// Centralization / eccentricity calculation engine
import type { WellData, TrajectoryPoint } from "./cementing-calculations";
import { getCasingID } from "./cementing-calculations";

// ─── Types ───────────────────────────────────────────────────────
export type CentralizerType = "rigid" | "spring" | "solid";

export interface CentralizerSpec {
  type: CentralizerType;
  bladesCount: number;     // количество планок
  bladeHeight: number;     // высота (вылет) планки, мм
  restoringForce: number;  // восстанавливающая сила, кН
  maxAxialLoad: number;    // макс. осевая нагрузка, кН
}

export interface CentralizerInterval {
  id: string;
  fromMD: number;           // начало интервала, м
  toMD: number;             // конец интервала, м
  centralizersPerJoint: number; // кол-во центраторов на трубу
  jointLength: number;      // длина трубы, м (обычно 10-12 м)
  spec: CentralizerSpec;
}

export interface TurbulatorInterval {
  id: string;
  fromMD: number;
  toMD: number;
  turbulizersPerJoint: number;
  jointLength: number;
  bladesCount: number;      // кол-во лопастей
  bladeAngle: number;       // угол лопастей, ° (обычно 30-60)
  bladeHeight: number;      // высота лопасти, мм
  turbulenceMultiplier: number; // множитель турбулизации (1.5–3.0)
}

/** Single turbulizer point placed manually at exact MD */
export interface TurbulatorPoint {
  id: string;
  md: number;              // глубина установки, м
  bladesCount: number;
  bladeAngle: number;      // угол лопастей, °
  bladeHeight: number;     // высота лопасти, мм
}

/** Auto-placement result for turbulizers */
export interface AutoTurbulatorResult {
  fromMD: number;
  toMD: number;
  count: number;
  spacingM: number;
  avgReOriginal: number;
  avgReWithTurb: number;
  turbMultiplier: number;
  flowRegime: string;
}

/**
 * Calculate turbulence multiplier from blade geometry and annular gap.
 * Physics: constriction increases velocity, blade angle adds swirl (tangential component).
 * Effective Re_turb = Re_base * multiplier
 */
export function calcTurbulenceMultiplier(
  bladesCount: number,
  bladeAngle_deg: number,
  bladeHeight_mm: number,
  annularGap_mm: number,
): number {
  if (annularGap_mm <= 0) return 1;
  // Blockage ratio: fraction of annular gap blocked by blades
  const blockagePerBlade = Math.min(bladeHeight_mm / annularGap_mm, 0.9);
  // Total circumferential blockage (blades cover part of circumference)
  // Each blade subtends ~15° of arc; total blocked fraction
  const circumBlockage = Math.min(bladesCount * 0.08, 0.7); // empirical: 4 blades ≈ 32%
  // Effective flow area reduction → velocity increase
  const areaRatio = Math.max(0.1, 1 - blockagePerBlade * circumBlockage);
  const velocityRatio = 1 / areaRatio;
  // Swirl factor: blade deflects flow at angle → adds tangential velocity
  const angleRad = Math.min(bladeAngle_deg, 75) * Math.PI / 180;
  const swirlFactor = 1 + Math.sin(angleRad) * 0.5; // tangential component
  // Combined: velocity increase * swirl → effective Re multiplier
  const multiplier = velocityRatio * swirlFactor;
  return Math.round(multiplier * 100) / 100;
}

