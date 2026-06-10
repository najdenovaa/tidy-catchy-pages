/**
 * Пенообработка призабойной зоны пласта (ОПЗ) — расчётный движок.
 *
 * Блоки:
 *   1) типы входных данных и рецептуры
 *   2) calculateFoamTreatment() — объёмы, давления, проникновение, прогноз
 *   3) buildCyclogram() — циклограмма P(t) для всех циклов
 *
 * Все расчёты локально в браузере, без сетевых вызовов.
 */

import {
  interpolateTVD,
  type TrajectoryPoint,
} from "./cementing-calculations";
import { calcN2ZFactor } from "./foam-cement-calculations";

/* ─────────── Константы ─────────── */

const ATM_MPA = 0.101325;
const STD_TEMP_K = 293.15;
const G = 9.81;

/* ─────────── Типы входных данных ─────────── */

export interface FoamTreatmentWellData {
  // Скважина
  wellDepthMD: number;
  casingID_mm: number;
  nktOD_mm: number;
  nktID_mm: number;
  nktDepthMD: number;
  trajectory: TrajectoryPoint[];

  // Пласт
  reservoirTopMD: number;
  reservoirBottomMD: number;
  netPayM: number;
  permeability_mD: number;
  porosity: number;
  reservoirPressureMPa: number;
  reservoirTemperatureC: number;
  skinFactor: number;

  // Жидкости
  wellFluidDensity: number; // г/см³
  wellFluidType: "water" | "oil" | "emulsion" | "brine";

  // Давления
  fracturePressureMPa: number;

  // Перфорация
  perfIntervalTopMD: number;
  perfIntervalBottomMD: number;
  perfDensity: number;
  perfDiameter_mm: number;

  // Текущий дебит (для прогноза)
  currentRateTpd?: number; // т/сут
  oilViscosityCp?: number; // мПа·с
  oilFVF?: number;         // объёмный коэффициент B
  drainageRadiusM?: number;
}

/* ─────────── Рецептуры ─────────── */

export type FoamTreatmentType =
  | "foam_surfactant"
  | "foam_acid_hcl"
  | "foam_acid_hf"
  | "foam_solvent"
  | "foam_sgps"
  | "n2_lift"
  | "foam_polymer"
  | "custom";

export interface FoamTreatmentRecipe {
  id: string;
  type: FoamTreatmentType;
  nameRu: string;
  description: string;

  baseFluidType: "water" | "acid_hcl" | "acid_hf_mud" | "solvent" | "brine";
  baseFluidDensity: number;
  baseFluidConcentration?: number;

  surfactantType: string;
  surfactantConc: number;

  targetFoamQuality: number;

  additives: Array<{
    name: string;
    concentration: number;
    unit: "%" | "кг/м³";
    purpose: string;
  }>;

  collectorType: "carbonate" | "terrigenous" | "any";
  maxTempC: number;
  skinReductionEstimate: [number, number];
  volumePerMeterPayZone: number;
}

