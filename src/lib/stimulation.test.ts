import { describe, it, expect } from "vitest";
import { calculateGasIPR, GAS_FLOW_CONSTANT } from "./stimulation-gas-ipr";
import { darcyJ, calculateInjectivity } from "./foam-treatment-diagnostics";
import { calculateMatrixInjection, displacementVolumeM3, injectivity, DEFAULT_CONSTRUCTION } from "./stimulation-injection";
import { co2ZFactor, reactionRate, hclMolarity } from "./acid-chemistry";
import { computeAcidStoichiometry, hclReactionRate, buildAcidStages } from "./stimulation-acid";
import { fracturePressureMPa, DEFAULT_DEPTH, DEFAULT_STRESS } from "./geology-model";

describe("Продуктивность: константы из СИ", () => {
  it("нефть: J = 2πkh/(μB(ln+S)) в СИ", () => {
    const k = 100, h = 10, mu = 1, B = 1, re = 250, rw = 0.108;
    const si = (2 * Math.PI * k * 9.869e-16 * h * 1e6) / (mu * 1e-3 * B * Math.log(re / rw)) * 86400; // м³/(сут·МПа)
    expect(darcyJ(k, h, mu, B, re, rw, 0)).toBeCloseTo(si, 3);
    expect(calculateInjectivity(k, h, mu, re, rw, 0)).toBeCloseTo(si, 3);
  });

  it("газ: q = πkh(Pr²−Pwf²)Tст/(μZT·Pст·ln) в СИ, тыс.м³/сут", () => {
    expect(GAS_FLOW_CONSTANT).toBeCloseTo(1.29, 2);
    const r = calculateGasIPR({
      reservoirPressureMPa: 20, reservoirTempC: 76.85, permeability_mD: 10, netPayM: 10,
      drainageRadiusM: 250, wellboreRadiusM: 0.108, skin: 0, gasGravity: 0.65, zFactor: 0.9, nonDarcyD: 0,
    });
    const mu = r.gasViscosityCP;
    const T = 350;
    const qSI = (Math.PI * 10 * 9.869e-16 * 10 * (20e6 ** 2 - 0.1e6 ** 2) * 293.15) / (mu * 1e-3 * 0.9 * T * 101325 * Math.log(250 / 0.108));
    expect(r.aofMcmd).toBeCloseTo((qSI * 86400) / 1000, 0);
  });
});

describe("Матричная закачка", () => {
  const base = {
    k_mD: 15, h_m: 12, skin: 8, skinAfter: 0, fluidViscosity_cP: 1.2, fluidDensity_gcm3: 1.07,
    reservoirPressureMPa: 22, fracturePressureMPa: 41.4, drainageRadiusM: 250, wellboreRadiusM: 0.108,
    safetyMarginMPa: 1.5, construction: DEFAULT_CONSTRUCTION,
  };
  it("макс. расход = J·(Pгрп − запас − Pпл)", () => {
    const r = calculateMatrixInjection({ ...base, plannedRateLpm: 50 });
    const J = injectivity(15, 12, 1.2, 250, 0.108, 8);
    expect(r.maxRateStartLpm).toBeCloseTo((J * (41.4 - 1.5 - 22) * 1000) / 1440, 3);
    expect(r.maxRateEndLpm).toBeGreaterThan(r.maxRateStartLpm);
  });
  it("расход каталога 250 л/мин при скине 8 — режим ГРП", () => {
    expect(calculateMatrixInjection({ ...base, plannedRateLpm: 250 }).regime).toBe("frac");
  });
  it("давление на устье = забойное − гидростатика + трение", () => {
    const r = calculateMatrixInjection({ ...base, plannedRateLpm: 50 });
    expect(r.surfacePressureMPa).toBeCloseTo(r.bhpAtPlannedMPa - r.hydrostaticMPa + r.frictionAtPlannedMPa, 6);
  });
  it("продавка = НКТ до башмака + колонна до перфорации", () => {
    const d = displacementVolumeM3({ perfTopMD: 2200, perfTopTVD: 2200, tubingShoeMD: 2150, tubingID_mm: 62, casingID_mm: 152 });
    expect(d.totalM3).toBeCloseTo((Math.PI / 4) * 0.062 ** 2 * 2150 + (Math.PI / 4) * 0.152 ** 2 * 50, 6);
  });
});

