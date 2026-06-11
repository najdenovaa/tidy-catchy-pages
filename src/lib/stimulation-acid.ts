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

// Многоступенчатая обработка
export interface AcidTreatmentStages {
  preflush: { fluid: string; volumePerMeterPay: number; volumeM3: number; purpose: string };
  mainAcid: { fluid: string; volumePerMeterPay: number; volumeM3: number; purpose: string };
  afterflush: { fluid: string; volumePerMeterPay: number; volumeM3: number; purpose: string };
  displacement: { fluid: string; volumeM3: number };
  totalVolumeM3: number;
}

export function buildAcidStages(opts: {
  collectorType: "carbonate" | "sandstone";
  payZoneM: number;
  mainAcidName: string;
  mainAcidVolPerM: number;
  tubingVolumeM3: number;
}): AcidTreatmentStages {
  const { collectorType, payZoneM, mainAcidName, mainAcidVolPerM, tubingVolumeM3 } = opts;
  const isSand = collectorType === "sandstone";
  const preflushVolPerM = isSand ? 0.4 : 0.3;
  const afterflushVolPerM = isSand ? 0.4 : 0.3;
  const preflush = {
    fluid: isSand ? "HCl 5%" : "NH₄Cl 5%",
    volumePerMeterPay: preflushVolPerM,
    volumeM3: preflushVolPerM * payZoneM,
    purpose: isSand ? "Растворение карбонатов, защита от CaF₂" : "Промывка ствола, защита от кольматации",
  };
  const main = {
    fluid: mainAcidName,
    volumePerMeterPay: mainAcidVolPerM,
    volumeM3: mainAcidVolPerM * payZoneM,
    purpose: "Растворение повреждения",
  };
  const after = {
    fluid: isSand ? "NH₄Cl 3%" : "HCl 3%",
    volumePerMeterPay: afterflushVolPerM,
    volumeM3: afterflushVolPerM * payZoneM,
    purpose: "Вытеснение отработанной кислоты, стабилизация pH",
  };
  const disp = { fluid: "Скважинная жидкость", volumeM3: tubingVolumeM3 };
  const total = preflush.volumeM3 + main.volumeM3 + after.volumeM3 + disp.volumeM3;
  return { preflush, mainAcid: main, afterflush: after, displacement: disp, totalVolumeM3: total };
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
