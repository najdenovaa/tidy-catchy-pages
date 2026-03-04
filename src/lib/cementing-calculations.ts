// Core cementing calculation formulas

export interface Rheology {
  pv: number; // Пластическая вязкость, сПз
  yp: number; // ДНС (динамическое напряжение сдвига), Па
}

export type AdditivePercentageType = 'bwoc' | 'bwob';

export interface Additive {
  name: string;
  percentage: number; // % от массы цемента (bwoc) или смеси (bwob)
  percentageType: AdditivePercentageType; // тип расчёта процента
  massKg: number; // кг (автовычисляемое)
}

export interface FlowRateStep {
  rateLps: number; // л/с
  volumeM3: number; // м³
}

export interface DrillingFluid {
  name: string;
  density: number; // кг/м³
  rheology: Rheology; // реология на поверхности (основная)
  rheologyBottomhole?: Rheology; // реология на забое (опционально)
  fluidLoss: number; // Водоотдача, мл/30мин
}

export interface DisplacementFluid {
  name: string;
  density: number; // кг/м³
  rheology: Rheology;
  flowRateSteps: FlowRateStep[];
  compressionCoeff: number; // коэффициент сжатия (1.0 = без сжатия, 1.05 = +5%)
}

export interface TrajectoryPoint {
  md: number;    // глубина по стволу, м
  azimuth: number; // азимут, °
  zenith: number;  // зенитный угол, °
  tvd: number;     // вертикальная глубина, м
}

export interface CasingSection {
  fromMD: number; // м — начало секции (от устья)
  toMD: number;   // м — конец секции
  wallThickness: number; // мм — толщина стенки
}

export interface CavernInterval {
  fromMD: number; // м — начало интервала
  toMD: number;   // м — конец интервала
  coeff: number;  // коэффициент кавернозности
}

export interface WellData {
  wellDepthMD: number;
  wellDepthTVD: number;
  casingDepthMD: number;
  holeDiameter: number; // мм
  casingOD: number; // мм
  casingWall: number; // мм (дефолт, если нет секций)
  prevCasingDepth: number;
  prevCasingID: number; // мм
  prevCasingOD: number; // мм
  ckodDepth: number;
  cementRiseHeight: number;
  cavernCoeff: number; // дефолт, если нет интервалов
  bottomTempStatic: number; // BHST °C
  bottomTempCirc: number; // BHCT °C
  trajectory: TrajectoryPoint[];
  casingSections?: CasingSection[];
  cavernIntervals?: CavernInterval[];
}

export function getCasingID(casingOD: number, casingWall: number): number {
  return casingOD - 2 * casingWall;
}

// Получить толщину стенки ОК на данной глубине MD
export function getCasingWallAtDepth(md: number, defaultWall: number, sections?: CasingSection[]): number {
  if (!sections || sections.length === 0) return defaultWall;
  for (const s of sections) {
    if (md >= s.fromMD && md < s.toMD) return s.wallThickness;
  }
  return defaultWall;
}

// Получить внутр. диаметр ОК на данной глубине
export function getCasingIDAtDepth(md: number, casingOD: number, defaultWall: number, sections?: CasingSection[]): number {
  return casingOD - 2 * getCasingWallAtDepth(md, defaultWall, sections);
}

// Получить коэффициент кавернозности на данной глубине MD
export function getCavernCoeffAtDepth(md: number, defaultCoeff: number, intervals?: CavernInterval[]): number {
  if (!intervals || intervals.length === 0) return defaultCoeff;
  for (const iv of intervals) {
    if (md >= iv.fromMD && md < iv.toMD) return iv.coeff;
  }
  return defaultCoeff;
}

// Вычислить общий объём трубы от mdTop до mdBottom с учётом секций ОК
export function totalPipeVolumeForRange(
  mdTop: number, mdBottom: number, casingOD: number, defaultWall: number, sections?: CasingSection[]
): number {
  if (!sections || sections.length === 0) {
    const id = getCasingID(casingOD, defaultWall);
    return pipeVolumePerMeter(id) * Math.max(0, mdBottom - mdTop);
  }
  // Разбиваем диапазон на поддиапазоны по секциям
  const sorted = [...sections].sort((a, b) => a.fromMD - b.fromMD);
  let vol = 0;
  let cursor = mdTop;
  for (const s of sorted) {
    if (cursor >= mdBottom) break;
    // Участок до секции — дефолт
    if (cursor < s.fromMD) {
      const segEnd = Math.min(s.fromMD, mdBottom);
      const id = getCasingID(casingOD, defaultWall);
      vol += pipeVolumePerMeter(id) * (segEnd - cursor);
      cursor = segEnd;
    }
    if (cursor >= mdBottom) break;
    // Участок внутри секции
    if (cursor < s.toMD) {
      const segStart = Math.max(cursor, s.fromMD);
      const segEnd = Math.min(s.toMD, mdBottom);
      const id = getCasingID(casingOD, s.wallThickness);
      vol += pipeVolumePerMeter(id) * (segEnd - segStart);
      cursor = segEnd;
    }
  }
  // Остаток после всех секций — дефолт
  if (cursor < mdBottom) {
    const id = getCasingID(casingOD, defaultWall);
    vol += pipeVolumePerMeter(id) * (mdBottom - cursor);
  }
  return vol;
}

// Средневзвешенный внутр. диаметр ОК (для расчёта трения)
export function weightedAverageCasingID(
  mdTop: number, mdBottom: number, casingOD: number, defaultWall: number, sections?: CasingSection[]
): number {
  const totalLen = mdBottom - mdTop;
  if (totalLen <= 0) return getCasingID(casingOD, defaultWall);
  if (!sections || sections.length === 0) return getCasingID(casingOD, defaultWall);
  const totalVol = totalPipeVolumeForRange(mdTop, mdBottom, casingOD, defaultWall, sections);
  // Обратный расчёт: vol = pi/4 * (d/1000)^2 * L => d = sqrt(4*vol/pi/L) * 1000
  return Math.sqrt(4 * totalVol / Math.PI / totalLen) * 1000;
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
  frictionPipe: number;
  frictionAnn: number;
  maxBHP: number;
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

// === Интерполяция TVD из траектории ===

/**
 * Проверяет, является ли траектория "реальной" (содержит хотя бы 2 точки с ненулевой MD).
 * Одна точка {md:0, tvd:0} считается дефолтной (нет инклинометрии).
 */
function isRealTrajectory(trajectory: TrajectoryPoint[]): boolean {
  if (!trajectory || trajectory.length < 2) return false;
  // Если все точки на md=0, траектория не задана
  return trajectory.some(p => p.md > 0);
}

/**
 * Строит fallback-траекторию для вертикальной скважины на основе wellData.
 * Если задана wellDepthTVD > 0, используется пропорция TVD/MD.
 * Иначе TVD = MD (вертикальная скважина).
 */
export function buildFallbackTrajectory(wellDepthMD: number, wellDepthTVD: number): TrajectoryPoint[] {
  const tvd = wellDepthTVD > 0 ? wellDepthTVD : wellDepthMD;
  if (wellDepthMD <= 0) return [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }];
  return [
    { md: 0, azimuth: 0, zenith: 0, tvd: 0 },
    { md: wellDepthMD, azimuth: 0, zenith: 0, tvd },
  ];
}

