// Писмата за напомняне и връзката „какво да направя сега“: всяко писмо има връзка
// за спиране и за изтриване, казва от коя проверка е датата, а разкритието за
// партньорска връзка се появява само когато е зададен партньорски URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmationEmail, reminderEmail, updatedEmail } from "../src/lib/reminders/email.ts";
import { RENEW_LINKS, renewLink } from "../src/data/renew-links.ts";
import { renewCtaHtml } from "../src/lib/checks/renew-cta.ts";

const TOKEN = "manage-token-0123456789abcdef";
const facts = { plate: "CB1234AB", validTo: "2027-03-12", checkedOn: "2026-11-26", manageToken: TOKEN };
const withPartner = (kind) => ({
  ...RENEW_LINKS,
  [kind]: { ...RENEW_LINKS[kind], partnerUrl: "https://partner.example/buy?ref=ponomer", partnerName: "Партньор ООД" },
});

const allMails = () => [
  confirmationEmail({ ...facts, kind: "vignette", plan: ["14", "3"], confirmToken: "confirm-token-0123456789abcdef" }),
  updatedEmail({ ...facts, kind: "gtp", plan: ["3"] }),
  reminderEmail({ ...facts, kind: "vignette", daysLeft: 14, last: false }),
  reminderEmail({ ...facts, kind: "gtp", daysLeft: 3, last: true }),
  reminderEmail({ ...facts, kind: "go", daysLeft: 1, last: true }),
];

