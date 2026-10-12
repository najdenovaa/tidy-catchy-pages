/**
 * Workover (КРС) calculations — full physics.
 * Blocks: 0 well data, 1 packers, 2 drag & lubricants, 3 stuck pipe, 4 fishing, 5 rig capacity.
 *
 * Formulas:
 *   • drag           : soft-string  T += w·cosθ ± μ·Fn  (нагрузка на крюке — на устье)
 *   • hydraulics     : Бингам, ламинар (труба 32μv/D²+16τ/3D, зазор 48μv/Dh²+6τ/Dh)
 *                      vs турбулентный режим (Блазиус), берётся больший градиент
 *   • diff. sticking : F = μ · ΔP · A_contact
 *   • free point     : Hooke's law  L = E·A·ΔL / ΔF
 *   • packer hold    : F = μ · P_set · π·D·L   (оценка; заменить паспортом пакера)
 *   • lubricant      : CoF directly from lubricity tester (OFITE/Fann)
 *   • pipe limit     : min(тело, резьба) · остаточная прочность / SF
 *   • jar            : растяжение по Гуку, скорость по волновому сопротивлению F/(A·√(Eρ))
 */

const G = 9.81;
const STEEL_DENSITY = 7850; // кг/м³

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
  /** Тип соединения НКТ: гладкая (NU), с высаженными концами (EUE), безмуфтовая/премиум */
  connectionType?: ConnectionType;
  /** Остаточная прочность трубы с учётом износа/коррозии, % (новая = 100) */
  pipeConditionPct?: number;
}

export type ConnectionType = "nu" | "eue" | "premium";

/**
 * Отношение прочности резьбового соединения к прочности тела трубы.
 * Гладкая НКТ (API NU, ГОСТ 633 гладкая): по табличным данным API 5C2/5C3
 * для 2-3/8", 2-7/8", 3-1/2" N80 соединение ≈ 0.69 от тела трубы.
 * EUE и премиум — равнопрочны телу.
 */
export const CONNECTION_EFFICIENCY: Record<ConnectionType, number> = {
  nu: 0.69,
  eue: 1.0,
  premium: 1.0,
};

export const CONNECTION_LABELS: Record<ConnectionType, string> = {
  nu: "Гладкая (NU)",
  eue: "Высаженные концы (EUE/В)",
  premium: "Безмуфтовая / премиум",
};

export function pipeCrossArea_m2(od_mm: number, id_mm: number): number {
  const od = od_mm / 1000, id = id_mm / 1000;
  return (Math.PI / 4) * Math.max(0, od * od - id * id);
}

/** Предел текучести тела трубы, кН (без запаса и износа). */
export function pipeBodyYieldKN(well: WorkoverWellData): number {
  return (well.pipeYieldMPa * 1e6 * pipeCrossArea_m2(well.pipeOD_mm, well.pipeID_mm)) / 1000;
}

/** Допустимая растягивающая нагрузка: min(тело, резьба) × остаточная прочность ÷ SF. */
export function pipeYieldForceKN(well: WorkoverWellData, sf = 1.25): number {
  const conn = CONNECTION_EFFICIENCY[well.connectionType ?? "nu"];
  const cond = Math.min(100, Math.max(1, well.pipeConditionPct ?? 100)) / 100;
  return (pipeBodyYieldKN(well) * conn * cond) / sf;
}

// ────────── Гидравлика (Бингам: ламинарный / турбулентный) ──────────

export interface FlowResult {
  gradPaM: number;
  velocityMs: number;
  reynolds: number;
  turbulent: boolean;
}

