import { describe, it, expect } from "vitest";
import { calculateBalancedPlug, type PlugInputs } from "./cement-plug-calculations";

const A = (mm: number) => (Math.PI / 4) * (mm / 1000) ** 2;
const base = (o: Partial<PlugInputs> = {}): PlugInputs => ({
  well: {
    wellDepthMD: 3000, holeDiameter: 215.9, casingShoe: 2000, casingID: 150.4, pipeOD: 89, pipeID: 75.9, cavernCoeff: 1.2,
    trajectory: [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 3000, tvd: 3000, zenith: 0, azimuth: 0 }],
  },
  plug: { topMD: 2600, bottomMD: 2650 },
  cement: { name: "Цемент", density: 1.85, rheology: { pv: 50, yp: 10 } },
  spacer: { name: "Буфер", density: 1.1, rheology: { pv: 5, yp: 2 } },
  wellFluid: { name: "Раствор", density: 1.2, rheology: { pv: 15, yp: 5 } },
  spacerVolumeAboveM3: 0.3, spacerVolumeBelowM3: 0, safetyMarginM: 30, thickeningTimeMin: 180, pullOutAbovePlugM: 50,
  washType: "direct", washCycles: 2, tripSpeedMs: 0.3,
  pumpRateCementLs: 5, pumpRateSpacerLs: 5, pumpRateDisplacementLs: 8, pumpRateWashLs: 10,
  ...o,
});

describe("Цементный мост: установка на равновесии", () => {
  const bore = 215.9 * Math.sqrt(1.2);

  it("объём моста: сечение × длина, цемент делится между затрубьем и трубами без потерь", () => {
    const r = calculateBalancedPlug(base());
    expect(r.cementVolumeTotal).toBeCloseTo(A(bore) * 50, 3);
    expect(r.cementVolumeAnn + r.cementVolumePipe).toBeCloseTo(r.cementVolumeTotal, 2);
  });

  it("без недопродавки — точное равновесие, но предупреждение о мокром подъёме", () => {
    const r = calculateBalancedPlug(base({ underDisplacementM3: 0 }));
    expect(Math.abs(r.imbalanceMPa)).toBeLessThan(0.005);
    expect(r.isBalanced).toBe(true);
    expect(r.balanceNotes.some((n) => n.startsWith("Точное равновесие"))).toBe(true);
    // продавка = объём труб от устья до кровли буфера в трубах
    const spacerTopPipe = r.fluidColumns.find((c) => c.location === "pipe" && c.label.includes("труб. верх"))!.topMD;
    expect(r.displacementVolume).toBeCloseTo(A(75.9) * spacerTopPipe, 2);
  });

  it("недопродавка: продавка меньше, трубы тяжелее ровно на (Δhтр + Δhзатр)·(ρц − ρр)·g", () => {
    const r0 = calculateBalancedPlug(base({ underDisplacementM3: 0 }));
    const r = calculateBalancedPlug(base({ underDisplacementM3: 0.3 }));
    expect(r0.displacementVolume - r.displacementVolume).toBeCloseTo(0.3, 3);
    const dh = 0.3 / A(75.9) + 0.3 / (A(bore) - A(89));
    const expected = dh * (1.85 - 1.2) * 9.81 / 1000;
    expect(r.imbalanceMPa).toBeCloseTo(expected, 2);
    expect(r.pressurePipe).toBeGreaterThan(r.pressureAnnulus); // раньше давления всегда совпадали
    expect(r.cementHeightPipeMD).toBeGreaterThan(r.cementHeightAnnMD);
    expect(r.cementVolumeAnn + r.cementVolumePipe).toBeCloseTo(r.cementVolumeTotal, 2);
    // уровень в трубах после остановки: ΔP / (ρр·g·(1 + Sтр/Sзатр на устье))
    const sP = A(75.9), sA = A(150.4) - A(89);
    expect(r.uTubeLevelDropM).toBeCloseTo((r.imbalanceMPa * 1e6) / (1200 * 9.81 * (1 + sP / sA)), 0);
    expect(r.isBalanced).toBe(true);
  });

  it("слишком большая недопродавка — предупреждение о загрязнении кровли", () => {
    const r = calculateBalancedPlug(base({ underDisplacementM3: 1.2 }));
    expect(r.balanceNotes.some((n) => n.startsWith("Недопродавка больше обычной"))).toBe(true);
  });

  it("запас на загрязнение поднимает кровлю по объёму", () => {
    const r = calculateBalancedPlug(base({ contaminationExcessPct: 10 }));
    expect(r.cementVolumeTotal).toBeCloseTo(r.cementVolumeDesign * 1.1, 2);
    expect(r.plugTopByVolumeMD).toBeCloseTo(2650 - 55, 0);
  });

  it("наклонный ствол: статика по TVD", () => {
    const traj = [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 1000, tvd: 1000, zenith: 0, azimuth: 0 }, { md: 3000, tvd: 2600, zenith: 40, azimuth: 0 }];
    const r = calculateBalancedPlug(base({ well: { ...base().well, trajectory: traj }, underDisplacementM3: 0 }));
    expect(r.plugLengthTVD).toBeLessThan(50);
    expect(Math.abs(r.imbalanceMPa)).toBeLessThan(0.005);
  });
});

describe("Цементный мост: промывка", () => {
  it("затрубье выше башмака считается по ВД обсадной колонны, а не по стволу", () => {
    const r = calculateBalancedPlug(base({ washCycles: 1 }));
    const ann = (A(150.4) - A(89)) * 2000 + (A(215.9 * Math.sqrt(1.2)) - A(89)) * (2550 - 2000);
    expect(r.washVolumeM3).toBeCloseTo(ann, 1);
  });
});
