// Расчёт цементирования с вращением обсадной колонны
// Источники: SPE 322980716 (2018), Lockyear & Hibbert, McLean — модели Couette + Coulomb friction

import { interpolateTVD, type WellData, type TrajectoryPoint } from "./cementing-calculations";

// ---------------- БАЗА РЕЗЬБОВЫХ СОЕДИНЕНИЙ ----------------

export interface ConnectionType {
  id: string;
  name: string;
  nameRu: string;
  manufacturer: string;
  type: 'buttress' | 'round' | 'premium' | 'flush';
  makeupTorqueMin: number;
  makeupTorqueOpt: number;
  makeupTorqueMax: number;
  rotationTorqueLimit: number;
  tensileStrength_kN: number;
  compressiveStrength_kN: number;
  couplingOD_mm: number;
  couplingLength_mm: number;
  canRotate: boolean;
  notes: string;
}

export const CONNECTION_DATABASE: Record<string, ConnectionType[]> = {
  '114.3': [
    { id: 'btc-114', name: 'BTC', nameRu: 'ОТТМ (трапец.)', manufacturer: 'API', type: 'buttress',
      makeupTorqueMin: 3400, makeupTorqueOpt: 4500, makeupTorqueMax: 6000, rotationTorqueLimit: 4800,
      tensileStrength_kN: 1200, compressiveStrength_kN: 1200, couplingOD_mm: 127.0, couplingLength_mm: 203,
      canRotate: true, notes: 'API BTC. До 30 об/мин.' },
    { id: 'ltc-114', name: 'LTC', nameRu: 'ОТТГ (длинная)', manufacturer: 'API', type: 'round',
      makeupTorqueMin: 2200, makeupTorqueOpt: 3000, makeupTorqueMax: 4000, rotationTorqueLimit: 3200,
      tensileStrength_kN: 950, compressiveStrength_kN: 950, couplingOD_mm: 127.0, couplingLength_mm: 168,
      canRotate: false, notes: 'Круглая резьба. Вращение НЕ рекомендуется.' },
    { id: 'vam-top-114', name: 'VAM TOP', nameRu: 'VAM TOP', manufacturer: 'Vallourec', type: 'premium',
      makeupTorqueMin: 4000, makeupTorqueOpt: 5500, makeupTorqueMax: 7500, rotationTorqueLimit: 6000,
      tensileStrength_kN: 1500, compressiveStrength_kN: 1400, couplingOD_mm: 127.0, couplingLength_mm: 220,
      canRotate: true, notes: 'Премиум, газогерметичная.' },
  ],
  '168.3': [
    { id: 'btc-168', name: 'BTC', nameRu: 'ОТТМ', manufacturer: 'API', type: 'buttress',
      makeupTorqueMin: 7500, makeupTorqueOpt: 9500, makeupTorqueMax: 12000, rotationTorqueLimit: 9600,
      tensileStrength_kN: 2800, compressiveStrength_kN: 2800, couplingOD_mm: 187.7, couplingLength_mm: 254,
      canRotate: true, notes: '' },
    { id: 'ltc-168', name: 'LTC', nameRu: 'ОТТГ', manufacturer: 'API', type: 'round',
      makeupTorqueMin: 5000, makeupTorqueOpt: 6500, makeupTorqueMax: 8500, rotationTorqueLimit: 6800,
      tensileStrength_kN: 2200, compressiveStrength_kN: 2200, couplingOD_mm: 187.7, couplingLength_mm: 210,
      canRotate: false, notes: 'Круглая. Вращение НЕ рекомендуется.' },
    { id: 'vam-top-168', name: 'VAM TOP', nameRu: 'VAM TOP', manufacturer: 'Vallourec', type: 'premium',
      makeupTorqueMin: 8000, makeupTorqueOpt: 11000, makeupTorqueMax: 15000, rotationTorqueLimit: 12000,
      tensileStrength_kN: 3500, compressiveStrength_kN: 3200, couplingOD_mm: 187.3, couplingLength_mm: 280,
      canRotate: true, notes: 'Газогерметичная.' },
    { id: 'tenaris-blue-168', name: 'TenarisBlue', nameRu: 'TenarisBlue', manufacturer: 'Tenaris', type: 'premium',
      makeupTorqueMin: 8500, makeupTorqueOpt: 11500, makeupTorqueMax: 16000, rotationTorqueLimit: 12800,
      tensileStrength_kN: 3700, compressiveStrength_kN: 3400, couplingOD_mm: 187.7, couplingLength_mm: 285,
      canRotate: true, notes: 'Метал-к-металу уплотнение.' },
  ],
  '177.8': [
    { id: 'btc-178', name: 'BTC', nameRu: 'ОТТМ', manufacturer: 'API', type: 'buttress',
      makeupTorqueMin: 8500, makeupTorqueOpt: 11500, makeupTorqueMax: 14500, rotationTorqueLimit: 11600,
      tensileStrength_kN: 3200, compressiveStrength_kN: 3200, couplingOD_mm: 194.5, couplingLength_mm: 254,
      canRotate: true, notes: '' },
    { id: 'ltc-178', name: 'LTC', nameRu: 'ОТТГ', manufacturer: 'API', type: 'round',
      makeupTorqueMin: 5500, makeupTorqueOpt: 7500, makeupTorqueMax: 9800, rotationTorqueLimit: 7800,
      tensileStrength_kN: 2500, compressiveStrength_kN: 2500, couplingOD_mm: 194.5, couplingLength_mm: 215,
      canRotate: false, notes: 'Круглая. Вращение НЕ рекомендуется.' },
    { id: 'vam-top-178', name: 'VAM TOP', nameRu: 'VAM TOP', manufacturer: 'Vallourec', type: 'premium',
      makeupTorqueMin: 9500, makeupTorqueOpt: 13000, makeupTorqueMax: 17500, rotationTorqueLimit: 14000,
      tensileStrength_kN: 4100, compressiveStrength_kN: 3800, couplingOD_mm: 194.5, couplingLength_mm: 280,
      canRotate: true, notes: 'Премиум.' },
    { id: 'vam-21-178', name: 'VAM 21', nameRu: 'VAM 21', manufacturer: 'Vallourec', type: 'premium',
      makeupTorqueMin: 10000, makeupTorqueOpt: 14000, makeupTorqueMax: 19000, rotationTorqueLimit: 15200,
      tensileStrength_kN: 4400, compressiveStrength_kN: 4100, couplingOD_mm: 194.5, couplingLength_mm: 285,
      canRotate: true, notes: 'Усиленная премиум, выс. компрессия.' },
  ],
  '244.5': [
    { id: 'btc-245', name: 'BTC', nameRu: 'ОТТМ', manufacturer: 'API', type: 'buttress',
      makeupTorqueMin: 14000, makeupTorqueOpt: 18000, makeupTorqueMax: 23000, rotationTorqueLimit: 18400,
      tensileStrength_kN: 5500, compressiveStrength_kN: 5500, couplingOD_mm: 269.9, couplingLength_mm: 305,
      canRotate: true, notes: '' },
    { id: 'ltc-245', name: 'LTC', nameRu: 'ОТТГ', manufacturer: 'API', type: 'round',
      makeupTorqueMin: 9000, makeupTorqueOpt: 12000, makeupTorqueMax: 16000, rotationTorqueLimit: 12800,
      tensileStrength_kN: 4200, compressiveStrength_kN: 4200, couplingOD_mm: 269.9, couplingLength_mm: 240,
      canRotate: false, notes: 'Круглая. Вращение НЕ рекомендуется.' },
    { id: 'vam-top-245', name: 'VAM TOP', nameRu: 'VAM TOP', manufacturer: 'Vallourec', type: 'premium',
      makeupTorqueMin: 16000, makeupTorqueOpt: 21000, makeupTorqueMax: 28000, rotationTorqueLimit: 22400,
      tensileStrength_kN: 6800, compressiveStrength_kN: 6300, couplingOD_mm: 269.9, couplingLength_mm: 320,
      canRotate: true, notes: 'Премиум.' },
  ],
  '339.7': [
    { id: 'btc-340', name: 'BTC', nameRu: 'ОТТМ', manufacturer: 'API', type: 'buttress',
      makeupTorqueMin: 22000, makeupTorqueOpt: 28000, makeupTorqueMax: 36000, rotationTorqueLimit: 28800,
      tensileStrength_kN: 8500, compressiveStrength_kN: 8500, couplingOD_mm: 365.1, couplingLength_mm: 381,
      canRotate: true, notes: '' },
    { id: 'vam-top-340', name: 'VAM TOP', nameRu: 'VAM TOP', manufacturer: 'Vallourec', type: 'premium',
      makeupTorqueMin: 25000, makeupTorqueOpt: 33000, makeupTorqueMax: 44000, rotationTorqueLimit: 35200,
      tensileStrength_kN: 10500, compressiveStrength_kN: 9700, couplingOD_mm: 365.1, couplingLength_mm: 395,
      canRotate: true, notes: 'Премиум для кондукторов.' },
  ],
  '426.0': [
    { id: 'btc-426', name: 'BTC', nameRu: 'ОТТМ', manufacturer: 'API', type: 'buttress',
      makeupTorqueMin: 35000, makeupTorqueOpt: 45000, makeupTorqueMax: 58000, rotationTorqueLimit: 46400,
      tensileStrength_kN: 12000, compressiveStrength_kN: 12000, couplingOD_mm: 454.0, couplingLength_mm: 406,
      canRotate: true, notes: 'Требует верхнего привода.' },
    { id: 'vam-top-426', name: 'VAM TOP', nameRu: 'VAM TOP', manufacturer: 'Vallourec', type: 'premium',
      makeupTorqueMin: 40000, makeupTorqueOpt: 53000, makeupTorqueMax: 70000, rotationTorqueLimit: 56000,
      tensileStrength_kN: 14500, compressiveStrength_kN: 13500, couplingOD_mm: 454.0, couplingLength_mm: 420,
      canRotate: true, notes: 'Премиум для кондукторов.' },
  ],
};

