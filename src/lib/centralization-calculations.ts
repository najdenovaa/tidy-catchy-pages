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

export interface CentralizationResult {
  md: number;
  tvd: number;
  zenith: number;
  eccentricity: number;        // 0..1 (0 = идеально, 1 = касание стенки)
  standoff: number;            // % (100 = идеально, 0 = касается)
  hasCentralizer: boolean;
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
): CentralizationResult[] {
  const results: CentralizationResult[] = [];
  const step = 5; // каждые 5 м по стволу
  const wpm = casingWeightPerMeter(wellData.casingOD, wellData.casingWall);
  const bf = buoyancyFactor(mudDensity);
  const rc_mm = radialClearance(wellData.holeDiameter, wellData.casingOD);
  const rc_m = rc_mm / 1000;
  const EI = STEEL_E * casingMomentOfInertia(wellData.casingOD, wellData.casingWall); // Н·м²

  if (rc_mm <= 0) return results;

  for (let md = 0; md <= wellData.casingDepthMD; md += step) {
    const { tvd, zenith } = interpolateTrajectory(wellData.trajectory, md);

    // Find matching interval
    const interval = intervals.find(iv => md >= iv.fromMD && md <= iv.toMD);

    let spanLength: number;
    let hasCentralizer = false;
    let centralizerMaxForce_N = 0; // max restoring force at full compression

    if (interval && interval.centralizersPerJoint > 0 && interval.jointLength > 0) {
      spanLength = interval.jointLength / interval.centralizersPerJoint;
      centralizerMaxForce_N = interval.spec.restoringForce * 1000; // кН → Н
      hasCentralizer = true;
    } else {
      spanLength = 12; // default joint length
    }

    const lateralF = lateralForcePerMeter(wpm, bf, zenith); // N/m

    let eccentricity: number;

    if (zenith < 0.5) {
      // Nearly vertical — casing hangs centered, minor eccentricity from imperfections
      eccentricity = hasCentralizer ? 0.02 : 0.08;
    } else if (hasCentralizer && EI > 0) {
      // ═══ Beam-on-elastic-support model ═══
      // Free sag of simply-supported beam under UDL (lateral gravity):
      // δ₀ = 5·w·L⁴ / (384·E·I)
      const L = spanLength;
      const sag_free_m = (5 * lateralF * Math.pow(L, 4)) / (384 * EI);

      // Centralizer acts as a SPRING at mid-span, NOT a constant force.
      // Spring stiffness: k = F_max / clearance (linear spring model)
      // At full compression (casing on wall), force = F_max
      // At zero deflection, force = 0
      const k_spring = centralizerMaxForce_N / rc_m; // N/m

      // Beam with central spring support:
      // Effective deflection: δ = δ₀ / (1 + k·L³/(48·E·I))
      const springFactor = (k_spring * Math.pow(L, 3)) / (48 * EI);
      const sag_with_spring_m = sag_free_m / (1 + springFactor);

      // Eccentricity = deflection / clearance, capped at 1.0
      eccentricity = Math.min(1, Math.max(0, sag_with_spring_m / rc_m));

      // Apply dogleg severity effect: in build/drop sections, additional bending increases eccentricity
      // Minimum eccentricity even with centralizers due to practical tolerances
      eccentricity = Math.max(eccentricity, 0.03);
    } else {
      // No centralizer — casing sags under gravity
      if (EI > 0) {
        // Free sag without support
        const L = spanLength;
        const sag_free_m = (5 * lateralF * Math.pow(L, 4)) / (384 * EI);
        eccentricity = Math.min(1, sag_free_m / rc_m);
        // In deviated wells without centralizers, casing tends to rest on low side
        // Apply minimum eccentricity based on inclination
        const inclinationFactor = Math.sin(zenith * Math.PI / 180);
        eccentricity = Math.max(eccentricity, 0.5 * inclinationFactor + 0.2 * inclinationFactor * inclinationFactor);
      } else {
        eccentricity = 1; // degenerate case
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

  // Segment the well by zenith zones (every 50m or change in zenith > 5°)
  const segmentSize = 50;
  const segments: { fromMD: number; toMD: number; zenithSamples: number[] }[] = [];
  
  for (let md = 0; md < wellData.casingDepthMD; md += segmentSize) {
    const endMD = Math.min(md + segmentSize, wellData.casingDepthMD);
    const samples: number[] = [];
    for (let m = md; m <= endMD; m += 5) {
      const { zenith } = interpolateTrajectory(wellData.trajectory, m);
      samples.push(zenith);
    }
    segments.push({ fromMD: md, toMD: endMD, zenithSamples: samples });
  }

  // Merge adjacent segments with similar zenith
  const merged: { fromMD: number; toMD: number; avgZenith: number }[] = [];
  for (const seg of segments) {
    const avg = seg.zenithSamples.reduce((a, b) => a + b, 0) / seg.zenithSamples.length;
    if (merged.length > 0) {
      const last = merged[merged.length - 1];
      if (Math.abs(last.avgZenith - avg) < 5) {
        last.toMD = seg.toMD;
        last.avgZenith = (last.avgZenith + avg) / 2;
        continue;
      }
    }
    merged.push({ fromMD: seg.fromMD, toMD: seg.toMD, avgZenith: avg });
  }

  const result: AutoPlacementInterval[] = [];

  for (const seg of merged) {
    const zenith = seg.avgZenith;

    if (zenith < 0.5) {
      // Vertical — minimal centralizers needed
      result.push({
        fromMD: seg.fromMD,
        toMD: seg.toMD,
        avgZenith: zenith,
        centralizersPerJoint: targetStandoff > 95 ? 1 : 0.5,
        standoffAchieved: 98,
        totalCentralizers: Math.ceil((seg.toMD - seg.fromMD) / jointLength * (targetStandoff > 95 ? 1 : 0.5)),
      });
      continue;
    }

    const lateralF = lateralForcePerMeter(wpm, bf, zenith);

    // Binary search for centralizersPerJoint (0.1 to 5.0)
    let lo = 0.1, hi = 5.0, bestCPJ = 1;
    
    for (let iter = 0; iter < 50; iter++) {
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

    // Round to nearest 0.1
    bestCPJ = Math.round(bestCPJ * 10) / 10;
    // Ensure at least 0.1
    bestCPJ = Math.max(0.1, bestCPJ);

    // Recalculate achieved standoff
    const L = jointLength / bestCPJ;
    const sag_free = (5 * lateralF * Math.pow(L, 4)) / (384 * EI);
    const springFactor = (k_spring * Math.pow(L, 3)) / (48 * EI);
    const sag = sag_free / (1 + springFactor);
    const ecc = Math.max(0.03, Math.min(1, sag / rc_m));
    const achieved = Math.round((1 - ecc) * 1000) / 10;

    const intervalLength = seg.toMD - seg.fromMD;
    const joints = intervalLength / jointLength;
    const totalCentralizers = Math.ceil(joints * bestCPJ);

    result.push({
      fromMD: seg.fromMD,
      toMD: seg.toMD,
      avgZenith: Math.round(zenith * 10) / 10,
      centralizersPerJoint: bestCPJ,
      standoffAchieved: achieved,
      totalCentralizers,
    });
  }

  return result;
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
