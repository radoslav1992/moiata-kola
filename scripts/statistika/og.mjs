/**
 * Генерира public/og-statistika.png — OG картата на /statistika.
 * Чете актуалните числа от src/data/statistika/, така че картата се
 * обновява заедно с данните (вика се от `npm run stats:build`).
 *
 * Ползва sharp (наличен като зависимост на Astro) и системния шрифт
 * DejaVu Sans (поддържа кирилица; наличен локално и на GitHub runners).
 */
import { readFileSync, writeFileSync } from "node:fs";

const age = JSON.parse(readFileSync("src/data/statistika/age.json", "utf8"));
const meta = JSON.parse(readFileSync("src/data/statistika/meta.json", "utf8"));

const MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
const [year, monthNum] = meta.month.split("-");
const monthLabel = `${MONTHS[Number(monthNum) - 1]} ${year}`;

const share = Math.round(age.national.over15Share);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#f7f9fb"/>
  <text x="600" y="295" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="230" fill="#003d99">${share}%</text>
  <text x="600" y="395" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="38" fill="#101a28">от колите в България са по-стари от 15 години</text>
  <text x="600" y="500" text-anchor="middle" font-family="DejaVu Sans" font-size="28" fill="#7b8a9e">Автомобилна статистика · данни от МВР, ${monthLabel}</text>
  <text x="600" y="560" text-anchor="middle" font-family="DejaVu Sans" font-weight="bold" font-size="30" fill="#003d99">ponomer.com/statistika</text>
</svg>`;

try {
  const { default: sharp } = await import("sharp");
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync("public/og-statistika.png", png);
  console.log(`✓ public/og-statistika.png (${share}% headline, ${monthLabel})`);
} catch (err) {
  console.warn(`⚠ og-statistika.png не е обновен (sharp недостъпен?): ${err.message}`);
}
