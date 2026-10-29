/**
 * Coiled Tubing (ГНКТ) Engineering Calculations
 * Based on CoilCADE methodology (Schlumberger)
 * Modules: Tubing Forces, CoilLIMIT, Hydraulics, CoilLIFE
 * 
 * All depth-dependent pressures use TVD (True Vertical Depth).
 * Trajectory: MD / Azimuth / Zenith / TVD (same as Cementing & Cement Plug modules).
 */

import { calculateTVDFromSurvey, interpolateTVD, type TrajectoryPoint } from "./cementing-calculations";
import {
  CT_SURFACE_DEFAULTS, forceModel, scanReach, stringLength, pipeFromBottom, ctHydraulics,
  strengthOf, collapseWithAxial, vonMisesLame, workingEnvelope, type CTSurfaceOptions, type EnvelopeRow,
} from "./ct-engine";

export type { CTSurfaceOptions };
export { CT_SURFACE_DEFAULTS };

export type { TrajectoryPoint };
export { calculateTVDFromSurvey, interpolateTVD };

// ─── Data Types ───

export interface CTStringData {
  od: number;          // Outer diameter, mm
  wall: number;        // Wall thickness, mm
  grade: string;       // Steel grade: CT-70, CT-80, CT-90, CT-110
  length: number;      // String length on reel, m
  ovality: number;     // Ovality %, 0-10
}

export interface CTSection {
  id: string;
  od: number;          // Outer diameter, mm
  wall: number;        // Wall thickness, mm
  length: number;      // Section length, m
}

export interface WellGeometry {
  md: number;          // Measured depth, m
  tvd: number;         // True vertical depth, m (auto-calculated from trajectory)
  casingID: number;    // Casing inner diameter, mm
  tubingID: number;    // Tubing inner diameter (if inside tubing), mm — 0 if open hole / casing
  wellheadPressure: number; // Wellhead pressure, MPa
  bhst: number;        // Bottom hole static temperature, °C
  bhct: number;        // Bottom hole circulating temperature, °C
  whTemp: number;      // Wellhead temperature, °C
  fracGradient: number; // Frac gradient, MPa/m
  trajectory: TrajectoryPoint[];
}

export interface FluidData {
  name: string;
  density: number;     // g/cm³
  pv: number;          // Plastic viscosity, cP
  yp: number;          // Yield point, Pa
  nIndex: number;      // Power-law n
  kIndex: number;      // Power-law K, Pa·s^n
}

export interface PumpData {
  flowRate: number;    // л/с
  surfacePressure: number; // MPa (calculated)
}

export interface ToolsData {
  bhaWeight: number;   // BHA weight in air, kg
  bhaLength: number;   // BHA length, m
  bhaOD: number;       // BHA OD, mm
  nozzleDiam: number;  // Jet nozzle diameter, mm
  nozzleCount: number; // Number of nozzles
}

// ─── Constants ───

const GRAVITY = 9.81;
const STEEL_DENSITY = 7850;

/** Yield strength by grade, MPa */
export const GRADE_YIELD: Record<string, number> = {
  "CT-70": 483,
  "CT-80": 552,
  "CT-90": 621,
  "CT-110": 758,
};

/** Reel & guide arch diameters for fatigue, m */
export const REEL_DIAMETERS: Record<string, number> = {
  small: 1.37,
  medium: 1.83,
  large: 2.44,
};
export const GUIDE_ARCH_DIAMETER = 1.83;



// ─── Utility ───

/**
 * Build a synthetic J-type trajectory when no survey is entered.
 * If MD > TVD, calculates an average inclination to honour the TVD input.
 * This ensures friction forces differ between RIH and POOH.
 */
export function buildSyntheticTrajectory(md: number, tvd: number): TrajectoryPoint[] {
  if (md <= 0) return [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }];
  if (tvd >= md || tvd <= 0) {
    // Vertical well
    return [
      { md: 0, azimuth: 0, zenith: 0, tvd: 0 },
      { md, azimuth: 0, zenith: 0, tvd: md },
    ];
  }
  // J-type: vertical section then build angle
  // Average inclination = acos(TVD / MD)
  const avgIncDeg = Math.acos(tvd / md) * (180 / Math.PI);
  // KOP at ~30% of MD (kick-off point)
  const kop = md * 0.3;
  const tvdAtKop = kop; // vertical above KOP
  const remainingMD = md - kop;
  const remainingTVD = tvd - tvdAtKop;
  const incDeg = remainingTVD > 0 && remainingMD > 0
    ? Math.acos(Math.min(1, remainingTVD / remainingMD)) * (180 / Math.PI)
    : avgIncDeg;
  const steps = 10;
  const pts: TrajectoryPoint[] = [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }];
  for (let i = 1; i <= steps; i++) {
    const frac = i / steps;
    const curMD = md * frac;
    let curZenith: number;
    let curTVD: number;
    if (curMD <= kop) {
      curZenith = 0;
      curTVD = curMD;
    } else {
      const buildFrac = (curMD - kop) / remainingMD;
      curZenith = incDeg * Math.min(1, buildFrac * 1.5); // ramp up
      curTVD = tvdAtKop + (curMD - kop) * Math.cos(curZenith * Math.PI / 180);
    }
    pts.push({ md: Math.round(curMD), azimuth: 0, zenith: Math.round(curZenith * 10) / 10, tvd: Math.round(curTVD * 10) / 10 });
  }
  // Correct last point TVD to match input
  pts[pts.length - 1].tvd = tvd;
  return pts;
}

export function ctID(od: number, wall: number): number {
  return od - 2 * wall;
}

function ctCrossSectionArea(od: number, wall: number): number {
  const odM = od / 1000;
  const idM = ctID(od, wall) / 1000;
  return (Math.PI / 4) * (odM * odM - idM * idM);
}

function ctInternalArea(od: number, wall: number): number {
  const idM = ctID(od, wall) / 1000;
  return (Math.PI / 4) * idM * idM;
}

/** Linear weight of CT in air, kg/m */
export function ctWeightPerMeter(od: number, wall: number): number {
  return ctCrossSectionArea(od, wall) * STEEL_DENSITY;
}

