// ============================================================================
// Part 5 — Integrity of the cement plug under cyclic loads
//
// Three independent failure paths considered, all from first principles:
//
// A. THERMAL CYCLING (injection / shut-in, steam, gas-lift)
//    A radially constrained cement annulus heated/cooled by ΔT develops
//    radial stress at the casing-cement and cement-rock interfaces:
//        Δσ_rad = E_c · α_c · ΔT / (1 − ν_c)
//    (Goodier 1933, plane-strain cylinder).  Positive on heating
//    (compresses cement against rock — usually safe) and negative on
//    cooling (tensile at interface → DEBOND).
//
// B. PRESSURE CYCLING (annular tests, injection pressure pulses)
//    Internal ΔP inside the plug body generates hoop tension by Lamé:
//        Δσ_θ_max = ΔP · (R_o² + R_i²) / (R_o² − R_i²)        at the bore.
//    For solid plug (no inner pipe) the maximum hoop stress collapses to
//    ΔP at the bore — still useful for fatigue accounting.
//
// C. CEMENT S-N FATIGUE (Aas-Jakobsen / fib MC-2010)
//        log10(N_f) = (1 − S_max) · 14 / (1 − R)
//    where S_max = σ_max / f_t  (tensile) or σ_max / f_c  (compressive),
//    R = σ_min / σ_max  ∈ [−1 … 1].
//    Miner's rule sums damage: D = Σ n_i / N_f,i ;  failure at D ≥ 1.
//
// DEBOND CRITERION (Carter & Evans, SPE 87195)
//    Shear-bond strength τ_b ≈ 0.17 · √(UCS_MPa)  [MPa]
//    Hydraulic-bond     σ_h ≈ 0.10 · UCS
//    If max interfacial tensile σ > σ_h  →  micro-annulus opens.
//    Aperture estimate (radial Hooke release):
//        h_μ = (σ − σ_h) · R / E_c        [m]
// ============================================================================

export interface CycleBlock {
  label?: string;
  cycles: number;
  /** Temperature swing, °C (peak − trough). Set 0 if not thermal. */
  deltaT_C: number;
  /** Pressure swing inside plug bore, MPa */
  deltaP_MPa: number;
  /** Stress ratio R = σ_min/σ_max ∈ [−1, 1] */
  R: number;
}

export interface PlugCyclicInput {
  ucsMPa: number;          // f_c
  youngModulusGPa: number; // E_c
  poisson: number;         // ν
  thermalExpansion_perC: number; // α_c (default 10e-6)
  plugLengthM: number;
  boreRadiusM: number;     // R_o
  /** Inner radius if a pipe sits inside (or 0 for solid plug) */
  innerRadiusM: number;    // R_i
  blocks: CycleBlock[];
}

export interface BlockResult {
  label: string;
  cycles: number;
  thermalStressMPa: number; // radial Δσ
  pressureHoopMPa: number;  // hoop Δσ_θ from ΔP
  combinedMaxMPa: number;   // governing tensile σ_max
  sMax: number;             // σ_max / f_t
  R: number;
  Nf: number;               // cycles to failure for this block
  damage: number;           // n / N_f
}

export interface PlugCyclicResult {
  tensileStrengthMPa: number;  // f_t = 0.10·UCS
  shearBondMPa: number;        // τ_b
  hydraulicBondMPa: number;    // σ_h
  blocks: BlockResult[];
  totalDamage: number;         // Miner sum
  remainingCyclesLastBlock: number;
  microAnnulusUm: number;      // 0 if no debond
  debond: boolean;
  status: "safe" | "warn" | "fail";
  warnings: string[];
  recommendation: string;
}

const ALPHA_DEFAULT = 10e-6; // 1/°C, hardened Portland cement
const SN_SLOPE = 14;         // fib MC-2010 cement S-N slope

function round(v: number, n = 2): number {
  const p = 10 ** n;
  return Math.round(v * p) / p;
}

function lameHoop(P: number, Ro: number, Ri: number): number {
  if (Ri <= 0) return P; // solid plug: hoop ≈ ΔP at bore
  const r2 = Ri * Ri, R2 = Ro * Ro;
  if (R2 - r2 <= 0) return P;
  return P * (R2 + r2) / (R2 - r2);
}

function aasJakobsenNf(sMax: number, R: number): number {
  // sMax in [0, 1]. Bound R away from 1 to avoid divide by 0.
  if (sMax <= 0) return Infinity;
  if (sMax >= 1) return 1;
  const r = Math.min(0.999, Math.max(-1, R));
  const logN = ((1 - sMax) * SN_SLOPE) / (1 - r);
  return Math.pow(10, Math.min(20, logN));
}

