/**
 * Вероятностная оценка риска поглощения и недоподъёма цемента (метод Монте-Карло).
 * Неопределённости: градиенты ГРП/поглощения и пластового давления, кавернозность, реология растворов,
 * плотность цемента, центрирование, расход. Каждая реализация — полная симуляция закачки.
 * Генератор случайных чисел детерминированный (seed): один и тот же расчёт даёт одни и те же цифры.
 */
import {
  calculatePressureProfile, calculateVolumes, annularVolumeForInterval,
  type WellData, type SlurryInput, type BufferFluid, type DrillingFluid, type DisplacementFluid, type Rheology,
} from "./cementing-calculations";

export interface RiskSettings {
  iterations: number;
  seed: number;
  /** σ относительная */
  fracSigma: number;
  poreSigma: number;
  cavernSigma: number;
  rheologySigma: number;
  /** σ абсолютная, г/см³ */
  densitySigma: number;
  /** σ абсолютная, процентные пункты отступа */
  standoffSigma: number;
  rateSigma: number;
}

export const DEFAULT_RISK: RiskSettings = {
  iterations: 200, seed: 20261013,
  fracSigma: 0.04, poreSigma: 0.03, cavernSigma: 0.05, rheologySigma: 0.15, densitySigma: 0.015, standoffSigma: 8, rateSigma: 0.05,
};

export interface RiskInput {
  wellData: WellData;
  drillingFluid: DrillingFluid;
  buffers: BufferFluid[];
  slurries: SlurryInput[];
  displacementFluids: DisplacementFluid[];
  fractureGradient: number;
  flushTimeMin: number;
  flushVolumeM3: number;
}

export interface RiskResult {
  iterations: number;
  pLoss: number;
  pUnderbalance: number;
  margin: { p10: number; p50: number; p90: number; mean: number };
  marginSamples: number[];
  zones: { name: string; pLoss: number; p10: number; p50: number }[];
  toc: { planned: number; p10: number; p50: number; p90: number; pBelowRequired: number | null; requiredMax: number | null };
  sensitivity: { factor: string; corr: number }[];
  deterministicMargin: number;
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pct = (sorted: number[], p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))] : 0;

