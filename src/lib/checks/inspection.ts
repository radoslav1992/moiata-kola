import { OFFICIAL_SOURCES } from "@/lib/site";
import type { CheckResult } from "./types";

/**
 * ГТП (годишен технически преглед) — публичната справка на ИААА.
 *
 * Верифицирано на 11.06.2026 с реален browser trace: endpoint-ът
 * POST /services/check-inspection/checkinsp.php приема regNum + captcha —
 * т.е. програмната интеграция е блокирана от captcha (не я заобикаляме).
 * Оставаме на „guided deep-link“ + автоматично копиране на номера.
 * Път напред: официално искане за данни/API към ИААА или партньор с достъп.
 * Интерфейсът е същият като останалите адаптери — интеграцията е drop-in.
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
