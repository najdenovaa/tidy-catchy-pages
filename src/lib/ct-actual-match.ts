/**
 * Сравнение расчёта ГНКТ с фактом и калибровка модели.
 *  - коэффициент трения μ подбирается по показаниям индикатора веса (минимум среднеквадратичного отклонения),
 *    отдельно оценивается μ для спуска и для подъёма;
 *  - поправочный множитель потерь на трение — по фактическому давлению насоса при известном расходе;
 *  - отклонения факта от откалиброванной модели — затяжки при подъёме и посадки при спуске.
 * Показания приводятся к модели с учётом фактического давления на устье в момент замера.
 */
import type { CTSection, CTStringData, FluidData, ToolsData, WellGeometry } from "./coiled-tubing-calculations";
import { calculateHydraulics } from "./coiled-tubing-calculations";
import { forceModel, pipeFromBottom, stringLength, type CTSurfaceOptions } from "./ct-engine";

export type ActualDir = "rih" | "pooh" | "static";

export interface ActualPoint {
  id: string;
  /** глубина КНБК, м */
  md: number;
  dir: ActualDir;
  /** индикатор веса, кН */
  wiKN?: number;
  /** давление насоса (в ГНКТ на входе), МПа */
  pumpMPa?: number;
  /** расход, л/с */
  rateLps?: number;
  /** давление на устье в момент замера, МПа */
  whpMPa?: number;
  time?: string;
}

export interface MatchPoint {
  md: number; dir: ActualDir; measured: number;
  modelCurrent: number; modelBest: number; residual: number; flag: "" | "overpull" | "setdown";
}

export interface MatchResult {
  muCurrent: number;
  muBest: number;
  muRIH: number | null;
  muPOOH: number | null;
  rmsCurrent: number;
  rmsBest: number;
  curve: { mu: number; rms: number; rmsRIH: number | null; rmsPOOH: number | null }[];
  points: MatchPoint[];
  lines: { depth: number; rihCur: number | null; poohCur: number | null; rihBest: number | null; poohBest: number | null }[];
  anomalies: { kind: "overpull" | "setdown"; from: number; to: number; maxKN: number }[];
  hyd: null | {
    factor: number; n: number; rmsBefore: number; rmsAfter: number;
    points: { md: number; rate: number; measured: number; modelBefore: number; modelAfter: number }[];
  };
  notes: string[];
}

interface Ctx {
  ct: CTStringData; well: WellGeometry; fluid: FluidData; tools: ToolsData; sections?: CTSection[]; opts: CTSurfaceOptions;
}

const rms = (a: number[]) => (a.length ? Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length) : NaN);

/** Модельные показания индикатора веса на заданных глубинах для μ. */
function modelWI(c: Ctx, mu: number, depths: number[]) {
  const m = forceModel(c.ct, c.sections, c.well, c.fluid, c.tools.bhaWeight, mu, c.opts);
  const out = new Map<number, { rih: number; pooh: number; stat: number }>();
  for (const d of depths) {
    if (out.has(d)) continue;
    const s = m.snapshot(Math.max(1, d), false);
    out.set(d, { rih: Number.isFinite(s.wiRIH) ? s.wiRIH : NaN, pooh: s.wiPOOH, stat: s.wiStatic });
  }
  return out;
}

