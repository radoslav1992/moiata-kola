// Индексируеми страници, които worker-ът рендерира при заявка (prerender = false) —
// за тях build-ът не записва .html файл, но са в sitemap-а и към тях има линкове.
// Съдържанието им се проверява от tests/on-demand.test.mjs и scripts/check-worker.mjs.
export const ON_DEMAND_PAGES = ["/za-firmi"];
