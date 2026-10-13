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
import { PUMPABLE_PILL_GEL_PA, assessPlugExchange, type PlugSupport } from "./cement-plug-exchange";
import { designPill, requiredPillGelPa, type PillDesign } from "./cement-plug-pill";
import { evaluatePlugComplications, type PlugComplicationParams } from "./cement-plug-complication-eval";
import type { LabTargets } from "./cement-recipe-designer";
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
  /** Рецептура нижней пачки (для вариантов с пачкой) */
  pillDesign: PillDesign | null;
  /** Ожидаемое опускание кровли с учётом обмена и осложнений, м */
  expectedTopDropM: number;
  /** Кратко: рецептура цемента */
  recipeSummary: string;
}

export interface AutoDesignResult {
  best: PlugCandidate | null;
  alternatives: PlugCandidate[];
  evaluated: number;
  notes: string[];
}

const SUPPORT_COST: Record<SupportOption, number> = { bottom: 0, none: 0, pill: 1, reactivePill: 2.5, mechanical: 4 };
const OK_VERDICTS = new Set(["supported", "no-buoyancy", "guaranteed", "stable", "settle"]);

export interface AutoDesignOptions {
  /** Осложнения (если включены) — учитываются в каждом варианте */
  complications?: PlugComplicationParams | null;
}

