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

/** Weight per meter of casing in air, N/m */
function casingWeightPerMeter(casingOD_mm: number, casingWall_mm: number): number {
  const od = casingOD_mm / 1000;
  const id = (casingOD_mm - 2 * casingWall_mm) / 1000;
  const area = Math.PI / 4 * (od * od - id * id);
  const steelDensity = 7850; // кг/м³
  return area * steelDensity * 9.81; // N/m
}

/** Buoyant weight factor (simplified, mud density in kg/m³) */
function buoyancyFactor(mudDensity: number): number {
  return 1 - mudDensity / 7850;
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
  const rc = radialClearance(wellData.holeDiameter, wellData.casingOD);

  if (rc <= 0) return results;

  for (let md = 0; md <= wellData.casingDepthMD; md += step) {
    const { tvd, zenith } = interpolateTrajectory(wellData.trajectory, md);

    // Find matching interval
    const interval = intervals.find(iv => md >= iv.fromMD && md <= iv.toMD);

    // Lateral force on a span between centralizers
    let spanLength: number;
    let centralizerRestoring = 0;
    let hasCentralizer = false;

    if (interval && interval.centralizersPerJoint > 0 && interval.jointLength > 0) {
      spanLength = interval.jointLength / interval.centralizersPerJoint;
      centralizerRestoring = interval.spec.restoringForce * 1000; // кН → Н
      hasCentralizer = true;
    } else {
      spanLength = 12; // длина трубы по умолчанию
    }

    const lateralF = lateralForcePerMeter(wpm, bf, zenith);
    // Distributed load on span (beam on two supports) → max deflection at midspan
    // Simplified: treat as simply-supported beam with UDL
    // δmax = 5·w·L⁴ / (384·E·I) but we use force-balance approach:
    // Total lateral force on span = w·L
    // Centralizer restoring force resists this
    // Eccentricity ratio = lateral_force_on_span / (restoring_force + lateral_force_on_span * correction)

    const totalLateralOnSpan = lateralF * spanLength; // N

    let eccentricity: number;
    if (zenith < 0.5) {
      // Nearly vertical — casing hangs centered
      eccentricity = hasCentralizer ? 0 : 0.05;
    } else if (hasCentralizer && centralizerRestoring > 0) {
      // Deflection model: beam sag between centralizers
      // Using catenary-like approximation: e = (w·L²) / (8·F_restoring) normalized to clearance
      const sag_mm = (lateralF * spanLength * spanLength) / (8 * centralizerRestoring) * 1000;
      eccentricity = Math.min(1, Math.max(0, sag_mm / rc));
    } else {
      // No centralizer — casing rests on low side
      // Some residual standoff from stiffness
      const stiffnessFactor = Math.min(1, totalLateralOnSpan / (wpm * 0.5));
      eccentricity = Math.min(1, 0.7 + 0.3 * stiffnessFactor);
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
