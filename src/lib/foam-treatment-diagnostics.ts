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
  /** % монтмориллонита (= smectite) от общего объёма */
  montmorillonite: number;
  // ── расширенные поля (опционально, используются если заданы) ──
  kaolinite?: number;
  illite?: number;
  chlorite?: number;
  smectite?: number;
  chalk?: number;
  siderite?: number;
  anhydrite?: number;
  pyrite?: number;
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

/* ───────────────────── 7. Реология пены в пористой среде (Hirasaki-Lawson) ───────────────────── */

/**
 * Кажущаяся вязкость пены в пористой среде по упрощённой модели Hirasaki-Lawson.
 *   μ_app = μ_base · (1 + α · FQ / (1 − FQ))
 *   α ~ √k · C_surf / max(0.01, v)
 *
 * @param FQ          качество пены, 0..1
 * @param mu_base_cP  вязкость базовой жидкости, сПз
 * @param k_mD        проницаемость пласта, мД
 * @param v_mps       скорость Дарси, м/с
 * @param surfPct     концентрация ПАВ, %
 */
export function foamApparentViscosity(
  FQ: number, mu_base_cP: number, k_mD: number, v_mps: number, surfPct: number,
): number {
  const fq = Math.max(0, Math.min(0.95, FQ));
  const alpha = (10 * Math.sqrt(Math.max(0.01, k_mD)) * Math.max(0, surfPct)) / Math.max(1e-3, v_mps * 1000);
  const mu = mu_base_cP * (1 + alpha * fq / Math.max(0.01, 1 - fq));
  return Math.min(10000, Math.max(mu_base_cP, mu));
}

/** Mobility Reduction Factor: во сколько раз пена снижает подвижность. */
export function mobilityReductionFactor(FQ: number, surfPct: number): number {
  return 1 + 50 * Math.pow(Math.max(0, Math.min(1, FQ)), 1.5) * Math.min(1, Math.max(0, surfPct) / 0.5);
}

/** Индекс приёмистости (закачка), м³/(сут·МПа). */
export function calculateInjectivity(
  k_mD: number, h: number, mu_cP: number, re: number, rw: number, skin: number,
): number {
  const denom = mu_cP * (Math.log(re / rw) + skin);
  return denom > 0 ? (2 * Math.PI * k_mD * h * 86400) / (denom * 1e6) : 0;
}

/**
 * Радиус проникновения раствора в пласт.
 *   V_inj = π · (R² − rw²) · h · φ · (1 − Sor) · (1 − FQ)
 */
export function penetrationRadius(
  volumeInjectedM3: number,
  netPay: number,
  porosity: number,
  residualSat: number,
  rw: number,
  foamQuality: number,
): number {
  const effPV = porosity * Math.max(0.01, 1 - residualSat);
  const liquidFrac = Math.max(0.05, 1 - foamQuality);
  const argument = volumeInjectedM3 / (Math.PI * Math.max(0.1, netPay) * effPV * liquidFrac) + rw * rw;
  return Math.sqrt(Math.max(0, argument));
}

/* ───────────────────── 8. Tornado sensitivity для NPV ───────────────────── */

export interface SensitivityParam {
  name: string;
  baseValue: number;
  /** Доля изменения, 0.2 = ±20%. */
  variation: number;
  /** Применяет новое значение к копии входа и возвращает NPV. */
  evaluate: (val: number) => number;
}

export interface SensitivityResult {
  name: string;
  baseValue: number;
  lowValue: number;
  highValue: number;
  lowNPV: number;
  highNPV: number;
  /** |highNPV − lowNPV| — для сортировки tornado. */
  range: number;
}

export function tornadoSensitivity(baseNPV: number, params: SensitivityParam[]): SensitivityResult[] {
  return params
    .map((p) => {
      const lo = p.baseValue * (1 - p.variation);
      const hi = p.baseValue * (1 + p.variation);
      const npvLo = p.evaluate(lo);
      const npvHi = p.evaluate(hi);
      return {
        name: p.name,
        baseValue: p.baseValue,
        lowValue: lo,
        highValue: hi,
        lowNPV: npvLo,
        highNPV: npvHi,
        range: Math.abs(npvHi - npvLo),
      };
    })
    .sort((a, b) => b.range - a.range);
}

/* ───────────────────── 9. Hawkins waterfall (поэтапное снятие скина) ───────────────────── */

export interface WaterfallStage {
  /** Короткий ID этапа */
  id: string;
  /** Подпись на оси */
  label: string;
  /** Скин ПОСЛЕ этого этапа */
  skinAfter: number;
  /** Изменение скина на этом этапе (отрицательное = снятие) */
  delta: number;
  /** Эффективная проницаемость ПЗП ПОСЛЕ этапа, мД */
  effectivePermeability: number;
  /** Краткое описание механизма */
  mechanism: string;
}

