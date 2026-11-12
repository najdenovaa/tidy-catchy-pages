import {resolveBenchLaws,type BenchRheologyPair} from './bench-rheology';
import {coupledCaseKey,simulateCoupledPlug,type CoupledPlugResult,type CoupledFrame,type CoupledTracePoint} from './coupled-plug';
import {initializePlug,normalizeMovingPlugCase,type MovingPlugCase} from './moving-plug';

export interface CoupledStudyRow {
  label:string; cellsPerChamber:number; stepSec:number; acceptedSteps:number; rejectedSteps:number;
  status:'complete'|'stopped'; reason:string; endTimeSec?:number; landingTimeSec:number|null;
  minStepSec?:number; maxStepSec?:number; minCellM?:number; maxCellM?:number;
  endXM?:number; maxInletMPa?:number; maxMassResidualKg:number; maxComponentResidualKg:number; maxForceResidualMPa:number;
}
export interface CoupledPhaseDifference {
  startSec:number; endSec:number; samples:number; maxInletMPa:number;
  maxBackWallMPa:number; maxAheadWallMPa:number; maxPositionM:number;
}
export interface CoupledComparison {
  label:string; comparable:boolean; reason:string; landing:'both'|'neither'|'different'|'unavailable';
  landingDifferenceSec?:number; finalPositionDifferenceM?:number; returnedDifferenceKg?:number;
  compositionL1?:number; approach?:CoupledPhaseDifference; seated?:CoupledPhaseDifference;
}
export interface CoupledStudy {
  model:'coupled-refinement-v1'; inputKey:string; status:'complete'|'partial'|'unavailable'; reason:string;
  rows:CoupledStudyRow[]; comparisons:CoupledComparison[]; note:string;
}
export const coupledStudyNote='Различия приведены по модулю; для временных профилей показан максимум на общей выборке. Пять прогонов: N, 2N, 4N при одном максимальном шаге; затем dt/2 и dt/4 при исходной сетке. Фактические шаги могут уменьшаться. Сравниваются все принятые временные точки с линейной интерполяцией только внутри одной фазы. Подход к упору и состояние после посадки разделены: кадр посадки относится к подходу, после посадки сравнение начинается с общей области покрытия следующих шагов. Неразрешённые пики могут быть пропущены. L1 состава (0-2) - интеграл суммы модулей разностей массовых долей по одной физической координате, делённый на длину; включает разность положения поршня. Незавершённые пары не сравниваются. Разности показывают численную чувствительность, не физическую погрешность или промысловую валидацию. Нулевое расхождение само по себе не доказывает точность.';
export function coupledRefinementPlan(input:MovingPlugCase,n:number,mu:number,switchSec:number,rheology?:BenchRheologyPair){
  resolveBenchLaws(rheology,mu);
  const p=normalizeMovingPlugCase(input);if(!p)throw new Error('Не задан сценарий связанного стенда.');
  if(!Number.isInteger(n)||n<1||n*4>60||!Number.isFinite(mu)||!rheology&&mu<=0||!Number.isFinite(switchSec)||switchSec<0||switchSec>p.durationSec)throw new Error('Для пяти прогонов нужны 1-15 исходных ячеек в каждой камере, положительная вязкость и корректный момент метки.');
  const plan=[{label:'Исходный',input:p,n},...[2,4].map(k=>({label:'Сетка ×'+k,input:{...p},n:n*k})),...[2,4].map(k=>({label:'Шаг /'+k,input:{...p,stepSec:p.stepSec/k},n}))];
  for(const c of plan){try{initializePlug(c.input);}catch(e){throw new Error(c.label+': '+(e instanceof Error?e.message:String(e))+' Для dt/4 допускается не более 1000 назначенных шагов.');}}
  return plan;
}
/** Piecewise constant mass fractions on a common physical coordinate, without stretching either piston. */
export function coupledCompositionL1(a:CoupledFrame,b:CoupledFrame){
  for(const f of [a,b])if(f.facesM.length!==f.fractions.length+1||!f.fractions.length||f.facesM.some((x,i)=>!Number.isFinite(x)||i>0&&x<=f.facesM[i-1])||f.fractions.some(q=>q.length!==3||q.some(x=>!Number.isFinite(x)||x<0)||Math.abs(q.reduce((s,x)=>s+x,0)-1)>1e-8))throw new Error('Недопустимый профиль для сравнения состава.');
  const length=a.facesM.at(-1)!-a.facesM[0];if(Math.abs(a.facesM[0]-b.facesM[0])>1e-9||Math.abs(a.facesM.at(-1)!-b.facesM.at(-1)!)>1e-9*Math.max(1,length))throw new Error('Профили состава имеют разные физические границы.');
  let i=0,j=0,error=0;
  while(i<a.fractions.length&&j<b.fractions.length){const left=Math.max(a.facesM[i],b.facesM[j]),right=Math.min(a.facesM[i+1],b.facesM[j+1]);if(right>left)error+=(right-left)*a.fractions[i].reduce((s,x,k)=>s+Math.abs(x-b.fractions[j][k]),0);const ar=a.facesM[i+1],br=b.facesM[j+1];if(ar<=br)i++;if(br<=ar)j++;}
  return error/length;
}
const fields=['inletMPa','backWallMPa','aheadWallMPa','xM'] as const;
function validateTrace(trace:CoupledTracePoint[]){let seated=false;for(let i=0;i<trace.length;i++){const f=trace[i];if(!Number.isFinite(f.timeSec)||fields.some(k=>!Number.isFinite(f[k]))||i>0&&f.timeSec<=trace[i-1].timeSec||!['approach','seated'].includes(f.phase)||seated&&f.phase==='approach')throw new Error('Некорректная история принятых шагов или фаз.');if(f.phase==='seated')seated=true;}}
function interpolate(points:CoupledTracePoint[],time:number){
  if(!points.length||time<points[0].timeSec||time>points.at(-1)!.timeSec)return undefined;
  let lo=0,hi=points.length-1;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(points[mid].timeSec<time)lo=mid+1;else hi=mid;}
  if(points[lo].timeSec===time||lo===0)return fields.map(k=>points[lo][k]);
  const a=points[lo-1],b=points[lo],ratio=(time-a.timeSec)/(b.timeSec-a.timeSec);return fields.map(k=>a[k]+ratio*(b[k]-a[k]));
}
/** No interpolation across contact: landing frame is approach, first post-step starts the seated coverage. */
export function compareCoupledPhase(a:CoupledTracePoint[],b:CoupledTracePoint[],phase:CoupledTracePoint['phase']):CoupledPhaseDifference|undefined{
  validateTrace(a);validateTrace(b);
  const aa=a.filter(f=>f.phase===phase),bb=b.filter(f=>f.phase===phase);if(!aa.length||!bb.length)return undefined;
  const startSec=Math.max(aa[0].timeSec,bb[0].timeSec),endSec=Math.min(aa.at(-1)!.timeSec,bb.at(-1)!.timeSec);if(startSec>endSec)return undefined;
  const times=[...new Set([startSec,endSec,...aa.map(f=>f.timeSec),...bb.map(f=>f.timeSec)].filter(t=>t>=startSec&&t<=endSec))].sort((x,y)=>x-y),maxima=[0,0,0,0];
  for(const time of times){const x=interpolate(aa,time),y=interpolate(bb,time);if(!x||!y)throw new Error('Нет общей временной выборки фазы.');fields.forEach((_,i)=>{maxima[i]=Math.max(maxima[i],Math.abs(x[i]-y[i]));});}
  return {startSec,endSec,samples:times.length,maxInletMPa:maxima[0],maxBackWallMPa:maxima[1],maxAheadWallMPa:maxima[2],maxPositionM:maxima[3]};
}
export function summarizeCoupledRefinement(input:MovingPlugCase,n:number,mu:number,switchSec:number,runs:CoupledPlugResult[],rheology?:BenchRheologyPair):CoupledStudy{
  const plan=coupledRefinementPlan(input,n,mu,switchSec,rheology),key=coupledCaseKey(input,n,mu,switchSec,rheology);
  if(runs.length!==5||runs.some((r,i)=>r.inputKey!==coupledCaseKey(plan[i].input,plan[i].n,mu,switchSec,rheology)||r.cellsPerChamber!==plan[i].n||r.viscosityMpas!==mu||r.switchSec!==switchSec))throw new Error('Прогоны не соответствуют плану связанного уточнения.');
  for(const r of runs){validateTrace(r.trace);if(r.trace.length!==(r.frames.length?r.acceptedSteps+1:0)||r.trace.length&&r.trace[0].phase!=='approach'||r.trace.at(-1)?.timeSec!==r.frames.at(-1)?.timeSec)throw new Error('Неполная или некорректная история принятых шагов.');if(r.landingTimeSec!==null&&(!Number.isFinite(r.landingTimeSec)||!r.trace.some(f=>f.timeSec===r.landingTimeSec&&f.phase==='approach')))throw new Error('Нет принятого события посадки.');if(r.trace.some(f=>f.phase==='seated'&&(r.landingTimeSec===null||f.timeSec<=r.landingTimeSec)||f.phase==='approach'&&r.landingTimeSec!==null&&f.timeSec>r.landingTimeSec))throw new Error('История фаз не согласована с посадкой.');}
  const study:CoupledStudy={model:'coupled-refinement-v1',inputKey:key,status:'partial',reason:'',rows:runs.map((r,i)=>{
    const trace=r.trace,steps=trace.slice(1).map((f,j)=>f.timeSec-trace[j].timeSec),lengths=trace.flatMap(f=>[f.xM/plan[i].n,(plan[i].input.totalLengthM-f.xM)/plan[i].n]);
    return {label:plan[i].label,cellsPerChamber:plan[i].n,stepSec:plan[i].input.stepSec,acceptedSteps:r.acceptedSteps,rejectedSteps:r.rejectedSteps,status:r.status,reason:r.reason,endTimeSec:trace.at(-1)?.timeSec,landingTimeSec:r.landingTimeSec,minStepSec:steps.length?Math.min(...steps):undefined,maxStepSec:steps.length?Math.max(...steps):undefined,minCellM:lengths.length?Math.min(...lengths):undefined,maxCellM:lengths.length?Math.max(...lengths):undefined,endXM:trace.at(-1)?.xM,maxInletMPa:trace.length?Math.max(...trace.map(f=>f.inletMPa)):undefined,maxMassResidualKg:r.maxMassResidualKg,maxComponentResidualKg:r.maxComponentResidualKg,maxForceResidualMPa:r.maxForceResidualMPa};
  }),comparisons:[],note:coupledStudyNote};
  for(const [i,j,label] of [[0,1,'Сетка: N / 2N'],[1,2,'Сетка: 2N / 4N'],[0,3,'Время: dt / dt÷2'],[3,4,'Время: dt÷2 / dt÷4']] as const){
    const a=runs[i],b=runs[j],fa=a.frames.at(-1),fb=b.frames.at(-1),c:CoupledComparison={label,comparable:false,reason:'',landing:'unavailable'};
    if(a.status!=='complete'||b.status!=='complete'||!fa||!fb||Math.abs(fa.timeSec-fb.timeSec)>1e-6){c.reason='Нет двух полных прогонов с одинаковым конечным временем.';study.comparisons.push(c);continue;}
    c.comparable=true;c.landing=a.landingTimeSec===null&&b.landingTimeSec===null?'neither':a.landingTimeSec!==null&&b.landingTimeSec!==null?'both':'different';
    if(c.landing==='both')c.landingDifferenceSec=Math.abs(a.landingTimeSec!-b.landingTimeSec!);
    c.approach=compareCoupledPhase(a.trace,b.trace,'approach');c.seated=compareCoupledPhase(a.trace,b.trace,'seated');
    c.finalPositionDifferenceM=Math.abs(fa.xM-fb.xM);c.returnedDifferenceKg=Math.abs(a.returnedKg.reduce((s,x)=>s+x,0)-b.returnedKg.reduce((s,x)=>s+x,0));c.compositionL1=coupledCompositionL1(fa,fb);
    c.reason=c.landing==='different'?'Посадка достигнута только в одном прогоне; разность времени не определена.':c.landing==='neither'?'Оба прогона не достигли упора; разность времени посадки не определена.':'Оба прогона достигли упора.';
    if(!c.seated)c.reason+=' Общего покрытия после посадки нет.';study.comparisons.push(c);
  }
  study.status=study.rows.every(r=>r.status==='complete')&&study.comparisons.every(c=>c.comparable)?'complete':'partial';study.reason=study.status==='complete'?'Пять прогонов рассчитаны; показаны численные различия.':'Есть незавершённые прогоны или несопоставимые пары; отсутствующие различия не заменены нулями.';return study;
}
export function evaluateCoupledRefinement(input:MovingPlugCase,n:number,mu:number,switchSec:number,baseline?:CoupledPlugResult,rheology?:BenchRheologyPair):CoupledStudy{
  try{const plan=coupledRefinementPlan(input,n,mu,switchSec,rheology),runs=plan.map((c,i)=>i===0&&baseline?.inputKey===coupledCaseKey(c.input,c.n,mu,switchSec,rheology)?baseline:simulateCoupledPlug(c.input,c.n,mu,switchSec,rheology));return summarizeCoupledRefinement(input,n,mu,switchSec,runs,rheology);}
  catch(e){return {model:'coupled-refinement-v1',inputKey:coupledCaseKey(input,n,mu,switchSec,rheology),status:'unavailable',reason:e instanceof Error?e.message:String(e),rows:[],comparisons:[],note:coupledStudyNote};}
}
function csvCell(v:unknown){return v===undefined||v===null?'':typeof v==='string'?'"'+v.replace(/"/g,'""')+'"':String(v);}
export function coupledStudyRunsCsv(s:CoupledStudy){return ['study_status;run;cells_per_chamber;nominal_step_s;accepted_steps;rejected_attempts;run_status;last_time_s;landing_time_s;actual_min_step_s;actual_max_step_s;min_cell_m;max_cell_m;max_inlet_mpa;mass_residual_kg;component_residual_kg;force_residual_mpa;reason',...s.rows.map(r=>[s.status,r.label,r.cellsPerChamber,r.stepSec,r.acceptedSteps,r.rejectedSteps,r.status,r.endTimeSec,r.landingTimeSec,r.minStepSec,r.maxStepSec,r.minCellM,r.maxCellM,r.maxInletMPa,r.maxMassResidualKg,r.maxComponentResidualKg,r.maxForceResidualMPa,r.reason].map(csvCell).join(';'))].join('\n');}
export function coupledStudyComparisonsCsv(s:CoupledStudy){return ['study_status;comparison;comparable;landing;landing_difference_s;final_position_difference_m;return_difference_kg;composition_l1;approach_start_s;approach_end_s;approach_samples;approach_inlet_difference_mpa;approach_back_difference_mpa;approach_ahead_difference_mpa;approach_position_difference_m;seated_start_s;seated_end_s;seated_samples;seated_inlet_difference_mpa;seated_back_difference_mpa;seated_ahead_difference_mpa;seated_position_difference_m;reason',...s.comparisons.map(c=>[s.status,c.label,c.comparable,c.landing,c.landingDifferenceSec,c.finalPositionDifferenceM,c.returnedDifferenceKg,c.compositionL1,...[c.approach,c.seated].flatMap(p=>[p?.startSec,p?.endSec,p?.samples,p?.maxInletMPa,p?.maxBackWallMPa,p?.maxAheadWallMPa,p?.maxPositionM]),c.reason].map(csvCell).join(';'))].join('\n');}
