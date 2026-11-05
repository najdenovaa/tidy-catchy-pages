import { describe, it, expect } from "vitest";
import { calculateRir, DEFAULT_RIR } from "./rir-calculations";
import { simulateSqueeze } from "./rir-squeeze-sim";
import { calculateSpotSqueeze } from "./rir-spot-squeeze";
import type { RirInputs } from "./rir-calculations";

const packer = DEFAULT_RIR;
const bradenhead: RirInputs = {
  ...DEFAULT_RIR,
  composition: "microcement",
  compositionDensity: 1.55,
  tool: { ...DEFAULT_RIR.tool, kind: "bradenhead" },
  spot: {
    initialShoeMD: 1870,
    liftedShoeMD: 1750,
    slurryBottomMD: 1870,
    slurryVolumeM3: 1,
    plannedSqueezeM3: 0.3,
    bopWorkingMPa: 21,
  },
};
describe("РИР без пакера - паритет полного модуля", () => {
  it("использует реальные глубины открытой НКТ и геометрию пачки", () => {
    const r = calculateRir(bradenhead);
    expect(r.spotResult).toBeDefined();
    expect(r.toolTVD).toBeCloseTo(1750);
    expect(r.volumes.tubingM3).toBeGreaterThan(0);
    expect(r.volumes.totalM3).toBe(1);
    expect(r.volumes.squeezeM3).toBe(0.3);
    expect(r.volumes.belowToolM3).toBeCloseTo(0.7);
    expect(r.constraints.some((c) => c.name.includes("ПВО"))).toBe(true);
    expect(
      r.constraints.some((c) => c.name.includes("Разрыв НКТ на устье")),
    ).toBe(true);
    expect(
      r.constraints.some((c) => c.name.includes("Перепад на пакере")),
    ).toBe(false);
  });
  it("общая динамика возвращает точки, выдержки и стадии подъёма/ПВО для графиков и 3D", () => {
    const r = calculateRir(bradenhead);
    const sim = simulateSqueeze(bradenhead, r, null);
    expect(sim.points.length).toBeGreaterThan(4);
    expect(sim.stages.some((s) => s.name.includes("Подъём НКТ"))).toBe(true);
    expect(sim.stages.some((s) => s.name.includes("ПВО"))).toBe(true);
    expect(
      sim.points.every(
        (p) => Number.isFinite(p.surfaceMPa) && Number.isFinite(p.vCompChannel),
      ),
    ).toBe(true);
    expect(sim.compInChannelM3).toBeLessThanOrEqual(0.3 + 1e-9);
    expect(sim.compInChannelM3).toBeGreaterThanOrEqual(0);
    expect(sim.outcome).not.toBe("sealed"); // simulation alone cannot certify isolation
  });
  it("ошибка компоновки блокирует симуляцию задавливания", () => {
    const invalid = {
      ...bradenhead,
      spot: { ...bradenhead.spot, liftedShoeMD: 1850 },
    };
    const r = calculateRir(invalid);
    expect(r.spotResult?.ok).toBe(false);
    const sim = simulateSqueeze(invalid, r, null);
    expect(sim.outcome).toBe("no_squeeze");
    expect(sim.compInChannelM3).toBe(0);
  });
  it("нарушение допустимого градиента ГРП блокирует безпакерную схему", () => {
    const invalid = { ...bradenhead, fracGradientMPaM: 0.009 };
    const r = calculateRir(invalid);
    expect(r.spotResult?.ok).toBe(false);
    expect(r.maxSurfaceMPa).toBe(0);
    expect(simulateSqueeze(invalid, r, null).outcome).toBe("no_squeeze");
  });
  it("пакерный базовый расчёт сохраняет старую схему и не создаёт spotResult", () => {
    const r = calculateRir(packer);
    expect(r.spotResult).toBeUndefined();
    expect(r.volumes.tubingM3).toBeGreaterThan(0);
    expect(r.constraints.some((c) => c.name.includes("ретейнере"))).toBe(true);
  });
});

describe("Геометрия общей временной шкалы без пакера", () => {
  it("поднимает НКТ только после размещения, закрывает ПВО после подъёма и сохраняет объём", () => {
    const res = calculateRir(bradenhead);
    const sim = simulateSqueeze(bradenhead, res, null);
    const spot = res.spotResult!;
    const lift = sim.points.filter((p) => p.stage.includes("Подъём НКТ"));
    expect(lift.length).toBeGreaterThan(1);
    expect(lift[0].openTubing!.shoeMD).toBeLessThan(1870);
    expect(lift.at(-1)!.openTubing!.shoeMD).toBeCloseTo(1750);
    for (const p of sim.points) {
      const g = p.openTubing!;
      expect(g).toBeDefined();
      expect(p.vCompChannel).toBeGreaterThanOrEqual(0);
      if (p.stage.includes("Закачка") || p.stage.includes("Продавка"))
        expect(g.shoeMD).toBe(1870);
      if (!g.bopClosed) expect(p.vCompChannel).toBe(0);
      if (g.bopClosed) expect(g.shoeMD).toBe(1750);
      const below =
        spot.casingAreaM2 *
        Math.max(0, g.slurryBottomMD - Math.max(g.shoeMD, g.slurryTopMD));
      const annular =
        spot.annularAreaM2 * Math.max(0, g.shoeMD - g.slurryTopMD);
      expect(below + annular).toBeCloseTo(g.slurryM3, 8);
      if (p.stage.includes("Подъём") || g.bopClosed)
        expect(g.slurryM3 + p.vCompChannel).toBeCloseTo(1, 8);
    }
    expect(lift.at(-1)!.openTubing!.slurryTopMD).toBeCloseTo(
      spot.slurryTopAfterLiftMD,
    );
  });
  it("сохраняет цемент при пачке больше вместимости НКТ", () => {
    const input = {
      ...bradenhead,
      spot: { ...bradenhead.spot, slurryVolumeM3: 6, liftedShoeMD: 1000 },
    };
    const res = calculateRir(input);
    expect(res.spotResult!.ok).toBe(true);
    const sim = simulateSqueeze(input, res, null);
    const fed = sim.points
      .filter((p) => p.stage === "Закачка цемента в НКТ")
      .at(-1)!;
    expect(fed.openTubing!.slurryM3).toBeCloseTo(
      6 - res.spotResult!.tubingCapacityBeforeM3,
    );
    const placed = sim.points
      .filter((p) => p.stage.startsWith("Продавка"))
      .at(-1)!;
    expect(placed.openTubing!.slurryM3).toBeCloseTo(6);
  });
});
