import {normalizeCementingSnapshot,type CementingSnapshot} from './cementing-normalizers';
import {transportInputKey,type TransportResult,type TransportStudy} from './compressible-transport';

/** Separate spatial and temporal refinements; never change both axes in one comparison. */
export function transportRefinementInputs(input:CementingSnapshot){
 const p=normalizeCementingSnapshot(input),s=p.wellData.stopStorage;
 if(!s?.flowEnabled)throw new Error('Включите исследовательский перенос.');
 const depth=p.wellData.casingDepthMD,h=s.flowCellLengthM??250,dt=s.flowStepSeconds??30;
 if(!(depth>0&&h>=10&&h<=1000&&dt>=.1&&dt<=60))throw new Error('Недопустимая сетка или шаг времени.');
 const n=Math.max(2,Math.ceil(depth/h));
 if(n*8>120||depth/(n*4)<10||dt/4<.1)throw new Error('Для пяти прогонов нужны: не более 120 ячеек на мелкой сетке, длина ячейки не менее 10 м и шаг не менее 0,1 с. Увеличьте исходную ячейку/шаг; короткий контур может не поддерживать это сравнение.');
 return [{label:'Исходный',input:p},...([2,4] as const).map(k=>({label:'Сетка / '+k,input:{...p,wellData:{...p.wellData,stopStorage:{...s,flowCellLengthM:depth/(n*k)}}}})),...([2,4] as const).map(k=>({label:'Шаг / '+k,input:{...p,wellData:{...p.wellData,stopStorage:{...s,flowStepSeconds:dt/k}}}}))];
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
function inletAt(r:TransportResult,time:number){
 const i=r.frames.findIndex(f=>f.timeMin>=time);if(i===0)return r.frames[0].inletMPa;if(i<0)return r.frames.at(-1)!.inletMPa;
 const a=r.frames[i-1],b=r.frames[i],f=(time-a.timeMin)/(b.timeMin-a.timeMin);return a.inletMPa+(b.inletMPa-a.inletMPa)*f;
}
export function summarizeTransportRefinement(input:CementingSnapshot,runs:TransportResult[]):TransportStudy{
 const plan=transportRefinementInputs(input);
 if(runs.length!==plan.length||runs.some((r,i)=>r.inputKey!==transportInputKey(plan[i].input)))throw new Error('Прогоны не соответствуют плану уточнения.');
 const study:TransportStudy={inputKey:transportInputKey(input),rows:runs.map((r,i)=>({label:plan[i].label,cellCount:r.cellCount,actualCellLengthM:r.cellCount?input.wellData.casingDepthMD/(r.cellCount/2):0,stepSeconds:r.stepSeconds,acceptedSteps:r.acceptedSteps,status:r.status,reason:r.reason,maxMassResidualKg:Math.max(0,...r.components.map(c=>Math.abs(c.residualKg)))})),comparisons:[],note:'Пять прогонов: сетка и максимальный шаг уточняются раздельно. Разности показывают численную чувствительность, не погрешность относительно истины и не промысловую валидацию. L1 состава - интеграл суммы модулей разностей массовых долей по физическому объёму, делённый на вместимость (0-2). Давление подачи сравнивается на объединении времён с линейной интерполяцией; неразрешённые пики могут быть пропущены. Фактические шаги могут уменьшаться адаптивно.'};
 for(const [i,j,label] of [[0,1,'Сетка: исходная / 2'],[1,2,'Сетка: /2 / /4'],[0,3,'Шаг: исходный / 2'],[3,4,'Шаг: /2 / /4']] as const){
  const a=runs[i],b=runs[j],ta=a.frames.at(-1)?.timeMin,tb=b.frames.at(-1)?.timeMin;
  if(a.status!=='complete'||b.status!=='complete'||ta===undefined||tb===undefined||Math.abs(ta-tb)>1e-6)continue;
  study.comparisons.push({label,maxInletDifferenceMPa:Math.max(...[...a.frames,...b.frames].map(f=>Math.abs(inletAt(a,f.timeMin)-inletAt(b,f.timeMin)))),returnDifferenceM3:Math.abs(a.frames.at(-1)!.returnedReferenceM3-b.frames.at(-1)!.returnedReferenceM3),compositionL1:compositionDistance(a,b)});
 }
 if(study.comparisons.length!==4)study.note='Есть незавершённые прогоны: сравниваются только полные пары с одинаковым конечным временем. '+study.note;
 return study;
}
export function transportStudyCsv(study:TransportStudy){return 'comparison;max_inlet_difference_mpa;return_difference_m3;composition_l1\n'+study.comparisons.map(r=>[r.label,r.maxInletDifferenceMPa,r.returnDifferenceM3,r.compositionL1].join(';')).join('\n');}
