import { isValidBgPlate } from "./types";

/**
 * Relay към публичната ГТП справка на ИААА (rta.government.bg).
 *
 * Справката е защитена с captcha. НЕ я заобикаляме — captcha-та се показва
 * на потребителя и той я решава; relay-ът само пренася картинката и отговора,
 * запазвайки PHP сесията между двете стъпки. Това е мост, докато се договори
 * официален достъп (виж docs/iaaa-data-request.md). Deep-link fallback-ът
 * остава като резервен вариант на /gtp/proverka.
 *
 * Поток:
 *   1. getCaptcha()  → нова PHP сесия + картинка с кода
 *   2. (потребителят чете кода)
 *   3. submitCheck() → POST regNum + captcha по същата сесия → резултат
 *
 * Endpoints (потвърдени с реален browser trace, 11.06.2026):
 *   GET  checkinsp.php?captcha/inspection=1&rand=<n>   — картинка
 *   POST checkinsp.php  body: regNum=<номер>&captcha=<код>
 */

const BASE = "https://rta.government.bg/services/check-inspection";
const CAPTCHA_URL = (rand: number) => `${BASE}/checkinsp.php?captcha/inspection=1&rand=${rand}`;
const SUBMIT_URL = `${BASE}/checkinsp.php`;
const INDEX_URL = `${BASE}/index.html`;

const browserHeaders = {
  "accept-language": "bg,en;q=0.8",
  referer: `${BASE}/index.html`,
  origin: "https://rta.government.bg",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

/** Извлича PHPSESSID от Set-Cookie заглавие */
function extractSession(setCookie: string | null): string | undefined {
  const m = setCookie?.match(/PHPSESSID=([^;]+)/);
  return m?.[1];
}

export interface CaptchaPayload {
  /** Непрозрачен токен — PHPSESSID, връща се при submitCheck */
  session: string;
  /** data: URL на картинката с кода */
  image: string;
}

export async function getCaptcha(): Promise<CaptchaPayload> {
  // Префлайт към index.html, за да минем напълно като браузъра и да поемем
  // сесия, ако се раздава там; иначе captcha endpoint-ът ще я създаде.
  let session: string | undefined;
  try {
    const pre = await fetch(INDEX_URL, { headers: browserHeaders, signal: AbortSignal.timeout(8000) });
    session = extractSession(pre.headers.get("set-cookie"));
  } catch {
    /* префлайтът не е критичен */
  }

  const res = await fetch(CAPTCHA_URL(Math.floor(Math.random() * 100)), {
    headers: {
      ...browserHeaders,
      accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      ...(session ? { cookie: `PHPSESSID=${session}` } : {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`captcha HTTP ${res.status}`);

  session = extractSession(res.headers.get("set-cookie")) ?? session;
  if (!session) throw new Error("no session from upstream");

  const bytes = new Uint8Array(await res.arrayBuffer());
  // ИААА връща картинката с грешен content-type (text/html), затова
  // типът се определя по magic bytes — иначе data: URL-ът е невалиден.
  const mime = sniffImageMime(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const image = `data:${mime};base64,${btoa(binary)}`;

  return { session, image };
}

/** Разпознава image MIME по сигнатурата на първите байтове */
function sniffImageMime(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  return "image/png";
}

export type GtpResult =
  | { status: "ok"; valid: boolean; validTo?: string; raw: string }
  | { status: "captcha_error"; raw: string }
  | { status: "not_found"; raw: string }
  | { status: "error"; message: string; raw?: string };

/** "01.06.2027" / "2027-06-01" → ISO дата, ако се срещне в отговора */
function findDate(text: string): string | undefined {
  const dotted = text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (dotted) return `${dotted[3]}-${dotted[2]}-${dotted[1]}T23:59:59`;
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T23:59:59`;
  return undefined;
}

export async function submitCheck(
  session: string,
  plate: string,
  captcha: string,
): Promise<GtpResult> {
  if (!isValidBgPlate(plate)) return { status: "error", message: "invalid_plate" };
  if (!/^[A-Za-z0-9]{3,8}$/.test(captcha)) return { status: "error", message: "invalid_captcha" };

  let raw = "";
  try {
    const res = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: {
        ...browserHeaders,
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        accept: "application/json, text/javascript, */*; q=0.01",
        cookie: `PHPSESSID=${session}`,
      },
      body: `regNum=${encodeURIComponent(plate)}&captcha=${encodeURIComponent(captcha)}`,
      signal: AbortSignal.timeout(8000),
    });
    raw = (await res.text()).trim();
    if (!res.ok) throw new Error(`submit HTTP ${res.status}`);
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      raw,
    };
  }

  // Евристики до финализиране на парсера с реален отговор (echo-ва се raw):
  const low = raw.toLowerCase();
  if (/captcha|код|грешн|невал/.test(low) && !/преглед|валид(?!н)/.test(low)) {
    return { status: "captcha_error", raw };
  }
  const validTo = findDate(raw);
  if (validTo) return { status: "ok", valid: new Date(validTo) >= new Date(), validTo, raw };
  if (/няма|не е намер|no .*found/.test(low)) return { status: "not_found", raw };

  // Неразпознат отговор → връщаме raw за финализиране на парсера
  return { status: "ok", valid: false, raw };
}
