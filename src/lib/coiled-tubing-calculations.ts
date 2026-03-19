/**
 * Coiled Tubing (ГНКТ) Engineering Calculations
 * Based on CoilCADE methodology (Schlumberger)
 * Modules: Tubing Forces, CoilLIMIT, Hydraulics, CoilLIFE
 * 
 * All depth-dependent pressures use TVD (True Vertical Depth).
 * Trajectory: MD / Azimuth / Zenith / TVD (same as Cementing & Cement Plug modules).
 */

import { calculateTVDFromSurvey, interpolateTVD, type TrajectoryPoint } from "./cementing-calculations";

export type { TrajectoryPoint };
export { calculateTVDFromSurvey, interpolateTVD };

// ─── Data Types ───

export interface CTStringData {
  od: number;          // Outer diameter, mm
  wall: number;        // Wall thickness, mm
  grade: string;       // Steel grade: CT-70, CT-80, CT-90, CT-110
  length: number;      // String length on reel, m
  ovality: number;     // Ovality %, 0-10
}

export interface WellGeometry {
  md: number;          // Measured depth, m
  tvd: number;         // True vertical depth, m (auto-calculated from trajectory)
  casingID: number;    // Casing inner diameter, mm
  tubingID: number;    // Tubing inner diameter (if inside tubing), mm — 0 if open hole / casing
  wellheadPressure: number; // Wellhead pressure, MPa
  bhst: number;        // Bottom hole static temperature, °C
  bhct: number;        // Bottom hole circulating temperature, °C
  whTemp: number;      // Wellhead temperature, °C
  fracGradient: number; // Frac gradient, MPa/m
  trajectory: TrajectoryPoint[];
}

export interface FluidData {
  name: string;
  density: number;     // g/cm³
  pv: number;          // Plastic viscosity, cP
  yp: number;          // Yield point, Pa
  nIndex: number;      // Power-law n
  kIndex: number;      // Power-law K, Pa·s^n
}

export interface PumpData {
  flowRate: number;    // l/min
  surfacePressure: number; // MPa (calculated)
}

export interface ToolsData {
  bhaWeight: number;   // BHA weight in air, kg
  bhaLength: number;   // BHA length, m
  bhaOD: number;       // BHA OD, mm
  nozzleDiam: number;  // Jet nozzle diameter, mm
  nozzleCount: number; // Number of nozzles
}

// ─── Constants ───

const GRAVITY = 9.81;
const STEEL_DENSITY = 7850;

/** Yield strength by grade, MPa */
const GRADE_YIELD: Record<string, number> = {
  "CT-70": 483,
  "CT-80": 552,
  "CT-90": 621,
  "CT-110": 758,
};

/** Reel & guide arch diameters for fatigue, m */
const REEL_DIAMETERS: Record<string, number> = {
  small: 1.37,
  medium: 1.83,
  large: 2.44,
};
const GUIDE_ARCH_DIAMETER = 1.83;

// ─── Utility ───

export function ctID(od: number, wall: number): number {
  return od - 2 * wall;
}

function ctCrossSectionArea(od: number, wall: number): number {
  const odM = od / 1000;
  const idM = ctID(od, wall) / 1000;
  return (Math.PI / 4) * (odM * odM - idM * idM);
}

function ctInternalArea(od: number, wall: number): number {
  const idM = ctID(od, wall) / 1000;
  return (Math.PI / 4) * idM * idM;
}

/** Linear weight of CT in air, kg/m */
export function ctWeightPerMeter(od: number, wall: number): number {
  return ctCrossSectionArea(od, wall) * STEEL_DENSITY;
}

/** Get TVD at a given MD from trajectory (linear interpolation) */
function getTVDatMD(trajectory: TrajectoryPoint[], md: number): number {
  if (!trajectory || trajectory.length === 0) return md;
  const sorted = [...trajectory].sort((a, b) => a.md - b.md);
  if (md <= sorted[0].md) return sorted[0].tvd;
  if (md >= sorted[sorted.length - 1].md) return sorted[sorted.length - 1].tvd;
  for (let i = 1; i < sorted.length; i++) {
    if (md <= sorted[i].md) {
      const frac = (md - sorted[i - 1].md) / (sorted[i].md - sorted[i - 1].md);
      return sorted[i - 1].tvd + frac * (sorted[i].tvd - sorted[i - 1].tvd);
    }
  }
  return sorted[sorted.length - 1].tvd;
}