function frictionGradient(
  geometry: "pipe" | "annulus",
  rho_kgm3: number, pv_cP: number, yp_Pa: number,
  diam_m: number, area_m2: number, rate_m3s: number,
): FlowResult {
  const mu = Math.max(1e-4, pv_cP / 1000);
  const D = Math.max(1e-4, diam_m);
  const v = rate_m3s / Math.max(1e-8, area_m2);
  const laminar = geometry === "pipe"
    ? (32 * mu * v) / (D * D) + (16 * yp_Pa) / (3 * D)
    : (48 * mu * v) / (D * D) + (6 * yp_Pa) / D;
  const re = (rho_kgm3 * v * D) / mu;
  const fanning = re > 2100 ? 0.0791 / Math.pow(re, 0.25) : 0;
  const turbulentGrad = (2 * fanning * rho_kgm3 * v * v) / D;
  const turbulent = turbulentGrad > laminar;
  return { gradPaM: Math.max(laminar, turbulentGrad), velocityMs: v, reynolds: re, turbulent };
}

/** Потери на трение в НКТ, МПа. */
export function tubingFrictionMPa(
  lengthM: number, tubingID_mm: number, rho_gcm3: number, pv_cP: number, yp_Pa: number, rateLs: number,
): FlowResult & { lossMPa: number } {
  const D = tubingID_mm / 1000;
  const r = frictionGradient("pipe", rho_gcm3 * 1000, pv_cP, yp_Pa, D, (Math.PI / 4) * D * D, rateLs / 1000);
  return { ...r, lossMPa: (r.gradPaM * lengthM) / 1e6 };
}

/** Потери на трение в затрубье, МПа. */
export function annulusFrictionMPa(
  lengthM: number, casingID_mm: number, tubingOD_mm: number, rho_gcm3: number, pv_cP: number, yp_Pa: number, rateLs: number,
): FlowResult & { lossMPa: number } {
  const Dh = Math.max(0.005, (casingID_mm - tubingOD_mm) / 1000);
  const A = (Math.PI / 4) * ((casingID_mm / 1000) ** 2 - (tubingOD_mm / 1000) ** 2);
  const r = frictionGradient("annulus", rho_gcm3 * 1000, pv_cP, yp_Pa, Dh, A, rateLs / 1000);
  return { ...r, lossMPa: (r.gradPaM * lengthM) / 1e6 };
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
  /** Допустимая нагрузка на колонну (с учётом резьбы, износа и запаса), кН. Если задана — используется вместо тела трубы ÷1.25. */
  pipeTensileLimitKN?: number;
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
  const tensileLimit = input.pipeTensileLimitKN ?? (input.pipeYieldMPa * 1e6 * A) / 1000 / 1.25;
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
  /** Реология жидкости, находящейся в скважине (для давления начала циркуляции). По умолчанию = жидкость глушения. */
  currentFluidPV_cP?: number;
  currentFluidYP_Pa?: number;
  /** Опциональный профиль секций для расчёта потерь по интервалам разного диаметра */
  sections?: KillSection[];
}

export interface KillResult {
  killDensity: number;
  balanceDensity: number;
  bottomholePressureMPa: number;
  killVolumeM3: number;
  tubingVolumeM3: number;
  annulusVolumeM3: number;
  /** Избыточное давление в трубах при закрытой скважине: Pпл − ρтек·g·H */
  sidppMPa: number;
  /** Давление прокачки (трение НКТ + затрубье) текущей жидкостью */
  circPressureCurrentMPa: number;
  initialCircPressureMPa: number;
  finalCircPressureMPa: number;
  tubingFrictionMPa: number;
  annulusFrictionMPa: number;
  tubingTurbulent: boolean;
  annulusTurbulent: boolean;
  tubingVelocityMs: number;
  annulusVelocityMs: number;
  /** Задавка: устьевое давление в начале (скважина заполнена текущей жидкостью) */
  bullheadSurfacePressureMPa: number;
  /** Задавка: устьевое давление в конце (НКТ заполнены жидкостью глушения) */
  bullheadEndPressureMPa: number;
  /** Задавка: максимально допустимое устьевое давление в начале (по ГРП) */
  bullheadMaxSurfaceMPa: number;
  exceedsFracture: boolean;
  /** Суммарные потери на трение при циркуляции жидкостью глушения (НКТ + затрубье) */
  frictionLossMPa: number;
  selectedFluid: string;
  warnings: string[];
  recommendation: string;
}

