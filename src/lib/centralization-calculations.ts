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

/** DLS (dogleg severity) at given MD in °/30 м (2D — без азимута) */
function calcDLS(traj: TrajectoryPoint[], md: number, stepM: number = 30): number {
  if (!traj || traj.length < 2) return 0;
  const p1 = interpolateTrajectory(traj, Math.max(0, md - stepM / 2));
  const p2 = interpolateTrajectory(traj, md + stepM / 2);
  const zen1 = p1.zenith * Math.PI / 180;
  const zen2 = p2.zenith * Math.PI / 180;
  const dogleg = Math.abs(zen2 - zen1); // рад на stepM метров
  return (dogleg * 180 / Math.PI); // °/stepM == °/30 м при stepM=30
}

/**
 * Боковая сила с учётом веса и натяжения колонны на дог-леге:
 * F = sqrt(F_weight² + F_tension²),  F_tension = T · DLS(рад/м)
 */
function lateralForceWithDLS(
  weightPerMeter_N: number,
  buoyancy: number,
  zenithDeg: number,
  tensionN: number,
  dlsRadPerM: number,
): number {
  const Fw = weightPerMeter_N * buoyancy * Math.sin(zenithDeg * Math.PI / 180);
  const Ft = tensionN * dlsRadPerM;
  return Math.sqrt(Fw * Fw + Ft * Ft);
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

    // Натяжение колонны ниже данной точки (упрощённо: вес ниже × cos(зенита))
    const tensionN = wpm * bf * Math.max(0, wellData.casingDepthMD - md) * Math.cos(zenith * Math.PI / 180);
    const dlsDegPer30m = calcDLS(wellData.trajectory, md);
    const dlsRadPerM = (dlsDegPer30m * Math.PI / 180) / 30;
    const lateralF = lateralForceWithDLS(wpm, bf, zenith, tensionN, dlsRadPerM);

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

export type PlacementZone =
  | "wellhead"   // приустьевая (всегда крепим)
  | "pump"       // зона ГНО (всегда крепим)
  | "vertical"   // прямой вертикальный участок (только "для вида")
  | "build"      // набор кривизны / высокий DLS
  | "tangent"    // стабильный наклонный участок
  | "horizontal";// горизонтальный участок (>70°)

export const placementZoneLabels: Record<PlacementZone, string> = {
  wellhead: "Устьевая зона",
  pump: "Зона ГНО",
  vertical: "Вертикаль (стабиль.)",
  build: "Набор / угол (DLS)",
  tangent: "Тангенциальный (стабиль.)",
  horizontal: "Горизонталь",
};

export interface AutoPlacementInterval {
  fromMD: number;
  toMD: number;
  avgZenith: number;
  maxDLS: number;             // максимальный DLS в интервале, °/30м
  zone: PlacementZone;
  centralizersPerJoint: number;
  standoffAchieved: number;
  totalCentralizers: number;
}

export interface AutoPlacementOptions {
  pumpZoneTop?: number;       // верх зоны ГНО, MD
  pumpZoneBottom?: number;    // низ зоны ГНО, MD
  wellheadDepth?: number;     // глубина устьевой зоны (по умолч. 50 м)
  dlsThresholdDegPer30m?: number; // порог "набора" (по умолч. 1.5°/30м)
  verticalSparseJoints?: number;  // 1 центратор на N трубок в вертикали (по умолч. 15)
}

/**
 * Профильно-ориентированная авто-расстановка центраторов.
 *
 * Алгоритм:
 *   1. Скан трактории по сегментам (длина = jointLength).
 *   2. Для каждого сегмента считаем avgZenith, maxZenith, локальный 3D-DLS
 *      и классифицируем зону: устье / ГНО / набор (DLS > порога) / тангенс
 *      / горизонталь / вертикаль.
 *   3. Для каждой зоны решаем CPJ:
 *        - vertical (низкий зенит + низкий DLS): редкая расстановка
 *          (~1 центратор на verticalSparseJoints трубок) — «для вида».
 *        - wellhead / pump: бин-поиск, но НЕ ниже 1 центратора/трубу.
 *        - build (высокий DLS): бин-поиск + минимум 1, +20% запас.
 *        - tangent / horizontal: обычный бин-поиск по целевому Standoff.
 *   4. Сливаем соседние сегменты с одинаковыми CPJ и зоной.
 */
export function autoPlaceCentralizers(
  wellData: WellData,
  spec: CentralizerSpec,
  jointLength: number,
  targetStandoff: number,
  mudDensity: number,
  options: AutoPlacementOptions = {},
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

  // ─── Геометрический потолок standoff по высоте планки ───
  // Когда центратор плотно сидит в кольцевом зазоре, минимальная достижимая
  // эксцентричность ограничена геометрией: колонна смещается вниз ровно до
  // тех пор, пока планка не упрётся в стенку. ecc_min_geom = max(0, 1 − h/rc).
  // Для пружинных под нагрузкой планка частично сжимается (коэф. 0.85).
  const bladeRatio = Math.max(0, Math.min(1, spec.bladeHeight / Math.max(0.01, rc_mm)));
  const bladeCompress = spec.type === "spring" ? 0.85 : 1.0;
  const eccFloorGeom = Math.max(0, 1 - bladeRatio * bladeCompress);
  const maxAchievableStandoff = Math.round((1 - eccFloorGeom) * 1000) / 10;

  // Максимум центраторов на трубу — допускаем 3-4-5+ если нужно для цели.
  const MAX_CPJ = 8.0;

  const wellheadDepth = options.wellheadDepth ?? 50;
  const pumpTop = options.pumpZoneTop ?? 0;
  const pumpBot = options.pumpZoneBottom ?? 0;
  const pumpZoneActive = pumpBot > pumpTop && pumpBot > 0;
  const dlsThresh = options.dlsThresholdDegPer30m ?? 1.5;
  const sparseN = Math.max(2, Math.round(options.verticalSparseJoints ?? 15));
  const sparseCPJ = Math.round((1 / sparseN) * 100) / 100;

  const segmentSize = Math.max(jointLength, 10);

  // Локальный 3D-DLS
  function localDLS(md1: number, md2: number): number {
    const p1 = interpolateTrajectory(wellData.trajectory, md1);
    const p2 = interpolateTrajectory(wellData.trajectory, md2);
    const azi = (md: number): number => {
      const t = wellData.trajectory;
      if (!t || t.length === 0) return 0;
      if (md <= t[0].md) return t[0].azimuth;
      if (md >= t[t.length - 1].md) return t[t.length - 1].azimuth;
      for (let i = 0; i < t.length - 1; i++) {
        if (md >= t[i].md && md <= t[i + 1].md) {
          const f = (md - t[i].md) / (t[i + 1].md - t[i].md);
          return t[i].azimuth + f * (t[i + 1].azimuth - t[i].azimuth);
        }
      }
      return 0;
    };
    const i1 = p1.zenith * Math.PI / 180;
    const i2 = p2.zenith * Math.PI / 180;
    const a1 = azi(md1) * Math.PI / 180;
    const a2 = azi(md2) * Math.PI / 180;
    let cosA = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
    cosA = Math.max(-1, Math.min(1, cosA));
    const dMD = Math.max(1, md2 - md1);
    return (Math.acos(cosA) * 180 / Math.PI) * (30 / dMD);
  }

  interface RawSeg {
    fromMD: number; toMD: number;
    maxZenith: number; avgZenith: number;
    dls: number;
  }
  const rawSegments: RawSeg[] = [];
  for (let md = 0; md < wellData.casingDepthMD; md += segmentSize) {
    const endMD = Math.min(md + segmentSize, wellData.casingDepthMD);
    let maxZ = 0, sumZ = 0, cnt = 0;
    for (let m = md; m <= endMD; m += 2) {
      const { zenith } = interpolateTrajectory(wellData.trajectory, m);
      maxZ = Math.max(maxZ, zenith);
      sumZ += zenith;
      cnt++;
    }
    const dls = localDLS(md, endMD);
    rawSegments.push({ fromMD: md, toMD: endMD, maxZenith: maxZ, avgZenith: sumZ / Math.max(1, cnt), dls });
  }

  function classify(seg: RawSeg): PlacementZone {
    const mid = (seg.fromMD + seg.toMD) / 2;
    if (mid <= wellheadDepth) return "wellhead";
    if (pumpZoneActive && mid >= pumpTop && mid <= pumpBot) return "pump";
    if (seg.maxZenith >= 70) return "horizontal";
    if (seg.dls >= dlsThresh) return "build";
    if (seg.maxZenith >= 3) return "tangent";
    return "vertical";
  }

  // Эксцентричность для заданного CPJ с учётом изгиба, пружинной жёсткости
  // и геометрического потолка по высоте планки.
  function eccForCPJ(zenith: number, cpj: number): number {
    if (cpj <= 0) return 1;
    const L = jointLength / cpj;
    const lateralF = lateralForcePerMeter(wpm, bf, zenith);
    const sag_free = (5 * lateralF * Math.pow(L, 4)) / (384 * EI);
    const springFactor = (k_spring * Math.pow(L, 3)) / (48 * EI);
    const sag = sag_free / (1 + springFactor);
    const eccStructural = Math.min(1, sag / rc_m);
    return Math.max(eccFloorGeom, eccStructural, 0.02);
  }

  // Подбор минимального CPJ, дающего ecc ≤ targetEcc/boost.
  // Если даже MAX_CPJ не хватает — возвращает MAX_CPJ и blocked=true.
  function physicsCPJ(
    zenith: number,
    boostFactor: number = 1,
    minCPJ: number = 0,
  ): { cpj: number; standoff: number; blocked: boolean } {
    const targetEffEcc = Math.max(0, targetEcc / boostFactor);
    const blockedByBlade = eccFloorGeom > targetEcc + 1e-4;

    if (zenith < 0.1) {
      const ecc = Math.max(eccFloorGeom, 0.02);
      return {
        cpj: Math.max(sparseCPJ, minCPJ),
        standoff: Math.round((1 - ecc) * 1000) / 10,
        blocked: false,
      };
    }

    // Низкий зенит и без центраторов цель уже достигается — редкая расстановка
    if (zenith < 3 && minCPJ === 0) {
      const ecc_free = eccForCPJ(zenith, 1 / jointLength);
      if (ecc_free <= targetEffEcc) {
        return {
          cpj: sparseCPJ,
          standoff: Math.round((1 - Math.max(0.02, ecc_free)) * 1000) / 10,
          blocked: false,
        };
      }
    }

    let lo = 0.05, hi = MAX_CPJ, bestCPJ = MAX_CPJ;
    for (let iter = 0; iter < 60; iter++) {
      const mid = (lo + hi) / 2;
      const ecc = eccForCPJ(zenith, mid);
      if (ecc <= targetEffEcc) { bestCPJ = mid; hi = mid; } else { lo = mid; }
    }
    bestCPJ = Math.max(minCPJ, Math.ceil(bestCPJ * 10) / 10);
    bestCPJ = Math.min(MAX_CPJ, bestCPJ);

    // Если не дотягиваем до цели — добиваем CPJ шагом 0.1 до MAX_CPJ.
    let ecc = eccForCPJ(zenith, bestCPJ);
    while (ecc > targetEcc && bestCPJ < MAX_CPJ) {
      bestCPJ = Math.round((bestCPJ + 0.1) * 10) / 10;
      ecc = eccForCPJ(zenith, bestCPJ);
    }

    const standoff = Math.round((1 - ecc) * 1000) / 10;
    return { cpj: bestCPJ, standoff, blocked: blockedByBlade && standoff < targetStandoff - 0.5 };
  }

  function solveForZone(seg: RawSeg, zone: PlacementZone): { cpj: number; standoff: number } {
    switch (zone) {
      case "vertical": {
        const r = physicsCPJ(seg.maxZenith);
        return { cpj: sparseCPJ, standoff: Math.max(r.standoff, 95) };
      }
      case "wellhead": {
        const r = physicsCPJ(seg.maxZenith, 1.0, 1.0);
        return { cpj: r.cpj, standoff: r.standoff };
      }
      case "pump": {
        // Зона ГНО — критичная: +15% запас и минимум 1/трубу
        const r = physicsCPJ(seg.maxZenith, 1.15, 1.0);
        return { cpj: r.cpj, standoff: r.standoff };
      }
      case "build": {
        // Набор / угол: +20% запас, минимум 1/трубу
        const r = physicsCPJ(seg.maxZenith, 1.2, 1.0);
        return { cpj: r.cpj, standoff: r.standoff };
      }
      case "horizontal":
      case "tangent":
      default:
        return physicsCPJ(seg.maxZenith);
    }
  }

  const computed = rawSegments.map(seg => {
    const zone = classify(seg);
    const { cpj, standoff } = solveForZone(seg, zone);
    return { ...seg, zone, cpj, standoff };
  });

  const merged: AutoPlacementInterval[] = [];
  for (const seg of computed) {
    const last = merged[merged.length - 1];
    if (last && last.zone === seg.zone && last.centralizersPerJoint === seg.cpj) {
      const oldLen = last.toMD - last.fromMD;
      const newLen = seg.toMD - seg.fromMD;
      last.toMD = seg.toMD;
      last.avgZenith = Math.round(((last.avgZenith * oldLen + seg.avgZenith * newLen) / (oldLen + newLen)) * 10) / 10;
      last.maxDLS = Math.max(last.maxDLS, Math.round(seg.dls * 10) / 10);
      last.standoffAchieved = Math.min(last.standoffAchieved, seg.standoff);
      last.totalCentralizers = Math.ceil((last.toMD - last.fromMD) / jointLength * last.centralizersPerJoint);
      continue;
    }
    const intervalLength = seg.toMD - seg.fromMD;
    merged.push({
      fromMD: seg.fromMD,
      toMD: seg.toMD,
      avgZenith: Math.round(seg.avgZenith * 10) / 10,
      maxDLS: Math.round(seg.dls * 10) / 10,
      zone: seg.zone,
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
