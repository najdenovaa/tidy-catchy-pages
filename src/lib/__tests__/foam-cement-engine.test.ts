import { describe, it, expect } from "vitest";
import {
  defaultFoamSettings,
  designFoamJob,
  simulateFoamJob,
  validateFoamJob,
  sizeFoamPlacement,
} from "../foam-cement-engine";
import {
  FOAM_ATM,
  nitrogenZ,
  nitrogenVolumeFactor,
  mixtureAt,
  ratioFromQuality,
} from "../foam-cement-physics";
import type { WellData } from "../cementing-calculations";
export const well: WellData = {
  wellDepthMD: 2000,
  wellDepthTVD: 2000,
  casingDepthMD: 2000,
  holeDiameter: 215.9,
  casingOD: 168.3,
  casingWall: 8.9,
  prevCasingDepth: 300,
  prevCasingID: 250,
  prevCasingOD: 273,
  ckodDepth: 1980,
  cementRiseHeight: 2000,
  cavernCoeff: 1,
  bottomTempStatic: 80,
  bottomTempCirc: 55,
  pumpZoneTop: 0,
  pumpZoneBottom: 0,
  trajectory: [
    { md: 0, tvd: 0, zenith: 0, azimuth: 0 },
    { md: 2000, tvd: 2000, zenith: 0, azimuth: 0 },
  ],
};
export const job = () => ({
  wellData: structuredClone(well),
  mudDensity: 1.2,
  settings: {
    ...defaultFoamSettings({ wellData: well }),
    spatialCells: 24,
    timeStepMin: 1,
    finalHoldMin: 1,
  },
});
describe("Foam engineering physics", () => {
  it("uses absolute pressure and explicit standard conditions", () => {
    expect(nitrogenZ(0.00001, 20)).toBeCloseTo(1, 4);
    expect(nitrogenVolumeFactor(FOAM_ATM, 20, 20)).toBeCloseTo(1, 10);
    expect(() => nitrogenZ(0, 20)).toThrow();
    for (const p of [0.101325, 5, 20, 50]) {
      const r = ratioFromQuality(30, p, 80);
      expect(mixtureAt(1.9, r, p, 80).qualityPct).toBeCloseTo(30, 9);
    }
  });
  it("accepts zero gauge backpressure without NaN", () => {
    const j = job();
    j.settings.backPressure = 0;
    const d = designFoamJob(j);
    expect(
      d.points.every((p) => Number.isFinite(p.density) && p.pressureMPaAbs > 0),
    ).toBe(true);
  });
  it("rejects incompatible geometry and invalid imports", () => {
    const j = job();
    j.wellData.holeDiameter = 160;
    expect(validateFoamJob(j).length).toBeGreaterThan(0);
    expect(() => simulateFoamJob(j)).toThrow();
  });
  it("zero gas integrates exact segmented geometry", () => {
    const j = job();
    j.settings.targetFoamQuality = 0;
    const d = designFoamJob(j);
    const expected =
      (Math.PI / 4) *
      ((0.25 ** 2 - 0.1683 ** 2) * 300 + (0.2159 ** 2 - 0.1683 ** 2) * 1700);
    expect(d.baseSlurryM3).toBeCloseTo(expected, 8);
    expect(d.n2StdM3).toBe(0);
  });
  it("carries foam through shoe, buffers ahead, and conserves gas and base", () => {
    const r = simulateFoamJob(job());
    expect(r.summary.finalFoamAnnulusM3).toBeGreaterThan(5);
    expect(r.summary.maxGasBalanceErrorPct).toBeLessThan(0.001);
    expect(r.summary.maxBaseBalanceErrorPct).toBeLessThan(0.001);
    const ann = r.frames.at(-1)!.cells.filter((c) => c.leg === "annulus");
    const buf = ann.filter((c) => c.fractions.buffer > 0.5);
    const foam = ann.filter((c) => c.fractions.foam > 0.5);
    if (buf.length && foam.length)
      expect(Math.min(...buf.map((c) => c.md))).toBeLessThan(
        Math.max(...foam.map((c) => c.md)),
      );
  });
  it("separates friction and static ECD, and stops nitrogen during holds", () => {
    const j = job();
    j.settings.pauseAfterFoamMin = 2;
    const r = simulateFoamJob(j);
    expect(r.frames.some((f) => f.dynamicECD > f.staticECD + 0.001)).toBe(true);
    expect(
      r.frames
        .filter((f) => f.stage.includes("Остановка"))
        .every((f) => f.liquidRateLps === 0 && f.n2RateStdM3Min === 0),
    ).toBe(true);
  });
});