// ---------------- БАЗА МАРОК СТАЛИ ----------------
// Источник: API 5CT / ГОСТ Р 53366. Yield strength (предел текучести), МПа.

export interface SteelGrade {
  id: string;
  name: string;
  yieldStrength_MPa: number;   // σ_y, МПа
  tensileStrength_MPa: number; // σ_u, МПа
  standard: 'API' | 'GOST';
}

export const STEEL_GRADES: SteelGrade[] = [
  { id: 'D',     name: 'Д (GOST)',  yieldStrength_MPa: 373, tensileStrength_MPa: 638, standard: 'GOST' },
  { id: 'J55',   name: 'J-55',      yieldStrength_MPa: 379, tensileStrength_MPa: 517, standard: 'API' },
  { id: 'K55',   name: 'K-55',      yieldStrength_MPa: 379, tensileStrength_MPa: 655, standard: 'API' },
  { id: 'E',     name: 'Е (GOST)',  yieldStrength_MPa: 539, tensileStrength_MPa: 686, standard: 'GOST' },
  { id: 'N80',   name: 'N-80',      yieldStrength_MPa: 552, tensileStrength_MPa: 689, standard: 'API' },
  { id: 'L80',   name: 'L-80',      yieldStrength_MPa: 552, tensileStrength_MPa: 655, standard: 'API' },
  { id: 'L',     name: 'Л (GOST)',  yieldStrength_MPa: 656, tensileStrength_MPa: 735, standard: 'GOST' },
  { id: 'C90',   name: 'C-90',      yieldStrength_MPa: 621, tensileStrength_MPa: 689, standard: 'API' },
  { id: 'T95',   name: 'T-95',      yieldStrength_MPa: 655, tensileStrength_MPa: 724, standard: 'API' },
  { id: 'M',     name: 'М (GOST)',  yieldStrength_MPa: 735, tensileStrength_MPa: 882, standard: 'GOST' },
  { id: 'P110',  name: 'P-110',     yieldStrength_MPa: 758, tensileStrength_MPa: 862, standard: 'API' },
  { id: 'R',     name: 'Р (GOST)',  yieldStrength_MPa: 931, tensileStrength_MPa: 1078, standard: 'GOST' },
  { id: 'Q125',  name: 'Q-125',     yieldStrength_MPa: 862, tensileStrength_MPa: 931, standard: 'API' },
  { id: 'T',     name: 'Т (GOST)',  yieldStrength_MPa: 1029, tensileStrength_MPa: 1127, standard: 'GOST' },
  { id: 'V150',  name: 'V-150',     yieldStrength_MPa: 1034, tensileStrength_MPa: 1138, standard: 'API' },
];

