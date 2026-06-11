import { OFFICIAL_SOURCES } from "@/lib/site";
import { daysUntil, type CheckResult } from "./types";
import { solveAltcha, type AltchaChallenge } from "./altcha";

/**
 * Гражданска отговорност — публичната справка на Гаранционен фонд.
 *
 * Формата е защитена с ALTCHA (proof-of-work), не с класическа captcha:
 * клиентът намира число n, за което SHA-256(salt + n) == challenge, и го
 * подава. Това е изчислението, което ALTCHA очаква — затова проверката е
 * напълно автоматична, без стъпка за потребителя (за разлика от ГТП).
 *
 * Поток (потвърден с реален browser trace, 11.06.2026):
 *   1. GET страницата → сесийна бисквитка (site_area)
 *   2. GET /ajax/altchagenchlange.php?code=1 → ALTCHA challenge
 *   3. решаваме PoW → base64 на решената структура
 *   4. POST формата (dkn + date + altcha) → HTML с резултата
 */

const PAGE_URL =
  "https://www.guaranteefund.org/bg/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B5%D0%BD-%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80-%D0%B8-%D1%81%D0%BF%D1%80%D0%B0%D0%B2%D0%BA%D0%B8/%D1%83%D1%81%D0%BB%D1%83%D0%B3%D0%B8/%D0%BF%D1%80%D0%BE%D0%B2%D0%B5%D1%80%D0%BA%D0%B0-%D0%B7%D0%B0-%D0%B2%D0%B0%D0%BB%D0%B8%D0%B4%D0%BD%D0%B0-%D0%B7%D0%B0%D1%81%D1%82%D1%80%D0%B0%D1%85%D0%BE%D0%B2%D0%BA%D0%B0-%D0%B3%D1%80a%D0%B6%D0%B4a%D0%BD%D1%81%D0%BAa-%D0%BE%D1%82%D0%B3%D0%BE%D0%B2%D0%BE%D1%80%D0%BD%D0%BE%D1%81%D1%82-%D0%BD%D0%B0-%D0%B0%D0%B2%D1%82%D0%BE%D0%BC%D0%BE%D0%B1%D0%B8%D0%BB%D0%B8%D1%81%D1%82%D0%B8%D1%82%D0%B5";
const CHALLENGE_URL = "https://www.guaranteefund.org/ajax/altchagenchlange.php?code=1";

const browserHeaders = {
  "accept-language": "bg,en;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

function collectCookies(res: Response, jar: Map<string, string>): void {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const pair = c.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
const cookieHeader = (jar: Map<string, string>) =>
  [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

/** „20.05.2026г.“ → „2026-05-20“ */
function bgDateToIso(text: string): string | undefined {
  const m = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

export interface InsuranceParse {
  valid: boolean;
  insurer?: string;
  validFrom?: string;
  validTo?: string;
}

/** Парсва HTML отговора от справката (изнесено за тестване офлайн). */
export function parseInsuranceHtml(html: string): InsuranceParse {
  if (!/има валидна задължителна застраховка/i.test(html)) {
    return { valid: false };
  }
  const tableMatch = html.match(/<table class="success-results"[\s\S]*?<\/table>/);
  const table = tableMatch?.[0] ?? "";
  const insurer = table.match(/<a[^>]*>([^<]+)<\/a>/)?.[1]?.trim();
  const dates = [...table.matchAll(/(\d{2})\.(\d{2})\.(\d{4})г\./g)].map((m) =>
    bgDateToIso(m[0]),
  );
  return {
    valid: true,
    insurer,
    validFrom: dates[0] ? `${dates[0]}T00:00:00` : undefined,
    validTo: dates[1] ? `${dates[1]}T23:59:59` : undefined,
  };
}

export async function checkInsurance(plate: string): Promise<CheckResult> {
  const checkedAt = new Date().toISOString();

  try {
    const jar = new Map<string, string>();

    // 1) Сесийна бисквитка от страницата
    const page = await fetch(PAGE_URL, { headers: browserHeaders, signal: AbortSignal.timeout(7000) });
    collectCookies(page, jar);

    // 2) ALTCHA challenge
    const chRes = await fetch(CHALLENGE_URL, {
      headers: { ...browserHeaders, accept: "*/*", cookie: cookieHeader(jar) },
      signal: AbortSignal.timeout(7000),
    });
    if (!chRes.ok) throw new Error(`challenge HTTP ${chRes.status}`);
    collectCookies(chRes, jar);
    const challenge = (await chRes.json()) as AltchaChallenge;

    // 3) Решаваме proof-of-work
    const altcha = solveAltcha(challenge);

    // 4) Подаваме формата
    const now = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const body = new URLSearchParams({
      dkn: plate,
      rama: "",
      stiker: "",
      seria: "",
      date: `${p2(now.getDate())}/${p2(now.getMonth() + 1)}/${now.getFullYear()}`,
      datepickertime: `${p2(now.getHours())}:${p2(now.getMinutes())}`,
      altcha_checkbox: "on",
      altcha,
      send: "търси",
    });

    const res = await fetch(PAGE_URL, {
      method: "POST",
      headers: {
        ...browserHeaders,
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookieHeader(jar),
        origin: "https://www.guaranteefund.org",
        referer: PAGE_URL,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`submit HTTP ${res.status}`);
    const html = await res.text();

    const parsed = parseInsuranceHtml(html);
    if (parsed.valid && parsed.validTo) {
      return {
        kind: "insurance",
        status: "ok",
        valid: daysUntil(parsed.validTo) >= 0,
        validFrom: parsed.validFrom,
        validTo: parsed.validTo,
        daysLeft: Math.max(0, daysUntil(parsed.validTo)),
        detail: parsed.insurer,
        checkedAt,
      };
    }
    if (/няма валидна|не е намер|не беше намер/i.test(html)) {
      return { kind: "insurance", status: "ok", valid: false, checkedAt };
    }
    throw new Error("unexpected response shape");
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[insurance] Гаранционен фонд недостъпен за ${plate}: ${reason}`);
    return {
      kind: "insurance",
      status: "manual",
      officialUrl: OFFICIAL_SOURCES.guaranteeFund.checkUrl,
      note: "Справката на Гаранционен фонд е временно недостъпна. Опитайте директно в официалната система.",
      checkedAt,
      reason,
    };
  }
}
