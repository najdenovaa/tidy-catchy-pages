/**
 * Workover (КРС) calculations — full physics.
 * Blocks: 0 well data, 1 packers, 2 drag & lubricants, 3 stuck pipe, 4 fishing, 5 rig capacity.
 *
 * All formulas: real physics, no fitted constants.
 *   • drag           : Johancsik soft-string  T += w·cosθ ± μ·w·sinθ
 *   • diff. sticking : F = μ · ΔP · A_contact
 *   • free point     : Hooke's law  L = E·A·ΔL / ΔF
 *   • packer hold    : F = μ · P_set · π·D·L
 *   • lubricant      : CoF directly from lubricity tester (OFITE/Fann)
 *   • pipe limit     : σ_yield · A / SF
 */

import type { TrajectoryPoint } from "./cementing-calculations";

// ────────── BLOCK 0: shared inputs ──────────

export const STEEL_GRADES: Record<string, number> = {
  J55: 379, K55: 379, N80: 552, L80: 552,
  C90: 621, T95: 655, P110: 758, Q125: 862,
};

export interface WorkoverWellData {
  wellDepthMD: number;
  trajectory: TrajectoryPoint[];
  casingID_mm: number;
  holeDiameter_mm: number;
  pipeOD_mm: number;
  pipeID_mm: number;
  pipeWeight_kgm: number;
  pipeGrade: string;
  pipeYieldMPa: number;
  pipeYoungModulusGPa: number;
  fluidDensity_gcm3: number;
  fluidPV_cP: number;
  fluidYP_Pa: number;
}

export function pipeCrossArea_m2(od_mm: number, id_mm: number): number {
  const od = od_mm / 1000, id = id_mm / 1000;
  return (Math.PI / 4) * (od * od - id * id);
}

export function pipeYieldForceKN(well: WorkoverWellData, sf = 1.25): number {
  return (well.pipeYieldMPa * 1e6 * pipeCrossArea_m2(well.pipeOD_mm, well.pipeID_mm)) / 1000 / sf;
}

function interpolateZenithDeg(md: number, traj: TrajectoryPoint[]): number {
  if (!traj.length) return 0;
  if (md <= traj[0].md) return traj[0].zenith;
  for (let i = 1; i < traj.length; i++) {
    if (md <= traj[i].md) {
      const a = traj[i - 1], b = traj[i];
      const t = (md - a.md) / Math.max(1e-6, b.md - a.md);
      return a.zenith + t * (b.zenith - a.zenith);
    }
  }
  return traj[traj.length - 1].zenith;
}

function interpolateAzimuthDeg(md: number, traj: TrajectoryPoint[]): number {
  if (!traj.length) return 0;
  if (md <= traj[0].md) return traj[0].azimuth ?? 0;
  for (let i = 1; i < traj.length; i++) {
    if (md <= traj[i].md) {
      const a = traj[i - 1], b = traj[i];
      const t = (md - a.md) / Math.max(1e-6, b.md - a.md);
      // Кратчайшая интерполяция по азимуту (учёт перехода 359→0)
      const a0 = a.azimuth ?? 0;
      const b0 = b.azimuth ?? 0;
      let d = b0 - a0;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      return a0 + t * d;
    }
  }
  return traj[traj.length - 1].azimuth ?? 0;
}

function averageZenithDeg(traj: TrajectoryPoint[], upToMD: number): number {
  if (!traj.length || upToMD <= 0) return 0;
  const step = 25;
  let sum = 0, n = 0;
  for (let md = 0; md <= upToMD; md += step) {
    sum += interpolateZenithDeg(md, traj);
    n++;
  }
  return n ? sum / n : 0;
}

// ────────── BLOCK 1: packers ──────────

export type PackerType = "mechanical" | "hydraulic" | "hydrostatic" | "permanent" | "retrievable";

export interface PackerInput {
  type: PackerType;
  packerOD_mm: number;
  elementLength_mm: number;
  setDepthMD: number;
  rubberFrictionCoeff: number;
  setPressureMPa: number;
  setForceWeight_kN?: number;
  differentialPressureMPa: number;
}

export interface PackerResult {
  holdCapacityKN: number;
  releaseForceKN: number;
  sealIntegrityMPa: number;
  slipBiteForceKN: number;
  contactAreaM2: number;
  isSecure: boolean;
  warnings: string[];
}