export interface SteelSection {
  fromMD: number;
  toMD: number;
  gradeId: string;
  wallThickness_mm?: number; // если не задано — берётся wellData.casingWall
}

export function getSteelGrade(id: string): SteelGrade {
  return STEEL_GRADES.find(g => g.id === id) || STEEL_GRADES[4]; // дефолт N-80
}

export function getSteelSectionAtMD(md: number, sections: SteelSection[] | undefined, defaultGradeId: string): SteelSection {
  if (sections && sections.length) {
    for (const s of sections) if (md >= s.fromMD && md <= s.toMD) return s;
  }
  return { fromMD: 0, toMD: 1e9, gradeId: defaultGradeId };
}

/**
 * Предел текучести тела трубы при кручении (Polar section modulus × τ_y).
 * Касательный предел: τ_y ≈ σ_y / √3 (критерий Мизеса).
 * T_y = (π / 16) × τ_y × (D⁴ − d⁴) / D, Н·м.
 */
export function pipeBodyTorsionalYield(casingOD_mm: number, wall_mm: number, yield_MPa: number): number {
  const D = casingOD_mm / 1000;
  const d = (casingOD_mm - 2 * wall_mm) / 1000;
  const tauY = yield_MPa * 1e6 / Math.sqrt(3); // Па
  return (Math.PI / 16) * tauY * (Math.pow(D, 4) - Math.pow(d, 4)) / D;
}



