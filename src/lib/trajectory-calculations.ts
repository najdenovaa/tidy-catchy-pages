/**
 * Trajectory analysis calculations:
 * - Vertical Section & Plan View coordinates (minimum curvature)
 * - Dog Leg Severity (DLS / пространственная интенсивность)
 * - Build Rate (ИИЗУ — интенсивность изменения зенитного угла)
 * - Turn Rate (интенсивность изменения азимута)
 * - Relative Tortuosity (относительная извилистость)
 * - Geothermal Gradient (температурный профиль)
 */

import type { TrajectoryPoint } from "./cementing-calculations";

// ────────────── Output types ──────────────

export interface TrajectoryCalcPoint {
  md: number;
  tvd: number;
  zenithDeg: number;
  azimuthDeg: number;
  northM: number;        // northing (м)
  eastM: number;         // easting (м)
  vsM: number;           // vertical section displacement (м)
  dlsDegPer30m: number;  // DLS °/30м
  buildRateDegPer30m: number; // ИИЗУ °/30м
  turnRateDegPer30m: number;  // интенсивность изменения азимута °/30м
  tortuosity: number;    // относительная извилистость (MD/TVD ratio - 1) × 100%
  tempStaticC: number;   // статическая температура °C
  tempCircC: number;     // циркуляционная температура °C
}

export interface TrajectoryResults {
  points: TrajectoryCalcPoint[];
  totalNorth: number;
  totalEast: number;
  totalVS: number;
  maxDLS: number;
  avgDLS: number;
  maxBuildRate: number;
  maxTurnRate: number;
  maxTortuosity: number;
  surfaceTempC: number;
  bottomTempStaticC: number;
  bottomTempCircC: number;
}

// ────────────── Helpers ──────────────

function degToRad(d: number): number { return d * Math.PI / 180; }

/**
 * Dog Leg Severity using the minimum curvature formula.
 * Returns DLS in degrees per 30m.
 */
function calcDLS(
  inc1: number, azi1: number, inc2: number, azi2: number, dMD: number
): number {
  if (dMD <= 0) return 0;
  const i1 = degToRad(inc1);
  const i2 = degToRad(inc2);
  const a1 = degToRad(azi1);
  const a2 = degToRad(azi2);

  let cosAlpha = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
  cosAlpha = Math.max(-1, Math.min(1, cosAlpha));
  const alpha = Math.acos(cosAlpha);
  return (alpha * 180 / Math.PI) * (30 / dMD);
}

/**
 * Minimum curvature ratio factor.
 */
function rfFactor(alpha: number): number {
  if (Math.abs(alpha) < 1e-7) return 1;
  return (2 / alpha) * Math.tan(alpha / 2);
}

// ────────────── Main calculation ──────────────

