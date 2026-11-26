/**
 * Дневната задача (cron trigger → src/worker.ts): чисти старите редове и
 * праща напомнянията, чийто ден е дошъл. Сайтът НЕ проверява регистрите отново —
 * писмото казва какво е показала проверката на потребителя и води към нова.
 *
 * Може да се пуска и по няколко пъти на ден: всяко напомняне се отбелязва
 * като изпратено и не тръгва втори път.
 */
import { daysBetween, reminderPlan, sofiaDate } from "./dates.ts";
import { FATAL_SEND_ERRORS, reminderEmail, sendMail } from "./email.ts";
import { cleanup, dueReminders, issueToken, markFailed, markSent, type CleanupResult } from "./store.ts";
import { remindersEnabled, type ReminderEnv, type ReminderKind } from "./types.ts";
import type { RenewLinkConfig } from "../../data/renew-links.ts";

/**
 * Писма на едно пускане. На безплатния план на Workers едно извикване има 50
 * заявки към D1/други услуги; всяко писмо струва три (токен, изпращане, отметка).
 * На платен план лимитът се вдига с променливата REMINDERS_PER_RUN.
 */
export const MAX_EMAILS_PER_RUN = 12;

export interface DailyResult {
  cleaned?: CleanupResult;
  due: number;
  sent: number;
  failed: number;
  stopped?: string;
}

export async function runDaily(
  env: ReminderEnv | undefined,
  now = new Date(),
  opts: { renewLinks?: Record<ReminderKind, RenewLinkConfig>; limit?: number } = {},
): Promise<DailyResult> {
  const result: DailyResult = { due: 0, sent: 0, failed: 0 };
  // Базата се чисти и когато изпращането още не е настроено (фирмените запитвания ползват само D1).
  if (!env?.DB) return { ...result, stopped: "no_db" };
  const db = env.DB;
  result.cleaned = await cleanup(db, now);
  if (!remindersEnabled(env)) return { ...result, stopped: "no_email_binding" };

  const today = sofiaDate(now);
  const configured = Number(env.REMINDERS_PER_RUN);
  const limit = opts.limit ?? (Number.isInteger(configured) && configured > 0 ? configured : MAX_EMAILS_PER_RUN);
  const due = await dueReminders(db, today, limit);
  result.due = due.length;

  for (const { row, step } of due) {
    const plan = reminderPlan(row.valid_to, row.checked_on);
    const manageToken = await issueToken(db, row.id, "manage", now);
    const mail = reminderEmail({
      kind: row.kind,
      plate: row.plate,
      validTo: row.valid_to,
      checkedOn: row.checked_on,
      daysLeft: daysBetween(today, row.valid_to),
      last: step === plan[plan.length - 1],
      manageToken,
      renewLinks: opts.renewLinks,
    });
    const sent = await sendMail(env, { to: row.email, ...mail });
    if (sent.ok) {
      result.sent++;
      await markSent(db, row.id, step, now);
    } else {
      result.failed++;
      // Домейнът не е настроен или дневният лимит е изчерпан: спираме, утре се опитва пак.
      if (FATAL_SEND_ERRORS.has(sent.code)) return { ...result, stopped: sent.code };
      // Проблем с конкретния получател: до 3 опита, после редът се пропуска.
      await markFailed(db, row.id);
    }
  }
  return result;
}