/** Get TVD at a given MD from trajectory (linear interpolation) */
function getTVDatMD(trajectory: TrajectoryPoint[], md: number): number {
  if (!trajectory || trajectory.length === 0) return md;
  const sorted = [...trajectory].sort((a, b) => a.md - b.md);
  if (md <= sorted[0].md) return sorted[0].tvd;
  if (md >= sorted[sorted.length - 1].md) return sorted[sorted.length - 1].tvd;
  for (let i = 1; i < sorted.length; i++) {
    if (md <= sorted[i].md) {
      const frac = (md - sorted[i - 1].md) / (sorted[i].md - sorted[i - 1].md);
      return sorted[i - 1].tvd + frac * (sorted[i].tvd - sorted[i - 1].tvd);
    }
  }
  return sorted[sorted.length - 1].tvd;
}

/** Get inclination (zenith) at a given MD */
function getIncAtMD(trajectory: TrajectoryPoint[], md: number): number {
  if (!trajectory || trajectory.length < 2) return 0;
  const sorted = [...trajectory].sort((a, b) => a.md - b.md);
  if (md <= sorted[0].md) return sorted[0].zenith;
  if (md >= sorted[sorted.length - 1].md) return sorted[sorted.length - 1].zenith;
  for (let i = 1; i < sorted.length; i++) {
    if (md <= sorted[i].md) {
      const frac = (md - sorted[i - 1].md) / (sorted[i].md - sorted[i - 1].md);
      return sorted[i - 1].zenith + frac * (sorted[i].zenith - sorted[i - 1].zenith);
    }
  }
  return sorted[sorted.length - 1].zenith;
}

// ─── Module 1: Tubing Forces ───
// Расчёт — в ct-engine.ts (эффективные силы, 3D, изгиб колонны, устье, уплотнитель, инжектор).

export interface ForceResult {
  weightInAir: number;
  buoyancyFactor: number;
  weightInFluid: number;
  /** суммарная сила трения при спуске / подъёме на полную глубину, кН */
  dragForceRIH: number;
  dragForcePOOH: number;
  /** показания индикатора веса на полной глубине (с давлением устья и уплотнителем), кН */
  surfaceLoadRIH: number;
  surfaceLoadPOOH: number;
  /** без движения, кН */
  surfaceLoadStatic: number;
  helicalBucklingLoad: number;
  sinusoidalBucklingLoad: number;
  /** первая глубина, где спуск невозможен (0 — доходит до полной глубины) */
  lockUpDepth: number;
  lockUpReason: "helical" | "injector" | null;
  helicalLockDepth: number;
  injectorLimitDepth: number;
  /** сила выталкивания давлением устья (P·A наружн.), кН */
  pressureAreaForce: number;
  /** трение в уплотнителе, кН */
  stripperFriction: number;
  /** глубина равновесия: выше неё при спуске трубу проталкивают (0 — не требуется) */
  pipeLightDepth: number;
  /** интервалы глубины КНБК, где требуется проталкивание */
  snubIntervals: [number, number][];
  /** спуск на полную глубину невозможен (запирание) */
  rihLocked: boolean;
  /** максимальное требуемое проталкивание при спуске, кН */
  maxSnubRequired: number;
  /** максимальное требуемое тяговое усилие инжектора при подъёме (с натяжением барабана), кН */
  maxPullRequired: number;
  injectorPullKN: number;
  injectorSnubKN: number;
  /** доступная нагрузка на забой на полной глубине: при полном проталкивании / без проталкивания, кН */
  wobMaxAtTD: number;
  wobNoSnubAtTD: number;
  /** интервал спирального изгиба при спуске на полную глубину, м (null — нет) */
  helicalZone: [number, number] | null;
  sinusoidalZone: [number, number] | null;
  /** глубина, до которой выполнен расчёт (min(длина ГНКТ, MD)) */
  deployDepth: number;
}

export interface DepthForcePoint {
  depth: number;
  tvd: number;
  axialRIH: number;
  axialPOOH: number;
  axialStatic: number;
  /** критические силы сжатия (отрицательные), кН */
  bucklingLimit: number;
  helicalLimit: number;
  /** 0 — нет изгиба, 1 — синусоидальный, 2 — спиральный (при спуске) */
  buckleRIH: number;
}

export interface HookLoadPoint {
  depth: number;
  tvd: number;
  hookRIH_kgf: number;
  hookPOOH_kgf: number;
  hookStatic_kgf: number;
  hookRIH_kN: number;
  hookPOOH_kN: number;
  hookStatic_kN: number;
  yieldLimit80_kgf: number;
  bucklingLimit_kgf: number;
  /** пределы инжектора: проталкивание (−) и тяга (+), кгс */
  snubLimit_kgf: number;
  pullLimit_kgf: number;
  /** доступная нагрузка на забой (при полном проталкивании / без него), кН */
  wobMax_kN: number;
  wobNoSnub_kN: number;
  locked: boolean;
}

const kgf = (n: number) => Math.round(n / GRAVITY);

function forceSetup(ct: CTStringData, well: WellGeometry, fluid: FluidData, tools: ToolsData, frictionCoeff: number, sections?: CTSection[], opts: CTSurfaceOptions = {}) {
  const o = { ...CT_SURFACE_DEFAULTS, ...opts };
  const model = forceModel(ct, sections, well, fluid, tools.bhaWeight, frictionCoeff, o);
  const maxD = Math.min(stringLength(ct, sections), well.md);
  return { o, model, maxD };
}

