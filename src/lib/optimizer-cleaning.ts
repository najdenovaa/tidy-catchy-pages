/** High-quality design. Laboratory removal is evidence, never a predicted cleaning percentage. */
import {
 annularFrictionMPa, getEffectiveTrajectory, interpolateTVD, totalPipeVolumeForRange, hbOf,
 type BufferFluid, type FlowRateStep, type PressureProfileResult, type WellData,
} from './cementing-calculations';
import {createAnnularGeometry,boreDiameterAtDepth} from './well-geometry';
import {resolveObservationDepth} from './pressure-observation';
import {buildProcessContract} from './cementing-process';
import {labFluids,removalIssue,type FluidInteractionLab,type RemovalTest} from './fluid-interaction-lab';
import {calculateTurbulatorFlow,defaultTurbulatorDesign,turbulatorStandoff} from './turbulator-flow';
import type {TurbulatorPoint} from './centralization-calculations';
import type {ProgramInput,OptimizerSettings,CentralizerPlan,ProgramVariant,VariantEval} from './cement-optimizer';

export const CLEANING_RATE_LPS=10, CLEANING_ABOVE_TVD_M=150, CLEANING_TARGET_PCT=85;
export const CLEANING_NOTE='85% — измеренный результат конкретной рецептуры и образца при T/P, времени и сдвиге протокола, не прогноз смытия в скважине. Расстановка и сдвиг оценочные. Режим осевого потока не заменяется наличием закрутки. Переключения подачи рассчитаны по несжимаемому поршневому переносу; дополнительно проверены сохранённые кадры нативной гидравлики. Между кадрами и на неучтённых неоднородностях очистка не подтверждается.';
export interface CleaningTarget {topMD:number;bottomMD:number;topTVD:number;bottomTVD:number;volumeM3:number;layers:string[];aboveActualM:number}
export interface CleaningProof {id:string;source:string;removalPct:number;exposureS:number;criticalPa:number;temperatureC:number;pressureMPaAbs:number}
export interface CleaningDesign {
 version:1; target:CleaningTarget; targetRemovalPct:85; chemicalName:string;heavyName:string;
 chemicalVolumeM3:number;heavyVolumeM3:number;chemicalContactMin:number;heavyHighContactMin:number;
 chemicalRateLps:10;heavyRateLps:number;cementRateLps:number;displacementRateLps:number;
 switchVolumeM3:number;heavyEndVolumeM3:number;proof?:CleaningProof;
}
export interface HighQualityScenario {
 sourceKey:string;target?:CleaningTarget;ready:boolean;issues:string[];warnings:string[];design?:CleaningDesign;
 program?:ProgramInput;centralization?:CentralizerPlan;evaluation?:VariantEval;
 candidates:number;
}
export type CleaningEvaluator=(p:ProgramInput,v:ProgramVariant,plan:CentralizerPlan,full:boolean,capture?:(r:PressureProfileResult)=>void)=>VariantEval;
export function cleaningInputKey(p:ProgramInput){return JSON.stringify([p.wellData,p.drillingFluid,p.buffers,p.slurries,p.displacementFluids,p.fractureGradient,p.flushTimeMin,p.flushVolumeM3,p.centralizerIntervals??[]]);}

