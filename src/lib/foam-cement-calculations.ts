/**
 * Foam Cementing — comprehensive engine.
 * A) Static profile by depth (iterative pressure, Z-factor N₂)
 * B) Dynamic profile by time (pumping simulation, BHP/ECD/N₂ rate)
 */

import {
  interpolateTVD,
  getCasingID,
  type TrajectoryPoint,
  type WellData,
} from "./cementing-calculations";

/* ──────────── Constants ──────────── */

const ATM_MPA = 0.101325;
const STD_TEMP_K = 293.15;
const M_N2 = 0.028014; // kg/mol
const R = 8.314;
const N2_TC = 126.2;
const N2_PC = 3.39;
const G = 9.81;

/* ──────────── Helpers ──────────── */

function areaM2(diamMm: number): number {
  const d = diamMm / 1000;
  return (Math.PI / 4) * d * d;
}
function annAreaM2(outerMm: number, innerMm: number): number {
  return areaM2(outerMm) - areaM2(innerMm);
}

/** Papay correlation for N₂ Z-factor (±3% up to 30 MPa) */
export function calcN2ZFactor(pressureMPa: number, tempK: number): number {
  if (pressureMPa <= ATM_MPA) return 1;
  const Tr = Math.max(0.5, tempK / N2_TC);
  const Pr = pressureMPa / N2_PC;
  const Z =
    1 -
    (3.53 * Pr) / Math.pow(10, 0.9813 * Tr) +
    (0.274 * Pr * Pr) / Math.pow(10, 0.8157 * Tr);
  return Math.max(0.3, Math.min(1.5, Z));
}

function n2DensityKgM3(pressureMPa: number, tempK: number): number {
  const Z = calcN2ZFactor(pressureMPa, tempK);
  return (pressureMPa * 1e6 * M_N2) / (Z * R * tempK);
}

/* ──────────── Recipe library (база рецептур пеноцемента) ──────────── */

export interface FoamCementRecipe {
  id: string;
  name: string;
  nameRu: string;
  baseDensity: number;        // г/см³
  waterCementRatio: number;
  yieldM3PerTon: number;
  pvCp: number;
  ypPa: number;
  thickeningTime30Bc: number; // мин
  maxTemp: number;            // °C
  foamStabilizerType: string;
  foamStabilizerConc: number; // % к массе цемента
  recommendedFQ: [number, number];
  description: string;
}

export const FOAM_CEMENT_RECIPES: FoamCementRecipe[] = [
  {
    id: "class-g-standard",
    name: "Class G + Standard Foamer",
    nameRu: "API Class G + Стандартный ПАВ",
    baseDensity: 1.90, waterCementRatio: 0.44, yieldM3PerTon: 0.76,
    pvCp: 45, ypPa: 8, thickeningTime30Bc: 240, maxTemp: 120,
    foamStabilizerType: "АОС", foamStabilizerConc: 0.5,
    recommendedFQ: [20, 75],
    description: "Стандартный пеноцемент для скважин до 3000 м",
  },
  {
    id: "lightweight-micro",
    name: "Lightweight Microsphere Blend",
    nameRu: "Облегчённый на микросферах + N₂",
    baseDensity: 1.50, waterCementRatio: 0.65, yieldM3PerTon: 1.10,
    pvCp: 30, ypPa: 5, thickeningTime30Bc: 300, maxTemp: 150,
    foamStabilizerType: "КПАВ", foamStabilizerConc: 0.3,
    recommendedFQ: [15, 50],
    description: "Для зон с низким градиентом ГРП",
  },
  {
    id: "heavy-foam",
    name: "Heavy Base + Foam",
    nameRu: "Утяжелённый базовый + N₂",
    baseDensity: 2.10, waterCementRatio: 0.38, yieldM3PerTon: 0.65,
    pvCp: 60, ypPa: 12, thickeningTime30Bc: 200, maxTemp: 100,
    foamStabilizerType: "АОС-М", foamStabilizerConc: 0.7,
    recommendedFQ: [25, 60],
    description: "Получение ρ 1.40–1.80 г/см³ из тяжёлого базового",
  },
  {
    id: "pct-i-g-cc-1",
    name: "PCT-I-G-CC-1",
    nameRu: "ПЦТ-I-G-CC-1 (ГОСТ 1581-2019)",
    baseDensity: 1.88, waterCementRatio: 0.44, yieldM3PerTon: 0.78,
    pvCp: 42, ypPa: 7, thickeningTime30Bc: 220, maxTemp: 110,
    foamStabilizerType: "АОС (сульфонол)", foamStabilizerConc: 0.5,
    recommendedFQ: [20, 70],
    description: "Российский тампонажный для умеренных температур",
  },
  {
    id: "pct-iii-ob-4",
    name: "PCT-III-Ob-4-50",
    nameRu: "ПЦТ-III-Об-4-50 (облегчённый)",
    baseDensity: 1.45, waterCementRatio: 0.70, yieldM3PerTon: 1.15,
    pvCp: 28, ypPa: 4, thickeningTime30Bc: 280, maxTemp: 50,
    foamStabilizerType: "Неонол АФ 9-12", foamStabilizerConc: 0.4,
    recommendedFQ: [15, 45],
    description: "Облегчённый ПЦТ для верхних интервалов до 50 °C",
  },
  {
    id: "pct-ii-50",
    name: "PCT-II-50",
    nameRu: "ПЦТ-II-50 (утяжелённый сульфатостойкий)",
    baseDensity: 2.05, waterCementRatio: 0.40, yieldM3PerTon: 0.68,
    pvCp: 55, ypPa: 11, thickeningTime30Bc: 210, maxTemp: 100,
    foamStabilizerType: "АОС-М", foamStabilizerConc: 0.6,
    recommendedFQ: [25, 55],
    description: "Сульфатостойкий утяжелённый для агрессивных сред",
  },
];

