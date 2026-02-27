/**
 * Cement plug stability analysis.
 * Evaluates whether a balanced cement plug will remain in place
 * or migrate (slump) downward after pipe removal.
 *
 * Physics:
 * During and immediately after pipe removal, the cement plug gels
 * in the ANNULAR space between borehole wall and drill pipe.
 * The critical stability window is during pipe withdrawal when:
 * - Gel strength is developing (10sec → 10min → thickening)
 * - The effective friction diameter is the ANNULAR hydraulic gap (D_bore - D_pipe)
 * - Friction acts on TWO surfaces: borehole wall AND pipe wall
 *
 * After pipe removal, the full bore diameter applies, but by that time
 * cement has developed significantly higher gel strength.
 *
 * Resistance formula for annulus (two friction surfaces):
 *   ΔP_friction = 4 × τ × L / Dh
 *   where Dh = D_bore - D_pipe (hydraulic diameter of annulus)
 *
 * Scenario 1: Plug sinks THROUGH the spacer below
 *   Driving force: (ρ_cement - ρ_spacer) × g × L_plug_TVD
 *   Resisting force: (4/Dh) × (SGS_cement × L_plug + SGS_spacer × L_spacer)
 *
 * Scenario 2: Plug + spacer sink TOGETHER in well fluid
 *   Driving force: (ρ_cement - ρ_wf) × g × L_plug + (ρ_spacer - ρ_wf) × g × L_spacer
 *   Resisting force: (4/Dh) × (SGS_cement × L_plug + SGS_spacer × L_spacer + SGS_wf × L_plug)
 *
 * Stability Factor (SF) = Resisting / Driving
 *   SF ≥ 1.5: stable with good margin
 *   1.0 ≤ SF < 1.5: stable but marginal
 *   SF < 1.0: plug will migrate
 */

export interface StabilityParams {
  plugLengthTVD: number;        // m
  spacerBelowLengthTVD: number; // m
  boreDiameterM: number;        // m
  pipeODm: number;              // m (drill pipe OD)
  cementDensityKgM3: number;    // kg/m³
  spacerDensityKgM3: number;    // kg/m³
  wellFluidDensityKgM3: number; // kg/m³
  /** СНС 10 сек, Pa */
  cementGel10Sec: number;
  spacerGel10Sec: number;
  wellFluidGel10Sec: number;
  /** СНС 10 мин, Pa */
  cementGel10Min: number;
  spacerGel10Min: number;
  wellFluidGel10Min: number;
  /** Dynamic YP as fallback, Pa */
  cementYP: number;
  spacerYP: number;
  wellFluidYP: number;
  isDeviated: boolean;
}

export interface StabilityResult {
  /** Scenario 1: plug sinks through spacer below */
  drivingPressure1: number;     // Pa
  resistingPressure1: number;   // Pa
  stabilityFactor1: number;

  /** Scenario 2: plug+spacer sink together in well fluid */
  drivingPressure2: number;     // Pa
  resistingPressure2: number;   // Pa
  stabilityFactor2: number;

  minStabilityFactor: number;
  isStable: boolean;
  warnings: string[];
  recommendation: string;

  /** Minimum spacer gel strength (10 min) needed for SF=1.5 in scenario 1 */
  requiredSpacerGel: number;    // Pa

  /** For backward compatibility */
  requiredSpacerYP: number;     // Pa

  /** Whether gel strength values were used (vs fallback to YP) */
  usedGelStrength: boolean;

  /** SF using 10-sec gel (immediate stability after pumping stops) */
  stabilityFactor1_10sec: number;
  stabilityFactor2_10sec: number;

  /** Hydraulic diameter used for calculation, m */
  hydraulicDiameterM: number;

  /** SF after pipe removal (full bore diameter, estimated 30-min gel) */
  stabilityFactor1_afterPull: number;
  stabilityFactor2_afterPull: number;
}

