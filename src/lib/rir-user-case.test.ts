import { describe, it, expect } from "vitest";
import { DEFAULT_RIR, calculateRir, type RirInputs } from "./rir-calculations";
import { simulateSqueeze } from "./rir-squeeze-sim";
import { screenCase } from "@/test/fixtures/rir-screenshot";
describe("Screenshot regression: РИР 168.3 / НКТ 73, 3 м³", () => {
  it("uses the mixed column and preserves a pressure ceiling despite an invalid lift", () => {
    const r = calculateRir(screenCase);
    expect(r.spotResult!.ok).toBe(false);
    expect(r.spotResult!.cementHydroMPa).toBeGreaterThan(24);
    expect(r.spotResult!.cementHydroMPa).toBeLessThan(26);
    expect(r.maxSurfaceMPa).toBeGreaterThan(15);
    expect(
      r.constraints.find((c) => c.name === r.governing)!.limitSurfaceMPa,
    ).toBeCloseTo(r.maxSurfaceMPa, 8);
    expect(r.spotResult!.recommendedLiftedShoeMD).toBeCloseTo(2044.37, 1);
    expect(r.fit!.J).toBeGreaterThan(0.49);
  });
  it("runs after the lift is explicitly corrected", () => {
    const initial = calculateRir(screenCase);
    const input = {
      ...screenCase,
      spot: {
        ...screenCase.spot,
        liftedShoeMD: initial.spotResult!.recommendedLiftedShoeMD,
      },
    };
    const res = calculateRir(input);
    expect(res.spotResult!.ok).toBe(true);
    const sim = simulateSqueeze(input, res, null);
    expect(sim.totalTimeMin).toBeGreaterThan(80);
    expect(sim.compInChannelM3).toBeGreaterThan(0);
  });
});

