/** Immutable pump schedule with explicit zero-flow intervals. Time in minutes. */
export interface PumpIntervalV2 { name:string; rateLps:number; volumeM3:number; pauseAfterMin?:number }
export function buildPumpTimelineV2(stages:PumpIntervalV2[]){
 let time=0,volume=0;
 const intervals:Array<{startMin:number;endMin:number;rateLps:number;startVolumeM3:number;endVolumeM3:number;name:string}>=[];
 for(const s of stages){
  if(!s.name.trim()||![s.rateLps,s.volumeM3,s.pauseAfterMin??0].every(Number.isFinite)||
   s.rateLps<=0||s.volumeM3<=0||(s.pauseAfterMin??0)<0)throw Error("Invalid pump stage");
  const end=time+s.volumeM3/(s.rateLps*0.06);
  intervals.push({startMin:time,endMin:end,rateLps:s.rateLps,
   startVolumeM3:volume,endVolumeM3:volume+s.volumeM3,name:s.name});
  time=end;volume+=s.volumeM3;
  if((s.pauseAfterMin??0)>0){
   intervals.push({startMin:time,endMin:time+s.pauseAfterMin!,rateLps:0,
    startVolumeM3:volume,endVolumeM3:volume,name:"Pump stop"});
   time+=s.pauseAfterMin!;
  }
 }
 return {
  durationMin:time,totalVolumeM3:volume,intervals,
  at(t:number){
   if(!Number.isFinite(t)||t<0||t>time+1e-9)throw Error("Time outside schedule");
   const v=intervals.find(x=>t>=x.startMin&&t<x.endMin);
   if(!v)return {rateLps:0,pumpedM3:volume,phase:"stopped" as const};
   return {rateLps:v.rateLps,pumpedM3:v.startVolumeM3+
    (t-v.startMin)*v.rateLps*0.06,
    phase:v.rateLps>0?"pumping" as const:"stopped" as const};
  }
 };
}
