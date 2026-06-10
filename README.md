# Моята кола — moiatakola.bg

Един сайт, в който всеки български шофьор проверява всичко за колата си —
**винетка, глоби, ГТП и Гражданска отговорност** — по регистрационен номер, за секунди.

## Стек

- **Astro 6** — статични страници + on-demand API маршрути
- **Tailwind CSS 4** (PostCSS плъгин) — дизайн системата живее в `src/styles/global.css`
- **Шрифтове:** Inter (целият сайт) + Oswald (само табелата и големите статусни числа)
- **Продукционна цел: Cloudflare** — build с `DEPLOY_TARGET=cloudflare npm run build`
  (локално и в CI се ползва Node адаптерът, защото workerd изисква мрежа на Cloudflare при build)

## Команди

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # производствен build в dist/
node dist/server/entry.mjs   # стартиране на Node build-а
npm run check      # astro check (типове)
```

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
