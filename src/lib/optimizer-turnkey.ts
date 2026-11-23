import {placeProgramTurbulators} from './optimizer-tool-layout';
import {centralizerSignature} from './equipment-library-reference';
import {buildCentralizerJointSchedule} from './centralizer-layout';
import {centralizerModelNotes} from './centralizer-response';
import type {ProgramInput,OptimizerSettings,OptimizerResult,VariantEval,ProgramVariant,CentralizerPlan} from './cement-optimizer';
import {compatibleHardware,type OptimizerHardwareCatalog,type CatalogTurbulator} from './optimizer-hardware';
import type {CleaningEvaluator,CleaningTarget} from './optimizer-cleaning';
import {cleaningTarget,cleaningDepths,cleaningFlow,cleaningInputKey,prepareCleaningProgram,remapCleaningLab} from './optimizer-cleaning';
import {buildProcessContract} from './cementing-process';
import {createAnnularGeometry} from './well-geometry';
import {totalPipeVolumeForRange,interpolateTVD,getEffectiveTrajectory,type FlowRateStep,type PressureProfileResult} from './cementing-calculations';
import {calculateCentralization,type TurbulatorPoint} from './centralization-calculations';
import {defaultTurbulatorDesign} from './turbulator-flow';
import {centralizerInventory} from './cementing-equipment';
import {centralizerMaterialGeometryKey} from './materials-equipment-inventory';
import type {OptimizerProgramRecord,BufferTransitRecord} from './optimizer-program-record';
export interface CompleteProgramPlan {sourceKey:string;program:ProgramInput;centralization:CentralizerPlan;evaluation:VariantEval;record:OptimizerProgramRecord}
export function projectCentralizerPlan(p:ProgramInput,catalog:OptimizerHardwareCatalog):CentralizerPlan|undefined{
 const intervals=p.wellData.centralizerDesign?.intervals??p.centralizerIntervals??[];
 const matches=(spec:typeof intervals[number]['spec'])=>catalog.centralizers.some(c=>(!spec.libraryReference||(c.identity.id===spec.libraryReference.entryId&&c.identity.revision===spec.libraryReference.revision))&&centralizerSignature(c.spec)===centralizerSignature(spec));
 if(!intervals.length||intervals.some(iv=>!matches(iv.spec)||(iv.pattern&&(!iv.specB||!matches(iv.specB)))))return;
 const profile=calculateCentralization(p.wellData,intervals,p.drillingFluid.density),toc=Math.min(...p.slurries.map(s=>s.topDepthMD)),inside=profile.filter(x=>x.md>=toc),points=buildCentralizerJointSchedule(p.wellData.casingDepthMD,intervals).flatMap(x=>x.placements);
 return {targetPct:null,label:'Заданная расстановка из справочника',intervals,profile,totalCount:points.length,countInCement:points.filter(x=>x.md>=toc).length,minStandoffPct:Math.min(...inside.map(x=>x.standoff)),avgStandoffPct:inside.reduce((n,x)=>n+x.standoff,0)/Math.max(1,inside.length)};
}
export function programTarget(p:ProgramInput):CleaningTarget{
 if(p.wellData.reservoirLayers?.length)return cleaningTarget(p.wellData);
 const w=p.wellData,top=Math.min(...p.slurries.map(s=>s.topDepthMD)),bottom=w.casingDepthMD,traj=getEffectiveTrajectory(w);
 if(!Number.isFinite(top)||top>=bottom)throw Error('Не задан положительный интервал цементирования.');
 return {topMD:top,bottomMD:bottom,topTVD:interpolateTVD(top,traj),bottomTVD:interpolateTVD(bottom,traj),volumeM3:createAnnularGeometry(w,bottom).volume(top,bottom),aboveActualM:0,layers:['Интервал цементирования (пласты не заданы)']};
}
/** Surface material and material crossing the target may differ. All switches use cumulative pumped volume. */
export function scheduleIntervalProgram(p:ProgramInput,t:CleaningTarget,qHeavy:number,qCement:number,qDisp:number,resize:boolean,contactMin:number,maxCementRateLps=Infinity):ProgramInput{
 const geometry=createAnnularGeometry(p.wellData,p.wellData.casingDepthMD),pipe=totalPipeVolumeForRange(0,p.wellData.casingDepthMD,p.wellData.casingOD,p.wellData.casingWall,p.wellData.casingSections);
 const buffers=p.buffers.map(b=>{let v=b.volume;if(resize&&b.bufferType==='chemical_wash')v=Math.max(v,t.volumeM3,.6*contactMin);if(resize&&(b.bufferType==='weighted'||b.bufferType==='elastic_spacer'))v=t.volumeM3+Math.max(v,.001);
  if(Math.abs(v-b.volume)>1e-6&&b.additives.some(a=>a.percentage<=0&&a.massKg>0))throw Error(b.name+': абсолютные массы добавок не масштабируются. Задайте концентрации.');
  const k=b.volume>0?v/b.volume:1;return {...b,volume:v,flowRateSteps:b.flowRateSteps.map(s=>({...s,volumeM3:s.volumeM3*k}))};});
 let before=0;const windows=buffers.map((b,i)=>{const start=b.bufferType==='chemical_wash'?before:before+pipe+geometry.volume(t.bottomMD,p.wellData.casingDepthMD),end=before+b.volume+pipe+geometry.volume(t.topMD,p.wellData.casingDepthMD);before+=b.volume;return {i,b,start,end};});
 const base={...p,buffers},contract=buildProcessContract(base);if(!contract.canRun)throw Error(contract.issues.filter(x=>x.severity==='error').map(x=>x.message).join('; '));
 const limits=windows.flatMap(x=>[x.start,x.end]),steps=new Map<string,FlowRateStep[]>();let injected=0;
 const original=p.displacementFluids.flatMap((d,i)=>d.flowRateSteps.map((s,j)=>({s,i,j}))),last=original.at(-1),landing=last&&original.length>1&&last.s.rateLps<Math.max(...original.slice(0,-1).map(x=>x.s.rateLps))?last:undefined;
 for(const st of contract.stages){if(st.destination!=='well')continue;const end=injected+st.volumeM3,cuts=[injected,...limits.filter(v=>v>injected+1e-9&&v<end-1e-9),end].sort((a,b)=>a-b),out=steps.get(st.fluidId)??[];
  for(let k=1;k<cuts.length;k++){const mid=(cuts[k]+cuts[k-1])/2,active=windows.filter(w=>mid>=w.start&&mid<w.end);let q=active.some(w=>w.b.bufferType==='chemical_wash')?10:active.some(w=>w.b.bufferType==='weighted'||w.b.bufferType==='elastic_spacer')?qHeavy:st.kind==='displacement'?qDisp:qCement;
   if(st.kind==='cement'||st.kind==='buffer')q=Math.min(q,maxCementRateLps);
   if(st.kind==='displacement'&&landing&&st.fluidId==='displacement:'+landing.i&&st.stepIndex===landing.j)q=Math.min(q,landing.s.rateLps);
   out.push({volumeM3:cuts[k]-cuts[k-1],rateLps:q,volumeMode:'manual'});
  }steps.set(st.fluidId,out);injected=end;
 }
 if(resize&&windows.some(w=>w.end>injected+1e-6))throw Error('До Стоп хвост буфера не проходит целевую зону. Проверьте размещение цемента.');
 return {...base,buffers:buffers.map((b,i)=>({...b,flowRateSteps:steps.get('buffer:'+i)??[]})),slurries:p.slurries.map((s,i)=>({...s,flowRateSteps:steps.get('cement:'+i)??[]})),displacementFluids:p.displacementFluids.map((d,i)=>({...d,flowRateSteps:steps.get('displacement:'+i)??[]}))};
}
export function auditProgramBuffers(p:ProgramInput,t:CleaningTarget,r:PressureProfileResult):{transit:BufferTransitRecord[];issues:string[]}{
 const depths=cleaningDepths(p.wellData,t),issues=new Set<string>(),transit:BufferTransitRecord[]=[];
 for(const [index,b] of p.buffers.entries()){
  const id='buffer:'+index,seconds=depths.map(()=>0),heavySeconds=depths.map(()=>0),seen=new Set<number>();let lo=Infinity,hi=0,minRegime=Infinity,maxRegime=0;
  for(let i=1;i<r.points.length;i++){const f=r.points[i],prev=r.points[i-1],dt=(f.time-prev.time)*60;if(!(dt>0))continue;
   const at=(cols:typeof f.transportColumns.annulus,md:number)=>cols?.some(c=>c.fluidId===id&&md>=c.topMD-1e-7&&md<=c.botMD+1e-7);
   for(let j=0;j<depths.length;j++){const md=depths[j];if(!at(f.transportColumns?.annulus,md))continue;seen.add(j);const q=f.annularReturnRate,flow=cleaningFlow(p.wellData,b,md,q);lo=Math.min(lo,q);hi=Math.max(hi,q);minRegime=Math.min(minRegime,flow.regime);maxRegime=Math.max(maxRegime,flow.regime);
    if(b.bufferType==='chemical_wash'&&(Math.abs(q-10)>.02||flow.regime!==0))issues.add(b.name+': химбуфер должен проходить зону ламинарно при 10 л/с.');
    if(at(prev.transportColumns?.annulus,md)){seconds[j]+=dt;if(flow.regime>=.5)heavySeconds[j]+=dt;}
   }
  }
  if(seen.size!==depths.length||Math.min(...seconds)<=0)issues.add(b.name+': проход/контакт не подтверждён по всей целевой зоне нативными кадрами.');
  if((b.bufferType==='weighted'||b.bufferType==='elastic_spacer')&&Math.min(...heavySeconds)<=0)issues.add(b.name+': нет переходного/турбулентного прохода всей целевой зоны.');
  transit.push({name:b.name,fluidId:id,minRateLps:Number.isFinite(lo)?lo:0,maxRateLps:hi,minContactMin:Math.min(...seconds)/60,minRegime:Number.isFinite(minRegime)?minRegime:0,maxRegime,coveredDepths:seen.size,totalDepths:depths.length});
 }
 return {transit,issues:[...issues]};
}
function hardwareRecord(depth:number,cp:CentralizerPlan,product:CatalogTurbulator|undefined,points:TurbulatorPoint[]):OptimizerProgramRecord['hardware']{
 const groups=new Map<string,OptimizerProgramRecord['hardware'][number]>();
 for(const joint of buildCentralizerJointSchedule(depth,cp.intervals))for(const {spec} of joint.placements){const p=spec.passport,ref=spec.libraryReference,key=centralizerSignature(spec)+'|'+(ref?.entryId??'')+'|'+(ref?.revision??'');const row=groups.get(key)??{kind:'centralizer' as const,quantity:0,identity:{id:ref?.entryId??p?.model??spec.type,model:p?.model??spec.type,manufacturer:p?.manufacturer??'Не указан',source:ref?.source??p?.source??'Паспорт проекта',sourceUrl:p?.sourceUrl,revision:ref?.revision??1,basis:ref?.basis??'catalog'}};row.quantity++;groups.set(key,row);}
 const central=[...groups.values()];
 return product&&points.length?[...central,{kind:'turbulator',quantity:points.length,identity:product.identity}]:central;
}
export async function completeOptimizerResults(p:ProgramInput,s:OptimizerSettings,catalog:OptimizerHardwareCatalog,result:OptimizerResult,candidates:VariantEval[],evaluate:CleaningEvaluator,apply:(b:ProgramInput['buffers'],c:ProgramInput['slurries'],d:ProgramInput['displacementFluids'],v:ProgramVariant)=>Pick<ProgramInput,'buffers'|'slurries'|'displacementFluids'>,choose:(ev:VariantEval[],s:OptimizerSettings)=>OptimizerResult['best'],progress?:(done:number,total:number)=>void,shouldStop:()=>boolean=()=>false,onConfirmed?:(result:OptimizerResult)=>void,stopAfterFirst=false):Promise<OptimizerResult>{
 const failures=new Set<string>(),available=compatibleHardware(p.wellData,catalog);let target:CleaningTarget;
 try{target=programTarget(p);}catch(e){return {...result,best:[],blocker:(e as Error).message};}
 if(!available.centralizers.length)return {...result,best:[],blocker:'В справочнике нет подходящих центраторов для этой колонны.'};
 const eligible=candidates.filter(e=>e.feasible&&!e.pruned&&e.centralization?.intervals.length),byQ=[...eligible].sort((a,b)=>(b.cqi??0)-(a.cqi??0)),byMargin=[...eligible].sort((a,b)=>b.minMarginMPa-a.minMarginMPa),byTime=[...eligible].sort((a,b)=>a.jobTimeMin-b.jobTimeMin);
 const queue:VariantEval[]=[],seen=new Set<string>();const add=(e:VariantEval)=>{const key=JSON.stringify([e.variant,e.centralization?.intervals]);if(!seen.has(key)){seen.add(key);queue.push(e);}};
 for(const sorted of [byQ,byMargin,byTime])sorted.slice(0,3).forEach(add);
 const plans=new Set<CentralizerPlan>();for(const e of byQ)if(!plans.has(e.centralization)){plans.add(e.centralization);add(e);}
 if(!queue.length)return {...result,best:[],blocker:shouldStop()?'Достигнут лимит времени автоподбора. Полностью проверенные программы не найдены; исходные данные сохранены.':result.blocker??'Для полной программы нужна рассчитанная расстановка из справочника. Включите подбор центрирования.'};
 const seenPrograms=new Set<string>(),pool:VariantEval[]=[],records=new Map<VariantEval,CompleteProgramPlan>();
 const prepared=s.optimizeBuffer?prepareCleaningProgram(p):{program:p,notes:[]};
 const layoutCache=new Map<string,ReturnType<typeof placeProgramTurbulators>>();
 const rates:number[]=[];for(let q=s.minRateLps;q<=s.maxRateLps+1e-9;q+=s.rateStepLps)rates.push(q);
 // Full confirmation is bounded to representative seeds; all safety checks still use native hydraulics.
 const seeds:VariantEval[]=[],seedPlans=new Set<CentralizerPlan>();
 for(const ev of byQ)if(!seedPlans.has(ev.centralization)){seedPlans.add(ev.centralization);seeds.push(ev);}
 for(const ev of queue)if(!seeds.includes(ev)&&seeds.length<Math.max(6,seedPlans.size+3))seeds.push(ev);
 const products:(CatalogTurbulator|undefined)[]=available.turbulators.length?available.turbulators:[undefined];
 const snapshot=():OptimizerResult=>{
 const withTools=pool.filter(ev=>records.get(ev)?.program.wellData.turbulatorDesign?.points.length);
 const best=choose(withTools.length?withTools:pool,s).map(item=>{const original=records.get(item.ev),record={...original.record,variant:item.label},complete={...original,record,program:{...original.program,wellData:{...original.program.wellData,optimizerProgram:record}}};return {...item,complete,hint:item.hint+' Полная программа: интервальные расходы и оснастка из справочника.'};});
 return {...result,best,highQuality:undefined,centralizerStudy:undefined,planningNotes:[...(shouldStop()?['Поиск ограничен по времени. Показаны только полностью проверенные программы; оптимальность по всей сетке не подтверждена.']:[]),...(result.planningNotes??[]),...new Set(best.flatMap(x=>x.complete.record.notes.filter(n=>n.includes('не подтверждено')||n.includes('нет допустимых')||n.includes('нет подходящего')))),`Проверено полных вариантов: ${pool.length}. Источники оснастки и фактический проход буферов доступны у каждого результата.`],blocker:best.length?undefined:shouldStop()?'Достигнут лимит времени автоподбора. Полностью проверенные программы не найдены; исходные данные сохранены.':result.blocker??('Не удалось подтвердить полную программу. '+[...failures].slice(0,2).join('; '))};
 };
 let done=0;const total=seeds.length*products.length*(s.optimizeBuffer?2:1);
 search: for(const seed of seeds)for(const product of products)for(const boost of s.optimizeBuffer?[true,false]:[false]){if(shouldStop())break search;done++;progress?.(done,total);try{
  const cp=seed.centralization,source=boost?prepared.program:p;
  const base={...source,...apply(source.buffers,source.slurries,source.displacementFluids,seed.variant)};
  const w={...base.wellData,standoffProfile:cp.profile.map(x=>({md:x.md,standoffPct:x.standoff}))};
  const heavy=base.buffers.find(b=>b.bufferType==='weighted'||b.bufferType==='elastic_spacer')??base.buffers.at(-1)??{...p.drillingFluid,volume:0,additives:[],flowRateSteps:[]};
  // Prefer the highest allowed annular rate; surface mixing stages are independently capped below.
  const qHeavy=boost?rates.at(-1)!:seed.variant.q1;
  const key=JSON.stringify([product,cp.intervals,qHeavy,heavy.density,heavy.rheology]);let layout=layoutCache.get(key);
  if(!layout){layout=product?placeProgramTurbulators(base,cp,target,product,heavy,qHeavy,s.jointLengthM):{design:defaultTurbulatorDesign(),swirlDepths:new Set<number>(),notes:['В справочнике нет подходящего турбулизатора; рассчитана программа с центраторами.']};layout.design.fluidId=base.buffers.includes(heavy)?'buffer-'+base.buffers.indexOf(heavy):'mud';layoutCache.set(key,layout);}
  const profile=cp.profile.map(row=>({...row,hasTurbulizer:layout.swirlDepths.has(row.md)})),centralization={...cp,profile};
  let program=scheduleIntervalProgram({...base,wellData:{...w,turbulatorDesign:layout.design}},target,qHeavy,seed.variant.q1,seed.variant.q2,boost,s.chemicalContactMin??10,s.maxCementRateLps);
  program={...program,wellData:{...program.wellData,fluidInteractionLab:remapCleaningLab(p,program)}};
  const contract=buildProcessContract(program);if(contract.stages.some(st=>(st.kind==='cement'||st.kind==='buffer')&&st.rateLps>s.maxCementRateLps+.001))throw Error('Ступень на буфере/цементе превышает заданную производительность затворения.');
  let pressure:PressureProfileResult|undefined;const ev={...evaluate(program,seed.variant,centralization,true,r=>{pressure=r;}),centralization};
  if(!ev.feasible){ev.violations.forEach(x=>failures.add(x));continue;}if(!pressure)throw Error('Нет нативного расчёта программы.');
  const audit=auditProgramBuffers(program,target,pressure);if(boost&&audit.issues.length){audit.issues.forEach(x=>failures.add(x));continue;}
  const nextWell={...program.wellData,optimizerCleaning:undefined,centralizerDesign:{mode:'manual' as const,targetStandoff:cp.targetPct??Math.max(10,Math.min(99,cp.minStandoffPct)),jointLength:s.jointLengthM,autoSpec:cp.intervals[0].spec,intervals:cp.intervals}};
  nextWell.centralizerMaterials={geometryKey:centralizerMaterialGeometryKey(nextWell),items:centralizerInventory(nextWell.casingDepthMD,cp.intervals)};
  const record:OptimizerProgramRecord={version:1,variant:'',createdAt:new Date().toISOString(),cqi:ev.cqi??0,minCqi:ev.minCqi??0,targetFromMD:target.topMD,targetToMD:target.bottomMD,bufferBoost:boost,transit:audit.transit,hardware:hardwareRecord(p.wellData.casingDepthMD,centralization,product,layout.design.points),notes:[...(boost?prepared.notes:[]),...layout.notes,...(!boost?[s.optimizeBuffer?'Дополнительное буферное усиление не подтверждено; сохранён допустимый вариант по качеству без обязательного турбулентного прохода.':'Подбор буферов отключён: составы и объёмы сохранены.',...audit.issues]:[]),...[...new Set(cp.intervals.flatMap(iv=>centralizerModelNotes(iv.spec)))],'CQI — расчётная оценка. Ступени и проход буферов проверены нативной гидравликой.','Источник оснастки сохранён по конкретной версии. Неуказанные в паспорте силовые/геометрические параметры остаются допущениями существующей модели.']};
  program={...program,wellData:{...nextWell,optimizerProgram:record}};
  const signature=JSON.stringify([program.buffers,program.slurries,program.displacementFluids,cp.intervals,layout.design],(k,v)=>k==='id'||k==='appliedAt'?undefined:v);if(seenPrograms.has(signature))continue;seenPrograms.add(signature);pool.push(ev);records.set(ev,{sourceKey:cleaningInputKey(p),program,centralization,evaluation:ev,record});
  onConfirmed?.(snapshot());
  if(stopAfterFirst&&(!available.turbulators.length||layout.design.points.length>0))break search;
 }catch(e){failures.add((e as Error).message);}finally{if(done%2===0)await new Promise(r=>setTimeout(r,0));}}
 return snapshot();
}
