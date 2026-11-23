import {normalizeHardwareIdentity} from './optimizer-hardware-identity';
import {generateSwirl,advanceSwirl,remapSwirl,swirlStats,swirlStepSize,SWIRL_RESIDUAL,type SwirlState} from './swirl-transport';
import type { Rheology, WellData } from './cementing-calculations';
import type { TurbulatorPoint } from './centralization-calculations';
import { hbFriction, hbRegimeBounds, rheologyResolution, type HBParams } from './cement-rheology';
import { boreDiameterAtDepth, createAnnularGeometry } from './well-geometry';

export interface TurbulatorFluid { id: string; name: string; density: number; rheology: Rheology; rateLps?: number; }
export interface TurbulatorDesign {
  points: TurbulatorPoint[];
  fluidId: string;
  /** null follows the selected program stage; 0 is a stopped pump. */
  rateLps: number | null;
  threshold: number;
  turningEfficiency: number;
}
export const TURBULATOR_MODEL_NOTE = 'Численная осесимметричная модель переноса вращательного момента: давление на лопастях, конечная длина изделия, вязкое и турбулентное трение на неподвижных стенках. Реология — из выбранной жидкости. Показаны скорости и их затухание без усиления изображения. Практическое затухание — потеря 99,9% вращательного момента; точный ноль в вязкой модели асимптотический. Модель использует усреднённую осевую скорость и идеализированное давление на лопасти; требует проверки для конкретного изделия, не является 3D CFD.';
export const defaultTurbulatorDesign = (): TurbulatorDesign => ({points:[],fluidId:'mud',rateLps:null,threshold:SWIRL_RESIDUAL,turningEfficiency:1});
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function normalizeTurbulatorDesign(v: unknown): TurbulatorDesign | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const d=v as Partial<TurbulatorDesign>, base=defaultTurbulatorDesign();
  return {...base,fluidId:typeof d.fluidId==='string'?d.fluidId:'mud',
    rateLps:d.rateLps===null?null:finite(d.rateLps)&&d.rateLps>=0?d.rateLps:null,
    threshold:base.threshold,
    turningEfficiency:base.turningEfficiency,
    // Preserve bad engineering values for visible validation; drop malformed records only.
    points:Array.isArray(d.points)?d.points.filter(p=>p&&typeof p.id==='string'&&[p.md,p.bladesCount,p.bladeAngle,p.bladeHeight].every(finite)).slice(0,2000).map(p=>({...p,catalog:normalizeHardwareIdentity(p.catalog)})):[]};
}
export interface TurbulatorHydraulicFluid { density: number; pv: number; yp: number; hb?: HBParams; }
export interface SwirlSample { md: number; distanceM: number; axialMs: number; tangentialMs: number; ratio: number; phase: number; boreMm: number; profile?:SwirlState; remainingFraction?:number; }
export interface TurbulatorFlowResult {
  point: TurbulatorPoint; valid: boolean; issues: string[]; samples: SwirlSample[];
  axialMs: number; tangentialMs: number; ratio: number; reynolds: number; regime: number;
  lengthM: number; reachedThreshold: boolean; pressureLossMPa: number; boreMm: number;
  standoffPct: number;
  vaneProfiles?:{z:number;state:SwirlState}[]; outletProfile?:SwirlState;
  decay90M?:number; decay99M?:number; decay999M?:number; residualFraction?:number;
}
export function turbulatorFluidProperties(fluid:TurbulatorFluid):TurbulatorHydraulicFluid {
  const r=rheologyResolution(fluid.rheology);
  if(!r.valid)throw new Error(r.error);
  if(!r.params&&!(fluid.rheology.pv>0&&fluid.rheology.yp>=0))throw new Error('Для расчёта нужны PV > 0 и YP ≥ 0 либо корректные показания Fann.');
  return {density:fluid.density,pv:fluid.rheology.pv,yp:fluid.rheology.yp,hb:r.params};
}
export function turbulatorStandoff(w:WellData,md:number) {
  const p=w.standoffProfile?.slice().sort((a,b)=>a.md-b.md);
  if(!p?.length)return Math.max(0,Math.min(100,w.annularStandoffPct??67));
  if(md<=p[0].md)return p[0].standoffPct;
  for(let i=1;i<p.length;i++)if(md<=p[i].md)return p[i-1].standoffPct+(p[i].standoffPct-p[i-1].standoffPct)*(md-p[i-1].md)/(p[i].md-p[i-1].md);
  return p[p.length-1].standoffPct;
}
function flowAt(w:WellData,md:number,q:number,f:TurbulatorHydraulicFluid){
  const bore=boreDiameterAtDepth(w,md),gap=(bore-w.casingOD)/2000;
  const area=Math.PI/4*((bore/1000)**2-(w.casingOD/1000)**2),u=area>0?q/1000/area:0;
  const hb=f.hb??{tau0:f.yp,K:f.pv/1000,n:1};
  const friction=hbFriction(hb,u,2*gap,1,f.density,'annulus');
  return {bore,gap,area,u,...friction};
}
export function turbulatorGeometryErrors(w:WellData,p:TurbulatorPoint):string[]{
  const errors:string[]=[];
  if((p.lengthMm!==undefined&&(!finite(p.lengthMm)||p.lengthMm<=0))||(p.bladeWidthMm!==undefined&&(!finite(p.bladeWidthMm)||p.bladeWidthMm<=0))||(!finite(p.sleeveThicknessMm??3)||(p.sleeveThicknessMm??3)<0||(p.sleeveThicknessMm??3)>p.bladeHeight))errors.push('Проверьте длину, ширину ребра и толщину втулки.');
  if(![p.md,p.bladesCount,p.bladeAngle,p.bladeHeight].every(finite)||p.md<0||p.md>w.casingDepthMD)errors.push('Глубина установки вне колонны или некорректные данные.');
  if(!Number.isInteger(p.bladesCount)||p.bladesCount<1||p.bladesCount>24)errors.push('Число рёбер: целое от 1 до 24.');
  if(p.bladeAngle<0||p.bladeAngle>75||p.bladeHeight<0)errors.push('Угол 0–75°, высота неотрицательная.');
  const gap=(boreDiameterAtDepth(w,p.md)-w.casingOD)/2;
  if(gap<=0||p.bladeHeight>=gap)errors.push('Наружный диаметр изделия не проходит в местный ствол.');
  // Near-wall offset must not intersect rigid rib tips. No silent recentering of a rigid sleeve.
  if(p.bladeHeight>gap*Math.max(0,Math.min(100,turbulatorStandoff(w,p.md)))/100+1e-7)errors.push('Рёбра пересекают стенку при текущем Standoff. Уточните центрирование в точке.');
  return errors;
}
/** Local loss and initial turning use the SAME explicit closure in the inspector and main hydraulics. */
const vaneCache=new Map<string,ReturnType<typeof generateSwirl>>();
const uniformWakeCache=new Map<string,TurbulatorFlowResult>();
export function turbulatorOutlet(w:WellData,p:TurbulatorPoint,q:number,f:TurbulatorHydraulicFluid,_legacyEfficiency?:number){
  const a=flowAt(w,p.md,q,f),hb=f.hb??{tau0:f.yp,K:f.pv/1000,n:1};
  const section={innerM:w.casingOD/2000,outerM:a.bore/2000};
  const blade={count:p.bladesCount,angleDeg:p.bladeAngle,heightM:p.bladeHeight/1000,widthM:(p.bladeWidthMm??8)/1000,lengthM:(p.lengthMm??180)/1000,sleeveM:(p.sleeveThicknessMm??3)/1000};
  const key=JSON.stringify([section,blade,q,f.density,hb]);
  let generated=vaneCache.get(key);
  if(!generated){generated=generateSwirl(section,blade,q/1000,{density:f.density,hb});if(vaneCache.size>512)vaneCache.delete(vaneCache.keys().next().value!);vaneCache.set(key,generated);}
  const stats=swirlStats(generated.state,q/1000),ratio=a.u>0?stats.meanMs/a.u:0;
  const sleeveArea=Math.PI*((section.innerM+blade.sleeveM)**2-section.innerM**2);
  const ribArea=blade.count*blade.widthM*Math.max(0,blade.heightM-blade.sleeveM);
  const blockage=a.area>0?Math.min(.95,(sleeveArea+ribArea)/a.area):0;
  const k=(1/Math.max(.1,1-blockage)-1)**2;
  return {...a,ratio,tangentialMs:stats.meanMs,pressureLossMPa:q>0?f.density*(k*a.u*a.u+stats.rmsMs**2)/2/1e6:0,state:generated.state,vaneProfiles:generated.profiles,stats};
}
export function calculateTurbulatorFlow(w:WellData,p:TurbulatorPoint,q:number,fluid:TurbulatorFluid,_legacySettings:Pick<TurbulatorDesign,'threshold'|'turningEfficiency'>=defaultTurbulatorDesign(),resolvedProperties?:TurbulatorHydraulicFluid):TurbulatorFlowResult{
  const out:TurbulatorFlowResult={point:p,valid:false,issues:turbulatorGeometryErrors(w,p),samples:[],axialMs:0,tangentialMs:0,ratio:0,reynolds:0,regime:0,lengthM:0,reachedThreshold:false,pressureLossMPa:0,boreMm:boreDiameterAtDepth(w,p.md),standoffPct:turbulatorStandoff(w,p.md)};
  if(!finite(q)||q<0||!finite(fluid.density)||fluid.density<=0)out.issues.push('Расход должен быть ≥ 0, плотность > 0.');
  let f:TurbulatorHydraulicFluid;
  try{f=resolvedProperties??turbulatorFluidProperties(fluid);}catch(e){out.issues.push(e instanceof Error?e.message:String(e));return out;}
  if(out.issues.length)return out;
  const inlet=turbulatorOutlet(w,p,q,f),hydraulic={density:f.density,hb:f.hb??{tau0:f.yp,K:f.pv/1000,n:1}};
  Object.assign(out,{valid:true,axialMs:inlet.u,tangentialMs:inlet.tangentialMs,ratio:inlet.ratio,reynolds:inlet.reynolds,regime:inlet.regime,pressureLossMPa:inlet.pressureLossMPa,outletProfile:inlet.state,vaneProfiles:inlet.vaneProfiles,residualFraction:0});
  if(q===0||inlet.stats.moment<=1e-20){out.reachedThreshold=true;out.decay90M=out.decay99M=out.decay999M=0;return out;}
  const geometry=createAnnularGeometry(w,w.casingDepthMD);
  const firstCell=geometry.at(Math.max(0,p.md-1e-7));
  const wakeKey=JSON.stringify([w.casingOD,inlet.bore,{...p,id:'',md:0},q,f]);
  const cached=uniformWakeCache.get(wakeKey);
  if(cached&&firstCell?.diameterMm===inlet.bore&&cached.lengthM<=p.md-firstCell.topMD)return {...cached,point:p,standoffPct:out.standoffPct,samples:cached.samples.map(s=>({...s,md:p.md-s.distanceM}))};
  let md=p.md,state=inlet.state,phase=0,last=inlet.stats,remaining=1,adaptiveStep:number|undefined;
  out.samples.push({md,distanceM:0,axialMs:inlet.u,tangentialMs:inlet.tangentialMs,ratio:inlet.ratio,phase,boreMm:inlet.bore,profile:state,remainingFraction:1});
  for(let count=0;md>1e-9&&count<4000;count++){
    const cell=geometry.at(Math.max(0,md-1e-7));
    if(!cell||cell.diameterMm<=w.casingOD){out.valid=false;out.issues.push('Выше изделия затрубье перекрыто.');break;}
    const section={innerM:w.casingOD/2000,outerM:cell.diameterMm/2000};
    if(Math.abs(section.outerM-state.outerM)>1e-10){state=remapSwirl(state,section);last=swirlStats(state,q/1000);adaptiveStep=undefined;}
    let step=Math.min(md-cell.topMD,adaptiveStep??swirlStepSize(state,q/1000,hydraulic));
    if(step<1e-10){md=Math.max(0,md-1e-7);continue;}
    let next=advanceSwirl(state,step,q/1000,hydraulic),stats=swirlStats(next,q/1000);
    if(stats.moment/inlet.stats.moment<=SWIRL_RESIDUAL){
      let lo=0,hi=step;
      for(let i=0;i<24;i++){const m=(lo+hi)/2,test=advanceSwirl(state,m,q/1000,hydraulic);if(swirlStats(test,q/1000).moment/inlet.stats.moment>SWIRL_RESIDUAL)lo=m;else hi=m;}
      step=hi;next=advanceSwirl(state,step,q/1000,hydraulic);stats=swirlStats(next,q/1000);out.reachedThreshold=true;
    }
    const newRemaining=stats.moment/inlet.stats.moment,dist=p.md-md;
    const decayRate=Math.log(remaining/Math.max(1e-30,newRemaining))/step;
    adaptiveStep=Math.min(2,step*1.5,decayRate>0?.025/decayRate:step*1.5);
    for(const [fraction,key] of [[.1,'decay90M'],[.01,'decay99M'],[.001,'decay999M']] as const)if(out[key]===undefined&&remaining>=fraction&&newRemaining<=fraction*(1+1e-7))out[key]=dist+step*Math.max(0,Math.min(1,Math.log(remaining/fraction)/Math.max(1e-20,Math.log(remaining/newRemaining))));
    phase+=(last.phaseGradient+stats.phaseGradient)*step/2;
    md-=step;state=next;last=stats;remaining=newRemaining;
    const u=q/1000/(Math.PI*(state.outerM**2-state.innerM**2));
    out.samples.push({md,distanceM:p.md-md,axialMs:u,tangentialMs:stats.meanMs,ratio:stats.meanMs/u,phase,boreMm:cell.diameterMm,profile:state,remainingFraction:remaining});
    if(out.reachedThreshold)break;
  }
  out.lengthM=p.md-md;out.residualFraction=remaining;
  if(!out.reachedThreshold)out.issues.push(md<=1e-9?'Расчёт ограничен устьем; 99,9% затухания до устья не достигнуто.':'Предел интегрирования; показана рассчитанная часть зоны затухания.');
  if(out.valid&&out.reachedThreshold&&firstCell?.diameterMm===inlet.bore&&out.lengthM<=p.md-firstCell.topMD){if(uniformWakeCache.size>128)uniformWakeCache.delete(uniformWakeCache.keys().next().value!);uniformWakeCache.set(wakeKey,out);}
  return out;
}
/** Local loss from the same generated profile; each device is assigned to exactly one fluid segment. */
export function turbulatorLossBetween(w:WellData,top:number,bottom:number,q:number,f:TurbulatorHydraulicFluid):number{
  if(!(q>0&&bottom>top))return 0;
  return (w.turbulatorDesign?.points??[]).reduce((sum,p)=>p.md>top&&p.md<=bottom&&turbulatorGeometryErrors(w,p).length===0?sum+turbulatorOutlet(w,p,q,f).pressureLossMPa:sum,0);
}
export function swirlRatioAt(result:TurbulatorFlowResult,md:number):number{
  if(!result.valid||md>result.point.md||!result.samples.length)return 0;
  const s=result.samples;if(md<s[s.length-1].md)return 0;
  for(let i=1;i<s.length;i++)if(md>=s[i].md){const t=(s[i-1].md-md)/(s[i-1].md-s[i].md||1);return s[i-1].ratio+(s[i].ratio-s[i-1].ratio)*t;}
  return s[0].ratio;
}