export function calculatePacker(input: PackerInput): PackerResult {
  const D = input.packerOD_mm / 1000;
  const L = input.elementLength_mm / 1000;
  const contactArea = Math.PI * D * L;
  const setPress = input.setPressureMPa * 1e6;
  const holdCapacity = (input.rubberFrictionCoeff * setPress * contactArea) / 1000;
  const releaseForce = holdCapacity * 1.2; // adhesion factor
  const sealIntegrity = input.setPressureMPa * 0.85;
  const slipBite = input.setForceWeight_kN ?? holdCapacity * 0.5;

  const warnings: string[] = [];
  if (input.differentialPressureMPa > sealIntegrity)
    warnings.push(
      `⚠ Перепад ${input.differentialPressureMPa} МПа > герметичности ${sealIntegrity.toFixed(1)} МПа — риск пропуска.`,
    );
  if (input.type === "permanent")
    warnings.push("Постоянный пакер — срыв невозможен, только разбуривание/фрезерование.");
  if (input.rubberFrictionCoeff < 0.25 || input.rubberFrictionCoeff > 0.55)
    warnings.push("μ резины вне диапазона 0.25–0.55 — проверьте паспорт пакера.");

  return {
    holdCapacityKN: holdCapacity,
    releaseForceKN: releaseForce,
    sealIntegrityMPa: sealIntegrity,
    slipBiteForceKN: slipBite,
    contactAreaM2: contactArea,
    isSecure: input.differentialPressureMPa <= sealIntegrity,
    warnings,
  };
}

// ────────── BLOCK 1b: packer RELEASE (full operation) ──────────

export type ReleaseMechanism = "tension" | "rotation" | "pressure_release" | "mill_out";

export interface PackerReleaseInput {
  packerType: PackerType;
  holdCapacityKN: number;
  monthsInService: number;
  h2sPresent: boolean;
  scaleDepositRate: number;     // kN/month (3–15)
  pipeWeightAboveKN: number;
  pipeYieldMPa: number;
  pipeOD_mm: number;
  pipeID_mm: number;
}

export interface PackerReleaseResult {
  releaseForceKN: number;
  breakdown: { baseHold: number; adhesion: number; scaleStick: number };
  totalPullRequiredKN: number;
  pipeTensileLimitKN: number;
  canReleaseByTension: boolean;
  recommendedMechanism: ReleaseMechanism;
  warnings: string[];
}

export function calculatePackerRelease(input: PackerReleaseInput): PackerReleaseResult {
  const adhesion = input.holdCapacityKN * (0.15 + 0.01 * Math.min(input.monthsInService, 24));
  const scaleStick = input.scaleDepositRate * input.monthsInService * (input.h2sPresent ? 1.5 : 1.0);
  const releaseForce = input.holdCapacityKN + adhesion + scaleStick;
  const totalPull = releaseForce + input.pipeWeightAboveKN;
  const A = (Math.PI / 4) * ((input.pipeOD_mm / 1000) ** 2 - (input.pipeID_mm / 1000) ** 2);
  const tensileLimit = (input.pipeYieldMPa * 1e6 * A) / 1000 / 1.25;
  const canRelease = totalPull < tensileLimit;

  let mechanism: ReleaseMechanism;
  const warnings: string[] = [];
  if (input.packerType === "permanent") {
    mechanism = "mill_out";
    warnings.push("Постоянный пакер — срыв невозможен. Только разбуривание/фрезерование.");
  } else if (!canRelease) {
    mechanism = input.packerType === "mechanical" ? "rotation" : "mill_out";
    warnings.push(
      `🔴 Усилие срыва ${totalPull.toFixed(0)} кН > предела колонны ${tensileLimit.toFixed(0)} кН. Натяжкой НЕ сорвать — труба порвётся. Применить ${mechanism === "rotation" ? "срыв вращением" : "фрезерование"}.`,
    );
  } else if (input.packerType === "mechanical") {
    mechanism = "rotation";
  } else if (input.packerType === "hydraulic" || input.packerType === "hydrostatic") {
    mechanism = "pressure_release";
    warnings.push("Гидравлический пакер: сначала сбросить давление, затем натяжка.");
  } else {
    mechanism = "tension";
  }
  if (input.monthsInService > 24)
    warnings.push(
      `⚠ Срок эксплуатации ${input.monthsInService} мес — пакер сильно прикипел (адгезия +${((adhesion / input.holdCapacityKN) * 100).toFixed(0)}%, отложения ${scaleStick.toFixed(0)} кН).`,
    );
  if (input.h2sPresent)
    warnings.push("⚠ H₂S среда — продукты коррозии увеличивают прихват плашек в 1.5×.");

  return {
    releaseForceKN: releaseForce,
    breakdown: { baseHold: input.holdCapacityKN, adhesion, scaleStick },
    totalPullRequiredKN: totalPull,
    pipeTensileLimitKN: tensileLimit,
    canReleaseByTension: canRelease,
    recommendedMechanism: mechanism,
    warnings,
  };
}

// ────────── BLOCK 1c: WELL KILL ──────────

export type KillMethod = "driller" | "wait_weight" | "volumetric" | "bullhead";

