/** One-source restart pressure and chart frame adapter for the coupled V2 engine.
 * The coupled solver is sampled by cumulative pumped volume, while pump stops
 * use wall-clock time. No passive U-tube displacement is implied.
 */
import { buildPumpTimelineV2, type PumpIntervalV2 } from "./advanced-pump-timeline-v2";
import { calculateRestartGelV2, type GelIntervalV2 } from "./advanced-restart-gel-v2";

export interface CoupledPressureSampleV2 {
 pumpedM3:number; surfacePressureMPa:number; shoePressureMPa:number;
}
export interface RestartEventV2 {
 stageIndex:number; gelIntervals:GelIntervalV2[]; breakdownVolumeM3:number;
}
export function buildRestartPressureFramesV2(
 stages:PumpIntervalV2[],
 samples:CoupledPressureSampleV2[],
 events:RestartEventV2[],
 timesMin:number[],
){
 const schedule=buildPumpTimelineV2(stages);
 if(!samples.length||samples.some(s=>![s.pumpedM3,s.surfacePressureMPa,s.shoePressureMPa].every(Number.isFinite)))
  throw Error("Invalid coupled pressure samples");
 const sorted=[...samples].sort((a,b)=>a.pumpedM3-b.pumpedM3);
 const sample=(v:number)=>{
  const pair=sorted.findIndex(s=>s.pumpedM3>=v-1e-9);
  if(pair<0)return sorted[sorted.length-1];
  if(pair===0)return sorted[0];
  const a=sorted[pair-1],b=sorted[pair];
  const w=Math.max(0,Math.min(1,(v-a.pumpedM3)/(b.pumpedM3-a.pumpedM3)));
  return {pumpedM3:v,surfacePressureMPa:a.surfacePressureMPa+(b.surfacePressureMPa-a.surfacePressureMPa)*w,
   shoePressureMPa:a.shoePressureMPa+(b.shoePressureMPa-a.shoePressureMPa)*w};
 };
 const restarts=events.map(e=>{
  if(!Number.isInteger(e.stageIndex)||e.stageIndex<1||e.stageIndex>=stages.length)
   throw Error("Invalid restart stage");
  const prev=schedule.intervals.filter(x=>x.name==="Pump stop")[e.stageIndex-1];
  if(!prev)throw Error("Restart needs preceding pump stop");
  const resumed=schedule.intervals.find(x=>x.startMin===prev.endMin&&x.rateLps>0);
  if(!resumed)throw Error("Missing restart");
  return {...e,startMin:resumed.startMin,stopMin:prev.startMin,startVolumeM3:resumed.startVolumeM3};
 });
 return timesMin.map(timeMin=>{
  const state=schedule.at(timeMin),base=sample(state.pumpedM3);
  let excess=0;
  const contributions=restarts.filter(e=>timeMin>=e.startMin).map(e=>{
   const delta=Math.max(0,state.pumpedM3-e.startVolumeM3);
   const g=calculateRestartGelV2({intervals:e.gelIntervals,stoppedAtMin:e.stopMin,
    restartAtMin:e.startMin,movingVolumeM3:delta,breakdownVolumeM3:e.breakdownVolumeM3,
    baselinePressureMPa:0});
   return {stageIndex:e.stageIndex,gelExcessMPa:g.remainingGelPressureMPa};
  });
  if(state.phase==="pumping")excess=contributions.reduce((v,c)=>v+c.gelExcessMPa,0);
  return {...state,timeMin,baseSurfacePressureMPa:base.surfacePressureMPa,
   surfacePressureMPa:base.surfacePressureMPa+excess,shoePressureMPa:base.shoePressureMPa,
   gelRestartExcessMPa:excess,phase:state.phase,
   model:"quasi-steady-pressure-plus-prescribed-gel-breakout" as const};
 });
}