export function getConnectionsForOD(casingOD_mm: number): ConnectionType[] {
  // Найти ближайший типоразмер
  const sizes = Object.keys(CONNECTION_DATABASE).map(Number).sort((a, b) => a - b);
  let best = sizes[0];
  let bestDiff = Math.abs(casingOD_mm - best);
  for (const s of sizes) {
    const d = Math.abs(casingOD_mm - s);
    if (d < bestDiff) { best = s; bestDiff = d; }
  }
  return CONNECTION_DATABASE[best.toFixed(1)] || CONNECTION_DATABASE[String(best)] || [];
}

// ---------------- ИНТЕРПОЛЯЦИЯ УГЛА ----------------

function interpolateZenith(md: number, traj: TrajectoryPoint[]): number {
  if (!traj || traj.length === 0) return 0;
  const sorted = [...traj].sort((a, b) => a.md - b.md);
  if (md <= sorted[0].md) return sorted[0].zenith || 0;
  if (md >= sorted[sorted.length - 1].md) return sorted[sorted.length - 1].zenith || 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (md >= sorted[i].md && md <= sorted[i + 1].md) {
      const frac = (md - sorted[i].md) / (sorted[i + 1].md - sorted[i].md);
      return (sorted[i].zenith || 0) + frac * ((sorted[i + 1].zenith || 0) - (sorted[i].zenith || 0));
    }
  }
  return 0;
}

// ---------------- РАСЧЁТ ----------------

export interface RotationTorquePoint {
  depthMD: number;
  tvd: number;
  zenith: number;
  frictionTorque: number;
  viscousTorque: number;
  centralizerTorque: number;
  couplingTorque: number;
  totalTorque: number;
  connectionLimit: number;
  utilizationPct: number;
  canRotate: boolean;
  maxSafeRPM: number;
}

export interface PhaseTorque {
  phase: string;
  fluidInAnnulus: string;
  maxTorque: number;
  avgTorque: number;
  maxRPM: number;
}

export interface RotationAnalysisResult {
  points: RotationTorquePoint[];
  maxTorque: number;
  maxTorqueDepth: number;
  connectionLimit: number;
  maxSafeRPM: number;
  canRotateFullString: boolean;
  criticalDepth: number | null;
  torqueByPhase: PhaseTorque[];
  displacementImprovementPct: number;
  warnings: string[];
}

export interface FluidRheology {
  density: number; // кг/м³
  pv: number;      // сПз
  yp: number;      // Па
  name: string;
}

export interface RotationInput {
  wellData: WellData;
  connection: ConnectionType;
  rpm: number;
  frictionCoeff: number;
  annulusFluid: FluidRheology;
  pipeFluid?: FluidRheology;
  centralizers: Array<{ depthMD: number; type: 'rigid' | 'spring' | 'solid'; od_mm: number; dragTorque_Nm?: number }>;
  stopRings?: Array<{ depthMD: number; od_mm: number }>;
  crossovers?: Array<{ depthMD: number; od_mm: number; torqueAdd_Nm?: number }>;
  // Для фазового анализа
  phases?: Array<{ name: string; fluid: FluidRheology }>;
  baseDisplacementEff?: number; // % — базовая эффективность без вращения
  avgEccentricity?: number;     // 0..1
}