describe("Foam placement regression and sensitivity", () => {
  it("accounts for depth-dependent casing wall and cavern intervals", () => {
    const j = job();
    j.wellData.casingSections = [
      { fromMD: 500, toMD: 1000, wallThickness: 12 },
    ];
    j.wellData.cavernIntervals = [{ fromMD: 600, toMD: 900, coeff: 1.3 }];
    const a = designFoamJob(job()),
      b = designFoamJob(j);
    expect(b.pipeCapacityM3).toBeLessThan(a.pipeCapacityM3);
    expect(b.annulusVolumeM3).toBeGreaterThan(a.annulusVolumeM3);
  });
  it("increased rate raises hydraulic losses", () => {
    const a = job();
    a.settings.targetFoamQuality = 0;
    const b = structuredClone(a);
    b.settings.pumpRateLps = 15;
    expect(simulateFoamJob(b).summary.maxPumpPressureMPa).toBeGreaterThan(
      simulateFoamJob(a).summary.maxPumpPressureMPa,
    );
  });
  it("zone FQ produces different transported nitrogen ratios", () => {
    const j = job();
    j.settings.zones = [
      { topMD: 0, bottomMD: 1000, targetFQ: 15 },
      { topMD: 1000, bottomMD: 2000, targetFQ: 35 },
    ];
    const r = simulateFoamJob(j);
    const foamStages = r.design.stages.filter((s) => s.kind === "foam");
    expect(foamStages.length).toBe(2);
    expect(foamStages[0].gasStdPerBase).toBeLessThan(
      foamStages[1].gasStdPerBase,
    );
    expect(r.summary.maxGasBalanceErrorPct).toBeLessThan(0.001);
  });
  it("constant density accounts for mass of compressed nitrogen", () => {
    const j = job();
    j.settings.controlMode = "constant-density";
    j.settings.targetDensity = 1.5;
    const d = designFoamJob(j);
    expect(d.points.every((p) => Math.abs(p.density - 1.5) < 0.001)).toBe(true);
    expect(d.stages.filter((s) => s.kind === "foam").length).toBeGreaterThan(2);
  });
  it("changes base and nitrogen with explicit reference depth", () => {
    const a = job(),
      b = job();
    a.settings.referenceMode = "generator";
    a.settings.referencePressureMPa = 1;
    b.settings.referenceMode = "depth";
    const da = designFoamJob(a),
      db = designFoamJob(b);
    expect(db.n2StdM3).toBeGreaterThan(da.n2StdM3);
  });
  it("uses only lab rows prepared under pressure", () => {
    const a = job();
    a.settings.lab = [
      {
        id: "1",
        source: "Test protocol",
        preparation: "atmospheric",
        pressureMPaAbs: 0.1,
        temperatureC: 20,
        qualityPct: 25,
        pvCp: 400,
        ypPa: 90,
      },
    ];
    const r = simulateFoamJob(a);
    expect(r.warnings.some((w) => w.includes("не используются"))).toBe(true);
  });
  it("holds nitrogen mass when backpressure compresses the foam", () => {
    const a = job();
    a.settings.backPressure = 3;
    const r = simulateFoamJob(a);
    expect(r.summary.maxGasBalanceErrorPct).toBeLessThan(0.001);
    expect(
      r.frames.every((f) => f.cells.every((c) => Number.isFinite(c.density))),
    ).toBe(true);
  });
  it("time refinement retains conservation and comparable final placement", () => {
    const a = job();
    a.settings.timeStepMin = 0.5;
    const b = job();
    b.settings.timeStepMin = 1;
    const x = simulateFoamJob(a),
      y = simulateFoamJob(b);
    expect(
      Math.abs(x.summary.finalFoamAnnulusM3 - y.summary.finalFoamAnnulusM3) /
        x.summary.finalFoamAnnulusM3,
    ).toBeLessThan(0.05);
    expect(x.summary.maxGasBalanceErrorPct).toBeLessThan(0.001);
  });
  it("applies equipment constraints instead of a universal stability verdict", () => {
    const j = job();
    j.settings.maxN2RateStdM3Min = 1;
    j.settings.maxPumpPressureMPa = 0.1;
    const r = simulateFoamJob(j);
    expect(r.constraints.filter((c) => !c.pass).length).toBeGreaterThanOrEqual(
      2,
    );
  });
});

describe("Volume sizing", () => {
  it("solves placement against dynamic rather than static TOC", () => {
    const j = job();
    j.settings.cementTopMD = 300;
    const r = sizeFoamPlacement(j);
    expect(r.summary.finalTOCMD).not.toBeNull();
    expect(r.summary.finalTOCMD!).toBeLessThanOrEqual(300);
    expect(r.input.settings.foamVolumeMultiplier).toBeGreaterThanOrEqual(0.2);
    const reduced = structuredClone(r.input);
    reduced.settings.foamVolumeMultiplier *= 0.95;
    expect(simulateFoamJob(reduced).summary.finalTOCMD!).toBeGreaterThan(300);
    expect(r.summary.maxGasBalanceErrorPct).toBeLessThan(0.001);
    expect(r.constraints.find((c) => c.label.includes("кровли"))?.pass).toBe(
      true,
    );
  });
});
