// ════════════════════════════════════════════════════════════════════
// Универсальный химический движок кислотных составов (HCl / HF + добавки).
// Используется в ГНКТ (CTAcidStimTab) и Интенсификации (Stimulation).
// Полная стехиометрия — никаких фиксированных таблиц.
// ════════════════════════════════════════════════════════════════════

// ── Молярные массы (г/моль) ──
export const M = {
  HCl: 36.46, HF: 20.01,
  CaCO3: 100.09,
  CaMgCO3_2: 184.40,
  SiO2: 60.08,
  CaCl2: 110.98, MgCl2: 95.21,
  CO2: 44.01, H2O: 18.02,
  SiF4: 104.08, H2SiF6: 144.09,
};

// ── Плотности растворов кислот (г/см³, линейная аппроксимация при 20°C) ──
export function hclDensity(concPct: number): number {
  return 1.000 + 0.00493 * Math.max(0, concPct);
}
export function hfDensity(concPct: number): number {
  return 1.000 + 0.0035 * Math.max(0, concPct);
}

export interface AcidComposition {
  hclPct: number;
  hfPct: number;
  corrosionInhibitorPct: number;
  ironControlPct: number;
  surfactantPct: number;
  mutualSolventPct: number;
  retarderPct: number;
}

export const DEFAULT_ACID_COMPOSITION: AcidComposition = {
  hclPct: 15, hfPct: 0,
  corrosionInhibitorPct: 0.5,
  ironControlPct: 0.5,
  surfactantPct: 0.3,
  mutualSolventPct: 5,
  retarderPct: 0,
};

export interface DissolvingResult {
  densityGcc: number;
  hclMolPerL: number;
  hfMolPerL: number;
  dissolvingPowerCalcite: number;   // кг CaCO₃ / м³ кислоты
  dissolvingPowerDolomite: number;  // кг доломита / м³
  dissolvingPowerQuartz: number;    // кг SiO₂ / м³ (HF>0)
  co2GeneratedM3PerM3: number;      // м³ CO₂ при пластовых P,T / м³ кислоты
  co2GeneratedStdM3PerM3: number;   // м³ CO₂ при н.у. / м³ кислоты
  effectiveAcidStrength: number;    // эффективная % HCl с учётом замедлителя
}

// ── Z-фактор CO₂ (упрощённая корреляция Tr/Pr) ──
export function co2ZFactor(P_MPa: number, T_K: number): number {
  const Tc = 304.13, Pc = 7.38;
  const Tr = T_K / Tc;
  const Pr = Math.max(0.05, P_MPa) / Pc;
  const z = 1 - (0.27 * Pr) / Tr + 0.08 * Pr * Pr / (Tr * Tr);
  return Math.max(0.25, Math.min(1.05, z));
}

// ════════════════════════════════════════════════════════════════════
// ГЛАВНАЯ ФУНКЦИЯ — растворяющая способность из стехиометрии
// ════════════════════════════════════════════════════════════════════
export function calculateDissolvingPower(
  comp: AcidComposition,
  bhPressureMPa: number,
  bhTemperatureC: number,
): DissolvingResult {
  const density = hclDensity(comp.hclPct) + (comp.hfPct > 0 ? (hfDensity(comp.hfPct) - 1) : 0);
  const rhoAcid = density * 1000; // кг/м³

  const hclMassPerM3 = rhoAcid * (comp.hclPct / 100);
  const hclMolesPerM3 = (hclMassPerM3 / M.HCl) * 1000;
  const hfMassPerM3 = rhoAcid * (comp.hfPct / 100);
  const hfMolesPerM3 = (hfMassPerM3 / M.HF) * 1000;

  // 2 HCl + CaCO₃
  const calciteMoles = hclMolesPerM3 / 2;
  const dissolvingPowerCalcite = (calciteMoles * M.CaCO3) / 1000;

  // 4 HCl + CaMg(CO₃)₂
  const dolomiteMoles = hclMolesPerM3 / 4;
  const dissolvingPowerDolomite = (dolomiteMoles * M.CaMgCO3_2) / 1000;

  // SiO₂ + 6 HF → H₂SiF₆ + 2 H₂O
  const quartzMoles = hfMolesPerM3 / 6;
  const dissolvingPowerQuartz = (quartzMoles * M.SiO2) / 1000;

  // CO₂ при полной реакции: 1 моль CaCO₃ → 1 моль CO₂
  const co2MolesPerM3 = calciteMoles;
  const T_K = bhTemperatureC + 273.15;
  const Z = co2ZFactor(bhPressureMPa, T_K);
  const co2VolBh = bhPressureMPa > 0
    ? (co2MolesPerM3 * 8.314 * T_K * Z) / (bhPressureMPa * 1e6)
    : (co2MolesPerM3 * 22.4) / 1000;
  const co2VolStd = (co2MolesPerM3 * 22.4) / 1000;

  const effectiveAcidStrength = comp.hclPct * (1 - Math.min(0.95, comp.retarderPct * 0.05));

  const hclMolPerL = hclMassPerM3 / M.HCl; // = моль/л (так как кг/м³ ÷ г/моль = моль/л)
  const hfMolPerL = hfMassPerM3 / M.HF;

  return {
    densityGcc: density,
    hclMolPerL, hfMolPerL,
    dissolvingPowerCalcite,
    dissolvingPowerDolomite,
    dissolvingPowerQuartz,
    co2GeneratedM3PerM3: co2VolBh,
    co2GeneratedStdM3PerM3: co2VolStd,
    effectiveAcidStrength,
  };
}

