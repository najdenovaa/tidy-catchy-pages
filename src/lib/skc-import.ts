/**
 * Импорт записи станции контроля цементирования (СКЦ): CSV / TXT / Excel.
 * Автоопределение разделителя, строки заголовка, назначения колонок и единиц измерения.
 * Объём, если его нет в записи, интегрируется по расходу.
 */
import * as XLSX from "xlsx";

export type SkcField = "time" | "pressure" | "rate" | "density" | "volume";
export type PressureUnit = "МПа" | "атм" | "кгс/см²" | "бар" | "psi";
export type RateUnit = "л/с" | "м³/мин" | "м³/ч" | "bbl/мин";
export type DensityUnit = "г/см³" | "кг/м³" | "ppg";
export type VolumeUnit = "м³" | "л" | "bbl";
export type TimeUnit = "чч:мм:сс" | "с" | "мин" | "дата-время";

export interface SkcMapping {
  columns: Partial<Record<SkcField, number>>;
  units: { pressure: PressureUnit; rate: RateUnit; density: DensityUnit; volume: VolumeUnit; time: TimeUnit };
}

export interface SkcRaw { headers: string[]; rows: string[][]; headerRow: number }

export interface SkcPoint {
  /** мин от начала записи */
  t: number;
  /** давление на устье, МПа */
  p: number;
  /** расход, л/с */
  q: number;
  /** плотность закачиваемой жидкости, г/см³ (NaN — нет данных) */
  rho: number;
  /** накопленный объём, м³ */
  v: number;
}

export interface SkcSeries { points: SkcPoint[]; volumeSource: "запись" | "интеграл расхода"; warnings: string[] }

const norm = (s: string) => String(s ?? "").toLowerCase().replace(/ё/g, "е").trim();

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  const cands = [";", "\t", ","];
  return cands.map((d) => ({ d, n: sample.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
}

const isNum = (s: string) => /^[-+]?\d+([.,]\d+)?([eE][-+]?\d+)?$/.test(String(s).trim());
const isTime = (s: string) => /^\d{1,2}:\d{2}(:\d{2}([.,]\d+)?)?$/.test(String(s).trim()) || /\d{1,4}[.\-/]\d{1,2}[.\-/]\d{1,4}[ T]\d{1,2}:\d{2}/.test(String(s));

export function parseText(text: string): SkcRaw {
  const d = detectDelimiter(text);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const cells = lines.map((l) => l.split(d).map((c) => c.replace(/^"|"$/g, "").trim()));
  return pickHeader(cells);
}

export function parseWorkbook(buf: ArrayBuffer): SkcRaw {
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, raw: false, blankrows: false }) as (string | number)[][];
  return pickHeader(rows.map((r) => r.map((c) => String(c ?? "").trim())));
}

/** Строка заголовка — последняя нечисловая строка перед блоком данных. */
function pickHeader(cells: string[][]): SkcRaw {
  const dataLike = (r: string[]) => r.filter((c) => isNum(c) || isTime(c)).length >= Math.max(2, Math.ceil(r.filter(Boolean).length * 0.6));
  let first = cells.findIndex(dataLike);
  if (first < 0) first = 0;
  const headerRow = Math.max(0, first - 1);
  const headers = first > 0 ? cells[headerRow] : cells[0].map((_, i) => `Колонка ${i + 1}`);
  const width = Math.max(...cells.slice(first).map((r) => r.length), headers.length);
  return {
    headers: Array.from({ length: width }, (_, i) => headers[i] || `Колонка ${i + 1}`),
    rows: cells.slice(first).filter(dataLike),
    headerRow,
  };
}

/** Угадываем назначение колонок по заголовкам и значениям. */
export function guessMapping(raw: SkcRaw): SkcMapping {
  const cols: SkcMapping["columns"] = {};
  const units: SkcMapping["units"] = { pressure: "МПа", rate: "л/с", density: "г/см³", volume: "м³", time: "чч:мм:сс" };
  raw.headers.forEach((h, i) => {
    const n = norm(h);
    if (cols.time === undefined && /(врем|time|дата|date|час)/.test(n)) cols.time = i;
    else if (cols.pressure === undefined && /(давлен|pressure|^p\b|p,|\bp\s*\(|мпа|атм|кгс|psi|бар)/.test(n)) {
      cols.pressure = i;
      if (/атм/.test(n)) units.pressure = "атм"; else if (/кгс/.test(n)) units.pressure = "кгс/см²"; else if (/psi/.test(n)) units.pressure = "psi"; else if (/бар|bar/.test(n)) units.pressure = "бар";
    } else if (cols.rate === undefined && /(расход|подач|rate|flow|^q\b|q,|л\/с|м3\/мин|м³\/мин|bpm)/.test(n)) {
      cols.rate = i;
      if (/м[3³]\/мин/.test(n)) units.rate = "м³/мин"; else if (/м[3³]\/ч/.test(n)) units.rate = "м³/ч"; else if (/bpm|bbl/.test(n)) units.rate = "bbl/мин";
    } else if (cols.density === undefined && /(плотн|density|dens|\bro\b|ρ|кг\/м|г\/см|ppg)/.test(n)) {
      cols.density = i;
      if (/кг\/м/.test(n)) units.density = "кг/м³"; else if (/ppg/.test(n)) units.density = "ppg";
    } else if (cols.volume === undefined && /(объ[её]м|volume|\bv\b|v,|накоп|сумм)/.test(n)) {
      cols.volume = i;
      if (/\bл\b|литр/.test(n) && !/л\/с/.test(n)) units.volume = "л"; else if (/bbl/.test(n)) units.volume = "bbl";
    }
  });
  // время по значению
  const sample = raw.rows.slice(0, 20);
  if (cols.time === undefined) {
    const ti = raw.headers.findIndex((_, i) => sample.some((r) => isTime(r[i] ?? "")));
    if (ti >= 0) cols.time = ti;
  }
  if (cols.time !== undefined) {
    const v = sample.map((r) => r[cols.time!] ?? "");
    if (v.some((x) => /\d{1,4}[.\-/]\d{1,2}[.\-/]\d{1,4}/.test(x))) units.time = "дата-время";
    else if (v.some((x) => x.includes(":"))) units.time = "чч:мм:сс";
    else units.time = /мин|min/.test(norm(raw.headers[cols.time])) ? "мин" : "с";
  }
  // плотность по величине
  if (cols.density !== undefined && units.density === "г/см³") {
    const vals = sample.map((r) => num(r[cols.density!])).filter((x) => Number.isFinite(x) && x > 0);
    const med = vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)] ?? 1.2;
    if (med > 100) units.density = "кг/м³"; else if (med > 5) units.density = "ppg";
  }
  return { columns: cols, units };
}

