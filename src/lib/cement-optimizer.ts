/**
 * Автоподбор программы цементирования.
 * Перебор расходов (буфер+цемент / продавка) и параметров разделительного буфера (объём, плотность).
 * Каждый вариант прогоняется через полную симуляцию закачки (послойное трение, проверка по пластам),
 * качество вытеснения — индекс MREI (API 10TR4) по интервалу цементирования при фактическом расходе
 * в момент, когда буфер и цемент идут по затрубью.
 */
import {
  calculatePressureProfile, calculateVolumes, getEffectiveTrajectory, interpolateTVD, annularVolumeForInterval,
  annularFrictionMPa, hbOf, getCavernCoeffAtDepth, type Rheology,
  type WellData, type DrillingFluid, type BufferFluid, type SlurryInput, type DisplacementFluid, type FlowRateStep,
  type PressureProfileResult, type VolumeResults,
} from "./cementing-calculations";
import { buildLabProgram } from "./cement-program";
import type { CentralizationResult } from "./centralization-calculations";

export interface OptimizerSettings {
  minRateLps: number;
  maxRateLps: number;
  /** Предельный расход буфера и цемента — производительность затворения (СМН + ЦА), л/с */
  maxCementRateLps: number;
  rateStepLps: number;
  /** Предельное давление на устье (паспорт агрегатов / обвязки), МПа */
  pumpPressureLimitMPa: number;
  /** Требуемый запас до ГРП/поглощения в каждой точке, МПа */
  marginReqMPa: number;
  /** Подбирать объём и плотность разделительного буфера */
  optimizeBuffer: boolean;
  /** Вращение колонны при цементировании, об/мин (влияет на MREI) */
  rotationRpm: number;
}

export const DEFAULT_OPTIMIZER_SETTINGS: OptimizerSettings = {
  minRateLps: 6, maxRateLps: 30, maxCementRateLps: 20, rateStepLps: 4, pumpPressureLimitMPa: 25, marginReqMPa: 0.5, optimizeBuffer: true, rotationRpm: 0,
};

export interface ProgramInput {
  wellData: WellData;
  drillingFluid: DrillingFluid;
  buffers: BufferFluid[];
  slurries: SlurryInput[];
  displacementFluids: DisplacementFluid[];
  fractureGradient: number;
  flushTimeMin: number;
  flushVolumeM3: number;
  centralization?: CentralizationResult[];
}

export interface ProgramVariant {
  /** Расход буфера и цемента, л/с */
  q1: number;
  /** Расход продавки (основной), л/с */
  q2: number;
  /** Разделительный буфер (последний перед цементом): объём, м³ и плотность, кг/м³ — null, если не меняется */
  bufferVolumeM3: number | null;
  bufferDensity: number | null;
}

export type Violation = "ГРП/поглощение" | "проявление" | "загустевание" | "давление на устье";

export interface VariantEval {
  variant: ProgramVariant;
  feasible: boolean;
  violations: Violation[];
  /** Индекс вытеснения по интервалу цементирования, % */
  mrei: number;
  /** Длина интервала, где буровой раствор на узкой стороне остаётся неподвижным, м */
  channelLengthM: number;
  minMarginMPa: number;
  minMarginAt: string;
  underbalanceMPa: number;
  maxSurfaceMPa: number;
  jobTimeMin: number;
  /** Минимальный запас времени загустевания по растворам, мин (Infinity — время не задано) */
  thickeningReserveMin: number;
  /** Средний расход, пока буфер и цемент идут по затрубью, л/с */
  effAnnRateLps: number;
  limitingFactor: string;
  recommendations: string[];
  /** Не считался: заведомо хуже соседнего варианта по давлению */
  pruned?: boolean;
}

export interface OptimizerResult {
  current: VariantEval;
  evaluations: VariantEval[];
  best: { label: string; hint: string; ev: VariantEval }[];
  rates: number[];
  /** Расходы буфера/цемента (с учётом предела затворения) */
  rates1: number[];
  bufferOptions: { volumeM3: number | null; density: number | null; label: string }[];
  /** Если ни один вариант не проходит — главная причина */
  blocker?: string;
}

// ─────────────────────────── Применение варианта ───────────────────────────

const setRate = (steps: FlowRateStep[], q: number) => steps.map((s) => ({ ...s, rateLps: q }));

