import type {
  Additive,
  BufferFluid,
  CavernInterval,
  CasingSection,
  DisplacementFluid,
  DrillingFluid,
  FlowRateStep,
  ReservoirLayer,
  Rheology,
  SlurryInput,
  TrajectoryPoint,
  WellData,
} from "./cementing-calculations";

export interface CementingSnapshot {
  wellData: WellData;
  drillingFluid: DrillingFluid;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  displacementFluids: DisplacementFluid[];
  fractureGradient: number;
  flushTimeMin: number;
  flushVolumeM3: number;
}

export const defaultWellData: WellData = {
  wellDepthMD: 0,
  wellDepthTVD: 0,
  casingDepthMD: 0,
  holeDiameter: 0,
  casingOD: 0,
  casingWall: 0,
  prevCasingDepth: 0,
  prevCasingOD: 0,
  prevCasingID: 0,
  ckodDepth: 0,
  cementRiseHeight: 0,
  cavernCoeff: 1.0,
  bottomTempStatic: 0,
  bottomTempCirc: 0,
  trajectory: [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }],
  reservoirLayers: [],
};

export const defaultDrillingFluid: DrillingFluid = {
  name: "",
  density: 0,
  rheology: { pv: 0, yp: 0 },
  fluidLoss: 0,
};

