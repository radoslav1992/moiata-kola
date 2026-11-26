// Твърденията за данните трябва да са верни и в двете състояния на сайта: без
// настроени напомняния нищо не се пази; с напомняне се пази точно описаното.
// Чете build-а (dist/client) — пуска се след `npm run build`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KEEP_AFTER_EXPIRY_DAYS, LEAD_TTL_DAYS, UNCONFIRMED_TTL_HOURS } from "../src/lib/reminders/store.ts";

const client = fileURLToPath(new URL("../dist/client/", import.meta.url));
const skip = !existsSync(`${client}poveritelnost.html`) && "няма build — пуснете npm run build";
const text = (file) =>
  readFileSync(client + file, "utf8")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

test("поверителност: какво се пази при напомняне, докога, кой го обработва и как се трие", { skip }, () => {
  const html = readFileSync(`${client}poveritelnost.html`, "utf8");
  assert.ok(html.includes('id="napomnyaniya"') && html.includes('id="za-firmi"'), "котвите от формите");
  const page = text("poveritelnost.html");
  assert.match(page, /по подразбиране не пазим нищо за вас/);
  for (const stored of ["имейл адреса ви", "регистрационния номер", "вида на срока", "датата на изтичане"]) {
    assert.ok(page.includes(stored), stored);
  }
  // сроковете в текста са същите като в кода
  assert.equal(KEEP_AFTER_EXPIRY_DAYS, 30);
  assert.match(page, /До 30 дни след датата на изтичане или докато спрете напомнянето/);
  assert.equal(UNCONFIRMED_TTL_HOURS, 48);
  assert.match(page, /непотвърдената заявка се изтрива след 48 часа/);
  assert.equal(LEAD_TTL_DAYS, 730);
  assert.match(page, /най-късно след 24 месеца/);
  assert.match(page, /Cloudflare/);
  assert.match(page, /„Спри това напомняне“/);
  assert.match(page, /„Изтрий всичко за този имейл“/);
  assert.match(page, /Не правим и нови справки за номера ви/);
});

test("старите обещания „нищо не се пази“ са заменени навсякъде с вярното и в двете състояния", { skip }, () => {
  for (const file of ["poveritelnost.html", "index.html", "za-proekta.html", "vinetka/proverka.html"]) {
    const page = text(file);
    assert.ok(!page.includes("ние просто нямаме такива данни"), file);
    assert.ok(!/не съхранява регистрационни номера, свързани с лични данни/.test(page), file);
    assert.ok(!/Номерата не се съхраняват, свързани с личност/.test(page), file);
    assert.ok(!/Не съхраняваме регистрационни номера, свързани с личност/.test(page), file);
  }
  assert.match(text("index.html"), /Сайтът не съхранява регистрационни номера, освен ако сами поискате напомняне по имейл\./);
});

test("every POST endpoint checks the request origin itself (Astro's built-in check is off)", () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  assert.match(read("astro.config.mjs"), /checkOrigin:\s*false/);
  assert.match(read("src/pages/api/gtp/check.ts"), /if \(!sameOrigin\(request\)\) return json\(\{ error: "forbidden" \}, 403\)/);
  assert.match(read("src/lib/reminders/api.ts"), /if \(!sameOrigin\(request\)\) return fail\(403, "forbidden"\)/);
  assert.match(read("src/lib/reminders/leads.ts"), /if \(!sameOrigin\(request\)\)/);
});
