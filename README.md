# Моята кола — moiatakola.bg

Един сайт, в който всеки български шофьор проверява всичко за колата си —
**винетка, глоби, ГТП и Гражданска отговорност** — по регистрационен номер, за секунди.

## Стек

- **Astro 6** — статични страници + on-demand API маршрути 
- **Tailwind CSS 4** (PostCSS плъгин) — дизайн системата живее в `src/styles/global.css`
- **Шрифтове:** Inter (целият сайт) + Oswald (само табелата и големите статусни числа)
- **Продукционна цел: Cloudflare Workers** (виж „Деплой“ по-долу)

## Команди

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # производствен build в dist/
node dist/server/entry.mjs   # стартиране на Node build-а
npm run check      # astro check (типове)
```

## Деплой на Cloudflare Workers

Конфигурацията е в `wrangler.jsonc` (адаптерът на Astro я допълва при build с worker
entry и assets binding). В Cloudflare → Workers → *Create* → свържете GitHub репото и задайте:

| Настройка | Стойност |
|---|---|
| Build command | `npm run build:cloudflare` (или `npm run build` — в Workers Builds адаптерът се познава автоматично по `WORKERS_CI`) |
| Deploy command | `npx wrangler deploy` |

Как работи: build-ът с Cloudflare адаптера записва `.wrangler/deploy/config.json`,
който сочи към генерирания пълен wrangler конфиг в `dist/` — и `wrangler deploy` /
`wrangler versions upload` го следват автоматично. Грешките „Missing entry-point“ или
„entry-point @astrojs/cloudflare/entrypoints/server was not found“ значат едно и също:
деплой стъпката е тръгнала след build за Node адаптера (без worker output).

Локален деплой от машина: `npm run build:cloudflare && npx wrangler deploy`.

Бележки:
- Сесии не се ползват (`session: null` драйвер) → не е нужен SESSION KV namespace;
- `imageService: "compile"` → не е нужен IMAGES binding;
- Cloudflare build-ът изисква изходяща мрежа (workerd тегли конфигурация от Cloudflare),
  затова в офлайн среди се ползва `npm run build` (Node адаптер).

### KV кеш на проверките (препоръчително в продукция)

Без binding кешът е in-memory (per-isolate — почти безполезен на Workers). За истински кеш:

```sh
npx wrangler kv namespace create CHECK_CACHE
```

и разкоментирайте `kv_namespaces` в `wrangler.jsonc` с върнатото id. Кодът го засича сам
(`src/lib/checks/cache.ts`); кешират се само успешни резултати, TTL 120 s.

### Rate limit на /api/check/*

Два слоя:

1. **В кода** (`src/lib/checks/rate-limit.ts`): 30 заявки/мин на IP, връща 429.
   На Workers това е per-isolate → защита в дълбочина, не основната линия.
2. **Cloudflare WAF** (основната линия) — изисква сайтът да е на ваш домейн в зоната:
   Dashboard → домейнът → **Security → WAF → Rate limiting rules → Create rule**:
   - Expression: `(starts_with(http.request.uri.path, "/api/check/"))`
   - Characteristics: IP адрес
   - Rate: напр. 20 заявки / 10 секунди → Action: **Block** за 1 минута
   На Free плана имате 1 rate limiting правило — това е правилното място за него.

### Реклама и съгласие

`ADS_ENABLED` в `src/lib/site.ts` (по подразбиране `false`). При включване Base монтира
банера за съгласие (`ConsentBanner.astro`); изборът се пази в localStorage `ad-consent`,
а рекламният loader трябва да зарежда само при стойност `granted` (и да слуша събитието
`ad-consent-change`). Инструменталните страници остават без реклама и при включен флаг.

## Архитектура

| Път | Какво е |
|---|---|
| `src/lib/site.ts` | Бранд, домейн, официални източници, навигация |
| `src/data/vignette-prices.ts` | **Единственият източник на истина за цените** — обновява се само тук |
| `src/lib/checks/` | Адаптери за проверките (винетка / ГО / ГТП) с общ интерфейс `CheckResult` |
| `src/pages/api/check/[kind].ts` | API маршрут, който клиентският widget вика |
| `src/components/PlateCheck.astro` | Подписният елемент — входът като регистрационна табела |
| `src/content/statii/` | Статиите (Markdown + FAQ в frontmatter → FAQPage schema) |

### Статус на интеграциите

- **Винетка (БГ ТОЛ):** реална интеграция срещу публичния endpoint на check.bgtoll.bg,
  с 2-минутен кеш и автоматичен fallback към насочен линк при недостъпност.
  *Първа задача преди launch: верифицирайте endpoint-а от реална мрежа (тази среда няма изходяща връзка).*
- **ГО (Гаранционен фонд)** и **ГТП (ИААА):** официалните справки са зад captcha → стратегия
  „guided deep-link“ (точни стъпки + дълбок линк). Адаптерите имат същия интерфейс,
  така че реална интеграция е drop-in промяна само в `src/lib/checks/`.
- **Глоби (КАТ):** изискват ЕГН + документ → нарочно guide-страница без вход за данни (`/globi/proverka`).

### SEO/GEO

- Хъб-и-спици: инструментите са хъбове, статиите фунелират към тях
- Schema: `WebSite` навсякъде, `WebApplication` на инструментите, `Article`+`FAQPage` на статиите,
  `BreadcrumbList` сайтуайд, `Product` на ценовите подстраници
- `sitemap-index.xml` (автоматичен) + `robots.txt`; канонични URL-и без trailing slash
- Директен отговор в първите две изречения на всяка статия + FAQ блок — GEO-friendly формат
- Цените са в EUR (основно) и BGN с видим „последна проверка на данните“ timestamp

### Смяна на домейна

Едно място: `SITE_URL` в `astro.config.mjs` и `SITE` в `src/lib/site.ts` (+ `public/robots.txt`).

### Монетизация (когато дойде моментът)

- Партньорските линкове за „купи винетка“ се добавят в `channels` на `src/pages/vinetka/kupi.astro`
  и в `INVALID_CTA` на `PlateCheck.astro` (с `rel="sponsored"`)
- Инструменталните страници остават чисти от реклама — скорост и доверие първо
