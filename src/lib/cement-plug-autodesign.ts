/**
 * Автоподбор конструкции цементного моста поверх исправленных моделей:
 * равновесие с недопродавкой, устойчивость против обмена жидкостями, рецептура под назначение,
 * давления при закачке (ГРП) и безопасное время.
 *
 * Перебор: плотность цемента × опора (без пачки / вязкая пачка с нужным СНС / механическая опора)
 * × длина моста. Из допустимых вариантов выбирается самый простой в исполнении
 * (обычная пачка проще реактивной, обе проще механической опоры; меньше отклонение от проекта).
 */
import { calculateBalancedPlug, type PlugInputs, type PlugResults } from "./cement-plug-calculations";
import { PUMPABLE_PILL_GEL_PA, yieldNumberCriticalExp, type PlugSupport } from "./cement-plug-exchange";
import { simulatePlugPressures } from "./cement-plug-pressure-sim";
import { designPlugSlurry } from "./cement-plug-recipe";
import { getPlugRequirements, type PlugPurpose } from "./cement-plug-types";

export type SupportOption = "none" | "pill" | "reactivePill" | "mechanical" | "bottom";

export const SUPPORT_OPTION_LABEL: Record<SupportOption, string> = {
  none: "без опоры (на растворе)",
  pill: "вязкая пачка",
  reactivePill: "реактивная / сшитая пачка",
  mechanical: "механическая опора",
  bottom: "на забой",
};

export interface PlugCandidate {
  densityGcm3: number;
  lengthM: number;
  topMD: number;
  support: SupportOption;
  /** СНС пачки под мостом (10 с, сразу после остановки), Па; 10 мин — ≥ 1,3× */
  pillGelPa: number;
  pillVolumeM3: number;
  underDisplacementM3: number;
  excessPct: number;
  feasible: boolean;
  reasons: string[];
  cost: number;
  exchangeVerdict: string;
  recipeOk: boolean;
  maxBhpMPa: number | null;
  fracMPa: number;
  timeSafe: boolean;
  /** Входные данные варианта — для применения */
  inputs: PlugInputs;
}

export interface AutoDesignResult {
  best: PlugCandidate | null;
  alternatives: PlugCandidate[];
  evaluated: number;
  notes: string[];
}

const SUPPORT_COST: Record<SupportOption, number> = { bottom: 0, none: 0, pill: 1, reactivePill: 2.5, mechanical: 4 };
const OK_VERDICTS = new Set(["supported", "no-buoyancy", "guaranteed", "stable"]);

