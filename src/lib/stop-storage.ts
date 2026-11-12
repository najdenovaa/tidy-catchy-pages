import {normalizeMovingPlugCase,type MovingPlugCase} from './moving-plug';
import type {WellData,PressurePoint,AnnularFluidType} from './cementing-calculations';
import {totalPipeVolumeForRange} from './cementing-calculations';
import type {ProcessFluid} from './cementing-process';
export interface StopStorageSettings {
 plugStudyEnabled?:boolean; plugCoupledEnabled?:boolean; plugHydraulicsEnabled?:boolean; plugViscosityMpas?:number;
 plugAleEnabled?:boolean; plugAleCells?:number; plugAleSwitchSec?:number;
 plugBenchEnabled?:boolean; plugBenchCase?:MovingPlugCase;
 flowMeshRefinement?:number;
 flowCheckValve?:boolean; flowValveCrackMPa?:number; flowClosureEnabled?:boolean; flowClosureTimeMin?:number;
 flowEnabled?:boolean; flowCellLengthM?:number; flowStepSeconds?:number;
 hydrostaticsEnabled?:boolean; referencePressureMPa?:number; surfaceBackpressureMPa?:number;
 enabled:boolean; pressureRiseMPa:number; rateLps:number;
 youngModulusMPa:number; poissonRatio:number; restraint:'fixedLength'|'closedEnds';
 bulkModuliMPa:Partial<Record<AnnularFluidType,number>>; source:string;
}
export interface StoragePoint {pressureRiseMPa:number; injectedReferenceM3:number; fluidCompressionReferenceM3:number; steelExpansionReferenceM3:number; timeMin:number; capacityM3:number; liquidVolumeM3:number; residualM3:number; residualKg:number}
export interface StopStorageResult {
 status:'ready'|'unavailable'; issues:string[]; settings:StopStorageSettings; model:'post-plug-incremental-v1';
 baselineCapacityM3:number; steelComplianceM3PerMPa:number; pumpDensityKgM3:number;
 fluids:{fluidId:string;name:string;volumeM3:number;bulkModulusMPa:number;densityKgM3:number}[];
 curve:StoragePoint[]; limitations:string[];
}
/** Preserve incomplete/invalid enabled settings for visible diagnostics, never invent a fluid modulus. */
export function normalizeStopStorage(value:unknown):StopStorageSettings|undefined{
 if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
 const s=value as Record<string,unknown>,b=s.bulkModuliMPa&&typeof s.bulkModuliMPa==='object'?s.bulkModuliMPa as Record<string,unknown>:{};
 const n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:0;
 return {...(typeof s.plugStudyEnabled==='boolean'?{plugStudyEnabled:s.plugStudyEnabled}:{}),...(typeof s.plugCoupledEnabled==='boolean'?{plugCoupledEnabled:s.plugCoupledEnabled}:{}),...(typeof s.plugHydraulicsEnabled==='boolean'?{plugHydraulicsEnabled:s.plugHydraulicsEnabled}:{}),...(s.plugViscosityMpas!==undefined?{plugViscosityMpas:n(s.plugViscosityMpas)}:{}),...(typeof s.plugAleEnabled==='boolean'?{plugAleEnabled:s.plugAleEnabled}:{}),...(s.plugAleCells!==undefined?{plugAleCells:n(s.plugAleCells)}:{}),...(s.plugAleSwitchSec!==undefined?{plugAleSwitchSec:typeof s.plugAleSwitchSec==='number'&&Number.isFinite(s.plugAleSwitchSec)?s.plugAleSwitchSec:-1}:{}),...(typeof s.plugBenchEnabled==='boolean'?{plugBenchEnabled:s.plugBenchEnabled}:{}),...(s.plugBenchCase!==undefined?{plugBenchCase:normalizeMovingPlugCase(s.plugBenchCase)}:{}),...(s.flowMeshRefinement!==undefined?{flowMeshRefinement:n(s.flowMeshRefinement)}:{}),...(typeof s.flowCheckValve==='boolean'?{flowCheckValve:s.flowCheckValve}:{}),...(typeof s.flowClosureEnabled==='boolean'?{flowClosureEnabled:s.flowClosureEnabled}:{}),...(s.flowValveCrackMPa!==undefined?{flowValveCrackMPa:typeof s.flowValveCrackMPa==='number'&&Number.isFinite(s.flowValveCrackMPa)?s.flowValveCrackMPa:-1}:{}),...(s.flowClosureTimeMin!==undefined?{flowClosureTimeMin:typeof s.flowClosureTimeMin==='number'&&Number.isFinite(s.flowClosureTimeMin)?s.flowClosureTimeMin:-1}:{}),...(typeof s.flowEnabled==='boolean'?{flowEnabled:s.flowEnabled}:{}),...(s.flowCellLengthM!==undefined?{flowCellLengthM:n(s.flowCellLengthM)}:{}),...(s.flowStepSeconds!==undefined?{flowStepSeconds:n(s.flowStepSeconds)}:{}),...(typeof s.hydrostaticsEnabled==='boolean'?{hydrostaticsEnabled:s.hydrostaticsEnabled}:{}),...(s.referencePressureMPa!==undefined?{referencePressureMPa:typeof s.referencePressureMPa==='number'&&Number.isFinite(s.referencePressureMPa)?s.referencePressureMPa:-1}:{}),...(s.surfaceBackpressureMPa!==undefined?{surfaceBackpressureMPa:typeof s.surfaceBackpressureMPa==='number'&&Number.isFinite(s.surfaceBackpressureMPa)?s.surfaceBackpressureMPa:-1}:{}),enabled:s.enabled===true,pressureRiseMPa:n(s.pressureRiseMPa),rateLps:n(s.rateLps),youngModulusMPa:n(s.youngModulusMPa),poissonRatio:n(s.poissonRatio),restraint:s.restraint==='closedEnds'?'closedEnds':'fixedLength',bulkModuliMPa:Object.fromEntries(['mud','buffer','cement','displacement'].filter(k=>b[k]!==undefined).map(k=>[k,n(b[k])])),source:typeof s.source==='string'?s.source.slice(0,2000):''};
}
/** Incremental Lamé volume compliance; pressure increments are internal only, units MPa. */
export function steelVolumeCompliance(volumeM3:number,odMm:number,wallMm:number,eMPa:number,nu:number,restraint:StopStorageSettings['restraint']){
 const a=odMm/2-wallMm,b=odMm/2;
 if(![volumeM3,odMm,wallMm,eMPa,nu].every(Number.isFinite)||volumeM3<0||a<=0||wallMm<=0||eMPa<=0||nu<0||nu>=.5)throw new Error('Недопустимая геометрия или упругость колонны');
 const factor=restraint==='fixedLength'?2*(1+nu)*((1-2*nu)*a*a+b*b):(3*(1-2*nu)*a*a+2*(1+nu)*b*b);
 return volumeM3*factor/(eMPa*(b*b-a*a));
}
export function evaluateStopStorage(w:WellData,columns:PressurePoint['transportColumns'],fluids:ProcessFluid[],pumpFluidId:string|undefined,landed:boolean):StopStorageResult|undefined{
 const settings=normalizeStopStorage(w.stopStorage);if(!settings?.enabled)return undefined;
 const issues:string[]=[];
 const result:StopStorageResult={status:'unavailable',issues,settings,model:'post-plug-incremental-v1',baselineCapacityM3:0,steelComplianceM3PerMPa:0,pumpDensityKgM3:0,fluids:[],curve:[],limitations:[
  'Отдельная фаза после посадки герметичной пробки. Прирост давления отсчитывается от установившегося состояния; абсолютное давление и допустимый предел здесь не определяются.',
  'Изотермическая жидкость с постоянным K: V(P)/V(0)=exp(-ΔP/K). Плотности заданы в исходном состоянии этой фазы. Газ, пена, утечки и температурные изменения не учитываются.',
  'Линейная упругость Ламе. Внешнее давление при нагружении не меняется; цементная поддержка, соединения, наземные линии и податливость оборудования не учтены.',
  'Дополнительная подача не проходит через пробку, не увеличивает замещение в затрубье и не включена в основной баланс до Стоп. Полный сброс прироста давления возвращает расчётный накопленный объём только при обратимой герметичной системе.',
  'Расчёт не подтверждает прочность колонны, ПВО или оснастки. Проверка полного напряжённого состояния и допустимого давления выполняется отдельно.'
 ]};
 if(!landed)issues.push('Геометрическая посадка пробки на ЦКОД не достигнута.');
 if(!columns)issues.push('Нет актуального распределения жидкостей.');
 if(!(w.ckodDepth>0&&w.ckodDepth<=w.casingDepthMD))issues.push('Недопустимая глубина ЦКОД.');
 if(!(settings.pressureRiseMPa>=0&&settings.rateLps>0&&settings.youngModulusMPa>0&&settings.poissonRatio>=0&&settings.poissonRatio<.5))issues.push('Укажите корректные ΔP, расход, E и коэффициент Пуассона.');
 const lookup=new Map(fluids.map(f=>[f.id,f]));const mud=fluids.find(f=>f.kind==='mud');if(mud)lookup.set('mud:initial',mud);
 let capacity=0;
 for(const b of columns?.pipe??[]){
  const top=Math.max(0,b.topMD),bot=Math.min(w.ckodDepth,b.botMD);if(bot<=top)continue;
  if(b.fluidType==='void'){issues.push('В трубе над пробкой есть незаполненный объём; газовая фаза не поддержана.');continue;}
  const volumeM3=totalPipeVolumeForRange(top,bot,w.casingOD,w.casingWall,w.casingSections),f=lookup.get(b.fluidId),k=settings.bulkModuliMPa[b.fluidType];capacity+=volumeM3;
  if(!(k>0))issues.push('Не задан положительный модуль K для жидкости: '+(f?.name??b.fluidType)+'.');
  if(!(f?.densityKgM3>0))issues.push('Не задана плотность жидкости: '+b.fluidId+'.');
  result.fluids.push({fluidId:b.fluidId,name:f?.name??b.fluidId,volumeM3,bulkModulusMPa:k??0,densityKgM3:f?.densityKgM3??0});
 }
 const pump=lookup.get(pumpFluidId??''),pumpK=pump&&pump.kind!=='serviceWater'?settings.bulkModuliMPa[pump.kind]:0;
 if(!(pumpK>0&&pump?.densityKgM3>0))issues.push('Не определены K и плотность жидкости дополнительной подачи.');
 if(!(capacity>0))issues.push('Нет положительного объёма жидкости над пробкой.');
 result.baselineCapacityM3=capacity;result.pumpDensityKgM3=pump?.densityKgM3??0;
 if(issues.length)return result;
 const cuts=[...new Set([0,w.ckodDepth,...(w.casingSections??[]).flatMap(s=>[s.fromMD,s.toMD]).filter(md=>md>0&&md<w.ckodDepth)])].sort((a,b)=>a-b);
 let compliance=0;
 try{for(let i=1;i<cuts.length;i++){
  const top=cuts[i-1],bot=cuts[i],mid=(top+bot)/2;
  const wall=[...(w.casingSections??[])].sort((a,b)=>a.fromMD-b.fromMD).find(s=>mid>=s.fromMD&&mid<s.toMD)?.wallThickness??w.casingWall;
  compliance+=steelVolumeCompliance(totalPipeVolumeForRange(top,bot,w.casingOD,w.casingWall,w.casingSections),w.casingOD,wall,settings.youngModulusMPa,settings.poissonRatio,settings.restraint);
 }}catch{issues.push('Некорректная геометрия секций колонны.');return result;}
 result.steelComplianceM3PerMPa=compliance;
 const minK=Math.min(pumpK,...result.fluids.map(f=>f.bulkModulusMPa));
 if(settings.pressureRiseMPa/minK>.05||compliance*settings.pressureRiseMPa/capacity>.01){issues.push('Превышена область малых приращений: ΔP/K > 5% или расширение вместимости > 1%.');return result;}
 for(let i=0;i<=20;i++){
  const dp=settings.pressureRiseMPa*i/20,expPump=Math.exp(dp/pumpK);
  const compressed=result.fluids.reduce((n,f)=>n+f.volumeM3*Math.exp(-dp/f.bulkModulusMPa),0);
  const freed=result.fluids.reduce((n,f)=>n+f.volumeM3*(-Math.expm1(-dp/f.bulkModulusMPa)),0);
  const steel=compliance*dp,fluidCompressionReferenceM3=freed*expPump,steelExpansionReferenceM3=steel*expPump;
  const injectedReferenceM3=fluidCompressionReferenceM3+steelExpansionReferenceM3,capacityM3=capacity+steel,liquidVolumeM3=compressed+injectedReferenceM3/expPump;
  const initialMass=result.fluids.reduce((n,f)=>n+f.volumeM3*f.densityKgM3,0),finalMass=result.fluids.reduce((n,f)=>n+f.volumeM3*Math.exp(-dp/f.bulkModulusMPa)*f.densityKgM3*Math.exp(dp/f.bulkModulusMPa),0)+injectedReferenceM3/expPump*pump.densityKgM3*expPump;
  result.curve.push({pressureRiseMPa:dp,injectedReferenceM3,fluidCompressionReferenceM3,steelExpansionReferenceM3,timeMin:injectedReferenceM3/(settings.rateLps*.06),capacityM3,liquidVolumeM3,residualM3:liquidVolumeM3-capacityM3,residualKg:finalMass-initialMass-injectedReferenceM3*pump.densityKgM3});
 }
 result.status='ready';return result;
}
export function stopStorageCsv(r:StopStorageResult){return 'delta_p_mpa;additional_reference_m3;fluid_reference_m3;steel_reference_m3;time_min;volume_residual_m3;mass_residual_kg\n'+r.curve.map(p=>[p.pressureRiseMPa,p.injectedReferenceM3,p.fluidCompressionReferenceM3,p.steelExpansionReferenceM3,p.timeMin,p.residualM3,p.residualKg].join(';')).join('\n');}