/** Применить вариант к жидкостям программы (возвращает новые массивы, исходные не меняются). */
export function applyVariant(
  buffers: BufferFluid[], slurries: SlurryInput[], disps: DisplacementFluid[], v: ProgramVariant,
): { buffers: BufferFluid[]; slurries: SlurryInput[]; displacementFluids: DisplacementFluid[] } {
  const lastBuf = buffers.length - 1;
  const nb = buffers.map((b, i) => {
    let steps = setRate(b.flowRateSteps, v.q1);
    let volume = b.volume;
    let density = b.density;
    if (i === lastBuf && v.bufferVolumeM3 !== null) {
      const k = b.volume > 0 ? v.bufferVolumeM3 / b.volume : 1;
      volume = v.bufferVolumeM3;
      steps = steps.length === 1 ? [{ ...steps[0], volumeM3: volume }] : steps.map((s) => ({ ...s, volumeM3: s.volumeM3 * k }));
    }
    if (i === lastBuf && v.bufferDensity !== null) density = v.bufferDensity;
    return { ...b, volume, density, flowRateSteps: steps };
  });
  const ns = slurries.map((s) => ({ ...s, flowRateSteps: setRate(s.flowRateSteps, v.q1) }));
  // Продавка: основной расход — q2; финальная «посадочная» ступень (последняя, с меньшим расходом) сохраняется
  const allSteps = disps.flatMap((d, di) => d.flowRateSteps.map((st, si) => ({ di, si, st })));
  const last = allSteps[allSteps.length - 1];
  const keepLast = allSteps.length > 1 && last && last.st.rateLps < Math.max(...allSteps.slice(0, -1).map((x) => x.st.rateLps));
  const nd = disps.map((d, di) => ({
    ...d,
    flowRateSteps: d.flowRateSteps.map((st, si) => (keepLast && last.di === di && last.si === si ? st : { ...st, rateLps: v.q2 })),
  }));
  return { buffers: nb, slurries: ns, displacementFluids: nd };
}

/** Текущий вариант (как задано пользователем). */
export function currentVariant(p: ProgramInput): ProgramVariant {
  const q1 = p.slurries[0]?.flowRateSteps[0]?.rateLps || p.buffers[0]?.flowRateSteps[0]?.rateLps || 10;
  const dSteps = p.displacementFluids.flatMap((d) => d.flowRateSteps);
  const q2 = dSteps.length ? Math.max(...dSteps.map((s) => s.rateLps)) : q1;
  return { q1, q2, bufferVolumeM3: null, bufferDensity: null };
}

// ─────────────────────────── Оценка варианта ───────────────────────────

interface DFluid { density: number; rheology: Rheology; volumeM3?: number }

export interface DisplacementIndexResult {
  index: number;
  channelLengthM: number;
  limitingFactor: string;
  recommendations: string[];
  segments: { md: number; standoff: number; mobilitySpacer: number; mobilityCement: number; efficiency: number; limiting: string }[];
}

/** Предел текучести для критерия подвижности: τ0 Гершеля–Балкли, если есть Fann; иначе YP (с запасом). */
const yieldStress = (r: Rheology) => hbOf(r)?.tau0 ?? r.yp;

/**
 * Индекс вытеснения по глубине (критерии Lockyear–Couturier / Bittleston–Frigaard в инженерной форме):
 *  • подвижность на узкой стороне M = (dp/dL)·h_узк / (2·τy_вытесняемой), h_узк = h·standoff;
 *    dp/dL — градиент трения вытесняющей жидкости в эксцентричном зазоре при фактическом расходе;
 *    M ≥ 1 — раствор на узкой стороне движется, M < 1 — остаётся застойный канал;
 *  • альтернатива — турбулентный режим буфера при времени контакта ≥ 10 мин;
 *  • иерархия плотности (+10%) и иерархия градиента трения (+20%);
 *  • вращение колонны повышает подвижность (до ×1.8 при 20 об/мин).
 */
