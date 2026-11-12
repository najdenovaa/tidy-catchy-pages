import {transportMesh} from './transport-mesh';
import {normalizeCementingSnapshot,type CementingSnapshot} from './cementing-normalizers';
import {transportInputKey,type TransportResult,type TransportStudy} from './compressible-transport';

/** Separate spatial and temporal refinements; never change both axes in one comparison. */
export function transportRefinementInputs(input:CementingSnapshot){
 const p=normalizeCementingSnapshot(input),s=p.wellData.stopStorage;
 if(!s?.flowEnabled)throw new Error('Включите исследовательский перенос.');
 const depth=p.wellData.casingDepthMD,h=s.flowCellLengthM??250,dt=s.flowStepSeconds??30;
 if(!(depth>0&&h>=10&&h<=1000&&dt>=.1&&dt<=60))throw new Error('Недопустимая сетка или шаг времени.');
 const n=Math.max(2,Math.ceil(depth/h)),refinement=s.flowMeshRefinement??1;
 transportMesh(depth,h,s.flowCheckValve||s.flowClosureEnabled?p.wellData.ckodDepth:undefined,refinement*4);
 if(depth/(n*refinement*4)<10||dt/4<.1)throw new Error('Для пяти прогонов нужны: не более 120 ячеек на мелкой сетке, длина ячейки не менее 10 м и шаг не менее 0,1 с. Увеличьте исходную ячейку/шаг; короткий контур может не поддерживать это сравнение.');
 return [{label:'Исходный',input:p},...([2,4] as const).map(k=>({label:'Сетка / '+k,input:{...p,wellData:{...p.wellData,stopStorage:{...s,flowMeshRefinement:refinement*k}}}})),...([2,4] as const).map(k=>({label:'Шаг / '+k,input:{...p,wellData:{...p.wellData,stopStorage:{...s,flowStepSeconds:dt/k}}}}))];
}

