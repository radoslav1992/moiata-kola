export type CheckKind = "vignette" | "insurance" | "inspection";

/** Резултат, който всеки адаптер връща и който клиентът рендерира. */
export type CheckResult =
  | {
      kind: CheckKind;
      status: "ok";
      valid: boolean;
      /** ISO дата, до която е валидна винетката/полицата/прегледът */
      validTo?: string;
      validFrom?: string;
      daysLeft?: number;
      /** Допълнителен ред под статуса, напр. вид винетка или застраховател */
      detail?: string;
      checkedAt: string;
    }
  | {
      /** Официалната система изисква captcha/лични данни → водим потребителя стъпка по стъпка */
      kind: CheckKind;
      status: "manual";
      officialUrl: string;
      note: string;
      checkedAt: string;
    }
  | {
      kind: CheckKind;
      status: "error";
      message: string;
      officialUrl: string;
      checkedAt: string;
    };

/**
 * Нормализира регистрационен номер: главни букви, без интервали,
 * кирилските букви от табелите се транслитерират към латинските им двойници.
 */
const CYR_TO_LAT: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H",
  О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X",
};

export function normalizePlate(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[АВЕКМНОРСТУХ]/g, (ch) => CYR_TO_LAT[ch] ?? ch);
}

/** Български формат: 1–2 букви, 4 цифри, 1–2 букви (CB1234AB, A1234BC). */
export function isValidBgPlate(plate: string): boolean {
  return /^[ABEKMHOPCTYX]{1,2}\d{4}[ABEKMHOPCTYX]{1,2}$/.test(plate);
}

export function daysUntil(isoDate: string): number {
  const ms = new Date(isoDate).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}
