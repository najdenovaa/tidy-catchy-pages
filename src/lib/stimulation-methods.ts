// Библиотека методов интенсификации добычи (ОПЗ / Стимуляция)
import type { DamageMechanism } from "./foam-treatment-diagnostics";

export type StimulationType =
  | "matrix_acid_hcl"
  | "matrix_acid_hf"
  | "acid_fracturing"
  | "acid_diversion"
  | "retarded_acid"
  | "emulsified_acid"
  | "organic_acid"
  | "foam_surfactant"
  | "foam_acid_hcl"
  | "foam_acid_hf"
  | "foam_solvent"
  | "foam_acid_combo"
  | "acid_then_foam"
  | "solvent_aspo"
  | "solvent_paraffin"
  | "n2_lift"
  | "n2_foam_lift"
  | "reperforation"
  | "impulse_wave"
  | "thermal"
  | "custom";

export type CollectorType = "sandstone" | "carbonate" | "fractured" | "tight";
export type MethodCategory = "acid" | "foam" | "combo" | "solvent" | "nitrogen" | "physical";

export interface MethodAdditive {
  name: string;
  purpose: string;
  concentration: number;
  unit: "%" | "кг/м³" | "л/м³";
  costPerUnit: number;
  required: boolean;
}

export interface StimulationMethod {
  id: string;
  type: StimulationType;
  category: MethodCategory;
  nameRu: string;
  description: string;
  icon: string;

  collectorTypes: CollectorType[];
  damageTypes: DamageMechanism[];
  tempRangeC: [number, number];
  permRangeMd: [number, number];

  mainReagent: { name: string; concentration: number; density: number; costPerM3: number };
  additives: MethodAdditive[];

  volumePerMeterPay: number;
  recommendedRate: [number, number];
  requiresN2: boolean;
  targetFoamQuality?: number;
  numberOfCycles: number;
  soakTimeMin: [number, number];

  skinReductionRange: [number, number];
  successRate: number;
  effectDurationMonths: [number, number];

  risks: string[];
  contraindications: string[];
}

const inh = (c = 0.3): MethodAdditive => ({ name: "Ингибитор коррозии", purpose: "Защита НКТ/ОК", concentration: c, unit: "%", costPerUnit: 1500, required: true });
const pav = (n = "ПАВ", p = "Деэмульгатор", c = 0.2): MethodAdditive => ({ name: n, purpose: p, concentration: c, unit: "%", costPerUnit: 800, required: true });

