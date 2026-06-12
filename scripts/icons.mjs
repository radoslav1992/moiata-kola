/**
 * Еднократно генериране на PWA иконите от public/favicon.svg.
 * Пуска се ръчно при промяна на логото: node scripts/icons.mjs
 *
 * Прави квадратни PNG-та върху плътен фон (табелата е широка, затова
 * се центрира с поле). За maskable вариантите полето е по-голямо —
 * безопасната зона на Android е централните ~80%.
 */
import { readFileSync, writeFileSync } from "node:fs";

const { default: sharp } = await import("sharp");
const svg = readFileSync("public/favicon.svg");
const BG = "#f7f9fb";

async function icon(size, plateWidth, out) {
  const plate = await sharp(svg).resize({ width: plateWidth }).png().toBuffer();
  const png = await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: plate, gravity: "centre" }])
    .png()
    .toBuffer();
  writeFileSync(`public/${out}`, png);
  console.log(`✓ public/${out} (${size}×${size})`);
}

await icon(180, 150, "apple-touch-icon.png");
await icon(192, 160, "icon-192.png");
await icon(512, 430, "icon-512.png");
// maskable: табелата в безопасната централна зона (~78% от ширината)
await icon(192, 140, "icon-192-maskable.png");
await icon(512, 380, "icon-512-maskable.png");