/** Cover all entered formation intervals plus 150 vertical metres above the shallowest roof, including gaps. */
export function cleaningTarget(w:WellData):CleaningTarget {
 const layers=w.reservoirLayers??[];
 if(!layers.length)throw Error('Не заданы интервалы пластов: целевая зона очистки не определена.');
 if(layers.some(l=>![l.topMD,l.bottomMD].every(Number.isFinite)||l.topMD<0||l.bottomMD<=l.topMD||l.bottomMD>w.casingDepthMD))throw Error('Интервалы пластов должны лежать в пределах колонны и иметь положительную толщину.');
 const trajectory=getEffectiveTrajectory(w);
 // The observation validator rejects incomplete profiles and ambiguous TVD.
 for(const l of layers)resolveObservationDepth({coordinate:'MD',valueM:l.bottomMD},w,trajectory);
 if(trajectory.some((x,i)=>i>0&&x.tvd<trajectory[i-1].tvd-1e-8))throw Error('Для восходящей траектории автоматическое расширение на 150 м TVD неоднозначно. Требуется отдельное задание интервала.');
 const roof=Math.min(...layers.map(l=>l.topMD)),roofTVD=interpolateTVD(roof,trajectory),z=Math.max(0,roofTVD-CLEANING_ABOVE_TVD_M);
 const top=z===0?0:resolveObservationDepth({coordinate:'TVD',valueM:z},w,trajectory).md;
 const bottom=Math.max(...layers.map(l=>l.bottomMD)),geometry=createAnnularGeometry(w,w.casingDepthMD);
 if(geometry.cells.some(c=>c.bottomMD>top&&c.topMD<bottom&&!(c.areaM2>0)))throw Error('В целевом интервале затрубье перекрыто.');
 return {topMD:top,bottomMD:bottom,topTVD:z,bottomTVD:interpolateTVD(bottom,trajectory),volumeM3:geometry.volume(top,bottom),layers:layers.map(l=>l.name),aboveActualM:roofTVD-z};
}
export function cleaningDepths(w:WellData,t:CleaningTarget){
 const nodes=new Set([t.topMD,t.bottomMD]);
 for(let md=t.topMD;md<t.bottomMD;md+=10)nodes.add(md);
 for(const c of createAnnularGeometry(w,w.casingDepthMD).cells)if(c.bottomMD>t.topMD&&c.topMD<t.bottomMD){
  nodes.add(Math.max(t.topMD,c.topMD)+1e-7);nodes.add(Math.min(t.bottomMD,c.bottomMD)-1e-7);
 }
 for(const c of w.standoffProfile??[])if(c.md>=t.topMD&&c.md<=t.bottomMD)nodes.add(c.md);
 return [...nodes].filter(x=>x>=t.topMD&&x<=t.bottomMD).sort((a,b)=>a-b);
}
export function cleaningFlow(w:WellData,b:BufferFluid,md:number,q:number){
 const bore=boreDiameterAtDepth(w,md),r=b.rheology,so=turbulatorStandoff(w,md);
 const f=annularFrictionMPa(q,1,bore,w.casingOD,r.pv,r.yp,b.density,so,hbOf(r));
 const narrowGap=(bore-w.casingOD)/2000*so/100;
 return {...f,narrowShearPa:f.pressureMPa*1e6*narrowGap/2};
}
/** Volume changes preserve concentration; never silently change an absolute-mass recipe. */
function resizedBuffer(b:BufferFluid,volume:number):BufferFluid {
 if(b.additives.some(a=>a.percentage<=0&&a.massKg>0)&&Math.abs(volume-b.volume)>1e-6)throw Error(b.name+': добавки заданы абсолютной массой. Для изменения объёма задайте дозировки, подтверждённые протоколом.');
 return {...b,volume,flowRateSteps:[{volumeM3:volume,rateLps:10,volumeMode:'manual'}]};
}
/** A single flow schedule for the entire string; fluid injection and its annular transit are different events. */
export function scheduleCleaning(p:ProgramInput,chemical:BufferFluid,heavy:BufferFluid,t:CleaningTarget,exposureS:number,qHeavy:number,qCement:number,qDisp:number){
 const c=resizedBuffer(chemical,Math.max(chemical.volume,t.volumeM3,.01*exposureS));
 // Extra original spacer volume gives a positive high-rate contact after it has filled the target.
 const h=resizedBuffer(heavy,t.volumeM3+Math.max(heavy.volume,.001));
 const pipe=totalPipeVolumeForRange(0,p.wellData.casingDepthMD,p.wellData.casingOD,p.wellData.casingWall,p.wellData.casingSections);
 const toRoof=createAnnularGeometry(p.wellData,p.wellData.casingDepthMD).volume(t.topMD,p.wellData.casingDepthMD);
 const change=c.volume+pipe+toRoof,heavyEnd=change+h.volume;
 const base={...p,buffers:[c,h]},contract=buildProcessContract(base);
 if(!contract.canRun)throw Error(contract.issues.filter(x=>x.severity==='error').map(x=>x.message).join('; '));
 let injected=0;
 const steps=new Map<string,FlowRateStep[]>();
 const original=p.displacementFluids.flatMap((d,i)=>d.flowRateSteps.map((s,j)=>({s,i,j}))),last=original.at(-1);
 const landing=last&&original.length>1&&last.s.rateLps<Math.max(...original.slice(0,-1).map(x=>x.s.rateLps))?last:undefined;
 for(const st of contract.stages){
  if(st.destination!=='well')continue;
  const end=injected+st.volumeM3;
  const cuts=[injected,...[change,heavyEnd].filter(x=>x>injected+1e-9&&x<end-1e-9),end];
  const list=steps.get(st.fluidId)??[];
  for(let i=1;i<cuts.length;i++){
   const mid=(cuts[i]+cuts[i-1])/2;
   let q=mid<change?10:mid<heavyEnd?qHeavy:st.kind==='displacement'?qDisp:qCement;
   // Preserve the landing rate. If it conflicts with the desired transit, report it in the audit.
   if(st.kind==='displacement'&&landing&&st.fluidId==='displacement:'+landing.i&&st.stepIndex===landing.j)q=Math.min(q,landing.s.rateLps);
   list.push({volumeM3:cuts[i]-cuts[i-1],rateLps:q,volumeMode:'manual'});
  }
  steps.set(st.fluidId,list);injected=end;
 }
 const program:ProgramInput={...base,buffers:base.buffers.map((b,i)=>({...b,flowRateSteps:steps.get('buffer:'+i)??[]})),slurries:p.slurries.map((s,i)=>({...s,flowRateSteps:steps.get('cement:'+i)??[]})),displacementFluids:p.displacementFluids.map((d,i)=>({...d,flowRateSteps:steps.get('displacement:'+i)??[]}))};
 if(injected<heavyEnd-1e-6)throw Error('До Стоп хвост тяжёлого буфера не проходит всю целевую зону: требуется изменить размещение цемента.');
 return {program,change,heavyEnd,chemical:c,heavy:h,chemicalContactMin:c.volume/.6,heavyHighContactMin:(h.volume-t.volumeM3)/(qHeavy*.06)};
}
/** Only rename IDs for composition-identical fluids. Changed recipes retain stale keys and cannot acquire old evidence. */
export function remapCleaningLab(old:ProgramInput,next:ProgramInput):FluidInteractionLab|undefined{
 const lab=old.wellData.fluidInteractionLab;if(!lab)return;
 const before=labFluids(old),after=labFluids(next),map=new Map<string,{id:string;key:string}>();
 const signature=(key:string)=>JSON.stringify(JSON.parse(key).slice(1));
 for(const f of before){const matches=after.filter(g=>signature(g.key)===signature(f.key));if(matches.length===1)map.set(f.id,matches[0]);}
 return {...lab,mixtures:lab.mixtures.map(t=>({...t,fractions:t.fractions.map(f=>{const m=map.get(f.fluidId);return m&&before.find(b=>b.id===f.fluidId)?.key===f.key?{...f,fluidId:m.id,key:m.key}:f;})})),removal:lab.removal.map(t=>{const m=map.get(t.cleanerId);return m&&before.find(b=>b.id===t.cleanerId)?.key===t.cleanerKey?{...t,cleanerId:m.id,cleanerKey:m.key}:t;})};
}
function placeCleaningTurbulators(w:WellData,t:CleaningTarget,heavy:BufferFluid,q:number,joint:number){
 const template=w.turbulatorDesign?.points[0];
 if(!template)throw Error('Нет исходной геометрии турбулизатора. Задайте изделие в разделе центрации; размеры по фотографии не назначаются.');
 const points:TurbulatorPoint[]=(w.turbulatorDesign?.points??[]).filter(p=>p.md<t.topMD||p.md>t.bottomMD);
 let md=t.bottomMD;
 while(md>t.topMD+1e-6&&points.length<2000){
  const p={...template,id:'quality-turb-'+md.toFixed(6),md};
  const f=calculateTurbulatorFlow(w,p,q,{id:'quality-heavy',name:heavy.name,density:heavy.density,rheology:heavy.rheology});
  if(!f.valid||!(f.tangentialMs>0))throw Error('Турбулизатор MD '+md.toFixed(1)+': '+(f.issues.join('; ')||'не создаёт закрутку.'));
  points.push(p);
  // Cover with successive model L90 wakes, capped by one casing joint. Not a cleaning-efficiency correlation.
  const distance=Math.min(joint,f.decay90M??f.lengthM);
  if(!(distance>.01))throw Error('Расчётная закрутка затухает слишком быстро для автоматической расстановки.');
  md-=distance;
 }
 if(md>t.topMD+1e-6)throw Error('Для покрытия интервала требуется более 2000 турбулизаторов.');
 return {...(w.turbulatorDesign??defaultTurbulatorDesign()),points:points.sort((a,b)=>a.md-b.md),fluidId:'buffer-1',rateLps:q};
}
export function auditCleaningTransit(p:ProgramInput,t:CleaningTarget,r:PressureProfileResult,proof:RemovalTest|undefined){
 const depths=cleaningDepths(p.wellData,t),chemSeconds=depths.map(()=>0),heavySeconds=depths.map(()=>0),issues=new Set<string>();
 let saw=false;
 for(let i=1;i<r.points.length;i++){
  const f=r.points[i],prev=r.points[i-1],dt=(f.time-prev.time)*60;
  if(!(dt>0))continue;
  const q=f.annularReturnRate,columns=f.transportColumns?.annulus;
  if(!columns){issues.add('Нет независимого состава затрубья для проверки прохода пачек.');continue;}
  const before=prev.transportColumns?.annulus??[];
  for(let j=0;j<depths.length;j++){
   const md=depths[j],at=(cols:typeof columns,id:string)=>cols.some(c=>c.fluidId===id&&md>=c.topMD-1e-7&&md<=c.botMD+1e-7);
   if(at(columns,'buffer:0')){
    saw=true;const flow=cleaningFlow(p.wellData,p.buffers[0],md,q);
    if(Math.abs(q-10)>.02)issues.add('Фактический затрубный расход химбуфера отличается от 10 л/с (переток/посадочная ступень).');
    if(flow.regime!==0)issues.add('Химбуфер не остаётся ламинарным на всём целевом интервале.');
    if(proof&&flow.narrowShearPa+1e-8<proof.criticalPa!)issues.add('Оценочный сдвиг на узкой стороне ниже условия лабораторного испытания.');
    // Conservative contact: only intervals whose two saved endpoints contain this fluid.
    if(at(before,'buffer:0')&&Math.abs(q-10)<=.02&&flow.regime===0)chemSeconds[j]+=dt;
   }
   if(at(columns,'buffer:1')&&at(before,'buffer:1')&&q>0&&cleaningFlow(p.wellData,p.buffers[1],md,q).regime>=.5)heavySeconds[j]+=dt;
  }
 }
 if(!saw)issues.add('Химбуфер не достиг целевой зоны в сохранённых кадрах.');
 if(proof&&Math.min(...chemSeconds)+1e-6<proof.exposureS!)issues.add('Подтверждённое по кадрам время химического воздействия меньше времени испытания.');
 if(Math.min(...heavySeconds)<=0)issues.add('Переходный/турбулентный проход тяжёлого буфера не подтверждён по всей зоне.');
 return {issues:[...issues],chemicalContactMin:Math.min(...chemSeconds)/60,heavyHighContactMin:Math.min(...heavySeconds)/60};
}
export async function buildHighQualityScenario(p:ProgramInput,s:OptimizerSettings,plans:CentralizerPlan[],evaluate:CleaningEvaluator):Promise<HighQualityScenario>{
 const out:HighQualityScenario={sourceKey:cleaningInputKey(p),ready:false,issues:[],warnings:[CLEANING_NOTE],candidates:0};
 let t:CleaningTarget;
 try{t=cleaningTarget(p.wellData);}catch(e){out.issues.push(String((e as Error).message));return out;}
 if((p.wellData.reservoirLayers??[]).some(l=>!(l.porePressureGrad>0)||!(l.fracGrad>0||l.absorbGrad>0||p.fractureGradient>0))){out.issues.push('Для высокого качества задайте пластовые давления и пределы ГРП/поглощения всех пластов.');return out;}
 if(t.aboveActualM<150)out.warnings.push('Расширение вверх ограничено устьем: '+t.aboveActualM.toFixed(1)+' м TVD.');
 out.target=t;
 const chemicals=p.buffers.map((b,i)=>({b,i})).filter(x=>x.b.bufferType==='chemical_wash');
 const heavies=p.buffers.filter(b=>b.bufferType==='weighted'||b.bufferType==='elastic_spacer');
 if(!chemicals.length)out.issues.push('Добавьте химический буфер с заданной рецептурой, плотностью и реологией.');
 if(!heavies.length)out.issues.push('Добавьте тяжёлый/вязкий разделительный буфер с заданной рецептурой.');
 if(out.issues.length)return out;
 const plan=plans.filter(x=>x.targetPct!==null&&x.targetPct>=85).sort((a,b)=>a.totalCount-b.totalCount)[0];
 if(!plan){out.issues.push('Нет рассчитанной расстановки центраторов для целевого отступа 85%.');return out;}
 const w={...p.wellData,standoffProfile:plan.profile.map(x=>({md:x.md,standoffPct:x.standoff}))};
 if(plan.minStandoffPct<84.5)out.issues.push('Целевая центрация 85% не достигнута по расчётной модели.');
 if(!s.minRateLps||s.rateStepLps<=0||s.maxRateLps<s.minRateLps||s.maxCementRateLps<10)out.issues.push('Пределы расходов должны допускать 10 л/с; шаг перебора должен быть положительным.');
 if(out.issues.length)return out;
 const rates:number[]=[];for(let q=s.minRateLps;q<=s.maxRateLps+1e-9;q+=s.rateStepLps){if(rates.length>200){out.issues.push('Слишком мелкий шаг расходов.');return out;}rates.push(q);}
 const cementRates=rates.filter(q=>q<=s.maxCementRateLps);
 const lab=p.wellData.fluidInteractionLab,fluids=labFluids(p),depths=cleaningDepths(w,t);
 const failures=new Set<string>();let best:HighQualityScenario|undefined,bestTest:RemovalTest|undefined;
 for(const {b:chemical,i} of chemicals){
  const tests=lab?.removal.filter(x=>x.cleanerId==='buffer:'+i&&!removalIssue(x,lab,fluids)&&typeof x.removalPct==='number'&&x.removalPct>=85&&x.fromMD!<=t.topMD&&x.toMD!>=t.bottomMD)??[];
  const proof=tests.filter(x=>depths.every(md=>cleaningFlow(w,chemical,md,10).narrowShearPa>=x.criticalPa!)).sort((a,b)=>a.exposureS!-b.exposureS!)[0];
  if(!proof)failures.add(chemical.name+': нет применимого протокола смытия ≥85% для текущих составов, T/P и всей зоны.');
  if(depths.some(md=>cleaningFlow(w,chemical,md,10).regime!==0)){failures.add(chemical.name+': при 10 л/с течение не ламинарное во всей зоне.');continue;}
  if(proof&&depths.some(md=>cleaningFlow(w,chemical,md,10).narrowShearPa<proof.criticalPa!)){failures.add(chemical.name+': сдвиг ниже испытанного условия.');continue;}
  for(const heavy of heavies){
   const lead=p.slurries[0]?.density*1000;
   if(!(heavy.density>p.drillingFluid.density&&heavy.density<lead)){failures.add(heavy.name+': плотность должна быть выше БР и ниже первого цемента; рецептура автоматически не утяжеляется.');continue;}
   const g=(b:Pick<BufferFluid,'rheology'>)=>{const h=hbOf(b.rheology);return h?h.tau0+h.K*100**h.n:b.rheology.yp+b.rheology.pv*.1;};
   if(g(heavy)<g(p.drillingFluid)){failures.add(heavy.name+': напряжение при 100 с⁻¹ ниже БР, вязкостная иерархия не подтверждена.');continue;}
   const qHeavy=cementRates.find(q=>depths.every(md=>cleaningFlow(w,heavy,md,q).regime>=.5));
   if(!qHeavy){failures.add(heavy.name+': переходный режим недостижим в пределах заданных расходов.');continue;}
   let tools:WellData['turbulatorDesign'];
   try{tools=placeCleaningTurbulators(w,t,heavy,qHeavy,s.jointLengthM);}catch(e){failures.add((e as Error).message);continue;}
   for(const qCement of cementRates)for(const qDisp of rates){
    out.candidates++;
    try{
     const scheduled=scheduleCleaning({...p,wellData:{...w,turbulatorDesign:tools}},chemical,heavy,t,proof?.exposureS??0,qHeavy,qCement,qDisp);
     const program=scheduled.program;program.wellData={...program.wellData,fluidInteractionLab:remapCleaningLab(p,program)};
     const currentFluids=labFluids(program),badMixture=program.wellData.fluidInteractionLab?.mixtures.some(x=>x.observation==='anomaly'&&x.temperatureC===lab?.temperatureC&&x.pressureMPaAbs===lab?.pressureMPaAbs&&x.fractions.every(f=>currentFluids.find(g=>g.id===f.fluidId)?.key===f.key));
     if(badMixture){failures.add('Для выбранных жидкостей лабораторией отмечена несовместимость.');continue;}
     const v={q1:qCement,q2:qDisp,bufferVolumeM3:null,bufferDensity:null},ev=evaluate(program,v,plan,false);
     if(!ev.feasible){ev.violations.forEach(x=>failures.add(x));continue;}
     const design:CleaningDesign={version:1,target:t,targetRemovalPct:85,chemicalName:chemical.name,heavyName:heavy.name,chemicalVolumeM3:scheduled.chemical.volume,heavyVolumeM3:scheduled.heavy.volume,chemicalContactMin:scheduled.chemicalContactMin,heavyHighContactMin:scheduled.heavyHighContactMin,chemicalRateLps:10,heavyRateLps:qHeavy,cementRateLps:qCement,displacementRateLps:qDisp,switchVolumeM3:scheduled.change,heavyEndVolumeM3:scheduled.heavyEnd,...(proof?{proof:{id:proof.id,source:proof.source,removalPct:proof.removalPct!,exposureS:proof.exposureS!,criticalPa:proof.criticalPa!,temperatureC:proof.temperatureC!,pressureMPaAbs:proof.pressureMPaAbs!}}:{})};
     if(!best||(!!proof&&!best.design?.proof)||!!proof===!!best.design?.proof&&(ev.minMarginMPa>best.evaluation!.minMarginMPa||ev.minMarginMPa===best.evaluation!.minMarginMPa&&ev.jobTimeMin<best.evaluation!.jobTimeMin)){
      best={...out,design,program,centralization:plan,evaluation:ev,issues:proof?[]:[chemical.name+': цель смытия 85% не подтверждена протоколом.']};bestTest=proof;
     }
    }catch(e){failures.add((e as Error).message);}
    if(out.candidates%4===0)await new Promise(r=>setTimeout(r,0));
   }
  }
 }
 if(!best){out.issues.push(...failures);return out;}
 let pressure:PressureProfileResult|undefined;
 const ev=evaluate(best.program!,best.evaluation!.variant,plan,true,r=>{pressure=r;});
 best.evaluation=ev;best.candidates=out.candidates;
 best.issues.push(...ev.violations);
 if(pressure){
  const audit=auditCleaningTransit(best.program!,t,pressure,bestTest);
  best.issues.push(...audit.issues);best.design!.chemicalContactMin=audit.chemicalContactMin;best.design!.heavyHighContactMin=audit.heavyHighContactMin;
 }
 else best.issues.push('Нет нативного результата для проверки прохода.');
 best.issues=[...new Set(best.issues)];best.ready=best.issues.length===0;
 return best;
}
