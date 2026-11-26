/**
 * Писмата на напомнянията през Cloudflare Email Service (`send_email` binding EMAIL).
 * Всяко писмо има текстова и HTML част, връзка за спиране на напомнянето и връзка
 * „изтрий всичко за този имейл“. HTML-ът е таблица с inline стилове — така се
 * вижда еднакво в Gmail, Outlook и Apple Mail.
 */
import { SITE } from "../site.ts";
import { renewLink, RENEW_LINKS, type RenewLinkConfig } from "../../data/renew-links.ts";
import { describePlan, endSentence, formatBgDate, formatDaysLeft, type ReminderStep } from "./dates.ts";
import type { EmailBinding, ReminderKind } from "./types.ts";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

export type SendResult = { ok: true; id: string } | { ok: false; code: string; message: string };

/** Грешки, които значат, че домейнът не е настроен за изпращане — няма смисъл да се опитва със следващия получател. */
export const FATAL_SEND_ERRORS = new Set(["E_SENDER_NOT_VERIFIED", "E_SENDER_DOMAIN_NOT_AVAILABLE", "E_DAILY_LIMIT_EXCEEDED"]);

export const DEFAULT_FROM = `no-reply@${SITE.domain}`;

export async function sendMail(env: { EMAIL?: EmailBinding; EMAIL_FROM?: string }, mail: Mail): Promise<SendResult> {
  if (!env.EMAIL) return { ok: false, code: "E_NO_BINDING", message: "EMAIL binding is not configured" };
  try {
    const result = await env.EMAIL.send({
      from: { email: env.EMAIL_FROM || DEFAULT_FROM, name: SITE.name },
      to: mail.to,
      ...(SITE.email ? { replyTo: SITE.email } : {}),
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      ...(mail.headers ? { headers: mail.headers } : {}),
    });
    // wrangler dev симулира binding-а и не връща messageId
    return { ok: true, id: result?.messageId ?? "local" };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error("[email]", e.code, e.message);
    return { ok: false, code: e.code ?? "E_UNKNOWN", message: e.message ?? String(err) };
  }
}

/* Текстове по вид */

interface KindText {
  /** Подлог с главна буква: „Винетката“ */
  subject: string;
  /** След „за“: „за винетката“ */
  object: string;
  recheckPath: string;
  recheckNote: string;
}

export const KIND_TEXT: Record<ReminderKind, KindText> = {
  vignette: { subject: "Винетката", object: "винетката", recheckPath: "/vinetka/proverka", recheckNote: "" },
  gtp: {
    subject: "Техническият преглед (ГТП)",
    object: "техническия преглед (ГТП)",
    recheckPath: "/gtp/proverka",
    recheckNote: " Системата на ИААА ще поиска код за сигурност — въвеждате го вие.",
  },
  go: {
    subject: "Гражданската отговорност",
    object: "Гражданската отговорност",
    recheckPath: "/grazhdanska-otgovornost/proverka",
    recheckNote: "",
  },
};

