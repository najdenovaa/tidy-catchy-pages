import { describe, it, expect } from "vitest";
import { buildLabProtocol, applyProtocolToSlurries, protocolToHtml, additivesFromProtocol } from "./lab-protocol";
import { designSlurry, neatThickeningMin, designToTargets, type DesignConditions } from "./cement-recipe-designer";
import { exportLabProtocolDocx } from "./export-lab-protocol-docx";
import { calculatePressureProfile, calculateVolumes, type WellData } from "./cementing-calculations";
import { buildRecipe } from "./cement-program";
import { normalizeSlurryInput, normalizeBufferFluid, normalizeDisplacementFluid } from "./cementing-normalizers";

const well: WellData = {
  wellDepthMD: 2600, wellDepthTVD: 2450, casingDepthMD: 2600, holeDiameter: 215.9, casingOD: 168.3, casingWall: 8.9,
  prevCasingDepth: 800, prevCasingOD: 244.5, prevCasingID: 226, ckodDepth: 2580, cementRiseHeight: 0, cavernCoeff: 1.15,
  bottomTempStatic: 92, bottomTempCirc: 0, surfaceTemp: 10, pumpZoneTop: 0, pumpZoneBottom: 0,
  trajectory: [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 800, tvd: 800, zenith: 0, azimuth: 0 }, { md: 1600, tvd: 1520, zenith: 35, azimuth: 90 }, { md: 2600, tvd: 2450, zenith: 38, azimuth: 90 }],
  reservoirLayers: [{ name: "БС10", topMD: 2450, bottomMD: 2480, porePressureGrad: 10.2, fracGrad: 18.5, absorbGrad: 17.6, fluidType: "газ" }],
};
const slurries = [
  normalizeSlurryInput({ name: "Облегчённый", density: 1.5, topDepthMD: 0, rheology: { pv: 40, yp: 10 }, flowRateSteps: [{ rateLps: 15, volumeM3: 0 }] }),
  normalizeSlurryInput({ name: "ПЦТ", density: 1.9, topDepthMD: 2200, rheology: { pv: 90, yp: 24 }, thickeningTime30Bc: 150, flowRateSteps: [{ rateLps: 15, volumeM3: 0 }] }),
];
const buffers = [normalizeBufferFluid({ name: "МБП", density: 1300, volume: 6, rheology: { pv: 20, yp: 8 }, flowRateSteps: [{ rateLps: 12, volumeM3: 6 }] })];
const disps = [normalizeDisplacementFluid({ name: "Продавка", density: 1180, rheology: { pv: 22, yp: 9 }, flowRateSteps: [{ rateLps: 14, volumeM3: 0 }] })];
const mud = { name: "ПГР", density: 1180, rheology: { pv: 22, yp: 9 }, fluidLoss: 5 };
const volumes = calculateVolumes(well, slurries, 1);
const pressure = calculatePressureProfile(well, slurries, buffers, mud, disps, 18, volumes.displacementVolumeWithCompression, 0, 0, { fast: true });
const input = { wellData: well, slurries, buffers, drillingFluid: mud, pressure, volumes };

