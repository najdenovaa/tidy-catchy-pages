/**
 * Cement plug stability analysis.
 *
 * TWO PHYSICAL MODELS depending on whether the system is confined:
 *
 * === CONFINED SYSTEM (default, most practical cases) ===
 * Bottom is closed (wellbore bottom, previous plug, packer, etc.)
 * The spacer below is INCOMPRESSIBLE and has NOWHERE TO GO.
 * → Bulk movement (piston sinking) is PHYSICALLY IMPOSSIBLE.
 * → The only risk is INTERFACE CONTAMINATION via Rayleigh-Taylor fingering.
 *
 * For RT fingering in yield-stress fluids, the interface is stable if:
 *   τ_eff > Δρ × g × D_crit / C
 * where τ_eff = τ_cement + τ_spacer (both must shear for finger to form),
 * D_crit = hydraulic diameter, C ≈ 4π (axisymmetric perturbation).
 *
 * Interface contamination risk:
 *   SF_interface = τ_eff × C / (Δρ × g × Dh)
 *   SF ≥ 1.0 → clean interface expected
 *   SF < 1.0 → some fingering/mixing at interface, but plug STAYS IN PLACE
 *
 * === OPEN SYSTEM (rare: plug over perforations, open-ended liner, etc.) ===
 * Fluid below CAN drain away → piston model applies.
 * Uses wall friction model: ΔP_resist = (4/Dh) × Σ(τ × L)
 *
 * In BOTH cases, the plug position is stable in confined systems.
 * The question is only about INTERFACE QUALITY (contamination depth).
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
  /** Is the system confined (closed bottom)? Default: true */
  isConfined?: boolean;
}

export interface StabilityResult {
  /** Is the system confined (closed bottom)? */
  isConfined: boolean;

  /** Interface stability factor (RT fingering criterion) */
  interfaceSF: number;
  /** Interface contamination risk level */
  interfaceRisk: 'low' | 'medium' | 'high';
  /** Estimated contamination depth at interface, m */
  contaminationDepthM: number;

  /** Piston model results (relevant for open systems, informational for confined) */
  drivingPressure1: number;     // Pa
  resistingPressure1: number;   // Pa
  stabilityFactor1: number;
  drivingPressure2: number;     // Pa
  resistingPressure2: number;   // Pa
  stabilityFactor2: number;

  /** Overall assessment */
  minStabilityFactor: number;
  isStable: boolean;
  warnings: string[];
  recommendation: string;

  /** Minimum spacer gel strength (10 min) needed for clean interface (SF_int=1.0) */
  requiredSpacerGel: number;    // Pa
  requiredSpacerYP: number;     // Pa (backward compat)

  usedGelStrength: boolean;

  /** SF using 10-sec gel */
  stabilityFactor1_10sec: number;
  stabilityFactor2_10sec: number;

  /** Hydraulic diameter used, m */
  hydraulicDiameterM: number;

  /** SF after pipe removal */
  stabilityFactor1_afterPull: number;
  stabilityFactor2_afterPull: number;
}

