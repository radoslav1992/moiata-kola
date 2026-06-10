/**
 * Единственият източник на истина за цените на винетки (леки автомобили до 3,5 т).
 * Цените са официалните от БГ ТОЛ; при промяна се обновява само този файл
 * и датата по-долу, а всички страници и schema се обновяват сами.
 */
export const PRICES_UPDATED = "2026-06-01";
export const PRICES_UPDATED_HUMAN = "1 юни 2026 г.";

export const BGN_PER_EUR = 1.95583;

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
    slug: "uikend",
    name: "Уикенд",
    fullName: "Уикенд винетка",
    priceEur: 5.11,
    priceBgn: 10,
    validity: "от 12:00 ч. в петък до 23:59 ч. в неделя",
    bestFor: "еднократно пътуване през уикенда",
  },
  {
    slug: "sedmichna",
    name: "Седмична",
    fullName: "Седмична винетка",
    priceEur: 7.67,
    priceBgn: 15,
    validity: "7 календарни дни",
    bestFor: "отпуска или командировка до седмица",
  },
  {
    slug: "mesechna",
    name: "Месечна",
    fullName: "Месечна винетка",
    priceEur: 15.34,
    priceBgn: 30,
    validity: "1 месец",
    bestFor: "по-дълъг престой или сезонна работа",
  },
  {
    slug: "trimesechna",
    name: "Тримесечна",
    fullName: "Тримесечна винетка",
    priceEur: 27.61,
    priceBgn: 54,
    validity: "3 месеца",
    bestFor: "редовно шофиране през един сезон",
  },
  {
    slug: "godishna",
    name: "Годишна",
    fullName: "Годишна винетка",
    priceEur: 49.6,
    priceBgn: 97,
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