/**
 * Поэтапная декомпозиция снятия скина в процессе пенообработки.
 * Имитирует физическую последовательность: дисперсия АСПО → растворение глин →
 * деблокада водяной фазы → восстановление подвижности.
 */
export function hawkinsWaterfall(
  initialSkin: number,
  reservoir: ReservoirSnapshot,
  damage: DamageAssessment[],
  expectedTotalReduction: number,
): WaterfallStage[] {
  // Распределяем общее снятие скина по 4 механизмам с весами из диагноза.
  const weights: Record<string, number> = {
    wax_asphaltene: 0,
    clay_swelling: 0,
    water_block: 0,
    mud_filtrate: 0,
    fines_migration: 0,
    emulsion_block: 0,
    scale_deposition: 0,
  };
  damage.forEach((d) => {
    weights[d.mechanism] = (weights[d.mechanism] || 0) + d.probability;
  });
  // Базовые веса, чтобы waterfall всегда показывал 4 этапа
  weights.wax_asphaltene = Math.max(weights.wax_asphaltene || 0, 0.2);
  weights.clay_swelling = Math.max(weights.clay_swelling || 0, 0.15);
  weights.water_block = Math.max(weights.water_block || 0, 0.15);
  weights.mud_filtrate = Math.max(weights.mud_filtrate || 0, 0.1);

  const wSum = weights.wax_asphaltene + weights.clay_swelling + weights.water_block + weights.mud_filtrate;
  const frac = (w: number) => (wSum > 0 ? w / wSum : 0.25);

  const stages: Array<{ id: string; label: string; mechanism: string; share: number }> = [
    { id: "solvent", label: "Растворитель / АСПО", mechanism: "Дисперсия парафинов и асфальтенов азотным лифтом", share: frac(weights.wax_asphaltene) },
    { id: "acid", label: "Кислотный пакет", mechanism: "Растворение карбонатных мостиков, частиц бурового, продуктов осаждения", share: frac(weights.mud_filtrate + weights.scale_deposition) },
    { id: "clay", label: "Стабилизатор глин + ПАВ", mechanism: "Подавление набухания глин, стабилизация мелких частиц", share: frac(weights.clay_swelling) },
    { id: "foam", label: "Пенный отжим воды", mechanism: "Снятие водяной/эмульсионной блокады, восстановление фазовой проницаемости", share: frac(weights.water_block + weights.emulsion_block) },
  ];

  const totalShare = stages.reduce((s, x) => s + x.share, 0) || 1;
  let runningSkin = initialSkin;
  const lnRatio = Math.log(Math.max(0.5, reservoir.rw * 5) / reservoir.rw);

  return stages.map((s) => {
    const delta = -(s.share / totalShare) * expectedTotalReduction;
    runningSkin = Math.max(-2, runningSkin + delta);
    // Эффективная k ПЗП через Hawkins-обращение
    const damageRatio = runningSkin > 0 ? 1 + runningSkin / lnRatio : 1;
    return {
      id: s.id,
      label: s.label,
      skinAfter: runningSkin,
      delta,
      effectivePermeability: reservoir.k_mD / Math.max(1, damageRatio),
      mechanism: s.mechanism,
    };
  });
}

/* ───────────────────── 10. Step-Rate Test (SRT) интерпретация ───────────────────── */

export interface StepRatePoint {
  /** Расход закачки, м³/сут */
  rate: number;
  /** Стабильное забойное давление на этом шаге, МПа */
  pressure: number;
}

export interface StepRateInterpretation {
  /** Давление разрыва пласта (FPP), МПа. null если не обнаружено. */
  formationPartingPressure: number | null;
  /** Расход, при котором достигается FPP, м³/сут */
  fppRate: number | null;
  /** Индекс точки в массиве (для подсветки) */
  fppIndex: number | null;
  /** Наклон до FPP (матричный режим), МПа/(м³/сут) — это 1/II */
  matrixSlope: number;
  /** Наклон после FPP (трещинный режим) */
  fractureSlope: number;
  /** Индекс приёмистости в матричном режиме, м³/(сут·МПа) */
  matrixInjectivity: number;
  /** Безопасный максимум для пенообработки (90% от FPP) */
  safeMaxPressure: number | null;
  /** Безопасный максимум расхода */
  safeMaxRate: number | null;
  /** Точки регрессии (для отрисовки прямых) */
  matrixLine: { rate: number; pressure: number }[];
  fractureLine: { rate: number; pressure: number }[];
  /** Качественная оценка */
  verdict: "matrix_only" | "fracture_detected" | "insufficient_data";
  verdictText: string;
}

