/**
 * Coiled Tubing (ГНКТ) Engineering Calculations
 * Based on CoilCADE methodology (Schlumberger)
 * Modules: Tubing Forces, CoilLIMIT, Hydraulics, CoilLIFE
 */

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
  tvd: number;         // True vertical depth, m
  casingID: number;    // Casing inner diameter, mm
  tubingID: number;    // Tubing inner diameter (if inside tubing), mm — 0 if open hole / casing
  wellheadPressure: number; // Wellhead pressure, MPa
  bhTemp: number;      // Bottom hole temperature, °C
  whTemp: number;      // Wellhead temperature, °C
  trajectory: TrajectoryPoint[];
}

export interface TrajectoryPoint {
  md: number;
  inc: number;   // inclination, degrees
  azi: number;   // azimuth, degrees
  tvd: number;
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

const GRAVITY = 9.81; // m/s²
const STEEL_DENSITY = 7850; // kg/m³

/** Yield strength by grade, MPa */
const GRADE_YIELD: Record<string, number> = {
  "CT-70": 483,
  "CT-80": 552,
  "CT-90": 621,
  "CT-110": 758,
};

/** Reel & guide arch diameters for fatigue, m */
const REEL_DIAMETERS: Record<string, number> = {
  "small": 1.37,
  "medium": 1.83,
  "large": 2.44,
};
const GUIDE_ARCH_DIAMETER = 1.83; // m typical

// ─── Utility ───

function ctID(od: number, wall: number): number {
  return od - 2 * wall;
}

function ctCrossSectionArea(od: number, wall: number): number {
  // Steel cross-section, mm² → m²
  const odM = od / 1000;
  const idM = ctID(od, wall) / 1000;
  return (Math.PI / 4) * (odM * odM - idM * idM);
}

function ctInternalArea(od: number, wall: number): number {
  const idM = ctID(od, wall) / 1000;
  return (Math.PI / 4) * idM * idM;
}

function ctOuterArea(od: number): number {
  const odM = od / 1000;
  return (Math.PI / 4) * odM * odM;
}

/** Linear weight of CT in air, kg/m */
export function ctWeightPerMeter(od: number, wall: number): number {
  return ctCrossSectionArea(od, wall) * STEEL_DENSITY;
}

// ─── Module 1: Tubing Forces ───

export interface ForceResult {
  weightInAir: number;       // kN — total string weight
  buoyancyFactor: number;    // dimensionless
  weightInFluid: number;     // kN — buoyed weight
  dragForceRIH: number;      // kN — drag during run-in-hole
  dragForcePOOH: number;     // kN — drag during pull-out
  surfaceLoadRIH: number;    // kN — surface weight indicator RIH
  surfaceLoadPOOH: number;   // kN — surface weight indicator POOH
  helicalBucklingLoad: number; // kN — critical helical buckling load
  sinusoidalBucklingLoad: number; // kN — sinusoidal buckling
  lockUpDepth: number;       // m — estimated lock-up depth (0 if no lock-up)
}

export function calculateTubingForces(
  ct: CTStringData,
  well: WellGeometry,
  fluid: FluidData,
  tools: ToolsData,
  frictionCoeff: number = 0.25
): ForceResult {
  const linearWeight = ctWeightPerMeter(ct.od, ct.wall); // kg/m
  const totalWeightAir = linearWeight * ct.length * GRAVITY / 1000; // kN
  const bhaWeightN = tools.bhaWeight * GRAVITY / 1000; // kN

  // Buoyancy factor
  const fluidDensity = fluid.density * 1000; // kg/m³
  const buoyancyFactor = 1 - fluidDensity / STEEL_DENSITY;

  const weightInFluid = (totalWeightAir + bhaWeightN) * buoyancyFactor;

  // Simplified drag calculation using trajectory
  const traj = well.trajectory.length > 1 ? well.trajectory : [
    { md: 0, inc: 0, azi: 0, tvd: 0 },
    { md: well.md, inc: 0, azi: 0, tvd: well.tvd },
  ];

  let totalDragRIH = 0;
  let totalDragPOOH = 0;
  let cumulativeWeight = bhaWeightN * buoyancyFactor; // Start from bottom

  // Walk from bottom to surface
  for (let i = traj.length - 1; i > 0; i--) {
    const segLen = traj[i].md - traj[i - 1].md;
    const incRad = (traj[i].inc * Math.PI) / 180;
    const segWeight = linearWeight * segLen * GRAVITY / 1000 * buoyancyFactor;

    const normalForce = Math.abs(cumulativeWeight * Math.sin(incRad));
    const frictionForce = frictionCoeff * normalForce;

    totalDragRIH += frictionForce; // assists going down, but friction opposes
    totalDragPOOH += frictionForce;
    cumulativeWeight += segWeight;
  }

  // Surface loads
  const surfaceLoadRIH = weightInFluid - totalDragRIH; // lighter when running in
  const surfaceLoadPOOH = weightInFluid + totalDragPOOH; // heavier when pulling out

  // Buckling loads (Dawson-Paslay)
  const idCasing = well.casingID / 1000; // m
  const odCT = ct.od / 1000; // m
  const radialClearance = (idCasing - odCT) / 2;
  const momentOfInertia = (Math.PI / 64) * (Math.pow(odCT, 4) - Math.pow(ctID(ct.od, ct.wall) / 1000, 4));
  const yieldStr = GRADE_YIELD[ct.grade] || 552;
  const E = 207000; // MPa — Young's modulus

  const buoyedWeightPerM = linearWeight * GRAVITY * buoyancyFactor; // N/m

  // Sinusoidal buckling critical load (Dawson-Paslay)
  const Fsin = radialClearance > 0
    ? 2 * Math.sqrt(E * 1e6 * momentOfInertia * buoyedWeightPerM * Math.sin(Math.max((traj[traj.length - 1]?.inc || 0) * Math.PI / 180, 0.01)) / radialClearance)
    : 0;

  // Helical buckling ≈ 1.4 × sinusoidal
  const Fhel = Fsin * 1.41;

  // Lock-up estimation: depth where cumulative compression exceeds helical buckling
  let lockUpDepth = 0;
  if (surfaceLoadRIH < 0) {
    // String is in compression at surface — lock-up occurred
    lockUpDepth = well.md; // full depth
  } else {
    // Walk from surface down to find where axial load goes to -Fhel
    let axialLoad = surfaceLoadRIH * 1000; // N
    for (let i = 1; i < traj.length; i++) {
      const segLen = traj[i].md - traj[i - 1].md;
      const incRad = (traj[i].inc * Math.PI) / 180;
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

// ─── Module 2: CoilLIMIT — Pressure & Load Limits ───

export interface LimitResult {
  burstPressure: number;     // MPa — internal yield (Barlow)
  collapsePressure: number;  // MPa — external collapse
  collapseWithOvality: number; // MPa — collapse adjusted for ovality
  yieldTension: number;      // kN — axial yield
  yieldCompression: number;  // kN — axial yield (compression)
  vonMisesRatio: number;     // ratio at given conditions (0-1, >1 = failure)
  maxWorkingPressure: number; // MPa — 80% of burst
  maxWorkingTension: number; // kN — 80% of yield
}

export function calculateLimits(
  ct: CTStringData,
  internalPressure: number = 0,
  externalPressure: number = 0,
  axialLoad: number = 0 // kN, positive = tension
): LimitResult {
  const yieldStrength = GRADE_YIELD[ct.grade] || 552; // MPa
  const od = ct.od;
  const wall = ct.wall;
  const id = ctID(od, wall);

  // Barlow burst pressure
  const burstPressure = (2 * yieldStrength * wall) / od;

  // Collapse pressure (API simplified, thin-wall)
  const dOverT = od / wall;
  let collapsePressure: number;
  if (dOverT < 15) {
    // Yield collapse
    collapsePressure = 2 * yieldStrength * ((dOverT - 1) / (dOverT * dOverT));
  } else {
    // Plastic collapse (simplified)
    collapsePressure = yieldStrength * (1 / dOverT) * 2;
  }

  // Ovality correction (Timoshenko)
  const ovalityFraction = ct.ovality / 100;
  const collapseWithOvality = collapsePressure * (1 - 3 * ovalityFraction * (dOverT - 1));
  const collapseAdj = Math.max(0, collapseWithOvality);

  // Axial yield
  const steelArea = ctCrossSectionArea(od, wall) * 1e6; // m² → mm²
  const steelAreaM2 = ctCrossSectionArea(od, wall); // m²
  const yieldTension = (yieldStrength * steelAreaM2 * 1000); // kN
  const yieldCompression = yieldTension; // same magnitude

  // Von Mises triaxial check
  const axialStress = (axialLoad * 1000) / steelAreaM2 / 1e6; // MPa
  const deltaPressure = internalPressure - externalPressure;
  const hoopStress = (deltaPressure * od) / (2 * wall); // MPa (thin wall)
  const radialStress = -(internalPressure + externalPressure) / 2; // MPa approx

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
    collapseWithOvality: Math.round(collapseAdj * 100) / 100,
    yieldTension: Math.round(yieldTension * 100) / 100,
    yieldCompression: Math.round(yieldCompression * 100) / 100,
    vonMisesRatio: Math.round(vonMisesRatio * 1000) / 1000,
    maxWorkingPressure: Math.round(burstPressure * 0.8 * 100) / 100,
    maxWorkingTension: Math.round(yieldTension * 0.8 * 100) / 100,
  };
}

// ─── Module 3: Hydraulics ───

export interface HydraulicsResult {
  dpInsideCT: number;       // MPa — friction inside CT
  dpAnnulus: number;        // MPa — friction in annulus
  dpNozzle: number;         // MPa — pressure drop across nozzles
  dpTotal: number;          // MPa — total surface pressure needed
  hydrostaticInside: number;  // MPa
  hydrostaticAnnulus: number; // MPa
  bhCircPressure: number;   // MPa — bottom hole circulating pressure
  velocityInCT: number;     // m/s
  velocityAnnulus: number;  // m/s
  reynoldsInCT: number;
  reynoldsAnnulus: number;
  flowRegimeCT: string;
  flowRegimeAnnulus: string;
}

export function calculateHydraulics(
  ct: CTStringData,
  well: WellGeometry,
  fluid: FluidData,
  pump: PumpData,
  tools: ToolsData
): HydraulicsResult {
  const Q = pump.flowRate / 1000 / 60; // m³/s
  const idCT = ctID(ct.od, ct.wall) / 1000; // m
  const odCT = ct.od / 1000;
  const idCasing = (well.tubingID > 0 ? well.tubingID : well.casingID) / 1000; // m

  const areaCT = (Math.PI / 4) * idCT * idCT;
  const areaAnnulus = (Math.PI / 4) * (idCasing * idCasing - odCT * odCT);

  const velCT = Q / areaCT;
  const velAnn = areaAnnulus > 0 ? Q / areaAnnulus : 0;

  const rho = fluid.density * 1000; // kg/m³
  const mu = fluid.pv / 1000; // Pa·s

  // Reynolds numbers
  const ReCT = mu > 0 ? (rho * velCT * idCT) / mu : 0;
  const dhAnn = idCasing - odCT;
  const ReAnn = mu > 0 && dhAnn > 0 ? (rho * velAnn * dhAnn) / mu : 0;

  const getRegime = (Re: number) => Re < 2100 ? "Ламинарный" : Re < 3000 ? "Переходный" : "Турбулентный";

  // Friction factor (Fanning)
  const fanningF = (Re: number) => {
    if (Re <= 0) return 0;
    if (Re < 2100) return 16 / Re;
    // Blasius
    return 0.079 / Math.pow(Re, 0.25);
  };

  const fCT = fanningF(ReCT);
  const fAnn = fanningF(ReAnn);

  // Pressure drops (Darcy-Weisbach style)
  const ctLength = Math.min(ct.length, well.md);
  const dpCT = idCT > 0 ? (4 * fCT * ctLength * rho * velCT * velCT) / (2 * idCT) / 1e6 : 0; // MPa
  const dpAnn = dhAnn > 0 ? (4 * fAnn * ctLength * rho * velAnn * velAnn) / (2 * dhAnn) / 1e6 : 0;

  // Nozzle pressure drop
  let dpNozzle = 0;
  if (tools.nozzleDiam > 0 && tools.nozzleCount > 0) {
    const nozzleArea = tools.nozzleCount * (Math.PI / 4) * Math.pow(tools.nozzleDiam / 1000, 2);
    const velNozzle = Q / nozzleArea;
    const Cd = 0.95; // discharge coefficient
    dpNozzle = (rho * velNozzle * velNozzle) / (2 * Cd * Cd) / 1e6;
  }

  // Hydrostatic
  const hydroIn = rho * GRAVITY * well.tvd / 1e6;
  const hydroAnn = hydroIn; // same fluid assumed

  // BHP
  const bhCircPressure = hydroAnn + dpAnn + well.wellheadPressure;

  const dpTotal = dpCT + dpAnn + dpNozzle;

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
  };
}

// ─── Module 4: CoilLIFE — Fatigue Life ───

export interface FatigueResult {
  bendingStrainReel: number;      // % — bending strain on reel
  bendingStrainGuideArch: number; // %
  totalStrainPerTrip: number;     // % — total cycling strain per trip (4 bends)
  estimatedCycles: number;        // trips before fatigue failure
  fatigueLifeUsed: number;        // % — cumulative usage (per trip / total)
  pressureDerate: number;         // % — burst pressure derating due to fatigue
  maxSafeTrips: number;           // conservative (SF=2)
}

export function calculateFatigue(
  ct: CTStringData,
  reelSize: "small" | "medium" | "large" = "medium",
  operatingPressure: number = 0, // MPa internal
  previousTrips: number = 0
): FatigueResult {
  const odM = ct.od / 1000;
  const reelDiam = REEL_DIAMETERS[reelSize];
  const guideArchDiam = GUIDE_ARCH_DIAMETER;

  // Bending strain = OD / Bend_Diameter (for thin wall tube)
  const strainReel = (odM / reelDiam) * 100; // %
  const strainGuideArch = (odM / guideArchDiam) * 100;

  // Each trip: reel→guide→well→guide→reel = 4 bending events
  const totalStrainPerTrip = 2 * strainReel + 2 * strainGuideArch;

  // Fatigue life estimation (Coffin-Manson simplified for CT)
  // N_f ≈ C / (strain_amplitude)^b
  // Typical CT: C ≈ 0.5, b ≈ 2.0 for strain in %
  const yieldStr = GRADE_YIELD[ct.grade] || 552;
  const strainAmplitude = totalStrainPerTrip / 4; // per cycle
  
  // Pressure effect: internal pressure reduces fatigue life
  const pressureRatio = operatingPressure / ((2 * yieldStr * ct.wall) / ct.od);
  const pressureFactor = Math.max(0.2, 1 - pressureRatio * 0.6);

  const C = 0.6; // empirical constant
  const b = 2.0;
  const baseCycles = strainAmplitude > 0 ? C / Math.pow(strainAmplitude, b) * 1000 : 99999;
  const adjustedCycles = Math.round(baseCycles * pressureFactor);

  const fatigueUsed = previousTrips > 0 ? (previousTrips / adjustedCycles) * 100 : 0;

  // Burst pressure derating
  const pressureDerate = Math.min(30, fatigueUsed * 0.5);

  return {
    bendingStrainReel: Math.round(strainReel * 1000) / 1000,
    bendingStrainGuideArch: Math.round(strainGuideArch * 1000) / 1000,
    totalStrainPerTrip: Math.round(totalStrainPerTrip * 1000) / 1000,
    estimatedCycles: adjustedCycles,
    fatigueLifeUsed: Math.round(fatigueUsed * 10) / 10,
    pressureDerate: Math.round(pressureDerate * 10) / 10,
    maxSafeTrips: Math.round(adjustedCycles / 2), // SF=2
  };
}

// ─── Presets ───

export const CT_PRESETS: { label: string; od: number; wall: number }[] = [
  { label: "1\" (25.4 мм)", od: 25.4, wall: 2.77 },
  { label: "1.25\" (31.75 мм)", od: 31.75, wall: 3.18 },
  { label: "1.5\" (38.1 мм)", od: 38.1, wall: 3.40 },
  { label: "1.75\" (44.45 мм)", od: 44.45, wall: 3.68 },
  { label: "2\" (50.8 мм)", od: 50.8, wall: 3.96 },
  { label: "2.375\" (60.33 мм)", od: 60.33, wall: 4.44 },
  { label: "2.875\" (73.03 мм)", od: 73.03, wall: 4.78 },
  { label: "3.5\" (88.9 мм)", od: 88.9, wall: 5.51 },
];

export const FLUID_PRESETS: { label: string; data: FluidData }[] = [
  { label: "Вода", data: { name: "Вода", density: 1.0, pv: 1, yp: 0, nIndex: 1, kIndex: 0.001 } },
  { label: "Солевой раствор (1.05)", data: { name: "Солевой раствор", density: 1.05, pv: 1.5, yp: 0, nIndex: 1, kIndex: 0.0015 } },
  { label: "КМЦ раствор", data: { name: "КМЦ раствор", density: 1.02, pv: 15, yp: 5, nIndex: 0.6, kIndex: 0.5 } },
  { label: "Кислота 15% HCl", data: { name: "HCl 15%", density: 1.07, pv: 1.2, yp: 0, nIndex: 1, kIndex: 0.0012 } },
  { label: "Гель (ГПГ)", data: { name: "Гуаровый гель", density: 1.01, pv: 25, yp: 10, nIndex: 0.45, kIndex: 2.0 } },
];
