/**
 * Hydrostatic and quasi-steady pressure profile for V2 advected fluids.
 * Pressure is relative to the pipe inlet: P(md)=P(inlet)+hydrostatic(md)-friction(inlet,md).
 * This is NOT a transient momentum solver or an annular-pressure simulator.
 */
import { calculateMultiFluidPipeFrictionV2, type PipeFluidIntervalV2 } from "./advanced-multifluid-pipe-v2";
import type { PipeFrictionV2Input } from "./advanced-pipe-hydraulics-v2";
import type { TrajectoryPoint } from "./cementing-calculations";
import { interpolateTVD } from "./cementing-calculations";

type Geometry = Omit<PipeFrictionV2Input, "densityKgM3" | "rheology">;
export interface PipePressureNodeV2 {
  md: number;
  tvd: number;
  hydrostaticMPa: number;
  frictionMPa: number;
  pressureRelativeToInletMPa: number;
}
export interface PipePressureProfileV2 {
  nodes: PipePressureNodeV2[];
  bottomHydrostaticMPa: number;
  bottomFrictionMPa: number;
  bottomPressureRelativeToInletMPa: number;
  model: "quasi-steady-incompressible";
}

/** Requires complete fluid coverage; relative pressure can be negative during pumping. */
export function calculatePipePressureProfileV2(
  geometry: Geometry,
  fluids: PipeFluidIntervalV2[],
  trajectory: TrajectoryPoint[],
  extraNodesMD: number[] = [],
): PipePressureProfileV2 {
  if (trajectory.length < 2 || trajectory.some(p=>![p.md,p.tvd].every(Number.isFinite)) ||
      trajectory.some((p,i)=>i>0 && p.md<=trajectory[i-1].md) ||
      geometry.fromMD < trajectory[0].md || geometry.toMD > trajectory[trajectory.length-1].md)
    throw new Error("Invalid or incomplete MD/TVD trajectory");
  // Check fluid coverage, geometry and fluid rheology using the existing V2 validator.
  calculateMultiFluidPipeFrictionV2(geometry,fluids);
  const bounds=[geometry.fromMD,geometry.toMD,
    ...fluids.flatMap(f=>[f.fromMD,f.toMD]),
    ...trajectory.map(p=>p.md),
    ...(geometry.sections??[]).flatMap(s=>[s.fromMD,s.toMD]),
    ...extraNodesMD];
  if (extraNodesMD.some(d=>!Number.isFinite(d)||d<geometry.fromMD||d>geometry.toMD))
    throw new Error("Extra profile nodes outside geometry");
  const xs=[...new Set(bounds.filter(d=>d>=geometry.fromMD&&d<=geometry.toMD))].sort((a,b)=>a-b);
  let hydro=0,friction=0;
  const nodes:PipePressureNodeV2[]=[{
    md:geometry.fromMD,tvd:interpolateTVD(geometry.fromMD,trajectory),
    hydrostaticMPa:0,frictionMPa:0,pressureRelativeToInletMPa:0,
  }];
  for(let i=1;i<xs.length;i++){
    const top=xs[i-1],bottom=xs[i],mid=(top+bottom)/2;
    const fluid=fluids.find(f=>mid>=f.fromMD&&mid<f.toMD);
    if(!fluid)throw new Error("Fluid interval gap");
    const deltaTvd=interpolateTVD(bottom,trajectory)-interpolateTVD(top,trajectory);
    hydro+=fluid.densityKgM3*9.81*deltaTvd/1e6;
    friction+=calculateMultiFluidPipeFrictionV2({...geometry,fromMD:top,toMD:bottom},[
      {...fluid,fromMD:top,toMD:bottom},
    ]).pressureLossMPa;
    nodes.push({md:bottom,tvd:interpolateTVD(bottom,trajectory),hydrostaticMPa:hydro,
      frictionMPa:friction,pressureRelativeToInletMPa:hydro-friction});
  }
  return {nodes,bottomHydrostaticMPa:hydro,bottomFrictionMPa:friction,
    bottomPressureRelativeToInletMPa:hydro-friction,model:"quasi-steady-incompressible"};
}