describe("Подбор рецептуры", () => {
  it("плотность и выход замыкаются по абсолютным объёмам", () => {
    for (const rho of [1.35, 1.5, 1.7, 1.9, 2.1]) {
      const d = designSlurry({ densityGcm3: rho, bhctC: 60, tTopC: 30, tBottomC: 70, bhstC: 80, maxPressureMPa: 35, requiredThickeningMin: 150, coversPay: true, gas: false, maxZenithDeg: 10, lossMarginMPa: 3, isTail: true });
      expect(d.densityGcm3).toBeCloseTo(rho, 3);
      expect(d.yieldM3PerT).toBeGreaterThan(0.5);
    }
  });

  it("время загустевания подбирается под требование, замедлитель растёт с температурой", () => {
    const mk = (bhct: number) => designSlurry({ densityGcm3: 1.9, bhctC: bhct, tTopC: bhct, tBottomC: bhct + 10, bhstC: bhct + 15, maxPressureMPa: 40, requiredThickeningMin: 180, coversPay: true, gas: false, maxZenithDeg: 0, lossMarginMPa: 3, isTail: true });
    const a = mk(50), b = mk(85);
    const ret = (d: ReturnType<typeof mk>) => d.components.find((c) => c.role === "retarder")?.pctBwoc ?? 0;
    expect(ret(b)).toBeGreaterThan(ret(a));
    expect(b.predicted.thickening30BcMin).toBeGreaterThanOrEqual(180);
    expect(neatThickeningMin(90)).toBeLessThan(neatThickeningMin(52));
  });

  it("газ → жёсткая водоотдача и газоблокатор; >110 °C → кварц", () => {
    const g = designSlurry({ densityGcm3: 1.9, bhctC: 70, tTopC: 75, tBottomC: 90, bhstC: 90, maxPressureMPa: 40, requiredThickeningMin: 150, coversPay: true, gas: true, maxZenithDeg: 40, lossMarginMPa: 3, isTail: true });
    expect(g.predicted.fluidLossTargetMl).toBe(50);
    expect(g.predicted.fluidLossMl).toBeLessThanOrEqual(50);
    expect(g.components.some((c) => c.role === "gasBlock")).toBe(true);
    expect(g.predicted.freeWaterPct).toBe(0);
    const hot = designSlurry({ densityGcm3: 1.9, bhctC: 120, tTopC: 120, tBottomC: 140, bhstC: 140, maxPressureMPa: 60, requiredThickeningMin: 200, coversPay: false, gas: false, maxZenithDeg: 0, lossMarginMPa: 3, isTail: true });
    expect(hot.components.find((c) => c.role === "silica")?.pctBwoc).toBe(35);
  });

  it("лёгкий раствор: бентонит, а ниже — микросферы по давлению", () => {
    const c = { bhctC: 60, tTopC: 20, tBottomC: 70, bhstC: 80, requiredThickeningMin: 180, coversPay: false, gas: false, maxZenithDeg: 0, lossMarginMPa: 3, isTail: false };
    expect(designSlurry({ ...c, densityGcm3: 1.55, maxPressureMPa: 30 }).components.some((x) => x.role === "extender")).toBe(true);
    const ms = designSlurry({ ...c, densityGcm3: 1.3, maxPressureMPa: 30 });
    expect(ms.components.find((x) => x.role === "lightweight")?.name).toMatch(/Стеклянные/);
  });
});

describe("Протокол", () => {
  it("содержит все разделы, баланс массы рецептуры = плотность", () => {
    const { protocol } = buildLabProtocol(input, "РП-TEST");
    expect(protocol.title).toContain("РП-TEST");
    expect(protocol.status).toMatch(/не результаты лабораторных испытаний/);
    const ids = protocol.sections.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["well", "layers", "cond", "recipe-0", "props-0", "recipe-1", "props-1", "compat", "concl"]));
    slurries.forEach((s, i) => {
      const rows = protocol.sections.find((x) => x.id === `recipe-${i}`)!.tables![0].rows;
      const kg = rows.reduce((t, r) => t + parseFloat(r[4].replace(",", ".")), 0);
      expect(kg / 1000).toBeCloseTo(s.density, 1);
      const props = protocol.sections.find((x) => x.id === `props-${i}`)!.tables![0];
      expect(props.headers).toEqual(["Показатель", "Условия испытания", "Требование", "Прогноз системы", "Факт", "Заключение"]);
      expect(props.rows.every((r) => r[4] === "")).toBe(true); // факт пуст
    });
    // газ у хвостовой пачки → строка СНС
    expect(protocol.sections.find((x) => x.id === "props-1")!.tables![0].rows.some((r) => r[0].includes("СНС"))).toBe(true);
    expect(protocolToHtml(protocol)).toContain("<table");
  });

  it("правка дозировки в протоколе переносится в программу, В/С пересчитывается", () => {
    const { protocol, designs } = buildLabProtocol(input);
    const t = protocol.sections.find((x) => x.id === "recipe-1")!.tables![0];
    const row = t.rows.find((r) => /Понизитель водоотдачи/.test(r[1]))!;
    row[3] = "0,35";
    const adds = additivesFromProtocol(protocol, 1, designs)!;
    expect(adds.find((a) => /Понизитель водоотдачи/.test(a.name))!.percentage).toBe(0.35);
    const next = applyProtocolToSlurries(protocol, slurries, designs);
    expect(next[1].thickeningTime30Bc).toBe(150); // замер не перезаписан
    expect(next[0].thickeningTime30Bc).toBeGreaterThan(0); // прогноз записан
    const r = buildRecipe(next[1], 1);
    expect(Math.abs(r.densityAtEntered - 1.9)).toBeLessThan(0.005);
    expect(next[1].rheology.fann).toBeTruthy();
  });

  it("выгрузка в Word", async () => {
    const { protocol } = buildLabProtocol(input);
    const blob = await exportLabProtocolDocx(protocol, "x.docx", true);
    expect(blob).toBeTruthy();
    expect((blob as Blob).size).toBeGreaterThan(5000);
  });
});

