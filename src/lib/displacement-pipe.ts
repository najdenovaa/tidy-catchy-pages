import type { D2Fluid, D2Stage, D2Result } from './displacement-2d';
import { reportSeriesPlot } from './report-series-plot';
export interface PipeSegment { topMD:number; bottomMD:number; startM3:number; endM3:number }
export interface PipeStage extends D2Stage { startS:number; endS:number; startM3:number; endM3:number }
export interface PipeTransport { fluids:D2Fluid[]; segments:PipeSegment[]; capacityM3:number; stages:PipeStage[]; pumpTimeS:number }
export interface DisplacementFrame { timeS:number; annulusFrame:number }
export const PIPE_NOTE='Труба: несжимаемый поршневой перенос без смешения и свободного падения. Вместимость учитывает секции колонны. Доля - средняя по объёму выбранной осевой ячейки, а не степень химического смешения. Радиальное распределение жидкости не рассчитывается.';
const overlap=(a:number,b:number,c:number,d:number)=>Math.max(0,Math.min(b,d)-Math.max(a,c));
export function buildPipeTransport(fluids:D2Fluid[],segments:PipeSegment[],source:D2Stage[]):PipeTransport {
  if(!fluids.length||!segments.length||segments[0].topMD!==0||segments[0].startM3!==0||segments.some((s,i)=>![s.topMD,s.bottomMD,s.startM3,s.endM3].every(Number.isFinite)||s.endM3<=s.startM3||s.bottomMD<=s.topMD||(i>0&&(Math.abs(s.startM3-segments[i-1].endM3)>1e-8||s.topMD!==segments[i-1].bottomMD))))throw new Error('Недопустимая геометрия трубного пространства');
  let time=0,volume=0;
  const stages=source.map(s=>{
    if(!Number.isInteger(s.fluid)||!fluids[s.fluid]||!Number.isFinite(s.volumeM3)||s.volumeM3<0||!Number.isFinite(s.rateM3s)||s.rateM3s<0||(s.volumeM3>0&&s.rateM3s<=0)||!Number.isFinite(s.holdS??0)||(s.holdS??0)<0)throw new Error('Недопустимая порция трубного переноса');
    const duration=s.volumeM3>0?s.volumeM3/s.rateM3s:(s.holdS??0);
    const out={...s,startS:time,endS:time+duration,startM3:volume,endM3:volume+s.volumeM3};time+=duration;volume+=s.volumeM3;return out;
  });
  return {fluids,segments,capacityM3:segments[segments.length-1].endM3,stages,pumpTimeS:time};
}
export function pipePumpedAt(p:PipeTransport,timeS:number) {
  if(!Number.isFinite(timeS))throw new Error('Недопустимое время трубного переноса');
  const t=Math.max(0,timeS);let volume=0;
  for(const s of p.stages){if(t>=s.endS)volume=s.endM3;else if(t>=s.startS){volume=s.startM3+Math.min(s.volumeM3,(t-s.startS)*s.rateM3s);break;}else break;}
  return volume;
}
function amounts(p:PipeTransport,a:number,b:number) {
  const v=p.fluids.map(()=>0);v[0]=overlap(a,b,-p.capacityM3,0);
  for(const s of p.stages)if(s.volumeM3>0)v[s.fluid]+=overlap(a,b,s.startM3,s.endM3);
  return v;
}
export function pipeDepthComposition(p:PipeTransport,md:number,timeS:number) {
  if(!Number.isFinite(md)||!Number.isFinite(timeS)||timeS<0)return null;
  const cell=p.segments.findIndex((s,i)=>md>=s.topMD&&(md<s.bottomMD||i===p.segments.length-1&&md===s.bottomMD));if(cell<0)return null;
  const s=p.segments[cell],P=pipePumpedAt(p,timeS),volume=s.endM3-s.startM3;
  return {cell,topMD:s.topMD,bottomMD:s.bottomMD,md:(s.topMD+s.bottomMD)/2,fractions:amounts(p,P-s.endM3,P-s.startM3).map(v=>v/volume)};
}
/** Independent integral control-volume ledger, not a sum of sampled depth cells. */
export function pipeBalance(p:PipeTransport,timeS:number) {
  const P=pipePumpedAt(p,timeS),initial=p.fluids.map((_,i)=>i===0?p.capacityM3:0),injected=amounts(p,0,P),inside=amounts(p,P-p.capacityM3,P),outlet=amounts(p,-p.capacityM3,P-p.capacityM3);
  return p.fluids.map((f,i)=>({fluid:i,name:f.name,initialM3:initial[i],injectedM3:injected[i],insideM3:inside[i],outletM3:outlet[i],residualM3:initial[i]+injected[i]-inside[i]-outlet[i]}));
}
/** Shoe boundary from the same volume-coordinate transport, split at both supply changes and slug fronts. */
export function pipeShoeStages(p:PipeTransport) {
  const stages:D2Stage[]=[],bounds=p.stages.filter(s=>s.volumeM3>0).map(s=>p.capacityM3+s.endM3);
  let startS:number|null=null;
  for(const s of p.stages){
    if(s.volumeM3===0){if(startS!==null&&s.endS>s.startS)stages.push({fluid:stages[stages.length-1]?.fluid??0,volumeM3:0,rateM3s:0,holdS:s.endS-s.startS,drivingStageId:s.drivingStageId});continue;}
    let a=Math.max(s.startM3,p.capacityM3);if(a>=s.endM3-1e-10)continue;
    if(startS===null)startS=s.startS+(a-s.startM3)/s.rateM3s;
    for(const b of [...bounds.filter(b=>b>a+1e-10&&b<s.endM3-1e-10),s.endM3]){
      const u=(a+b)/2-p.capacityM3,source=p.stages.find(x=>x.volumeM3>0&&u>=x.startM3-1e-10&&u<x.endM3);
      if(!source)throw new Error('Не определена жидкость у башмака');
      stages.push({fluid:source.fluid,volumeM3:b-a,rateM3s:s.rateM3s,drivingStageId:s.drivingStageId});a=b;
    }
  }
  return {stages,annulusStartS:startS??p.pumpTimeS};
}
export function displacementTimeline(pipe:PipeTransport|null|undefined,result:D2Result|null|undefined,annulusStartS:number,settleMin:number):DisplacementFrame[] {
  if(result?.snapshots.length){
    const before=pipe?Array.from({length:30},(_,i)=>annulusStartS*i/30).filter(t=>t<annulusStartS):[];
    return [...before.map(timeS=>({timeS,annulusFrame:0})),...result.snapshots.map((s,i)=>({timeS:s.t+annulusStartS,annulusFrame:i}))];
  }
  if(!pipe)return [];
  const end=pipe.pumpTimeS+Math.max(0,settleMin)*60;
  const times=[0,pipe.pumpTimeS,end,...pipe.stages.flatMap(s=>[s.startS,s.endS]),...Array.from({length:140},(_,i)=>end*i/139)];
  return [...new Set(times)].sort((a,b)=>a-b).map(timeS=>({timeS,annulusFrame:0}));
}
export function pipeHistory(p:PipeTransport,md:number,frames:DisplacementFrame[]){return frames.map((frame,i)=>({frame:i,timeS:frame.timeS,...pipeDepthComposition(p,md,frame.timeS)}));}
export function pipeHistoryPlots(p:PipeTransport,colors:string[],md:number,frames:DisplacementFrame[]){
  if(!pipeDepthComposition(p,md,0))return [];
  const rows=pipeHistory(p,md,frames),plots=[];
  for(let start=0;start<p.fluids.length;start+=5){const plot=reportSeriesPlot('Доли жидкостей в трубе: MD '+md.toFixed(1)+' м, жидкости '+(start+1)+'-'+Math.min(start+5,p.fluids.length),'pipeHistory',rows.map(x=>x.timeS/60),'Время от начала закачки, мин','Объёмная доля, %',p.fluids.slice(start,start+5).map((f,i)=>({name:(start+i+1)+'. '+f.name,color:colors[start+i]??'#64748b',values:rows.map(r=>r.fractions?.[start+i]===undefined?null:r.fractions[start+i]*100)})),{plotId:'pipe-history-'+start,note:PIPE_NOTE});plots.push({...plot,sourceKey:JSON.stringify([md,rows,p.fluids.map(f=>f.name),colors,start])});}
  return plots;
}
