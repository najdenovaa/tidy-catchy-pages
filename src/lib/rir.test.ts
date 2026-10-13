import { describe, it, expect } from "vitest";
import { burstMPa, collapseMPa, calculateRir, DEFAULT_RIR } from "./rir-calculations";

describe("РИР: прочность труб по API 5C3", () => {
  it("5½ дюйма 17 lb/ft N80: разрыв 7740 psi, смятие 6290 psi", () => {
    expect(burstMPa(139.7, 7.72, 552) / 0.00689476).toBeCloseTo(7740, -2);
    expect(collapseMPa(139.7, 7.72, 552).pMPa / 0.00689476).toBeCloseTo(6290, -2);
  });
  it("7 дюймов 23 lb/ft J55: смятие 3270 psi", () => {
    const c = collapseMPa(177.8, 8.05, 379);
    expect(c.pMPa / 0.00689476).toBeCloseTo(3270, -2);
  });
  it("2⅞ дюйма 6.5 lb/ft N80 НКТ: разрыв 10570 psi", () => {
    expect(burstMPa(73.0, 5.51, 552) / 0.00689476).toBeCloseTo(10570, -2);
  });
});

describe("РИР: диагностика и окно давлений", () => {
  const r = calculateRir(DEFAULT_RIR);
  it("приёмистость: линейная аппроксимация по забойному давлению", () => {
    expect(r.fit!.J).toBeGreaterThan(0);
    expect(r.fit!.r2).toBeGreaterThan(0.95);
    expect(r.fit!.points[0].bhpMPa).toBeGreaterThan(r.fit!.points[0].surfaceMPa);
  });
  it("окно давлений — минимум ограничений, на устье = забой − гидростатика состава", () => {
    const min = Math.min(...r.constraints.map((c) => c.limitBhpMPa));
    expect(r.maxBhpMPa).toBeCloseTo(min, 6);
    expect(r.maxSurfaceMPa).toBeGreaterThan(0);
    expect(r.maxSurfaceMPa).toBeCloseTo(r.maxBhpMPa - r.compositionDensity * 9.81 * r.leakTVD / 1000, 6);
  });
  it("выбор состава по раскрытию: широкий канал — цемент, узкий — микроцемент, микрозазор — смола", () => {
    const mk = (q: number) => calculateRir({ ...DEFAULT_RIR, injectivity: [{ rateM3h: q, surfacePressureMPa: 8 }, { rateM3h: q * 2, surfacePressureMPa: 12 }] }).composition;
    expect(mk(20)).toBe("cement");
    expect(mk(0.5)).toBe("microcement");
    expect(mk(0.002)).toBe("resin");
  });
  it("объём: под ретейнером + задавливание + запас; продавка = объём НКТ − объём задавливания", () => {
    const v = r.volumes;
    expect(v.totalM3).toBeCloseTo(v.belowToolM3 + v.squeezeM3 + v.reserveM3, 9);
    expect(v.displacementM3).toBeCloseTo((Math.PI / 4) * ((73 - 11) / 1000) ** 2 * 1820 - v.squeezeM3, 3);
  });
  it("без пакера ограничение — разрыв колонны у устья", () => {
    const b = calculateRir({ ...DEFAULT_RIR, tool: { ...DEFAULT_RIR.tool, kind: "bradenhead" } });
    expect(b.constraints.some((c) => c.name.startsWith("Разрыв колонны у устья"))).toBe(true);
  });
  it("ход работ сформирован, время жизни состава ≥ работа/0,75", () => {
    expect(r.workProgram.length).toBeGreaterThan(6);
    expect(r.timing.requiredWorkLifeMin).toBeGreaterThanOrEqual(r.timing.jobMin / 0.75);
  });
});

import { analyseTubing, DEFAULT_TUBING_MECH, type MechLoadCase } from "./rir-tubing";

