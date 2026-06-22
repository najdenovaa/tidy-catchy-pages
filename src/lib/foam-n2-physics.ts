/**
 * Физика N₂ в пенной обработке:
 *  1) Z-фактор азота по корреляции Papay (Tc=126.2 K, Pc=3.39 МПа)
 *  2) Профиль сжатия N₂ от устья до забоя с учётом Z и P(h)
 *  3) Энергия расширения N₂ при стравливании (изотермическая работа газа)
 *  4) Выносная способность пены при стравливании
 *
 * Использование: вызвать computeFoamN2Physics() с устьевым P, забойным P,
 * температурой по глубине, объёмом N₂ на цикл, FQ.
 */

const T_STD = 293.15; // K (20°C)
const P_STD = 0.101325; // МПа
const R_GAS = 8.314; // Дж/(моль·К)
const M_N2 = 0.028014; // кг/моль

/** Z-фактор N₂ по Papay. */
export function zFactorN2(P_MPa: number, T_K: number): number {
  const Ppr = Math.max(0.01, P_MPa / 3.39);
  const Tpr = T_K / 126.2;
  if (Tpr < 1.05) return 1.0;
  const z = 1 - (3.52 * Ppr) / Math.pow(10, 0.9813 * Tpr)
              + (0.274 * Ppr * Ppr) / Math.pow(10, 0.8157 * Tpr);
  return Math.max(0.5, Math.min(1.2, z));
}

/** Плотность N₂ из уравнения состояния PV = ZnRT. ρ = P·M / (Z·R·T). [кг/м³] */
export function densityN2(P_MPa: number, T_K: number): number {
  const z = zFactorN2(P_MPa, T_K);
  return (P_MPa * 1e6 * M_N2) / (z * R_GAS * T_K);
}

/** Перевод стандартного объёма N₂ (м³ст) в объём при условиях (P, T) с Z. */
export function n2VolumeAtConditions(V_std_m3: number, P_MPa: number, T_K: number): number {
  const z = zFactorN2(P_MPa, T_K);
  return V_std_m3 * (P_STD / P_MPa) * (T_K / T_STD) * z;
}

/** Точка профиля сжатия азота по глубине. */
export interface N2ProfilePoint {
  depthM: number;
  pressureMPa: number;
  temperatureC: number;
  z: number;
  densityKgM3: number;
  /** объём N₂ в этой точке на 1 м³ст */
  vRatio: number;
  /** локальная объёмная доля газа в пене (foam quality на этой глубине) */
  foamQualityPct: number;
}

/**
 * Профиль N₂ от устья до забоя. Линейная аппроксимация P(h) и T(h).
 */
export function buildN2Profile(opts: {
  surfacePressureMPa: number;
  bhPressureMPa: number;
  surfaceTempC: number;
  bhTempC: number;
  depthM: number;
  /** FQ задаётся на поверхности; пересчёт на забой через v_ratio. */
  surfaceFQ_pct: number;
  steps?: number;
}): N2ProfilePoint[] {
  const n = opts.steps ?? 20;
  const out: N2ProfilePoint[] = [];
  // объём газа на поверхности на 1 м³ всей пены
  const Vgas_surf_per_unit = opts.surfaceFQ_pct / 100;
  const Vliq_per_unit = 1 - Vgas_surf_per_unit;

  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const h = opts.depthM * f;
    const P = opts.surfacePressureMPa + (opts.bhPressureMPa - opts.surfacePressureMPa) * f;
    const Tc = opts.surfaceTempC + (opts.bhTempC - opts.surfaceTempC) * f;
    const Tk = Tc + 273.15;
    const z = zFactorN2(P, Tk);
    const rho = densityN2(P, Tk);
    // объём 1 м³ст в условиях (P,T)
    const vRatio = (P_STD / P) * (Tk / T_STD) * z;
    // FQ локальный: объём газа сжимается ~vRatio/vRatio_surf
    const vRatioSurf = (P_STD / opts.surfacePressureMPa) * ((opts.surfaceTempC + 273.15) / T_STD) * zFactorN2(opts.surfacePressureMPa, opts.surfaceTempC + 273.15);
    const Vgas_local = Vgas_surf_per_unit * (vRatio / Math.max(1e-9, vRatioSurf));
    const FQ_local = 100 * Vgas_local / (Vgas_local + Vliq_per_unit);
    out.push({
      depthM: h,
      pressureMPa: P,
      temperatureC: Tc,
      z,
      densityKgM3: rho,
      vRatio,
      foamQualityPct: FQ_local,
    });
  }
  return out;
}

export interface N2ExpansionEnergy {
  /** работа изотермического расширения N₂ от забойного P до устьевого, Дж */
  isothermalWorkJ: number;
  /** то же в МДж */
  isothermalWorkMJ: number;
  /** эквивалент в кВт·ч */
  workKWh: number;
  /** масса жидкости, которую теоретически может поднять эта энергия (на TVD) [кг] */
  liftableMassKg: number;
  /** объём жидкости (для ρ=1000), м³ */
  liftableVolumeM3: number;
  /** скорость расширения в момент стравливания (мощность за 1 мин), кВт */
  peakPowerKW: number;
}

