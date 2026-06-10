import { OFFICIAL_SOURCES } from "@/lib/site";
import type { CheckResult } from "./types";

/**
 * Гражданска отговорност — публичната справка на Гаранционен фонд.
 *
 * Официалната проверка на eisoukr.guaranteefund.org е защитена с captcha,
 * затова в MVP водим потребителя с насочен дълбок линк и точни стъпки
 * (стратегията „guided deep-link“ от плана). Когато се договори/потвърди
 * программен достъп, тази функция връща "ok" резултат със застраховател
 * и крайна дата, без да се пипа нищо друго по веригата.
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
