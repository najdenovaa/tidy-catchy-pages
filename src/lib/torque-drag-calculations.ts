/**
 * Torque & Drag calculation engine — Soft-string (Johancsik) model.
 * Extended: BHA modes, motor drilling, back-reaming, fatigue, friction calibration, pick-up/slack-off.
 */

import { interpolateTVD, type TrajectoryPoint } from "./cementing-calculations";

/* ───── Types ───── */

export interface TDInput {
  trajectory: TrajectoryPoint[];
  wellDepthMD: number;
  casingDepthMD: number;
  casingShoe: number;
  holeDiameter: number;        // мм
  casingOD: number;            // мм
  casingID: number;            // мм
  pipeWeightKgPerM: number;
  mudDensity: number;          // г/см³
  frictionCased: number;
  frictionOpenhole: number;
  wob: number;                 // кН
  rpm: number;
  blockWeight: number;         // кН
  // Extended params
  yieldStrength?: number;      // предел текучести трубы, МПа
  pipeOD_mm?: number;          // OD трубы (если отличается от casingOD)
  dcLength?: number;           // длина УБТ, м
  dcOD?: number;               // мм
  dcWeight?: number;           // кг/м
  motorBendAngle?: number;     // угол перекоса ГЗД, °
  backReamSpeed?: number;      // скорость обратной проработки, м/мин
}

export type TDMode = 'trip_in' | 'trip_out' | 'rotate' | 'drill_rotary' | 'drill_motor' | 'back_ream' | 'pickup' | 'slackoff';

export interface TDPoint {
  md: number;
  tvd: number;
  zenith: number;
  azimuth: number;
  effectiveTension: number;    // кН
  dragForce: number;           // кН
  torque: number;              // кН·м
  sideForce: number;           // кН/м
  hookLoad: number;            // кН
  clearance: number;           // мм
  fatigueDamage?: number;      // accumulated fatigue ratio (0–1)
  vonMises?: number;           // Von Mises stress, МПа
}

export interface TDResult {
  mode: TDMode;
  modeLabel: string;
  points: TDPoint[];
  maxHookLoad: number;
  minHookLoad: number;
  maxTorque: number;
  maxSideForce: number;
  freeRotatingWeight: number;
  maxFatigueDamage?: number;
  maxVonMises?: number;
}

export interface TDSummary {
  tripIn: TDResult;
  tripOut: TDResult;
  rotate: TDResult;
  freeWeight: number;
  buoyancyFactor: number;
}

/* ───── Helpers ───── */

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function buoyancyFactor(mudDensityGcm3: number, steelDensityGcm3: number = 7.85): number {
  return 1 - mudDensityGcm3 / steelDensityGcm3;
}

/** Dogleg severity between two survey points, °/30m */
function calcDLS(zen1: number, azi1: number, zen2: number, azi2: number, dMD: number): number {
  if (dMD <= 0) return 0;
  const i1 = toRad(zen1), i2 = toRad(zen2);
  const a1 = toRad(azi1), a2 = toRad(azi2);
  const cosD = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
  const dl = Math.acos(Math.min(1, Math.max(-1, cosD)));
  return (dl * 180 / Math.PI) * (30 / dMD);
}

/** Fatigue damage per cycle from bending stress (Lubinski/Hansford simplified) */
function fatigueDamagePerCycle(bendingStress: number, yieldStrength: number): number {
  // S-N curve approximation: cycles = (yield / stress)^4 * 1e6
  if (bendingStress <= 0 || yieldStrength <= 0) return 0;
  const ratio = yieldStrength / bendingStress;
  if (ratio > 10) return 0; // negligible
  const nCycles = Math.pow(ratio, 4) * 1e6;
  return 1 / nCycles; // damage per single rotation cycle
}

/* ───── Main Calculation ───── */

function buildSegments(traj: TrajectoryPoint[], wellDepthMD: number): TrajectoryPoint[] {
  if (traj.length >= 2) return traj;
  return [
    { md: 0, azimuth: 0, zenith: 0, tvd: 0 },
    { md: wellDepthMD, azimuth: 0, zenith: 0, tvd: wellDepthMD },
  ];
}