function singlePhaseTorque(input: RotationInput, fluid: FluidRheology, rpm: number): {
  cumTorque: number; points: RotationTorquePoint[]; avgFriction: number; avgViscous: number;
} {
  const omega = rpm * 2 * Math.PI / 60;
  const casOD = input.wellData.casingOD / 1000;
  const casR = casOD / 2;
  const step = 5;
  const wpm = (input.wellData as any).casingWeight || (casOD * 1000 * 0.2);
  const bf = 1 - fluid.density / 7850;
  const connectionLimit = input.connection.rotationTorqueLimit;

  let cumTorque = 0;
  const points: RotationTorquePoint[] = [];
  let sumFric = 0, sumVisc = 0, n = 0;

  for (let md = 0; md <= input.wellData.casingDepthMD; md += step) {
    const tvd = interpolateTVD(md, input.wellData.trajectory);
    const zenith = interpolateZenith(md, input.wellData.trajectory);
    const zenRad = zenith * Math.PI / 180;

    const prevCasing = input.wellData.prevCasingDepth || 0;
    const isOpenHole = md > prevCasing;
    const boreDiam = isOpenHole
      ? (input.wellData.holeDiameter / 1000) * Math.sqrt(input.wellData.cavernCoeff || 1)
      : (input.wellData.prevCasingID || input.wellData.holeDiameter) / 1000;
    const gap = Math.max(0.001, (boreDiam - casOD) / 2);

    // 1. Сухое трение (Coulomb)
    const Fn = wpm * 9.81 * bf * Math.sin(zenRad) * step;
    const frictionTorque = input.frictionCoeff * Fn * casR;

    // 2. Вязкостный момент (Bingham, Couette)
    const shearRate = omega * casR / gap;
    const muEff = (fluid.pv / 1000) + fluid.yp / Math.max(1e-3, shearRate);
    const viscousTorque = 2 * Math.PI * muEff * omega * casR * casR * casR * step / gap;

    // 3. Центраторы
    const centsAtDepth = input.centralizers.filter(c => Math.abs(c.depthMD - md) < step);
    const centralizerTorque = centsAtDepth.reduce((sum, c) => {
      const base = c.dragTorque_Nm ?? (c.type === 'rigid' ? 80 : c.type === 'solid' ? 100 : 40);
      return sum + base * (1 + rpm / 60);
    }, 0);

    // 4. Муфты — увеличенный OD
    const isJoint = (md % 12) < step;
    let couplingTorque = 0;
    if (isJoint) {
      const couplingOD = input.connection.couplingOD_mm / 1000;
      const couplingGap = (boreDiam - couplingOD) / 2;
      if (couplingGap < 0.005) {
        couplingTorque = input.frictionCoeff * Math.abs(Fn) * (couplingOD / 2) * 1.5;
      }
    }

    // 5. Переводники + упорные кольца
    const xovers = (input.crossovers || []).filter(x => Math.abs(x.depthMD - md) < step);
    const xoverTorque = xovers.reduce((s, x) => s + (x.torqueAdd_Nm || 20), 0);
    const stops = (input.stopRings || []).filter(s => Math.abs(s.depthMD - md) < step);
    const stopTorque = stops.reduce((s, r) => {
      const sg = (boreDiam - r.od_mm / 1000) / 2;
      return s + (sg < 0.005 ? input.frictionCoeff * Math.abs(Fn) * (r.od_mm / 2000) : 0);
    }, 0);

    const segTorque = frictionTorque + viscousTorque + centralizerTorque + couplingTorque + xoverTorque + stopTorque;
    cumTorque += segTorque;

    const dryAccum = frictionTorque + centralizerTorque + couplingTorque + xoverTorque + stopTorque;
    sumFric += dryAccum; sumVisc += viscousTorque; n++;

    const utilization = cumTorque / connectionLimit * 100;
    const maxSafeRPM = viscousTorque > 1e-6
      ? Math.max(0, Math.min(120, rpm * (connectionLimit - dryAccum * (points.length + 1)) / Math.max(1, cumTorque)))
      : 120;

    points.push({
      depthMD: md, tvd, zenith,
      frictionTorque: dryAccum,
      viscousTorque,
      centralizerTorque,
      couplingTorque: couplingTorque + xoverTorque + stopTorque,
      totalTorque: cumTorque,
      connectionLimit,
      utilizationPct: utilization,
      canRotate: cumTorque < connectionLimit,
      maxSafeRPM,
    });
  }

  return { cumTorque, points, avgFriction: sumFric / Math.max(1, n), avgViscous: sumVisc / Math.max(1, n) };
}

export function rotationEfficiencyBoost(rpm: number, eccentricity: number, baseEfficiency: number): number {
  const rpmNorm = Math.min(1, rpm / 30);
  const eccFactor = Math.min(1, eccentricity / 0.7);
  const boost = rpmNorm * eccFactor * 0.40;
  return Math.min(100, baseEfficiency + (100 - baseEfficiency) * boost);
}