export function displacementIndex(
  p: ProgramInput,
  f: { rateLps: number; mud: DFluid; spacer: DFluid | null; cement: DFluid | null; rotationRpm: number },
  centr: CentralizationResult[],
): DisplacementIndexResult {
  const w = p.wellData;
  const rotK = Math.min(1.8, 1 + 0.04 * Math.max(0, f.rotationRpm));
  const grad = (fl: DFluid, outer: number, so: number) => {
    const r = annularFrictionMPa(f.rateLps, 1, outer, w.casingOD, fl.rheology.pv, fl.rheology.yp, fl.density, so, hbOf(fl.rheology));
    return { g: r.pressureMPa * 1e6, regime: r.regime }; // Па/м
  };
  const denS = (dIn: number, dOut: number) => { const r = dIn / Math.max(1, dOut); return r >= 1.1 ? 1 : r >= 1 ? 0.5 + (r - 1) * 5 : Math.max(0, 0.5 - (1 - r) * 3); };
  const frS = (gIn: number, gOut: number) => { const r = gIn / Math.max(1e-6, gOut); return r >= 1.2 ? 1 : r <= 0.8 ? 0.3 : 0.3 + ((r - 0.8) / 0.4) * 0.7; };
  const annArea = (outer: number) => (Math.PI / 4) * ((outer / 1000) ** 2 - (w.casingOD / 1000) ** 2);

  const pair = (inF: DFluid, outF: DFluid, outer: number, so: number, contactVol?: number) => {
    const h = (outer - w.casingOD) / 2 / 1000;
    const hN = h * Math.max(0.05, so / 100);
    const gIn = grad(inF, outer, so);
    const gOut = grad(outF, outer, so);
    const tauY = Math.max(0.1, yieldStress(outF.rheology));
    const M = ((gIn.g * hN) / (2 * tauY)) * rotK;
    const sMob = Math.min(1, M);
    const ct = contactVol && f.rateLps > 0 ? contactVol / (f.rateLps / 1000) / 60 : 0;
    const sTurb = gIn.regime >= 1 ? Math.min(1, ct / 10) : 0;
    const sFlow = Math.max(sMob, sTurb);
    const eff = sFlow * (0.75 + 0.25 * denS(inF.density, outF.density)) * (0.85 + 0.15 * frS(gIn.g, gOut.g));
    const limiting = sFlow < 0.8 ? "узкая сторона" : denS(inF.density, outF.density) < 0.8 ? "иерархия плотности" : frS(gIn.g, gOut.g) < 0.8 ? "иерархия трения" : "—";
    return { M, eff, limiting, area: annArea(outer) };
  };

  const segs: DisplacementIndexResult["segments"] = [];
  let wSum = 0, effSum = 0, channel = 0;
  const lim: Record<string, number> = {};
  for (let i = 0; i < centr.length; i++) {
    const c = centr[i];
    const len = i < centr.length - 1 ? centr[i + 1].md - c.md : i > 0 ? c.md - centr[i - 1].md : 1;
    const outer = c.md <= w.prevCasingDepth ? w.prevCasingID : w.holeDiameter * Math.sqrt(getCavernCoeffAtDepth(c.md, w.cavernCoeff, w.cavernIntervals));
    const so = c.standoff;
    const sp = f.spacer ? pair(f.spacer, f.mud, outer, so, f.spacer.volumeM3) : null;
    const ce = f.cement ? pair(f.cement, f.spacer ?? f.mud, outer, so) : null;
    const effSp = sp ? sp.eff : 0.6; // без буфера — штраф
    const eff = effSp * (ce ? 0.5 + 0.5 * ce.eff : 1);
    const limiting = sp && sp.eff <= (ce?.eff ?? 1) ? sp.limiting : ce?.limiting ?? "—";
    if (sp && sp.M < 1) channel += Math.max(0, len);
    segs.push({ md: c.md, standoff: so, mobilitySpacer: sp?.M ?? 0, mobilityCement: ce?.M ?? 0, efficiency: eff * 100, limiting });
    wSum += Math.max(0, len); effSum += Math.max(0, len) * eff;
    lim[limiting] = (lim[limiting] ?? 0) + Math.max(0, len);
  }
  const index = wSum > 0 ? (effSum / wSum) * 100 : 0;
  const limitingFactor = Object.entries(lim).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  const rec: string[] = [];
  if (channel > 0) rec.push(`На ${channel.toFixed(0)} м буровой раствор на узкой стороне зазора остаётся неподвижным — повысить отступ (центраторы), расход или включить вращение колонны.`);
  if (f.spacer && f.spacer.density < f.mud.density * 1.05) rec.push("Плотность буфера ниже рекомендуемой иерархии (+5…10% к раствору).");
  if (f.spacer && yieldStress(f.spacer.rheology) < yieldStress(f.mud.rheology)) rec.push("ДНС буфера ниже, чем у раствора: для ламинарного вытеснения нужна иерархия реологии.");
  if (!f.spacer) rec.push("Нет разделительного буфера — цемент контактирует с раствором напрямую.");
  return { index, channelLengthM: channel, limitingFactor, recommendations: rec, segments: segs };
}

