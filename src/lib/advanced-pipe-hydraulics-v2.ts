/**
 * Advanced hydraulics V2 — isolated pipe-friction calculation.
 * Does not replace calculatePressureProfile or affect production calculations.
 * All depths are measured depth (MD), section boundaries are [fromMD, toMD).
 */
import { pipeFrictionMPa, type CasingSection, type Rheology, hbOf, effectiveRheology } from "./cementing-calculations";

export interface PipeFrictionV2Input {
  fromMD: number;
  toMD: number;
  casingODmm: number;
  defaultWallMm: number;
  sections?: CasingSection[];
  flowRateLps: number;
  densityKgM3: number;
  rheology: Rheology;
}

export interface PipeFrictionSegmentV2 {
  fromMD: number;
  toMD: number;
  lengthM: number;
  wallMm: number;
  insideDiameterMm: number;
  pressureLossMPa: number;
  reynolds: number;
  regime: number;
}

export interface PipeFrictionV2Result {
  totalPressureLossMPa: number;
  segments: PipeFrictionSegmentV2[];
  method: "section-by-section";
}

export function calculateSectionalPipeFrictionV2(input: PipeFrictionV2Input): PipeFrictionV2Result {
  const { fromMD, toMD, casingODmm, defaultWallMm, flowRateLps, densityKgM3 } = input;
  const nums = [fromMD, toMD, casingODmm, defaultWallMm, flowRateLps, densityKgM3, input.rheology.pv, input.rheology.yp];
  if (nums.some(n => !Number.isFinite(n)) || fromMD < 0 || toMD <= fromMD ||
      casingODmm <= 0 || defaultWallMm <= 0 || defaultWallMm * 2 >= casingODmm ||
      flowRateLps < 0 || densityKgM3 <= 0 || input.rheology.pv < 0 || input.rheology.yp < 0) {
    throw new Error("Invalid V2 pipe hydraulics input");
  }
  const sections = [...(input.sections ?? [])].sort((a, b) => a.fromMD - b.fromMD);
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (![s.fromMD, s.toMD, s.wallThickness].every(Number.isFinite) ||
        s.fromMD < 0 || s.toMD <= s.fromMD ||
        s.wallThickness <= 0 || s.wallThickness * 2 >= casingODmm ||
        (i > 0 && s.fromMD < sections[i - 1].toMD)) {
      throw new Error("Invalid or overlapping casing sections");
    }
  }
  const boundaries = [fromMD, toMD, ...sections.flatMap(s => [s.fromMD, s.toMD].filter(d => d > fromMD && d < toMD))]
    .sort((a, b) => a - b);
  const distinct = boundaries.filter((d, i) => i === 0 || d > boundaries[i - 1]);
  const rheology = effectiveRheology(input.rheology, "displacement");
  const result: PipeFrictionSegmentV2[] = [];
  for (let i = 1; i < distinct.length; i++) {
    const start = distinct[i - 1], end = distinct[i];
    const mid = (start + end) / 2;
    const match = sections.find(s => mid >= s.fromMD && mid < s.toMD);
    const wallMm = match?.wallThickness ?? defaultWallMm;
    const insideDiameterMm = casingODmm - 2 * wallMm;
    const loss = pipeFrictionMPa(flowRateLps, end - start, insideDiameterMm,
      rheology.pv, rheology.yp, densityKgM3, hbOf(rheology));
    result.push({ fromMD: start, toMD: end, lengthM: end - start, wallMm,
      insideDiameterMm, pressureLossMPa: loss.pressureMPa, reynolds: loss.reynolds, regime: loss.regime });
  }
  return { totalPressureLossMPa: result.reduce((sum, s) => sum + s.pressureLossMPa, 0),
    segments: result, method: "section-by-section" };
}