/** Секционный расчёт потерь трения в затрубье (Бингам, ламинар/турбулент), МПа. */
export function calculateKillFriction(
  sections: KillSection[],
  pumpRateLs: number,
  killFluidPV_cP: number,
  killFluidYP_Pa: number,
  density_gcm3 = 1.0,
): number {
  let totalLoss = 0;
  for (const sec of sections) {
    totalLoss += annulusFrictionMPa(
      sec.lengthM, sec.casingID_mm, sec.tubingOD_mm, density_gcm3, killFluidPV_cP, killFluidYP_Pa, pumpRateLs,
    ).lossMPa;
  }
  return totalLoss;
}

export function calculateKill(input: KillInput): KillResult {
  const tvd = Math.max(1, input.reservoirDepthTVD);
  const md = Math.max(1, input.wellDepthMD);

  const balanceDensity = (input.formationPressureMPa * 1e6) / (G * tvd) / 1000;
  const killDensity = balanceDensity * (1 + input.safetyMarginPct / 100);
  const bhp = (killDensity * 1000 * G * tvd) / 1e6;
  const exceedsFracture = bhp > input.fracturePressureMPa;

  const tubingVolume = (Math.PI / 4) * (input.tubingID_mm / 1000) ** 2 * md;
  const annulusVolume =
    (Math.PI / 4) * Math.max(0, (input.casingID_mm / 1000) ** 2 - (input.tubingOD_mm / 1000) ** 2) * md;
  const killVolume = tubingVolume + annulusVolume;

  const curPV = input.currentFluidPV_cP ?? input.killFluidPV_cP;
  const curYP = input.currentFluidYP_Pa ?? input.killFluidYP_Pa;

  const annulusLoss = (rho: number, pv: number, yp: number) =>
    input.sections && input.sections.length > 0
      ? { lossMPa: calculateKillFriction(input.sections, input.pumpRateLs, pv, yp, rho), turbulent: false, velocityMs: 0 }
      : annulusFrictionMPa(md, input.casingID_mm, input.tubingOD_mm, rho, pv, yp, input.pumpRateLs);

  // Циркуляция жидкостью глушения
  const tubKill = tubingFrictionMPa(md, input.tubingID_mm, killDensity, input.killFluidPV_cP, input.killFluidYP_Pa, input.pumpRateLs);
  const annKill = annulusLoss(killDensity, input.killFluidPV_cP, input.killFluidYP_Pa);
  // Циркуляция текущей жидкостью
  const tubCur = tubingFrictionMPa(md, input.tubingID_mm, input.currentMudDensity, curPV, curYP, input.pumpRateLs);
  const annCur = annulusLoss(input.currentMudDensity, curPV, curYP);

  const circCurrent = tubCur.lossMPa + annCur.lossMPa;
  const circKill = tubKill.lossMPa + annKill.lossMPa;

  const hydroCur = (input.currentMudDensity * 1000 * G * tvd) / 1e6;
  const killHydro = (killDensity * 1000 * G * tvd) / 1e6;
  const sidpp = Math.max(0, input.formationPressureMPa - hydroCur);

  // Метод ожидания/бурильщика: ICP = Pизб.тр + Pпрокачки; FCP = Pпрокачки жидкостью глушения
  const ICP = sidpp + circCurrent;
  const FCP = circKill;

  // Задавка в НКТ: на забое нужно ≥ Pпл, не более Pгрп
  const bullheadStart = Math.max(0, input.formationPressureMPa - hydroCur + tubCur.lossMPa);
  const bullheadEnd = Math.max(0, input.formationPressureMPa - killHydro + tubKill.lossMPa);
  const bullheadMax = Math.max(0, input.fracturePressureMPa - hydroCur + tubCur.lossMPa);

  const fluid = KILL_FLUIDS.find((f) => f.maxDensity >= killDensity) ?? KILL_FLUIDS[KILL_FLUIDS.length - 1];

  const warnings: string[] = [];
  if (exceedsFracture)
    warnings.push(
      `🔴 Забойное давление глушения ${bhp.toFixed(1)} МПа > ГРП ${input.fracturePressureMPa.toFixed(1)} МПа. Риск поглощения! Снизить плотность или применить поэтапное глушение.`,
    );
  if ((input.method === "driller" || input.method === "wait_weight")) {
    const ecd = (killHydro + annKill.lossMPa);
    if (!exceedsFracture && ecd > input.fracturePressureMPa)
      warnings.push(
        `🔴 С учётом трения в затрубье (${annKill.lossMPa.toFixed(1)} МПа) забойное ${ecd.toFixed(1)} МПа > ГРП. Снизить расход насоса.`,
      );
  }
  if (input.method === "bullhead") {
    if (bullheadStart >= bullheadMax)
      warnings.push(
        `🔴 Задавка невозможна без ГРП: нужно ${bullheadStart.toFixed(1)} МПа на устье, допустимо ${bullheadMax.toFixed(1)} МПа. Снизить расход или сменить метод.`,
      );
    else if (bullheadStart > 0.85 * bullheadMax)
      warnings.push(
        `⚠ Задавка: устьевое ${bullheadStart.toFixed(1)} МПа близко к пределу ${bullheadMax.toFixed(1)} МПа по ГРП. Контролировать давление.`,
      );
  }
  if (tubKill.lossMPa > 0.7 * Math.max(circKill, 1e-6) && tubKill.turbulent)
    warnings.push(
      `Основные потери — в НКТ (${tubKill.lossMPa.toFixed(1)} МПа, турбулентный режим). Давление насоса сильно зависит от расхода: −20% расхода ≈ −30% потерь.`,
    );
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
        "Метод ожидания: сразу закачка утяжелённой жидкости за 1 циркуляцию. Давление насоса снижается от ICP до FCP, пока жидкость глушения заполняет НКТ, затем держится на FCP.";
      break;
    case "volumetric":
      recommendation =
        "Объёмный метод: без циркуляции (нет доступа к забою). Стравливание газа порциями с поддержанием давления.";
      break;
    case "bullhead":
      recommendation = `Прямая задавка в пласт через НКТ: устьевое давление ${bullheadStart.toFixed(1)} → ${bullheadEnd.toFixed(1)} МПа по мере заполнения НКТ, предел по ГРП ${bullheadMax.toFixed(1)} МПа. Без учёта приёмистости пласта.`;
      break;
  }

  return {
    killDensity,
    balanceDensity,
    bottomholePressureMPa: bhp,
    killVolumeM3: killVolume,
    tubingVolumeM3: tubingVolume,
    annulusVolumeM3: annulusVolume,
    sidppMPa: sidpp,
    circPressureCurrentMPa: circCurrent,
    initialCircPressureMPa: ICP,
    finalCircPressureMPa: FCP,
    tubingFrictionMPa: tubKill.lossMPa,
    annulusFrictionMPa: annKill.lossMPa,
    tubingTurbulent: tubKill.turbulent,
    annulusTurbulent: annKill.turbulent,
    tubingVelocityMs: tubKill.velocityMs,
    annulusVelocityMs: annKill.velocityMs,
    bullheadSurfacePressureMPa: bullheadStart,
    bullheadEndPressureMPa: bullheadEnd,
    bullheadMaxSurfaceMPa: bullheadMax,
    exceedsFracture,
    frictionLossMPa: circKill,
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
  /** Нагрузка, приложенная к низу колонны (рыба, натяжка, пакер), кН. Растягивающая > 0. */
  bottomLoadKN?: number;
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

  let tension = (input.bottomLoadKN ?? 0) * 1000;
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
    // Нагрузка на крюке — натяжение у устья (первая точка после разворота: наименьшая MD)
    maxHookLoadKN: points[0]?.hookLoadKN ?? 0,
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
  /** Нагрузка от колонны над точкой прихвата (вес + затяжки), кН */
  stringLoadKN: number;
  /** Требуемая нагрузка на крюке для освобождения натяжкой, кН */
  requiredHookLoadKN: number;
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
  stringLoadKN = 0,
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
  const requiredHook = stringLoadKN + freeingForce;
  const canFree = freeingForce > 0 && requiredHook < limit;

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
    stringLoadKN,
    requiredHookLoadKN: requiredHook,
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
  /** УБТ / утяжелённые трубы над яссом (ударная масса). 0 — ясс в компоновке НКТ без УБТ. */
  collarLengthM?: number;
  collarOD_mm?: number;
  collarID_mm?: number;
  /** Коэффициент трения для расчёта затяжек ловильной колонны (по умолчанию 0.3) */
  frictionCoeff?: number;
}

