/**
 * Единственият източник на истина за цените на винетки (леки автомобили до 3,5 т).
 * Цените са официалните от БГ ТОЛ; при промяна се обновява този файл и датите
 * по-долу — таблиците, калкулаторът, страниците за отделните видове и schema
 * се обновяват сами. Статиите в content/statii и public/llms.txt цитират
 * цените в текста и се обновяват на ръка.
 *
 * Тарифа в сила от 1 август 2026 г. (+30%); еднодневната винетка за леки
 * автомобили съществува от 3 февруари 2026 г.
 */
export const PRICES_UPDATED = "2026-10-14";
export const PRICES_UPDATED_HUMAN = "14 октомври 2026 г.";
export const PRICES_EFFECTIVE_HUMAN = "1 август 2026 г.";

export const BGN_PER_EUR = 1.95583;

/** Левовата равностойност по фиксирания курс, закръглена до стотинка */
const toBgn = (eur: number) => Math.round(eur * BGN_PER_EUR * 100) / 100;

/** Компенсаторна такса за лек автомобил без валидна винетка (плащане в 14-дневен срок) */
export const COMPENSATORY_FEE_EUR = 46.5;

export interface VignettePrice {
  slug: string;
  /** Кратко име за таблици */
  name: string;
  /** Пълно име за заглавия */
  fullName: string;
  priceEur: number;
  priceBgn: number;
  validity: string;
  bestFor: string;
}

export const VIGNETTE_PRICES: VignettePrice[] = [
  {
    slug: "dnevna",
    name: "Еднодневна",
    fullName: "Еднодневна винетка",
    priceEur: 5.3,
    priceBgn: toBgn(5.3),
    validity: "24 часа от избрания начален час",
    bestFor: "еднократно пътуване в рамките на едно денонощие",
  },
  {
    slug: "uikend",
    name: "Уикенд",
    fullName: "Уикенд винетка",
    priceEur: 6.6,
    priceBgn: toBgn(6.6),
    validity: "от 12:00 ч. в петък до 23:59 ч. в неделя",
    bestFor: "пътуване през уикенда",
  },
  {
    slug: "sedmichna",
    name: "Седмична",
    fullName: "Седмична винетка",
    priceEur: 10,
    priceBgn: toBgn(10),
    validity: "7 календарни дни",
    bestFor: "отпуска или командировка до седмица",
  },
  {
    slug: "mesechna",
    name: "Месечна",
    fullName: "Месечна винетка",
    priceEur: 19.9,
    priceBgn: toBgn(19.9),
    validity: "1 месец",
    bestFor: "по-дълъг престой или сезонна работа",
  },
  {
    slug: "trimesechna",
    name: "Тримесечна",
    fullName: "Тримесечна винетка",
    priceEur: 35.9,
    priceBgn: toBgn(35.9),
    validity: "3 месеца",
    bestFor: "редовно шофиране през един сезон",
  },
  {
    slug: "godishna",
    name: "Годишна",
    fullName: "Годишна винетка",
    priceEur: 64.5,
    priceBgn: toBgn(64.5),
    validity: "1 година от избраната начална дата",
    bestFor: "всеки, който кара по републикански пътища целогодишно",
  },
];

export const fmtEur = (v: number) =>
  v.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

export const fmtBgn = (v: number) =>
  v.toLocaleString("bg-BG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " лв.";

export const priceBySlug = (slug: string) =>
  VIGNETTE_PRICES.find((p) => p.slug === slug)!;
