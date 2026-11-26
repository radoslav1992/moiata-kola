/**
 * Общи типове за напомнянията. Binding-ите са описани с минимални интерфейси
 * (както KVLike в checks/cache.ts) — без зависимост от @cloudflare/workers-types.
 *
 * Модулите в тази папка се импортират с относителни пътища и разширение .ts,
 * за да се зареждат и от тестовете (node --test), не само от Vite.
 */

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}

export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown[]>;
}

/** Cloudflare Email Service (`send_email` binding). */
export interface EmailBinding {
  send(message: Record<string, unknown>): Promise<{ messageId?: string } | void>;
}

export interface ReminderEnv {
  DB?: D1Like;
  EMAIL?: EmailBinding;
  /** Адрес на подателя върху домейна с включено Email Sending, напр. no-reply@ponomer.com */
  EMAIL_FROM?: string;
  /** По желание: колко писма да тръгват на едно пускане на cron-а (по подразбиране 12 — виж cron.ts) */
  REMINDERS_PER_RUN?: string;
}

/** Напомнянията работят само когато и базата, и изпращането на имейли са настроени. */
export function remindersEnabled(env: ReminderEnv | undefined): env is ReminderEnv & { DB: D1Like; EMAIL: EmailBinding } {
  return !!env?.DB && !!env.EMAIL;
}

/** Заглавие в отговорите на проверките: "on", когато напомнянията са настроени. */
export const REMINDERS_HEADER = "x-reminders";

/** Видовете, както се пазят в базата. */
export type ReminderKind = "vignette" | "gtp" | "go";
export const REMINDER_KINDS: readonly ReminderKind[] = ["vignette", "gtp", "go"];

/** Видовете на проверките в сайта (CheckKind) → вид на напомнянето. */
export const KIND_FROM_CHECK: Record<string, ReminderKind> = {
  vignette: "vignette",
  inspection: "gtp",
  insurance: "go",
  gtp: "gtp",
  go: "go",
};

export interface ReminderRow {
  id: number;
  email: string;
  plate: string;
  kind: ReminderKind;
  valid_to: string;
  checked_on: string;
  confirmed_at: string | null;
  sent_14_at: string | null;
  sent_3_at: string | null;
  sent_1_at: string | null;
  send_failures: number;
  created_at: string;
}
