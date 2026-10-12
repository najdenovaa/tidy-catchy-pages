import { describe, it, expect } from "vitest";
import { runOptimizer, applyVariant, evaluateProgram, bufferOptions, centralizerPlans, placeForStandoff, DEFAULT_OPTIMIZER_SETTINGS, type ProgramInput } from "./cement-optimizer";
import { calculateCentralization, centralizerPresets } from "./centralization-calculations";
import type { WellData } from "./cementing-calculations";
import { normalizeSlurryInput, normalizeBufferFluid, normalizeDisplacementFluid } from "./cementing-normalizers";

const well: WellData = {
  wellDepthMD: 2600, wellDepthTVD: 2450, casingDepthMD: 2600, holeDiameter: 215.9, casingOD: 168.3, casingWall: 8.9,
  prevCasingDepth: 800, prevCasingOD: 244.5, prevCasingID: 226, ckodDepth: 2580, cementRiseHeight: 0, cavernCoeff: 1.15,
  bottomTempStatic: 92, bottomTempCirc: 0, pumpZoneTop: 0, pumpZoneBottom: 0,
  trajectory: [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 800, tvd: 800, zenith: 0, azimuth: 0 }, { md: 1600, tvd: 1520, zenith: 35, azimuth: 90 }, { md: 2600, tvd: 2450, zenith: 38, azimuth: 90 }],
  reservoirLayers: [{ name: "БС10", topMD: 2450, bottomMD: 2480, porePressureGrad: 10.2, fracGrad: 17.5, absorbGrad: 16.8, fluidType: "нефть" }],
};

const input = (tt = 300): ProgramInput => ({
  wellData: well,
  drillingFluid: { name: "ПГР", density: 1180, rheology: { pv: 22, yp: 9 }, fluidLoss: 5 },
  buffers: [normalizeBufferFluid({ name: "МБП", density: 1100, volume: 4, rheology: { pv: 20, yp: 12 }, flowRateSteps: [{ rateLps: 10, volumeM3: 4 }] })],
  slurries: [
    normalizeSlurryInput({ name: "Облегчённый", density: 1.5, topDepthMD: 1000, rheology: { pv: 40, yp: 10 }, thickeningTime30Bc: tt, flowRateSteps: [{ rateLps: 10, volumeM3: 0 }] }),
    normalizeSlurryInput({ name: "ПЦТ", density: 1.9, topDepthMD: 2200, rheology: { pv: 90, yp: 24 }, thickeningTime30Bc: tt, flowRateSteps: [{ rateLps: 10, volumeM3: 0 }] }),
  ],
  displacementFluids: [normalizeDisplacementFluid({ name: "Продавка", density: 1180, rheology: { pv: 22, yp: 9 }, flowRateSteps: [{ rateLps: 10, volumeM3: 40 }, { rateLps: 4, volumeM3: 2 }] })],
  fractureGradient: 18, flushTimeMin: 0, flushVolumeM3: 0,
});

