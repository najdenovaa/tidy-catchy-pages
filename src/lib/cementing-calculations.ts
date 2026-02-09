// Core cementing calculation formulas

export interface Rheology {
  pv: number; // Пластическая вязкость, сПз
  yp: number; // ДНС (динамическое напряжение сдвига), Па
}

export interface DrillingFluid {
  name: string;
  density: number; // г/см³
  rheology: Rheology;
}

export interface WellData {
  wellDepthMD: number;
  wellDepthTVD: number;
  casingDepthMD: number;
  holeDiameter: number; // мм
  casingOD: number; // мм
  casingWall: number; // мм
  prevCasingDepth: number;
  prevCasingID: number; // мм
  ckodDepth: number;
  cementRiseHeight: number;
  cavernCoeff: number;
  bottomTemp: number;
  maxAngle: number;
  maxAngleDepth: number;
}

// Авто-расчёт внутреннего диаметра колонны
export function getCasingID(casingOD: number, casingWall: number): number {
  return casingOD - 2 * casingWall;
}

export interface CementSlurry {
  name: string;
  density: number;
  height: number;
  waterRatio: number;
}

export interface BufferFluid {
  name: string;
  density: number; // кг/м³
  volume: number; // м³
  rheology: Rheology;
}

export interface SlurryInput {
  name: string;
  density: number;
  height: number;
  rheology: Rheology;
}

export interface VolumeResults {
  wellVolumePerMeter: number;
  wellVolumeWithCavern: number;
  annularVolumePerMeter: number;
  pipeVolumePerMeter: number;
  totalAnnularVolume: number;
  totalPipeVolume: number;
  displacementVolume: number;
  equivalentDiameter: number;
  casingID: number;
}

export interface CementResults {
  slurryVolume: number;
  dryMass: number;
  waterVolume: number;
}

export interface HydraulicResults {
  hydrostaticPressurePipe: number;
  hydrostaticPressureAnnulus: number;
  fractureGradient: number;
  fracturePressure: number;
  safetyCoefficient: number;
  maxWorkPressure: number;
  stopPressure: number;
}

export interface ContactTimeResults {
  bufferHeightAnnulus: number;
  bufferVelocity: number;
  contactTime: number;
}

export function wellVolumePerMeter(diameterMm: number): number {
  const d = diameterMm / 1000;
  return (Math.PI / 4) * d * d;
}

export function wellVolumeWithCavern(diameterMm: number, cavCoeff: number): number {
  return wellVolumePerMeter(diameterMm) * cavCoeff;
}

export function annularVolumePerMeter(holeDiamMm: number, casingODmm: number, cavCoeff: number): number {
  const dHole = holeDiamMm / 1000;
  const dCasing = casingODmm / 1000;
  return (Math.PI / 4) * (dHole * dHole * cavCoeff - dCasing * dCasing);
}

export function pipeVolumePerMeter(casingIDmm: number): number {
  const d = casingIDmm / 1000;
  return (Math.PI / 4) * d * d;
}

export function equivalentDiameter(holeDiamMm: number, cavCoeff: number): number {
  return holeDiamMm * Math.sqrt(cavCoeff);
}

export function displacementVolume(pipeVolPerM: number, ckodDepth: number, isWater: boolean = true): number {
  const coeff = isWater ? 1.03 : 1.06;
  return pipeVolPerM * ckodDepth * coeff;
}

export function calculateVolumes(data: WellData): VolumeResults {
  const casingID = getCasingID(data.casingOD, data.casingWall);
  const wellVPM = wellVolumePerMeter(data.holeDiameter);
  const wellVCav = wellVolumeWithCavern(data.holeDiameter, data.cavernCoeff);
  const annVPM = annularVolumePerMeter(data.holeDiameter, data.casingOD, data.cavernCoeff);
  const pipeVPM = pipeVolumePerMeter(casingID);
  const eqDiam = equivalentDiameter(data.holeDiameter, data.cavernCoeff);

  const cementInterval = data.cementRiseHeight;
  const totalAnnular = annVPM * cementInterval;
  const totalPipe = pipeVPM * data.ckodDepth;
  const dispVol = displacementVolume(pipeVPM, data.ckodDepth, true);

  return {
    wellVolumePerMeter: wellVPM,
    wellVolumeWithCavern: wellVCav,
    annularVolumePerMeter: annVPM,
    pipeVolumePerMeter: pipeVPM,
    totalAnnularVolume: totalAnnular,
    totalPipeVolume: totalPipe,
    displacementVolume: dispVol,
    equivalentDiameter: eqDiam,
    casingID,
  };
}

