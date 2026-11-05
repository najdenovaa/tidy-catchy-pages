import { describe, it, expect } from "vitest";
import { calculateRir, DEFAULT_RIR, type RirInputs } from "./rir-calculations";
import { designRirComposition } from "./rir-compositions";
import { planRir } from "./rir-autodesign";
import {
  createRirLab, recipeMass, recipeKey, evaluateRirLab, effectiveRirLab, buildRirLabProtocol,
} from "./rir-laboratory";
const cond = { bhctC: 48, bhstC: 60, requiredWorkLifeMin: 180, volumeM3: 3, targetDensity: 1.85 };
const ctx = { bhctC: 48, bhstC: 60, requiredMin: 180 };
function probe() {
  return createRirLab("cement", designRirComposition("cement", cond, 2)!.primary, ctx);
}
function tested(inp: RirInputs) {
  const r = calculateRir(inp);
  const c = { bhctC: r.temps.bhctC, bhstC: r.temps.bhstC, requiredMin: r.timing.requiredWorkLifeMin };
  const d = createRirLab("cement", designRirComposition("cement", { ...cond, bhctC: c.bhctC, bhstC: c.bhstC }, 2)!.primary, c);
  d.ingredients.forEach(x => { x.batch = "lot-2026"; });
  Object.assign(d, { protocol: "РИР-1", laboratory: "Лаборатория", operator: "Технолог", date: "2026-11-05", pressureMPa: 45 });
  Object.assign(d.facts, { density: 1.8, pv: 20, yp: 3, workLifeMin: 600 });
  d.testedKey = recipeKey(d); d.appliedKey = recipeKey(d);
  return d;
}
describe("Independent RIR recipe and laboratory", () => {
  it("creates a cement RIR recipe conserving absolute volume without invented test results", () => {
    const d = designRirComposition("cement", cond, 2)!.primary;
    expect(d.kind).toBe("cement");
    expect(d.components.reduce((s, x) => s + x.kgPerM3 / x.sg / 1000, d.waterLPerM3 / 1000)).toBeCloseTo(1, 10);
    expect(d.components.reduce((s, x) => s + x.kgPerM3, d.waterLPerM3)).toBeCloseTo(1850, 8);
    expect(d.workLifeSource).toBe("unknown");
    expect(d.thickeningCurve).toEqual([]);
    expect(d.strengthCurve).toEqual([]);
  });
  it("does not pass missing laboratory results or requirements", () => {
    const d = probe(), e = evaluateRirLab(d, ctx);
    expect(e.current).toBe(false);
    expect(e.usable).toBe(false);
    expect(e.checks.every(x => x.status === "unknown")).toBe(true);
  });
  it("normalizes mass parts and invalidates zero density ingredients", () => {
    const d = probe(), a = recipeMass(d);
    d.ingredients.forEach(x => { x.parts *= 3; });
    const b = recipeMass(d);
    expect(a.density).toBeCloseTo(b.density, 10);
    expect(a.rows[0].kgPerM3).toBeCloseTo(b.rows[0].kgPerM3, 10);
    d.ingredients[0].sg = 0;
    expect(recipeMass(d).valid).toBe(false);
  });
  it("applies measured density and rheology to RIR, not to bridges", () => {
    const i: RirInputs = { ...DEFAULT_RIR, composition: "cement" };
    const d = tested(i), inp = { ...i, laboratory: { cement: d } };
    const r = calculateRir(inp), plan = planRir(inp, r);
    expect(r.compositionDensity).toBe(1.8);
    expect(plan.comp!.primary.workLifeSource).toBe("laboratory");
    expect(plan.comp!.primary.props[0].value).toContain("20");
    expect(plan.comp!.primary.workLifeAtBhctMin).toBe(600);
    expect(plan.comp!.primary.workLifeCurve).toEqual([]);
  });
  it("invalidates applied measurements after recipe, material lot, composition or temperature changes", () => {
    const i: RirInputs = { ...DEFAULT_RIR, composition: "cement" }, d = tested(i);
    const r = calculateRir(i), inp = { ...i, laboratory: { cement: d } };
    expect(effectiveRirLab(inp, r.temps.bhctC, r.temps.bhstC)).not.toBeNull();
    expect(effectiveRirLab(inp, r.temps.bhctC + 3, r.temps.bhstC)).toBeNull();
    expect(effectiveRirLab({ ...inp, composition: "microcement" }, r.temps.bhctC, r.temps.bhstC)).toBeNull();
    d.ingredients[0].batch = "different";
    expect(effectiveRirLab(inp, r.temps.bhctC, r.temps.bhstC)).toBeNull();
    expect(calculateRir(inp).compositionDensity).toBe(1.85);
  });
  it("keeps negative slot results and does not treat a water injectivity test as cement passage", () => {
    const i: RirInputs = { ...DEFAULT_RIR, composition: "cement" }, d = tested(i), r = calculateRir(i);
    Object.assign(d.facts, { slotUm: 100, slotDpMPa: 3, slotVolumeMl: 10, slotTimeMin: 5 });
    d.slotResult = "fail";
    const e = evaluateRirLab(d, { bhctC: r.temps.bhctC, bhstC: r.temps.bhstC, requiredMin: 100 });
    expect(e.checks.find(x => x.label === "Проходимость в щели")!.status).toBe("fail");
    const protocol = JSON.stringify(buildRirLabProtocol(d, { bhctC: r.temps.bhctC, bhstC: r.temps.bhstC, requiredMin: 100 }, 3));
    expect(protocol).toContain("не соответствует");
    expect(protocol).toContain("ПРОТОКОЛ ПОДБОРА СОСТАВА РИР");
  });
  it("does not reuse one homogeneous test for a two-phase resin and microcement job", () => {
    const i: RirInputs = { ...DEFAULT_RIR, composition: "cement" }, d = tested(i), r = calculateRir(i);
    expect(effectiveRirLab({ ...i, composition: "resin_micro", laboratory: { resin_micro: d } }, r.temps.bhctC, r.temps.bhstC)).toBeNull();
  });
});