export function autoDesignPlug(base: PlugInputs, purpose: PlugPurpose, wocHours: number, fracGradientMPaPerM: number): AutoDesignResult {
  const req = getPlugRequirements(purpose, 0);
  const bottom = base.plug.bottomMD;
  const curLen = Math.max(0, base.plug.bottomMD - base.plug.topMD);
  const atBottom = bottom >= base.well.wellDepthMD - 1;
  const lMin = Math.max(req.minPlugLengthM, 10);
  const lengths = [...new Set([lMin, Math.max(lMin, curLen), lMin + 20, lMin + 50].map((x) => Math.round(x)))].sort((a, b) => a - b);
  const rho0 = base.cement.density;
  const densities = [...new Set([rho0, rho0 - 0.1, rho0 - 0.2, rho0 - 0.3].filter((x) => x >= 1.4).map((x) => Math.round(x * 100) / 100))];
  const supports: SupportOption[] = atBottom ? ["bottom"] : ["none", "pill", "reactivePill", "mechanical"];
  const notes: string[] = [];

  const cands: PlugCandidate[] = [];
  for (const rho of densities) for (const sup of supports) for (const L of lengths) {
    const top = Math.max(0, bottom - L);
    const probe = calculateBalancedPlug({ ...base, plug: { topMD: top, bottomMD: bottom }, cement: { ...base.cement, density: rho }, useViscousPad: false, spacerVolumeBelowM3: 0, support: atBottom ? "bottom" : "fluid" });
    const R = probe.boreDiamUsed / 2000;
    const dRho = (rho - base.wellFluid.density) * 1000;
    const needGel = Math.max(0, yieldNumberCriticalExp(probe.plugZenithDeg) * dRho * 9.81 * R * 1.2);
    let pillGel = 0;
    if (sup === "pill") { if (needGel > PUMPABLE_PILL_GEL_PA) continue; pillGel = Math.ceil(needGel); }
    // Реактивные/сшитые пачки (силикатные, полимер-сшитые) дают СНС в сотни Па; выше ~250 Па — только механическая опора
    if (sup === "reactivePill") { if (needGel <= PUMPABLE_PILL_GEL_PA || needGel > 250) continue; pillGel = Math.ceil(needGel); }
    const usePill = sup === "pill" || sup === "reactivePill";
    const boreA = (Math.PI / 4) * (probe.boreDiamUsed / 1000) ** 2;
    const pillVol = usePill ? Math.round(boreA * 40 * 100) / 100 : 0;
    const supportMode: PlugSupport = sup === "bottom" ? "bottom" : sup === "mechanical" ? "mechanical" : "fluid";
    const inputs: PlugInputs = {
      ...base,
      plug: { topMD: top, bottomMD: bottom },
      cement: { ...base.cement, density: rho },
      useViscousPad: usePill,
      spacerVolumeBelowM3: pillVol,
      viscousPadFluid: usePill ? {
        name: sup === "reactivePill" ? "Реактивная пачка" : "Вязкая пачка",
        density: base.wellFluid.density,
        rheology: { pv: 30, yp: Math.max(10, pillGel * 0.4) },
        gel10sec: pillGel, gel10min: Math.round(pillGel * 1.3),
      } : undefined,
      padPullUpAboveM: base.padPullUpAboveM ?? 5,
      support: supportMode,
      underDisplacementM3: probe.recommendedUnderDisplacementM3,
      contaminationExcessPct: probe.isOpenHole ? 20 : 10,
    };
    const r = calculateBalancedPlug(inputs);
    const rec = designPlugSlurry(inputs, r, purpose, wocHours);
    const reasons: string[] = [];
    const exOk = OK_VERDICTS.has(r.exchange.verdict);
    if (!exOk) reasons.push(`устойчивость: ${r.exchange.verdict === "unstable" ? "неустойчив" : "риск обмена"}`);
    if (!rec.allOk) reasons.push(`рецептура: не выполнено ${rec.compliance.filter((c) => c.ok === false).map((c) => c.label.split(",")[0]).join(", ")}`);
    if (!r.isTimeSafe) reasons.push("время работы > 75% загустевания");
    if (L < req.minPlugLengthM) reasons.push(`длина < ${req.minPlugLengthM} м`);
    const cost = SUPPORT_COST[sup] + Math.abs(rho - rho0) * 5 + (L - lMin) / 50 + (r.exchange.verdict === "stable" ? 0.3 : 0);
    cands.push({
      densityGcm3: rho, lengthM: L, topMD: top, support: sup, pillGelPa: pillGel, pillVolumeM3: pillVol,
      underDisplacementM3: inputs.underDisplacementM3 ?? 0, excessPct: inputs.contaminationExcessPct ?? 0,
      feasible: reasons.length === 0, reasons, cost, exchangeVerdict: r.exchange.verdict, recipeOk: rec.allOk,
      maxBhpMPa: null, fracMPa: fracGradientMPaPerM * r.plugBottomTVD, timeSafe: r.isTimeSafe, inputs,
    });
  }

  // Давления — только для лучших допустимых (расчёт закачки дороже)
  const ranked = cands.filter((c) => c.feasible).sort((a, b) => a.cost - b.cost);
  const checked: PlugCandidate[] = [];
  for (const c of ranked) {
    if (checked.length >= 6) break;
    const r: PlugResults = calculateBalancedPlug(c.inputs);
    const pts = simulatePlugPressures(c.inputs, r, fracGradientMPaPerM);
    c.maxBhpMPa = pts.reduce((m, p) => Math.max(m, p.bhpMPa), 0);
    if (fracGradientMPaPerM > 0 && c.maxBhpMPa > c.fracMPa) { c.feasible = false; c.reasons.push(`давление на забое ${c.maxBhpMPa.toFixed(1)} > ГРП ${c.fracMPa.toFixed(1)} МПа`); continue; }
    checked.push(c);
  }
  // Механическую опору всегда показываем как надёжную альтернативу
  if (!checked.some((c) => c.support === "mechanical")) {
    const m = ranked.find((c) => c.support === "mechanical" && c.feasible);
    if (m) {
      const pts = simulatePlugPressures(m.inputs, calculateBalancedPlug(m.inputs), fracGradientMPaPerM);
      m.maxBhpMPa = pts.reduce((x, p) => Math.max(x, p.bhpMPa), 0);
      if (!(fracGradientMPaPerM > 0 && m.maxBhpMPa > m.fracMPa)) checked.push(m);
    }
  }
  const best = checked[0] ?? null;
  if (!best) {
    notes.push("Допустимого варианта не найдено: проверьте время загустевания, производительность насосов, градиент ГРП или требования к прочности.");
  }
  const seen = new Set<string>();
  const alternatives = [...checked.slice(1), ...cands.filter((c) => !c.feasible).sort((a, b) => a.reasons.length - b.reasons.length || a.cost - b.cost)]
    .filter((c) => { const k = `${c.support}|${c.densityGcm3}`; if (seen.has(k) || (best && k === `${best.support}|${best.densityGcm3}`)) return false; seen.add(k); return true; })
    .slice(0, 6);
  const noneOk = cands.some((c) => c.support === "none" && c.feasible);
  if (!atBottom && !noneOk) notes.push("Без опоры мост на растворе неустойчив при всех рассмотренных плотностях — нужна пачка под мостом или механическая опора.");
  return { best, alternatives, evaluated: cands.length, notes };
}
