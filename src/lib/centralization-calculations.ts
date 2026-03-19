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
  const rc = radialClearance(wellData.holeDiameter, wellData.casingOD);
  const EI = STEEL_E * casingMomentOfInertia(wellData.casingOD, wellData.casingWall); // Н·м²

  if (rc <= 0) return results;

  for (let md = 0; md <= wellData.casingDepthMD; md += step) {
    const { tvd, zenith } = interpolateTrajectory(wellData.trajectory, md);

    // Find matching interval
    const interval = intervals.find(iv => md >= iv.fromMD && md <= iv.toMD);

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

    const lateralF = lateralForcePerMeter(wpm, bf, zenith); // N/m

    let eccentricity: number;
    if (zenith < 0.5) {
      // Nearly vertical — casing hangs centered
      eccentricity = hasCentralizer ? 0 : 0.05;
    } else if (hasCentralizer && EI > 0) {
      // ═══ Beam deflection model (simply-supported beam with UDL) ═══
      // δmax = 5·w·L⁴ / (384·E·I), м — максимальный прогиб балки
      const L = spanLength;
      const sag_m = (5 * lateralF * Math.pow(L, 4)) / (384 * EI);
      
      // Центратор создает сосредоточенную силу в середине пролёта,
      // которая поднимает колонну: δ_lift = F·L³ / (48·E·I)
      let lift_m = 0;
      if (centralizerRestoring > 0) {
        lift_m = (centralizerRestoring * Math.pow(L, 3)) / (48 * EI);
      }
      
      // Результирующий прогиб (не может быть отрицательным)
      const net_sag_mm = Math.max(0, sag_m - lift_m) * 1000;
      eccentricity = Math.min(1, Math.max(0, net_sag_mm / rc));
    } else {
      // No centralizer — casing rests on low side
      const stiffnessFactor = Math.min(1, lateralF * spanLength / (wpm * 0.5));
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
