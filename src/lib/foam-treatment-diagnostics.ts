/**
 * Пенообработка ПЗП — Диагностика, прогноз, экономика (академический уровень).
 *
 * Блоки:
 *   1) IPR (Vogel/Darcy) + продуктивность
 *   2) Декомпозиция скина (Hawkins)
 *   3) Авто-диагностика механизма повреждения
 *   4) Кривые падения Арпса (подбор параметров)
 *   5) Прогноз дебита после обработки с затуханием эффекта
 *   6) Экономика: NPV, ROI, payback, cashflow
 */

/* ───────────────────── Типы ───────────────────── */

export interface ProductionPoint {
  /** месяц от первой точки, 0,1,2,… */
  month: number;
  /** дебит нефти, м³/сут */
  qOil: number;
  /** обводнённость, % */
  waterCut?: number;
  /** забойное давление, МПа (если есть) */
  bhpMPa?: number;
}

export interface ReservoirSnapshot {
  /** Текущее пластовое давление, МПа */
  Pr: number;
  /** Давление насыщения, МПа */
  Pb: number;
  /** Проницаемость, мД */
  k_mD: number;
  /** Эффективная толщина, м */
  h: number;
  /** Вязкость нефти, сПз */
  mu_cP: number;
  /** Объёмный коэффициент нефти Bo */
  Bo: number;
  /** Радиус дренирования, м */
  re: number;
  /** Радиус скважины, м */
  rw: number;
  /** Текущий скин (из ГДИС или оценка) */
  skin: number;
  /** Температура пласта, °C */
  tempC: number;
}

export interface Mineralogy {
  quartz: number;
  feldspar: number;
  calcite: number;
  dolomite: number;
  clay: number;
  /** % монтмориллонита от общего объёма */
  montmorillonite: number;
}

export interface DrillingHistory {
  mudType: "wbm" | "obm" | "sbm";
  mudWeight: number;            // г/см³
  overbalanceMPa: number;       // репрессия при бурении
  soakTimeDays: number;         // контакт с буровым
}

export type CollectorType = "sandstone" | "carbonate" | "fractured" | "tight";

/* ───────────────────── 1. IPR (Vogel/Darcy) ───────────────────── */

export interface IPRResult {
  /** Идеальная продуктивность (без скина), м³/(сут·МПа) */
  J_ideal: number;
  /** Текущая (фактическая) продуктивность, м³/(сут·МПа) */
  J_actual: number;
  /** AOF (абсолютно открытый поток), м³/сут */
  qMax_vogel: number;
  /** Точки IPR кривой: bhp [МПа] vs qOil [м³/сут] */
  iprCurve: { bhp: number; qOil: number }[];
  /** Flow efficiency (J_actual / J_ideal_with_skin) */
  flowEfficiency: number;
}

/** Радиальный коэффициент продуктивности по Дюпюи, м³/(сут·МПа). */
function darcyJ(k_mD: number, h: number, mu: number, Bo: number, re: number, rw: number, skin: number): number {
  // Метрическая форма: J = (k·h) / (18.41·μ·Bo·(ln(re/rw)+S))
  const denom = 18.41 * mu * Bo * (Math.log(re / rw) + skin);
  return denom > 0 ? (k_mD * h) / denom : 0;
}

export function calculateIPR(reservoir: ReservoirSnapshot, history: ProductionPoint[]): IPRResult {
  const { k_mD, h, mu_cP, Bo, re, rw, skin, Pr, Pb } = reservoir;
  const J_ideal = darcyJ(k_mD, h, mu_cP, Bo, re, rw, 0);
  const J_withSkin = darcyJ(k_mD, h, mu_cP, Bo, re, rw, skin);

  const qMax_vogel =
    Pr > Pb
      ? J_withSkin * Pr
      : (J_withSkin * Pb * (1 + 0.2 * (Pr / Pb) - 0.8 * Math.pow(Pr / Pb, 2))) / 1.8;

  const iprCurve: { bhp: number; qOil: number }[] = [];
  for (let i = 0; i <= 20; i++) {
    const pwf = (i / 20) * Pr;
    let q: number;
    if (Pr > Pb) {
      q = J_withSkin * (Pr - pwf);
    } else {
      q = qMax_vogel * (1 - 0.2 * (pwf / Pr) - 0.8 * Math.pow(pwf / Pr, 2));
    }
    iprCurve.push({ bhp: pwf, qOil: Math.max(0, q) });
  }

  // Фактическая продуктивность из истории (если есть забойное)
  const last = history[history.length - 1];
  const J_actual =
    last && last.bhpMPa !== undefined && Pr > last.bhpMPa
      ? last.qOil / (Pr - last.bhpMPa)
      : J_withSkin;

  const flowEfficiency = J_ideal > 0 ? J_actual / J_ideal : 0;

  return { J_ideal, J_actual, qMax_vogel, iprCurve, flowEfficiency: Math.max(0, Math.min(2, flowEfficiency)) };
}