const num = (s: string | undefined) => {
  const v = parseFloat(String(s ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};

function timeToMin(s: string, unit: TimeUnit): number {
  const x = String(s).trim();
  if (unit === "с") return num(x) / 60;
  if (unit === "мин") return num(x);
  const m = x.match(/(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?\s*$/);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0) + (m[4] ? Number(`0.${m[4]}`) / 60 : 0);
}

const P_TO_MPA: Record<PressureUnit, number> = { "МПа": 1, "атм": 0.101325, "кгс/см²": 0.0980665, "бар": 0.1, "psi": 0.00689476 };
const Q_TO_LPS: Record<RateUnit, number> = { "л/с": 1, "м³/мин": 1000 / 60, "м³/ч": 1000 / 3600, "bbl/мин": 158.987 / 60 };
const V_TO_M3: Record<VolumeUnit, number> = { "м³": 1, "л": 0.001, "bbl": 0.158987 };
const RHO_TO_G: Record<DensityUnit, number> = { "г/см³": 1, "кг/м³": 0.001, "ppg": 0.119826 };

/** Преобразование в ряд СКЦ (единицы СИ проекта), сортировка по времени, интеграл объёма. */
export function toSeries(raw: SkcRaw, map: SkcMapping): SkcSeries {
  const c = map.columns, u = map.units;
  const warnings: string[] = [];
  if (c.pressure === undefined) warnings.push("Не найдена колонна давления.");
  if (c.rate === undefined && c.volume === undefined) warnings.push("Нет ни расхода, ни объёма — сравнение по объёму невозможно.");
  let t0 = NaN, dayShift = 0, prevRaw = NaN;
  const pts: SkcPoint[] = [];
  raw.rows.forEach((r, idx) => {
    let t = c.time !== undefined ? timeToMin(r[c.time] ?? "", u.time) : idx * (1 / 60);
    if (Number.isFinite(t) && Number.isFinite(prevRaw) && t + 12 * 60 < prevRaw) dayShift += 24 * 60; // переход через полночь
    prevRaw = t; t += dayShift;
    if (!Number.isFinite(t)) return;
    if (!Number.isFinite(t0)) t0 = t;
    const p = c.pressure !== undefined ? num(r[c.pressure]) * P_TO_MPA[u.pressure] : NaN;
    const q = c.rate !== undefined ? num(r[c.rate]) * Q_TO_LPS[u.rate] : NaN;
    const rho = c.density !== undefined ? num(r[c.density]) * RHO_TO_G[u.density] : NaN;
    const v = c.volume !== undefined ? num(r[c.volume]) * V_TO_M3[u.volume] : NaN;
    pts.push({ t: t - t0, p, q: Number.isFinite(q) ? Math.max(0, q) : NaN, rho, v });
  });
  pts.sort((a, b) => a.t - b.t);
  let volumeSource: SkcSeries["volumeSource"] = "запись";
  if (c.volume === undefined || pts.every((x) => !Number.isFinite(x.v))) {
    volumeSource = "интеграл расхода";
    let v = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) {
        const dt = (pts[i].t - pts[i - 1].t) * 60;
        const qa = (Number.isFinite(pts[i].q) ? pts[i].q : 0), qb = (Number.isFinite(pts[i - 1].q) ? pts[i - 1].q : 0);
        if (dt > 0 && dt < 600) v += ((qa + qb) / 2) * dt / 1000;
      }
      pts[i].v = v;
    }
  } else {
    // объём с начала записи
    const v0 = pts.find((x) => Number.isFinite(x.v))?.v ?? 0;
    pts.forEach((x) => { x.v = Number.isFinite(x.v) ? x.v - v0 : NaN; });
    if (c.rate === undefined) {
      for (let i = 1; i < pts.length; i++) {
        const dt = (pts[i].t - pts[i - 1].t) * 60;
        pts[i].q = dt > 0 ? Math.max(0, ((pts[i].v - pts[i - 1].v) * 1000) / dt) : 0;
      }
      if (pts.length) pts[0].q = pts[1]?.q ?? 0;
    }
  }
  if (pts.length < 10) warnings.push("Слишком мало точек в записи.");
  return { points: pts.filter((x) => Number.isFinite(x.p) || Number.isFinite(x.q)), volumeSource, warnings };
}

export async function readSkcFile(file: File): Promise<SkcRaw> {
  const name = file.name.toLowerCase();
  if (/\.(xlsx|xls|ods)$/.test(name)) return parseWorkbook(await file.arrayBuffer());
  const buf = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("�")) text = new TextDecoder("windows-1251").decode(buf); // выгрузки СКЦ часто в cp1251
  return parseText(text);
}
