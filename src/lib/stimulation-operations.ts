/**
 * ОПЗ — график закачки по стадиям, экономика, распределение по пропласткам.
 */
import { injectivity } from "./stimulation-injection";
import { tubingFrictionMPa } from "./workover-calculations";
import type { ForecastPoint } from "./foam-treatment-diagnostics";

const G = 9.81;

// ═══════════════════════════════════════════════════════════════════
// 1. График закачки (плоское вытеснение в стволе)
// ═══════════════════════════════════════════════════════════════════

export interface ScheduleStage {
  name: string;
  volumeM3: number;
  density_gcm3: number;
  /** Стадия основной кислоты: по мере её входа в пласт скин снижается */
  isMainAcid?: boolean;
}

export interface ScheduleInput {
  stages: ScheduleStage[];
  /** Объём ствола от устья до кровли перфорации (НКТ + колонна), м³ */
  wellboreVolumeM3: number;
  /** Длина пути MD и вертикальная глубина кровли перфорации */
  pathMD: number;
  perfTVD: number;
  tubingID_mm: number;
  /** Длина НКТ (для трения), м */
  tubingLengthM: number;
  initialWellboreDensity_gcm3: number;
  reservoirPressureMPa: number;
  fracturePressureMPa: number;
  safetyMarginMPa: number;
  k_mD: number;
  h_m: number;
  fluidViscosity_cP: number;
  skinStart: number;
  skinEnd: number;
  /** Максимальная подача насоса, л/мин */
  pumpMaxLpm: number;
  /** Минимальный расход, л/мин */
  minRateLpm: number;
  drainageRadiusM: number;
  wellboreRadiusM: number;
}

export interface SchedulePoint {
  volumeM3: number;
  timeMin: number;
  rateLpm: number;
  surfacePressureMPa: number;
  bhpMPa: number;
  skin: number;
  stage: string;
  /** Жидкость, входящая в пласт */
  entering: string;
}

export interface ScheduleStageSummary {
  name: string;
  volumeM3: number;
  startMin: number;
  endMin: number;
  avgRateLpm: number;
  maxSurfaceMPa: number;
}

export interface ScheduleResult {
  points: SchedulePoint[];
  stages: ScheduleStageSummary[];
  totalTimeMin: number;
  maxSurfaceMPa: number;
  maxBhpMPa: number;
  warnings: string[];
}

interface Parcel { stage: string; volume: number; density: number; isMain: boolean }

/**
 * Пошаговая закачка: в каждый момент расход = min(подача насоса, 90% допустимого по ГРП
 * при текущем скине). В пласт входит жидкость, находящаяся у забоя (плоское вытеснение).
 * Скин снижается линейно по мере входа основной кислоты в пласт.
 */
