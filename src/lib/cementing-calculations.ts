// Core cementing calculation formulas

export interface WellData {
  wellDepthMD: number; // Глубина скважины по стволу, м
  wellDepthTVD: number; // Глубина скважины по вертикали, м
  casingDepthMD: number; // Глубина спуска колонны по стволу, м
  holeDiameter: number; // Диаметр открытого ствола, мм
  casingOD: number; // Наружный диаметр обсадной колонны, мм
  casingID: number; // Внутренний диаметр обсадной колонны, мм
  casingWall: number; // Толщина стенки колонны, мм
  prevCasingDepth: number; // Глубина предыдущей колонны, м
  prevCasingID: number; // Внутренний диаметр пред. колонны, мм
  ckodDepth: number; // Глубина ЦКОД, м
  cementRiseHeight: number; // Высота подъёма цемента, м
  cavernCoeff: number; // Коэффициент кавернозности
  mudDensity: number; // Плотность бурового раствора, г/см3
  bottomTemp: number; // Статическая температура на забое, °C
  maxAngle: number; // Максимальный зенитный угол, градус
  maxAngleDepth: number; // Глубина макс. угла, м
}

export interface CementSlurry {
  name: string;
  density: number; // г/см3
  height: number; // высота подъёма, м
  waterRatio: number; // водоцементное отношение
}

export interface BufferFluid {
  name: string;
  density: number; // кг/м3
  volume: number; // м3
}

export interface VolumeResults {
  wellVolumePerMeter: number; // V п.м. скважины, м3/м
  wellVolumeWithCavern: number; // V п.м. скважины с кав-тью, м3/м
  annularVolumePerMeter: number; // V п.м. затруба, м3/м
  pipeVolumePerMeter: number; // V п.м. трубного, м3/м
  totalAnnularVolume: number; // Общий объём затрубного пространства, м3
  totalPipeVolume: number; // Общий объём трубного пространства, м3
  displacementVolume: number; // Объём продавочной жидкости, м3
  equivalentDiameter: number; // Эквивалентный диаметр, мм
}

export interface CementResults {
  slurryVolume: number; // Объём цементного раствора, м3
  dryMass: number; // Масса сухого цемента, тн
  waterVolume: number; // Объём воды для затворения, м3
}

export interface HydraulicResults {
  hydrostaticPressurePipe: number; // Гидростатика в трубном, МПа
  hydrostaticPressureAnnulus: number; // Гидростатика в затрубном, МПа
  fractureGradient: number; // Градиент разрыва, кПа/м
  fracturePressure: number; // Давление гидроразрыва, МПа
  safetyCoefficient: number; // Коэффициент безопасности
  maxWorkPressure: number; // Максимальное рабочее давление, МПа
  stopPressure: number; // Давление "СТОП", МПа
}

export interface ContactTimeResults {
  bufferHeightAnnulus: number; // Высота буфера в затрубе, м
  bufferVelocity: number; // Скорость буфера, м/мин
  contactTime: number; // Время контакта, мин
}

// V п.м. скважины = π/4 × D² (м3/м)
export function wellVolumePerMeter(diameterMm: number): number {
  const d = diameterMm / 1000;
  return (Math.PI / 4) * d * d;
}

// V п.м. с учётом кавернозности
export function wellVolumeWithCavern(diameterMm: number, cavCoeff: number): number {
  return wellVolumePerMeter(diameterMm) * cavCoeff;
}

// V п.м. затрубного пространства
export function annularVolumePerMeter(holeDiamMm: number, casingODmm: number, cavCoeff: number): number {
  const dHole = holeDiamMm / 1000;
  const dCasing = casingODmm / 1000;
  return (Math.PI / 4) * (dHole * dHole * cavCoeff - dCasing * dCasing);
}

// V п.м. трубного пространства
export function pipeVolumePerMeter(casingIDmm: number): number {
  const d = casingIDmm / 1000;
  return (Math.PI / 4) * d * d;
}

// Эквивалентный диаметр с учётом кавернозности
export function equivalentDiameter(holeDiamMm: number, cavCoeff: number): number {
  return holeDiamMm * Math.sqrt(cavCoeff);
}