/** Get inclination (zenith) at a given MD */
function getIncAtMD(trajectory: TrajectoryPoint[], md: number): number {
  if (!trajectory || trajectory.length < 2) return 0;
  const sorted = [...trajectory].sort((a, b) => a.md - b.md);
  if (md <= sorted[0].md) return sorted[0].zenith;
  if (md >= sorted[sorted.length - 1].md) return sorted[sorted.length - 1].zenith;
  for (let i = 1; i < sorted.length; i++) {
    if (md <= sorted[i].md) {
      const frac = (md - sorted[i - 1].md) / (sorted[i].md - sorted[i - 1].md);
      return sorted[i - 1].zenith + frac * (sorted[i].zenith - sorted[i - 1].zenith);
    }
  }
  return sorted[sorted.length - 1].zenith;
}

// ─── Module 1: Tubing Forces ───

export interface ForceResult {
  weightInAir: number;
  buoyancyFactor: number;
  weightInFluid: number;
  dragForceRIH: number;
  dragForcePOOH: number;
  surfaceLoadRIH: number;
  surfaceLoadPOOH: number;
  helicalBucklingLoad: number;
  sinusoidalBucklingLoad: number;
  lockUpDepth: number;
}

export interface DepthForcePoint {
  depth: number;
  tvd: number;
  axialRIH: number;
  axialPOOH: number;
  bucklingLimit: number;
  helicalLimit: number;
}

export function calculateTubingForces(
  ct: CTStringData,
  well: WellGeometry,
  fluid: FluidData,
  tools: ToolsData,
  frictionCoeff: number = 0.25
): ForceResult {
  const linearWeight = ctWeightPerMeter(ct.od, ct.wall);
  const totalWeightAir = linearWeight * ct.length * GRAVITY / 1000;
  const bhaWeightN = tools.bhaWeight * GRAVITY / 1000;

  const fluidDensity = fluid.density * 1000;
  const buoyancyFactor = 1 - fluidDensity / STEEL_DENSITY;
  const weightInFluid = (totalWeightAir + bhaWeightN) * buoyancyFactor;

  const traj = well.trajectory.length > 1 ? well.trajectory : [
    { md: 0, azimuth: 0, zenith: 0, tvd: 0 },
    { md: well.md, azimuth: 0, zenith: 0, tvd: well.tvd },
  ];

  let totalDragRIH = 0;
  let totalDragPOOH = 0;
  let cumulativeWeight = bhaWeightN * buoyancyFactor;

  for (let i = traj.length - 1; i > 0; i--) {
    const segLen = traj[i].md - traj[i - 1].md;
    const incRad = (traj[i].zenith * Math.PI) / 180;
    const segWeight = linearWeight * segLen * GRAVITY / 1000 * buoyancyFactor;

    const normalForce = Math.abs(cumulativeWeight * Math.sin(incRad));
    const frictionForce = frictionCoeff * normalForce;

    totalDragRIH += frictionForce;
    totalDragPOOH += frictionForce;
    cumulativeWeight += segWeight;
  }

  const surfaceLoadRIH = weightInFluid - totalDragRIH;
  const surfaceLoadPOOH = weightInFluid + totalDragPOOH;

  const idCasing = well.casingID / 1000;
  const odCT = ct.od / 1000;
  const radialClearance = (idCasing - odCT) / 2;
  const momentOfInertia = (Math.PI / 64) * (Math.pow(odCT, 4) - Math.pow(ctID(ct.od, ct.wall) / 1000, 4));
  const E = 207000;

  const buoyedWeightPerM = linearWeight * GRAVITY * buoyancyFactor;
  const bottomZenith = traj[traj.length - 1]?.zenith || 0;

  const Fsin = radialClearance > 0
    ? 2 * Math.sqrt(E * 1e6 * momentOfInertia * buoyedWeightPerM * Math.sin(Math.max(bottomZenith * Math.PI / 180, 0.01)) / radialClearance)
    : 0;
  const Fhel = Fsin * 1.41;

  let lockUpDepth = 0;
  if (surfaceLoadRIH < 0) {
    lockUpDepth = well.md;
  } else {
    let axialLoad = surfaceLoadRIH * 1000;
    for (let i = 1; i < traj.length; i++) {
      const segLen = traj[i].md - traj[i - 1].md;
      const incRad = (traj[i].zenith * Math.PI) / 180;
      const segWeight = linearWeight * segLen * GRAVITY * buoyancyFactor;
      const normalF = Math.abs(axialLoad * Math.sin(incRad));
      const frictionF = frictionCoeff * normalF;
      axialLoad = axialLoad - segWeight * Math.cos(incRad) - frictionF;
      if (axialLoad < -Fhel) {
        lockUpDepth = traj[i].md;
        break;
      }
    }
  }

  return {
    weightInAir: totalWeightAir + bhaWeightN,
    buoyancyFactor,
    weightInFluid,
    dragForceRIH: totalDragRIH,
    dragForcePOOH: totalDragPOOH,
    surfaceLoadRIH,
    surfaceLoadPOOH,
    helicalBucklingLoad: Fhel / 1000,
    sinusoidalBucklingLoad: Fsin / 1000,
    lockUpDepth,
  };
}

