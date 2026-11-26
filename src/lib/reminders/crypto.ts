/**
 * Токени, хешове и ALTCHA (proof-of-work) за формите на сайта. Само WebCrypto —
 * работи еднакво в Workers, в Node и в тестовете.
 *
 * Challenge-ът е във формата на ALTCHA v1 (същият, който checks/altcha.ts решава
 * за Гаранционен фонд): challenge = SHA-256(salt + number), подписан с HMAC.
 * Клиентът намира number; сървърът проверява решението, подписа и срока.
 */
import type { D1Like } from "./types.ts";

const encoder = new TextEncoder();

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

export async function hmacHex(key: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, encoder.encode(text)));
}

/** Случаен токен за връзка в писмо (256 бита, URL-безопасен). В базата отива само hashToken(). */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const hashToken = sha256Hex;

export function isTokenShaped(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(token);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* Сървърен ключ */

let cachedSecret: { db: D1Like; value: string } | undefined;

/**
 * Ключът за подписите живее в базата (app_secrets) и се създава при първата
 * заявка — собственикът не настройва нищо. Кешира се за живота на isolate-а.
 */
export async function serverSecret(db: D1Like): Promise<string> {
  if (cachedSecret?.db === db) return cachedSecret.value;
  await db.prepare("INSERT OR IGNORE INTO app_secrets (name, value) VALUES ('hmac', ?)").bind(newToken()).run();
  const row = await db.prepare("SELECT value FROM app_secrets WHERE name = 'hmac'").first<{ value: string }>();
  if (!row) throw new Error("app_secrets: missing hmac key");
  cachedSecret = { db, value: row.value };
  return row.value;
}

/** Необратим отпечатък на IP/имейл за ограничението на честотата. */
export async function fingerprint(secret: string, scope: string, value: string): Promise<string> {
  return (await hmacHex(secret, `${scope}:${value}`)).slice(0, 32);
}

/* ALTCHA */

export const ALTCHA_MAX_NUMBER = 30_000;
export const ALTCHA_TTL_SECONDS = 10 * 60;

export interface AltchaChallenge {
  algorithm: "SHA-256";
  challenge: string;
  maxNumber: number;
  salt: string;
  signature: string;
}

export async function createChallenge(secret: string, now = Date.now()): Promise<AltchaChallenge> {
  const expires = Math.floor(now / 1000) + ALTCHA_TTL_SECONDS;
  const salt = `${newToken().slice(0, 16)}?expires=${expires}`;
  const number = crypto.getRandomValues(new Uint32Array(1))[0]! % (ALTCHA_MAX_NUMBER + 1);
  const challenge = await sha256Hex(salt + number);
  return { algorithm: "SHA-256", challenge, maxNumber: ALTCHA_MAX_NUMBER, salt, signature: await hmacHex(secret, challenge) };
}

export type AltchaVerdict = { ok: true; challenge: string } | { ok: false; reason: "malformed" | "signature" | "solution" | "expired" };

/** Проверява решението (base64 JSON, както го праща ALTCHA клиентът). Не проверява повторна употреба. */
export async function verifySolution(secret: string, payload: unknown, now = Date.now()): Promise<AltchaVerdict> {
  if (typeof payload !== "string" || payload.length > 2000) return { ok: false, reason: "malformed" };
  let data: { algorithm?: unknown; challenge?: unknown; number?: unknown; salt?: unknown; signature?: unknown };
  try {
    data = JSON.parse(atob(payload));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const { algorithm, challenge, number, salt, signature } = data ?? {};
  if (
    algorithm !== "SHA-256" ||
    typeof challenge !== "string" ||
    typeof salt !== "string" ||
    typeof signature !== "string" ||
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number < 0 ||
    number > ALTCHA_MAX_NUMBER
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (!timingSafeEqual(await hmacHex(secret, challenge), signature)) return { ok: false, reason: "signature" };
  if (!timingSafeEqual(await sha256Hex(salt + number), challenge)) return { ok: false, reason: "solution" };
  const expires = Number(/[?&]expires=(\d+)/.exec(salt)?.[1]);
  if (!Number.isFinite(expires) || expires * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, challenge };
}

/** Решава challenge в браузъра (и в тестове). ~15 хил. хеша средно — под секунда на телефон. */
export async function solveChallenge(c: AltchaChallenge): Promise<string> {
  for (let n = 0; n <= c.maxNumber; n++) {
    if ((await sha256Hex(c.salt + n)) === c.challenge) {
      return btoa(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number: n, salt: c.salt, signature: c.signature }));
    }
  }
  throw new Error("altcha: no solution within maxNumber");
}
