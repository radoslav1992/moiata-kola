/**
 * Нормализатор на МВР данните за /statistika.
 *
 * Вход:  data/mvr-raw/<ГГГГ-ММ>.zip — месечният архив от data.egov.bg
 *        (https://data.egov.bg/data/view/2e634036-6ab9-4efd-bd8e-c8e14a931911),
 *        свален ръчно или от GitHub Action-а. Взима се най-новият zip,
 *        освен ако не е подаден изрично: node normalize.mjs data/mvr-raw/2026-06.zip
 * Изход: src/data/statistika/*.json — компактни агрегати, от които
 *        страницата /statistika се рендерира при build. Суровите CSV-та
 *        никога не влизат в bundle-а.
 *
 * Без външни зависимости; разархивира със системния `unzip`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const RAW_DIR = "data/mvr-raw";
const OUT_DIR = "src/data/statistika";

// ---------------------------------------------------------------- вход

const zipPath =
  process.argv[2] ??
  (() => {
    const zips = readdirSync(RAW_DIR).filter((f) => f.endsWith(".zip")).sort();
    if (!zips.length) fail(`няма zip в ${RAW_DIR} — свалете месечния архив от data.egov.bg`);
    return join(RAW_DIR, zips[zips.length - 1]);
  })();

const month = basename(zipPath).replace(".zip", ""); // "2026-06"
if (!/^\d{4}-\d{2}$/.test(month)) fail(`името на архива трябва да е ГГГГ-ММ.zip, не ${basename(zipPath)}`);

const tmp = mkdtempSync(join(tmpdir(), "mvr-"));
execFileSync("unzip", ["-o", "-q", zipPath, "-d", tmp]);

/** Намира CSV по числовия му префикс ("4-..."). */
function csv(prefix) {
  const name = readdirSync(tmp).find((f) => f.startsWith(`${prefix}-`) && f.endsWith(".csv"));
  if (!name) fail(`в архива липсва файл с префикс "${prefix}-"`);
  return parseCsv(readFileSync(join(tmp, name), "utf8"));
}

/** Минимален CSV парсер за формата на МВР (цитирани полета, запетая). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/** Проверка, че колоните са каквито очакваме — при промяна у източника гърми ясно. */
function expectHeader(rows, mustInclude, file) {
  for (const col of mustInclude) {
    if (!rows[0].includes(col)) {
      fail(`${file}: липсва колона "${col}". Реални колони: ${rows[0].join(", ")}`);
    }
  }
}

const num = (v) => Number(v || 0);
const share = (part, total) => Math.round((part / total) * 1000) / 10; // 1 знак, в %

// ------------------------------------------------- файл 1: парк по марка/вид

const f1 = csv(1);
expectHeader(f1, ["МАРКА", "ЛЕК АВТОМОБИЛ", "ОБЩО"], "файл 1");
const f1cars = f1[0].indexOf("ЛЕК АВТОМОБИЛ");
const f1total = f1[0].indexOf("ОБЩО");
const totalRow = f1.find((r) => r[0] === "ОБЩО") ?? fail("файл 1: няма ред ОБЩО");

const fleetTotals = {
  allVehicles: num(totalRow[f1total]),
  cars: num(totalRow[f1cars]),
};