export function calculateTubingForces(
  ct: CTStringData,
  well: WellGeometry,
  fluid: FluidData,
  tools: ToolsData,
  frictionCoeff: number = 0.25,
  sections?: CTSection[],
  opts: CTSurfaceOptions = {},
): ForceResult {
  const { o, model, maxD } = forceSetup(ct, well, fluid, tools, frictionCoeff, sections, opts);
  const total = stringLength(ct, sections);
  let wAir = 0;
  for (let x = 0; x < total; x += 10) wAir += pipeFromBottom(ct, sections, x + 5).wAir * Math.min(10, total - x);
  const bhaN = tools.bhaWeight * GRAVITY;
  const buoyancyFactor = 1 - (fluid.density * 1000) / STEEL_DENSITY;
  const scan = scanReach(model, maxD, 50, false, o.injectorSnubKN);
  const td = model.snapshot(maxD, true);
  // зоны изгиба и трение — на последней достижимой глубине
  const evalD = scan.lockUpDepth > 0 ? Math.max(1, scan.lockUpDepth * 0.97) : maxD;
  const prof = model.profile(evalD);
  const n = prof.st.length - 1;
  const zone = (state: number): [number, number] | null => {
    let a = -1, b = -1;
    for (let i = 0; i <= n; i++) if (prof.rih.buckle[i] >= state) { if (a < 0) a = prof.st[i].md; b = prof.st[i].md; }
    return a < 0 ? null : [Math.round(a), Math.round(b)];
  };
  return {
    weightInAir: (wAir + bhaN) / 1000,
    buoyancyFactor,
    weightInFluid: ((wAir + bhaN) * buoyancyFactor) / 1000,
    dragForceRIH: prof.rih.drag / 1000,
    dragForcePOOH: prof.pooh.drag / 1000,
    surfaceLoadRIH: Number.isFinite(td.wiRIH) ? td.wiRIH : -o.injectorSnubKN,
    rihLocked: !Number.isFinite(td.wiRIH) || scan.lockUpDepth > 0,
    surfaceLoadPOOH: td.wiPOOH,
    surfaceLoadStatic: td.wiStatic,
    sinusoidalBucklingLoad: (prof.rih.fSin[n] ?? 0) / 1000,
    helicalBucklingLoad: (prof.rih.fHel[n] ?? 0) / 1000,
    lockUpDepth: scan.lockUpDepth,
    lockUpReason: scan.lockUpReason,
    helicalLockDepth: scan.helicalLockDepth,
    injectorLimitDepth: scan.injectorLimitDepth,
    pressureAreaForce: model.pressureForceN / 1000,
    stripperFriction: model.stripperN / 1000,
    pipeLightDepth: scan.pipeLightDepth,
    snubIntervals: scan.snubIntervals,
    maxSnubRequired: Math.max(scan.maxSnubRequired, Number.isFinite(td.wiRIH) ? -td.wiRIH : 0),
    maxPullRequired: Math.max(scan.maxPullRequired, td.pullRequired),
    injectorPullKN: o.injectorPullKN,
    injectorSnubKN: o.injectorSnubKN,
    wobMaxAtTD: td.wobMax,
    wobNoSnubAtTD: td.wobNoSnub,
    helicalZone: zone(2),
    sinusoidalZone: zone(1),
    deployDepth: maxD,
  };
}

/** Индикатор веса по глубине КНБК (спуск / подъём / без движения) + доступная нагрузка на забой. */
export function generateHookLoadProfile(
  ct: CTStringData,
  well: WellGeometry,
  fluid: FluidData,
  tools: ToolsData,
  frictionCoeff: number = 0.25,
  sections?: CTSection[],
  steps: number = 50,
  opts: CTSurfaceOptions = {},
): HookLoadPoint[] {
  const { o, model, maxD } = forceSetup(ct, well, fluid, tools, frictionCoeff, sections, opts);
  const yieldStrength = GRADE_YIELD[ct.grade] || 552;
  const y80 = yieldStrength * ctCrossSectionArea(ct.od, ct.wall) * 1e6 * 0.8;
  const scan = scanReach(model, maxD, steps, true, o.injectorSnubKN);
  const pts: HookLoadPoint[] = [{
    depth: 0, tvd: 0, hookRIH_kgf: kgf(-model.pressureForceN - model.stripperN), hookPOOH_kgf: kgf(-model.pressureForceN + model.stripperN), hookStatic_kgf: kgf(-model.pressureForceN),
    hookRIH_kN: Math.round((-model.pressureForceN - model.stripperN) / 100) / 10, hookPOOH_kN: Math.round((-model.pressureForceN + model.stripperN) / 100) / 10, hookStatic_kN: Math.round(-model.pressureForceN / 100) / 10,
    yieldLimit80_kgf: kgf(y80), bucklingLimit_kgf: 0, snubLimit_kgf: kgf(-o.injectorSnubKN * 1000), pullLimit_kgf: kgf(o.injectorPullKN * 1000),
    wobMax_kN: 0, wobNoSnub_kN: 0, locked: false,
  }];
  const prof = model.profile(maxD);
  for (const s of scan.depths) {
    const rih = Number.isFinite(s.wiRIH) ? s.wiRIH : NaN;
    const k = Math.min(prof.st.length - 1, Math.max(0, Math.round((s.md / maxD) * (prof.st.length - 1))));
    pts.push({
      depth: Math.round(s.md), tvd: Math.round(s.tvd * 10) / 10,
      hookRIH_kgf: Number.isFinite(rih) ? kgf(rih * 1000) : (null as unknown as number),
      hookPOOH_kgf: kgf(s.wiPOOH * 1000), hookStatic_kgf: kgf(s.wiStatic * 1000),
      hookRIH_kN: Number.isFinite(rih) ? Math.round(rih * 10) / 10 : (null as unknown as number),
      hookPOOH_kN: Math.round(s.wiPOOH * 10) / 10, hookStatic_kN: Math.round(s.wiStatic * 10) / 10,
      yieldLimit80_kgf: kgf(y80), bucklingLimit_kgf: kgf(-(prof.rih.fHel[k] ?? 0)),
      snubLimit_kgf: kgf(-o.injectorSnubKN * 1000), pullLimit_kgf: kgf(o.injectorPullKN * 1000),
      wobMax_kN: Math.round(s.wobMax * 10) / 10, wobNoSnub_kN: Math.round(s.wobNoSnub * 10) / 10,
      locked: s.helicalLock || s.injectorLimited,
    });
  }
  return pts;
}

/** Распределение эффективной осевой силы по стволу при КНБК на полной глубине. */
export function generateForceDepthProfile(
  ct: CTStringData,
  well: WellGeometry,
  fluid: FluidData,
  tools: ToolsData,
  frictionCoeff: number = 0.25,
  steps: number = 80,
  sections?: CTSection[],
  opts: CTSurfaceOptions = {},
  /** глубина КНБК для профиля (по умолчанию — полная глубина; при запирании — чуть выше него) */
  atDepth?: number,
): DepthForcePoint[] {
  const { model, maxD } = forceSetup(ct, well, fluid, tools, frictionCoeff, sections, opts);
  const prof = model.profile(atDepth && atDepth > 0 ? Math.min(atDepth, maxD) : maxD);
  const n = prof.st.length - 1;
  const every = Math.max(1, Math.floor(n / steps));
  const out: DepthForcePoint[] = [];
  for (let i = 0; i <= n; i += every) {
    const fin = (x: number) => (Number.isFinite(x) && Math.abs(x) < 1e9 ? Math.round(x / 100) / 10 : (null as unknown as number));
    out.push({
      depth: Math.round(prof.st[i].md), tvd: Math.round(prof.st[i].tvd * 10) / 10,
      axialRIH: prof.rih.diverged && prof.st[i].md <= prof.rih.divergedAt ? (null as unknown as number) : fin(prof.rih.F[i]),
      axialPOOH: fin(prof.pooh.F[i]), axialStatic: fin(prof.stat.F[i]),
      bucklingLimit: Number.isFinite(prof.rih.fSin[i]) ? -Math.round(prof.rih.fSin[i] / 100) / 10 : (null as unknown as number),
      helicalLimit: Number.isFinite(prof.rih.fHel[i]) ? -Math.round(prof.rih.fHel[i] / 100) / 10 : (null as unknown as number),
      buckleRIH: prof.rih.buckle[i],
    });
    if (i + every > n && i !== n) i = n - every;
  }
  return out;
}

