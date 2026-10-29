import { describe, expect, it } from "vitest";
import * as C from "./coiled-tubing-calculations";
import { buildCTProgram } from "./ct-program";

describe("ГНКТ: программа работ", () => {
  it("строится по расчёту: ограничения, интервалы спуска, контрольные точки", () => {
    const tr = [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 1500, tvd: 1500, zenith: 0, azimuth: 0 }, { md: 2100, tvd: 1882, zenith: 90, azimuth: 0 }, { md: 3300, tvd: 1882, zenith: 90, azimuth: 0 }];
    const ct = { od: 44.45, wall: 3.68, grade: "CT-90", length: 4500, ovality: 2 };
    const well = { md: 3300, tvd: 1882, casingID: 99.6, tubingID: 0, wellheadPressure: 10, bhst: 80, bhct: 60, whTemp: 20, fracGradient: 0.018, trajectory: tr };
    const fluid = C.FLUID_PRESETS[0].data, tools = { bhaWeight: 100, bhaLength: 5, bhaOD: 54, nozzleDiam: 4, nozzleCount: 4 }, pump = { flowRate: 3, surfacePressure: 0 };
    const forces = C.calculateTubingForces(ct, well, fluid, tools, 0.22);
    const hyd = C.calculateHydraulics(ct, well, fluid, pump, tools);
    const lim = C.calculateLimits(ct, hyd.pumpPressure, 10, forces.surfaceLoadPOOH);
    const fat = C.calculateFatigue(ct, "medium", hyd.pumpPressure, 0);
    const hl = C.generateHookLoadProfile(ct, well, fluid, tools, 0.22, undefined, 40);
    const p = buildCTProgram({ ct, well, fluid, pump, opts: {}, friction: 0.22, forces, limits: lim, hydraulics: hyd, fatigue: fat, hookLoad: hl, operationType: "wellbore_cleanout" });
    expect(p.title).toContain("Промывка");
    expect(p.sections.length).toBe(7);
    expect(p.checkpoints.length).toBeGreaterThan(5);
    expect(p.sections[2].items.join(" ")).toContain("проталкиванием");
    const test = p.limitsTable.find((r) => r[0].startsWith("Давление опрессовки"))!;
    expect(parseFloat(test[1].replace(",", "."))).toBeLessThanOrEqual(lim.maxWorkingPressure + 0.05);
  });
});
