/**
 * Ориентировъчната цена на годишния технически преглед (ГТП) за лек автомобил.
 * Държавата не фиксира цена — всеки пункт определя своята; това е диапазонът,
 * който сайтът цитира. Заглавието, описанието, картата с цената и FAQ на
 * /gtp/cena, както и текстът на /gtp/proverka четат оттук — при промяна се
 * обновява само този файл.
 */
import { BGN_PER_EUR } from "./vignette-prices.ts";

export const GTP_PRICE_YEAR = 2026;
export const GTP_PRICE_MIN_EUR = 30;
export const GTP_PRICE_MAX_EUR = 60;

/** Левовата равностойност, закръглена до 10 лв. — диапазонът е ориентировъчен */
const toBgnRounded = (eur: number) => Math.round((eur * BGN_PER_EUR) / 10) * 10;

export const GTP_PRICE_MIN_BGN = toBgnRounded(GTP_PRICE_MIN_EUR);
export const GTP_PRICE_MAX_BGN = toBgnRounded(GTP_PRICE_MAX_EUR);

/** "30–60 €" */
export const GTP_PRICE_RANGE_EUR = `${GTP_PRICE_MIN_EUR}–${GTP_PRICE_MAX_EUR} €`;
/** "60–120 лв." */
export const GTP_PRICE_RANGE_BGN = `${GTP_PRICE_MIN_BGN}–${GTP_PRICE_MAX_BGN} лв.`;
