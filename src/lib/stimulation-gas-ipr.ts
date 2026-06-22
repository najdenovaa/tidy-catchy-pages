/**
 * Газовый IPR (Rawlins-Schellhardt / Darcy radial) + газовые повреждения.
 *
 * Применяется для газовых и газоконденсатных скважин:
 *   q_g = (k · h · (P_r² − P_wf²)) / (1422 · μ_g · Z · T · (ln(r_e/r_w) + S))
 *
 * Размерности (метрические/полевые гибрид, как принято в ОПЗ-расчётах РФ):
 *   k — мД, h — м, P — МПа, T — K, μ_g — сПз → q_g [тыс.м³/сут].
 *
 * Вспомогательные:
 *   • Z-фактор по Papay (быстрая корреляция, ±3% для P_pr < 15)
 *   • Вязкость газа по Lee et al. (1966)
 *   • Не-Дарси скин: D = β · ρ · q / (μ · h) → S_total = S + D·q
 */

export type WellFluidType = "oil" | "gas" | "gas_condensate" | "water_injector";

export interface GasIPRInput {
  reservoirPressureMPa: number;   // Pr
  reservoirTempC: number;         // T_R
  permeability_mD: number;        // k
  netPayM: number;                // h
  drainageRadiusM: number;        // re (≈ 250 м по умолчанию)
  wellboreRadiusM: number;        // rw
  skin: number;                   // механический скин
  gasGravity: number;             // γ_g (воздух=1), 0.55..0.9
  /** Если не задан — считается по Papay. */
  zFactor?: number;
  /** Не-Дарси коэф. D, 1/(тыс.м³/сут). Если undefined — оценивается по проницаемости. */
  nonDarcyD?: number;
}

export interface GasIPRPoint {
  pwf: number;        // МПа
  qGas: number;       // тыс.м³/сут (Mcm/d)
}

export interface GasIPRResult {
  iprCurve: GasIPRPoint[];
  /** Absolute Open Flow при Pwf = 0.1 МПа (атмосфера). */
  aofMcmd: number;
  gasViscosityCP: number;
  zFactor: number;
  /** Псевдо-критические параметры (Sutton). */
  ppc: number;        // МПа
  tpc: number;        // K
  /** Не-Дарси доп. скин на AOF (показывает турбулентность). */
  nonDarcySkinAtAOF: number;
}

/* ── Псевдо-критические по Sutton (для природного газа) ─────────────── */
function suttonPseudoCritical(gravity: number): { ppc: number; tpc: number } {
  // Sutton, 1985: ppc [psia], tpc [°R]
  const ppc_psia = 756.8 - 131.0 * gravity - 3.6 * gravity * gravity;
  const tpc_R = 169.2 + 349.5 * gravity - 74.0 * gravity * gravity;
  return { ppc: ppc_psia * 0.00689476, tpc: tpc_R / 1.8 };  // → МПа, K
}

/* ── Z-фактор по Papay (1968) ───────────────────────────────────────── */
export function zFactorPapay(pressureMPa: number, tempK: number, gravity: number): number {
  const { ppc, tpc } = suttonPseudoCritical(gravity);
  const ppr = pressureMPa / ppc;
  const tpr = tempK / tpc;
  // Papay: Z = 1 - 3.52·Ppr/10^(0.9813·Tpr) + 0.274·Ppr²/10^(0.8157·Tpr)
  const z =
    1 -
    (3.52 * ppr) / Math.pow(10, 0.9813 * tpr) +
    (0.274 * ppr * ppr) / Math.pow(10, 0.8157 * tpr);
  return Math.max(0.3, Math.min(1.3, z));
}

/* ── Вязкость газа по Lee, Gonzalez, Eakin (1966), сПз ─────────────── */
export function gasViscosityLee(
  pressureMPa: number,
  tempK: number,
  gravity: number,
  zFactor: number,
): number {
  const M = 28.97 * gravity;                       // г/моль
  // ρ_g = P·M / (Z·R·T); в г/см³
  const R = 8.3144;                                // Дж/(моль·К)
  const rho_kgm3 = (pressureMPa * 1e6 * M * 1e-3) / (zFactor * R * tempK);
  const rho = rho_kgm3 / 1000;                     // г/см³

  const T_R = tempK * 1.8;                         // °R
  const K = ((9.4 + 0.02 * M) * Math.pow(T_R, 1.5)) / (209 + 19 * M + T_R);
  const X = 3.5 + 986 / T_R + 0.01 * M;
  const Y = 2.4 - 0.2 * X;
  const muMicroP = K * Math.exp(X * Math.pow(rho, Y));   // мкПз
  return muMicroP * 1e-4;                                // → сПз
}

