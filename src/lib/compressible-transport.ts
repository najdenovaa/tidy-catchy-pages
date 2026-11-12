import {transportMesh} from './transport-mesh';
import {initializeFlow,advanceFlow,type FlowSystem,type FlowCell,type FlowState} from './compressible-flow';
import {buildProcessContract} from './cementing-process';
import {normalizeCementingSnapshot,type CementingSnapshot} from './cementing-normalizers';
import {normalizeStopStorage} from './stop-storage';
import {createAnnularGeometry} from './well-geometry';
import {getEffectiveTrajectory,interpolateTVD,totalPipeVolumeForRange,effectiveRheology,cementCategory,hbOf} from './cementing-calculations';
import {rheologyInputErrors} from './cement-rheology';
export interface TransportFrame {sealClosed?:boolean;barrierFlowKgS?:number;timeMin:number;stage:string;inletMPa:number;shoeCellMPa:number;pumpedReferenceM3:number;returnedReferenceM3:number;returnRateReferenceLps:number;maxStepResidualKg:number}
export interface TransportStudy {
 inputKey:string; rows:{label:string;cellCount:number;actualCellLengthM:number;minCellLengthM:number;maxCellLengthM:number;stepSeconds:number;acceptedSteps:number;status:string;reason:string;maxMassResidualKg:number}[];
 comparisons:{label:string;maxInletDifferenceMPa:number;returnDifferenceM3:number;compositionL1:number;beforeClosureMPa?:number;afterClosureMPa?:number;barrierTransferredDifferenceKg?:number;afterComparisonStartMin?:number}[];note:string;
}
export interface TransportResult {
 mesh?:{minLengthM:number;maxLengthM:number;meanLengthM:number};
 study?:TransportStudy;
 boundaryEvents?:{timeMin:number;kind:string;depthMD:number;note:string}[];
 model:'compressible-fv-research-v1';inputKey:string;status:'complete'|'stopped';reason:string;cellLengthM:number;stepSeconds:number;cellCount:number;acceptedSteps:number;maxStepRelativeResidual:number;
 frames:TransportFrame[];components:{name:string;id:string;rhoRef:number;bulkMPa:number;initialKg:number;injectedKg:number;returnedKg:number;retainedKg:number;residualKg:number}[];
 profile:{leg:string;md:number;volumeM3:number;pressureMPa:number;fractions:{id:string;name:string;massFraction:number}[]}[];limitations:string[];
}
/** Full normalized key; a short display hash is not used for report/cache validity. */
export function transportInputKey(input:CementingSnapshot){const p=normalizeCementingSnapshot(input);return JSON.stringify(['compressible-fv-research-v1',{...p,wellData:{...p.wellData,caliperLog:undefined}}]);}
export function simulateCompressibleTransport(input:CementingSnapshot,progress?:(fraction:number)=>void):TransportResult{
 const p=normalizeCementingSnapshot(input),w=p.wellData,settings=normalizeStopStorage(w.stopStorage),contract=buildProcessContract(p);
 const r:TransportResult={model:'compressible-fv-research-v1',inputKey:transportInputKey(input),status:'stopped',reason:'',cellLengthM:settings?.flowCellLengthM??250,stepSeconds:settings?.flowStepSeconds??30,cellCount:0,acceptedSteps:0,maxStepRelativeResidual:0,frames:[],components:[],profile:[],limitations:[
  'Исследовательская 1D-модель: изотермическая жидкость, постоянные K, жёсткая колонна, заполненный контур с открытым возвратом. Начальная масса определена собственным гидростатическим равновесием EOS.',
  'Давление, массовые потоки и состав решаются совместно. Импульс квазистационарный: инерция и гидроудар не учитываются. Массовые доли переносятся апвиндом первого порядка, границы жидкостей численно размываются.',
  'Порции и расходы приведены к опорному давлению плотностей. Начальный раствор в контуре уже сжат. Масса и объёмы этой ветки не смешиваются с основной моделью постоянной плотности.',
  'Модель циркуляции без твёрдых пробок: расчёт заканчивается по назначенному расписанию. Движение пробок и срез не моделируются. Можно явно задать идеальный обратный клапан и момент герметичного перекрытия на ЦКОД; это сценарные граничные условия, не прогноз посадки.',
  'Газ, свободная поверхность, потери, приток, тепло и упругость труб не решаются. Разрежение или обратный приток через возврат прекращают расчёт. Неполный результат не является рассчитанной программой цементирования.',
  'Геометрические объёмы ячеек учитывают исходные диаметры/секции, гидравлический диаметр усреднён по вместимости ячейки. Смешанная реология - объёмно взвешенные сопротивления чистых жидкостей без химического взаимодействия.',
  'Для проектных решений нужны исследование сходимости сетки/шага и промысловая проверка. Основной расчёт, его ограничения и автоматический подбор не заменяются этой веткой.'
 ]};
 try{
  if(!settings?.flowEnabled)throw new Error('Включите исследовательский сжимаемый перенос во вводе.');
  if(!contract.canRun)throw new Error(contract.issues.filter(i=>i.severity==='error').map(i=>i.message).join(' '));
  const errors=rheologyInputErrors(p);if(errors.length)throw new Error(errors.join(' '));
  if(!(r.cellLengthM>=10&&r.cellLengthM<=1000&&r.stepSeconds>=.1&&r.stepSeconds<=60))throw new Error('Длина ячейки: 10-1000 м; шаг времени: 0,1-60 с.');
  if(!(w.casingDepthMD>0&&w.casingOD>0&&w.casingWall>0&&2*w.casingWall<w.casingOD)||(w.casingSections??[]).some(c=>!(c.wallThickness>0&&2*c.wallThickness<w.casingOD)))throw new Error('Некорректная геометрия колонны.');
  const count=Math.max(2,Math.ceil(w.casingDepthMD/r.cellLengthM));if(count*2>120)throw new Error('Больше 120 ячеек. Увеличьте длину ячейки для исследовательского прогона.');
  const used=new Set(['mud:0',...contract.stages.filter(s=>s.destination==='well').map(s=>s.fluidId)]);
  const fluids=contract.fluids.filter(f=>used.has(f.id)&&f.kind!=='serviceWater').map(f=>{
   const bulkMPa=settings.bulkModuliMPa[f.kind as 'mud'],rheo=effectiveRheology(f.rheology,f.kind==='cement'?cementCategory(f.densityKgM3/1000):f.kind==='buffer'?'buffer':f.kind==='displacement'?'displacement':'mud');
   if(!(bulkMPa>0))throw new Error('Укажите K для '+f.name+'.');
   return {id:f.id,name:f.name,rhoRef:f.densityKgM3,bulkMPa,pv:rheo.pv,yp:rheo.yp,hb:hbOf(rheo)};
  });
  const hasBarrier=settings.flowCheckValve||settings.flowClosureEnabled;
  if(hasBarrier&&!(w.ckodDepth>0&&w.ckodDepth<=w.casingDepthMD))throw new Error('Для границы нужна глубина ЦКОД в пределах колонны.');
  const closureTime=settings.flowClosureTimeMin;
  if(settings.flowClosureEnabled&&!(closureTime!==undefined&&closureTime>=0&&closureTime<=(contract.totalTimeMin??0)))throw new Error('Задайте момент перекрытия от 0 до конца расписания, мин.');
  const mesh=transportMesh(w.casingDepthMD,r.cellLengthM,hasBarrier?w.ckodDepth:undefined,settings.flowMeshRefinement??1);
  const {cuts,pipeCount}=mesh,barrierFace=cuts.indexOf(w.ckodDepth);
  r.mesh={minLengthM:mesh.minLengthM,maxLengthM:mesh.maxLengthM,meanLengthM:mesh.meanLengthM};
  const traj=getEffectiveTrajectory(w),ann=createAnnularGeometry(w,w.casingDepthMD),cells:FlowCell[]=[];
  const standoff=(md:number)=>{const points=[...(w.standoffProfile??[])].sort((a,b)=>a.md-b.md);if(!points.length)return w.annularStandoffPct??67;const right=points.findIndex(p=>p.md>=md);if(right===0)return points[0].standoffPct;if(right<0)return points.at(-1)!.standoffPct;const a=points[right-1],b=points[right];return a.standoffPct+(md-a.md)/(b.md-a.md)*(b.standoffPct-a.standoffPct);};
  for(let i=0;i<pipeCount;i++){
   const top=cuts[i],bottom=cuts[i+1],length=bottom-top,volumeM3=totalPipeVolumeForRange(top,bottom,w.casingOD,w.casingWall,w.casingSections);
   cells.push({volumeM3,lengthM:length,tvd:interpolateTVD((top+bottom)/2,traj),kind:'pipe',outerMm:w.casingOD,innerMm:Math.sqrt(4*volumeM3/(Math.PI*length))*1000,md:(top+bottom)/2});
  }
  for(let i=pipeCount-1;i>=0;i--){const top=cuts[i],bottom=cuts[i+1],length=bottom-top,volumeM3=ann.volume(top,bottom);cells.push({volumeM3,lengthM:length,tvd:interpolateTVD((top+bottom)/2,traj),kind:'annulus',outerMm:Math.sqrt(4*volumeM3/(Math.PI*length)+(w.casingOD/1000)**2)*1000,innerMm:w.casingOD,md:(top+bottom)/2,standoffPct:standoff((top+bottom)/2)});}
  const system:FlowSystem={barriers:hasBarrier?[{face:barrierFace,checkValve:settings.flowCheckValve,crackMPa:settings.flowCheckValve?(settings.flowValveCrackMPa??0):0}]:[],cells,fluids,referenceMPa:settings.referencePressureMPa??0,outletMPa:settings.surfaceBackpressureMPa??0,inletTvd:interpolateTVD(0,traj),outletTvd:interpolateTVD(0,traj),frictionMultiplier:w.frictionCalibration??1};
  if(system.referenceMPa<0||system.outletMPa<0)throw new Error('Опорное давление и противодавление должны быть неотрицательными.');
  let state:FlowState=initializeFlow(system,fluids.findIndex(f=>f.id==='mud:0')),time=0,pumped=0,returned=0;
  r.cellCount=cells.length;r.components=fluids.map((f,j)=>({...f,initialKg:state.masses.reduce((n,m,i)=>n+m*state.fractions[i][j],0),injectedKg:0,returnedKg:0,retainedKg:0,residualKg:0}));
  const snapshot=()=>{r.components.forEach((f,j)=>{f.retainedKg=state.masses.reduce((n,m,i)=>n+m*state.fractions[i][j],0);f.residualKg=f.initialKg+f.injectedKg-f.returnedKg-f.retainedKg;});r.profile=cells.map((c,i)=>({leg:c.kind,md:c.md,volumeM3:c.volumeM3,pressureMPa:state.pressures[i],fractions:fluids.map((f,j)=>({id:f.id,name:f.name,massFraction:state.fractions[i][j]}))}));};snapshot();
  r.frames.push({timeMin:0,stage:'Гидростатическое равновесие',inletMPa:system.outletMPa,shoeCellMPa:state.pressures[pipeCount-1],pumpedReferenceM3:0,returnedReferenceM3:0,returnRateReferenceLps:0,maxStepResidualKg:0});
  r.boundaryEvents=[];let sealClosed=false;
  if(settings.flowCheckValve)r.boundaryEvents.push({timeMin:0,kind:'idealCheckValve',depthMD:w.ckodDepth,note:'Идеальный обратный клапан: только прямой поток; давление открытия '+(settings.flowValveCrackMPa??0)+' МПа. Негерметичность и паспортная характеристика не моделируются.'});
  const closeIfDue=()=>{if(settings.flowClosureEnabled&&!sealClosed&&time>=closureTime!-1e-10){sealClosed=true;system.barriers![0].closed=true;r.boundaryEvents!.push({timeMin:time,kind:'prescribedSeal',depthMD:w.ckodDepth,note:'Герметичное перекрытие задано пользователем. Движение и механическая посадка пробки не рассчитаны. Последующая подача остаётся над границей.'});}};
  for(const stage of contract.stages){
   const isSurface=stage.destination==='surface',index=isSurface?0:fluids.findIndex(f=>f.id===stage.fluidId),rate=isSurface?0:stage.rateLps/1000,kgS=rate*fluids[index].rhoRef;
   let remaining=(stage.durationMin??0)*60;
   while(remaining>1e-8){
    if(r.acceptedSteps>=1500)throw new Error('Лимит 1500 шагов. Увеличьте шаг времени или сократите сценарий.');
    closeIfDue();
    let dt=Math.min(r.stepSeconds,remaining,...(settings.flowClosureEnabled&&!sealClosed?[(closureTime!-time)*60]:[])),step:ReturnType<typeof advanceFlow>|undefined,lastError='';
    for(let retry=0;retry<7;retry++){try{step=advanceFlow(system,state,dt,kgS,index);break;}catch(e){lastError=e instanceof Error?e.message:String(e);dt/=2;}}
    if(!step)throw new Error('t='+time.toFixed(2)+' мин, '+stage.name+': '+lastError);
    state=step.state;time+=dt/60;remaining-=dt;pumped+=rate*dt;r.acceptedSteps++;
    r.components[index].injectedKg+=kgS*dt;step.returnedKg.forEach((m,j)=>r.components[j].returnedKg+=m);snapshot();
    const refOut=step.returnedKg.reduce((n,m,j)=>n+m/fluids[j].rhoRef,0);returned+=refOut;r.maxStepRelativeResidual=Math.max(r.maxStepRelativeResidual,step.maxRelativeResidual);
    r.frames.push({sealClosed,barrierFlowKgS:hasBarrier?step.fluxKgS[barrierFace]:undefined,timeMin:time,stage:stage.name,inletMPa:step.inletMPa,shoeCellMPa:state.pressures[pipeCount-1],pumpedReferenceM3:pumped,returnedReferenceM3:returned,returnRateReferenceLps:refOut/dt*1000,maxStepResidualKg:step.maxComponentResidualKg});
    if(r.acceptedSteps%10===0)progress?.(Math.min(.99,time/Math.max(contract.totalTimeMin??1,1)));
   }
  }
  closeIfDue();snapshot();r.status='complete';r.reason=settings.flowClosureEnabled?'Расписание с заданным перекрытием рассчитано; это сценарий границы, не прогноз посадки пробки.':'Расписание циркуляции рассчитано; механическая посадка пробки не моделируется.';
 }catch(e){r.reason=e instanceof Error?e.message:String(e);}
 return r;
}
export function transportCsv(r:TransportResult){return 'status;seal_closed;barrier_flow_kg_s;time_min;inlet_mpa;shoe_cell_mpa;pumped_reference_m3;returned_reference_m3;return_rate_reference_lps;step_component_residual_kg\n'+r.frames.map(p=>[r.status,p.sealClosed??false,p.barrierFlowKgS??'',p.timeMin,p.inletMPa,p.shoeCellMPa,p.pumpedReferenceM3,p.returnedReferenceM3,p.returnRateReferenceLps,p.maxStepResidualKg].join(';')).join('\n');}
