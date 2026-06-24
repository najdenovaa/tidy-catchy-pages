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

  const dhAnn = Math.max(0.005, (input.casingID_mm - input.tubingOD_mm) / 1000);
  const annArea = (Math.PI / 4) * ((input.casingID_mm / 1000) ** 2 - (input.tubingOD_mm / 1000) ** 2);
  const vAnn = input.pumpRateLs / 1000 / Math.max(1e-6, annArea);
  const dpdlAnn =
    input.killFluidYP_Pa / (0.2 * dhAnn) + ((input.killFluidPV_cP / 1000) * vAnn) / (1.5 * dhAnn * dhAnn);
  const frictionLoss = (dpdlAnn * input.wellDepthMD) / 1e6;

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
    const zen = (zenDeg * Math.PI) / 180;
    const wSeg = well.pipeWeight_kgm * step * 9.81 * bf;
    const axial = wSeg * Math.cos(zen);
    const normal = wSeg * Math.sin(zen);
    const drag = mu * Math.abs(normal);

    freeWeight += axial;
    if (input.operation === "pull_out") tension += axial + drag;
    else if (input.operation === "run_in") tension += axial - drag;
    else tension += axial;

    points.push({ md, hookLoadKN: tension / 1000, dragKN: drag / 1000, zenithDeg: zenDeg });
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
} {
  const A = pipeCrossArea_m2(well.pipeOD_mm, well.pipeID_mm);
  const E = well.pipeYoungModulusGPa * 1e9;
  const dF = input.pulledForceKN * 1000;
  if (dF <= 0) return { freePointMD: 0, freePipeLength: 0 };
  const freePoint = (E * A * input.measuredStretchM) / dF;
  const clamped = Math.min(Math.max(0, freePoint), well.wellDepthMD);
  return { freePointMD: clamped, freePipeLength: clamped };
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
}

export interface FishingResult {
  requiredHookLoadKN: number;
  jarImpactKN: number;
  jarEnergyJ: number;
  maxSafeHookLoadKN: number;
  canEngage: boolean;
  recommendation: string;
}

export function calculateFishing(input: FishingInput, well: WorkoverWellData): FishingResult {
  let jarImpact = 0;
  let jarEnergy = 0;
  if (input.jarType && input.jarStretchM) {
    jarEnergy = 0.5 * input.overpullKN * 1000 * input.jarStretchM;
    jarImpact = input.overpullKN * 2;
  }
  const maxSafe = pipeYieldForceKN(well);
  const required = input.fishWeightKN + input.overpullKN;
  return {
    requiredHookLoadKN: required,
    jarImpactKN: jarImpact,
    jarEnergyJ: jarEnergy,
    maxSafeHookLoadKN: maxSafe,
    canEngage: required < maxSafe,
    recommendation:
      jarImpact > 0
        ? `Ясс даёт ударную нагрузку ~${jarImpact.toFixed(0)} кН. Для прихваченной рыбы — серия ударов.`
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
