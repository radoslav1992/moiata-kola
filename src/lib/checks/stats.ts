/**
 * Анонимни агрегирани броячи на проверките (Workers Analytics Engine).
 *
 * След всяка завършена проверка записваме точно четири неща: вид
 * (vignette/insurance/inspection), изход (valid/invalid/expiring/
 * upstream-error), държава на регистрация (засега винаги "BG") и денят —
 * той идва от timestamp-а на Analytics Engine и се агрегира при заявка.
 *
 * Нарочно НЕ записваме: номера, hash на номера, IP или каквото и да е
 * per-vehicle. Така обещанието в /poveritelnost („не съхраняваме номера,
 * свързани с лични данни“) остава буквално вярно, а броячите стигат за
 * всички обобщени истории („X% от проверките са без ГО“) и за мониторинг
 * на upstream грешките.
 *
 * Binding-ът (CHECK_STATS в wrangler.jsonc → dataset "check_stats")
 * съществува само на workerd; при Node build logCheck е тих no-op.
 * Извикването е fire-and-forget — статистиката никога не бави и не чупи
 * проверка.
 */
import type { CheckResult } from "./types";

export type CheckOutcome = "valid" | "invalid" | "expiring" | "upstream-error";

interface AnalyticsEngineDataset {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

let resolved = false;
let dataset: AnalyticsEngineDataset | undefined;

async function getDataset(): Promise<AnalyticsEngineDataset | undefined> {
  if (!resolved) {
    resolved = true;
    try {
      const specifier = "cloudflare:workers";
      const mod = (await import(/* @vite-ignore */ specifier)) as {
        env?: { CHECK_STATS?: AnalyticsEngineDataset };
      };
      dataset = mod.env?.CHECK_STATS;
    } catch {
      dataset = undefined;
    }
  }
  return dataset;
}

/** Свежда CheckResult до изход за статистиката. */
export function outcomeOf(result: CheckResult): CheckOutcome {
  if (result.status === "ok") {
    if (!result.valid) return "invalid";
    return result.daysLeft !== undefined && result.daysLeft <= 7 ? "expiring" : "valid";
  }
  return "upstream-error";
}

/** Записва една завършена проверка. Никога не хвърля и не се чака. */
export async function logCheck(kind: string, outcome: CheckOutcome, country = "BG"): Promise<void> {
  try {
    (await getDataset())?.writeDataPoint({ blobs: [kind, outcome, country], doubles: [1] });
  } catch {
    // статистиката никога не пречи на проверката
  }
}
