import { describe, it, expect } from "vitest";
import { fitRheology, hbFriction, RPM_TO_SHEAR, DIAL_TO_PA, type FannReadings } from "./cement-rheology";
import { bhctKutasovTarghi, buildRecipe, buildLabProgram } from "./cement-program";
import { annularFrictionMPa, calculatePressureProfile, calculateVolumes, annularVolumeForInterval, type WellData } from "./cementing-calculations";
import { normalizeSlurryInput, normalizeBufferFluid, normalizeDisplacementFluid } from "./cementing-normalizers";

const synth = (f: (g: number) => number): FannReadings => {
  const d = (rpm: number) => f(rpm * RPM_TO_SHEAR) / DIAL_TO_PA;
  return { r600: d(600), r300: d(300), r200: d(200), r100: d(100), r6: d(6), r3: d(3) };
};

describe("Реология по Fann", () => {
  it("восстанавливает параметры Гершеля–Балкли", () => {
    const fit = fitRheology(synth((g) => 5 + 0.5 * Math.pow(g, 0.6)))!;
    expect(fit.best).toBe("hb");
    expect(fit.hb.tau0).toBeCloseTo(5, 0);
    expect(fit.hb.n).toBeCloseTo(0.6, 1);
    expect(fit.hb.r2).toBeGreaterThan(0.999);
    // Бингам по 600/300 завышает напряжение на малых скоростях
    expect(fit.binghamLowShearErrorPct).toBeGreaterThan(20);
  });

  it("для чистого Бингама выбирает Бингама", () => {
    const fit = fitRheology(synth((g) => 8 + 0.05 * g))!;
    expect(fit.best).toBe("bingham");
    expect(fit.bingham.pv).toBeCloseTo(50, 0);
    expect(fit.bingham.ypPa).toBeCloseTo(8, 1);
  });

  it("недостаточно показаний — null", () => {
    expect(fitRheology({ r600: 50 })).toBeNull();
  });

  it("ГБ при n=1 совпадает с ламинарными формулами Бингама (труба и кольцо)", () => {
    const pv = 60, yp = 8, rho = 1850;
    const hb = { tau0: yp, K: pv / 1000, n: 1 };
    // кольцо 215.9 × 168.3, 2 л/с, 1000 м
    const area = (Math.PI / 4) * (0.2159 ** 2 - 0.1683 ** 2);
    const v = 0.002 / area, Dh = 0.2159 - 0.1683;
    const bing = annularFrictionMPa(2, 1000, 215.9, 168.3, pv, yp, rho, 100).pressureMPa;
    const hbA = hbFriction(hb, v, Dh, 1000, rho, "annulus").pressureMPa;
    expect(hbA / bing).toBeGreaterThan(0.98);
    expect(hbA / bing).toBeLessThan(1.03);
    // труба
    const D = 0.15, vp = 0.3;
    const pipeB = ((32 * (pv / 1000) * vp) / (D * D) + (16 * yp) / (3 * D)) * 1000 / 1e6;
    expect(hbFriction(hb, vp, D, 1000, rho, "pipe").pressureMPa / pipeB).toBeCloseTo(1, 1);
  });

  it("турбулентный режим при высокой скорости воды", () => {
    const r = hbFriction({ tau0: 0, K: 0.001, n: 1 }, 2, 0.15, 1000, 1000, "pipe");
    expect(r.regime).toBe(1);
    const Re = 8 * 1000 * 4 / r.wallShearPa;
    expect(Re).toBeGreaterThan(100000);
  });

  it("Fann-показания в реологии меняют гидравлику симуляции", () => {
    const well: WellData = {
      wellDepthMD: 2500, wellDepthTVD: 2500, casingDepthMD: 2500, holeDiameter: 215.9, casingOD: 168.3, casingWall: 8.9,
      prevCasingDepth: 500, prevCasingOD: 244.5, prevCasingID: 226, ckodDepth: 2480, cementRiseHeight: 1500, cavernCoeff: 1.1,
      bottomTempStatic: 80, bottomTempCirc: 60, pumpZoneTop: 0, pumpZoneBottom: 0,
      trajectory: [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 2500, tvd: 2500, zenith: 0, azimuth: 0 }],
      reservoirLayers: [],
    };
    const vol = annularVolumeForInterval(1000, 2500, 215.9, 168.3, 226, 500, 1.1);
    const mk = (fann?: FannReadings) => [normalizeSlurryInput({ name: "Цемент", density: 1.85, topDepthMD: 1000, rheology: { pv: 60, yp: 8, fann }, flowRateSteps: [{ rateLps: 15, volumeM3: vol }] })];
    const buffers = [normalizeBufferFluid({ name: "Буфер", density: 1100, volume: 6, rheology: { pv: 20, yp: 10 }, flowRateSteps: [{ rateLps: 15, volumeM3: 6 }] })];
    const disp = [normalizeDisplacementFluid({ name: "Продавка", density: 1100, rheology: { pv: 15, yp: 5 }, flowRateSteps: [{ rateLps: 15, volumeM3: 100 }] })];
    const mud = { name: "Раствор", density: 1200, rheology: { pv: 25, yp: 12 }, fluidLoss: 6 };
    const run = (sl: ReturnType<typeof mk>) => calculatePressureProfile(well, sl, buffers, mud, disp, 18.5, calculateVolumes(well, sl, 1).displacementVolumeWithCompression, 0, 0);
    const a = run(mk());
    const b = run(mk(synth((g) => 15 + 0.9 * Math.pow(g, 0.55))));
    expect(b.zoneChecks[0].maxPressureMPa).not.toBeCloseTo(a.zoneChecks[0].maxPressureMPa, 2);
  });
});

