// Кинетика кислотной реакции, wormhole, многоступенчатость, дивертер
export interface AcidReactionKinetics {
  reactionRate: number;              // моль/(м²·с)
  penetrationRadius: number;         // м
  wormholeLength: number;            // м
  dissolutionVolume: number;         // м³
  spentAcidVolume: number;           // м³
  residualAcidConcentration: number; // %
}

// Скорость реакции HCl с CaCO₃ (Lund & Fogler)
export function hclReactionRate(tempC: number, concentration: number): number {
  const A = 7.31e7;
  const Ea = 55000;
  const R = 8.314;
  const T = tempC + 273.15;
  return A * Math.exp(-Ea / (R * T)) * (concentration / 100);
}

// Оптимальный расход для wormholing (Da ≈ 0.29)
export function optimalAcidRate(k_md: number, phi: number, tempC: number, holeDiamM: number): number {
  const Da_opt = 0.29;
  const k_m2 = k_md * 9.869e-16;
  const q_m3s = Da_opt * Math.sqrt(Math.max(k_m2, 1e-20)) * phi * Math.PI * Math.max(holeDiamM, 0.05) * 1e6;
  return Math.max(20, Math.min(2000, q_m3s * 60000));
}

// Полный расчёт кинетики и проникновения
export function computeAcidKinetics(opts: {
  tempC: number;
  concentration: number;     // %
  acidVolumeM3: number;
  payZoneM: number;
  porosity: number;          // доли
  wellboreRadiusM: number;
  collectorType: "carbonate" | "sandstone";
}): AcidReactionKinetics {
  const { tempC, concentration, acidVolumeM3, payZoneM, porosity, wellboreRadiusM, collectorType } = opts;
  const rate = hclReactionRate(tempC, concentration);

  // Радиус проникновения (объёмный баланс)
  const volPerM = acidVolumeM3 / Math.max(payZoneM, 1);
  const rPen = Math.sqrt(volPerM / (Math.PI * Math.max(porosity, 0.05)) + wellboreRadiusM ** 2);

  // Wormhole для карбоната (эмпирика, м)
  let wh = 0;
  if (collectorType === "carbonate") {
    const Da = 0.29;
    wh = Math.min(rPen * 3, 2 + 0.4 * Math.sqrt(acidVolumeM3 / Math.max(payZoneM, 1)) * (1 - Math.min(0.9, rate * 1e3)));
  }

  // Объём растворённой породы: для HCl ~0.082 м³ CaCO₃ на 1 м³ 15% кислоты
  const dissCoef = collectorType === "carbonate" ? 0.082 * (concentration / 15) : 0.015 * (concentration / 12);
  const dissolutionVolume = acidVolumeM3 * dissCoef;

  // Остаточная концентрация (упрощённо: реакция съедает 70-95%)
  const consumed = Math.min(0.95, 0.5 + rate * 5);
  const residual = concentration * (1 - consumed);

  return {
    reactionRate: rate,
    penetrationRadius: rPen - wellboreRadiusM,
    wormholeLength: wh,
    dissolutionVolume,
    spentAcidVolume: acidVolumeM3 * consumed,
    residualAcidConcentration: residual,
  };
}

// ───────────────────── Стехиометрия растворения породы ─────────────────────
// Реакции:
//   Карбонат:   2 HCl + CaCO₃ → CaCl₂ + H₂O + CO₂                (M_HCl=36.46, M_CaCO₃=100.09)
//   Доломит:    4 HCl + CaMg(CO₃)₂ → CaCl₂ + MgCl₂ + 2H₂O + 2CO₂ (M=184.4)
//   Песчаник:   4 HF  + SiO₂ → SiF₄ + 2H₂O                        (M_HF=20.01, M_SiO₂=60.08)
// Плотности (кг/м³): CaCO₃ 2710, CaMg(CO₃)₂ 2840, SiO₂ 2650.
// V_CO₂ при н.у. = n · 22.4 / 1000 [м³ст]; в забое: V_бз = V_ст·(P_ст/P_бз)·(T_бз/T_ст)·Z.

export interface AcidStoichiometry {
  rock: "carbonate" | "dolomite" | "sandstone";
  hclMassKg: number;
  hfMassKg: number;
  rockDissolvedKg: number;
  rockDissolvedM3: number;
  co2VolumeStdM3: number;
  co2VolumeBhM3: number;
  caCl2MassKg: number;
  caF2RiskKg?: number;
  notes: string[];
}