describe("Автоподбор программы", () => {
  it("применение варианта: расходы, буфер, посадочная ступень сохраняется", () => {
    const p = input();
    const r = applyVariant(p.buffers, p.slurries, p.displacementFluids, { q1: 14, q2: 20, bufferVolumeM3: 8, bufferDensity: 1300 });
    expect(r.buffers[0].flowRateSteps[0]).toEqual({ rateLps: 14, volumeM3: 8 });
    expect(r.buffers[0].density).toBe(1300);
    expect(r.slurries.every((s) => s.flowRateSteps.every((st) => st.rateLps === 14))).toBe(true);
    expect(r.displacementFluids[0].flowRateSteps[0].rateLps).toBe(20);
    expect(r.displacementFluids[0].flowRateSteps[1].rateLps).toBe(4);
    expect(p.buffers[0].density).toBe(1100); // исходные не тронуты
  });

  it("варианты буфера: иерархия плотности и объём по высоте 250 м", () => {
    const opts = bufferOptions(input(), DEFAULT_OPTIMIZER_SETTINGS);
    expect(opts.some((o) => o.density === 1300)).toBe(true); // 1180 × 1.1 ≈ 1300
    expect(opts.some((o) => (o.volumeM3 ?? 0) >= 6)).toBe(true);
  });

  it("при реологии по Fann и плохом центрировании расход повышает качество, но съедает запас", () => {
    const p = input();
    p.wellData = { ...well, annularStandoffPct: 45 };
    p.drillingFluid = { ...p.drillingFluid, rheology: { pv: 13, yp: 6.7, fann: { r600: 40, r300: 27, r200: 22, r100: 16, r6: 6, r3: 5 } } };
    p.buffers = [{ ...p.buffers[0], density: 1300, rheology: { pv: 15, yp: 7.2, fann: { r600: 45, r300: 30, r200: 24, r100: 17, r6: 5, r3: 4 } } }];
    const lo = evaluateProgram(p, { q1: 8, q2: 8, bufferVolumeM3: null, bufferDensity: null }, DEFAULT_OPTIMIZER_SETTINGS);
    const hi = evaluateProgram(p, { q1: 20, q2: 26, bufferVolumeM3: null, bufferDensity: null }, DEFAULT_OPTIMIZER_SETTINGS);
    expect(hi.effAnnRateLps).toBeGreaterThan(lo.effAnnRateLps);
    expect(hi.mrei).toBeGreaterThan(lo.mrei);
    expect(hi.channelLengthM).toBeLessThanOrEqual(lo.channelLengthM);
    expect(hi.minMarginMPa).toBeLessThan(lo.minMarginMPa + 1e-9);
  });

  it("буфер легче раствора — иерархия плотности ограничивает качество", () => {
    const p = input();
    const ev = evaluateProgram(p, { q1: 10, q2: 10, bufferVolumeM3: null, bufferDensity: null }, DEFAULT_OPTIMIZER_SETTINGS);
    const fixed = evaluateProgram(p, { q1: 10, q2: 10, bufferVolumeM3: null, bufferDensity: 1300 }, DEFAULT_OPTIMIZER_SETTINGS);
    expect(ev.limitingFactor).toBe("иерархия плотности");
    expect(fixed.mrei).toBeGreaterThan(ev.mrei);
  });

  it("находит допустимые варианты и они не хуже текущего", { timeout: 60000 }, async () => {
    const r = await runOptimizer(input(), { ...DEFAULT_OPTIMIZER_SETTINGS, rateStepLps: 4 });
    expect(r.best.length).toBeGreaterThan(0);
    const top = r.best[0].ev;
    expect(top.feasible).toBe(true);
    expect(top.minMarginMPa).toBeGreaterThanOrEqual(DEFAULT_OPTIMIZER_SETTINGS.marginReqMPa);
    expect(top.mrei).toBeGreaterThanOrEqual(r.current.mrei - 1e-6);
    // Лучший вариант никогда не нарушает запрет
    expect(r.best.every((b) => b.ev.violations.length === 0)).toBe(true);
    expect(r.evaluations.length).toBe(r.bufferOptions.length * r.rates.length * r.rates1.length);
    expect(r.evaluations.every((e) => e.variant.q1 <= DEFAULT_OPTIMIZER_SETTINGS.maxCementRateLps)).toBe(true);
  });

  it("короткое время загустевания отсекает медленные варианты", { timeout: 60000 }, async () => {
    const r = await runOptimizer(input(110), { ...DEFAULT_OPTIMIZER_SETTINGS, rateStepLps: 6, optimizeBuffer: false });
    const slow = r.evaluations.find((e) => e.variant.q1 === 6 && e.variant.q2 === 6)!;
    expect(slow.violations).toContain("загустевание");
    if (r.best.length) expect(r.best[0].ev.thickeningReserveMin).toBeGreaterThanOrEqual(0);
  });

  it("расстановка под целевой отступ выдерживает цель по модели центрирования", () => {
    const spec = { type: "rigid" as const, bladesCount: 6, bladeHeight: 25, restoringForce: centralizerPresets.rigid.restoringForce!, maxAxialLoad: 300 };
    for (const target of [55, 75]) {
      const ivs = placeForStandoff(well, spec, 12, target, 1180, 1000);
      const prof = calculateCentralization(well, ivs, 1180).filter((r) => r.md >= 1000);
      expect(Math.min(...prof.map((r) => r.standoff))).toBeGreaterThanOrEqual(target);
    }
    const plans = centralizerPlans(input(), DEFAULT_OPTIMIZER_SETTINGS);
    const counts = plans.map((p) => p.countInCement);
    expect(counts).toEqual([...counts].sort((a, b) => a - b)); // выше цель — больше центраторов
  });

  it("автоподбор рекомендует центрирование не ниже 67% и учитывает рост трения", { timeout: 60000 }, async () => {
    const r = await runOptimizer(input(), { ...DEFAULT_OPTIMIZER_SETTINGS, rateStepLps: 6 });
    const st = r.centralizerStudy!;
    expect(st.options.length).toBe(4);
    const rec = st.options[st.recommendedIdx];
    expect(rec.centralization!.minStandoffPct).toBeGreaterThanOrEqual(66.5);
    expect(r.best[0].ev.centralization).toBeTruthy();
    // лучшее центрирование → больше трение → меньше запас
    expect(st.options[3].minMarginMPa).toBeLessThanOrEqual(st.options[0].minMarginMPa + 1e-9);
  });
});