// ── Скорость реакции HCl–CaCO₃ (Lund-Fogler, Arrhenius) ──
export function reactionRate(hclConcMolPerL: number, temperatureC: number): number {
  const A = 7.314e7;
  const Ea = 62800;
  const R = 8.314;
  const T = temperatureC + 273.15;
  const order = 0.63;
  return A * Math.exp(-Ea / (R * T)) * Math.pow(Math.max(1e-6, hclConcMolPerL), order);
}

// ════════════════════════════════════════════════════════════════════
// Радиус/глубина проникновения и wormhole
// ════════════════════════════════════════════════════════════════════
export interface PenetrationResult {
  penetrationRadiusM: number;
  wormholeLengthM: number;
  dissolvedRockKg: number;
  damkohler: number;
}

export function acidPenetration(
  comp: AcidComposition,
  diss: DissolvingResult,
  acidVolumeM3: number,
  payZoneM: number,
  porosity: number,
  wellboreRadiusM: number,
  rockType: "carbonate" | "sandstone" | "dolomite",
  temperatureC: number,
  pumpRateLpm: number,
): PenetrationResult {
  const beta = rockType === "carbonate" ? diss.dissolvingPowerCalcite
             : rockType === "dolomite"  ? diss.dissolvingPowerDolomite
             : diss.dissolvingPowerQuartz;
  const rockDensity = rockType === "carbonate" ? 2710 : rockType === "dolomite" ? 2870 : 2650;
  const dissolvedRockKg = beta * acidVolumeM3;
  const dissolvedRockVol = dissolvedRockKg / rockDensity;
  const effPhi = Math.max(0.03, porosity);

  const rPen = Math.sqrt(
    (acidVolumeM3 + dissolvedRockVol) / (Math.PI * Math.max(0.5, payZoneM) * effPhi) +
      wellboreRadiusM ** 2
  );

  const rate = reactionRate(diss.hclMolPerL, temperatureC);
  const Q_m3s = pumpRateLpm / 60000;
  const velocity = Q_m3s / Math.max(1e-6, Math.PI * wellboreRadiusM * Math.max(0.5, payZoneM));
  const damkohler = rate / Math.max(1e-9, velocity * 1000);

  const whEff = Math.exp(-Math.pow(Math.log(Math.max(1e-3, damkohler) / 0.29), 2) / 2);
  const wormholeLengthM = rockType !== "sandstone" ? Math.max(0, rPen - wellboreRadiusM) * whEff : 0;

  return { penetrationRadiusM: rPen, wormholeLengthM, dissolvedRockKg, damkohler };
}

// ════════════════════════════════════════════════════════════════════
// Валидация состава
// ════════════════════════════════════════════════════════════════════
export function validateComposition(
  comp: AcidComposition,
  rockType: "carbonate" | "sandstone" | "dolomite",
  tempC: number,
): string[] {
  const w: string[] = [];
  if (comp.hfPct > 0 && (rockType === "carbonate" || rockType === "dolomite"))
    w.push("⚠ HF с карбонатом/доломитом → осаждение CaF₂. Использовать только HCl.");
  if (comp.hclPct > 28)
    w.push("⚠ HCl > 28% — крайне агрессивна, риск коррозии даже с ингибитором.");
  if (comp.hfPct > 0 && comp.hclPct < 3 * comp.hfPct)
    w.push("⚠ Соотношение HCl:HF < 3:1 — риск вторичного осаждения. Увеличить HCl.");
  if (tempC > 90 && comp.hfPct > 0)
    w.push("⚠ HF при T > 90°C — очень быстрая реакция, малое проникновение.");
  if (comp.corrosionInhibitorPct < 0.3 && tempC > 80)
    w.push("⚠ Ингибитор коррозии < 0.3% при T > 80°C — недостаточная защита труб.");
  if (comp.hclPct === 0 && comp.hfPct === 0)
    w.push("⚠ Нулевая концентрация активной кислоты — состав неработоспособен.");
  return w;
}

// ── Пресеты для быстрого ввода ──
export const ACID_PRESETS: { id: string; label: string; desc: string; comp: Partial<AcidComposition> }[] = [
  { id: "hcl-7.5", label: "HCl 7.5%", desc: "Предпоток / слабая обработка",
    comp: { hclPct: 7.5, hfPct: 0 } },
  { id: "hcl-15", label: "HCl 15%", desc: "Стандарт для карбонатов",
    comp: { hclPct: 15, hfPct: 0 } },
  { id: "hcl-20", label: "HCl 20%", desc: "Усиленная обработка",
    comp: { hclPct: 20, hfPct: 0 } },
  { id: "hcl-28", label: "HCl 28%", desc: "Глубокая обработка карбоната",
    comp: { hclPct: 28, hfPct: 0 } },
  { id: "mud-12-3", label: "Mud Acid 12/3", desc: "12% HCl + 3% HF — песчаники",
    comp: { hclPct: 12, hfPct: 3 } },
  { id: "mud-13.5-1.5", label: "Mud Acid 13.5/1.5", desc: "Глинистый песчаник",
    comp: { hclPct: 13.5, hfPct: 1.5 } },
  { id: "mud-10-2", label: "Mud Acid 10/2", desc: "Каолинитовый песчаник",
    comp: { hclPct: 10, hfPct: 2 } },
];