describe("РИР: НКТ и пакер (Лубинский)", () => {
  const lc: MechLoadCase = { toolMD: 1820, toolTVD: 1820, tubingOdMm: 73, tubingWallMm: 5.5, tubingGrade: "Е (N80/L80)", casingIdMm: 130.7,
    wellFluidDensity: 1.0, surfaceTempC: 20, toolStaticC: 20, toolCircC: 20, squeezeSurfaceMPa: 0, annulusBackPressureMPa: 0 };
  const m = { ...DEFAULT_TUBING_MECH, injectionTempC: 20, displacementDensity: 1.0 };
  it("без изменений давлений и температуры НКТ не перемещаются", () => {
    const r = analyseTubing(lc, m);
    expect(Math.abs(r.totalDLmm)).toBeLessThan(1e-6);
  });
  it("температура: ΔL = β·L·ΔT", () => {
    const r = analyseTubing({ ...lc, toolStaticC: 60, toolCircC: 60 }, { ...m, injectionTempC: 20 });
    const dT = (20 + 60) / 2 - (20 + 60) / 2; // одинаково → 0
    expect(r.effects.find((e) => e.key === "temp")!.dLmm).toBeCloseTo(1.24e-5 * 1820 * dT * 1000, 6);
    const r2 = analyseTubing({ ...lc, toolStaticC: 60, toolCircC: 40 }, { ...m, injectionTempC: 10 });
    expect(r2.effects.find((e) => e.key === "temp")!.dLmm).toBeCloseTo(1.24e-5 * 1820 * ((10 + 40) / 2 - (20 + 60) / 2) * 1000, 3);
  });
  it("поршень: ΔL1 = −L·[(Ap−Ai)ΔPi]/(E·As)", () => {
    const r = analyseTubing({ ...lc, squeezeSurfaceMPa: 10 }, m);
    const od = 0.073, id = 0.062, Ai = Math.PI / 4 * id * id, As = Math.PI / 4 * od * od - Ai, Ap = Math.PI / 4 * 0.0683 ** 2;
    expect(r.effects.find((e) => e.key === "piston")!.dLmm).toBeCloseTo(-1820 * (Ap - Ai) * 10e6 / (2.07e11 * As) * 1000, 3);
  });
  it("давление в НКТ укорачивает трубы; противодавление в затрубье уменьшает укорочение и изгиб", () => {
    const a = analyseTubing({ ...lc, squeezeSurfaceMPa: 15 }, m);
    const b = analyseTubing({ ...lc, squeezeSurfaceMPa: 15, annulusBackPressureMPa: 8 }, m);
    expect(a.totalDLmm).toBeLessThan(0);
    expect(b.totalDLmm).toBeGreaterThan(a.totalDLmm);
    expect(a.buckling.buckled).toBe(true);
    expect(b.buckling.fictitiousKN).toBeLessThan(a.buckling.fictitiousKN);
  });
  it("свободный стингер: при малой разгрузке выходит из ретейнера, предлагается разгрузка / противодавление", () => {
    const r = analyseTubing({ ...lc, squeezeSurfaceMPa: 25 }, { ...m, setDownKN: 5, sealTravelMm: 100 });
    expect(r.stingerUnseats).toBe(true);
    expect(r.setDownNeededKN).not.toBeNull();
  });
  it("закреплённые НКТ: укорочение даёт растяжение пакера = k·|ΔL| − разгрузка", () => {
    const r = analyseTubing({ ...lc, squeezeSurfaceMPa: 15 }, { ...m, mode: "anchored", setDownKN: 20 });
    expect(r.packerForceKN).toBeCloseTo(-20 + r.restrainForceKN, 6);
    expect(r.packerForceKN).toBeGreaterThan(0);
  });
});

import { designMicrocement, designResin, designRirComposition } from "./rir-compositions";

describe("РИР: составы", () => {
  const c = { bhctC: 48, bhstC: 58, requiredWorkLifeMin: 183, volumeM3: 1.3, targetDensity: 0 };
  it("микроцемент: баланс масс и объёмов на 1 м³, загустевание ≥ требуемого", () => {
    const d = designMicrocement(c);
    const mass = d.waterLPerM3 + d.components.reduce((t, x) => t + x.kgPerM3, 0);
    const vol = d.waterLPerM3 / 1000 + d.components.reduce((t, x) => t + x.kgPerM3 / x.sg / 1000, 0);
    expect(vol).toBeCloseTo(1, 2);
    expect(mass / 1000).toBeCloseTo(1.55, 2);
    expect(d.workLifeAtBhctMin).toBeGreaterThanOrEqual(183);
    expect(d.components.some((x) => x.role === "retarder")).toBe(true);
  });
  it("смола: стехиометрия, время жизни ≥ требуемого, вязкость снижена разбавителем", () => {
    const d = designResin(c);
    expect(d.workLifeAtBhctMin).toBeGreaterThanOrEqual(183);
    const res = d.components.find((x) => x.role === "resin")!, hd = d.components.find((x) => x.role === "hardener")!;
    expect(hd.dose).toBeGreaterThan(10);
    expect(res.dose).toBe(100);
    const vol = d.components.reduce((t, x) => t + x.kgPerM3 / x.sg / 1000, 0);
    expect(vol).toBeCloseTo(1, 3);
  });
  it("горячая скважина — ароматический амин / ангидрид, холодная — алифатический", () => {
    expect(designResin({ ...c, bhctC: 120, bhstC: 140, requiredWorkLifeMin: 150 }).system).toMatch(/ДЭТДА|МТГФА|ангидрид/i);
    expect(designResin({ ...c, bhctC: 20, bhstC: 25, requiredWorkLifeMin: 60 }).system).toMatch(/ПЭПА|Полиэфирамин|ИФДА/);
  });
  it("утяжеление смолы баритом до плотности", () => {
    const d = designResin({ ...c, targetDensity: 1.4 });
    expect(d.densityGcm3).toBeCloseTo(1.4, 2);
    expect(d.components.some((x) => x.role === "weight")).toBe(true);
  });
  it("комбинация: смола в «голову» + микроцемент", () => {
    const r = designRirComposition("resin_micro", c, 0.6)!;
    expect(r.primary.kind).toBe("resin");
    expect(r.secondary!.kind).toBe("microcement");
    expect(r.split!.primaryM3 + r.split!.secondaryM3).toBeCloseTo(1.3, 6);
  });
});