describe("Температура и программа испытаний", () => {
  it("Kutasov–Targhi: Ts=100 °C, Γ=3 °C/100 м → ≈71 °C", () => {
    const r = bhctKutasovTarghi(100, 25, 2500);
    expect(r.inRange).toBe(true);
    expect(r.bhctC).toBeCloseTo(-50.64 + 804.9 * 0.03 + (1.342 - 12.22 * 0.03) * 100, 6);
  });

  it("вне диапазона — приближённо и с пометкой", () => {
    const r = bhctKutasovTarghi(50, 10, 1500);
    expect(r.inRange).toBe(false);
    expect(r.note).toBeTruthy();
    expect(r.bhctC).toBeGreaterThan(10);
    expect(r.bhctC).toBeLessThan(50);
  });

  it("программа испытаний бракует короткое время загустевания", () => {
    const well: WellData = {
      wellDepthMD: 2500, wellDepthTVD: 2500, casingDepthMD: 2500, holeDiameter: 215.9, casingOD: 168.3, casingWall: 8.9,
      prevCasingDepth: 500, prevCasingOD: 244.5, prevCasingID: 226, ckodDepth: 2480, cementRiseHeight: 1500, cavernCoeff: 1.1,
      bottomTempStatic: 90, bottomTempCirc: 0, pumpZoneTop: 0, pumpZoneBottom: 0,
      trajectory: [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 2500, tvd: 2500, zenith: 0, azimuth: 0 }],
      reservoirLayers: [{ name: "Газ", topMD: 2300, bottomMD: 2320, porePressureGrad: 10, fracGrad: 17, absorbGrad: 16, fluidType: "газ" }],
    };
    const vol = annularVolumeForInterval(1000, 2500, 215.9, 168.3, 226, 500, 1.1);
    const sl = [normalizeSlurryInput({ name: "Цемент", density: 1.85, topDepthMD: 1000, rheology: { pv: 60, yp: 8 }, flowRateSteps: [{ rateLps: 15, volumeM3: vol }], thickeningTime30Bc: 60 })];
    const buffers = [normalizeBufferFluid({ name: "Буфер", density: 1100, volume: 6, rheology: { pv: 20, yp: 10 }, flowRateSteps: [{ rateLps: 15, volumeM3: 6 }] })];
    const disp = [normalizeDisplacementFluid({ name: "Продавка", density: 1100, rheology: { pv: 15, yp: 5 }, flowRateSteps: [{ rateLps: 15, volumeM3: 100 }] })];
    const mud = { name: "Раствор", density: 1200, rheology: { pv: 25, yp: 12 }, fluidLoss: 6 };
    const vols = calculateVolumes(well, sl, 1);
    const pr = calculatePressureProfile(well, sl, buffers, mud, disp, 18.5, vols.displacementVolumeWithCompression, 0, 0);
    const prog = buildLabProgram(well, sl, pr, vols);
    const p = prog.slurries[0];
    expect(p.jobTimeMin).toBeGreaterThan(30);
    expect(p.requiredThickeningMin).toBeGreaterThanOrEqual(p.jobTimeMin / 0.75 - 1);
    expect(p.requiredThickeningMin).toBeGreaterThanOrEqual(p.jobTimeMin + 30);
    expect(p.tests.find((t) => t.test.startsWith("Время загустевания"))!.status).toBe("fail");
    expect(p.tests.some((t) => t.test.startsWith("Статическое напряжение"))).toBe(true); // газ → SGS
    expect(p.tests.find((t) => t.test.startsWith("Водоотдача"))!.criterion).toContain("50");
    expect(p.tTopStaticC).toBeLessThan(p.tBottomStaticC);
  });
});

describe("Рецептура по абсолютным объёмам", () => {
  it("чистый ПЦТ 1.90 г/см³: В/Ц ≈ 0.44, выход ≈ 0.76 м³/т", () => {
    const r = buildRecipe(normalizeSlurryInput({ name: "G", density: 1.9, waterRatio: 0.44 }), 10);
    expect(r.wcForDesign).toBeCloseTo(0.441, 2);
    expect(r.yieldM3perT).toBeCloseTo(0.759, 2);
    expect(Math.abs(r.densityMismatch)).toBeLessThan(0.01);
    expect(r.perM3.cementKg + r.perM3.waterL).toBeCloseTo(1900, 0); // масса 1 м³
    expect(r.totals.cementT).toBeCloseTo(r.perM3.cementKg * 10 / 1000, 6);
  });

  it("облегчённый с бентонитом: добавка учтена, несоответствие В/С поймано", () => {
    const r = buildRecipe(normalizeSlurryInput({
      name: "Облегчённый", density: 1.5, waterRatio: 0.7,
      additives: [{ name: "Бентонит", percentage: 8, percentageType: "bwoc" }],
    }), 20);
    expect(r.perM3.additives[0].sg).toBe(2.65);
    expect(r.perM3.additives[0].kgPerM3).toBeCloseTo(r.perM3.cementKg * 0.08, 6);
    const mass = r.perM3.cementKg + r.perM3.waterL + r.perM3.additives[0].kgPerM3;
    expect(mass).toBeCloseTo(1500, 0);
    expect(r.densityAtEntered).toBeGreaterThan(1.5); // 0.7 мало для 1.50
    expect(r.warnings.some((w) => w.includes("Введённое В/С"))).toBe(true);
  });
});