// ─── Module 2: CoilLIMIT (API RP 5C7) ───

export interface LimitResult {
  burstPressure: number;
  collapsePressure: number;
  collapseWithOvality: number;
  /** смятие с овальностью при заданной осевой нагрузке (растяжение снижает), МПа */
  collapseAtLoad: number;
  yieldTension: number;
  yieldCompression: number;
  vonMisesRatio: number;
  maxWorkingPressure: number;
  maxWorkingTension: number;
  /** минимальная толщина стенки с учётом износа, мм */
  minWall: number;
  /** коэффициент снижения предела текучести по температуре */
  tempDerate: number;
  collapseRegime: string;
}

export function calculateLimits(
  ct: CTStringData,
  internalPressure: number = 0,
  externalPressure: number = 0,
  axialLoad: number = 0,
  opts: { wallLossPct?: number; tempC?: number } = {},
): LimitResult {
  const derate = opts.tempC !== undefined ? tempDeratingFactor(opts.tempC) : 1;
  const s = strengthOf(ct.od, ct.wall, ct.grade, ct.ovality, opts.wallLossPct ?? 0, derate);
  const cAx = collapseWithAxial(ct.od, ct.wall, ct.grade, ct.ovality, Math.max(0, axialLoad), opts.wallLossPct ?? 0, derate);
  const vm = vonMisesLame(ct.od, s.tMin, Math.max(0, internalPressure), Math.max(0, externalPressure), axialLoad);
  const regime = s.collapseYield < s.collapseElastic * 0.5 ? "пластическое (по пределу текучести)" : s.collapseElastic < s.collapseYield * 0.5 ? "упругое" : "переходное (упругопластическое)";
  return {
    burstPressure: Math.round(s.burst * 100) / 100,
    collapsePressure: Math.round(s.collapse * 100) / 100,
    collapseWithOvality: Math.round(s.collapseOval * 100) / 100,
    collapseAtLoad: Math.round(cAx * 100) / 100,
    yieldTension: Math.round(s.yieldTensionKN * 100) / 100,
    yieldCompression: Math.round(s.yieldTensionKN * 100) / 100,
    vonMisesRatio: Math.round((vm / s.yieldMPa) * 1000) / 1000,
    maxWorkingPressure: Math.round(s.burst * 0.8 * 100) / 100,
    maxWorkingTension: Math.round(s.yieldTensionKN * 0.8 * 100) / 100,
    minWall: Math.round(s.tMin * 100) / 100,
    tempDerate: Math.round(derate * 1000) / 1000,
    collapseRegime: regime,
  };
}

export type { EnvelopeRow };

/** Диаграмма допустимых нагрузок (CoilLIMIT): предел (Мизес 100%) и рабочая (80%). */
export function generatePressureLoadEnvelope(ct: CTStringData, opts: { wallLossPct?: number; tempC?: number } = {}): EnvelopeRow[] {
  const derate = opts.tempC !== undefined ? tempDeratingFactor(opts.tempC) : 1;
  return workingEnvelope(ct.od, ct.wall, ct.grade, ct.ovality, opts.wallLossPct ?? 0, derate);
}

export interface OperatingPathPoint { axialLoad: number; dp: number; md: number; label?: string }

/**
 * Путь нагрузок на диаграмме пределов: истинная осевая сила и перепад давления (внутр. − наруж.) по стволу
 * при КНБК на полной глубине и циркуляции; первая точка — труба на барабане / над уплотнителем.
 */
export function generateOperatingPath(
  ct: CTStringData, well: WellGeometry, fluid: FluidData, tools: ToolsData, frictionCoeff: number,
  sections: CTSection[] | undefined, hyd: Pick<HydraulicsResult, "pumpPressure" | "dpReel" | "dpLines" | "dpCTDeployed" | "dpAnnulus">, opts: CTSurfaceOptions = {},
  atDepth?: number,
): { rih: OperatingPathPoint[]; pooh: OperatingPathPoint[] } {
  const pumpPressure = hyd.pumpPressure, dpInsideDeployed = hyd.dpCTDeployed, dpAnn = hyd.dpAnnulus;
  const { o, model, maxD: fullD } = forceSetup(ct, well, fluid, tools, frictionCoeff, sections, opts);
  const maxD = atDepth && atDepth > 0 ? Math.min(atDepth, fullD) : fullD;
  const prof = model.profile(maxD);
  const n = prof.st.length - 1;
  const rho = fluid.density * 1000;
  // давление внутри ГНКТ на устье = давление насоса − потери в линиях и в навитой на барабан части
  const pIn0 = pumpPressure - hyd.dpReel - hyd.dpLines;
  const mk = (F: number[], dir: number): OperatingPathPoint[] => {
    const out: OperatingPathPoint[] = [];
    const surf = F[0];
    const wiTop = surf - model.pressureForceN + dir * model.stripperN;
    out.push({ axialLoad: Math.round((wiTop + o.reelBackTensionKN * 1000) / 100) / 10, dp: Math.round(pumpPressure * 10) / 10, md: 0, label: "барабан" });
    const every = Math.max(1, Math.floor(n / 40));
    for (let i = 0; i <= n; i += every) {
      const s = prof.st[i], p = prof.pipes[i];
      const pi = pIn0 + (rho * GRAVITY * s.tvd) / 1e6 - dpInsideDeployed * (s.md / Math.max(1, maxD));
      const po = well.wellheadPressure + (rho * GRAVITY * s.tvd) / 1e6 + dpAnn * (1 - s.md / Math.max(1, maxD));
      const Ftrue = F[i] - po * 1e6 * p.ao + pi * 1e6 * p.ai;
      if (!Number.isFinite(Ftrue) || Math.abs(Ftrue) > 1e9) continue;
      out.push({ axialLoad: Math.round(Ftrue / 100) / 10, dp: Math.round((pi - po) * 10) / 10, md: Math.round(s.md) });
    }
    return out;
  };
  return { rih: mk(prof.rih.F, -1), pooh: mk(prof.pooh.F, 1) };
}

