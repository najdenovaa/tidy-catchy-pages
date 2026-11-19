import type { Rheology, WellData } from './cementing-calculations';
import type { TurbulatorPoint } from './centralization-calculations';
import { hbFriction, rheologyResolution, type HBParams } from './cement-rheology';
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
export const TURBULATOR_MODEL_NOTE = 'Оценочная модель: отклонение потока рёбрами и конвективно-вязкое затухание. Коэффициент передачи закрутки требует стендовой калибровки; это не CFD и не подтверждение турбулентного режима. L считается до заданного порога vθ/vz. Температура учитывается только через выбранную лабораторную реологию, без скрытой температурной поправки.';
export const defaultTurbulatorDesign = (): TurbulatorDesign => ({points:[],fluidId:'mud',rateLps:null,threshold:.01,turningEfficiency:.5});
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function normalizeTurbulatorDesign(v: unknown): TurbulatorDesign | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const d=v as Partial<TurbulatorDesign>, base=defaultTurbulatorDesign();
  return {...base,fluidId:typeof d.fluidId==='string'?d.fluidId:'mud',
    rateLps:d.rateLps===null?null:finite(d.rateLps)&&d.rateLps>=0?d.rateLps:null,
    threshold:finite(d.threshold)&&d.threshold>0&&d.threshold<1?d.threshold:base.threshold,
    turningEfficiency:finite(d.turningEfficiency)&&d.turningEfficiency>=0&&d.turningEfficiency<=1?d.turningEfficiency:base.turningEfficiency,
    // Preserve bad engineering values for visible validation; drop malformed records only.
    points:Array.isArray(d.points)?d.points.filter(p=>p&&typeof p.id==='string'&&[p.md,p.bladesCount,p.bladeAngle,p.bladeHeight].every(finite)).slice(0,2000):[]};
}
export interface TurbulatorHydraulicFluid { density: number; pv: number; yp: number; hb?: HBParams; }
export interface SwirlSample { md: number; distanceM: number; axialMs: number; tangentialMs: number; ratio: number; phase: number; boreMm: number; }
export interface TurbulatorFlowResult {
  point: TurbulatorPoint; valid: boolean; issues: string[]; samples: SwirlSample[];
  axialMs: number; tangentialMs: number; ratio: number; reynolds: number; regime: number;
  lengthM: number; reachedThreshold: boolean; pressureLossMPa: number; boreMm: number;
  standoffPct: number;
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
  const shear=gap>0?Math.max(1e-9,6*u/gap):1e-9;
  const mu=hb.tau0/shear+hb.K*shear**(hb.n-1);
  // First transverse diffusion mode of a no-slip gap, convected with mean axial velocity.
  // Excentricity accelerates dissipation; this closure is explicitly an engineering estimate.
  const e=1-Math.max(0,Math.min(100,turbulatorStandoff(w,md)))/100;
  const alpha=gap>0&&u>0?Math.PI**2*mu/f.density/(gap*gap*u)*(1+e*e):0;
  return {bore,gap,area,u,alpha,...friction};
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
export function turbulatorOutlet(w:WellData,p:TurbulatorPoint,q:number,f:TurbulatorHydraulicFluid,efficiency=.5){
  const a=flowAt(w,p.md,q,f),engagement=a.gap>0?Math.min(1,p.bladeHeight/1000/a.gap):0;
  const radius=w.casingOD/2000, thickness=(p.sleeveThicknessMm??3)/1000;
  const width=(p.bladeWidthMm??8)/1000;
  const coverage=Math.min(.9,p.bladesCount*width/(2*Math.PI*Math.max(1e-6,radius+thickness)));
  const sleeveArea=Math.PI*((radius+thickness)**2-radius**2);
  const ribArea=p.bladesCount*width*Math.max(0,p.bladeHeight/1000-thickness);
  const blockage=a.area>0?Math.min(.95,(sleeveArea+ribArea)/a.area):0;
  const ratio=efficiency*engagement*coverage*Math.tan(p.bladeAngle*Math.PI/180);
  const k=(1/Math.max(.1,1-blockage)-1)**2+ratio**2;
  return {...a,ratio,tangentialMs:a.u*ratio,pressureLossMPa:q>0?k*f.density*a.u*a.u/2/1e6:0};
}
export function calculateTurbulatorFlow(w:WellData,p:TurbulatorPoint,q:number,fluid:TurbulatorFluid,settings:Pick<TurbulatorDesign,'threshold'|'turningEfficiency'>=defaultTurbulatorDesign()):TurbulatorFlowResult{
  const out:TurbulatorFlowResult={point:p,valid:false,issues:turbulatorGeometryErrors(w,p),samples:[],axialMs:0,tangentialMs:0,ratio:0,reynolds:0,regime:0,lengthM:0,reachedThreshold:false,pressureLossMPa:0,boreMm:boreDiameterAtDepth(w,p.md),standoffPct:turbulatorStandoff(w,p.md)};
  if(!finite(q)||q<0||!finite(fluid.density)||fluid.density<=0)out.issues.push('Расход должен быть ≥ 0, плотность > 0.');
  if(!(settings.threshold>0&&settings.threshold<1&&settings.turningEfficiency>=0&&settings.turningEfficiency<=1))out.issues.push('Проверьте порог и коэффициент передачи закрутки.');
  let f:TurbulatorHydraulicFluid;
  try{f=turbulatorFluidProperties(fluid);}catch(e){out.issues.push(e instanceof Error?e.message:String(e));return out;}
  if(out.issues.length)return out;
  const inlet=turbulatorOutlet(w,p,q,f,settings.turningEfficiency);
  Object.assign(out,{valid:true,axialMs:inlet.u,tangentialMs:inlet.tangentialMs,ratio:inlet.ratio,reynolds:inlet.reynolds,regime:inlet.regime,pressureLossMPa:inlet.pressureLossMPa});
  if(q===0||inlet.ratio<=settings.threshold){out.reachedThreshold=true;return out;}
  // Integrate UPWARD only. Exact cell boundaries; no ±3 m zone and no propagation below the device.
  const cells=createAnnularGeometry(w,w.casingDepthMD).cells;
  let md=p.md,v=inlet.tangentialMs,phase=0;
  out.samples.push({md,distanceM:0,axialMs:inlet.u,tangentialMs:v,ratio:inlet.ratio,phase,boreMm:inlet.bore});
  for(let count=0;md>0&&count<3000;count++){
    const cell=cells.find(c=>md>c.topMD+1e-9&&md<=c.bottomMD+1e-9);
    const a=flowAt(w,Math.max(0,md-1e-7),q,f);
    if(a.gap<=0){out.valid=false;out.issues.push('Выше изделия затрубье перекрыто.');break;}
    const boundary=cell?.topMD??0;
    let step=Math.min(md-boundary,Math.max(.02,(a.alpha>0?1/a.alpha:100)/25));
    if(step<1e-8){md=Math.max(0,md-1e-7);continue;}
    const stop=a.alpha>0?Math.log(v/(settings.threshold*a.u))/a.alpha:Infinity;
    if(stop<=step){step=Math.max(0,stop);out.reachedThreshold=true;}
    const next=v*Math.exp(-a.alpha*step),radius=(w.casingOD+a.bore)/4000;
    phase+=a.alpha>0?(v-next)/(a.alpha*a.u*radius):v*step/(a.u*radius);
    md-=step;v=next;
    out.samples.push({md,distanceM:p.md-md,axialMs:a.u,tangentialMs:v,ratio:v/a.u,phase,boreMm:a.bore});
    if(out.reachedThreshold)break;
  }
  out.lengthM=p.md-md;
  if(!out.reachedThreshold)out.issues.push(md<=0?'Закрутка достигает устья выше порога; длина ограничена устьем.':'Достигнут предел интегрирования; длина показана как нижняя оценка.');
  return out;
}
/** Estimate local pressure loss for each device once, assigning fluid by MD intervals (top, bottom]. */
const lossCache=new WeakMap<WellData,{md:number;unitLoss:number}[]>();
export function turbulatorLossBetween(w:WellData,top:number,bottom:number,q:number,f:TurbulatorHydraulicFluid):number{
  if(!(q>0&&bottom>top))return 0;
  let tools=lossCache.get(w);
  if(!tools){const design=w.turbulatorDesign;tools=(design?.points??[]).filter(p=>turbulatorGeometryErrors(w,p).length===0).map(p=>({md:p.md,unitLoss:turbulatorOutlet(w,p,1,{density:1,pv:25,yp:0},design?.turningEfficiency).pressureLossMPa}));lossCache.set(w,tools);}
  return tools.reduce((sum,p)=>p.md>top&&p.md<=bottom?sum+p.unitLoss*f.density*q*q:sum,0);
}
export function swirlRatioAt(result:TurbulatorFlowResult,md:number):number{
  if(!result.valid||md>result.point.md||!result.samples.length)return 0;
  const s=result.samples;if(md<s[s.length-1].md)return 0;
  for(let i=1;i<s.length;i++)if(md>=s[i].md){const t=(s[i-1].md-md)/(s[i-1].md-s[i].md||1);return s[i-1].ratio+(s[i].ratio-s[i-1].ratio)*t;}
  return s[0].ratio;
}

/** Fast field evaluated at a target MD, using exact constant-diameter cells. Same diffusion closure as profile. */
export function turbulatorVelocityAt(w:WellData,p:TurbulatorPoint,md:number,q:number,f:TurbulatorHydraulicFluid,design:TurbulatorDesign):number{
  if(q<=0||md>p.md||md<0||turbulatorGeometryErrors(w,p).length)return 0;
  let v=turbulatorOutlet(w,p,q,f,design.turningEfficiency).tangentialMs;
  const cells=createAnnularGeometry(w,w.casingDepthMD).cells;
  for(let i=cells.length-1;i>=0;i--){const c=cells[i],a=Math.max(md,c.topMD),b=Math.min(p.md,c.bottomMD);if(b<=a)continue;const local=flowAt(w,(a+b)/2,q,f);v*=Math.exp(-local.alpha*(b-a));}
  const u=flowAt(w,md,q,f).u;
  return u>0&&v/u>=design.threshold?v:0;
}

/** Reuse the actual computed pipe eccentricity, not a second geometry input in the inspector. */
export function turbulatorWellForResults(w:WellData,results:{md:number;standoff:number}[]|null):WellData{
  return results?.length?{...w,standoffProfile:results.map(r=>({md:r.md,standoffPct:r.standoff}))}:w;
}
