// Свежа локална D1 база за тестовете: Miniflare (локалният runtime на wrangler —
// идва с него, а wrangler е изискване на @astrojs/cloudflare) + миграциите от
// migrations/, приложени в реда на имената им, както прави
// `wrangler d1 migrations apply --local`.
import { Miniflare } from "miniflare";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));

export function migrationStatements() {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) =>
      readFileSync(join(migrationsDir, f), "utf8")
        .replace(/--.*$/gm, "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean),
    );
}

export async function freshD1() {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "test" },
  });
  const db = await mf.getD1Database("DB");
  await db.batch(migrationStatements().map((s) => db.prepare(s)));
  return { db, dispose: () => mf.dispose() };
}

/** Изпразва таблиците между тестовете (app_secrets остава — ключът е кеширан в процеса). */
export async function emptyTables(db) {
  await db.batch(
    ["reminder_tokens", "reminders", "business_leads", "attempts"].map((t) => db.prepare(`DELETE FROM ${t}`)),
  );
}

/** Заместител на send_email binding-а: събира писмата, по желание отказва. */
export function fakeEmail() {
  const sent = [];
  const binding = {
    sent,
    failWith: null,
    async send(message) {
      if (binding.failWith) throw Object.assign(new Error("send failed"), { code: binding.failWith });
      sent.push(message);
      return { messageId: `msg-${sent.length}` };
    },
  };
  return binding;
}

export const rows = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