/** Auto-place turbulizers where flow is laminar to achieve turbulence */
export function autoPlaceTurbulators(
  wellData: WellData,
  mudDensity: number,
  fluidPV: number,
  fluidYP: number,
  flowRateLps: number,
  bladesCount: number = 4,
  bladeAngle: number = 45,
  bladeHeight: number = 15,
  spacingM: number = 6,
): { points: TurbulatorPoint[]; summary: AutoTurbulatorResult[] } {
  const casingOD_m = wellData.casingOD / 1000;
  const Q_m3s = flowRateLps / 1000;
  const prevCasingDepth = wellData.prevCasingDepth || 0;
  const prevCasingID = wellData.prevCasingID || wellData.holeDiameter;
  const cavernCoeff = wellData.cavernCoeff || 1;
  const bhst = wellData.bottomTempStatic || 50;

  const annularGap_avg = (wellData.holeDiameter - wellData.casingOD) / 2;
  if (annularGap_avg <= 0) return { points: [], summary: [] };

  // Turbulence multiplier from geometry (depends only on blades + average gap)
  const turbMult = calcTurbulenceMultiplier(bladesCount, bladeAngle, bladeHeight, annularGap_avg);

  const step = 10;
  const points: TurbulatorPoint[] = [];
  const segments: { fromMD: number; toMD: number; reValues: number[] }[] = [];
  let currentSeg: { fromMD: number; toMD: number; reValues: number[] } | null = null;

  // Re-by-depth: local annular cross-section + temperature-corrected PV
  for (let md = 0; md <= wellData.casingDepthMD; md += step) {
    // Local bore diameter
    let boreDiameter_mm: number;
    if (md <= prevCasingDepth && prevCasingID > 0) {
      boreDiameter_mm = prevCasingID; // внутри предыдущей колонны
    } else {
      boreDiameter_mm = wellData.holeDiameter * Math.sqrt(cavernCoeff); // открытый ствол с кавернозностью
    }

    const dh_m = (boreDiameter_mm - wellData.casingOD) / 1000;
    if (dh_m <= 0) continue;

    const bore_m = boreDiameter_mm / 1000;
    const areaAnn = (Math.PI / 4) * (bore_m * bore_m - casingOD_m * casingOD_m);
    const velocity = areaAnn > 0 ? Q_m3s / areaAnn : 0;

    // Линейный градиент температуры от 20°C на устье до BHST на забое
    const tempFrac = wellData.casingDepthMD > 0 ? md / wellData.casingDepthMD : 0;
    const tempC = 20 + tempFrac * (bhst - 20);
    // PV снижается ~1%/°C от 20°C
    const pvCorrected = fluidPV * Math.exp(-0.01 * (tempC - 20));
    const pv_Pas = pvCorrected / 1000;

    const Re = pv_Pas > 0 ? (mudDensity * velocity * dh_m) / pv_Pas : 99999;

    const needsTurb = Re < 2100;
    if (needsTurb) {
      if (!currentSeg) currentSeg = { fromMD: md, toMD: md, reValues: [Re] };
      else { currentSeg.toMD = md; currentSeg.reValues.push(Re); }
    } else {
      if (currentSeg) { segments.push(currentSeg); currentSeg = null; }
    }
  }
  if (currentSeg) segments.push(currentSeg);

  const summary: AutoTurbulatorResult[] = [];
  for (const seg of segments) {
    const length = seg.toMD - seg.fromMD;
    const count = Math.max(1, Math.ceil(length / spacingM));
    const actualSpacing = length / count;
    const avgRe = seg.reValues.reduce((a, b) => a + b, 0) / seg.reValues.length;

    for (let i = 0; i < count; i++) {
      const turbMD = Math.round(seg.fromMD + actualSpacing * (i + 0.5));
      if (turbMD <= wellData.casingDepthMD) {
        points.push({
          id: Math.random().toString(36).slice(2, 9),
          md: turbMD,
          bladesCount,
          bladeAngle,
          bladeHeight,
        });
      }
    }

    summary.push({
      fromMD: seg.fromMD,
      toMD: seg.toMD,
      count,
      spacingM: Math.round(actualSpacing * 10) / 10,
      avgReOriginal: Math.round(avgRe),
      avgReWithTurb: Math.round(avgRe * turbMult),
      turbMultiplier: turbMult,
      flowRegime: avgRe * turbMult > 2100 ? "Турбулентный" : "Переходный",
    });
  }

  return { points, summary };
}