describe("Подбор под требования технолога", () => {
  const base: DesignConditions = { densityGcm3: 1.9, bhctC: 60, tTopC: 40, tBottomC: 70, bhstC: 80, maxPressureMPa: 35, requiredThickeningMin: 150, coversPay: true, gas: false, maxZenithDeg: 10, lossMarginMPa: 3, isTail: true };
  const pct = (d: { components: { role: string; pctBwoc: number }[] }, role: string) => d.components.filter((c) => c.role === role).reduce((s, c) => s + c.pctBwoc, 0);

  it("без требований — значения программы, все выполнены", () => {
    const r = designToTargets(base);
    expect(r.targets.thickeningMinMin).toBe(150);
    expect(r.allOk).toBe(true);
  });

  it("жёстче водоотдача → больше понизителя, требование выполнено", () => {
    const a = designToTargets(base), b = designToTargets(base, { fluidLossMaxMl: 40 });
    expect(pct(b.design, "fluidLoss")).toBeGreaterThan(pct(a.design, "fluidLoss"));
    expect(b.design.predicted.fluidLossMl).toBeLessThanOrEqual(40);
    expect(b.compliance.find((x) => x.key === "fl")?.ok).toBe(true);
  });

  it("длиннее время загустевания → больше замедлителя; окно ≤ max соблюдается", () => {
    const b = designToTargets(base, { thickeningMinMin: 300, thickeningMaxMin: 380 });
    expect(b.design.predicted.thickening30BcMin).toBeGreaterThanOrEqual(300);
    expect(b.design.predicted.thickening30BcMin).toBeLessThanOrEqual(380);
    expect(pct(b.design, "retarder")).toBeGreaterThan(pct(designToTargets(base).design, "retarder"));
  });

  it("низкая ДНС → итерационно растёт пластификатор", () => {
    const a = designToTargets(base), b = designToTargets(base, { yieldPointMaxPa: a.design.predicted.rheo27.ypPa * 0.6 });
    expect(pct(b.design, "dispersant")).toBeGreaterThan(pct(a.design, "dispersant"));
    expect(b.compliance.find((x) => x.key === "yp")?.ok).toBe(true);
  });

  it("газонепроницаемость и выбор облегчения задаются флагами", () => {
    const g = designToTargets({ ...base, isTail: false }, { gasTight: true });
    expect(pct(g.design, "gasBlock")).toBeGreaterThan(0);
    const m = designToTargets({ ...base, densityGcm3: 1.5, isTail: false }, { extender: "microspheres" });
    expect(pct(m.design, "lightweight")).toBeGreaterThan(0);
    expect(m.design.densityGcm3).toBeCloseTo(1.5, 2);
  });

  it("требование ранней прочности облегчённого раствора — замена бентонита / ускоритель", () => {
    const c = { ...base, densityGcm3: 1.5, tTopC: 25, isTail: false };
    const a = designToTargets(c);
    const b = designToTargets(c, { strength24MinMPa: Math.max(2, a.design.predicted.strength24TopMPa * 1.5) });
    expect(b.design.predicted.strength24TopMPa).toBeGreaterThan(a.design.predicted.strength24TopMPa);
    expect(b.actions.length).toBeGreaterThan(0);
  });

  it("протокол берёт требования технолога", () => {
    const sl = slurries.map((s, i) => (i === 1 ? { ...s, labTargets: { fluidLossMaxMl: 35, thickeningMinMin: 260 } } : s));
    const { protocol } = buildLabProtocol({ ...input, slurries: sl });
    const t = protocol.sections.find((x) => x.id === "props-1")!.tables![0].rows;
    expect(t.find((r) => r[0].startsWith("Водоотдача"))![2]).toBe("≤ 35");
    expect(t.find((r) => r[0].startsWith("Время загустевания до 30"))![2]).toBe("≥ 260");
  });
});