test("всяко писмо: текст и HTML, връзка за спиране и „изтрий всичко“, List-Unsubscribe", () => {
  for (const mail of allMails()) {
    assert.ok(mail.subject.length > 10 && mail.subject.length < 120, mail.subject);
    for (const part of [mail.text, mail.html]) {
      assert.ok(part.includes(`https://ponomer.com/napomnyane/otpisvane?t=${TOKEN}`), mail.subject);
      assert.ok(part.includes(`https://ponomer.com/napomnyane/iztrivane?t=${TOKEN}`), mail.subject);
      assert.match(part, /неофициален сайт/);
      assert.ok(!/undefined|null|NaN|\[object/.test(part), mail.subject);
      assert.ok(!part.includes(".."), `двойна точка в „${mail.subject}“`);
    }
    assert.match(mail.text, /Изтриване на всичко за този имейл/);
    assert.match(mail.html, /Изтрий всичко за този имейл/);
    assert.match(mail.html, /^<!doctype html>/);
    assert.equal(mail.headers["List-Unsubscribe"], `<https://ponomer.com/napomnyane/otpisvane?t=${TOKEN}>`);
    assert.equal(mail.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  }
});

test("напомнянето казва какво изтича, кога и според коя проверка, и води към нова проверка", () => {
  const mail = reminderEmail({ ...facts, kind: "vignette", daysLeft: 14, last: false });
  assert.equal(mail.subject, "Винетката на CB1234AB изтича след 14 дни — на 12 март 2027 г.");
  for (const part of [mail.text, mail.html]) {
    assert.match(part, /Винетката на CB1234AB изтича след 14 дни — на 12 март 2027 г\., според проверката, направена в ponomer\.com на 26 ноември 2026 г\./);
    assert.match(part, /Оттогава не сме проверявали отново/);
    assert.ok(part.includes("https://ponomer.com/vinetka/proverka?plate=CB1234AB"));
    assert.ok(part.includes("https://ponomer.com/vinetka/kupi"));
  }
  const gtp = reminderEmail({ ...facts, kind: "gtp", daysLeft: 3, last: true });
  assert.equal(gtp.subject, "Техническият преглед (ГТП) на CB1234AB изтича след 3 дни — на 12 март 2027 г.");
  assert.ok(gtp.text.includes("https://ponomer.com/gtp/proverka?plate=CB1234AB"));
  assert.ok(gtp.text.includes("https://ponomer.com/gtp/cena"));
  assert.match(gtp.text, /код за сигурност — въвеждате го вие/, "captcha-та на ИААА не се заобикаля");
  const go = reminderEmail({ ...facts, kind: "go", daysLeft: 1, last: true });
  assert.equal(go.subject, "Гражданската отговорност на CB1234AB изтича утре — на 12 март 2027 г.");
  assert.ok(go.text.includes("https://ponomer.com/grazhdanska-otgovornost/proverka?plate=CB1234AB"));
  assert.ok(go.text.includes("https://ponomer.com/grazhdanska-otgovornost/proverka#oferti"));
});

test("по подразбиране няма партньорски връзки и няма разкритие — никъде", () => {
  for (const kind of ["vignette", "gtp", "go"]) {
    const link = renewLink(kind);
    assert.equal(link.partner, false);
    assert.equal(link.disclosure, null);
    assert.ok(link.href.startsWith("/"), "целта е страница на сайта");
    const mail = reminderEmail({ ...facts, kind, daysLeft: 3, last: true });
    assert.ok(!/партньорска|sponsored/.test(mail.text + mail.html), kind);
  }
  for (const kind of ["vignette", "insurance", "inspection"]) {
    for (const style of ["link", "button"]) assert.ok(!/партньорска|sponsored|target=/.test(renewCtaHtml(kind, style)));
  }
  // картите с резултат остават същите като преди модула
  assert.equal(renewCtaHtml("vignette", "button"), '<a href="/vinetka/kupi" class="btn-primary mt-3 w-full sm:w-auto">Купи винетка онлайн</a>');
  assert.equal(
    renewCtaHtml("inspection", "link"),
    '<a href="/gtp/cena" class="mt-2 inline-block text-sm font-semibold text-accent hover:underline">Виж цените за ГТП →</a>',
  );
});

test("зададен партньорски URL: връзката сочи към партньора и има ясно разкритие — в писмото и в картата", () => {
  const disclosure = "Връзката е партньорска: при покупка през нея получаваме комисиона от Партньор ООД.";
  const mail = reminderEmail({ ...facts, kind: "vignette", daysLeft: 3, last: true, renewLinks: withPartner("vignette") });
  assert.ok(mail.text.includes("https://partner.example/buy?ref=ponomer"));
  assert.ok(mail.text.includes(disclosure));
  assert.ok(mail.html.includes("https://partner.example/buy?ref=ponomer"));
  assert.ok(mail.html.includes(disclosure));
  assert.match(mail.html, /rel="sponsored nofollow noopener"/);
  assert.ok(!mail.text.includes("https://ponomer.com/vinetka/kupi"));

  // партньор само за винетки не променя писмата за ГТП и ГО
  const other = reminderEmail({ ...facts, kind: "gtp", daysLeft: 3, last: true, renewLinks: withPartner("vignette") });
  assert.ok(!/партньорска|partner\.example/.test(other.text + other.html));

  const card = renewCtaHtml("insurance", "link", withPartner("go"));
  assert.match(card, /href="https:\/\/partner\.example\/buy\?ref=ponomer"/);
  assert.match(card, /rel="sponsored nofollow noopener"/);
  assert.ok(card.includes(disclosure));

  // без име на партньора се изписва домейнът му
  const unnamed = { ...RENEW_LINKS, gtp: { ...RENEW_LINKS.gtp, partnerUrl: "https://www.punkt.example/x", partnerName: "" } };
  assert.match(renewLink("gtp", unnamed).disclosure, /комисиона от punkt\.example\.$/);
});

test("писмото за потвърждение: какво е поискано, кога ще пишем и че без потвърждение нищо не тръгва", () => {
  const mail = confirmationEmail({ ...facts, kind: "vignette", plan: ["14", "3"], confirmToken: "confirm-token-0123456789abcdef" });
  assert.equal(mail.subject, "Потвърдете напомнянето за винетката на CB1234AB");
  for (const part of [mail.text, mail.html]) {
    assert.ok(part.includes("https://ponomer.com/napomnyane/potvarzhdenie?t=confirm-token-0123456789abcdef"));
    assert.match(part, /Ще ви пишем 14 дни и 3 дни преди 12 март 2027 г\./);
    assert.match(part, /Без потвърждение не изпращаме нищо, а заявката се изтрива след 48 часа\./);
    assert.match(part, /Ако не сте поискали напомняне, не правете нищо\./);
  }
});