/* ───────────────────── 2. Декомпозиция скина ───────────────────── */

export interface SkinDecomposition {
  totalSkin: number;
  skinDamage: number;       // повреждение призабойной зоны (Hawkins)
  skinMechanical: number;   // механический (перфорация, частичное вскрытие)
  skinDeviation: number;    // от наклона ствола (отрицательный)
  skinPseudo: number;       // турбулентность, фазовые эффекты
  damagedZoneRadius: number;
  damagedPermeability: number;
  damageRatio: number;      // k/k_d
}

/** Скин по Хокинсу: S = (k/k_d − 1)·ln(r_d/rw). */
export function hawkinsSkin(k: number, k_d: number, r_d: number, rw: number): number {
  if (k_d <= 0 || rw <= 0 || r_d <= rw) return 0;
  return (k / k_d - 1) * Math.log(r_d / rw);
}

/**
 * Распределяет полный скин на компоненты по эвристикам.
 * Возвращает оценки + параметры зоны повреждения, согласованные по Хокинсу.
 */
export function decomposeSkin(
  totalSkin: number,
  reservoir: ReservoirSnapshot,
  zenithDeg: number = 0,
  perfDensity: number = 20,
): SkinDecomposition {
  // Скин от наклона (по формуле Cinco-Ley, упрощённая):
  // S_dev ≈ −(θ/41)^2.06, для θ до 75°
  const skinDeviation = zenithDeg > 0 ? -Math.pow(Math.min(75, zenithDeg) / 41, 2.06) : 0;

  // Механический (перфорация, плотность отверстий): хорошая >20 → 0, плохая <10 → +2..+4
  const skinMechanical = perfDensity >= 20 ? 0.5 : perfDensity >= 12 ? 1.5 : 3.5;

  // Псевдоскин (турбулентность) — обычно небольшой для нефтяных
  const skinPseudo = 0.5;

  // Оставшийся скин — повреждение
  const skinDamage = Math.max(0, totalSkin - skinMechanical - skinDeviation - skinPseudo);

  // Реконструируем параметры зоны повреждения: фиксируем r_d, считаем k_d
  // S_d = (k/k_d − 1)·ln(r_d/rw) → k_d = k / (1 + S_d/ln(r_d/rw))
  const r_d = Math.max(reservoir.rw * 3, 0.5); // 0.5 м или 3·rw
  const lnRatio = Math.log(r_d / reservoir.rw);
  const damageRatio = skinDamage > 0 && lnRatio > 0 ? 1 + skinDamage / lnRatio : 1;
  const damagedPermeability = reservoir.k_mD / Math.max(1, damageRatio);

  return {
    totalSkin,
    skinDamage,
    skinMechanical,
    skinDeviation,
    skinPseudo,
    damagedZoneRadius: r_d,
    damagedPermeability,
    damageRatio,
  };
}

/* ───────────────────── 3. Авто-диагностика повреждения ───────────────────── */

export type DamageMechanism =
  | "mud_filtrate"
  | "fines_migration"
  | "clay_swelling"
  | "scale_deposition"
  | "wax_asphaltene"
  | "emulsion_block"
  | "water_block"
  | "condensate_banking"
  | "perforation_damage";

export interface DamageAssessment {
  mechanism: DamageMechanism;
  nameRu: string;
  probability: number;          // 0..1
  severity: "low" | "medium" | "high";
  evidence: string;
  recommendedRecipeId: string;  // совпадает с FOAM_TREATMENT_RECIPES.id
}

const MECH_NAME: Record<DamageMechanism, string> = {
  mud_filtrate: "Фильтрат бурового раствора",
  fines_migration: "Миграция мелких частиц",
  clay_swelling: "Набухание глин",
  scale_deposition: "Солеотложения (CaCO₃ / CaSO₄)",
  wax_asphaltene: "АСПО (асфальтены, парафин)",
  emulsion_block: "Эмульсионная блокада",
  water_block: "Водяная блокада",
  condensate_banking: "Конденсатная пробка",
  perforation_damage: "Повреждение перфорации",
};

