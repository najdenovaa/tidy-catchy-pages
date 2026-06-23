// ============================================================
// Coiled Tubing — Acid Stimulation (Кислотная обработка)
// ============================================================
// Matrix acidizing через ГНКТ. Два режима:
//   - Карбонат (CaCO₃): HCl 15% (стандарт), реакция: 2HCl+CaCO₃→CaCl₂+H₂O+CO₂
//   - Терригенник (песчаник): Mud Acid (12% HCl + 3% HF) с предпотоком HCl
//
// Расчёты:
//   - V кислоты на 1 м перфорации (по типу породы)
//   - Q макс. (Pзаб < Pгрп) — закон Дарси упрощённо + матричный коэф.
//   - BHTP = Pуст + ρ·g·TVD - ΔPтрения
//   - Растворяющая способность β (кг CaCO₃ / м³ HCl)
//   - Объём CO₂ выделившегося газа (нм³)
// ============================================================

import {
  AcidComposition, DEFAULT_ACID_COMPOSITION, calculateDissolvingPower,
} from "./acid-chemistry";

export type AcidSystem = "HCl-15" | "HCl-28" | "MudAcid-12-3" | "HCl-7.5";
export type FormationType = "carbonate" | "sandstone" | "dolomite";

const G = 9.81;

// Пресеты соответствуют выбору в Select (для обратной совместимости).
// Растворяющая способность ВСЕГДА вычисляется через acid-chemistry, а не из таблицы.
const SYSTEM_TO_COMP: Record<AcidSystem, AcidComposition> = {
  "HCl-7.5":      { ...DEFAULT_ACID_COMPOSITION, hclPct: 7.5, hfPct: 0 },
  "HCl-15":       { ...DEFAULT_ACID_COMPOSITION, hclPct: 15,  hfPct: 0 },
  "HCl-28":       { ...DEFAULT_ACID_COMPOSITION, hclPct: 28,  hfPct: 0 },
  "MudAcid-12-3": { ...DEFAULT_ACID_COMPOSITION, hclPct: 12,  hfPct: 3 },
};

// Рекомендуемый удельный объём кислоты, м³/м перфорации
const ACID_VOLUME_PER_M: Record<FormationType, { min: number; typical: number; max: number }> = {
  carbonate:  { min: 0.5,  typical: 1.0,  max: 2.0 },
  sandstone:  { min: 0.3,  typical: 0.75, max: 1.5 },
  dolomite:   { min: 0.7,  typical: 1.2,  max: 2.5 },
};


export interface AcidStimInputs {
  tvd: number;             // м
  md: number;              // м
  perforationLength: number; // м (толщина обрабатываемого пласта)
  formation: FormationType;
  reservoirPressure: number; // MPa
  fracGradient: number;    // MPa/м (≈0.017 типично)
  acidSystem: AcidSystem;
  volumePerMeter: number;  // м³/м (задаётся пользователем)
  pumpRate: number;        // л/мин (расход закачки)
  whTemp: number;          // °C
  bhct: number;            // °C
  ctID: number;            // мм
  pipeFrictionFactor: number; // безразмерный масштаб (0.5-2), для tuning
  preflushVolume: number;  // м³ HCl 7.5% предпоток (для песчаника)
  overflushVolume: number; // м³ продавки
  surfacePressure: number; // MPa — макс. рабочее давление насоса (для проверки)
  /** Опциональный пользовательский состав. Если не задан — берётся пресет по acidSystem. */
  composition?: AcidComposition;
}


export interface AcidStage {
  name: string;
  fluid: string;
  volume: number;       // м³
  rate: number;         // л/мин
  duration: number;     // мин
  cumVolume: number;    // м³
  cumTime: number;      // мин
}

export interface AcidStimResult {
  // Volumes
  acidVolumeRecommended: number;   // м³
  acidVolumeUsed: number;          // м³
  totalLiquidVolume: number;       // м³ (preflush + acid + overflush)
  // Pressures
  fracPressure: number;            // MPa (Pзаб макс)
  hydrostaticAtPerf: number;       // MPa
  frictionLoss: number;            // MPa
  bhpAtMaxRate: number;            // MPa
  maxAllowableRate: number;        // л/мин (чтобы Pзаб < Pгрп)
  surfacePressureNeeded: number;   // MPa
  // Chemistry
  dissolvedRock: number;           // кг
  co2Generated: number;            // нм³
  // Schedule
  totalPumpTime: number;           // мин
  stages: AcidStage[];
  // Status
  feasible: boolean;
  withinPressureLimit: boolean;
  recommendations: string[];
  // Sensitivity: rate vs BHP
  sensitivity: { rate: number; bhp: number; surfaceP: number; status: "ok" | "frac" | "pump" }[];
}

