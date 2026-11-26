/**
 * Binding-ите на Worker-а (D1, Email Service…). В Astro 6 се четат от модула
 * "cloudflare:workers", който съществува само на workerd — затова import-ът е
 * динамичен, а при Node build-а (и в `astro dev`) функцията връща undefined
 * и всичко, което зависи от binding-и, остава изключено.
 */
import type { ReminderEnv } from "./reminders/types.ts";

let resolved = false;
let env: ReminderEnv | undefined;

export async function runtimeEnv(): Promise<ReminderEnv | undefined> {
  if (!resolved) {
    resolved = true;
    try {
      const specifier = "cloudflare:workers";
      const mod = (await import(/* @vite-ignore */ specifier)) as { env?: ReminderEnv };
      env = mod.env;
    } catch {
      env = undefined;
    }
  }
  return env;
}