// ─── Module 3: Hydraulics ───

export interface HydraulicsResult {
  /** потери внутри ГНКТ: спущенная часть + навитая на барабане + линии, МПа */
  dpInsideCT: number;
  dpCTDeployed: number;
  dpReel: number;
  dpLines: number;
  dpAnnulus: number;
  dpNozzle: number;
  /** сумма потерь на трение (без устьевого давления), МПа */
  dpTotal: number;
  /** давление насоса = P устья + все потери, МПа */
  pumpPressure: number;
  hydrostaticInside: number;
  hydrostaticAnnulus: number;
  bhCircPressure: number;
  velocityInCT: number;
  velocityAnnulus: number;
  reynoldsInCT: number;
  reynoldsAnnulus: number;
  flowRegimeCT: string;
  flowRegimeAnnulus: string;
  /** эквивалентная циркуляционная плотность (без устьевого давления), г/см³ */
  ecdAtTD: number;
  minTransportVelocity: number;
  transportOk: boolean;
  fracPressureAtTD: number;
  fracSafetyFactor: number;
  rheologyModel: string;
  reelLengthM: number;
  annulusSegments: { from: number; to: number; holeIdMm: number; velocity: number; regime: string; dp: number }[];
  warnings: string[];
}

export interface HydraulicsChartPoint {
  flowRate: number;
  dpCT: number;
  dpReel: number;
  dpAnn: number;
  dpNozzle: number;
  dpTotal: number;
  pumpPressure: number;
}

export function calculateHydraulics(
  ct: CTStringData,
  well: WellGeometry,
  fluid: FluidData,
  pump: PumpData,
  tools: ToolsData,
  sections?: CTSection[],
  opts: CTSurfaceOptions = {},
): HydraulicsResult {
  const h = ctHydraulics(ct, sections, well, fluid, pump.flowRate, { d: tools.nozzleDiam, n: tools.nozzleCount }, opts);
  const traj = well.trajectory.length > 1 ? well.trajectory : buildSyntheticTrajectory(well.md, well.tvd);
  const maxInc = Math.max(...traj.map((t) => t.zenith));
  const incFactor = 1 + Math.sin((Math.min(maxInc, 90) * Math.PI) / 180) * 0.6;
  const minTransportVelocity = 0.5 * incFactor;
  const tvd = getTVDatMD(traj, h.deployedM);
  const fracPressureAtTD = well.fracGradient * tvd;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const widest = h.annSegs.reduce((a, b) => (b.flow.v < (a?.flow.v ?? Infinity) ? b : a), h.annSegs[0]);
  return {
    dpInsideCT: r2(h.dpDeployed + h.dpReel + h.dpLines),
    dpCTDeployed: r2(h.dpDeployed),
    dpReel: r2(h.dpReel),
    dpLines: r2(h.dpLines),
    dpAnnulus: r2(h.dpAnn),
    dpNozzle: r2(h.dpNozzle),
    dpTotal: r2(h.dpDeployed + h.dpReel + h.dpLines + h.dpAnn + h.dpNozzle),
    pumpPressure: r2(h.pumpPressure),
    hydrostaticInside: r2(h.hydro),
    hydrostaticAnnulus: r2(h.hydro),
    bhCircPressure: r2(h.bhp),
    velocityInCT: r2(h.ctFlow.v),
    velocityAnnulus: r2(h.minAnnVel),
    reynoldsInCT: Math.round(h.ctFlow.Re),
    reynoldsAnnulus: Math.round(widest?.flow.Re ?? 0),
    flowRegimeCT: h.ctFlow.regime,
    flowRegimeAnnulus: widest?.flow.regime ?? "—",
    ecdAtTD: Math.round(h.ecd * 1000) / 1000,
    minTransportVelocity: r2(minTransportVelocity),
    transportOk: h.minAnnVel >= minTransportVelocity,
    fracPressureAtTD: r2(fracPressureAtTD),
    fracSafetyFactor: fracPressureAtTD > 0 ? r2(h.bhp / fracPressureAtTD) : 0,
    rheologyModel: h.rheo.model,
    reelLengthM: Math.round(h.reelM),
    annulusSegments: h.annSegs.map((s) => ({ from: Math.round(s.from), to: Math.round(s.to), holeIdMm: s.holeIdMm, velocity: r2(s.flow.v), regime: s.flow.regime, dp: r2((s.flow.gradPaM * (s.to - s.from)) / 1e6) })),
    warnings: h.warnings,
  };
}

/** Потери давления и давление насоса в зависимости от расхода (л/с) */
export function generateHydraulicsCurve(
  ct: CTStringData,
  well: WellGeometry,
  fluid: FluidData,
  tools: ToolsData,
  maxFlowRate: number = 10,
  steps: number = 30,
  sections?: CTSection[],
  opts: CTSurfaceOptions = {},
): HydraulicsChartPoint[] {
  const points: HydraulicsChartPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const fr = (maxFlowRate / steps) * i;
    const r = calculateHydraulics(ct, well, fluid, { flowRate: fr, surfacePressure: 0 }, tools, sections, opts);
    points.push({ flowRate: Math.round(fr * 100) / 100, dpCT: r.dpCTDeployed, dpReel: Math.round((r.dpReel + r.dpLines) * 100) / 100, dpAnn: r.dpAnnulus, dpNozzle: r.dpNozzle, dpTotal: r.dpTotal, pumpPressure: r.pumpPressure });
  }
  return points;
}

// ─── Module 4: CoilLIFE ───

export interface FatigueResult {
  bendingStrainReel: number;
  bendingStrainGuideArch: number;
  totalStrainPerTrip: number;
  estimatedCycles: number;
  fatigueLifeUsed: number;
  pressureDerate: number;
  maxSafeTrips: number;
}

export interface FatigueChartPoint {
  trips: number;
  lifeUsed: number;
  burstDerate: number;
  effectiveBurst: number;
}

