/**
 * Foam Cementing calculation engine.
 * Computes foam quality, density profile, N₂ volume and rate by depth.
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
}

export interface FoamCementPoint {
  md: number;
  tvd: number;
  pressure: number;              // МПа (гидростатическое)
  temperature: number;           // °C
  foamQuality: number;           // % (0–100)
  foamDensity: number;           // г/см³
  n2VolumeRatio: number;         // объёмная доля N₂
  compressionFactor: number;     // фактор сжатия газа
}

export interface FoamCementResult {
  points: FoamCementPoint[];
  initialVolumeM3: number;       // начальный объём пеноцемента (при surface P)
  finalVolumeM3: number;         // конечный объём (в скважине, сжатый)
  n2VolumeStdM3: number;         // объём N₂ при стандартных условиях, м³
  n2RateM3PerMin: number;        // средний расход N₂, м³/мин (стд.)
  avgFoamQuality: number;        // средневзвешенное качество по глубине
  minFoamQuality: number;
  maxFoamQuality: number;
  avgFoamDensity: number;        // средняя плотность пеноцемента
  minFoamDensity: number;
  maxFoamDensity: number;
  ecdProfile: { md: number; ecd: number }[];
}

/* ───── Constants ───── */

const ATM_MPA = 0.101325; // атмосферное давление, МПа
const STD_TEMP_K = 293.15; // стандартная температура, K (20°C)

/* ───── Helpers ───── */

function areaM2(diamMm: number): number {
  const d = diamMm / 1000;
  return (Math.PI / 4) * d * d;
}

function annAreaM2(outerMm: number, innerMm: number): number {
  return areaM2(outerMm) - areaM2(innerMm);
}

/* ───── Main Calculation ───── */