const DENSITY_TABLE: [number, number, number][] = [
  [1400, 1.706, 1.368], [1450, 1.517, 1.199], [1500, 1.365, 1.048],
  [1550, 1.241, 0.923], [1600, 1.138, 0.82], [1650, 1.05, 0.733],
  [1700, 0.975, 0.658], [1750, 0.91, 0.593], [1800, 0.853, 0.536],
  [1850, 0.803, 0.485], [1900, 0.758, 0.441], [1950, 0.718, 0.401],
  [2000, 0.683, 0.365],
];

export function getWaterCementRatio(densityKgM3: number): number {
  for (let i = 0; i < DENSITY_TABLE.length - 1; i++) {
    if (densityKgM3 >= DENSITY_TABLE[i][0] && densityKgM3 <= DENSITY_TABLE[i + 1][0]) {
      const frac = (densityKgM3 - DENSITY_TABLE[i][0]) / (DENSITY_TABLE[i + 1][0] - DENSITY_TABLE[i][0]);
      return DENSITY_TABLE[i][2] + frac * (DENSITY_TABLE[i + 1][2] - DENSITY_TABLE[i][2]);
    }
  }
  if (densityKgM3 <= DENSITY_TABLE[0][0]) return DENSITY_TABLE[0][2];
  return DENSITY_TABLE[DENSITY_TABLE.length - 1][2];
}

export function calculateCement(
  annularVPM: number,
  height: number,
  densityGcm3: number,
  cementDensityDry: number = 3.15
): CementResults {
  const slurryVolume = annularVPM * height;
  const densityKg = densityGcm3 * 1000;
  const wcr = getWaterCementRatio(densityKg);
  const slurryMassKg = slurryVolume * densityKg;
  const dryMassKg = slurryMassKg / (1 + wcr);
  const dryMassTons = dryMassKg / 1000;
  const waterVolume = (dryMassKg * wcr) / 1000;

  return { slurryVolume, dryMass: dryMassTons, waterVolume };
}

export function hydrostaticPressure(density: number, depthTVD: number): number {
  return density * depthTVD * 0.00981;
}

export function calculateHydraulics(
  data: WellData,
  lightCement: CementSlurry | null,
  heavyCement: CementSlurry,
  fractureGradientKpaM: number
): HydraulicResults {
  const pipePressure = hydrostaticPressure(1.0, data.wellDepthTVD);
  let annulusPressure = 0;
  const mudHeight = data.wellDepthTVD - (lightCement ? lightCement.height : 0) - heavyCement.height;
  annulusPressure += hydrostaticPressure(1.16, Math.max(0, mudHeight));
  if (lightCement && lightCement.height > 0) {
    annulusPressure += hydrostaticPressure(lightCement.density, lightCement.height);
  }
  annulusPressure += hydrostaticPressure(heavyCement.density, heavyCement.height);

  const fracturePressure = (fractureGradientKpaM * data.wellDepthTVD) / 1000;
  const safetyCoeff = annulusPressure / fracturePressure;
  const differentialPressure = annulusPressure - pipePressure;
  const maxWorkPressure = differentialPressure;
  const stopPressure = maxWorkPressure * 1.2;

  return {
    hydrostaticPressurePipe: pipePressure,
    hydrostaticPressureAnnulus: annulusPressure,
    fractureGradient: fractureGradientKpaM,
    fracturePressure,
    safetyCoefficient: safetyCoeff,
    maxWorkPressure: Math.abs(maxWorkPressure),
    stopPressure: Math.abs(stopPressure),
  };
}

