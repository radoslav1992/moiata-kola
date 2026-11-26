/**
 * Входна точка на Worker-а (wrangler.jsonc → main). Заявките отиват към Astro,
 * както и преди; добавен е само cron handler-ът за напомнянията по имейл
 * (src/lib/reminders/cron.ts). Без D1 binding той не прави нищо.
 */
import { handle } from "@astrojs/cloudflare/handler";
import type { ReminderEnv } from "./lib/reminders/types.ts";

type FetchArgs = Parameters<typeof handle>;

interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  fetch(request: FetchArgs[0], env: FetchArgs[1], ctx: FetchArgs[2]) {
    return handle(request, env, ctx);
  },
  async scheduled(_controller: unknown, env: ReminderEnv, ctx: WaitUntil) {
    const { runDaily } = await import("./lib/reminders/cron.ts");
    ctx.waitUntil(
      runDaily(env).then(
        (result) => console.log("[reminders]", JSON.stringify(result)),
        (err) => console.error("[reminders] failed", err instanceof Error ? err.stack : err),
      ),
    );
  },
};
