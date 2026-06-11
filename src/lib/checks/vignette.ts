import { OFFICIAL_SOURCES } from "@/lib/site";
import { daysUntil, type CheckResult } from "./types";

/**
 * Проверка на електронна винетка през публичния endpoint на check.bgtoll.bg
 * (същият, който официалната страница ползва — Boleron и Avtovia доказват,
 * че интеграция от трета страна е възможна).
 *
 * Ако upstream откаже (промяна на API, captcha, rate limit), връщаме "manual"
 * резултат с дълбок линк към официалната проверка — никога счупен екран.
 */

const ENDPOINT = "https://check.bgtoll.bg/check/vignette/plate";

interface BgTollVignette {
  validityDateFrom?: string;
  validityDateTo?: string;
  validityDateFromFormated?: string;
  validityDateToFormated?: string;
  vignetteType?: { name?: string };
}

export async function checkVignette(plate: string): Promise<CheckResult> {
  const checkedAt = new Date().toISOString();
  let result: CheckResult;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      // Заявката повтаря тази на официалната страница: check.bgtoll.bg има
      // бот-филтър и отказва "голи" клиенти (403 за datacenter/non-browser).
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
        "accept-language": "bg",
        origin: "https://check.bgtoll.bg",
        referer: "https://check.bgtoll.bg/",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ vehicleNumber: plate, region: "BG" }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
    const data = (await res.json()) as { ok?: boolean; vignette?: BgTollVignette | null };

    if (data.vignette?.validityDateTo) {
      const validTo = data.vignette.validityDateTo;
      result = {
        kind: "vignette",
        status: "ok",
        valid: daysUntil(validTo) >= 0,
        validFrom: data.vignette.validityDateFrom,
        validTo,
        daysLeft: Math.max(0, daysUntil(validTo)),
        detail: data.vignette.vignetteType?.name,
        checkedAt,
      };
    } else if (data.ok && !data.vignette) {
      result = { kind: "vignette", status: "ok", valid: false, checkedAt };
    } else {
      throw new Error("unexpected upstream shape");
    }
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    // Видимо в Cloudflare → Workers → Logs (или `npx wrangler tail`)
    console.error(`[vignette] БГ ТОЛ недостъпен за ${plate}: ${reason}`);
    result = {
      kind: "vignette",
      status: "manual",
      officialUrl: OFFICIAL_SOURCES.bgtoll.checkUrl,
      note: "Връзката с БГ ТОЛ е временно недостъпна. Проверете директно в официалната система — отнема под минута.",
      checkedAt,
      reason,
    };
  }

  return result;
}
