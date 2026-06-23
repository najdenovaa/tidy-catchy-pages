// ============================================================================
// Part 1 — Sedimentation / segregation of the cement slurry inside the plug
//
// Physical models used (all coefficients are physical constants, no tuning):
//
// 1. Stokes terminal velocity of a cement grain in plasma (water + admixtures):
//       v_s = (ρ_p − ρ_l) · g · d² / (18 · μ_l)
//    Re < 0.1 ⇒ Stokes regime, valid for d50 ≈ 5–80 μm.
//
// 2. Hindered settling (Richardson–Zaki, 1954):
//       v_h = v_s · (1 − φ)^4.65
//    φ = solids volume fraction = (ρ_slurry − ρ_water) / (ρ_solid − ρ_water).
//
// 3. Boycott (1920) effect for inclined columns. Acrivos–Herbolzheimer (1979)
//    closed form for the enhancement factor in a tube of diameter D and
//    inclination θ from vertical:
//       E(θ) = 1 + (L / D) · sin(θ)
//    bounded by physical channel formation (≤ 30×).
//
// 4. Gel-arrest. Free settling proceeds until the static gel strength reaches
//    the API-10B SGS threshold (~48 Pa, "static gel strength = 100 lb/100ft²").
//    Gel build is modelled as linear ramp from τ10s to plateau (Ostroot-Walker
//    correlation):  τ(t) = τ10s + (τ_plateau − τ10s) · min(1, t/t_plateau)
//    Above ~48 Pa the matrix freezes grains in place.
//
// 5. Density redistribution along the plug after sedimentation distance Δ:
//       ρ_bot = ρ_slurry · (1 + Δ/L · k_sed)
//       ρ_top = ρ_slurry · (1 − Δ/L · k_sed)
//    k_sed = (ρ_solid − ρ_water) / ρ_slurry — physical amplification of the
//    density gradient when φ is concentrated at the bottom.
//
// 6. Free-water column (API RP-10B-2 §15): integral water expelled to the top
//    is FW% of slurry volume, height h_fw = FW · L. Acceptance: FW ≤ 0.5 %.
// ============================================================================

const G = 9.81;
const RHO_WATER = 1000;            // kg/m³
const RHO_SOLID_CEMENT = 3150;     // kg/m³ (Portland)
const PLASMA_VISCOSITY_DEFAULT = 0.005; // Pa·s (≈ 5 cP at BHCT 60 °C for w/c 0.44)
const SGS_ARREST_PA = 48;          // API 10B "100 lb/100ft²" gel arrest
const GEL_PLATEAU_MIN_DEFAULT = 60; // min to reach plateau
const RZ_EXPONENT = 4.65;
const BOYCOTT_MAX = 30;

export interface SedimentationInput {
  slurryDensityKgM3: number;     // ρ_slurry
  plasmaViscosityPaS?: number;   // μ_l (default 0.005)
  particleD50um: number;         // d50 in μm
  plugLengthM: number;           // L
  boreDiameterM: number;         // D
  zenithDeg: number;             // θ
  /** Free time before slurry is locked: thickening time OR time to SGS=48 Pa */
  freeTimeMin: number;
  /** Static gel strength curve */
  gel10secPa: number;
  gel10minPa: number;
  gelPlateauPa?: number;         // default = gel10minPa × 2
  gelPlateauMin?: number;        // default = 60
  /** Free water from API laboratory test, % of slurry volume */
  freeWaterPct?: number;         // default 0.5%
  bhctC?: number;
}

export interface SedimentationResult {
  // intermediate
  solidsFraction: number;        // φ
  stokesVelocityMmH: number;     // v_s
  hinderedVelocityMmH: number;   // v_h
  boycottFactor: number;         // E(θ)
  effectiveVelocityMmH: number;  // v_h × E
  timeToGelArrestMin: number;    // when τ(t) ≥ 48 Pa
  effectiveSettlingTimeMin: number;
  // outputs
  sedimentationDistanceM: number; // Δ
  densityTopKgM3: number;
  densityBottomKgM3: number;
  densityDeltaKgM3: number;
  freeWaterHeightMm: number;
  // checks
  passFreeWater: boolean;        // FW ≤ 0.5%
  passDensityGradient: boolean;  // |Δρ| ≤ 60 kg/m³ (RF norm 0.06 g/cm³)
  passBoycott: boolean;          // E ≤ 3
  warnings: string[];
  recommendation: string;
  /** Profile of density along the plug (top → bottom) */
  profile: { positionFracFromTop: number; densityKgM3: number }[];
}

function round(v: number, n = 2): number {
  const p = 10 ** n;
  return Math.round(v * p) / p;
}