export function calculateRotationTorque(input: RotationInput): RotationAnalysisResult {
  const warnings: string[] = [];
  const main = singlePhaseTorque(input, input.annulusFluid, input.rpm);

  let maxT = 0, maxD = 0;
  for (const p of main.points) {
    if (p.totalTorque > maxT) { maxT = p.totalTorque; maxD = p.depthMD; }
  }
  const limit = input.connection.rotationTorqueLimit;
  const criticalPoint = main.points.find(p => p.totalTorque >= limit);

  // Макс. безопасные обороты по всей колонне:
  // T(rpm) ≈ Tfric + Tvisc * (rpm / rpm_ref)
  // limit = Tfric + Tvisc * (rpmMax / rpm_ref)
  const totalFric = main.points.reduce((s, p) => s + p.frictionTorque + p.centralizerTorque + p.couplingTorque, 0);
  const totalVisc = main.points.reduce((s, p) => s + p.viscousTorque, 0);
  const rpmMax = totalVisc > 1e-6
    ? Math.max(0, input.rpm * (limit - totalFric) / Math.max(1, totalVisc))
    : 120;

  // Фазы
  const phases: PhaseTorque[] = [];
  const phaseList = input.phases && input.phases.length > 0
    ? input.phases
    : [
        { name: 'Циркуляция', fluid: input.annulusFluid },
        { name: 'Закачка буфера', fluid: { ...input.annulusFluid, pv: 15, yp: 8, density: 1050, name: 'буфер' } },
        { name: 'Закачка цемента', fluid: { ...input.annulusFluid, pv: 50, yp: 18, density: 1850, name: 'цемент' } },
        { name: 'Продавка', fluid: input.annulusFluid },
      ];
  for (const ph of phaseList) {
    const r = singlePhaseTorque(input, ph.fluid, input.rpm);
    const pts = r.points;
    const avg = pts.reduce((s, p) => s + p.totalTorque, 0) / Math.max(1, pts.length);
    const mx = pts.reduce((m, p) => Math.max(m, p.totalTorque), 0);
    const phaseFric = pts.reduce((s, p) => s + p.frictionTorque + p.centralizerTorque + p.couplingTorque, 0);
    const phaseVisc = pts.reduce((s, p) => s + p.viscousTorque, 0);
    const maxRPMphase = phaseVisc > 1e-6
      ? Math.max(0, input.rpm * (limit - phaseFric) / Math.max(1, phaseVisc))
      : 120;
    phases.push({
      phase: ph.name,
      fluidInAnnulus: ph.fluid.name,
      maxTorque: mx,
      avgTorque: avg,
      maxRPM: Math.min(120, maxRPMphase),
    });
  }

  // Бенефит замещения
  const base = input.baseDisplacementEff ?? 65;
  const ecc = input.avgEccentricity ?? 0.4;
  const boosted = rotationEfficiencyBoost(input.rpm, ecc, base);
  const improvement = boosted - base;

  // Предупреждения о муфтах
  const tight = main.points.filter(p => p.couplingTorque > 500);
  if (tight.length > 0) {
    warnings.push(`Зазор муфта-ствол < 5мм на ${tight.length} участках — возможен повышенный момент.`);
  }
  if (criticalPoint) {
    warnings.push(`На глубине ${criticalPoint.depthMD.toFixed(0)}м момент достигает предела резьбы.`);
  }
  if (!input.connection.canRotate) {
    warnings.push('Выбранная резьба не рекомендована для вращения.');
  }

  return {
    points: main.points,
    maxTorque: maxT,
    maxTorqueDepth: maxD,
    connectionLimit: limit,
    maxSafeRPM: Math.min(120, rpmMax),
    canRotateFullString: !criticalPoint,
    criticalDepth: criticalPoint ? criticalPoint.depthMD : null,
    torqueByPhase: phases,
    displacementImprovementPct: improvement,
    warnings,
  };
}

export function getBondGrade(cqi: number): { grade: string; color: string } {
  if (cqi >= 90) return { grade: 'A', color: '#16a34a' };
  if (cqi >= 80) return { grade: 'B', color: '#65a30d' };
  if (cqi >= 70) return { grade: 'C', color: '#ca8a04' };
  if (cqi >= 60) return { grade: 'D', color: '#ea580c' };
  if (cqi >= 50) return { grade: 'E', color: '#dc2626' };
  return { grade: 'F', color: '#991b1b' };
}
