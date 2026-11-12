import {resolveFlowRateSteps,slurryDesignVolume,buildDisplacementSchedule,calculateVolumes,type Rheology} from './cementing-calculations';
import {normalizeCementingSnapshot,type CementingSnapshot} from './cementing-normalizers';
export interface ProcessFluid {id:string;kind:'mud'|'buffer'|'cement'|'displacement'|'serviceWater';index:number;name:string;densityKgM3:number;rheology:Rheology}
export interface ProcessStage {id:string;fluidId:string;kind:'buffer'|'cement'|'displacement'|'surfaceFlush';name:string;stepIndex:number;volumeM3:number;rateLps:number;requestedRateLps:number;durationMin:number|null;startMin:number|null;endMin:number|null;destination:'well'|'surface';compressionCoeff:number;assumedRate:boolean}
export interface ProcessIssue {severity:'error'|'warning';code:string;message:string;stageId?:string}
export interface ProcessContract {version:1;inputKey:string;fluids:ProcessFluid[];stages:ProcessStage[];events:{id:string;kind:'start'|'stageStart'|'stageEnd'|'stop';timeMin:number|null;stageId?:string;fluidId?:string}[];issues:ProcessIssue[];canRun:boolean;totalTimeMin:number|null;wellVolumeM3:number;surfaceVolumeM3:number;wellMassKg:number;surfaceMassKg:number;displacementTargetM3:number;volumeResidualM3:number;massResidualKg:number}
/** Surface schedule only. It does not claim a downhole inventory balance for freefall/compression. */
export function buildProcessContract(input:CementingSnapshot,displacementTarget?:number):ProcessContract {
 const s=normalizeCementingSnapshot({...input,wellData:{...input.wellData,caliperLog:undefined}}),w=s.wellData;
 const issues:ProcessIssue[]=[],fluids:ProcessFluid[]=[];
 const addFluid=(kind:ProcessFluid['kind'],index:number,name:string,densityKgM3:number,rheology:Rheology)=>{const id=`${kind}:${index}`;fluids.push({id,kind,index,name,densityKgM3,rheology});return id;};
 addFluid('mud',0,s.drillingFluid.name||'Буровой раствор',s.drillingFluid.density,s.drillingFluid.rheology);
 const service=addFluid('serviceWater',0,'Техническая вода ЛВД',1000,{pv:1,yp:0});
 const bIds=s.buffers.map((f,i)=>addFluid('buffer',i,f.name,f.density,f.rheology));
 const cIds=s.slurries.map((f,i)=>addFluid('cement',i,f.name,f.density*1000,f.rheology));
 const dIds=s.displacementFluids.map((f,i)=>addFluid('displacement',i,f.name,f.density,f.rheology));
 for(const [name,value] of [['Время промывки ЛВД',s.flushTimeMin],['Объём промывки ЛВД',s.flushVolumeM3]] as const)if(value<0)issues.push({severity:'error',code:'NEGATIVE_INPUT',message:name+': отрицательное значение недопустимо.'});
 for(const f of [...s.buffers,...s.slurries,...s.displacementFluids])for(const step of f.flowRateSteps)if(step.rateLps<0||step.volumeM3<0)issues.push({severity:'error',code:'NEGATIVE_MODE',message:f.name+': расход и объём режима не могут быть отрицательными.'});
 const stages:ProcessStage[]=[];let time:number|null=0;
 const add=(fluidId:string,kind:ProcessStage['kind'],name:string,stepIndex:number,volumeM3:number,rateLps:number,compressionCoeff=1,duration?:number,assumedRate=false,requestedRateLps=rateLps)=>{
  const id=`${fluidId}/${kind}/${stepIndex}`;const destination=kind==='surfaceFlush'?'surface':'well';
  let durationMin=duration??(rateLps>0?volumeM3/(rateLps*.06):null);
  if(![volumeM3,rateLps,compressionCoeff].every(Number.isFinite)||volumeM3<0||rateLps<0||compressionCoeff<1||durationMin!==null&&(!Number.isFinite(durationMin)||durationMin<0)){issues.push({severity:'error',code:'INVALID_STAGE',stageId:id,message:`${name}: недопустимые объём, расход или время.`});durationMin=null;}
  if(volumeM3>0&&!(rateLps>0)){issues.push({severity:'error',code:'MISSING_RATE',stageId:id,message:`${name}: для положительного объёма нужен положительный расход.`});durationMin=null;}
  if(destination==='well'&&volumeM3>0&&!(fluids.find(f=>f.id===fluidId)?.densityKgM3>0))issues.push({severity:'error',code:'MISSING_DENSITY',stageId:id,message:`${name}: укажите положительную плотность.`});
  if(assumedRate)issues.push({severity:'warning',code:'LEGACY_RATE',stageId:id,message:`${name}: расход не задан; применён прежний резервный расход ${rateLps} л/с. Введите фактический режим.`});
  const endMin=time===null||durationMin===null?null:time+durationMin;
  stages.push({id,fluidId,kind,name,stepIndex,volumeM3,rateLps,requestedRateLps,durationMin,startMin:time,endMin,destination,compressionCoeff,assumedRate});time=endMin;
 };
 const modes=(fluidId:string,kind:'buffer'|'cement',name:string,steps:Parameters<typeof resolveFlowRateSteps>[0],design:number)=>{
  if(!Number.isFinite(design)||design<0){issues.push({severity:'error',code:'INVALID_DESIGN_VOLUME',message:name+': недопустимый расчётный объём.'});return;}
  const resolved=resolveFlowRateSteps(steps,design),actual=resolved.reduce((n,x)=>n+x.volumeM3,0);
  if(Math.abs(actual-design)>1e-6)issues.push({severity:'warning',code:'DESIGN_VOLUME_OVERRIDE',message:`${name}: режимы задают ${actual.toFixed(3)} м³ при расчётном объёме ${design.toFixed(3)} м³. Ручные объёмы сохранены.`});
  resolved.forEach((x,i)=>{if(x.volumeM3>0)add(fluidId,kind,name,i,x.volumeM3,x.rateLps);});
 };
 s.buffers.forEach((f,i)=>modes(bIds[i],'buffer',f.name,f.flowRateSteps,f.volume));
 s.slurries.forEach((f,i)=>modes(cIds[i],'cement',f.name,f.flowRateSteps,slurryDesignVolume(w,s.slurries,i)));
 if(s.flushTimeMin>0||s.flushVolumeM3>0)add(service,'surfaceFlush','Промывка ЛВД',0,s.flushVolumeM3,s.flushTimeMin>0?s.flushVolumeM3/(s.flushTimeMin*.06):0,1,s.flushTimeMin);
 const computedTarget=calculateVolumes(w,s.slurries,s.displacementFluids[0]?.compressionCoeff??1).displacementVolumeWithCompression;
 const target=displacementTarget??computedTarget;
 if(displacementTarget!==undefined&&Math.abs(target-computedTarget)>1e-6)issues.push({severity:'warning',code:'EXTERNAL_DISPLACEMENT_TARGET',message:`Переданная цель продавки ${target.toFixed(3)} м³ отличается от ${computedTarget.toFixed(3)} м³ по текущим исходным данным. Проверьте коэффициент сжатия и источник объёма.`});
 if(!Number.isFinite(target)||target<0)issues.push({severity:'error',code:'INVALID_TARGET',message:'Недопустимый расчётный объём продавки.'});
 const displacement=buildDisplacementSchedule(s.displacementFluids,Number.isFinite(target)?target:0),fallback=displacement.find(d=>d.rateLps>0)?.rateLps??5;
 displacement.forEach(d=>{if(d.volumeM3>0)add(dIds[d.fluidIndex],'displacement',d.name,d.stepIndex,d.volumeM3,d.rateLps>0?d.rateLps:fallback,d.compressionCoeff,undefined,!(d.rateLps>0),d.rateLps);});
 if(target>0&&!displacement.length)issues.push({severity:'error',code:'NO_DISPLACEMENT',message:'Не задана продавочная жидкость при положительном расчётном объёме продавки.'});
 let wellVolumeM3=0,surfaceVolumeM3=0,wellMassKg=0,surfaceMassKg=0;
 for(const st of stages){if(st.destination==='well'){wellVolumeM3+=st.volumeM3;wellMassKg+=st.volumeM3*(fluids.find(f=>f.id===st.fluidId)?.densityKgM3??0);}else{surfaceVolumeM3+=st.volumeM3;surfaceMassKg+=st.volumeM3*1000;}}
 const integrated=stages.filter(st=>st.destination==='well'&&st.durationMin!==null).reduce((n,st)=>n+st.rateLps*.06*st.durationMin!,0);
 const integratedMass=stages.filter(st=>st.destination==='well'&&st.durationMin!==null).reduce((n,st)=>n+st.rateLps*.06*st.durationMin!*(fluids.find(f=>f.id===st.fluidId)?.densityKgM3??0),0);
 const events:ProcessContract['events']=[{id:'start',kind:'start',timeMin:0}];
 for(const st of stages)events.push({id:st.id+'/start',kind:'stageStart',timeMin:st.startMin,stageId:st.id,fluidId:st.fluidId},{id:st.id+'/end',kind:'stageEnd',timeMin:st.endMin,stageId:st.id,fluidId:st.fluidId});
 events.push({id:'plannedStop',kind:'stop',timeMin:time});
 let hash=2166136261;for(const c of JSON.stringify([s,target])){hash^=c.charCodeAt(0);hash=Math.imul(hash,16777619);}
 return {version:1,inputKey:`process-v1-${(hash>>>0).toString(16)}`,fluids,stages,events,issues,canRun:!issues.some(x=>x.severity==='error'),totalTimeMin:time,wellVolumeM3,surfaceVolumeM3,wellMassKg,surfaceMassKg,displacementTargetM3:target,volumeResidualM3:integrated-wellVolumeM3,massResidualKg:integratedMass-wellMassKg};
}
export function processContractCsv(c:ProcessContract){const q=(v:unknown)=>'"'+String(v??'').replace(/"/g,'""')+'"';return 'stage_id;fluid_id;destination;name;volume_m3;rate_lps;start_min;end_min;mass_kg\n'+c.stages.map(s=>[s.id,s.fluidId,s.destination,s.name,s.volumeM3,s.rateLps,s.startMin,s.endMin,s.volumeM3*(s.destination==='surface'?1000:c.fluids.find(f=>f.id===s.fluidId)?.densityKgM3??0)].map(q).join(';')).join('\n');}
