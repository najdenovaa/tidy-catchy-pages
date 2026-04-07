/**
 * Drilling Hydraulics calculation engine.
 * ECD, pressure losses, flow regime, cuttings bed, annular velocity,
 * bit hydraulics, temperature profile.
 */

import { interpolateTVD, type TrajectoryPoint, type Rheology, effectiveRheology } from "./cementing-calculations";

/* ───── Types ───── */

export interface DrillingHydraulicsInput {
  trajectory: TrajectoryPoint[];
  wellDepthMD: number;
  wellDepthTVD: number;
  holeDiameter: number;       // мм
  casingOD: number;           // мм — бурильная колонна (drill pipe OD)
  casingID: number;           // мм — drill pipe ID
  prevCasingDepth: number;    // башмак обсадной колонны, м
  prevCasingID: number;       // мм — ID обсадной колонны
  mudDensity: number;         // кг/м³
  mudRheology: Rheology;
  flowRate: number;           // л/с
  rop: number;                // скорость проходки м/ч
  cuttingsDensity: number;    // кг/м³ шлама (по умолчанию 2650)
  nozzles: number[];          // диаметры насадок долота, мм
  surfaceTemp: number;        // температура на устье, °C
  bottomTemp: number;         // BHST, °C
  dpWeight: number;           // вес бурильной трубы кг/м
  dcLength: number;           // длина УБТ, м
  dcOD: number;               // OD УБТ, мм
  dcID: number;               // ID УБТ, мм
  dcWeight: number;           // вес УБТ кг/м
}

export interface HydraulicsDepthPoint {
  md: number;
  tvd: number;
  annVelocity: number;        // м/с — скорость в затрубье
  pipeVelocity: number;       // м/с — скорость в трубе
  reynoldsPipe: number;
  reynoldsAnn: number;
  flowRegimePipe: string;
  flowRegimeAnn: string;
  pressureLossPipe: number;   // МПа — накопленные потери в трубе до этой точки
  pressureLossAnn: number;    // МПа — накопленные потери в затрубье
  ecd: number;                // кг/м³ — ECD
  cuttingsBedHeight: number;  // мм — высота шламовой подушки (для наклонных)
  temperature: number;        // °C — температура на этой глубине
  zenith: number;
}

export interface BitHydraulics {
  totalFlowArea: number;      // мм²
  nozzleVelocity: number;     // м/с
  bitPressureLoss: number;    // МПа
  impactForce: number;        // кН
  hydraulicPower: number;     // кВт
  specificHydPower: number;   // кВт/см² (HSI)
}

export interface DrillingHydraulicsResult {
  depthPoints: HydraulicsDepthPoint[];
  bitHydraulics: BitHydraulics;
  totalPressureLoss: number;  // МПа — суммарные потери
  surfacePressure: number;    // МПа — давление на стояке
  ecdAtTD: number;            // кг/м³
  criticalFlowRate: number;   // л/с — критическая производительность
  minFlowRate: number;        // л/с — мин. расход для выноса шлама
  annVelocityAtTD: number;    // м/с
}

/* ───── Helpers ───── */

const G = 9.81;

function flowRegimeLabel(re: number): string {
  if (re < 2100) return "Ламинарный";
  if (re < 3000) return "Переходный";
  return "Турбулентный";
}

function interpolateAngle(md: number, traj: TrajectoryPoint[], field: 'zenith' | 'azimuth'): number {
  if (traj.length === 0) return 0;
  if (md <= traj[0].md) return traj[0][field];
  if (md >= traj[traj.length - 1].md) return traj[traj.length - 1][field];
  for (let i = 0; i < traj.length - 1; i++) {
    if (md >= traj[i].md && md <= traj[i + 1].md) {
      const f = (md - traj[i].md) / (traj[i + 1].md - traj[i].md);
      return traj[i][field] + f * (traj[i + 1][field] - traj[i][field]);
    }
  }
  return traj[traj.length - 1][field];
}

function buildTraj(traj: TrajectoryPoint[], md: number): TrajectoryPoint[] {
  if (traj.length >= 2) return traj;
  return [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md, azimuth: 0, zenith: 0, tvd: md }];
}