export function calculatePlugSedimentation(p: SedimentationInput): SedimentationResult {
  const warnings: string[] = [];
  const μ = p.plasmaViscosityPaS ?? PLASMA_VISCOSITY_DEFAULT;
  const ρ = p.slurryDensityKgM3;
  const d = Math.max(1, p.particleD50um) * 1e-6; // m
  const L = Math.max(0.01, p.plugLengthM);
  const D = Math.max(0.05, p.boreDiameterM);
  const θ = ((p.zenithDeg ?? 0) * Math.PI) / 180;

  // Solids volume fraction
  const φ = Math.min(0.65, Math.max(0.1,
    (ρ - RHO_WATER) / (RHO_SOLID_CEMENT - RHO_WATER)));

  // Stokes terminal velocity (m/s)
  const v_s = ((RHO_SOLID_CEMENT - RHO_WATER) * G * d * d) / (18 * μ);

  // Hindered settling
  const v_h = v_s * Math.pow(1 - φ, RZ_EXPONENT);

  // Boycott enhancement
  const E = Math.min(BOYCOTT_MAX, 1 + (L / D) * Math.sin(θ));
  const v_eff = v_h * E;

  // Gel arrest time — interpolate linear gel build
  const τ10s = Math.max(0, p.gel10secPa);
  const τ10m = Math.max(τ10s, p.gel10minPa);
  const τplateau = Math.max(τ10m, p.gelPlateauPa ?? τ10m * 2);
  const tPlateau = Math.max(10, p.gelPlateauMin ?? GEL_PLATEAU_MIN_DEFAULT);

  // τ(t) = τ10s for t<10s; linear to τ10m at 10 min; linear to plateau at tPlateau
  function tauAt(tMin: number): number {
    if (tMin <= 1 / 6) return τ10s; // 10 sec
    if (tMin <= 10) return τ10s + (τ10m - τ10s) * (tMin - 1/6) / (10 - 1/6);
    if (tMin <= tPlateau) return τ10m + (τplateau - τ10m) * (tMin - 10) / (tPlateau - 10);
    return τplateau;
  }

  // Find time when τ reaches SGS_ARREST_PA
  let tArrest = Infinity;
  if (τplateau >= SGS_ARREST_PA) {
    // binary search 0..tPlateau
    let lo = 0, hi = tPlateau;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (tauAt(m) >= SGS_ARREST_PA) hi = m; else lo = m;
    }
    tArrest = hi;
  }

  const tFree = Math.min(p.freeTimeMin, tArrest);
  const Δ = v_eff * tFree * 60; // m

  // Density gradient
  const k_sed = (RHO_SOLID_CEMENT - RHO_WATER) / ρ;
  const grad = Math.min(0.5, (Δ / L) * k_sed); // cap at 50%
  const ρ_bot = ρ * (1 + grad);
  const ρ_top = ρ * (1 - grad);

  // Free water column
  const FW = (p.freeWaterPct ?? 0.5) / 100;
  const h_fw_mm = FW * L * 1000;

  // Checks
  const passFW = (p.freeWaterPct ?? 0.5) <= 0.5;
  const passDelta = Math.abs(ρ_bot - ρ_top) <= 60;
  const passBoy = E <= 3;

  if (!passBoy)
    warnings.push(`⚠ Boycott-усиление ×${E.toFixed(1)} — наклон ${(θ*180/Math.PI).toFixed(0)}° критичен (>3×).`);
  if (!passFW)
    warnings.push(`⛔ Свободная вода ${(p.freeWaterPct ?? 0.5).toFixed(2)} % > 0.5 % — нарушение API 10B.`);
  if (!passDelta)
    warnings.push(`⛔ Расслоение Δρ = ${Math.abs(ρ_bot - ρ_top).toFixed(0)} кг/м³ > 60 кг/м³ (нарушение РФ ПБ НГП § цемент).`);
  if (tFree >= tArrest)
    warnings.push(`ℹ Седиментация остановлена гелем за ${tArrest.toFixed(0)} мин (τ ≥ 48 Па).`);
  else
    warnings.push(`⚠ Гель не достиг 48 Па за время WOC — оседание продолжается ${tFree.toFixed(0)} мин.`);

  // Density profile (5 points)
  const profile = Array.from({ length: 5 }, (_, i) => {
    const f = i / 4;
    return { positionFracFromTop: f, densityKgM3: ρ_top + (ρ_bot - ρ_top) * f };
  });

  let recommendation = "";
  if (passFW && passDelta && passBoy) {
    recommendation = "Расслоение в пределах норм. Седиментация не критична.";
  } else {
    const fixes: string[] = [];
    if (!passFW) fixes.push("снизить В/Ц или добавить понизитель водоотдачи (FLAC, AMPS)");
    if (!passDelta) fixes.push("увеличить вязкость плазмы (бентонит 1–3 %), уменьшить d50 (тонкий помол), увеличить YP цемента");
    if (!passBoy) fixes.push("уменьшить длину моста или сместить интервал на менее наклонный участок");
    recommendation = "Меры для соблюдения норм: " + fixes.join("; ") + ".";
  }

  return {
    solidsFraction: round(φ, 3),
    stokesVelocityMmH: round(v_s * 1000 * 3600, 3),
    hinderedVelocityMmH: round(v_h * 1000 * 3600, 3),
    boycottFactor: round(E, 2),
    effectiveVelocityMmH: round(v_eff * 1000 * 3600, 3),
    timeToGelArrestMin: isFinite(tArrest) ? round(tArrest, 1) : 99999,
    effectiveSettlingTimeMin: round(tFree, 1),
    sedimentationDistanceM: round(Δ, 4),
    densityTopKgM3: Math.round(ρ_top),
    densityBottomKgM3: Math.round(ρ_bot),
    densityDeltaKgM3: Math.round(ρ_bot - ρ_top),
    freeWaterHeightMm: round(h_fw_mm, 1),
    passFreeWater: passFW,
    passDensityGradient: passDelta,
    passBoycott: passBoy,
    warnings,
    recommendation,
    profile,
  };
}