export const STIMULATION_METHODS: StimulationMethod[] = [
  // ═══════ КИСЛОТНЫЕ ═══════
  {
    id: "hcl-matrix", type: "matrix_acid_hcl", category: "acid",
    nameRu: "Солянокислотная обработка (HCl)",
    description: "Классическая СКО для карбонатных коллекторов. HCl 12-15% растворяет CaCO₃, создаёт wormholes.",
    icon: "🧪",
    collectorTypes: ["carbonate", "fractured"],
    damageTypes: ["scale_deposition", "mud_filtrate", "perforation_damage"],
    tempRangeC: [20, 150], permRangeMd: [0.1, 5000],
    mainReagent: { name: "HCl 15%", concentration: 15, density: 1.07, costPerM3: 15000 },
    additives: [
      inh(0.3), pav(),
      { name: "Стабилизатор железа", purpose: "Связывание Fe³⁺", concentration: 0.5, unit: "%", costPerUnit: 1200, required: false },
      { name: "Взаимный растворитель", purpose: "Смачиваемость", concentration: 3, unit: "%", costPerUnit: 600, required: false },
    ],
    volumePerMeterPay: 1.5, recommendedRate: [100, 400], requiresN2: false,
    numberOfCycles: 1, soakTimeMin: [30, 120],
    skinReductionRange: [5, 20], successRate: 85, effectDurationMonths: [6, 24],
    risks: ["Коррозия труб при t>100°C", "Вторичное осаждение CaF₂", "Прорыв в водоносный"],
    contraindications: ["Терригенный коллектор без карбонатного цемента"],
  },
  {
    id: "mud-acid", type: "matrix_acid_hf", category: "acid",
    nameRu: "Глинокислотная обработка (HCl+HF)",
    description: "Для терригенных коллекторов. HCl 10-12% + HF 1-3%. Обязателен preflush.",
    icon: "⚗️",
    collectorTypes: ["sandstone"],
    damageTypes: ["mud_filtrate", "clay_swelling", "fines_migration", "perforation_damage"],
    tempRangeC: [20, 100], permRangeMd: [1, 500],
    mainReagent: { name: "HCl 12% + HF 3%", concentration: 12, density: 1.05, costPerM3: 25000 },
    additives: [
      inh(0.5),
      { name: "Ингибитор глин", purpose: "Предотвращение набухания", concentration: 1.0, unit: "%", costPerUnit: 2000, required: true },
      { name: "Буфер NH₄Cl", purpose: "Стабилизация pH afterflush", concentration: 3, unit: "%", costPerUnit: 400, required: true },
    ],
    volumePerMeterPay: 1.0, recommendedRate: [50, 200], requiresN2: false,
    numberOfCycles: 1, soakTimeMin: [30, 90],
    skinReductionRange: [3, 12], successRate: 75, effectDurationMonths: [4, 18],
    risks: ["Вторичное осаждение флюоридов", "Миграция мелочи"],
    contraindications: ["Карбонатный коллектор", "T > 100°C"],
  },
  {
    id: "acid-frac", type: "acid_fracturing", category: "acid",
    nameRu: "Кислотный ГРП",
    description: "Закачка HCl выше давления разрыва. Создание длинных проводящих каналов.",
    icon: "💥",
    collectorTypes: ["carbonate", "tight"],
    damageTypes: ["perforation_damage", "scale_deposition"],
    tempRangeC: [30, 150], permRangeMd: [0.01, 100],
    mainReagent: { name: "HCl 15-28%", concentration: 20, density: 1.10, costPerM3: 18000 },
    additives: [inh(0.6), { name: "Гелеобразователь", purpose: "Загущение", concentration: 0.8, unit: "%", costPerUnit: 3500, required: true }],
    volumePerMeterPay: 4.0, recommendedRate: [800, 2500], requiresN2: false,
    numberOfCycles: 1, soakTimeMin: [0, 30],
    skinReductionRange: [10, 40], successRate: 70, effectDurationMonths: [12, 60],
    risks: ["Прорыв в воду", "Высокие давления", "Деструкция цементного камня"],
    contraindications: ["Близость водоносного горизонта", "Слабый цементный камень"],
  },
  {
    id: "acid-divert", type: "acid_diversion", category: "acid",
    nameRu: "Кислота с отклонителем",
    description: "Поинтервальная обработка многопластовых скважин (шары, гели, волокна).",
    icon: "🎯",
    collectorTypes: ["carbonate", "sandstone"],
    damageTypes: ["scale_deposition", "perforation_damage", "mud_filtrate"],
    tempRangeC: [20, 130], permRangeMd: [0.1, 2000],
    mainReagent: { name: "HCl 15%", concentration: 15, density: 1.07, costPerM3: 15000 },
    additives: [inh(0.4), pav(), { name: "Отклонитель (волокно)", purpose: "Блокировка высокопрониц.", concentration: 5, unit: "кг/м³", costPerUnit: 800, required: true }],
    volumePerMeterPay: 1.8, recommendedRate: [100, 300], requiresN2: false,
    numberOfCycles: 1, soakTimeMin: [30, 120],
    skinReductionRange: [6, 18], successRate: 78, effectDurationMonths: [6, 24],
    risks: ["Неэффективное распределение", "Прорыв через отклонитель"],
    contraindications: [],
  },
  {
    id: "retarded-acid", type: "retarded_acid", category: "acid",
    nameRu: "Замедленная (гелированная) кислота",
    description: "HCl с полимерным загустителем. Глубокое проникновение.",
    icon: "🔬",
    collectorTypes: ["carbonate", "fractured"],
    damageTypes: ["scale_deposition", "mud_filtrate"],
    tempRangeC: [30, 120], permRangeMd: [1, 2000],
    mainReagent: { name: "Гелированная HCl 20%", concentration: 20, density: 1.10, costPerM3: 35000 },
    additives: [
      { name: "Полимерный загуститель", purpose: "Замедление реакции", concentration: 2, unit: "%", costPerUnit: 3000, required: true },
      inh(0.5),
      { name: "Брейкер", purpose: "Разрушение геля", concentration: 0.2, unit: "%", costPerUnit: 2000, required: true },
    ],
    volumePerMeterPay: 2.0, recommendedRate: [100, 300], requiresN2: false,
    numberOfCycles: 1, soakTimeMin: [60, 180],
    skinReductionRange: [8, 25], successRate: 80, effectDurationMonths: [8, 30],
    risks: ["Остаточный полимер", "Высокая стоимость"],
    contraindications: ["T < 30°C"],
  },
  {
    id: "emulsified-acid", type: "emulsified_acid", category: "acid",
    nameRu: "Эмульгированная кислота",
    description: "Кислота в дизтопливе (внутренняя фаза). Сильное замедление, для горячих пластов.",
    icon: "🧴",
    collectorTypes: ["carbonate"],
    damageTypes: ["scale_deposition", "wax_asphaltene"],
    tempRangeC: [60, 180], permRangeMd: [0.5, 1000],
    mainReagent: { name: "HCl 28% в дизеле", concentration: 28, density: 0.95, costPerM3: 40000 },
    additives: [inh(0.8), { name: "Эмульгатор", purpose: "Стабилизация эмульсии", concentration: 1.5, unit: "%", costPerUnit: 2500, required: true }],
    volumePerMeterPay: 2.0, recommendedRate: [80, 250], requiresN2: false,
    numberOfCycles: 1, soakTimeMin: [60, 240],
    skinReductionRange: [10, 30], successRate: 82, effectDurationMonths: [10, 36],
    risks: ["Сложная подготовка на устье", "Расслоение эмульсии"],
    contraindications: ["T < 60°C"],
  },
  {
    id: "organic-acid", type: "organic_acid", category: "acid",
    nameRu: "Органические кислоты (CH₃COOH, HCOOH)",
    description: "Уксусная/муравьиная для высокотемпературных и хромированных труб.",
    icon: "🍋",
    collectorTypes: ["carbonate", "sandstone"],
    damageTypes: ["scale_deposition", "mud_filtrate"],
    tempRangeC: [80, 200], permRangeMd: [0.1, 1000],
    mainReagent: { name: "CH₃COOH 10%", concentration: 10, density: 1.02, costPerM3: 22000 },
    additives: [inh(0.3), pav()],
    volumePerMeterPay: 1.2, recommendedRate: [60, 200], requiresN2: false,
    numberOfCycles: 1, soakTimeMin: [60, 180],
    skinReductionRange: [3, 10], successRate: 70, effectDurationMonths: [6, 18],
    risks: ["Низкая реакционная способность"],
    contraindications: ["T < 60°C"],
  },
  // ═══════ ПЕННЫЕ ═══════
  {
    id: "foam-pav", type: "foam_surfactant", category: "foam",
    nameRu: "Пенная ПАВ-обработка",
    description: "ПАВ + N₂. Очистка ПЗП от глинистых частиц и фильтрата. Многоцикловая.",
    icon: "🫧",
    collectorTypes: ["sandstone", "carbonate"],
    damageTypes: ["mud_filtrate", "fines_migration", "clay_swelling"],
    tempRangeC: [20, 90], permRangeMd: [0.5, 500],
    mainReagent: { name: "Раствор ПАВ 1%", concentration: 1, density: 1.0, costPerM3: 5000 },
    additives: [
      { name: "Сульфонол НП-3", purpose: "Пенообразователь", concentration: 1.0, unit: "%", costPerUnit: 800, required: true },
      { name: "КМЦ", purpose: "Стабилизатор пены", concentration: 0.3, unit: "%", costPerUnit: 400, required: false },
    ],
    volumePerMeterPay: 2.0, recommendedRate: [50, 200], requiresN2: true,
    targetFoamQuality: 70, numberOfCycles: 3, soakTimeMin: [30, 90],
    skinReductionRange: [2, 8], successRate: 70, effectDurationMonths: [3, 12],
    risks: ["Нестабильность пены при t>90°C"], contraindications: [],
  },
  {
    id: "foam-acid-hcl", type: "foam_acid_hcl", category: "foam",
    nameRu: "Пенокислотная HCl",
    description: "HCl 12% + ПАВ + N₂. Замедление реакции + энергия газа при стравливании.",
    icon: "🧫",
    collectorTypes: ["carbonate"],
    damageTypes: ["scale_deposition", "mud_filtrate", "perforation_damage"],
    tempRangeC: [20, 100], permRangeMd: [0.5, 2000],
    mainReagent: { name: "HCl 12%", concentration: 12, density: 1.06, costPerM3: 12000 },
    additives: [{ name: "ПАВ (Нефтенол)", purpose: "Пенообразователь", concentration: 0.5, unit: "%", costPerUnit: 1200, required: true }, inh(0.3)],
    volumePerMeterPay: 2.5, recommendedRate: [50, 200], requiresN2: true,
    targetFoamQuality: 60, numberOfCycles: 2, soakTimeMin: [30, 120],
    skinReductionRange: [5, 15], successRate: 80, effectDurationMonths: [6, 24],
    risks: ["Коррозия при t>80°C", "Нестабильность пены"], contraindications: ["Терригенный коллектор"],
  },
  {
    id: "foam-acid-hf", type: "foam_acid_hf", category: "foam",
    nameRu: "Пеноглинокислота (HCl+HF+ПАВ+N₂)",
    description: "Глинокислота в пене для терригенов. Глубокое и равномерное проникновение.",
    icon: "🧪",
    collectorTypes: ["sandstone"],
    damageTypes: ["mud_filtrate", "clay_swelling", "fines_migration"],
    tempRangeC: [20, 90], permRangeMd: [1, 300],
    mainReagent: { name: "HCl 10% + HF 2%", concentration: 10, density: 1.04, costPerM3: 23000 },
    additives: [inh(0.5), { name: "ПАВ", purpose: "Пенообразователь", concentration: 0.7, unit: "%", costPerUnit: 1200, required: true }],
    volumePerMeterPay: 2.0, recommendedRate: [50, 180], requiresN2: true,
    targetFoamQuality: 65, numberOfCycles: 2, soakTimeMin: [30, 90],
    skinReductionRange: [4, 14], successRate: 75, effectDurationMonths: [6, 20],
    risks: ["Осаждение флюоридов"], contraindications: ["Карбонатный коллектор"],
  },
  {
    id: "foam-solvent", type: "foam_solvent", category: "foam",
    nameRu: "Пена + растворитель (АСПО)",
    description: "Растворитель в пене с N₂. Эффективно при низких давлениях.",
    icon: "🛢️",
    collectorTypes: ["sandstone", "carbonate"],
    damageTypes: ["wax_asphaltene", "emulsion_block"],
    tempRangeC: [10, 80], permRangeMd: [0.5, 1000],
    mainReagent: { name: "Нефрас + ПАВ", concentration: 100, density: 0.80, costPerM3: 42000 },
    additives: [{ name: "ПАВ (диспергатор)", purpose: "Пенообразователь+диспергатор", concentration: 2, unit: "%", costPerUnit: 1500, required: true }],
    volumePerMeterPay: 1.8, recommendedRate: [40, 150], requiresN2: true,
    targetFoamQuality: 70, numberOfCycles: 2, soakTimeMin: [60, 240],
    skinReductionRange: [4, 12], successRate: 78, effectDurationMonths: [4, 14],
    risks: ["Пожароопасность"], contraindications: [],
  },
  // ═══════ КОМБИНИРОВАННЫЕ ═══════
  {
    id: "foam-acid-combo", type: "foam_acid_combo", category: "combo",
    nameRu: "Пенокислота + матричная кислота",
    description: "Сначала пенокислота для глубокого проникновения, затем матричная — для приствольной зоны.",
    icon: "🔗",
    collectorTypes: ["carbonate"],
    damageTypes: ["scale_deposition", "mud_filtrate", "perforation_damage"],
    tempRangeC: [30, 110], permRangeMd: [0.5, 2000],
    mainReagent: { name: "HCl 12% + HCl 15%", concentration: 13, density: 1.06, costPerM3: 14000 },
    additives: [inh(0.5), pav("ПАВ", "Пенообразователь", 0.6)],
    volumePerMeterPay: 3.5, recommendedRate: [80, 250], requiresN2: true,
    targetFoamQuality: 60, numberOfCycles: 2, soakTimeMin: [60, 180],
    skinReductionRange: [10, 25], successRate: 82, effectDurationMonths: [10, 30],
    risks: ["Сложная циклограмма"], contraindications: ["Терригенный коллектор"],
  },
  {
    id: "acid-then-foam", type: "acid_then_foam", category: "combo",
    nameRu: "Кислота → пена (последовательно)",
    description: "Кислота для растворения, пена — для вытеснения продуктов реакции.",
    icon: "➡️",
    collectorTypes: ["carbonate", "sandstone"],
    damageTypes: ["scale_deposition", "mud_filtrate", "fines_migration"],
    tempRangeC: [20, 100], permRangeMd: [0.5, 1500],
    mainReagent: { name: "HCl 12% + ПАВ+N₂", concentration: 12, density: 1.06, costPerM3: 13000 },
    additives: [inh(0.4), pav("ПАВ", "Пенообразователь", 0.5)],
    volumePerMeterPay: 3.0, recommendedRate: [80, 220], requiresN2: true,
    targetFoamQuality: 65, numberOfCycles: 2, soakTimeMin: [60, 150],
    skinReductionRange: [8, 22], successRate: 80, effectDurationMonths: [8, 24],
    risks: ["Длительность операции"], contraindications: [],
  },
  // ═══════ РАСТВОРИТЕЛИ ═══════
  {
    id: "hot-solvent", type: "solvent_aspo", category: "solvent",
    nameRu: "Обработка растворителем (АСПО)",
    description: "Горячий нефрас/толуол для удаления асфальтенов и парафинов.",
    icon: "🔥",
    collectorTypes: ["sandstone", "carbonate"],
    damageTypes: ["wax_asphaltene"],
    tempRangeC: [20, 120], permRangeMd: [0.1, 5000],
    mainReagent: { name: "Нефрас С2-80/120", concentration: 100, density: 0.78, costPerM3: 45000 },
    additives: [{ name: "ПАВ (диспергатор)", purpose: "Диспергирование АСПО", concentration: 2, unit: "%", costPerUnit: 1000, required: true }],
    volumePerMeterPay: 1.5, recommendedRate: [30, 100], requiresN2: false,
    numberOfCycles: 2, soakTimeMin: [120, 480],
    skinReductionRange: [3, 10], successRate: 75, effectDurationMonths: [3, 12],
    risks: ["Пожароопасность", "Экологический риск"], contraindications: ["Близость водоносного"],
  },
  {
    id: "paraffin-hot", type: "solvent_paraffin", category: "solvent",
    nameRu: "Депарафинизация (горячая нефть)",
    description: "Закачка горячей нефти/конденсата для оплавления парафина.",
    icon: "♨️",
    collectorTypes: ["sandstone", "carbonate"],
    damageTypes: ["wax_asphaltene"],
    tempRangeC: [10, 80], permRangeMd: [0.5, 5000],
    mainReagent: { name: "Горячая нефть 90°C", concentration: 100, density: 0.85, costPerM3: 8000 },
    additives: [],
    volumePerMeterPay: 2.5, recommendedRate: [50, 200], requiresN2: false,
    numberOfCycles: 1, soakTimeMin: [60, 240],
    skinReductionRange: [2, 8], successRate: 65, effectDurationMonths: [2, 8],
    risks: ["Охлаждение в стволе"], contraindications: [],
  },
  // ═══════ АЗОТНЫЕ ═══════
  {
    id: "n2-lift", type: "n2_lift", category: "nitrogen",
    nameRu: "Азотный лифт (вызов притока)",
    description: "Замещение столба жидкости N₂ для снижения BHP.",
    icon: "💨",
    collectorTypes: ["sandstone", "carbonate", "fractured", "tight"],
    damageTypes: [],
    tempRangeC: [0, 200], permRangeMd: [0.01, 50000],
    mainReagent: { name: "Азот (N₂)", concentration: 100, density: 0.001, costPerM3: 0 },
    additives: [],
    volumePerMeterPay: 0, recommendedRate: [200, 800], requiresN2: true,
    targetFoamQuality: 95, numberOfCycles: 1, soakTimeMin: [0, 0],
    skinReductionRange: [0, 2], successRate: 90, effectDurationMonths: [1, 6],
    risks: ["Неконтролируемый приток", "ГНВП"],
    contraindications: ["Газовая скважина с высоким Pпл"],
  },
  {
    id: "n2-foam-lift", type: "n2_foam_lift", category: "nitrogen",
    nameRu: "Пенный лифт (ПАВ + N₂)",
    description: "Пена снижает плотность столба и обеспечивает мягкий вызов притока.",
    icon: "🌬️",
    collectorTypes: ["sandstone", "carbonate", "fractured", "tight"],
    damageTypes: ["water_block", "condensate_banking"],
    tempRangeC: [0, 120], permRangeMd: [0.01, 10000],
    mainReagent: { name: "Раствор ПАВ 0.5%", concentration: 0.5, density: 1.0, costPerM3: 4000 },
    additives: [{ name: "ПАВ", purpose: "Пенообразователь", concentration: 0.5, unit: "%", costPerUnit: 800, required: true }],
    volumePerMeterPay: 0.5, recommendedRate: [100, 400], requiresN2: true,
    targetFoamQuality: 85, numberOfCycles: 1, soakTimeMin: [0, 60],
    skinReductionRange: [0, 4], successRate: 88, effectDurationMonths: [2, 8],
    risks: ["Нестабильность пены"], contraindications: [],
  },
  // ═══════ ФИЗИЧЕСКИЕ ═══════
  {
    id: "reperf", type: "reperforation", category: "physical",
    nameRu: "Дострел / переперфорация",
    description: "Дополнительная перфорация для увеличения площади притока.",
    icon: "🎯",
    collectorTypes: ["sandstone", "carbonate", "fractured", "tight"],
    damageTypes: ["perforation_damage"],
    tempRangeC: [0, 200], permRangeMd: [0.001, 50000],
    mainReagent: { name: "Перфораторы ПКО", concentration: 100, density: 1, costPerM3: 0 },
    additives: [],
    volumePerMeterPay: 0, recommendedRate: [0, 0], requiresN2: false,
    numberOfCycles: 1, soakTimeMin: [0, 0],
    skinReductionRange: [2, 10], successRate: 85, effectDurationMonths: [12, 60],
    risks: ["Прорыв в воду/газ"], contraindications: ["Близость ВНК/ГНК"],
  },
  {
    id: "impulse", type: "impulse_wave", category: "physical",
    nameRu: "Импульсно-волновое воздействие",
    description: "Гидроимпульсы / акустика для очистки ПЗП без химии.",
    icon: "🌊",
    collectorTypes: ["sandstone", "carbonate", "fractured"],
    damageTypes: ["fines_migration", "mud_filtrate", "perforation_damage"],
    tempRangeC: [0, 150], permRangeMd: [0.1, 5000],
    mainReagent: { name: "Скважинная жидкость", concentration: 100, density: 1.0, costPerM3: 100 },
    additives: [],
    volumePerMeterPay: 0.3, recommendedRate: [0, 0], requiresN2: false,
    numberOfCycles: 5, soakTimeMin: [0, 30],
    skinReductionRange: [1, 6], successRate: 60, effectDurationMonths: [3, 10],
    risks: ["Низкая эффективность при глубоком повреждении"], contraindications: [],
  },
  {
    id: "thermal", type: "thermal", category: "physical",
    nameRu: "Термообработка (пар / горячая вода)",
    description: "Прогрев ПЗП паром для расплавления АСПО и снижения вязкости.",
    icon: "♨️",
    collectorTypes: ["sandstone", "carbonate"],
    damageTypes: ["wax_asphaltene"],
    tempRangeC: [10, 80], permRangeMd: [1, 5000],
    mainReagent: { name: "Пар / горячая вода", concentration: 100, density: 0.95, costPerM3: 500 },
    additives: [],
    volumePerMeterPay: 5.0, recommendedRate: [100, 500], requiresN2: false,
    numberOfCycles: 1, soakTimeMin: [240, 1440],
    skinReductionRange: [2, 8], successRate: 70, effectDurationMonths: [3, 10],
    risks: ["Тепловые потери", "Деструкция цемента"], contraindications: ["Многолетняя мерзлота"],
  },
];

export const METHOD_CATEGORY_LABEL: Record<MethodCategory, string> = {
  acid: "Кислотные",
  foam: "Пенные",
  combo: "Комбинированные",
  solvent: "Растворительные",
  nitrogen: "Азотные",
  physical: "Физические",
};

export const COLLECTOR_LABEL: Record<CollectorType, string> = {
  sandstone: "Терригенный",
  carbonate: "Карбонатный",
  fractured: "Трещиноватый",
  tight: "Низкопроницаемый",
};