export const defaultCementingSnapshot: CementingSnapshot = {
  wellData: defaultWellData,
  drillingFluid: defaultDrillingFluid,
  slurries: [],
  buffers: [],
  displacementFluids: [],
  fractureGradient: 17.7,
  flushTimeMin: 10,
  flushVolumeM3: 0,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const toString = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const normalizeBufferType = (value: unknown): BufferFluid["bufferType"] => {
  if (
    value === "chemical_wash" ||
    value === "elastic_spacer" ||
    value === "cement_wash" ||
    value === "water" ||
    value === "weighted"
  ) {
    return value;
  }
  return undefined;
};

function normalizeRheology(value: unknown, fallback: Rheology = { pv: 0, yp: 0 }): Rheology {
  const source = isRecord(value) ? value : {};
  return {
    pv: toNumber(source.pv, fallback.pv),
    yp: toNumber(source.yp, fallback.yp),
  };
}

function normalizeAdditive(value: unknown): Additive {
  const source = isRecord(value) ? value : {};
  return {
    name: toString(source.name),
    percentage: toNumber(source.percentage, 0),
    percentageType: source.percentageType === "bwob" ? "bwob" : "bwoc",
    massKg: toNumber(source.massKg, 0),
  };
}

function normalizeFlowRateSteps(value: unknown, fallbackRate = 0, fallbackVolume = 0): FlowRateStep[] {
  const rawSteps = Array.isArray(value) ? value : [];
  const normalized = rawSteps
    .filter(isRecord)
    .map((step) => ({
      rateLps: toNumber(step.rateLps, fallbackRate),
      volumeM3: toNumber(step.volumeM3, fallbackVolume),
    }));

  return normalized.length > 0
    ? normalized
    : [{ rateLps: fallbackRate, volumeM3: fallbackVolume }];
}

function normalizeTrajectoryPoint(value: unknown): TrajectoryPoint {
  const source = isRecord(value) ? value : {};
  const md = toNumber(source.md, 0);
  return {
    md,
    azimuth: toNumber(source.azimuth, 0),
    zenith: toNumber(source.zenith, 0),
    tvd: toNumber(source.tvd, md),
  };
}

function normalizeCasingSection(value: unknown): CasingSection {
  const source = isRecord(value) ? value : {};
  return {
    fromMD: toNumber(source.fromMD, 0),
    toMD: toNumber(source.toMD, 0),
    wallThickness: toNumber(source.wallThickness, 0),
  };
}

function normalizeCavernInterval(value: unknown): CavernInterval {
  const source = isRecord(value) ? value : {};
  return {
    fromMD: toNumber(source.fromMD, 0),
    toMD: toNumber(source.toMD, 0),
    coeff: toNumber(source.coeff, 1),
  };
}

function normalizeReservoirLayer(value: unknown): ReservoirLayer {
  const source = isRecord(value) ? value : {};
  return {
    name: toString(source.name, "Пласт"),
    topMD: toNumber(source.topMD, 0),
    bottomMD: toNumber(source.bottomMD, 0),
    porePressureGrad: toNumber(source.porePressureGrad, 0),
    fracGrad: toNumber(source.fracGrad, 0),
    absorbGrad: toNumber(source.absorbGrad, 0),
    fluidType: toString(source.fluidType, "нефть"),
  };
}

export function normalizeWellData(value: unknown): WellData {
  const source = isRecord(value) ? value : {};
  const trajectory = Array.isArray(source.trajectory)
    ? source.trajectory.filter(isRecord).map(normalizeTrajectoryPoint)
    : defaultWellData.trajectory;
  const casingSections = Array.isArray(source.casingSections)
    ? source.casingSections.filter(isRecord).map(normalizeCasingSection)
    : undefined;
  const cavernIntervals = Array.isArray(source.cavernIntervals)
    ? source.cavernIntervals.filter(isRecord).map(normalizeCavernInterval)
    : undefined;

  const reservoirLayers = Array.isArray(source.reservoirLayers)
    ? source.reservoirLayers.filter(isRecord).map(normalizeReservoirLayer)
    : undefined;

  return {
    wellDepthMD: toNumber(source.wellDepthMD, defaultWellData.wellDepthMD),
    wellDepthTVD: toNumber(source.wellDepthTVD, defaultWellData.wellDepthTVD),
    casingDepthMD: toNumber(source.casingDepthMD, defaultWellData.casingDepthMD),
    holeDiameter: toNumber(source.holeDiameter, defaultWellData.holeDiameter),
    casingOD: toNumber(source.casingOD, defaultWellData.casingOD),
    casingWall: toNumber(source.casingWall, defaultWellData.casingWall),
    prevCasingDepth: toNumber(source.prevCasingDepth, defaultWellData.prevCasingDepth),
    prevCasingOD: toNumber(source.prevCasingOD, defaultWellData.prevCasingOD),
    prevCasingID: toNumber(source.prevCasingID, defaultWellData.prevCasingID),
    ckodDepth: toNumber(source.ckodDepth, defaultWellData.ckodDepth),
    cementRiseHeight: toNumber(source.cementRiseHeight, defaultWellData.cementRiseHeight),
    cavernCoeff: toNumber(source.cavernCoeff, defaultWellData.cavernCoeff),
    bottomTempStatic: toNumber(source.bottomTempStatic, defaultWellData.bottomTempStatic),
    bottomTempCirc: toNumber(source.bottomTempCirc, defaultWellData.bottomTempCirc),
    trajectory: trajectory.length > 0 ? trajectory : defaultWellData.trajectory,
    casingSections: casingSections && casingSections.length > 0 ? casingSections : undefined,
    cavernIntervals: cavernIntervals && cavernIntervals.length > 0 ? cavernIntervals : undefined,
    reservoirLayers: reservoirLayers && reservoirLayers.length > 0 ? reservoirLayers : undefined,
  };
}

export function normalizeDrillingFluid(value: unknown): DrillingFluid {
  const source = isRecord(value) ? value : {};
  const bottomhole = normalizeRheology(
    isRecord(source.rheologyBottomhole)
      ? source.rheologyBottomhole
      : { pv: source.pvBottom, yp: source.ypBottom },
  );

  return {
    name: toString(source.name),
    density: toNumber(source.density, 0),
    rheology: normalizeRheology(
      isRecord(source.rheology) ? source.rheology : { pv: source.pv, yp: source.yp },
    ),
    rheologyBottomhole:
      bottomhole.pv > 0 || bottomhole.yp > 0
        ? bottomhole
        : undefined,
    fluidLoss: toNumber(source.fluidLoss, 0),
  };
}

export function normalizeSlurryInput(value: unknown, index = 0): SlurryInput {
  const source = isRecord(value) ? value : {};
  const fallbackRate = toNumber(source.flowRateLps, 0);

  return {
    name: toString(source.name, `Раствор ${index + 1}`),
    density: toNumber(source.density, 0),
    topDepthMD: toNumber(source.topDepthMD, 0),
    rheology: normalizeRheology(
      isRecord(source.rheology) ? source.rheology : { pv: source.pv, yp: source.yp },
    ),
    additives: Array.isArray(source.additives)
      ? source.additives.filter(isRecord).map(normalizeAdditive)
      : [],
    thickeningTime30Bc: toNumber(source.thickeningTime30Bc, 0),
    thickeningTime50Bc: toNumber(source.thickeningTime50Bc, 0),
    flowRateSteps: normalizeFlowRateSteps(source.flowRateSteps, fallbackRate, 0),
    waterRatio: toNumber(source.waterRatio, 0),
    yieldPerTon: toNumber(source.yieldPerTon, 0),
    washVolume: toNumber(source.washVolume, 0),
  };
}

export function normalizeBufferFluid(value: unknown, index = 0): BufferFluid {
  const source = isRecord(value) ? value : {};
  const volume = toNumber(source.volume, 0);
  const fallbackRate = toNumber(source.flowRateLps, 0);

  return {
    name: toString(source.name, `Буфер ${index + 1}`),
    bufferType: normalizeBufferType(source.bufferType),
    density: toNumber(source.density, 0),
    volume,
    rheology: normalizeRheology(
      isRecord(source.rheology) ? source.rheology : { pv: source.pv, yp: source.yp },
    ),
    additives: Array.isArray(source.additives)
      ? source.additives.filter(isRecord).map(normalizeAdditive)
      : [],
    flowRateSteps: normalizeFlowRateSteps(source.flowRateSteps, fallbackRate, volume),
  };
}

export function normalizeDisplacementFluid(value: unknown, index = 0): DisplacementFluid {
  const source = isRecord(value) ? value : {};
  const fallbackRate = toNumber(source.flowRateLps, 0);

  return {
    name: toString(source.name, `Порция ${index + 1}`),
    density: toNumber(source.density, 0),
    rheology: normalizeRheology(
      isRecord(source.rheology) ? source.rheology : { pv: source.pv, yp: source.yp },
    ),
    flowRateSteps: normalizeFlowRateSteps(source.flowRateSteps, fallbackRate, 0),
    compressionCoeff: toNumber(source.compressionCoeff, 1) || 1,
  };
}

export function normalizeCementingSnapshot(value: unknown): CementingSnapshot {
  const source = isRecord(value) ? value : {};

  return {
    wellData: normalizeWellData(source.wellData),
    drillingFluid: normalizeDrillingFluid(source.drillingFluid),
    slurries: Array.isArray(source.slurries)
      ? source.slurries.map((item, index) => normalizeSlurryInput(item, index))
      : [],
    buffers: Array.isArray(source.buffers)
      ? source.buffers.map((item, index) => normalizeBufferFluid(item, index))
      : [],
    displacementFluids: Array.isArray(source.displacementFluids)
      ? source.displacementFluids.map((item, index) => normalizeDisplacementFluid(item, index))
      : [],
    fractureGradient: toNumber(source.fractureGradient, defaultCementingSnapshot.fractureGradient),
    flushTimeMin: toNumber(source.flushTimeMin, defaultCementingSnapshot.flushTimeMin),
    flushVolumeM3: toNumber(source.flushVolumeM3, defaultCementingSnapshot.flushVolumeM3),
  };
}