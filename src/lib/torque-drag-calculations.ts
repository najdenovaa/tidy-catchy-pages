/**
 * Torque & Drag calculation engine — Soft-string (Johancsik) model.
 * Computes effective tension, drag, torque, side force, hook load per depth segment.
 */

import { interpolateTVD, type TrajectoryPoint } from "./cementing-calculations";

/* ───── Types ───── */

export interface TDInput {
  trajectory: TrajectoryPoint[];
  wellDepthMD: number;
  casingDepthMD: number;       // глубина спуска колонны
  casingShoe: number;          // башмак предыдущей ОК
  holeDiameter: number;        // мм
  casingOD: number;            // мм
  casingID: number;            // мм
  pipeWeightKgPerM: number;    // вес трубы кг/м
  mudDensity: number;          // г/см³
  frictionCased: number;       // коэфф. трения в ОК (0.15–0.30)
  frictionOpenhole: number;    // коэфф. трения в открытом стволе (0.20–0.40)
  wob: number;                 // вес на долоте, кН (для бурения)
  rpm: number;                 // обороты в минуту (для вращения)
  blockWeight: number;         // вес талевого блока, кН
}

export type TDMode = 'trip_in' | 'trip_out' | 'rotate' | 'drill_rotary' | 'drill_motor';

export interface TDPoint {
  md: number;
  tvd: number;
  zenith: number;
  azimuth: number;
  effectiveTension: number;    // кН
  dragForce: number;           // кН (осевое трение)
  torque: number;              // кН·м
  sideForce: number;           // кН/м (контактная/боковая сила)
  hookLoad: number;            // кН (вес на крюке)
  clearance: number;           // мм (зазор)
}

export interface TDResult {
  mode: TDMode;
  modeLabel: string;
  points: TDPoint[];
  maxHookLoad: number;
  minHookLoad: number;
  maxTorque: number;
  maxSideForce: number;
  freeRotatingWeight: number;  // вес колонны в жидкости (свободно)
}

export interface TDSummary {
  tripIn: TDResult;
  tripOut: TDResult;
  rotate: TDResult;
  freeWeight: number;          // кН
  buoyancyFactor: number;
}

/* ───── Helpers ───── */

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function buoyancyFactor(mudDensityGcm3: number, steelDensityGcm3: number = 7.85): number {
  return 1 - mudDensityGcm3 / steelDensityGcm3;
}

/* ───── Main Calculation ───── */

/**
 * Build trajectory segments from well data. If trajectory has < 2 points, create a vertical well.
 */
function buildSegments(traj: TrajectoryPoint[], wellDepthMD: number): TrajectoryPoint[] {
  if (traj.length >= 2) return traj;
  return [
    { md: 0, azimuth: 0, zenith: 0, tvd: 0 },
    { md: wellDepthMD, azimuth: 0, zenith: 0, tvd: wellDepthMD },
  ];
}

/**
 * Calculate T&D for a single mode.
 * Uses bottom-up accumulation for trip_in/trip_out/rotate,
 * applying the soft-string method.
 */
export function calculateTD(input: TDInput, mode: TDMode): TDResult {
  const traj = buildSegments(input.trajectory, input.wellDepthMD);
  const bf = buoyancyFactor(input.mudDensity);
  const unitWeight = input.pipeWeightKgPerM * 9.81 / 1000; // кН/м (buoyant)
  const buoyantWeight = unitWeight * bf;

  // Build fine-grained depth points (every ~10m or use trajectory points)
  const depthPoints: TrajectoryPoint[] = [];
  const step = 10; // м
  for (let md = 0; md <= input.casingDepthMD; md += step) {
    const tvd = interpolateTVD(md, traj);
    // Interpolate zenith and azimuth
    const zen = interpolateAngle(md, traj, 'zenith');
    const azi = interpolateAngle(md, traj, 'azimuth');
    depthPoints.push({ md, tvd, zenith: zen, azimuth: azi });
  }
  // Ensure last point is exactly at casing depth
  if (depthPoints.length === 0 || depthPoints[depthPoints.length - 1].md < input.casingDepthMD) {
    const md = input.casingDepthMD;
    depthPoints.push({ md, tvd: interpolateTVD(md, traj), zenith: interpolateAngle(md, traj, 'zenith'), azimuth: interpolateAngle(md, traj, 'azimuth') });
  }

  const n = depthPoints.length;
  const results: TDPoint[] = new Array(n);

  // Friction direction: trip_in = -1 (pipe going down, friction opposes), trip_out = +1, rotate = 0
  const frictionSign = mode === 'trip_in' || mode === 'drill_rotary' || mode === 'drill_motor' ? -1 : mode === 'trip_out' ? 1 : 0;
  const isRotating = mode === 'rotate' || mode === 'drill_rotary';

  // Bottom-up accumulation
  let tension = 0; // at bottom = 0 (or WOB for drilling)
  if (mode === 'drill_rotary' || mode === 'drill_motor') {
    tension = -input.wob; // negative = compression at bit
  }

  let cumTorque = 0;

  for (let i = n - 1; i >= 0; i--) {
    const pt = depthPoints[i];
    const mu = pt.md > input.casingShoe ? input.frictionOpenhole : input.frictionCased;
    
    // Clearance
    const boreDiam = pt.md > input.casingShoe ? input.holeDiameter : input.casingID; // simplified
    const clearance = (boreDiam - input.casingOD) / 2;

    if (i < n - 1) {
      const ptNext = depthPoints[i + 1];
      const dMD = ptNext.md - pt.md;
      const dTVD = ptNext.tvd - pt.tvd;

      const incUpper = toRad(pt.zenith);
      const incLower = toRad(ptNext.zenith);
      const aziUpper = toRad(pt.azimuth);
      const aziLower = toRad(ptNext.azimuth);

      const avgInc = (incUpper + incLower) / 2;
      const dInc = incLower - incUpper;
      const dAzi = aziLower - aziUpper;

      // Weight component
      const Wb = buoyantWeight * dMD;

      // Normal force (side force) — Johancsik simplified
      const Fn_inc = tension * dInc + Wb * Math.sin(avgInc);
      const Fn_azi = tension * Math.sin(avgInc) * dAzi;
      const Fn = Math.sqrt(Fn_inc * Fn_inc + Fn_azi * Fn_azi);

      // Drag force
      const drag = mu * Fn;

      if (isRotating) {
        // For rotation: axial tension changes by weight only, torque accumulates friction
        tension += Wb * Math.cos(avgInc);
        cumTorque += mu * Fn * (input.casingOD / 2000); // кН·м
      } else {
        // Trip in/out: friction affects axial load
        tension += Wb * Math.cos(avgInc) + frictionSign * drag;
      }

      results[i] = {
        md: pt.md,
        tvd: pt.tvd,
        zenith: pt.zenith,
        azimuth: pt.azimuth,
        effectiveTension: tension,
        dragForce: drag,
        torque: cumTorque,
        sideForce: dMD > 0 ? Fn / dMD : 0, // кН/м
        hookLoad: tension + input.blockWeight,
        clearance,
      };
    } else {
      // Bottom point
      results[i] = {
        md: pt.md,
        tvd: pt.tvd,
        zenith: pt.zenith,
        azimuth: pt.azimuth,
        effectiveTension: tension,
        dragForce: 0,
        torque: 0,
        sideForce: 0,
        hookLoad: tension + input.blockWeight,
        clearance,
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
  };
}

/**
 * Calculate full T&D summary for trip_in, trip_out, and rotate modes.
 */
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
