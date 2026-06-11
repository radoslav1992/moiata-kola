export const SITE = {
  name: "По номер",
  domain: "moiatakola.bg",
  url: "https://moiatakola.bg",
  tagline:
    "Провери колата си за 10 секунди — винетка, глоби, ГТП и Гражданска отговорност на едно място.",
  description:
    "Безплатна проверка на винетка, Гражданска отговорност и ГТП по регистрационен номер. Актуални цени на винетки в евро и лева. Неофициален инструмент с данни от официалните системи.",
  locale: "bg_BG",
  email: "kontakt@moiatakola.bg",
} as const;

/**
 * Превключва се на true заедно с първия рекламен скрипт (AdSense).
 * Дотогава сайтът не ползва рекламни бисквитки и банерът за съгласие
 * не се показва (GDPR не изисква банер без такива бисквитки).
 */
export const ADS_ENABLED = false;

export const OFFICIAL_SOURCES = {
  bgtoll: {
    name: "БГ ТОЛ (Национално тол управление)",
    checkUrl: "https://check.bgtoll.bg",
    buyUrl: "https://www.bgtoll.bg",
  },
  guaranteeFund: {
    name: "Гаранционен фонд",
    checkUrl:
      "https://www.guaranteefund.org/bg/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D0%BE%D0%BD%D0%B5%D0%BD-%D1%86%D0%B5%D0%BD%D1%82%D1%8A%D1%80-%D0%B8-%D1%81%D0%BF%D1%80%D0%B0%D0%B2%D0%BA%D0%B8/%D1%83%D1%81%D0%BB%D1%83%D0%B3%D0%B8/%D0%BF%D1%80%D0%BE%D0%B2%D0%B5%D1%80%D0%BA%D0%B0-%D0%B7%D0%B0-%D0%B2%D0%B0%D0%BB%D0%B8%D0%B4%D0%BD%D0%B0-%D0%B7%D0%B0%D1%81%D1%82%D1%80%D0%B0%D1%85%D0%BE%D0%B2%D0%BA%D0%B0-%D0%B3%D1%80a%D0%B6%D0%B4a%D0%BD%D1%81%D0%BAa-%D0%BE%D1%82%D0%B3%D0%BE%D0%B2%D0%BE%D1%80%D0%BD%D0%BE%D1%81%D1%82-%D0%BD%D0%B0-%D0%B0%D0%B2%D1%82%D0%BE%D0%BC%D0%BE%D0%B1%D0%B8%D0%BB%D0%B8%D1%81%D1%82%D0%B8%D1%82%D0%B5",
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
  { href: "/statii", label: "Статии" },
] as const;

/** „Действие — онлайн за 10 секунди | Бранд“ за инструменти */
export function toolTitle(action: string): string {
  return `${action} — онлайн за 10 секунди | ${SITE.name}`;
}
