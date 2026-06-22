// Специализированные инженерные расчёты для растворителей и азота
// (Audit v25 — Часть 2.3, 2.4)

// ────────────────────────────────────────────────────────────
// РАСТВОРИТЕЛИ (АСПО / парафин)
// ────────────────────────────────────────────────────────────

export type SolventType = "neftras" | "toluene" | "xylene" | "diesel" | "hot_oil" | "condensate";

export const SOLVENT_LABEL: Record<SolventType, string> = {
  neftras: "Нефрас С2-80/120",
  toluene: "Толуол",
  xylene: "Ксилол",
  diesel: "Дизтопливо",
  hot_oil: "Горячая нефть",
  condensate: "Конденсат",
};

// Растворяющая способность по АСПО, кг/м³ растворителя (типичные значения)
const SOLVENT_DISSOLUTION_CAPACITY: Record<SolventType, { asphaltene: number; paraffin: number }> = {
  neftras:    { asphaltene: 180, paraffin: 220 },
  toluene:    { asphaltene: 350, paraffin: 180 },
  xylene:     { asphaltene: 320, paraffin: 200 },
  diesel:     { asphaltene:  60, paraffin: 240 },
  hot_oil:    { asphaltene:  40, paraffin: 280 },
  condensate: { asphaltene:  20, paraffin: 320 },
};

export interface SolventInput {
  solvent: SolventType;
  damageType: "asphaltene" | "paraffin";
  payZoneM: number;
  porosity: number;          // д.ед.
  wellboreRadiusM: number;   // м
  penetrationRadiusM: number;// желаемый радиус обработки, м
  depositSaturation: number; // насыщение АСПО в ПЗП, д.ед. от пор. объёма (0.05..0.4)
  reservoirTempC: number;
  surfaceTempC: number;      // температура нагрева растворителя на устье, °C
  tubingDepthM: number;
  rateM3PerMin: number;      // расход закачки
  tubingOD_mm: number;       // НКТ нар. диам.
}

export interface SolventResult {
  treatedPoreVolumeM3: number;     // поровый объём кольца обработки
  depositMassKg: number;           // масса АСПО в кольце
  dissolutionCapacityKgPerM3: number;
  requiredSolventM3: number;       // объём растворителя по растворяющей способности (с запасом 30%)
  bottomholeTempC: number;         // оценка Tзаб после прокачки
  meetsTempCriterion: boolean;     // Tзаб ≥ Tкрист.+10°C? (для парафина)
  diffusionTimeMin: number;        // t = r²/(4D), мин — рекомендация по выдержке
  recommendedSoakMin: number;      // округлённое значение для плана
  warnings: string[];
}

