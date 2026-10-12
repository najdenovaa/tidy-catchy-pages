import { describe, it, expect } from "vitest";
import {
  calculateDrag, calculateKill, calculateFishing, diagnoseStuck,
  pipeBodyYieldKN, pipeYieldForceKN, tubingFrictionMPa, annulusFrictionMPa,
  planMultiIntervalKill, KILL_SALTS,
  type WorkoverWellData,
} from "./workover-calculations";

const vertical: WorkoverWellData = {
  wellDepthMD: 2500,
  trajectory: [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 2500, tvd: 2500, zenith: 0, azimuth: 0 }],
  casingID_mm: 152, holeDiameter_mm: 215.9,
  pipeOD_mm: 73, pipeID_mm: 62, pipeWeight_kgm: 9.67,
  pipeGrade: "N80", pipeYieldMPa: 552, pipeYoungModulusGPa: 210,
  fluidDensity_gcm3: 1.1, fluidPV_cP: 15, fluidYP_Pa: 5,
  connectionType: "eue", pipeConditionPct: 100,
};

const deviated: WorkoverWellData = {
  ...vertical,
  trajectory: [
    { md: 0, tvd: 0, zenith: 0, azimuth: 0 },
    { md: 800, tvd: 800, zenith: 0, azimuth: 0 },
    { md: 1500, tvd: 1450, zenith: 35, azimuth: 90 },
    { md: 2500, tvd: 2200, zenith: 55, azimuth: 90 },
  ],
};

// Вес НКТ в жидкости: q·L·g·(1 − ρж/ρст)
const buoyedWeightKN = (L: number) => (9.67 * L * 9.81 * (1 - 1.1 / 7.85)) / 1000;

describe("Затяжки: нагрузка на крюке берётся на устье", () => {
  it("вертикальная скважина: подъём = спуск = вес в жидкости", () => {
    const expected = buoyedWeightKN(2500); // ≈ 203.9 кН
    for (const operation of ["pull_out", "run_in", "rotate"] as const) {
      const r = calculateDrag({ operation, frictionCoeff: 0.3 }, vertical);
      expect(r.maxHookLoadKN).toBeCloseTo(expected, 0);
    }
  });

  it("наклонная скважина: подъём > вес > спуск", () => {
    const up = calculateDrag({ operation: "pull_out", frictionCoeff: 0.3 }, deviated).maxHookLoadKN;
    const rot = calculateDrag({ operation: "rotate", frictionCoeff: 0.3 }, deviated).maxHookLoadKN;
    const down = calculateDrag({ operation: "run_in", frictionCoeff: 0.3 }, deviated).maxHookLoadKN;
    expect(up).toBeGreaterThan(rot);
    expect(rot).toBeGreaterThan(down);
    expect(up).toBeGreaterThan(150); // раньше было 0.7 кН
  });

  it("нагрузка снизу колонны передаётся на крюк", () => {
    const base = calculateDrag({ operation: "pull_out", frictionCoeff: 0.3 }, vertical).maxHookLoadKN;
    const loaded = calculateDrag({ operation: "pull_out", frictionCoeff: 0.3, bottomLoadKN: 100 }, vertical).maxHookLoadKN;
    expect(loaded - base).toBeCloseTo(100, 1);
  });
});

describe("Гидравлика", () => {
  it("ламинар в трубе = Пуазейль 32μvL/D²", () => {
    const D = 0.062, mu = 0.1, Q = 0.001;
    const v = Q / ((Math.PI / 4) * D * D);
    const expectedMPa = (32 * mu * v * 1000) / (D * D) / 1e6;
    const r = tubingFrictionMPa(1000, 62, 1.0, 100, 0, 1);
    expect(r.turbulent).toBe(false);
    expect(r.lossMPa).toBeCloseTo(expectedMPa, 4);
  });

  it("турбулент в трубе = Блазиус", () => {
    const D = 0.062, mu = 0.001, rho = 1000, Q = 0.008;
    const v = Q / ((Math.PI / 4) * D * D);
    const re = (rho * v * D) / mu;
    const f = 0.0791 / Math.pow(re, 0.25);
    const expectedMPa = (2 * f * rho * v * v * 1000) / D / 1e6;
    const r = tubingFrictionMPa(1000, 62, 1.0, 1, 0, 8);
    expect(r.turbulent).toBe(true);
    expect(r.lossMPa).toBeCloseTo(expectedMPa, 4);
  });

  it("ламинар в затрубье = щель 48μv/Dh²", () => {
    const Dh = 0.079, mu = 0.1, Q = 0.001;
    const A = (Math.PI / 4) * (0.152 ** 2 - 0.073 ** 2);
    const v = Q / A;
    const expectedMPa = (48 * mu * v * 1000) / (Dh * Dh) / 1e6;
    const r = annulusFrictionMPa(1000, 152, 73, 1.0, 100, 0, 1);
    expect(r.lossMPa).toBeCloseTo(expectedMPa, 4);
  });
});