/** Integral of |xA-xB| over the same physical-volume coordinate, divided by total volume. */
export function compositionDistance(a:TransportResult,b:TransportResult){
 let error=0,total=0;
 const ids=new Set([...a.components,...b.components].map(f=>f.id));
 for(const leg of ['pipe','annulus']){
  const aa=a.profile.filter(c=>c.leg===leg),bb=b.profile.filter(c=>c.leg===leg);
  const va=aa.reduce((n,c)=>n+c.volumeM3,0),vb=bb.reduce((n,c)=>n+c.volumeM3,0);
  if(!(va>0&&vb>0)||Math.abs(va-vb)>1e-8*Math.max(1,va,vb))throw new Error('Профили имеют разные вместимости.');
  let i=0,j=0,ar=aa[0].volumeM3,br=bb[0].volumeM3;
  while(i<aa.length&&j<bb.length){
   const overlap=Math.min(ar,br);total+=overlap;
   for(const id of ids){const x=aa[i].fractions.find(f=>f.id===id)?.massFraction??0,y=bb[j].fractions.find(f=>f.id===id)?.massFraction??0;error+=overlap*Math.abs(x-y);}
   ar-=overlap;br-=overlap;
   if(ar<1e-12){i++;ar=aa[i]?.volumeM3??0;}if(br<1e-12){j++;br=bb[j]?.volumeM3??0;}
  }
 }
 return error/total;
}
function at(frames:TransportResult['frames'],time:number){
 if(!frames.length||time<frames[0].timeMin-1e-10||time>frames.at(-1)!.timeMin+1e-10)return undefined;
 const i=frames.findIndex(f=>f.timeMin>=time-1e-10);if(i<=0)return frames[0].inletMPa;
 const a=frames[i-1],b=frames[i],f=(time-a.timeMin)/(b.timeMin-a.timeMin);return a.inletMPa+(b.inletMPa-a.inletMPa)*f;
}
/** Never interpolate across the prescribed closure. Compare only shared phase coverage. */
export function compareTransportPressure(a:TransportResult,b:TransportResult,closure?:number){
 const diff=(aa:TransportResult['frames'],bb:TransportResult['frames'])=>{
  const samples=[...aa,...bb].map(f=>{const x=at(aa,f.timeMin),y=at(bb,f.timeMin);return x===undefined||y===undefined?undefined:Math.abs(x-y);}).filter((v):v is number=>v!==undefined);
  return samples.length?Math.max(...samples):undefined;
 };
 if(closure===undefined)return {maxInletDifferenceMPa:diff(a.frames,b.frames)??0};
 const pre=(r:TransportResult)=>r.frames.filter(f=>!f.sealClosed&&f.timeMin<=closure+1e-10),post=(r:TransportResult)=>r.frames.filter(f=>f.sealClosed&&f.timeMin>=closure-1e-10);
 const aa=post(a),bb=post(b),beforeClosureMPa=diff(pre(a),pre(b)),afterClosureMPa=diff(aa,bb);
 return {maxInletDifferenceMPa:Math.max(beforeClosureMPa??0,afterClosureMPa??0),beforeClosureMPa,afterClosureMPa,afterComparisonStartMin:afterClosureMPa===undefined?undefined:Math.max(aa[0].timeMin,bb[0].timeMin)};
}
function barrierMass(r:TransportResult){return r.frames.slice(1).reduce((n,f,i)=>n+(f.barrierFlowKgS??0)*(f.timeMin-r.frames[i].timeMin)*60,0);}
export function summarizeTransportRefinement(input:CementingSnapshot,runs:TransportResult[]):TransportStudy{
 const plan=transportRefinementInputs(input);
 if(runs.length!==plan.length||runs.some((r,i)=>r.inputKey!==transportInputKey(plan[i].input)))throw new Error('Прогоны не соответствуют плану уточнения.');
 const study:TransportStudy={inputKey:transportInputKey(input),rows:runs.map((r,i)=>({label:plan[i].label,cellCount:r.cellCount,actualCellLengthM:r.mesh?.meanLengthM??(r.cellCount?input.wellData.casingDepthMD/(r.cellCount/2):0),minCellLengthM:r.mesh?.minLengthM??0,maxCellLengthM:r.mesh?.maxLengthM??0,stepSeconds:r.stepSeconds,acceptedSteps:r.acceptedSteps,status:r.status,reason:r.reason,maxMassResidualKg:Math.max(0,...r.components.map(c=>Math.abs(c.residualKg)))})),comparisons:[],note:'Каждый исходный интервал, в том числе короткий у ЦКОД, делится на 2 и 4; глубина границы сохраняется точно. Давления до и после заданного перекрытия сравниваются раздельно только на общей временной выборке; начальный интервал после события может отсутствовать в сравнении. Поток границы интегрируется по принятым интервалам, показана разность перенесённых масс. Пять прогонов: сетка и максимальный шаг уточняются раздельно. Разности показывают численную чувствительность, не погрешность относительно истины и не промысловую валидацию. L1 состава - интеграл суммы модулей разностей массовых долей по физическому объёму, делённый на вместимость (0-2). Давление подачи сравнивается на объединении времён с линейной интерполяцией; неразрешённые пики могут быть пропущены. Фактические шаги могут уменьшаться адаптивно.'};
 for(const [i,j,label] of [[0,1,'Сетка: исходная / 2'],[1,2,'Сетка: /2 / /4'],[0,3,'Шаг: исходный / 2'],[3,4,'Шаг: /2 / /4']] as const){
  const a=runs[i],b=runs[j],ta=a.frames.at(-1)?.timeMin,tb=b.frames.at(-1)?.timeMin;
  if(a.status!=='complete'||b.status!=='complete'||ta===undefined||tb===undefined||Math.abs(ta-tb)>1e-6)continue;
  const events=(r:TransportResult)=>(r.boundaryEvents??[]).map(e=>[e.kind,e.depthMD,Math.round(e.timeMin*1e8)]);
  if(JSON.stringify(events(a))!==JSON.stringify(events(b)))throw new Error('События границ в сравниваемых прогонах не совпадают.');
  const closure=a.boundaryEvents?.find(e=>e.kind==='prescribedSeal')?.timeMin;
  study.comparisons.push({label,...compareTransportPressure(a,b,closure),returnDifferenceM3:Math.abs(a.frames.at(-1)!.returnedReferenceM3-b.frames.at(-1)!.returnedReferenceM3),compositionL1:compositionDistance(a,b),barrierTransferredDifferenceKg:a.boundaryEvents?.length?Math.abs(barrierMass(a)-barrierMass(b)):undefined});
 }
 if(study.comparisons.length!==4)study.note='Есть незавершённые прогоны: сравниваются только полные пары с одинаковым конечным временем. '+study.note;
 return study;
}
export function transportStudyCsv(study:TransportStudy){return 'comparison;max_inlet_difference_mpa;return_difference_m3;composition_l1;before_closure_mpa;after_closure_mpa;after_comparison_start_min;barrier_transferred_difference_kg\n'+study.comparisons.map(r=>[r.label,r.maxInletDifferenceMPa,r.returnDifferenceM3,r.compositionL1,r.beforeClosureMPa??'',r.afterClosureMPa??'',r.afterComparisonStartMin??'',r.barrierTransferredDifferenceKg??''].join(';')).join('\n');}
