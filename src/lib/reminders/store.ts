/**
 * Всичко, което напомнянията пишат и четат в D1. Функциите приемат `now`
 * отвън, за да се тестват с фиксиран часовник.
 */
import { fingerprint, hashToken, isTokenShaped, newToken } from "./crypto.ts";
import { addDays, dueStep, sofiaDate, type ReminderStep } from "./dates.ts";
import type { D1Like, ReminderKind, ReminderRow } from "./types.ts";

export const UNCONFIRMED_TTL_HOURS = 48;
export const KEEP_AFTER_EXPIRY_DAYS = 30;
export const LEAD_TTL_DAYS = 730;
export const MAX_SEND_FAILURES = 3;

const iso = (at: Date) => at.toISOString();
const ago = (at: Date, seconds: number) => new Date(at.getTime() - seconds * 1000).toISOString();

/* Ограничение на честотата (отпечатъци, не сурови IP/имейли) */

export interface Limit {
  kind: string;
  max: number;
  seconds: number;
}

export const LIMITS = {
  signupIp: { kind: "signup_ip", max: 5, seconds: 60 * 60 },
  signupEmail: { kind: "signup_email", max: 3, seconds: 24 * 60 * 60 },
  leadIp: { kind: "lead_ip", max: 5, seconds: 60 * 60 },
} satisfies Record<string, Limit>;

export async function overLimit(db: D1Like, secret: string, limit: Limit, value: string, now: Date): Promise<boolean> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM attempts WHERE kind = ? AND key = ? AND created_at > ?")
    .bind(limit.kind, await fingerprint(secret, limit.kind, value), ago(now, limit.seconds))
    .first<{ n: number }>();
  return (row?.n ?? 0) >= limit.max;
}

export async function recordAttempt(db: D1Like, secret: string, limit: Limit, value: string, now: Date): Promise<void> {
  await db
    .prepare("INSERT INTO attempts (kind, key, created_at) VALUES (?, ?, ?)")
    .bind(limit.kind, await fingerprint(secret, limit.kind, value), iso(now))
    .run();
}

/** ALTCHA решението важи веднъж: връща false, ако този challenge вече е ползван. */
export async function claimChallenge(db: D1Like, challenge: string, now: Date): Promise<boolean> {
  const key = challenge.slice(0, 64);
  const seen = await db.prepare("SELECT 1 AS x FROM attempts WHERE kind = 'pow' AND key = ?").bind(key).first();
  if (seen) return false;
  await db.prepare("INSERT INTO attempts (kind, key, created_at) VALUES ('pow', ?, ?)").bind(key, iso(now)).run();
  return true;
}

/* Напомняния */

export interface SignupInput {
  email: string;
  plate: string;
  kind: ReminderKind;
  /** ГГГГ-ММ-ДД */
  validTo: string;
}

/**
 * Записва заявката. Уникалност по (имейл, номер, вид): повторна заявка сменя
 * датата. При нова дата флаговете за изпратени писма се нулират; потвърждението
 * се запазва. За непотвърден ред 48-те часа започват отначало.
 */
export async function upsertReminder(db: D1Like, input: SignupInput, now: Date): Promise<{ id: number; confirmed: boolean }> {
  const row = await db
    .prepare(
      `INSERT INTO reminders (email, plate, kind, valid_to, checked_on, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (email, plate, kind) DO UPDATE SET
         sent_14_at = CASE WHEN reminders.valid_to = excluded.valid_to THEN reminders.sent_14_at END,
         sent_3_at = CASE WHEN reminders.valid_to = excluded.valid_to THEN reminders.sent_3_at END,
         sent_1_at = CASE WHEN reminders.valid_to = excluded.valid_to THEN reminders.sent_1_at END,
         send_failures = 0,
         valid_to = excluded.valid_to,
         checked_on = excluded.checked_on,
         created_at = CASE WHEN reminders.confirmed_at IS NULL THEN excluded.created_at ELSE reminders.created_at END
       RETURNING id, confirmed_at`,
    )
    .bind(input.email, input.plate, input.kind, input.validTo, sofiaDate(now), iso(now))
    .first<{ id: number; confirmed_at: string | null }>();
  if (!row) throw new Error("reminders: upsert returned no row");
  return { id: Number(row.id), confirmed: !!row.confirmed_at };
}

export type TokenPurpose = "confirm" | "manage";

/** Нов токен за връзка в писмо; в базата отива само SHA-256 хешът му. */
export async function issueToken(db: D1Like, reminderId: number, purpose: TokenPurpose, now: Date): Promise<string> {
  const token = newToken();
  await db
    .prepare("INSERT INTO reminder_tokens (hash, reminder_id, purpose, created_at) VALUES (?, ?, ?, ?)")
    .bind(await hashToken(token), reminderId, purpose, iso(now))
    .run();
  return token;
}

export async function findByToken(db: D1Like, token: unknown, purpose: TokenPurpose): Promise<ReminderRow | null> {
  if (!isTokenShaped(token)) return null;
  return db
    .prepare(
      "SELECT r.* FROM reminder_tokens t JOIN reminders r ON r.id = t.reminder_id WHERE t.hash = ? AND t.purpose = ?",
    )
    .bind(await hashToken(token), purpose)
    .first<ReminderRow>();
}

/** Непотвърдена заявка важи 48 часа; после връзката не работи, а cron-ът изтрива реда. */
export function awaitingConfirmation(row: ReminderRow, now: Date): boolean {
  return !row.confirmed_at && row.created_at >= ago(now, UNCONFIRMED_TTL_HOURS * 3600);
}