export interface FishingResult {
  /** Нагрузка на крюке при натяжке (вес колонны + затяжки + УБТ + рыба + натяжка), кН */
  requiredHookLoadKN: number;
  /** Нагрузка на крюке без натяжки (взвешенная колонна с рыбой), кН */
  stringLoadKN: number;
  /** Растяжение колонны при натяжке, м (по Гуку) */
  jarStretchM: number;
  /** Упругая энергия, запасённая в колонне при взводе: ½·F·x, Дж */
  jarEnergyJ: number;
  /** Скорость ударной части в момент срабатывания: F / (A·√(E·ρ)), м/с */
  jarVelocityMs: number;
  /** Оценка ударной силы, диапазон, кН */
  jarImpactLowKN: number;
  jarImpactHighKN: number;
  /** Допустимая нагрузка на колонну (резьба, износ, запас), кН */
  maxSafeHookLoadKN: number;
  canEngage: boolean;
  recommendation: string;
  warnings: string[];
}

export function calculateFishing(input: FishingInput, well: WorkoverWellData): FishingResult {
  const E = well.pipeYoungModulusGPa * 1e9;
  const L = Math.max(1, Math.min(input.fishTopMD, well.wellDepthMD));
  const Ap = pipeCrossArea_m2(well.pipeOD_mm, well.pipeID_mm);
  const bf = 1 - well.fluidDensity_gcm3 / 7.85;

  const collarLen = Math.max(0, input.collarLengthM ?? 0);
  const Ac = collarLen > 0 ? pipeCrossArea_m2(input.collarOD_mm ?? 0, input.collarID_mm ?? 0) : 0;
  const collarWeightKN = (Ac * STEEL_DENSITY * collarLen * G * bf) / 1000;

  // Затяжки колонны до головы рыбы: внизу висит рыба + УБТ + натяжка
  const pipeLen = Math.max(1, L - collarLen);
  const segWell = { ...well, wellDepthMD: pipeLen };
  const mu = input.frictionCoeff ?? 0.3;
  const withPull = calculateDrag(
    { operation: "pull_out", frictionCoeff: mu, bottomLoadKN: input.fishWeightKN + collarWeightKN + input.overpullKN },
    segWell,
  );
  const noPull = calculateDrag(
    { operation: "pull_out", frictionCoeff: mu, bottomLoadKN: input.fishWeightKN + collarWeightKN },
    segWell,
  );
  const required = withPull.maxHookLoadKN;

  // Ясс: растяжение и энергия взвода, скорость по волновому сопротивлению трубы над яссом
  const F = Math.max(0, input.overpullKN) * 1000;
  const stretch = (F * pipeLen) / Math.max(1e-6, E * Ap);
  const energy = 0.5 * F * stretch;
  const hammerArea = Ac > 0 ? Ac : Ap;
  const impedance = hammerArea * Math.sqrt(E * STEEL_DENSITY); // Н·с/м
  const velocity = F / Math.max(1e-6, impedance);
  // Ударная сила: оценка через коэффициент усиления к натяжке.
  // НКТ без УБТ ≈ 1.0–1.5; с УБТ над яссом ≈ 1.5–3 (рекомендации производителей яссов).
  const [kLow, kHigh] = collarLen > 0 ? [1.5, 3] : [1.0, 1.5];
  const jarOn = !!input.jarType && F > 0;

  const maxSafe = pipeYieldForceKN(well);
  const canEngage = required < maxSafe;

  const warnings: string[] = [];
  if (!canEngage)
    warnings.push(
      `🔴 Нагрузка на крюке ${required.toFixed(0)} кН > допустимой для колонны ${maxSafe.toFixed(0)} кН. Уменьшить натяжку или сменить колонну.`,
    );
  if (well.connectionType === "nu" || well.connectionType === undefined)
    warnings.push("Гладкие НКТ: предел ограничен резьбой (≈69% тела трубы). Для ловильных работ предпочтительны НКТ с высаженными концами или бурильные трубы.");
  if (jarOn && collarLen === 0)
    warnings.push("Нет УБТ над яссом — удар слабый (≈ натяжке). Для эффективной работы ясса установить УБТ/утяжелённые трубы над яссом.");

  return {
    requiredHookLoadKN: required,
    stringLoadKN: noPull.maxHookLoadKN,
    jarStretchM: jarOn ? stretch : 0,
    jarEnergyJ: jarOn ? energy : 0,
    jarVelocityMs: jarOn ? velocity : 0,
    jarImpactLowKN: jarOn ? input.overpullKN * kLow : 0,
    jarImpactHighKN: jarOn ? input.overpullKN * kHigh : 0,
    maxSafeHookLoadKN: maxSafe,
    canEngage,
    recommendation: jarOn
      ? `Ясс: натяжка ${input.overpullKN.toFixed(0)} кН растягивает колонну на ${stretch.toFixed(2)} м, скорость ударной части ≈ ${velocity.toFixed(1)} м/с, удар ≈ ${(input.overpullKN * kLow).toFixed(0)}–${(input.overpullKN * kHigh).toFixed(0)} кН. Оценка; точные значения — по программе производителя ясса.`
      : "Захват рыбы натяжением. При неудаче — применить ясс.",
    warnings,
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
  /** Давление гидроразрыва (поглощения) интервала, МПа. 0/не задано — не проверяется. */
  fracturePressureMPa?: number;
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
    const bhp = (governingDensity * 1000 * G * iv.bottomTVD) / 1e6;
    const excess = bhp - iv.formationPressureMPa;
    const name = `Интервал ${iv.topMD.toFixed(0)}–${iv.bottomMD.toFixed(0)} м`;
    if (iv.fracturePressureMPa && iv.fracturePressureMPa > 0 && bhp > iv.fracturePressureMPa) {
      warnings.push(`🔴 ${name}: давление ${bhp.toFixed(1)} МПа > Pгрп ${iv.fracturePressureMPa.toFixed(1)} МПа — поглощение. Нужна блокирующая пачка или поинтервальное глушение.`);
      return;
    }
    if (i === governing) return;
    const fracNote = iv.fracturePressureMPa && iv.fracturePressureMPa > 0
      ? `, запас до ГРП ${(iv.fracturePressureMPa - bhp).toFixed(1)} МПа`
      : ", Pгрп не задано — поглощение не проверено";
    warnings.push(`${name}: ${bhp.toFixed(1)} МПа vs Pпл ${iv.formationPressureMPa.toFixed(1)} (избыток +${excess.toFixed(1)} МПа${fracNote}).`);
  });
  if (!recipe.feasible)
    warnings.push(`🔴 Определяющая плотность ${governingDensity.toFixed(2)} недостижима солью ${salt.name}.`);

  return {
    intervals: withDensity, governingDensity, governingInterval: governing,
    recipe, totalVolumeM3: wellVolumeM3, warnings,
  };
}
