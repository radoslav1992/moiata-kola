import { OFFICIAL_SOURCES } from "@/lib/site";
import type { CheckResult } from "./types";

/**
 * Гражданска отговорност — публичната справка на Гаранционен фонд.
 *
 * Официалната проверка на eisoukr.guaranteefund.org е защитена с captcha
 * (потвърдено 06.2026), затова водим потребителя с насочен дълбок линк,
 * точни стъпки и автоматично копиране на номера. Път напред: брокерско
 * партньорство (Boleron/SDI имат легален ЕИСОУКР достъп) — върви заедно
 * с affiliate сделката за ГО. При договорен достъп тази функция връща
 * "ok" резултат със застраховател и крайна дата, без промени по веригата.
 */
export async function checkInsurance(_plate: string): Promise<CheckResult> {
  return {
    kind: "insurance",
    status: "manual",
    officialUrl: OFFICIAL_SOURCES.guaranteeFund.checkUrl,
    note: "Справката на Гаранционен фонд изисква код за сигурност. Отворете официалната проверка, въведете номера и кода — резултатът е веднага.",
    checkedAt: new Date().toISOString(),
  };
}
