// @ts-check
import { defineConfig, sessionDrivers } from "astro/config";
import sitemap from "@astrojs/sitemap";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";
import { readdir, readFile, writeFile } from "node:fs/promises";

// Единственото място, където живее каноничният домейн.
// При смяна на домейна се променя само тук.
export const SITE_URL = "https://ponomer.com";

// Продукционната цел е Cloudflare (Workers за проксиране на проверките,
// edge кеш, ниска латентност в ЕС). Адаптерът се избира автоматично:
// в Workers Builds (WORKERS_CI) / Pages (CF_PAGES) или с DEPLOY_TARGET=cloudflare
// се билдва worker; навсякъде другаде — Node.
const isCloudflare =
  process.env.DEPLOY_TARGET === "cloudflare" ||
  process.env.WORKERS_CI === "1" ||
  !!process.env.CF_PAGES;

/**
 * С trailingSlash "never" @astrojs/sitemap записва началото като
 * <loc>https://ponomer.com</loc> (премахва "/" след build, serialize не помага).
 * canonical, og:url и schema на началото са "https://ponomer.com/" — sitemap-ът
 * трябва да е същият. Пуска се след sitemap интеграцията.
 */
function homeSitemapSlash() {
  return {
    name: "home-sitemap-slash",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const files = (await readdir(dir)).filter((f) => /^sitemap-\d+\.xml$/.test(f));
        for (const f of files) {
          const file = new URL(f, dir);
          const xml = await readFile(file, "utf8");
          const fixed = xml.replaceAll(`<loc>${SITE_URL}</loc>`, `<loc>${SITE_URL}/</loc>`);
          if (fixed !== xml) {
            await writeFile(file, fixed);
            logger.info(`${f}: началната страница е ${SITE_URL}/`);
          }
        }
      },
    },
  };
}

export default defineConfig({
  site: SITE_URL,
  output: "static",
  adapter: isCloudflare
    ? cloudflare({
        // Не ползваме Astro <Image> с runtime трансформации → без IMAGES binding
        imageService: "compile",
        // Prerender в Node: не изисква workerd/мрежа на Cloudflare при build
        prerenderEnvironment: "node",
      })
    : node({ mode: "standalone" }),
  // Не ползваме сесии → null драйвер, за да не изисква адаптерът SESSION KV namespace
  session: { driver: sessionDrivers.null() },
  trailingSlash: "never",
  // Формите проверяват произхода сами (sameOrigin в src/lib/reminders/api.ts).
  // Вградената проверка на Astro би спряла и еднокликовото отписване, което
  // пощенските услуги пращат като POST без Origin заглавие (RFC 8058).
  security: { checkOrigin: false },
  // gtp/proverka.html вместо gtp/proverka/index.html: статичните assets на
  // Cloudflare (html_handling "auto-trailing-slash") тогава сервират
  // каноничния URL без наклонена черта, а /gtp/proverka/ пренасочват към него.
  // С "directory" беше обратното — и в Google влизаха и двата варианта.
  // Пренасочването на Cloudflare е 307 (временно), затова public/_redirects
  // прави .html и "/" вариантите 301 (tests/redirects.test.mjs).
  build: { format: "file" },
  integrations: [
    sitemap({
      // /napomnyane/* са страници от връзките в писмата (noindex, с токен в адреса)
      filter: (page) => !page.includes("/api/") && !page.includes("/napomnyane/"),
    }),
    homeSitemapSlash(),
  ],
});