const G = 9.81;
/** If user doesn't provide gel strength, estimate as YP × this factor */
const GEL_FROM_YP_FACTOR = 3.0;
/** Gel development factor: 30-min gel ≈ 2× 10-min gel (conservative) */
const GEL_30MIN_FACTOR = 2.0;
/** Maximum realistic spacer gel strength, Pa (~80 lb/100ft²) */
const MAX_REALISTIC_GEL_PA = 38;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function calculatePlugStability(p: StabilityParams): StabilityResult {
  const {
    plugLengthTVD: Lp, spacerBelowLengthTVD: Ls, boreDiameterM: D,
    pipeODm: d,
    cementDensityKgM3: ρc, spacerDensityKgM3: ρs, wellFluidDensityKgM3: ρwf,
    cementYP, spacerYP, wellFluidYP,
  } = p;

  // Hydraulic diameter: annulus during gel development (pipe still in hole)
  const Dh = d > 0 ? Math.max(D - d, 0.01) : D;

  // Use gel strength if provided, otherwise estimate from YP
  const usedGel = p.cementGel10Min > 0 || p.spacerGel10Min > 0 || p.wellFluidGel10Min > 0;
  const τc = p.cementGel10Min > 0 ? p.cementGel10Min : cementYP * GEL_FROM_YP_FACTOR;
  const τs = p.spacerGel10Min > 0 ? p.spacerGel10Min : spacerYP * GEL_FROM_YP_FACTOR;
  const τwf = p.wellFluidGel10Min > 0 ? p.wellFluidGel10Min : wellFluidYP * GEL_FROM_YP_FACTOR;

  // 10-sec gel for immediate stability check
  const τc_10s = p.cementGel10Sec > 0 ? p.cementGel10Sec : cementYP;
  const τs_10s = p.spacerGel10Sec > 0 ? p.spacerGel10Sec : spacerYP;
  const τwf_10s = p.wellFluidGel10Sec > 0 ? p.wellFluidGel10Sec : wellFluidYP;

  // Estimated 30-min gel (for after pipe removal scenario)
  const τc_30 = τc * GEL_30MIN_FACTOR;
  const τs_30 = τs * GEL_30MIN_FACTOR;
  const τwf_30 = τwf * GEL_30MIN_FACTOR;

  // --- Scenario 1: plug pushes through spacer below ---
  const drive1 = Math.max(0, (ρc - ρs) * G * Lp);

  // During pipe withdrawal: annular Dh, 10-min gel
  const resist1 = Dh > 0 ? (4 / Dh) * (τc * Lp + τs * Ls) : 0;
  const sf1 = drive1 > 0.01 ? resist1 / drive1 : 999;

  // Immediate (10-sec gel, annular)
  const resist1_10s = Dh > 0 ? (4 / Dh) * (τc_10s * Lp + τs_10s * Ls) : 0;
  const sf1_10s = drive1 > 0.01 ? resist1_10s / drive1 : 999;

  // After pipe removal: full bore D, but ~30-min gel
  const resist1_after = D > 0 ? (4 / D) * (τc_30 * Lp + τs_30 * Ls) : 0;
  const sf1_after = drive1 > 0.01 ? resist1_after / drive1 : 999;

  // --- Scenario 2: plug+spacer move together downward ---
  const drive2_raw = (ρc - ρwf) * G * Lp + (ρs - ρwf) * G * Ls;
  const drive2 = Math.max(0, drive2_raw);

  // During pipe withdrawal: annular Dh, 10-min gel
  const resist2 = Dh > 0 ? (4 / Dh) * (τc * Lp + τs * Ls + τwf * Lp) : 0;
  const sf2 = drive2 > 0.01 ? resist2 / drive2 : 999;

  // Immediate (10-sec gel, annular)
  const resist2_10s = Dh > 0 ? (4 / Dh) * (τc_10s * Lp + τs_10s * Ls + τwf_10s * Lp) : 0;
  const sf2_10s = drive2 > 0.01 ? resist2_10s / drive2 : 999;

  // After pipe removal: full bore D, ~30-min gel
  const resist2_after = D > 0 ? (4 / D) * (τc_30 * Lp + τs_30 * Ls + τwf_30 * Lp) : 0;
  const sf2_after = drive2 > 0.01 ? resist2_after / drive2 : 999;

  const minSF = Math.min(sf1, sf2);
  const minSF_after = Math.min(sf1_after, sf2_after);
  const isStable = minSF >= 1.0;

  // Required spacer gel for SF=1.5 in scenario 1 (annular)
  const targetSF = 1.5;
  let requiredSpacerGel = 0;
  if (drive1 > 0 && Dh > 0 && Ls > 0) {
    requiredSpacerGel = Math.max(0, (drive1 * targetSF * Dh / 4 - τc * Lp) / Ls);
  }

  const warnings: string[] = [];

  if (!usedGel) {
    warnings.push(`ℹ Прочность геля не задана — используется оценка: Gel ≈ ${GEL_FROM_YP_FACTOR}×YP. Для точности введите СНС.`);
  }

  if (d > 0) {
    warnings.push(`ℹ Расчёт при трубах в скважине: Dгидр = ${(Dh * 1000).toFixed(0)} мм (скважина ${(D * 1000).toFixed(0)} − трубы ${(d * 1000).toFixed(0)} мм). Трение по двум поверхностям.`);
  }

  if (sf1 < 1.0)
    warnings.push(`⛔ Мост проседает через буфер (SF₁ = ${sf1.toFixed(2)}). Увеличьте гель буфера или его объём.`);
  else if (sf1 < 1.5)
    warnings.push(`⚠ Малый запас устойчивости через буфер (SF₁ = ${sf1.toFixed(2)}). Рекомендуется SF ≥ 1.5.`);

  if (sf2 < 1.0)
    warnings.push(`⛔ Система мост+буфер уходит вниз (SF₂ = ${sf2.toFixed(2)}). Увеличьте реологию или плотность буфера.`);
  else if (sf2 < 1.5)
    warnings.push(`⚠ Малый запас устойчивости системы (SF₂ = ${sf2.toFixed(2)}).`);

  // 10-sec warnings (immediate stability)
  const minSF_10s = Math.min(sf1_10s, sf2_10s);
  if (minSF_10s < 1.0 && minSF >= 1.0)
    warnings.push(`⚠ Сразу после остановки насосов (СНС 10с) мост нестабилен (SF = ${minSF_10s.toFixed(2)}). Важно быстро набирать прочность геля.`);

  // After pipe removal check
  if (minSF >= 1.0 && minSF_after < 1.0)
    warnings.push(`⚠ После извлечения труб (полный диаметр, ~30-мин гель) SF снижается до ${minSF_after.toFixed(2)}. Контролируйте скорость подъёма.`);
  else if (minSF_after >= 1.5 && minSF < 1.0)
    warnings.push(`ℹ После развития геля (~30 мин) мост стабилизируется (SF = ${minSF_after.toFixed(2)}). Критический период — первые минуты.`);

  if (Ls < 1 && Lp > 0)
    warnings.push(`⚠ Нижний буфер слишком мал (${Ls.toFixed(1)} м TVD). Рекомендуется ≥ 5 м.`);

  if (requiredSpacerGel > MAX_REALISTIC_GEL_PA && minSF < 1.5) {
    warnings.push(`⚠ Требуемый гель буфера (${requiredSpacerGel.toFixed(1)} Па) превышает реалистичный диапазон (≤ ${MAX_REALISTIC_GEL_PA} Па). Увеличьте объём буфера или уменьшите разницу плотностей.`);
  }

  if (ρc > ρwf * 1.5 && isStable)
    warnings.push(`ℹ Большая разница плотностей (${(ρc / 1000).toFixed(2)} vs ${(ρwf / 1000).toFixed(2)} г/см³). Контролируйте стабильность.`);

  let recommendation = '';
  if (!isStable) {
    if (minSF_after >= 1.0) {
      recommendation = `Мост нестабилен при подъёме труб, но стабилизируется после развития геля (~30 мин, SF = ${minSF_after.toFixed(2)}).\n` +
        `Рекомендации:\n` +
        `1. Медленный подъём инструмента для минимизации свабирования\n` +
        `2. Выдержка 10–15 мин перед подъёмом для набора геля\n` +
        `3. Увеличьте СНС 10 мин буфера до ≥ ${Math.min(requiredSpacerGel, MAX_REALISTIC_GEL_PA).toFixed(1)} Па`;
    } else {
      recommendation = `Мост нестабилен! Рекомендации:\n` +
        `1. Увеличьте объём нижнего буфера (вязкая пачка)\n` +
        `2. Увеличьте 10-мин гель буфера до ≥ ${Math.min(requiredSpacerGel, MAX_REALISTIC_GEL_PA).toFixed(1)} Па\n` +
        `3. Если гель > ${MAX_REALISTIC_GEL_PA} Па — увеличьте длину буфера\n` +
        `4. Уменьшите разницу плотностей`;
    }
  } else if (minSF < 1.5) {
    recommendation = `Мост стабилен, но запас мал. Рекомендуется увеличить 10-мин гель буфера до ≥ ${requiredSpacerGel.toFixed(1)} Па.`;
  } else {
    recommendation = `Мост стабилен с хорошим запасом (SF = ${minSF.toFixed(2)}).`;
  }

  return {
    drivingPressure1: round2(drive1),
    resistingPressure1: round2(resist1),
    stabilityFactor1: round2(sf1),
    drivingPressure2: round2(drive2),
    resistingPressure2: round2(resist2),
    stabilityFactor2: round2(sf2),
    minStabilityFactor: round2(minSF),
    isStable,
    warnings,
    recommendation,
    requiredSpacerGel: round2(requiredSpacerGel),
    requiredSpacerYP: round2(requiredSpacerGel),
    usedGelStrength: usedGel,
    stabilityFactor1_10sec: round2(sf1_10s),
    stabilityFactor2_10sec: round2(sf2_10s),
    hydraulicDiameterM: round2(Dh),
    stabilityFactor1_afterPull: round2(sf1_after),
    stabilityFactor2_afterPull: round2(sf2_after),
  };
}
