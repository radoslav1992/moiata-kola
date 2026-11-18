// SEO инварианти на build-а (dist/client) — пуска се след `npm run build`.
// Една форма на URL за целия сайт: https://ponomer.com/ за началото, иначе без
// .html и без "/" накрая. canonical, og:url, sitemap, вътрешни линкове и
// schema трябва да ползват само нея.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";

const SITE = "https://ponomer.com";
const clientDir = fileURLToPath(new URL("../dist/client/", import.meta.url));
const built = existsSync(join(clientDir, "sitemap-0.xml"));
const skip = !built && "няма build — пуснете npm run build";

const canonicalFor = (path) => (path === "/" ? `${SITE}/` : `${SITE}${path}`);

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === "_astro" ? [] : htmlFiles(full);
    return e.name.endsWith(".html") ? [full] : [];
  });
}

/** dist/client/gtp/proverka.html -> /gtp/proverka; index.html -> / */
function pathOf(file) {
  const rel = relative(clientDir, file).split(sep).join("/").replace(/\.html$/, "");
  return rel === "index" ? "/" : `/${rel}`;
}

const pages = built
  ? htmlFiles(clientDir).map((file) => {
      const html = readFileSync(file, "utf8");
      const attr = (re) => [...html.matchAll(re)].map((m) => m[1]);
      return {
        path: pathOf(file),
        html,
        title: (html.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? "",
        description: attr(/<meta name="description" content="([^"]*)"/g)[0] ?? "",
        canonicals: attr(/<link rel="canonical" href="([^"]*)"/g),
        ogUrl: attr(/<meta property="og:url" content="([^"]*)"/g),
        noindex: /<meta name="robots" content="[^"]*noindex/.test(html),
      };
    })
  : [];
const indexable = pages.filter((p) => !p.noindex && p.path !== "/404");
const byPath = Object.fromEntries(pages.map((p) => [p.path, p]));

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

/** Пътят е в каноничната форма (без .html, без "/" накрая, без /index) */
function isCanonicalPath(path) {
  if (path === "/") return true;
  return !path.endsWith("/") && !path.endsWith(".html") && !/(^|\/)index$/.test(path);
}

test("всяка индексируема страница: един canonical към себе си, og:url = canonical", { skip }, () => {
  assert.ok(indexable.length > 20);
  for (const p of indexable) {
    assert.deepEqual(p.canonicals, [canonicalFor(p.path)], `${p.path}: canonical`);
    assert.deepEqual(p.ogUrl, [canonicalFor(p.path)], `${p.path}: og:url`);
    assert.ok(p.title.trim().length > 0, `${p.path}: празно <title>`);
  }
});

test("началната страница е https://ponomer.com/ навсякъде", { skip }, () => {
  const home = byPath["/"];
  assert.deepEqual(home.canonicals, [`${SITE}/`]);
  assert.deepEqual(home.ogUrl, [`${SITE}/`]);
  const sitemap = readFileSync(join(clientDir, "sitemap-0.xml"), "utf8");
  assert.ok(sitemap.includes(`<loc>${SITE}/</loc>`), "sitemap: началото е с /");
  assert.ok(!sitemap.includes(`<loc>${SITE}</loc>`), "sitemap: началото без /");
  for (const p of pages) {
    // "url":"https://ponomer.com" (без /) в JSON-LD
    assert.ok(!/"https:\/\/ponomer\.com"/.test(p.html), `${p.path}: URL на началото без "/"`);
  }
});

test("sitemap: точно индексируемите страници, по веднъж, в каноничната форма", { skip }, () => {
  const sitemap = readFileSync(join(clientDir, "sitemap-0.xml"), "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(new Set(locs).size, locs.length, "дублирани URL-и в sitemap");
  for (const loc of locs) assert.ok(isCanonicalPath(new URL(loc).pathname), `не-каноничен URL: ${loc}`);
  assert.deepEqual([...locs].sort(), indexable.map((p) => canonicalFor(p.path)).sort());
  const index = readFileSync(join(clientDir, "sitemap-index.xml"), "utf8");
  assert.ok(index.includes(`<loc>${SITE}/sitemap-0.xml</loc>`));
});

test("вътрешните линкове и абсолютните URL-и сочат само каноничната форма", { skip }, () => {
  const assetExt = /\.(svg|png|jpg|webp|ico|xml|txt|webmanifest|css|js|json|woff2?)$/;
  for (const p of pages) {
    const hrefs = [...p.html.matchAll(/\shref="([^"]*)"/g)].map((m) => decode(m[1]));
    const absolute = [...p.html.matchAll(/https:\/\/ponomer\.com[^"'\s<>)\\]*/g)].map((m) => m[0]);
    for (const raw of [...hrefs, ...absolute]) {
      let url;
      try {
        url = new URL(raw, SITE);
      } catch {
        continue;
      }
      if (url.origin !== SITE || raw.startsWith("#") || raw.startsWith("//")) continue;
      if (url.pathname.startsWith("/_astro/") || assetExt.test(url.pathname)) continue;
      assert.ok(isCanonicalPath(url.pathname), `${p.path}: линк към ${raw}`);
      assert.ok(byPath[url.pathname] || url.pathname.startsWith("/api/"), `${p.path}: линк към несъществуваща страница ${raw}`);
    }
  }
});
