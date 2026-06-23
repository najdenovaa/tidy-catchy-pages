// ════════════════════════════════════════════════════════════════════
// Единая геологическая модель: реальный минеральный состав,
// глины по типам, флюид, глубина с градиентами, упрощённая геомеханика.
// Используется в модуле Интенсификации (и в будущем — в ГНКТ).
// ════════════════════════════════════════════════════════════════════

export type CarbonateSubtype = "limestone" | "dolomite" | "chalk" | "mixed";

/** Полный минеральный состав (% по массе/объёму). Сумма должна быть ≈ 100. */
export interface DetailedMineralogy {
  // ── Силикаты ──
  quartz: number;
  feldspar: number;
  // ── Карбонаты ──
  calcite: number;     // CaCO₃ — известняк
  dolomite: number;    // CaMg(CO₃)₂
  chalk: number;       // мел (мягкий CaCO₃, высокопористый)
  // ── Прочие реактивные ──
  siderite: number;    // FeCO₃ — даёт Fe³⁺ в HCl
  anhydrite: number;   // CaSO₄ — риск вторичного гипса
  pyrite: number;      // FeS₂ — даёт H₂S
  // ── Глины (по типам) ──
  kaolinite: number;
  illite: number;
  chlorite: number;    // содержит Fe²⁺ — риск Fe(OH)₃
  smectite: number;    // монтмориллонит — основной набухающий
}

export const DEFAULT_MINERALOGY_SANDSTONE: DetailedMineralogy = {
  quartz: 65, feldspar: 8,
  calcite: 3, dolomite: 0, chalk: 0,
  siderite: 0, anhydrite: 0, pyrite: 0,
  kaolinite: 6, illite: 8, chlorite: 4, smectite: 6,
};

export const DEFAULT_MINERALOGY_CARBONATE: DetailedMineralogy = {
  quartz: 3, feldspar: 0,
  calcite: 75, dolomite: 15, chalk: 0,
  siderite: 1, anhydrite: 2, pyrite: 0,
  kaolinite: 1, illite: 2, chlorite: 0, smectite: 1,
};

export const DEFAULT_MINERALOGY_DOLOMITE: DetailedMineralogy = {
  quartz: 2, feldspar: 0,
  calcite: 10, dolomite: 80, chalk: 0,
  siderite: 1, anhydrite: 3, pyrite: 0,
  kaolinite: 1, illite: 2, chlorite: 0, smectite: 1,
};

export function totalCarbonate(m: DetailedMineralogy): number {
  return m.calcite + m.dolomite + m.chalk;
}
export function totalClay(m: DetailedMineralogy): number {
  return m.kaolinite + m.illite + m.chlorite + m.smectite;
}
export function totalMineralPct(m: DetailedMineralogy): number {
  return m.quartz + m.feldspar + totalCarbonate(m) +
    m.siderite + m.anhydrite + m.pyrite + totalClay(m);
}

/** Нормализовать состав к 100% (пропорционально). */
export function normalizeMineralogy(m: DetailedMineralogy): DetailedMineralogy {
  const t = totalMineralPct(m);
  if (t <= 0) return m;
  const k = 100 / t;
  const out: any = {};
  (Object.keys(m) as (keyof DetailedMineralogy)[]).forEach((key) => {
    out[key] = +(m[key] * k).toFixed(2);
  });
  return out as DetailedMineralogy;
}

/** Определить подтип карбоната по составу. */
export function detectCarbonateSubtype(m: DetailedMineralogy): CarbonateSubtype {
  const c = totalCarbonate(m);
  if (c < 30) return "limestone"; // не карбонатная порода — формальный fallback
  const fDolo = m.dolomite / Math.max(1, c);
  const fChalk = m.chalk / Math.max(1, c);
  if (fDolo > 0.6) return "dolomite";
  if (fChalk > 0.5) return "chalk";
  if (fDolo > 0.2) return "mixed";
  return "limestone";
}

// ════════════════════════════════════════════════════════════════════
// Реактивность к кислотам
// ════════════════════════════════════════════════════════════════════

/** Относительная реактивность карбонатов к HCl (calcite = 1). */
export const CARBONATE_HCL_REACTIVITY = {
  calcite: 1.0,
  chalk: 1.15,    // более пористый → больше доступной поверхности
  dolomite: 0.55, // 4 HCl на моль, медленнее
};

/** Относительная реактивность глин к HF (kaolinite = 1). */
export const CLAY_HF_REACTIVITY = {
  kaolinite: 1.0,
  smectite: 0.85,
  illite: 0.45,
  chlorite: 0.30, // медленно + риск Fe(OH)₃
};

// ════════════════════════════════════════════════════════════════════
// Пластовый флюид
// ════════════════════════════════════════════════════════════════════

