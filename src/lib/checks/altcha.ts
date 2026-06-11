import { createHash } from "node:crypto";

export interface AltchaChallenge {
  algorithm: string;
  challenge: string;
  maxNumber?: number;
  salt: string;
  signature: string;
}

/**
 * Решава ALTCHA proof-of-work: намира число n, за което
 * SHA-256(salt + n) съвпада с challenge хеша, и връща base64 на решената
 * структура (форматът, който формата на Гаранционен фонд очаква в поле altcha).
 *
 * Това е изчислението, което ALTCHA по дизайн очаква от клиента — няма
 * картинка и няма „не съм робот“. Не е заобикаляне на captcha, а
 * изпълнение на самия механизъм, точно както го прави браузърът.
 */
export function solveAltcha(c: AltchaChallenge): string {
  if (c.algorithm !== "SHA-256") throw new Error(`unsupported altcha algorithm: ${c.algorithm}`);
  const start = Date.now();
  const max = c.maxNumber ?? 1_000_000;
  for (let n = 0; n <= max; n++) {
    const hex = createHash("sha256").update(c.salt + n).digest("hex");
    if (hex === c.challenge) {
      const solved = {
        algorithm: c.algorithm,
        challenge: c.challenge,
        number: n,
        salt: c.salt,
        signature: c.signature,
        took: Date.now() - start,
      };
      return Buffer.from(JSON.stringify(solved), "utf-8").toString("base64");
    }
  }
  throw new Error("altcha not solved within maxNumber");
}