/* ── Не-Дарси коэффициент D по корреляции Jones (1987) ──────────────── */
function estimateNonDarcyD(k_mD: number, h_m: number, gravity: number): number {
  // β [1/м] ≈ 1.88·10^10 · k^(-1.47) · φ^(-0.53)
  // q [тыс.м³/сут] → коэффициент D пересчитан эмпирически
  // Упрощённо: D ≈ 6e-5 · γg / (h · k^0.5) — даёт реалистичные доли для k=1..1000 мД
  return (6e-5 * gravity) / (Math.max(1, h_m) * Math.sqrt(Math.max(0.1, k_mD)));
}

/* ── Главный расчёт ────────────────────────────────────────────────── */
export function calculateGasIPR(input: GasIPRInput): GasIPRResult {
  const {
    reservoirPressureMPa: Pr,
    reservoirTempC,
    permeability_mD: k,
    netPayM: h,
    drainageRadiusM: re,
    wellboreRadiusM: rw,
    skin,
    gasGravity,
  } = input;

  const T = reservoirTempC + 273.15;
  const { ppc, tpc } = suttonPseudoCritical(gasGravity);
  const z = input.zFactor ?? zFactorPapay(Pr * 0.7, T, gasGravity); // средн. пластов.
  const mu_g = gasViscosityLee(Pr * 0.7, T, gasGravity, z);
  const D = input.nonDarcyD ?? estimateNonDarcyD(k, h, gasGravity);
  const lnRatio = Math.log(re / rw);

  // Метрическая форма уравнения газовой радиальной фильтрации.
  // Константа 1422 — из псевдо-давления для (P²)-формы при q [Mcm/d], k [мД], P [МПа], T [K].
  const denom0 = 1422 * mu_g * z * T * (lnRatio + skin);

  // Решаем неявно: q = (k·h·(Pr²−Pwf²)) / (1422·μ·Z·T·(lnR + S + D·q))
  function solveQ(pwf: number): number {
    const num = k * h * (Pr * Pr - pwf * pwf);
    if (num <= 0) return 0;
    // итерации с не-Дарси скином
    let q = num / denom0;
    for (let i = 0; i < 8; i++) {
      const denom = 1422 * mu_g * z * T * (lnRatio + skin + D * q);
      q = num / denom;
      if (!isFinite(q) || q < 0) return 0;
    }
    return q;
  }

  const iprCurve: GasIPRPoint[] = [];
  for (let i = 0; i <= 20; i++) {
    const pwf = (i / 20) * Pr;
    iprCurve.push({ pwf, qGas: solveQ(pwf) });
  }

  const aofMcmd = solveQ(0.1);
  const nonDarcySkinAtAOF = D * aofMcmd;

  return {
    iprCurve: iprCurve.reverse(), // от Pr → 0
    aofMcmd,
    gasViscosityCP: mu_g,
    zFactor: z,
    ppc,
    tpc,
    nonDarcySkinAtAOF,
  };
}

/* ── Газовые механизмы повреждения ──────────────────────────────────── */

export type GasDamageMechanism =
  | "condensate_banking"
  | "water_block_gas"
  | "non_darcy_turbulence"
  | "liquid_loading";

export interface GasDamage {
  mechanism: GasDamageMechanism;
  nameRu: string;
  probability: number;
  severity: "low" | "medium" | "high";
  evidence: string;
  recommendedTreatment: string;
}

export interface GasDamageInput {
  fluidType: WellFluidType;
  reservoirPressureMPa: number;
  bottomholePressureMPa?: number;
  dewPointMPa?: number;          // для газоконденсата
  condensateGasRatio?: number;   // см³/м³
  waterCutPct: number;
  permeability_mD: number;
  aofMcmd: number;
  currentRateMcmd: number;
  nonDarcySkinAtAOF: number;
}