// Объём продавочной жидкости (водой — коэфф 1.03, бурраствором — 1.06)
export function displacementVolume(pipeVolPerM: number, ckodDepth: number, isWater: boolean = true): number {
  const coeff = isWater ? 1.03 : 1.06;
  return pipeVolPerM * ckodDepth * coeff;
}

// Расчёт объёмов
export function calculateVolumes(data: WellData): VolumeResults {
  const wellVPM = wellVolumePerMeter(data.holeDiameter);
  const wellVCav = wellVolumeWithCavern(data.holeDiameter, data.cavernCoeff);
  const annVPM = annularVolumePerMeter(data.holeDiameter, data.casingOD, data.cavernCoeff);
  const pipeVPM = pipeVolumePerMeter(data.casingID);
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
  };
}

// Таблица плотность → водоцементное отношение (из Excel)
const DENSITY_TABLE: [number, number, number][] = [
  [1400, 1.706, 1.368], [1450, 1.517, 1.199], [1500, 1.365, 1.048],
  [1550, 1.241, 0.923], [1600, 1.138, 0.82], [1650, 1.05, 0.733],
  [1700, 0.975, 0.658], [1750, 0.91, 0.593], [1800, 0.853, 0.536],
  [1850, 0.803, 0.485], [1900, 0.758, 0.441], [1950, 0.718, 0.401],
  [2000, 0.683, 0.365],
];

// Интерполяция водоцементного отношения по плотности
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

// Расчёт цементного раствора
export function calculateCement(
  annularVPM: number,
  height: number,
  densityGcm3: number,
  cementDensityDry: number = 3.15 // г/см3 — плотность зёрен цемента
): CementResults {
  const slurryVolume = annularVPM * height;
  const densityKg = densityGcm3 * 1000;
  const wcr = getWaterCementRatio(densityKg);

  // Масса цемента: V_раствора × плотность_раствора / (1 + В/Ц)
  const slurryMassKg = slurryVolume * densityKg;
  const dryMassKg = slurryMassKg / (1 + wcr);
  const dryMassTons = dryMassKg / 1000;
  const waterVolume = (dryMassKg * wcr) / 1000; // м3

  return {
    slurryVolume,
    dryMass: dryMassTons,
    waterVolume,
  };
}

// Гидростатическое давление, МПа
export function hydrostaticPressure(density: number, depthTVD: number): number {
  return density * depthTVD * 0.00981;
}

// Гидравлический расчёт
export function calculateHydraulics(
  data: WellData,
  lightCement: CementSlurry | null,
  heavyCement: CementSlurry,
  fractureGradientKpaM: number
): HydraulicResults {
  // Давление в трубном (продавка водой)
  const pipePressure = hydrostaticPressure(1.0, data.wellDepthTVD);

  // Давление в затрубном (цемент)
  let annulusPressure = 0;
  const mudHeight = data.wellDepthTVD - (lightCement ? lightCement.height : 0) - heavyCement.height;
  annulusPressure += hydrostaticPressure(data.mudDensity, Math.max(0, mudHeight));
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

// Время контакта буфера
export function calculateContactTime(
  bufferVolume: number,
  annularVPM: number,
  flowRate: number // м3/мин
): ContactTimeResults {
  const bufferHeight = bufferVolume / annularVPM;
  const velocity = flowRate / annularVPM;
  const contactTime = bufferHeight / velocity;

  return {
    bufferHeightAnnulus: bufferHeight,
    bufferVelocity: velocity,
    contactTime,
  };
}

// BHCT по AMOCO (упрощённая формула)
export function calculateBHCT(bottomTempC: number, surfaceTempC: number = 20, depthM: number = 3200): number {
  const bhstF = bottomTempC * 9 / 5 + 32;
  const depthFt = depthM * 3.28084;
  // Упрощённая формула AMOCO
  const ratio = 0.7 + 0.3 * (depthFt / 15000);
  const bhctF = 68 + (bhstF - 68) * ratio;
  return (bhctF - 32) * 5 / 9;
}
