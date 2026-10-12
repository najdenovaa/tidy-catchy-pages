import { describe, it, expect } from "vitest";
import {
  apiBurstMPa, apiCollapse, checkCasing, settlingVelocity, calculateCleanout,
  calculateSwab, calculateBlockingPill, calculateBackOff, selectFishingTools,
} from "./workover-operations";
import { calculateBrineRecipe, KILL_SALTS, type WorkoverWellData } from "./workover-calculations";

const vertical: WorkoverWellData = {
  wellDepthMD: 2500,
  trajectory: [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: 2500, tvd: 2500, zenith: 0, azimuth: 0 }],
  casingID_mm: 152, holeDiameter_mm: 215.9,
  pipeOD_mm: 73, pipeID_mm: 62, pipeWeight_kgm: 9.67,
  pipeGrade: "Е", pipeYieldMPa: 552, pipeYoungModulusGPa: 210,
  fluidDensity_gcm3: 1.0, fluidPV_cP: 1, fluidYP_Pa: 0,
  connectionType: "nu", pipeConditionPct: 100,
};

const N80 = 80000 / 145.0377; // МПа
const psi = (mpa: number) => mpa * 145.0377;

describe("API 5C3: сверка с табличными значениями API", () => {
  it("7\" 23# N80: смятие 3830 psi, разрыв 6340 psi", () => {
    expect(psi(apiCollapse(177.8, 8.05, N80).mpa)).toBeGreaterThan(3830 * 0.98);
    expect(psi(apiCollapse(177.8, 8.05, N80).mpa)).toBeLessThan(3830 * 1.02);
    expect(psi(apiBurstMPa(177.8, 8.05, N80))).toBeCloseTo(6340, -2);
  });
  it("5-1/2\" 17# N80: смятие 6280 psi, разрыв 7740 psi", () => {
    expect(psi(apiCollapse(139.7, 7.72, N80).mpa)).toBeGreaterThan(6280 * 0.98);
    expect(psi(apiCollapse(139.7, 7.72, N80).mpa)).toBeLessThan(6280 * 1.02);
    expect(psi(apiBurstMPa(139.7, 7.72, N80))).toBeCloseTo(7740, -2);
  });
  it("2-7/8\" 6.5# N80 НКТ: смятие 11160 psi, разрыв 10570 psi", () => {
    expect(psi(apiCollapse(73.0, 5.51, N80).mpa)).toBeGreaterThan(11160 * 0.98);
    expect(psi(apiCollapse(73.0, 5.51, N80).mpa)).toBeLessThan(11160 * 1.02);
    expect(psi(apiBurstMPa(73.0, 5.51, N80))).toBeCloseTo(10570, -2);
  });
});

describe("Опрессовка и снижение уровня", () => {
  const base = {
    casingOD_mm: 168.3, casingWall_mm: 8.0, casingYieldMPa: 552, wearPct: 0, bottomMD: 2500,
    testPressureMPa: 15, insideDensity: 1.0, outsideDensity: 1.0, levelMD: 0, sfBurst: 1.15, sfCollapse: 1.1,
  };
  it("одинаковые плотности: нагрузка разрыва = давление опрессовки по всей глубине", () => {
    const r = checkCasing(base, vertical);
    expect(r.maxBurstLoadMPa).toBeCloseTo(15, 6);
    expect(r.maxTestPressureMPa).toBeCloseTo(r.burstAllowableMPa, 6);
  });
  it("пустая колонна: смятие = гидростатика за колонной", () => {
    const r = checkCasing({ ...base, testPressureMPa: 0, levelMD: 2500 }, vertical);
    expect(r.maxCollapseLoadMPa).toBeCloseTo((1000 * 9.81 * 2500) / 1e6, 1);
  });
});

