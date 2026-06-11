import { OFFICIAL_SOURCES } from "@/lib/site";
import { daysUntil, type CheckResult } from "./types";

/**
 * Проверка на електронна винетка през публичния endpoint на check.bgtoll.bg —
 * същия, който официалната страница вика (потвърден от реален browser trace):
 *
 *   GET /check/vignette/plate/{държава}/{номер}
 *
 * Номерът се приема и без интервали (CB2951AM).
 * При отказ или неочакван отговор връщаме "manual" резултат с дълбок линк
 * към официалната проверка и поле reason за диагностика — никога счупен екран.
 */

const ENDPOINT_BASE = "https://check.bgtoll.bg/check/vignette/plate";

interface BgTollVignette {
  validityDateFrom?: string;
  validityDateTo?: string;
  validityDateFromFormated?: string;
  validityDateToFormated?: string;
  vignetteType?: { name?: string };
  vignetteValidityType?: { name?: string };
}

/** "01.06.2027" → ISO дата (резервен вариант, ако липсва машинният формат) */
function parseFormatedDate(value: string): string | undefined {
  const m = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T23:59:59` : undefined;
}

const REQUEST_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "bg",
  referer: "https://check.bgtoll.bg/",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * check.bgtoll.bg е известен с нестабилност под натоварване (спорадични 5xx
 * и таймаути), затова правим до 3 опита с кратък backoff. Повтаряме само при
 * сървърни грешки/таймаути — не при 4xx (там отговорът е смислен).
 */
async function fetchVignette(url: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(300 * attempt);
    try {
      const res = await fetch(url, {
        headers: REQUEST_HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      if (res.status >= 500) {
        lastErr = new Error(`upstream HTTP ${res.status}`);
        continue; // сървърна грешка → нов опит
      }
      return res;
    } catch (err) {
      lastErr = err; // таймаут/мрежа → нов опит
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("upstream unreachable");
}

export async function checkVignette(plate: string): Promise<CheckResult> {
  const checkedAt = new Date().toISOString();

  try {
    const url = `${ENDPOINT_BASE}/BG/${plate}`;
    const res = await fetchVignette(url);

    if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
    const data = (await res.json()) as { ok?: boolean; vignette?: BgTollVignette | null };

    const vignette = data.vignette;
    if (vignette) {
      const validTo =
        vignette.validityDateTo ??
        (vignette.validityDateToFormated
          ? parseFormatedDate(vignette.validityDateToFormated)
          : undefined);
      if (!validTo) {
        throw new Error(`unexpected shape: ${JSON.stringify(data).slice(0, 200)}`);
      }
      return {
        kind: "vignette",
        status: "ok",
        valid: daysUntil(validTo) >= 0,
        validFrom: vignette.validityDateFrom,
        validTo,
        daysLeft: Math.max(0, daysUntil(validTo)),
        detail: vignette.vignetteType?.name ?? vignette.vignetteValidityType?.name,
        checkedAt,
      };
    }

    if ("vignette" in data && !vignette) {
      // Изричното vignette: null е официалното "няма валидна винетка"
      return { kind: "vignette", status: "ok", valid: false, checkedAt };
    }

    throw new Error(`unexpected shape: ${JSON.stringify(data).slice(0, 200)}`);
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    // Видимо в Cloudflare → Workers → Logs (или `npx wrangler tail`)
    console.error(`[vignette] БГ ТОЛ недостъпен за ${plate}: ${reason}`);
    return {
      kind: "vignette",
      status: "manual",
      officialUrl: OFFICIAL_SOURCES.bgtoll.checkUrl,
      note: "Връзката с БГ ТОЛ е временно недостъпна. Проверете директно в официалната система — отнема под минута.",
      checkedAt,
      reason,
    };
  }
}