/**
 * Возвращает рабочую траекторию: реальную если есть, иначе fallback.
 */
export function getEffectiveTrajectory(wellData: { trajectory: TrajectoryPoint[]; wellDepthMD: number; wellDepthTVD: number }): TrajectoryPoint[] {
  if (isRealTrajectory(wellData.trajectory)) return wellData.trajectory;
  return buildFallbackTrajectory(wellData.wellDepthMD, wellData.wellDepthTVD);
}

export function interpolateTVD(md: number, trajectory: TrajectoryPoint[]): number {
  if (!trajectory || trajectory.length === 0) return md;
  if (trajectory.length === 1) {
    // Единственная точка: если md=0 и tvd=0 — нет данных, возвращаем md
    if (trajectory[0].md === 0 && trajectory[0].tvd === 0) return md;
    return trajectory[0].tvd;
  }
  
  // Сортируем по MD
  const sorted = [...trajectory].sort((a, b) => a.md - b.md);
  
  if (md <= sorted[0].md) return sorted[0].tvd;
  if (md >= sorted[sorted.length - 1].md) return sorted[sorted.length - 1].tvd;
  
  for (let i = 0; i < sorted.length - 1; i++) {
    if (md >= sorted[i].md && md <= sorted[i + 1].md) {
      const frac = (md - sorted[i].md) / (sorted[i + 1].md - sorted[i].md);
      return sorted[i].tvd + frac * (sorted[i + 1].tvd - sorted[i].tvd);
    }
  }
  return sorted[sorted.length - 1].tvd;
}

// === Автоматический расчёт TVD по методу минимальной кривизны ===

export function calculateTVDFromSurvey(trajectory: TrajectoryPoint[]): TrajectoryPoint[] {
  if (!trajectory || trajectory.length === 0) return [];
  const sorted = [...trajectory].sort((a, b) => a.md - b.md);
  const result: TrajectoryPoint[] = [{ ...sorted[0], tvd: sorted[0].tvd || sorted[0].md }];

  for (let i = 1; i < sorted.length; i++) {
    const prev = result[i - 1];
    const cur = sorted[i];
    const deltaMD = cur.md - prev.md;
    if (deltaMD <= 0) { result.push({ ...cur, tvd: prev.tvd }); continue; }

    const I1 = (prev.zenith || 0) * Math.PI / 180;
    const I2 = (cur.zenith || 0) * Math.PI / 180;
    const A1 = (prev.azimuth || 0) * Math.PI / 180;
    const A2 = (cur.azimuth || 0) * Math.PI / 180;

    // Угол поворота (dogleg angle)
    const cosBeta = Math.cos(I2 - I1) - Math.sin(I1) * Math.sin(I2) * (1 - Math.cos(A2 - A1));
    const beta = Math.acos(Math.min(1, Math.max(-1, cosBeta)));

    // Ratio factor (минимальная кривизна)
    const RF = beta > 1e-6 ? (2 / beta) * Math.tan(beta / 2) : 1;

    const deltaTVD = (deltaMD / 2) * (Math.cos(I1) + Math.cos(I2)) * RF;
    result.push({ ...cur, tvd: Math.round((prev.tvd + deltaTVD) * 100) / 100 });
  }
  return result;
}

// === Расчёт массы добавки из процента ===

export function calculateAdditiveMass(
  percentage: number,
  percentageType: AdditivePercentageType,
  baseMassKg: number // сухая масса цемента (bwoc) или общая масса смеси (bwob)
): number {
  if (percentage <= 0 || baseMassKg <= 0) return 0;
  if (percentageType === 'bwob') {
    // bwob: % от смеси (цемент + все добавки). Additive = pct/100 * blend; blend = base + additive
    // => additive = (pct/100 * base) / (1 - pct/100)
    const frac = percentage / 100;
    return frac >= 1 ? 0 : (frac * baseMassKg) / (1 - frac);
  }
  // bwoc: % от массы сухого цемента
  return (percentage / 100) * baseMassKg;
}