export const KILL_FLUIDS = [
  { name: "Техническая вода", maxDensity: 1.0, type: "water" },
  { name: "Раствор NaCl", maxDensity: 1.2, type: "brine" },
  { name: "Раствор CaCl₂", maxDensity: 1.4, type: "brine" },
  { name: "Раствор CaBr₂", maxDensity: 1.7, type: "brine" },
  { name: "Раствор ZnBr₂/CaBr₂", maxDensity: 2.3, type: "brine" },
  { name: "Глинистый р-р с баритом", maxDensity: 2.5, type: "weighted_mud" },
] as const;

export interface KillSection {
  lengthM: number;
  casingID_mm: number;
  tubingOD_mm: number;
}

export interface KillInput {
  method: KillMethod;
  formationPressureMPa: number;
  reservoirDepthTVD: number;
  fracturePressureMPa: number;
  currentMudDensity: number;
  wellDepthMD: number;
  casingID_mm: number;
  tubingOD_mm: number;
  tubingID_mm: number;
  killFluidPV_cP: number;
  killFluidYP_Pa: number;
  pumpRateLs: number;
  safetyMarginPct: number;
  /** Опциональный профиль секций для расчёта потерь по интервалам разного диаметра */
  sections?: KillSection[];
}

export interface KillResult {
  killDensity: number;
  balanceDensity: number;
  bottomholePressureMPa: number;
  killVolumeM3: number;
  initialCircPressureMPa: number;
  finalCircPressureMPa: number;
  bullheadSurfacePressureMPa: number;
  exceedsFracture: boolean;
  frictionLossMPa: number;
  selectedFluid: string;
  warnings: string[];
  recommendation: string;
}

export function calculateKill(input: KillInput): KillResult {
  const G = 9.81;
  const tvd = Math.max(1, input.reservoirDepthTVD);

  const balanceDensity = (input.formationPressureMPa * 1e6) / (G * tvd) / 1000;
  const killDensity = balanceDensity * (1 + input.safetyMarginPct / 100);
  const bhp = (killDensity * 1000 * G * tvd) / 1e6;
  const exceedsFracture = bhp > input.fracturePressureMPa;

  const tubingCapacity = (Math.PI / 4) * (input.tubingID_mm / 1000) ** 2 * input.wellDepthMD;
  const annulusCapacity =
    (Math.PI / 4) * ((input.casingID_mm / 1000) ** 2 - (input.tubingOD_mm / 1000) ** 2) * input.wellDepthMD;
  const killVolume = tubingCapacity + annulusCapacity;

  // Потери на трение: по секциям профиля, либо одно-секционный fallback
  let frictionLoss: number;
  if (input.sections && input.sections.length > 0) {
    frictionLoss = calculateKillFriction(
      input.sections, input.pumpRateLs, input.killFluidPV_cP, input.killFluidYP_Pa,
    );
  } else {
    const dhAnn = Math.max(0.005, (input.casingID_mm - input.tubingOD_mm) / 1000);
    const annArea = (Math.PI / 4) * ((input.casingID_mm / 1000) ** 2 - (input.tubingOD_mm / 1000) ** 2);
    const vAnn = input.pumpRateLs / 1000 / Math.max(1e-6, annArea);
    const dpdlAnn =
      input.killFluidYP_Pa / (0.2 * dhAnn) + ((input.killFluidPV_cP / 1000) * vAnn) / (1.5 * dhAnn * dhAnn);
    frictionLoss = (dpdlAnn * input.wellDepthMD) / 1e6;
  }

  const pumpPressure = frictionLoss;
  const ICP = pumpPressure + ((killDensity - input.currentMudDensity) * 1000 * G * tvd) / 1e6;
  const FCP = pumpPressure * (killDensity / Math.max(0.01, input.currentMudDensity));

  const killHydro = (killDensity * 1000 * G * tvd) / 1e6;
  const bullheadSurface = Math.max(0, input.formationPressureMPa - killHydro + frictionLoss);

  const fluid = KILL_FLUIDS.find((f) => f.maxDensity >= killDensity) ?? KILL_FLUIDS[KILL_FLUIDS.length - 1];

  const warnings: string[] = [];
  if (exceedsFracture)
    warnings.push(
      `🔴 Забойное давление глушения ${bhp.toFixed(1)} МПа > ГРП ${input.fracturePressureMPa.toFixed(1)} МПа. Риск поглощения! Снизить плотность или применить поэтапное глушение.`,
    );
  if (input.method === "bullhead" && bullheadSurface * 1.5 > input.fracturePressureMPa - killHydro)
    warnings.push("⚠ Bullheading: давление задавки близко к ГРП. Контролировать устьевое давление.");
  if (killDensity > 2.3)
    warnings.push(
      `⚠ Требуется плотность ${killDensity.toFixed(2)} г/см³ — нужны утяжелители (барит/гематит) или соли (CaCl₂, CaBr₂, ZnBr₂).`,
    );

  let recommendation = "";
  switch (input.method) {
    case "driller":
      recommendation =
        "Метод бурильщика: 1-я циркуляция вымывает приток текущей жидкостью, 2-я — закачка утяжелённой. Проще, но дольше (2 цикла).";
      break;
    case "wait_weight":
      recommendation =
        "Метод ожидания: сразу закачка утяжелённой жидкости за 1 циркуляцию. Быстрее, ниже давления, но требует точного расчёта.";
      break;
    case "volumetric":
      recommendation =
        "Объёмный метод: без циркуляции (нет доступа к забою). Стравливание газа порциями с поддержанием давления.";
      break;
    case "bullhead":
      recommendation = `Прямая задавка в пласт: устьевое давление ${bullheadSurface.toFixed(1)} МПа. Применять, когда циркуляция невозможна. ОБЯЗАТЕЛЬНО проверить ГРП.`;
      break;
  }

  return {
    killDensity,
    balanceDensity,
    bottomholePressureMPa: bhp,
    killVolumeM3: killVolume,
    initialCircPressureMPa: ICP,
    finalCircPressureMPa: FCP,
    bullheadSurfacePressureMPa: bullheadSurface,
    exceedsFracture,
    frictionLossMPa: frictionLoss,
    selectedFluid: fluid.name,
    warnings,
    recommendation,
  };
}

