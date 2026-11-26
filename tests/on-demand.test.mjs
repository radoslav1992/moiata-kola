// Изключено състояние (няма D1 и EMAIL binding) върху Node build-а — пуска се след
// `npm run build`, както останалите тестове върху dist/. Стартира dist/server/entry.mjs
// и проверява: сайтът работи както преди, офертата за напомняне не се появява,
// маршрутите на напомнянията са 404, а /za-firmi показва описанието без формата.
// Включеното състояние се проверява със scripts/check-worker.mjs срещу wrangler dev.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ON_DEMAND_PAGES } from "./on-demand-pages.mjs";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const entry = join(dist, "server/entry.mjs");
// Cloudflare build-ът записва dist/server/wrangler.json; неговият entry не се пуска с node.
const nodeBuild = existsSync(entry) && !existsSync(join(dist, "server/wrangler.json"));
const skip = !nodeBuild && "няма Node build — пуснете npm run build";

const PORT = 4300 + (process.pid % 500);
const base = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  if (!nodeBuild) return;
  server = spawn(process.execPath, [entry], { env: { ...process.env, HOST: "127.0.0.1", PORT: String(PORT) }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${base}/robots.txt`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("Node сървърът не стартира");
});
after(() => server?.kill());

const get = (path, init) => fetch(base + path, { redirect: "manual", ...init });
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

test("маршрутите на напомнянията отговарят с 404, докато не са настроени", { skip }, async () => {
  assert.equal((await get("/api/reminders/challenge")).status, 404);
  const signup = await get("/api/reminders", {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: "ivan@example.com", plate: "CB1234AB", kind: "vignette", validTo: "2027-03-12", consent: true }),
  });
  assert.equal(signup.status, 404);
  for (const action of ["potvarzhdenie", "otpisvane", "iztrivane", "drugo"]) {
    const res = await get(`/napomnyane/${action}?t=abcdefghijklmnopqrstuvwxyz`);
    assert.equal(res.status, 404, action);
    const html = await res.text();
    assert.match(html, /<meta name="robots" content="noindex/);
    assert.ok(!html.includes("data-reminder-page"), "без разметка на напомнянията");
  }
  const post = await get("/napomnyane/otpisvane?t=abcdefghijklmnopqrstuvwxyz", { method: "POST" });
  assert.equal(post.status, 404);
});

test("проверките не обявяват напомняния и статичните страници нямат разметка на офертата", { skip }, async () => {
  const res = await get("/api/check/inspection?plate=CB1234AB");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-reminders"), null);
  assert.equal((await res.json()).status, "manual");

  const client = join(dist, "client");
  for (const page of ["index.html", "vinetka/proverka.html", "gtp/proverka.html", "grazhdanska-otgovornost/proverka.html"]) {
    const html = readFileSync(join(client, page), "utf8");
    assert.ok(!/data-reminder-offer|Напомнете ми|name="consent"/.test(html), page);
  }
  // офертата живее само в клиентския скрипт и се показва след заглавие x-reminders: on
  const scripts = readdirSync(join(client, "_astro")).filter((f) => f.endsWith(".js"));
  assert.ok(scripts.some((f) => readFileSync(join(client, "_astro", f), "utf8").includes("x-reminders")));
});

test("/za-firmi: описанието се показва, формата е скрита, POST е 404", { skip }, async () => {
  assert.deepEqual(ON_DEMAND_PAGES, ["/za-firmi"]);
  const res = await get("/za-firmi");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h1[^>]*>За фирми и автопаркове<\/h1>/);
  assert.match(html, /Планирана услуга — още не е налична/);
  assert.match(html, /Тя още не съществува\./);
  assert.ok(html.includes("data-lead-off"));
  assert.ok(!/<form|data-lead-form|name="budget"|type="email"/.test(html), "без форма");
  assert.ok(!/\d\s?(€|лв)/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")), "без цени");

  const title = decode(html.match(/<title>([^<]*)<\/title>/)[1]);
  const description = decode(html.match(/<meta name="description" content="([^"]*)"/)[1]);
  assert.ok(title.length <= 60, `заглавие ${title.length} знака`);
  assert.ok(description.length >= 120 && description.length <= 155, `описание ${description.length} знака`);
  assert.ok(html.includes('<link rel="canonical" href="https://ponomer.com/za-firmi"'));
  assert.ok(!/<meta name="robots" content="[^"]*noindex/.test(html));

  const post = await get("/za-firmi", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: base },
    body: "email=a%40example.com",
  });
  assert.equal(post.status, 404);
});

test("страницата за фирми е в sitemap-а и във футъра", { skip }, async () => {
  const client = join(dist, "client");
  assert.ok(readFileSync(join(client, "sitemap-0.xml"), "utf8").includes("<loc>https://ponomer.com/za-firmi</loc>"));
  const home = readFileSync(join(client, "index.html"), "utf8");
  assert.match(home, /<a href="\/za-firmi"[^>]*>\s*За фирми и автопаркове\s*<\/a>/);
});
