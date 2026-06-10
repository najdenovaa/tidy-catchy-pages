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
    category?: AdditiveCategory;
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

/* ─────────── Химико-реологический движок ─────────── */

export type AdditiveCategory =
  | "corrosion_inhibitor"   // ингибитор коррозии
  | "iron_control"          // стабилизатор Fe³⁺ (лимонная, NTA)
  | "clay_stabilizer"       // стабилизатор глин (KCl, NH4Cl)
  | "mutual_solvent"        // взаимный растворитель (EGMBE)
  | "demulsifier"           // деэмульгатор
  | "scale_inhibitor"       // ингибитор солеотложения (НТФ, ОЭДФ)
  | "gelling_agent"         // гелянт / загуститель (КМЦ, ксантан)
  | "polymer"               // полимер (ПАА, ПАВ-полимер)
  | "foam_stabilizer"       // стабилизатор пены
  | "solvent"               // органический растворитель (толуол, ксилол)
  | "gas_generator"         // газогенерирующий (NH4Cl, NaNO2)
  | "other";

export type SurfactantClass =
  | "fluorinated" | "amphoteric" | "nonionic" | "anionic" | "cationic" | "none";

/** Автоопределение категории по названию и назначению. */
export function detectAdditiveCategory(a: { name: string; purpose: string; category?: AdditiveCategory }): AdditiveCategory {
  if (a.category) return a.category;
  const s = `${a.name} ${a.purpose}`.toLowerCase();
  if (/ингибитор\s*корроз|солинг|инкоргаз|corrosion/.test(s)) return "corrosion_inhibitor";
  if (/железа|fe|iron|лимонн|уксусн|citric|acetic|nta/.test(s)) return "iron_control";
  if (/стабилизатор\s*глин|kcl|nh4cl|хлорид\s*аммония|clay/.test(s) && !/газоген/.test(s)) return "clay_stabilizer";
  if (/взаимн.*раствор|egmbe|бутилцеллозольв|mutual/.test(s)) return "mutual_solvent";
  if (/деэмульг|demulsif|разрушитель\s*эмульс/.test(s)) return "demulsifier";
  if (/солеотлож|scale\s*inhib|нтф|оэдф|ипхан/.test(s)) return "scale_inhibitor";
  if (/паа|полиакрилам|polymer|гуар|guar/.test(s)) return "polymer";
  if (/гелянт|загуст|кмц|ксантан|xanthan|gel/.test(s)) return "gelling_agent";
  if (/стабилизатор\s*пены|foam\s*stab/.test(s)) return "foam_stabilizer";
  if (/nh4cl|nano2|газоген|gas\s*gen/.test(s)) return "gas_generator";
  if (/толуол|ксилол|бензин|нефрас|конденсат|растворитель|toluene|xylene/.test(s)) return "solvent";
  return "other";
}

/** Классификация ПАВ по химической природе. */
export function classifySurfactant(name: string): SurfactantClass {
  const s = name.toLowerCase().trim();
  if (!s || s === "—") return "none";
  if (/фтор|fluor|fc-?\d|зонил/.test(s)) return "fluorinated";
  if (/амфо|бетаин|capb|coco-?betaine/.test(s)) return "amphoteric";
  if (/неонол|оп-?\d|превоцел|нефтенол\s*к|синтанол/.test(s)) return "nonionic";
  if (/нефтенол\s*впк|катамин|катапин|cetac|катион|чак/.test(s)) return "cationic";
  return "anionic"; // Сульфонол, АОС, ПО-3А и т.п.
}

/** Стабильность пены: множитель к ΔS и к окну допустимого FQ. */
const FOAM_STABILITY_FACTOR: Record<SurfactantClass, number> = {
  fluorinated: 1.30, amphoteric: 1.15, nonionic: 1.10,
  anionic: 1.00,     cationic:   0.95, none:     0.40,
};