export const absoluteUrl = (path: string) => (/^https?:\/\//.test(path) ? path : `${SITE.url}${path}`);
export const confirmUrl = (token: string) => `${SITE.url}/napomnyane/potvarzhdenie?t=${token}`;
export const unsubscribeUrl = (token: string) => `${SITE.url}/napomnyane/otpisvane?t=${token}`;
export const deleteAllUrl = (token: string) => `${SITE.url}/napomnyane/iztrivane?t=${token}`;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const C = { accent: "#003d99", ink: "#101a28", soft: "#4a5a70", faint: "#7b8a9e", line: "#e3e9f1", canvas: "#f7f9fb" };

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0"><tr><td style="background:${C.accent};border-radius:10px">
<a href="${esc(href)}" style="display:inline-block;padding:12px 20px;font:600 15px/1.2 Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none">${esc(label)}</a>
</td></tr></table>`;
}

const p = (html: string, extra = "") => `<p style="margin:0 0 12px;${extra}">${html}</p>`;

interface ManageLinks {
  /** Токен „manage“ — отваря и спирането, и изтриването */
  manageToken: string;
}

function footerText(why: string, links: ManageLinks): string {
  return [
    "--",
    why,
    `Спиране на това напомняне: ${unsubscribeUrl(links.manageToken)}`,
    `Изтриване на всичко за този имейл: ${deleteAllUrl(links.manageToken)}`,
    `${SITE.domain} е неофициален сайт. Меродавни са официалните регистри.`,
  ].join("\n");
}

function layout(opts: { preheader: string; heading: string; body: string; why: string; links: ManageLinks }): string {
  return `<!doctype html>
<html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.heading)}</title></head>
<body style="margin:0;padding:0;background:${C.canvas}">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(opts.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.canvas}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${C.line};border-radius:16px">
<tr><td style="padding:20px 24px 0;font:600 16px/1.2 Arial,Helvetica,sans-serif;color:${C.accent}">${esc(SITE.name)} <span style="color:${C.faint};font-weight:400">· ${esc(SITE.domain)}</span></td></tr>
<tr><td style="padding:16px 24px 8px;font:400 16px/1.6 Arial,Helvetica,sans-serif;color:${C.ink}">
<h1 style="margin:0 0 14px;font:600 21px/1.3 Arial,Helvetica,sans-serif;color:${C.ink}">${esc(opts.heading)}</h1>
${opts.body}
</td></tr>
<tr><td style="padding:14px 24px 22px;border-top:1px solid ${C.line};font:400 12px/1.6 Arial,Helvetica,sans-serif;color:${C.faint}">
${esc(opts.why)}<br>
<a href="${esc(unsubscribeUrl(opts.links.manageToken))}" style="color:${C.soft}">Спри това напомняне</a> ·
<a href="${esc(deleteAllUrl(opts.links.manageToken))}" style="color:${C.soft}">Изтрий всичко за този имейл</a><br>
${esc(SITE.domain)} е неофициален сайт. Меродавни са официалните регистри.
</td></tr>
</table></td></tr></table></body></html>`;
}

/** RFC 8058: пощенските клиенти показват собствен бутон „Отписване“ и го изпълняват с един POST. */
function unsubscribeHeaders(manageToken: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl(manageToken)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export interface ReminderFacts {
  kind: ReminderKind;
  plate: string;
  /** ГГГГ-ММ-ДД */
  validTo: string;
  /** ГГГГ-ММ-ДД — денят на проверката, от която е датата */
  checkedOn: string;
}

/** Първото писмо: връзка за потвърждение (double opt-in). */
export function confirmationEmail(
  f: ReminderFacts & { plan: ReminderStep[]; confirmToken: string } & ManageLinks,
): Omit<Mail, "to"> {
  const k = KIND_TEXT[f.kind];
  const url = confirmUrl(f.confirmToken);
  const fact = endSentence(
    `${k.subject} на ${f.plate} изтича на ${formatBgDate(f.validTo)} — според проверката, направена в ${SITE.domain} на ${formatBgDate(f.checkedOn)}`,
  );
  const plan = endSentence(describePlan(f.plan, f.validTo));
  const unconfirmed = "Без потвърждение не изпращаме нищо, а заявката се изтрива след 48 часа.";
  const notYou = "Ако не сте поискали напомняне, не правете нищо.";
  const why = `Получавате това писмо, защото в ${SITE.domain} беше поискано напомняне за този адрес.`;
  return {
    subject: `Потвърдете напомнянето за ${k.object} на ${f.plate}`,
    text: [
      "Здравейте,",
      "",
      `В ${SITE.domain} беше поискано напомняне на този имейл. ${fact}`,
      "",
      "Потвърдете, за да го включим:",
      url,
      "",
      `${plan} ${unconfirmed}`,
      "",
      notYou,
      "",
      footerText(why, f),
    ].join("\n"),
    html: layout({
      preheader: "Потвърдете с един клик, за да включим напомнянето.",
      heading: "Потвърдете напомнянето",
      body:
        p(`В ${esc(SITE.domain)} беше поискано напомняне на този имейл. ${esc(fact)}`) +
        button(url, "Потвърди напомнянето") +
        p(`${esc(plan)} ${unconfirmed}`, `color:${C.soft};font-size:14px`) +
        p(notYou, `color:${C.soft};font-size:14px`),
      why,
      links: f,
    }),
    headers: unsubscribeHeaders(f.manageToken),
  };
}

/** Повторна заявка за вече потвърдено напомняне: датата е сменена, ново потвърждение не трябва. */
export function updatedEmail(f: ReminderFacts & { plan: ReminderStep[] } & ManageLinks): Omit<Mail, "to"> {
  const k = KIND_TEXT[f.kind];
  const fact = endSentence(
    `Напомнянето за ${k.object} на ${f.plate} вече е за ${formatBgDate(f.validTo)} — според проверката, направена в ${SITE.domain} на ${formatBgDate(f.checkedOn)}`,
  );
  const plan = `${endSentence(describePlan(f.plan, f.validTo))} Ново потвърждение не е нужно.`;
  const why = `Получавате това писмо, защото в ${SITE.domain} отново беше поискано напомняне за този адрес.`;
  return {
    subject: `Обновихме напомнянето за ${k.object} на ${f.plate}`,
    text: ["Здравейте,", "", fact, "", plan, "", footerText(why, f)].join("\n"),
    html: layout({
      preheader: `Новата дата е ${formatBgDate(f.validTo)}`,
      heading: "Напомнянето е обновено",
      body: p(esc(fact)) + p(esc(plan), `color:${C.soft};font-size:14px`),
      why,
      links: f,
    }),
    headers: unsubscribeHeaders(f.manageToken),
  };
}

/** Самото напомняне — 14 дни, 3 дни или ден преди срока. */
export function reminderEmail(
  f: ReminderFacts & { daysLeft: number; last: boolean; renewLinks?: Record<ReminderKind, RenewLinkConfig> } & ManageLinks,
): Omit<Mail, "to"> {
  const k = KIND_TEXT[f.kind];
  const when = formatDaysLeft(f.daysLeft);
  const date = formatBgDate(f.validTo);
  const renew = renewLink(f.kind, f.renewLinks ?? RENEW_LINKS);
  const renewUrl = absoluteUrl(renew.href);
  const recheckUrl = `${SITE.url}${k.recheckPath}?plate=${encodeURIComponent(f.plate)}`;

  const fact = endSentence(
    `${k.subject} на ${f.plate} изтича ${when} — на ${date}, според проверката, направена в ${SITE.domain} на ${formatBgDate(f.checkedOn)}`,
  );
  const stale = `Оттогава не сме проверявали отново и не знаем дали срокът вече е подновен. Актуалното състояние се вижда с нова проверка.${k.recheckNote}`;
  const last = f.last ? "Това е последното писмо за този срок. Данните за напомнянето се изтриват 30 дни след датата." : "";
  const why = `Получавате това писмо, защото поискахте и потвърдихте напомняне в ${SITE.domain}.`;

  return {
    subject: `${k.subject} на ${f.plate} изтича ${when} — на ${date}`,
    text: [
      "Здравейте,",
      "",
      fact,
      "",
      stale,
      `Провери отново: ${recheckUrl}`,
      "",
      `${renew.label}: ${renewUrl}`,
      ...(renew.disclosure ? [renew.disclosure] : []),
      ...(last ? ["", last] : []),
      "",
      footerText(why, f),
    ].join("\n"),
    html: layout({
      preheader: `Изтича ${when} — на ${date}`,
      heading: `${k.subject} на ${f.plate} изтича ${when}`,
      body:
        p(esc(fact)) +
        p(esc(stale), `color:${C.soft};font-size:14px`) +
        button(recheckUrl, "Провери отново") +
        p(
          `<a href="${esc(renewUrl)}"${renew.partner ? ' rel="sponsored nofollow noopener"' : ""} style="color:${C.accent};font-weight:600">${esc(renew.label)}</a>` +
            (renew.disclosure ? `<br><span style="color:${C.faint};font-size:13px">${esc(renew.disclosure)}</span>` : ""),
        ) +
        (last ? p(esc(last), `color:${C.soft};font-size:14px`) : ""),
      why,
      links: f,
    }),
    headers: unsubscribeHeaders(f.manageToken),
  };
}
