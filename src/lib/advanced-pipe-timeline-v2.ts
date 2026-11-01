/** Connect V2 fluid advection to the isolated hydrostatic/friction pressure solver. */
import { simulatePipeAdvectionV2, type PumpStageV2 } from "./advanced-pipe-advection-v2";
import { calculatePipePressureProfileV2, type PipePressureProfileV2 } from "./advanced-pipe-pressure-v2";
import type { PipeFluidIntervalV2 } from "./advanced-multifluid-pipe-v2";
import type { PipeFrictionV2Input } from "./advanced-pipe-hydraulics-v2";
import type { TrajectoryPoint } from "./cementing-calculations";

export function simulatePipePressureTimelineV2(
  geometry: Omit<PipeFrictionV2Input, "densityKgM3" | "rheology">,
  initial: Pick<PipeFluidIntervalV2, "name" | "densityKgM3" | "rheology">,
  stages: PumpStageV2[],
  trajectory: TrajectoryPoint[],
  sampleTimesMin: number[],
): { pipeCapacityM3:number; frames: Array<{
    timeMin:number; pumpedM3:number; exitedM3:number;
    fluids:PipeFluidIntervalV2[]; rateLps:number; pressure:PipePressureProfileV2;
  }> } {
  const result=simulatePipeAdvectionV2(geometry,initial,stages,sampleTimesMin);
  let elapsed=0;
  const stageWindows=stages.map(s=>{
    const start=elapsed;elapsed+=s.volumeM3/(s.rateLps*0.06)+(s.pauseAfterMin??0);
    return {start,end:elapsed,rateLps:s.rateLps};
  });
  return {pipeCapacityM3:result.pipeCapacityM3,frames:result.frames.map(frame=>{
    const at=stageWindows.find(s=>frame.timeMin>=s.start&&frame.timeMin<s.end);
    const rateLps=frame.timeMin<=0?0:(at?.rateLps??0);
    const pressure=calculatePipePressureProfileV2({...geometry,flowRateLps:rateLps},frame.inside,trajectory);
    return {timeMin:frame.timeMin,pumpedM3:frame.pumpedM3,exitedM3:frame.exitedM3,
      fluids:frame.inside,rateLps,pressure};
  })};
}