/** Линейная регрессия y = a + b·x. Возвращает {a, b}. */
function linearFit(pts: { x: number; y: number }[]): { a: number; b: number } {
  const n = pts.length;
  if (n < 2) return { a: 0, b: 0 };
  const sx = pts.reduce((s, p) => s + p.x, 0);
  const sy = pts.reduce((s, p) => s + p.y, 0);
  const sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
  const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) return { a: sy / n, b: 0 };
  const b = (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  return { a, b };
}

export function interpretStepRateTest(points: StepRatePoint[]): StepRateInterpretation {
  const pts = [...points].filter((p) => p.rate > 0 && p.pressure > 0).sort((a, b) => a.rate - b.rate);
  if (pts.length < 4) {
    return {
      formationPartingPressure: null, fppRate: null, fppIndex: null,
      matrixSlope: 0, fractureSlope: 0, matrixInjectivity: 0,
      safeMaxPressure: null, safeMaxRate: null,
      matrixLine: [], fractureLine: [],
      verdict: "insufficient_data",
      verdictText: "Для интерпретации нужно ≥ 4 точек ступенчатой закачки.",
    };
  }

  // Поиск точки излома: минимизируем сумму SSE двух линейных регрессий.
  let bestIdx = -1;
  let bestSSE = Infinity;
  for (let split = 2; split <= pts.length - 2; split++) {
    const a = pts.slice(0, split).map((p) => ({ x: p.rate, y: p.pressure }));
    const b = pts.slice(split).map((p) => ({ x: p.rate, y: p.pressure }));
    const fitA = linearFit(a);
    const fitB = linearFit(b);
    const sseA = a.reduce((s, p) => s + Math.pow(p.y - (fitA.a + fitA.b * p.x), 2), 0);
    const sseB = b.reduce((s, p) => s + Math.pow(p.y - (fitB.a + fitB.b * p.x), 2), 0);
    const sse = sseA + sseB;
    // Излом валиден только если наклон во второй части МЕНЬШЕ (трещина даёт пологий участок)
    if (sse < bestSSE && fitB.b < fitA.b * 0.7) {
      bestSSE = sse;
      bestIdx = split;
    }
  }

  // Если излом не найден — весь тест в матричном режиме
  if (bestIdx < 0) {
    const fit = linearFit(pts.map((p) => ({ x: p.rate, y: p.pressure })));
    const matrixII = fit.b > 0 ? 1 / fit.b : 0;
    return {
      formationPartingPressure: null, fppRate: null, fppIndex: null,
      matrixSlope: fit.b, fractureSlope: 0,
      matrixInjectivity: matrixII,
      safeMaxPressure: pts[pts.length - 1].pressure * 0.95,
      safeMaxRate: pts[pts.length - 1].rate * 0.95,
      matrixLine: [
        { rate: pts[0].rate, pressure: fit.a + fit.b * pts[0].rate },
        { rate: pts[pts.length - 1].rate, pressure: fit.a + fit.b * pts[pts.length - 1].rate },
      ],
      fractureLine: [],
      verdict: "matrix_only",
      verdictText: `Излом не обнаружен — закачка в матричном режиме до ${pts[pts.length - 1].pressure.toFixed(1)} МПа. Можно увеличивать темп.`,
    };
  }

  const matrixPts = pts.slice(0, bestIdx);
  const fracPts = pts.slice(bestIdx);
  const fitM = linearFit(matrixPts.map((p) => ({ x: p.rate, y: p.pressure })));
  const fitF = linearFit(fracPts.map((p) => ({ x: p.rate, y: p.pressure })));

  // FPP = пересечение двух прямых
  const fppRate = (fitF.a - fitM.a) / (fitM.b - fitF.b);
  const fpp = fitM.a + fitM.b * fppRate;

  return {
    formationPartingPressure: fpp,
    fppRate,
    fppIndex: bestIdx,
    matrixSlope: fitM.b,
    fractureSlope: fitF.b,
    matrixInjectivity: fitM.b > 0 ? 1 / fitM.b : 0,
    safeMaxPressure: fpp * 0.9,
    safeMaxRate: fppRate * 0.9,
    matrixLine: [
      { rate: pts[0].rate, pressure: fitM.a + fitM.b * pts[0].rate },
      { rate: fppRate, pressure: fpp },
    ],
    fractureLine: [
      { rate: fppRate, pressure: fpp },
      { rate: pts[pts.length - 1].rate, pressure: fitF.a + fitF.b * pts[pts.length - 1].rate },
    ],
    verdict: "fracture_detected",
    verdictText: `Обнаружено давление разрыва пласта ${fpp.toFixed(1)} МПа при ${fppRate.toFixed(0)} м³/сут. Безопасный максимум для пенообработки: ${(fpp * 0.9).toFixed(1)} МПа.`,
  };
}
