import { describe, expect, it } from "vitest";
import { calculateSectionalPipeFrictionV2 } from "./advanced-pipe-hydraulics-v2";
import { pipeFrictionMPa } from "./cementing-calculations";

const base = {
  fromMD: 0, toMD: 2000, casingODmm: 168.3, defaultWallMm: 8.9,
  flowRateLps: 15, densityKgM3: 1200, rheology: { pv: 30, yp: 7 },
};

describe("Advanced pipe hydraulics V2 (isolated)", () => {
  it("matches the original pipe friction when diameter is constant", () => {
    const r = calculateSectionalPipeFrictionV2(base);
    const old = pipeFrictionMPa(15, 2000, 168.3 - 2 * 8.9, 30, 7, 1200);
    expect(r.totalPressureLossMPa).toBeCloseTo(old.pressureMPa, 9);
    expect(r.segments).toHaveLength(1);
  });

  it("sums exact section friction rather than using an averaged ID", () => {
    const r = calculateSectionalPipeFrictionV2({
      ...base, sections: [{ fromMD: 500, toMD: 1500, wallThickness: 12.0 }],
    });
    const wide = pipeFrictionMPa(15, 1000, 150.5, 30, 7, 1200).pressureMPa;
    const narrow = pipeFrictionMPa(15, 1000, 144.3, 30, 7, 1200).pressureMPa;
    expect(r.totalPressureLossMPa).toBeCloseTo(wide + narrow, 9);
    expect(r.segments.map(x => x.lengthM)).toEqual([500, 1000, 500]);
    expect(r.segments.map(x => x.insideDiameterMm)).toEqual([150.5, 144.3, 150.5]);
  });

  it("matches an independently computed laminar Bingham reference in MPa", () => {
    // Q=0.015 m3/s, rho=1200 kg/m3, PV=0.030 Pa*s, YP=7 Pa.
    // For D=150.5 mm: Re≈639, ΔP≈0.283799716506 MPa per 1000 m.
    // For D=144.3 mm: Re≈744, ΔP≈0.301007298701 MPa per 1000 m.
    const r = calculateSectionalPipeFrictionV2({
      ...base, sections: [{ fromMD: 500, toMD: 1500, wallThickness: 12 }],
    });
    expect(r.totalPressureLossMPa).toBeCloseTo(0.5848070152075, 9);
    expect(r.segments[0].pressureLossMPa + r.segments[2].pressureLossMPa).toBeCloseTo(0.2837997165062, 9);
    expect(r.segments[1].pressureLossMPa).toBeCloseTo(0.3010072987013, 9);
    expect(r.segments.every(x => x.regime === 0)).toBe(true);
  });

  it("uses default thickness in gaps and clips sections at range boundaries", () => {
    const r = calculateSectionalPipeFrictionV2({
      ...base, fromMD: 600, toMD: 1300,
      sections: [{ fromMD: 200, toMD: 800, wallThickness: 10 }],
    });
    expect(r.segments.map(x => [x.fromMD, x.toMD])).toEqual([[600, 800], [800, 1300]]);
  });

  it("returns zero friction for zero flow", () => {
    const r = calculateSectionalPipeFrictionV2({ ...base, flowRateLps: 0 });
    expect(r.totalPressureLossMPa).toBe(0);
  });

  it("rejects overlapping sections and nonphysical diameters", () => {
    expect(() => calculateSectionalPipeFrictionV2({
      ...base, sections: [
        { fromMD: 0, toMD: 1000, wallThickness: 9 },
        { fromMD: 900, toMD: 1800, wallThickness: 10 },
      ],
    })).toThrow();
    expect(() => calculateSectionalPipeFrictionV2({ ...base, defaultWallMm: 85 })).toThrow();
  });
});