/* ──────────── Multi-zone foam quality ──────────── */

export interface FoamQualityZone {
  topMD: number;
  bottomMD: number;
  targetFQ: number; // %
}

/** Returns target FQ at given MD: explicit zone if defined, else fallback. */
export function getZonalFQ(md: number, zones: FoamQualityZone[] | undefined, fallback: number): number {
  if (!zones || zones.length === 0) return fallback;
  const z = zones.find(zn => md >= zn.topMD && md <= zn.bottomMD);
  return z ? z.targetFQ : fallback;
}

/* ──────────── A. STATIC PROFILE ──────────── */

export interface FoamCementInput {
  baseDensity: number;
  targetFoamQuality: number;
  backPressure: number;
  surfaceTemperature: number;
  bottomTemperature: number;
  wellDepthMD: number;
  casingDepthMD: number;
  holeDiameter: number;
  casingOD: number;
  cementTopMD: number;
  cementBottomMD: number;
  trajectory: TrajectoryPoint[];
  mudDensity: number;
  cavernCoeff?: number;
  pumpingTimeMin?: number;
  pumpRateLps?: number;
  /** Optional multi-zone FQ — overrides targetFoamQuality per depth interval */
  foamQualityZones?: FoamQualityZone[];
  /** Recipe id (for traceability/UI) */
  recipeId?: string;
}

export interface FoamCementPoint {
  md: number;
  tvd: number;
  pressure: number;
  temperature: number;
  foamQuality: number;
  foamDensity: number;
  n2VolumeRatio: number;
  compressionFactor: number;
  zFactor: number;
}

export interface FoamCementResult {
  points: FoamCementPoint[];
  initialVolumeM3: number;
  finalVolumeM3: number;
  slurryVolumeM3: number;
  n2VolumeStdM3: number;
  n2RateM3PerMin: number;
  pumpingTimeMin: number;
  avgFoamQuality: number;
  minFoamQuality: number;
  maxFoamQuality: number;
  avgFoamDensity: number;
  minFoamDensity: number;
  maxFoamDensity: number;
  ecdProfile: { md: number; ecd: number }[];
}