export function autoDesignPlug(base: PlugInputs, purpose: PlugPurpose, wocHours: number, fracGradientMPaPerM: number, opts: AutoDesignOptions = {}): AutoDesignResult {
  const req = getPlugRequirements(purpose, 0);
  const bottom = base.plug.bottomMD;
  const curLen = Math.max(0, base.plug.bottomMD - base.plug.topMD);
  const atBottom = bottom >= base.well.wellDepthMD - 1;
  const lMin = Math.max(req.minPlugLengthM, 10);
  const lengths = [...new Set([lMin, Math.max(lMin, curLen), lMin + 20, lMin + 50].map((x) => Math.round(x)))].sort((a, b) => a - b);
  const rho0 = base.cement.density;
  let densities = [...new Set([rho0, rho0 - 0.1, rho0 - 0.2, rho0 - 0.3].filter((x) => x >= 1.4).map((x) => Math.round(x * 100) / 100))];
  const supports: SupportOption[] = atBottom ? ["bottom"] : ["none", "pill", "reactivePill", "mechanical"];
  const notes: string[] = [];
  const compl = opts.complications ?? null;

  // Осложнения: проявление задаёт минимальную плотность цемента
  if (compl) {
    const probe0 = calculateBalancedPlug(base);
    const e0 = evaluatePlugComplications(base, probe0, compl);
    if (e0.requiredCementDensity && e0.requiredCementDensity > Math.min(...densities)) {
      const need = Math.ceil(e0.requiredCementDensity * 100) / 100;
      densities = [...new Set([...densities.filter((d) => d >= need), need, need + 0.05].map((x) => Math.round(x * 100) / 100))];
      notes.push(`Проявление: рассмотрены только плотности цемента ≥ ${need.toFixed(2)} г/см³ (удержание пласта).`);
    }
  }
  const complTargets: LabTargets = compl
    ? { ...((compl.type === "loss" || compl.type === "both") && compl.lossRate > 0 ? { fiber: true } : {}), ...((compl.type === "kick" || compl.type === "both") && compl.fluidType === "gas" ? { gasTight: true } : {}) }
    : {};

  const cands: PlugCandidate[] = [];
  for (const rho of densities) for (const sup of supports) for (const L of lengths) {
    const top = Math.max(0, bottom - L);
    const probe = calculateBalancedPlug({ ...base, plug: { topMD: top, bottomMD: bottom }, cement: { ...base.cement, density: rho }, useViscousPad: false, spacerVolumeBelowM3: 0, support: atBottom ? "bottom" : "fluid" });
    const usePill = sup === "pill" || sup === "reactivePill";
    const boreA = (Math.PI / 4) * (probe.boreDiamUsed / 1000) ** 2;
    const pillVol = usePill ? Math.round(boreA * 40 * 100) / 100 : 0;
    const pillDensity = base.wellFluid.density;
    const strictGel = requiredPillGelPa({ cementDensity: rho, boreDiameterMm: probe.boreDiamUsed, zenithDeg: probe.plugZenithDeg, pillDensity });
    let pillGel = 0;
    if (sup === "pill") {
      // Обычная пачка: минимальный СНС, при котором кровля опускается не более чем на 5% длины моста
      const allow = Math.max(1, 0.05 * L);
      const ok = [15, 20, 25, 30, 40, 50, 60].find((g) => {
        const ex = assessPlugExchange({ ...probe.exchangeInput, below: { name: "пачка", density: pillDensity, gel10s: g, gel10min: g * 1.5, yp: g * 0.6 }, belowPad: { name: "раствор", density: base.wellFluid.density, gel10s: base.wellFluid.gel10sec, gel10min: base.wellFluid.gel10min, yp: base.wellFluid.rheology.yp } });
        return OK_VERDICTS.has(ex.verdict) && (ex.interfaces[0]?.topDropM ?? 0) <= allow;
      });
      if (ok === undefined) continue;
      pillGel = ok;
    }
    // Реактивные/сшитые пачки дают СНС в сотни Па; выше ~250 Па — только механическая опора
    if (sup === "reactivePill") { if (strictGel <= PUMPABLE_PILL_GEL_PA || strictGel > 250) continue; pillGel = strictGel; }
    const pillDesign = usePill ? designPill(pillGel, pillDensity, probe.temperatures?.bhctC ?? 60, pillVol) : null;
    const supportMode: PlugSupport = sup === "bottom" ? "bottom" : sup === "mechanical" ? "mechanical" : "fluid";
    let inputs: PlugInputs = {
      ...base,
      plug: { topMD: top, bottomMD: bottom },
      cement: { ...base.cement, density: rho },
      useViscousPad: usePill,
      spacerVolumeBelowM3: pillVol,
      viscousPadFluid: pillDesign ? {
        name: pillDesign.type === "bentonitePolymer" ? "Вязкая пачка (бентонит-полимер)" : pillDesign.type === "mmh" ? "Вязкая пачка (ММГ)" : "Реактивная пачка",
        density: pillDesign.densityGcm3, rheology: { pv: pillDesign.predicted.pv, yp: pillDesign.predicted.yp },
        gel10sec: pillDesign.predicted.gel10s, gel10min: pillDesign.predicted.gel10min,
      } : undefined,
      padPullUpAboveM: base.padPullUpAboveM ?? 5,
      support: supportMode,
      underDisplacementM3: probe.recommendedUnderDisplacementM3,
      contaminationExcessPct: probe.isOpenHole ? 20 : 10,
    };
    let r = calculateBalancedPlug(inputs);
    const reasons: string[] = [];
    let complDrop = 0;
    if (compl) {
      let e = evaluatePlugComplications(inputs, r, compl);
      // Компенсация потерь цемента объёмом
      if (e.active && e.correctedCementVolumeM3 > r.cementVolumeTotal + 0.01) {
        const need = Math.ceil(((e.correctedCementVolumeM3 / Math.max(1e-6, r.cementVolumeDesign)) - 1) * 100);
        inputs = { ...inputs, contaminationExcessPct: Math.min(100, Math.max(inputs.contaminationExcessPct ?? 0, need)) };
        r = calculateBalancedPlug(inputs);
        e = evaluatePlugComplications(inputs, r, compl);
      }
      if (e.reachesLossZone) reasons.push("осложнения: мост уходит в зону поглощения");
      if (e.kickBreakThrough) reasons.push("осложнения: проявление прорывает мост");
      if (e.active && e.realLengthM < req.minPlugLengthM) reasons.push(`осложнения: длина после потерь ${e.realLengthM.toFixed(0)} < ${req.minPlugLengthM} м`);
      complDrop = e.topDropM;
    }
    const rec = designPlugSlurry(inputs, r, purpose, wocHours, complTargets);
    const exOk = OK_VERDICTS.has(r.exchange.verdict);
    if (!exOk) reasons.push(`устойчивость: ${r.exchange.verdict === "unstable" ? "может уйти" : "риск осадки"}`);
    if (!rec.allOk) reasons.push(`рецептура: не выполнено ${rec.compliance.filter((c) => c.ok === false).map((c) => c.label.split(",")[0]).join(", ")}`);
    if (!r.isTimeSafe) reasons.push("время работы > 75% загустевания");
    if (L < req.minPlugLengthM) reasons.push(`длина < ${req.minPlugLengthM} м`);
    if (pillDesign && !pillDesign.meets) reasons.push("пачка: СНС не обеспечивается");
    const drop = Math.max(r.exchange.interfaces[0]?.topDropM ?? 0, complDrop);
    if (drop > 0.3 * L) reasons.push(`кровля опустится на ${drop.toFixed(0)} м (> 30% длины моста)`);
    const cost = SUPPORT_COST[sup] + Math.abs(rho - rho0) * 5 + (L - lMin) / 50 + (drop / Math.max(1, L)) * 4 + (pillGel > 30 ? 0.3 : 0);
    cands.push({
      densityGcm3: rho, lengthM: L, topMD: top, support: sup, pillGelPa: pillGel, pillVolumeM3: pillVol, pillDesign,
      underDisplacementM3: inputs.underDisplacementM3 ?? 0, excessPct: inputs.contaminationExcessPct ?? 0,
      feasible: reasons.length === 0, reasons, cost, exchangeVerdict: r.exchange.verdict, recipeOk: rec.allOk, expectedTopDropM: drop,
      recipeSummary: rec.design.components.filter((c) => c.role !== "defoamer").map((c) => `${c.name.split(" (")[0]} ${c.pctBwoc}%`).join(", "),
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