export const FOAM_TREATMENT_RECIPES: FoamTreatmentRecipe[] = [
  {
    id: "foam_pav_clean",
    type: "foam_surfactant",
    nameRu: "Пенная обработка ПАВ (очистка ПЗП)",
    description:
      "Для удаления глинистых частиц бурового раствора и фильтрата из ПЗП. Эффективна в терригенных коллекторах.",
    baseFluidType: "water",
    baseFluidDensity: 1.0,
    surfactantType: "Сульфонол НП-3",
    surfactantConc: 1.0,
    targetFoamQuality: 70,
    additives: [
      { name: "Стабилизатор КМЦ", concentration: 0.3, unit: "%", purpose: "Стабилизация пены" },
    ],
    collectorType: "terrigenous",
    maxTempC: 90,
    skinReductionEstimate: [2, 8],
    volumePerMeterPayZone: 2.0,
  },
  {
    id: "foam_acid_hcl_carb",
    type: "foam_acid_hcl",
    nameRu: "Пенокислотная обработка HCl (карбонат)",
    description:
      "Для карбонатных коллекторов. Пена замедляет реакцию кислоты, увеличивает глубину проникновения. HCl 12-15%.",
    baseFluidType: "acid_hcl",
    baseFluidDensity: 1.07,
    baseFluidConcentration: 15,
    surfactantType: "Нефтенол ВПК",
    surfactantConc: 0.5,
    targetFoamQuality: 60,
    additives: [
      { name: "Ингибитор коррозии", concentration: 0.3, unit: "%", purpose: "Защита НКТ и колонны" },
      { name: "Стабилизатор железа", concentration: 0.5, unit: "%", purpose: "Предотвращение осаждения Fe" },
    ],
    collectorType: "carbonate",
    maxTempC: 100,
    skinReductionEstimate: [5, 15],
    volumePerMeterPayZone: 2.5,
  },
  {
    id: "foam_acid_glina",
    type: "foam_acid_hf",
    nameRu: "Глинокислотная пенная обработка (терриген)",
    description:
      "HCl 10% + HF 3% в пене. Растворяет глинистый цемент и алюмосиликаты. Только для терригенных коллекторов.",
    baseFluidType: "acid_hf_mud",
    baseFluidDensity: 1.05,
    baseFluidConcentration: 10,
    surfactantType: "ОП-10",
    surfactantConc: 0.5,
    targetFoamQuality: 55,
    additives: [
      { name: "HF", concentration: 3, unit: "%", purpose: "Растворение глин" },
      { name: "Ингибитор коррозии Солинг", concentration: 0.3, unit: "%", purpose: "Защита труб" },
    ],
    collectorType: "terrigenous",
    maxTempC: 80,
    skinReductionEstimate: [3, 12],
    volumePerMeterPayZone: 2.0,
  },
  {
    id: "foam_solvent_aspo",
    type: "foam_solvent",
    nameRu: "Пенная обработка растворителем (АСПО)",
    description:
      "Для удаления асфальтено-смолисто-парафиновых отложений. Бутилбензольная фракция + ПАВ + N₂.",
    baseFluidType: "solvent",
    baseFluidDensity: 0.86,
    surfactantType: "АОС",
    surfactantConc: 2.0,
    targetFoamQuality: 65,
    additives: [{ name: "Толуол", concentration: 30, unit: "%", purpose: "Растворение АСПО" }],
    collectorType: "any",
    maxTempC: 120,
    skinReductionEstimate: [3, 10],
    volumePerMeterPayZone: 1.5,
  },
  {
    id: "foam_sgps_thermo",
    type: "foam_sgps",
    nameRu: "Самогенерирующаяся пенная система (СГПС)",
    description:
      "NH4Cl + NaNO2 → N₂ in-situ + тепло. Не требует азотной установки на устье. Для скважин с низким Pпл.",
    baseFluidType: "water",
    baseFluidDensity: 1.05,
    surfactantType: "Нефтенол К",
    surfactantConc: 1.5,
    targetFoamQuality: 50,
    additives: [
      { name: "NH4Cl", concentration: 250, unit: "кг/м³", purpose: "Реагент газогенерации" },
      { name: "NaNO2", concentration: 220, unit: "кг/м³", purpose: "Реагент газогенерации" },
    ],
    collectorType: "any",
    maxTempC: 130,
    skinReductionEstimate: [2, 7],
    volumePerMeterPayZone: 1.8,
  },
  {
    id: "foam_polymer_div",
    type: "foam_polymer",
    nameRu: "Полимерная пена (потокоотклоняющая)",
    description:
      "Пена + ПАА для временного блокирования промытых зон при последующей кислотной обработке.",
    baseFluidType: "water",
    baseFluidDensity: 1.02,
    surfactantType: "Сульфонол НП-3",
    surfactantConc: 0.8,
    targetFoamQuality: 75,
    additives: [
      { name: "ПАА", concentration: 0.5, unit: "%", purpose: "Загущение базовой жидкости" },
    ],
    collectorType: "any",
    maxTempC: 90,
    skinReductionEstimate: [1, 4],
    volumePerMeterPayZone: 1.2,
  },
  {
    id: "n2_lift_gas",
    type: "n2_lift",
    nameRu: "Азотный лифт (вызов притока)",
    description:
      "Замещение столба жидкости азотом для снижения забойного давления и вызова притока. Без ПАВ.",
    baseFluidType: "water",
    baseFluidDensity: 1.0,
    surfactantType: "—",
    surfactantConc: 0,
    targetFoamQuality: 95,
    additives: [],
    collectorType: "any",
    maxTempC: 200,
    skinReductionEstimate: [0, 2],
    volumePerMeterPayZone: 0,
  },
];

