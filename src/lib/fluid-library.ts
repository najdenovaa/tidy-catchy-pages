import type {DrillingFluid, BufferFluid, SlurryInput, DisplacementFluid, Rheology} from './cementing-calculations';
import {normalizeDrillingFluid, normalizeBufferFluid, normalizeSlurryInput, normalizeDisplacementFluid} from './cementing-normalizers';
import type {FluidLibraryReference} from './fluid-library-reference';
export type FluidKind = 'mud' | 'buffer' | 'slurry' | 'displacement';
export type ProjectFluid = DrillingFluid | BufferFluid | SlurryInput | DisplacementFluid;
export const FLUID_KINDS: Record<FluidKind,string> = {mud:'Буровой раствор', buffer:'Буферная жидкость', slurry:'Тампонажный раствор', displacement:'Продавочная жидкость'};
export const FLUID_BASES = {user:'Ввод технолога', laboratory:'Лабораторные измерения', manufacturer:'Данные производителя', estimate:'Расчётная оценка'} as const;
export const FLUID_LIBRARY_KEY = 'deallsoft.fluid-library.v1';
export interface FluidConditions {source:string; basis:FluidLibraryReference['basis']; temperatureC?:number; pressureMPa?:number; notes:string}
/** Canonical density is kg/m³ for every library kind. No well depths, volumes or pump schedule. */
export interface FluidProperties {
  name:string; density:number; rheology:Rheology;
  rheologyBottomhole?:Rheology; fluidLoss?:number; bufferType?:BufferFluid['bufferType'];
  additives?:SlurryInput['additives']; thickeningTime30Bc?:number; thickeningTime50Bc?:number;
  waterRatio?:number; yieldPerTon?:number; cementSG?:number; labTargets?:SlurryInput['labTargets']; compressionCoeff?:number;
}
export interface FluidRevision extends FluidConditions {version:number; createdAt:string; properties:FluidProperties}
export interface FluidEntry {id:string; kind:FluidKind; revisions:FluidRevision[]}
export interface FluidLibrary {schemaVersion:1; entries:FluidEntry[]}
export const emptyFluidLibrary = ():FluidLibrary => ({schemaVersion:1,entries:[]});
const clone = <T>(v:T):T => JSON.parse(JSON.stringify(v));
const normalizers = {mud:normalizeDrillingFluid,buffer:normalizeBufferFluid,slurry:normalizeSlurryInput,displacement:normalizeDisplacementFluid};
export function fluidProperties(kind:FluidKind, fluid:ProjectFluid):FluidProperties {
  const f=normalizers[kind](fluid) as ProjectFluid;
  const props:FluidProperties={name:typeof fluid.name==='string'?fluid.name:f.name,density:kind==='slurry'?f.density*1000:f.density,rheology:f.rheology};
  const keys:Record<FluidKind,string[]>={mud:['fluidLoss','rheologyBottomhole'],buffer:['bufferType','additives'],slurry:['additives','thickeningTime30Bc','thickeningTime50Bc','waterRatio','yieldPerTon','cementSG','labTargets'],displacement:['compressionCoeff']};
  for(const key of keys[kind]) if(f[key as keyof ProjectFluid]!==undefined)(props as unknown as Record<string,unknown>)[key]=f[key as keyof ProjectFluid];
  // Absolute masses belong to the job volume, only percentages travel with the recipe.
  if(props.additives)props.additives=props.additives.map(a=>({...a,massKg:a.percentage>0?0:a.massKg}));
  return clone(props);
}
const stable=(v:unknown):string=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const fluidSignature=(kind:FluidKind, f:ProjectFluid)=>stable(fluidProperties(kind,f));
export const fluidIsModified=(kind:FluidKind,f:ProjectFluid)=>!!f.libraryReference&&fluidSignature(kind,f)!==f.libraryReference.signature;
function validateProperties(p:FluidProperties){
  if(!p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name.trim()||p.name.length>200)throw new Error('Укажите наименование до 200 символов.');
  if(!Number.isFinite(p.density)||p.density<=0||p.density>5000)throw new Error('Плотность должна быть больше 0 и не более 5000 кг/м³.');
  if(!p.rheology || typeof p.rheology !== 'object')throw new Error('Не заданы свойства реологии.');
  for(const r of [p.rheology,p.rheologyBottomhole].filter(Boolean) as Rheology[]){
    if(!r||![r.pv,r.yp].every(v=>Number.isFinite(v)&&v>=0))throw new Error('PV и YP должны быть неотрицательными числами.');
    if(r.fann&&!Object.values(r.fann).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0))throw new Error('Некорректные показания Fann.');
  }
  for(const k of ['fluidLoss','thickeningTime30Bc','thickeningTime50Bc','waterRatio','yieldPerTon','cementSG','compressionCoeff'] as const){const v=p[k];if(v!==undefined&&(!Number.isFinite(v)||v<0))throw new Error('Свойства жидкости должны быть конечными неотрицательными числами.');}
  if(p.compressionCoeff!==undefined&&p.compressionCoeff<1)throw new Error('Коэффициент сжатия должен быть не меньше 1.');
  if(p.additives?.some(a=>a.massKg!==0))throw new Error('Абсолютная доза компонента в кг зависит от объёма работы. Переведите её в проценты в проекте перед сохранением в библиотеку.');
  if(p.additives&&(!Array.isArray(p.additives)||p.additives.length>200||p.additives.some(a=>!a.name.trim()||!Number.isFinite(a.percentage)||a.percentage<0||!['bwoc','bwob'].includes(a.percentageType))))throw new Error('Проверьте наименования и проценты компонентов.');
}
export function validateFluidRevision(r:FluidRevision){
  validateProperties(r.properties);
  if(typeof r.source!=='string'||!r.source.trim()||r.source.length>2000||typeof r.notes!=='string'||r.notes.length>4000||!Object.prototype.hasOwnProperty.call(FLUID_BASES,r.basis))throw new Error('Укажите источник данных (до 2000 символов).');
  if(r.temperatureC!==undefined&&(!Number.isFinite(r.temperatureC)||r.temperatureC < -273.15||r.temperatureC>500))throw new Error('Проверьте температуру измерений.');
  if(r.pressureMPa!==undefined&&(!Number.isFinite(r.pressureMPa)||r.pressureMPa<0||r.pressureMPa>300))throw new Error('Проверьте давление измерений.');
  if(r.basis==='laboratory'&&(r.temperatureC===undefined||r.pressureMPa===undefined))throw new Error('Для лабораторных данных укажите температуру и давление испытаний.');
}
export function saveFluidRevision(lib:FluidLibrary,kind:FluidKind,properties:FluidProperties,conditions:FluidConditions,entryId?:string):FluidLibrary{
  const next=clone(lib),entry=entryId?next.entries.find(e=>e.id===entryId):undefined;
  if(entryId&&(!entry||entry.kind!==kind))throw new Error('Запись библиотеки изменилась. Обновите список.');
  if((entry?.revisions.length??0)>=50||(!entry&&next.entries.length>=500))throw new Error('Достигнут лимит библиотеки: 500 записей, 50 версий на запись.');
  const revision:FluidRevision={...clone(conditions),properties:clone(properties),version:(entry?.revisions.at(-1)?.version??0)+1,createdAt:new Date().toISOString()};
  validateFluidRevision(revision);
  if(entry)entry.revisions.push(revision);else next.entries.push({id:crypto.randomUUID(),kind,revisions:[revision]});
  return next;
}
export function applyFluidRevision<T extends ProjectFluid>(kind:FluidKind,target:T,entry:FluidEntry,version:number):T{
  if(entry.kind!==kind)throw new Error('Тип жидкости не совпадает.');
  const r=entry.revisions.find(r=>r.version===version);if(!r)throw new Error('Версия не найдена.');validateFluidRevision(r);
  const p=clone(r.properties), applied={...clone(target),...p,density:kind==='slurry'?p.density/1000:p.density} as T;
  // Missing optional properties must clear values inherited from a different material.
  for(const key of ['rheologyBottomhole','bufferType','cementSG','labTargets'])if(!(key in p))delete (applied as unknown as Record<string,unknown>)[key];
  applied.libraryReference={entryId:entry.id,revision:r.version,name:p.name,source:r.source,notes:r.notes,basis:r.basis,temperatureC:r.temperatureC,pressureMPa:r.pressureMPa,appliedAt:new Date().toISOString(),signature:fluidSignature(kind,applied)};
  return applied;
}
export function parseFluidLibrary(text:string):FluidLibrary{
  if(text.length>5000000)throw new Error('Файл библиотеки больше 5 МБ.');
  const raw=JSON.parse(text);if(raw?.schemaVersion!==1||!Array.isArray(raw.entries)||raw.entries.length>500)throw new Error('Неподдерживаемый формат библиотеки.');
  const ids=new Set<string>();
  for(const e of raw.entries){
    if(!e||typeof e.id!=='string'||!e.id||e.id.length>200||ids.has(e.id)||!Object.prototype.hasOwnProperty.call(FLUID_KINDS,e.kind)||!Array.isArray(e.revisions)||!e.revisions.length||e.revisions.length>50)throw new Error('Некорректная запись библиотеки.');ids.add(e.id);
    e.revisions.forEach((r:FluidRevision,i:number)=>{
      if(!r||r.version!==i+1||!Number.isFinite(Date.parse(r.createdAt))||typeof r.source!=='string'||typeof r.notes!=='string'||!r.properties)throw new Error('Некорректная история версий.');
      validateFluidRevision(r);
      const p=r.properties, f={...p,density:e.kind==='slurry'?p.density/1000:p.density};
      const canonical=fluidProperties(e.kind,f as ProjectFluid);
      canonical.density=p.density; // Avoid rejecting a valid unit roundtrip for floating-point rounding.
      // Never silently discard unknown properties or coerce malformed imported values.
      if(stable(p)!==stable(canonical))throw new Error('Свойства файла не соответствуют схеме жидкости.');
    });
  }
  return clone(raw);
}
export function readFluidLibrary(storage:Pick<Storage,'getItem'>):{library:FluidLibrary;raw:string|null}{
  const raw=storage.getItem(FLUID_LIBRARY_KEY);return {library:raw?parseFluidLibrary(raw):emptyFluidLibrary(),raw};
}
export function writeFluidLibrary(storage:Pick<Storage,'getItem'|'setItem'>,lib:FluidLibrary,expectedRaw:string|null):string{
  if(storage.getItem(FLUID_LIBRARY_KEY)!==expectedRaw)throw new Error('Библиотека изменена в другой вкладке. Нажмите «Обновить список» перед сохранением.');
  const text=JSON.stringify(lib);parseFluidLibrary(text);storage.setItem(FLUID_LIBRARY_KEY,text);return text;
}
export function fluidReferenceText(kind:FluidKind,f:ProjectFluid):string{
  const r=f.libraryReference;if(!r)return '';
  return `${r.name}, версия ${r.revision}; ${FLUID_BASES[r.basis]}; источник: ${r.source}${r.temperatureC!==undefined?`; t = ${r.temperatureC} °C`:''}${r.pressureMPa!==undefined?`; P = ${r.pressureMPa} МПа`:''}; ${fluidIsModified(kind,f)?'свойства изменены в проекте':'снимок выбранной версии'}. Применено: ${r.appliedAt}${r.notes?`; примечание: ${r.notes}`:''}`;
}