function corr(x: number[], y: number[]): number {
  const n = x.length; if (n < 3) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

const scaleRheo = (r: Rheology, k: number): Rheology => ({
  pv: r.pv * k, yp: r.yp * k,
  ...(r.fann ? { fann: Object.fromEntries(Object.entries(r.fann).map(([key, v]) => [key, (Number(v) || 0) * k])) } : {}),
});

/** Глубина верха цемента при фактической кавернозности, если закачан объём по плановой. */
export function actualToc(w: WellData, plannedTop: number, cavernActual: number): number {
  const planned = annularVolumeForInterval(plannedTop, w.casingDepthMD, w.holeDiameter, w.casingOD, w.prevCasingID, w.prevCasingDepth, w.cavernCoeff, w.cavernIntervals);
  const k = cavernActual / Math.max(1e-6, w.cavernCoeff);
  const actualVol = (top: number) => annularVolumeForInterval(top, w.casingDepthMD, w.holeDiameter, w.casingOD, w.prevCasingID, w.prevCasingDepth, cavernActual, w.cavernIntervals?.map((iv) => ({ ...iv, coeff: iv.coeff * k })));
  let lo = 0, hi = w.casingDepthMD;
  if (actualVol(0) <= planned) return 0;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (actualVol(mid) > planned) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

export async function runLossRisk(
  inp: RiskInput, settings: RiskSettings = DEFAULT_RISK, onProgress?: (done: number, total: number) => void,
): Promise<RiskResult> {
  const rnd = mulberry32(settings.seed);
  const normal = () => { const u = 1 - rnd(), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const w0 = inp.wellData;
  const plannedTop = inp.slurries.length ? Math.min(...inp.slurries.map((s) => s.topDepthMD)) : w0.casingDepthMD;
  const layers = w0.reservoirLayers ?? [];
  const requiredMax = layers.length ? Math.min(...layers.map((l) => l.topMD)) - 150 : null;

  const base = (() => {
    const v = calculateVolumes(w0, inp.slurries, inp.displacementFluids[0]?.compressionCoeff ?? 1);
    const pr = calculatePressureProfile(w0, inp.slurries, inp.buffers, inp.drillingFluid, inp.displacementFluids, inp.fractureGradient, v.displacementVolumeWithCompression, inp.flushTimeMin, inp.flushVolumeM3, { fast: true });
    return pr.zoneChecks.length ? Math.min(...pr.zoneChecks.map((z) => z.marginMPa)) : 0;
  })();

  const factors: Record<string, number[]> = { "Градиент ГРП/поглощения": [], "Пластовое давление": [], "Кавернозность": [], "Реология": [], "Плотность цемента": [], "Центрирование": [], "Расход": [] };
  const margins: number[] = [], tocs: number[] = [];
  const zoneMargins: Record<string, number[]> = {};
  let loss = 0, under = 0;

  for (let it = 0; it < settings.iterations; it++) {
    const kFrac = 1 + settings.fracSigma * normal();
    const kPore = 1 + settings.poreSigma * normal();
    const cav = Math.max(1, w0.cavernCoeff * (1 + settings.cavernSigma * normal()));
    const kRheo = Math.exp(settings.rheologySigma * normal());
    const dRho = settings.densitySigma * normal();
    const dSo = settings.standoffSigma * normal();
    const kRate = Math.max(0.5, 1 + settings.rateSigma * normal());

    const w: WellData = {
      ...w0, cavernCoeff: cav,
      cavernIntervals: w0.cavernIntervals?.map((iv) => ({ ...iv, coeff: Math.max(1, iv.coeff * cav / Math.max(1e-6, w0.cavernCoeff)) })),
      reservoirLayers: layers.map((l) => ({ ...l, fracGrad: l.fracGrad * kFrac, absorbGrad: l.absorbGrad * kFrac, porePressureGrad: l.porePressureGrad * kPore })),
      standoffProfile: w0.standoffProfile?.map((p) => ({ ...p, standoffPct: Math.min(100, Math.max(5, p.standoffPct + dSo)) })),
      annularStandoffPct: Math.min(100, Math.max(5, (w0.annularStandoffPct ?? 67) + dSo)),
    };
    const rate = <T extends { flowRateSteps: { rateLps: number; volumeM3: number }[] }>(x: T): T => ({ ...x, flowRateSteps: x.flowRateSteps.map((st) => ({ ...st, rateLps: st.rateLps * kRate })) });
    const slurries = inp.slurries.map((s) => rate({ ...s, density: s.density + dRho, rheology: scaleRheo(s.rheology, kRheo) }));
    const buffers = inp.buffers.map((b) => rate({ ...b, rheology: scaleRheo(b.rheology, kRheo) }));
    const disps = inp.displacementFluids.map((d) => rate({ ...d, rheology: scaleRheo(d.rheology, kRheo) }));
    const mud = { ...inp.drillingFluid, rheology: scaleRheo(inp.drillingFluid.rheology, kRheo) };
    const vols = calculateVolumes(w, slurries, disps[0]?.compressionCoeff ?? 1);
    const pr = calculatePressureProfile(w, slurries, buffers, mud, disps, inp.fractureGradient * kFrac, vols.displacementVolumeWithCompression, inp.flushTimeMin, inp.flushVolumeM3, { fast: true });

    const m = pr.zoneChecks.length ? Math.min(...pr.zoneChecks.map((z) => z.marginMPa)) : 0;
    margins.push(m);
    if (m < 0) loss++;
    if (pr.zoneChecks.some((z) => z.porePressureMPa > 0 && z.minPressureMPa < z.porePressureMPa)) under++;
    pr.zoneChecks.forEach((z) => { (zoneMargins[z.name] ??= []).push(z.marginMPa); });
    tocs.push(actualToc(w0, plannedTop, cav));

    factors["Градиент ГРП/поглощения"].push(kFrac); factors["Пластовое давление"].push(kPore); factors["Кавернозность"].push(cav);
    factors["Реология"].push(kRheo); factors["Плотность цемента"].push(dRho); factors["Центрирование"].push(dSo); factors["Расход"].push(kRate);

    onProgress?.(it + 1, settings.iterations);
    if (it % 5 === 4) await new Promise((r) => setTimeout(r, 0));
  }

  const sm = [...margins].sort((a, b) => a - b);
  const st = [...tocs].sort((a, b) => a - b);
  return {
    iterations: settings.iterations,
    pLoss: loss / settings.iterations,
    pUnderbalance: under / settings.iterations,
    margin: { p10: pct(sm, 0.1), p50: pct(sm, 0.5), p90: pct(sm, 0.9), mean: margins.reduce((a, b) => a + b, 0) / Math.max(1, margins.length) },
    marginSamples: margins,
    zones: Object.entries(zoneMargins).map(([name, arr]) => {
      const s = [...arr].sort((a, b) => a - b);
      return { name, pLoss: arr.filter((x) => x < 0).length / arr.length, p10: pct(s, 0.1), p50: pct(s, 0.5) };
    }),
    toc: {
      planned: plannedTop, p10: pct(st, 0.1), p50: pct(st, 0.5), p90: pct(st, 0.9),
      pBelowRequired: requiredMax !== null ? tocs.filter((t) => t > requiredMax).length / tocs.length : null, requiredMax,
    },
    sensitivity: Object.entries(factors).map(([factor, xs]) => ({ factor, corr: corr(xs, margins) })).sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr)),
    deterministicMargin: base,
  };
}