/* ─────────── Внутренние хелперы ─────────── */

function calcFrictionInNKT(
  rateLps: number,
  idMm: number,
  lengthM: number,
  densityGcc: number,
): number {
  if (rateLps <= 0 || idMm <= 0 || lengthM <= 0) return 0;
  const d = idMm / 1000;
  const area = (Math.PI / 4) * d * d;
  const v = rateLps / 1000 / area; // м/с
  const rho = densityGcc * 1000;
  const mu = 0.001; // вода ~1 cP
  const Re = (rho * v * d) / mu;
  let f: number;
  if (Re < 2100) f = 64 / Math.max(1, Re);
  else f = 0.316 / Math.pow(Math.max(Re, 4000), 0.25); // Блазиус
  const dPpa = (f * lengthM * rho * v * v) / (2 * d);
  return dPpa / 1e6;
}

/* ─────────── Результат расчёта ─────────── */

export interface FoamTreatmentResult {
  // Объёмы
  treatmentVolumeM3: number;
  foamVolumeAtSurfaceM3: number;
  foamVolumeAtFormationM3: number;
  n2VolumeStdM3: number;
  n2VolumeAtFormationM3: number;
  displacementVolumeM3: number;

  // Давления
  injectionPressureMPa: number;
  bottomholePressureMPa: number;
  maxAllowedPressureMPa: number;
  pressureMarginMPa: number;
  frictionMPa: number;

  // Пена на забое
  foamQualityAtFormation: number;
  foamDensityAtFormation: number;

  // Проникновение
  penetrationRadiusM: number;

  // Оборудование
  n2PeakRateM3min: number;
  pumpRateLps: number;

  // Циклы
  numberOfCycles: number;
  cycleTimeMin: number;
  totalTreatmentTimeMin: number;

  // Прогноз
  currentSkin: number;
  expectedSkin: number;
  expectedSkinReduction: number;
  expectedProductionIncreasePct: number;
  expectedRateTpd?: number;

  warnings: string[];
}

export interface FoamTreatmentOptions {
  numberOfCycles: number;
  soakTimeMin: number;
  injectionRateLps: number;
  targetPenetrationM: number;
  usePacker: boolean;
}