export function diagnoseDamage(
  reservoir: ReservoirSnapshot,
  mineralogy: Mineralogy | undefined,
  collector: CollectorType,
  history: ProductionPoint[],
  drilling: DrillingHistory | undefined,
  perfDensity: number = 20,
): DamageAssessment[] {
  const out: DamageAssessment[] = [];

  // 1) Фильтрат бурового
  if (drilling && drilling.mudType === "wbm" && drilling.overbalanceMPa > 2.5) {
    const sev = drilling.soakTimeDays > 10 ? "high" : drilling.soakTimeDays > 4 ? "medium" : "low";
    out.push({
      mechanism: "mud_filtrate",
      nameRu: MECH_NAME.mud_filtrate,
      probability: Math.min(0.95, 0.55 + 0.05 * drilling.overbalanceMPa + 0.02 * drilling.soakTimeDays),
      severity: sev,
      evidence: `ВБР ${drilling.mudWeight.toFixed(2)} г/см³, репрессия ${drilling.overbalanceMPa.toFixed(1)} МПа, контакт ${drilling.soakTimeDays} сут`,
      recommendedRecipeId: collector === "carbonate" ? "foam_acid_hcl_carb" : "foam_pav_clean",
    });
  }

  // 2) Набухание глин
  if (mineralogy && mineralogy.clay >= 8) {
    const mmt = mineralogy.montmorillonite ?? 0;
    if (mmt >= 3 || mineralogy.clay >= 15) {
      out.push({
        mechanism: "clay_swelling",
        nameRu: MECH_NAME.clay_swelling,
        probability: Math.min(0.95, 0.4 + 0.04 * mmt + 0.015 * mineralogy.clay),
        severity: mmt >= 15 ? "high" : mmt >= 8 ? "medium" : "low",
        evidence: `Глинистость ${mineralogy.clay}%, монтмориллонит ${mmt}%`,
        recommendedRecipeId: collector === "carbonate" ? "foam_acid_hcl_carb" : "foam_acid_glina",
      });
    }
  }

  // 3) АСПО
  const lastQ = history[history.length - 1]?.qOil ?? 0;
  const firstQ = history[0]?.qOil ?? lastQ;
  const decline = firstQ > 0 ? Math.max(0, (firstQ - lastQ) / firstQ) : 0;
  if (reservoir.tempC < 70 && decline > 0.25) {
    out.push({
      mechanism: "wax_asphaltene",
      nameRu: MECH_NAME.wax_asphaltene,
      probability: Math.min(0.9, 0.4 + 0.7 * decline),
      severity: decline > 0.5 ? "high" : "medium",
      evidence: `Tпл ${reservoir.tempC}°C (≤ WAT?), падение дебита ${(decline * 100).toFixed(0)}%`,
      recommendedRecipeId: "foam_solvent_aspo",
    });
  }

  // 4) Солеотложения
  const lastWC = history[history.length - 1]?.waterCut ?? 0;
  if (lastWC > 40 && reservoir.tempC > 55) {
    out.push({
      mechanism: "scale_deposition",
      nameRu: MECH_NAME.scale_deposition,
      probability: Math.min(0.85, 0.3 + 0.005 * lastWC + 0.005 * reservoir.tempC),
      severity: lastWC > 70 ? "high" : "medium",
      evidence: `Обводнённость ${lastWC.toFixed(0)}%, Tпл ${reservoir.tempC}°C — риск CaCO₃ / CaSO₄`,
      recommendedRecipeId: collector === "carbonate" ? "foam_acid_hcl_carb" : "foam_pav_clean",
    });
  }

  // 5) Миграция мелких частиц (терриген + рост обводнённости)
  if ((collector === "sandstone" || collector === "tight") && lastWC > 25 && (mineralogy?.clay ?? 0) >= 5) {
    out.push({
      mechanism: "fines_migration",
      nameRu: MECH_NAME.fines_migration,
      probability: 0.55 + 0.005 * lastWC,
      severity: "medium",
      evidence: `Терриген, обв. ${lastWC.toFixed(0)}%, глин. ${(mineralogy?.clay ?? 0)}%`,
      recommendedRecipeId: "foam_acid_glina",
    });
  }

  // 6) Водяная блокада (терриген, низкая проницаемость)
  if ((collector === "sandstone" || collector === "tight") && reservoir.k_mD < 10 && lastWC < 15) {
    out.push({
      mechanism: "water_block",
      nameRu: MECH_NAME.water_block,
      probability: 0.5,
      severity: "medium",
      evidence: `Низкая k=${reservoir.k_mD} мД, низкая обв. ${lastWC.toFixed(0)}% — капиллярная блокада`,
      recommendedRecipeId: "foam_pav_clean",
    });
  }

  // 7) Повреждение перфорации
  if (perfDensity < 12) {
    out.push({
      mechanism: "perforation_damage",
      nameRu: MECH_NAME.perforation_damage,
      probability: 0.6,
      severity: perfDensity < 8 ? "high" : "medium",
      evidence: `Плотность перфорации ${perfDensity} отв/м — низкая`,
      recommendedRecipeId: "foam_acid_hcl_carb",
    });
  }

  return out.sort((a, b) => b.probability - a.probability);
}