/** Generate depth profile for force chart */
export function generateForceDepthProfile(
  ct: CTStringData,
  well: WellGeometry,
  fluid: FluidData,
  tools: ToolsData,
  frictionCoeff: number = 0.25,
  steps: number = 50
): DepthForcePoint[] {
  const linearWeight = ctWeightPerMeter(ct.od, ct.wall);
  const fluidDensity = fluid.density * 1000;
  const buoyancyFactor = 1 - fluidDensity / STEEL_DENSITY;
  const bhaWeightN = tools.bhaWeight * GRAVITY / 1000;
  const buoyedWeightPerM = linearWeight * GRAVITY * buoyancyFactor;

  const odCT = ct.od / 1000;
  const idCasing = well.casingID / 1000;
  const radialClearance = Math.max((idCasing - odCT) / 2, 0.001);
  const momentOfInertia = (Math.PI / 64) * (Math.pow(odCT, 4) - Math.pow(ctID(ct.od, ct.wall) / 1000, 4));
  const E = 207000;

  const points: DepthForcePoint[] = [];
  const maxD = Math.min(ct.length, well.md);
  const stepSize = maxD / steps;
  const traj = well.trajectory;

  for (let s = 0; s <= steps; s++) {
    const depth = s * stepSize;
    const tvd = getTVDatMD(traj, depth);
    const depthWeight = linearWeight * depth * GRAVITY / 1000 * buoyancyFactor;
    const totalWeight = depthWeight + bhaWeightN * buoyancyFactor;

    const zenith = getIncAtMD(traj, depth);
    const incRad = (zenith * Math.PI) / 180;

    const normalForce = Math.abs(totalWeight * Math.sin(Math.max(incRad, 0.01)));
    const drag = frictionCoeff * normalForce;

    const axialRIH = totalWeight - drag;
    const axialPOOH = totalWeight + drag;

    const sinBuckle = radialClearance > 0
      ? -2 * Math.sqrt(E * 1e6 * momentOfInertia * buoyedWeightPerM * Math.sin(Math.max(incRad, 0.01)) / radialClearance) / 1000
      : 0;
    const helBuckle = sinBuckle * 1.41;

    points.push({
      depth: Math.round(depth),
      tvd: Math.round(tvd * 10) / 10,
      axialRIH: Math.round(axialRIH * 10) / 10,
      axialPOOH: Math.round(axialPOOH * 10) / 10,
      bucklingLimit: Math.round(sinBuckle * 10) / 10,
      helicalLimit: Math.round(helBuckle * 10) / 10,
    });
  }

  return points;
}

// ─── Module 2: CoilLIMIT ───

export interface LimitResult {
  burstPressure: number;
  collapsePressure: number;
  collapseWithOvality: number;
  yieldTension: number;
  yieldCompression: number;
  vonMisesRatio: number;
  maxWorkingPressure: number;
  maxWorkingTension: number;
}

