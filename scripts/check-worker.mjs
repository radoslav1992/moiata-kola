// Проверява маршрутите, които worker-ът рендерира при заявка, срещу работещ worker.
// Първо го пуснете:  npm run build:cloudflare && npx wrangler dev
// после:             node scripts/check-worker.mjs [base-url]   (по подразбиране http://localhost:8787)
//
// Скриптът сам разпознава състоянието по заглавието x-reminders на проверките:
//   изключено (няма D1/EMAIL binding) — напомнянията са 404, /za-firmi е без форма;
//   включено — challenge, валидиране на заявката, страниците от писмата и формата за фирми.
// Не записва нищо: праща само невалидни заявки.
import assert from "node:assert/strict";

const base = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const get = (path, init) => fetch(base + path, { redirect: "manual", ...init });
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";

// Сайтът работи както преди
assert.equal((await get("/")).status, 200, "/");
const check = await get("/api/check/inspection?plate=CB1234AB");
assert.equal(check.status, 200);
assert.equal((await check.json()).status, "manual", "ГТП остава зад captcha-та на ИААА");
const legacy = await get("/gtp/proverka.html");
assert.equal(legacy.status, 301);
assert.equal(new URL(legacy.headers.get("location"), base).pathname, "/gtp/proverka");

// Шрифтовете от CSS-а се сервират
const home = await (await get("/")).text();
const cssPath = home.match(/href="(\/_astro\/[^"]+\.css)"/)[1];
const css = await (await get(cssPath)).text();
const fonts = [...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map((m) => m[1]);
assert.ok(fonts.length >= 2, "Inter и Oswald са в CSS-а");
for (const font of fonts) assert.equal((await get(new URL(font, base + cssPath).pathname)).status, 200, font);

const enabled = check.headers.get("x-reminders") === "on";
console.log(`Напомняния: ${enabled ? "включени" : "изключени"} (${base})`);

// /za-firmi — описанието се показва винаги
const fleetRes = await get("/za-firmi");
assert.equal(fleetRes.status, 200);
const fleet = await fleetRes.text();
assert.match(fleet, /<h1[^>]*>За фирми и автопаркове<\/h1>/);
assert.match(fleet, /Планирана услуга — още не е налична/);
const title = decode(fleet.match(/<title>([^<]*)<\/title>/)[1]);
const description = decode(fleet.match(/<meta name="description" content="([^"]*)"/)[1]);
assert.ok(title.length <= 60, `заглавие ${title.length}`);
assert.ok(description.length >= 120 && description.length <= 155, `описание ${description.length}`);
assert.ok(fleet.includes('<link rel="canonical" href="https://ponomer.com/za-firmi"'));
assert.equal((await get("/napomnyane/nesto-drugo")).status, 404);

const formPost = (body) =>
  get("/za-firmi", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: base }, body });
const signup = (body) =>
  get("/api/reminders", { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body) });

if (!enabled) {
  assert.equal((await get("/api/reminders/challenge")).status, 404);
  assert.equal((await signup({ email: "a@example.com" })).status, 404);
  for (const action of ["potvarzhdenie", "otpisvane", "iztrivane"]) {
    assert.equal((await get(`/napomnyane/${action}?t=${TOKEN}`)).status, 404, action);
  }
}

const hasDb = /data-lead-form/.test(fleet);
if (!hasDb) {
  assert.ok(fleet.includes("data-lead-off") && !/<form/.test(fleet), "без D1 формата е скрита");
  assert.equal((await formPost("email=a%40example.com")).status, 404);
} else {
  assert.match(fleet, /<form method="post"/);
  for (const field of ["email", "company", "vehicles", "needs", "budget", "consent", "website"]) {
    assert.ok(fleet.includes(`name="${field}"`), `поле ${field}`);
  }
  const invalid = await formPost("email=greshen&company=Firma+OOD&budget=0");
  assert.equal(invalid.status, 400);
  const html = await invalid.text();
  assert.match(html, /role="alert"/);
  assert.ok(html.includes('value="greshen"') && html.includes('value="Firma OOD"'), "стойностите се връщат");
  assert.equal((await formPost("email=a%40example.com")).status, 400);
}

if (enabled) {
  const challenge = await (await get("/api/reminders/challenge")).json();
  assert.equal(challenge.algorithm, "SHA-256");
  assert.ok(challenge.challenge && challenge.salt && challenge.signature && challenge.maxNumber > 0);

  const bad = await signup({ email: "не-е-имейл", plate: "CB1234AB", kind: "vignette", validTo: "2099-01-01", consent: true });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "invalid_email");
  const noCaptcha = await signup({ email: "a@example.com", plate: "CB1234AB", kind: "vignette", validTo: new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10), consent: true });
  assert.equal(noCaptcha.status, 400);
  assert.equal((await noCaptcha.json()).error, "captcha");
  const foreign = await get("/api/reminders", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" });
  assert.equal(foreign.status, 403);

  for (const action of ["potvarzhdenie", "otpisvane", "iztrivane"]) {
    const res = await get(`/napomnyane/${action}?t=${TOKEN}`);
    assert.equal(res.status, 410, action);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const html = await res.text();
    assert.match(html, /Връзката вече не е валидна/);
    assert.match(html, /<meta name="robots" content="noindex/);
    assert.ok(!html.includes("googletagmanager"), "без Google Analytics на страниците с токен");
  }
  // Еднокликово отписване от пощенски клиент (RFC 8058): POST без Origin
  const oneClick = await get(`/napomnyane/otpisvane?t=${TOKEN}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });
  assert.equal(oneClick.status, 410, "непознат токен; заявката не е спряна от проверка за произход");
}

console.log("Проверките на worker-а минаха.");
