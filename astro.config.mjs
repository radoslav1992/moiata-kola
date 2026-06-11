// @ts-check
import { defineConfig, sessionDrivers } from "astro/config";
import sitemap from "@astrojs/sitemap";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";

// Единственото място, където живее каноничният домейн.
// При смяна на домейна се променя само тук.
export const SITE_URL = "https://moiatakola.bg";

// Продукционната цел е Cloudflare (Workers за проксиране на проверките,
// edge кеш, ниска латентност в ЕС): build с DEPLOY_TARGET=cloudflare.
// Локално/CI без флага се ползва Node адаптерът.
const isCloudflare = process.env.DEPLOY_TARGET === "cloudflare";

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
