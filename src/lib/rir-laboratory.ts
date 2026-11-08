import { materialLabel, type ProductIdentity } from "./cement-product-catalog";
/** RIR-specific recipe and measured tests. A measured value never comes from a forecast. */
import type { CompositionDesign, RirCompositionResult } from "./rir-compositions";
import type { CompositionKind, RirInputs } from "./rir-calculations";
import type { LabProtocol, ProtocolSection } from "./lab-protocol";

export interface RirLabIngredient extends ProductIdentity {
  name: string; batch: string; role: string;
  /** Mass parts, same arbitrary basis for every ingredient, including water. */
  parts: number; sg: number; sgAssumed?: boolean;
}
export interface RirLabFacts {
  density: number | null; pv: number | null; yp: number | null;
  workLifeMin: number | null; fluidLossMl: number | null;
  freeWaterPct: number | null; strengthMPa: number | null;
  strengthAgeH: number | null; sedimentationDelta: number | null;
  slotUm: number | null; slotDpMPa: number | null; slotVolumeMl: number | null;
  slotTimeMin: number | null;
}
export interface RirLabDraft {
  kind: CompositionKind;
  title: string;
  ingredients: RirLabIngredient[];
  reservePct: number; sampleVolumeL: number;
  protocol: string; laboratory: string; operator: string; date: string;
  bhctC: number; bhstC: number; pressureMPa: number | null;
  facts: RirLabFacts;
  targets: { fluidLossMax: number | null; freeWaterMax: number | null;
    strengthMin: number | null; strengthAgeH: number | null; sedimentationMax: number | null };
  compatibility: "unknown" | "pass" | "fail";
  slotResult: "unknown" | "pass" | "fail";
  notes: string;
  /** Explicit links to recipe + material lots + laboratory conditions. */
  testedKey?: string; appliedKey?: string;
}
export type RirLabStore = Partial<Record<CompositionKind, RirLabDraft>>;
export interface RirLabContext { bhctC: number; bhstC: number; requiredMin: number; pressureMPa?: number; }
const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const positive = (v: number | null | undefined): v is number => finite(v) && v > 0;
const fmt = (v: number | null | undefined, d = 2) => finite(v) ? v.toFixed(d) : "не задано";
export function recipeMass(d: RirLabDraft) {
  const valid = d.ingredients.length > 0 && d.ingredients.every(x =>
    x.name.trim() && positive(x.parts) && positive(x.sg));
  const mass = d.ingredients.reduce((s, x) => s + x.parts, 0);
  const litres = d.ingredients.reduce((s, x) => s + x.parts / x.sg, 0);
  return { valid: !!valid && positive(litres), density: valid ? mass / litres : NaN,
    rows: d.ingredients.map(x => ({ ...x, kgPerM3: valid ? x.parts * 1000 / litres : NaN })) };
}
export function recipeKey(d: RirLabDraft): string {
  return JSON.stringify([d.kind, d.ingredients.map(x => {
    const base = [x.name, x.batch, x.role, x.parts, x.sg];
    const identity = [x.productId, x.manufacturer, x.technicalSpec, x.sourceUrl, x.sgAssumed];
    // Preserve fingerprints of saved pre-catalog laboratory records with no product identity.
    return identity.some(v => v !== undefined && v !== false) ? [...base, ...identity] : base;
  }),
    d.bhctC, d.bhstC, d.pressureMPa]);
}
export function createRirLab(kind: CompositionKind, design: CompositionDesign, c: RirLabContext): RirLabDraft {
  return {
    kind, title: design.title, ingredients: [
      ...design.components.map(x => ({ name: x.name, batch: "", role: x.role, parts: x.kgPerM3, sg: x.sg })),
      ...(design.waterLPerM3 > 0 ? [{ name: "Вода затворения", batch: "", role: "water", parts: design.waterLPerM3, sg: 1 }] : []),
    ], reservePct: 5, sampleVolumeL: 1, protocol: "", laboratory: "", operator: "", date: "",
    bhctC: c.bhctC, bhstC: c.bhstC, pressureMPa: null,
    facts: { density: null, pv: null, yp: null, workLifeMin: null, fluidLossMl: null,
      freeWaterPct: null, strengthMPa: null, strengthAgeH: null, sedimentationDelta: null,
      slotUm: null, slotDpMPa: null, slotVolumeMl: null, slotTimeMin: null },
    targets: { fluidLossMax: null, freeWaterMax: null, strengthMin: null,
      strengthAgeH: null, sedimentationMax: null },
    compatibility: "unknown", slotResult: "unknown", notes: "",
  };
}
export function evaluateRirLab(d: RirLabDraft, c: RirLabContext) {
  const mass = recipeMass(d), key = recipeKey(d);
  const bound = d.testedKey === key;
  const conditions = Math.abs(d.bhctC - c.bhctC) <= 2 && Math.abs(d.bhstC - c.bhstC) <= 2;
  const identity = !!(d.protocol.trim() && d.laboratory.trim() && d.operator.trim() && d.date
    && d.ingredients.every(x => x.batch.trim() && !x.sgAssumed));
  const current = bound && conditions && identity;
  type Check = { label: string; status: "pass" | "fail" | "unknown"; actual: string; target: string };
  const checks: Check[] = [];
  const check = (label: string, v: number | null, target: number | null, max = true) => {
    checks.push({ label, actual: fmt(v), target: target === null ? "по программе испытаний" : (max ? "≤ " : "≥ ") + fmt(target),
      status: !current || !finite(v) || !finite(target) ? "unknown" : (max ? v <= target : v >= target) ? "pass" : "fail" });
  };
  check("Плотность, г/см³ (допуск к рецептуре 0,02)", d.facts.density, null);
  checks[0].target = fmt(mass.density) + " ± 0,02";
  checks[0].status = !current || !mass.valid || !positive(d.facts.density) ? "unknown" :
    Math.abs(d.facts.density - mass.density) <= 0.02 ? "pass" : "fail";
  check(d.kind === "resin" ? "Время жизни, мин" : "Загустевание до 70 Bc, мин", d.facts.workLifeMin, c.requiredMin, false);
  check("Водоотдача, мл/30 мин", d.facts.fluidLossMl, d.targets.fluidLossMax);
  check("Свободная вода, %", d.facts.freeWaterPct, d.targets.freeWaterMax);
  check("Седиментация: Δρ верх-низ, г/см³", d.facts.sedimentationDelta, d.targets.sedimentationMax);
  check("Прочность, МПа", d.facts.strengthMPa, d.targets.strengthMin, false);
  if (checks[5].status !== "unknown" && (!positive(d.targets.strengthAgeH) || d.facts.strengthAgeH !== d.targets.strengthAgeH))
    checks[5].status = "unknown";
  checks.push({ label: "Совместимость с водой, раствором и буфером", actual: d.compatibility,
    target: "нет осадка / загустевания по принятой методике",
    status: current ? d.compatibility : "unknown" });
  const slotDefined = positive(d.facts.slotUm) && positive(d.facts.slotDpMPa) &&
    positive(d.facts.slotVolumeMl) && positive(d.facts.slotTimeMin);
  checks.push({ label: "Проходимость в щели", actual: slotDefined ? fmt(d.facts.slotUm, 0) + " мкм" : "условия не заданы",
    target: "испытание на фактическом составе", status: current && slotDefined ? d.slotResult : "unknown" });
  const invalidFacts = Object.values(d.facts).some(v => v !== null && (!finite(v) || v < 0)) ||
    (d.facts.density !== null && !positive(d.facts.density)) ||
    (d.facts.workLifeMin !== null && !positive(d.facts.workLifeMin));
  const usable = current && mass.valid && !invalidFacts && positive(d.pressureMPa) &&
    (c.pressureMPa === undefined || d.pressureMPa >= c.pressureMPa) &&
    positive(d.facts.density) && positive(d.facts.pv) && positive(d.facts.workLifeMin);
  return { key, current, conditions, identity, mass, checks, usable,
    applied: usable && d.appliedKey === key,
    status: !current ? "Испытания не привязаны к текущей рецептуре и условиям" :
      checks.some(x => x.status === "fail") ? "Есть несоответствия" :
      checks.some(x => x.status === "unknown") ? "Испытания заполнены частично" :
      "Заполненные испытания соответствуют заданным требованиям" };
}
/** Only a single homogeneous composition can calibrate the current one-fluid simulator. */
export function effectiveRirLab(inp: RirInputs, bhctC: number, bhstC: number) {
  if (inp.composition === "auto" || inp.composition === "resin_micro") return null;
  const d = inp.laboratory?.[inp.composition];
  if (!d || d.kind !== inp.composition) return null;
  const e = evaluateRirLab(d, { bhctC, bhstC, requiredMin: 0 });
  return e.applied ? d : null;
}
export function withRirLab(comp: RirCompositionResult | null, inp: RirInputs, c: RirLabContext) {
  if (!comp) return comp;
  const d = effectiveRirLab(inp, c.bhctC, c.bhstC);
  if (!d || !evaluateRirLab(d, c).applied) return comp;
  const m = recipeMass(d);
  return { ...comp, primary: { ...comp.primary, title: d.title || comp.primary.title,
    components: m.rows.filter(x => x.role !== "water").map(x => ({
      name: materialLabel(x), role: x.role, purpose: "Фактическая рецептура РИР",
      dose: x.parts, doseUnit: "масс. ч.", kgPerM3: x.kgPerM3, sg: x.sg })),
    waterLPerM3: m.rows.filter(x => x.role === "water").reduce((s, x) => s + x.kgPerM3 / x.sg, 0),
    densityGcm3: d.facts.density!, workLifeAtBhctMin: d.facts.workLifeMin!,
    workLifeSource: "laboratory" as const,
    props: [{ label: "ПВ / ДНС (факт), мПа·с / Па", value: d.facts.pv + " / " + (d.facts.yp ?? "не задано") },
      { label: "Протокол лаборатории", value: d.protocol },
      { label: "Плотность (факт), г/см³", value: String(d.facts.density) }],
    // A single laboratory endpoint does not define a measured curve.
    workLifeCurve: [], thickeningCurve: comp.primary.kind === "resin" ? [{ x: 0, y: d.facts.pv! }] : [],
    strengthCurve: positive(d.facts.strengthMPa) && positive(d.facts.strengthAgeH) ?
      [{ x: d.facts.strengthAgeH, y: d.facts.strengthMPa }] : [],
    notes: ["Измеренные плотность, ПВ и время жизни применены из протокола " + d.protocol,
      "Рост вязкости между измерениями остаётся сценарной моделью; единичные точки не являются кривой испытаний."],
  } };
}
export function rirLabSection(d: RirLabDraft, c: RirLabContext, volumeM3: number): ProtocolSection {
  const e = evaluateRirLab(d, c), factor = volumeM3 * (1 + d.reservePct / 100);
  return { id: "rir-lab-" + d.kind, title: "Лабораторные испытания состава РИР",
    paragraphs: [e.status, "Протокол: " + (d.protocol || "не задан") + "; лаборатория: " + d.laboratory +
      "; исполнитель: " + d.operator + "; дата: " + d.date,
      "BHCT / BHST: " + fmt(d.bhctC) + " / " + fmt(d.bhstC) + " °C; давление испытания: " + fmt(d.pressureMPa) + " МПа.",
      "Перенос измеренных свойств в расчёт: " + (e.applied ? "включён" : "не выполнен") +
      ". Проходимость в скважине и герметичность этим не подтверждены.", d.notes],
    tables: [
      { id: "rir-lab-rheology", headers: ["Измеренный показатель", "Факт"], rows: [
        ["ПВ / вязкость, мПа·с", fmt(d.facts.pv)], ["ДНС, Па", fmt(d.facts.yp)],
        ["Возраст прочности, ч", fmt(d.facts.strengthAgeH)],
        ["Запас приготовления, %", fmt(d.reservePct)], ["Объём лабораторной пробы, л", fmt(d.sampleVolumeL)],
      ] },
      { id: "rir-lab-recipe", headers: ["Компонент / партия", "Масс. части", "SG", "кг/м³", "На операцию с запасом, кг"],
        rows: e.mass.rows.map(x => [materialLabel(x), fmt(x.parts), fmt(x.sg) + (x.sgAssumed ? " (допущение)" : ""),
          fmt(x.kgPerM3), fmt(x.kgPerM3 * factor)]) },
      { id: "rir-lab-facts", headers: ["Испытание", "Факт", "Требование", "Статус"],
        rows: e.checks.map(x => [x.label, x.actual, x.target, x.status === "pass" ? "соответствует" : x.status === "fail" ? "не соответствует" : "не оценено"]) },
      { id: "rir-lab-slot", headers: ["Щель, мкм", "ΔP, МПа", "Прошло, мл", "Время, мин"],
        rows: [[fmt(d.facts.slotUm), fmt(d.facts.slotDpMPa), fmt(d.facts.slotVolumeMl), fmt(d.facts.slotTimeMin)]] },
    ] };
}
export function buildRirLabProtocol(d: RirLabDraft, c: RirLabContext, volumeM3: number): LabProtocol {
  return { version: 1, createdAt: new Date().toISOString(), title: "ПРОТОКОЛ ПОДБОРА СОСТАВА РИР",
    subtitle: d.title, meta: [{ label: "Номер", value: d.protocol }], status: "Рецептура и введённые результаты испытаний. Прогноз не является фактом.",
    sections: [rirLabSection(d, c, volumeM3)], signatures: [{ role: "Лаборант / инженер", name: d.operator }], slurryNames: [d.title] };
}