/* ───────────────────── 4. Арпс — подбор параметров падения ───────────────────── */

export type DeclineType = "exponential" | "hyperbolic" | "harmonic";

export interface DeclineAnalysis {
  type: DeclineType;
  qi: number;     // начальный дебит, м³/сут
  di: number;     // начальная скорость падения, 1/мес
  b: number;      // показатель Арпса
  r2: number;     // качество подбора
  eurM3?: number; // оценка EUR (если применимо), м³
}

/** q(t) = qi / (1 + b·di·t)^(1/b); b=0 → qi·exp(−di·t) */
function arpsQ(qi: number, di: number, b: number, t: number): number {
  if (b <= 1e-6) return qi * Math.exp(-di * t);
  return qi / Math.pow(1 + b * di * t, 1 / b);
}

function r2(actual: number[], predicted: number[]): number {
  if (actual.length < 2) return 0;
  const mean = actual.reduce((s, v) => s + v, 0) / actual.length;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < actual.length; i++) {
    ssRes += (actual[i] - predicted[i]) ** 2;
    ssTot += (actual[i] - mean) ** 2;
  }
  return ssTot > 0 ? 1 - ssRes / ssTot : 0;
}

/**
 * Подбор Арпса перебором по b ∈ [0..1] и аналитической оценкой qi, di.
 * Простая, но устойчивая реализация без внешних либ.
 */
export function fitArpsDecline(history: ProductionPoint[]): DeclineAnalysis {
  const pts = history.filter((p) => p.qOil > 0);
  if (pts.length < 3) {
    return { type: "exponential", qi: pts[0]?.qOil ?? 0, di: 0, b: 0, r2: 0 };
  }
  const tArr = pts.map((p) => p.month);
  const qArr = pts.map((p) => p.qOil);

  let best: { qi: number; di: number; b: number; r2: number } = { qi: qArr[0], di: 0.01, b: 0, r2: -Infinity };

  for (let bi = 0; bi <= 20; bi++) {
    const b = bi / 20; // 0..1
    // Грид-поиск di
    for (let dj = 1; dj <= 60; dj++) {
      const di = 0.002 * dj; // 0.002..0.12 1/мес
      // Аналитическая оценка qi = mean(q_i / arpsQ(1,di,b,t_i))
      let sum = 0, n = 0;
      for (let i = 0; i < pts.length; i++) {
        const f = arpsQ(1, di, b, tArr[i]);
        if (f > 0) {
          sum += qArr[i] / f;
          n++;
        }
      }
      const qi = n > 0 ? sum / n : qArr[0];
      const pred = tArr.map((t) => arpsQ(qi, di, b, t));
      const r = r2(qArr, pred);
      if (r > best.r2) best = { qi, di, b, r2: r };
    }
  }

  const type: DeclineType = best.b <= 0.05 ? "exponential" : best.b >= 0.95 ? "harmonic" : "hyperbolic";

  // Оценка EUR: интеграл q(t)dt до экономического предела (1 м³/сут), за 240 мес
  let eur = 0;
  for (let t = 0; t < 240; t++) {
    const q = arpsQ(best.qi, best.di, best.b, t);
    if (q < 1) break;
    eur += q * 30; // м³/мес ≈ q·30 (упрощ.)
  }

  return { type, qi: best.qi, di: best.di, b: best.b, r2: best.r2, eurM3: eur };
}

/* ───────────────────── 5. Прогноз после обработки ───────────────────── */

export interface ForecastPoint {
  month: number;
  qBaseline: number;       // без обработки, м³/сут
  qTreated: number;        // с обработкой (с затуханием), м³/сут
  deltaQ: number;          // прирост, м³/сут
  cumulativeDeltaM3: number; // накопленный прирост, м³
}

/** PI_new/PI_old по Дюпюи (тот же re/rw): (ln(re/rw)+S_old)/(ln(re/rw)+S_new). */
export function piRatio(reservoir: ReservoirSnapshot, skinOld: number, skinNew: number): number {
  const lnR = Math.log(reservoir.re / reservoir.rw);
  return (lnR + Math.max(-2, skinOld)) / (lnR + Math.max(-2, skinNew));
}

