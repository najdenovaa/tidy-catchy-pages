import { describe, it, expect } from "vitest";
import { simulateDisplacement2D, type D2Fluid } from "./displacement-2d";
import { buildDisplacementInput } from "./displacement-2d-input";
import { calculateVolumes, type WellData } from "./cementing-calculations";
import { normalizeSlurryInput, normalizeBufferFluid, normalizeDisplacementFluid } from "./cementing-normalizers";

const mud: D2Fluid = { name: "ОБР", density: 1200, pv: 0.025, yp: 10, kind: "mud" };
const sp: D2Fluid = { name: "Буфер", density: 1300, pv: 0.02, yp: 5, kind: "spacer" };
const cem: D2Fluid = { name: "Цемент", density: 1850, pv: 0.06, yp: 12, kind: "cement" };
const sim = (standoff: number, incl: number, fl: D2Fluid[], rate = 0.012) => simulateDisplacement2D({
  zTop: 1500, zBot: 2500, nZ: 60, nTheta: 12, geom: () => ({ rHole: 0.108, rCasing: 0.073, standoff, inclDeg: incl }), fluids: fl,
  stages: [{ fluid: 1, volumeM3: 4, rateM3s: rate }, { fluid: 2, volumeM3: 15, rateM3s: rate }],
});
const narrowWide = (r: ReturnType<typeof sim>, j: number) => {
  const cemF = r.fluids.map((f) => f.kind === "cement");
  const at = (i: number) => r.finalFrac.reduce((a, fr, f) => a + (cemF[f] ? fr[j * r.nTheta + i] : 0), 0);
  return { wide: at(0), narrow: at(r.nTheta - 1) };
};

describe("2D-модель вытеснения в затрубье", () => {
  it("концентрично и вертикально — ровный фронт, баланс объёмов", () => {
    const r = sim(1, 0, [mud, sp, cem]);
    const j = Math.floor(r.nZ * 0.8);
    const { wide, narrow } = narrowWide(r, j);
    expect(Math.abs(wide - narrow)).toBeLessThan(0.02);
    expect(Math.abs(r.summary.massBalanceErrPct)).toBeLessThan(0.1);
    expect(r.summary.cementFillPct).toBeGreaterThan(97);
  });
  it("равные плотности и эксцентриситет — канал раствора на узкой стороне", () => {
    const r = sim(0.3, 0, [mud, { ...sp, density: 1200 }, { ...cem, density: 1250 }]);
    const j = Math.floor(r.nZ * 0.8);
    const { wide, narrow } = narrowWide(r, j);
    expect(wide - narrow).toBeGreaterThan(0.1);
    expect(r.summary.channelM).toBeGreaterThan(0);
  });
  it("иерархия плотностей улучшает вытеснение", () => {
    const eq = sim(0.3, 0, [mud, { ...sp, density: 1200 }, { ...cem, density: 1250 }]);
    const good = sim(0.3, 0, [mud, sp, cem]);
    expect(good.summary.cementFillPct).toBeGreaterThan(eq.summary.cementFillPct);
    expect(good.summary.mudLeftPct).toBeLessThan(eq.summary.mudLeftPct);
  });
  it("лёгкий цемент в наклонном стволе — раствор остаётся на нижней (узкой) стороне", () => {
    const r = sim(0.3, 60, [{ ...mud, density: 1500, yp: 15 }, { ...sp, density: 1400 }, { ...cem, density: 1450 }], 0.008);
    const j = Math.floor(r.nZ * 0.8);
    const { wide, narrow } = narrowWide(r, j);
    expect(narrow).toBeLessThan(0.3);
    expect(wide).toBeGreaterThan(0.8);
    expect(r.summary.mudLeftPct).toBeGreaterThan(15);
  });
  it("сборка из программы: в затрубье выходят буфер и цемент за вычетом стакана ниже ЦКОД", () => {
    const well = { wellDepthMD: 2500, wellDepthTVD: 2500, casingDepthMD: 2490, holeDiameter: 215.9, casingOD: 168.3, casingWall: 8.9, prevCasingDepth: 500, prevCasingOD: 244.5, prevCasingID: 226, ckodDepth: 2470, cementRiseHeight: 1500, cavernCoeff: 1.1, bottomTempStatic: 80, bottomTempCirc: 60, pumpZoneTop: 0, pumpZoneBottom: 0,
      trajectory: [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 2500, tvd: 2500, zenith: 0, azimuth: 0 }], reservoirLayers: [] } as WellData;
    const slurries = [normalizeSlurryInput({ name: "Цемент", density: 1.85, topDepthMD: 1600, rheology: { pv: 60, yp: 8 }, flowRateSteps: [{ rateLps: 12, volumeM3: 0 }] })];
    const buffers = [normalizeBufferFluid({ name: "Буфер", density: 1250, volume: 5, rheology: { pv: 15, yp: 6 }, flowRateSteps: [{ rateLps: 12, volumeM3: 5 }] })];
    const disp = [normalizeDisplacementFluid({ name: "Продавка", density: 1100, rheology: { pv: 10, yp: 3 }, flowRateSteps: [{ rateLps: 14, volumeM3: 0 }] })];
    const volumes = calculateVolumes(well, slurries, 1);
    const { input, meta } = buildDisplacementInput({ wellData: well, slurries, buffers, drillingFluid: { name: "Р", density: 1200, rheology: { pv: 20, yp: 8 }, fluidLoss: 6 }, displacementFluids: disp, volumes });
    const byKind = (k: string) => input.stages.filter((s) => input.fluids[s.fluid].kind === k).reduce((a, s) => a + s.volumeM3, 0);
    expect(byKind("spacer")).toBeCloseTo(5, 3);
    expect(byKind("cement")).toBeLessThan(volumes.slurryVolumes[0].slurryVolumeM3);
    expect(byKind("cement")).toBeGreaterThan(volumes.slurryVolumes[0].slurryVolumeM3 * 0.97);
    expect(meta.annulusStartS).toBeGreaterThan(0);
    expect(input.zTop).toBeLessThan(1600);
    expect(meta.notes.some((n) => n.includes("центрирования"))).toBe(true);
  });
});
