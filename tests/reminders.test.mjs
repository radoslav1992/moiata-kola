// Напомняния по имейл върху истинска локална D1 (Miniflare): миграцията, заявката
// (валидиране, ALTCHA, ограничение на честотата, upsert), токените за
// потвърждение / спиране / изтриване, дневната задача и почистването.
// Часовникът е фалшив: всяка функция получава `now` отвън.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshD1, emptyTables, fakeEmail, rows } from "./helpers/d1.mjs";
import { handleChallenge, handleSignup } from "../src/lib/reminders/api.ts";
import { runDaily } from "../src/lib/reminders/cron.ts";
import { hashToken, solveChallenge } from "../src/lib/reminders/crypto.ts";
import { addDays } from "../src/lib/reminders/dates.ts";
import { cleanup, confirmReminder, deleteAllForEmail, findByToken, unsubscribe } from "../src/lib/reminders/store.ts";
import { serverSecret } from "../src/lib/reminders/crypto.ts";
import { solveAltcha } from "../src/lib/checks/altcha.ts";

const NOW = new Date("2026-11-26T09:00:00Z"); // 11:00 в София
const TODAY = "2026-11-26";
const at = (days, hours = 0) => new Date(NOW.getTime() + days * 86_400_000 + hours * 3_600_000);

let db, dispose, email, env;
let ipCounter = 0;
const nextIp = () => `203.0.113.${++ipCounter}`;

before(async () => {
  ({ db, dispose } = await freshD1());
});
after(() => dispose());
beforeEach(async () => {
  await emptyTables(db);
  email = fakeEmail();
  env = { DB: db, EMAIL: email, EMAIL_FROM: "no-reply@ponomer.com" };
});

const challengeFor = async (now = NOW, ip = nextIp()) =>
  (await handleChallenge(new Request("https://ponomer.com/api/reminders/challenge", { headers: { "cf-connecting-ip": ip } }), env, now)).json();

/** Изпраща заявка за напомняне; ALTCHA се решава, освен ако не е подадена стойност. */
async function signup(fields = {}, opts = {}) {
  const { now = NOW, ip = nextIp(), headers = {} } = opts;
  const useEnv = "useEnv" in opts ? opts.useEnv : env;
  const body = {
    email: "ivan@example.com",
    plate: "CB1234AB",
    kind: "vignette",
    validTo: `${addDays(TODAY, 60)}T23:59:59`,
    consent: true,
    ...fields,
  };
  if (!("altcha" in fields)) body.altcha = solveAltcha(await challengeFor(now));
  const res = await handleSignup(
    new Request("https://ponomer.com/api/reminders", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://ponomer.com", "cf-connecting-ip": ip, ...headers },
      body: JSON.stringify(body),
    }),
    useEnv,
    now,
  );
  return { status: res.status, body: await res.json() };
}

const tokenFrom = (mail, path) => new RegExp(`https://ponomer\\.com/napomnyane/${path}\\?t=([A-Za-z0-9_-]+)`).exec(mail.text)?.[1];
const reminders = () => rows(db, "SELECT * FROM reminders ORDER BY id");

/** Записва и потвърждава напомняне; връща реда и токена за управление от писмото. */
async function confirmed(fields = {}, opts = {}) {
  const before = email.sent.length;
  const res = await signup(fields, opts);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const mail = email.sent[before];
  const done = await confirmReminder(db, tokenFrom(mail, "potvarzhdenie"), opts.now ?? NOW);
  return { row: done.row, manage: tokenFrom(mail, "otpisvane") };
}

