import { describe, it, expect } from "vitest";
import { analyzeSkc, syntheticSkcCsv } from "./skc-analysis";
import { parseText, guessMapping, toSeries } from "./skc-import";
import { calculatePressureProfile, calculateVolumes, type WellData } from "./cementing-calculations";
import { normalizeSlurryInput, normalizeBufferFluid, normalizeDisplacementFluid } from "./cementing-normalizers";

const well: WellData = {
  wellDepthMD: 2600, wellDepthTVD: 2450, casingDepthMD: 2600, holeDiameter: 215.9, casingOD: 168.3, casingWall: 8.9, prevCasingDepth: 800, prevCasingOD: 244.5, prevCasingID: 226,
  ckodDepth: 2580, cementRiseHeight: 0, cavernCoeff: 1.15, bottomTempStatic: 92, bottomTempCirc: 0, pumpZoneTop: 0, pumpZoneBottom: 0,
  trajectory: [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 800, tvd: 800, zenith: 0, azimuth: 0 }, { md: 1600, tvd: 1520, zenith: 35, azimuth: 90 }, { md: 2600, tvd: 2450, zenith: 38, azimuth: 90 }],
  reservoirLayers: [{ name: "БС10", topMD: 2450, bottomMD: 2480, porePressureGrad: 10.2, fracGrad: 18.5, absorbGrad: 17.6, fluidType: "нефть" }],
};
const slurries = [normalizeSlurryInput({ name: "Л", density: 1.5, topDepthMD: 0, rheology: { pv: 40, yp: 10 }, flowRateSteps: [{ rateLps: 15, volumeM3: 0 }] }), normalizeSlurryInput({ name: "G", density: 1.9, topDepthMD: 2200, rheology: { pv: 90, yp: 24 }, flowRateSteps: [{ rateLps: 15, volumeM3: 0 }] })];
const buffers = [normalizeBufferFluid({ name: "МБП", density: 1300, volume: 6, rheology: { pv: 20, yp: 12 }, flowRateSteps: [{ rateLps: 12, volumeM3: 6 }] })];
const disps = [normalizeDisplacementFluid({ name: "П", density: 1180, rheology: { pv: 22, yp: 9 }, flowRateSteps: [{ rateLps: 14, volumeM3: 40 }, { rateLps: 4, volumeM3: 2 }] })];
const mud = { name: "ПГР", density: 1180, rheology: { pv: 22, yp: 9 }, fluidLoss: 5 };
const volumes = calculateVolumes(well, slurries, 1);
const plan = calculatePressureProfile(well, slurries, buffers, mud, disps, 18, volumes.displacementVolumeWithCompression, 10, 0, { fast: true });
const run = (csv: string) => {
  const raw = parseText(csv);
  const s = toSeries(raw, guessMapping(raw));
  return analyzeSkc({ series: s.points, plan, slurries, buffers, displacementFluids: disps, drillingFluid: mud, volumes, plugBumpMPa: 1.5, volumeOffsetM3: null });
};

describe("Импорт записи СКЦ", () => {
  it("распознаёт колонки и единицы (атм, м³/мин, кг/м³, запятая, переход через полночь)", () => {
    const csv = [
      "Станция СКЦ-2М; скважина 123", "",
      "Время\tДавление, атм\tРасход, м3/мин\tПлотность, кг/м3",
      "23:59:50\t10,0\t0,6\t1180", "23:59:55\t20,0\t0,6\t1180", "00:00:00\t30,0\t0,6\t1500", "00:00:05\t40,0\t0,6\t1500",
      "00:00:10\t50,0\t0,6\t1500", "00:00:15\t60,0\t0,6\t1500", "00:00:20\t70,0\t0,6\t1500", "00:00:25\t80,0\t0,6\t1500",
      "00:00:30\t90,0\t0,6\t1500", "00:00:35\t100,0\t0,6\t1500",
    ].join("\n");
    const raw = parseText(csv);
    const m = guessMapping(raw);
    expect(m.columns).toEqual({ time: 0, pressure: 1, rate: 2, density: 3 });
    expect(m.units.pressure).toBe("атм"); expect(m.units.rate).toBe("м³/мин"); expect(m.units.density).toBe("кг/м³");
    const s = toSeries(raw, m);
    expect(s.points[2].t).toBeCloseTo(10 / 60, 6); // через полночь
    expect(s.points[0].p).toBeCloseTo(1.01325, 4);
    expect(s.points[0].q).toBeCloseTo(10, 6);
    expect(s.points[2].rho).toBeCloseTo(1.5, 6);
    expect(s.volumeSource).toBe("интеграл расхода");
    expect(s.points[9].v).toBeCloseTo(10 * 45 / 1000, 6);
  });
});

describe("Сравнение с расчётом", () => {
  it("калибровка находит заложенный множитель трения; без отклонений — нет поглощения", () => {
    const a = run(syntheticSkcCsv(plan, { frictionK: 1.3 }));
    expect(a.offsetSource).toBe("плотность цемента");
    expect(a.calibration.kFriction).toBeGreaterThan(1.2);
    expect(a.calibration.kFriction).toBeLessThan(1.4);
    expect(a.events.some((e) => e.title.includes("поглощение"))).toBe(false);
    expect(a.plug.detected).toBe(true);
    expect(Math.abs(a.plug.deviationPct!)).toBeLessThan(1.5);
  });

  it("поглощение во время продавки обнаруживается, верх цемента — ниже проекта", () => {
    const cemOut = plan.points.find((p) => p.annCementHeightM > 1)!.cumulativeVolume;
    const a = run(syntheticSkcCsv(plan, { frictionK: 1.0, lossFromV: cemOut + 10, lossMPa: 3 }));
    const loss = a.events.find((e) => e.title.includes("поглощение"))!;
    expect(loss.level).toBe("critical");
    expect(loss.fromV!).toBeGreaterThan(cemOut + 5);
    expect(a.tocEstimate!.shiftM).toBeGreaterThan(100);
  });

  it("плотность цемента вне допуска", () => {
    const a = run(syntheticSkcCsv(plan, { frictionK: 1.0, densityNoise: 0.08 }));
    const c = a.cement.find((x) => x.name === "G")!;
    expect(c.outOfSpecM3).toBeGreaterThan(1);
  });
});

describe("Калибровка в расчёте", () => {
  it("множитель трения увеличивает давление при закачке", () => {
    const p2 = calculatePressureProfile({ ...well, frictionCalibration: 1.5 }, slurries, buffers, mud, disps, 18, volumes.displacementVolumeWithCompression, 10, 0, { fast: true });
    const max = (pr: typeof plan) => Math.max(...pr.points.map((p) => p.surfacePressure));
    expect(max(p2)).toBeGreaterThan(max(plan));
    const st = plan.points.find((p) => p.pumpRateLps > 0)!;
    expect(st.surfaceStaticMPa).toBeDefined();
  });
});