/**
 * Энергия расширения N₂ при стравливании:
 *   W = n·R·T·ln(P_bh/P_surf)   (изотермическая)
 *   n = (P_bh·V_bh)/(Z·R·T)
 *
 * Эта энергия идёт на:
 *  — вынос кольматанта из ПЗП к стволу
 *  — подъём жидкости + механической смеси к устью
 */
export function computeN2ExpansionEnergy(opts: {
  /** объём N₂ в забойных условиях, м³ */
  n2VolumeAtBhM3: number;
  bhPressureMPa: number;
  surfacePressureMPa: number;
  bhTempC: number;
  /** TVD до забоя — для оценки подъёма */
  tvdM: number;
  /** время стравливания, мин (для мощности) */
  bleedDurationMin: number;
}): N2ExpansionEnergy {
  const Tk = opts.bhTempC + 273.15;
  const z = zFactorN2(opts.bhPressureMPa, Tk);
  // моль N₂ в забое
  const n_mol = (opts.bhPressureMPa * 1e6 * opts.n2VolumeAtBhM3) / (z * R_GAS * Tk);
  // изотермическая работа
  const W_J = n_mol * R_GAS * Tk * Math.log(Math.max(1.01, opts.bhPressureMPa / Math.max(0.1, opts.surfacePressureMPa)));
  // подъёмная способность: m·g·h = W → m = W/(g·h)
  const liftMass = W_J / (9.81 * Math.max(1, opts.tvdM));
  const peakPowerW = W_J / Math.max(1, opts.bleedDurationMin * 60);
  return {
    isothermalWorkJ: W_J,
    isothermalWorkMJ: W_J / 1e6,
    workKWh: W_J / 3.6e6,
    liftableMassKg: liftMass,
    liftableVolumeM3: liftMass / 1000,
    peakPowerKW: peakPowerW / 1000,
  };
}

export interface FoamN2PhysicsResult {
  profile: N2ProfilePoint[];
  n2VolumeStdM3: number;
  n2VolumeBhM3: number;
  compressionRatio: number;       // V_std / V_bh
  bhDensityN2KgM3: number;
  surfaceFQ_pct: number;
  bhFQ_pct: number;
  expansionEnergy: N2ExpansionEnergy;
  recommendations: string[];
}

export function computeFoamN2Physics(opts: {
  surfacePressureMPa: number;
  bhPressureMPa: number;
  surfaceTempC: number;
  bhTempC: number;
  tvdM: number;
  /** объём пены, закачанной на поверхности, м³ (на цикл) */
  foamVolumeSurfaceM3: number;
  /** FQ на поверхности, % */
  surfaceFQ_pct: number;
  bleedDurationMin: number;
}): FoamN2PhysicsResult {
  const profile = buildN2Profile({
    surfacePressureMPa: opts.surfacePressureMPa,
    bhPressureMPa: opts.bhPressureMPa,
    surfaceTempC: opts.surfaceTempC,
    bhTempC: opts.bhTempC,
    depthM: opts.tvdM,
    surfaceFQ_pct: opts.surfaceFQ_pct,
  });

  // объём N₂ на поверхности (в составе пены)
  const V_gas_surf = opts.foamVolumeSurfaceM3 * (opts.surfaceFQ_pct / 100);
  // в стандартных условиях:
  const surf = profile[0];
  // перевод "при условиях устья" → "стандарт": V_std = V / vRatio
  const V_std = V_gas_surf / Math.max(1e-9, surf.vRatio);

  // объём в забое
  const bh = profile[profile.length - 1];
  const V_bh = V_std * bh.vRatio;

  const energy = computeN2ExpansionEnergy({
    n2VolumeAtBhM3: V_bh,
    bhPressureMPa: opts.bhPressureMPa,
    surfacePressureMPa: Math.max(0.5, opts.surfacePressureMPa * 0.2), // на стравливании сброс почти до атм.
    bhTempC: opts.bhTempC,
    tvdM: opts.tvdM,
    bleedDurationMin: opts.bleedDurationMin,
  });

  const recs: string[] = [];
  const compressionRatio = V_std / Math.max(1e-6, V_bh);
  if (compressionRatio > 200) recs.push("Высокая степень сжатия — потребуется большой объём N₂ на поверхности.");
  if (bh.foamQualityPct < 30) recs.push(`FQ в забое всего ${bh.foamQualityPct.toFixed(0)}% — фактически почти жидкость. Увеличь поверхностный FQ или снизь BHP.`);
  else if (bh.foamQualityPct > 75) recs.push(`FQ в забое ${bh.foamQualityPct.toFixed(0)}% — выход за стабильное окно (35–75%), пена потеряет несущую способность.`);
  if (energy.peakPowerKW > 200) recs.push(`Пиковая мощность стравливания ${energy.peakPowerKW.toFixed(0)} кВт — обязательно ступенчатый сброс через штуцер.`);
  if (energy.liftableMassKg > 5000) recs.push(`Расширение поднимет ~${(energy.liftableMassKg / 1000).toFixed(1)} т жидкости — высокая выносная способность.`);

  return {
    profile,
    n2VolumeStdM3: V_std,
    n2VolumeBhM3: V_bh,
    compressionRatio,
    bhDensityN2KgM3: bh.densityKgM3,
    surfaceFQ_pct: opts.surfaceFQ_pct,
    bhFQ_pct: bh.foamQualityPct,
    expansionEnergy: energy,
    recommendations: recs,
  };
}