// Потери давления на трение по ГНКТ (упрощённо: Hazen-Williams-like для воды-кислоты)
function frictionLossMPa(qLpm: number, length_m: number, ctID_mm: number, density: number, scale: number): number {
  // V = Q / A, м/с
  const A = Math.PI * Math.pow(ctID_mm / 2000, 2);
  const Q_m3s = qLpm / 60000;
  const V = Q_m3s / Math.max(1e-6, A);
  // Упрощённый Fanning: f ≈ 0.046/Re^0.2 (турбулентный)
  // Re ≈ ρ·V·D/μ, μ ≈ 0.001 Па·с для кислотных растворов
  const mu = 0.0012;
  const D = ctID_mm / 1000;
  const Re = Math.max(2100, (density * 1000 * V * D) / mu);
  const f = 0.046 / Math.pow(Re, 0.2);
  // ΔP = 2·f·ρ·V²·L/D (Па)
  const dP_Pa = (2 * f * density * 1000 * V * V * length_m) / D;
  return (dP_Pa / 1e6) * scale;
}

function calcBHP(inp: AcidStimInputs, qLpm: number, density: number): {
  hydro: number; friction: number; bhp: number; surface: number;
} {
  const hydro = (density * 1000 * G * inp.tvd) / 1e6;          // MPa
  const fric = frictionLossMPa(qLpm, inp.md, inp.ctID, density, inp.pipeFrictionFactor);
  // BHP при закачке = Pуст + Hydro - Fric_по_ГНКТ (трение крадёт давление при подаче)
  // Нагнетание: Pуст = BHP - Hydro + Fric  →  BHP = Pуст + Hydro - Fric (для исходящего потока)
  // Для расчёта макс. Q: оцениваем Pуст по доступному запасу
  // Здесь возвращаем BHP при условии Pуст = inp.surfacePressure
  const bhp = inp.surfacePressure + hydro - fric;
  return { hydro, friction: fric, bhp, surface: inp.surfacePressure };
}

