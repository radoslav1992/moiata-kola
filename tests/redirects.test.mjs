// Проверява public/_redirects срещу build-а (dist/client) — пуска се след `npm run build`.
//
// Съпоставянето повтаря логиката на asset worker-а на Cloudflare
// (workers-shared: parseRedirects + rules-engine): статичните правила (без * и :)
// се търсят по точен път, после динамичните по реда във файла; "*" е (?<splat>.*),
// ":name" е ([^/]+); след първото динамично правило всички следващи са динамични.
// Реалното поведение е проверено и с `wrangler dev` (виж README → Пренасочвания).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ON_DEMAND_PAGES } from "./on-demand-pages.mjs";

const root = new URL("../", import.meta.url);
const client = new URL("dist/client/", root);

// Всички не-канонични URL-и от Search Console (Pages, 90 дни до 15.11.2026):
// .html, наклонена черта накрая, /index.html — всеки трябва да е 301 към чистия URL.
const LEGACY_FROM_SEARCH_CONSOLE = {
  "/index.html": "/",
  "/gtp/proverka.html": "/gtp/proverka",
  "/gtp/proverka/": "/gtp/proverka",
  "/gtp/cena.html": "/gtp/cena",
  "/grazhdanska-otgovornost/proverka.html": "/grazhdanska-otgovornost/proverka",
  "/kontakti.html": "/kontakti",
  "/statistika.html": "/statistika",
  "/vinetka/ceni.html": "/vinetka/ceni",
  "/vinetka/ceni/godishna.html": "/vinetka/ceni/godishna",
  "/vinetka/ceni/uikend.html": "/vinetka/ceni/uikend",
  "/vinetka/proverka.html": "/vinetka/proverka",
  "/statii/bgtoll-kakvo-e-kak-raboti.html": "/statii/bgtoll-kakvo-e-kak-raboti",
  "/statii/globa-za-lipsvashta-vinetka.html": "/statii/globa-za-lipsvashta-vinetka",
  "/statii/grazhdanska-otgovornost-ceni-2026.html": "/statii/grazhdanska-otgovornost-ceni-2026",
  "/statii/grazhdanska-otgovornost-za-motor.html": "/statii/grazhdanska-otgovornost-za-motor",
  "/statii/iztekla-grazhdanska-otgovornost.html": "/statii/iztekla-grazhdanska-otgovornost",
  "/statii/kupih-vinetka-no-ne-se-pokazva.html": "/statii/kupih-vinetka-no-ne-se-pokazva",
  "/statii/otpadna-li-stikerat-go.html": "/statii/otpadna-li-stikerat-go",
  "/statii/prehvarlya-li-se-vinetkata.html": "/statii/prehvarlya-li-se-vinetkata",
};

function parseRedirects(text) {
  const rules = [];
  let dynamicSeen = false;
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const tokens = line.replace(/\s+#.*$/, "").split(/\s+/);
    assert.ok(tokens.length === 2 || tokens.length === 3, `ред ${i + 1}: 2 или 3 полета`);
    const [from, to, status = "302"] = tokens;
    const isDynamic = /\*|:[A-Za-z]\w*/.test(from);
    if (isDynamic) dynamicSeen = true;
    rules.push({ from, to, status: Number(status), line: i + 1, static: !isDynamic && !dynamicSeen, isDynamic });
  });
  return rules;
}

function toRegExp(from) {
  const esc = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  let re = from.split("*").map(esc).join("(?<splat>.*)");
  re = re.replace(/:([A-Za-z]\w*)/g, "(?<$1>[^/]+)");
  return new RegExp(`^${re}$`);
}

function matchRedirect(rules, pathname) {
  const staticHit = rules.find((r) => r.static && r.from === pathname);
  if (staticHit) return { status: staticHit.status, to: staticHit.to, rule: staticHit };
  for (const r of rules.filter((r) => !r.static)) {
    const m = toRegExp(r.from).exec(pathname);
    if (m) {
      let to = r.to;
      for (const [k, v] of Object.entries(m.groups ?? {})) to = to.replaceAll(`:${k}`, v);
      return { status: r.status, to: to.replace(/\/+/g, "/"), rule: r };
    }
  }
  return null;
}