export function computeAcidStoichiometry(opts: {
  acidVolumeM3: number;
  acidDensityKgM3: number;
  hclConcentrationPct: number;
  hfConcentrationPct?: number;
  rock: "carbonate" | "dolomite" | "sandstone";
  preflushUsed?: boolean;
  bhPressureMPa?: number;
  bhTemperatureC?: number;
}): AcidStoichiometry {
  const Vm3 = Math.max(0, opts.acidVolumeM3);
  const totalMassKg = Vm3 * opts.acidDensityKgM3;
  const hclMass = totalMassKg * (opts.hclConcentrationPct / 100);
  const hfMass = totalMassKg * ((opts.hfConcentrationPct ?? 0) / 100);
  const nHCl = hclMass / 36.46 * 1000;
  const nHF = hfMass / 20.01 * 1000;

  let rockKg = 0, rockM3 = 0, co2Mol = 0, caCl2 = 0, caF2 = 0;
  const notes: string[] = [];

  if (opts.rock === "carbonate") {
    const nCaCO3 = nHCl / 2;
    rockKg = nCaCO3 * 100.09 / 1000;
    rockM3 = rockKg / 2710;
    co2Mol = nCaCO3;
    caCl2 = nCaCO3 * 110.98 / 1000;
  } else if (opts.rock === "dolomite") {
    const nDol = nHCl / 4;
    rockKg = nDol * 184.4 / 1000;
    rockM3 = rockKg / 2840;
    co2Mol = nDol * 2;
    caCl2 = nDol * 110.98 / 1000;
    notes.push("Доломит реагирует медленнее кальцита (фактор ~1/5 при T<60°C) — увеличить выдержку.");
  } else {
    const nCaCO3 = nHCl / 2;
    const cementKg = nCaCO3 * 100.09 / 1000;
    co2Mol = nCaCO3;
    const sioKg = (nHF / 4) * 60.08 / 1000;
    rockKg = cementKg + sioKg;
    rockM3 = cementKg / 2710 + sioKg / 2650;
    caCl2 = nCaCO3 * 110.98 / 1000;
    if (hfMass > 0 && !opts.preflushUsed) {
      const nCa = nCaCO3;
      const nF = nHF;
      const nCaF2 = Math.min(nCa, nF / 2);
      caF2 = nCaF2 * 78.07 / 1000;
      notes.push("ВНИМАНИЕ: без preflush HCl возможно осаждение CaF₂ — необратимое повреждение ПЗП.");
    }
    notes.push("Песчаник: цемент ~10% масс., HF растворяет SiO₂ с выходом ~25% (упрощённая модель).");
  }

  const co2VolStd = co2Mol * 22.4 / 1000;
  let co2VolBh = co2VolStd;
  if (opts.bhPressureMPa && opts.bhTemperatureC != null) {
    const Pbh = Math.max(0.5, opts.bhPressureMPa);
    const Tbh = (opts.bhTemperatureC ?? 25) + 273.15;
    const Z = 0.92;
    co2VolBh = co2VolStd * (0.101 / Pbh) * (Tbh / 273.15) * Z;
  }
  if (opts.rock !== "sandstone" && co2VolBh > 0) {
    notes.push(
      `CO₂ в забое: ${co2VolBh.toFixed(2)} м³ (${co2VolStd.toFixed(1)} м³ст). Учесть при стравливании!`,
    );
  }

  return {
    rock: opts.rock,
    hclMassKg: hclMass,
    hfMassKg: hfMass,
    rockDissolvedKg: rockKg,
    rockDissolvedM3: rockM3,
    co2VolumeStdM3: co2VolStd,
    co2VolumeBhM3: co2VolBh,
    caCl2MassKg: caCl2,
    caF2RiskKg: caF2 > 0 ? caF2 : undefined,
    notes,
  };
}

// ───────────────────── Многоступенчатая обработка ─────────────────────
// Карбонат: preflush(NH₄Cl/дизель) → main(HCl) → afterflush(NH₄Cl) → продавка.
// Песчаник + HF (глинокислота) — СТРОГО 3 стадии:
//   1) Preflush HCl 5–7.5% — удалить Ca²⁺/Mg²⁺ (защита от CaF₂)
//   2) Main HCl-HF (12-3 / 13.5-1.5 / 10-2)
//   3) Afterflush NH₄Cl 3–5% — стабилизация pH, защита от вторичных осадков

export type AcidStageRole = "preflush" | "main" | "afterflush" | "displacement";

export interface AcidStage {
  role: AcidStageRole;
  label: string;
  fluid: string;
  volumePerMeterPay: number;
  volumeM3: number;
  purpose: string;
  critical?: boolean;
}