describe("Промывка пробки", () => {
  it("Стокс для мелкого песка в вязкой жидкости", () => {
    const s = settlingVelocity(0.1, 1.0, 50);
    expect(s.regime).toBe("Стокс");
    expect(s.v).toBeCloseTo((9.81 * 1e-8 * 1650) / (18 * 0.05), 8);
  });
  it("восходящая скорость = расход / площадь канала", () => {
    const r = calculateCleanout({ plugTopMD: 2000, plugBottomMD: 2100, method: "reverse", rateLs: 6, grainDiameter_mm: 0.3, feedRate_mh: 5, plugPorosity: 0.4 }, vertical);
    expect(r.upflowVelocityMs).toBeCloseTo(0.006 / ((Math.PI / 4) * 0.062 ** 2), 6);
    expect(r.sandVolumeM3).toBeCloseTo((Math.PI / 4) * 0.152 ** 2 * 100 * 0.6, 6);
  });
});

describe("Освоение", () => {
  it("уровень для заданной депрессии", () => {
    const r = calculateSwab({
      reservoirMD: 2000, reservoirPressureMPa: 15, targetDrawdownMPa: 5, fluidDensity: 1.0,
      packerInstalled: true, swabSubmergenceM: 200, swabEfficiency: 0.8, swabSpeedMs: 2,
    }, vertical);
    const g = 0.00981;
    expect(r.staticLevelTVD).toBeCloseTo(2000 - 15 / g, 0);
    expect(r.requiredLevelTVD).toBeCloseTo(2000 - 10 / g, 0);
    expect(r.volumeToRemoveM3).toBeCloseTo((r.requiredLevelMD - r.staticLevelMD) * (Math.PI / 4) * 0.062 ** 2, 3);
  });
});

describe("Блокирующая пачка, ловильный инструмент, отворот", () => {
  it("объём пачки = ствол + поровый объём зоны проникновения", () => {
    const r = calculateBlockingPill({ perfTopMD: 2300, perfBottomMD: 2320, porosityPct: 20, penetrationRadiusM: 0.5, coverAboveM: 30, excessPct: 0, tubingShoeMD: 2200 }, vertical);
    const rw = 0.10795, rp = rw + 0.5;
    expect(r.formationVolumeM3).toBeCloseTo(Math.PI * (rp * rp - rw * rw) * 20 * 0.2, 6);
    expect(r.pillVolumeM3).toBeCloseTo(r.formationVolumeM3 + (Math.PI / 4) * 0.152 ** 2 * 50, 6);
  });
  it("овершот не проходит при малом зазоре", () => {
    const r = selectFishingTools({ fishOD_mm: 140, fishID_mm: 0, headDamaged: false, minClearance_mm: 6, externalBodyWall_mm: 10 }, vertical);
    expect(r.options.find((o) => o.tool.startsWith("Овершот"))?.feasible).toBe(false);
  });
  it("закрутка в вертикальной скважине = M·L/(G·Jp)", () => {
    const r = calculateBackOff({ backOffMD: 1500, breakoutTorqueKNm: 2, frictionCoeff: 0.3 }, vertical);
    const J = (Math.PI / 32) * (0.073 ** 4 - 0.062 ** 4);
    expect(r.turns).toBeCloseTo((2000 * 1500) / (80.8e9 * J) / (2 * Math.PI), 2);
  });
});

describe("Рассолы по справочным таблицам", () => {
  it("CaCl₂ 1.189 г/см³ ≈ 20% и кристаллизация ≈ −20 °C", () => {
    const r = calculateBrineRecipe(KILL_SALTS.find((s) => s.id === "cacl2")!, 1.189, 10);
    expect(r.wtPctClean).toBeCloseTo(20, 1);
    expect(r.crystallizationC).toBeCloseTo(-20, 1);
  });
  it("NaCl 1.112 г/см³ ≈ 15%", () => {
    const r = calculateBrineRecipe(KILL_SALTS.find((s) => s.id === "nacl")!, 1.112, 10);
    expect(r.wtPctClean).toBeCloseTo(15, 1);
  });
});