export function buildInjectionSchedule(input: ScheduleInput): ScheduleResult {
  const total = input.stages.reduce((s, x) => s + x.volumeM3, 0);
  const Vw = Math.max(0.1, input.wellboreVolumeM3);
  const mainTotal = input.stages.filter((s) => s.isMainAcid).reduce((s, x) => s + x.volumeM3, 0);
  const tvdPerMD = input.perfTVD / Math.max(1, input.pathMD);

  // Ствол: очередь порций, сверху — устье (конец массива), снизу — забой (начало массива)
  let wellbore: Parcel[] = [{ stage: "Скважинная жидкость", volume: Vw, density: input.initialWellboreDensity_gcm3, isMain: false }];
  let mainEntered = 0;
  let t = 0;
  const points: SchedulePoint[] = [];
  const summaries: ScheduleStageSummary[] = [];
  const N = 300;
  const dV = Math.max(1e-3, total / N);
  const warnings: string[] = [];
  let maxSurf = 0, maxBhp = 0;

  const hydrostatic = () => {
    // Порции в стволе по длине (объём ∝ длине на однородном участке — допущение)
    let p = 0;
    for (const parcel of wellbore) p += parcel.density * 1000 * G * (parcel.volume / Vw) * input.pathMD * tvdPerMD;
    return p / 1e6;
  };

  for (const st of input.stages) {
    let remaining = st.volumeM3;
    const startT = t;
    let rateSum = 0, n = 0, stMax = 0;
    while (remaining > 1e-9) {
      const step = Math.min(dV, remaining);
      const skin = mainTotal > 0
        ? input.skinStart + (input.skinEnd - input.skinStart) * Math.min(1, mainEntered / mainTotal)
        : input.skinStart;
      const J = injectivity(input.k_mD, input.h_m, input.fluidViscosity_cP, input.drainageRadiusM, input.wellboreRadiusM, skin);
      const dpMax = Math.max(0, input.fracturePressureMPa - input.safetyMarginMPa - input.reservoirPressureMPa);
      const qMaxLpm = (J * dpMax * 1000) / 1440;
      const rate = Math.max(input.minRateLpm, Math.min(input.pumpMaxLpm, 0.9 * qMaxLpm));
      const bhp = input.reservoirPressureMPa + (J > 0 ? ((rate * 1440) / 1000) / J : 0);
      const fr = tubingFrictionMPa(input.tubingLengthM, input.tubingID_mm, 1.05, input.fluidViscosity_cP, 0, rate / 60).lossMPa;
      const surface = Math.max(0, bhp - hydrostatic() + fr);

      // Сдвиг порций: сверху входит новая, снизу уходит в пласт объём step
      wellbore.push({ stage: st.name, volume: step, density: st.density_gcm3, isMain: !!st.isMainAcid });
      let out = step;
      const entering = wellbore[0].stage;
      while (out > 1e-12 && wellbore.length) {
        const b = wellbore[0];
        const take = Math.min(out, b.volume);
        if (b.isMain) mainEntered += take;
        b.volume -= take; out -= take;
        if (b.volume <= 1e-12) wellbore.shift();
      }
      wellbore = wellbore.filter((x) => x.volume > 1e-12);

      t += (step * 1000) / Math.max(1, rate);
      remaining -= step;
      rateSum += rate; n++;
      stMax = Math.max(stMax, surface);
      maxSurf = Math.max(maxSurf, surface);
      maxBhp = Math.max(maxBhp, bhp);
      points.push({
        volumeM3: points.length ? points[points.length - 1].volumeM3 + step : step,
        timeMin: t, rateLpm: rate, surfacePressureMPa: surface, bhpMPa: bhp, skin, stage: st.name, entering,
      });
    }
    summaries.push({ name: st.name, volumeM3: st.volumeM3, startMin: startT, endMin: t, avgRateLpm: n ? rateSum / n : 0, maxSurfaceMPa: stMax });
  }

  if (points.some((p) => p.rateLpm <= input.minRateLpm + 1e-9 && p.bhpMPa > input.fracturePressureMPa - input.safetyMarginMPa))
    warnings.push(`🔴 Даже минимальный расход ${input.minRateLpm} л/мин превышает допустимое давление — пласт не принимает в матричном режиме. Нужна предварительная обработка/депрессия или признать ГРП.`);
  if (points.some((p) => p.rateLpm >= input.pumpMaxLpm - 1e-9))
    warnings.push(`Расход ограничен подачей насоса ${input.pumpMaxLpm} л/мин — пласт принял бы больше.`);
  warnings.push("Расход на каждом шаге — 90% от допустимого по ГРП при текущем скине; давление на устье — с гидростатикой фактического заполнения ствола.");

  return { points, stages: summaries, totalTimeMin: t, maxSurfaceMPa: maxSurf, maxBhpMPa: maxBhp, warnings };
}

// ═══════════════════════════════════════════════════════════════════
// 2. Экономика с НДПИ, операционными затратами и налогом на прибыль
// ═══════════════════════════════════════════════════════════════════

export interface EconomicsInput {
  /** Цена реализации (нетбэк), руб/т нефти или руб/тыс.м³ газа */
  pricePerUnit: number;
  /** НДПИ, руб/т или руб/тыс.м³ */
  mineralTaxPerUnit: number;
  /** Удельные операционные затраты на добычу, руб/т или руб/тыс.м³ */
  opexPerUnit: number;
  /** Плотность нефти, кг/м³ (для перевода м³ → т). Для газа не используется. */
  oilDensity_kgm3: number;
  isGas: boolean;
  /** Налог на прибыль, доля */
  profitTaxRate: number;
  /** Ставка дисконтирования, доля в год */
  discountRate: number;
  /** Затраты на обработку */
  reagentCostRub: number;
  serviceCostRub: number;
  mobilizationRub: number;
  /** Потери добычи на время простоя, сут */
  downtimeDays: number;
}

export interface EconomicsMonth {
  month: number;
  incrementalUnits: number;
  cashFlow: number;
  cumulative: number;
  cumulativeDiscounted: number;
}

export interface EconomicsResult {
  treatmentCostRub: number;
  downtimeLossRub: number;
  incrementalUnitsTotal: number;
  unitLabel: string;
  marginPerUnit: number;
  npv: number;
  irrAnnual: number | null;
  paybackMonths: number | null;
  pi: number;
  months: EconomicsMonth[];
  warnings: string[];
}

