/** Isolated V2: pipe friction for multiple fluid plugs along a sectional casing. */
import { calculateSectionalPipeFrictionV2, type PipeFrictionSegmentV2, type PipeFrictionV2Input } from "./advanced-pipe-hydraulics-v2";
import type { Rheology } from "./cementing-calculations";

export interface PipeFluidIntervalV2 {
  fromMD: number;
  toMD: number;
  name: string;
  densityKgM3: number;
  rheology: Rheology;
}
export interface FluidPipeSegmentV2 extends PipeFrictionSegmentV2 {
  fluidName: string;
  densityKgM3: number;
}
export interface MultiFluidPipeResultV2 {
  pressureLossMPa: number;
  segments: FluidPipeSegmentV2[];
  model: "steady-state-sectional";
}

/** 
 * Fluids cover [fromMD,toMD) exactly, without gaps or overlaps.
 * Each plug has constant properties; temperature and transient effects excluded.
 */
export function calculateMultiFluidPipeFrictionV2(
  geometry: Omit<PipeFrictionV2Input, "densityKgM3" | "rheology">,
  fluids: PipeFluidIntervalV2[],
): MultiFluidPipeResultV2 {
  if (fluids.length === 0) throw new Error("At least one fluid interval required");
  const sorted = [...fluids].sort((a, b) => a.fromMD - b.fromMD);
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-7;
  if (!near(sorted[0].fromMD, geometry.fromMD) || !near(sorted[sorted.length - 1].toMD, geometry.toMD))
    throw new Error("Fluid intervals must cover the entire calculation depth");
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    if (!f.name.trim() || !Number.isFinite(f.fromMD) || !Number.isFinite(f.toMD) || f.toMD <= f.fromMD ||
        !Number.isFinite(f.densityKgM3) || f.densityKgM3 <= 0 ||
        (i > 0 && !near(sorted[i - 1].toMD, f.fromMD))) {
      throw new Error("Invalid, missing, or overlapping fluid interval");
    }
  }
  const segments: FluidPipeSegmentV2[] = sorted.flatMap(fluid => {
    const result = calculateSectionalPipeFrictionV2({
      ...geometry, fromMD: fluid.fromMD, toMD: fluid.toMD,
      densityKgM3: fluid.densityKgM3, rheology: fluid.rheology,
    });
    return result.segments.map(seg => ({
      ...seg, fluidName: fluid.name, densityKgM3: fluid.densityKgM3,
    }));
  });
  return { pressureLossMPa: segments.reduce((sum, x) => sum + x.pressureLossMPa, 0),
    segments, model: "steady-state-sectional" };
}
