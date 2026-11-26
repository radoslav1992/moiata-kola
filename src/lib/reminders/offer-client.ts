/**
 * Офертата „Напомнете ми по имейл“ под валиден резултат от проверка (браузър).
 *
 * Показва се само ако сървърът е върнал заглавие x-reminders: on (D1 и EMAIL са
 * настроени) и до срока остава достатъчно време за поне едно писмо. Без акаунт:
 * имейл, съгласие и невидима ALTCHA задача, която браузърът решава при изпращане.
 * Заявката е непотвърдена, докато човекът не отвори връзката от писмото.
 */
import { solveChallenge, type AltchaChallenge } from "./crypto.ts";
import { describePlan, endSentence, expiryDate, reminderPlan, sofiaDate } from "./dates.ts";

export { REMINDERS_HEADER } from "./types.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface OfferTarget {
  /** Вид на проверката в сайта: vignette | insurance | inspection */
  kind: string;
  plate: string;
  /** validTo от резултата на проверката */
  validTo: string;
}

export function removeReminderOffer(root: Element, kind: string): void {
  root.querySelector(`[data-reminder-offer="${kind}"]`)?.remove();
}

/** Имейлът от последната успешна заявка — за да не се пише отново за следващия срок на същата страница. */
let lastEmail = "";

/**
 * Вмъква офертата веднага след `card`. Не прави нищо, ако няма кога да напомним.
 * `collapsed`: на страниците с няколко проверки офертата е един ред, който се
 * разгръща при натискане — три отворени форми под три резултата са твърде много.
 */
export function mountReminderOffer(card: Element, target: OfferTarget, opts: { collapsed?: boolean } = {}): void {
  const validTo = expiryDate(target.validTo);
  if (!validTo) return;
  const plan = reminderPlan(validTo, sofiaDate(new Date()));
  if (!plan.length) return;

  if (card.parentElement) removeReminderOffer(card.parentElement, target.kind);
  const id = `remind-${target.kind}`;
  const offer = "Напомнете ми по имейл, преди да изтече";
  const form = document.createElement("form");
  form.noValidate = true;
  form.className = "card p-4 sm:p-5";
  form.dataset.reminderOffer = target.kind;
  form.setAttribute("aria-labelledby", `${id}-title`);
  form.innerHTML = `
    ${
      opts.collapsed
        ? `<button type="button" id="${id}-title" aria-expanded="false" aria-controls="${id}-body" data-offer-toggle
             class="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold text-accent">
             <span>${offer}</span><span aria-hidden="true">+</span>
           </button>`
        : `<p class="text-sm font-semibold text-ink" id="${id}-title">${offer}</p>`
    }
    <div id="${id}-body" ${opts.collapsed ? "hidden" : ""}>
      <p class="mt-1 text-sm text-ink-soft">${esc(endSentence(describePlan(plan, validTo)))} Без регистрация.</p>
      <div data-offer-fields>
        <label class="sr-only" for="${id}-email">Имейл адрес</label>
        <input id="${id}-email" name="email" type="email" inputmode="email" autocomplete="email" required
          placeholder="вашият имейл" value="${esc(lastEmail)}"
          class="mt-3 w-full min-w-0 rounded-lg border border-line-strong bg-white px-4 py-2.5 text-base text-ink outline-none focus:border-accent" />
        <label class="mt-3 flex items-start gap-2.5 text-xs leading-relaxed text-ink-soft">
          <input type="checkbox" name="consent" required class="mt-0.5 h-4 w-4 shrink-0 accent-accent" />
          <span>Съгласен съм ponomer.com да пази имейла ми, номера и датата на изтичане, за да ми изпрати напомнянето.
            <a href="/poveritelnost#napomnyaniya" class="font-medium text-accent underline decoration-accent/30 underline-offset-2">Как пазим данните</a></span>
        </label>
        <button type="submit" class="btn-primary mt-3 w-full sm:w-auto">Напомнете ми</button>
      </div>
      <p class="mt-3 text-sm outline-none empty:hidden" role="status" tabindex="-1" data-offer-status></p>
    </div>`;
  card.insertAdjacentElement("afterend", form);

  const email = form.querySelector<HTMLInputElement>("input[name=email]")!;
  const consent = form.querySelector<HTMLInputElement>("input[name=consent]")!;
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]")!;
  const fields = form.querySelector<HTMLElement>("[data-offer-fields]")!;
  const status = form.querySelector<HTMLElement>("[data-offer-status]")!;
  const body = form.querySelector<HTMLElement>(`#${id}-body`)!;

  const toggle = form.querySelector<HTMLButtonElement>("[data-offer-toggle]");
  toggle?.addEventListener("click", () => {
    const open = body.hidden;
    body.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.lastElementChild!.textContent = open ? "−" : "+";
    if (open && fields.isConnected) email.focus();
  });

  const say = (text: string, tone: "bad" | "ok" | "soft") => {
    status.className = `mt-3 text-sm outline-none empty:hidden ${tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : "text-ink-soft"}`;
    status.textContent = text;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    const address = email.value.trim();
    if (!address || !email.checkValidity()) {
      say("Въведете валиден имейл адрес.", "bad");
      email.focus();
      return;
    }
    if (!consent.checked) {
      say("Отбележете съгласието — без него не можем да запазим имейла за напомнянето.", "bad");
      consent.focus();
      return;
    }

    button.disabled = true;
    say("Изпращаме…", "soft");
    try {
      const challengeRes = await fetch("/api/reminders/challenge");
      if (!challengeRes.ok) throw new Error(await messageOf(challengeRes));
      const altcha = await solveChallenge((await challengeRes.json()) as AltchaChallenge);
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: address,
          plate: target.plate,
          kind: target.kind,
          validTo: target.validTo,
          consent: true,
          altcha,
        }),
      });
      if (!res.ok) throw new Error(await messageOf(res));
      lastEmail = address;
      fields.remove();
      say(
        `Изпратихме писмо на ${address}. Отворете връзката в него до 48 часа, за да включим напомнянето. Ако не го виждате, погледнете и в „Спам“.`,
        "ok",
      );
      status.focus();
    } catch (err) {
      button.disabled = false;
      say(err instanceof Error && err.message ? err.message : "Не успяхме да запишем напомнянето. Опитайте отново.", "bad");
    }
  });
}

async function messageOf(res: Response): Promise<string> {
  try {
    return ((await res.json()) as { message?: string }).message ?? "";
  } catch {
    return "";
  }
}