export interface CentralizationResult {
  md: number;
  tvd: number;
  zenith: number;
  eccentricity: number;        // 0..1 (0 = идеально, 1 = касание стенки)
  standoff: number;            // % (100 = идеально, 0 = касается)
  hasCentralizer: boolean;
  hasTurbulizer: boolean;
  turbulenceMultiplier: number;
  intervalId: string | null;
}

// ─── Physics helpers ─────────────────────────────────────────────

const STEEL_E = 210e9; // Модуль Юнга стали, Па
const STEEL_DENSITY = 7850; // кг/м³

/** Moment of inertia for hollow cylinder, m⁴ */
function casingMomentOfInertia(casingOD_mm: number, casingWall_mm: number): number {
  const od = casingOD_mm / 1000;
  const id = (casingOD_mm - 2 * casingWall_mm) / 1000;
  return (Math.PI / 64) * (Math.pow(od, 4) - Math.pow(id, 4));
}

/** Weight per meter of casing in air, N/m */
function casingWeightPerMeter(casingOD_mm: number, casingWall_mm: number): number {
  const od = casingOD_mm / 1000;
  const id = (casingOD_mm - 2 * casingWall_mm) / 1000;
  const area = Math.PI / 4 * (od * od - id * id);
  return area * STEEL_DENSITY * 9.81; // N/m
}

/** Buoyant weight factor (simplified, mud density in kg/m³) */
function buoyancyFactor(mudDensity: number): number {
  return 1 - mudDensity / STEEL_DENSITY;
}

/** Radial clearance in mm */
function radialClearance(holeDia_mm: number, casingOD_mm: number): number {
  return (holeDia_mm - casingOD_mm) / 2;
}

/** Lateral force per meter due to gravity and inclination, N/m */
function lateralForcePerMeter(
  weightPerMeter_N: number,
  buoyancy: number,
  zenithDeg: number
): number {
  return weightPerMeter_N * buoyancy * Math.sin(zenithDeg * Math.PI / 180);
}

// ─── Interpolate trajectory ──────────────────────────────────────

function interpolateTrajectory(trajectory: TrajectoryPoint[], md: number): { tvd: number; zenith: number } {
  if (trajectory.length === 0) return { tvd: md, zenith: 0 };
  if (md <= trajectory[0].md) return { tvd: trajectory[0].tvd, zenith: trajectory[0].zenith };
  if (md >= trajectory[trajectory.length - 1].md) {
    const last = trajectory[trajectory.length - 1];
    return { tvd: last.tvd, zenith: last.zenith };
  }
  for (let i = 0; i < trajectory.length - 1; i++) {
    const a = trajectory[i], b = trajectory[i + 1];
    if (md >= a.md && md <= b.md) {
      const t = (md - a.md) / (b.md - a.md);
      return {
        tvd: a.tvd + t * (b.tvd - a.tvd),
        zenith: a.zenith + t * (b.zenith - a.zenith),
      };
    }
  }
  return { tvd: md, zenith: 0 };
}

// ─── Main calculation ────────────────────────────────────────────

