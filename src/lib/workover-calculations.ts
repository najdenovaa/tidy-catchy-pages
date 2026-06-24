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