export function calculateLimits(
  ct: CTStringData,
  internalPressure: number = 0,
  externalPressure: number = 0,
  axialLoad: number = 0
): LimitResult {
  const yieldStrength = GRADE_YIELD[ct.grade] || 552;
  const od = ct.od;
  const wall = ct.wall;

  const burstPressure = (2 * yieldStrength * wall) / od;

  const dOverT = od / wall;
  let collapsePressure: number;
  if (dOverT < 15) {
    collapsePressure = 2 * yieldStrength * ((dOverT - 1) / (dOverT * dOverT));
  } else {
    collapsePressure = yieldStrength * (1 / dOverT) * 2;
  }

  const ovalityFraction = ct.ovality / 100;
  const collapseWithOvality = Math.max(0, collapsePressure * (1 - 3 * ovalityFraction * (dOverT - 1)));

  const steelAreaM2 = ctCrossSectionArea(od, wall);
  const yieldTension = yieldStrength * steelAreaM2 * 1000;
  const yieldCompression = yieldTension;

  const axialStress = (axialLoad * 1000) / steelAreaM2 / 1e6;
  const deltaPressure = internalPressure - externalPressure;
  const hoopStress = (deltaPressure * od) / (2 * wall);
  const radialStress = -(internalPressure + externalPressure) / 2;

  const vonMises = Math.sqrt(
    0.5 * (
      Math.pow(axialStress - hoopStress, 2) +
      Math.pow(hoopStress - radialStress, 2) +
      Math.pow(radialStress - axialStress, 2)
    )
  );
  const vonMisesRatio = vonMises / yieldStrength;

  return {
    burstPressure: Math.round(burstPressure * 100) / 100,
    collapsePressure: Math.round(collapsePressure * 100) / 100,
    collapseWithOvality: Math.round(Math.max(0, collapseWithOvality) * 100) / 100,
    yieldTension: Math.round(yieldTension * 100) / 100,
    yieldCompression: Math.round(yieldCompression * 100) / 100,
    vonMisesRatio: Math.round(vonMisesRatio * 1000) / 1000,
    maxWorkingPressure: Math.round(burstPressure * 0.8 * 100) / 100,
    maxWorkingTension: Math.round(yieldTension * 0.8 * 100) / 100,
  };
}

/** Generate pressure-load envelope for chart */
export interface EnvelopePoint {
  pressure: number;
  axialLoad: number;
  type: string;
}

export function generatePressureLoadEnvelope(ct: CTStringData): EnvelopePoint[] {
  const yieldStrength = GRADE_YIELD[ct.grade] || 552;
  const od = ct.od;
  const wall = ct.wall;
  const steelAreaM2 = ctCrossSectionArea(od, wall);

  const burstP = (2 * yieldStrength * wall) / od;
  const dOverT = od / wall;
  let collapseP = dOverT < 15
    ? 2 * yieldStrength * ((dOverT - 1) / (dOverT * dOverT))
    : yieldStrength * (1 / dOverT) * 2;
  const tensionKN = yieldStrength * steelAreaM2 * 1000;
  const compressionKN = tensionKN;

  const points: EnvelopePoint[] = [];
  const steps = 20;

  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps;
    const axial = tensionKN * (1 - ratio);
    const axialStress = (axial * 1000) / steelAreaM2 / 1e6;
    const remaining = Math.sqrt(Math.max(0, yieldStrength * yieldStrength - axialStress * axialStress));
    const pMax = remaining * 2 * wall / od;
    points.push({ pressure: Math.round(pMax * 10) / 10, axialLoad: Math.round(axial * 10) / 10, type: "burst" });
  }

  for (let i = steps; i >= 0; i--) {
    const ratio = i / steps;
    const axial = tensionKN * (1 - ratio);
    const axialStress = (axial * 1000) / steelAreaM2 / 1e6;
    const remaining = Math.sqrt(Math.max(0, yieldStrength * yieldStrength - axialStress * axialStress));
    const pMin = -(remaining * 2 * wall / od) * (collapseP / burstP);
    points.push({ pressure: Math.round(pMin * 10) / 10, axialLoad: Math.round(axial * 10) / 10, type: "collapse" });
  }

  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps;
    const axial = -compressionKN * ratio;
    const axialStress = (axial * 1000) / steelAreaM2 / 1e6;
    const remaining = Math.sqrt(Math.max(0, yieldStrength * yieldStrength - axialStress * axialStress));
    const pMin = -(remaining * 2 * wall / od) * (collapseP / burstP);
    points.push({ pressure: Math.round(pMin * 10) / 10, axialLoad: Math.round(axial * 10) / 10, type: "collapse" });
  }

  for (let i = steps; i >= 0; i--) {
    const ratio = i / steps;
    const axial = -compressionKN * ratio;
    const axialStress = (axial * 1000) / steelAreaM2 / 1e6;
    const remaining = Math.sqrt(Math.max(0, yieldStrength * yieldStrength - axialStress * axialStress));
    const pMax = remaining * 2 * wall / od;
    points.push({ pressure: Math.round(pMax * 10) / 10, axialLoad: Math.round(axial * 10) / 10, type: "burst" });
  }

  return points;
}

// ─── Module 3: Hydraulics ───