export function calculateFoamCement(input: FoamCementInput): FoamCementResult {
  const {
    baseDensity, targetFoamQuality, backPressure,
    surfaceTemperature, bottomTemperature,
    wellDepthMD, casingDepthMD, holeDiameter, casingOD,
    cementTopMD, cementBottomMD, trajectory, mudDensity,
  } = input;

  const traj = trajectory.length > 1
    ? trajectory
    : [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: wellDepthMD, azimuth: 0, zenith: 0, tvd: wellDepthMD }];

  const annArea = annAreaM2(holeDiameter, casingOD);
  const cementLength = Math.max(0, cementBottomMD - cementTopMD);
  const step = Math.max(1, Math.round(cementLength / 100)); // ~100 points
  const points: FoamCementPoint[] = [];

  const bottomTVD = interpolateTVD(cementBottomMD, traj);

  // Surface conditions for target foam quality
  const surfacePressure = backPressure + ATM_MPA; // approximation at surface
  const surfaceTempK = surfaceTemperature + 273.15;
  
  // At surface, targetFoamQuality = V_gas / (V_gas + V_slurry) * 100
  // V_gas_surface = Q * V_slurry / (100 - Q) where Q = targetFoamQuality

  let totalN2StdM3 = 0;
  let sumFQ = 0;
  let sumDens = 0;
  let count = 0;
  let minFQ = 100, maxFQ = 0;
  let minDens = baseDensity, maxDens = 0;

  const ecdProfile: { md: number; ecd: number }[] = [];

  for (let md = cementTopMD; md <= cementBottomMD; md += step) {
    const tvd = interpolateTVD(md, traj);
    
    // Temperature gradient (linear)
    const tempFrac = bottomTVD > 0 ? tvd / bottomTVD : 0;
    const temperature = surfaceTemperature + tempFrac * (bottomTemperature - surfaceTemperature);
    const tempK = temperature + 273.15;

    // Hydrostatic pressure at this depth (mud above cement + foam cement below)
    // Simplified: use mud density for column above cement top, then iterate
    const topTVD = interpolateTVD(cementTopMD, traj);
    const hydroMud = mudDensity * 9.81 * topTVD / 1000; // МПа
    const hydroCement = baseDensity * 9.81 * (tvd - topTVD) / 1000; // approx, will adjust
    const pressure = Math.max(ATM_MPA, backPressure + hydroMud + hydroCement * (1 - targetFoamQuality / 100));

    // Gas compression factor (ideal gas law: PV = nRT)
    // V_depth / V_std = (P_std * T_depth) / (P_depth * T_std)
    const compressionFactor = (ATM_MPA * tempK) / (pressure * STD_TEMP_K);

    // Foam quality at this depth
    // At surface, quality = targetFoamQuality
    // At depth, gas is compressed → quality decreases
    // FQ_depth = V_gas_depth / (V_gas_depth + V_slurry)
    // V_gas_depth = V_gas_surface * compressionFactor (relative to surface P)
    const surfaceGasRatio = targetFoamQuality / (100 - targetFoamQuality);
    const depthGasRatio = surfaceGasRatio * (surfacePressure * surfaceTempK) / (pressure * tempK);
    const foamQuality = (depthGasRatio / (1 + depthGasRatio)) * 100;

    // Foam density at depth
    // ρ_foam = ρ_base * (1 - FQ/100) + ρ_N2 * FQ/100
    // ρ_N2 at depth ≈ 0.001 * pressure/ATM (negligible for density calc)
    const n2Density = 0.00125 * pressure / ATM_MPA * STD_TEMP_K / tempK; // г/см³ roughly
    const foamDensity = baseDensity * (1 - foamQuality / 100) + n2Density * (foamQuality / 100);

    const pt: FoamCementPoint = {
      md, tvd, pressure, temperature,
      foamQuality: Math.max(0, Math.min(100, foamQuality)),
      foamDensity,
      n2VolumeRatio: depthGasRatio / (1 + depthGasRatio),
      compressionFactor,
    };
    points.push(pt);

    sumFQ += pt.foamQuality;
    sumDens += pt.foamDensity;
    count++;
    minFQ = Math.min(minFQ, pt.foamQuality);
    maxFQ = Math.max(maxFQ, pt.foamQuality);
    minDens = Math.min(minDens, pt.foamDensity);
    maxDens = Math.max(maxDens, pt.foamDensity);

    // ECD at this point
    if (tvd > 0) {
      const ecd = pressure / (9.81 * tvd / 1000); // г/см³
      ecdProfile.push({ md, ecd });
    }
  }

  // Total volumes
  const baseSlurryVolumeM3 = annArea * cementLength; // without foam
  // At surface, foam volume = slurry / (1 - FQ/100)
  const initialVolumeM3 = baseSlurryVolumeM3 / (1 - targetFoamQuality / 100);
  const finalVolumeM3 = baseSlurryVolumeM3; // slurry volume stays, gas compresses

  // Total N₂ at standard conditions
  // N₂_std = ∑(gas_volume_at_depth * P_depth/P_std * T_std/T_depth) for each segment
  const segmentLength = cementLength / Math.max(1, count);
  for (const pt of points) {
    const gasVolAtDepth = annArea * segmentLength * pt.n2VolumeRatio;
    const n2Std = gasVolAtDepth * pt.pressure / ATM_MPA * STD_TEMP_K / (pt.temperature + 273.15);
    totalN2StdM3 += n2Std;
  }

  // Assuming 60 min pumping time for rate estimation
  const pumpingTimeMin = 60;
  const n2RateM3PerMin = totalN2StdM3 / pumpingTimeMin;

  return {
    points,
    initialVolumeM3,
    finalVolumeM3,
    n2VolumeStdM3: totalN2StdM3,
    n2RateM3PerMin,
    avgFoamQuality: count > 0 ? sumFQ / count : 0,
    minFoamQuality: minFQ,
    maxFoamQuality: maxFQ,
    avgFoamDensity: count > 0 ? sumDens / count : 0,
    minFoamDensity: minDens,
    maxFoamDensity: maxDens,
    ecdProfile,
  };
}