describe("Химия", () => {
  it("CO₂ по Пенгу–Робинсону близко к NIST (±7%)", () => {
    const rho = (p: number, t: number) => (p * 1e6 * 0.04401) / (co2ZFactor(p, t) * 8.314 * t);
    expect(rho(10, 353.15)).toBeGreaterThan(221 * 0.93); // NIST ≈ 221 кг/м³
    expect(rho(10, 353.15)).toBeLessThan(221 * 1.07);
    expect(rho(20, 353.15)).toBeGreaterThan(594 * 0.93); // NIST ≈ 594 кг/м³
    expect(rho(20, 353.15)).toBeLessThan(594 * 1.07);
  });
  it("одна кинетика Lund–Fogler в обоих модулях", () => {
    expect(hclReactionRate(80, 15)).toBeCloseTo(reactionRate(hclMolarity(15), 80), 12);
  });
  it("HF: 6 моль HF на моль SiO₂", () => {
    const s = computeAcidStoichiometry({ acidVolumeM3: 1, acidDensityKgM3: 1000, hclConcentrationPct: 0, hfConcentrationPct: 3, rock: "sandstone", preflushUsed: true });
    const nHF = (1000 * 0.03 / 20.01) * 1000;
    expect(s.rockDissolvedKg).toBeCloseTo(((nHF / 6) * 60.08) / 1000, 6);
  });
  it("глинокислота: afterflush не меньше основной кислоты", () => {
    const st = buildAcidStages({ collectorType: "sandstone", payZoneM: 10, mainAcidName: "HCl 12% + HF 3%", mainAcidVolPerM: 1.0, tubingVolumeM3: 6, hasHF: true });
    expect(st.afterflush.volumeM3).toBeGreaterThanOrEqual(st.mainAcid.volumeM3);
  });
  it("Pгрп по TVD меньше, чем по MD в наклонной скважине", () => {
    const byMD = fracturePressureMPa(DEFAULT_DEPTH, 22, DEFAULT_STRESS);
    const byTVD = fracturePressureMPa(DEFAULT_DEPTH, 22, DEFAULT_STRESS, 1900);
    expect(byTVD).toBeLessThan(byMD);
  });
});

import { buijseGlasbergenVelocity, calculateWormholes, treatedDamageSkin } from "./stimulation-wormhole";
import { rankMethods } from "./stimulation-ranking";

describe("Червоточины Buijse–Glasbergen", () => {
  it("при v_i = v_opt скорость фронта ≈ v_i/PV_bt", () => {
    const v = buijseGlasbergenVelocity(1e-4, 1e-4, 0.5);
    expect(v).toBeCloseTo((1e-4 / 0.5) * (1 - Math.exp(-4)) ** 2, 10);
  });
  it("радиальный рост совпадает с аналитикой при v_i ≫ v_opt", () => {
    const vOptCm = 1e-4; // очень малый оптимум → B ≈ 1 на всём пути
    const r = calculateWormholes({ acidVolumeM3: 10, rateLpm: 100, payZoneM: 10, porosity: 0.15, wellboreRadiusM: 0.1, viOptCmMin: vOptCm, pvBtOpt: 0.5 });
    const q = 100 / 60000, a = q / (2 * Math.PI * 10 * 0.15), vopt = vOptCm / 100 / 60;
    const K = (Math.pow(a, 2 / 3) * Math.pow(vopt, 1 / 3)) / 0.5;
    const T = 10 / q;
    const rExact = Math.pow(Math.pow(0.1, 5 / 3) + (5 / 3) * K * T, 3 / 5);
    expect(r.wormholeRadiusM).toBeCloseTo(rExact, 2);
  });
});

describe("Скин по зонам (Хокинс)", () => {
  it("без обработки скин повреждения не меняется", () => {
    expect(treatedDamageSkin({ damageSkin: 5, damageRadiusM: 0.5, treatedRadiusM: 0.108, wellboreRadiusM: 0.108, wormholes: false }).skinAfter).toBeCloseTo(5, 6);
    expect(treatedDamageSkin({ damageSkin: 5, damageRadiusM: 0.5, treatedRadiusM: 0.108, wellboreRadiusM: 0.108, wormholes: true }).skinAfter).toBeCloseTo(5, 6);
  });
  it("червоточины за зоной повреждения дают S = −ln(r_wh/rw)", () => {
    expect(treatedDamageSkin({ damageSkin: 5, damageRadiusM: 0.5, treatedRadiusM: 2, wellboreRadiusM: 0.108, wormholes: true }).skinAfter).toBeCloseTo(-Math.log(2 / 0.108), 6);
  });
  it("частичная очистка: оставшееся повреждение (k/k_d − 1)·ln(r_d/r_t)", () => {
    const r = treatedDamageSkin({ damageSkin: 5, damageRadiusM: 0.5, treatedRadiusM: 0.3, wellboreRadiusM: 0.108, wormholes: false });
    expect(r.skinAfter).toBeCloseTo((r.kOverKd - 1) * Math.log(0.5 / 0.3), 6);
  });
});

