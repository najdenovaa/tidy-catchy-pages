// Core cementing calculation formulas

export interface Rheology {
  pv: number; // Пластическая вязкость, сПз
  yp: number; // ДНС (динамическое напряжение сдвига), Па
}

export interface Additive {
  name: string;
  percentage: number; // % от массы цемента (bwoc)
  massKg: number; // кг (автовычисляемое)
}

export interface FlowRateStep {
  rateLps: number; // л/с
  volumeM3: number; // м³
}

export interface DrillingFluid {
  name: string;
  density: number; // кг/м³
  rheology: Rheology;
  fluidLoss: number; // Водоотдача, мл/30мин
}

export interface DisplacementFluid {
  name: string;
  density: number; // кг/м³
  rheology: Rheology;
  flowRateSteps: FlowRateStep[];
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
  prevCasingOD: number; // мм
  ckodDepth: number;
  cementRiseHeight: number;
  cavernCoeff: number;
  bottomTempStatic: number; // BHST °C
  bottomTempCirc: number; // BHCT °C
}

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
  additives: Additive[];
  flowRateSteps: FlowRateStep[];
}

export interface SlurryInput {
  name: string;
  density: number; // г/см³ (input) / кг/м³ (internal)
  topDepthMD: number; // м — глубина верха цемента от устья
  rheology: Rheology;
  additives: Additive[];
  thickeningTime30Bc: number; // время загустевания до 30 Вс, мин
  thickeningTime50Bc: number; // время загустевания до 50 Вс, мин
  flowRateSteps: FlowRateStep[];
  waterRatio: number; // В/Ц (водоцементное отношение)
  yieldPerTon: number; // Выход раствора, м³/т
}

// Вычислить высоту столба цемента для i-го раствора
// Порядок: первый в списке = у устья (верхний), последний = у забоя (нижний)
export function getSlurryHeight(slurries: SlurryInput[], index: number, casingDepthMD: number): number {
  const s = slurries[index];
  const lastIdx = slurries.length - 1;
  // Нижняя граница: дно скважины для последнего, или верх следующего для остальных
  const bottomDepth = index === lastIdx ? casingDepthMD : slurries[index + 1].topDepthMD;
  return Math.max(0, bottomDepth - s.topDepthMD);
}

// Совместимый getter для flowRateLps (берёт первый шаг или 0)
export function getFlowRateLps(steps: FlowRateStep[]): number {
  return steps.length > 0 ? steps[0].rateLps : 0;
}

export interface Equipment {
  smn20: number;
  ca: number;
  skc: number;
  personnel: { role: string; count: number }[];
}

export interface VolumeResults {
  casingID: number;
  wellVolumePerMeter: number;
  wellVolumeWithCavern: number;
  annularVolumePerMeter: number;
  annularVolumePerMeterPrevCasing: number; // в пред. колонне
  pipeVolumePerMeter: number;
  openHoleVolumePerMeter: number; // V п.м. открытого ствола
  totalAnnularVolume: number;
  totalPipeVolume: number;
  displacementVolume: number;
  displacementVolumeWithCompression: number; // с коэф. сжатия
  equivalentDiameter: number;
}

export interface CementResults {
  slurryVolume: number;
  dryMass: number;
  waterVolume: number;
  yieldPerTon: number; // Выход раствора из 1 тонны, м³/т
  waterCementRatio: number;
}

export interface HydraulicResults {
  hydrostaticPressurePipe: number;
  hydrostaticPressureAnnulus: number;
  fractureGradient: number;
  fracturePressure: number;
  safetyCoefficient: number;
  differentialPressure: number;
  stopPressure: number;
}

export interface ContactTimeResults {
  bufferHeightAnnulus: number;
  bufferVelocity: number;
  contactTime: number;
}

export interface SafeTimeResults {
  workTimeWithCement: number; // мин
  safeTime75: number; // мин (75% от загуст.)
  thickeningTime30Bc: number;
  thickeningTime50Bc: number;
  isSafe: boolean;
}

export interface MaterialSummary {
  cementItems: { name: string; amount: number; unit: string }[];
  bufferItems: { name: string; amount: number; unit: string }[];
  equipmentItems: { name: string; amount: number; unit: string }[];
  waterForBuffers: number; // м³
  waterForCement: number; // м³
  waterReserve: number; // м³ (10%)
  waterTotal: number; // м³
}

// === Базовые формулы ===

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

// Межтрубное пространство (между пред. колонной и текущей)
export function interCasingVolumePerMeter(prevCasingIDmm: number, casingODmm: number): number {
  const d1 = prevCasingIDmm / 1000;
  const d2 = casingODmm / 1000;
  return (Math.PI / 4) * (d1 * d1 - d2 * d2);
}

export function pipeVolumePerMeter(casingIDmm: number): number {
  const d = casingIDmm / 1000;
  return (Math.PI / 4) * d * d;
}

export function equivalentDiameter(holeDiamMm: number, cavCoeff: number): number {
  return holeDiamMm * Math.sqrt(cavCoeff);
}