export function calculateFoamTreatment(
  well: FoamTreatmentWellData,
  recipe: FoamTreatmentRecipe,
  options: FoamTreatmentOptions,
): FoamTreatmentResult {
  const cycles = Math.max(1, options.numberOfCycles);

  // 1. Объём обрабатывающей жидкости (на всю операцию)
  const treatmentVol = recipe.volumePerMeterPayZone * well.netPayM * cycles;

  // 2. Объём пены на устье (стандартные условия)
  const fq = Math.min(95, Math.max(0, recipe.targetFoamQuality));
  const foamVolSurface =
    fq < 99 ? treatmentVol / (1 - fq / 100) : treatmentVol * 100;

  // 3. Давление на забое
  const perfMidMD = (well.perfIntervalTopMD + well.perfIntervalBottomMD) / 2;
  const perfTVD = interpolateTVD(perfMidMD, well.trajectory);
  const hydrostaticMPa = (well.wellFluidDensity * G * perfTVD) / 1000;

  const friction = calcFrictionInNKT(
    options.injectionRateLps,
    well.nktID_mm,
    Math.min(well.nktDepthMD, well.wellDepthMD),
    recipe.baseFluidDensity,
  );

  // Целевое забойное давление = пластовое + 2 МПа (мин. перепад для приёмистости)
  const bhpInjection = well.reservoirPressureMPa + 2.0;
  const surfacePressure = Math.max(0, bhpInjection - hydrostaticMPa + friction);

  // 4. Запас до ГРП
  const pressureMargin = well.fracturePressureMPa - bhpInjection;

  // 5. N₂
  const tempK = well.reservoirTemperatureC + 273.15;
  const Z = calcN2ZFactor(bhpInjection, tempK);

  // Сжатый объём пены на забое: при тех же FQ пена сжимается с поверхностной до забойной
  // FQ_bh = V_gas_bh / (V_gas_bh + V_liq) ; V_gas_bh = V_gas_surf * (P_atm * T_bh) / (P_bh * T_std * Z)
  const compression = (ATM_MPA * tempK) / (bhpInjection * STD_TEMP_K * Z);
  const n2VolSurfTotal = foamVolSurface - treatmentVol;
  const n2VolFormation = n2VolSurfTotal * compression;
  const foamVolFormation = treatmentVol + n2VolFormation;
  const fqFormation = (n2VolFormation / Math.max(1e-9, foamVolFormation)) * 100;
  const foamDensityFormation =
    recipe.baseFluidDensity * (1 - fqFormation / 100); // газ пренебрежимо лёгкий

  // 6. Радиус проникновения (за один цикл)
  const rw = well.casingID_mm / 2000;
  const effectivePorosity = Math.max(0.01, well.porosity * (1 - 0.3));
  const treatPerCycle = treatmentVol / cycles;
  const Rpenetration = Math.sqrt(
    treatPerCycle / (Math.PI * Math.max(0.1, well.netPayM) * effectivePorosity) + rw * rw,
  );

  // 7. Продавка = объём НКТ от устья до перфорации
  const nktArea = (Math.PI / 4) * Math.pow(well.nktID_mm / 1000, 2);
  const dispVolume = nktArea * Math.min(well.nktDepthMD, perfMidMD);

  // 8. Время
  const rateM3min = options.injectionRateLps * 0.06; // л/с → м³/мин
  const foamVolPerCycleSurface = foamVolSurface / cycles;
  const injectionTimeMin = foamVolPerCycleSurface / Math.max(0.001, rateM3min);
  const dispTimeMin = dispVolume / Math.max(0.001, rateM3min);
  const cycleTimeMin = injectionTimeMin + dispTimeMin + options.soakTimeMin + 30; // 30 мин стравливание
  const totalTimeMin = cycleTimeMin * cycles;

  // Пиковый расход N₂: газ_на_цикл (стд) / время закачки
  const n2VolStdPerCycle = n2VolSurfTotal / cycles;
  const n2PeakRate = n2VolStdPerCycle / Math.max(0.1, injectionTimeMin);

  // 9. Прогноз скина и дебита
  const reductionRange =
    recipe.skinReductionEstimate[1] - recipe.skinReductionEstimate[0];
  const penetrationFactor = Math.min(1, Rpenetration / 3);
  const cycleBonus = Math.min(1, (cycles - 1) * 0.15);
  const skinReduction =
    recipe.skinReductionEstimate[0] +
    reductionRange * (0.5 * penetrationFactor + 0.5 * cycleBonus);
  const newSkin = Math.max(-2, well.skinFactor - skinReduction);

  const Re = well.drainageRadiusM ?? 500;
  const lnRr = Math.log(Re / Math.max(0.05, rw));
  const productivityRatio =
    (lnRr + well.skinFactor) / Math.max(0.1, lnRr + newSkin);
  const productionIncreasePct = (productivityRatio - 1) * 100;
  const expectedRate =
    well.currentRateTpd != null
      ? well.currentRateTpd * productivityRatio
      : undefined;

  // 10. Предупреждения
  const warnings: string[] = [];
  if (pressureMargin < 1.0)
    warnings.push(
      `Запас до ГРП всего ${pressureMargin.toFixed(1)} МПа — высокий риск гидроразрыва.`,
    );
  if (recipe.type === "foam_acid_hf" && well.reservoirTemperatureC > 80)
    warnings.push(
      "HF при температуре > 80°C — высокая скорость реакции, возможно вторичное осаждение.",
    );
  if (recipe.targetFoamQuality > 80)
    warnings.push("FQ > 80% — риск нестабильности пены, возможен распад.");
  if (Rpenetration < 0.5)
    warnings.push(
      "Радиус проникновения < 0.5 м — увеличьте объём обработки или число циклов.",
    );
  if (
    recipe.collectorType !== "any" &&
    recipe.collectorType === "carbonate" &&
    recipe.type === "foam_acid_hf"
  )
    warnings.push("Глинокислота НЕ применяется для карбонатных коллекторов!");
  if (well.reservoirTemperatureC > recipe.maxTempC)
    warnings.push(
      `Температура пласта ${well.reservoirTemperatureC}°C выше предела рецептуры ${recipe.maxTempC}°C.`,
    );
  if (surfacePressure > 32)
    warnings.push(
      `Устьевое давление ${surfacePressure.toFixed(1)} МПа > 32 МПа — нужен агрегат высокого давления.`,
    );
  if (!options.usePacker && recipe.type.startsWith("foam_acid"))
    warnings.push(
      "Кислотная обработка без пакера — обсадная колонна подвергается коррозии.",
    );

  return {
    treatmentVolumeM3: treatmentVol,
    foamVolumeAtSurfaceM3: foamVolSurface,
    foamVolumeAtFormationM3: foamVolFormation,
    n2VolumeStdM3: n2VolSurfTotal,
    n2VolumeAtFormationM3: n2VolFormation,
    displacementVolumeM3: dispVolume,

    injectionPressureMPa: surfacePressure,
    bottomholePressureMPa: bhpInjection,
    maxAllowedPressureMPa: well.fracturePressureMPa,
    pressureMarginMPa: pressureMargin,
    frictionMPa: friction,

    foamQualityAtFormation: fqFormation,
    foamDensityAtFormation: foamDensityFormation,

    penetrationRadiusM: Rpenetration,

    n2PeakRateM3min: n2PeakRate,
    pumpRateLps: options.injectionRateLps,

    numberOfCycles: cycles,
    cycleTimeMin,
    totalTreatmentTimeMin: totalTimeMin,

    currentSkin: well.skinFactor,
    expectedSkin: newSkin,
    expectedSkinReduction: skinReduction,
    expectedProductionIncreasePct: productionIncreasePct,
    expectedRateTpd: expectedRate,

    warnings,
  };
}

