// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import cloudflare from "@astrojs/cloudflare";
import node from "@astrojs/node";

// Единственото място, където живее каноничният домейн.
// При смяна на домейна се променя само тук.
export const SITE_URL = "https://moiatakola.bg";

// Продукционната цел е Cloudflare (Workers за проксиране на проверките,
// edge кеш, ниска латентност в ЕС). Локално/CI се ползва Node адаптерът,
// защото workerd изисква достъп до мрежата на Cloudflare по време на build.
const isCloudflare = process.env.DEPLOY_TARGET === "cloudflare";

export default defineConfig({
  site: SITE_URL,
  output: "static",
  adapter: isCloudflare ? cloudflare() : node({ mode: "standalone" }),
  trailingSlash: "never",
  integrations: [
    sitemap({
      filter: (page) => !page.includes("/api/"),
    }),
  ],
});