export interface FluidProperties {
  oilViscosity_cP: number;
  Bo: number;                    // объёмный коэффициент нефти
  GOR_m3m3: number;              // газовый фактор
  waterCutPct: number;
  oilDensity_kgm3: number;
}

export const DEFAULT_FLUID: FluidProperties = {
  oilViscosity_cP: 1.2, Bo: 1.15, GOR_m3m3: 80,
  waterCutPct: 20, oilDensity_kgm3: 850,
};

// ════════════════════════════════════════════════════════════════════
// Глубина и градиенты (подсказки для Pr/T)
// ════════════════════════════════════════════════════════════════════

export interface DepthProfile {
  depthMD_m: number;
  pressureGradient_MPa_per_100m: number; // 1.05 = нормальное гидростатическое
  tempGradient_C_per_100m: number;        // 2.5..3.5 типично
  surfaceTempC: number;                   // 10°C типично
}

export const DEFAULT_DEPTH: DepthProfile = {
  depthMD_m: 2200,
  pressureGradient_MPa_per_100m: 1.05,
  tempGradient_C_per_100m: 3.0,
  surfaceTempC: 10,
};

export function suggestedReservoirPressureMPa(d: DepthProfile): number {
  return +(d.depthMD_m * d.pressureGradient_MPa_per_100m / 100).toFixed(2);
}
export function suggestedReservoirTempC(d: DepthProfile): number {
  return +(d.surfaceTempC + d.depthMD_m * d.tempGradient_C_per_100m / 100).toFixed(1);
}

// ════════════════════════════════════════════════════════════════════
// Упрощённая геомеханика (Eaton)
// Pfrac ≈ 0.7·σv + 0.3·Pp
// σv = D · 0.0226 МПа/м (средняя горная порода ≈ 2300 кг/м³)
// ════════════════════════════════════════════════════════════════════

export interface StressState {
  overburdenGradient_MPa_per_100m: number; // 2.26 = горная порода ≈ 2300 кг/м³
  eatonRatio: number;                       // 0.7 типично
}

export const DEFAULT_STRESS: StressState = {
  overburdenGradient_MPa_per_100m: 2.26,
  eatonRatio: 0.7,
};

export function overburdenPressureMPa(d: DepthProfile, s: StressState): number {
  return +(d.depthMD_m * s.overburdenGradient_MPa_per_100m / 100).toFixed(2);
}

export function fracturePressureMPa(
  d: DepthProfile, Pp_MPa: number, s: StressState
): number {
  const sigmaV = d.depthMD_m * s.overburdenGradient_MPa_per_100m / 100;
  return +(s.eatonRatio * sigmaV + (1 - s.eatonRatio) * Pp_MPa).toFixed(2);
}

// ════════════════════════════════════════════════════════════════════
// Растворение породы по реальному минеральному составу
// ════════════════════════════════════════════════════════════════════

export interface MineralogyDissolution {
  carbonateKgPerM3: number;       // растворяется HCl
  silicateKgPerM3: number;         // растворяется HF
  totalKgPerM3: number;
  effectiveRockDensity_kgm3: number;
  warnings: string[];
}

const ROCK_DENSITY: Record<keyof DetailedMineralogy, number> = {
  quartz: 2650, feldspar: 2620,
  calcite: 2710, dolomite: 2870, chalk: 2400,
  siderite: 3960, anhydrite: 2980, pyrite: 5000,
  kaolinite: 2600, illite: 2700, chlorite: 2900, smectite: 2350,
};

