import { describe, it, expect } from "vitest";
import {
  buildDisplacementSchedule,
  annularFrictionMPa, eccentricityFrictionFactor, calculatePressureProfile, calculateVolumes,
  annularVolumeForInterval, type WellData,
} from "./cementing-calculations";
import { normalizeSlurryInput, normalizeBufferFluid, normalizeDisplacementFluid } from "./cementing-normalizers";

describe("Трение в кольцевом зазоре", () => {
  it("ламинар Бингама: щелевая формула 48μv/Dh² + 6τ/Dh", () => {
    const Do = 215.9, Di = 168.3, L = 1000, pv = 100, yp = 10, Q = 2; // л/с — ламинарный режим
    const A = (Math.PI / 4) * ((Do / 1000) ** 2 - (Di / 1000) ** 2);
    const v = (Q / 1000) / A, Dh = (Do - Di) / 1000;
    const expected = ((48 * (pv / 1000) * v) / (Dh * Dh) + (6 * yp) / Dh) * L / 1e6;
    const r = annularFrictionMPa(Q, L, Do, Di, pv, yp, 1800, 100);
    expect(r.regime).toBe(0);
    expect(r.pressureMPa).toBeCloseTo(expected, 6);
  });

  it("эксцентриситет: при центрировании 100% поправки нет, при касании — снижение", () => {
    expect(eccentricityFrictionFactor(100, 0.78, 60, 8, 0)).toBeCloseTo(1, 6);
    const f67 = eccentricityFrictionFactor(67, 0.78, 60, 8, 0);
    const f20 = eccentricityFrictionFactor(20, 0.78, 60, 8, 0);
    expect(f67).toBeLessThan(1);
    expect(f20).toBeLessThan(f67);
    expect(f20).toBeGreaterThan(0.2);
  });

  it("эксцентриситет: формула Haciislamoglu для ламинара", () => {
    // n из PV/YP: θ300 = PV + YP/0.4788, θ600 = 2PV + YP/0.4788
    const pv = 30, yp = 10 * 0.4788; // YP = 10 lbf/100ft²
    const n = 3.32 * Math.log10((2 * pv + 10) / (pv + 10));
    const e = 0.5, K = 0.78;
    const expected = 1 - 0.072 * (e / n) * K ** 0.8454 - 1.5 * e * e * Math.sqrt(n) * K ** 0.1852 + 0.96 * e ** 3 * Math.sqrt(n) * K ** 0.2527;
    expect(eccentricityFrictionFactor(50, K, pv, yp, 0)).toBeCloseTo(expected, 6);
  });
});

describe("Симуляция цементирования: проверка по пластам", () => {
  const well: WellData = {
    wellDepthMD: 2500, wellDepthTVD: 2500, casingDepthMD: 2500, holeDiameter: 215.9, casingOD: 168.3, casingWall: 8.9,
    prevCasingDepth: 500, prevCasingOD: 244.5, prevCasingID: 226, ckodDepth: 2480, cementRiseHeight: 1500, cavernCoeff: 1.1,
    bottomTempStatic: 80, bottomTempCirc: 60, pumpZoneTop: 0, pumpZoneBottom: 0,
    trajectory: [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 2500, tvd: 2500, zenith: 0, azimuth: 0 }],
    reservoirLayers: [],
  };
  const cementVol = annularVolumeForInterval(1000, 2500, well.holeDiameter, well.casingOD, well.prevCasingID, well.prevCasingDepth, well.cavernCoeff);
  const slurries = [normalizeSlurryInput({ name: "Цемент", density: 1.85, topDepthMD: 1000, rheology: { pv: 60, yp: 8 }, flowRateSteps: [{ rateLps: 15, volumeM3: cementVol }], thickeningTime30Bc: 240 })];
  const buffers = [normalizeBufferFluid({ name: "Буфер", density: 1100, volume: 6, rheology: { pv: 20, yp: 10 }, flowRateSteps: [{ rateLps: 15, volumeM3: 6 }] })];
  const disp = [normalizeDisplacementFluid({ name: "Продавка", density: 1100, rheology: { pv: 15, yp: 5 }, flowRateSteps: [{ rateLps: 15, volumeM3: 100 }] })];
  const mud = { name: "Раствор", density: 1200, rheology: { pv: 25, yp: 12 }, fluidLoss: 6 };

  const run = (w: WellData) => {
    const vols = calculateVolumes(w, slurries, 1.0);
    return calculatePressureProfile(w, slurries, buffers, mud, disp, 18.5, vols.displacementVolumeWithCompression, 0, 0);
  };

  it("на забое всегда есть точка проверки по общему градиенту ГРП", () => {
    const r = run(well);
    expect(r.zoneChecks[0].name).toContain("Забой");
    expect(r.zoneChecks[0].limitMPa).toBeCloseTo((18.5 * 2500) / 1000, 6);
    expect(r.zoneChecks[0].maxPressureMPa).toBeGreaterThan(0);
  });

  it("слабый пласт выше забоя ловится, хотя на забое запас есть", () => {
    const weak: WellData = { ...well, reservoirLayers: [{ name: "Слабый", topMD: 1200, bottomMD: 1220, porePressureGrad: 10, fracGrad: 16, absorbGrad: 12.5, fluidType: "вода" }] };
    const r = run(weak);
    const z = r.zoneChecks.find((c) => c.name.startsWith("Слабый"))!;
    expect(z.limitKind).toBe("поглощение");
    expect(z.marginMPa).toBeLessThan(0);
  });

  it("плохое центрирование снижает трение и давление на забое", () => {
    const good = run({ ...well, annularStandoffPct: 100 });
    const bad = run({ ...well, annularStandoffPct: 30 });
    expect(bad.zoneChecks[0].maxPressureMPa).toBeLessThan(good.zoneChecks[0].maxPressureMPa);
  });
});

describe("многопорционная продавка", () => {
  const rh = { model: "bingham" as const, pv: 10, yp: 5 } as any;
  const df = (name: string, steps: { rateLps: number; volumeM3: number }[]) => ({ name, density: 1100, rheology: rh, flowRateSteps: steps, compressionCoeff: 1 });
  it("порции суммируются, автоостаток добирает общий объём", () => {
    const s = buildDisplacementSchedule([df("Буфер-продавка", [{ rateLps: 10, volumeM3: 3 }]), df("Раствор", [{ rateLps: 15, volumeM3: 0 }]), df("Вода", [{ rateLps: 8, volumeM3: 2 }])], 20);
    expect(s.map((x) => x.volumeM3)).toEqual([3, 15, 2]);
    expect(s.reduce((a, x) => a + x.volumeM3, 0)).toBeCloseTo(20, 9);
    expect(s[1].auto).toBe(true);
    expect(s.map((x) => x.fluidIndex)).toEqual([0, 1, 2]);
  });
  it("избыток заданных объёмов срезается с конца", () => {
    const s = buildDisplacementSchedule([df("A", [{ rateLps: 10, volumeM3: 12 }]), df("B", [{ rateLps: 10, volumeM3: 12 }])], 20);
    expect(s.reduce((a, x) => a + x.volumeM3, 0)).toBeCloseTo(20, 9);
    expect(s[0].volumeM3).toBe(12);
  });
});