const G = 9.81;
const GEL_FROM_YP_FACTOR = 3.0;
const GEL_30MIN_FACTOR = 2.0;
/** RT fingering: geometric constant for axisymmetric instability in pipe */
const RT_CONSTANT = 4 * Math.PI; // ≈ 12.57
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

  const isConfined = p.isConfined !== false; // default true

  // Hydraulic diameter: annulus during gel development
  const Dh = d > 0 ? Math.max(D - d, 0.01) : D;

  // Gel strength resolution
  const usedGel = p.cementGel10Min > 0 || p.spacerGel10Min > 0 || p.wellFluidGel10Min > 0;
  const τc = p.cementGel10Min > 0 ? p.cementGel10Min : cementYP * GEL_FROM_YP_FACTOR;
  const τs = p.spacerGel10Min > 0 ? p.spacerGel10Min : spacerYP * GEL_FROM_YP_FACTOR;
  const τwf = p.wellFluidGel10Min > 0 ? p.wellFluidGel10Min : wellFluidYP * GEL_FROM_YP_FACTOR;

  const τc_10s = p.cementGel10Sec > 0 ? p.cementGel10Sec : cementYP;
  const τs_10s = p.spacerGel10Sec > 0 ? p.spacerGel10Sec : spacerYP;
  const τwf_10s = p.wellFluidGel10Sec > 0 ? p.wellFluidGel10Sec : wellFluidYP;

  const τc_30 = τc * GEL_30MIN_FACTOR;
  const τs_30 = τs * GEL_30MIN_FACTOR;
  const τwf_30 = τwf * GEL_30MIN_FACTOR;

  const Δρ_cs = Math.max(0, ρc - ρs);     // cement vs spacer
  const Δρ_cw = Math.max(0, ρc - ρwf);    // cement vs well fluid

  // ═══ INTERFACE STABILITY (Rayleigh-Taylor fingering) ═══
  // For a finger to form, BOTH fluids must yield at the interface
  // Effective yield stress = τ_cement + τ_spacer
  const τ_eff_10min = τc + τs;
  const τ_eff_10sec = τc_10s + τs_10s;
  const τ_eff_30min = τc_30 + τs_30;

  // Critical driving stress for RT instability
  const rtDriving = Δρ_cs * G * Dh / RT_CONSTANT;
  const interfaceSF = rtDriving > 0.01 ? τ_eff_10min / rtDriving : 999;

  // Estimate contamination depth: if SF < 1, fingers can penetrate
  // Penetration limited by gel strength development over time
  let contaminationDepthM = 0;
  if (interfaceSF < 1.0 && Δρ_cs > 0) {
    // Maximum finger penetration ≈ Dh × (1/SF - 1), capped by spacer length
    contaminationDepthM = Math.min(Dh * (1 / Math.max(interfaceSF, 0.1) - 1), Ls);
  }

  const interfaceRisk: 'low' | 'medium' | 'high' =
    interfaceSF >= 1.5 ? 'low' :
    interfaceSF >= 0.7 ? 'medium' : 'high';

  // ═══ PISTON MODEL (for open systems / informational) ═══
  const drive1 = Δρ_cs * G * Lp;
  const resist1 = Dh > 0 ? (4 / Dh) * (τc * Lp + τs * Ls) : 0;
  const sf1 = drive1 > 0.01 ? resist1 / drive1 : 999;

  const resist1_10s = Dh > 0 ? (4 / Dh) * (τc_10s * Lp + τs_10s * Ls) : 0;
  const sf1_10s = drive1 > 0.01 ? resist1_10s / drive1 : 999;

  const resist1_after = D > 0 ? (4 / D) * (τc_30 * Lp + τs_30 * Ls) : 0;
  const sf1_after = drive1 > 0.01 ? resist1_after / drive1 : 999;

  const drive2_raw = Δρ_cw * G * Lp + Math.max(0, ρs - ρwf) * G * Ls;
  const drive2 = Math.max(0, drive2_raw);
  const resist2 = Dh > 0 ? (4 / Dh) * (τc * Lp + τs * Ls + τwf * Lp) : 0;
  const sf2 = drive2 > 0.01 ? resist2 / drive2 : 999;

  const resist2_10s = Dh > 0 ? (4 / Dh) * (τc_10s * Lp + τs_10s * Ls + τwf_10s * Lp) : 0;
  const sf2_10s = drive2 > 0.01 ? resist2_10s / drive2 : 999;

  const resist2_after = D > 0 ? (4 / D) * (τc_30 * Lp + τs_30 * Ls + τwf_30 * Lp) : 0;
  const sf2_after = drive2 > 0.01 ? resist2_after / drive2 : 999;

  // ═══ OVERALL ASSESSMENT ═══
  let minSF: number;
  let isStable: boolean;

  if (isConfined) {
    // In confined system, bulk movement is impossible
    // Stability is determined by interface quality
    minSF = interfaceSF;
    isStable = true; // plug ALWAYS stays in place in confined system
  } else {
    // Open system: piston model applies
    minSF = Math.min(sf1, sf2);
    isStable = minSF >= 1.0;
  }

  // Required spacer gel for clean interface (SF_int = 1.0)
  let requiredSpacerGel = 0;
  if (rtDriving > 0) {
    requiredSpacerGel = Math.max(0, rtDriving - τc);
  }

  // ═══ WARNINGS ═══
  const warnings: string[] = [];

  if (!usedGel) {
    warnings.push(`ℹ СНС не задан — используется оценка: Gel ≈ ${GEL_FROM_YP_FACTOR}×YP. Для точности введите СНС.`);
  }

  if (isConfined) {
    warnings.push(`✅ Мост стабилен.`);
  }

  if (d > 0) {
    warnings.push(`ℹ Dгидр = ${(Dh * 1000).toFixed(0)} мм (скважина ${(D * 1000).toFixed(0)} − трубы ${(d * 1000).toFixed(0)} мм).`);
  }

  if (isConfined) {
    if (interfaceRisk === 'high')
      warnings.push(`⚠ Высокий риск загрязнения интерфейса (SF_инт = ${interfaceSF.toFixed(2)}). Возможно пальцевание на ${contaminationDepthM.toFixed(1)} м. Увеличьте СНС буфера или уменьшите Δρ.`);
    else if (interfaceRisk === 'medium')
      warnings.push(`⚠ Умеренный риск загрязнения интерфейса (SF_инт = ${interfaceSF.toFixed(2)}). Незначительное смешение.`);
    else
      warnings.push(`✅ Чистый интерфейс (SF_инт = ${interfaceSF.toFixed(2)}). Пальцевание подавлено реологией.`);
  } else {
    if (sf1 < 1.0)
      warnings.push(`⛔ Мост проседает через буфер (SF₁ = ${sf1.toFixed(2)}). Увеличьте гель буфера.`);
    else if (sf1 < 1.5)
      warnings.push(`⚠ Малый запас (SF₁ = ${sf1.toFixed(2)}). Рекомендуется SF ≥ 1.5.`);
    if (sf2 < 1.0)
      warnings.push(`⛔ Система уходит вниз (SF₂ = ${sf2.toFixed(2)}).`);
    else if (sf2 < 1.5)
      warnings.push(`⚠ Малый запас (SF₂ = ${sf2.toFixed(2)}).`);
  }

  if (Ls < 1 && Lp > 0)
    warnings.push(`⚠ Нижний буфер слишком мал (${Ls.toFixed(1)} м TVD). Рекомендуется ≥ 5 м для чистого интерфейса.`);

  if (ρc > ρwf * 1.5)
    warnings.push(`ℹ Большая разница плотностей (${(ρc / 1000).toFixed(2)} vs ${(ρwf / 1000).toFixed(2)} г/см³).`);

  // ═══ RECOMMENDATION ═══
  let recommendation = '';
  if (isConfined) {
    if (interfaceRisk === 'low') {
      recommendation = `Мост стабилен. Замкнутая система — проседание невозможно. Интерфейс чистый (SF = ${interfaceSF.toFixed(2)}).`;
    } else if (interfaceRisk === 'medium') {
      recommendation = `Мост стабилен (замкнутая система). Незначительное смешение на интерфейсе (~${contaminationDepthM.toFixed(1)} м).\n` +
        `Для улучшения качества герметизации увеличьте СНС буфера до ≥ ${requiredSpacerGel.toFixed(1)} Па.`;
    } else {
      recommendation = `Мост стабилен (замкнутая система, проседание невозможно), но высокий риск загрязнения интерфейса (~${contaminationDepthM.toFixed(1)} м).\n` +
        `Рекомендации:\n` +
        `1. Увеличьте СНС 10 мин буфера до ≥ ${requiredSpacerGel.toFixed(1)} Па\n` +
        `2. Увеличьте объём нижнего буфера (компенсация зоны смешения)\n` +
        `3. Уменьшите разницу плотностей цемента и буфера`;
    }
  } else {
    if (!isStable) {
      recommendation = `Мост нестабилен (открытая система)! Рекомендации:\n` +
        `1. Увеличьте объём нижнего буфера\n` +
        `2. Увеличьте СНС буфера\n` +
        `3. Уменьшите разницу плотностей`;
    } else if (minSF < 1.5) {
      recommendation = `Мост стабилен, но запас мал (SF = ${minSF.toFixed(2)}).`;
    } else {
      recommendation = `Мост стабилен с хорошим запасом (SF = ${minSF.toFixed(2)}).`;
    }
  }

  return {
    isConfined,
    interfaceSF: round2(interfaceSF),
    interfaceRisk,
    contaminationDepthM: round2(contaminationDepthM),
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