export function calculateFoamCement(input: FoamCementInput): FoamCementResult {
  const {
    baseDensity, targetFoamQuality, backPressure,
    surfaceTemperature, bottomTemperature,
    casingDepthMD, holeDiameter, casingOD,
    cementTopMD, cementBottomMD, trajectory, mudDensity,
  } = input;

  const cavernCoeff = input.cavernCoeff ?? 1.0;
  const traj = trajectory.length > 1
    ? trajectory
    : [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: casingDepthMD, azimuth: 0, zenith: 0, tvd: casingDepthMD }];

  const effHole = holeDiameter * Math.sqrt(cavernCoeff);
  const annArea = annAreaM2(effHole, casingOD);
  const cementLength = Math.max(0, cementBottomMD - cementTopMD);
  const nSteps = 200;
  const step = cementLength / nSteps;

  const surfacePressure = backPressure + ATM_MPA;
  const surfTK = surfaceTemperature + 273.15;
  const surfGasR = targetFoamQuality / Math.max(0.0001, 100 - targetFoamQuality);

  const topTVD = interpolateTVD(cementTopMD, traj);
  const bottomTVD = interpolateTVD(cementBottomMD, traj);
  let cumulativePressure = backPressure + mudDensity * G * topTVD / 1000;

  const points: FoamCementPoint[] = [];
  let prevTVD = topTVD;
  let totalN2Std = 0;
  let sumFQ = 0, sumDens = 0, minFQ = 100, maxFQ = 0, minDens = baseDensity, maxDens = 0;
  const ecdProfile: { md: number; ecd: number }[] = [];

  for (let i = 0; i <= nSteps; i++) {
    const md = cementTopMD + i * step;
    const tvd = interpolateTVD(md, traj);
    const dTvd = Math.max(0, tvd - prevTVD);

    const tempFrac = bottomTVD > topTVD ? (tvd - topTVD) / (bottomTVD - topTVD) : 0;
    const tempC = surfaceTemperature + tempFrac * (bottomTemperature - surfaceTemperature);
    const tempK = tempC + 273.15;

    const Z = calcN2ZFactor(cumulativePressure, tempK);
    const depthGasR = surfGasR * (surfacePressure * tempK) / (cumulativePressure * surfTK) * Z;
    const foamQuality = Math.max(0, Math.min(100, (depthGasR / (1 + depthGasR)) * 100));
    const n2Dens = n2DensityKgM3(cumulativePressure, tempK) / 1000;
    const foamDensity = baseDensity * (1 - foamQuality / 100) + n2Dens * (foamQuality / 100);

    if (dTvd > 0) cumulativePressure += foamDensity * G * dTvd / 1000;
    prevTVD = tvd;

    const compressionFactor = (ATM_MPA * tempK) / (cumulativePressure * STD_TEMP_K * Z);

    points.push({
      md, tvd, pressure: cumulativePressure, temperature: tempC,
      foamQuality, foamDensity,
      n2VolumeRatio: foamQuality / 100, compressionFactor, zFactor: Z,
    });
    sumFQ += foamQuality;
    sumDens += foamDensity;
    if (foamQuality < minFQ) minFQ = foamQuality;
    if (foamQuality > maxFQ) maxFQ = foamQuality;
    if (foamDensity < minDens) minDens = foamDensity;
    if (foamDensity > maxDens) maxDens = foamDensity;
    if (tvd > 0) ecdProfile.push({ md, ecd: cumulativePressure / (G * tvd / 1000) });
  }

  const count = points.length;
  const finalVolumeM3 = annArea * cementLength;
  let slurryVolumeM3 = 0;
  const segLen = count > 1 ? cementLength / (count - 1) : 0;
  for (const pt of points) {
    slurryVolumeM3 += annArea * segLen * (1 - pt.foamQuality / 100);
    const gasV = annArea * segLen * pt.n2VolumeRatio;
    const tempK = pt.temperature + 273.15;
    totalN2Std += gasV * pt.pressure / ATM_MPA * STD_TEMP_K / tempK / pt.zFactor;
  }
  const initialVolumeM3 = slurryVolumeM3 / Math.max(1e-6, 1 - targetFoamQuality / 100);

  let pumpingTimeMin: number;
  if (input.pumpingTimeMin && input.pumpingTimeMin > 0) pumpingTimeMin = input.pumpingTimeMin;
  else if (input.pumpRateLps && input.pumpRateLps > 0) pumpingTimeMin = slurryVolumeM3 / (input.pumpRateLps * 0.06);
  else pumpingTimeMin = 60;
  const n2RateM3PerMin = pumpingTimeMin > 0 ? totalN2Std / pumpingTimeMin : 0;

  return {
    points, initialVolumeM3, finalVolumeM3, slurryVolumeM3,
    n2VolumeStdM3: totalN2Std, n2RateM3PerMin, pumpingTimeMin,
    avgFoamQuality: count > 0 ? sumFQ / count : 0,
    minFoamQuality: minFQ, maxFoamQuality: maxFQ,
    avgFoamDensity: count > 0 ? sumDens / count : 0,
    minFoamDensity: minDens, maxFoamDensity: maxDens,
    ecdProfile,
  };
}

