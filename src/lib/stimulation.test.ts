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