function zenithAt(md: number, traj: { md: number; zenith: number }[]): number {
  if (traj.length === 0) return 0;
  if (md <= traj[0].md) return traj[0].zenith || 0;
  for (let i = 1; i < traj.length; i++) {
    if (md <= traj[i].md) {
      const a = traj[i - 1], b = traj[i];
      return (a.zenith || 0) + ((md - a.md) / Math.max(1e-6, b.md - a.md)) * ((b.zenith || 0) - (a.zenith || 0));
    }
  }
  return traj[traj.length - 1].zenith || 0;
}

/** Профиль центрирования по интервалу цементирования: из модуля центрирования или постоянный отступ. */
export function cementIntervalCentralization(p: ProgramInput): CentralizationResult[] {
  const top = Math.min(...p.slurries.map((s) => s.topDepthMD), p.wellData.casingDepthMD);
  const bottom = p.wellData.casingDepthMD;
  if (p.centralization && p.centralization.length > 0) {
    const inside = p.centralization.filter((c) => c.md >= top && c.md <= bottom);
    if (inside.length > 0) return inside;
  }
  const traj = getEffectiveTrajectory(p.wellData);
  const so = p.wellData.annularStandoffPct ?? 67;
  const out: CentralizationResult[] = [];
  const step = Math.max(10, (bottom - top) / 60);
  for (let md = top; md <= bottom + 1e-6; md += step) {
    out.push({
      md, tvd: interpolateTVD(md, traj), zenith: zenithAt(md, traj), eccentricity: 1 - so / 100, standoff: so,
      hasCentralizer: false, hasTurbulizer: false, turbulenceMultiplier: 1, intervalId: null,
    });
  }
  return out;
}

/** Средний расход в период, когда буфер/цемент находятся в затрубье и движутся. */
function effectiveAnnularRate(pr: PressureProfileResult, fallback: number): number {
  let wSum = 0, qSum = 0;
  const pts = pr.points;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const dt = p.time - pts[i - 1].time;
    if (dt <= 0 || p.pumpRateLps <= 0) continue;
    if (p.annBufferHeightM + p.annCementHeightM > 1) { wSum += dt; qSum += dt * p.pumpRateLps; }
  }
  return wSum > 0 ? qSum / wSum : fallback;
}

export function evaluateProgram(
  p: ProgramInput, v: ProgramVariant, settings: OptimizerSettings, vols?: VolumeResults, centr?: CentralizationResult[],
): VariantEval {
  const prog = applyVariant(p.buffers, p.slurries, p.displacementFluids, v);
  const volumes = vols ?? calculateVolumes(p.wellData, prog.slurries, prog.displacementFluids[0]?.compressionCoeff ?? 1);
  const pr = calculatePressureProfile(
    p.wellData, prog.slurries, prog.buffers, p.drillingFluid, prog.displacementFluids, p.fractureGradient,
    volumes.displacementVolumeWithCompression, p.flushTimeMin, p.flushVolumeM3, { fast: true },
  );
  const violations: Violation[] = [];

  // Запас по пластам
  let minMargin = Infinity, minMarginAt = "—", underbalance = 0;
  for (const z of pr.zoneChecks) {
    if (z.marginMPa < minMargin) { minMargin = z.marginMPa; minMarginAt = z.name; }
    if (z.porePressureMPa > 0 && z.minPressureMPa < z.porePressureMPa) underbalance = Math.max(underbalance, z.porePressureMPa - z.minPressureMPa);
  }
  if (!Number.isFinite(minMargin)) minMargin = 0;
  if (minMargin < settings.marginReqMPa) violations.push("ГРП/поглощение");
  if (underbalance > 0) violations.push("проявление");

  // Давление на устье
  const maxSurface = pr.points.reduce((m, x) => Math.max(m, x.surfacePressure), 0);
  if (maxSurface > settings.pumpPressureLimitMPa) violations.push("давление на устье");

  // Время загустевания
  const lab = buildLabProgram(p.wellData, prog.slurries, pr, volumes);
  let thickReserve = Infinity;
  lab.slurries.forEach((ls, i) => {
    const tt = prog.slurries[i].thickeningTime30Bc || 0;
    if (tt > 0) thickReserve = Math.min(thickReserve, tt - ls.requiredThickeningMin);
  });
  if (thickReserve < 0) violations.push("загустевание");
  const jobTime = pr.points.length ? pr.points[pr.points.length - 1].time : 0;

  // Качество вытеснения — критерий подвижности раствора на узкой стороне
  const effRate = effectiveAnnularRate(pr, v.q2);
  const spacerSrc = prog.buffers[prog.buffers.length - 1];
  const tail = prog.slurries[prog.slurries.length - 1];
  const dei = displacementIndex(p, {
    rateLps: effRate,
    mud: { density: p.drillingFluid.density, rheology: p.drillingFluid.rheology },
    spacer: spacerSrc ? { density: spacerSrc.density, rheology: spacerSrc.rheology, volumeM3: spacerSrc.volume } : null,
    cement: tail ? { density: tail.density * 1000, rheology: tail.rheology } : null,
    rotationRpm: settings.rotationRpm,
  }, centr ?? cementIntervalCentralization(p));

  return {
    variant: v, feasible: violations.length === 0, violations, mrei: dei.index, channelLengthM: dei.channelLengthM,
    minMarginMPa: minMargin, minMarginAt, underbalanceMPa: underbalance, maxSurfaceMPa: maxSurface,
    jobTimeMin: jobTime, thickeningReserveMin: thickReserve, effAnnRateLps: effRate, limitingFactor: dei.limitingFactor,
    recommendations: dei.recommendations,
  };
}

