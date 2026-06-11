// @ts-check
import { defineConfig, sessionDrivers } from "astro/config";
import sitemap from "@astrojs/sitemap";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";

// Единственото място, където живее каноничният домейн.
// При смяна на домейна се променя само тук.
export const SITE_URL = "https://moiatakola.bg";

// Продукционната цел е Cloudflare (Workers за проксиране на проверките,
// edge кеш, ниска латентност в ЕС). Адаптерът се избира автоматично:
// в Workers Builds (WORKERS_CI) / Pages (CF_PAGES) или с DEPLOY_TARGET=cloudflare
// се билдва worker; навсякъде другаде — Node.
const isCloudflare =
  process.env.DEPLOY_TARGET === "cloudflare" ||
  process.env.WORKERS_CI === "1" ||
  !!process.env.CF_PAGES;

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
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/api/"),
    }),
  ],
});