export function calculateContactTime(
  bufferVolume: number,
  annularVPM: number,
  flowRate: number
): ContactTimeResults {
  const bufferHeight = bufferVolume / annularVPM;
  const velocity = flowRate / annularVPM;
  const contactTime = bufferHeight / velocity;
  return { bufferHeightAnnulus: bufferHeight, bufferVelocity: velocity, contactTime };
}

export function calculateBHCT(bottomTempC: number, surfaceTempC: number = 20, depthM: number = 3200): number {
  const bhstF = bottomTempC * 9 / 5 + 32;
  const depthFt = depthM * 3.28084;
  const ratio = 0.7 + 0.3 * (depthFt / 15000);
  const bhctF = 68 + (bhstF - 68) * ratio;
  return (bhctF - 32) * 5 / 9;
}

// Потери давления на трение (упрощённая формула Букингема-Рейнера для Бингамовской модели)
export function frictionPressureLoss(
  flowRateM3min: number,
  lengthM: number,
  dHydMm: number,
  pv: number, // сПз
  yp: number, // Па
  density: number // кг/м³
): number {
  const dHyd = dHydMm / 1000;
  const area = (Math.PI / 4) * dHyd * dHyd;
  const velocityMs = (flowRateM3min / 60) / area;
  const pvPas = pv / 1000;
  
  // Потери на трение, МПа
  const frictionLaminar = (32 * pvPas * velocityMs * lengthM) / (dHyd * dHyd) / 1e6;
  const yieldTerm = (16 * yp * lengthM) / (3 * dHyd) / 1e6;
  
  return frictionLaminar + yieldTerm;
}

// Расчёт давлений по стадиям закачки для графиков
export interface PressurePoint {
  stage: string;
  time: number; // мин (накопленное)
  surfacePressure: number; // МПа
  bottomholePressure: number; // МПа
  fracturePressure: number; // МПа
}

export function calculatePressureProfile(
  wellData: WellData,
  slurries: SlurryInput[],
  buffers: BufferFluid[],
  drillingFluid: DrillingFluid,
  fractureGradient: number,
  flowRate: number,
  displacementVol: number
): PressurePoint[] {
  const points: PressurePoint[] = [];
  const fracP = (fractureGradient * wellData.wellDepthTVD) / 1000;
  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);
  const dHydAnn = wellData.holeDiameter - wellData.casingOD; // гидравлич. диам. затруба, мм
  const dHydPipe = casingID; // гидравлич. диам. трубы, мм

  let cumTime = 0;
  
  // Начальная точка
  const hydroMud = hydrostaticPressure(drillingFluid.density, wellData.wellDepthTVD);
  points.push({ stage: "Начало", time: 0, surfacePressure: 0, bottomholePressure: hydroMud, fracturePressure: fracP });

  const stages: { name: string; volume: number; density: number; pv: number; yp: number }[] = [];
  
  buffers.forEach(b => stages.push({ name: b.name, volume: b.volume, density: b.density / 1000, pv: b.rheology.pv, yp: b.rheology.yp }));
  slurries.forEach(s => {
    const vol = s.height > 0 ? s.height * annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, wellData.cavernCoeff) : 0;
    if (vol > 0) stages.push({ name: s.name, volume: vol, density: s.density, pv: s.rheology.pv, yp: s.rheology.yp });
  });
  stages.push({ name: "Продавка", volume: displacementVol, density: 1.0, pv: 1, yp: 0 });

  stages.forEach(s => {
    const stageTime = flowRate > 0 ? s.volume / flowRate : 0;
    cumTime += stageTime;
    
    // Упрощённый расчёт: потери в трубе + потери в затрубе
    const frPipe = frictionPressureLoss(flowRate, wellData.casingDepthMD, dHydPipe, s.pv, s.yp, s.density * 1000);
    const frAnn = frictionPressureLoss(flowRate, wellData.casingDepthMD, Math.max(dHydAnn, 10), drillingFluid.rheology.pv, drillingFluid.rheology.yp, drillingFluid.density * 1000);
    
    const bhp = hydroMud + frPipe + frAnn;
    const surfP = frPipe + frAnn;
    
    points.push({ stage: s.name, time: cumTime, surfacePressure: surfP, bottomholePressure: bhp, fracturePressure: fracP });
  });

  return points;
}