export function calculateSolventTreatment(p: SolventInput): SolventResult {
  // Поровый объём кольца обработки: V = π(r²-rw²)·h·φ
  const treatedPV = Math.PI *
    (p.penetrationRadiusM * p.penetrationRadiusM - p.wellboreRadiusM * p.wellboreRadiusM) *
    p.payZoneM * p.porosity;

  // Масса отложений в кольце: m = V_pore · sat · ρ_depo (для АСПО ρ ≈ 900 кг/м³)
  const rhoDeposit = p.damageType === "asphaltene" ? 1050 : 900;
  const depositMass = treatedPV * p.depositSaturation * rhoDeposit;

  // Растворяющая способность
  const cap = SOLVENT_DISSOLUTION_CAPACITY[p.solvent][p.damageType];

  // Объём растворителя с запасом 30%
  const requiredSolvent = (depositMass / cap) * 1.3;

  // Тепловой баланс — упрощённая модель потерь в НКТ:
  // ΔT_loss ≈ k_loss · (L/100), где k_loss зависит от расхода
  // При q = 1 м³/мин потеря ≈ 1.5 °C / 100 м, при q = 0.05 — до 5 °C / 100 м
  const k_loss = Math.max(0.8, 5 / Math.max(0.05, p.rateM3PerMin));
  const dT_loss = (k_loss * p.tubingDepthM) / 100;
  const Tbh = Math.max(p.reservoirTempC, p.surfaceTempC - dT_loss);

  // Критерий по температуре — для парафина важно T > Tкрист.+10°C
  // Tкрист парафина обычно 30-50°C, берём 45°C по умолчанию
  const Tcrit = p.damageType === "paraffin" ? 45 : 30;
  const meetsTemp = Tbh >= Tcrit + 10;

  // Диффузионное время растворения: t = r²/(4D), D ≈ 1e-9 м²/с
  // Для практики берём масштаб пор r ≈ √(k/φ) ≈ 1e-5 м для k=15 мД
  // Принимаем r = 0.01 м (1 см масштаб неоднородности АСПО)
  const D = p.damageType === "asphaltene" ? 5e-10 : 1.5e-9;
  const rChar = 0.01;
  const tSec = (rChar * rChar) / (4 * D);
  const tMin = tSec / 60;
  const recommendedSoak = Math.min(480, Math.max(60, Math.round(tMin / 30) * 30));

  const warnings: string[] = [];
  if (!meetsTemp && p.damageType === "paraffin")
    warnings.push(`Tзаб ≈ ${Tbh.toFixed(0)}°C ниже Tкрист.+10 (${Tcrit + 10}°C). Повысьте Tнагрева или снизьте темп закачки.`);
  if (p.rateM3PerMin < 0.05)
    warnings.push("Слишком низкий темп закачки — большие тепловые потери.");
  if (p.solvent === "condensate" && p.damageType === "asphaltene")
    warnings.push("Конденсат малоэффективен по асфальтенам — рассмотрите толуол/ксилол.");
  if (requiredSolvent > 50)
    warnings.push(`Большой объём (${requiredSolvent.toFixed(0)} м³) — рассмотрите многоциклическую обработку.`);

  return {
    treatedPoreVolumeM3: treatedPV,
    depositMassKg: depositMass,
    dissolutionCapacityKgPerM3: cap,
    requiredSolventM3: requiredSolvent,
    bottomholeTempC: Tbh,
    meetsTempCriterion: meetsTemp,
    diffusionTimeMin: tMin,
    recommendedSoakMin: recommendedSoak,
    warnings,
  };
}

// ────────────────────────────────────────────────────────────
// АЗОТНЫЕ ОПЕРАЦИИ (лифт / пенный лифт / освоение)
// ────────────────────────────────────────────────────────────

export interface NitrogenInput {
  operationType: "n2_lift" | "n2_foam_lift" | "n2_cleanup";
  wellDepthM: number;
  tubingID_mm: number;        // внутр. диам НКТ
  fluidDensityKgM3: number;   // плотность скважинной жидкости
  reservoirPressureMPa: number;
  reservoirTempC: number;
  surfaceTempC: number;
  targetBhpMPa: number;       // желаемое забойное давление после лифта (для срабатывания пласта)
  foamQualityPct?: number;    // для пенного лифта, %
  pumpRateM3PerMin: number;   // темп закачки N2 (приведённый к н.у.)
}

export interface NitrogenResult {
  tubingVolumeM3: number;
  bhpHydrostaticMPa: number;        // текущее гидростат. давл. столба жидкости
  drawdownMPa: number;              // ΔP = Pпл - Pзаб целевое
  // Замещение столба:
  liftHeightM: number;              // высота замещения столба N2
  // Параметры N2 в забойных условиях:
  zFactorBh: number;                // Z в забое (Papay)
  n2DensityBh: number;              // плотность N2 в забое, кг/м³
  n2GradientBhMPaPer100m: number;   // градиент N2 в забое, МПа/100м
  // Объёмы:
  n2VolumeDownholeM3: number;       // объём N2 в забое
  n2VolumeSurfaceStandardM3: number;// объём N2 на поверхности при ст. условиях
  n2MassKg: number;
  // Время операции:
  pumpTimeMin: number;
  // Пенный лифт:
  foamLiquidVolumeM3?: number;      // объём ПАВ-раствора для пены
  // Безопасность:
  warnings: string[];
}

// Papay correlation для Z (для N2 приведём через критич. параметры азота)
// Tc(N2) = 126.2 K, Pc(N2) = 3.39 МПа
function papayZN2(P_MPa: number, T_K: number): number {
  const Ppr = P_MPa / 3.39;
  const Tpr = T_K / 126.2;
  if (Tpr < 1.05) return 1.0;
  const z = 1 - (3.52 * Ppr) / Math.pow(10, 0.9813 * Tpr)
              + (0.274 * Ppr * Ppr) / Math.pow(10, 0.8157 * Tpr);
  return Math.max(0.5, Math.min(1.2, z));
}

