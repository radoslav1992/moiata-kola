/**
 * Запитванията от страницата „За фирми и автопаркове“ (/za-firmi). Услугата е
 * само планирана — формата събира интерес, нищо не се продава и нищо не се праща.
 * Работи с обикновен POST (без JavaScript) и иска само D1 binding-а.
 */
import { clientIp, isRateLimited } from "../checks/rate-limit.ts";
import { parseEmail, sameOrigin } from "./api.ts";
import { serverSecret } from "./crypto.ts";
import { LIMITS, overLimit, recordAttempt } from "./store.ts";
import type { D1Like } from "./types.ts";

export const VEHICLE_RANGES = [
  { value: "2-5", label: "2–5" },
  { value: "6-20", label: "6–20" },
  { value: "21-50", label: "21–50" },
  { value: "51-200", label: "51–200" },
  { value: "200+", label: "над 200" },
] as const;

export const NEEDS = [
  { value: "list", label: "Един списък с всички коли и сроковете им" },
  { value: "reminders", label: "Напомняния по имейл преди изтичане" },
  { value: "export", label: "Експорт към Excel или CSV" },
] as const;

export const BUDGETS = [
  { value: "0", label: "Не бих платил" },
  { value: "<10", label: "до 10 € на месец" },
  { value: "10-25", label: "10–25 € на месец" },
  { value: "25-50", label: "25–50 € на месец" },
  { value: "50+", label: "над 50 € на месец" },
] as const;

/** Скрито поле-капан: хората не го виждат, ботовете го попълват. */
export const HONEYPOT_FIELD = "website";

export interface LeadValues {
  email: string;
  company: string;
  vehicles: string;
  needs: string[];
  budget: string;
  consent: boolean;
}

export type LeadErrors = Partial<Record<keyof LeadValues | "form", string>>;

export const EMPTY_LEAD: LeadValues = { email: "", company: "", vehicles: "", needs: [], budget: "", consent: false };

const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.trim() : "");

export function parseLead(form: FormData): { values: LeadValues; errors: LeadErrors; bot: boolean } {
  const values: LeadValues = {
    email: str(form.get("email")).slice(0, 254),
    company: str(form.get("company")).slice(0, 120),
    vehicles: str(form.get("vehicles")),
    needs: form.getAll("needs").map(str).filter((n) => NEEDS.some((x) => x.value === n)),
    budget: str(form.get("budget")),
    consent: form.get("consent") !== null,
  };
  const errors: LeadErrors = {};
  if (!parseEmail(values.email)) errors.email = "Въведете валиден имейл адрес.";
  if (/[\u0000-\u001f\u007f]/.test(values.company)) errors.company = "Името съдържа недопустими знаци.";
  if (!VEHICLE_RANGES.some((r) => r.value === values.vehicles)) errors.vehicles = "Изберете колко автомобила имате.";
  if (!values.needs.length) errors.needs = "Изберете поне едно нещо, което ви трябва.";
  if (!BUDGETS.some((b) => b.value === values.budget)) errors.budget = "Изберете един от отговорите.";
  if (!values.consent) errors.consent = "Отбележете съгласието — без него не можем да запазим отговорите ви.";
  return { values, errors, bot: str(form.get(HONEYPOT_FIELD)) !== "" };
}

export type LeadOutcome =
  | { status: "saved" }
  | { status: "invalid"; values: LeadValues; errors: LeadErrors }
  | { status: "rejected"; code: 403 | 429; values: LeadValues; errors: LeadErrors };

/** Обработва POST от формата. Извиква се само когато D1 е настроена. */
export async function submitLead(request: Request, db: D1Like, now = new Date()): Promise<LeadOutcome> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { status: "invalid", values: EMPTY_LEAD, errors: { form: "Формата не можа да бъде прочетена. Опитайте отново." } };
  }
  const { values, errors, bot } = parseLead(form);
  const ip = clientIp(request);
  if (!sameOrigin(request)) {
    return { status: "rejected", code: 403, values, errors: { form: "Заявката беше отхвърлена. Изпратете формата от тази страница." } };
  }
  if (isRateLimited(ip)) {
    return { status: "rejected", code: 429, values, errors: { form: "Твърде много заявки. Опитайте отново след малко." } };
  }
  // Попълнен капан: отговаряме като при успех, но не записваме нищо.
  if (bot) return { status: "saved" };
  if (Object.keys(errors).length) return { status: "invalid", values, errors };

  const secret = await serverSecret(db);
  if (await overLimit(db, secret, LIMITS.leadIp, ip, now)) {
    return { status: "rejected", code: 429, values, errors: { form: "Твърде много заявки. Опитайте отново по-късно." } };
  }
  await recordAttempt(db, secret, LIMITS.leadIp, ip, now);
  const at = now.toISOString();
  await db
    .prepare("INSERT INTO business_leads (email, company, vehicles, needs, budget, consent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(parseEmail(values.email), values.company || null, values.vehicles, values.needs.join(","), values.budget, at, at)
    .run();
  return { status: "saved" };
}
