import { describe, it, expect } from "vitest";
import {
  importLab,
  importObservations,
  compareFoamFact,
  readFoamProject,
  LAB_HEADERS,
  FACT_HEADERS,
  csv,
} from "../foam-cement-data";
import {
  FOAM_MODEL_VERSION,
  simulateFoamJob,
  defaultFoamSettings,
} from "../foam-cement-engine";
import type { WellData } from "../cementing-calculations";
const well = {
  wellDepthMD: 1000,
  wellDepthTVD: 1000,
  casingDepthMD: 1000,
  holeDiameter: 215.9,
  casingOD: 168.3,
  casingWall: 8.9,
  prevCasingDepth: 200,
  prevCasingID: 250,
  prevCasingOD: 273,
  ckodDepth: 980,
  cementRiseHeight: 1000,
  cavernCoeff: 1,
  bottomTempStatic: 60,
  bottomTempCirc: 40,
  pumpZoneTop: 0,
  pumpZoneBottom: 0,
  trajectory: [
    { md: 0, tvd: 0, zenith: 0, azimuth: 0 },
    { md: 1000, tvd: 1000, zenith: 0, azimuth: 0 },
  ],
} satisfies WellData;
const input = () => ({
  wellData: well,
  mudDensity: 1.2,
  settings: {
    ...defaultFoamSettings({ wellData: well }),
    spatialCells: 16,
    timeStepMin: 1,
  },
});
describe("Foam data exchange", () => {
  it("imports semicolon CSV with decimal comma and quoted source", () => {
    const r = importLab(
      LAB_HEADERS + '\n1;"Протокол; №1";pressurized;10;60;25;"42,5";7;;;;',
    );
    expect(r[0].pvCp).toBe(42.5);
    expect(r[0].source).toBe("Протокол; №1");
  });
  it("does not invent empty laboratory measurements", () => {
    expect(importLab(LAB_HEADERS + "\n")).toEqual([]);
    expect(() =>
      importLab(LAB_HEADERS + "\n1;source;pressurized;;60;25;42;7;;;;"),
    ).toThrow();
  });
  it("rejects negative measured values and duplicate timestamps", () => {
    expect(() => importObservations(FACT_HEADERS + "\n0;-1;;;;")).toThrow();
    expect(() =>
      importObservations(
        '[{"timeMin":0,"pumpPressureMPa":1},{"timeMin":0,"pumpPressureMPa":2}]',
      ),
    ).toThrow();
  });
  it("roundtrips properly escaped data without executing formulas", () => {
    const s = csv([{ source: 'a; "b"', pvCp: 42 }]);
    expect(s).toContain('"a; ""b"""');
  });
  it("imports settings while retaining current project geometry", () => {
    const j = input();
    const raw = {
      modelVersion: FOAM_MODEL_VERSION,
      input: { ...j, wellData: { ...well, casingDepthMD: 800 } },
    };
    expect(readFoamProject(JSON.stringify(raw), j).wellData.casingDepthMD).toBe(
      1000,
    );
    expect(() => readFoamProject('{"modelVersion":"x"}', j)).toThrow();
  });
  it("exact planned observations produce zero RMSE; excludes out-of-range times", () => {
    const r = simulateFoamJob(input());
    const points = r.frames
      .filter((_, i) => i % 3 === 0)
      .map((f) => ({
        timeMin: f.time,
        pumpPressureMPa: f.pumpPressureMPa,
        n2RateStdM3Min: f.n2RateStdM3Min,
      }));
    const fact = compareFoamFact(r, [
      ...points,
      { timeMin: 999, pumpPressureMPa: 30 },
    ]);
    expect(fact.pressureRMSE).toBeLessThan(1e-9);
    expect(fact.warnings.some((w) => w.includes("исключена"))).toBe(true);
    expect(fact.measuredN2StdM3).toBeCloseTo(fact.plannedN2SamePeriodStdM3, 8);
  });
  it("fits a known friction multiplier from independent synthetic residuals", () => {
    const r = simulateFoamJob(input());
    const points = r.frames
      .filter((f) => f.liquidRateLps > 0 && f.hydroPumpPressureMPa >= 0)
      .map((f) => ({
        timeMin: f.time,
        pumpPressureMPa:
          f.hydroPumpPressureMPa +
          1.3 * (f.pumpPressureMPa - f.hydroPumpPressureMPa),
      }));
    const fact = compareFoamFact(r, points);
    expect(fact.suggestedFrictionMultiplier).toBeCloseTo(1.3, 6);
  });
});
