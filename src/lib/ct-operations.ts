/**
 * Библиотека операций ГНКТ (Coiled Tubing Operations Library).
 *
 * Каждая операция содержит:
 *   - рекомендуемую рабочую жидкость
 *   - диапазон расхода и устьевого давления
 *   - типичную КНБК
 *   - флаги (вращение, азот)
 *   - типовые риски
 *
 * Расходы в библиотеке даны в **л/мин** (отраслевая практика для ГНКТ),
 * UI приложения хранит pump.flowRate в **л/с** — конвертация при применении.
 */

export type CTOperationType =
  | "wellbore_cleanout"
  | "acid_stimulation"
  | "nitrogen_kickoff"
  | "cement_squeeze"
  | "plug_setting"
  | "fishing"
  | "milling"
  | "sand_control"
  | "chemical_treatment"
  | "logging"
  | "perforation"
  | "gas_lift"
  | "scale_removal"
  | "paraffin_removal"
  | "well_kill"
  | "custom";

export interface CTOperation {
  type: CTOperationType;
  nameRu: string;
  description: string;
  icon: string;
  category: "Промывка/чистка" | "Стимуляция" | "Цемент/механика" | "Газовые" | "Сервис";
  recommendedFluid: string;
  recommendedFluidDensity: number; // г/см³ — для быстрого пресета FluidData
  recommendedFlowRateLpm: [number, number]; // мин-макс, л/мин
  recommendedSurfacePressureMPa: [number, number];
  typicalBHA: string[];
  requiresRotation: boolean;
  requiresNitrogen: boolean;
  risks: string[];
}

