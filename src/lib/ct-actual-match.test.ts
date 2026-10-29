import { describe, expect, it } from "vitest";
import { demoActual, matchActual, parseActualTable } from "./ct-actual-match";
import { FLUID_PRESETS } from "./coiled-tubing-calculations";

const tr = [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 1500, tvd: 1500, zenith: 0, azimuth: 0 }, { md: 2100, tvd: 1882, zenith: 90, azimuth: 0 }, { md: 3300, tvd: 1882, zenith: 90, azimuth: 0 }];
const c = {
  ct: { od: 44.45, wall: 3.68, grade: "CT-90", length: 4500, ovality: 2 },
  well: { md: 3300, tvd: 1882, casingID: 99.6, tubingID: 0, wellheadPressure: 5, bhst: 80, bhct: 60, whTemp: 20, fracGradient: 0.018, trajectory: tr },
  fluid: FLUID_PRESETS[0].data, tools: { bhaWeight: 100, bhaLength: 5, bhaOD: 54, nozzleDiam: 4, nozzleCount: 4 }, opts: {},
};

describe("ГНКТ: сравнение с фактом", () => {
  it("по показаниям индикатора веса восстанавливается трение, по давлению — множитель потерь, находится затяжка", () => {
    const data = demoActual(c, 0.28);
    const t0 = Date.now();
    const r = matchActual(c, data, 0.2);
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(r.muBest).toBeGreaterThan(0.25);
    expect(r.muBest).toBeLessThan(0.31);
    expect(r.rmsBest).toBeLessThan(r.rmsCurrent);
    expect(r.hyd?.factor).toBeGreaterThan(1.1);
    expect(r.hyd?.factor).toBeLessThan(1.26);
    expect(r.anomalies.some((a) => a.kind === "overpull")).toBe(true);
  });
  it("разбор таблицы: заголовки, единицы, направление по изменению глубины", () => {
    const rows = [["Глубина, м", "Вес, тс", "Давление насоса, МПа", "Расход, л/с"], [100, 2, 10, 3], [200, 3, 11, 3], [150, 3.5, 11, 3]];
    const p = parseActualTable(rows, "kN");
    expect(p.length).toBe(3);
    expect(p[0].wiKN).toBeCloseTo(19.6, 1);
    expect(p[1].dir).toBe("rih");
    expect(p[2].dir).toBe("pooh");
    expect(p[1].pumpMPa).toBe(11);
  });
});