export function displacementVolume(pipeVolPerM: number, ckodDepth: number): number {
  return pipeVolPerM * ckodDepth;
}

// === Расчёт объёмов ===

export function calculateVolumes(data: WellData): VolumeResults {
  const casingID = getCasingID(data.casingOD, data.casingWall);
  const wellVPM = wellVolumePerMeter(data.holeDiameter);
  const wellVCav = wellVolumeWithCavern(data.holeDiameter, data.cavernCoeff);
  const annVPM = annularVolumePerMeter(data.holeDiameter, data.casingOD, data.cavernCoeff);
  const annVPMprev = interCasingVolumePerMeter(data.prevCasingID, data.casingOD);
  const pipeVPM = pipeVolumePerMeter(casingID);
  const openHoleVPM = wellVolumePerMeter(data.holeDiameter) * data.cavernCoeff;
  const eqDiam = equivalentDiameter(data.holeDiameter, data.cavernCoeff);

  const openHoleInterval = data.casingDepthMD - data.prevCasingDepth;
  const totalAnnular = annVPM * openHoleInterval + annVPMprev * data.prevCasingDepth;
  const totalPipe = pipeVPM * data.casingDepthMD;
  const dispVol = displacementVolume(pipeVPM, data.ckodDepth);
  const dispVolComp = dispVol * 1.05; // с коэф. сжатия 5%

  return {
    casingID,
    wellVolumePerMeter: wellVPM,
    wellVolumeWithCavern: wellVCav,
    annularVolumePerMeter: annVPM,
    annularVolumePerMeterPrevCasing: annVPMprev,
    pipeVolumePerMeter: pipeVPM,
    openHoleVolumePerMeter: openHoleVPM,
    totalAnnularVolume: totalAnnular,
    totalPipeVolume: totalPipe,
    displacementVolume: dispVol,
    displacementVolumeWithCompression: dispVolComp,
    equivalentDiameter: eqDiam,
  };
}

// === В/Ц таблица ===

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
): CementResults {
  const slurryVolume = annularVPM * height;
  const densityKg = densityGcm3 * 1000;
  const wcr = getWaterCementRatio(densityKg);
  const slurryMassKg = slurryVolume * densityKg;
  const dryMassKg = slurryMassKg / (1 + wcr);
  const dryMassTons = dryMassKg / 1000;
  const waterVolume = (dryMassKg * wcr) / 1000;
  const yieldPerTon = dryMassTons > 0 ? slurryVolume / dryMassTons : 0;

  return { slurryVolume, dryMass: dryMassTons, waterVolume, yieldPerTon, waterCementRatio: wcr };
}

// === Гидравлика ===

export function hydrostaticPressure(densityGcm3: number, depthTVD: number): number {
  return densityGcm3 * depthTVD * 0.00981;
}

export function calculateHydraulics(
  data: WellData,
  slurries: SlurryInput[],
  displacementDensity: number, // г/см³ продавочной жидкости
  fractureGradientKpaM: number
): HydraulicResults {
  // Трубное — продавочная жидкость
  const pipePressure = hydrostaticPressure(displacementDensity, data.wellDepthTVD);

  // Затрубное — цемент + бур. раствор
  let annulusPressure = 0;
  let cementTotalHeight = 0;
  slurries.forEach((s, i) => {
    const h = getSlurryHeight(slurries, i, data.casingDepthMD);
    if (h > 0) {
      annulusPressure += hydrostaticPressure(s.density, h);
      cementTotalHeight += h;
    }
  });
  const mudHeight = Math.max(0, data.wellDepthTVD - cementTotalHeight);
  // Use drilling fluid density (will be passed as parameter in future)
  annulusPressure += hydrostaticPressure(1.1, mudHeight); // fallback

  const fracturePressure = (fractureGradientKpaM * data.wellDepthTVD) / 1000;
  const safetyCoeff = fracturePressure > 0 ? annulusPressure / fracturePressure : 0;
  const differentialPressure = annulusPressure - pipePressure;
  const stopPressure = Math.abs(differentialPressure) + 3.0; // +30 атм как в PDF

  return {
    hydrostaticPressurePipe: pipePressure,
    hydrostaticPressureAnnulus: annulusPressure,
    fractureGradient: fractureGradientKpaM,
    fracturePressure,
    safetyCoefficient: safetyCoeff,
    differentialPressure: Math.abs(differentialPressure),
    stopPressure,
  };
}

// === Время контакта ===

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

// === BHCT ===

export function calculateBHCT(bottomTempC: number, surfaceTempC: number = 20, depthM: number = 3200): number {
  const bhstF = bottomTempC * 9 / 5 + 32;
  const depthFt = depthM * 3.28084;
  const ratio = 0.7 + 0.3 * (depthFt / 15000);
  const bhctF = 68 + (bhstF - 68) * ratio;
  return (bhctF - 32) * 5 / 9;
}

// === Безопасное время ===

