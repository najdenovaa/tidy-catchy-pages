import type {DrillingFluid,BufferFluid,SlurryInput,DisplacementFluid} from './cementing-calculations';
export interface LabFraction {fluidId:string;key:string;share:number|null}
export interface MixtureTest {id:string;source:string;temperatureC:number|null;pressureMPaAbs:number|null;fractions:LabFraction[];pvCp:number|null;ypPa:number|null;observation:'unknown'|'no-anomaly'|'anomaly';notes:string}
export interface RemovalTest {removalPct?:number|null;id:string;source:string;temperatureC:number|null;pressureMPaAbs:number|null;cleanerId:string;cleanerKey:string;mudKey:string;fromMD:number|null;toMD:number|null;criticalPa:number|null;exposureS:number|null;notes:string}
export interface FluidInteractionLab {version:1;temperatureC:number|null;pressureMPaAbs:number|null;useMixtures:boolean;mixtures:MixtureTest[];removal:RemovalTest[]}
export interface LabFluid {id:string;name:string;key:string;temperatureC:number|null;pressureMPaAbs:number|null}
export type LabFluidsInput={drillingFluid:DrillingFluid;buffers:BufferFluid[];slurries:SlurryInput[];displacementFluids:DisplacementFluid[]};
export const FLUID_LAB_NOTE='Лабораторные данные привязаны к составам и заданному сценарию T/P. Между двумя измеренными составами одной бинарной пары PV/YP интерполируются линейно, без экстраполяции. Тройные смеси применяются только в измеренной точке. Остальные смешанные ячейки используют базовое осреднение. Это выбранная модель, не автоматический допуск рецептуры; температурного пересчёта нет. На заключительной выдержке используется прежняя типовая модель роста структуры; измеренные смеси там не применяются.';
export const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const record=(x:unknown):Record<string,any>=>x&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,any>:{};
const num=(x:unknown)=>finite(x)?x:null, str=(x:unknown)=>typeof x==='string'?x.slice(0,10000):'';
export function normalizeFluidLab(x:unknown):FluidInteractionLab|undefined{
 if(!x||typeof x!=='object')return undefined;const v=record(x);
 const conditions=(r:Record<string,any>)=>({id:str(r.id),source:str(r.source),temperatureC:num(r.temperatureC),pressureMPaAbs:num(r.pressureMPaAbs),notes:str(r.notes)});
 return {version:1,temperatureC:num(v.temperatureC),pressureMPaAbs:num(v.pressureMPaAbs),useMixtures:v.useMixtures===true,
 mixtures:(Array.isArray(v.mixtures)?v.mixtures:[]).slice(0,200).map((x:unknown)=>{const r=record(x);return {...conditions(r),pvCp:num(r.pvCp),ypPa:num(r.ypPa),observation:r.observation==='anomaly'?'anomaly':r.observation==='no-anomaly'?'no-anomaly':'unknown',fractions:(Array.isArray(r.fractions)?r.fractions:[]).slice(0,3).map((f:unknown)=>{const a=record(f);return {fluidId:str(a.fluidId),key:str(a.key),share:num(a.share)};})};}),
 removal:(Array.isArray(v.removal)?v.removal:[]).slice(0,200).map((x:unknown)=>{const r=record(x);return {...conditions(r),cleanerId:str(r.cleanerId),cleanerKey:str(r.cleanerKey),mudKey:str(r.mudKey),fromMD:num(r.fromMD),toMD:num(r.toMD),criticalPa:num(r.criticalPa),exposureS:num(r.exposureS),...(r.removalPct!==undefined?{removalPct:num(r.removalPct)}:{})};})};
}
export const emptyFluidLab=():FluidInteractionLab=>({version:1,temperatureC:null,pressureMPaAbs:null,useMixtures:false,mixtures:[],removal:[]});
export function labFluids(p:LabFluidsInput):LabFluid[]{
 const make=(id:string,f:any)=>({id,name:f.name||id,temperatureC:num((f.rheologyBottomhole??f.rheology)?.testTemperatureC),pressureMPaAbs:num((f.rheologyBottomhole??f.rheology)?.testPressureMPaAbs),key:JSON.stringify([id,f.name,f.bufferType,f.fluidLoss,f.density,f.rheology,f.rheologyBottomhole,f.additives,f.waterRatio,f.cementSG,f.libraryReference,f.labTargets,...(f.base?[f.base]:[]),...(f.chemicalRecipe?[f.chemicalRecipe.id,f.chemicalRecipe.family,f.chemicalRecipe.waterSource]:[])],(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)});
 return [make('mud:0',p.drillingFluid),...p.buffers.map((f,i)=>make('buffer:'+i,f)),...p.slurries.map((f,i)=>make('cement:'+i,f)),...p.displacementFluids.map((f,i)=>make('displacement:'+i,f))];
}
export function conditionsIssue(t:{source:string;temperatureC:number|null;pressureMPaAbs:number|null},lab:FluidInteractionLab){
 if(!t.source.trim())return 'Не указан протокол/метод';
 if(!finite(t.temperatureC)||!finite(t.pressureMPaAbs)||t.temperatureC<=-273.15||t.pressureMPaAbs<=0)return 'Не заданы корректные T/P протокола';
 if(!finite(lab.temperatureC)||!finite(lab.pressureMPaAbs))return 'Не заданы T/P выбранного сценария';
 if(t.temperatureC!==lab.temperatureC||t.pressureMPaAbs!==lab.pressureMPaAbs)return 'T/P отличаются от выбранного сценария';
 return null;
}
export interface CompiledMixture {fractions:number[];pv:number;yp:number;id:string}
export function compileMixtures(lab:FluidInteractionLab|undefined,fluids:LabFluid[]){
 const points:CompiledMixture[]=[],issues:string[]=[];const keys=new Set<string>();
 if(!lab)return {points,issues:['Нет протоколов совместимости смесей. Используется базовое осреднение.']};
 for(const t of lab.mixtures){let error=conditionsIssue(t,lab);const fs=fluids.map(()=>0);
  if(t.fractions.length<2||t.fractions.length>3)error='Нужны доли двух или трёх жидкостей';
  const ids=new Set<string>();for(const f of t.fractions){const i=fluids.findIndex(x=>x.id===f.fluidId);if(i<0||fluids[i].key!==f.key)error='Состав жидкости изменён или отсутствует';else if(fluids[i].temperatureC!==lab.temperatureC||fluids[i].pressureMPaAbs!==lab.pressureMPaAbs)error='T/P реологии чистых жидкостей не подтверждены для сценария';if(ids.has(f.fluidId))error='Повтор жидкости в составе';ids.add(f.fluidId);if(!finite(f.share)||f.share<=0||f.share>=1)error='Доли смеси должны быть больше 0 и меньше 1';else if(i>=0)fs[i]=f.share;}
  if(Math.abs(fs.reduce((a,b)=>a+b,0)-1)>1e-6)error='Сумма объёмных долей должна равняться 1';
  if(!finite(t.pvCp)||t.pvCp<0||!finite(t.ypPa)||t.ypPa<0)error='Нужны неотрицательные измеренные PV/YP';
  if(t.observation!=='no-anomaly')error=t.observation==='anomaly'?'Лабораторией отмечена аномалия; модель Бингама не применяется':'Наблюдения лаборатории не подтверждены';
  const key=JSON.stringify(fs);if(keys.has(key))error='Дублирующий измеренный состав';keys.add(key);
  if(error)issues.push(t.id+': '+error);else points.push({fractions:fs,pv:t.pvCp!/1000,yp:t.ypPa!,id:t.id});
 }
 if(!points.length)issues.push('Нет применимых измерений смесей для текущего сценария.');
 return {points,issues};
}
/** Explicit interpolation option; not a constitutive law validated for all mixtures. */
export function createMixtureLookup(points:CompiledMixture[]){
 const groups=new Map<string,CompiledMixture[]>();for(const p of points){const key=p.fractions.map((v,i)=>v>0?i:-1).filter(i=>i>=0).join(',');groups.set(key,[...(groups.get(key)??[]),p]);}
 return (c:ArrayLike<number>[],cell:number)=>{
  const ids:number[]=[];for(let f=0;f<c.length;f++)if(c[f][cell]>1e-6)ids.push(f);if(ids.length<2||ids.length>3)return null;
  const group=groups.get(ids.join(','));if(!group)return null;
  for(const p of group)if(p.fractions.length===c.length&&ids.every(i=>Math.abs(p.fractions[i]-c[i][cell])<=1e-6))return {pv:p.pv,yp:p.yp};
  if(ids.length!==2)return null;
  const [a,b]=ids,share=c[b][cell]/(c[a][cell]+c[b][cell]);let lo:CompiledMixture|undefined,hi:CompiledMixture|undefined;
  for(const p of group){if(p.fractions.length!==c.length)continue;const x=p.fractions[b];if(x<=share&&(!lo||x>lo.fractions[b]))lo=p;if(x>=share&&(!hi||x<hi.fractions[b]))hi=p;}
  if(!lo||!hi)return null;const dx=hi.fractions[b]-lo.fractions[b],t=dx>0?(share-lo.fractions[b])/dx:0;return {pv:lo.pv+(hi.pv-lo.pv)*t,yp:lo.yp+(hi.yp-lo.yp)*t};
 };
}
export function measuredMixture(points:CompiledMixture[],c:ArrayLike<number>[],cell:number){return createMixtureLookup(points)(c,cell);}
export function removalIssue(t:RemovalTest,lab:FluidInteractionLab,fluids:LabFluid[]){
 const condition=conditionsIssue(t,lab);if(condition)return condition;
 if(t.removalPct!==undefined&&t.removalPct!==null&&(!finite(t.removalPct)||t.removalPct<0||t.removalPct>100))return 'Измеренное смытие должно быть от 0 до 100%';
 if(fluids.find(f=>f.id===t.cleanerId)?.key!==t.cleanerKey||fluids[0]?.key!==t.mudKey)return 'Состав промывки или бурового изменён';
 const cleaner=fluids.find(f=>f.id===t.cleanerId);if(cleaner?.temperatureC!==lab.temperatureC||cleaner.pressureMPaAbs!==lab.pressureMPaAbs||fluids[0].temperatureC!==lab.temperatureC||fluids[0].pressureMPaAbs!==lab.pressureMPaAbs)return 'T/P реологии промывки и бурового не совпадают со сценарием';
 if(t.cleanerId==='mud:0')return 'Выберите вытесняющую жидкость';
 if(!finite(t.fromMD)||!finite(t.toMD)||t.fromMD<0||t.toMD<=t.fromMD||!finite(t.criticalPa)||t.criticalPa<0||!finite(t.exposureS)||t.exposureS<=0)return 'Проверьте интервал, критическое напряжение и время испытания';
 return null;
}