export function matchActual(c: Ctx, data: ActualPoint[], muCurrent: number, anomalyKN = 5): MatchResult {
  const maxD = Math.min(stringLength(c.ct, c.sections), c.well.md);
  const ao = pipeFromBottom(c.ct, c.sections, stringLength(c.ct, c.sections)).ao;
  const w0 = c.well.wellheadPressure;
  const pts = data.filter((p) => Number.isFinite(p.md) && p.md > 0 && p.md <= maxD + 1 && Number.isFinite(p.wiKN));
  const bin = (d: number) => Math.max(5, Math.round(d / 10) * 10);
  const depths = [...new Set(pts.map((p) => bin(p.md)))];
  // поправка на фактическое давление устья: dWI = −(P_факт − P_модели)·A
  const corr = (p: ActualPoint) => (p.whpMPa !== undefined && Number.isFinite(p.whpMPa) ? -(p.whpMPa - w0) * 1e3 * ao : 0);
  const pred = (mp: Map<number, { rih: number; pooh: number; stat: number }>, p: ActualPoint) => {
    const r = mp.get(bin(p.md))!;
    return (p.dir === "rih" ? r.rih : p.dir === "pooh" ? r.pooh : r.stat) + corr(p);
  };
  const evalMu = (mu: number) => {
    const mp = modelWI(c, mu, depths);
    const all: number[] = [], rih: number[] = [], pooh: number[] = [];
    for (const p of pts) {
      const v = pred(mp, p);
      if (!Number.isFinite(v)) { all.push(50); if (p.dir === "rih") rih.push(50); continue; } // запирание в модели при фактическом проходе — большой штраф
      const e = (p.wiKN as number) - v;
      all.push(e); if (p.dir === "rih") rih.push(e); if (p.dir === "pooh") pooh.push(e);
    }
    return { mp, rms: rms(all), rmsRIH: rih.length ? rms(rih) : null, rmsPOOH: pooh.length ? rms(pooh) : null };
  };
  const curve: MatchResult["curve"] = [];
  const cache = new Map<number, ReturnType<typeof evalMu>>();
  const at = (mu: number) => { const k = Math.round(mu * 1000) / 1000; let r = cache.get(k); if (!r) { r = evalMu(k); cache.set(k, r); } return r; };
  for (let mu = 0.05; mu <= 0.5001; mu += 0.025) { const r = at(mu); curve.push({ mu: Math.round(mu * 1000) / 1000, rms: r.rms, rmsRIH: r.rmsRIH, rmsPOOH: r.rmsPOOH }); }
  const notes: string[] = [];
  let muBest = muCurrent;
  if (pts.length >= 2) {
    // уточнение золотым сечением вокруг минимума сетки
    const i0 = curve.reduce((b, x, i) => (x.rms < curve[b].rms ? i : b), 0);
    let a = curve[Math.max(0, i0 - 1)].mu, b = curve[Math.min(curve.length - 1, i0 + 1)].mu;
    const g = (Math.sqrt(5) - 1) / 2;
    let x1 = b - g * (b - a), x2 = a + g * (b - a);
    for (let k = 0; k < 8; k++) {
      if (at(x1).rms < at(x2).rms) { b = x2; x2 = x1; x1 = b - g * (b - a); } else { a = x1; x1 = x2; x2 = a + g * (b - a); }
    }
    muBest = Math.round(((a + b) / 2) * 1000) / 1000;
  } else notes.push("Для подбора трения нужно не меньше двух замеров индикатора веса на разных глубинах.");
  // μ для спуска / подъёма — парабола по сетке
  const subsetMin = (key: "rmsRIH" | "rmsPOOH") => {
    const xs = curve.filter((x) => x[key] !== null);
    if (xs.length < 3) return null;
    const i = xs.reduce((bi, x, k) => ((x[key] as number) < (xs[bi][key] as number) ? k : bi), 0);
    if (i === 0 || i === xs.length - 1) return xs[i].mu;
    const [y0, y1, y2] = [xs[i - 1][key] as number, xs[i][key] as number, xs[i + 1][key] as number];
    const h = xs[i].mu - xs[i - 1].mu, den = y0 - 2 * y1 + y2;
    return Math.round((den > 0 ? xs[i].mu + (h * (y0 - y2)) / (2 * den) : xs[i].mu) * 1000) / 1000;
  };
  const muRIH = subsetMin("rmsRIH"), muPOOH = subsetMin("rmsPOOH");
  const cur = at(muCurrent), best = at(muBest);
  const points: MatchPoint[] = pts.map((p) => {
    const mc = pred(cur.mp, p), mb = pred(best.mp, p);
    const res = (p.wiKN as number) - mb;
    const lim = Math.max(anomalyKN, 0.15 * Math.abs(mb));
    const flag: MatchPoint["flag"] = p.dir === "pooh" && res > lim ? "overpull" : p.dir === "rih" && res < -lim ? "setdown" : "";
    return { md: p.md, dir: p.dir, measured: p.wiKN as number, modelCurrent: mc, modelBest: mb, residual: res, flag };
  }).sort((x, y) => x.md - y.md);
  // интервалы аномалий
  const anomalies: MatchResult["anomalies"] = [];
  for (const kind of ["overpull", "setdown"] as const) {
    const fl = points.filter((p) => p.flag === kind);
    for (const p of fl) {
      const last = anomalies.filter((a) => a.kind === kind).slice(-1)[0];
      if (last && p.md - last.to <= 150) { last.to = p.md; last.maxKN = Math.max(last.maxKN, Math.abs(p.residual)); }
      else anomalies.push({ kind, from: p.md, to: p.md, maxKN: Math.abs(p.residual) });
    }
  }
  // линии модели для графика
  const lineDepths = Array.from({ length: 41 }, (_, i) => bin((maxD * i) / 40));
  const mc = modelWI(c, muCurrent, lineDepths), mb = modelWI(c, muBest, lineDepths);
  const fin = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
  const lines = lineDepths.map((d) => ({ depth: d, rihCur: fin(mc.get(d)!.rih), poohCur: fin(mc.get(d)!.pooh), rihBest: fin(mb.get(d)!.rih), poohBest: fin(mb.get(d)!.pooh) }));
  if (muRIH !== null && muPOOH !== null && Math.abs(muRIH - muPOOH) > 0.08) {
    notes.push(muPOOH > muRIH
      ? `При подъёме трение заметно выше, чем при спуске (μ ${muPOOH.toFixed(2)} против ${muRIH.toFixed(2)}): возможны шлам/песок над КНБК, налипания, сужения — проверьте очистку ствола.`
      : `При спуске трение выше, чем при подъёме (μ ${muRIH.toFixed(2)} против ${muPOOH.toFixed(2)}): вероятен спиральный изгиб сильнее расчётного или сопротивление КНБК (посадки) — снизить скорость, добавить смазку/снижатель трения, рассмотреть вибратор.`);
  }
  // гидравлика
  let hyd: MatchResult["hyd"] = null;
  const hp = data.filter((p) => Number.isFinite(p.pumpMPa) && Number.isFinite(p.rateLps) && (p.rateLps as number) > 0 && p.md > 0);
  if (hp.length) {
    const rows = hp.map((p) => {
      const whp = Number.isFinite(p.whpMPa) ? (p.whpMPa as number) : w0;
      const well = { ...c.well, md: Math.min(p.md, maxD), wellheadPressure: whp };
      const base = calculateHydraulics(c.ct, well, c.fluid, { flowRate: p.rateLps as number, surfacePressure: 0 }, c.tools, c.sections, { ...c.opts, hydFrictionFactor: 1 });
      const fr = base.pumpPressure - whp - base.dpNozzle;
      const before = calculateHydraulics(c.ct, well, c.fluid, { flowRate: p.rateLps as number, surfacePressure: 0 }, c.tools, c.sections, c.opts).pumpPressure;
      return { md: p.md, rate: p.rateLps as number, measured: p.pumpMPa as number, fr, nozzle: base.dpNozzle, whp, before };
    });
    const num = rows.reduce((s, r) => s + (r.measured - r.whp - r.nozzle) * r.fr, 0), den = rows.reduce((s, r) => s + r.fr * r.fr, 0);
    const factor = den > 0 ? Math.min(3, Math.max(0.2, num / den)) : 1;
    const pr = rows.map((r) => ({ md: Math.round(r.md), rate: r.rate, measured: r.measured, modelBefore: Math.round(r.before * 100) / 100, modelAfter: Math.round((r.whp + r.nozzle + factor * r.fr) * 100) / 100 }));
    hyd = { factor: Math.round(factor * 1000) / 1000, n: rows.length, rmsBefore: rms(pr.map((x) => x.measured - x.modelBefore)), rmsAfter: rms(pr.map((x) => x.measured - x.modelAfter)), points: pr };
    if (factor > 1.15) notes.push(`Фактические потери на трение выше расчётных в ${factor.toFixed(2)} раза: проверьте реологию жидкости, засорение/отложения в трубе, точность расходомера.`);
    else if (factor < 0.85) notes.push(`Фактические потери ниже расчётных (×${factor.toFixed(2)}): жидкость снижает трение сильнее модели (полимер/снижатель трения) или завышен расход по датчику.`);
  }
  return { muCurrent, muBest, muRIH, muPOOH, rmsCurrent: cur.rms, rmsBest: best.rms, curve, points, lines, anomalies, hyd, notes };
}