test("миграцията върху свежа база: таблици, уникалност, позволени видове", async () => {
  const tables = (await rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((t) => t.name);
  for (const t of ["app_secrets", "attempts", "business_leads", "reminder_tokens", "reminders"]) assert.ok(tables.includes(t), t);

  const insert = (kind, mail = "a@example.com") =>
    db
      .prepare("INSERT INTO reminders (email, plate, kind, valid_to, checked_on, created_at) VALUES (?, 'CB1234AB', ?, '2027-01-01', '2026-11-26', '2026-11-26T09:00:00Z')")
      .bind(mail, kind)
      .run();
  await insert("vignette");
  await insert("gtp");
  await insert("go");
  await assert.rejects(insert("vignette"), /UNIQUE/, "един ред на (имейл, номер, вид)");
  await assert.rejects(insert("kasko", "b@example.com"), /CHECK/, "само vignette | gtp | go");

  // токените изчезват заедно с напомнянето
  const [{ id }] = await reminders();
  await db.prepare("INSERT INTO reminder_tokens (hash, reminder_id, purpose, created_at) VALUES ('h', ?, 'manage', 'x')").bind(id).run();
  await db.prepare("DELETE FROM reminders WHERE id = ?").bind(id).run();
  assert.equal((await rows(db, "SELECT * FROM reminder_tokens")).length, 0);
});

test("изключено състояние: без D1 или без EMAIL binding всичко е 404 и нищо не се праща", async () => {
  for (const partial of [undefined, {}, { DB: db }, { EMAIL: email }]) {
    const res = await signup({ altcha: "x" }, { useEnv: partial });
    assert.equal(res.status, 404);
    const ch = await handleChallenge(new Request("https://ponomer.com/api/reminders/challenge"), partial, NOW);
    assert.equal(ch.status, 404);
  }
  assert.equal(email.sent.length, 0);
  assert.equal((await reminders()).length, 0);
  assert.equal((await runDaily(undefined, NOW)).stopped, "no_db");
  assert.equal((await runDaily({ DB: db }, NOW)).stopped, "no_email_binding");
});

test("заявка: валидиране на имейл, номер, вид, дата и съгласие", async () => {
  const cases = [
    [{ email: "не-е-имейл" }, "invalid_email"],
    [{ email: "a@b" }, "invalid_email"],
    [{ plate: "123" }, "invalid_plate"],
    [{ kind: "kasko" }, "invalid_kind"],
    [{ validTo: "скоро" }, "invalid_date"],
    [{ validTo: "2026-11-20T23:59:59" }, "invalid_date"], // вече изтекла
    [{ validTo: `${addDays(TODAY, 5 * 365)}T23:59:59` }, "invalid_date"], // нереално далеч
    [{ validTo: `${addDays(TODAY, 1)}T23:59:59` }, "too_soon"], // изтича до ден
    [{ consent: false }, "consent_required"],
    [{ consent: "on" }, "consent_required"],
  ];
  for (const [fields, error] of cases) {
    const res = await signup(fields);
    assert.equal(res.status, 400, JSON.stringify(fields));
    assert.equal(res.body.error, error, JSON.stringify(fields));
    assert.ok(res.body.message.length > 5);
  }
  assert.equal((await reminders()).length, 0);
  assert.equal(email.sent.length, 0);

  const crossSite = await signup({}, { headers: { origin: "https://evil.example" } });
  assert.equal(crossSite.status, 403);
});

test("заявка: ALTCHA е задължителна, подписана, със срок и за еднократна употреба", async () => {
  assert.equal((await signup({ altcha: undefined })).body.error, "captcha");
  assert.equal((await signup({ altcha: "глупости" })).body.error, "captcha");

  const challenge = await challengeFor();
  assert.equal(challenge.algorithm, "SHA-256");
  const decode = (payload) => JSON.parse(atob(payload));
  const encode = (obj) => btoa(JSON.stringify(obj));
  const solved = await solveChallenge(challenge); // решението, което смята браузърът

  const wrongNumber = { ...decode(solved), number: decode(solved).number + 1 };
  assert.equal((await signup({ altcha: encode(wrongNumber) })).body.error, "captcha");
  const forged = { ...decode(solved), signature: "0".repeat(64) };
  assert.equal((await signup({ altcha: encode(forged) })).body.error, "captcha");
  assert.equal((await signup({ altcha: solved }, { now: at(0, 1) })).body.error, "captcha", "изтекъл след 10 минути");

  assert.equal((await signup({ altcha: solved })).status, 200);
  const replay = await signup({ altcha: solved, email: "drug@example.com" });
  assert.equal(replay.body.error, "captcha", "същото решение не важи втори път");
  assert.equal((await reminders()).length, 1);
});

test("заявка: ограничение на честотата по IP и по имейл", async () => {
  const ip = nextIp();
  for (let i = 0; i < 5; i++) {
    assert.equal((await signup({ email: `p${i}@example.com` }, { ip })).status, 200);
  }
  const sixth = await signup({ email: "p6@example.com" }, { ip });
  assert.equal(sixth.status, 429);
  assert.equal(sixth.body.error, "rate_limited");
  assert.equal((await signup({ email: "p6@example.com" }, { ip, now: at(0, 2) })).status, 200, "след час отново може");

  for (let i = 0; i < 3; i++) {
    assert.equal((await signup({ email: "edin@example.com", plate: `CB000${i}AB` })).status, 200);
  }
  assert.equal((await signup({ email: "edin@example.com", plate: "CB0009AB" })).status, 429, "до 3 писма на адрес за 24 часа");

  // в базата няма сурови IP адреси или имейли в таблицата за ограничението
  const attempts = await rows(db, "SELECT key FROM attempts");
  assert.ok(attempts.length > 0);
  for (const a of attempts) assert.ok(!a.key.includes("203.0.113") && !a.key.includes("@"), a.key);
});

test("заявка: 31-вата заявка в минута от един IP се спира от лимита в паметта", async () => {
  const ip = nextIp();
  let last;
  for (let i = 0; i < 31; i++) {
    last = await handleChallenge(new Request("https://ponomer.com/api/reminders/challenge", { headers: { "cf-connecting-ip": ip } }), env, NOW);
  }
  assert.equal(last.status, 429);
});

test("успешна заявка: непотвърден ред, само хешове на токените, писмо с връзка за потвърждение", async () => {
  const res = await signup({ email: " Ivan@Example.com ", plate: "св 1234 ав", kind: "insurance", validTo: "2027-03-12T23:59:59" });
  assert.deepEqual(res, { status: 200, body: { ok: true } });

  const [row] = await reminders();
  assert.equal(row.email, "ivan@example.com");
  assert.equal(row.plate, "CB1234AB", "кирилицата от табелата е нормализирана");
  assert.equal(row.kind, "go");
  assert.equal(row.valid_to, "2027-03-12");
  assert.equal(row.checked_on, TODAY);
  assert.equal(row.confirmed_at, null);
  assert.deepEqual([row.sent_14_at, row.sent_3_at, row.sent_1_at], [null, null, null]);
  // освен датата не се пази нищо от резултата на проверката
  assert.deepEqual(Object.keys(row).sort(), [
    "checked_on", "confirmed_at", "created_at", "email", "id", "kind", "plate", "send_failures", "sent_14_at", "sent_1_at", "sent_3_at", "valid_to",
  ]);

  assert.equal(email.sent.length, 1);
  const mail = email.sent[0];
  assert.equal(mail.to, "ivan@example.com");
  assert.deepEqual(mail.from, { email: "no-reply@ponomer.com", name: "По номер" });
  assert.equal(mail.replyTo, "kontakt@ponomer.com");
  assert.match(mail.subject, /^Потвърдете напомнянето за Гражданската отговорност на CB1234AB$/);
  for (const part of [mail.text, mail.html]) {
    assert.match(part, /napomnyane\/potvarzhdenie\?t=/);
    assert.match(part, /napomnyane\/otpisvane\?t=/);
    assert.match(part, /napomnyane\/iztrivane\?t=/);
    assert.match(part, /12 март 2027 г\./);
    assert.match(part, /26 ноември 2026 г\./, "датата на проверката");
    assert.match(part, /48 часа/);
  }
  assert.match(mail.headers["List-Unsubscribe"], /^<https:\/\/ponomer\.com\/napomnyane\/otpisvane\?t=[\w-]+>$/);
  assert.equal(mail.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");

  const confirm = tokenFrom(mail, "potvarzhdenie");
  const manage = tokenFrom(mail, "otpisvane");
  assert.equal(tokenFrom(mail, "iztrivane"), manage);
  const tokens = await rows(db, "SELECT hash, purpose FROM reminder_tokens ORDER BY purpose");
  assert.deepEqual(tokens, [
    { hash: await hashToken(confirm), purpose: "confirm" },
    { hash: await hashToken(manage), purpose: "manage" },
  ]);
  const dump = JSON.stringify(await rows(db, "SELECT * FROM reminder_tokens"));
  assert.ok(!dump.includes(confirm) && !dump.includes(manage), "самите токени не са в базата");
});

test("upsert: повторна заявка сменя датата, без втори ред", async () => {
  await signup({ validTo: "2027-01-10T23:59:59" });
  await signup({ email: "IVAN@example.com", plate: "СВ1234АВ", validTo: "2027-02-20T23:59:59" }, { now: at(0, 1) });
  let all = await reminders();
  assert.equal(all.length, 1);
  assert.equal(all[0].valid_to, "2027-02-20");
  assert.equal(all[0].confirmed_at, null);
  assert.equal(all[0].created_at, at(0, 1).toISOString(), "48-те часа за потвърждение започват отначало");
  assert.equal(email.sent.length, 2);
  assert.match(email.sent[1].subject, /^Потвърдете/);

  // друг вид или друг номер за същия имейл е отделно напомняне
  await signup({ kind: "inspection", validTo: "2027-05-05T23:59:59" });
  assert.equal((await reminders()).length, 2);

  // потвърден ред: остава потвърден, флаговете се нулират само при нова дата, писмото е „обновихме“
  await emptyTables(db);
  const { row } = await confirmed({ validTo: "2027-01-10T23:59:59" });
  await db.prepare("UPDATE reminders SET sent_14_at = 'x' WHERE id = ?").bind(row.id).run();
  await signup({ validTo: "2027-01-10T23:59:59" }, { now: at(1) });
  assert.equal((await reminders())[0].sent_14_at, "x", "същата дата: вече пратеното не се повтаря");
  const sentBefore = email.sent.length;
  await signup({ validTo: "2028-01-09T23:59:59" }, { now: at(2) });
  all = await reminders();
  assert.equal(all.length, 1);
  assert.equal(all[0].valid_to, "2028-01-09");
  assert.equal(all[0].checked_on, "2026-11-28");
  assert.ok(all[0].confirmed_at);
  assert.equal(all[0].sent_14_at, null);
  const update = email.sent[sentBefore];
  assert.match(update.subject, /^Обновихме напомнянето за винетката на CB1234AB$/);
  assert.ok(!update.text.includes("potvarzhdenie"), "ново потвърждение не се иска");
  assert.match(update.text, /napomnyane\/otpisvane\?t=/);
  assert.match(update.text, /napomnyane\/iztrivane\?t=/);
});

test("потвърждение: само с токена от писмото; повторното отваряне не е грешка", async () => {
  await signup();
  const mail = email.sent[0];
  const confirm = tokenFrom(mail, "potvarzhdenie");
  const manage = tokenFrom(mail, "otpisvane");

  assert.equal(await confirmReminder(db, "несъществуващ-токен-0123456789", NOW), null);
  assert.equal(await confirmReminder(db, manage, NOW), null, "токенът за управление не потвърждава");
  assert.equal(await confirmReminder(db, undefined, NOW), null);
  assert.equal((await reminders())[0].confirmed_at, null);

  const first = await confirmReminder(db, confirm, at(0, 3));
  assert.equal(first.first, true);
  assert.equal((await reminders())[0].confirmed_at, at(0, 3).toISOString());
  const again = await confirmReminder(db, confirm, at(1));
  assert.equal(again.first, false);
  assert.equal((await reminders())[0].confirmed_at, at(0, 3).toISOString());

  // връзката за потвърждение важи 48 часа, дори преди cron-ът да е изтрил реда
  await signup({ email: "kasno@example.com" });
  const late = tokenFrom(email.sent.at(-1), "potvarzhdenie");
  assert.equal(await confirmReminder(db, late, at(2, 1)), null);
  assert.ok(await confirmReminder(db, late, at(1, 23)));
});

test("спиране: изтрива само това напомняне и токените му", async () => {
  const a = await confirmed({ kind: "vignette" });
  const b = await confirmed({ kind: "inspection" });
  assert.equal(await unsubscribe(db, "несъществуващ-токен-0123456789"), null);
  assert.equal((await findByToken(db, a.manage, "manage")).id, a.row.id);

  const gone = await unsubscribe(db, a.manage);
  assert.equal(gone.kind, "vignette");
  const left = await reminders();
  assert.deepEqual(left.map((r) => r.kind), ["gtp"]);
  assert.equal(await unsubscribe(db, a.manage), null, "връзката важи веднъж");
  const tokens = await rows(db, "SELECT DISTINCT reminder_id FROM reminder_tokens");
  assert.deepEqual(tokens, [{ reminder_id: b.row.id }]);
});

test("„изтрий всичко за този имейл“: напомнянията, запитването от фирми и отпечатъците", async () => {
  const mine = await confirmed({ email: "ivan@example.com", kind: "vignette" });
  await confirmed({ email: "ivan@example.com", kind: "insurance" });
  await signup({ email: "ivan@example.com", plate: "CA7777AA" }); // непотвърдено
  await confirmed({ email: "drug@example.com" });
  const lead = (mail) =>
    db.prepare("INSERT INTO business_leads (email, vehicles, needs, budget, consent_at, created_at) VALUES (?, '2-5', 'list', '0', 'x', 'x')").bind(mail).run();
  await lead("ivan@example.com");
  await lead("drug@example.com");

  const secret = await serverSecret(db);
  assert.equal(await deleteAllForEmail(db, secret, "несъществуващ-токен-0123456789"), null);
  const done = await deleteAllForEmail(db, secret, mine.manage);
  assert.deepEqual(done, { email: "ivan@example.com", reminders: 3, leads: 1 });

  assert.deepEqual((await reminders()).map((r) => r.email), ["drug@example.com"]);
  assert.deepEqual((await rows(db, "SELECT email FROM business_leads")).map((r) => r.email), ["drug@example.com"]);
  const orphans = await rows(db, "SELECT * FROM reminder_tokens WHERE reminder_id NOT IN (SELECT id FROM reminders)");
  assert.equal(orphans.length, 0);
  assert.equal(await deleteAllForEmail(db, secret, mine.manage), null);
});

test("cron: непотвърдените не получават нищо; потвърдените — 14 и 3 дни преди, по веднъж", async () => {
  const validTo = addDays(TODAY, 40);
  await signup({ email: "nepotvarden@example.com", validTo: `${validTo}T23:59:59` });
  await confirmed({ email: "ivan@example.com", validTo: `${validTo}T23:59:59` });
  email.sent.length = 0;

  const sentOn = {};
  for (let day = 0; day <= 45; day++) {
    const before = email.sent.length;
    const result = await runDaily(env, at(day));
    if (email.sent.length > before) sentOn[40 - day] = email.sent.slice(before).map((m) => m.to);
    assert.equal(result.failed, 0);
    await runDaily(env, at(day, 1)); // второ пускане същия ден не праща нищо ново
    assert.equal(email.sent.length, before + (sentOn[40 - day]?.length ?? 0));
  }
  assert.deepEqual(sentOn, { 14: ["ivan@example.com"], 3: ["ivan@example.com"] });

  const [first, last] = email.sent;
  assert.match(first.subject, /^Винетката на CB1234AB изтича след 14 дни — на /);
  assert.match(last.subject, /^Винетката на CB1234AB изтича след 3 дни — на /);
  assert.ok(!first.text.includes("последното писмо"));
  assert.match(last.text, /последното писмо за този срок/);
});

test("cron: кратка винетка — едно писмо в деня преди; само 3-дневно, ако 14-ият ден е минал при заявката", async () => {
  await confirmed({ email: "uikend@example.com", plate: "CB0001AB", validTo: `${addDays(TODAY, 2)}T23:59:59` });
  await confirmed({ email: "sedmica@example.com", plate: "CB0002AB", validTo: `${addDays(TODAY, 7)}T23:59:59` });
  email.sent.length = 0;

  const log = [];
  for (let day = 0; day <= 9; day++) {
    const before = email.sent.length;
    await runDaily(env, at(day));
    for (const m of email.sent.slice(before)) log.push(`ден ${day}: ${m.to}: ${m.subject.replace(/ — на .*/, "")}`);
  }
  assert.deepEqual(log, [
    "ден 1: uikend@example.com: Винетката на CB0001AB изтича утре",
    "ден 4: sedmica@example.com: Винетката на CB0002AB изтича след 3 дни",
  ]);
});

test("cron: лимит на писмата за едно пускане; останалите тръгват при следващото", async () => {
  for (let i = 0; i < 5; i++) {
    await confirmed({ email: `p${i}@example.com`, plate: `CB000${i}AB`, validTo: `${addDays(TODAY, 20)}T23:59:59` });
  }
  email.sent.length = 0;
  const first = await runDaily(env, at(6), { limit: 3 });
  assert.equal(first.sent, 3);
  const second = await runDaily(env, at(6, 1), { limit: 3 });
  assert.equal(second.sent, 2);
  assert.equal((await runDaily(env, at(6, 2), { limit: 3 })).sent, 0);
  assert.equal(new Set(email.sent.map((m) => m.to)).size, 5);
  assert.equal((await runDaily({ ...env, REMINDERS_PER_RUN: "1" }, at(17))).sent, 1, "REMINDERS_PER_RUN от конфигурацията");
});

test("cron: ненастроен домейн спира пускането; проблемен получател се пропуска след 3 опита", async () => {
  await confirmed({ validTo: `${addDays(TODAY, 20)}T23:59:59` });
  email.sent.length = 0;

  email.failWith = "E_SENDER_NOT_VERIFIED";
  const stopped = await runDaily(env, at(6));
  assert.equal(stopped.stopped, "E_SENDER_NOT_VERIFIED");
  assert.equal((await reminders())[0].send_failures, 0, "не е вина на получателя — утре се опитва пак");

  email.failWith = "E_RECIPIENT_SUPPRESSED";
  for (let i = 0; i < 3; i++) assert.equal((await runDaily(env, at(6, i + 1))).failed, 1);
  assert.equal((await reminders())[0].send_failures, 3);
  assert.equal((await runDaily(env, at(7))).due, 0, "след 3 неуспеха редът се пропуска");
  assert.equal((await reminders())[0].sent_14_at, null);
  assert.equal(email.sent.length, 0);
});

test("почистване: непотвърдени след 48 часа, напомняния 30 дни след срока, стари отпечатъци и запитвания", async () => {
  await signup({ email: "zabravil@example.com" });
  await confirmed({ email: "ivan@example.com", validTo: `${addDays(TODAY, 10)}T23:59:59` });

  let result = await cleanup(db, at(1, 23));
  assert.equal(result.unconfirmed, 0, "на 47-ия час заявката още чака");
  result = await cleanup(db, at(2, 1));
  assert.equal(result.unconfirmed, 1);
  assert.deepEqual((await reminders()).map((r) => r.email), ["ivan@example.com"]);

  result = await cleanup(db, at(10 + 29));
  assert.equal(result.expired, 0, "29 дни след срока редът още се пази");
  assert.equal((await reminders()).length, 1);
  result = await cleanup(db, at(10 + 30));
  assert.equal(result.expired, 1, "на 30-ия ден след срока се изтрива");
  assert.equal((await reminders()).length, 0);
  assert.equal((await rows(db, "SELECT * FROM reminder_tokens")).length, 0);
  assert.equal((await rows(db, "SELECT * FROM attempts")).length, 0, "отпечатъците се трият след 24 часа");

  const lead = (createdAt) =>
    db.prepare("INSERT INTO business_leads (email, vehicles, needs, budget, consent_at, created_at) VALUES ('f@example.com', '2-5', 'list', '0', ?, ?)").bind(createdAt, createdAt).run();
  await lead(at(-731).toISOString());
  await lead(at(-700).toISOString());
  result = await cleanup(db, NOW);
  assert.equal(result.leads, 1);
  assert.equal((await rows(db, "SELECT * FROM business_leads")).length, 1);

  // дневната задача чисти и без EMAIL binding
  await signup({ email: "pak@example.com" });
  const daily = await runDaily({ DB: db }, at(3));
  assert.equal(daily.cleaned.unconfirmed, 1);
});