/* ───── Bingham Plastic friction ───── */

function binghamFrictionPipe(
  flowRateM3s: number, id_mm: number, length_m: number, rho: number, pv: number, yp: number
): { dp: number; re: number; vel: number } {
  const d = id_mm / 1000;
  const a = Math.PI * (d / 2) ** 2;
  const vel = flowRateM3s / a;
  // Reynolds for Bingham
  const re = rho * vel * d / ((pv / 1000) + (yp * d) / (6 * vel + 1e-9));
  // Friction pressure loss
  let dp: number;
  if (re < 2100) {
    // Laminar: dp = (32 * pv * vel * L) / (d^2 * 1000) + (16 * yp * L) / (3 * d)
    dp = (32 * (pv / 1000) * vel * length_m) / (d * d) + (16 * yp * length_m) / (3 * d);
  } else {
    // Turbulent: Fanning friction
    const f = 0.0791 / Math.pow(Math.max(re, 100), 0.25);
    dp = f * 2 * rho * vel * vel * length_m / d;
  }
  return { dp: dp / 1e6, re, vel }; // МПа
}

function binghamFrictionAnn(
  flowRateM3s: number, od_mm: number, hole_mm: number, length_m: number, rho: number, pv: number, yp: number
): { dp: number; re: number; vel: number } {
  const dh = hole_mm / 1000;
  const dp_m = od_mm / 1000;
  const gap = dh - dp_m;
  const a = Math.PI / 4 * (dh * dh - dp_m * dp_m);
  const vel = flowRateM3s / a;
  const dHyd = gap; // hydraulic diameter for annulus ≈ (dh - dp)
  const re = rho * vel * dHyd / ((pv / 1000) + (yp * dHyd) / (6 * vel + 1e-9));
  let dpLoss: number;
  if (re < 2100) {
    dpLoss = (48 * (pv / 1000) * vel * length_m) / (gap * gap) + (6 * yp * length_m) / gap;
  } else {
    const f = 0.0791 / Math.pow(Math.max(re, 100), 0.25);
    dpLoss = f * 2 * rho * vel * vel * length_m / dHyd;
  }
  return { dp: dpLoss / 1e6, re, vel };
}

/* ───── Main Calculation ───── */