// ─── Ввод данных ───

const num = (x: unknown) => { const v = parseFloat(String(x ?? "").replace(/\s/g, "").replace(",", ".")); return Number.isFinite(v) ? v : undefined; };

export type WeightUnit = "kN" | "tf" | "kgf" | "klbf";
export const WEIGHT_TO_KN: Record<WeightUnit, number> = { kN: 1, tf: 9.80665, kgf: 0.00980665, klbf: 4.44822 };
export const WEIGHT_LABEL: Record<WeightUnit, string> = { kN: "кН", tf: "тс", kgf: "кгс", klbf: "тыс. фунтов" };

/** Разбор таблицы (из Excel/буфера). Столбцы ищутся по заголовкам; без заголовков — порядок: глубина, вес, давление, расход, P устья, направление. */
export function parseActualTable(rows: unknown[][], unit: WeightUnit): ActualPoint[] {
  if (!rows.length) return [];
  const head = rows[0].map((x) => String(x ?? "").toLowerCase());
  const hasHeader = head.some((h) => /[a-zа-я]/i.test(h) && !/^[-+\d.,\s]+$/.test(h));
  const find = (keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)));
  const idx = hasHeader ? {
    md: find(["глуб", "depth", "md", "забой"]), wi: find(["вес", "нагруз", "weight", "hook", "индик"]),
    p: find(["давл", "pump", "pressure", "насос", "цирк"]), q: find(["расход", "rate", "flow", "подач"]),
    whp: find(["устье", "устьев", "whp", "wellhead", "буфер"]), dir: find(["напр", "dir", "операц", "спо"]), t: find(["врем", "time", "дата"]),
  } : { md: 0, wi: 1, p: 2, q: 3, whp: 4, dir: 5, t: -1 };
  // если «давление» совпало со столбцом устьевого — разведём
  if (idx.p >= 0 && idx.p === idx.whp) idx.p = head.findIndex((h, i) => i !== idx.whp && (h.includes("насос") || h.includes("pump") || h.includes("цирк")));
  const kWi = head[idx.wi]?.includes("кгс") ? WEIGHT_TO_KN.kgf : head[idx.wi]?.includes("тс") ? WEIGHT_TO_KN.tf : head[idx.wi]?.includes("klb") || head[idx.wi]?.includes("фунт") ? WEIGHT_TO_KN.klbf : head[idx.wi]?.includes("кн") ? 1 : WEIGHT_TO_KN[unit];
  const body = hasHeader ? rows.slice(1) : rows;
  const out: ActualPoint[] = [];
  let prev: number | null = null;
  body.forEach((r, i) => {
    const md = num(r[idx.md]);
    if (md === undefined) return;
    const dirS = idx.dir >= 0 ? String(r[idx.dir] ?? "").toLowerCase() : "";
    let dir: ActualDir = dirS.startsWith("п") || dirS.includes("pooh") || dirS.includes("out") || dirS.includes("up") ? "pooh" : dirS.startsWith("с") || dirS.includes("rih") || dirS.includes("in") || dirS.includes("down") ? "rih" : dirS.startsWith("ст") || dirS.includes("stat") ? "static" : "rih";
    if (!dirS) dir = prev === null ? "rih" : md > prev + 0.05 ? "rih" : md < prev - 0.05 ? "pooh" : "static";
    if (dirS.startsWith("ст")) dir = "static";
    prev = md;
    const wi = num(r[idx.wi]);
    out.push({
      id: `a${i}-${Math.random().toString(36).slice(2, 6)}`, md, dir,
      wiKN: wi !== undefined ? wi * kWi : undefined,
      pumpMPa: idx.p >= 0 ? num(r[idx.p]) : undefined, rateLps: idx.q >= 0 ? num(r[idx.q]) : undefined,
      whpMPa: idx.whp >= 0 ? num(r[idx.whp]) : undefined, time: idx.t >= 0 ? String(r[idx.t] ?? "") : undefined,
    });
  });
  return out;
}

