/**
 * Foam Cementing calculation engine.
 * Computes foam quality, density profile, N₂ volume and rate by depth
 * with iterative top-down pressure integration and N₂ real-gas Z-factor.
 */

import { interpolateTVD, type TrajectoryPoint } from "./cementing-calculations";

/* ───── Types ───── */

export interface FoamCementInput {
  baseDensity: number;           // базовая плотность цемента, г/см³
  targetFoamQuality: number;     // целевое качество пены, % (20–80)
  backPressure: number;          // обратное давление, МПа
  surfaceTemperature: number;    // температура на устье, °C
  bottomTemperature: number;     // температура на забое, °C
  wellDepthMD: number;           // глубина скважины, м
  casingDepthMD: number;         // глубина спуска ОК, м
  holeDiameter: number;          // диаметр ствола, мм
  casingOD: number;              // наружный диаметр ОК, мм
  cementTopMD: number;           // кровля цемента, м
  cementBottomMD: number;        // подошва цемента, м
  trajectory: TrajectoryPoint[];
  mudDensity: number;            // плотность бурового раствора, г/см³
  cavernCoeff?: number;          // кавернозность открытого ствола (1.0 = нет)
  pumpingTimeMin?: number;       // фактическое время закачки, мин
  pumpRateLps?: number;          // расход закачки базовой суспензии, л/с
}

export interface FoamCementPoint {
  md: number;
  tvd: number;
  pressure: number;              // МПа (гидростатическое суммарное)
  temperature: number;           // °C
  foamQuality: number;           // % (0–100)
  foamDensity: number;           // г/см³
  n2VolumeRatio: number;         // объёмная доля N₂ на этой глубине
  compressionFactor: number;     // V_std / V_depth (для справки)
  zFactor: number;               // Z-фактор N₂ на данных P,T
}

export interface FoamCementResult {
  points: FoamCementPoint[];
  initialVolumeM3: number;       // объём пеноцемента на устье (суспензия + газ при P_surface)
  finalVolumeM3: number;         // объём пеноцемента в скважине (полный кольцевой объём)
  slurryVolumeM3: number;        // объём базовой суспензии (без газа)
  n2VolumeStdM3: number;         // объём N₂ при стандартных условиях, м³
  n2RateM3PerMin: number;        // средний расход N₂, м³/мин (стд.)
  pumpingTimeMin: number;        // принятое время закачки, мин
  avgFoamQuality: number;
  minFoamQuality: number;
  maxFoamQuality: number;
  avgFoamDensity: number;
  minFoamDensity: number;
  maxFoamDensity: number;
  ecdProfile: { md: number; ecd: number }[];
}

/* ───── Constants ───── */

const ATM_MPA = 0.101325;        // атмосферное давление, МПа
const STD_TEMP_K = 293.15;       // стандартная температура, K (20°C)
const R_J_MOL_K = 8.314;         // универс. газовая постоянная, Дж/(моль·K)
const M_N2_KG_MOL = 0.028014;    // молярная масса N₂, кг/моль
const N2_TC_K = 126.2;           // критическая температура N₂, K
const N2_PC_MPA = 3.39;          // критическое давление N₂, МПа

/* ───── Helpers ───── */

function areaM2(diamMm: number): number {
  const d = diamMm / 1000;
  return (Math.PI / 4) * d * d;
}

function annAreaM2(outerMm: number, innerMm: number): number {
  return areaM2(outerMm) - areaM2(innerMm);
}

/**
 * Z-фактор N₂ — упрощённая корреляция через приведённые параметры
 * (точность ±2–5% до 50 МПа в диапазоне 280–400 K).
 */
export function calcN2CompressibilityFactor(pressureMPa: number, tempK: number): number {
  if (pressureMPa <= ATM_MPA || tempK <= 0) return 1;
  const Tr = tempK / N2_TC_K;
  const Pr = pressureMPa / N2_PC_MPA;
  // Корреляция типа Dranchuk-Abou-Kassem (сокращённая)
  const A = 0.3265 - 1.0700 / Tr - 0.5339 / (Tr * Tr * Tr);
  const B = 0.5475 - 0.7361 / Tr + 0.1844 / (Tr * Tr);
  const rhoR = 0.27 * Pr / Tr; // приведённая плотность (нач. приближение)
  let Z = 1 + A * rhoR + B * rhoR * rhoR;
  Z = Math.max(0.3, Math.min(1.5, Z));
  return Z;
}

