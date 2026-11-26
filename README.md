# По номер — ponomer.com

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
npm test           # тестове: SEO и пренасочвания върху dist/ (след build), напомняния върху локална D1
npm run check:worker   # маршрутите на worker-а срещу работещ `npx wrangler dev`
```

## Деплой на Cloudflare Workers

Конфигурацията е в `wrangler.jsonc` (адаптерът на Astro я допълва при build с assets
binding-а; входната точка е `src/worker.ts` — Astro плюс cron handler-а за напомнянията). В Cloudflare → Workers → *Create* → свържете GitHub репото и задайте:

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

### Статистика на проверките (Workers Analytics Engine)

Два слоя с различни архитектури — само вторият докосва Worker-а:

1. **МВР данни** (възраст на автопарка, марки, горива) — изцяло build-time
   и вече реализиран: месечният zip от data.egov.bg стои в `data/mvr-raw/`
   (ГГГГ-ММ.zip), `npm run stats:build` го нормализира до компактни JSON-и
   в `src/data/statistika/`, а страницата `/statistika` се рендерира от тях
   при build. Суровите CSV-та не влизат в bundle-а. Месечният workflow
   `.github/workflows/statistika.yml` опитва автоматично сваляне (URL в
   repo variable `MVR_STATS_URL`) и отваря PR; при блокиран достъп отваря
   issue за 2-минутната ръчна стъпка. Бележка: файлове 12–21 от архива
   броят всички издадени СРМПС (вкл. препродажби) — не ги ползваме.
   Този слой нарочно НЕ влиза в runtime.
2. **Собствени данни от проверките** — Worker-ът пише по един fire-and-forget
   ред след всяка завършена проверка в Analytics Engine (binding `CHECK_STATS`,
   dataset `check_stats`): вид, изход (valid/invalid/expiring/upstream-error),
   държава. Ден идва от timestamp-а на AE. **Не се записват номера, hash-ове,
   IP или каквото и да е per-vehicle** — виж `src/lib/checks/stats.ts`.
   `upstream-error` дублира като мониторинг на отказите на официалните системи.

Заявки към данните: SQL през Analytics Engine API (месечният Action агрегира и
комитва JSON до МВР файловете, двата слоя минават през един build pipeline).
При публикуване на проценти от проверките: видима бележка, че извадката е
самоселектирана („данните са от доброволни проверки в сайта и не са
представителна извадка“).

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

### Напомняния по имейл и „За фирми“ (изключени, докато не се настроят)

След валиден резултат (винетка, ГТП, ГО) сайтът може да предложи „Напомнете ми по имейл,
преди да изтече“: имейл + съгласие, писмо с връзка за потвърждение (double opt-in), после
напомняне 14 и 3 дни преди датата (за кратки винетки — едно, в деня преди). Страницата
`/za-firmi` събира интерес към планирана услуга за автопаркове.

**Без настройка нищо от това не е активно** и сайтът работи както досега: офертата не се
показва, `/api/reminders*` и `/napomnyane/*` отговарят с 404, `/za-firmi` показва само
описанието. Клонът може да се слее преди стъпките по-долу.

Настройка — по ред:

1. **Създайте D1 базата** (с данни само в ЕС) и копирайте върнатото `database_id`:
   ```sh
   npx wrangler d1 create ponomer --jurisdiction=eu
   ```
2. **Впишете я в `wrangler.jsonc`**: разкоментирайте `d1_databases` и сложете реалното `database_id`.
3. **Приложете миграцията** (`migrations/0001_reminders.sql`):
   ```sh
   npx wrangler d1 migrations apply ponomer --remote
   ```
   От тук нататък формата на `/za-firmi` работи (иска само D1).
4. **Включете Cloudflare Email Sending за ponomer.com**: Dashboard → *Email Service* → *Email Sending* →
   добавете домейна и DNS записите, които Cloudflare предлага (SPF/DKIM), и изчакайте да се
   потвърдят. Подателят е `no-reply@ponomer.com`; отговорите отиват на `SITE.email`
   (`src/lib/site.ts`).
5. **Разкоментирайте останалото в `wrangler.jsonc`**: `send_email` (binding `EMAIL`), `vars`
   (`EMAIL_FROM`) и `triggers` (cron).
6. **Деплой**: `npm run build:cloudflare && npx wrangler deploy` (или push, ако деплоят е през Workers Builds).
7. **Проверка**: направете проверка на винетка с валиден резултат → под него е офертата → поискайте
   напомняне на свой адрес → отворете връзката от писмото. `npx wrangler tail` показва ред
   `[reminders] {...}` при всяко пускане на cron-а.

Какво е добре да знаете:

- **Cron.** `17 5-8 * * *` пуска задачата четири пъти всяка сутрин (UTC). Едно пускане праща до
  12 писма — толкова се побират в лимита от 50 заявки на извикване в безплатния план на Workers;
  изпратеното се отбелязва и не се повтаря, останалите тръгват при следващото пускане. На платен
  план вдигнете лимита с `"REMINDERS_PER_RUN": "200"` във `vars`. Същата задача трие
  непотвърдените заявки (след 48 часа), напомнянията (30 дни след датата) и старите записи.
- **Сайтът не проверява регистрите вместо потребителя.** Писмото казва какво е показала
  неговата проверка и на коя дата, и води към нова проверка. Captcha-та на ИААА не се заобикаля.
- **Какво се пази** (`migrations/0001_reminders.sql`): имейл, номер, вид, дата на изтичане, ден на
  проверката, потвърждение и кои писма са пратени. Токените от писмата са само като SHA-256 хеш.
  IP адреси не се пазят — за ограничението на честотата има HMAC отпечатъци, които се трият.
  Обещанията към потребителя са в `src/pages/poveritelnost.astro` — при промяна на кода ги дръжте верни.
- **Защита на формата**: ALTCHA proof-of-work (`src/lib/reminders/crypto.ts`; ключът за подписите се
  създава сам в таблица `app_secrets`), лимит по IP и по имейл в D1 и лимитът в паметта от
  `rate-limit.ts`. Добра идея е WAF правилото по-горе да покрива и `/api/reminders`.
- **Локално**: `npm run build:cloudflare`, после с разкоментирани binding-и
  `npx wrangler d1 migrations apply ponomer --local && npx wrangler dev`. Писмата не се изпращат —
  wrangler ги записва във файлове и показва пътя им в конзолата. `npm run check:worker`
  проверява маршрутите и в двете състояния.

### Реклама и съгласие

Банерът за съгласие (`ConsentBanner.astro`) се монтира на всяка страница; изборът се пази в
localStorage `cookie-consent`. Google Analytics (gtag в `Base.astro`) се зарежда само при
стойност `granted` и слуша събитието `cookie-consent-change` за късно съгласие. Бъдещият
рекламен loader (`ADS_ENABLED` в `src/lib/site.ts`, по подразбиране `false`) трябва да следва
същия модел. Инструменталните страници остават без реклама и при включен флаг.

## Архитектура

| Път | Какво е |
|---|---|
| `src/lib/site.ts` | Бранд, домейн, официални източници, навигация |
| `src/data/vignette-prices.ts` | **Единственият източник на истина за цените** — обновява се само тук |
| `src/lib/checks/` | Адаптери за проверките (винетка / ГО / ГТП) с общ интерфейс `CheckResult` |
| `src/pages/api/check/[kind].ts` | API маршрут, който клиентският widget вика |
| `src/lib/reminders/` | Напомняния по имейл: дати и график, D1, писма, ALTCHA, cron, запитвания от фирми |
| `src/data/renew-links.ts` | Връзката „поднови“ за всеки вид срок — и единственото място за партньорски URL |
| `src/worker.ts` | Входна точка на Worker-а: Astro + cron handler-ът за напомнянията |
| `migrations/` | Схемата на D1 базата |
| `src/components/PlateCheck.astro` | Подписният елемент — входът като регистрационна табела |
| `src/content/statii/` | Статиите (Markdown + FAQ в frontmatter → FAQPage schema) |

### Статус на интеграциите (верифициран 11.06.2026 с реални browser traces)

- **Винетка (БГ ТОЛ): ✅ работи на продукция.**
  `GET https://check.bgtoll.bg/check/vignette/plate/BG/{номер}` (номер без интервали също се приема).
  2-минутен кеш, fallback с поле `reason` за диагностика. Бележка: check.bgtoll.bg връща 403
  на datacenter/non-browser клиенти извън БГ, но fetch от Cloudflare Workers минава.
- **ГТП (ИААА): captcha.** Endpoint: `POST rta.government.bg/services/check-inspection/checkinsp.php`
  с полета `regNum` + `captcha` → програмна интеграция блокирана (captcha не се заобикаля).
  Стратегия: guided deep-link + автоматично копиране на номера в клипборда.
  Път напред: официално искане за достъп към ИААА или партньор с данни.
- **ГО (Гаранционен фонд): captcha** (графичен код за сигурност в eisoukr.guaranteefund.org).
  Същата guided deep-link стратегия. Път напред: брокерско партньорство (Boleron/SDI/insurance.bg
  имат легален ЕИСОУКР достъп) — естествено върви заедно с ГО affiliate сделката от плана.
- **Глоби (КАТ):** изискват ЕГН + документ → нарочно guide-страница без вход за данни (`/globi/proverka`).

### SEO/GEO

- Хъб-и-спици: инструментите са хъбове, статиите фунелират към тях
- Schema: `WebSite` навсякъде, `WebApplication` на инструментите, `Article`+`FAQPage` на статиите,
  `BreadcrumbList` сайтуайд, `Product` на ценовите подстраници
- `sitemap-index.xml` (автоматичен) + `robots.txt`; канонични URL-и без trailing slash
  и без `.html`; началото е `https://ponomer.com/` (canonical, og:url, sitemap и schema)
- Цените в заглавията идват от `src/data/vignette-prices.ts` и `src/data/gtp-prices.ts`
- Директен отговор в първите две изречения на всяка статия + FAQ блок — GEO-friendly формат
- Цените са в EUR (основно) и BGN с видим „последна проверка на данните“ timestamp

#### Пренасочвания

`public/_redirects` прави `/път.html`, `/път/` и `/index.html` → 301 към каноничния URL.
Без него статичните assets на Cloudflare пренасочват със 307 (временно) и Google
държи старите адреси в индекса. `tests/redirects.test.mjs` проверява всеки стар URL
от Search Console, че каноничните не се пренасочват и че няма цикли. На живо:
`npm run build:cloudflare && npx wrangler dev`, после `curl -I localhost:8787/gtp/proverka.html`.

### Смяна на домейна

Едно място: `SITE_URL` в `astro.config.mjs` и `SITE` в `src/lib/site.ts` (+ `public/robots.txt`).

### Монетизация (когато дойде моментът)

- Партньорските линкове за „купи винетка“ се добавят в `channels` на `src/pages/vinetka/kupi.astro`
  (с `rel="sponsored"`)
- Връзката под изтичащ/липсващ срок и в писмата за напомняне идва от `src/data/renew-links.ts`:
  попълнете `partnerUrl` и `partnerName` за съответния вид. Тогава връзката става
  `rel="sponsored"`, а до нея — и в картата с резултата, и в писмото — излиза разкритието
  „Връзката е партньорска: …“. Празни полета = връзка към страница на сайта, без разкритие
- Инструменталните страници остават чисти от реклама — скорост и доверие първо
