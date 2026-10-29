import { describe, expect, it } from "vitest";
import * as C from "./coiled-tubing-calculations";
import { strengthOf, pipeFlow, rheologyOf, bucklingLimits, pipeGeom } from "./ct-engine";

const water = C.FLUID_PRESETS[0].data;
const tools = { bhaWeight: 0, bhaLength: 5, bhaOD: 54, nozzleDiam: 4, nozzleCount: 4 };
const ct = { od: 44.45, wall: 3.68, grade: "CT-90", length: 4800, ovality: 2 };
const horiz = [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 1500, tvd: 1500, zenith: 0, azimuth: 0 }, { md: 2100, tvd: 1882, zenith: 90, azimuth: 0 }, { md: 4000, tvd: 1882, zenith: 90, azimuth: 0 }];
const hWell = { md: 4000, tvd: 1882, casingID: 99.6, tubingID: 0, wellheadPressure: 10, bhst: 80, bhct: 60, whTemp: 20, fracGradient: 0.018, trajectory: horiz };

describe("ГНКТ: силы", () => {
  it("вертикаль без давления: индикатор веса без движения = вес в жидкости, при СПО ± трение уплотнителя", () => {
    const well = { ...hWell, md: 2000, tvd: 2000, trajectory: [], wellheadPressure: 0 };
    const f = C.calculateTubingForces({ ...ct, length: 2000 }, well, water, tools, 0.25);
    const buoyed = (C.ctWeightPerMeter(44.45, 3.68) * 2000 * 9.81 * (1 - 1000 / 7850)) / 1000;
    expect(f.surfaceLoadStatic).toBeCloseTo(buoyed, 1);
    expect(f.surfaceLoadPOOH - f.surfaceLoadStatic).toBeCloseTo(2, 1);
    expect(f.surfaceLoadStatic - f.surfaceLoadRIH).toBeCloseTo(2, 1);
    expect(f.lockUpDepth).toBe(0);
  });
  it("давление устья выталкивает трубу на P·A и даёт глубину равновесия", () => {
    const f0 = C.calculateTubingForces(ct, { ...hWell, wellheadPressure: 0 }, water, tools, 0.15);
    const f10 = C.calculateTubingForces(ct, hWell, water, tools, 0.15);
    const pa = 10e6 * (Math.PI / 4) * 0.04445 ** 2 / 1000;
    expect(f10.pressureAreaForce).toBeCloseTo(pa, 1);
    expect(f0.surfaceLoadStatic - f10.surfaceLoadStatic).toBeCloseTo(pa, 0);
    // равновесие: вес ~31.7 Н/м против 15.5 кН + уплотнитель → ~600–650 м
    expect(f10.pipeLightDepth).toBeGreaterThan(500);
    expect(f10.pipeLightDepth).toBeLessThan(750);
  });
  it("горизонталь: запирание от спирального изгиба, глубже при меньшем трении", () => {
    const a = C.calculateTubingForces(ct, hWell, water, tools, 0.3);
    const b = C.calculateTubingForces(ct, hWell, water, tools, 0.2);
    expect(a.lockUpReason).toBe("helical");
    expect(a.lockUpDepth).toBeGreaterThan(2100);
    expect(a.lockUpDepth).toBeLessThan(4000);
    expect(b.lockUpDepth === 0 || b.lockUpDepth > a.lockUpDepth).toBe(true);
    const c = C.calculateTubingForces(ct, hWell, water, tools, 0.12);
    expect(c.lockUpDepth).toBe(0);
    expect(c.wobMaxAtTD).toBeGreaterThan(0);
  });
  it("слабый инжектор ограничивает спуск раньше спирального запирания", () => {
    const f = C.calculateTubingForces(ct, hWell, water, tools, 0.12, undefined, { injectorSnubKN: 5 });
    expect(f.lockUpReason).toBe("injector");
    expect(f.lockUpDepth).toBeLessThan(700);
  });
  it("критические силы изгиба в горизонтали (Досон–Паслей)", () => {
    const p = pipeGeom(44.45, 3.68);
    const w = p.wAir + 1000 * 9.81 * p.ai - 1000 * 9.81 * p.ao;
    const r = (0.0996 - 0.04445) / 2;
    const lim = bucklingLimits(p.ei, w, Math.PI / 2, r);
    expect(lim.fSin / 1000).toBeCloseTo(2 * Math.sqrt((p.ei * w) / r) / 1000, 3);
    expect(lim.fHel / lim.fSin).toBeCloseTo(Math.SQRT2, 3);
  });
});

