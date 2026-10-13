import { describe, it, expect } from "vitest";
import { autoPlaceCentralizers, calculateCentralization, centralizerPresets, type CentralizerInterval } from "./centralization-calculations";
import type { WellData } from "./cementing-calculations";

const well: WellData = {
  wellDepthMD: 2600, wellDepthTVD: 2450, casingDepthMD: 2600, holeDiameter: 215.9, casingOD: 168.3, casingWall: 8.9,
  prevCasingDepth: 800, prevCasingOD: 244.5, prevCasingID: 226, ckodDepth: 2580, cementRiseHeight: 0, cavernCoeff: 1.15,
  bottomTempStatic: 92, bottomTempCirc: 0, pumpZoneTop: 0, pumpZoneBottom: 0,
  trajectory: [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 800, tvd: 800, zenith: 0, azimuth: 0 }, { md: 1600, tvd: 1520, zenith: 35, azimuth: 90 }, { md: 2600, tvd: 2450, zenith: 38, azimuth: 90 }],
};
const spec = { type: "rigid" as const, bladesCount: 6, bladeHeight: 25, restoringForce: centralizerPresets.rigid.restoringForce!, maxAxialLoad: 300 };
const toIntervals = (pl: ReturnType<typeof autoPlaceCentralizers>): CentralizerInterval[] =>
  pl.map((p, i) => ({ id: String(i), fromMD: p.fromMD, toMD: p.toMD, centralizersPerJoint: p.centralizersPerJoint, jointLength: 12, spec }));

describe("Авторасстановка центраторов", () => {
  it("цель по отступу выдерживается по полной модели центрирования (с натяжением на наборе угла)", () => {
    for (const target of [55, 67, 75]) {
      const pl = autoPlaceCentralizers(well, spec, 12, target, 1180);
      const prof = calculateCentralization(well, toIntervals(pl), 1180).filter((r) => r.md > 50);
      const worst = Math.min(...prof.map((r) => r.standoff));
      expect(worst).toBeGreaterThanOrEqual(target - 0.5);
      // заявленный в таблице отступ совпадает с расчётом
      for (const iv of pl) {
        const inside = prof.filter((r) => r.md > iv.fromMD && r.md < iv.toMD);
        if (inside.length) expect(iv.standoffAchieved).toBeLessThanOrEqual(Math.min(...inside.map((r) => r.standoff)) + 0.6);
      }
    }
  });

  it("на наборе угла с натяжением — чаще, чем 1 на 10 труб", () => {
    const pl = autoPlaceCentralizers(well, spec, 12, 67, 1180);
    const at = pl.find((iv) => iv.fromMD <= 950 && iv.toMD >= 950)!;
    expect(at.centralizersPerJoint).toBeGreaterThan(0.1);
  });

  it("в вертикали остаётся редкая расстановка", () => {
    const pl = autoPlaceCentralizers(well, spec, 12, 67, 1180);
    const at = pl.find((iv) => iv.fromMD <= 400 && iv.toMD >= 400)!;
    expect(at.centralizersPerJoint).toBeLessThanOrEqual(0.1);
  });
});
