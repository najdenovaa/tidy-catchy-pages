/** Stage timeline from one V2 pumping programme, including its actual stop boundaries. */
import {buildPumpTimelineV2,type PumpIntervalV2} from "./advanced-pump-timeline-v2";
export interface V2StageBoundary { time:number;label:string }
export function calculateV2StageMetadata(stages:PumpIntervalV2[],cementStageIndices:number[]){
 const schedule=buildPumpTimelineV2(stages);
 if(!stages.length)return {stageBoundaries:[] as V2StageBoundary[],cementStartTime:null,stopTime:0,pumpedVolumeM3:0};
 if(cementStageIndices.some(i=>!Number.isInteger(i)||i<0||i>=stages.length))
  throw Error("Invalid cement stage index");
 const boundaries:V2StageBoundary[]=[];
 let stageIndex=0;
 for(const period of schedule.intervals){
  if(period.rateLps===0)boundaries.push({time:period.startMin,label:"Остановка насосов"});
  else {
   boundaries.push({time:period.startMin,label:stages[stageIndex].name});
   stageIndex++;
  }
 }
 const pumping=schedule.intervals.filter(x=>x.rateLps>0);
 const cementStartTime=cementStageIndices.length
  ?pumping[Math.min(...cementStageIndices)].startMin:null;
 return {stageBoundaries:boundaries,cementStartTime,stopTime:schedule.durationMin,
  pumpedVolumeM3:schedule.totalVolumeM3};
}
