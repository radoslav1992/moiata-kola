import { OFFICIAL_SOURCES } from "@/lib/site";
import type { CheckResult } from "./types";

/**
 * ГТП (годишен технически преглед) — публичната справка на ИААА.
 *
 * Както при ГО: докато програмният достъп не е потвърден, връщаме
 * насочен дълбок линк към официалната проверка. Интерфейсът е същият
 * като останалите адаптери, така че интеграцията е drop-in.
 */
export async function checkInspection(_plate: string): Promise<CheckResult> {
  return {
    kind: "inspection",
    status: "manual",
    officialUrl: OFFICIAL_SOURCES.rta.checkUrl,
    note: "Справката за ГТП се прави в системата на ИААА. Отворете официалната проверка и въведете регистрационния номер — резултатът е веднага.",
    checkedAt: new Date().toISOString(),
  };
}