export const CT_OPERATIONS: CTOperation[] = [
  {
    type: "wellbore_cleanout",
    nameRu: "Промывка скважины",
    description:
      "Вымыв песка, проппанта, шлама. ГНКТ спускается до забоя, промывка прямая или обратная.",
    icon: "🧹",
    category: "Промывка/чистка",
    recommendedFluid: "Гель (ГПГ) или полимер",
    recommendedFluidDensity: 1.02,
    recommendedFlowRateLpm: [100, 400],
    recommendedSurfacePressureMPa: [5, 25],
    typicalBHA: ["Промывочная насадка", "Обратный клапан", "Разъединитель"],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: ["Прихват при остановке циркуляции", "Пескопроявление при подъёме"],
  },
  {
    type: "acid_stimulation",
    nameRu: "Кислотная обработка",
    description:
      "Закачка кислоты через ГНКТ с поинтервальной обработкой. Точечная доставка к целевому интервалу.",
    icon: "🧪",
    category: "Стимуляция",
    recommendedFluid: "HCl 15% или глинокислота (HCl+HF)",
    recommendedFluidDensity: 1.07,
    recommendedFlowRateLpm: [50, 200],
    recommendedSurfacePressureMPa: [10, 35],
    typicalBHA: ["Кислотная насадка", "Пакер надувной", "Обратный клапан"],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: ["Коррозия ГНКТ", "Превышение давления ГРП", "Вторичное осаждение Fe/Al"],
  },
  {
    type: "nitrogen_kickoff",
    nameRu: "Вызов притока азотом",
    description:
      "Замещение столба жидкости азотом через ГНКТ для снижения забойного давления и вызова притока.",
    icon: "💨",
    category: "Газовые",
    recommendedFluid: "Азот",
    recommendedFluidDensity: 0.001,
    recommendedFlowRateLpm: [200, 800],
    recommendedSurfacePressureMPa: [5, 30],
    typicalBHA: ["Обратный клапан", "Разъединитель"],
    requiresRotation: false,
    requiresNitrogen: true,
    risks: ["Гидратообразование", "Неконтролируемый приток", "Холодовая хрупкость"],
  },
  {
    type: "cement_squeeze",
    nameRu: "Задавка цементного раствора",
    description:
      "Доставка цемента через ГНКТ для ликвидации негерметичности, отсечения водопритоков.",
    icon: "🏗️",
    category: "Цемент/механика",
    recommendedFluid: "Цементный раствор ПЦТ",
    recommendedFluidDensity: 1.85,
    recommendedFlowRateLpm: [30, 150],
    recommendedSurfacePressureMPa: [10, 40],
    typicalBHA: ["Цементировочная насадка", "Обратный клапан"],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: ["Прихват в цементе", "Недопродавка", "Преждевременное загустевание"],
  },
  {
    type: "plug_setting",
    nameRu: "Установка цементного моста",
    description:
      "Установка цементного моста через ГНКТ для изоляции интервала / консервации скважины.",
    icon: "🧱",
    category: "Цемент/механика",
    recommendedFluid: "Цементный раствор ПЦТ",
    recommendedFluidDensity: 1.85,
    recommendedFlowRateLpm: [40, 120],
    recommendedSurfacePressureMPa: [5, 25],
    typicalBHA: ["Цементировочная насадка", "Обратный клапан"],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: ["Размыв моста при подъёме", "Контаминация скважинной жидкостью"],
  },
  {
    type: "fishing",
    nameRu: "Ловильные работы",
    description:
      "Извлечение аварийного оборудования (труб, инструмента) из скважины с помощью ловильного БКА на ГНКТ.",
    icon: "🪝",
    category: "Цемент/механика",
    recommendedFluid: "Скваж. жидкость или гель",
    recommendedFluidDensity: 1.05,
    recommendedFlowRateLpm: [50, 200],
    recommendedSurfacePressureMPa: [5, 30],
    typicalBHA: ["Гидро-ясс", "Овершот / труболовка", "Обратный клапан"],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: ["Прихват ГНКТ", "Невозможность освобождения от рыбы", "Обрыв"],
  },
  {
    type: "milling",
    nameRu: "Фрезерование",
    description:
      "Разбуривание цементных мостов, металлических пробок, отложений. Требует вращение через ВЗД.",
    icon: "⚙️",
    category: "Цемент/механика",
    recommendedFluid: "Буровой раствор или вода",
    recommendedFluidDensity: 1.10,
    recommendedFlowRateLpm: [100, 300],
    recommendedSurfacePressureMPa: [10, 30],
    typicalBHA: ["Фрезер", "ВЗД (забойный двигатель)", "Обратный клапан"],
    requiresRotation: true,
    requiresNitrogen: false,
    risks: ["Запирание", "Обрыв ГНКТ", "Перегрев фрезера"],
  },
  {
    type: "sand_control",
    nameRu: "Управление пескопроявлением",
    description:
      "Закачка ингибиторов пескопроявления / установка гравийного фильтра малого объёма через ГНКТ.",
    icon: "⏳",
    category: "Стимуляция",
    recommendedFluid: "Гель с проппантом / смолы",
    recommendedFluidDensity: 1.20,
    recommendedFlowRateLpm: [60, 200],
    recommendedSurfacePressureMPa: [10, 30],
    typicalBHA: ["Намывная насадка", "Пакер", "Обратный клапан"],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: ["Несформированный фильтр", "Прихват в гравии"],
  },
  {
    type: "chemical_treatment",
    nameRu: "Химическая обработка ПЗП",
    description:
      "Закачка ПАВ, ингибиторов АСПО, деэмульгаторов, биоцидов в призабойную зону пласта.",
    icon: "🧫",
    category: "Стимуляция",
    recommendedFluid: "ПАВ / ингибитор",
    recommendedFluidDensity: 1.02,
    recommendedFlowRateLpm: [50, 200],
    recommendedSurfacePressureMPa: [5, 25],
    typicalBHA: ["Распылительная насадка", "Обратный клапан"],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: ["Совместимость с пластом", "Эмульсии"],
  },
  {
    type: "logging",
    nameRu: "ГИС на ГНКТ",
    description:
      "Доставка геофизических приборов в горизонтальные скважины, где обычный кабель не проходит.",
    icon: "📡",
    category: "Сервис",
    recommendedFluid: "Скваж. жидкость",
    recommendedFluidDensity: 1.05,
    recommendedFlowRateLpm: [0, 50],
    recommendedSurfacePressureMPa: [0, 10],
    typicalBHA: ["Каротажная сборка (PLT, GR, CCL)", "Разъединитель"],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: ["Запирание на горизонте", "Помехи каротажу"],
  },
  {
    type: "perforation",
    nameRu: "Перфорация на ГНКТ",
    description:
      "Спуск перфоратора на ГНКТ под давлением (under-balance). Точная глубина установки.",
    icon: "🎯",
    category: "Сервис",
    recommendedFluid: "Скваж. жидкость / N₂",
    recommendedFluidDensity: 1.00,
    recommendedFlowRateLpm: [0, 100],
    recommendedSurfacePressureMPa: [0, 20],
    typicalBHA: ["Перфоратор", "CCL", "Разъединитель"],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: ["Зацеп ГНКТ за заусенцы перфорации", "Неуправляемый приток"],
  },
  {
    type: "gas_lift",
    nameRu: "Установка газлифтных клапанов",
    description:
      "Установка/замена газлифтных клапанов через ГНКТ при недоступности съёма канатным методом.",
    icon: "🔧",
    category: "Сервис",
    recommendedFluid: "Скваж. жидкость",
    recommendedFluidDensity: 1.05,
    recommendedFlowRateLpm: [0, 50],
    recommendedSurfacePressureMPa: [0, 15],
    typicalBHA: ["Установочный инструмент", "Якорь", "Разъединитель"],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: ["Неустановка клапана", "Падение клапана в скважину"],
  },
  {
    type: "scale_removal",
    nameRu: "Удаление солеотложений",
    description:
      "Закачка ингибиторов солеотложения / растворителей карбонатных, сульфатных и др. солей.",
    icon: "🧂",
    category: "Промывка/чистка",
    recommendedFluid: "HCl 10% / EDTA / DTPA",
    recommendedFluidDensity: 1.05,
    recommendedFlowRateLpm: [60, 250],
    recommendedSurfacePressureMPa: [5, 30],
    typicalBHA: ["Распыляющая насадка", "Обратный клапан"],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: ["Коррозия", "Совместимость с пластовой водой"],
  },
  {
    type: "paraffin_removal",
    nameRu: "Удаление парафина (АСПО)",
    description:
      "Растворение АСПО через ГНКТ горячей нефтью / растворителем / греющим инструментом.",
    icon: "🔥",
    category: "Промывка/чистка",
    recommendedFluid: "Бутилбензольная фракция / толуол",
    recommendedFluidDensity: 0.86,
    recommendedFlowRateLpm: [80, 250],
    recommendedSurfacePressureMPa: [5, 25],
    typicalBHA: ["Распыляющая насадка", "Греющий ВЗД (опц.)", "Обратный клапан"],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: ["Возгорание (горячая нефть)", "Повторное отложение при охлаждении"],
  },
  {
    type: "well_kill",
    nameRu: "Глушение скважины",
    description:
      "Закачка утяжелённого раствора через ГНКТ при ГНВП или перед КРС.",
    icon: "🛑",
    category: "Промывка/чистка",
    recommendedFluid: "CaCl₂ / NaBr / CaBr₂",
    recommendedFluidDensity: 1.30,
    recommendedFlowRateLpm: [50, 200],
    recommendedSurfacePressureMPa: [5, 40],
    typicalBHA: ["Обратный клапан"],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: ["Поглощение при высокой плотности", "Неполное глушение", "Дифф. прихват"],
  },
  {
    type: "custom",
    nameRu: "Пользовательская операция",
    description: "Свободный режим — все параметры задаются вручную.",
    icon: "✏️",
    category: "Сервис",
    recommendedFluid: "—",
    recommendedFluidDensity: 1.0,
    recommendedFlowRateLpm: [0, 0],
    recommendedSurfacePressureMPa: [0, 0],
    typicalBHA: [],
    requiresRotation: false,
    requiresNitrogen: false,
    risks: [],
  },
];

/** Конвертация л/мин → л/с (формат pump.flowRate в UI). */
export const lpmToLps = (lpm: number): number => lpm / 60;