export function calculateFatigue(
  ct: CTStringData,
  reelSize: "small" | "medium" | "large" = "medium",
  operatingPressure: number = 0,
  previousTrips: number = 0
): FatigueResult {
  const odM = ct.od / 1000;
  const reelDiam = REEL_DIAMETERS[reelSize];
  const guideArchDiam = GUIDE_ARCH_DIAMETER;

  const strainReel = (odM / reelDiam) * 100;
  const strainGuideArch = (odM / guideArchDiam) * 100;
  const totalStrainPerTrip = 2 * strainReel + 2 * strainGuideArch;

  const yieldStr = GRADE_YIELD[ct.grade] || 552;
  const strainAmplitude = totalStrainPerTrip / 4;

  const pressureRatio = operatingPressure / ((2 * yieldStr * ct.wall) / ct.od);
  const pressureFactor = Math.max(0.2, 1 - pressureRatio * 0.6);

  const C = 0.6;
  const b = 2.0;
  const baseCycles = strainAmplitude > 0 ? C / Math.pow(strainAmplitude, b) * 1000 : 99999;
  const adjustedCycles = Math.round(baseCycles * pressureFactor);

  const fatigueUsed = previousTrips > 0 ? (previousTrips / adjustedCycles) * 100 : 0;
  const pressureDerate = Math.min(30, fatigueUsed * 0.5);

  return {
    bendingStrainReel: Math.round(strainReel * 1000) / 1000,
    bendingStrainGuideArch: Math.round(strainGuideArch * 1000) / 1000,
    totalStrainPerTrip: Math.round(totalStrainPerTrip * 1000) / 1000,
    estimatedCycles: adjustedCycles,
    fatigueLifeUsed: Math.round(fatigueUsed * 10) / 10,
    pressureDerate: Math.round(pressureDerate * 10) / 10,
    maxSafeTrips: Math.round(adjustedCycles / 2),
  };
}

/** Generate fatigue life curve */
export function generateFatigueCurve(
  ct: CTStringData,
  reelSize: "small" | "medium" | "large",
  operatingPressure: number
): FatigueChartPoint[] {
  const fatigue = calculateFatigue(ct, reelSize, operatingPressure, 0);
  const maxTrips = fatigue.estimatedCycles;
  const burstP = (2 * (GRADE_YIELD[ct.grade] || 552) * ct.wall) / ct.od;
  const points: FatigueChartPoint[] = [];
  const steps = 40;

  for (let i = 0; i <= steps; i++) {
    const trips = Math.round((maxTrips * 1.2 / steps) * i);
    const used = (trips / maxTrips) * 100;
    const derate = Math.min(30, used * 0.5);
    points.push({
      trips,
      lifeUsed: Math.round(used * 10) / 10,
      burstDerate: Math.round(derate * 10) / 10,
      effectiveBurst: Math.round((burstP * (1 - derate / 100)) * 10) / 10,
    });
  }

  return points;
}

// ─── Temperature Profile ───

export interface TempProfilePoint {
  depth: number;
  tvd: number;
  tempStatic: number;
  tempCirculating: number;
}

export function generateTempProfile(well: WellGeometry, steps: number = 30): TempProfilePoint[] {
  const points: TempProfilePoint[] = [];
  const maxMD = well.md;
  const traj = well.trajectory;

  for (let i = 0; i <= steps; i++) {
    const md = (maxMD / steps) * i;
    const tvd = getTVDatMD(traj, md);
    const tvdRatio = well.tvd > 0 ? tvd / well.tvd : 0;
    const tempStatic = well.whTemp + (well.bhst - well.whTemp) * tvdRatio;
    const tempCirc = well.whTemp + (well.bhct - well.whTemp) * tvdRatio;
    points.push({
      depth: Math.round(md),
      tvd: Math.round(tvd * 10) / 10,
      tempStatic: Math.round(tempStatic * 10) / 10,
      tempCirculating: Math.round(tempCirc * 10) / 10,
    });
  }

  return points;
}

// ─── CT Pipe Tempering (Temperature Derating) ───

/**
 * Temperature derating factor for CT steel yield strength.
 * Based on API 5ST / IRP Vol.7 data for CT grades.
 * Below 100°C: no derating (factor = 1.0)
 * 100-200°C: mild derating
 * 200-300°C: significant derating  
 * Above 300°C: severe derating
 */
export function tempDeratingFactor(tempC: number): number {
  if (tempC <= 100) return 1.0;
  if (tempC <= 150) return 1.0 - 0.03 * ((tempC - 100) / 50);     // 1.0 → 0.97
  if (tempC <= 200) return 0.97 - 0.07 * ((tempC - 150) / 50);    // 0.97 → 0.90
  if (tempC <= 250) return 0.90 - 0.08 * ((tempC - 200) / 50);    // 0.90 → 0.82
  if (tempC <= 300) return 0.82 - 0.10 * ((tempC - 250) / 50);    // 0.82 → 0.72
  if (tempC <= 350) return 0.72 - 0.12 * ((tempC - 300) / 50);    // 0.72 → 0.60
  return Math.max(0.40, 0.60 - 0.15 * ((tempC - 350) / 50));      // floor at 0.40
}

/**
 * CT pipe temperature profile during circulation.
 * Models heat exchange: fluid inside CT absorbs heat from formation,
 * so pipe temp is between inlet fluid temp and formation temp.
 * Uses a simplified 1D heat transfer model.
 */
export interface CTPipeTempPoint {
  depth: number;
  tvd: number;
  formationTemp: number;     // geothermal temperature at this TVD
  fluidInsideTemp: number;   // fluid temperature inside CT at this depth
  pipeTemp: number;          // CT pipe body temperature
  yieldDerating: number;     // derating factor (0-1)
  effectiveYield: number;    // derated yield strength, MPa
  burstDerated: number;      // derated burst pressure, MPa
  collapseDerated: number;   // derated collapse pressure, MPa
}

export interface TemperingResult {
  profile: CTPipeTempPoint[];
  maxPipeTemp: number;
  maxPipeTempDepth: number;
  minDeratingFactor: number;
  effectiveYieldAtBH: number;
  burstAtBH: number;
  collapseAtBH: number;
  nominalYield: number;
  nominalBurst: number;
  nominalCollapse: number;
}

