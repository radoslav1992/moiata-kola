// Чистата логика на напомнянията: дати по българско време и кой ден кое писмо тръгва.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  describePlan,
  dueStep,
  endSentence,
  expiryDate,
  formatBgDate,
  formatDaysLeft,
  reminderPlan,
  sofiaDate,
} from "../src/lib/reminders/dates.ts";

test("sofiaDate: календарният ден е по българско време, не по UTC", () => {
  assert.equal(sofiaDate(new Date("2026-11-26T10:00:00Z")), "2026-11-26");
  assert.equal(sofiaDate(new Date("2026-11-26T22:30:00Z")), "2026-11-27"); // 00:30 в София (UTC+2)
  assert.equal(sofiaDate(new Date("2026-07-01T21:30:00Z")), "2026-07-02"); // лятно време (UTC+3)
});

test("expiryDate: приема форматите на регистрите и отхвърля всичко друго", () => {
  assert.equal(expiryDate("2027-06-01T23:59:59"), "2027-06-01"); // без зона = българско време
  assert.equal(expiryDate("2027-06-01"), "2027-06-01");
  assert.equal(expiryDate("2027-06-01T22:30:00Z"), "2027-06-02");
  assert.equal(expiryDate("2027-06-01T23:59:59+03:00"), "2027-06-01");
  for (const bad of ["", "утре", "2027-13-01", "2027-02-30T10:00:00", "01.06.2027", null, 20270601, "2027-06-01".repeat(9)]) {
    assert.equal(expiryDate(bad), null, String(bad));
  }
});

test("дни между дати и форматиране на български", () => {
  assert.equal(daysBetween("2026-11-26", "2026-12-10"), 14);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2); // през смяната на часа
  assert.equal(addDays("2026-12-25", 14), "2027-01-08");
  assert.equal(formatBgDate("2027-03-12"), "12 март 2027 г.");
  assert.equal(formatDaysLeft(14), "след 14 дни");
  assert.equal(formatDaysLeft(1), "утре");
  assert.equal(formatDaysLeft(0), "днес");
  assert.equal(endSentence("преди 12 март 2027 г."), "преди 12 март 2027 г.", "без втора точка след „г.“");
  assert.equal(endSentence("Готово"), "Готово.");
});

test("reminderPlan: кои писма има смисъл да се пратят според оставащото време при заявката", () => {
  const today = "2026-11-26";
  const plan = (days) => reminderPlan(addDays(today, days), today);
  assert.deepEqual(plan(365), ["14", "3"]);
  assert.deepEqual(plan(15), ["14", "3"]);
  assert.deepEqual(plan(14), ["3"], "14-дневното вече е в миналото");
  assert.deepEqual(plan(4), ["3"]);
  assert.deepEqual(plan(3), ["1"], "кратка винетка: едно писмо в деня преди");
  assert.deepEqual(plan(2), ["1"]);
  assert.deepEqual(plan(1), [], "изтича до ден: нищо не се предлага");
  assert.deepEqual(plan(0), []);
  assert.deepEqual(plan(-3), []);
  assert.deepEqual(plan(5 * 365), [], "нереално далечна дата");
  assert.equal(describePlan(plan(30), "2026-12-26"), "Ще ви пишем 14 дни и 3 дни преди 26 декември 2026 г.");
  assert.equal(describePlan(plan(7), "2026-12-03"), "Ще ви пишем 3 дни преди 3 декември 2026 г.");
  assert.equal(describePlan(plan(2), "2026-11-28"), "Ще ви пишем в деня преди 28 ноември 2026 г.");
});

/** Симулира cron-а ден по ден с фалшив часовник и връща { ден преди срока: стъпка }. */
function simulate(checkedOn, validTo, { skipDays = [] } = {}) {
  const row = { valid_to: validTo, checked_on: checkedOn, sent_14_at: null, sent_3_at: null, sent_1_at: null };
  const sent = {};
  for (let day = addDays(checkedOn, 1); day <= addDays(validTo, 3); day = addDays(day, 1)) {
    if (skipDays.includes(daysBetween(day, validTo))) continue; // cron-ът не е тръгнал този ден
    const step = dueStep(row, day);
    if (!step) continue;
    sent[daysBetween(day, validTo)] = step;
    row[`sent_${step}_at`] = day;
  }
  return sent;
}

test("cron: 14 дни и 3 дни преди срока, по веднъж", () => {
  assert.deepEqual(simulate("2026-11-26", "2027-03-12"), { 14: "14", 3: "3" });
  assert.deepEqual(simulate("2026-11-26", addDays("2026-11-26", 15)), { 14: "14", 3: "3" });
});

test("cron: 14-дневното се пропуска, ако при заявката вече е било в миналото", () => {
  assert.deepEqual(simulate("2026-11-26", addDays("2026-11-26", 14)), { 3: "3" });
  assert.deepEqual(simulate("2026-11-26", addDays("2026-11-26", 10)), { 3: "3" });
  assert.deepEqual(simulate("2026-11-26", addDays("2026-11-26", 4)), { 3: "3" });
});

test("cron: кратка винетка (2–3 дни) получава едно писмо в деня преди изтичането", () => {
  assert.deepEqual(simulate("2026-11-26", "2026-11-29"), { 1: "1" });
  assert.deepEqual(simulate("2026-11-26", "2026-11-28"), { 1: "1" });
});

test("cron: пропуснат ден се наваксва на следващия, без дублиране и без писма след срока", () => {
  assert.deepEqual(simulate("2026-11-01", "2026-12-20", { skipDays: [14, 13] }), { 12: "14", 3: "3" });
  assert.deepEqual(simulate("2026-11-01", "2026-12-20", { skipDays: [3] }), { 14: "14", 2: "3" });
  // cron-ът не е работил от 14-ия до 4-тия ден: остава само последното напомняне
  assert.deepEqual(simulate("2026-11-01", "2026-12-20", { skipDays: [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4] }), { 3: "3" });
  assert.deepEqual(simulate("2026-11-26", "2026-11-28", { skipDays: [1] }), { 0: "1" });
  const expired = { valid_to: "2026-11-20", checked_on: "2026-10-01", sent_14_at: null, sent_3_at: null, sent_1_at: null };
  assert.equal(dueStep(expired, "2026-11-21"), null);
});