describe("Рейтинг: риск обводнения", () => {
  const res = { collectorType: "carbonate" as const, temperatureC: 75, permeability_mD: 15, porosity: 0.15, payZoneM: 12, reservoirPressureMPa: 22 };
  it("близкий ВНК и плохой цемент снижают балл СКО", () => {
    const base = rankMethods(res).find((r) => r.method.id === "hcl-matrix")!.score;
    const risky = rankMethods({ ...res, distanceToContactM: 3, cementQuality: "poor" }).find((r) => r.method.id === "hcl-matrix")!.score;
    expect(risky).toBeLessThan(base - 30);
  });
  it("несовместимый коллектор не выше 30 баллов", () => {
    const r = rankMethods({ ...res, collectorType: "sandstone" }).find((m) => m.method.id === "hcl-matrix")!;
    expect(r.score).toBeLessThanOrEqual(30);
  });
});

import { fitArpsDecline, forecastPostTreatment } from "./foam-treatment-diagnostics";

describe("Прогноз начинается с текущего дебита", () => {
  it("базовый дебит в месяц 0 прогноза = дебит на конец истории", () => {
    const hist = Array.from({ length: 19 }, (_, m) => ({ month: m, qOil: 80 * Math.exp((Math.log(35 / 80) / 18) * m) }));
    const arps = fitArpsDecline(hist);
    const res = { Pr: 22, Pb: 15, k_mD: 15, h: 12, mu_cP: 1.2, Bo: 1.15, re: 250, rw: 0.108, skin: 8, tempC: 75 };
    const f = forecastPostTreatment(arps, res, 8, 0, 36, 0.025, 18);
    expect(f[0].qBaseline).toBeCloseTo(35, 0);
  });
});

import { buildInjectionSchedule, calculateStimulationEconomics, allocateAcidToZones } from "./stimulation-operations";

describe("График закачки", () => {
  const base = {
    wellboreVolumeM3: 7.4, pathMD: 2200, perfTVD: 2200, tubingID_mm: 62, tubingLengthM: 2150,
    initialWellboreDensity_gcm3: 1.05, reservoirPressureMPa: 22, fracturePressureMPa: 41.4, safetyMarginMPa: 1.5,
    k_mD: 15, h_m: 12, fluidViscosity_cP: 1.2, skinStart: 8, skinEnd: -0.5, pumpMaxLpm: 500, minRateLpm: 10,
    drainageRadiusM: 250, wellboreRadiusM: 0.108,
  };
  const stages = [
    { name: "Preflush", volumeM3: 3.6, density_gcm3: 1.03 },
    { name: "HCl", volumeM3: 18, density_gcm3: 1.074, isMainAcid: true },
    { name: "Afterflush", volumeM3: 3.6, density_gcm3: 1.03 },
    { name: "Продавка", volumeM3: 7.4, density_gcm3: 1.05 },
  ];
  it("объём сохраняется, забойное ниже Pгрп, расход растёт по мере снятия скина", () => {
    const r = buildInjectionSchedule({ ...base, stages });
    expect(r.points[r.points.length - 1].volumeM3).toBeCloseTo(32.6, 6);
    expect(r.maxBhpMPa).toBeLessThan(41.4);
    expect(r.points[r.points.length - 1].rateLpm).toBeGreaterThan(r.points[0].rateLpm);
  });
  it("в пласт сначала входит скважинная жидкость, кислота — после заполнения ствола", () => {
    const r = buildInjectionSchedule({ ...base, stages });
    const firstAcid = r.points.find((p) => p.entering === "HCl")!;
    expect(firstAcid.volumeM3).toBeGreaterThan(7.4 + 3.6 - 0.2);
  });
});

describe("Экономика", () => {
  it("NPV = дисконтированный поток минус затраты", () => {
    const fc = Array.from({ length: 12 }, (_, m) => ({ month: m, qBaseline: 30, qTreated: 40, deltaQ: 10, cumulativeDeltaM3: 0 }));
    const e = calculateStimulationEconomics(fc, {
      pricePerUnit: 40000, mineralTaxPerUnit: 15000, opexPerUnit: 5000, oilDensity_kgm3: 850, isGas: false,
      profitTaxRate: 0.25, discountRate: 0, reagentCostRub: 1e6, serviceCostRub: 0, mobilizationRub: 0, downtimeDays: 0,
    });
    const margin = (40000 - 15000 - 5000) * 0.75;
    expect(e.npv).toBeCloseTo(12 * 10 * 0.85 * 30.4 * margin - 1e6, 0);
  });
});

describe("Распределение по пропласткам", () => {
  const zones = [{ name: "A", h_m: 4, k_mD: 100, skin: 2 }, { name: "B", h_m: 8, k_mD: 5, skin: 5 }];
  it("без отклонителя — по приёмистости, с идеальным — по толщине", () => {
    const no = allocateAcidToZones(zones, 12, 1, 0);
    expect(no[0].sharePct).toBeGreaterThan(80);
    const ideal = allocateAcidToZones(zones, 12, 1, 1);
    expect(ideal[0].volumeM3).toBeCloseTo(4, 6);
    expect(ideal[1].volumeM3).toBeCloseTo(8, 6);
  });
});