export function calculateStimulationEconomics(forecast: ForecastPoint[], input: EconomicsInput): EconomicsResult {
  const daysPerMonth = 30.4;
  const toUnits = (qPerDay: number) => input.isGas ? qPerDay : (qPerDay * input.oilDensity_kgm3) / 1000; // т или тыс.м³ в сутки
  const margin = (input.pricePerUnit - input.mineralTaxPerUnit - input.opexPerUnit) * (1 - input.profitTaxRate);
  const treatmentCost = input.reagentCostRub + input.serviceCostRub + input.mobilizationRub;
  const baseRate = forecast[0]?.qBaseline ?? 0;
  const downtimeLoss = toUnits(baseRate) * input.downtimeDays * margin;
  const r = Math.pow(1 + input.discountRate, 1 / 12) - 1;

  let cum = -treatmentCost - downtimeLoss;
  let cumD = cum;
  let payback: number | null = null;
  let incTotal = 0;
  const flows: number[] = [cum];
  const months: EconomicsMonth[] = forecast.map((p, i) => {
    const units = toUnits(Math.max(0, p.deltaQ)) * daysPerMonth;
    incTotal += units;
    const cf = units * margin;
    cum += cf;
    cumD += cf / Math.pow(1 + r, i + 1);
    flows.push(cf);
    if (payback === null && cum >= 0) payback = i + 1;
    return { month: i + 1, incrementalUnits: units, cashFlow: cf, cumulative: cum, cumulativeDiscounted: cumD };
  });

  // IRR (месячная) бисекцией → годовая
  const npvAt = (rm: number) => flows.reduce((s, f, i) => s + f / Math.pow(1 + rm, i), 0);
  let irr: number | null = null;
  if (npvAt(0) > 0 && npvAt(5) < 0) {
    let lo = 0, hi = 5;
    for (let k = 0; k < 100; k++) { const mid = (lo + hi) / 2; if (npvAt(mid) > 0) lo = mid; else hi = mid; }
    irr = Math.pow(1 + (lo + hi) / 2, 12) - 1;
  }

  const warnings: string[] = [];
  if (margin <= 0) warnings.push("🔴 Цена за вычетом НДПИ и операционных затрат ≤ 0 — дополнительная добыча убыточна.");
  if (payback === null) warnings.push("Обработка не окупается за горизонт прогноза.");
  warnings.push("Цены, НДПИ и затраты — введите актуальные для месторождения; ставка НДПИ меняется ежемесячно.");

  return {
    treatmentCostRub: treatmentCost,
    downtimeLossRub: downtimeLoss,
    incrementalUnitsTotal: incTotal,
    unitLabel: input.isGas ? "тыс.м³" : "т",
    marginPerUnit: margin,
    npv: cumD,
    irrAnnual: irr,
    paybackMonths: payback,
    pi: treatmentCost + downtimeLoss > 0 ? (cumD + treatmentCost + downtimeLoss) / (treatmentCost + downtimeLoss) : 0,
    months,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. Распределение кислоты по пропласткам
// ═══════════════════════════════════════════════════════════════════

export interface Zone {
  name: string;
  h_m: number;
  k_mD: number;
  skin: number;
}

export interface ZoneAllocationResult {
  name: string;
  sharePct: number;
  volumeM3: number;
  requiredM3: number;
  coveragePct: number;
}

/**
 * Без отклонителя кислота распределяется пропорционально приёмистости пропластка
 * J_i ∝ k_i·h_i / (ln(re/rw) + S_i). Отклонитель выравнивает профиль:
 * доля ∝ J_i^(1−e), где e — эффективность отклонения (0 — нет, 1 — идеально по толщине).
 */
export function allocateAcidToZones(
  zones: Zone[], totalVolumeM3: number, volumePerMeter: number, diverterEfficiency: number,
  re = 250, rw = 0.108,
): ZoneAllocationResult[] {
  const e = Math.min(1, Math.max(0, diverterEfficiency));
  const lnR = Math.log(re / rw);
  const w = zones.map((z) => {
    const J = (z.k_mD * z.h_m) / Math.max(0.5, lnR + z.skin);
    // при идеальном отклонении — пропорционально толщине
    return Math.pow(Math.max(1e-9, J), 1 - e) * Math.pow(Math.max(1e-9, z.h_m), e);
  });
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return zones.map((z, i) => {
    const vol = (totalVolumeM3 * w[i]) / sum;
    const req = volumePerMeter * z.h_m;
    return { name: z.name, sharePct: (100 * w[i]) / sum, volumeM3: vol, requiredM3: req, coveragePct: req > 0 ? (100 * vol) / req : 0 };
  });
}
