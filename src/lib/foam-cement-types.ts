import type { WellData } from "./cementing-calculations";
export type FoamFluidKind = "mud" | "buffer" | "foam" | "displacement";
export interface FoamZone {
  topMD: number;
  bottomMD: number;
  targetFQ: number;
}
export interface FoamFormation {
  md: number;
  poreMPa?: number;
  fractureMPa?: number;
  name: string;
}
export interface FoamLabRow {
  id: string;
  source: string;
  preparation: "pressurized" | "atmospheric" | "unknown";
  pressureMPaAbs: number;
  temperatureC: number;
  qualityPct: number;
  pvCp: number;
  ypPa: number;
  stabilityMin?: number;
  thickeningMin?: number;
  compressiveMPa?: number;
  permeabilityMd?: number;
}
export interface FoamBuffer {
  name: string;
  volumeM3: number;
  density: number;
  pvCp: number;
  ypPa: number;
}
export interface FoamSettings {
  foamVolumeMultiplier: number;
  recipeId: string;
  baseDensity: number;
  waterCementRatio: number;
  yieldM3PerTon: number;
  foamerPctBWOC: number;
  liquidPV: number;
  liquidYP: number;
  mudPV: number;
  mudYP: number;
  pumpRateLps: number;
  targetFoamQuality: number;
  controlMode: "reference-quality" | "constant-density";
  targetDensity: number;
  referenceMode: "depth" | "generator";
  referenceMD: number;
  referencePressureMPa: number;
  referenceTemperatureC: number;
  standardTemperatureC: number;
  backPressure: number;
  surfaceTemperature: number;
  bottomTemperature: number;
  temperatureMode: "static" | "circulating";
  thermalResponseMin: number;
  cementTopMD: number;
  buffers: FoamBuffer[];
  zones: FoamZone[];
  formations: FoamFormation[];
  fractureGradient: number;
  poreGradient: number | null;
  limitsSource: string;
  maxPumpPressureMPa: number;
  maxN2RateStdM3Min: number;
  maxN2PressureMPa: number;
  maxSlurryRateLps: number;
  n2AvailableStdM3: number;
  pauseAfterFoamMin: number;
  finalHoldMin: number;
  frictionMultiplier: number;
  roughnessMm: number;
  spatialCells: number;
  timeStepMin: number;
  lab: FoamLabRow[];
}
export interface FoamJobInput {
  wellData: WellData;
  mudDensity: number;
  settings: FoamSettings;
}
export interface FoamDesignPoint {
  md: number;
  tvd: number;
  pressureMPaAbs: number;
  temperatureC: number;
  qualityPct: number;
  density: number;
  z: number;
  localVolumeM3: number;
  baseVolumeM3: number;
  n2StdM3: number;
  gasStdPerBase: number;
}
export interface FoamStage {
  id: string;
  name: string;
  kind: FoamFluidKind | "pause";
  liquidVolumeM3: number;
  liquidRateLps: number;
  gasStdPerBase: number;
  density: number;
  pvCp: number;
  ypPa: number;
  durationMin: number;
  backPressureMPa: number;
}
export interface FoamDesign {
  points: FoamDesignPoint[];
  annulusVolumeM3: number;
  plannedFoamVolumeM3: number;
  pipeCapacityM3: number;
  baseSlurryM3: number;
  n2StdM3: number;
  stages: FoamStage[];
  notes: string[];
  reference: {
    md: number | null;
    pressureMPaAbs: number;
    temperatureC: number;
    qualityPct: number;
    density: number;
  };
  cementTonnes: number;
  waterM3: number;
  foamerKg: number;
  recipeMassMismatchPct: number;
}
export interface FoamCellState {
  leg: "pipe" | "annulus";
  mdTop: number;
  mdBottom: number;
  md: number;
  tvd: number;
  areaM2: number;
  capacityM3: number;
  pressureMPaAbs: number;
  temperatureC: number;
  density: number;
  qualityPct: number;
  z: number;
  velocityMps: number;
  fractions: Record<FoamFluidKind, number>;
  baseFoamM3: number;
  n2StdM3: number;
  foamVolumeM3: number;
}
export interface FoamFrame {
  time: number;
  stage: string;
  liquidRateLps: number;
  n2RateStdM3Min: number;
  foamerRateKgMin: number;
  pumpPressureMPa: number;
  hydroPumpPressureMPa: number;
  annulusBHPMPa: number;
  staticBHPMPa: number;
  dynamicECD: number;
  staticECD: number;
  frictionMPa: number;
  cumulativeBaseM3: number;
  cumulativeN2StdM3: number;
  cumulativeInjectedLiquidM3: number;
  retainedN2StdM3: number;
  returnedN2StdM3: number;
  retainedBaseM3: number;
  returnedBaseM3: number;
  foamInAnnulusM3: number;
  foamTopMD: number | null;
  baseBalanceErrorPct: number;
  gasBalanceErrorPct: number;
  formationMargins: {
    name: string;
    md: number;
    pressureMPa: number;
    poreMarginMPa: number | null;
    fractureMarginMPa: number | null;
  }[];
  converged: boolean;
  residualMPa: number;
  iterations: number;
  freeFall: boolean;
  boundaryBackflowM3: number;
  cells: FoamCellState[];
}
export interface FoamSimulation {
  modelVersion: string;
  createdAt: string;
  input: FoamJobInput;
  design: FoamDesign;
  frames: FoamFrame[];
  summary: {
    durationMin: number;
    maxPumpPressureMPa: number;
    maxECD: number;
    maxN2RateStdM3Min: number;
    finalTOCMD: number | null;
    maxGasBalanceErrorPct: number;
    maxBaseBalanceErrorPct: number;
    finalFoamAnnulusM3: number;
    nonConvergedFrames: number;
    freeFallFrames: number;
  };
  constraints: {
    label: string;
    pass: boolean;
    actual: number;
    limit: number;
    unit: string;
  }[];
  warnings: string[];
}
export interface FoamObservation {
  timeMin: number;
  pumpPressureMPa?: number;
  slurryRateLps?: number;
  n2RateStdM3Min?: number;
  density?: number;
}
export interface FoamPlanFact {
  samples: {
    timeMin: number;
    observedPressure: number | null;
    plannedPressure: number;
    residual: number | null;
    observedN2: number | null;
    plannedN2: number;
  }[];
  pressureRMSE: number | null;
  pressureBias: number | null;
  measuredN2StdM3: number;
  plannedN2SamePeriodStdM3: number;
  startMin: number;
  endMin: number;
  coveragePct: number;
  suggestedFrictionMultiplier: number | null;
  fittedRMSE: number | null;
  warnings: string[];
}
export interface FoamCandidate {
  input: FoamJobInput;
  feasible: boolean;
  n2StdM3: number;
  durationMin: number;
  maxPressureMPa: number;
  minMarginMPa: number | null;
  score: number;
  reasons: string[];
}
export interface FoamReportBundle {
  simulation: FoamSimulation;
  observations: FoamObservation[];
  planFact?: FoamPlanFact;
}