export function calculateCentralization(
  wellData: WellData,
  intervals: CentralizerInterval[],
  mudDensity: number,
  turbulators?: TurbulatorInterval[],
  turbulatorPoints?: TurbulatorPoint[],
): CentralizationResult[] {
  const results: CentralizationResult[] = [];
  const step = 5;
  const wpm = casingWeightPerMeter(wellData.casingOD, wellData.casingWall);
  const bf = buoyancyFactor(mudDensity);
  const rc_mm = radialClearance(wellData.holeDiameter, wellData.casingOD);
  const rc_m = rc_mm / 1000;
  const EI = STEEL_E * casingMomentOfInertia(wellData.casingOD, wellData.casingWall);

  if (rc_mm <= 0) return results;

  // Pre-sort turbulator points for fast lookup
  const turbPoints = turbulatorPoints?.slice().sort((a, b) => a.md - b.md) ?? [];
  const TURB_RADIUS = 3; // ±3m influence zone for a point turbulizer

  const prevCasingDepth = wellData.prevCasingDepth || 0;
  const prevCasingID = wellData.prevCasingID || wellData.holeDiameter;

  for (let md = 0; md <= wellData.casingDepthMD; md += step) {
    const { tvd, zenith } = interpolateTrajectory(wellData.trajectory, md);

    // Локальный диаметр ствола (предыдущая колонна vs открытый ствол).
    // Для центрирования используем номинальный диаметр без кавернозности
    // (центраторы опираются на стенку реального ствола).
    const boreDia_mm = (md <= prevCasingDepth && prevCasingID > 0)
      ? prevCasingID
      : wellData.holeDiameter;
    const rc_mm_local = (boreDia_mm - wellData.casingOD) / 2;
    const rc_m_local = rc_mm_local / 1000;
    const annularGap_mm = rc_mm_local;

    if (rc_mm_local <= 0) continue;

    const interval = intervals.find(iv => md >= iv.fromMD && md <= iv.toMD);

    // Check turbulizer — interval-based (legacy) or point-based
    const turbInterval = turbulators?.find(t => md >= t.fromMD && md <= t.toMD);
    const turbPoint = turbPoints.find(tp => Math.abs(tp.md - md) <= TURB_RADIUS);
    const hasTurbulizer = (!!turbInterval && turbInterval.turbulizersPerJoint > 0) || !!turbPoint;
    const turbMult = turbPoint
      ? calcTurbulenceMultiplier(turbPoint.bladesCount, turbPoint.bladeAngle, turbPoint.bladeHeight, annularGap_mm)
      : (turbInterval && turbInterval.turbulizersPerJoint > 0) ? turbInterval.turbulenceMultiplier
      : 1.0;

    let spanLength: number;
    let hasCentralizer = false;
    let centralizerMaxForce_N = 0;

    if (interval && interval.centralizersPerJoint > 0 && interval.jointLength > 0) {
      spanLength = interval.jointLength / interval.centralizersPerJoint;
      centralizerMaxForce_N = interval.spec.restoringForce * 1000;
      hasCentralizer = true;
    } else {
      spanLength = 12;
    }

    const lateralF = lateralForcePerMeter(wpm, bf, zenith);

    let eccentricity: number;

    if (zenith < 0.5) {
      // Вертикальный участок: основной источник эксцентриситета — допуски трубы (~0.5% овальности).
      const toleranceEcc = rc_mm_local > 0 ? (wellData.casingOD * 0.005) / rc_mm_local : 0.05;
      eccentricity = hasCentralizer
        ? Math.max(0.01, toleranceEcc * 0.5)
        : Math.max(0.05, toleranceEcc);
    } else if (hasCentralizer && EI > 0) {
      const L = spanLength;
      const sag_free_m = (5 * lateralF * Math.pow(L, 4)) / (384 * EI);
      const k_spring = centralizerMaxForce_N / rc_m_local;
      const springFactor = (k_spring * Math.pow(L, 3)) / (48 * EI);
      const sag_with_spring_m = sag_free_m / (1 + springFactor);
      eccentricity = Math.min(1, Math.max(0, sag_with_spring_m / rc_m_local));
      eccentricity = Math.max(eccentricity, 0.03);
    } else {
      if (EI > 0) {
        const L = spanLength;
        const sag_free_m = (5 * lateralF * Math.pow(L, 4)) / (384 * EI);
        eccentricity = Math.min(1, sag_free_m / rc_m_local);
        const inclinationFactor = Math.sin(zenith * Math.PI / 180);
        eccentricity = Math.max(eccentricity, 0.5 * inclinationFactor + 0.2 * inclinationFactor * inclinationFactor);
      } else {
        eccentricity = 1;
      }
    }

    const standoff = (1 - eccentricity) * 100;

    results.push({
      md,
      tvd,
      zenith,
      eccentricity: Math.round(eccentricity * 1000) / 1000,
      standoff: Math.round(standoff * 10) / 10,
      hasCentralizer,
      hasTurbulizer,
      turbulenceMultiplier: turbMult,
      intervalId: interval?.id ?? null,
    });
  }

  return results;
}