/** Плотность N₂ из уравнения состояния реального газа, кг/м³ */
function n2DensityKgM3(pressureMPa: number, tempK: number): number {
  const Z = calcN2CompressibilityFactor(pressureMPa, tempK);
  // PV = ZnRT → ρ = P·M / (Z·R·T)
  return (pressureMPa * 1e6 * M_N2_KG_MOL) / (Z * R_J_MOL_K * tempK);
}

/* ───── Main Calculation ───── */

export function calculateFoamCement(input: FoamCementInput): FoamCementResult {
  const {
    baseDensity, targetFoamQuality, backPressure,
    surfaceTemperature, bottomTemperature,
    wellDepthMD, casingDepthMD, holeDiameter, casingOD,
    cementTopMD, cementBottomMD, trajectory, mudDensity,
  } = input;

  const cavernCoeff = input.cavernCoeff ?? 1.0;
  const traj = trajectory.length > 1
    ? trajectory
    : [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: wellDepthMD, azimuth: 0, zenith: 0, tvd: wellDepthMD }];

  // Кольцевая площадь с учётом кавернозности
  const effectiveHoleDia = holeDiameter * Math.sqrt(cavernCoeff);
  const annArea = annAreaM2(effectiveHoleDia, casingOD);
  const cementLength = Math.max(0, cementBottomMD - cementTopMD);
  const nSteps = 100;
  const step = Math.max(0.5, cementLength / nSteps);
  const points: FoamCementPoint[] = [];

  // Поверхностные условия для целевого FQ
  const surfacePressure = backPressure + ATM_MPA;
  const surfaceTempK = surfaceTemperature + 273.15;
  // Соотношение V_gas / V_slurry при поверхностных условиях
  const surfaceGasSlurryRatio = targetFoamQuality / (100 - targetFoamQuality);

  // Гидростатика мудовой колонны над кровлей цемента
  const topTVD = interpolateTVD(cementTopMD, traj);
  // ρ[g/cm³] · g · h[м] / 1000 = МПа
  let cumulativePressure = backPressure + mudDensity * 9.81 * topTVD / 1000;

  let totalN2StdM3 = 0;
  let sumFQ = 0, sumDens = 0, count = 0;
  let minFQ = 100, maxFQ = 0;
  let minDens = baseDensity, maxDens = 0;
  const ecdProfile: { md: number; ecd: number }[] = [];

  let prevTVD = topTVD;

  // Итеративный проход сверху вниз: давление на текущей точке
  // строится из накопленного давления + dP от плотности этого слоя.
  for (let md = cementTopMD; md <= cementBottomMD + 1e-6; md += step) {
    const mdCur = Math.min(md, cementBottomMD);
    const tvd = interpolateTVD(mdCur, traj);

    // Температура (линейный градиент по TVD)
    const bottomTVD = interpolateTVD(cementBottomMD, traj);
    const tempFrac = bottomTVD > topTVD ? (tvd - topTVD) / (bottomTVD - topTVD) : 0;
    const temperature = surfaceTemperature + tempFrac * (bottomTemperature - surfaceTemperature);
    const tempK = temperature + 273.15;

    // FQ на текущем давлении (из предыдущего шага — итеративно)
    const depthGasSlurryRatio = surfaceGasSlurryRatio
      * (surfacePressure * tempK) / (cumulativePressure * surfaceTempK)
      * calcN2CompressibilityFactor(cumulativePressure, tempK); // Z увеличивает реальный объём
    const foamQuality = Math.max(0, Math.min(100, (depthGasSlurryRatio / (1 + depthGasSlurryRatio)) * 100));

    // Плотность N₂ при реальном газе
    const n2DensG = n2DensityKgM3(cumulativePressure, tempK) / 1000; // г/см³
    // Плотность пеноцемента (объёмная смесь)
    const foamDensity = baseDensity * (1 - foamQuality / 100) + n2DensG * (foamQuality / 100);

    // Приращение давления от ЭТОГО слоя (по реальной плотности пеноцемента)
    const dTvd = tvd - prevTVD;
    if (dTvd > 0) {
      const dP = foamDensity * 9.81 * dTvd / 1000; // МПа
      cumulativePressure += dP;
    }
    prevTVD = tvd;

    const Z = calcN2CompressibilityFactor(cumulativePressure, tempK);
    const compressionFactor = (ATM_MPA * tempK) / (cumulativePressure * STD_TEMP_K * Z);

    const pt: FoamCementPoint = {
      md: mdCur,
      tvd,
      pressure: cumulativePressure,
      temperature,
      foamQuality,
      foamDensity,
      n2VolumeRatio: foamQuality / 100,
      compressionFactor,
      zFactor: Z,
    };
    points.push(pt);

    sumFQ += foamQuality;
    sumDens += foamDensity;
    count++;
    if (foamQuality < minFQ) minFQ = foamQuality;
    if (foamQuality > maxFQ) maxFQ = foamQuality;
    if (foamDensity < minDens) minDens = foamDensity;
    if (foamDensity > maxDens) maxDens = foamDensity;

    if (tvd > 0) {
      const ecd = cumulativePressure / (9.81 * tvd / 1000); // г/см³
      ecdProfile.push({ md: mdCur, ecd });
    }

    if (mdCur >= cementBottomMD) break;
  }

  // Объёмы. Полный объём пеноцемента в скважине = кольцевой объём:
  const finalVolumeM3 = annArea * cementLength;

  // Объём базовой суспензии = ∑(annArea · dL · (1 − FQ/100))
  // Поскольку FQ меняется с глубиной — интегрируем по сегментам.
  let slurryVolumeM3 = 0;
  const segLen = count > 0 ? cementLength / count : 0;
  for (const pt of points) {
    slurryVolumeM3 += annArea * segLen * (1 - pt.foamQuality / 100);
  }

  // N₂ при стандартных условиях по сегментам с реальным Z
  for (const pt of points) {
    const gasVolAtDepth = annArea * segLen * pt.n2VolumeRatio;
    // V_std = V_depth · P_depth/P_std · T_std/T_depth · 1/Z
    const tempK = pt.temperature + 273.15;
    const n2Std = gasVolAtDepth * pt.pressure / ATM_MPA * STD_TEMP_K / tempK / pt.zFactor;
    totalN2StdM3 += n2Std;
  }

  // Объём смеси на устье (для оценки начального объёма перед закачкой):
  // суспензия + газ при поверхностных условиях
  const initialVolumeM3 = slurryVolumeM3 / Math.max(1e-6, 1 - targetFoamQuality / 100);

  // Время закачки
  let pumpingTimeMin: number;
  if (input.pumpingTimeMin && input.pumpingTimeMin > 0) {
    pumpingTimeMin = input.pumpingTimeMin;
  } else if (input.pumpRateLps && input.pumpRateLps > 0) {
    // м³ / (л/с · 0.06) = м³ / (м³/мин)
    pumpingTimeMin = slurryVolumeM3 / (input.pumpRateLps * 0.06);
  } else {
    pumpingTimeMin = 60;
  }
  const n2RateM3PerMin = pumpingTimeMin > 0 ? totalN2StdM3 / pumpingTimeMin : 0;

  return {
    points,
    initialVolumeM3,
    finalVolumeM3,
    slurryVolumeM3,
    n2VolumeStdM3: totalN2StdM3,
    n2RateM3PerMin,
    pumpingTimeMin,
    avgFoamQuality: count > 0 ? sumFQ / count : 0,
    minFoamQuality: minFQ,
    maxFoamQuality: maxFQ,
    avgFoamDensity: count > 0 ? sumDens / count : 0,
    minFoamDensity: minDens,
    maxFoamDensity: maxDens,
    ecdProfile,
  };
}