export function calculateTD(input: TDInput, mode: TDMode): TDResult {
  const traj = buildSegments(input.trajectory, input.wellDepthMD);
  const bf = buoyancyFactor(input.mudDensity);
  const unitWeight = input.pipeWeightKgPerM * 9.81 / 1000;
  const buoyantWeight = unitWeight * bf;

  const depthPoints: TrajectoryPoint[] = [];
  const step = 10;
  for (let md = 0; md <= input.casingDepthMD; md += step) {
    const tvd = interpolateTVD(md, traj);
    const zen = interpolateAngle(md, traj, 'zenith');
    const azi = interpolateAngle(md, traj, 'azimuth');
    depthPoints.push({ md, tvd, zenith: zen, azimuth: azi });
  }
  if (depthPoints.length === 0 || depthPoints[depthPoints.length - 1].md < input.casingDepthMD) {
    const md = input.casingDepthMD;
    depthPoints.push({ md, tvd: interpolateTVD(md, traj), zenith: interpolateAngle(md, traj, 'zenith'), azimuth: interpolateAngle(md, traj, 'azimuth') });
  }

  const n = depthPoints.length;
  const results: TDPoint[] = new Array(n);

  // Direction mapping
  const frictionSign = (mode === 'trip_in' || mode === 'drill_rotary' || mode === 'drill_motor' || mode === 'slackoff') ? -1
    : (mode === 'trip_out' || mode === 'back_ream' || mode === 'pickup') ? 1
    : 0;
  const isRotating = mode === 'rotate' || mode === 'drill_rotary' || mode === 'drill_motor' || mode === 'back_ream';

  let tension = 0;
  if (mode === 'drill_rotary' || mode === 'drill_motor') {
    tension = -input.wob;
  }

  let cumTorque = 0;
  let cumFatigue = 0;
  const yieldStr = input.yieldStrength ?? 550; // default L80
  const pipeOD = input.pipeOD_mm ?? input.casingOD;

  // DC section
  const dcTop = input.dcLength ? Math.max(0, input.casingDepthMD - input.dcLength) : input.casingDepthMD;
  const dcWeight = input.dcWeight ? input.dcWeight * 9.81 / 1000 * bf : buoyantWeight;
  const dcOD = input.dcOD ?? pipeOD;

  for (let i = n - 1; i >= 0; i--) {
    const pt = depthPoints[i];
    const mu = pt.md > input.casingShoe ? input.frictionOpenhole : input.frictionCased;
    const boreDiam = pt.md > input.casingShoe ? input.holeDiameter : input.casingID;

    // Use DC or DP weight
    const inDC = pt.md >= dcTop && input.dcLength && input.dcLength > 0;
    const segWeight = inDC ? dcWeight : buoyantWeight;
    const segOD = inDC ? dcOD : pipeOD;
    const clearance = (boreDiam - segOD) / 2;

    if (i < n - 1) {
      const ptNext = depthPoints[i + 1];
      const dMD = ptNext.md - pt.md;

      const incUpper = toRad(pt.zenith);
      const incLower = toRad(ptNext.zenith);
      const aziUpper = toRad(pt.azimuth);
      const aziLower = toRad(ptNext.azimuth);
      const avgInc = (incUpper + incLower) / 2;
      const dInc = incLower - incUpper;
      const dAzi = aziLower - aziUpper;

      const Wb = segWeight * dMD;
      const Fn_inc = tension * dInc + Wb * Math.sin(avgInc);
      const Fn_azi = tension * Math.sin(avgInc) * dAzi;
      const Fn = Math.sqrt(Fn_inc * Fn_inc + Fn_azi * Fn_azi);
      const drag = mu * Fn;

      // Motor drilling — add motor bend side force
      let motorSF = 0;
      if (mode === 'drill_motor' && input.motorBendAngle && input.motorBendAngle > 0) {
        motorSF = input.wob * Math.sin(toRad(input.motorBendAngle)) * 0.1; // simplified
      }

      if (isRotating) {
        tension += Wb * Math.cos(avgInc);
        cumTorque += mu * (Fn + motorSF) * (segOD / 2000);
      } else {
        tension += Wb * Math.cos(avgInc) + frictionSign * drag;
      }

      // DLS-based fatigue
      const dls = calcDLS(pt.zenith, pt.azimuth, ptNext.zenith, ptNext.azimuth, dMD);
      const bendingStress = dls > 0 ? (segOD / 2000) * 210e3 * (dls * Math.PI / 180) / (30) : 0; // МПа
      const dmg = isRotating && input.rpm > 0 ? fatigueDamagePerCycle(bendingStress, yieldStr) * input.rpm * (dMD / (input.rpm * 0.1 + 1)) : 0;
      cumFatigue += dmg;

      // Von Mises stress
      const axialStress = Math.abs(tension) / (Math.PI * ((segOD / 2000) ** 2 - ((segOD - 2 * (input.casingOD > 0 ? (input.casingOD - input.casingID) / 2 : 10)) / 2000) ** 2));
      const shearStress = cumTorque > 0 ? cumTorque / (Math.PI / 16 * (segOD / 1000) ** 3) : 0;
      const vonMises = Math.sqrt(axialStress ** 2 + 3 * shearStress ** 2) / 1e3; // МПа approx

      results[i] = {
        md: pt.md, tvd: pt.tvd, zenith: pt.zenith, azimuth: pt.azimuth,
        effectiveTension: tension,
        dragForce: drag,
        torque: cumTorque,
        sideForce: dMD > 0 ? Fn / dMD : 0,
        hookLoad: tension + input.blockWeight,
        clearance,
        fatigueDamage: cumFatigue,
        vonMises: Math.abs(vonMises),
      };
    } else {
      results[i] = {
        md: pt.md, tvd: pt.tvd, zenith: pt.zenith, azimuth: pt.azimuth,
        effectiveTension: tension,
        dragForce: 0, torque: 0, sideForce: 0,
        hookLoad: tension + input.blockWeight,
        clearance,
        fatigueDamage: 0, vonMises: 0,
      };
    }
  }

  const hookLoads = results.map(p => p.hookLoad);
  const torques = results.map(p => p.torque);
  const sideForces = results.map(p => p.sideForce);

  const modeLabels: Record<TDMode, string> = {
    trip_in: 'Спуск колонны',
    trip_out: 'Подъём колонны',
    rotate: 'Вращение',
    drill_rotary: 'Бурение ротором',
    drill_motor: 'Бурение ГЗД',
    back_ream: 'Обратная проработка',
    pickup: 'Затяжка (Pick-up)',
    slackoff: 'Разгрузка (Slack-off)',
  };

  return {
    mode,
    modeLabel: modeLabels[mode],
    points: results,
    maxHookLoad: Math.max(...hookLoads),
    minHookLoad: Math.min(...hookLoads),
    maxTorque: Math.max(...torques),
    maxSideForce: Math.max(...sideForces),
    freeRotatingWeight: buoyantWeight * input.casingDepthMD + input.blockWeight,
    maxFatigueDamage: Math.max(...results.map(p => p.fatigueDamage ?? 0)),
    maxVonMises: Math.max(...results.map(p => p.vonMises ?? 0)),
  };
}

export function calculateTDSummary(input: TDInput): TDSummary {
  const tripIn = calculateTD(input, 'trip_in');
  const tripOut = calculateTD(input, 'trip_out');
  const rotate = calculateTD(input, 'rotate');
  const bf = buoyancyFactor(input.mudDensity);
  const freeWeight = input.pipeWeightKgPerM * 9.81 / 1000 * bf * input.casingDepthMD + input.blockWeight;
  return { tripIn, tripOut, rotate, freeWeight, buoyancyFactor: bf };
}

/* ───── Angle interpolation ───── */

function interpolateAngle(md: number, traj: TrajectoryPoint[], field: 'zenith' | 'azimuth'): number {
  if (traj.length === 0) return 0;
  if (md <= traj[0].md) return traj[0][field];
  if (md >= traj[traj.length - 1].md) return traj[traj.length - 1][field];
  for (let i = 0; i < traj.length - 1; i++) {
    if (md >= traj[i].md && md <= traj[i + 1].md) {
      const frac = (md - traj[i].md) / (traj[i + 1].md - traj[i].md);
      return traj[i][field] + frac * (traj[i + 1][field] - traj[i][field]);
    }
  }
  return traj[traj.length - 1][field];
}