export function diagnoseGasDamage(input: GasDamageInput): GasDamage[] {
  const out: GasDamage[] = [];
  if (input.fluidType !== "gas" && input.fluidType !== "gas_condensate") return out;

  // 1) Конденсатная пробка (P_wf < P_dew)
  if (input.fluidType === "gas_condensate" && input.dewPointMPa) {
    const pwf = input.bottomholePressureMPa ?? input.reservoirPressureMPa * 0.6;
    if (pwf < input.dewPointMPa) {
      const delta = input.dewPointMPa - pwf;
      out.push({
        mechanism: "condensate_banking",
        nameRu: "Конденсатная пробка",
        probability: Math.min(0.95, 0.5 + 0.05 * delta),
        severity: delta > 5 ? "high" : delta > 2 ? "medium" : "low",
        evidence: `P_wf ${pwf.toFixed(1)} МПа < P_рос ${input.dewPointMPa.toFixed(1)} МПа (ΔP=${delta.toFixed(1)} МПа). КГФ ${input.condensateGasRatio ?? "—"} см³/м³`,
        recommendedTreatment:
          "Метанол / газоконденсатный растворитель + ПАВ-гидрофобизатор. Поддержание P_wf > P_росы режимом эксплуатации.",
      });
    }
  }

  // 2) Водяная блокада газа (капиллярное запирание)
  if (input.waterCutPct > 5 && input.permeability_mD < 30) {
    out.push({
      mechanism: "water_block_gas",
      nameRu: "Водяная блокада газа",
      probability: Math.min(0.9, 0.4 + 0.01 * input.waterCutPct + (input.permeability_mD < 10 ? 0.2 : 0)),
      severity: input.waterCutPct > 20 ? "high" : "medium",
      evidence: `Влагосодержание ${input.waterCutPct.toFixed(0)}%, k=${input.permeability_mD} мД — капиллярное запирание газа в поровых каналах.`,
      recommendedTreatment:
        "ПАВ-десорбент (фторированные/силиконовые) + гидрофобизация ПЗП. Метанол как ингибитор гидратов.",
    });
  }

  // 3) Не-Дарси турбулентность (D·q становится сравним со скином)
  if (input.nonDarcySkinAtAOF > 1.5 && input.currentRateMcmd > 0.5 * input.aofMcmd) {
    out.push({
      mechanism: "non_darcy_turbulence",
      nameRu: "Не-Дарси (турбулентный) скин",
      probability: Math.min(0.9, 0.4 + 0.15 * input.nonDarcySkinAtAOF),
      severity: input.nonDarcySkinAtAOF > 4 ? "high" : "medium",
      evidence: `Доп. скин турбулентности на AOF = ${input.nonDarcySkinAtAOF.toFixed(1)}. Текущий режим ${(100 * input.currentRateMcmd / Math.max(0.01, input.aofMcmd)).toFixed(0)}% от AOF.`,
      recommendedTreatment:
        "Увеличить площадь притока (доперф/ГРП), снизить рабочий депрессии, проппант с улучшенной проводимостью.",
    });
  }

  // 4) Жидкостная нагрузка (low rate gas wells)
  if (input.currentRateMcmd > 0 && input.currentRateMcmd < 0.2 * input.aofMcmd && input.waterCutPct > 0) {
    out.push({
      mechanism: "liquid_loading",
      nameRu: "Жидкостная нагрузка (loading)",
      probability: 0.65,
      severity: "medium",
      evidence: `Q_газ ${input.currentRateMcmd.toFixed(1)} тыс.м³/сут << AOF ${input.aofMcmd.toFixed(1)} тыс.м³/сут — скорость газа ниже критической по Тёрнеру.`,
      recommendedTreatment:
        "ПАВ-плунжер / пенообразующие палочки, оптимизация НКТ, газлифт, периодические продувки.",
    });
  }

  return out.sort((a, b) => b.probability - a.probability);
}

export const WELL_FLUID_LABEL: Record<WellFluidType, string> = {
  oil: "Нефтяная",
  gas: "Газовая",
  gas_condensate: "Газоконденсатная",
  water_injector: "Нагнетательная (вода)",
};