/* ─────────── Циклограмма ─────────── */

export interface TreatmentCycleStep {
  name: string;
  durationMin: number;
  pressureMode: "injection" | "soak" | "bleed" | "flow";
  description: string;
  fluidPumped: string;
  volumeM3: number;
  surfacePressureMPa: number;
  bottomholePressureMPa: number;
}

export interface TreatmentCycle {
  cycleNumber: number;
  steps: TreatmentCycleStep[];
}

export interface CyclogramPoint {
  time: number; // мин с начала операции
  surfacePressure: number;
  bhp: number;
  phase: string;
  cycle: number;
}

export function buildCyclogram(
  well: FoamTreatmentWellData,
  recipe: FoamTreatmentRecipe,
  options: FoamTreatmentOptions,
  result: FoamTreatmentResult,
): { cycles: TreatmentCycle[]; points: CyclogramPoint[] } {
  const cycles: TreatmentCycle[] = [];
  const points: CyclogramPoint[] = [];

  const perfMidMD =
    (well.perfIntervalTopMD + well.perfIntervalBottomMD) / 2;
  const perfTVD = interpolateTVD(perfMidMD, well.trajectory);
  const hydrostaticMPa = (well.wellFluidDensity * G * perfTVD) / 1000;

  const Psurf = result.injectionPressureMPa;
  const Pbh = result.bottomholePressureMPa;

  const foamVolPerCycleSurface =
    result.foamVolumeAtSurfaceM3 / result.numberOfCycles;
  const treatVolPerCycle = result.treatmentVolumeM3 / result.numberOfCycles;
  const dispVol = result.displacementVolumeM3;

  const rateM3min = options.injectionRateLps * 0.06;
  const injTime = foamVolPerCycleSurface / Math.max(0.001, rateM3min);
  const dispTime = dispVol / Math.max(0.001, rateM3min);
  const soakTime = options.soakTimeMin;
  const bleedTime = 30;

  let t = 0;
  const samplesPerPhase = 8;

  for (let c = 1; c <= result.numberOfCycles; c++) {
    const steps: TreatmentCycleStep[] = [];

    // Фаза 1 — закачка пены
    const inj: TreatmentCycleStep = {
      name: "Закачка пены",
      durationMin: injTime,
      pressureMode: "injection",
      description: "Закачка пены через НКТ в пласт. Давление растёт до рабочего.",
      fluidPumped: `Пена FQ ${recipe.targetFoamQuality}% (${recipe.surfactantType})`,
      volumeM3: foamVolPerCycleSurface,
      surfacePressureMPa: Psurf,
      bottomholePressureMPa: Pbh,
    };
    steps.push(inj);
    for (let i = 0; i <= samplesPerPhase; i++) {
      const f = i / samplesPerPhase;
      points.push({
        time: t + injTime * f,
        surfacePressure: Psurf * Math.min(1, f * 1.2),
        bhp: hydrostaticMPa + (Pbh - hydrostaticMPa) * Math.min(1, f * 1.2),
        phase: "Закачка",
        cycle: c,
      });
    }
    t += injTime;

    // Фаза 2 — продавка
    const dispStep: TreatmentCycleStep = {
      name: "Продавка",
      durationMin: dispTime,
      pressureMode: "injection",
      description: "Продавка пены продавочной жидкостью объёмом, равным НКТ.",
      fluidPumped: "Скваж. жидкость",
      volumeM3: dispVol,
      surfacePressureMPa: Psurf,
      bottomholePressureMPa: Pbh,
    };
    steps.push(dispStep);
    for (let i = 0; i <= samplesPerPhase; i++) {
      const f = i / samplesPerPhase;
      points.push({
        time: t + dispTime * f,
        surfacePressure: Psurf,
        bhp: Pbh,
        phase: "Продавка",
        cycle: c,
      });
    }
    t += dispTime;

    // Фаза 3 — выдержка
    const soakStep: TreatmentCycleStep = {
      name: "Выдержка",
      durationMin: soakTime,
      pressureMode: "soak",
      description: "Выдержка под давлением — пена проникает в пласт, реагенты работают.",
      fluidPumped: "—",
      volumeM3: 0,
      surfacePressureMPa: Psurf * 0.4,
      bottomholePressureMPa: well.reservoirPressureMPa + 1.0,
    };
    steps.push(soakStep);
    for (let i = 0; i <= samplesPerPhase; i++) {
      const f = i / samplesPerPhase;
      points.push({
        time: t + soakTime * f,
        surfacePressure: Psurf * (1 - 0.6 * f),
        bhp: Pbh - (Pbh - (well.reservoirPressureMPa + 1.0)) * f,
        phase: "Выдержка",
        cycle: c,
      });
    }
    t += soakTime;

    // Фаза 4 — стравливание
    const bleedStep: TreatmentCycleStep = {
      name: "Стравливание / отработка",
      durationMin: bleedTime,
      pressureMode: "bleed",
      description: "Сброс давления на устье. Пена расширяется и выносит кольматант на поверхность.",
      fluidPumped: "Возврат из пласта",
      volumeM3: foamVolPerCycleSurface * 0.7,
      surfacePressureMPa: 0,
      bottomholePressureMPa: hydrostaticMPa,
    };
    steps.push(bleedStep);
    for (let i = 0; i <= samplesPerPhase; i++) {
      const f = i / samplesPerPhase;
      points.push({
        time: t + bleedTime * f,
        surfacePressure: Psurf * 0.4 * (1 - f),
        bhp:
          well.reservoirPressureMPa +
          1.0 -
          (well.reservoirPressureMPa + 1.0 - hydrostaticMPa) * f,
        phase: "Стравливание",
        cycle: c,
      });
    }
    t += bleedTime;

    cycles.push({ cycleNumber: c, steps });
  }

  return { cycles, points };
}