export function calculateDrillingHydraulics(input: DrillingHydraulicsInput): DrillingHydraulicsResult {
  const traj = buildTraj(input.trajectory, input.wellDepthMD);
  const rh = effectiveRheology(input.mudRheology, 'mud');
  const rho = input.mudDensity; // кг/м³
  const Q = input.flowRate / 1000; // м³/с
  const step = 50; // м

  const depthPoints: HydraulicsDepthPoint[] = [];
  let cumPipeLoss = 0;
  let cumAnnLoss = 0;

  // Drill collar starts at (wellDepthMD - dcLength) to wellDepthMD
  const dcTop = Math.max(0, input.wellDepthMD - input.dcLength);

  for (let md = 0; md <= input.wellDepthMD; md += step) {
    const tvd = interpolateTVD(md, traj);
    const zen = interpolateAngle(md, traj, 'zenith');
    const segLen = md === 0 ? 0 : step;

    // Determine if in DC or DP section
    const inDC = md >= dcTop;
    const pipeID = inDC ? input.dcID : input.casingID;
    const pipeOD = inDC ? input.dcOD : input.casingOD;

    // Annulus bore: in casing or open hole
    const boreDiam = md < input.prevCasingDepth ? input.prevCasingID : input.holeDiameter;

    // Pipe friction
    const pf = binghamFrictionPipe(Q, pipeID, segLen, rho, rh.pv, rh.yp);
    cumPipeLoss += pf.dp;

    // Annular friction
    const af = binghamFrictionAnn(Q, pipeOD, boreDiam, segLen, rho, rh.pv, rh.yp);
    cumAnnLoss += af.dp;

    // ECD = mud density + (annular friction pressure / (0.00981 * TVD))
    const ecd = tvd > 0 ? rho + (cumAnnLoss * 1e6) / (G * tvd) : rho;

    // Temperature (linear gradient)
    const temp = input.surfaceTemp + (input.bottomTemp - input.surfaceTemp) * (tvd / Math.max(input.wellDepthTVD, 1));

    // Cuttings bed height (simplified — increases with zenith angle)
    const zenRad = (zen * Math.PI) / 180;
    // Transport ratio decreases with angle; critical for 30-60°
    const transportRatio = Math.max(0.1, 1 - 0.8 * Math.sin(zenRad));
    const cuttingsConc = input.rop > 0 ? (1 - transportRatio) * 0.04 * (input.rop / 20) : 0;
    const annGap = (boreDiam - pipeOD) / 2;
    const bedHeight = cuttingsConc * annGap; // мм

    depthPoints.push({
      md, tvd,
      annVelocity: af.vel,
      pipeVelocity: pf.vel,
      reynoldsPipe: pf.re,
      reynoldsAnn: af.re,
      flowRegimePipe: flowRegimeLabel(pf.re),
      flowRegimeAnn: flowRegimeLabel(af.re),
      pressureLossPipe: cumPipeLoss,
      pressureLossAnn: cumAnnLoss,
      ecd,
      cuttingsBedHeight: bedHeight,
      temperature: temp,
      zenith: zen,
    });
  }

  // Ensure last point at TD
  if (depthPoints.length === 0 || depthPoints[depthPoints.length - 1].md < input.wellDepthMD) {
    const md = input.wellDepthMD;
    const tvd = interpolateTVD(md, traj);
    const lastPt = depthPoints[depthPoints.length - 1];
    depthPoints.push({
      ...lastPt, md, tvd,
    });
  }

  // Bit hydraulics
  const totalNozzleArea = input.nozzles.reduce((s, d) => s + Math.PI * (d / 2) ** 2, 0); // мм²
  const tfa_m2 = totalNozzleArea / 1e6;
  const nozzleVel = tfa_m2 > 0 ? Q / tfa_m2 : 0;
  const bitDp = tfa_m2 > 0 ? (rho * Q * Q) / (2 * 0.95 * 0.95 * tfa_m2 * tfa_m2) / 1e6 : 0; // МПа
  const impactForce = tfa_m2 > 0 ? 0.95 * rho * Q * nozzleVel / 1000 : 0; // кН  
  const hydPower = Q * bitDp * 1e6 / 1000; // кВт
  const bitAreaCm2 = Math.PI * (input.holeDiameter / 20) ** 2; // cm²
  const hsi = bitAreaCm2 > 0 ? hydPower / bitAreaCm2 : 0;

  const bitHydraulics: BitHydraulics = {
    totalFlowArea: totalNozzleArea,
    nozzleVelocity: nozzleVel,
    bitPressureLoss: bitDp,
    impactForce,
    hydraulicPower: hydPower,
    specificHydPower: hsi,
  };

  const totalLoss = cumPipeLoss + cumAnnLoss + bitDp;
  const surfacePressure = totalLoss;

  // Critical flow rate (turbulent onset in annulus at TD)
  const tdPt = depthPoints[depthPoints.length - 1];
  const boreTD = input.wellDepthMD < input.prevCasingDepth ? input.prevCasingID : input.holeDiameter;
  const pipeODTD = input.wellDepthMD >= dcTop ? input.dcOD : input.casingOD;
  const gapTD = (boreTD - pipeODTD) / 1000;
  const critQ = gapTD > 0 ? (2100 * (rh.pv / 1000 + rh.yp * gapTD / 6)) / (rho * gapTD) * Math.PI / 4 * ((boreTD / 1000) ** 2 - (pipeODTD / 1000) ** 2) : 0;

  // Min flow rate for cuttings transport (annular velocity > 0.5 m/s)
  const annArea = Math.PI / 4 * ((boreTD / 1000) ** 2 - (pipeODTD / 1000) ** 2);
  const minQ = 0.5 * annArea * 1000; // л/с

  return {
    depthPoints,
    bitHydraulics,
    totalPressureLoss: totalLoss,
    surfacePressure,
    ecdAtTD: tdPt?.ecd ?? rho,
    criticalFlowRate: Math.abs(critQ) * 1000,
    minFlowRate: minQ,
    annVelocityAtTD: tdPt?.annVelocity ?? 0,
  };
}