/** Кривая насыщения от концентрации добавки. */
function sat(conc: number, scale: number): number {
  if (conc <= 0) return 0;
  return 1 - Math.exp(-conc / Math.max(1e-6, scale));
}

/** Эффекты по категориям добавок (зависят от концентрации). */
const ADDITIVE_EFFECTS: Record<AdditiveCategory, (conc: number) => {
  maxTempBonusC?: number;
  skinReductionFactor?: number;   // множитель к ΔS
  penetrationFactor?: number;     // множитель к Rpen
  viscosityCp?: number;           // добавка к μ базовой жидкости
  tauHoursFactor?: number;        // множитель к τ чистки (меньше = быстрее)
  halfLifeFactor?: number;        // множитель к T½ (больше = дольше эффект)
  protectsAgainstFe?: boolean;
  protectsAgainstCorrosion?: boolean;
}> = {
  corrosion_inhibitor: (c) => ({ maxTempBonusC: 40 * sat(c, 0.3), protectsAgainstCorrosion: c >= 0.2 }),
  iron_control:        (c) => ({ protectsAgainstFe: c >= 0.3, skinReductionFactor: 1 + 0.05 * sat(c, 0.5) }),
  clay_stabilizer:     (c) => ({ skinReductionFactor: 1 + 0.10 * sat(c, 2),   halfLifeFactor: 1 + 0.40 * sat(c, 2) }),
  mutual_solvent:      (c) => ({ skinReductionFactor: 1 + 0.25 * sat(c, 5),   penetrationFactor: 1 + 0.15 * sat(c, 5), tauHoursFactor: 1 - 0.20 * sat(c, 3) }),
  demulsifier:         (c) => ({ tauHoursFactor: 1 - 0.45 * sat(c, 0.2) }),
  scale_inhibitor:     (c) => ({ halfLifeFactor: 1 + 0.20 * sat(c, 0.5) }),
  gelling_agent:       (c) => ({ viscosityCp: 30 * sat(c, 0.5),  penetrationFactor: 1 + 0.10 * sat(c, 0.5) }),
  polymer:             (c) => ({ viscosityCp: 80 * sat(c, 0.5),  penetrationFactor: 1 + 0.15 * sat(c, 0.5), skinReductionFactor: 0.95 }),
  foam_stabilizer:     (c) => ({ skinReductionFactor: 1 + 0.05 * sat(c, 0.5) }),
  solvent:             (c) => ({ skinReductionFactor: 1 + 0.20 * sat(c, 30),  penetrationFactor: 1 + 0.10 * sat(c, 30) }),
  gas_generator:       () => ({}),
  other:               () => ({}),
};

export interface ChemistryAnalysis {
  // Сводные множители, применённые к физике
  surfactantClass: SurfactantClass;
  foamStabilityFactor: number;
  effectiveMaxTempC: number;
  skinReductionMultiplier: number;
  penetrationMultiplier: number;
  apparentViscosityCp: number;
  tauHoursFactor: number;
  halfLifeFactor: number;
  // Защита
  hasCorrosionProtection: boolean;
  hasIronControl: boolean;
  // Разбор по добавкам
  perAdditive: Array<{
    name: string;
    concentration: number;
    unit: string;
    category: AdditiveCategory;
    effect: string;
  }>;
  // Совместимость
  compatibilityWarnings: string[];
  compatibilityNotes: string[];
}

const CAT_LABEL_RU: Record<AdditiveCategory, string> = {
  corrosion_inhibitor: "Ингибитор коррозии",
  iron_control: "Стабилизатор Fe³⁺",
  clay_stabilizer: "Стабилизатор глин",
  mutual_solvent: "Взаимный растворитель",
  demulsifier: "Деэмульгатор",
  scale_inhibitor: "Ингибитор солеотложения",
  gelling_agent: "Гелянт / загуститель",
  polymer: "Полимер",
  foam_stabilizer: "Стабилизатор пены",
  solvent: "Органический растворитель",
  gas_generator: "Газогенерирующий реагент",
  other: "Прочее",
};

