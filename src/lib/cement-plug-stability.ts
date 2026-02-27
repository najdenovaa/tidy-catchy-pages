/**
 * Cement plug stability analysis.
 * Evaluates whether a balanced cement plug will remain in place
 * or migrate (slump) downward after pipe removal.
 *
 * Physics:
 * After pipe removal, the cement plug is a free-standing column in the wellbore.
 * Two failure scenarios are evaluated:
 *
 * Scenario 1: Plug sinks THROUGH the spacer below
 *   Driving force: (ρ_cement - ρ_spacer) × g × L_plug_TVD
 *   Resisting force: wall yield stress friction (4/D) × (τ_cement × L_plug + τ_spacer × L_spacer)
 *
 * Scenario 2: Plug + spacer sink TOGETHER in well fluid
 *   Driving force: (ρ_cement - ρ_wf) × g × L_plug + (ρ_spacer - ρ_wf) × g × L_spacer
 *   Resisting force: wall friction of cement + spacer + well fluid yield stress
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
  cementDensityKgM3: number;    // kg/m³
  spacerDensityKgM3: number;    // kg/m³
  wellFluidDensityKgM3: number; // kg/m³
  cementYP: number;             // Pa (yield point)
  spacerYP: number;             // Pa
  wellFluidYP: number;          // Pa
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

  /** Minimum spacer YP needed for SF=1.5 in scenario 1 */
  requiredSpacerYP: number;     // Pa
}

const G = 9.81;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function calculatePlugStability(p: StabilityParams): StabilityResult {
  const {
    plugLengthTVD: Lp, spacerBelowLengthTVD: Ls, boreDiameterM: D,
    cementDensityKgM3: ρc, spacerDensityKgM3: ρs, wellFluidDensityKgM3: ρwf,
    cementYP: τc, spacerYP: τs, wellFluidYP: τwf,
  } = p;

  // --- Scenario 1: plug pushes through spacer below ---
  const drive1 = Math.max(0, (ρc - ρs) * G * Lp);
  const resist1 = D > 0 ? (4 / D) * (τc * Lp + τs * Ls) : 0;
  const sf1 = drive1 > 0.01 ? resist1 / drive1 : 999;

  // --- Scenario 2: plug+spacer move together downward ---
  const drive2_raw = (ρc - ρwf) * G * Lp + (ρs - ρwf) * G * Ls;
  const drive2 = Math.max(0, drive2_raw);
  const resist2 = D > 0 ? (4 / D) * (τc * Lp + τs * Ls + τwf * Lp) : 0;
  const sf2 = drive2 > 0.01 ? resist2 / drive2 : 999;

  const minSF = Math.min(sf1, sf2);
  const isStable = minSF >= 1.0;

  // Required spacer YP for SF=1.5 in scenario 1
  const targetSF = 1.5;
  let requiredSpacerYP = 0;
  if (drive1 > 0 && D > 0 && Ls > 0) {
    requiredSpacerYP = Math.max(0, (drive1 * targetSF * D / 4 - τc * Lp) / Ls);
  }

  const warnings: string[] = [];
  if (sf1 < 1.0)
    warnings.push(`⛔ Мост проседает через буфер (SF₁ = ${sf1.toFixed(2)}). Увеличьте YP буфера или его объём.`);
  else if (sf1 < 1.5)
    warnings.push(`⚠ Малый запас устойчивости через буфер (SF₁ = ${sf1.toFixed(2)}). Рекомендуется SF ≥ 1.5.`);

  if (sf2 < 1.0)
    warnings.push(`⛔ Система мост+буфер уходит вниз (SF₂ = ${sf2.toFixed(2)}). Увеличьте реологию или плотность буфера.`);
  else if (sf2 < 1.5)
    warnings.push(`⚠ Малый запас устойчивости системы (SF₂ = ${sf2.toFixed(2)}).`);

  if (Ls < 1 && Lp > 0)
    warnings.push(`⚠ Нижний буфер слишком мал (${Ls.toFixed(1)} м TVD). Рекомендуется ≥ 5 м.`);

  if (ρc > ρwf * 1.5 && isStable)
    warnings.push(`ℹ Большая разница плотностей (${(ρc / 1000).toFixed(2)} vs ${(ρwf / 1000).toFixed(2)} г/см³). Контролируйте стабильность.`);

  let recommendation = '';
  if (!isStable) {
    recommendation = `Мост нестабилен! Рекомендации:\n` +
      `1. Увеличьте объём нижнего буфера (вязкая пачка)\n` +
      `2. Увеличьте YP буфера до ≥ ${requiredSpacerYP.toFixed(1)} Па\n` +
      `3. Увеличьте YP цемента\n` +
      `4. Уменьшите разницу плотностей`;
  } else if (minSF < 1.5) {
    recommendation = `Мост стабилен, но запас мал. Рекомендуется увеличить YP буфера до ≥ ${requiredSpacerYP.toFixed(1)} Па.`;
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
    requiredSpacerYP: round2(requiredSpacerYP),
  };
}