describe("Глушение", () => {
  const input = {
    method: "wait_weight" as const,
    formationPressureMPa: 28, reservoirDepthTVD: 2200, fracturePressureMPa: 42,
    currentMudDensity: 1.1, wellDepthMD: 2500, casingID_mm: 152, tubingOD_mm: 73, tubingID_mm: 62,
    killFluidPV_cP: 20, killFluidYP_Pa: 6, pumpRateLs: 8, safetyMarginPct: 5,
  };

  it("ICP = избыточное в трубах + давление прокачки; FCP включает трение в НКТ", () => {
    const r = calculateKill(input);
    const sidpp = 28 - (1.1 * 1000 * 9.81 * 2200) / 1e6;
    expect(r.sidppMPa).toBeCloseTo(sidpp, 3);
    expect(r.initialCircPressureMPa).toBeCloseTo(sidpp + r.circPressureCurrentMPa, 6);
    expect(r.finalCircPressureMPa).toBeCloseTo(r.tubingFrictionMPa + r.annulusFrictionMPa, 6);
    expect(r.tubingTurbulent).toBe(true);
    expect(r.tubingFrictionMPa).toBeGreaterThan(4); // ≈ 5.9 МПа, раньше не учитывалось
  });

  it("задавка: начальное давление выше конечного, предел по ГРП", () => {
    const r = calculateKill({ ...input, method: "bullhead" });
    expect(r.bullheadSurfacePressureMPa).toBeGreaterThan(r.bullheadEndPressureMPa);
    expect(r.bullheadMaxSurfaceMPa).toBeGreaterThan(r.bullheadSurfacePressureMPa);
  });
});

describe("Предел НКТ", () => {
  it("тело трубы σт·A", () => {
    const A = (Math.PI / 4) * (0.073 ** 2 - 0.062 ** 2);
    expect(pipeBodyYieldKN(vertical)).toBeCloseTo((552e6 * A) / 1000, 3);
  });
  it("гладкая НКТ ограничена резьбой, износ снижает предел", () => {
    const body = pipeBodyYieldKN(vertical);
    expect(pipeYieldForceKN({ ...vertical, connectionType: "eue" })).toBeCloseTo(body / 1.25, 3);
    expect(pipeYieldForceKN({ ...vertical, connectionType: "nu" })).toBeCloseTo((body * 0.69) / 1.25, 3);
    expect(pipeYieldForceKN({ ...vertical, connectionType: "eue", pipeConditionPct: 80 })).toBeCloseTo((body * 0.8) / 1.25, 3);
  });
});

describe("Ловильные работы и ясс", () => {
  it("растяжение по Гуку и скорость по волновому сопротивлению", () => {
    const r = calculateFishing({ fishTopMD: 1600, fishWeightKN: 120, overpullKN: 150, jarType: "hydraulic", frictionCoeff: 0.3 }, vertical);
    const A = (Math.PI / 4) * (0.073 ** 2 - 0.062 ** 2);
    expect(r.jarStretchM).toBeCloseTo((150e3 * 1600) / (210e9 * A), 3);
    expect(r.jarVelocityMs).toBeCloseTo(150e3 / (A * Math.sqrt(210e9 * 7850)), 3);
    expect(r.jarVelocityMs).toBeLessThan(10); // раньше было 21 м/с
    // нагрузка на крюке = вес 1600 м НКТ + рыба + натяжка (вертикаль)
    expect(r.requiredHookLoadKN).toBeCloseTo(buoyedWeightKN(1600) + 120 + 150, 0);
  });

  it("превышение предела трубы не даёт «безопасно»", () => {
    const r = calculateFishing({ fishTopMD: 1600, fishWeightKN: 200, overpullKN: 400, jarType: "hydraulic" }, vertical);
    expect(r.canEngage).toBe(false);
  });
});

describe("Прихват", () => {
  it("освобождение учитывает вес колонны над прихватом", () => {
    const d = diagnoseStuck(vertical, {
      canRotate: true, canMoveDown: false, canMoveUp: false, stuckDepthMD: 1800,
      occurredDuringCirculation: true, deltaP_MPa: 1, contactLenM: 5, mudcakeFriction: 0.25,
    }, 1000, 150);
    expect(d.requiredHookLoadKN).toBeCloseTo(150 + d.freeingForceKN, 6);
  });
});

describe("Многоинтервальное глушение", () => {
  it("предупреждает о поглощении в интервале со слабым ГРП", () => {
    const plan = planMultiIntervalKill([
      { topMD: 1900, bottomMD: 1950, topTVD: 1750, bottomTVD: 1790, formationPressureMPa: 19, fracturePressureMPa: 20, intervalType: "kick_zone", requiredKillDensity: 0 },
      { topMD: 2300, bottomMD: 2400, topTVD: 2050, bottomTVD: 2125, formationPressureMPa: 24, fracturePressureMPa: 36, intervalType: "kill_zone", requiredKillDensity: 0 },
    ], KILL_SALTS[1], 30, "medium", 5);
    expect(plan.governingInterval).toBe(1);
    expect(plan.warnings.some((w) => w.startsWith("🔴") && w.includes("1900"))).toBe(true);
  });
});