export function calculateTempering(
  ct: CTStringData,
  well: WellGeometry,
  fluid: FluidData,
  pump: PumpData,
  steps: number = 40,
): TemperingResult {
  const yieldNominal = GRADE_YIELD[ct.grade] || 552;
  const od = ct.od;
  const wall = ct.wall;
  const burstNominal = (2 * yieldNominal * wall) / od;
  // смятие по API RP 5C7 (Тимошенко) с овальностью
  const collapseNominal = strengthOf(od, wall, ct.grade, ct.ovality).collapseOval;

  const traj = well.trajectory.length > 1 ? well.trajectory
    : buildSyntheticTrajectory(well.md, well.tvd);
  const maxMD = well.md;

  // Heat transfer parameters
  const flowRateLs = pump.flowRate;
  const idCT = ctID(od, wall) / 1000; // m
  const areaCT = (Math.PI / 4) * idCT * idCT;
  const massFlowRate = flowRateLs / 1000 * fluid.density * 1000; // kg/s
  const Cp = 4186; // J/(kg·K) - water-based, adjust for oil
  const fluidCp = fluid.density < 0.9 ? 2100 : (fluid.density > 1.15 ? 3800 : Cp);

  // Overall heat transfer coefficient (W/(m²·K)) — typical for CT in wellbore
  const U = 50; // simplified
  const perimeterInner = Math.PI * idCT;

  const profile: CTPipeTempPoint[] = [];
  let maxPipeTemp = 0;
  let maxPipeTempDepth = 0;
  let minDerating = 1.0;

  // Simulate fluid heating as it flows down inside CT
  let fluidTemp = well.whTemp; // inlet temperature = wellhead temp

  for (let i = 0; i <= steps; i++) {
    const md = (maxMD / steps) * i;
    const tvd = getTVDatMD(traj, md);
    const tvdRatio = well.tvd > 0 ? tvd / well.tvd : 0;
    const formationTemp = well.whTemp + (well.bhst - well.whTemp) * tvdRatio;

    // Heat exchange over this segment
    if (i > 0 && massFlowRate > 0) {
      const segLen = maxMD / steps;
      const dQ = U * perimeterInner * segLen * (formationTemp - fluidTemp);
      const dT = dQ / (massFlowRate * fluidCp);
      fluidTemp += dT;
      // Cap fluid temp to not exceed formation temp
      fluidTemp = Math.min(fluidTemp, formationTemp);
    }

    // Pipe body temperature: between fluid inside and formation
    // Weighted average — pipe closer to fluid temp when flow is high
    const flowFactor = massFlowRate > 0
      ? Math.min(0.85, 0.3 + (massFlowRate / 5) * 0.3) // 0.3-0.85 depending on flow
      : 0.0;
    const pipeTemp = flowFactor * fluidTemp + (1 - flowFactor) * formationTemp;

    const derating = tempDeratingFactor(pipeTemp);
    const effYield = yieldNominal * derating;
    const burstD = burstNominal * derating;
    const collapseD = strengthOf(od, wall, ct.grade, ct.ovality, 0, derating).collapseOval;

    if (pipeTemp > maxPipeTemp) {
      maxPipeTemp = pipeTemp;
      maxPipeTempDepth = md;
    }
    if (derating < minDerating) minDerating = derating;

    profile.push({
      depth: Math.round(md),
      tvd: Math.round(tvd * 10) / 10,
      formationTemp: Math.round(formationTemp * 10) / 10,
      fluidInsideTemp: Math.round(fluidTemp * 10) / 10,
      pipeTemp: Math.round(pipeTemp * 10) / 10,
      yieldDerating: Math.round(derating * 1000) / 1000,
      effectiveYield: Math.round(effYield * 10) / 10,
      burstDerated: Math.round(burstD * 10) / 10,
      collapseDerated: Math.round(collapseD * 10) / 10,
    });
  }

  const lastPoint = profile[profile.length - 1];

  return {
    profile,
    maxPipeTemp: Math.round(maxPipeTemp * 10) / 10,
    maxPipeTempDepth: Math.round(maxPipeTempDepth),
    minDeratingFactor: Math.round(minDerating * 1000) / 1000,
    effectiveYieldAtBH: lastPoint.effectiveYield,
    burstAtBH: lastPoint.burstDerated,
    collapseAtBH: lastPoint.collapseDerated,
    nominalYield: yieldNominal,
    nominalBurst: Math.round(burstNominal * 10) / 10,
    nominalCollapse: Math.round(collapseNominal * 10) / 10,
  };
}

// ─── Risk Assessment ───

export interface RiskItem {
  level: "info" | "warning" | "critical";
  emoji: string;
  message: string;
}