// ────────── BLOCK 2: drag + lubricants ──────────

export type DragOperation = "pull_out" | "run_in" | "rotate" | "work_pipe";

export interface LubricantInput {
  name: string;
  concentration: number;
  baseFrictionCoeff: number;
  lubricatedFrictionCoeff: number;
  penetrationIndex: number; // 1..10
}

export interface DragInput {
  operation: DragOperation;
  frictionCoeff: number;
  lubricant?: LubricantInput;
}

export interface DragPoint {
  md: number;
  hookLoadKN: number;
  dragKN: number;
  zenithDeg: number;
  doglegDegPer10m: number;
  normalForceN: number;
}

export interface DragResult {
  points: DragPoint[];
  maxHookLoadKN: number;
  freeWeightKN: number;
  appliedFrictionCoeff: number;
}

export function calculateDrag(input: DragInput, well: WorkoverWellData): DragResult {
  const step = 10; // m
  const bf = 1 - well.fluidDensity_gcm3 / 7.85;
  const mu = input.lubricant ? input.lubricant.lubricatedFrictionCoeff : input.frictionCoeff;

  let tension = 0;
  let freeWeight = 0;
  const points: DragPoint[] = [];

  for (let md = well.wellDepthMD; md > 0; md -= step) {
    const zenDeg = interpolateZenithDeg(md, well.trajectory);
    const zenDegPrev = interpolateZenithDeg(Math.max(0, md - step), well.trajectory);
    const aziDeg = interpolateAzimuthDeg(md, well.trajectory);
    const aziDegPrev = interpolateAzimuthDeg(Math.max(0, md - step), well.trajectory);
    const zen = (zenDeg * Math.PI) / 180;
    const zenPrev = (zenDegPrev * Math.PI) / 180;
    const dAzi = ((aziDeg - aziDegPrev) * Math.PI) / 180;

    // Полный 3D dogleg (минимальная кривизна): cosβ = cos(I2−I1) − sin I1·sin I2·(1−cos ΔA)
    const cosBeta = Math.cos(zen - zenPrev) - Math.sin(zen) * Math.sin(zenPrev) * (1 - Math.cos(dAzi));
    const dogleg = Math.acos(Math.max(-1, Math.min(1, cosBeta))); // рад/шаг

    const wSeg = well.pipeWeight_kgm * step * 9.81 * bf;
    const wNormal = wSeg * Math.sin(zen);                  // прижатие от веса
    const tNormal = Math.abs(tension) * dogleg;            // прижатие от натяжения в перегибе (T·dα)
    const normalForce = Math.sqrt(wNormal * wNormal + tNormal * tNormal);
    const drag = mu * normalForce;
    const axial = wSeg * Math.cos(zen);

    freeWeight += axial;
    if (input.operation === "pull_out") tension += axial + drag;
    else if (input.operation === "run_in") tension += axial - drag;
    else tension += axial;

    points.push({
      md,
      hookLoadKN: tension / 1000,
      dragKN: drag / 1000,
      zenithDeg: zenDeg,
      doglegDegPer10m: (dogleg * 180) / Math.PI,
      normalForceN: normalForce,
    });
  }
  points.reverse();
  return {
    points,
    maxHookLoadKN: points[points.length - 1]?.hookLoadKN ?? 0,
    freeWeightKN: freeWeight / 1000,
    appliedFrictionCoeff: mu,
  };
}

export interface LubricantResult {
  resultingFrictionCoeff: number;
  frictionReductionPct: number;
  dragReductionKN: number;
  penetrationTimeHours: number;
  effectiveForStuck: boolean;
}

