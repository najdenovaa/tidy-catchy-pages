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

/** Предел текучести σт (не менее), МПа. ГОСТ 633-80 табл. 6 (Д — исполнение А) и API 5CT. */
export const STEEL_GRADES: Record<string, number> = {
  "Д": 379, "К": 491, "Е": 552, "Л": 654, "М": 724, "Р": 930,
  J55: 379, K55: 379, N80: 552, L80: 552,
  C90: 621, T95: 655, P110: 758, Q125: 862,
};

/** Гладкие НКТ по ГОСТ 633-80, табл. 2 (масса 1 м трубы — по стандарту). */
export const GOST_TUBING_SIZES = [
  { label: "33×3,5", od: 33.4, wall: 3.5, massKgm: 2.6 },
  { label: "42×3,5", od: 42.2, wall: 3.5, massKgm: 3.3 },
  { label: "48×4,0", od: 48.3, wall: 4.0, massKgm: 4.4 },
  { label: "60×5,0", od: 60.3, wall: 5.0, massKgm: 6.8 },
  { label: "73×5,5", od: 73.0, wall: 5.5, massKgm: 9.2 },
  { label: "73×7,0", od: 73.0, wall: 7.0, massKgm: 11.4 },
  { label: "89×6,5", od: 88.9, wall: 6.5, massKgm: 13.2 },
  { label: "102×6,5", od: 101.6, wall: 6.5, massKgm: 15.2 },
  { label: "114×7,0", od: 114.3, wall: 7.0, massKgm: 18.5 },
] as const;

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