describe("ГНКТ: гидравлика", () => {
  it("навитая на барабан часть даёт дополнительные потери (кривизна)", () => {
    const rh = rheologyOf(water);
    const q = 0.003, d = 0.03709;
    const straight = pipeFlow(q, d, 1000, rh).gradPaM, coiled = pipeFlow(q, d, 1000, rh, 2.3).gradPaM;
    expect(coiled / straight).toBeGreaterThan(1.1);
    expect(coiled / straight).toBeLessThan(1.4);
  });
  it("давление насоса = устьевое + все потери; снижатель трения снижает потери", () => {
    const h = C.calculateHydraulics(ct, hWell, water, { flowRate: 3, surfacePressure: 0 }, tools);
    expect(h.pumpPressure).toBeCloseTo(10 + h.dpTotal, 1);
    expect(h.dpReel).toBeGreaterThan(0);
    expect(h.ecdAtTD).toBeLessThan(1.05);
    const dr = C.calculateHydraulics(ct, hWell, water, { flowRate: 3, surfacePressure: 0 }, tools, undefined, { frictionReducerPct: 60 });
    expect(dr.dpCTDeployed).toBeLessThan(h.dpCTDeployed * 0.6);
  });
  it("бингамовская жидкость пересчитывается в степенную по Fann", () => {
    const r = rheologyOf({ name: "x", density: 1.1, pv: 20, yp: 10, nIndex: 1, kIndex: 0 });
    expect(r.n).toBeGreaterThan(0.5);
    expect(r.n).toBeLessThan(0.9);
  });
  it("затрубье по участкам: НКТ до башмака, ниже — колонна", () => {
    const w = { ...hWell, tubingID: 62, casingID: 99.6 };
    const h = C.calculateHydraulics(ct, w, water, { flowRate: 3, surfacePressure: 0 }, tools, undefined, { tubingShoeMD: 1800 });
    expect(h.annulusSegments.length).toBe(2);
    expect(h.annulusSegments[0].velocity).toBeGreaterThan(h.annulusSegments[1].velocity);
  });
});

describe("ГНКТ: прочность API RP 5C7", () => {
  it("смятие с овальностью по Тимошенко", () => {
    const s = strengthOf(44.45, 3.68, "CT-90", 2);
    expect(s.collapse).toBeCloseTo(94.3, 0);
    expect(s.collapseOval).toBeGreaterThan(60);
    expect(s.collapseOval).toBeLessThan(70);
  });
  it("износ стенки и натяжение снижают пределы", () => {
    const a = C.calculateLimits(ct, 0, 0, 0);
    const b = C.calculateLimits(ct, 0, 0, 100, { wallLossPct: 10 });
    expect(b.burstPressure).toBeLessThan(a.burstPressure);
    expect(b.collapseAtLoad).toBeLessThan(b.collapseWithOvality);
  });
  it("диаграмма пределов замкнута на текучести", () => {
    const env = C.generatePressureLoadEnvelope(ct);
    expect(env[0].burstLimit).toBe(0);
    expect(env[env.length - 1].burstLimit).toBe(0);
    const mid = env[Math.floor(env.length / 2)];
    expect(mid.burstLimit).toBeGreaterThan(mid.burstWork);
    expect(mid.collapseLimit).toBeLessThan(0);
  });
});