export function calculateLubricant(
  lube: LubricantInput,
  dragWithoutLube_kN: number,
  dragWithLube_kN: number,
  stuckContactLenM?: number,
  differentialPressureMPa?: number,
  fluidViscCp?: number,
): LubricantResult {
  const frictionReduction = (1 - lube.lubricatedFrictionCoeff / Math.max(1e-6, lube.baseFrictionCoeff)) * 100;
  const dragReduction = dragWithoutLube_kN - dragWithLube_kN;

  let penetrationTime = 0;
  let effectiveForStuck = false;
  if (stuckContactLenM && differentialPressureMPa && fluidViscCp) {
    penetrationTime =
      (stuckContactLenM * fluidViscCp) / Math.max(1e-6, differentialPressureMPa * lube.penetrationIndex * 10);
    effectiveForStuck = lube.penetrationIndex >= 5 && penetrationTime < 12;
  }

  return {
    resultingFrictionCoeff: lube.lubricatedFrictionCoeff,
    frictionReductionPct: frictionReduction,
    dragReductionKN: dragReduction,
    penetrationTimeHours: penetrationTime,
    effectiveForStuck,
  };
}

// ────────── BLOCK 3: stuck pipe ──────────

export interface FreePointInput {
  pulledForceKN: number;
  measuredStretchM: number;
}

export function calculateFreePoint(input: FreePointInput, well: WorkoverWellData): {
  freePointMD: number;
  freePipeLength: number;
  idealFreePointMD: number;
  frictionCorrectionPct: number;
  avgZenithDeg: number;
} {
  const A = pipeCrossArea_m2(well.pipeOD_mm, well.pipeID_mm);
  const E = well.pipeYoungModulusGPa * 1e9;
  const dF = input.pulledForceKN * 1000;
  if (dF <= 0) return { freePointMD: 0, freePipeLength: 0, idealFreePointMD: 0, frictionCorrectionPct: 0, avgZenithDeg: 0 };
  const ideal = (E * A * input.measuredStretchM) / dF;
  // Поправка трения: в искривлённой скважине часть растяжения «съедается»
  // трением свободной части → реальная точка прихвата глубже расчётной.
  const avgZen = averageZenithDeg(well.trajectory, Math.min(ideal, well.wellDepthMD));
  const frictionFactor = 1 + 0.15 * Math.sin((avgZen * Math.PI) / 180); // до +15% в горизонтали
  const corrected = ideal * frictionFactor;
  const clamped = Math.min(Math.max(0, corrected), well.wellDepthMD);
  return {
    freePointMD: clamped,
    freePipeLength: clamped,
    idealFreePointMD: Math.min(Math.max(0, ideal), well.wellDepthMD),
    frictionCorrectionPct: (frictionFactor - 1) * 100,
    avgZenithDeg: avgZen,
  };
}

export type StuckType = "differential" | "mechanical" | "keyseat" | "cuttings" | "cement";

export interface StuckSymptoms {
  canRotate: boolean;
  canMoveDown: boolean;
  canMoveUp: boolean;
  stuckDepthMD: number;
  occurredDuringCirculation: boolean;
  deltaP_MPa?: number;
  contactLenM?: number;
  mudcakeFriction?: number;
}

export interface StuckDiagnosis {
  type: StuckType;
  probability: number;
  freeingForceKN: number;
  pipeYieldKN: number;
  rigAllowableKN?: number;
  canFreeByPull: boolean;
  recommendation: string;
}

export function differentialSticking(
  deltaP_MPa: number,
  contactLenM: number,
  pipeOD_mm: number,
  mudcakeFriction: number,
): number {
  const contactWidth = (pipeOD_mm / 1000) * 0.3;
  const A = contactWidth * contactLenM;
  return (mudcakeFriction * deltaP_MPa * 1e6 * A) / 1000;
}

export function diagnoseStuck(
  well: WorkoverWellData,
  symptoms: StuckSymptoms,
  rigAllowableKN?: number,
): StuckDiagnosis {
  let type: StuckType;
  if (symptoms.canRotate && !symptoms.canMoveUp && !symptoms.canMoveDown) type = "differential";
  else if (symptoms.canMoveDown && !symptoms.canMoveUp) type = "keyseat";
  else if (!symptoms.canRotate && !symptoms.canMoveUp && !symptoms.canMoveDown) type = "mechanical";
  else type = "cuttings";

  let freeingForce = 0;
  if (type === "differential" && symptoms.deltaP_MPa && symptoms.contactLenM) {
    freeingForce = differentialSticking(
      symptoms.deltaP_MPa,
      symptoms.contactLenM,
      well.pipeOD_mm,
      symptoms.mudcakeFriction ?? 0.25,
    );
  }

  const pipeYield = pipeYieldForceKN(well);
  const limit = rigAllowableKN ? Math.min(pipeYield, rigAllowableKN) : pipeYield;
  const canFree = freeingForce > 0 && freeingForce < limit;

  const recommendation =
    type === "differential"
      ? "Спот-жидкость (нефтяная/смазка с проникающей способностью), снизить ΔP, расхаживание."
      : type === "keyseat"
        ? "Проработка желоба, вращение при подъёме."
        : type === "mechanical"
          ? "Ясс вниз, фрезерование, освобождение секции."
          : "Восстановить циркуляцию, промыть шлам.";

  return {
    type,
    probability: 0.8,
    freeingForceKN: freeingForce,
    pipeYieldKN: pipeYield,
    rigAllowableKN,
    canFreeByPull: canFree,
    recommendation,
  };
}

