/** Demonstration recipes. Properties require a laboratory protocol for the actual material batch. */
export interface FoamCementRecipe {
  id: string;
  name: string;
  nameRu: string;
  baseDensity: number; // г/см³
  waterCementRatio: number;
  yieldM3PerTon: number;
  pvCp: number;
  ypPa: number;
  thickeningTime30Bc: number; // мин
  maxTemp: number; // °C
  foamStabilizerType: string;
  foamStabilizerConc: number; // % к массе цемента
  recommendedFQ: [number, number];
  description: string;
}

export const FOAM_CEMENT_RECIPES: FoamCementRecipe[] = [
  {
    id: "class-g-standard",
    name: "Class G + Standard Foamer",
    nameRu: "API Class G + Стандартный ПАВ",
    baseDensity: 1.9,
    waterCementRatio: 0.44,
    yieldM3PerTon: 0.76,
    pvCp: 45,
    ypPa: 8,
    thickeningTime30Bc: 240,
    maxTemp: 120,
    foamStabilizerType: "АОС",
    foamStabilizerConc: 0.5,
    recommendedFQ: [20, 75],
    description: "Стандартный пеноцемент для скважин до 3000 м",
  },
  {
    id: "lightweight-micro",
    name: "Lightweight Microsphere Blend",
    nameRu: "Облегчённый на микросферах + N₂",
    baseDensity: 1.5,
    waterCementRatio: 0.65,
    yieldM3PerTon: 1.1,
    pvCp: 30,
    ypPa: 5,
    thickeningTime30Bc: 300,
    maxTemp: 150,
    foamStabilizerType: "КПАВ",
    foamStabilizerConc: 0.3,
    recommendedFQ: [15, 50],
    description: "Для зон с низким градиентом ГРП",
  },
  {
    id: "heavy-foam",
    name: "Heavy Base + Foam",
    nameRu: "Утяжелённый базовый + N₂",
    baseDensity: 2.1,
    waterCementRatio: 0.38,
    yieldM3PerTon: 0.65,
    pvCp: 60,
    ypPa: 12,
    thickeningTime30Bc: 200,
    maxTemp: 100,
    foamStabilizerType: "АОС-М",
    foamStabilizerConc: 0.7,
    recommendedFQ: [25, 60],
    description: "Получение ρ 1.40–1.80 г/см³ из тяжёлого базового",
  },
  {
    id: "pct-i-g-cc-1",
    name: "PCT-I-G-CC-1",
    nameRu: "ПЦТ-I-G-CC-1 (ГОСТ 1581-2019)",
    baseDensity: 1.88,
    waterCementRatio: 0.44,
    yieldM3PerTon: 0.78,
    pvCp: 42,
    ypPa: 7,
    thickeningTime30Bc: 220,
    maxTemp: 110,
    foamStabilizerType: "АОС (сульфонол)",
    foamStabilizerConc: 0.5,
    recommendedFQ: [20, 70],
    description: "Российский тампонажный для умеренных температур",
  },
  {
    id: "pct-iii-ob-4",
    name: "PCT-III-Ob-4-50",
    nameRu: "ПЦТ-III-Об-4-50 (облегчённый)",
    baseDensity: 1.45,
    waterCementRatio: 0.7,
    yieldM3PerTon: 1.15,
    pvCp: 28,
    ypPa: 4,
    thickeningTime30Bc: 280,
    maxTemp: 50,
    foamStabilizerType: "Неонол АФ 9-12",
    foamStabilizerConc: 0.4,
    recommendedFQ: [15, 45],
    description: "Облегчённый ПЦТ для верхних интервалов до 50 °C",
  },
  {
    id: "pct-ii-50",
    name: "PCT-II-50",
    nameRu: "ПЦТ-II-50 (утяжелённый сульфатостойкий)",
    baseDensity: 2.05,
    waterCementRatio: 0.4,
    yieldM3PerTon: 0.68,
    pvCp: 55,
    ypPa: 11,
    thickeningTime30Bc: 210,
    maxTemp: 100,
    foamStabilizerType: "АОС-М",
    foamStabilizerConc: 0.6,
    recommendedFQ: [25, 55],
    description: "Сульфатостойкий утяжелённый для агрессивных сред",
  },
];
