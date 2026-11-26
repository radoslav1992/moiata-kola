/**
 * Дати и график на напомнянията. Всичко се смята в календарни дни по
 * българско време (Europe/Sofia) — така „изтича на 12 март“ значи едно и също
 * в сайта, в писмото и в cron-а, независимо че Worker-ът работи в UTC.
 *
 * Модулът е чист (без мрежа и без база) и се ползва и в браузъра.
 */

const DAY_MS = 86_400_000;
const SOFIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Sofia",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Календарната дата в България за даден момент → "ГГГГ-ММ-ДД". */
export function sofiaDate(at: Date): string {
  return SOFIA.format(at);
}

function isRealDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === date;
}

/**
 * validTo от проверката → денят на изтичане "ГГГГ-ММ-ДД" (или null).
 * Регистрите връщат или дата/час без зона (българско време, напр.
 * "2027-06-01T23:59:59"), или момент със зона ("…Z", "+03:00").
 */
export function expiryDate(validTo: unknown): string | null {
  if (typeof validTo !== "string" || validTo.length > 40) return null;
  const s = validTo.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isRealDate(s) ? s : null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const at = new Date(s);
    return Number.isNaN(at.getTime()) ? null : sofiaDate(at);
  }
  const date = s.slice(0, 10);
  return isRealDate(date) ? date : null;
}

/** Цели календарни дни от `from` до `to` (и двете "ГГГГ-ММ-ДД"). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Най-далечната дата, за която приемаме напомняне (ГТП на нова кола важи 3 години). */
export const MAX_LEAD_DAYS = 3 * 366 + 31;

export type ReminderStep = "14" | "3" | "1";

/**
 * Кои напомняния има смисъл да се пратят, ако заявката е направена на
 * `signupDay` за срок, изтичащ на `validTo`:
 *
 *   над 14 дни        → 14 дни и 3 дни преди
 *   от 4 до 14 дни    → само 3 дни преди (14-дневното вече е в миналото)
 *   2 или 3 дни       → едно, в деня преди изтичането (кратки винетки)
 *   до 1 ден          → нищо: няма кога да напомним, не предлагаме
 */
export function reminderPlan(validTo: string, signupDay: string): ReminderStep[] {
  const lead = daysBetween(signupDay, validTo);
  if (lead > MAX_LEAD_DAYS) return [];
  if (lead > 14) return ["14", "3"];
  if (lead >= 4) return ["3"];
  if (lead >= 2) return ["1"];
  return [];
}

export interface DueInput {
  valid_to: string;
  checked_on: string;
  sent_14_at: string | null;
  sent_3_at: string | null;
  sent_1_at: string | null;
}

/**
 * Кое напомняне (ако има) трябва да тръгне днес за този ред. Прозорците са
 * интервали, не точни дни: ако cron-ът пропусне ден, писмото тръгва на
 * следващия и казва реалния брой оставащи дни.
 *
 *   "14": остават от 4 до 14 дни
 *   "3":  остават от 0 до 3 дни
 *   "1":  остава 1 ден (или денят на изтичане, ако cron-ът е пропуснал)
 */
export function dueStep(row: DueInput, today: string): ReminderStep | null {
  const left = daysBetween(today, row.valid_to);
  if (left < 0) return null;
  const plan = reminderPlan(row.valid_to, row.checked_on);
  if (plan.includes("14") && !row.sent_14_at && left <= 14 && left >= 4) return "14";
  if (plan.includes("3") && !row.sent_3_at && left <= 3) return "3";
  if (plan.includes("1") && !row.sent_1_at && left <= 1) return "1";
  return null;
}

const MONTHS = [
  "януари", "февруари", "март", "април", "май", "юни",
  "юли", "август", "септември", "октомври", "ноември", "декември",
];

/** "2027-03-12" → "12 март 2027 г." */
export function formatBgDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y} г.`;
}

/** 0 → "днес", 1 → "утре", N → "след N дни" */
export function formatDaysLeft(left: number): string {
  if (left <= 0) return "днес";
  if (left === 1) return "утре";
  return `след ${left} дни`;
}

/** Кога ще пишем — за офертата под резултата и за страницата за потвърждение. */
export function describePlan(plan: ReminderStep[], validTo: string): string {
  const date = formatBgDate(validTo);
  if (plan.includes("14")) return `Ще ви пишем 14 дни и 3 дни преди ${date}`;
  if (plan.includes("3")) return `Ще ви пишем 3 дни преди ${date}`;
  if (plan.includes("1")) return `Ще ви пишем в деня преди ${date}`;
  return "";
}

/** Завършва изречение с точка — освен ако вече свършва с такава („… 2027 г.“ не получава втора). */
export function endSentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}