/** Каноничните пътища на страниците от build-а: gtp/proverka.html -> /gtp/proverka */
function builtPages() {
  const sitemap = readFileSync(new URL("sitemap-0.xml", client), "utf8");
  return [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
}

const pageExists = (path) =>
  ON_DEMAND_PAGES.includes(path) ||
  existsSync(fileURLToPath(new URL(path === "/" ? "index.html" : `.${path}.html`, client)));

/** Следва пренасочванията до краен път; хвърля при цикъл */
function follow(rules, start) {
  const hops = [];
  let path = start;
  for (let i = 0; i < 5; i++) {
    const hit = matchRedirect(rules, path);
    if (!hit) return { final: path, hops };
    hops.push({ from: path, to: hit.to, status: hit.status });
    assert.notEqual(hit.to, path, `${path} пренасочва към себе си`);
    path = hit.to;
  }
  assert.fail(`цикъл от пренасочвания: ${JSON.stringify(hops)}`);
}

const built = existsSync(new URL("sitemap-0.xml", client));
const rules = parseRedirects(readFileSync(new URL("public/_redirects", root), "utf8"));

test("_redirects: само 301, статичните правила са преди динамичните", () => {
  assert.ok(rules.length > 0);
  for (const r of rules) {
    assert.equal(r.status, 301, `ред ${r.line}: ${r.from} трябва да е 301`);
    assert.ok(r.to.startsWith("/"), `ред ${r.line}: относителна цел`);
    if (!r.isDynamic) assert.ok(r.static, `ред ${r.line}: статично правило след динамично се брои за динамично`);
  }
  const froms = rules.map((r) => r.from);
  assert.equal(new Set(froms).size, froms.length, "дублирани правила");
});

test("всеки стар URL от Search Console -> 301 към каноничния, с едно пренасочване", { skip: !built && "няма build" }, () => {
  for (const [legacy, canonical] of Object.entries(LEGACY_FROM_SEARCH_CONSOLE)) {
    const { final, hops } = follow(rules, legacy);
    assert.equal(hops.length, 1, `${legacy}: очаквано 1 пренасочване, има ${hops.length}`);
    assert.equal(hops[0].status, 301);
    assert.equal(final, canonical, `${legacy} -> ${final}, очаквано ${canonical}`);
    assert.ok(pageExists(canonical), `${canonical} няма страница в build-а`);
  }
});

test("каноничните URL-и (sitemap) не се пренасочват — никое правило не засенчва страница", { skip: !built && "няма build" }, () => {
  const pages = builtPages();
  assert.ok(pages.length > 20);
  for (const path of pages) {
    assert.equal(matchRedirect(rules, path), null, `${path} се пренасочва, а е каноничен`);
    assert.ok(pageExists(path), `${path} е в sitemap, но няма файл`);
  }
});

test("всеки вариант на всяка страница (.html, /, .html/) стига до каноничния без цикъл", { skip: !built && "няма build" }, () => {
  for (const path of builtPages()) {
    const variants = path === "/" ? ["/index.html", "/index"] : [`${path}.html`, `${path}/`, `${path}.html/`];
    for (const v of variants) {
      const { final, hops } = follow(rules, v);
      assert.equal(final, path, `${v} -> ${final}`);
      assert.ok(hops.length <= 2, `${v}: ${hops.length} пренасочвания`);
      assert.ok(hops.every((h) => h.status === 301));
    }
  }
});

test("worker маршрутите (/api/*) не се пренасочват в каноничната си форма", () => {
  const routes = [
    "/api/check/vignette",
    "/api/gtp/captcha",
    "/api/gtp/check",
    "/api/reminders",
    "/api/reminders/challenge",
    "/napomnyane/potvarzhdenie",
    "/napomnyane/otpisvane",
    "/napomnyane/iztrivane",
    ...ON_DEMAND_PAGES,
  ];
  for (const path of routes) {
    assert.equal(matchRedirect(rules, path), null, path);
  }
});