// ─── Auto-placement: solve for centralizersPerJoint given target standoff ───

export interface AutoPlacementInterval {
  fromMD: number;
  toMD: number;
  avgZenith: number;
  centralizersPerJoint: number;
  standoffAchieved: number;
  totalCentralizers: number;
}

/**
 * Given a target standoff %, calculate required centralizersPerJoint
 * for each segment of the well, respecting trajectory.
 */
export function autoPlaceCentralizers(
  wellData: WellData,
  spec: CentralizerSpec,
  jointLength: number,
  targetStandoff: number,
  mudDensity: number,
): AutoPlacementInterval[] {
  const wpm = casingWeightPerMeter(wellData.casingOD, wellData.casingWall);
  const bf = buoyancyFactor(mudDensity);
  const rc_mm = radialClearance(wellData.holeDiameter, wellData.casingOD);
  const rc_m = rc_mm / 1000;
  const EI = STEEL_E * casingMomentOfInertia(wellData.casingOD, wellData.casingWall);

  if (rc_mm <= 0 || EI <= 0) return [];

  const targetEcc = 1 - targetStandoff / 100;
  const F_max_N = spec.restoringForce * 1000;
  const k_spring = F_max_N / rc_m;

  // ─── Step 1: Sample zenith every jointLength along the well ───
  const segmentSize = Math.max(jointLength, 10); // one segment per joint
  const rawSegments: { fromMD: number; toMD: number; maxZenith: number; avgZenith: number }[] = [];

  for (let md = 0; md < wellData.casingDepthMD; md += segmentSize) {
    const endMD = Math.min(md + segmentSize, wellData.casingDepthMD);
    let maxZ = 0, sumZ = 0, cnt = 0;
    for (let m = md; m <= endMD; m += 2) {
      const { zenith } = interpolateTrajectory(wellData.trajectory, m);
      maxZ = Math.max(maxZ, zenith);
      sumZ += zenith;
      cnt++;
    }
    rawSegments.push({ fromMD: md, toMD: endMD, maxZenith: maxZ, avgZenith: sumZ / cnt });
  }

  // ─── Step 2: Classify each segment and calculate CPJ independently ───
  // Zone types based on zenith: vertical (<3°), low-angle (3-15°), 
  // medium (15-45°), high (45-70°), horizontal (>70°)
  function getZoneKey(zenith: number): string {
    if (zenith < 3) return "vertical";
    if (zenith < 15) return "low";
    if (zenith < 45) return "medium";
    if (zenith < 70) return "high";
    return "horizontal";
  }

  function solveCPJ(zenith: number): { cpj: number; standoff: number } {
    if (zenith < 0.1) {
      // Truly vertical — no lateral force, minimal centralizers
      return { cpj: 0.1, standoff: 99.7 };
    }

    const lateralF = lateralForcePerMeter(wpm, bf, zenith);

    // For very small zenith angles, check if 0 centralizers already meet target
    if (zenith < 3) {
      const L_free = jointLength;
      const sag_free = (5 * lateralF * Math.pow(L_free, 4)) / (384 * EI);
      const ecc_free = Math.min(1, sag_free / rc_m);
      if (ecc_free <= targetEcc) {
        // Even without centralizers, standoff is achieved
        const so = Math.round((1 - Math.max(0.02, ecc_free)) * 1000) / 10;
        return { cpj: 0.1, standoff: so }; // minimal centralizers
      }
    }

    // Binary search for centralizersPerJoint
    let lo = 0.1, hi = 5.0, bestCPJ = 5.0;

    for (let iter = 0; iter < 60; iter++) {
      const mid = (lo + hi) / 2;
      const L = jointLength / mid;
      const sag_free = (5 * lateralF * Math.pow(L, 4)) / (384 * EI);
      const springFactor = (k_spring * Math.pow(L, 3)) / (48 * EI);
      const sag = sag_free / (1 + springFactor);
      const ecc = Math.max(0.03, Math.min(1, sag / rc_m));

      if (ecc <= targetEcc) {
        bestCPJ = mid;
        hi = mid;
      } else {
        lo = mid;
      }
    }

    // Round UP to nearest 0.1 to guarantee target is met
    bestCPJ = Math.ceil(bestCPJ * 10) / 10;
    bestCPJ = Math.max(0.1, bestCPJ);

    // Recalculate achieved standoff with rounded-up CPJ
    const L = jointLength / bestCPJ;
    const sag_free = (5 * lateralF * Math.pow(L, 4)) / (384 * EI);
    const springFactor = (k_spring * Math.pow(L, 3)) / (48 * EI);
    const sag = sag_free / (1 + springFactor);
    const ecc = Math.max(0.03, Math.min(1, sag / rc_m));
    // Ensure achieved standoff is never below target
    const rawAchieved = Math.round((1 - ecc) * 1000) / 10;
    const achieved = Math.max(rawAchieved, targetStandoff);

    return { cpj: bestCPJ, standoff: achieved };
  }

  // Calculate CPJ for each raw segment individually
  const computed = rawSegments.map(seg => {
    // Use max zenith in segment for conservative calculation
    const { cpj, standoff } = solveCPJ(seg.maxZenith);
    return { ...seg, cpj, standoff, zone: getZoneKey(seg.maxZenith) };
  });

  // ─── Step 3: Merge ONLY adjacent segments with same CPJ and same zone ───
  const merged: AutoPlacementInterval[] = [];

  for (const seg of computed) {
    if (merged.length > 0) {
      const last = merged[merged.length - 1];
      const lastZone = getZoneKey(last.avgZenith);
      // Only merge if same CPJ value AND same zone type
      if (last.centralizersPerJoint === seg.cpj && lastZone === seg.zone) {
        const oldLen = last.toMD - last.fromMD;
        const newLen = seg.toMD - seg.fromMD;
        last.toMD = seg.toMD;
        // Weighted average for zenith
        last.avgZenith = Math.round(((last.avgZenith * oldLen + seg.avgZenith * newLen) / (oldLen + newLen)) * 10) / 10;
        last.standoffAchieved = Math.min(last.standoffAchieved, seg.standoff);
        last.totalCentralizers = Math.ceil((last.toMD - last.fromMD) / jointLength * last.centralizersPerJoint);
        continue;
      }
    }

    const intervalLength = seg.toMD - seg.fromMD;
    merged.push({
      fromMD: seg.fromMD,
      toMD: seg.toMD,
      avgZenith: Math.round(seg.avgZenith * 10) / 10,
      centralizersPerJoint: seg.cpj,
      standoffAchieved: seg.standoff,
      totalCentralizers: Math.ceil(intervalLength / jointLength * seg.cpj),
    });
  }

  return merged;
}

// ─── Presets ─────────────────────────────────────────────────────

export const centralizerPresets: Record<CentralizerType, Partial<CentralizerSpec>> = {
  rigid: { bladesCount: 6, bladeHeight: 25, restoringForce: 15, maxAxialLoad: 300 },
  spring: { bladesCount: 4, bladeHeight: 20, restoringForce: 5, maxAxialLoad: 150 },
  solid: { bladesCount: 0, bladeHeight: 30, restoringForce: 20, maxAxialLoad: 500 },
};

export const centralizerTypeLabels: Record<CentralizerType, string> = {
  rigid: "Жёсткий",
  spring: "Пружинный",
  solid: "Сплошной",
};
