import { describe, it, expect } from "vitest";
import { checkNorms, requiredOverbalanceMPa, inferCasingType, normsSummary } from "./cement-norms";
import { planLogistics, DEFAULT_LOGISTICS } from "./cement-logistics";
import { runLossRisk, actualToc, DEFAULT_RISK } from "./cement-risk";
import { buildLabProgram } from "./cement-program";
import { calculatePressureProfile, calculateVolumes, calculateMaterials, type WellData } from "./cementing-calculations";
import { normalizeSlurryInput, normalizeBufferFluid, normalizeDisplacementFluid } from "./cementing-normalizers";

const well: WellData = {
  wellDepthMD: 2600, wellDepthTVD: 2450, casingDepthMD: 2600, holeDiameter: 215.9, casingOD: 168.3, casingWall: 8.9,
  prevCasingDepth: 800, prevCasingOD: 244.5, prevCasingID: 226, ckodDepth: 2580, cementRiseHeight: 0, cavernCoeff: 1.15,
  bottomTempStatic: 92, bottomTempCirc: 0, surfaceTemp: 10, pumpZoneTop: 0, pumpZoneBottom: 0,
  trajectory: [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 800, tvd: 800, zenith: 0, azimuth: 0 }, { md: 1600, tvd: 1520, zenith: 35, azimuth: 90 }, { md: 2600, tvd: 2450, zenith: 38, azimuth: 90 }],
  reservoirLayers: [{ name: "БС10", topMD: 2450, bottomMD: 2480, porePressureGrad: 10.2, fracGrad: 18.5, absorbGrad: 17.6, fluidType: "нефть" }],
};
const slurries = [
  normalizeSlurryInput({ name: "Облегчённый", density: 1.5, topDepthMD: 600, thickeningTime30Bc: 300, rheology: { pv: 30, yp: 10 }, flowRateSteps: [{ rateLps: 15, volumeM3: 0 }] }),
  normalizeSlurryInput({ name: "ПЦТ", density: 1.9, topDepthMD: 2200, thickeningTime30Bc: 150, rheology: { pv: 60, yp: 8 }, flowRateSteps: [{ rateLps: 15, volumeM3: 0 }] }),
];
const buffers = [normalizeBufferFluid({ name: "МБП", density: 1300, volume: 6, rheology: { pv: 20, yp: 8 }, flowRateSteps: [{ rateLps: 12, volumeM3: 6 }] })];
const disps = [normalizeDisplacementFluid({ name: "Продавка", density: 1180, rheology: { pv: 22, yp: 9 }, flowRateSteps: [{ rateLps: 14, volumeM3: 0 }] })];
const mud = { name: "ПГР", density: 1180, rheology: { pv: 22, yp: 9 }, fluidLoss: 5 };
const volumes = calculateVolumes(well, slurries, 1);
const pressure = calculatePressureProfile(well, slurries, buffers, mud, disps, 18, volumes.displacementVolumeWithCompression, 0, 0, { fast: true });
const lab = buildLabProgram(well, slurries, pressure, volumes);

describe("Нормы ПБ", () => {
  it("репрессия: 10% до 1200 м (≤ 1,5 МПа), 5% глубже (≤ 2,5 МПа)", () => {
    expect(requiredOverbalanceMPa(10, 1000)).toBeCloseTo(1.0, 6);
    expect(requiredOverbalanceMPa(20, 1100)).toBeCloseTo(1.5, 6);
    expect(requiredOverbalanceMPa(25, 2400)).toBeCloseTo(1.25, 6);
    expect(requiredOverbalanceMPa(60, 5000)).toBeCloseTo(2.5, 6);
  });

  it("проверки по программе: подъём над пластом, перекрытие башмака, 75% загустевания", () => {
    const c = checkNorms({ wellData: well, slurries, buffers, drillingFluid: mud, pressure, lab, casingType: inferCasingType(well), hasSkc: true });
    const byId = Object.fromEntries(c.map((x) => [x.id, x]));
    expect(inferCasingType(well)).toBe("production");
    expect(byId["rise-pay"].status).toBe("ok"); // 2450 − 600 = 1850 м
    expect(byId["overlap"].status).toBe("ok"); // 800 − 600 = 200 м
    expect(byId["dens-Облегчённый"].status).toBe("ok");
    expect(byId["record"].status).toBe("ok");
    expect(byId["lab"].status).toBe("manual");
    const tt = c.find((x) => x.id === "tt-ПЦТ")!;
    const job = lab.slurries[1].jobTimeMin;
    expect(tt.status).toBe(job <= 0.75 * 150 ? "ok" : "fail");
    expect(normsSummary(c).ok).toBeGreaterThan(3);
  });

  it("кондуктор не до устья — нарушение; нет СКЦ — нарушение", () => {
    const c = checkNorms({ wellData: well, slurries, buffers, drillingFluid: mud, pressure, lab, casingType: "conductor", hasSkc: false });
    expect(c.find((x) => x.id === "rise-surface")!.status).toBe("fail");
    expect(c.find((x) => x.id === "record")!.status).toBe("fail");
  });
});

describe("Техника и логистика", () => {
  it("число агрегатов по мощности: подача падает с давлением", () => {
    const materials = calculateMaterials(slurries, buffers, well);
    const r = planLogistics(pressure, materials, slurries);
    expect(r.unitRateAt(5)).toBeCloseTo(20, 6);    // 100 кВт / 5 МПа
    expect(r.unitRateAt(1)).toBe(DEFAULT_LOGISTICS.unitMaxRateLps);
    expect(r.unitsWorking).toBeGreaterThanOrEqual(r.peakUnitsHydraulic);
    expect(r.unitsTotal).toBe(r.unitsWorking + 1);
    expect(r.mixers).toBeGreaterThanOrEqual(Math.ceil(r.blendT / 20));
    expect(r.tankers).toBe(Math.ceil(materials.waterTotal / 10));
    expect(r.timeline.length).toBe(5);
    expect(r.lineTestMPa).toBeGreaterThanOrEqual(Math.ceil(r.maxSurfaceMPa * 1.5) - 1e-9 > 32 ? 32 : Math.ceil(r.maxSurfaceMPa * 1.5));
  });
});

describe("Риск поглощения (Монте-Карло)", () => {
  it("фактическая кавернозность больше плановой — верх цемента ниже", () => {
    expect(actualToc(well, 600, 1.15)).toBeCloseTo(600, 0);
    expect(actualToc(well, 600, 1.3)).toBeGreaterThan(650);
    expect(actualToc(well, 600, 1.05)).toBeLessThan(600);
  });

  it("воспроизводимо, вероятности в [0;1], градиент ГРП — сильный фактор", { timeout: 60000 }, async () => {
    const inp = { wellData: well, drillingFluid: mud, buffers, slurries, displacementFluids: disps, fractureGradient: 18, flushTimeMin: 0, flushVolumeM3: 0 };
    const a = await runLossRisk(inp, { ...DEFAULT_RISK, iterations: 40 });
    const b = await runLossRisk(inp, { ...DEFAULT_RISK, iterations: 40 });
    expect(a.margin.p50).toBe(b.margin.p50);
    expect(a.pLoss).toBeGreaterThanOrEqual(0); expect(a.pLoss).toBeLessThanOrEqual(1);
    expect(a.margin.p10).toBeLessThanOrEqual(a.margin.p90);
    const frac = a.sensitivity.find((s) => s.factor === "Градиент ГРП/поглощения")!;
    expect(frac.corr).toBeGreaterThan(0.3);
    expect(a.toc.pBelowRequired).not.toBeNull();
  });
});