export function calculateNitrogenOperation(p: NitrogenInput): NitrogenResult {
  const warnings: string[] = [];

  // Объём НКТ
  const A = Math.PI * Math.pow(p.tubingID_mm / 2000, 2); // м²
  const tubingVol = A * p.wellDepthM;

  // Гидростатика жидкости
  const bhpHydro = (p.fluidDensityKgM3 * 9.81 * p.wellDepthM) / 1e6;
  const drawdown = Math.max(0, p.reservoirPressureMPa - p.targetBhpMPa);

  // Высота замещения столба жидкости газом N2
  // Pзаб = ρ_N2·g·h_N2 + ρ_ж·g·(L-h_N2) (без учёта потерь)
  // Сначала оценим без поправки на N2 column (light gas)
  const targetBhpPa = p.targetBhpMPa * 1e6;
  // приближение: считаем что N2 даёт ~5-15% от веса жидкости
  // h_N2 ≈ (ρ_ж·g·L - Pзаб·1e6) / (ρ_ж·g - ρ_N2·g)
  // итеративно:
  let liftHeight = 0;
  let zBh = 1.0;
  let rhoBh = 0;
  for (let i = 0; i < 5; i++) {
    const Tbh_K = p.reservoirTempC + 273.15;
    zBh = papayZN2(p.targetBhpMPa, Tbh_K);
    // ρ_N2 = P·M/(Z·R·T), M(N2)=0.028 кг/моль, R=8.314
    rhoBh = (targetBhpPa * 0.028) / (zBh * 8.314 * Tbh_K);
    const denom = (p.fluidDensityKgM3 - rhoBh) * 9.81;
    if (denom <= 0) { liftHeight = p.wellDepthM; break; }
    liftHeight = Math.min(
      p.wellDepthM,
      Math.max(0, (p.fluidDensityKgM3 * 9.81 * p.wellDepthM - targetBhpPa) / denom)
    );
  }

  const n2GradBh = (rhoBh * 9.81) / 1e4; // МПа/100м

  // Объём N2 в забойных условиях
  const n2VolDownhole = A * liftHeight;
  // Масса N2: m = ρ·V
  const n2Mass = rhoBh * n2VolDownhole;
  // Приведение к стандартным условиям (P=0.101325 МПа, T=288.15K, Z≈1)
  const n2VolStd = (n2Mass * 8.314 * 288.15) / (0.028 * 101325);

  // Время закачки
  const pumpTime = p.pumpRateM3PerMin > 0 ? n2VolStd / p.pumpRateM3PerMin : 0;

  // Пенный лифт — объём жидкости-носителя
  let foamLiq: number | undefined;
  if (p.operationType === "n2_foam_lift" && p.foamQualityPct) {
    const fq = p.foamQualityPct / 100;
    foamLiq = n2VolDownhole * (1 - fq) / fq;
  }

  // Предупреждения
  if (p.targetBhpMPa >= p.reservoirPressureMPa)
    warnings.push("Целевое Pзаб ≥ Pпл — приток невозможен. Снизьте целевое давление.");
  if (liftHeight >= p.wellDepthM * 0.99)
    warnings.push("Требуется замещение всего столба — рассмотрите пенный лифт.");
  if (drawdown > 0.5 * p.reservoirPressureMPa)
    warnings.push(`Большая депрессия (${drawdown.toFixed(1)} МПа) — риск выноса проппанта/мехпримесей.`);
  if (n2VolStd > 50000)
    warnings.push(`Большой объём N2 (${(n2VolStd / 1000).toFixed(0)} тыс.м³ н.у.) — проверьте логистику.`);
  if (p.operationType === "n2_lift" && bhpHydro < p.reservoirPressureMPa)
    warnings.push("Скважина уже фонтанирует — азотный лифт избыточен.");

  return {
    tubingVolumeM3: tubingVol,
    bhpHydrostaticMPa: bhpHydro,
    drawdownMPa: drawdown,
    liftHeightM: liftHeight,
    zFactorBh: zBh,
    n2DensityBh: rhoBh,
    n2GradientBhMPaPer100m: n2GradBh,
    n2VolumeDownholeM3: n2VolDownhole,
    n2VolumeSurfaceStandardM3: n2VolStd,
    n2MassKg: n2Mass,
    pumpTimeMin: pumpTime,
    foamLiquidVolumeM3: foamLiq,
    warnings,
  };
}