/* ──────────── B. DYNAMIC TIME PROFILE ──────────── */

export interface FoamPumpingInput {
  wellData: WellData;
  trajectory: TrajectoryPoint[];
  mudDensity: number;        // g/cm³
  baseDensity: number;       // g/cm³ (slurry only)
  targetFoamQuality: number; // %
  backPressure: number;      // MPa
  surfaceTemperature: number;
  bottomTemperature: number;
  bufferVolume: number;      // m³
  bufferDensity: number;     // g/cm³
  pumpRateLps: number;       // l/s (base slurry rate)
  cementTopMD: number;
  cementBottomMD: number;
  fractureGradient: number;  // kPa/m
  cavernCoeff: number;
}

export interface FoamPressurePoint {
  stage: string;
  time: number;
  surfacePressure: number;
  bottomholePressure: number;
  fracturePressure: number;
  cumulativeVolume: number;
  pumpRateLps: number;
  n2RateStdM3min: number;
  cumulativeN2StdM3: number;
  foamQualitySurface: number;
  foamQualityBottom: number;
  foamDensitySurface: number;
  foamDensityBottom: number;
  slurryRateLps: number;
  ecdAtBottom: number;
  ecdStatic: number;
  fracGradEcd: number;
  annMudHeightM: number;
  annBufferHeightM: number;
  annFoamHeightM: number;
  foamTopMD: number;
  annularVelocityMps: number;
}

export interface FoamPumpingResult {
  points: FoamPressurePoint[];
  stageBoundaries: { time: number; label: string }[];
  totalN2StdM3: number;
  peakN2RateStdM3min: number;
  totalBaseSlurryM3: number;
  totalFoamVolumeAtSurfaceM3: number;
  pumpingTimeMin: number;
  bufferTimeMin: number;
  foamTimeMin: number;
  displacementTimeMin: number;
  avgFoamDensityAnn: number;
  maxBHPmpa: number;
  maxECD: number;
}

/** Compute foam column hydrostatic + densities at top/bottom via top-down integration */
function integrateFoamColumn(
  topMD: number,
  heightM: number,
  pTopMpa: number,
  input: FoamPumpingInput,
  traj: TrajectoryPoint[],
): { pBottom: number; densTop: number; densBottom: number; fqTop: number; fqBottom: number; avgDens: number } {
  if (heightM <= 0) {
    return { pBottom: pTopMpa, densTop: input.baseDensity, densBottom: input.baseDensity, fqTop: input.targetFoamQuality, fqBottom: input.targetFoamQuality, avgDens: input.baseDensity };
  }
  const surfP = input.backPressure + ATM_MPA;
  const surfTK = input.surfaceTemperature + 273.15;
  const surfGasR = input.targetFoamQuality / Math.max(0.0001, 100 - input.targetFoamQuality);
  const bottomTVDref = interpolateTVD(input.cementBottomMD, traj);
  const topTVDref = interpolateTVD(input.cementTopMD, traj);

  const slices = 30;
  const dh = heightM / slices;
  let p = pTopMpa;
  let densTop = input.baseDensity, fqTop = input.targetFoamQuality;
  let densBottom = densTop, fqBottom = fqTop;
  let sumDens = 0, count = 0;
  let prevTVD = interpolateTVD(topMD, traj);

  for (let i = 0; i <= slices; i++) {
    const md = topMD + i * dh;
    const tvd = interpolateTVD(md, traj);
    const tempFrac = bottomTVDref > topTVDref ? Math.max(0, Math.min(1, (tvd - topTVDref) / (bottomTVDref - topTVDref))) : 0;
    const tempC = input.surfaceTemperature + tempFrac * (input.bottomTemperature - input.surfaceTemperature);
    const tempK = tempC + 273.15;
    const Z = calcN2ZFactor(p, tempK);
    const depthGasR = surfGasR * (surfP * tempK) / (p * surfTK) * Z;
    const fq = Math.max(0, Math.min(100, (depthGasR / (1 + depthGasR)) * 100));
    const n2D = n2DensityKgM3(p, tempK) / 1000;
    const dens = input.baseDensity * (1 - fq / 100) + n2D * (fq / 100);
    if (i === 0) { densTop = dens; fqTop = fq; }
    densBottom = dens; fqBottom = fq;
    sumDens += dens; count++;
    const dTVD = Math.max(0, tvd - prevTVD);
    if (dTVD > 0) p += dens * G * dTVD / 1000;
    prevTVD = tvd;
  }
  return { pBottom: p, densTop, densBottom, fqTop, fqBottom, avgDens: count > 0 ? sumDens / count : input.baseDensity };
}