export function calculateAcidStim(inp: AcidStimInputs): AcidStimResult {
  const sys = DISSOLVING_POWER[inp.acidSystem];
  const fracPressure = inp.fracGradient * inp.tvd;
  const rec = ACID_VOLUME_PER_M[inp.formation];
  const acidVolumeRec = rec.typical * inp.perforationLength;
  const acidVolumeUsed = inp.volumePerMeter * inp.perforationLength;
  const totalVol = inp.preflushVolume + acidVolumeUsed + inp.overflushVolume;
  const density = sys.density;

  const main = calcBHP(inp, inp.pumpRate, density);
  // Макс. расход — итеративно: при каком Q BHP = fracPressure
  // BHP = Pуст + Hydro - Fric(Q).  Pуст_макс = inp.surfacePressure
  // Дано фикс Pуст, ищем Q при котором BHP ≤ fracPressure
  // Если main.bhp > frac → нужно снижать Q (увеличит fric? нет, fric растёт с Q)
  // Снижение Q уменьшит fric → BHP вырастет ещё.  Значит лимит — Pуст, не Q.
  // Поэтому maxRate ищем как Q, при котором Pуст = inp.surfacePressure даёт BHP = fracPressure
  // → fric(Q_max) = inp.surfacePressure + hydro - fracPressure
  const fricBudget = inp.surfacePressure + main.hydro - fracPressure;
  let maxRate = inp.pumpRate;
  if (fricBudget > 0) {
    // решаем fric(Q) = fricBudget итерациями
    let lo = 1, hi = 5000;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const f = frictionLossMPa(mid, inp.md, inp.ctID, density, inp.pipeFrictionFactor);
      if (f < fricBudget) lo = mid; else hi = mid;
    }
    maxRate = +lo.toFixed(0);
  } else {
    maxRate = 0; // даже при 0 расхода BHP > frac (хвостовое давление)
  }

  // Химия
  const beta = sys[inp.formation];
  const dissolved = beta * acidVolumeUsed;
  const co2 = sys.co2PerM3 * acidVolumeUsed * (inp.formation === "sandstone" ? 0.2 : 1);

  // Расписание
  const stages: AcidStage[] = [];
  let cumV = 0, cumT = 0;
  const pushStage = (name: string, fluid: string, vol: number, rate: number) => {
    if (vol <= 0) return;
    const dur = (vol * 1000) / rate;
    cumV += vol;
    cumT += dur;
    stages.push({
      name, fluid, volume: +vol.toFixed(2), rate, duration: +dur.toFixed(1),
      cumVolume: +cumV.toFixed(2), cumTime: +cumT.toFixed(1),
    });
  };
  if (inp.preflushVolume > 0) pushStage("Предпоток", "HCl 7.5%", inp.preflushVolume, inp.pumpRate);
  pushStage("Основная кислота", inp.acidSystem, acidVolumeUsed, inp.pumpRate);
  if (inp.overflushVolume > 0) pushStage("Продавка", "Вода/KCl", inp.overflushVolume, inp.pumpRate);

  // Чувствительность
  const sensitivity: AcidStimResult["sensitivity"] = [];
  for (let k = 0.25; k <= 2.5; k += 0.25) {
    const q = +(inp.pumpRate * k).toFixed(0);
    const c = calcBHP(inp, q, density);
    const status: "ok" | "frac" | "pump" =
      c.bhp > fracPressure ? "frac"
      : c.surface > inp.surfacePressure * 1.05 ? "pump"
      : "ok";
    sensitivity.push({ rate: q, bhp: +c.bhp.toFixed(2), surfaceP: +c.surface.toFixed(2), status });
  }

  const withinPressureLimit = main.bhp <= fracPressure && main.bhp > 0;
  const feasible = withinPressureLimit && acidVolumeUsed > 0 && maxRate > 0;

  const recs: string[] = [];
  if (!withinPressureLimit) recs.push(`⚠ Pзаб (${main.bhp.toFixed(1)} MPa) превышает Pгрп (${fracPressure.toFixed(1)} MPa) — снизьте расход до ≤ ${maxRate} л/мин`);
  else recs.push(`✅ Pзаб = ${main.bhp.toFixed(1)} MPa < Pгрп ${fracPressure.toFixed(1)} MPa (запас ${(fracPressure - main.bhp).toFixed(1)} MPa)`);
  if (acidVolumeUsed < rec.min * inp.perforationLength) recs.push(`ℹ Объём кислоты ниже минимального (${(rec.min * inp.perforationLength).toFixed(1)} м³) — возможна неполная обработка`);
  if (acidVolumeUsed > rec.max * inp.perforationLength) recs.push(`ℹ Объём кислоты выше типового макс. (${(rec.max * inp.perforationLength).toFixed(1)} м³) — оцените экономику`);
  if (inp.formation === "sandstone" && inp.preflushVolume < acidVolumeUsed * 0.5) {
    recs.push("⚠ Песчаник: предпоток HCl должен быть ≥ 50% объёма Mud Acid (для удаления Ca²⁺ и предотвращения CaF₂)");
  }
  if (inp.formation === "carbonate" && inp.acidSystem === "MudAcid-12-3") {
    recs.push("✖ Mud Acid НЕ применяется на карбонатах — образуется гипс CaSO₄. Используйте HCl 15-28%");
  }
  if (inp.overflushVolume < acidVolumeUsed * 0.3) recs.push("ℹ Продавка < 30% объёма кислоты — рекомендуется увеличить для выноса отработанной кислоты");
  if (co2 > 100) recs.push(`ℹ Выделится ~${co2.toFixed(0)} нм³ CO₂ — предусмотрите дегазацию устья`);

  return {
    acidVolumeRecommended: +acidVolumeRec.toFixed(2),
    acidVolumeUsed: +acidVolumeUsed.toFixed(2),
    totalLiquidVolume: +totalVol.toFixed(2),
    fracPressure: +fracPressure.toFixed(2),
    hydrostaticAtPerf: +main.hydro.toFixed(2),
    frictionLoss: +main.friction.toFixed(2),
    bhpAtMaxRate: +main.bhp.toFixed(2),
    maxAllowableRate: maxRate,
    surfacePressureNeeded: +main.surface.toFixed(2),
    dissolvedRock: +dissolved.toFixed(0),
    co2Generated: +co2.toFixed(0),
    totalPumpTime: +cumT.toFixed(1),
    stages,
    feasible,
    withinPressureLimit,
    recommendations: recs,
    sensitivity,
  };
}

export const ACID_SYSTEMS: { id: AcidSystem; label: string; desc: string }[] = [
  { id: "HCl-7.5",      label: "HCl 7.5%",       desc: "Предпоток, слабая обработка" },
  { id: "HCl-15",       label: "HCl 15%",        desc: "Стандарт для карбонатов" },
  { id: "HCl-28",       label: "HCl 28%",        desc: "Усиленная обработка, глубокая" },
  { id: "MudAcid-12-3", label: "Mud Acid 12/3",  desc: "12% HCl + 3% HF — песчаники" },
];

export const FORMATION_TYPES: { id: FormationType; label: string }[] = [
  { id: "carbonate", label: "Карбонат (известняк)" },
  { id: "dolomite",  label: "Доломит" },
  { id: "sandstone", label: "Песчаник (терригенник)" },
];
