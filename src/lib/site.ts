export const SITE = {
  name: "По номер",
  domain: "ponomer.com",
  url: "https://ponomer.com",
  tagline:
    "Провери колата си за 10 секунди — винетка, глоби, ГТП и Гражданска отговорност на едно място.",
  description:
    "Безплатна проверка на винетка, Гражданска отговорност и ГТП по регистрационен номер. Актуални цени на винетки в евро и лева. Неофициален инструмент с данни от официалните системи.",
  locale: "bg_BG",
  email: "kontakt@ponomer.com",
} as const;

/**
 * Включва рекламните места (Adsterra) — виж components/AdSlot.astro.
 * Рекламата се зарежда само при съгласие "granted" от банера за бисквитки
 * (localStorage ключ "cookie-consent") — виж ConsentBanner.astro.
 */
export const ADS_ENABLED = true;

export const OFFICIAL_SOURCES = {
  bgtoll: {
    name: "БГ ТОЛ (Национално тол управление)",
    checkUrl: "https://check.bgtoll.bg",
    buyUrl: "https://www.bgtoll.bg",
  },
  guaranteeFund: {
    name: "Гаранционен фонд",
    /**
     * Нарочно сочи корена: дълбокият URL на справката съдържа смесени
     * латински/кирилски символи и е чуплив. Функционалният endpoint за
     * автоматичната проверка живее отделно в lib/checks/insurance.ts.
     */
    checkUrl: "https://www.guaranteefund.org/bg",
  },
  rta: {
    name: "ИА „Автомобилна администрация“ (ИААА)",
    checkUrl: "https://rta.government.bg",
  },
  mvr: {
    name: "МВР — електронни услуги",
    checkUrl: "https://e-uslugi.mvr.bg",
  },
} as const;

export const NAV_LINKS = [
  { href: "/vinetka/proverka", label: "Винетка" },
  { href: "/grazhdanska-otgovornost/proverka", label: "Гражданска" },
  { href: "/gtp/proverka", label: "ГТП" },
  { href: "/globi/proverka", label: "Глоби" },
  { href: "/vinetka/ceni", label: "Цени" },
  { href: "/statistika", label: "Статистика" },
  { href: "/statii", label: "Статии" },
] as const;

/**
 * Публичният път на страницата от Astro.url.pathname. С build.format "file"
 * при build пътят идва като "/gtp/proverka.html" (и "/index.html" за началото),
 * а Cloudflare сервира и индексира "/gtp/proverka" — canonical, og:url и
 * активният линк в менюто трябва да ползват него.
 */
export function cleanPath(pathname: string): string {
  return pathname.replace(/\.html$/, "").replace(/(^|\/)index$/, "").replace(/\/$/, "") || "/";
}
