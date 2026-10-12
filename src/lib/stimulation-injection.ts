/**
 * Матричная закачка при ОПЗ: приёмистость, максимальный расход без ГРП,
 * давление на устье, объём продавки по конструкции скважины.
 */
import { DARCY_OIL_CONSTANT } from "./foam-treatment-diagnostics";
import { tubingFrictionMPa } from "./workover-calculations";

const G = 9.81;

export interface WellConstruction {
  /** Кровля перфорации, MD */
  perfTopMD: number;
  /** Кровля перфорации, TVD */
  perfTopTVD: number;
  /** Башмак НКТ, MD */
  tubingShoeMD: number;
  tubingID_mm: number;
  casingID_mm: number;
}

export const DEFAULT_CONSTRUCTION: WellConstruction = {
  perfTopMD: 2200,
  perfTopTVD: 2200,
  tubingShoeMD: 2150,
  tubingID_mm: 62,
  casingID_mm: 152,
};

const area = (d_mm: number) => (Math.PI / 4) * (d_mm / 1000) ** 2;

/** Объём продавки: НКТ до башмака + колонна от башмака до кровли перфорации. */
export function displacementVolumeM3(c: WellConstruction): { tubingM3: number; casingM3: number; totalM3: number } {
  const shoe = Math.min(c.tubingShoeMD, c.perfTopMD);
  const tubingM3 = area(c.tubingID_mm) * shoe;
  const casingM3 = area(c.casingID_mm) * Math.max(0, c.perfTopMD - shoe);
  return { tubingM3, casingM3, totalM3: tubingM3 + casingM3 };
}

export interface MatrixInjectionInput {
  k_mD: number;
  h_m: number;
  skin: number;
  /** Скин после обработки (для приёмистости в конце закачки) */
  skinAfter: number;
  fluidViscosity_cP: number;
  fluidDensity_gcm3: number;
  reservoirPressureMPa: number;
  fracturePressureMPa: number;
  drainageRadiusM: number;
  wellboreRadiusM: number;
  /** Запас до давления ГРП, МПа */
  safetyMarginMPa: number;
  /** Плановый расход, л/мин */
  plannedRateLpm: number;
  construction: WellConstruction;
}

export interface MatrixInjectionResult {
  injectivityStart: number;   // м³/(сут·МПа) при текущем скине
  injectivityEnd: number;     // при скине после обработки
  maxRateStartLpm: number;
  maxRateEndLpm: number;
  bhpAtPlannedMPa: number;
  hydrostaticMPa: number;
  frictionAtPlannedMPa: number;
  surfacePressureMPa: number;
  maxSurfacePressureMPa: number;
  /** Давление опрессовки линий: 1.5 × рабочее на устье */
  lineTestPressureMPa: number;
  regime: "matrix" | "near_frac" | "frac";
  warnings: string[];
}

/** Приёмистость по Дюпюи (стационарный радиальный приток), м³/(сут·МПа). */
export function injectivity(k_mD: number, h_m: number, mu_cP: number, re: number, rw: number, skin: number): number {
  const denom = DARCY_OIL_CONSTANT * mu_cP * (Math.log(re / rw) + Math.max(-3, skin));
  return denom > 0 ? (k_mD * h_m) / denom : 0;
}

const m3dToLpm = (q: number) => (q * 1000) / 1440;
const lpmToM3d = (q: number) => (q * 1440) / 1000;

export function calculateMatrixInjection(input: MatrixInjectionInput): MatrixInjectionResult {
  const c = input.construction;
  const Jstart = injectivity(input.k_mD, input.h_m, input.fluidViscosity_cP, input.drainageRadiusM, input.wellboreRadiusM, input.skin);
  const Jend = injectivity(input.k_mD, input.h_m, input.fluidViscosity_cP, input.drainageRadiusM, input.wellboreRadiusM, input.skinAfter);
  const dpMax = Math.max(0, input.fracturePressureMPa - input.safetyMarginMPa - input.reservoirPressureMPa);
  const qStart = Jstart * dpMax;
  const qEnd = Jend * dpMax;

  const qPlan = lpmToM3d(input.plannedRateLpm);
  const bhp = input.reservoirPressureMPa + (Jstart > 0 ? qPlan / Jstart : Infinity);
  const hydro = (input.fluidDensity_gcm3 * 1000 * G * c.perfTopTVD) / 1e6;
  const fr = tubingFrictionMPa(Math.min(c.tubingShoeMD, c.perfTopMD), c.tubingID_mm, input.fluidDensity_gcm3,
    input.fluidViscosity_cP, 0, input.plannedRateLpm / 60);
  const surface = Math.max(0, bhp - hydro + fr.lossMPa);
  const maxSurface = Math.max(0, input.fracturePressureMPa - input.safetyMarginMPa - hydro + fr.lossMPa);

  const regime: MatrixInjectionResult["regime"] =
    bhp >= input.fracturePressureMPa ? "frac" : bhp >= input.fracturePressureMPa - input.safetyMarginMPa ? "near_frac" : "matrix";

  const warnings: string[] = [];
  if (regime === "frac")
    warnings.push(`🔴 При ${input.plannedRateLpm.toFixed(0)} л/мин забойное ${bhp.toFixed(1)} МПа ≥ Pгрп ${input.fracturePressureMPa.toFixed(1)} МПа — пласт будет разорван, обработка перестанет быть матричной. Начинать с ${m3dToLpm(qStart).toFixed(0)} л/мин.`);
  else if (regime === "near_frac")
    warnings.push(`⚠ Забойное ${bhp.toFixed(1)} МПа в пределах запаса ${input.safetyMarginMPa} МПа до ГРП.`);
  if (qEnd > qStart * 1.2)
    warnings.push(`По мере снятия скина приёмистость растёт: расход можно поднимать до ${m3dToLpm(qEnd).toFixed(0)} л/мин, удерживая давление на устье ≤ ${maxSurface.toFixed(1)} МПа.`);
  if (c.tubingShoeMD > c.perfTopMD)
    warnings.push("Башмак НКТ ниже кровли перфорации — продавка считается до кровли, проверить компоновку.");
  warnings.push("Приёмистость — стационарная оценка по Дюпюи для однородного пласта; уточнять ступенчатой закачкой.");

  return {
    injectivityStart: Jstart,
    injectivityEnd: Jend,
    maxRateStartLpm: m3dToLpm(qStart),
    maxRateEndLpm: m3dToLpm(qEnd),
    bhpAtPlannedMPa: bhp,
    hydrostaticMPa: hydro,
    frictionAtPlannedMPa: fr.lossMPa,
    surfacePressureMPa: surface,
    maxSurfacePressureMPa: maxSurface,
    lineTestPressureMPa: 1.5 * Math.max(surface, maxSurface),
    regime,
    warnings,
  };
}