/* ─────────── Подбор оборудования ─────────── */

export interface EquipmentRecommendation {
  pumpUnit: string;
  n2Unit: string;
  foamGenerator: string;
  comments: string[];
}

export function recommendEquipment(
  result: FoamTreatmentResult,
): EquipmentRecommendation {
  const comments: string[] = [];

  let pumpUnit = "ЦА-320 (макс. 32 МПа, расход до 18 л/с)";
  if (result.injectionPressureMPa > 30) {
    pumpUnit = "СИН-32 / СИН-46 (макс. 40-46 МПа)";
    comments.push("Требуется насос высокого давления (>32 МПа).");
  }
  if (result.pumpRateLps > 18) {
    pumpUnit = "СИН-46 (расход до 30 л/с)";
  }

  let n2Unit = "АГУ-8К (расход 0.5–8 м³/мин)";
  if (result.n2PeakRateM3min > 8) {
    n2Unit = "ТА-15 / две АГУ-8К в параллель";
    comments.push("Пиковый расход N₂ > 8 м³/мин — нужна установка повышенной производительности.");
  }
  if (result.n2VolumeStdM3 < 1) {
    n2Unit = "Азотная установка не требуется";
  }

  const foamGenerator =
    result.pumpRateLps > 10 ? "ПГ-300 (до 300 л/мин пены)" : "ПГ-150 (до 150 л/мин пены)";

  return { pumpUnit, n2Unit, foamGenerator, comments };
}