// ─────────────────────────── Варианты буфера ───────────────────────────

/** Варианты разделительного буфера: текущий; по иерархии плотности; по времени контакта / высоте. */
export function bufferOptions(p: ProgramInput, settings: OptimizerSettings): OptimizerResult["bufferOptions"] {
  const opts: OptimizerResult["bufferOptions"] = [{ volumeM3: null, density: null, label: "как задан" }];
  if (!settings.optimizeBuffer || p.buffers.length === 0 || p.slurries.length === 0) return opts;
  const b = p.buffers[p.buffers.length - 1];
  const lead = p.slurries[0];
  const mudRho = p.drillingFluid.density;
  const leadRho = lead.density * 1000;
  // Иерархия: буфер на ~10% тяжелее раствора, но легче головного цемента минимум на 50 кг/м³
  const hierRho = Math.round(Math.min(mudRho * 1.1, leadRho - 50) / 10) * 10;
  // Высота буфера в затрубье у башмака ≥ 250 м (или время контакта ≥ 10 мин при 15 л/с)
  const bottom = p.wellData.casingDepthMD;
  const v250 = annularVolumeForInterval(
    Math.max(0, bottom - 250), bottom, p.wellData.holeDiameter, p.wellData.casingOD, p.wellData.prevCasingID,
    p.wellData.prevCasingDepth, p.wellData.cavernCoeff, p.wellData.cavernIntervals,
  );
  const vContact = (15 * 600) / 1000; // 10 мин × 15 л/с
  const vRec = Math.ceil(Math.max(v250, vContact) * 2) / 2;
  const densOk = hierRho > b.density + 5 && hierRho > mudRho;
  if (densOk) opts.push({ volumeM3: null, density: hierRho, label: `ρ ${hierRho} кг/м³` });
  if (vRec > b.volume + 0.4) opts.push({ volumeM3: vRec, density: null, label: `${vRec} м³` });
  if (densOk && vRec > b.volume + 0.4) opts.push({ volumeM3: vRec, density: hierRho, label: `${vRec} м³, ρ ${hierRho}` });
  return opts;
}

// ─────────────────────────── Оптимизация ───────────────────────────

export function optimizerRates(s: OptimizerSettings): number[] {
  const out: number[] = [];
  for (let q = s.minRateLps; q <= s.maxRateLps + 1e-9; q += s.rateStepLps) out.push(Math.round(q * 10) / 10);
  return out;
}

/**
 * Перебор. onProgress вызывается после каждой оценки; между пачками управление отдаётся браузеру.
 */