export function stoichiometricDemandByMineralogy(
  m: DetailedMineralogy,
  betaCalcite_kg_per_m3: number, // β HCl для чистого calcite (из acid-chemistry)
  betaQuartz_kg_per_m3: number,   // β HF для чистого SiO₂
): MineralogyDissolution {
  const f = (k: keyof DetailedMineralogy) => m[k] / 100;

  const carbonateKg =
    f("calcite") * betaCalcite_kg_per_m3 * CARBONATE_HCL_REACTIVITY.calcite +
    f("chalk")   * betaCalcite_kg_per_m3 * CARBONATE_HCL_REACTIVITY.chalk +
    f("dolomite")* betaCalcite_kg_per_m3 * CARBONATE_HCL_REACTIVITY.dolomite;

  // HF реагирует с кварцем, полевыми шпатами (≈1.5×) и глинами
  const silicateKg =
    f("quartz")   * betaQuartz_kg_per_m3 * 1.0 +
    f("feldspar") * betaQuartz_kg_per_m3 * 1.5 +
    f("kaolinite")* betaQuartz_kg_per_m3 * CLAY_HF_REACTIVITY.kaolinite * 1.4 +
    f("smectite") * betaQuartz_kg_per_m3 * CLAY_HF_REACTIVITY.smectite  * 1.4 +
    f("illite")   * betaQuartz_kg_per_m3 * CLAY_HF_REACTIVITY.illite    * 1.4 +
    f("chlorite") * betaQuartz_kg_per_m3 * CLAY_HF_REACTIVITY.chlorite  * 1.4;

  // Эффективная плотность породы (взвешенная)
  let rhoSum = 0;
  (Object.keys(m) as (keyof DetailedMineralogy)[]).forEach((k) => {
    rhoSum += (m[k] / 100) * ROCK_DENSITY[k];
  });
  const tot = totalMineralPct(m);
  const rhoEff = tot > 0 ? rhoSum * (100 / tot) : 2650;

  const warnings: string[] = [];
  if (m.chlorite >= 3)
    warnings.push(`⚠ Хлорит ${m.chlorite.toFixed(1)}% + HF → риск осадка Fe(OH)₃. Добавить Fe-control (EDTA / лимонная кислота 1-2%).`);
  if (m.smectite >= 5)
    warnings.push(`⚠ Смектит ${m.smectite.toFixed(1)}% → высокий риск набухания. Preflush KCl 2-3% или NH₄Cl обязателен.`);
  if (m.siderite >= 2)
    warnings.push(`⚠ Сидерит ${m.siderite.toFixed(1)}% + HCl → Fe³⁺ в растворе → Fe(OH)₃. Включить Fe-стабилизатор.`);
  if (m.pyrite >= 1)
    warnings.push(`⚠ Пирит ${m.pyrite.toFixed(1)}% + HCl → выделение H₂S. Обязателен H₂S-скавенджер.`);
  if (m.anhydrite >= 3)
    warnings.push(`⚠ Ангидрит ${m.anhydrite.toFixed(1)}% — растворяется HCl, риск вторичного гипса. Рассмотреть chelant (HEDTA) вместо HCl.`);
  if (m.illite >= 8)
    warnings.push(`⚠ Иллит ${m.illite.toFixed(1)}% — миграция фибрилл при HF. Снизить расход или применить замедлитель.`);

  return {
    carbonateKgPerM3: carbonateKg,
    silicateKgPerM3: silicateKg,
    totalKgPerM3: carbonateKg + silicateKg,
    effectiveRockDensity_kgm3: Math.max(2300, rhoEff),
    warnings,
  };
}

// ────────────────────────────────────────────────────────────────────
// Обратная совместимость: усреднённая (упрощённая) минералогия
// ────────────────────────────────────────────────────────────────────

/** Упрощённая минералогия: 6 полей вместо 12. */
export interface AveragedMineralogy {
  quartz: number;
  feldspar: number;
  calcite: number;       // включает мел
  dolomite: number;
  clay: number;          // сумма всех глин
  montmorillonite: number; // = смектит, абсолютные %
}

export function toAveragedMineralogy(m: DetailedMineralogy): AveragedMineralogy {
  return {
    quartz: m.quartz,
    feldspar: m.feldspar,
    calcite: +(m.calcite + m.chalk).toFixed(2),
    dolomite: m.dolomite,
    clay: +totalClay(m).toFixed(2),
    montmorillonite: m.smectite,
  };
}

/** Распределяем несмектитовые глины типично: каолинит/иллит/хлорит = 0.4/0.4/0.2. */
export function fromAveragedMineralogy(a: AveragedMineralogy): DetailedMineralogy {
  const nonSmectiteClay = Math.max(0, a.clay - a.montmorillonite);
  return {
    quartz: a.quartz,
    feldspar: a.feldspar,
    calcite: a.calcite,
    dolomite: a.dolomite,
    chalk: 0,
    siderite: 0,
    anhydrite: 0,
    pyrite: 0,
    smectite: a.montmorillonite,
    kaolinite: +(nonSmectiteClay * 0.4).toFixed(2),
    illite: +(nonSmectiteClay * 0.4).toFixed(2),
    chlorite: +(nonSmectiteClay * 0.2).toFixed(2),
  };
}

export function totalAveragedPct(a: AveragedMineralogy): number {
  return a.quartz + a.feldspar + a.calcite + a.dolomite + a.clay;
}

export function toLegacyMineralogy(m: DetailedMineralogy) {
  return {
    quartz: m.quartz,
    feldspar: m.feldspar,
    calcite: m.calcite + m.chalk,
    dolomite: m.dolomite,
    clay: totalClay(m),
    montmorillonite: m.smectite,
    kaolinite: m.kaolinite,
    illite: m.illite,
    chlorite: m.chlorite,
    smectite: m.smectite,
    chalk: m.chalk,
    siderite: m.siderite,
    anhydrite: m.anhydrite,
    pyrite: m.pyrite,
  };
}