import { spotGeometry, calculateSpotSqueeze } from "./rir-spot-squeeze";
import { buildRirProgram, stageRegime } from "./rir-program";
import { planRir, autoDesignRir, applyVariant } from "./rir-autodesign";
function corrected() {
  const r = calculateRir(screenCase);
  return {
    ...screenCase,
    spot: {
      ...screenCase.spot,
      liftedShoeMD: r.spotResult!.recommendedLiftedShoeMD,
    },
  };
}
describe("Pressure, inventory and reporting consistency", () => {
  it("does not subtract full-depth cement hydrostatics for a spotted slug", () => {
    const i = corrected(),
      r = calculateRir(i),
      s = r.spotResult!;
    const expectedH =
      (9.81 / 1000) * (1.1 * 2205 + 0.75 * (2205 - s.slurryTopAfterLiftMD));
    expect(s.cementHydroMPa).toBeCloseTo(expectedH, 10);
    expect(r.maxSurfaceMPa).toBeCloseTo(0.95 * 0.02 * 2205 - expectedH, 9);
    expect(r.maxSurfaceWaterMPa).toBeCloseTo(
      0.95 * 0.02 * 2205 - (9.81 * 2205) / 1000,
      9,
    );
    expect(r.pressureBasis).toContain("Смешанный");
  });
  it("accounts for tubing displacement while the shoe remains immersed", () => {
    const r = calculateRir(screenCase),
      s = r.spotResult!,
      g = r.spotInput!;
    const outside =
      s.casingAreaM2 * (g.slurryBottomMD - g.liftedShoeMD) +
      s.annularAreaM2 * (g.liftedShoeMD - s.slurryTopAfterLiftMD);
    expect(outside).toBeCloseTo(3, 10);
    expect(s.slurryTopAfterLiftMD).toBeLessThan(s.slurryTopFullyWithdrawnMD);
  });
  it("balanced placement includes cement in tubing and reduces displacement volume", () => {
    const a = corrected(),
      i = { ...a, spot: { ...a.spot, placementMode: "balanced" as const } },
      r = calculateRir(i),
      s = r.spotResult!,
      g = r.spotInput!;
    const shape = spotGeometry(g, g.initialShoeMD, 3);
    expect(shape.slurryInTubingM3).toBeGreaterThan(0);
    expect(s.placementDisplacementM3 + shape.slurryInTubingM3).toBeCloseTo(
      s.tubingCapacityBeforeM3,
      9,
    );
    const sim = simulateSqueeze(i, r, null);
    const p = sim.points.filter((p) => p.stage.startsWith("Продавка")).at(-1)!;
    expect(p.openTubing!.totalSlurryM3).toBeCloseTo(3, 8);
    expect(p.openTubing!.slurryInTubingM3).toBeCloseTo(
      shape.slurryInTubingM3,
      8,
    );
  });
  it("conserves closed-system injected volume including elastic storage, and respects pressure limits", () => {
    const i = corrected(),
      r = calculateRir(i),
      sim = simulateSqueeze(i, r, null);
    for (const p of sim.points.filter((p) => p.openTubing?.bopClosed)) {
      expect(p.surfaceMPa).toBeLessThanOrEqual(r.maxSurfaceMPa + 1e-8);
      expect(p.bhpMPa).toBeLessThanOrEqual(
        r.spotResult!.fractureLimitBhpMPa + 1e-7,
      );
      expect(p.balanceErrorM3).toBeLessThan(1e-8);
      expect(p.closedPumpedM3!).toBeCloseTo(p.vChannel + p.elasticVolumeM3!, 8);
    }
    const last = sim.points.at(-1)!;
    expect(last.closedPumpedM3).toBeCloseTo(2, 8);
    expect(sim.compInChannelM3).toBeLessThanOrEqual(2 + 1e-8);
    expect(sim.compInChannelM3).toBeGreaterThan(1);
    expect(last.openTubing!.slurryM3 + last.vCompChannel).toBeCloseTo(3, 8);
  });
  it("links hold pressure decay to changing injectivity instead of a fixed percentage", () => {
    const i = corrected(),
      r = calculateRir(i);
    const a = simulateSqueeze(i, r, null),
      b = simulateSqueeze(
        i,
        { ...r, fit: { ...r.fit!, J: r.fit!.J * 0.1 } },
        null,
      );
    expect(Math.abs(a.holds[0].decayPct - b.holds[0].decayPct)).toBeGreaterThan(
      1,
    );
  });
  it("distinguishes a blocked calculation from an unsuccessful squeeze in the report", () => {
    const r = calculateRir(screenCase),
      sim = simulateSqueeze(screenCase, r, null),
      doc = buildRirProgram(screenCase, r, null, null, r.workProgram, sim, 200);
    expect(sim.blocked).toBe(true);
    expect(sim.blockReasons?.join(" ")).toContain("2044.4");
    expect(doc.title).toContain("не выполнен");
    expect(doc.sections.some((s) => s.id === "regime")).toBe(false);
  });
  it("uses the trace for report rates and required work-life estimate", () => {
    const i = corrected(),
      r = calculateRir(i),
      plan = planRir(i, r);
    expect(plan.requiredWorkLifeMin).toBeGreaterThanOrEqual(
      plan.sim.totalTimeMin / 0.7,
    );
    const rows = stageRegime(plan.sim);
    for (const row of rows.filter((r) => r.kind === "squeeze"))
      expect(row.qAvg * 0.06 * (row.t1 - row.t0)).toBeCloseTo(row.volM3, 8);
    const doc = buildRirProgram(
      i,
      r,
      null,
      null,
      r.workProgram,
      plan.sim,
      plan.requiredWorkLifeMin,
    );
    expect(JSON.stringify(doc)).toContain("Смешанный столб");
    expect(JSON.stringify(doc)).not.toContain("при НКТ, заполненных составом");
  });
  it("blocks out-of-range step controls without hanging or inventing a completed operation", () => {
    const i = { ...corrected(), pumpRateLs: 0.00001 },
      r = calculateRir(i);
    const sim = simulateSqueeze(i, r, null);
    expect(sim.blocked).toBe(true);
    expect(sim.points.length).toBe(1);
  });
  it("autodesign includes ordinary cement for perforations and calculates the proposed lift", () => {
    const r = autoDesignRir(screenCase);
    expect(r.variants.some((v) => v.composition === "cement")).toBe(true);
    expect(r.best).not.toBeNull();
    const applied = applyVariant(screenCase, r.best!);
    expect(calculateRir(applied).spotResult!.ok).toBe(true);
    expect(r.best!.toolDepthMD).toBeLessThan(2102);
  }, 20000);
});
it("does not invent injectivity for incompatible or decreasing measurements", () => {
  const i = corrected();
  for (const injectivity of [
    [
      { rateM3h: 10, surfacePressureMPa: 2 },
      { rateM3h: 1, surfacePressureMPa: 10 },
    ],
    [{ rateM3h: 5, surfacePressureMPa: 0 }],
  ]) {
    const input = { ...i, zonePressureMPa: 30, injectivity };
    const res = calculateRir(input);
    expect(res.fit).toBeNull();
    expect(simulateSqueeze(input, res, null).blocked).toBe(true);
  }
});