export function forecastPostTreatment(
  baseline: DeclineAnalysis,
  reservoir: ReservoirSnapshot,
  skinOld: number,
  skinNew: number,
  months: number = 36,
  /** Скорость возврата скина, 1/мес. 0.02 = эффект слабеет на 2%/мес. */
  skinRecoveryRate: number = 0.02,
): ForecastPoint[] {
  const ratio = piRatio(reservoir, skinOld, skinNew);
  const out: ForecastPoint[] = [];
  let cum = 0;
  for (let m = 0; m < months; m++) {
    const qBase = arpsQ(baseline.qi, baseline.di, baseline.b, m);
    const effRatio = 1 + (ratio - 1) * Math.exp(-skinRecoveryRate * m);
    const qTreated = qBase * effRatio;
    const dq = qTreated - qBase;
    cum += Math.max(0, dq) * 30; // м³ за месяц
    out.push({ month: m, qBaseline: qBase, qTreated, deltaQ: dq, cumulativeDeltaM3: cum });
  }
  return out;
}

/* ───────────────────── 6. Экономика ───────────────────── */

export interface CostInputs {
  chemicalCost: number;
  n2Cost: number;
  equipmentDays: number;
  crewDays: number;
  mobilization: number;
  oilPricePerM3: number;   // руб/м³
  discountRateAnnual: number; // напр. 0.12
}

export const DEFAULT_COSTS: CostInputs = {
  chemicalCost: 0,
  n2Cost: 0,
  equipmentDays: 2,
  crewDays: 2,
  mobilization: 500_000,
  oilPricePerM3: 35_000,
  discountRateAnnual: 0.12,
};

export const COST_RATES = {
  acidPump_per_day: 120_000,
  n2Unit_per_day: 180_000,
  foamGen_per_day: 50_000,
  crew_per_day: 250_000,
};

export interface EconomicsResult {
  totalCost: number;
  incrementalOilM3: number;
  incrementalRevenue: number;
  netProfit: number;
  paybackMonths: number | null;
  roi: number;            // %
  npv: number;            // руб
  monthly: Array<{
    month: number;
    qBaseline: number;
    qTreated: number;
    deltaQ: number;
    cumulativeDeltaM3: number;
    monthRevenue: number;
    cumulativeProfit: number;
    cumulativeProfitDiscounted: number;
  }>;
}

export function calculateEconomics(forecast: ForecastPoint[], costs: CostInputs): EconomicsResult {
  const equipment = costs.equipmentDays * (COST_RATES.acidPump_per_day + COST_RATES.n2Unit_per_day + COST_RATES.foamGen_per_day);
  const crew = costs.crewDays * COST_RATES.crew_per_day;
  const totalCost = costs.chemicalCost + costs.n2Cost + equipment + crew + costs.mobilization;

  const monthlyRate = Math.pow(1 + costs.discountRateAnnual, 1 / 12) - 1;
  let cumProfit = -totalCost;
  let cumProfitDisc = -totalCost;
  let paybackMonths: number | null = null;
  let totalRevenue = 0;

  const monthly = forecast.map((p) => {
    const monthM3 = Math.max(0, p.deltaQ) * 30;
    const monthRevenue = monthM3 * costs.oilPricePerM3;
    totalRevenue += monthRevenue;
    cumProfit += monthRevenue;
    cumProfitDisc += monthRevenue / Math.pow(1 + monthlyRate, p.month + 1);
    if (paybackMonths === null && cumProfit >= 0) paybackMonths = p.month;
    return {
      month: p.month,
      qBaseline: p.qBaseline,
      qTreated: p.qTreated,
      deltaQ: p.deltaQ,
      cumulativeDeltaM3: p.cumulativeDeltaM3,
      monthRevenue,
      cumulativeProfit: cumProfit,
      cumulativeProfitDiscounted: cumProfitDisc,
    };
  });

  const netProfit = totalRevenue - totalCost;
  const roi = totalCost > 0 ? (netProfit / totalCost) * 100 : 0;
  const npv = cumProfitDisc;
  const incrementalOilM3 = forecast.length ? forecast[forecast.length - 1].cumulativeDeltaM3 : 0;

  return {
    totalCost,
    incrementalOilM3,
    incrementalRevenue: totalRevenue,
    netProfit,
    paybackMonths,
    roi,
    npv,
    monthly,
  };
}