/** Потвърждава заявката. Повторно отваряне на същата връзка не е грешка. */
export async function confirmReminder(db: D1Like, token: unknown, now: Date): Promise<{ row: ReminderRow; first: boolean } | null> {
  const row = await findByToken(db, token, "confirm");
  if (!row) return null;
  if (row.confirmed_at) return { row, first: false };
  if (!awaitingConfirmation(row, now)) return null;
  const confirmedAt = iso(now);
  await db.prepare("UPDATE reminders SET confirmed_at = ? WHERE id = ? AND confirmed_at IS NULL").bind(confirmedAt, row.id).run();
  return { row: { ...row, confirmed_at: confirmedAt }, first: true };
}

/** Спира едно напомняне: редът се изтрива заедно с токените му. */
export async function unsubscribe(db: D1Like, token: unknown): Promise<ReminderRow | null> {
  const row = await findByToken(db, token, "manage");
  if (!row) return null;
  await db.batch([
    db.prepare("DELETE FROM reminder_tokens WHERE reminder_id = ?").bind(row.id),
    db.prepare("DELETE FROM reminders WHERE id = ?").bind(row.id),
  ]);
  return row;
}

/** „Изтрий всичко за този имейл“: всички напомняния, запитванията от фирмената страница и отпечатъците. */
export async function deleteAllForEmail(
  db: D1Like,
  secret: string,
  token: unknown,
): Promise<{ email: string; reminders: number; leads: number } | null> {
  const row = await findByToken(db, token, "manage");
  if (!row) return null;
  const count = await db.prepare("SELECT COUNT(*) AS n FROM reminders WHERE email = ?").bind(row.email).first<{ n: number }>();
  const leads = await db.prepare("SELECT COUNT(*) AS n FROM business_leads WHERE email = ?").bind(row.email).first<{ n: number }>();
  await db.batch([
    db.prepare("DELETE FROM reminder_tokens WHERE reminder_id IN (SELECT id FROM reminders WHERE email = ?)").bind(row.email),
    db.prepare("DELETE FROM reminders WHERE email = ?").bind(row.email),
    db.prepare("DELETE FROM business_leads WHERE email = ?").bind(row.email),
    db
      .prepare("DELETE FROM attempts WHERE kind = ? AND key = ?")
      .bind(LIMITS.signupEmail.kind, await fingerprint(secret, LIMITS.signupEmail.kind, row.email)),
  ]);
  return { email: row.email, reminders: count?.n ?? 0, leads: leads?.n ?? 0 };
}

/* Cron */

export interface DueReminder {
  row: ReminderRow;
  step: ReminderStep;
}

/** Потвърдените редове, за които днес трябва да тръгне писмо (най-близките срокове първи). */
export async function dueReminders(db: D1Like, today: string, limit: number): Promise<DueReminder[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM reminders
       WHERE confirmed_at IS NOT NULL AND send_failures < ?1 AND valid_to >= ?2 AND valid_to <= ?3
         AND (sent_14_at IS NULL OR sent_3_at IS NULL OR sent_1_at IS NULL)
       ORDER BY valid_to, id`,
    )
    .bind(MAX_SEND_FAILURES, today, addDays(today, 14))
    .all<ReminderRow>();
  const due: DueReminder[] = [];
  for (const row of results) {
    const step = dueStep(row, today);
    if (step) due.push({ row, step });
    if (due.length >= limit) break;
  }
  return due;
}

const SENT_COLUMN: Record<ReminderStep, string> = { "14": "sent_14_at", "3": "sent_3_at", "1": "sent_1_at" };

export async function markSent(db: D1Like, id: number, step: ReminderStep, now: Date): Promise<void> {
  await db.prepare(`UPDATE reminders SET ${SENT_COLUMN[step]} = ?, send_failures = 0 WHERE id = ?`).bind(iso(now), id).run();
}

export async function markFailed(db: D1Like, id: number): Promise<void> {
  await db.prepare("UPDATE reminders SET send_failures = send_failures + 1 WHERE id = ?").bind(id).run();
}

export interface CleanupResult {
  unconfirmed: number;
  expired: number;
  leads: number;
}

/**
 * Изтрива: непотвърдени заявки след 48 часа; напомняния на 30-ия ден след датата
 * на изтичане; запитвания от фирми след 24 месеца; отпечатъци след 24 часа.
 */
export async function cleanup(db: D1Like, now: Date): Promise<CleanupResult> {
  const today = sofiaDate(now);
  const unconfirmedBefore = ago(now, UNCONFIRMED_TTL_HOURS * 3600);
  const expiredBefore = addDays(today, -KEEP_AFTER_EXPIRY_DAYS);
  const stale = "confirmed_at IS NULL AND created_at < ?1";
  const expired = "valid_to <= ?1";
  const changes = (r: unknown) => (r as { meta?: { changes?: number } })?.meta?.changes ?? 0;
  const results = await db.batch([
    db.prepare(`DELETE FROM reminder_tokens WHERE reminder_id IN (SELECT id FROM reminders WHERE ${stale})`).bind(unconfirmedBefore),
    db.prepare(`DELETE FROM reminders WHERE ${stale}`).bind(unconfirmedBefore),
    db.prepare(`DELETE FROM reminder_tokens WHERE reminder_id IN (SELECT id FROM reminders WHERE ${expired})`).bind(expiredBefore),
    db.prepare(`DELETE FROM reminders WHERE ${expired}`).bind(expiredBefore),
    db.prepare("DELETE FROM business_leads WHERE created_at < ?").bind(ago(now, LEAD_TTL_DAYS * 86_400)),
    db.prepare("DELETE FROM attempts WHERE created_at < ?").bind(ago(now, 24 * 3600)),
  ]);
  return { unconfirmed: changes(results[1]), expired: changes(results[3]), leads: changes(results[4]) };
}
