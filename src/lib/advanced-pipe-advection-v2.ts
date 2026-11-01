/** V2 plug-advection model: incompressible, no mixing or leakoff, zero dispersion. */
import { calculateMultiFluidPipeFrictionV2, type PipeFluidIntervalV2 } from "./advanced-multifluid-pipe-v2";
import type { PipeFrictionV2Input } from "./advanced-pipe-hydraulics-v2";
import type { Rheology, CasingSection } from "./cementing-calculations";

export interface PumpStageV2 {
  name: string;
  densityKgM3: number;
  rheology: Rheology;
  rateLps: number;
  volumeM3: number;
}
export interface AdvectionFrameV2 {
  timeMin: number;
  pumpedM3: number;
  inside: PipeFluidIntervalV2[];
  exitedM3: number;
  frictionMPa: number;
}
type GeometryV2 = Omit<PipeFrictionV2Input, "densityKgM3" | "rheology">;
const tolerance = 1e-8;

function capacity(geometry: GeometryV2) {
  const { fromMD, toMD, casingODmm, defaultWallMm } = geometry;
  if (![fromMD, toMD, casingODmm, defaultWallMm].every(Number.isFinite) ||
      fromMD < 0 || toMD <= fromMD || defaultWallMm <= 0 || casingODmm <= 2 * defaultWallMm)
    throw new Error("Invalid casing geometry");
  const sections = [...(geometry.sections ?? [])].sort((a,b) => a.fromMD - b.fromMD);
  for (let i=0;i<sections.length;i++) {
    const s=sections[i];
    if (![s.fromMD,s.toMD,s.wallThickness].every(Number.isFinite) || s.fromMD < 0 ||
      s.toMD <= s.fromMD || s.wallThickness <= 0 || 2*s.wallThickness >= casingODmm ||
      (i>0 && s.fromMD < sections[i-1].toMD)) throw new Error("Invalid casing sections");
  }
  const xs=[fromMD,toMD,...sections.flatMap(s=>[s.fromMD,s.toMD].filter(d=>d>fromMD&&d<toMD))].sort((a,b)=>a-b);
  const boundaries=xs.filter((d,i)=>i===0||d>xs[i-1]);
  const parts=[] as { top:number; bottom:number; startV:number; endV:number; area:number }[];
  let v=0;
  for(let i=1;i<boundaries.length;i++) {
    const top=boundaries[i-1],bottom=boundaries[i],mid=(top+bottom)/2;
    const wall=sections.find(s=>mid>=s.fromMD&&mid<s.toMD)?.wallThickness??defaultWallMm;
    const id=(casingODmm-2*wall)/1000;
    const area=Math.PI*id*id/4;
    const delta=(bottom-top)*area;
    parts.push({top,bottom,startV:v,endV:v+delta,area});
    v+=delta;
  }
  function depthAtVolume(position:number):number {
    if (position<=0) return fromMD;
    if (position>=v) return toMD;
    const p=parts.find(s=>position<=s.endV+tolerance)!;
    return p.top+(position-p.startV)/p.area;
  }
  return { volume:v, depthAtVolume };
}

/** At time t, injected fluid occupies the leading portion of the pipe. Older plugs travel deeper. */
export function simulatePipeAdvectionV2(
  geometry: GeometryV2,
  initial: Pick<PipeFluidIntervalV2,"name"|"densityKgM3"|"rheology">,
  stages: PumpStageV2[],
  sampleTimesMin: number[],
): { pipeCapacityM3:number; frames:AdvectionFrameV2[] } {
  if (![initial.densityKgM3,initial.rheology.pv,initial.rheology.yp].every(Number.isFinite) ||
      initial.densityKgM3<=0 || initial.rheology.pv<0 || initial.rheology.yp<0 || !initial.name.trim())
    throw new Error("Invalid initial fluid");
  const pipe=capacity(geometry);
  let t=0,v=0;
  const batch=stages.map(s=>{
    if (!s.name.trim() || ![s.densityKgM3,s.rheology.pv,s.rheology.yp,s.rateLps,s.volumeM3].every(Number.isFinite) ||
      s.densityKgM3<=0 || s.rheology.pv<0 || s.rheology.yp<0 || s.rateLps<=0 || s.volumeM3<=0)
      throw new Error("Invalid pumping stage");
    const duration=s.volumeM3/(s.rateLps*0.06);
    const b={...s,startTime:t,endTime:t+duration,startV:v,endV:v+s.volumeM3};
    t+=duration;v+=s.volumeM3;return b;
  });
  const pumpedAt=(time:number)=>{
    let result=0;
    for(const s of batch) result+=Math.min(s.volumeM3,Math.max(0,(time-s.startTime)*s.rateLps*0.06));
    return result;
  };
  const frames=sampleTimesMin.map(time=>{
    if(!Number.isFinite(time)||time<0||time>t+tolerance)throw new Error("Time outside pumping program");
    const pumped=pumpedAt(time);
    const plugs: {fromV:number;toV:number;name:string;densityKgM3:number;rheology:Rheology}[]=[];
    for(const b of batch){
      const injected=Math.min(b.volumeM3,Math.max(0,(time-b.startTime)*b.rateLps*0.06));
      if(injected<=tolerance)continue;
      const start=Math.max(0,pumped-(b.startV+injected));
      const end=Math.min(pipe.volume,pumped-b.startV);
      if(end>start+tolerance)plugs.push({fromV:start,toV:end,name:b.name,densityKgM3:b.densityKgM3,rheology:b.rheology});
    }
    if(pumped<pipe.volume-tolerance)
      plugs.push({fromV:pumped,toV:pipe.volume,name:initial.name,densityKgM3:initial.densityKgM3,rheology:initial.rheology});
    plugs.sort((a,b)=>a.fromV-b.fromV);
    const inside=plugs.map(p=>({fromMD:pipe.depthAtVolume(p.fromV),toMD:pipe.depthAtVolume(p.toV),
      name:p.name,densityKgM3:p.densityKgM3,rheology:p.rheology}));
    const current= batch.find(b=>time>=b.startTime&&time<b.endTime)??batch[batch.length-1];
    const rate= time===0||!current?0:current.rateLps;
    const frictionMPa=calculateMultiFluidPipeFrictionV2({...geometry,flowRateLps:rate},inside.length?inside:[
      {...initial,fromMD:geometry.fromMD,toMD:geometry.toMD}
    ]).pressureLossMPa;
    return {timeMin:time,pumpedM3:pumped,inside,exitedM3:Math.max(0,pumped-pipe.volume),frictionMPa};
  });
  return {pipeCapacityM3:pipe.volume,frames};
}