export interface AcidTreatmentStages {
  preflush: AcidStage;
  mainAcid: AcidStage;
  afterflush: AcidStage;
  displacement: { fluid: string; volumeM3: number };
  totalVolumeM3: number;
  scheme: "carbonate-3stage" | "sandstone-glinokislota-3stage";
  recommendations: string[];
}

export function buildAcidStages(opts: {
  collectorType: "carbonate" | "sandstone";
  payZoneM: number;
  mainAcidName: string;
  mainAcidVolPerM: number;
  tubingVolumeM3: number;
  hasHF?: boolean;
}): AcidTreatmentStages {
  const { collectorType, payZoneM, mainAcidName, mainAcidVolPerM, tubingVolumeM3 } = opts;
  const hasHF = opts.hasHF ?? /HF/i.test(mainAcidName);
  const isSandHF = collectorType === "sandstone" && hasHF;

  const preflushVolPerM = isSandHF ? 0.5 : 0.3;
  const afterflushVolPerM = isSandHF ? 0.5 : 0.3;

  const preflush: AcidStage = {
    role: "preflush",
    label: "1. Preflush (буфер)",
    fluid: isSandHF ? "HCl 5–7.5%" : "NH₄Cl 5% / дизель",
    volumePerMeterPay: preflushVolPerM,
    volumeM3: preflushVolPerM * payZoneM,
    purpose: isSandHF
      ? "Растворение карбонатов, удаление Ca²⁺/Mg²⁺ — защита от CaF₂"
      : "Промывка ствола, охлаждение, защита обсадной колонны",
    critical: isSandHF,
  };
  const main: AcidStage = {
    role: "main",
    label: "2. Основная кислота",
    fluid: mainAcidName,
    volumePerMeterPay: mainAcidVolPerM,
    volumeM3: mainAcidVolPerM * payZoneM,
    purpose: isSandHF
      ? "Растворение силикатов и алюмосиликатов (глинокислотная обработка)"
      : "Растворение карбонатов и кольматанта, формирование wormhole",
    critical: true,
  };
  const after: AcidStage = {
    role: "afterflush",
    label: "3. Afterflush",
    fluid: isSandHF ? "NH₄Cl 3–5%" : "NH₄Cl 3% / товарная нефть",
    volumePerMeterPay: afterflushVolPerM,
    volumeM3: afterflushVolPerM * payZoneM,
    purpose: isSandHF
      ? "Вытеснение HF, стабилизация pH, защита от вторичных осадков (Si-гели, Fe(OH)₃)"
      : "Вытеснение отработанной кислоты, стабилизация эмульсий",
    critical: isSandHF,
  };
  const disp = { fluid: "Скважинная жидкость", volumeM3: tubingVolumeM3 };
  const total = preflush.volumeM3 + main.volumeM3 + after.volumeM3 + disp.volumeM3;

  const recs: string[] = [];
  if (isSandHF) {
    recs.push("Глинокислота: СТРОГО соблюдать 3 стадии — без preflush HCl выпадет CaF₂.");
    recs.push("Соотношение HCl:HF = 12:3 / 13.5:1.5 / 10:2 (по составу глин: каолинит/иллит).");
    recs.push("Закачка только в matrix-режиме (< 0.05 bbl/min/ft) — давление ниже ГРП.");
    recs.push("Afterflush ≥ 1.5× объёма main HF — обязательная защита от вторичных осадков.");
  } else {
    recs.push("Карбонат: контролировать Da ≈ 0.29 для оптимального wormholing.");
    recs.push("Preflush необходим при контакте с пластовой водой высокой минерализации.");
  }

  return {
    preflush, mainAcid: main, afterflush: after, displacement: disp,
    totalVolumeM3: total,
    scheme: isSandHF ? "sandstone-glinokislota-3stage" : "carbonate-3stage",
    recommendations: recs,
  };
}

// Распределение кислоты по пластам
export interface ZoneAllocation {
  zoneIdx: number;
  volumeM3: number;
  coveragePct: number;
}

export function acidDistribution(
  zones: Array<{ k: number; h: number; skin?: number; name?: string }>,
  totalAcidVol: number,
  useDiverter: boolean
): ZoneAllocation[] {
  if (!useDiverter) {
    const totalKH = zones.reduce((s, z) => s + z.k * z.h, 0) || 1;
    return zones.map((z, i) => ({
      zoneIdx: i,
      volumeM3: totalAcidVol * (z.k * z.h) / totalKH,
      coveragePct: 100 * (z.k * z.h) / totalKH,
    }));
  }
  return zones.map((_, i) => ({
    zoneIdx: i,
    volumeM3: totalAcidVol / zones.length,
    coveragePct: 100 / zones.length,
  }));
}