import { simulateSqueeze } from "./rir-squeeze-sim";

describe("РИР: моделирование задавливания", () => {
  const r = calculateRir(DEFAULT_RIR);
  const comp = designRirComposition(r.composition, { bhctC: r.temps.bhctC, bhstC: r.temps.bhstC, requiredWorkLifeMin: r.timing.requiredWorkLifeMin, volumeM3: r.volumes.totalM3, targetDensity: 0 }, r.volumes.squeezeM3)!;
  const sim = simulateSqueeze(DEFAULT_RIR, r, comp.primary);
  it("давление на устье не превышает допустимого в каждый момент", () => {
    for (const p of sim.points) expect(p.surfaceMPa).toBeLessThanOrEqual(p.allowSurfaceMPa + 1e-6);
  });
  it("баланс на ступени: прирост в канале = закачано (несжимаемая система)", () => {
    const st = sim.points.filter((p) => p.stage === "Ступень 1");
    const a = st[0], b = st[st.length - 1];
    expect(b.vChannel - a.vChannel).toBeCloseTo(b.vPumped - a.vPumped, 6);
  });
  it("типовой случай задавливается, сценарий из-под пакера тоже", () => {
    expect(sim.outcome).toBe("sealed");
    const inp = { ...DEFAULT_RIR, tool: { ...DEFAULT_RIR.tool, kind: "packer" as const } };
    const r2 = calculateRir(inp);
    const c2 = designRirComposition(r2.composition, { bhctC: r2.temps.bhctC, bhstC: r2.temps.bhstC, requiredWorkLifeMin: r2.timing.requiredWorkLifeMin, volumeM3: r2.volumes.totalM3, targetDensity: 0 }, r2.volumes.squeezeM3)!;
    const s2 = simulateSqueeze(inp, r2, c2.primary);
    expect(s2.stages.some((x) => x.name === "Посадка пакера")).toBe(true);
    expect(s2.compInChannelM3).toBeGreaterThan(0);
  });
  it("состав доходит до канала, подвижность падает, есть итог", () => {
    expect(sim.compInChannelM3).toBeGreaterThan(0);
    const mob = sim.points.filter((p) => p.vCompChannel > 0).map((p) => p.mobility);
    expect(mob[mob.length - 1]).toBeLessThan(mob[0]);
    expect(["sealed", "partial", "no_squeeze"]).toContain(sim.outcome);
    expect(sim.holds.length).toBeGreaterThan(0);
  });
});

import { autoDesignRir, planRir, applyVariant } from "./rir-autodesign";
import { buildRirProgram, stageRegime } from "./rir-program";

describe("РИР: автоподбор и программа работ", () => {
  it("автоподбор: лучший вариант задавлен и в пределах 75% времени жизни; узкий канал — только смола", () => {
    const a = autoDesignRir(DEFAULT_RIR);
    expect(a.best?.outcome).toBe("sealed");
    expect(a.best!.workLifeUsedPct).toBeLessThanOrEqual(75);
    const tight = autoDesignRir({ ...DEFAULT_RIR, injectivity: [{ rateM3h: 0.02, surfacePressureMPa: 8 }, { rateM3h: 0.05, surfacePressureMPa: 12 }] });
    expect(new Set(tight.variants.map((v) => v.composition))).toEqual(new Set(["resin"]));
    const applied = applyVariant(DEFAULT_RIR, a.best!);
    expect(applied.composition).toBe(a.best!.composition);
    expect(applied.hesitationStages).toBe(a.best!.stages);
  });
  it("план: время жизни увеличивается, если моделирование показывает > 75%", () => {
    const r = calculateRir(DEFAULT_RIR);
    const p = planRir(DEFAULT_RIR, r);
    if (p.extendedByModel) expect(p.requiredWorkLifeMin).toBeGreaterThan(r.timing.requiredWorkLifeMin);
    expect(p.sim.workLifeUsedPct).toBeLessThanOrEqual(90);
  });
  it("программа работ: разделы, регламент, осложнения", () => {
    const r = calculateRir(DEFAULT_RIR);
    const p = planRir(DEFAULT_RIR, r);
    const prog = buildRirProgram(DEFAULT_RIR, r, p.comp, null, r.workProgram, p.sim, p.requiredWorkLifeMin);
    const ids = prog.sections.map((s) => s.id);
    for (const id of ["goal", "well", "window", "regime", "equip", "work", "contingency", "accept", "hse"]) expect(ids).toContain(id);
    const reg = stageRegime(p.sim);
    expect(reg.length).toBe(p.sim.stages.length);
    const pumped = reg.filter((x) => x.kind !== "hold").reduce((t, x) => t + x.volM3, 0);
    expect(pumped).toBeCloseTo(p.sim.points[p.sim.points.length - 1].vPumped, 3);
  });
});