// ────────── BLOCK 4: fishing ──────────

export interface FishingInput {
  fishTopMD: number;
  fishWeightKN: number;
  overpullKN: number;
  jarType?: "mechanical" | "hydraulic";
  jarStretchM?: number;
  hammerMassKg?: number;     // масса ударной массы ясса (по умолчанию 500 кг)
  impactTimeMs?: number;     // длительность удара (по умолчанию 5 мс)
}

export interface FishingResult {
  requiredHookLoadKN: number;
  jarImpactKN: number;
  jarEnergyJ: number;
  jarVelocityMs: number;
  maxSafeHookLoadKN: number;
  canEngage: boolean;
  recommendation: string;
}

export function calculateFishing(input: FishingInput, well: WorkoverWellData): FishingResult {
  let jarImpact = 0;
  let jarEnergy = 0;
  let jarVelocity = 0;

  if (input.jarType && input.jarStretchM && input.jarStretchM > 0) {
    const hammerMass = input.hammerMassKg ?? 500;
    const impactTime = (input.impactTimeMs ?? 5) / 1000; // c
    // Жёсткость свободной колонны k = E·A/L
    const A = pipeCrossArea_m2(well.pipeOD_mm, well.pipeID_mm);
    const L = Math.max(1, input.fishTopMD);
    const k = (well.pipeYoungModulusGPa * 1e9 * A) / L; // Н/м
    // Накопленная упругая энергия в колонне: E = ½·k·x²
    jarEnergy = 0.5 * k * input.jarStretchM * input.jarStretchM; // Дж
    // Скорость молота в момент удара: v = √(2E/m)
    jarVelocity = Math.sqrt((2 * jarEnergy) / hammerMass); // м/с
    // Пиковая ударная сила: F = m·v/Δt
    jarImpact = (hammerMass * jarVelocity) / Math.max(1e-6, impactTime) / 1000; // кН
  }

  const maxSafe = pipeYieldForceKN(well);
  const required = input.fishWeightKN + input.overpullKN;
  return {
    requiredHookLoadKN: required,
    jarImpactKN: jarImpact,
    jarEnergyJ: jarEnergy,
    jarVelocityMs: jarVelocity,
    maxSafeHookLoadKN: maxSafe,
    canEngage: required < maxSafe,
    recommendation:
      jarImpact > 0
        ? `Ясс: энергия ${(jarEnergy / 1000).toFixed(0)} кДж, скорость удара ${jarVelocity.toFixed(1)} м/с, пиковая сила ${jarImpact.toFixed(0)} кН. Серия ударов для прихваченной рыбы.`
        : "Захват рыбы натяжением. При неудаче — применить ясс.",
  };
}

// ────────── BLOCK 5: rig capacity ──────────

export interface RigInput {
  rigCapacityKN: number;
  derrickCapacityKN: number;
  safetyFactor: number;
  currentHookLoadKN: number;
}

export interface RigResult {
  allowableLoadKN: number;
  limitingComponent: "rig" | "derrick";
  marginKN: number;
  utilizationPct: number;
  maxOverpullKN: number;
  status: "safe" | "caution" | "overload";
  warnings: string[];
}