export function getAdditiveCategoryLabel(c: AdditiveCategory): string {
  return CAT_LABEL_RU[c] ?? c;
}

/** Главный анализатор химии рецепта. */
export function analyzeFoamChemistry(
  recipe: FoamTreatmentRecipe,
  well: FoamTreatmentWellData,
): ChemistryAnalysis {
  const surfactantClass = classifySurfactant(recipe.surfactantType);
  const foamStab = FOAM_STABILITY_FACTOR[surfactantClass];

  let maxTempBonus = 0;
  let skinMult = 1;
  let penMult = 1;
  let visc = 1; // базовая вода ~1 cP
  let tauF = 1;
  let halfF = 1;
  let hasCorr = false;
  let hasFe = false;

  const perAdditive: ChemistryAnalysis["perAdditive"] = [];

  for (const a of recipe.additives) {
    const cat = detectAdditiveCategory(a);
    const conc = a.concentration;
    const eff = ADDITIVE_EFFECTS[cat](conc);
    const parts: string[] = [];

    if (eff.maxTempBonusC) { maxTempBonus += eff.maxTempBonusC; parts.push(`+${eff.maxTempBonusC.toFixed(0)}°C к Tмакс`); }
    if (eff.skinReductionFactor) { skinMult *= eff.skinReductionFactor; parts.push(`×${eff.skinReductionFactor.toFixed(2)} к ΔS`); }
    if (eff.penetrationFactor)   { penMult  *= eff.penetrationFactor;   parts.push(`×${eff.penetrationFactor.toFixed(2)} к Rпрон`); }
    if (eff.viscosityCp)         { visc     += eff.viscosityCp;         parts.push(`+${eff.viscosityCp.toFixed(0)} cP к μ`); }
    if (eff.tauHoursFactor)      { tauF     *= eff.tauHoursFactor;      parts.push(`τ чистки ×${eff.tauHoursFactor.toFixed(2)}`); }
    if (eff.halfLifeFactor)      { halfF    *= eff.halfLifeFactor;      parts.push(`T½ эффекта ×${eff.halfLifeFactor.toFixed(2)}`); }
    if (eff.protectsAgainstCorrosion) hasCorr = true;
    if (eff.protectsAgainstFe)        hasFe   = true;

    perAdditive.push({
      name: a.name, concentration: conc, unit: a.unit, category: cat,
      effect: parts.length ? parts.join("; ") : "учёт в составе реагентов",
    });
  }

  // Подкорректировать ΔS на стабильность пены (хорошее ПАВ держит контакт)
  skinMult *= foamStab;

  // Совместимость
  const warn: string[] = [];
  const notes: string[] = [];
  const isAcid = recipe.type === "foam_acid_hcl" || recipe.type === "foam_acid_hf";

  if (isAcid && !hasCorr)
    warn.push("Кислотный рецепт без ингибитора коррозии — НКТ и оборудование под угрозой (особенно при T > 60 °C).");
  if (isAcid && well.reservoirTemperatureC > 80 && !hasFe)
    warn.push("HCl при T > 80 °C без стабилизатора Fe³⁺ — риск вторичного осаждения гидроокиси железа в пласте.");
  if (recipe.type === "foam_acid_hf" && recipe.collectorType === "carbonate")
    warn.push("HF на карбонатах — мгновенное осаждение CaF₂ (фторид кальция), пласт будет закольматирован.");
  if (surfactantClass === "cationic" && perAdditive.some(p => p.category === "polymer"))
    warn.push("Катионный ПАВ + анионный полимер (ПАА) — образование нерастворимого комплекса, закупорка ПЗП.");
  if (surfactantClass === "nonionic" && well.reservoirTemperatureC > 90)
    notes.push("Неионогенное ПАВ при T > 90 °C — возможен переход через точку помутнения, фазовое расслоение.");
  if (recipe.type === "foam_acid_hf" && !perAdditive.some(p => p.category === "mutual_solvent"))
    notes.push("Глинокислота без взаимного растворителя — на 15–25 % ниже эффективность по удалению водяного блока.");
  if (well.wellFluidType === "emulsion" && !perAdditive.some(p => p.category === "demulsifier"))
    notes.push("Скважина с эмульсией — добавьте деэмульгатор, иначе выход на режим затянется.");
  if (perAdditive.some(p => p.category === "polymer") && recipe.baseFluidType === "acid_hcl")
    warn.push("ПАА в среде HCl ≥ 15 % быстро деградирует — загущение работать не будет.");
  if (recipe.type === "foam_solvent" && well.skinFactor < 0)
    notes.push("Скин уже отрицательный — обработка растворителем малоэффективна (нет органических отложений).");

  return {
    surfactantClass,
    foamStabilityFactor: foamStab,
    effectiveMaxTempC: recipe.maxTempC + maxTempBonus,
    skinReductionMultiplier: skinMult,
    penetrationMultiplier: penMult,
    apparentViscosityCp: visc,
    tauHoursFactor: tauF,
    halfLifeFactor: halfF,
    hasCorrosionProtection: hasCorr,
    hasIronControl: hasFe,
    perAdditive,
    compatibilityWarnings: warn,
    compatibilityNotes: notes,
  };
}