/** Вертикальная глубина по MD (линейная интерполяция по точкам траектории с рассчитанной TVD). */
export function tvdAtMD(md: number, traj: TrajectoryPoint[]): number {
  if (!traj.length) return md;
  if (md <= traj[0].md) return traj[0].tvd + (md - traj[0].md);
  for (let i = 1; i < traj.length; i++) {
    if (md <= traj[i].md) {
      const a = traj[i - 1], b = traj[i];
      const t = (md - a.md) / Math.max(1e-6, b.md - a.md);
      return a.tvd + t * (b.tvd - a.tvd);
    }
  }
  // ниже последней точки — по последнему зенитному углу
  const last = traj[traj.length - 1];
  return last.tvd + (md - last.md) * Math.cos((last.zenith * Math.PI) / 180);
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

// ────────── BLOCK 1: packers (паспорт + усилия в НКТ по Lubinski) ──────────

export type PackerType = "mechanical" | "hydraulic" | "hydrostatic" | "permanent" | "retrievable";

/** Свобода перемещения НКТ относительно пакера */
export type TubingPackerConnection = "free" | "anchored";

export interface PackerInput {
  type: PackerType;
  setDepthMD: number;
  /** Внутренний диаметр уплотнительного ствола (полированной втулки) пакера, мм */
  sealBoreID_mm: number;
  /** Паспорт: допустимый перепад давления на пакер, МПа */
  ratingDiffMPa: number;
  /** Паспорт: допустимая осевая нагрузка на пакер (натяжение/сжатие), кН */
  ratingLoadKN: number;
  connection: TubingPackerConnection;
  /** Ход уплотнений (для свободного соединения), мм */
  sealStrokeMM: number;
  // Состояние при посадке (начальное)
  tubingSurfaceMPa0: number;
  annulusSurfaceMPa0: number;
  tubingFluidDensity0: number;
  annulusFluidDensity: number;
  // Рабочее состояние (конечное)
  tubingSurfaceMPa1: number;
  annulusSurfaceMPa1: number;
  tubingFluidDensity1: number;
  /** Среднее изменение температуры НКТ, °C (охлаждение при закачке < 0) */
  avgTempChangeC: number;
}

export interface PackerResult {
  packerTVD: number;
  /** Давление под пакером (в НКТ) и над пакером (в затрубье), МПа: [до, после] */
  pTubingAtPacker: [number, number];
  pAnnulusAtPacker: [number, number];
  /** Перепад на пакер (под − над) в рабочем состоянии, МПа */
  diffPressureMPa: number;
  /** Удлинение НКТ (+) / укорочение (−), мм */
  dLPistonMM: number;
  dLBucklingMM: number;
  dLBallooningMM: number;
  dLTemperatureMM: number;
  dLTotalMM: number;
  /** Эквивалентные силы, кН (+ = растяжение НКТ у пакера) */
  fPistonKN: number;
  fBallooningKN: number;
  fTemperatureKN: number;
  /** Фиктивная сила изгиба Ff = Ap·(Pi − Po), кН; > 0 — НКТ изгибается */
  fictitiousForceKN: number;
  buckled: boolean;
  neutralPointFromPackerM: number;
  /** Для заякоренных НКТ: нагрузка на пакер (+ натяжение, − сжатие), кН */
  packerLoadKN: number;
  isSecure: boolean;
  warnings: string[];
}

const POISSON = 0.3;
const THERMAL_EXP = 1.24e-5; // 1/°C, сталь

/**
 * Изменение длины и усилия НКТ над пакером при переходе от состояния посадки к рабочему
 * (Lubinski, 1962; Hammerlindl): поршневой эффект, продольный изгиб, раздувание, температура.
 */
export function calculatePacker(input: PackerInput, well: WorkoverWellData): PackerResult {
  const L = Math.max(1, Math.min(input.setDepthMD, well.wellDepthMD));
  const H = tvdAtMD(L, well.trajectory);
  const E = well.pipeYoungModulusGPa * 1e9;
  const do_ = well.pipeOD_mm / 1000, di = well.pipeID_mm / 1000;
  const Ao = (Math.PI / 4) * do_ * do_;
  const Ai = (Math.PI / 4) * di * di;
  const As = Math.max(1e-6, Ao - Ai);
  const Ap = (Math.PI / 4) * (input.sealBoreID_mm / 1000) ** 2;
  const R2 = (do_ / di) ** 2;
  const I = (Math.PI / 64) * (do_ ** 4 - di ** 4);
  const r = Math.max(0, (well.casingID_mm - well.pipeOD_mm) / 2000);

  const hydro = (rho: number) => (rho * 1000 * G * H) / 1e6; // МПа
  const Pi0 = input.tubingSurfaceMPa0 + hydro(input.tubingFluidDensity0);
  const Po0 = input.annulusSurfaceMPa0 + hydro(input.annulusFluidDensity);
  const Pi1 = input.tubingSurfaceMPa1 + hydro(input.tubingFluidDensity1);
  const Po1 = input.annulusSurfaceMPa1 + hydro(input.annulusFluidDensity);

  const dPi = (Pi1 - Pi0) * 1e6, dPo = (Po1 - Po0) * 1e6;
  // Среднее по длине изменение давления: устье + половина гидростатики
  const dPia = ((input.tubingSurfaceMPa1 - input.tubingSurfaceMPa0) +
    (hydro(input.tubingFluidDensity1) - hydro(input.tubingFluidDensity0)) / 2) * 1e6;
  const dPoa = (input.annulusSurfaceMPa1 - input.annulusSurfaceMPa0) * 1e6;

  // 1. Поршневой эффект: F1 > 0 — сила вверх на торец НКТ (сжатие)
  const F1 = (Ap - Ai) * dPi - (Ap - Ao) * dPo;
  const dL1 = (-L * F1) / (E * As);

  // 3. Раздувание (ballooning)
  const dL3 = ((-2 * POISSON * L) / E) * (dPia - R2 * dPoa) / (R2 - 1);
  // Эквивалентные силы = сила, которую должен приложить пакер, чтобы не дать НКТ изменить длину
  // (+ = растяжение НКТ у пакера): F = −E·As·ΔL/L
  const F3 = 2 * POISSON * (dPia * Ai - dPoa * Ao);

  // 4. Температура
  const dL4 = L * THERMAL_EXP * input.avgTempChangeC;
  const F4 = -E * As * THERMAL_EXP * input.avgTempChangeC; // при запрете перемещения: охлаждение → растяжение

  // 2. Продольный (спиральный) изгиб под действием давления
  const w = well.pipeWeight_kgm * G + input.tubingFluidDensity1 * 1000 * G * Ai - input.annulusFluidDensity * 1000 * G * Ao; // Н/м
  const bucklingDL = (Pi: number, Po: number) => {
    const Ff = Ap * (Pi - Po) * 1e6;
    if (Ff <= 0 || w <= 0 || r <= 0) return 0;
    const n = Ff / w;
    const base = (r * r * Ff * Ff) / (8 * E * I * w);
    return n <= L ? -base : -base * (L / n) * (2 - L / n);
  };
  const dL2 = bucklingDL(Pi1, Po1) - bucklingDL(Pi0, Po0);
  const Ff1 = Ap * (Pi1 - Po1) * 1e6;

  const dLlinear = dL1 + dL3 + dL4;
  const dLTotal = dLlinear + dL2;
  // Заякоренные НКТ: пакер удерживает длину → нагрузка = E·As·(−ΔL)/L
  const packerLoad = input.connection === "anchored" ? (-E * As * dLlinear) / L / 1000 : 0;

  const diff = Pi1 - Po1;
  const warnings: string[] = [];
  if (Math.abs(diff) > input.ratingDiffMPa)
    warnings.push(`🔴 Перепад на пакер ${diff.toFixed(1)} МПа > паспортного ${input.ratingDiffMPa} МПа.`);
  if (input.connection === "free" && Math.abs(dLTotal) * 1000 > input.sealStrokeMM)
    warnings.push(
      `🔴 Перемещение НКТ ${(dLTotal * 1000).toFixed(0)} мм больше хода уплотнений ${input.sealStrokeMM} мм — ${dLTotal < 0 ? "уплотнения выйдут из ствола пакера" : "упор в пакер"}. Увеличить ход или посадить с разгрузкой.`,
    );
  if (input.connection === "anchored" && Math.abs(packerLoad) > input.ratingLoadKN)
    warnings.push(`🔴 Нагрузка на пакер ${packerLoad.toFixed(0)} кН > паспортной ${input.ratingLoadKN} кН.`);
  if (input.connection === "anchored" && packerLoad < 0)
    warnings.push("⚠ НКТ сжаты на пакере — возможен продольный изгиб над пакером. Проверить разгрузку и центраторы.");
  if (Ff1 > 0 && input.connection === "free")
    warnings.push(`НКТ над пакером в спиральном изгибе на ${Math.min(L, Ff1 / Math.max(w, 1e-6)).toFixed(0)} м (Ff = ${(Ff1 / 1000).toFixed(0)} кН).`);
  if (input.type === "permanent")
    warnings.push("Постоянный пакер — срыв невозможен, только разбуривание/фрезерование.");

  return {
    packerTVD: H,
    pTubingAtPacker: [Pi0, Pi1],
    pAnnulusAtPacker: [Po0, Po1],
    diffPressureMPa: diff,
    dLPistonMM: dL1 * 1000,
    dLBucklingMM: dL2 * 1000,
    dLBallooningMM: dL3 * 1000,
    dLTemperatureMM: dL4 * 1000,
    dLTotalMM: dLTotal * 1000,
    fPistonKN: F1 / 1000,
    fBallooningKN: F3 / 1000,
    fTemperatureKN: F4 / 1000,
    fictitiousForceKN: Ff1 / 1000,
    buckled: Ff1 > 0,
    neutralPointFromPackerM: Ff1 > 0 ? Math.min(L, Ff1 / Math.max(w, 1e-6)) : 0,
    packerLoadKN: packerLoad,
    isSecure: !warnings.some((x) => x.startsWith("🔴")),
    warnings,
  };
}

// ────────── BLOCK 1b: packer RELEASE (full operation) ──────────

export type ReleaseMechanism = "tension" | "rotation" | "pressure_release" | "mill_out";

export interface PackerReleaseInput {
  packerType: PackerType;
  /** Паспорт: усилие срыва (срезные винты/кольцо), кН. Для срыва вращением — 0. */
  releaseShearKN: number;
  /** Дополнительное усилие: отложения, прихват плашек, кН (по опыту на месторождении) */
  extraStuckKN: number;
  pipeWeightAboveKN: number;
  /** Допустимая нагрузка на колонну (резьба, износ, запас), кН */
  pipeTensileLimitKN: number;
  /** Допустимая нагрузка подъёмника, кН */
  rigAllowableKN?: number;
}

export interface PackerReleaseResult {
  releaseForceKN: number;
  breakdown: { shear: number; extra: number };
  totalPullRequiredKN: number;
  pipeTensileLimitKN: number;
  canReleaseByTension: boolean;
  recommendedMechanism: ReleaseMechanism;
  warnings: string[];
}

export function calculatePackerRelease(input: PackerReleaseInput): PackerReleaseResult {
  const releaseForce = Math.max(0, input.releaseShearKN) + Math.max(0, input.extraStuckKN);
  const totalPull = releaseForce + input.pipeWeightAboveKN;
  const limit = Math.min(input.pipeTensileLimitKN, input.rigAllowableKN ?? Infinity);
  const canRelease = totalPull < limit;

  let mechanism: ReleaseMechanism;
  const warnings: string[] = [];
  if (input.packerType === "permanent") {
    mechanism = "mill_out";
    warnings.push("Постоянный пакер — срыв невозможен. Только разбуривание/фрезерование.");
  } else if (!canRelease) {
    mechanism = input.packerType === "mechanical" ? "rotation" : "mill_out";
    const by = totalPull >= input.pipeTensileLimitKN ? `допустимой для колонны ${input.pipeTensileLimitKN.toFixed(0)} кН` : `лимита подъёмника ${input.rigAllowableKN?.toFixed(0)} кН`;
    warnings.push(
      `🔴 Нужно ${totalPull.toFixed(0)} кН на крюке > ${by}. Натяжкой не сорвать — ${mechanism === "rotation" ? "срыв вращением" : "фрезерование"}.`,
    );
  } else if (input.packerType === "mechanical") {
    mechanism = "rotation";
  } else if (input.packerType === "hydraulic" || input.packerType === "hydrostatic") {
    mechanism = "pressure_release";
    warnings.push("Гидравлический пакер: выровнять давление над и под пакером, затем натяжка.");
  } else {
    mechanism = "tension";
  }
  if (input.releaseShearKN <= 0 && input.packerType !== "mechanical" && input.packerType !== "permanent")
    warnings.push("Усилие срыва по паспорту не задано — расчёт неполный.");

  return {
    releaseForceKN: releaseForce,
    breakdown: { shear: Math.max(0, input.releaseShearKN), extra: Math.max(0, input.extraStuckKN) },
    totalPullRequiredKN: totalPull,
    pipeTensileLimitKN: input.pipeTensileLimitKN,
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
  /** "pb" — запас по Правилам безопасности (10% до 1200 м TVD, 5% глубже); "manual" — safetyMarginPct */
  marginMode?: "pb" | "manual";
  /** Реология жидкости, находящейся в скважине (для давления начала циркуляции). По умолчанию = жидкость глушения. */
  currentFluidPV_cP?: number;
  currentFluidYP_Pa?: number;
  /** Опциональный профиль секций для расчёта потерь по интервалам разного диаметра */
  sections?: KillSection[];
}

export interface KillResult {
  /** Применённый запас: % от Pпл и МПа */
  appliedMarginPct: number;
  appliedMarginMPa: number;
  marginRule: string;
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

/**
 * Запас противодавления над пластовым.
 * ПБ НГП (приказ Ростехнадзора № 534): не менее 10% для глубин до 1200 м по вертикали,
 * 5% — глубже. Верхние ограничения 1.5 и 2.5–3.0 МПа приняты по практике прежних ПБ —
 * сверить с действующей редакцией.
 */
export function killMargin(
  formationPressureMPa: number, tvd: number, mode: "pb" | "manual", manualPct: number,
): { mpa: number; rule: string } {
  if (mode === "manual") {
    return { mpa: (formationPressureMPa * manualPct) / 100, rule: `вручную ${manualPct}%` };
  }
  const shallow = tvd <= 1200;
  const pct = shallow ? 10 : 5;
  const cap = shallow ? 1.5 : 3.0;
  const raw = (formationPressureMPa * pct) / 100;
  const mpa = Math.min(raw, cap);
  return {
    mpa,
    rule: `ПБ: ${pct}% (${shallow ? "до" : "глубже"} 1200 м TVD)${raw > cap ? `, ограничено ${cap} МПа` : ""}`,
  };
}

export function calculateKill(input: KillInput): KillResult {
  const tvd = Math.max(1, input.reservoirDepthTVD);
  const md = Math.max(1, input.wellDepthMD);

  const balanceDensity = (input.formationPressureMPa * 1e6) / (G * tvd) / 1000;
  const margin = killMargin(input.formationPressureMPa, tvd, input.marginMode ?? "manual", input.safetyMarginPct);
  const killDensity = ((input.formationPressureMPa + margin.mpa) * 1e6) / (G * tvd) / 1000;
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
    appliedMarginPct: (margin.mpa / Math.max(1e-6, input.formationPressureMPa)) * 100,
    appliedMarginMPa: margin.mpa,
    marginRule: margin.rule,
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
  /** Крутящий момент в сечении при вращении, кН·м */
  torqueKNm: number;
}

export interface DragResult {
  points: DragPoint[];
  /** Нагрузка на крюке (натяжение у устья), кН */
  maxHookLoadKN: number;
  freeWeightKN: number;
  appliedFrictionCoeff: number;
  /** Момент на устье при вращении, кН·м */
  surfaceTorqueKNm: number;
  /** Расхаживание: нагрузка при подъёме и при спуске, кН */
  pickUpKN: number;
  slackOffKN: number;
}

/**
 * Модель «мягкой нити» (Johancsik, 1984), шаг 10 м снизу вверх:
 *   Fn = √[(T·Δφ·sin θ̄)² + (T·Δθ + W·sin θ̄)²],  Δθ = θверх − θниз
 *   на участке набора кривизны натяжение прижимает трубу к верхней стенке и частично
 *   компенсирует вес, на участке спада — складывается с ним.
 *   ΔT = W·cos θ̄ ± μ·Fn;  при вращении ΔT = W·cos θ̄, ΔM = μ·Fn·r.
 */
function tensionProfile(
  op: "pull_out" | "run_in" | "rotate",
  mu: number,
  well: WorkoverWellData,
  bottomLoadKN: number,
): { points: DragPoint[]; freeWeight: number; torque: number } {
  const step = 10;
  const bf = 1 - well.fluidDensity_gcm3 / 7.85;
  const rPipe = well.pipeOD_mm / 2000;
  let tension = bottomLoadKN * 1000;
  let torque = 0;
  let freeWeight = 0;
  const points: DragPoint[] = [];

  for (let md = well.wellDepthMD; md > 0; md -= step) {
    const seg = Math.min(step, md);
    const mdUp = md - seg;
    const zLow = (interpolateZenithDeg(md, well.trajectory) * Math.PI) / 180;
    const zUp = (interpolateZenithDeg(mdUp, well.trajectory) * Math.PI) / 180;
    const aLow = (interpolateAzimuthDeg(md, well.trajectory) * Math.PI) / 180;
    const aUp = (interpolateAzimuthDeg(mdUp, well.trajectory) * Math.PI) / 180;
    const zAvg = (zLow + zUp) / 2;
    const dTheta = zUp - zLow;
    let dPhi = aUp - aLow;
    if (dPhi > Math.PI) dPhi -= 2 * Math.PI;
    if (dPhi < -Math.PI) dPhi += 2 * Math.PI;

    const W = well.pipeWeight_kgm * seg * G * bf;
    const fnSide = tension * dPhi * Math.sin(zAvg);
    const fnPlane = tension * dTheta + W * Math.sin(zAvg);
    const normalForce = Math.sqrt(fnSide * fnSide + fnPlane * fnPlane);
    const axial = W * Math.cos(zAvg);
    const drag = op === "rotate" ? 0 : mu * normalForce;

    freeWeight += axial;
    tension += op === "pull_out" ? axial + drag : op === "run_in" ? axial - drag : axial;
    if (op === "rotate") torque += mu * normalForce * rPipe;

    const cosBeta = Math.cos(zUp - zLow) - Math.sin(zLow) * Math.sin(zUp) * (1 - Math.cos(aUp - aLow));
    const dogleg = Math.acos(Math.max(-1, Math.min(1, cosBeta)));

    points.push({
      md: mdUp,
      hookLoadKN: tension / 1000,
      dragKN: drag / 1000,
      zenithDeg: (zUp * 180) / Math.PI,
      doglegDegPer10m: ((dogleg * 180) / Math.PI) * (10 / seg),
      normalForceN: normalForce,
      torqueKNm: torque / 1000,
    });
  }
  points.reverse();
  return { points, freeWeight, torque };
}

export function calculateDrag(input: DragInput, well: WorkoverWellData): DragResult {
  const mu = input.lubricant ? input.lubricant.lubricatedFrictionCoeff : input.frictionCoeff;
  const bottom = input.bottomLoadKN ?? 0;
  const op = input.operation === "work_pipe" ? "pull_out" : input.operation;
  const main = tensionProfile(op, mu, well, bottom);
  const up = op === "pull_out" ? main : tensionProfile("pull_out", mu, well, bottom);
  const down = tensionProfile("run_in", mu, well, bottom);
  const rot = op === "rotate" ? main : tensionProfile("rotate", mu, well, bottom);
  return {
    points: main.points,
    // Нагрузка на крюке — натяжение у устья (первая точка после разворота: наименьшая MD)
    maxHookLoadKN: main.points[0]?.hookLoadKN ?? 0,
    freeWeightKN: main.freeWeight / 1000,
    appliedFrictionCoeff: mu,
    surfaceTorqueKNm: rot.torque / 1000,
    pickUpKN: up.points[0]?.hookLoadKN ?? 0,
    slackOffKN: down.points[0]?.hookLoadKN ?? 0,
  };
}

/** Предел текучести тела трубы на кручение, кН·м: τт = 0.577·σт, M = τт·J/(D/2). */
export function pipeTorsionalYieldKNm(well: WorkoverWellData): number {
  const do_ = well.pipeOD_mm / 1000, di = well.pipeID_mm / 1000;
  const J = (Math.PI / 32) * (do_ ** 4 - di ** 4);
  return (0.577 * well.pipeYieldMPa * 1e6 * J) / (do_ / 2) / 1000;
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

export interface FreePointResult {
  freePointMD: number;
  freePipeLength: number;
  /** По закону Гука без учёта трения */
  idealFreePointMD: number;
  frictionCorrectionPct: number;
  avgZenithDeg: number;
  /** Рекомендуемая глубина отворота/отрезания: на 1–2 трубы выше точки прихвата */
  backOffMD: number;
  /** Удлинение, которое дала бы вся колонна до забоя при этой натяжке, м */
  maxStretchToBottomM: number;
  belowBottom: boolean;
}

/**
 * Точка прихвата по растяжению с учётом трения: дополнительная натяжка ΔF на устье
 * затухает по глубине из-за трения в искривлённом стволе (модель затяжек).
 * Ищется длина L свободной части, при которой Σ ΔT(s)·ds / (E·A) = ΔL замеренное.
 */
export function calculateFreePoint(input: FreePointInput, well: WorkoverWellData, frictionCoeff = 0.3): FreePointResult {
  const A = pipeCrossArea_m2(well.pipeOD_mm, well.pipeID_mm);
  const E = well.pipeYoungModulusGPa * 1e9;
  const dF = input.pulledForceKN;
  const empty: FreePointResult = {
    freePointMD: 0, freePipeLength: 0, idealFreePointMD: 0, frictionCorrectionPct: 0,
    avgZenithDeg: 0, backOffMD: 0, maxStretchToBottomM: 0, belowBottom: false,
  };
  if (dF <= 0 || input.measuredStretchM <= 0) return empty;
  const ideal = (E * A * input.measuredStretchM) / (dF * 1000);

  const stretchFor = (L: number): number => {
    const w = { ...well, wellDepthMD: L };
    const ref = tensionProfile("rotate", frictionCoeff, w, 0).points;
    const surfaceRef = ref[0]?.hookLoadKN ?? 0;
    // нагрузка у прихвата B, при которой на устье натяжение выросло ровно на ΔF
    let lo = 0, hi = dF;
    let pull = tensionProfile("pull_out", frictionCoeff, w, hi).points;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      const p = tensionProfile("pull_out", frictionCoeff, w, mid).points;
      if ((p[0]?.hookLoadKN ?? 0) - surfaceRef > dF) hi = mid; else lo = mid;
      pull = p;
    }
    let s = 0;
    for (let i = 0; i < pull.length; i++) {
      const seg = i + 1 < pull.length ? pull[i + 1].md - pull[i].md : L - pull[i].md;
      const dT = Math.max(0, (pull[i].hookLoadKN - ref[i].hookLoadKN) * 1000);
      s += (dT * seg) / (E * A);
    }
    return s;
  };

  const maxStretch = stretchFor(well.wellDepthMD);
  let L: number;
  let belowBottom = false;
  if (input.measuredStretchM >= maxStretch) {
    L = well.wellDepthMD;
    belowBottom = true;
  } else {
    let lo = 10, hi = well.wellDepthMD;
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      if (stretchFor(mid) < input.measuredStretchM) lo = mid; else hi = mid;
    }
    L = (lo + hi) / 2;
  }

  return {
    freePointMD: L,
    freePipeLength: L,
    idealFreePointMD: Math.min(ideal, well.wellDepthMD),
    frictionCorrectionPct: (L / Math.max(1e-6, ideal) - 1) * 100,
    avgZenithDeg: averageZenithDeg(well.trajectory, L),
    backOffMD: Math.max(0, L - 15),
    maxStretchToBottomM: maxStretch,
    belowBottom,
  };
}

/** Виды прихвата в КРС */
export type StuckType = "sand" | "deposits" | "packer" | "differential" | "mechanical" | "cement";

export type CirculationState = "free" | "restricted" | "none";
export type StuckOnset = "moving_sudden" | "gradual" | "after_static";

export interface StuckSymptoms {
  canRotate: boolean;
  canMoveDown: boolean;
  canMoveUp: boolean;
  stuckDepthMD: number;
  circulation: CirculationState;
  onset: StuckOnset;
  /** В компоновке есть пакер/якорь */
  packerInString: boolean;
  packerDepthMD?: number;
  /** Пескопроявление / песчаная пробка в скважине */
  sandProduction: boolean;
  /** АСПО, соли, продукты коррозии */
  deposits: boolean;
  /** Недавние цементные/изоляционные работы */
  afterCementing: boolean;
  /** Интервал перфорации, MD */
  perfTopMD?: number;
  perfBottomMD?: number;
  deltaP_MPa?: number;
  contactLenM?: number;
  mudcakeFriction?: number;
}

export interface StuckRankItem {
  type: StuckType;
  score: number;
  probability: number;
  reasons: string[];
}

export interface StuckDiagnosis {
  type: StuckType;
  probability: number;
  ranking: StuckRankItem[];
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

export const STUCK_LABELS: Record<StuckType, string> = {
  sand: "Песчаная пробка",
  deposits: "АСПО / соли / коррозия",
  packer: "Несработавший пакер / якорь",
  differential: "Дифференциальный (у перфорации)",
  mechanical: "Механический (посторонний предмет, смятие колонны)",
  cement: "Цементный",
};

export const STUCK_RECOMMENDATIONS: Record<StuckType, string> = {
  sand: "Восстановить циркуляцию (обратная промывка при возможности), промыть пробку с расхаживанием; при отсутствии циркуляции — ГНКТ/промывка через отдельную колонну. Не превышать допустимую натяжку.",
  deposits: "Горячая промывка (нефть/вода), растворители АСПО или кислотная ванна для солей, затем расхаживание. Подобрать реагент по анализу отложений.",
  packer: "Сорвать пакер по паспортной процедуре (сброс давления, вращение, натяжка на срезные винты). При неудаче — отворот над пакером и фрезерование.",
  differential: "Снизить репрессию (облегчить жидкость/снизить уровень), установить ванну со смазкой с высокой проникающей способностью, расхаживание с вращением.",
  mechanical: "Определить точку прихвата, расхаживание вниз и ясс вниз; печать для обследования головы; фрезерование. Проверить колонну на смятие (шаблонирование/ПГИ).",
  cement: "Разбуривание/фрезерование цемента, отворот выше прихвата; при свежем цементе — немедленная промывка.",
};

/**
 * Экспертная диагностика по признакам (балльная оценка). Признаки и веса открыты в `reasons`.
 */
export function diagnoseStuck(
  well: WorkoverWellData,
  s: StuckSymptoms,
  rigAllowableKN?: number,
  stringLoadKN = 0,
): StuckDiagnosis {
  const items: Record<StuckType, StuckRankItem> = {
    sand: { type: "sand", score: 0, probability: 0, reasons: [] },
    deposits: { type: "deposits", score: 0, probability: 0, reasons: [] },
    packer: { type: "packer", score: 0, probability: 0, reasons: [] },
    differential: { type: "differential", score: 0, probability: 0, reasons: [] },
    mechanical: { type: "mechanical", score: 0, probability: 0, reasons: [] },
    cement: { type: "cement", score: 0, probability: 0, reasons: [] },
  };
  const add = (t: StuckType, pts: number, why: string) => { items[t].score += pts; items[t].reasons.push(`${pts > 0 ? "+" : ""}${pts} ${why}`); };

  const nearPerf = s.perfTopMD !== undefined && s.perfBottomMD !== undefined && s.perfBottomMD > 0 &&
    s.stuckDepthMD >= s.perfTopMD - 20 && s.stuckDepthMD <= s.perfBottomMD + 20;
  const nearPacker = s.packerInString && s.packerDepthMD !== undefined && Math.abs(s.stuckDepthMD - s.packerDepthMD) <= 50;

  // Циркуляция — главный различающий признак
  if (s.circulation === "free") { add("differential", 2, "циркуляция свободная"); add("packer", 1, "циркуляция свободная"); add("mechanical", 1, "циркуляция свободная"); }
  if (s.circulation === "restricted") { add("sand", 3, "циркуляция затруднена"); add("deposits", 2, "циркуляция затруднена"); }
  if (s.circulation === "none") { add("sand", 3, "циркуляции нет"); add("cement", 2, "циркуляции нет"); add("deposits", 1, "циркуляции нет"); }

  if (s.sandProduction) add("sand", 3, "пескопроявление");
  if (s.deposits) add("deposits", 3, "АСПО/соли в скважине");
  if (s.afterCementing) add("cement", 4, "после цементных работ");
  if (s.packerInString) add("packer", 2, "пакер/якорь в компоновке");
  if (nearPacker) add("packer", 3, "прихват на глубине пакера");
  if (nearPerf) add("differential", 3, "прихват напротив перфорации");
  else add("differential", -2, "не у перфорации (в обсаженном стволе маловероятен)");

  if (s.onset === "after_static") { add("differential", 3, "после остановки без движения"); add("sand", 1, "после остановки (осаждение песка)"); }
  if (s.onset === "gradual") { add("deposits", 2, "затяжки нарастали постепенно"); add("sand", 1, "затяжки нарастали постепенно"); }
  if (s.onset === "moving_sudden") { add("mechanical", 3, "резкая посадка при движении"); }

  if (s.canMoveDown && !s.canMoveUp) { add("mechanical", 2, "ходит вниз, не ходит вверх"); add("sand", 1, "ходит вниз (пробка над компоновкой)"); }
  if (!s.canMoveDown && !s.canMoveUp && !s.canRotate) { add("cement", 1, "нет ни хода, ни вращения"); add("differential", 1, "нет ни хода, ни вращения"); }
  if (s.canRotate) { add("differential", -1, "вращается"); add("packer", 1, "вращается"); }

  const list = Object.values(items).map((it) => ({ ...it, score: Math.max(0, it.score) }));
  const total = list.reduce((a, b) => a + b.score, 0) || 1;
  list.forEach((it) => { it.probability = it.score / total; });
  list.sort((a, b) => b.score - a.score);
  const top = list[0];

  let freeingForce = 0;
  if (top.type === "differential" && s.deltaP_MPa && s.contactLenM) {
    freeingForce = differentialSticking(s.deltaP_MPa, s.contactLenM, well.pipeOD_mm, s.mudcakeFriction ?? 0.25);
  }
  const pipeYield = pipeYieldForceKN(well);
  const limit = rigAllowableKN ? Math.min(pipeYield, rigAllowableKN) : pipeYield;
  const requiredHook = stringLoadKN + freeingForce;
  const canFree = freeingForce > 0 && requiredHook < limit;

  return {
    type: top.type,
    probability: top.probability,
    ranking: list,
    freeingForceKN: freeingForce,
    pipeYieldKN: pipeYield,
    rigAllowableKN,
    stringLoadKN,
    requiredHookLoadKN: requiredHook,
    canFreeByPull: canFree,
    recommendation: STUCK_RECOMMENDATIONS[top.type],
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
  /** Температура начала кристаллизации, °C (null — нет данных) */
  crystallizationC: number | null;
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
      dissolveTimeMin: 0, maxAchievableDensity: salt.maxDensity, crystallizationC: null,
      warnings: [`🔴 ${salt.name} даёт максимум ${salt.maxDensity} г/см³. Для ${targetDensity.toFixed(2)} г/см³ нужна другая соль (CaCl₂ до 1.40) или утяжелитель.`],
    };
  }
  if (targetDensity < 1.0) warnings.push("Плотность < 1.0 — достаточно чистой воды без соли.");

  const { wtPct: wtPctClean, tabulated } = brineWtPct(salt, targetDensity);
  const crystallizationC = brineCrystallizationC(salt, wtPctClean);
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
    warnings.push(`Продукт ${salt.purity}% чистоты — расчёт на ${productMassKg.toFixed(0)} кг товарного. Примеси (в основном NaCl) тоже утяжеляют раствор: фактическая плотность будет выше — довести по ареометру.`);
  if (crystallizationC !== null && crystallizationC > -10)
    warnings.push(`❄ Температура начала кристаллизации ≈ ${crystallizationC.toFixed(0)} °C — при морозе ниже этой температуры соль выпадет. Хранить/закачивать с подогревом или выбрать другую концентрацию.`);
  if (!tabulated && salt.densityCoeff_k > 0)
    warnings.push("Плотность рассчитана по линейной зависимости (справочной таблицы для этой соли нет) — точность ±0.01 г/см³, проверить ареометром.");
  if (temperatureC < 10)
    warnings.push(`⚠ Холодная вода (${temperatureC}°C) — растворение в 1.4× дольше. Подогреть для ускорения.`);
  if (salt.form === "granule")
    warnings.push("Гранулы растворяются медленнее порошка — учесть в графике подготовки.");

  return {
    feasible: true, targetDensity, salt, wtPctClean,
    productMassKg, pureSaltKg, waterVolumeL, waterMassKg,
    dissolveTimeMin: dissolveTime, maxAchievableDensity: salt.maxDensity, crystallizationC, warnings,
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
  marginMode: "pb" | "manual" = "manual",
): MultiIntervalKill {
  const withDensity: KillInterval[] = intervals.map((iv) => {
    const tvd = Math.max(1, iv.bottomTVD);
    const m = killMargin(iv.formationPressureMPa, tvd, marginMode, safetyMarginPct);
    return { ...iv, requiredKillDensity: ((iv.formationPressureMPa + m.mpa) * 1e6) / (G * tvd) / 1000 };
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

// ═══════════════════════════════════════════════════════════════════
// 6. Рассолы: справочные таблицы
// ═══════════════════════════════════════════════════════════════════

/**
 * Плотность (отн. плотность при 15.6 °C) и температура начала кристаллизации.
 * CaCl₂: OxyChem / Engineering ToolBox; NaCl: таблица рассолов (60 °F) и свойства водных растворов NaCl.
 */
export const BRINE_TABLES: Record<string, { density: [number, number][]; freezing: [number, number][]; eutecticPct: number; source: string }> = {
  CaCl: {
    density: [[0, 1.0], [10, 1.090], [16, 1.149], [20, 1.189], [24, 1.228], [28, 1.275], [30, 1.298], [32, 1.322], [40, 1.416]],
    freezing: [[0, 0], [10, -6.7], [16, -13.3], [20, -20.0], [24, -28.9], [28, -43.3], [30, -47.0], [32, -8.3], [40, 16.0]],
    eutecticPct: 29.9,
    source: "OxyChem, Engineering ToolBox",
  },
  NaCl: {
    density: [[0, 1.0], [5, 1.037], [10, 1.073], [15, 1.112], [20, 1.151], [23, 1.176], [26, 1.201]],
    freezing: [[0, 0], [5, -3.05], [10, -6.56], [14, -9.94], [16, -11.89], [18, -14.04], [20, -16.46], [23.3, -21.1]],
    eutecticPct: 23.3,
    source: "таблица рассолов при 60 °F; свойства водных растворов NaCl",
  },
};

function interp(table: [number, number][], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return table[table.length - 1][1];
}

function inverseInterp(table: [number, number][], y: number): number {
  for (let i = 1; i < table.length; i++) {
    if (y <= table[i][1]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
    }
  }
  return table[table.length - 1][0];
}

export function brineTableKey(salt: KillSalt): "CaCl" | "NaCl" | null {
  if (salt.formula.startsWith("CaCl")) return "CaCl";
  if (salt.formula === "NaCl") return "NaCl";
  return null;
}

/** Концентрация чистой соли (масс. %) для заданной плотности: по таблице, если она есть, иначе линейно. */
export function brineWtPct(salt: KillSalt, density: number): { wtPct: number; tabulated: boolean } {
  const key = brineTableKey(salt);
  if (key) return { wtPct: Math.max(0, inverseInterp(BRINE_TABLES[key].density, density)), tabulated: true };
  return { wtPct: salt.densityCoeff_k > 0 ? Math.max(0, (density - 1) / salt.densityCoeff_k) : 0, tabulated: false };
}

/** Температура начала кристаллизации, °C (null — нет справочных данных). */
export function brineCrystallizationC(salt: KillSalt, wtPct: number): number | null {
  const key = brineTableKey(salt);
  if (!key) return null;
  const t = BRINE_TABLES[key];
  if (key === "NaCl" && wtPct > t.eutecticPct) return null; // выше эвтектики — кристаллизация соли, данных нет
  return interp(t.freezing, wtPct);
}
