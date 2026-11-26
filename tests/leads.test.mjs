// Формата „За фирми и автопаркове“: валидиране, запис в D1, капан за ботове,
// ограничение на честотата. Обикновен form POST — без JavaScript.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshD1, emptyTables, rows } from "./helpers/d1.mjs";
import { BUDGETS, HONEYPOT_FIELD, NEEDS, VEHICLE_RANGES, parseLead, submitLead } from "../src/lib/reminders/leads.ts";

const NOW = new Date("2026-11-26T09:00:00Z");
let db, dispose;
let ipCounter = 0;

before(async () => {
  ({ db, dispose } = await freshD1());
});
after(() => dispose());
beforeEach(() => emptyTables(db));

const valid = { email: "Fleet@Example.com", company: "Такси Изток ООД", vehicles: "6-20", needs: ["list", "reminders"], budget: "10-25", consent: "on" };

function form(fields) {
  const data = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) for (const item of [v].flat()) data.append(k, item);
  return data;
}

const post = (fields, { ip = `198.51.100.${++ipCounter}`, origin = "https://ponomer.com", now = NOW } = {}) =>
  submitLead(
    new Request("https://ponomer.com/za-firmi", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin, "cf-connecting-ip": ip },
      body: form(fields),
    }),
    db,
    now,
  );

const leads = () => rows(db, "SELECT * FROM business_leads ORDER BY id");

test("диапазоните: без цени на услугата и с отговор „не бих платил“", () => {
  assert.ok(VEHICLE_RANGES.length >= 4);
  assert.deepEqual(NEEDS.map((n) => n.value), ["list", "reminders", "export"]);
  assert.equal(BUDGETS[0].label, "Не бих платил");
});

test("валидиране: имейл, брой автомобили, нужди, бюджет и съгласие са задължителни; фирмата не е", () => {
  const empty = parseLead(new FormData());
  assert.deepEqual(Object.keys(empty.errors).sort(), ["budget", "consent", "email", "needs", "vehicles"]);
  const fd = new FormData();
  for (const [k, v] of form({ ...valid, company: "" })) fd.append(k, v);
  const ok = parseLead(fd);
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.bot, false);
  assert.deepEqual(ok.values.needs, ["list", "reminders"]);
});

test("запис: един ред с имейл, фирма, диапазони, нужди и момент на съгласието", async () => {
  assert.deepEqual(await post(valid), { status: "saved" });
  const [row] = await leads();
  assert.equal(row.email, "fleet@example.com");
  assert.equal(row.company, "Такси Изток ООД");
  assert.equal(row.vehicles, "6-20");
  assert.equal(row.needs, "list,reminders");
  assert.equal(row.budget, "10-25");
  assert.equal(row.consent_at, NOW.toISOString());
  assert.equal(row.created_at, NOW.toISOString());

  await post({ ...valid, company: "", budget: "0" });
  assert.equal((await leads())[1].company, null);
});

test("грешки: нищо не се записва, стойностите се връщат за попълване", async () => {
  const res = await post({ ...valid, email: "грешен", vehicles: "999", needs: ["нещо"], consent: [] });
  assert.equal(res.status, "invalid");
  assert.deepEqual(Object.keys(res.errors).sort(), ["consent", "email", "needs", "vehicles"]);
  assert.equal(res.values.email, "грешен");
  assert.equal(res.values.budget, "10-25");
  assert.equal((await leads()).length, 0);
});

test("капан за ботове: попълнено скрито поле → изглежда като успех, но не се записва", async () => {
  assert.deepEqual(await post({ ...valid, [HONEYPOT_FIELD]: "https://spam.example" }), { status: "saved" });
  assert.equal((await leads()).length, 0);
});

test("защита: чужд произход се отхвърля; до 5 записа на час от един IP", async () => {
  const foreign = await post(valid, { origin: "https://evil.example" });
  assert.equal(foreign.status, "rejected");
  assert.equal(foreign.code, 403);

  const ip = "198.51.100.200";
  for (let i = 0; i < 5; i++) assert.equal((await post(valid, { ip })).status, "saved");
  const sixth = await post(valid, { ip });
  assert.equal(sixth.status, "rejected");
  assert.equal(sixth.code, 429);
  assert.equal((await leads()).length, 5);
  assert.equal((await post(valid, { ip, now: new Date(NOW.getTime() + 2 * 3_600_000) })).status, "saved");
});
