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

/* Кратък кеш в паметта: реже повторни заявки към БГ ТОЛ за същия номер.
   Бележка за продукция: на Cloudflare Workers това е per-isolate; при
   нужда се мести в KV със същия интерфейс. */
const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, { result: CheckResult; expires: number }>();

interface BgTollVignette {
  validityDateFrom?: string;
  validityDateTo?: string;
  validityDateFromFormated?: string;
  validityDateToFormated?: string;
  vignetteType?: { name?: string };
}

export async function checkVignette(plate: string): Promise<CheckResult> {
  const cached = cache.get(plate);
  if (cached && cached.expires > Date.now()) {
    return cached.result;
  }

  const checkedAt = new Date().toISOString();
  let result: CheckResult;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ vehicleNumber: plate, region: "BG" }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`upstream ${res.status}`);
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
  } catch {
    result = {
      kind: "vignette",
      status: "manual",
      officialUrl: OFFICIAL_SOURCES.bgtoll.checkUrl,
      note: "Връзката с БГ ТОЛ е временно недостъпна. Проверете директно в официалната система — отнема под минута.",
      checkedAt,
    };
  }

  cache.set(plate, { result, expires: Date.now() + CACHE_TTL_MS });
  return result;
}