export function calculateRigCapacity(input: RigInput): RigResult {
  const limiting = Math.min(input.rigCapacityKN, input.derrickCapacityKN);
  const limitingComponent: "rig" | "derrick" =
    input.rigCapacityKN <= input.derrickCapacityKN ? "rig" : "derrick";
  const allowable = limiting / Math.max(1, input.safetyFactor);
  const margin = allowable - input.currentHookLoadKN;
  const utilization = (input.currentHookLoadKN / Math.max(1e-6, allowable)) * 100;

  const warnings: string[] = [];
  if (utilization > 100)
    warnings.push(
      `🔴 ПЕРЕГРУЗ: ${input.currentHookLoadKN.toFixed(0)} кН > допустимой ${allowable.toFixed(0)} кН.`,
    );
  else if (utilization > 85)
    warnings.push(`🟡 Близко к пределу (${utilization.toFixed(0)}%). Осторожно при расхаживании.`);
  if (input.derrickCapacityKN < input.rigCapacityKN)
    warnings.push(`Мачта (${input.derrickCapacityKN} кН) слабее лебёдки — ограничивающий фактор.`);

  return {
    allowableLoadKN: allowable,
    limitingComponent,
    marginKN: margin,
    utilizationPct: utilization,
    maxOverpullKN: Math.max(0, margin),
    status: utilization > 100 ? "overload" : utilization > 85 ? "caution" : "safe",
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════
// РЕЦЕПТУРНЫЙ ДВИЖОК ЖИДКОСТИ ГЛУШЕНИЯ (соли → плотность)
// ═══════════════════════════════════════════════════════════════════

export type SaltForm = "powder" | "granule" | "dry";

export interface KillSalt {
  id: string;
  name: string;
  formula: string;
  purity: number;              // % чистоты товарного продукта
  form: SaltForm;
  densityCoeff_k: number;      // ρ = 1.0 + k × wt%(чистой соли)
  maxDensity: number;
  maxWtPctClean: number;
  solubility_g_per_L: number;
  dissolveBaseMin: number;     // мин на 10% концентрации
}

export const KILL_SALTS: KillSalt[] = [
  { id: "nacl",  name: "Галит (NaCl сухой)",                       formula: "NaCl",  purity: 98,  form: "dry",
    densityCoeff_k: 0.00758, maxDensity: 1.20, maxWtPctClean: 26.4, solubility_g_per_L: 359, dissolveBaseMin: 15 },
  { id: "cacl2", name: "Кальций хлористый техн. гранулированный",  formula: "CaCl₂", purity: 94,  form: "granule",
    densityCoeff_k: 0.01000, maxDensity: 1.40, maxWtPctClean: 40,   solubility_g_per_L: 745, dissolveBaseMin: 25 },
  { id: "kcl94", name: "Калий хлористый 94% порошок",              formula: "KCl",   purity: 94,  form: "powder",
    densityCoeff_k: 0.00667, maxDensity: 1.16, maxWtPctClean: 24,   solubility_g_per_L: 340, dissolveBaseMin: 10 },
  { id: "kcl94g",name: "Калий хлористый 94% гранулы",              formula: "KCl",   purity: 94,  form: "granule",
    densityCoeff_k: 0.00667, maxDensity: 1.16, maxWtPctClean: 24,   solubility_g_per_L: 340, dissolveBaseMin: 22 },
  { id: "kcl60", name: "Калий хлористый 60% порошок",              formula: "KCl",   purity: 60,  form: "powder",
    densityCoeff_k: 0.00667, maxDensity: 1.16, maxWtPctClean: 24,   solubility_g_per_L: 340, dissolveBaseMin: 10 },
  { id: "kcl60g",name: "Калий хлористый 60% гранулы",              formula: "KCl",   purity: 60,  form: "granule",
    densityCoeff_k: 0.00667, maxDensity: 1.16, maxWtPctClean: 24,   solubility_g_per_L: 340, dissolveBaseMin: 22 },
  { id: "water", name: "Вода техническая",                         formula: "H₂O",   purity: 100, form: "dry",
    densityCoeff_k: 0,       maxDensity: 1.00, maxWtPctClean: 0,    solubility_g_per_L: 0,   dissolveBaseMin: 0 },
];

export interface BrineRecipe {
  feasible: boolean;
  targetDensity: number;
  salt: KillSalt;
  wtPctClean: number;
  productMassKg: number;
  pureSaltKg: number;
  waterVolumeL: number;
  waterMassKg: number;
  dissolveTimeMin: number;
  maxAchievableDensity: number;
  warnings: string[];
}

export function calculateBrineRecipe(
  salt: KillSalt,
  targetDensity: number,
  volumeM3: number,
  mixingIntensity: "low" | "medium" | "high" = "medium",
  temperatureC: number = 20,
): BrineRecipe {
  const warnings: string[] = [];

  if (targetDensity > salt.maxDensity) {
    return {
      feasible: false, targetDensity, salt,
      wtPctClean: 0, productMassKg: 0, pureSaltKg: 0, waterVolumeL: 0, waterMassKg: 0,
      dissolveTimeMin: 0, maxAchievableDensity: salt.maxDensity,
      warnings: [`🔴 ${salt.name} даёт максимум ${salt.maxDensity} г/см³. Для ${targetDensity.toFixed(2)} г/см³ нужна другая соль (CaCl₂ до 1.40) или утяжелитель.`],
    };
  }
  if (targetDensity < 1.0) warnings.push("Плотность < 1.0 — достаточно чистой воды без соли.");

  const wtPctClean = salt.densityCoeff_k > 0 ? Math.max(0, (targetDensity - 1.0) / salt.densityCoeff_k) : 0;
  const totalMassKg = targetDensity * 1000 * volumeM3;
  const pureSaltKg = (wtPctClean / 100) * totalMassKg;
  const productMassKg = salt.purity > 0 ? pureSaltKg / (salt.purity / 100) : 0;
  const waterMassKg = totalMassKg - productMassKg;
  const waterVolumeL = waterMassKg / 1.0;

  const concFactor = Math.max(0.1, wtPctClean / 10);
  const mixFactor = mixingIntensity === "high" ? 0.6 : mixingIntensity === "low" ? 1.5 : 1.0;
  const tempFactor = temperatureC < 10 ? 1.4 : temperatureC > 30 ? 0.8 : 1.0;
  const dissolveTime = salt.dissolveBaseMin * concFactor * mixFactor * tempFactor;

  if (wtPctClean > salt.maxWtPctClean * 0.9)
    warnings.push(`⚠ Концентрация ${wtPctClean.toFixed(1)}% близка к насыщению (${salt.maxWtPctClean}%) — риск кристаллизации при охлаждении. Контролировать температуру.`);
  if (salt.purity > 0 && salt.purity < 90)
    warnings.push(`Продукт ${salt.purity}% чистоты — требуется ${productMassKg.toFixed(0)} кг товарного (примеси не дают плотности).`);
  if (temperatureC < 10)
    warnings.push(`⚠ Холодная вода (${temperatureC}°C) — растворение в 1.4× дольше. Подогреть для ускорения.`);
  if (salt.form === "granule")
    warnings.push("Гранулы растворяются медленнее порошка — учесть в графике подготовки.");

  return {
    feasible: true, targetDensity, salt, wtPctClean,
    productMassKg, pureSaltKg, waterVolumeL, waterMassKg,
    dissolveTimeMin: dissolveTime, maxAchievableDensity: salt.maxDensity, warnings,
  };
}

export function autoSelectSalt(targetDensity: number): KillSalt | null {
  if (targetDensity <= 1.00) return KILL_SALTS.find((s) => s.id === "water")!;
  if (targetDensity <= 1.16) return KILL_SALTS.find((s) => s.id === "kcl94")!;
  if (targetDensity <= 1.20) return KILL_SALTS.find((s) => s.id === "nacl")!;
  if (targetDensity <= 1.40) return KILL_SALTS.find((s) => s.id === "cacl2")!;
  return null;
}

// ─── Многоинтервальное глушение ─────────────────────────────────────
export interface KillInterval {
  topMD: number;
  bottomMD: number;
  topTVD: number;
  bottomTVD: number;
  formationPressureMPa: number;
  intervalType: "kill_zone" | "kick_zone" | "transit";
  requiredKillDensity: number;
}

export interface MultiIntervalKill {
  intervals: KillInterval[];
  governingDensity: number;
  governingInterval: number;
  recipe: BrineRecipe;
  totalVolumeM3: number;
  warnings: string[];
}

export function planMultiIntervalKill(
  intervals: KillInterval[],
  salt: KillSalt,
  wellVolumeM3: number,
  mixingIntensity: "low" | "medium" | "high",
  safetyMarginPct: number,
  temperatureC: number = 20,
): MultiIntervalKill {
  const G = 9.81;
  const withDensity: KillInterval[] = intervals.map((iv) => {
    const tvd = Math.max(1, iv.bottomTVD);
    const bal = (iv.formationPressureMPa * 1e6) / (G * tvd) / 1000;
    return { ...iv, requiredKillDensity: bal * (1 + safetyMarginPct / 100) };
  });

  let governing = 0;
  for (let i = 1; i < withDensity.length; i++)
    if (withDensity[i].requiredKillDensity > withDensity[governing].requiredKillDensity) governing = i;

  const governingDensity = withDensity.length ? withDensity[governing].requiredKillDensity : 1.0;
  const recipe = calculateBrineRecipe(salt, governingDensity, wellVolumeM3, mixingIntensity, temperatureC);

  const warnings: string[] = [];
  withDensity.forEach((iv, i) => {
    if (i === governing) return;
    const bhp = (governingDensity * 1000 * G * iv.bottomTVD) / 1e6;
    const excess = bhp - iv.formationPressureMPa;
    warnings.push(`Интервал ${iv.topMD.toFixed(0)}–${iv.bottomMD.toFixed(0)} м: ${bhp.toFixed(1)} МПа vs Pпл ${iv.formationPressureMPa.toFixed(1)} (избыток +${excess.toFixed(1)} МПа).`);
  });
  if (!recipe.feasible)
    warnings.push(`🔴 Определяющая плотность ${governingDensity.toFixed(2)} недостижима солью ${salt.name}.`);

  return {
    intervals: withDensity, governingDensity, governingInterval: governing,
    recipe, totalVolumeM3: wellVolumeM3, warnings,
  };
}