/** Fast field evaluated at a target MD, using exact constant-diameter cells. Same diffusion closure as profile. */
const fieldCache=new WeakMap<WellData,Map<string,TurbulatorFlowResult>>();
export function turbulatorVelocityAt(w:WellData,p:TurbulatorPoint,md:number,q:number,f:TurbulatorHydraulicFluid,design:TurbulatorDesign):number{
  if(q<=0||md>p.md||md<0||turbulatorGeometryErrors(w,p).length)return 0;
  let cache=fieldCache.get(w);if(!cache){cache=new Map();fieldCache.set(w,cache);}
  const key=JSON.stringify([p,q,f]),hb=f.hb??{tau0:f.yp,K:f.pv/1000,n:1};
  let result=cache.get(key);
  if(!result){
    const fluid:TurbulatorFluid={id:'field',name:'Жидкость сегмента',density:f.density,rheology:{pv:f.pv,yp:f.yp}};
    result=calculateTurbulatorFlow(w,p,q,fluid,design,{...f,hb});
    result={...result,outletProfile:undefined,vaneProfiles:undefined,samples:result.samples.map(({profile:_,...s})=>s)};
    cache.set(key,result);
  }
  if(!result.valid||!result.samples.length)return 0;
  const s=result.samples;if(md<s[s.length-1].md)return 0;
  for(let i=1;i<s.length;i++)if(md>=s[i].md){const t=(s[i-1].md-md)/(s[i-1].md-s[i].md||1);return s[i-1].tangentialMs+t*(s[i].tangentialMs-s[i-1].tangentialMs);}
  return result.tangentialMs;
}
/** Reuse the actual computed pipe eccentricity, not a second geometry input in the inspector. */
export function turbulatorWellForResults(w:WellData,results:{md:number;standoff:number}[]|null):WellData{
  return results?.length?{...w,standoffProfile:results.map(r=>({md:r.md,standoffPct:r.standoff}))}:w;
}