export interface HydraulicsResult {
  dpInsideCT: number;
  dpAnnulus: number;
  dpNozzle: number;
  dpTotal: number;
  hydrostaticInside: number;
  hydrostaticAnnulus: number;
  bhCircPressure: number;
  velocityInCT: number;
  velocityAnnulus: number;
  reynoldsInCT: number;
  reynoldsAnnulus: number;
  flowRegimeCT: string;
  flowRegimeAnnulus: string;
  ecdAtTD: number;
  minTransportVelocity: number;
  transportOk: boolean;
  fracPressureAtTD: number;
  fracSafetyFactor: number;
}

export interface HydraulicsChartPoint {
  flowRate: number;
  dpCT: number;
  dpAnn: number;
  dpNozzle: number;
  dpTotal: number;
}

export function calculateHydraulics(
  ct: CTStringData,
  well: WellGeometry,
  fluid: FluidData,
  pump: PumpData,
  tools: ToolsData
): HydraulicsResult {
  // flowRate is in l/s → convert to m³/s
  const Q = pump.flowRate / 1000;
  const idCT = ctID(ct.od, ct.wall) / 1000;
  const odCT = ct.od / 1000;
  const idCasing = (well.tubingID > 0 ? well.tubingID : well.casingID) / 1000;

  const areaCT = (Math.PI / 4) * idCT * idCT;
  const areaAnnulus = (Math.PI / 4) * (idCasing * idCasing - odCT * odCT);

  const velCT = areaCT > 0 ? Q / areaCT : 0;
  const velAnn = areaAnnulus > 0 ? Q / areaAnnulus : 0;

  const rho = fluid.density * 1000;
  const mu = fluid.pv / 1000;

  const ReCT = mu > 0 ? (rho * velCT * idCT) / mu : 0;
  const dhAnn = idCasing - odCT;
  const ReAnn = mu > 0 && dhAnn > 0 ? (rho * velAnn * dhAnn) / mu : 0;

  const getRegime = (Re: number) => Re < 2100 ? "Ламинарный" : Re < 3000 ? "Переходный" : "Турбулентный";

  const fanningF = (Re: number) => {
    if (Re <= 0) return 0;
    if (Re < 2100) return 16 / Re;
    return 0.079 / Math.pow(Re, 0.25);
  };

  const fCT = fanningF(ReCT);
  const fAnn = fanningF(ReAnn);

  const ctLength = Math.min(ct.length, well.md);
  const dpCT = idCT > 0 ? (4 * fCT * ctLength * rho * velCT * velCT) / (2 * idCT) / 1e6 : 0;
  const dpAnn = dhAnn > 0 ? (4 * fAnn * ctLength * rho * velAnn * velAnn) / (2 * dhAnn) / 1e6 : 0;

  let dpNozzle = 0;
  if (tools.nozzleDiam > 0 && tools.nozzleCount > 0) {
    const nozzleArea = tools.nozzleCount * (Math.PI / 4) * Math.pow(tools.nozzleDiam / 1000, 2);
    const velNozzle = Q / nozzleArea;
    const Cd = 0.95;
    dpNozzle = (rho * velNozzle * velNozzle) / (2 * Cd * Cd) / 1e6;
  }

  // *** TVD-based hydrostatics ***
  const tvd = well.tvd;
  const hydroIn = rho * GRAVITY * tvd / 1e6;
  const hydroAnn = hydroIn;

  const bhCircPressure = hydroAnn + dpAnn + well.wellheadPressure;
  const dpTotal = dpCT + dpAnn + dpNozzle;

  // ECD at TVD
  const ecdAtTD = tvd > 0 ? bhCircPressure / (GRAVITY * tvd / 1e6) / 1000 : fluid.density;

  // Frac pressure at TVD
  const fracPressureAtTD = well.fracGradient * tvd;
  const fracSafetyFactor = fracPressureAtTD > 0 ? bhCircPressure / fracPressureAtTD : 0;

  // Solids transport
  const avgZenith = well.trajectory.length > 1 ? well.trajectory[well.trajectory.length - 1].zenith : 0;
  const incFactor = 1 + Math.sin((avgZenith * Math.PI) / 180) * 0.6;
  const minTransportVelocity = 0.5 * incFactor;
  const transportOk = velAnn >= minTransportVelocity;

  return {
    dpInsideCT: Math.round(dpCT * 100) / 100,
    dpAnnulus: Math.round(dpAnn * 100) / 100,
    dpNozzle: Math.round(dpNozzle * 100) / 100,
    dpTotal: Math.round(dpTotal * 100) / 100,
    hydrostaticInside: Math.round(hydroIn * 100) / 100,
    hydrostaticAnnulus: Math.round(hydroAnn * 100) / 100,
    bhCircPressure: Math.round(bhCircPressure * 100) / 100,
    velocityInCT: Math.round(velCT * 100) / 100,
    velocityAnnulus: Math.round(velAnn * 100) / 100,
    reynoldsInCT: Math.round(ReCT),
    reynoldsAnnulus: Math.round(ReAnn),
    flowRegimeCT: getRegime(ReCT),
    flowRegimeAnnulus: getRegime(ReAnn),
    ecdAtTD: Math.round(ecdAtTD * 1000) / 1000,
    minTransportVelocity: Math.round(minTransportVelocity * 100) / 100,
    transportOk,
    fracPressureAtTD: Math.round(fracPressureAtTD * 100) / 100,
    fracSafetyFactor: Math.round(fracSafetyFactor * 100) / 100,
  };
}