export function calculateSafeTime(
  workTimeWithCement: number,
  thickeningTime30Bc: number,
  thickeningTime50Bc: number
): SafeTimeResults {
  const safeTime75 = Math.round(workTimeWithCement * 100 / 75);
  const isSafe = thickeningTime30Bc >= safeTime75;
  return { workTimeWithCement, safeTime75, thickeningTime30Bc, thickeningTime50Bc, isSafe };
}

// === Материалы ===

export function calculateMaterials(
  slurries: SlurryInput[],
  buffers: BufferFluid[],
  annularVPM: number,
  casingDepthMD: number,
): MaterialSummary {
  const cementItems: { name: string; amount: number; unit: string }[] = [];
  const bufferItems: { name: string; amount: number; unit: string }[] = [];
  let waterForCement = 0;
  let waterForBuffers = 0;

  slurries.forEach((s, i) => {
    const h = getSlurryHeight(slurries, i, casingDepthMD);
    if (h > 0) {
      const res = calculateCement(annularVPM, h, s.density);
      cementItems.push({ name: s.name, amount: res.dryMass, unit: "т" });
      waterForCement += res.waterVolume;
      s.additives.forEach(a => {
        if (a.name && a.massKg > 0) {
          cementItems.push({ name: a.name, amount: a.massKg, unit: "кг" });
        }
      });
    }
  });

  buffers.forEach(b => {
    bufferItems.push({ name: b.name, amount: b.volume, unit: "м³" });
    waterForBuffers += b.volume * 0.9; // ~90% вода
    b.additives.forEach(a => {
      if (a.name && a.massKg > 0) {
        bufferItems.push({ name: `  ${a.name}`, amount: a.massKg, unit: "кг" });
      }
    });
  });

  const waterReserve = (waterForCement + waterForBuffers) * 0.1;
  const waterTotal = waterForCement + waterForBuffers + waterReserve;

  return {
    cementItems,
    bufferItems,
    equipmentItems: [
      { name: "Башмак БКМ", amount: 1, unit: "шт" },
      { name: "Клапан ЦКОД", amount: 1, unit: "шт" },
      { name: "Пробка продавочная", amount: 1, unit: "шт" },
    ],
    waterForBuffers,
    waterForCement,
    waterReserve,
    waterTotal,
  };
}

// === Профиль давлений для графиков ===

export interface PressurePoint {
  stage: string;
  time: number;
  surfacePressure: number;
  bottomholePressure: number;
  fracturePressure: number;
  cumulativeVolume: number;
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
  const dHydAnn = Math.max(wellData.holeDiameter - wellData.casingOD, 10);
  const dHydPipe = casingID;

  const hydroMud = hydrostaticPressure(drillingFluid.density / 1000, wellData.wellDepthTVD);
  let cumTime = 0;
  let cumVol = 0;

  points.push({ stage: "Начало", time: 0, surfacePressure: 0, bottomholePressure: hydroMud, fracturePressure: fracP, cumulativeVolume: 0 });

  const stages: { name: string; volume: number; density: number; pv: number; yp: number }[] = [];

  buffers.forEach(b => stages.push({ name: b.name, volume: b.volume, density: b.density / 1000, pv: b.rheology.pv, yp: b.rheology.yp }));
  slurries.forEach((s, i) => {
    const annVPM = annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, wellData.cavernCoeff);
    const h = getSlurryHeight(slurries, i, wellData.casingDepthMD);
    const vol = h > 0 ? h * annVPM : 0;
    if (vol > 0) stages.push({ name: s.name, volume: vol, density: s.density, pv: s.rheology.pv, yp: s.rheology.yp });
  });
  stages.push({ name: "Продавка", volume: displacementVol, density: 1.0, pv: 1, yp: 0 });

  stages.forEach(s => {
    const stageTime = flowRate > 0 ? s.volume / flowRate : 0;
    cumTime += stageTime;
    cumVol += s.volume;

    const frPipe = frictionLoss(flowRate, wellData.casingDepthMD, dHydPipe, s.pv, s.yp);
    const frAnn = frictionLoss(flowRate, wellData.casingDepthMD, dHydAnn, drillingFluid.rheology.pv, drillingFluid.rheology.yp);
    const bhp = hydroMud + frPipe + frAnn;
    const surfP = frPipe + frAnn;

    points.push({ stage: s.name, time: cumTime, surfacePressure: surfP, bottomholePressure: bhp, fracturePressure: fracP, cumulativeVolume: cumVol });
  });

  return points;
}

function frictionLoss(flowRateM3min: number, lengthM: number, dHydMm: number, pv: number, yp: number): number {
  const dHyd = dHydMm / 1000;
  if (dHyd <= 0 || flowRateM3min <= 0) return 0;
  const area = (Math.PI / 4) * dHyd * dHyd;
  const velocityMs = (flowRateM3min / 60) / area;
  const pvPas = pv / 1000;
  const frLam = (32 * pvPas * velocityMs * lengthM) / (dHyd * dHyd) / 1e6;
  const yieldTerm = (16 * yp * lengthM) / (3 * dHyd) / 1e6;
  return frLam + yieldTerm;
}