/** Invert the existing bulk-flow regime criterion at the selected MD. No swirl bonus to Re. */
export function turbulatorRegimeThresholds(w:WellData,md:number,fluid:TurbulatorFluid) {
  const f=turbulatorFluidProperties(fluid);
  if(!Number.isFinite(f.density)||f.density<=0||!Number.isFinite(md)||md<0||md>w.casingDepthMD)throw new Error('Проверьте глубину и плотность жидкости.');
  if(boreDiameterAtDepth(w,md)<=w.casingOD)throw new Error('Нет проходного затрубного сечения.');
  const bounds=hbRegimeBounds(f.hb??{tau0:f.yp,K:f.pv/1000,n:1});
  const searchLimitLps=2000;
  const solve=(target:number):number|null=>{
    let lo=0,hi=1;
    while(hi<searchLimitLps&&flowAt(w,md,hi,f).reynolds<target)hi=Math.min(searchLimitLps,hi*2);
    if(flowAt(w,md,hi,f).reynolds<target)return null;
    for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(flowAt(w,md,mid,f).reynolds<target)lo=mid;else hi=mid;}
    return hi;
  };
  return {transitionLps:solve(bounds.laminar),turbulentLps:solve(bounds.turbulent),reLaminar:bounds.laminar,reTurbulent:bounds.turbulent,searchLimitLps};
}