export function calculatePlugCyclicIntegrity(inp: PlugCyclicInput): PlugCyclicResult {
  const warnings: string[] = [];
  const f_c = Math.max(1, inp.ucsMPa);
  const f_t = 0.10 * f_c;
  const tau_b = 0.17 * Math.sqrt(f_c);
  const sigma_h = 0.10 * f_c;
  const E_MPa = Math.max(1, inp.youngModulusGPa) * 1000;
  const α = inp.thermalExpansion_perC || ALPHA_DEFAULT;
  const ν = Math.min(0.45, Math.max(0.05, inp.poisson || 0.20));

  let totalDamage = 0;
  let lastNf = Infinity;
  let maxInterfaceTension = 0;

  const blocks: BlockResult[] = inp.blocks.map((b, idx) => {
    const dT = Math.abs(b.deltaT_C || 0);
    const dP = Math.abs(b.deltaP_MPa || 0);

    // Thermal radial (tensile on cooling — take magnitude)
    const σ_thermal = (E_MPa * α * dT) / (1 - ν);
    // Pressure hoop tension
    const σ_hoop = lameHoop(dP, inp.boreRadiusM, inp.innerRadiusM);
    // Conservative combination (orthogonal principal stresses): sum
    const σ_max = σ_thermal + σ_hoop;
    maxInterfaceTension = Math.max(maxInterfaceTension, σ_max);

    const S = Math.min(0.99, σ_max / f_t);
    const Nf = aasJakobsenNf(S, b.R ?? 0);
    const damage = b.cycles / Nf;
    if (idx === inp.blocks.length - 1) lastNf = Nf;
    totalDamage += damage;

    return {
      label: b.label || `Цикл-блок ${idx + 1}`,
      cycles: b.cycles,
      thermalStressMPa: round(σ_thermal),
      pressureHoopMPa: round(σ_hoop),
      combinedMaxMPa: round(σ_max),
      sMax: round(S, 3),
      R: b.R ?? 0,
      Nf: isFinite(Nf) ? Math.round(Nf) : 99999999,
      damage: round(damage, 4),
    };
  });

  // Debond check at interface (worst block)
  const debond = maxInterfaceTension > sigma_h;
  const microUm = debond
    ? Math.max(0, (maxInterfaceTension - sigma_h) * inp.boreRadiusM / E_MPa) * 1e6
    : 0;

  let status: "safe" | "warn" | "fail" = "safe";
  if (totalDamage >= 1 || debond) status = "fail";
  else if (totalDamage >= 0.5 || maxInterfaceTension > sigma_h * 0.7) status = "warn";

  if (totalDamage >= 1) warnings.push(`⛔ Кумулятивное повреждение D = ${totalDamage.toFixed(2)} ≥ 1 — усталостное разрушение.`);
  else if (totalDamage >= 0.5) warnings.push(`⚠ D = ${totalDamage.toFixed(2)} (>0.5) — снижен ресурс.`);
  if (debond) warnings.push(`⛔ Дебондинг на контакте: σ = ${maxInterfaceTension.toFixed(2)} МПа > σ_h = ${sigma_h.toFixed(2)} МПа. Микрозазор ≈ ${microUm.toFixed(0)} μm.`);
  else if (maxInterfaceTension > sigma_h * 0.7) warnings.push(`⚠ Запас по сцеплению ≤ 30 %.`);

  const remainingCyclesLastBlock = totalDamage < 1 && isFinite(lastNf)
    ? Math.max(0, Math.round((1 - totalDamage) * lastNf))
    : 0;

  let recommendation = "";
  if (status === "safe") {
    recommendation = `Мост выдерживает заданный цикл-план. Ресурс по последнему блоку: ${remainingCyclesLastBlock.toLocaleString()} циклов.`;
  } else if (status === "warn") {
    recommendation = `Запас усталости ограничен. Меры:
• Использовать цемент с E ≤ 8 ГПа (эластичный, латексный/волоконный) — снижает термическую σ.
• Ограничить ΔP опрессовки ≤ 0.7 × расчётной.
• Увеличить длину моста (распределение нагрузки).`;
  } else {
    recommendation = `⛔ Конструкция не проходит. Обязательные меры:
• Эластичный цемент (E ≤ 6 ГПа, расширяющие добавки ≥ 0.2 %).
• Двойной барьер (две независимые пробки).
• Снизить амплитуду термоцикла (предпрогрев скважины перед закачкой).
• Пересмотреть программу опрессовки.`;
  }

  return {
    tensileStrengthMPa: round(f_t),
    shearBondMPa: round(tau_b),
    hydraulicBondMPa: round(sigma_h),
    blocks,
    totalDamage: round(totalDamage, 4),
    remainingCyclesLastBlock,
    microAnnulusUm: round(microUm, 1),
    debond,
    status,
    warnings,
    recommendation,
  };
}
