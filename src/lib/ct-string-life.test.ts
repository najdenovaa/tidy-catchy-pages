import { describe, expect, it } from "vitest";
import { analyzeStringLife, cyclesToFailure, defaultPassport, reelLayerD } from "./ct-string-life";

const job = { depthM: 3000, pressureMPa: 0, env: "normal" as const };

describe("ГНКТ: ресурс по длине трубы", () => {
  it("калибровка: 1.5″ на дуге R 72″ без давления ≈ 1000 циклов; давление 0.43·Pразр снижает ресурс ~в 6 раз", () => {
    const n0 = cyclesToFailure(38.1 / (2 * 1828.8), 0, 100, 552);
    expect(n0).toBeGreaterThan(800);
    expect(n0).toBeLessThan(1300);
    const nP = cyclesToFailure(38.1 / (2 * 1828.8), 43, 100, 552);
    expect(n0 / nP).toBeGreaterThan(4);
    expect(n0 / nP).toBeLessThan(8);
  });
  it("слои барабана: у сердечника диаметр меньше — деформация больше", () => {
    expect(reelLayerD(10, 0.04445, 2.13, 1.7)).toBeLessThan(reelLayerD(4000, 0.04445, 2.13, 1.7));
  });
  it("рейсы повреждают только спускаемую часть; расхаживание даёт локальный пик", () => {
    const p = { ...defaultPassport(4500, 2.13), journal: [
      { id: "a", kind: "trip" as const, depthM: 2000, count: 20, pressureMPa: 20 },
      { id: "b", kind: "recip" as const, depthM: 1500, fromM: 1450, count: 30, pressureMPa: 20 },
    ] };
    const a = analyzeStringLife(p, 44.45, 3.4, "CT-80", job, 3150);
    const at = (x: number) => a.profile.reduce((b, q) => (Math.abs(q.pos - x) < Math.abs(b.pos - x) ? q : b)).damagePct;
    expect(at(2500)).toBe(0);
    expect(at(1000)).toBeGreaterThan(0);
    expect(at(1475)).toBeGreaterThan(at(1000) * 2);
    expect(a.maxAtPos).toBeGreaterThan(1440);
    expect(a.maxAtPos).toBeLessThan(1510);
  });
  it("обрезка нижнего конца сдвигает профиль и уменьшает длину", () => {
    const base = { ...defaultPassport(4500, 2.13), journal: [{ id: "a", kind: "trip" as const, depthM: 200, count: 100, pressureMPa: 30 }] };
    const a = analyzeStringLife(base, 44.45, 3.4, "CT-80", { ...job, depthM: 3000 }, 3150);
    expect(a.recommendedCutM).toBeGreaterThan(0);
    const cut = analyzeStringLife({ ...base, journal: [...base.journal, { id: "c", kind: "cut" as const, depthM: 0, count: 0, pressureMPa: 0, cutM: 250 }] }, 44.45, 3.4, "CT-80", job, 3150);
    expect(cut.currentLengthM).toBe(4250);
    expect(cut.maxDamagePct).toBeLessThan(a.maxDamagePct * 0.2);
  });
  it("стыковой шов — локально больше повреждение", () => {
    const p = { ...defaultPassport(4500, 2.13), welds: [{ id: "w", sFromCoreM: 3000, type: "butt" as const }], journal: [{ id: "a", kind: "trip" as const, depthM: 3000, count: 50, pressureMPa: 10 }] };
    const a = analyzeStringLife(p, 44.45, 3.4, "CT-80", job, 3150);
    expect(Math.abs(a.maxAtPos - 1500)).toBeLessThan(15);
  });
});