export function calculateTrajectory(
  trajectory: TrajectoryPoint[],
  surfaceTempC: number,
  bottomTempStaticC: number,
  bottomTempCircC: number,
  vsAzimuthDeg: number = 0 // direction of vertical section
): TrajectoryResults {
  if (!trajectory || trajectory.length < 2) {
    return {
      points: [], totalNorth: 0, totalEast: 0, totalVS: 0,
      maxDLS: 0, avgDLS: 0, maxBuildRate: 0, maxTurnRate: 0, maxTortuosity: 0,
      surfaceTempC, bottomTempStaticC, bottomTempCircC,
    };
  }

  const sorted = [...trajectory].sort((a, b) => a.md - b.md);
  const totalMD = sorted[sorted.length - 1].md;
  const totalTVD = sorted[sorted.length - 1].tvd;

  // Temperature gradients (linear)
  const gradStatic = totalMD > 0 ? (bottomTempStaticC - surfaceTempC) / totalMD : 0;
  const gradCirc = totalMD > 0 ? (bottomTempCircC - surfaceTempC) / totalMD : 0;

  const vsAziRad = degToRad(vsAzimuthDeg);

  const points: TrajectoryCalcPoint[] = [];
  let north = 0, east = 0;
  let sumDLS = 0;
  let maxDLS = 0, maxBuild = 0, maxTurn = 0, maxTort = 0;
  let dlsCount = 0;

  // First point
  points.push({
    md: sorted[0].md,
    tvd: sorted[0].tvd,
    zenithDeg: sorted[0].zenith,
    azimuthDeg: sorted[0].azimuth,
    northM: 0,
    eastM: 0,
    vsM: 0,
    dlsDegPer30m: 0,
    buildRateDegPer30m: 0,
    turnRateDegPer30m: 0,
    tortuosity: 0,
    tempStaticC: surfaceTempC + gradStatic * sorted[0].md,
    tempCircC: surfaceTempC + gradCirc * sorted[0].md,
  });

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const dMD = curr.md - prev.md;

    if (dMD <= 0) continue;

    // DLS
    const dls = calcDLS(prev.zenith, prev.azimuth, curr.zenith, curr.azimuth, dMD);
    maxDLS = Math.max(maxDLS, dls);
    sumDLS += dls;
    dlsCount++;

    // Build rate (ИИЗУ)
    const buildRate = Math.abs(curr.zenith - prev.zenith) * (30 / dMD);
    maxBuild = Math.max(maxBuild, buildRate);

    // Turn rate
    let dAzi = curr.azimuth - prev.azimuth;
    // Normalize to -180..180
    while (dAzi > 180) dAzi -= 360;
    while (dAzi < -180) dAzi += 360;
    const turnRate = Math.abs(dAzi) * (30 / dMD);
    maxTurn = Math.max(maxTurn, turnRate);

    // Minimum curvature N/E increments
    const i1 = degToRad(prev.zenith);
    const i2 = degToRad(curr.zenith);
    const a1 = degToRad(prev.azimuth);
    const a2 = degToRad(curr.azimuth);

    let cosAlpha = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
    cosAlpha = Math.max(-1, Math.min(1, cosAlpha));
    const alpha = Math.acos(cosAlpha);
    const rf = rfFactor(alpha);

    const dN = (dMD / 2) * (Math.sin(i1) * Math.cos(a1) + Math.sin(i2) * Math.cos(a2)) * rf;
    const dE = (dMD / 2) * (Math.sin(i1) * Math.sin(a1) + Math.sin(i2) * Math.sin(a2)) * rf;

    north += dN;
    east += dE;

    // Vertical section: projection of horizontal displacement onto VS azimuth direction
    const vs = north * Math.cos(vsAziRad) + east * Math.sin(vsAziRad);

    // Tortuosity: (ΔMD / ΔTVD - 1) as percentage
    const dTVD = curr.tvd - prev.tvd;
    const tort = dTVD > 0 ? ((dMD / dTVD) - 1) * 100 : 0;
    maxTort = Math.max(maxTort, tort);

    points.push({
      md: curr.md,
      tvd: curr.tvd,
      zenithDeg: curr.zenith,
      azimuthDeg: curr.azimuth,
      northM: north,
      eastM: east,
      vsM: vs,
      dlsDegPer30m: dls,
      buildRateDegPer30m: buildRate,
      turnRateDegPer30m: turnRate,
      tortuosity: tort,
      tempStaticC: surfaceTempC + gradStatic * curr.md,
      tempCircC: surfaceTempC + gradCirc * curr.md,
    });
  }

  return {
    points,
    totalNorth: north,
    totalEast: east,
    totalVS: points.length > 0 ? points[points.length - 1].vsM : 0,
    maxDLS,
    avgDLS: dlsCount > 0 ? sumDLS / dlsCount : 0,
    maxBuildRate: maxBuild,
    maxTurnRate: maxTurn,
    maxTortuosity: maxTort,
    surfaceTempC,
    bottomTempStaticC,
    bottomTempCircC,
  };
}