/** Generate flow rate vs pressure drop curve for chart */
export function generateHydraulicsCurve(
  ct: CTStringData,
  well: WellGeometry,
  fluid: FluidData,
  tools: ToolsData,
  maxFlowRate: number = 600,
  steps: number = 30
): HydraulicsChartPoint[] {
  const points: HydraulicsChartPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const fr = (maxFlowRate / steps) * i;
    const r = calculateHydraulics(ct, well, fluid, { flowRate: fr, surfacePressure: 0 }, tools);
    points.push({
      flowRate: Math.round(fr),
      dpCT: r.dpInsideCT,
      dpAnn: r.dpAnnulus,
      dpNozzle: r.dpNozzle,
      dpTotal: r.dpTotal,
    });
  }
  return points;
}

// ─── Module 4: CoilLIFE ───

export interface FatigueResult {
  bendingStrainReel: number;
  bendingStrainGuideArch: number;
  totalStrainPerTrip: number;
  estimatedCycles: number;
  fatigueLifeUsed: number;
  pressureDerate: number;
  maxSafeTrips: number;
}

export interface FatigueChartPoint {
  trips: number;
  lifeUsed: number;
  burstDerate: number;
  effectiveBurst: number;
}

export function calculateFatigue(
  ct: CTStringData,
  reelSize: "small" | "medium" | "large" = "medium",
  operatingPressure: number = 0,
  previousTrips: number = 0
): FatigueResult {
  const odM = ct.od / 1000;
  const reelDiam = REEL_DIAMETERS[reelSize];
  const guideArchDiam = GUIDE_ARCH_DIAMETER;

  const strainReel = (odM / reelDiam) * 100;
  const strainGuideArch = (odM / guideArchDiam) * 100;
  const totalStrainPerTrip = 2 * strainReel + 2 * strainGuideArch;

  const yieldStr = GRADE_YIELD[ct.grade] || 552;
  const strainAmplitude = totalStrainPerTrip / 4;

  const pressureRatio = operatingPressure / ((2 * yieldStr * ct.wall) / ct.od);
  const pressureFactor = Math.max(0.2, 1 - pressureRatio * 0.6);

  const C = 0.6;
  const b = 2.0;
  const baseCycles = strainAmplitude > 0 ? C / Math.pow(strainAmplitude, b) * 1000 : 99999;
  const adjustedCycles = Math.round(baseCycles * pressureFactor);

  const fatigueUsed = previousTrips > 0 ? (previousTrips / adjustedCycles) * 100 : 0;
  const pressureDerate = Math.min(30, fatigueUsed * 0.5);

  return {
    bendingStrainReel: Math.round(strainReel * 1000) / 1000,
    bendingStrainGuideArch: Math.round(strainGuideArch * 1000) / 1000,
    totalStrainPerTrip: Math.round(totalStrainPerTrip * 1000) / 1000,
    estimatedCycles: adjustedCycles,
    fatigueLifeUsed: Math.round(fatigueUsed * 10) / 10,
    pressureDerate: Math.round(pressureDerate * 10) / 10,
    maxSafeTrips: Math.round(adjustedCycles / 2),
  };
}

