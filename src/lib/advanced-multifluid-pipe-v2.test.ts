import { describe, expect, it } from "vitest";
import { calculateMultiFluidPipeFrictionV2 } from "./advanced-multifluid-pipe-v2";
import { pipeFrictionMPa } from "./cementing-calculations";

const geom = { fromMD: 0, toMD: 2000, casingODmm: 168.3, defaultWallMm: 8.9, flowRateLps: 15,
  sections: [{ fromMD: 500, toMD: 1500, wallThickness: 12 }] };
const fluids = [
  { fromMD: 0, toMD: 1000, name: "Water", densityKgM3: 1000, rheology: { pv: 1, yp: 0 } },
  { fromMD: 1000, toMD: 2000, name: "Cement", densityKgM3: 1850, rheology: { pv: 60, yp: 8 } },
];
describe("V2 multiple fluids in sectional pipe", () => {
  it("splits at both casing and fluid boundaries and sums independent losses", () => {
    const result = calculateMultiFluidPipeFrictionV2(geom, fluids);
    expect(result.segments.map(s => [s.fromMD, s.toMD, s.fluidName]))
      .toEqual([[0, 500, "Water"], [500, 1000, "Water"], [1000, 1500, "Cement"], [1500, 2000, "Cement"]]);
    const expected = pipeFrictionMPa(15, 500, 150.5, 1, 0, 1000).pressureMPa
      + pipeFrictionMPa(15, 500, 144.3, 1, 0, 1000).pressureMPa
      + pipeFrictionMPa(15, 500, 144.3, 60, 8, 1850).pressureMPa
      + pipeFrictionMPa(15, 500, 150.5, 60, 8, 1850).pressureMPa;
    expect(result.pressureLossMPa).toBeCloseTo(expected, 9);
  });
  it("single fluid reduces to sectional V2", () => {
    const r = calculateMultiFluidPipeFrictionV2(geom, [
      { ...fluids[0], toMD: 2000 },
    ]);
    expect(r.segments).toHaveLength(3);
    expect(r.pressureLossMPa).toBeGreaterThan(0);
  });
  it("rejects gaps, overlaps, and incomplete coverage", () => {
    expect(() => calculateMultiFluidPipeFrictionV2(geom, [{ ...fluids[0], toMD: 900 }, fluids[1]])).toThrow();
    expect(() => calculateMultiFluidPipeFrictionV2(geom, [{ ...fluids[0], toMD: 1100 }, fluids[1]])).toThrow();
    expect(() => calculateMultiFluidPipeFrictionV2(geom, [{ ...fluids[0], fromMD: 100 }])).toThrow();
  });
  it("zero rate produces zero friction", () => {
    const r = calculateMultiFluidPipeFrictionV2({ ...geom, flowRateLps: 0 }, fluids);
    expect(r.pressureLossMPa).toBe(0);
  });
});