// TVD-интервал между двумя точками MD
export function tvdInterval(mdTop: number, mdBottom: number, trajectory: TrajectoryPoint[]): number {
  const tvdTop = interpolateTVD(mdTop, trajectory);
  const tvdBottom = interpolateTVD(mdBottom, trajectory);
  return Math.max(0, tvdBottom - tvdTop);
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

// Объём кольцевого пространства для интервала [mdTop, mdBottom] с учётом двух зон:
// 0..prevCasingDepth — межтрубное (prevCasingID vs casingOD)
// prevCasingDepth..bottom — открытый ствол (holeDiam vs casingOD, с каверн.)
// Поддержка интервалов кавернозности
export function annularVolumeForInterval(
  mdTop: number, mdBottom: number,
  holeDiamMm: number, casingODmm: number, prevCasingIDmm: number,
  prevCasingDepth: number, cavernCoeff: number,
  cavernIntervals?: CavernInterval[]
): number {
  const interCasingVPM = interCasingVolumePerMeter(prevCasingIDmm, casingODmm);

  const top = Math.max(mdTop, 0);
  const bot = Math.max(mdBottom, 0);
  if (bot <= top) return 0;

  // Участок внутри предыдущей колонны
  const prevTop = top;
  const prevBot = Math.min(bot, prevCasingDepth);
  const prevLen = Math.max(0, prevBot - prevTop);

  // Участок открытого ствола — с учётом интервалов кавернозности
  const openTop = Math.max(top, prevCasingDepth);
  const openBot = bot;
  let openHoleVol = 0;
  if (openBot > openTop) {
    if (!cavernIntervals || cavernIntervals.length === 0) {
      openHoleVol = annularVolumePerMeter(holeDiamMm, casingODmm, cavernCoeff) * (openBot - openTop);
    } else {
      // Разбиваем на подинтервалы
      const sorted = [...cavernIntervals].sort((a, b) => a.fromMD - b.fromMD);
      let cursor = openTop;
      for (const iv of sorted) {
        if (cursor >= openBot) break;
        // До интервала — дефолтный коэфф
        if (cursor < iv.fromMD) {
          const segEnd = Math.min(iv.fromMD, openBot);
          openHoleVol += annularVolumePerMeter(holeDiamMm, casingODmm, cavernCoeff) * (segEnd - cursor);
          cursor = segEnd;
        }
        if (cursor >= openBot) break;
        // Внутри интервала
        if (cursor < iv.toMD) {
          const segStart = Math.max(cursor, iv.fromMD);
          const segEnd = Math.min(iv.toMD, openBot);
          openHoleVol += annularVolumePerMeter(holeDiamMm, casingODmm, iv.coeff) * (segEnd - segStart);
          cursor = segEnd;
        }
      }
      // Остаток — дефолт
      if (cursor < openBot) {
        openHoleVol += annularVolumePerMeter(holeDiamMm, casingODmm, cavernCoeff) * (openBot - cursor);
      }
    }
  }

  return interCasingVPM * prevLen + openHoleVol;
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

  // Объём затрубного пространства с учётом интервалов кавернозности
  const totalAnnular = annularVolumeForInterval(
    0, data.casingDepthMD,
    data.holeDiameter, data.casingOD, data.prevCasingID,
    data.prevCasingDepth, data.cavernCoeff, data.cavernIntervals
  );

  // Объём трубного пространства с учётом секций ОК
  const totalPipe = totalPipeVolumeForRange(0, data.casingDepthMD, data.casingOD, data.casingWall, data.casingSections);
  const dispVol = totalPipeVolumeForRange(0, data.ckodDepth, data.casingOD, data.casingWall, data.casingSections);
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
  slurryVolume: number,
  densityGcm3: number,
): CementResults {
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
  fractureGradientKpaM: number,
  drillingFluidRheology?: Rheology,
  displacementRheology?: Rheology,
  pumpRateLps?: number
): HydraulicResults {
  const traj = getEffectiveTrajectory(data);
  const bottomTVD = interpolateTVD(data.casingDepthMD, traj);

  // Трубное — продавочная жидкость по вертикали
  const pipePressure = hydrostaticPressure(displacementDensity, bottomTVD);

  // Затрубное — цемент + бур. раствор (по вертикали)
  let annulusPressure = 0;
  let cementTVDtotal = 0;
  slurries.forEach((s, i) => {
    const hMD = getSlurryHeight(slurries, i, data.casingDepthMD);
    if (hMD > 0) {
      // Пересчитываем высоту столба по вертикали
      const lastIdx = slurries.length - 1;
      const bottomMD = i === lastIdx ? data.casingDepthMD : slurries[i + 1].topDepthMD;
      const hTVD = tvdInterval(s.topDepthMD, bottomMD, traj);
      annulusPressure += hydrostaticPressure(s.density, hTVD);
      cementTVDtotal += hTVD;
    }
  });
  const mudHeightTVD = Math.max(0, bottomTVD - cementTVDtotal);
  annulusPressure += hydrostaticPressure(1.1, mudHeightTVD); // fallback плотность бур. раствора

  const fracturePressure = (fractureGradientKpaM * bottomTVD) / 1000;

  // Потери на трение (если есть данные)
  let frictionPipe = 0;
  let frictionAnn = 0;
  const rate = pumpRateLps ?? 0;
  if (rate > 0) {
    const casingID = weightedAverageCasingID(0, data.casingDepthMD, data.casingOD, data.casingWall, data.casingSections);
    const dHydPipe = casingID;
    const dHydAnn = Math.max(data.holeDiameter - data.casingOD, 10);
    const dHoleM = data.holeDiameter / 1000;
    const dCasM = data.casingOD / 1000;
    const annAreaM2 = (Math.PI / 4) * (dHoleM * dHoleM - dCasM * dCasM);
    const pipeAreaM2 = (Math.PI / 4) * (casingID / 1000) * (casingID / 1000);
    const flowRateM3min = rate * 0.06;

    // Трубное — продавочная жидкость
    const dispPv = displacementRheology?.pv ?? 1;
    const dispYp = displacementRheology?.yp ?? 0;
    frictionPipe = frictionLossWithRegime(flowRateM3min, data.casingDepthMD, dHydPipe, dispPv, dispYp, pipeAreaM2, displacementDensity * 1000).pressureMPa;

    // Затрубное — средние свойства цементного раствора (после закачки цемент в затрубье)
    const avgPv = slurries.length > 0 ? slurries.reduce((s, sl) => s + sl.rheology.pv, 0) / slurries.length : (drillingFluidRheology?.pv ?? 25);
    const avgYp = slurries.length > 0 ? slurries.reduce((s, sl) => s + sl.rheology.yp, 0) / slurries.length : (drillingFluidRheology?.yp ?? 18);
    const avgDensity = slurries.length > 0 ? slurries.reduce((s, sl) => s + sl.density * 1000, 0) / slurries.length : 1100;
    const annFrictionMultiplier = 0.8;
    frictionAnn = frictionLossWithRegime(flowRateM3min, data.casingDepthMD, dHydAnn, avgPv, avgYp, annAreaM2, avgDensity).pressureMPa * annFrictionMultiplier;
  }

  const maxBHP = annulusPressure + frictionAnn;
  const safetyCoeff = fracturePressure > 0 ? maxBHP / fracturePressure : 0;
  const differentialPressure = annulusPressure - pipePressure;
  const stopPressure = Math.abs(differentialPressure) + 3.0;

  return {
    hydrostaticPressurePipe: pipePressure,
    hydrostaticPressureAnnulus: annulusPressure,
    fractureGradient: fractureGradientKpaM,
    fracturePressure,
    safetyCoefficient: safetyCoeff,
    differentialPressure: Math.abs(differentialPressure),
    stopPressure,
    frictionPipe,
    frictionAnn,
    maxBHP,
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
  wellData: WellData,
): MaterialSummary {
  const cementItems: { name: string; amount: number; unit: string }[] = [];
  const bufferItems: { name: string; amount: number; unit: string }[] = [];
  let waterForCement = 0;
  let waterForBuffers = 0;

  slurries.forEach((s, i) => {
    const h = getSlurryHeight(slurries, i, wellData.casingDepthMD);
    if (h > 0) {
      const lastIdx = slurries.length - 1;
      const mdBot = i === lastIdx ? wellData.casingDepthMD : slurries[i + 1].topDepthMD;
      const vol = annularVolumeForInterval(s.topDepthMD, mdBot, wellData.holeDiameter, wellData.casingOD, wellData.prevCasingID, wellData.prevCasingDepth, wellData.cavernCoeff, wellData.cavernIntervals);
      const res = calculateCement(vol, s.density);
      const dryMassKg = res.dryMass * 1000; // тонны → кг
      cementItems.push({ name: s.name, amount: res.dryMass, unit: "т" });
      waterForCement += res.waterVolume;
      s.additives.forEach(a => {
        const pctType = a.percentageType || 'bwoc';
        const computedMassKg = a.percentage > 0 ? calculateAdditiveMass(a.percentage, pctType, dryMassKg) : a.massKg;
        const label = pctType === 'bwob' ? `${a.percentage}% bwob` : `${a.percentage}% bwoc`;
        if (a.name && computedMassKg > 0) {
          cementItems.push({ name: `  ${a.name} (${label})`, amount: computedMassKg, unit: "кг" });
        }
      });
    }
  });

  buffers.forEach(b => {
    bufferItems.push({ name: b.name, amount: b.volume, unit: "м³" });
    waterForBuffers += b.volume * 0.9; // ~90% вода
    const bufferMassKg = b.volume * b.density; // density в кг/м³
    b.additives.forEach(a => {
      // Авторасчёт массы из % (от массы буферной жидкости)
      const computedMassKg = a.percentage > 0 ? (a.percentage / 100) * bufferMassKg : a.massKg;
      if (a.name && computedMassKg > 0) {
        bufferItems.push({ name: `  ${a.name} (${a.percentage}%)`, amount: computedMassKg, unit: "кг" });
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
  pumpRateLps: number;
  annularReturnRate: number; // л/с — скорость выхода на устье
  flowRegimeAnn: number; // 0 = ламинарный, 1 = турбулентный (затрубье)
  reynoldsAnn: number; // число Рейнольдса затрубья
  maxSafeRateLps: number; // макс. производительность без ГРП, л/с
  densityGcm3: number; // плотность закачиваемой жидкости, г/см³
}

export interface StageBoundary {
  time: number;
  label: string;
}

export interface PressureProfileResult {
  points: PressurePoint[];
  safeWorkingTimeMin: number;
  cementStartTime: number;
  stopTime: number;
  stageBoundaries: StageBoundary[];
  equilibriumTimeMin: number; // время выхода на равновесие после остановки, мин
}

export function calculatePressureProfile(
  wellData: WellData,
  slurries: SlurryInput[],
  buffers: BufferFluid[],
  drillingFluid: DrillingFluid,
  displacementFluids: DisplacementFluid[],
  fractureGradient: number,
  displacementVol: number,
  flushTimeMin: number = 10,
  flushVolumeM3: number = 0
): PressureProfileResult {
  const points: PressurePoint[] = [];
  const traj = getEffectiveTrajectory(wellData);
  const bottomTVD = interpolateTVD(wellData.casingDepthMD, traj);
  const fracP = (fractureGradient * bottomTVD) / 1000;
  const casingID = weightedAverageCasingID(0, wellData.casingDepthMD, wellData.casingOD, wellData.casingWall, wellData.casingSections);
  const dHydAnn = Math.max(wellData.holeDiameter - wellData.casingOD, 10);
  const dHydPipe = casingID;
  const annVPM = annularVolumePerMeter(wellData.holeDiameter, wellData.casingOD, wellData.cavernCoeff);
  // Фактические площади сечений для расчёта скорости
  const dHoleM = wellData.holeDiameter / 1000;
  const dCasM = wellData.casingOD / 1000;
  const annAreaM2 = (Math.PI / 4) * (dHoleM * dHoleM - dCasM * dCasM);
  const pipeAreaM2 = (Math.PI / 4) * (casingID / 1000) * (casingID / 1000);

  const mudDensityGcm3 = drillingFluid.density / 1000;
  // Начальная гидростатика — затрубье заполнено буровым раствором
  const hydroMudFull = hydrostaticPressure(mudDensityGcm3, bottomTVD);

  // Функция расчёта макс. безопасной производительности (бинарный поиск по Q, чтоб BHP ≤ fracP)
  function calcMaxSafeRate(annHydro: number, annPv: number, annYp: number, annDensity: number, pipePv: number, pipeYp: number, pipeDensity: number): number {
    const margin = fracP - annHydro;
    if (margin <= 0) return 0;
    // Бинарный поиск: friction_ann(Q) ≤ margin
    let lo = 0, hi = 50 * 0.06; // до 50 л/с
    for (let iter = 0; iter < 20; iter++) {
      const mid = (lo + hi) / 2;
      const fAnn = frictionLossWithRegime(mid, wellData.casingDepthMD, dHydAnn, annPv, annYp, annAreaM2, annDensity).pressureMPa * 0.8;
      if (fAnn < margin) lo = mid; else hi = mid;
    }
    return ((lo + hi) / 2) / 0.06; // convert m³/min to l/s
  }

  let cumTime = 0;
  let cumVol = 0;
  let cementStartTime = 0;
  let equilibriumTimeMin = 0; // время выхода на равновесие после остановки, мин

  points.push({ stage: "Начало", time: 0, surfacePressure: 0, bottomholePressure: hydroMudFull, fracturePressure: fracP, cumulativeVolume: 0, pumpRateLps: 0, annularReturnRate: 0, flowRegimeAnn: 0, reynoldsAnn: 0, maxSafeRateLps: calcMaxSafeRate(hydroMudFull, drillingFluid.rheology.pv, drillingFluid.rheology.yp, drillingFluid.density, drillingFluid.rheology.pv, drillingFluid.rheology.yp, drillingFluid.density), densityGcm3: mudDensityGcm3 });

  interface Stage { name: string; volume: number; densityGcm3: number; pv: number; yp: number; rateLps: number; isCement: boolean; compressionCoeff: number; durationMin?: number; isFlushPause?: boolean }
  const stages: Stage[] = [];

  // Буферы — по шагам
  buffers.forEach(b => {
    if (b.flowRateSteps.length > 1) {
      b.flowRateSteps.forEach(step => {
        if (step.volumeM3 > 0) {
          stages.push({ name: b.name, volume: step.volumeM3, densityGcm3: b.density / 1000, pv: b.rheology.pv, yp: b.rheology.yp, rateLps: step.rateLps, isCement: false, compressionCoeff: 1.0 });
        }
      });
    } else {
      const rate = b.flowRateSteps.length > 0 ? b.flowRateSteps[0].rateLps : 5;
      stages.push({ name: b.name, volume: b.volume, densityGcm3: b.density / 1000, pv: b.rheology.pv, yp: b.rheology.yp, rateLps: rate, isCement: false, compressionCoeff: 1.0 });
    }
  });

  // Цементные растворы — в порядке списка (первый в списке качается первым)
  slurries.forEach((s, origIdx) => {
    const h = getSlurryHeight(slurries, origIdx, wellData.casingDepthMD);
    if (h <= 0) return;
    const lastIdx = slurries.length - 1;
    const mdBot = origIdx === lastIdx ? wellData.casingDepthMD : slurries[origIdx + 1].topDepthMD;
    const vol = annularVolumeForInterval(s.topDepthMD, mdBot, wellData.holeDiameter, wellData.casingOD, wellData.prevCasingID, wellData.prevCasingDepth, wellData.cavernCoeff, wellData.cavernIntervals);
    if (vol <= 0) return;
    if (s.flowRateSteps.length > 1) {
      s.flowRateSteps.forEach(step => {
        if (step.volumeM3 > 0) {
          stages.push({ name: s.name, volume: step.volumeM3, densityGcm3: s.density, pv: s.rheology.pv, yp: s.rheology.yp, rateLps: step.rateLps, isCement: true, compressionCoeff: 1.0 });
        }
      });
    } else {
      const rate = s.flowRateSteps.length > 0 ? s.flowRateSteps[0].rateLps : 5;
      stages.push({ name: s.name, volume: vol, densityGcm3: s.density, pv: s.rheology.pv, yp: s.rheology.yp, rateLps: rate, isCement: true, compressionCoeff: 1.0 });
    }
  });

  // === Промывка ЛВД (пауза): цемент оседает под собственным весом ===
  stages.push({
    name: "Промывка ЛВД",
    volume: flushVolumeM3,
    densityGcm3: mudDensityGcm3,
    pv: drillingFluid.rheology.pv,
    yp: drillingFluid.rheology.yp,
    rateLps: flushVolumeM3 > 0 && flushTimeMin > 0 ? (flushVolumeM3 / (flushTimeMin * 60)) * 1000 : 0,
    isCement: false,
    compressionCoeff: 1.0,
    durationMin: flushTimeMin,
    isFlushPause: true,
  });

  // Продавочные жидкости — по шагам с распределением объёма
  let remainingDispVol = displacementVol;
  displacementFluids.forEach(df => {
    const cc = df.compressionCoeff || 1.0;
    const totalStepVol = df.flowRateSteps.reduce((s, st) => s + st.volumeM3, 0);
    if (totalStepVol > 0) {
      df.flowRateSteps.forEach(step => {
        if (step.volumeM3 > 0) {
          const vol = Math.min(step.volumeM3, remainingDispVol);
          if (vol > 0) {
            stages.push({ name: df.name, volume: vol, densityGcm3: df.density / 1000, pv: df.rheology.pv, yp: df.rheology.yp, rateLps: step.rateLps, isCement: false, compressionCoeff: cc });
            remainingDispVol -= vol;
          }
        }
      });
    } else {
      const perStep = remainingDispVol / Math.max(df.flowRateSteps.length, 1);
      df.flowRateSteps.forEach(step => {
        if (perStep > 0 && step.rateLps > 0) {
          stages.push({ name: df.name, volume: perStep, densityGcm3: df.density / 1000, pv: df.rheology.pv, yp: df.rheology.yp, rateLps: step.rateLps, isCement: false, compressionCoeff: cc });
        }
      });
      remainingDispVol = 0;
    }
  });

  let cementStartFound = false;
  let cementFreefallVol = 0; // объём, на который цемент ушёл вниз при паузе (надо догнать продавкой)

  // Отслеживаем границы этапов (группируем продавку)
  const stageBoundaries: StageBoundary[] = [];
  let prevGroupLabel = "";

  // === Динамическое отслеживание флюидов в ТРУБЕ и ЗАТРУБЬЕ ===
  const avgCasingID = weightedAverageCasingID(0, wellData.casingDepthMD, wellData.casingOD, wellData.casingWall, wellData.casingSections);
  const pipeVPM = pipeVolumePerMeter(avgCasingID);
  const pipeCapacity = totalPipeVolumeForRange(0, wellData.casingDepthMD, wellData.casingOD, wellData.casingWall, wellData.casingSections);

  // История закачки: [{densityGcm3, volumeM3}] в порядке закачки
  interface FluidBatch { densityGcm3: number; volumeM3: number; }
  const pumpHistory: FluidBatch[] = [];
  let totalPumped = 0;

  // Вычисляет гидростатику ТРУБЫ с учётом текущих флюидов
  // Труба заполняется сверху: последний закачанный флюид — у устья, старый — у забоя
  function calcPipeHydrostatic(): number {
    let pressure = 0;
    let depthMD = 0; // от устья вниз
    let remaining = pipeCapacity;

    // Идём от последнего закачанного (сверху) к первому (снизу)
    for (let i = pumpHistory.length - 1; i >= 0 && remaining > 0; i--) {
      const batch = pumpHistory[i];
      const take = Math.min(batch.volumeM3, remaining);
      if (take <= 0) continue;
      const heightM = take / pipeVPM;
      const topMD = depthMD;
      const botMD = Math.min(depthMD + heightM, wellData.casingDepthMD);
      const tvdTop = interpolateTVD(topMD, traj);
      const tvdBot = interpolateTVD(botMD, traj);
      pressure += batch.densityGcm3 * Math.max(0, tvdBot - tvdTop) * 0.00981;
      depthMD = botMD;
      remaining -= take;
    }

    // Если осталось место — внизу трубы исходный буровой раствор
    if (remaining > 0 && depthMD < wellData.casingDepthMD) {
      const botMD = wellData.casingDepthMD;
      const tvdTop = interpolateTVD(depthMD, traj);
      const tvdBot = interpolateTVD(botMD, traj);
      pressure += mudDensityGcm3 * Math.max(0, tvdBot - tvdTop) * 0.00981;
    }

    return pressure;
  }

  // Вычисляет гидростатику ЗАТРУБЬЯ
  // Флюид выходит из трубы снизу и поднимается в затрубье.
  // Порядок выхода: сначала исходный буровой из трубы, потом закачанные флюиды по порядку.
  // В затрубье: самый свежий флюид внизу (у забоя), самый старый — вверху.
  function calcAnnularHydrostatic(): number {
    let pressure = 0;

    // Строим список того, что вышло в затрубье (в порядке выхода = снизу вверх наоборот)
    // Всего вышло totalPumped м³ из трубы
    // Первым вышел буровой раствор (до pipeCapacity м³), затем закачанные флюиды
    const exitBatches: FluidBatch[] = [];
    const mudExited = Math.min(totalPumped, pipeCapacity);
    if (mudExited > 0) exitBatches.push({ densityGcm3: mudDensityGcm3, volumeM3: mudExited });

    let pumpedExited = Math.max(0, totalPumped - pipeCapacity);
    for (let i = 0; i < pumpHistory.length && pumpedExited > 0; i++) {
      const take = Math.min(pumpHistory[i].volumeM3, pumpedExited);
      if (take > 0) exitBatches.push({ densityGcm3: pumpHistory[i].densityGcm3, volumeM3: take });
      pumpedExited -= take;
    }

    // Затрубье: exitBatches в обратном порядке = самый свежий внизу
    let currentBottomMD = wellData.casingDepthMD;
    for (let i = exitBatches.length - 1; i >= 0; i--) {
      const batch = exitBatches[i];
      if (batch.volumeM3 <= 0 || currentBottomMD <= 0) continue;
      const heightMD = batch.volumeM3 / annVPM;
      const topMD = Math.max(0, currentBottomMD - heightMD);
      const tvdBot = interpolateTVD(currentBottomMD, traj);
      const tvdTop = interpolateTVD(topMD, traj);
      pressure += batch.densityGcm3 * Math.max(0, tvdBot - tvdTop) * 0.00981;
      currentBottomMD = topMD;
    }

    // Выше — исходный буровой раствор затрубья
    if (currentBottomMD > 0) {
      const tvd = interpolateTVD(currentBottomMD, traj);
      pressure += mudDensityGcm3 * tvd * 0.00981;
    }

    return pressure;
  }

  let cumDisplacementVol = 0; // накопленный объём продавки (для отслеживания догонки)
  let freefallOffset = 0; // объём, сместившийся при U-tube оседании (добавляется к totalPumped)
  let displacementStartTime: number | null = null; // старт продавки после промывки

  stages.forEach(s => {
    if (s.isCement && !cementStartFound) {
      cementStartTime = cumTime;
      cementStartFound = true;
    }

    const groupLabel = (!s.isCement && cumTime >= cementStartTime && cementStartFound && !s.isFlushPause) ? "Продавка" : s.name;
    if (groupLabel !== prevGroupLabel) {
      stageBoundaries.push({ time: cumTime, label: groupLabel });
      prevGroupLabel = groupLabel;
    }

    // === Обработка паузы «Промывка ЛВД» — цемент оседает под собственным весом ===
    if (s.isFlushPause && s.durationMin) {
      const pauseMin = s.durationMin;

      // === Анализ содержимого трубы: ищем инверсии плотности (тяжёлое над лёгким) ===
      // Собираем текущий профиль трубы (сверху вниз)
      interface PipeSlice { densityGcm3: number; volumeM3: number; }
      const pipeProfile: PipeSlice[] = [];
      let pipeRemaining = pipeCapacity;

      for (let i = pumpHistory.length - 1; i >= 0 && pipeRemaining > 0; i--) {
        const b = pumpHistory[i];
        const take = Math.min(b.volumeM3, pipeRemaining);
        if (take > 0) pipeProfile.push({ densityGcm3: b.densityGcm3, volumeM3: take });
        pipeRemaining -= take;
      }
      // Если осталось — внизу исходный буровой раствор
      if (pipeRemaining > 0) {
        pipeProfile.push({ densityGcm3: mudDensityGcm3, volumeM3: pipeRemaining });
      }

      // Найти плотность тяжёлого флюида вверху трубы и лёгкого внизу
      // Тяжёлый цемент сверху падает, вытесняя лёгкий снизу в затрубье
      let heavyDensity = 0;
      let heavyVolume = 0;
      let lightDensityBelow = mudDensityGcm3;

      // Ищем первый тяжёлый слой сверху трубы
      for (const slice of pipeProfile) {
        if (slice.densityGcm3 > mudDensityGcm3 + 0.05) {
          heavyDensity = Math.max(heavyDensity, slice.densityGcm3);
          heavyVolume += slice.volumeM3;
        } else {
          // Нашли лёгкий слой ниже тяжёлого
          if (heavyVolume > 0) {
            lightDensityBelow = slice.densityGcm3;
            break;
          }
        }
      }

      // === Расчёт объёма свободного падения (итеративно до равновесия U-трубки) ===
      let freefallVol = 0;
      if (heavyVolume > 0 && heavyDensity > lightDensityBelow + 0.05) {
        const savedTotal = totalPumped;
        const testBatch: FluidBatch = { densityGcm3: heavyDensity, volumeM3: 0 };
        pumpHistory.push(testBatch);
        const maxFreefall = Math.min(heavyVolume, pipeCapacity * 0.4);
        const step = Math.max(maxFreefall / 100, 0.01);

        for (let v = step; v <= maxFreefall; v += step) {
          testBatch.volumeM3 = v;
          totalPumped = savedTotal + v;
          const pH = calcPipeHydrostatic();
          const aH = calcAnnularHydrostatic();
          if (pH <= aH + 0.02) { freefallVol = v; break; }
          freefallVol = v;
        }

        testBatch.volumeM3 = 0;
        totalPumped = savedTotal;
      } else {
        pumpHistory.push({ densityGcm3: mudDensityGcm3, volumeM3: 0 });
      }

      // === Расчёт скорости свободного падения через бинарный поиск (трение = движущее давление) ===
      let settlingTau = 0.5; // мин (по умолчанию — быстро)
      if (freefallVol > 0 && heavyVolume > 0) {
        const drivingPressureMPa = (heavyDensity - lightDensityBelow) * 9.81 *
          tvdInterval(0, Math.min(heavyVolume / pipeVPM, wellData.casingDepthMD), traj) / 1000;

        if (drivingPressureMPa > 0.01) {
          // Средние свойства цемента для трения
          const cPv = slurries.length > 0 ? slurries.reduce((s, sl) => s + sl.rheology.pv, 0) / slurries.length : 30;
          const cYp = slurries.length > 0 ? slurries.reduce((s, sl) => s + sl.rheology.yp, 0) / slurries.length : 5;
          const cDensity = heavyDensity * 1000;

          // Бинарный поиск: friction_pipe(Q) + friction_ann(Q) = ΔP_driving
          let lo = 0, hi = 20 * 0.06; // макс 20 л/с
          for (let iter = 0; iter < 15; iter++) {
            const mid = (lo + hi) / 2;
            const fP = frictionLossWithRegime(mid, wellData.casingDepthMD, dHydPipe, cPv, cYp, pipeAreaM2, cDensity).pressureMPa;
            const fA = frictionLossWithRegime(mid, wellData.casingDepthMD, dHydAnn, drillingFluid.rheology.pv, drillingFluid.rheology.yp, annAreaM2, drillingFluid.density).pressureMPa * 0.8;
            if (fP + fA < drivingPressureMPa) lo = mid; else hi = mid;
          }
          const settlingRateM3min = (lo + hi) / 2;
          const settlingRateM3s = settlingRateM3min / 60;
          if (settlingRateM3s > 0) {
            settlingTau = Math.max(0.1, (freefallVol / settlingRateM3s) / 60); // мин
          }
        }
      }
      // Растягиваем оседание на всю промывку — не менее 1/3 паузы
      // чтобы кривая затухания заняла бо́льшую часть паузы (без длинных плоских участков)
      settlingTau = Math.max(settlingTau, pauseMin * 0.3);

      const ffBatchIdx = pumpHistory.length - 1;
      const savedCumVol = cumVol;

      // Определяем макс. допустимый расход на выходе = последний расход перед паузой
      const lastActiveRate = points.length > 0 ? points[points.length - 1].pumpRateLps : 5;

      // === Генерируем точки: экспоненциальное оседание ===
      let prevSettledVol = 0;
      let equilibriumReached = false;
      for (let m = 1; m <= pauseMin; m++) {
        const tNow = cumTime + m;

        const settledFrac = 1 - Math.exp(-m / Math.max(settlingTau, 0.01));
        const settledVol = freefallVol * settledFrac;

        // Выход на устье = объём вытесненный за шаг → расход л/с
        const deltaVol = settledVol - prevSettledVol; // м³ за шаг
        let returnRateLps = deltaVol / 60 * 1000; // м³/мин → л/с
        // Ограничиваем: выход на устье не должен превышать последнюю производительность
        returnRateLps = Math.min(returnRateLps, lastActiveRate);
        // Плавное затухание к нулю к концу промывки
        const pauseFrac = m / Math.max(pauseMin, 0.001);
        const taper = Math.pow(Math.max(0, 1 - pauseFrac), 1.15);
        returnRateLps = Math.max(0, returnRateLps * taper);
        if (m === pauseMin) returnRateLps = 0;
        prevSettledVol = settledVol;

        // Определяем момент достижения равновесия (95% от freefallVol)
        if (!equilibriumReached && settledFrac >= 0.95) {
          equilibriumTimeMin = m;
          equilibriumReached = true;
        }

        pumpHistory[ffBatchIdx].volumeM3 = settledVol;
        totalPumped = savedCumVol + settledVol;

        const pipeHydro = calcPipeHydrostatic();
        const annHydro = calcAnnularHydrostatic();

        const surfP = Math.max(0, annHydro - pipeHydro);
        const bhp = annHydro;

        points.push({
          stage: s.name, time: tNow,
          surfacePressure: surfP, bottomholePressure: bhp, fracturePressure: fracP,
          cumulativeVolume: savedCumVol, pumpRateLps: 0, annularReturnRate: returnRateLps,
          flowRegimeAnn: 0, reynoldsAnn: 0,
          maxSafeRateLps: calcMaxSafeRate(annHydro, drillingFluid.rheology.pv, drillingFluid.rheology.yp, drillingFluid.density, drillingFluid.rheology.pv, drillingFluid.rheology.yp, drillingFluid.density),
          densityGcm3: mudDensityGcm3,
        });
      }
      if (!equilibriumReached) equilibriumTimeMin = pauseMin;

      // Финализируем
      cementFreefallVol = freefallVol; // запоминаем для продавки (объём догонки)
      freefallOffset = freefallVol; // смещение для корректного totalPumped в последующих этапах
      pumpHistory[ffBatchIdx].volumeM3 = freefallVol;
      totalPumped = savedCumVol + freefallVol;
      cumTime += pauseMin;
      return;
    }

    // === Обычный этап (с насосом) ===
    const flowRateM3min = s.rateLps * 0.06;
    const stageTime = flowRateM3min > 0 ? s.volume / flowRateM3min : 0;

    // Трубное трение — взвешенное по доле заполнения трубы закачиваемым флюидом
    // Часть трубы занята новым флюидом, остальное — буровым раствором
    const densityKgM3 = s.densityGcm3 * 1000;
    const frPipePumped = frictionLossWithRegime(flowRateM3min, wellData.casingDepthMD, dHydPipe, s.pv, s.yp, pipeAreaM2, densityKgM3);
    const frPipeMud = frictionLossWithRegime(flowRateM3min, wellData.casingDepthMD, dHydPipe, drillingFluid.rheology.pv, drillingFluid.rheology.yp, pipeAreaM2, drillingFluid.density);

    // Затрубное трение — по свойствам флюида В ЗАТРУБЬЕ (не закачиваемого!)
    // До продавки: в затрубье буровой раствор. Во время продавки: цемент + буровой.
    let annPv: number, annYp: number, annDensity: number;
    if (!s.isCement && cementStartFound && !s.isFlushPause) {
      // Продавка — в затрубье поднимается цемент (средние свойства растворов)
      const totalCementSlurries = slurries.length || 1;
      annPv = slurries.reduce((sum, sl) => sum + sl.rheology.pv, 0) / totalCementSlurries;
      annYp = slurries.reduce((sum, sl) => sum + sl.rheology.yp, 0) / totalCementSlurries;
      annDensity = slurries.reduce((sum, sl) => sum + sl.density * 1000, 0) / totalCementSlurries;
    } else if (s.isCement) {
      // Закачка цемента — в затрубье пока буровой раствор
      annPv = drillingFluid.rheology.pv;
      annYp = drillingFluid.rheology.yp;
      annDensity = drillingFluid.density;
    } else {
      // Буферы — в затрубье буровой раствор
      annPv = drillingFluid.rheology.pv;
      annYp = drillingFluid.rheology.yp;
      annDensity = drillingFluid.density;
    }
    // Множитель трения затрубья: эксцентриситет (~0.8x от концентрического)
    const annFrictionMultiplier = 0.8;

    pumpHistory.push({ densityGcm3: s.densityGcm3, volumeM3: 0 });
    const batchIdx = pumpHistory.length - 1;

    const isDisplacement = !s.isCement && cementStartFound && !s.isFlushPause;
    if (isDisplacement && displacementStartTime === null) {
      displacementStartTime = cumTime;
    }

    const dtMin = 0.5;
    const stepCount = Math.max(1, Math.ceil(stageTime / dtMin));
    for (let step = 1; step <= stepCount; step++) {
      const progressedTime = Math.min(step * dtMin, stageTime);
      const frac = stageTime > 0 ? Math.min(progressedTime / stageTime, 1) : 1;
      const tNow = cumTime + progressedTime;
      const vNow = cumVol + s.volume * frac;
      const stepVolume = stepCount > 0 ? s.volume / stepCount : 0;

      if (isDisplacement) cumDisplacementVol += stepVolume;

      pumpHistory[batchIdx].volumeM3 = s.volume * frac;
      totalPumped = cumVol + s.volume * frac + freefallOffset;

      // Доля трубы, заполненная закачанным флюидом
      const filledFraction = Math.min(totalPumped / Math.max(pipeCapacity, 0.01), 1);

      // === Soft start: насосы выходят на режим за первые ~5 мин от начала закачки ===
      const globalTimeMin = tNow;
      const softStartFactor = Math.min(1, globalTimeMin / 5.0);
      // Кривая разгона: очень плавное нарастание (5-я степень для более пологого старта)
      const rampFactor = softStartFactor * softStartFactor * softStartFactor * softStartFactor * softStartFactor;

      // Фактическая производительность с учётом разгона
      const actualRateLps = s.rateLps * rampFactor;
      const actualFlowRateM3min = actualRateLps * 0.06;

      // Пересчёт трения с ФАКТИЧЕСКОЙ производительностью (а не номинальной)
      const frPipePumpedActual = frictionLossWithRegime(actualFlowRateM3min, wellData.casingDepthMD, dHydPipe, s.pv, s.yp, pipeAreaM2, densityKgM3);
      const frPipeMudActual = frictionLossWithRegime(actualFlowRateM3min, wellData.casingDepthMD, dHydPipe, drillingFluid.rheology.pv, drillingFluid.rheology.yp, pipeAreaM2, drillingFluid.density);
      const frPipe = frPipePumpedActual.pressureMPa * filledFraction + frPipeMudActual.pressureMPa * (1 - filledFraction);

      // === Загустевание цемента: увеличение эффективной вязкости с течением времени ===
      let thickeningMultiplier = 1.0;
      if (cementStartFound && globalTimeMin > cementStartTime) {
        const timeSinceCementStart = globalTimeMin - cementStartTime;
        const maxThick30 = slurries.length > 0 ? Math.max(...slurries.map(sl => sl.thickeningTime30Bc || 180)) : 180;
        const progressFrac = Math.min(1, timeSinceCementStart / maxThick30);
        thickeningMultiplier = 1.0 + 0.20 * progressFrac + 0.35 * progressFrac * progressFrac + 0.25 * progressFrac * progressFrac * progressFrac;
      }

      const effAnnPv = annPv * thickeningMultiplier;
      const effAnnYp = annYp * thickeningMultiplier;
      const frAnnDynamic = frictionLossWithRegime(actualFlowRateM3min, wellData.casingDepthMD, dHydAnn, effAnnPv, effAnnYp, annAreaM2, annDensity);
      const frAnnNow = frAnnDynamic.pressureMPa * annFrictionMultiplier;
      const reAnnNow = frAnnDynamic.reynolds;
      const flowRegimeAnnNow = frAnnDynamic.regime;

      const pipeHydro = calcPipeHydrostatic();
      const annHydro = calcAnnularHydrostatic();

      const isCatchingUp = isDisplacement && cementFreefallVol > 0 && cumDisplacementVol < cementFreefallVol;
      const catchUpFrac = isDisplacement && cementFreefallVol > 0
        ? Math.min(1, cumDisplacementVol / cementFreefallVol)
        : 1;

      const effectiveFrAnn = isCatchingUp ? frAnnNow * catchUpFrac * catchUpFrac : frAnnNow;

      const surfPRaw = Math.max(0, (annHydro - pipeHydro) + frPipe + effectiveFrAnn);
      const bhpRaw = annHydro + effectiveFrAnn;

      // === Выход на устье ===
      // На длинных промывках перед продавкой возможна задержка циркуляции:
      // сначала небольшой лаг, затем плавный рост до Qвых = Qвх,
      // после появления давления на агрегате — синхронный режим 1:1.
      let circulationFactor = 1;
      if (isDisplacement && displacementStartTime !== null) {
        const timeFromDispStart = tNow - displacementStartTime;
        const delayMin = 2;
        const rampMin = 4;

        if (timeFromDispStart <= delayMin) {
          circulationFactor = 0;
        } else {
          const x = Math.min(1, (timeFromDispStart - delayMin) / rampMin);
          circulationFactor = x * x * (3 - 2 * x); // smoothstep
        }

        // Как только давление на агрегате стабильно появилось — выход = вход
        if (surfPRaw >= 0.3) {
          circulationFactor = 1;
        }
      }

      let totalAnnReturn = actualRateLps * circulationFactor;
      totalAnnReturn = Math.min(totalAnnReturn, actualRateLps);
      totalAnnReturn = Math.max(0, totalAnnReturn);

      // Сглаживаем кривые давления на этапе цемента — без резких "ломаных" падений
      let surfP = surfPRaw;
      let bhp = bhpRaw;
      if (s.isCement && points.length > 0) {
        const prev = points[points.length - 1];
        const blend = 0.35;
        surfP = prev.surfacePressure + (surfPRaw - prev.surfacePressure) * blend;
        bhp = prev.bottomholePressure + (bhpRaw - prev.bottomholePressure) * blend;
      }

      points.push({ stage: s.name, time: tNow, surfacePressure: surfP, bottomholePressure: bhp, fracturePressure: fracP, cumulativeVolume: vNow, pumpRateLps: actualRateLps, annularReturnRate: totalAnnReturn, flowRegimeAnn: flowRegimeAnnNow, reynoldsAnn: reAnnNow, maxSafeRateLps: calcMaxSafeRate(annHydro, effAnnPv, effAnnYp, annDensity, s.pv, s.yp, densityKgM3), densityGcm3: s.densityGcm3 });
    }

    pumpHistory[batchIdx].volumeM3 = s.volume;
    totalPumped = cumVol + s.volume + freefallOffset;

    cumTime += stageTime;
    cumVol += s.volume;
  });

  // СТОП — пробка садится в ЦКОД на ходу, давление скачком от динамического
  const stopTime = cumTime;
  const stopIncrease = 2.75;

  // Берём последнее динамическое давление (с трением, насос работал)
  const lastPoint = points[points.length - 1];
  const lastSurfP = lastPoint ? lastPoint.surfacePressure : 0;
  const lastRate = lastPoint ? lastPoint.pumpRateLps : 0;

  // Забойное = только гидростатика затрубья (насос отсечён пробкой, трения нет)
  const staticAnnHydro = calcAnnularHydrostatic();

  // Скачок давления от посадки пробки (от динамического давления на насосе)
  points.push({
    stage: "СТОП (пробка в ЦКОД)", time: cumTime + 0.5,
    surfacePressure: lastSurfP + stopIncrease, bottomholePressure: staticAnnHydro,
    fracturePressure: fracP, cumulativeVolume: cumVol, pumpRateLps: lastRate,
    annularReturnRate: 0, flowRegimeAnn: 0, reynoldsAnn: 0, maxSafeRateLps: 0, densityGcm3: 0,
  });

  // Удержание давления СТОП
  points.push({
    stage: "СТОП (удержание)", time: cumTime + 5,
    surfacePressure: lastSurfP + stopIncrease, bottomholePressure: staticAnnHydro,
    fracturePressure: fracP, cumulativeVolume: cumVol, pumpRateLps: 0,
    annularReturnRate: 0, flowRegimeAnn: 0, reynoldsAnn: 0, maxSafeRateLps: 0, densityGcm3: 0,
  });

  const cementToStop = stopTime - cementStartTime;
  const safeWorkingTimeMin = cementToStop * 0.75;

  return { points, safeWorkingTimeMin, cementStartTime, stopTime, stageBoundaries, equilibriumTimeMin };
}

// Потери давления на трение с учётом режима потока (ламинарный / переходный / турбулентный)
// densityKgM3 — плотность флюида, кг/м³
interface FrictionResult { pressureMPa: number; reynolds: number; regime: number; }

function frictionLossWithRegime(flowRateM3min: number, lengthM: number, dHydMm: number, pv: number, yp: number, flowAreaM2: number, densityKgM3: number): FrictionResult {
  const dHyd = dHydMm / 1000;
  if (dHyd <= 0 || flowRateM3min <= 0) return { pressureMPa: 0, reynolds: 0, regime: 0 };
  const area = flowAreaM2 > 0 ? flowAreaM2 : (Math.PI / 4) * dHyd * dHyd;
  const v = (flowRateM3min / 60) / area;
  const pvPas = pv / 1000;

  // Эффективная вязкость (Бингам)
  const muEff = pvPas + yp * dHyd / (6 * v);
  // Обобщённое число Рейнольдса
  const Re = densityKgM3 * v * dHyd / muEff;

  // Ламинарные потери (Бингам)
  const frLam = (32 * pvPas * v * lengthM) / (dHyd * dHyd) / 1e6;
  const yieldTerm = (16 * yp * lengthM) / (3 * dHyd) / 1e6;
  const laminarLoss = frLam + yieldTerm;

  // Турбулентные потери (Фаннинг, формула Блазиуса)
  const f = 0.0791 / Math.pow(Math.max(Re, 100), 0.25);
  const turbulentLoss = (2 * f * densityKgM3 * v * v * lengthM) / dHyd / 1e6;

  if (Re < 2100) {
    return { pressureMPa: laminarLoss, reynolds: Re, regime: 0 }; // ламинарный
  } else if (Re < 4000) {
    // Переходная зона — интерполяция
    const blend = (Re - 2100) / 1900;
    const loss = laminarLoss * (1 - blend) + turbulentLoss * blend;
    return { pressureMPa: loss, reynolds: Re, regime: 0.5 }; // переходный
  } else {
    return { pressureMPa: turbulentLoss, reynolds: Re, regime: 1 }; // турбулентный
  }
}

// Обратно-совместимая обёртка (без режима)
function frictionLoss(flowRateM3min: number, lengthM: number, dHydMm: number, pv: number, yp: number, flowAreaM2: number, densityKgM3: number = 1100): number {
  return frictionLossWithRegime(flowRateM3min, lengthM, dHydMm, pv, yp, flowAreaM2, densityKgM3).pressureMPa;
}