/** Generate fatigue life curve */
export function generateFatigueCurve(
  ct: CTStringData,
  reelSize: "small" | "medium" | "large",
  operatingPressure: number
): FatigueChartPoint[] {
  const fatigue = calculateFatigue(ct, reelSize, operatingPressure, 0);
  const maxTrips = fatigue.estimatedCycles;
  const burstP = (2 * (GRADE_YIELD[ct.grade] || 552) * ct.wall) / ct.od;
  const points: FatigueChartPoint[] = [];
  const steps = 40;

  for (let i = 0; i <= steps; i++) {
    const trips = Math.round((maxTrips * 1.2 / steps) * i);
    const used = (trips / maxTrips) * 100;
    const derate = Math.min(30, used * 0.5);
    points.push({
      trips,
      lifeUsed: Math.round(used * 10) / 10,
      burstDerate: Math.round(derate * 10) / 10,
      effectiveBurst: Math.round((burstP * (1 - derate / 100)) * 10) / 10,
    });
  }

  return points;
}

// ─── Temperature Profile ───

export interface TempProfilePoint {
  depth: number;
  tvd: number;
  tempStatic: number;
  tempCirculating: number;
}

export function generateTempProfile(well: WellGeometry, steps: number = 30): TempProfilePoint[] {
  const points: TempProfilePoint[] = [];
  const maxMD = well.md;
  const traj = well.trajectory;

  for (let i = 0; i <= steps; i++) {
    const md = (maxMD / steps) * i;
    const tvd = getTVDatMD(traj, md);
    const tvdRatio = well.tvd > 0 ? tvd / well.tvd : 0;
    const tempStatic = well.whTemp + (well.bhst - well.whTemp) * tvdRatio;
    const tempCirc = well.whTemp + (well.bhct - well.whTemp) * tvdRatio;
    points.push({
      depth: Math.round(md),
      tvd: Math.round(tvd * 10) / 10,
      tempStatic: Math.round(tempStatic * 10) / 10,
      tempCirculating: Math.round(tempCirc * 10) / 10,
    });
  }

  return points;
}

// ─── Risk Assessment ───

export interface RiskItem {
  level: "info" | "warning" | "critical";
  emoji: string;
  message: string;
}

export function assessRisks(
  forces: ForceResult,
  limits: LimitResult,
  hydraulics: HydraulicsResult,
  fatigue: FatigueResult,
  well: WellGeometry
): RiskItem[] {
  const risks: RiskItem[] = [];

  if (forces.lockUpDepth > 0) {
    risks.push({ level: "critical", emoji: "🔒", message: `Запирание ГНКТ на глубине ${forces.lockUpDepth.toFixed(0)} м — невозможно продвижение` });
  }
  if (forces.surfaceLoadRIH < 0) {
    risks.push({ level: "critical", emoji: "⚠️", message: "Колтюбинг в сжатии на устье — риск спирального изгиба" });
  }
  if (forces.surfaceLoadPOOH > limits.maxWorkingTension) {
    risks.push({ level: "critical", emoji: "💥", message: "Нагрузка при подъёме превышает рабочий предел натяжения" });
  }

  if (hydraulics.dpTotal > limits.maxWorkingPressure) {
    risks.push({ level: "critical", emoji: "🔴", message: `Давление циркуляции (${hydraulics.dpTotal.toFixed(1)} МПа) > макс. рабочее (${limits.maxWorkingPressure.toFixed(1)} МПа)` });
  }
  if (limits.vonMisesRatio >= 1.0) {
    risks.push({ level: "critical", emoji: "⛔", message: "Критерий Мизеса превышен — деформация неизбежна!" });
  } else if (limits.vonMisesRatio >= 0.8) {
    risks.push({ level: "warning", emoji: "🟡", message: `Коэффициент Мизеса ${limits.vonMisesRatio.toFixed(3)} — близко к пределу` });
  }

  if (limits.collapseWithOvality < well.wellheadPressure) {
    risks.push({ level: "warning", emoji: "📉", message: "Давление смятия ниже устьевого давления" });
  }

  // Frac check
  if (hydraulics.fracSafetyFactor >= 1.0 && hydraulics.fracPressureAtTD > 0) {
    risks.push({ level: "critical", emoji: "🌋", message: `BHP (${hydraulics.bhCircPressure.toFixed(1)} МПа) превышает давление ГРП (${hydraulics.fracPressureAtTD.toFixed(1)} МПа) — риск поглощения!` });
  } else if (hydraulics.fracSafetyFactor >= 0.85 && hydraulics.fracPressureAtTD > 0) {
    risks.push({ level: "warning", emoji: "⚡", message: `BHP = ${(hydraulics.fracSafetyFactor * 100).toFixed(0)}% от давления ГРП — осторожно` });
  }

  if (!hydraulics.transportOk) {
    risks.push({ level: "warning", emoji: "🔄", message: `Скорость в затрубье (${hydraulics.velocityAnnulus.toFixed(2)} м/с) недостаточна для транспорта шлама (мин. ${hydraulics.minTransportVelocity.toFixed(2)} м/с)` });
  }
  if (hydraulics.ecdAtTD > 1.5) {
    risks.push({ level: "info", emoji: "📊", message: `ECD на забое: ${hydraulics.ecdAtTD.toFixed(3)} г/см³ — проверьте совместимость с пластовым давлением` });
  }

  if (fatigue.fatigueLifeUsed > 80) {
    risks.push({ level: "critical", emoji: "💀", message: `Ресурс ГНКТ критически исчерпан (${fatigue.fatigueLifeUsed.toFixed(0)}%)` });
  } else if (fatigue.fatigueLifeUsed > 50) {
    risks.push({ level: "warning", emoji: "⏳", message: `Использовано ${fatigue.fatigueLifeUsed.toFixed(0)}% ресурса — усиленный контроль` });
  }
  if (fatigue.pressureDerate > 15) {
    risks.push({ level: "warning", emoji: "📉", message: `Давление разрыва снижено на ${fatigue.pressureDerate.toFixed(1)}% из-за усталости` });
  }

  if (risks.length === 0) {
    risks.push({ level: "info", emoji: "✅", message: "Все параметры в допустимых пределах" });
  }

  return risks;
}