/**
 * Approximate height in annulus consumed by a given volume,
 * walking from bottom of stack upward against `annArea`.
 */
function volToHeight(volM3: number, annArea: number): number {
  return volM3 / Math.max(1e-9, annArea);
}

export function calculateFoamPressureProfile(input: FoamPumpingInput): FoamPumpingResult {
  const traj = input.trajectory.length > 1 ? input.trajectory : [
    { md: 0, azimuth: 0, zenith: 0, tvd: 0 },
    { md: input.wellData.casingDepthMD, azimuth: 0, zenith: 0, tvd: input.wellData.casingDepthMD },
  ];
  const wd = input.wellData;
  const casingID = getCasingID(wd.casingOD, wd.casingWall);
  const pipeArea = areaM2(casingID);
  const pipeCapacity = pipeArea * wd.casingDepthMD;

  const effHole = wd.holeDiameter * Math.sqrt(input.cavernCoeff || 1);
  const annArea = annAreaM2(effHole, wd.casingOD);
  const annTotalVolume = annArea * wd.casingDepthMD;
  const foamAnnVolume = annArea * Math.max(0, input.cementBottomMD - input.cementTopMD);

  const slurryRate = Math.max(0.1, input.pumpRateLps);
  const foamRateSurface = slurryRate / Math.max(0.0001, 1 - input.targetFoamQuality / 100);
  const n2RateSurfaceLps = foamRateSurface - slurryRate;

  // Volumes (surface basis)
  const bufferVol = Math.max(0, input.bufferVolume);
  const baseSlurryNeeded = foamAnnVolume; // slurry volume = annular foam volume (gas fills the rest)
  const foamVolSurface = baseSlurryNeeded / Math.max(0.0001, 1 - input.targetFoamQuality / 100);
  const displacementVol = pipeCapacity;

  const bufferTimeMin = bufferVol / (slurryRate * 0.06);
  const foamTimeMin = foamVolSurface / (foamRateSurface * 0.06);
  const dispTimeMin = displacementVol / (slurryRate * 0.06);
  const pumpingTimeMin = bufferTimeMin + foamTimeMin + dispTimeMin;

  const bottomTVD = interpolateTVD(input.cementBottomMD, traj);
  const fracPMpa = input.fractureGradient * bottomTVD / 1000; // kPa/m × m → kPa → /1000 MPa
  const fracGradEcd = input.fractureGradient / G; // approx g/cm³

  const dtMin = 0.5;
  const points: FoamPressurePoint[] = [];
  const stageBoundaries: { time: number; label: string }[] = [];
  let cumTime = 0;
  let cumBaseSlurryPumped = 0; // m³ slurry equivalent
  let cumFoamPumpedSurface = 0; // m³ foam at surface
  let cumBufferPumped = 0;
  let cumDispPumped = 0;
  let cumN2Std = 0;
  let peakN2 = 0;
  let maxBHP = 0, maxECD = 0;
  let sumFoamDensAnn = 0, foamDensCount = 0;

  const phases: Array<{ name: string; durationMin: number; kind: "buffer" | "foam" | "disp" }> = [
    { name: "Буфер", durationMin: bufferTimeMin, kind: "buffer" },
    { name: "Пеноцемент", durationMin: foamTimeMin, kind: "foam" },
    { name: "Продавка", durationMin: dispTimeMin, kind: "disp" },
  ];

  stageBoundaries.push({ time: 0, label: "Начало" });

  for (const phase of phases) {
    if (phase.durationMin <= 0) {
      stageBoundaries.push({ time: cumTime, label: phase.name });
      continue;
    }
    const steps = Math.max(1, Math.round(phase.durationMin / dtMin));
    const stepDt = phase.durationMin / steps;

    for (let s = 0; s < steps; s++) {
      cumTime += stepDt;
      const isFoam = phase.kind === "foam";
      const currentSlurryRate = slurryRate;
      const currentFoamRate = isFoam ? foamRateSurface : currentSlurryRate;
      const slurryStep = currentSlurryRate * 0.06 * stepDt;
      const foamStep = currentFoamRate * 0.06 * stepDt;

      if (phase.kind === "buffer") cumBufferPumped += slurryStep;
      if (phase.kind === "foam") cumFoamPumpedSurface += foamStep;
      if (phase.kind === "disp") cumDispPumped += slurryStep;
      cumBaseSlurryPumped += slurryStep;

      // ── Annulus composition ──
      // Total volume that has exited the casing into annulus = cumulative pumped surface volume above pipe capacity.
      // Order pumped (surface): buffer → foam (surface) → displacement.
      const totalSurfacePumped = cumBufferPumped + cumFoamPumpedSurface + cumDispPumped;
      const annExitedSurface = Math.max(0, totalSurfacePumped - pipeCapacity);

      // Slices in annulus from bottom up: first that exits goes to bottom (no, displacing mud upward → first exits goes to bottom of annulus and pushes mud up).
      // Sequence at annulus bottom (oldest first): buffer (bottom), then foam, then displacement at top.
      // Cumulative tracking in annulus:
      let bufferInAnn = Math.min(cumBufferPumped, annExitedSurface);
      let remaining = annExitedSurface - bufferInAnn;
      // For foam, surface→downhole the volume compresses. Estimate foam volume in annulus
      // by integrating slurry-side: the volume of foam (downhole) = base slurry that has reached annulus.
      // Base slurry exited = max(0, cumBaseSlurryPumped - pipeCapacity - cumBufferPumped) approximation.
      const slurryFoamExited = Math.max(0, cumBaseSlurryPumped - pipeCapacity - cumBufferPumped - cumDispPumped);
      // Foam downhole volume ≈ slurryFoamExited (since gas at high P shrinks → ~slurry vol)
      const foamInAnnDownhole = Math.min(foamAnnVolume, slurryFoamExited);
      // Displacement in annulus (mud) — happens only if foam fully placed
      const dispInAnn = Math.max(0, annExitedSurface - bufferInAnn - foamInAnnDownhole);

      const bufferH = volToHeight(bufferInAnn, annArea);
      const foamH = volToHeight(foamInAnnDownhole, annArea);
      const dispH = volToHeight(dispInAnn, annArea);
      const mudH = Math.max(0, wd.casingDepthMD - bufferH - foamH - dispH);

      // ── Hydrostatic from surface to bottom ──
      // Order top→bottom: mud, displacement (over foam? no — displacement is at top of annulus AFTER foam fills bottom)
      // Actually annulus order bottom→top: buffer | foam | displacement | mud(unreplaced)
      // Wait. As fluids exit casing → they enter annulus at SHOE (bottom). First exited is at bottom.
      // So bottom→top: BUFFER(first) → FOAM → DISP → MUD(remaining original)
      // Top→bottom (for pressure integration): MUD, DISP(mud), FOAM, BUFFER
      let p = input.backPressure;
      let curTVD = 0;

      // Mud column at top
      if (mudH > 0) {
        const topMD = 0;
        const botMD = mudH;
        const botTVD = interpolateTVD(botMD, traj);
        p += input.mudDensity * G * (botTVD - curTVD) / 1000;
        curTVD = botTVD;
      }
      // Displacement (mud-like) column
      if (dispH > 0) {
        const topMD = mudH;
        const botMD = mudH + dispH;
        const botTVD = interpolateTVD(botMD, traj);
        p += input.mudDensity * G * (botTVD - curTVD) / 1000;
        curTVD = botTVD;
      }
      // Foam column (variable density)
      let foamDensTopVal = input.baseDensity, foamDensBotVal = input.baseDensity, fqTopVal = input.targetFoamQuality, fqBotVal = input.targetFoamQuality;
      if (foamH > 0) {
        const topMD = mudH + dispH;
        const integ = integrateFoamColumn(topMD, foamH, p, input, traj);
        p = integ.pBottom;
        foamDensTopVal = integ.densTop;
        foamDensBotVal = integ.densBottom;
        fqTopVal = integ.fqTop;
        fqBotVal = integ.fqBottom;
        sumFoamDensAnn += integ.avgDens;
        foamDensCount++;
        curTVD = interpolateTVD(topMD + foamH, traj);
      }
      // Buffer column at bottom
      if (bufferH > 0) {
        const topMD = mudH + dispH + foamH;
        const botMD = Math.min(wd.casingDepthMD, topMD + bufferH);
        const botTVD = interpolateTVD(botMD, traj);
        p += input.bufferDensity * G * (botTVD - curTVD) / 1000;
        curTVD = botTVD;
      }
      // Extend to bottom if anything missing
      if (curTVD < bottomTVD) {
        p += input.mudDensity * G * (bottomTVD - curTVD) / 1000;
      }

      const bhp = p;
      const ecd = bottomTVD > 0 ? bhp / (G * bottomTVD / 1000) : 0;

      // ── Surface pressure (simplified: friction stub) ──
      // Friction-free assumption; surface P ≈ pump pressure to push fluid down inside pipe & up annulus
      // For dynamic display we estimate ΔP = BHP_ann - hydrostatic_inside_pipe
      // Inside pipe: at this snapshot, pipe is mostly filled with whatever was pumped last.
      // Use mud-density approximation for inside (acceptable since pipe holds displacement mud in late stage).
      const innerHydro = input.mudDensity * G * bottomTVD / 1000;
      const surfP = Math.max(0, bhp - innerHydro + input.backPressure);

      // ── N₂ rate ──
      let n2RateStd = 0;
      if (isFoam) {
        const surfaceP = input.backPressure + ATM_MPA;
        const surfTK = input.surfaceTemperature + 273.15;
        // N₂ at surface conditions → std: V_std = V_surf × P/P_std × T_std/T
        const n2VolPerMin_surf = n2RateSurfaceLps * 60 / 1000; // m³/min at surface
        n2RateStd = n2VolPerMin_surf * surfaceP / ATM_MPA * STD_TEMP_K / surfTK;
        cumN2Std += n2RateStd * stepDt;
        if (n2RateStd > peakN2) peakN2 = n2RateStd;
      }

      maxBHP = Math.max(maxBHP, bhp);
      maxECD = Math.max(maxECD, ecd);

      const annVelMps = (currentFoamRate / 1000) / annArea;
      const foamSurfDens = isFoam ? input.baseDensity * (1 - input.targetFoamQuality / 100) : (phase.kind === "buffer" ? input.bufferDensity : input.mudDensity);

      points.push({
        stage: phase.name,
        time: cumTime,
        surfacePressure: surfP,
        bottomholePressure: bhp,
        fracturePressure: fracPMpa,
        cumulativeVolume: cumBaseSlurryPumped,
        pumpRateLps: currentSlurryRate,
        n2RateStdM3min: n2RateStd,
        cumulativeN2StdM3: cumN2Std,
        foamQualitySurface: isFoam ? input.targetFoamQuality : 0,
        foamQualityBottom: foamH > 0 ? fqBotVal : (isFoam ? input.targetFoamQuality : 0),
        foamDensitySurface: foamSurfDens,
        foamDensityBottom: foamH > 0 ? foamDensBotVal : foamSurfDens,
        slurryRateLps: currentSlurryRate,
        ecdAtBottom: ecd,
        ecdStatic: ecd,
        fracGradEcd,
        annMudHeightM: mudH,
        annBufferHeightM: bufferH,
        annFoamHeightM: foamH,
        foamTopMD: mudH + dispH,
        annularVelocityMps: annVelMps,
      });
    }
    stageBoundaries.push({ time: cumTime, label: phase.name });
  }

  return {
    points, stageBoundaries,
    totalN2StdM3: cumN2Std,
    peakN2RateStdM3min: peakN2,
    totalBaseSlurryM3: baseSlurryNeeded,
    totalFoamVolumeAtSurfaceM3: foamVolSurface,
    pumpingTimeMin,
    bufferTimeMin,
    foamTimeMin,
    displacementTimeMin: dispTimeMin,
    avgFoamDensityAnn: foamDensCount > 0 ? sumFoamDensAnn / foamDensCount : input.baseDensity,
    maxBHPmpa: maxBHP,
    maxECD,
  };
}