/* ─────────── Внутренние хелперы ─────────── */

function calcFrictionInNKT(
  rateLps: number,
  idMm: number,
  lengthM: number,
  densityGcc: number,
  viscosityCp: number = 1,
): number {
  if (rateLps <= 0 || idMm <= 0 || lengthM <= 0) return 0;
  const d = idMm / 1000;
  const area = (Math.PI / 4) * d * d;
  const v = rateLps / 1000 / area; // м/с
  const rho = densityGcc * 1000;
  const mu = Math.max(0.0005, viscosityCp * 0.001); // Pa·s
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

  // Химико-реологический анализ (применён к расчёту)
  chemistry: ChemistryAnalysis;
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

  // 0. Анализ химии — даёт множители и эффективные параметры
  const chemistry = analyzeFoamChemistry(recipe, well);

  // 1. Объём обрабатывающей жидкости (на всю операцию)
  const treatmentVol = recipe.volumePerMeterPayZone * well.netPayM * cycles;

  // 2. Объём пены на устье (стандартные условия)
  const fq = Math.min(95, Math.max(0, recipe.targetFoamQuality));
  const foamVolSurface =
    fq < 99 ? treatmentVol / (1 - fq / 100) : treatmentVol * 100;

  // 3. Давление на забое (трение с учётом кажущейся вязкости от полимеров/гелянтов)
  const perfMidMD = (well.perfIntervalTopMD + well.perfIntervalBottomMD) / 2;
  const perfTVD = interpolateTVD(perfMidMD, well.trajectory);
  const hydrostaticMPa = (well.wellFluidDensity * G * perfTVD) / 1000;

  const friction = calcFrictionInNKT(
    options.injectionRateLps,
    well.nktID_mm,
    Math.min(well.nktDepthMD, well.wellDepthMD),
    recipe.baseFluidDensity,
    chemistry.apparentViscosityCp,
  );

  // Целевое забойное давление = пластовое + 2 МПа (мин. перепад для приёмистости)
  const bhpInjection = well.reservoirPressureMPa + 2.0;
  const surfacePressure = Math.max(0, bhpInjection - hydrostaticMPa + friction);

  // 4. Запас до ГРП
  const pressureMargin = well.fracturePressureMPa - bhpInjection;

  // 5. N₂
  const tempK = well.reservoirTemperatureC + 273.15;
  const Z = calcN2ZFactor(bhpInjection, tempK);

  const compression = (ATM_MPA * tempK) / (bhpInjection * STD_TEMP_K * Z);
  const n2VolSurfTotal = foamVolSurface - treatmentVol;
  const n2VolFormation = n2VolSurfTotal * compression;
  const foamVolFormation = treatmentVol + n2VolFormation;
  const fqFormation = (n2VolFormation / Math.max(1e-9, foamVolFormation)) * 100;
  const foamDensityFormation =
    recipe.baseFluidDensity * (1 - fqFormation / 100);

  // 6. Радиус проникновения (за один цикл) — с учётом химии (взаимный раств., гелянт)
  const rw = well.casingID_mm / 2000;
  const effectivePorosity = Math.max(0.01, well.porosity * (1 - 0.3));
  const treatPerCycle = treatmentVol / cycles;
  const RpenetrationRaw = Math.sqrt(
    treatPerCycle / (Math.PI * Math.max(0.1, well.netPayM) * effectivePorosity) + rw * rw,
  );
  const Rpenetration = RpenetrationRaw * chemistry.penetrationMultiplier;

  // 7. Продавка = объём НКТ от устья до перфорации
  const nktArea = (Math.PI / 4) * Math.pow(well.nktID_mm / 1000, 2);
  const dispVolume = nktArea * Math.min(well.nktDepthMD, perfMidMD);

  // 8. Время
  const rateM3min = options.injectionRateLps * 0.06;
  const foamVolPerCycleSurface = foamVolSurface / cycles;
  const injectionTimeMin = foamVolPerCycleSurface / Math.max(0.001, rateM3min);
  const dispTimeMin = dispVolume / Math.max(0.001, rateM3min);
  const cycleTimeMin = injectionTimeMin + dispTimeMin + options.soakTimeMin + 30;
  const totalTimeMin = cycleTimeMin * cycles;

  const n2VolStdPerCycle = n2VolSurfTotal / cycles;
  const n2PeakRate = n2VolStdPerCycle / Math.max(0.1, injectionTimeMin);

  // 9. Прогноз скина и дебита — с учётом химии (множитель ΔS)
  const reductionRange =
    recipe.skinReductionEstimate[1] - recipe.skinReductionEstimate[0];
  const penetrationFactor = Math.min(1, Rpenetration / 3);
  const cycleBonus = Math.min(1, (cycles - 1) * 0.15);
  const skinReductionBase =
    recipe.skinReductionEstimate[0] +
    reductionRange * (0.5 * penetrationFactor + 0.5 * cycleBonus);
  const skinReduction = skinReductionBase * chemistry.skinReductionMultiplier;
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

  // 10. Предупреждения (физика + химия)
  const warnings: string[] = [];
  if (pressureMargin < 1.0)
    warnings.push(`Запас до ГРП всего ${pressureMargin.toFixed(1)} МПа — высокий риск гидроразрыва.`);
  if (recipe.targetFoamQuality > 80)
    warnings.push("FQ > 80% — риск нестабильности пены, возможен распад.");
  if (Rpenetration < 0.5)
    warnings.push("Радиус проникновения < 0.5 м — увеличьте объём обработки или число циклов.");
  if (well.reservoirTemperatureC > chemistry.effectiveMaxTempC)
    warnings.push(
      `Температура пласта ${well.reservoirTemperatureC}°C выше эффективного предела рецептуры ${chemistry.effectiveMaxTempC.toFixed(0)}°C (с учётом ингибитора).`,
    );
  if (surfacePressure > 32)
    warnings.push(`Устьевое давление ${surfacePressure.toFixed(1)} МПа > 32 МПа — нужен агрегат высокого давления.`);
  if (!options.usePacker && recipe.type.startsWith("foam_acid"))
    warnings.push("Кислотная обработка без пакера — обсадная колонна подвергается коррозии.");
  // Подмешиваем критические предупреждения химии
  for (const w of chemistry.compatibilityWarnings) warnings.push(w);

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
    chemistry,
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

/* ─────────── Расход реагентов ─────────── */

export interface ReagentItem {
  name: string;
  category: "base_fluid" | "surfactant" | "additive" | "nitrogen" | "displacement";
  amount: number;
  unit: string;
  cost?: number;
}

/**
 * Полная разбивка всех компонентов на операцию.
 * Концентрации в % считаются массовыми (от базовой жидкости).
 * Концентрации в кг/м³ применяются как есть.
 */
export function buildReagentConsumption(
  recipe: FoamTreatmentRecipe,
  result: FoamTreatmentResult,
): ReagentItem[] {
  const items: ReagentItem[] = [];
  const baseVolM3 = result.treatmentVolumeM3; // объём базовой жидкости
  const baseMassT = (baseVolM3 * recipe.baseFluidDensity * 1000) / 1000; // т

  const baseLabel =
    recipe.baseFluidType === "acid_hcl"
      ? `HCl ${recipe.baseFluidConcentration ?? 15}%`
      : recipe.baseFluidType === "acid_hf_mud"
      ? `HCl/HF смесь`
      : recipe.baseFluidType === "solvent"
      ? "Растворитель"
      : recipe.baseFluidType === "brine"
      ? "Рассол"
      : "Техническая вода";

  items.push({
    name: baseLabel,
    category: "base_fluid",
    amount: baseVolM3,
    unit: "м³",
  });

  if (recipe.surfactantConc > 0 && recipe.surfactantType !== "—") {
    items.push({
      name: `ПАВ: ${recipe.surfactantType}`,
      category: "surfactant",
      amount: (baseMassT * recipe.surfactantConc) / 100 * 1000, // кг
      unit: "кг",
    });
  }

  for (const a of recipe.additives) {
    const amount =
      a.unit === "%" ? (baseMassT * a.concentration) / 100 * 1000 : a.concentration * baseVolM3;
    items.push({
      name: a.name,
      category: "additive",
      amount,
      unit: "кг",
    });
  }

  if (result.n2VolumeStdM3 > 0.1) {
    items.push({
      name: "Азот N₂ (стд)",
      category: "nitrogen",
      amount: result.n2VolumeStdM3,
      unit: "м³",
    });
  }

  if (result.displacementVolumeM3 > 0) {
    items.push({
      name: "Продавочная жидкость",
      category: "displacement",
      amount: result.displacementVolumeM3 * result.numberOfCycles,
      unit: "м³",
    });
  }

  return items;
}

/* ─────────── Профиль расхода q(t) ─────────── */

export interface RateProfilePoint {
  time: number; // мин
  liquidRateLps: number;
  n2RateM3min: number;
  cycle: number;
  phase: string;
}

export function buildRateProfile(
  recipe: FoamTreatmentRecipe,
  options: FoamTreatmentOptions,
  result: FoamTreatmentResult,
): RateProfilePoint[] {
  const out: RateProfilePoint[] = [];
  const rateLps = options.injectionRateLps;
  const rateM3min = rateLps * 0.06;
  const foamVolPerCycleSurf = result.foamVolumeAtSurfaceM3 / result.numberOfCycles;
  const injTime = foamVolPerCycleSurf / Math.max(0.001, rateM3min);
  const dispTime = result.displacementVolumeM3 / Math.max(0.001, rateM3min);
  const soakTime = options.soakTimeMin;
  const bleedTime = 30;

  // Доля жидкости в пене ≈ (1 − FQ/100)
  const liqFrac = 1 - recipe.targetFoamQuality / 100;
  const liqRateDuringFoam = rateLps * liqFrac;
  const n2Peak = result.n2PeakRateM3min;

  let t = 0;
  const push = (dt: number, ql: number, qn: number, phase: string, c: number) => {
    out.push({ time: t, liquidRateLps: ql, n2RateM3min: qn, phase, cycle: c });
    out.push({ time: t + dt, liquidRateLps: ql, n2RateM3min: qn, phase, cycle: c });
    t += dt;
  };

  for (let c = 1; c <= result.numberOfCycles; c++) {
    push(injTime, liqRateDuringFoam, n2Peak, "Закачка пены", c);
    push(dispTime, rateLps, 0, "Продавка", c);
    push(soakTime, 0, 0, "Выдержка", c);
    push(bleedTime, 0, 0, "Стравливание", c);
  }
  return out;
}

/* ─────────── Эволюция скина по циклам ─────────── */

export interface SkinPerCycle {
  cycle: number;
  skin: number;
  productivityRatio: number;
  rateTpd?: number;
}

export function buildSkinEvolution(
  well: FoamTreatmentWellData,
  recipe: FoamTreatmentRecipe,
  result: FoamTreatmentResult,
): SkinPerCycle[] {
  const out: SkinPerCycle[] = [];
  const rw = well.casingID_mm / 2000;
  const Re = well.drainageRadiusM ?? 500;
  const lnRr = Math.log(Re / Math.max(0.05, rw));
  const totalReduction = result.expectedSkinReduction;

  out.push({
    cycle: 0,
    skin: well.skinFactor,
    productivityRatio: 1,
    rateTpd: well.currentRateTpd,
  });

  // Закон убывающей отдачи по циклам: 1й — 60%, 2й — +25%, 3й — +10%, далее насыщение
  const weights = [0.6, 0.25, 0.1, 0.04, 0.01];
  let cum = 0;
  for (let c = 1; c <= result.numberOfCycles; c++) {
    cum += weights[Math.min(c - 1, weights.length - 1)];
    const reductionSoFar = totalReduction * Math.min(1, cum);
    const skin = Math.max(-2, well.skinFactor - reductionSoFar);
    const pr = (lnRr + well.skinFactor) / Math.max(0.1, lnRr + skin);
    out.push({
      cycle: c,
      skin,
      productivityRatio: pr,
      rateTpd: well.currentRateTpd != null ? well.currentRateTpd * pr : undefined,
    });
  }
  return out;
}

/* ─────────── Прогноз дебита после обработки (часы и сутки) ─────────── */

export interface ProductionPoint {
  hours: number;
  days: number;
  rateTpd: number;
  cumulativeT: number;
  cumulativeGainT: number;
}

/**
 * Динамика выхода на режим:
 *   1) Чистка: первые 24 ч низкий дебит (вынос пены/реагентов), нарастает экспоненциально.
 *      q_clean(t) = q_after * (1 − exp(−t/τ)), τ ≈ 8 ч
 *   2) Период стабильного эффекта (1–60 сут): пик в районе 5–10 сут.
 *   3) Постепенное снижение эффекта: экспоненциальное затухание прироста,
 *      период полураспада ~180 сут (типично для ОПЗ).
 */
export function buildProductionForecast(
  well: FoamTreatmentWellData,
  result: FoamTreatmentResult,
  horizonDays = 90,
): ProductionPoint[] {
  const baseRate = well.currentRateTpd ?? 0;
  const finalRate = result.expectedRateTpd ?? baseRate;
  const gain = Math.max(0, finalRate - baseRate);

  const tauHours = 8;
  const halfLifeDays = 180;
  const k = Math.log(2) / halfLifeDays;

  const points: ProductionPoint[] = [];
  let cumulative = 0;
  let cumulativeBase = 0;

  // Шаг 1 ч в первые 3 суток, далее — 1 сутки
  const hourSamples: number[] = [];
  for (let h = 0; h <= 72; h += 1) hourSamples.push(h);
  for (let d = 4; d <= horizonDays; d += 1) hourSamples.push(d * 24);

  let prevH = 0;
  for (const h of hourSamples) {
    const days = h / 24;
    const cleanup = 1 - Math.exp(-h / tauHours);
    const decline = Math.exp(-k * days);
    const rate = baseRate + gain * cleanup * decline;

    const dt = (h - prevH) / 24; // сутки
    cumulative += rate * dt;
    cumulativeBase += baseRate * dt;
    prevH = h;

    points.push({
      hours: h,
      days: +days.toFixed(3),
      rateTpd: rate,
      cumulativeT: cumulative,
      cumulativeGainT: cumulative - cumulativeBase,
    });
  }
  return points;
}