// ─── Presets ───

export const CT_PRESETS: { label: string; od: number; wall: number }[] = [
  { label: '1" (25.4 мм)', od: 25.4, wall: 2.77 },
  { label: '1.25" (31.75 мм)', od: 31.75, wall: 3.18 },
  { label: '1.5" (38.1 мм)', od: 38.1, wall: 3.40 },
  { label: '1.75" (44.45 мм)', od: 44.45, wall: 3.68 },
  { label: '2" (50.8 мм)', od: 50.8, wall: 3.96 },
  { label: '2.375" (60.33 мм)', od: 60.33, wall: 4.44 },
  { label: '2.875" (73.03 мм)', od: 73.03, wall: 5.51 },
  { label: '3.5" (88.9 мм)', od: 88.9, wall: 5.51 },
];

export const FLUID_PRESETS: { label: string; data: FluidData }[] = [
  { label: "Вода", data: { name: "Вода", density: 1.0, pv: 1, yp: 0, nIndex: 1, kIndex: 0.001 } },
  { label: "Солевой раствор (NaCl)", data: { name: "Солевой раствор NaCl", density: 1.05, pv: 1.5, yp: 0, nIndex: 1, kIndex: 0.0015 } },
  { label: "Солевой раствор (CaCl₂)", data: { name: "Солевой раствор CaCl₂", density: 1.20, pv: 2.0, yp: 0, nIndex: 1, kIndex: 0.002 } },
  { label: "КМЦ раствор", data: { name: "КМЦ раствор", density: 1.02, pv: 15, yp: 5, nIndex: 0.6, kIndex: 0.5 } },
  { label: "Кислота 15% HCl", data: { name: "HCl 15%", density: 1.07, pv: 1.2, yp: 0, nIndex: 1, kIndex: 0.0012 } },
  { label: "Кислота 28% HCl", data: { name: "HCl 28%", density: 1.14, pv: 1.8, yp: 0, nIndex: 1, kIndex: 0.0018 } },
  { label: "Глинокислота", data: { name: "Глинокислота (HCl+HF)", density: 1.08, pv: 1.3, yp: 0, nIndex: 1, kIndex: 0.0013 } },
  { label: "Гель (ГПГ)", data: { name: "Гуаровый гель", density: 1.01, pv: 25, yp: 10, nIndex: 0.45, kIndex: 2.0 } },
  { label: "Биополимер (ксантан)", data: { name: "Биополимерный раствор", density: 1.01, pv: 20, yp: 8, nIndex: 0.5, kIndex: 1.5 } },
  { label: "Нефть (0.85)", data: { name: "Нефть", density: 0.85, pv: 5, yp: 0, nIndex: 1, kIndex: 0.005 } },
  { label: "Азот (газ)", data: { name: "Азот", density: 0.15, pv: 0.02, yp: 0, nIndex: 1, kIndex: 0.00002 } },
];