export function assessRisks(
  forces: ForceResult,
  limits: LimitResult,
  hydraulics: HydraulicsResult,
  fatigue: FatigueResult,
  well: WellGeometry
): RiskItem[] {
  const risks: RiskItem[] = [];

  if (forces.lockUpDepth > 0) {
    risks.push({ level: "critical", emoji: "🔒", message: forces.lockUpReason === "injector"
      ? `Спуск ограничен инжектором на ${forces.lockUpDepth.toFixed(0)} м: требуемое проталкивание больше ${forces.injectorSnubKN.toFixed(0)} кН`
      : `Запирание ГНКТ на ${forces.lockUpDepth.toFixed(0)} м: спиральный изгиб, усилие с устья не передаётся вниз` });
  }
  if (forces.pipeLightDepth > 0) {
    risks.push({ level: "info", emoji: "⬇️", message: `Давление на устье выталкивает трубу: до ${forces.pipeLightDepth.toFixed(0)} м спуск с проталкиванием инжектором (до ${forces.maxSnubRequired.toFixed(1)} кН)` });
  }
  if (forces.helicalZone && forces.lockUpDepth === 0) {
    risks.push({ level: "warning", emoji: "🌀", message: `Спиральный изгиб при спуске в интервале ${forces.helicalZone[0]}–${forces.helicalZone[1]} м — повышенное трение, износ трубы` });
  }
  if (forces.maxPullRequired > forces.injectorPullKN * 0.9) {
    risks.push({ level: "critical", emoji: "🏋️", message: `Требуемое тяговое усилие при подъёме ${forces.maxPullRequired.toFixed(0)} кН > 90% тяги инжектора (${forces.injectorPullKN.toFixed(0)} кН)` });
  }
  if (forces.surfaceLoadPOOH > limits.maxWorkingTension) {
    risks.push({ level: "critical", emoji: "💥", message: "Нагрузка при подъёме превышает рабочий предел натяжения (80% текучести)" });
  }

  if (hydraulics.pumpPressure > limits.maxWorkingPressure) {
    risks.push({ level: "critical", emoji: "🔴", message: `Давление насоса (${hydraulics.pumpPressure.toFixed(1)} МПа) > макс. рабочего давления ГНКТ (${limits.maxWorkingPressure.toFixed(1)} МПа)` });
  }
  if (limits.vonMisesRatio >= 1.0) {
    risks.push({ level: "critical", emoji: "⛔", message: "Критерий Мизеса превышен — деформация неизбежна!" });
  } else if (limits.vonMisesRatio >= 0.8) {
    risks.push({ level: "warning", emoji: "🟡", message: `Коэффициент Мизеса ${limits.vonMisesRatio.toFixed(3)} — близко к пределу` });
  }

  if (limits.collapseWithOvality * 0.8 < well.wellheadPressure) {
    risks.push({ level: limits.collapseWithOvality < well.wellheadPressure ? "critical" : "warning", emoji: "📉", message: `Давление на устье ${well.wellheadPressure.toFixed(1)} МПа близко к давлению смятия с овальностью (${limits.collapseWithOvality.toFixed(1)} МПа) — не стравливать давление в ГНКТ` });
  }

  // Frac check
  if (hydraulics.fracSafetyFactor >= 1.0 && hydraulics.fracPressureAtTD > 0) {
    risks.push({ level: "critical", emoji: "🌋", message: `BHP (${hydraulics.bhCircPressure.toFixed(1)} МПа) превышает давление ГРП (${hydraulics.fracPressureAtTD.toFixed(1)} МПа) — риск поглощения!` });
  } else if (hydraulics.fracSafetyFactor >= 0.85 && hydraulics.fracPressureAtTD > 0) {
    risks.push({ level: "warning", emoji: "⚡", message: `BHP = ${(hydraulics.fracSafetyFactor * 100).toFixed(0)}% от давления ГРП — осторожно` });
  }

  if (!hydraulics.transportOk) {
    risks.push({ level: "warning", emoji: "🔄", message: `Скорость в затрубье (${hydraulics.velocityAnnulus.toFixed(2)} м/с) недостаточна для транспорта шлама (мин. ${hydraulics.minTransportVelocity.toFixed(2)} м/с)` });
  }
  if (hydraulics.ecdAtTD > 1.5) {
    risks.push({ level: "info", emoji: "📊", message: `ECD на забое: ${hydraulics.ecdAtTD.toFixed(3)} г/см³ — проверьте совместимость с пластовым давлением` });
  }

  if (fatigue.fatigueLifeUsed > 80) {
    risks.push({ level: "critical", emoji: "💀", message: `Ресурс ГНКТ критически исчерпан (${fatigue.fatigueLifeUsed.toFixed(0)}%)` });
  } else if (fatigue.fatigueLifeUsed > 50) {
    risks.push({ level: "warning", emoji: "⏳", message: `Использовано ${fatigue.fatigueLifeUsed.toFixed(0)}% ресурса — усиленный контроль` });
  }
  if (fatigue.pressureDerate > 15) {
    risks.push({ level: "warning", emoji: "📉", message: `Давление разрыва снижено на ${fatigue.pressureDerate.toFixed(1)}% из-за усталости` });
  }

  if (risks.length === 0) {
    risks.push({ level: "info", emoji: "✅", message: "Все параметры в допустимых пределах" });
  }

  return risks;
}

// ─── Presets ───

export const CT_PRESETS: { label: string; od: number; wall: number }[] = [
  { label: '1" (25.4 мм)', od: 25.4, wall: 2.77 },
  { label: '1.25" (31.75 мм)', od: 31.75, wall: 3.18 },
  { label: '1.5" (38.1 мм)', od: 38.1, wall: 3.40 },
  { label: '1.75" (44.45 мм)', od: 44.45, wall: 3.68 },
  { label: '2" (50.8 мм)', od: 50.8, wall: 3.96 },
  { label: '2.375" (60.33 мм)', od: 60.33, wall: 4.44 },
  { label: '2.875" (73.03 мм)', od: 73.03, wall: 5.51 },
  { label: '3.5" (88.9 мм)', od: 88.9, wall: 5.51 },
];

export const FLUID_PRESETS: { label: string; data: FluidData }[] = [
  { label: "Вода", data: { name: "Вода", density: 1.0, pv: 1, yp: 0, nIndex: 1, kIndex: 0.001 } },
  { label: "Солевой раствор (NaCl)", data: { name: "Солевой раствор NaCl", density: 1.05, pv: 1.5, yp: 0, nIndex: 1, kIndex: 0.0015 } },
  { label: "Солевой раствор (CaCl₂)", data: { name: "Солевой раствор CaCl₂", density: 1.20, pv: 2.0, yp: 0, nIndex: 1, kIndex: 0.002 } },
  { label: "КМЦ раствор", data: { name: "КМЦ раствор", density: 1.02, pv: 15, yp: 5, nIndex: 0.6, kIndex: 0.25 } },
  { label: "Кислота 15% HCl", data: { name: "HCl 15%", density: 1.07, pv: 1.2, yp: 0, nIndex: 1, kIndex: 0.0012 } },
  { label: "Кислота 28% HCl", data: { name: "HCl 28%", density: 1.14, pv: 1.8, yp: 0, nIndex: 1, kIndex: 0.0018 } },
  { label: "Глинокислота", data: { name: "Глинокислота (HCl+HF)", density: 1.08, pv: 1.3, yp: 0, nIndex: 1, kIndex: 0.0013 } },
  { label: "Гель (ГПГ)", data: { name: "Гуаровый гель (линейный, 3.6 кг/м³)", density: 1.01, pv: 25, yp: 10, nIndex: 0.5, kIndex: 0.35 } },
  { label: "Биополимер (ксантан)", data: { name: "Биополимерный раствор", density: 1.01, pv: 20, yp: 8, nIndex: 0.4, kIndex: 0.6 } },
  { label: "Нефть (0.85)", data: { name: "Нефть", density: 0.85, pv: 5, yp: 0, nIndex: 1, kIndex: 0.005 } },
  { label: "Азот (газ)", data: { name: "Азот", density: 0.15, pv: 0.02, yp: 0, nIndex: 1, kIndex: 0.00002 } },
];