const topBrands = f1
  .slice(1)
  .filter((r) => r[0] !== "ОБЩО" && r[0] !== "НЕИЗВЕСТНА")
  .map((r) => ({ brand: r[0], count: num(r[f1cars]) }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 15);

// ------------------------------------------------- файл 2: парк по гориво

const f2 = csv(2);
expectHeader(f2, ["ВИД", "БЕНЗИН", "ДИЗЕЛ", "ЕЛЕКТРОДВИГАТЕЛ"], "файл 2");
const carsRow = f2.find((r) => r[0] === "ЛЕК АВТОМОБИЛ") ?? fail("файл 2: няма ред ЛЕК АВТОМОБИЛ");
const fuelOf = (label) => {
  const i = f2[0].indexOf(label);
  return i === -1 ? 0 : num(carsRow[i]);
};

// Групираме десетките комбинации в категории, които значат нещо за читателя.
const carsTotal = fuelOf("BCИЧKO") || fleetTotals.cars; // тоталната колона в източника е с латински букви
const gasoline = fuelOf("БЕНЗИН");
const diesel = fuelOf("ДИЗЕЛ");
const bev = fuelOf("ЕЛЕКТРОДВИГАТЕЛ");
const hybrid =
  fuelOf("БЕНЗИН/ЕЛЕКТРИЧЕСТВО") + fuelOf("ДИЗЕЛ/ЕЛЕКТРИЧЕСТВО") + fuelOf("БЕНЗИН/ЕЛЕКТРИЧЕСТВО/ВТЕЧНЕН НЕФТЕН ГАЗ");
const lpgCng =
  fuelOf("БЕНЗИН/ВТЕЧНЕН НЕФТЕН ГАЗ") + fuelOf("БЕНЗИН/ГАЗ") + fuelOf("ВТЕЧНЕН НЕФТЕН ГАЗ") + fuelOf("ГАЗ") +
  fuelOf("БЕНЗИН/ПРИРОДЕН ГАЗ") + fuelOf("КОМПРЕСИРАН ПРИРОДЕН ГАЗ") + fuelOf("ПРИРОДЕН ГАЗ") +
  fuelOf("ПРИРОДЕН ГАЗ/ВТЕЧНЕН НЕФТЕН ГАЗ") + fuelOf("БЕНЗИН/КОМПРЕСИРАН ПРИРОДЕН ГАЗ/ВТЕЧНЕН НЕФТЕН ГАЗ");
const other = carsTotal - gasoline - diesel - bev - hybrid - lpgCng;

const fuelMix = [
  { label: "Бензин", count: gasoline },
  { label: "Дизел", count: diesel },
  { label: "Газ (LPG/CNG, вкл. бензин/газ)", count: lpgCng },
  { label: "Хибрид", count: hybrid },
  { label: "Електрически", count: bev },
  { label: "Друго / неизвестно", count: other },
].map((f) => ({ ...f, share: share(f.count, carsTotal) }));

writeFileSync(join(OUT_DIR, "fleet.json"), JSON.stringify({ totals: fleetTotals, carsTotal, fuelMix, topBrands }, null, 1));

// ------------------------------------- файл 4: възраст на леките по области

const f4 = csv(4);
// Внимание: в източника първата колона е с правописна грешка ("КАГЕТОРИЯ"),
// затова не я проверяваме по име, а по позиция.
expectHeader(f4, ["МАРКА", "РЕГИОН", "ВСИЧКО"], "файл 4");
const BUCKETS = ["0-5 год.", "6-10 год.", "11-15 год.", "15-20 год.", "над 20 год."];
// Средна възраст — оценка по средите на групите (методиката е обяснена на
// страницата). Източникът надписва четвъртата група "15-20", но 15-годишните
// са в "11-15", т.е. реално групата е 16–20 → среда 18.
const MIDPOINTS = { "0-5 год.": 2.5, "6-10 год.": 8, "11-15 год.": 13, "15-20 год.": 18, "над 20 год.": 25 };
const bIdx = Object.fromEntries(BUCKETS.map((b) => [b, f4[0].indexOf(b)]));

const byRegion = new Map();
const national = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
for (const r of f4.slice(1)) {
  if (r[0] !== "M1" || r[2] === "ОБЩО" || !r[2]) continue; // само леки (M1), без тотални редове
  const reg = byRegion.get(r[2]) ?? Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  for (const b of BUCKETS) {
    reg[b] += num(r[bIdx[b]]);
    national[b] += num(r[bIdx[b]]);
  }
  byRegion.set(r[2], reg);
}

function ageStats(buckets) {
  const total = BUCKETS.reduce((s, b) => s + buckets[b], 0);
  const over15 = buckets["15-20 год."] + buckets["над 20 год."];
  const estMean = BUCKETS.reduce((s, b) => s + buckets[b] * MIDPOINTS[b], 0) / total;
  return { total, over15Share: share(over15, total), estMeanAge: Math.round(estMean * 10) / 10 };
}

const regions = [...byRegion.entries()]
  .map(([region, buckets]) => ({ region, ...ageStats(buckets) }))
  .sort((a, b) => b.estMeanAge - a.estMeanAge);

writeFileSync(
  join(OUT_DIR, "age.json"),
  JSON.stringify({ national: { ...ageStats(national), buckets: national }, regions }, null, 1),
);

// ----------------------------- файл 11: новорегистрирани — нови срещу употребявани

const f11 = csv(11);
expectHeader(f11, ["МАРКА", "M1-нови", "общо-нови", "общо-употр."], "файл 11");
const i11 = (c) => f11[0].indexOf(c);
const t11 = f11.find((r) => r[0] === "ОБЩО") ?? fail("файл 11: няма ред ОБЩО");

const newVsUsed = {
  novi: num(t11[i11("общо-нови")]),
  upotrebyavani: num(t11[i11("общо-употр.")]),
};

const topNewCarBrands = f11
  .slice(1)
  .filter((r) => r[0] !== "ОБЩО")
  .map((r) => ({ brand: r[0], count: num(r[i11("M1-нови")]) }))
  .filter((b) => b.count > 0)
  .sort((a, b) => b.count - a.count)
  .slice(0, 10);

// Бележка: файлове 12–21 („позиция X в СРМПС“) броят всички издадени
// свидетелства за регистрация през периода — включително препродажби и
// пререгистрации (тоталът им е ~2× първоначалните регистрации). Не ги
// ползваме, за да не представим препродажби като „нови електромобили“.

// --------------------------------- файл 22: хибриди, първоначално регистрирани

const f22 = csv(22);
expectHeader(f22, ["РЕГИОН", "КЛАС ХИБРИД", "БРОЙ"], "файл 22");
const hIdx = f22[0].indexOf("КЛАС ХИБРИД"), cIdx = f22[0].indexOf("БРОЙ");
const hybridByClass = new Map();
let hybridTotal = 0;
for (const r of f22.slice(1)) {
  const klass = r[hIdx] || "БЕЗ КЛАС";
  hybridByClass.set(klass, (hybridByClass.get(klass) ?? 0) + num(r[cIdx]));
  hybridTotal += num(r[cIdx]);
}

writeFileSync(
  join(OUT_DIR, "ytd.json"),
  JSON.stringify(
    {
      newVsUsed,
      carsNewVsUsed: { novi: num(t11[i11("M1-нови")]), upotrebyavani: num(t11[i11("M1-употр.")]) },
      topNewCarBrands,
      hybrids: { total: hybridTotal, byClass: Object.fromEntries(hybridByClass) },
    },
    null,
    1,
  ),
);

// --------------------------------------------------------------- meta

writeFileSync(
  join(OUT_DIR, "meta.json"),
  JSON.stringify(
    {
      month,
      sourceUrl: "https://data.egov.bg/data/view/2e634036-6ab9-4efd-bd8e-c8e14a931911",
      sourceName: "МВР — регистрирани ППС (Портал за отворени данни)",
      generatedAt: new Date().toISOString().slice(0, 10),
    },
    null,
    1,
  ),
);

rmSync(tmp, { recursive: true, force: true });
console.log(`✓ статистика към ${month}: ${fleetTotals.cars.toLocaleString("bg-BG")} леки автомобила в парка, ` +
  `${(newVsUsed.novi + newVsUsed.upotrebyavani).toLocaleString("bg-BG")} първоначални регистрации от началото на годината`);
