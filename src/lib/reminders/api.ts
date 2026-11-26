/**
 * Обработката на заявките за напомняне. Маршрутите в src/pages/api/reminders/
 * само подават заявката и binding-ите тук — така логиката се тества директно.
 *
 * Без D1 или без EMAIL binding всичко отговаря с 404: функцията е изключена,
 * докато собственикът не я настрои (README → „Напомняния по имейл“).
 */
import { isValidBgPlate, normalizePlate } from "../checks/types.ts";
import { clientIp, isRateLimited } from "../checks/rate-limit.ts";
import { claimChallenge, issueToken, LIMITS, overLimit, recordAttempt, upsertReminder } from "./store.ts";
import { createChallenge, serverSecret, verifySolution } from "./crypto.ts";
import { daysBetween, expiryDate, MAX_LEAD_DAYS, reminderPlan, sofiaDate } from "./dates.ts";
import { confirmationEmail, sendMail, updatedEmail } from "./email.ts";
import { KIND_FROM_CHECK, remindersEnabled, type ReminderEnv } from "./types.ts";

const MESSAGES = {
  not_found: "Не е намерено.",
  forbidden: "Заявката беше отхвърлена.",
  rate_limited: "Твърде много заявки. Опитайте отново по-късно.",
  bad_request: "Невалидна заявка.",
  invalid_email: "Въведете валиден имейл адрес.",
  invalid_plate: "Невалиден регистрационен номер.",
  invalid_kind: "Непознат вид проверка.",
  invalid_date: "Липсва валидна дата на изтичане. Направете проверката отново.",
  consent_required: "Отбележете съгласието — без него не можем да запазим имейла за напомнянето.",
  too_soon: "Срокът изтича до ден — няма кога да изпратим напомняне.",
  captcha: "Защитата срещу автоматични заявки не мина. Опитайте отново.",
  email_failed: "Не успяхме да изпратим писмото за потвърждение. Опитайте отново след малко.",
};

export type ApiError = keyof typeof MESSAGES;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export const fail = (status: number, error: ApiError) => json({ error, message: MESSAGES[error] }, status);

/** Защита от заявки от чужди сайтове за методите, които променят данни. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === new URL(request.url).host;
    } catch {
      return false;
    }
  }
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function parseEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email) || CONTROL_CHARS.test(email)) return null;
  return email;
}

/** GET /api/reminders/challenge → ALTCHA challenge за формата. */
export async function handleChallenge(request: Request, env: ReminderEnv | undefined, now = new Date()): Promise<Response> {
  if (!remindersEnabled(env)) return fail(404, "not_found");
  if (isRateLimited(clientIp(request))) return fail(429, "rate_limited");
  return json(await createChallenge(await serverSecret(env.DB), now.getTime()));
}

/**
 * POST /api/reminders  { email, plate, kind, validTo, consent, altcha }
 *
 * Записва непотвърдена заявка и праща писмо с връзка за потвърждение.
 * Отговорът е един и същ за нов и за вече записан имейл.
 */
export async function handleSignup(request: Request, env: ReminderEnv | undefined, now = new Date()): Promise<Response> {
  if (!remindersEnabled(env)) return fail(404, "not_found");
  const ip = clientIp(request);
  if (isRateLimited(ip)) return fail(429, "rate_limited");
  if (!sameOrigin(request)) return fail(403, "forbidden");

  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 8000) return fail(400, "bad_request");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail(400, "bad_request");
    body = parsed as Record<string, unknown>;
  } catch {
    return fail(400, "bad_request");
  }

  const email = parseEmail(body.email);
  if (!email) return fail(400, "invalid_email");
  const plate = normalizePlate(typeof body.plate === "string" ? body.plate : "");
  if (!isValidBgPlate(plate)) return fail(400, "invalid_plate");
  const kind = typeof body.kind === "string" ? KIND_FROM_CHECK[body.kind] : undefined;
  if (!kind) return fail(400, "invalid_kind");
  const validTo = expiryDate(body.validTo);
  if (!validTo) return fail(400, "invalid_date");
  if (body.consent !== true) return fail(400, "consent_required");

  const today = sofiaDate(now);
  const plan = reminderPlan(validTo, today);
  if (!plan.length) {
    const lead = daysBetween(today, validTo);
    return fail(400, lead >= 0 && lead <= MAX_LEAD_DAYS ? "too_soon" : "invalid_date");
  }

  const db = env.DB;
  const secret = await serverSecret(db);
  const verdict = await verifySolution(secret, body.altcha, now.getTime());
  if (!verdict.ok || !(await claimChallenge(db, verdict.challenge, now))) return fail(400, "captcha");

  if ((await overLimit(db, secret, LIMITS.signupIp, ip, now)) || (await overLimit(db, secret, LIMITS.signupEmail, email, now))) {
    return fail(429, "rate_limited");
  }
  await recordAttempt(db, secret, LIMITS.signupIp, ip, now);
  await recordAttempt(db, secret, LIMITS.signupEmail, email, now);

  const { id, confirmed } = await upsertReminder(db, { email, plate, kind, validTo }, now);
  const manageToken = await issueToken(db, id, "manage", now);
  const facts = { kind, plate, validTo, checkedOn: today, plan, manageToken };
  const mail = confirmed
    ? updatedEmail(facts)
    : confirmationEmail({ ...facts, confirmToken: await issueToken(db, id, "confirm", now) });

  const sent = await sendMail(env, { to: email, ...mail });
  if (!sent.ok) return fail(502, "email_failed");
  return json({ ok: true });
}
