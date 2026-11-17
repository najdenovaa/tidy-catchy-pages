import {rheologyReportFluids,type RheologyReportInput} from './rheology-fluids';
import {rheologyChartData} from './rheology-data';
import {RPM_TO_SHEAR} from './cement-rheology';
import {buildProcessContract} from './cementing-process';
import {normalizeCementingSnapshot} from './cementing-normalizers';
import {reportSeriesPlot,hasPlotNumbers} from './report-series-plot';
export const HIERARCHY_NOTE='Сравнение выбранных моделей, не проверка совместимости смесей или эффективности вытеснения. Возрастание реологии не является универсальным требованием для всех пар, особенно промывок и продавки. Знак Δτ проверен на общей сетке; температурный пересчёт не выполняется.';
const colors=['#2563eb','#dc2626','#059669','#7c3aed','#d97706','#0e7490','#be185d','#475569'];
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
export function rheologyHierarchy(input:RheologyReportInput){
 const all=rheologyReportFluids(input).filter(f=>f.id!=='mud-bottomhole');
 let sequence=all,sequenceSource='Порядок введённых жидкостей; без данных скважины объёмы не проверены.';const issues:string[]=[];
 if(input.wellData){
  const c=buildProcessContract(normalizeCementingSnapshot(input));
  const ids=['mud',...c.stages.filter(s=>s.destination==='well'&&s.volumeM3>0).map(s=>{const f=c.fluids.find(f=>f.id===s.fluidId)!;return (f.kind==='cement'?'slurry':f.kind)+'-'+(f.index+1);})].filter((v,i,a)=>i===0||v!==a[i-1]);
  sequence=ids.map(id=>all.find(f=>f.id===id)).filter((f):f is typeof all[number]=>!!f);
  sequenceSource='Действующее расписание: только положительные объёмы в скважину. Промывка ЛВД на поверхность исключена.';issues.push(...c.issues.map(i=>i.message));
 }
 const fluids=sequence.map((f,i)=>{
  const data=rheologyChartData(f.r,f.appliedR),fit=data.applied.params?data.applied.fit:null;
  const valid=data.applied.valid&&(data.applied.params?true:finite(f.appliedR.pv)&&f.appliedR.pv>=0&&finite(f.appliedR.yp)&&f.appliedR.yp>=0);
  const t=f.r.testTemperatureC,p=f.r.testPressureMPaAbs,conditionsKnown=finite(t)&&t>=-273.15&&t<=500&&finite(p)&&p>=0&&p<=300;
  return {...f,data,order:i+1,label:`${i+1}. ${f.name||'Без названия'} [${f.id}]`,color:colors[i%colors.length],valid,defaults:f.appliedSource.includes('Модельные PV/YP'),conditionsKnown,temperatureC:t??null,pressureMPaAbs:p??null,source:f.r.testSource?.trim()||'Источник не указан',min:fit?Math.min(...fit.points.map(p=>p.gamma)):null,max:fit?Math.max(...fit.points.map(p=>p.gamma)):null};
 });
 const ranges=fluids.filter(f=>f.valid&&f.min!==null),min=ranges.length?Math.max(...ranges.map(f=>f.min!)):3*RPM_TO_SHEAR,max=ranges.length?Math.min(...ranges.map(f=>f.max!)):600*RPM_TO_SHEAR;
 if(fluids.some(f=>!f.valid))issues.push('Есть недопустимая модель: её кривая и соответствующие сравнения недоступны.');
 if(min>=max)issues.push('Нет общего диапазона измеренных скоростей сдвига. Экстраполяция автоматически не выполняется.');
 if(fluids.length<2)issues.push('Для иерархии нужны минимум две жидкости в последовательности.');
 const x=min<max?[...new Set([...Array.from({length:121},(_,i)=>min*(max/min)**(i/120)),...ranges.flatMap(f=>f.data.applied.fit!.points.map(p=>p.gamma)).filter(g=>g>=min&&g<=max),min,max])].sort((a,b)=>a-b):[];
 const rows=fluids.map(f=>({...f,tau:x.map(g=>f.valid?f.data.predictApplied(g):null)}));
 const pairs=rows.slice(1).map((after,i)=>{
  const before=rows[i],delta=x.map((_,j)=>before.tau[j]===null||after.tau[j]===null?null:after.tau[j]!-before.tau[j]!);
  const values=delta.filter(finite),tol=1e-9*Math.max(1,...before.tau.filter(finite).map(Math.abs),...after.tau.filter(finite).map(Math.abs));
  const positive=values.some(v=>v>tol),negative=values.some(v=>v< -tol);
  const ordering=!values.length?'Нет сравнения':positive&&negative?'Меняется знак Δτ':positive?'Следующая выше на сетке':negative?'Следующая ниже на сетке':'Совпадают в точности расчёта';
  const conditions=!before.conditionsKnown||!after.conditionsKnown?'Условия T/P не подтверждены':Math.abs(before.temperatureC!-after.temperatureC!)>1e-6||Math.abs(before.pressureMPaAbs!-after.pressureMPaAbs!)>1e-6?'Условия T/P различаются':before.defaults||after.defaults?'Модельные значения по типу жидкости':'Заданные условия T/P совпадают';
  const signChanges:number[][]=[];let previous:number|undefined;
  for(let j=0;j<delta.length;j++){const v=delta[j];if(v===null||Math.abs(v)<=tol)continue;if(previous!==undefined&&Math.sign(delta[previous]!)!==Math.sign(v))signChanges.push([x[previous],x[j]]);previous=j;}
  return {before:before.id,after:after.id,label:`${before.order} - ${after.order}`,beforeName:before.label,afterName:after.label,delta,ordering,conditions,comparable:before.valid&&after.valid&&conditions==='Заданные условия T/P совпадают'&&values.length>0,minDelta:values.length?Math.min(...values):null,maxDelta:values.length?Math.max(...values):null,signChanges};
 });
 return {fluids:rows,pairs,x,min,max,issues,sequenceSource,note:HIERARCHY_NOTE,rangeSource:ranges.length?'Пересечение диапазонов замеров применяемых моделей. Заданные PV/YP сравниваются на той же сетке.':'Замеров применяемых моделей нет: расчётная сетка 3-600 об/мин Fann; это не диапазон лабораторного подтверждения.'};
}
export function rheologyHierarchyFigures(input:RheologyReportInput){
 const h=rheologyHierarchy(input);if(h.fluids.length<2||!h.x.length||!h.fluids.some(f=>f.valid))return [];
 const note=`${h.rangeSource} ${h.sequenceSource} Условия см. в таблице: совпадение T/P не подразумевается.`;
 const plot=(title:string,id:string,unit:string,series:Parameters<typeof reportSeriesPlot>[5],extra='')=>reportSeriesPlot(title,'rheology',h.x,'Скорость сдвига, с⁻¹',unit,series,{plotId:id,note:extra+note});
 return [plot('Реологическая иерархия: выбранные модели','rheologyHierarchyStress','Напряжение сдвига, Па',h.fluids.map(f=>({name:f.label+(f.defaults?' (модельные PV/YP)':''),color:f.color,values:f.tau}))),
 plot('Реологическая иерархия: кажущаяся вязкость','rheologyHierarchyViscosity','Кажущаяся вязкость, мПа·с',h.fluids.map(f=>({name:f.label,color:f.color,values:f.tau.map((v,i)=>v===null?null:1000*v/h.x[i])})),'μкаж = 1000τ/γ, мПа·с; γ > 0. '),
 plot('Реологическая иерархия: соседние жидкости','rheologyHierarchyDelta','Δτ следующая минус предыдущая, Па',[...h.pairs.map((p,i)=>({name:p.label+'; '+p.conditions,color:colors[i%colors.length],values:p.delta})),{name:'Равные напряжения',color:'#94a3b8',reference:true,dash:'4 4',values:h.x.map(()=>0)}],'Пары в порядке закачки; знак на сетке не означает пригодность или несовместимость. ')]
 .filter(hasPlotNumbers).map(p=>({...p,sourceKey:JSON.stringify(['hierarchy-v1',p.plotId,p.data,h.fluids.map(f=>[f.id,f.data.applied.label,f.appliedSource,f.temperatureC,f.pressureMPaAbs,f.source])])}));
}
