// Monte Carlo uncertainty analysis for cement quality (CQI)
// Perturbs key inputs (caverns, rheology, eccentricity) and runs N CQI simulations
// Produces P10/P50/P90 distributions + probability of success.

import { calculateCementQuality, type CQIInput } from "./cement-quality-index";

export interface MonteCarloOptions {
  iterations: number;
  cavernUncertainty: number;     // ± fraction (0.15 = ±15%)
  rheologyUncertainty: number;   // ± fraction
  eccentricityUncertainty: number; // ± absolute (0.1)
  successThreshold: number;      // avg CQI considered "successful" (default 70)
}

export interface MonteCarloResult {
  iterations: number;
  avgCqiSamples: number[];
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  stdev: number;
  successProbability: number;    // fraction of runs with avgCqi >= threshold
  gradeDistribution: Record<string, number>; // grade -> fraction
}

// Box-Muller normal sampler
function randomNormal(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Triangular-ish sample in [-uncertainty, +uncertainty], peak near 0
function sampleSymmetric(uncertainty: number): number {
  const z = randomNormal() / 2; // ~ N(0, 0.5)
  return Math.max(-uncertainty, Math.min(uncertainty, z * uncertainty));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)));
  return sorted[idx];
}

function gradeFromCqi(cqi: number): string {
  if (cqi >= 85) return "A";
  if (cqi >= 70) return "B";
  if (cqi >= 55) return "C";
  if (cqi >= 40) return "D";
  return "F";
}

export function runMonteCarloCQI(
  baseInput: CQIInput,
  opts: Partial<MonteCarloOptions> = {},
): MonteCarloResult {
  const options: MonteCarloOptions = {
    iterations: opts.iterations ?? 200,
    cavernUncertainty: opts.cavernUncertainty ?? 0.15,
    rheologyUncertainty: opts.rheologyUncertainty ?? 0.20,
    eccentricityUncertainty: opts.eccentricityUncertainty ?? 0.10,
    successThreshold: opts.successThreshold ?? 70,
  };

  const samples: number[] = [];
  const gradeCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };

  for (let i = 0; i < options.iterations; i++) {
    // Perturb caverns (hole diameter scaling + per-interval coeff)
    const cavernFactor = 1 + sampleSymmetric(options.cavernUncertainty);
    const perturbedWell = {
      ...baseInput.wellData,
      holeDiameter: baseInput.wellData.holeDiameter * cavernFactor,
      cavernCoeff: baseInput.wellData.cavernCoeff * (1 + sampleSymmetric(options.cavernUncertainty)),
      cavernIntervals: baseInput.wellData.cavernIntervals?.map((cv) => ({
        ...cv,
        coeff: cv.coeff * (1 + sampleSymmetric(options.cavernUncertainty)),
      })),
    };

    // Perturb rheology of drilling fluid + cement slurries
    const rheoF = () => 1 + sampleSymmetric(options.rheologyUncertainty);
    const perturbedMud = {
      ...baseInput.drillingFluid,
      rheology: baseInput.drillingFluid.rheology
        ? {
            ...baseInput.drillingFluid.rheology,
            yp: baseInput.drillingFluid.rheology.yp * rheoF(),
            pv: baseInput.drillingFluid.rheology.pv * rheoF(),
          }
        : baseInput.drillingFluid.rheology,
    };
    const perturbedSlurries = baseInput.slurries.map((s) => ({
      ...s,
      rheology: s.rheology
        ? { ...s.rheology, yp: s.rheology.yp * rheoF(), pv: s.rheology.pv * rheoF() }
        : s.rheology,
    }));

    // Perturb eccentricity of each centralization segment
    const perturbedCent = baseInput.centralization?.map((c) => {
      const dEcc = sampleSymmetric(options.eccentricityUncertainty);
      const newEcc = Math.max(0, Math.min(0.95, c.eccentricity + dEcc));
      return {
        ...c,
        eccentricity: newEcc,
        standoff: (1 - newEcc) * 100,
      };
    });

    try {
      const r = calculateCementQuality({
        ...baseInput,
        wellData: perturbedWell,
        drillingFluid: perturbedMud,
        slurries: perturbedSlurries,
        centralization: perturbedCent,
      });
      const avg = r.summary.avgCQI ?? 0;
      samples.push(avg);
      gradeCounts[gradeFromCqi(avg)]++;
    } catch {
      // Skip failed run
    }
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((s, v) => s + v, 0) / Math.max(1, samples.length);
  const variance =
    samples.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, samples.length);
  const stdev = Math.sqrt(variance);
  const success = samples.filter((v) => v >= options.successThreshold).length;

  const gradeDist: Record<string, number> = {};
  const total = Math.max(1, samples.length);
  for (const k of ["A", "B", "C", "D", "F"]) {
    gradeDist[k] = gradeCounts[k] / total;
  }

  return {
    iterations: samples.length,
    avgCqiSamples: samples,
    p10: percentile(sorted, 0.1),
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    mean,
    stdev,
    successProbability: success / total,
    gradeDistribution: gradeDist,
  };
}