export async function runOptimizer(
  p: ProgramInput, settings: OptimizerSettings, onProgress?: (done: number, total: number) => void,
): Promise<OptimizerResult> {
  const rates = optimizerRates(settings);
  const bOpts = bufferOptions(p, settings);
  const centr = cementIntervalCentralization(p);
  const cur = currentVariant(p);
  const current = evaluateProgram(p, cur, settings, undefined, centr);

  const total = bOpts.length * rates.filter((q) => q <= settings.maxCementRateLps + 1e-9).length * rates.length;
  const evaluations: VariantEval[] = [];
  let i = 0;
  const rates1 = rates.filter((q) => q <= settings.maxCementRateLps + 1e-9);
  for (const bo of bOpts) for (const q1 of rates1) {
    // Давление растёт с расходом продавки: если при q2 превышен предел ГРП/устья, при больших q2 — тоже
    let frictionFail: VariantEval | null = null;
    for (const q2 of rates) {
      const v: ProgramVariant = { q1, q2, bufferVolumeM3: bo.volumeM3, bufferDensity: bo.density };
      if (frictionFail) {
        evaluations.push({ ...frictionFail, variant: v, pruned: true, mrei: NaN });
      } else {
        const ev = evaluateProgram(p, v, settings, undefined, centr);
        evaluations.push(ev);
        if (ev.violations.includes("ГРП/поглощение") || ev.violations.includes("давление на устье")) {
          frictionFail = { ...ev, violations: ev.violations.filter((x) => x === "ГРП/поглощение" || x === "давление на устье"), feasible: false };
        }
        if (++i % 6 === 0) await new Promise((r) => setTimeout(r, 0));
      }
      onProgress?.(evaluations.length, total);
    }
  }
  return { current, evaluations, rates, rates1: rates.filter((q) => q <= settings.maxCementRateLps + 1e-9), bufferOptions: bOpts, best: pickVariants(evaluations, settings), blocker: findBlocker(evaluations) };
}

function findBlocker(evs: VariantEval[]): string | undefined {
  if (evs.some((e) => e.feasible)) return undefined;
  const count: Record<string, number> = {};
  evs.forEach((e) => e.violations.forEach((v) => { count[v] = (count[v] ?? 0) + 1; }));
  const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  const msg: Record<string, string> = {
    "ГРП/поглощение": "Ни при одном расходе давление не укладывается в окно ГРП/поглощения с требуемым запасом. Нужны облегчённый цемент, снижение высоты подъёма, двухступенчатое цементирование или уменьшение требуемого запаса.",
    "проявление": "Во всех вариантах давление в затрубье в покое опускается ниже пластового. Увеличьте плотность буфера/облегчённого цемента.",
    "загустевание": "Время загустевания цемента меньше требуемого при любом расходе. Нужна корректировка замедлителя (больше времени загустевания).",
    "давление на устье": "Предел давления на устье превышается во всех вариантах. Проверьте предел агрегатов или уменьшите максимальный расход.",
  };
  return top ? msg[top[0]] : undefined;
}

/** Три варианта: максимум качества, баланс (запас ≥ 1.5 МПа и ≥ 30 мин по загустеванию), минимум риска. */
export function pickVariants(evs: VariantEval[], settings: OptimizerSettings): OptimizerResult["best"] {
  const feas = evs.filter((e) => e.feasible);
  if (feas.length === 0) return [];
  const q = (x: number) => Math.round(x * 2) / 2; // качество с точностью 0.5%
  const byQuality = [...feas].sort((a, b) => q(b.mrei) - q(a.mrei) || a.channelLengthM - b.channelLengthM || b.minMarginMPa - a.minMarginMPa || a.jobTimeMin - b.jobTimeMin);
  const top = byQuality[0];
  const out: OptimizerResult["best"] = [{ label: "Максимум качества", hint: "Наибольший индекс вытеснения при соблюдении всех ограничений", ev: top }];

  const balMargin = Math.max(1.5, settings.marginReqMPa);
  const bal = byQuality.find((e) => e.minMarginMPa >= balMargin && e.thickeningReserveMin >= 30 && e.mrei >= top.mrei * 0.9);
  if (bal && !sameVariant(bal, top)) out.push({ label: "Сбалансированный", hint: `Запас по пластам ≥ ${balMargin} МПа и по загустеванию ≥ 30 мин, качество не ниже 90% от максимума`, ev: bal });

  const r1 = (x: number) => Math.round(x * 10) / 10;
  const safe = [...feas].filter((e) => e.mrei >= top.mrei * 0.85)
    .sort((a, b) => r1(b.minMarginMPa) - r1(a.minMarginMPa) || Math.min(b.thickeningReserveMin, 600) - Math.min(a.thickeningReserveMin, 600) || b.mrei - a.mrei)[0];
  if (safe && !out.some((o) => sameVariant(o.ev, safe))) out.push({ label: "Минимум риска", hint: "Наибольший запас до ГРП/поглощения при качестве не ниже 85% от максимума", ev: safe });
  return out;
}

const sameVariant = (a: VariantEval, b: VariantEval) =>
  a.variant.q1 === b.variant.q1 && a.variant.q2 === b.variant.q2 && a.variant.bufferVolumeM3 === b.variant.bufferVolumeM3 && a.variant.bufferDensity === b.variant.bufferDensity;