/** Демонстрационные «фактические» данные: модель при μ_ист + шум + затяжка в интервале. */
export function demoActual(c: Ctx, muTrue = 0.28): ActualPoint[] {
  const maxD = Math.min(stringLength(c.ct, c.sections), c.well.md);
  const m = forceModel(c.ct, c.sections, c.well, c.fluid, c.tools.bhaWeight, muTrue, c.opts);
  const out: ActualPoint[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 2; };
  const lim = (() => { for (let d = 100; d <= maxD; d += 100) { if (m.snapshot(d, false).helicalLock) return d - 100; } return maxD; })();
  for (let d = 100; d <= lim; d += 100) { const s = m.snapshot(d, false); out.push({ id: `r${d}`, md: d, dir: "rih", wiKN: Math.round((s.wiRIH + rnd() * 1.5) * 10) / 10, whpMPa: c.well.wellheadPressure }); }
  for (let d = lim; d >= 100; d -= 100) {
    const s = m.snapshot(d, false);
    const extra = Math.abs(d - lim * 0.55) < lim * 0.06 ? 9 : 0; // затяжка
    const rate = 3;
    const h = calculateHydraulics(c.ct, { ...c.well, md: d }, c.fluid, { flowRate: rate, surfacePressure: 0 }, c.tools, c.sections, { ...c.opts, hydFrictionFactor: 1.18 });
    out.push({ id: `p${d}`, md: d, dir: "pooh", wiKN: Math.round((s.wiPOOH + extra + rnd() * 1.5) * 10) / 10, pumpMPa: Math.round((h.pumpPressure + rnd() * 0.3) * 10) / 10, rateLps: rate, whpMPa: c.well.wellheadPressure });
  }
  return out;
}
