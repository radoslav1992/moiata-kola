/**
 * Клиентски ГТП relay: рендерира captcha картата в подаден контейнер,
 * зарежда captcha-та на ИААА, потребителят я решава, и резултатът се
 * показва на същото място. Ползва се и от комбинираната проверка, и от
 * самостоятелната страница, за да има едно поведение навсякъде.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("bg-BG", { day: "numeric", month: "long", year: "numeric" });

const LABEL = "ГТП (технически преглед)";

type GtpResponse =
  | { status: "ok"; valid: boolean; validTo?: string }
  | { status: "captcha_error" }
  | { status: "not_found" }
  | { status: "error"; message?: string };

const head = `<p class="text-sm font-medium text-ink-soft">${LABEL}</p>`;

function loadingCard(): string {
  return `
    <div class="card p-4 sm:p-5">
      ${head}
      <p class="mt-1.5 text-sm text-ink-soft">Зареждам код за сигурност от ИААА…</p>
    </div>`;
}

function captchaCard(image: string): string {
  return `
    <div class="card border-l-4 border-l-accent p-4 sm:p-5">
      ${head}
      <p class="mt-1.5 text-sm text-ink-soft">Системата на ИААА иска код за сигурност. Впишете кода от картинката:</p>
      <div class="mt-3 flex items-center gap-3">
        <img alt="Код за сигурност от ИААА" class="h-12 rounded-md border border-line bg-white" src="${image}" />
        <button type="button" class="text-sm font-medium text-accent hover:underline" data-gtp-refresh>Нов код</button>
      </div>
      <div class="mt-3 flex flex-col gap-2 sm:flex-row">
        <input type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8"
          placeholder="Код от картинката" data-gtp-input
          class="w-full rounded-lg border border-line-strong bg-white px-4 py-2.5 text-center text-lg tracking-widest text-ink uppercase outline-none focus:border-accent sm:max-w-[12rem]" />
        <button type="button" class="btn-primary" data-gtp-go>Провери ГТП</button>
      </div>
      <p class="mt-2 text-xs text-bad" data-gtp-err hidden></p>
    </div>`;
}

function fallbackCard(officialUrl: string, note: string): string {
  return `
    <div class="card border-l-4 border-l-line-strong p-4 sm:p-5">
      ${head}
      <p class="mt-1.5 text-sm leading-relaxed text-ink-soft">${esc(note)}</p>
      <a href="${esc(officialUrl)}" target="_blank" rel="nofollow noopener" class="btn-secondary mt-3 w-full sm:w-auto">Официална проверка ↗</a>
    </div>`;
}

function resultCard(validTo: string, valid: boolean): string {
  const days = Math.ceil((new Date(validTo).getTime() - Date.now()) / 86_400_000);
  const expiring = valid && days <= 30;
  const tone = !valid ? "bad" : expiring ? "warn" : "ok";
  const pill = !valid
    ? `<span class="inline-flex items-center rounded-full bg-bad-soft px-3 py-1 text-xs font-semibold text-bad">Изтекъл</span>`
    : expiring
      ? `<span class="inline-flex items-center rounded-full bg-warn-soft px-3 py-1 text-xs font-semibold text-warn">Изтича скоро</span>`
      : `<span class="inline-flex items-center rounded-full bg-ok-soft px-3 py-1 text-xs font-semibold text-ok">Валиден</span>`;
  return `
    <div class="card flex items-center justify-between gap-4 border-l-4 border-l-${tone} p-4 sm:p-5">
      <div>
        ${head}
        <div class="mt-1.5">${pill}</div>
        <p class="mt-2 text-sm text-ink-soft">Валиден до <strong class="text-ink">${fmtDate(validTo)}</strong></p>
        ${expiring ? `<a href="/gtp/cena" class="mt-2 inline-block text-sm font-semibold text-accent hover:underline">Виж цените за ГТП →</a>` : ""}
      </div>
      <div class="shrink-0 text-center">
        <p class="font-plate text-4xl font-semibold text-${tone} sm:text-5xl">${Math.max(0, days)}</p>
        <p class="text-xs text-ink-faint">${Math.abs(days) === 1 ? "ден" : "дни"}</p>
      </div>
    </div>`;
}

/** Стартира ГТП проверката в `container` за вече валидиран номер `plate`. */
export function mountGtp(container: HTMLElement, plate: string, officialUrl: string): void {
  container.innerHTML = loadingCard();
  void loadCaptcha();

  async function loadCaptcha() {
    try {
      const res = await fetch("/api/gtp/captcha");
      if (!res.ok) throw new Error(String(res.status));
      const { session, image } = (await res.json()) as { session: string; image: string };
      container.innerHTML = captchaCard(image);
      const input = container.querySelector<HTMLInputElement>("[data-gtp-input]")!;
      const go = container.querySelector<HTMLButtonElement>("[data-gtp-go]")!;
      const refresh = container.querySelector<HTMLButtonElement>("[data-gtp-refresh]")!;
      const err = container.querySelector<HTMLElement>("[data-gtp-err]")!;
      input.focus();
      const submit = () => doSubmit(session, input.value.trim(), go, err);
      go.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
      refresh.addEventListener("click", () => void loadCaptcha());
    } catch {
      container.innerHTML = fallbackCard(
        officialUrl,
        "Връзката със системата на ИААА е временно недостъпна. Проверете директно в официалната система — отнема под минута.",
      );
    }
  }

  async function doSubmit(session: string, captcha: string, go: HTMLButtonElement, err: HTMLElement) {
    if (!captcha) {
      err.textContent = "Впишете кода от картинката.";
      err.hidden = false;
      return;
    }
    err.hidden = true;
    go.disabled = true;
    go.textContent = "Проверявам…";
    try {
      const res = await fetch("/api/gtp/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session, plate, captcha }),
      });
      const r = (await res.json()) as GtpResponse;

      if (r.status === "captcha_error") {
        await loadCaptcha();
        const e2 = container.querySelector<HTMLElement>("[data-gtp-err]");
        if (e2) {
          e2.textContent = "Грешен код — опитайте с новия код.";
          e2.hidden = false;
        }
        return;
      }
      if (r.status === "ok" && r.validTo) {
        container.innerHTML = resultCard(r.validTo, r.valid);
        return;
      }
      if (r.status === "not_found") {
        container.innerHTML = fallbackCard(
          officialUrl,
          "За този номер не е намерен валиден технически преглед. Проверете номера или вижте директно в официалната система.",
        );
        return;
      }
      container.innerHTML = fallbackCard(
        officialUrl,
        "Проверката през ИААА е временно недостъпна. Проверете директно в официалната система.",
      );
    } catch {
      container.innerHTML = fallbackCard(officialUrl, "Проверката е временно недостъпна. Опитайте отново след малко.");
    }
  }
}
