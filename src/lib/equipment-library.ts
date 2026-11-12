import {EQUIPMENT_LABELS,normalizeEquipment,type EquipmentKind,type EquipmentSelection} from './cementing-equipment';
import type {CentralizerSpec} from './centralization-calculations';
import {normalizeLibraryCentralizer,centralizerSignature,stableEquipmentValue,type EquipmentLibraryReference} from './equipment-library-reference';
export const EQUIPMENT_LIBRARY_KEY='deallsoft.equipment-library.v1';
export const EQUIPMENT_BASES={passport:'Паспорт поставки / испытаний',catalog:'Каталог изготовителя',user:'Ввод технолога'} as const;
export const EQUIPMENT_PROPERTY_NUMBERS=['casingOD','outerDiameter','passageID','maxTemperatureC','backpressureMPa','membraneRuptureMPa','stopPressureMPa','basketCapacityKN'] as const;
export const EQUIPMENT_PROPERTY_TEXT=['productId','model','manufacturer','sourceUrl','thread','passport','note'] as const;
export type EquipmentProperties=Omit<EquipmentSelection,'id'|'quantity'|'depthMD'|'basketSupportPct'|'basketBridgeMin'|'basketCarrierDensityGcm3'|'libraryReference'>;
export interface EquipmentRevision {version:number;createdAt:string;source:string;basis:EquipmentLibraryReference['basis'];notes:string;properties:EquipmentProperties}
export interface EquipmentEntry {id:string;kind:EquipmentKind;revisions:EquipmentRevision[]}
export interface EquipmentLibrary {schemaVersion:1;entries:EquipmentEntry[]}
export const emptyEquipmentLibrary=():EquipmentLibrary=>({schemaVersion:1,entries:[]});
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
export function equipmentProperties(e:EquipmentSelection):EquipmentProperties{
 const p:EquipmentProperties={kind:e.kind,model:e.model,manufacturer:e.manufacturer};
 for(const k of EQUIPMENT_PROPERTY_TEXT)if(typeof e[k]==='string')p[k]=e[k];
 for(const k of EQUIPMENT_PROPERTY_NUMBERS)if(e[k]!==undefined)p[k]=e[k];
 if(e.kind==='centralizer'&&e.centralizerSpec){const {libraryReference,...spec}=clone(e.centralizerSpec);p.centralizerSpec=spec;}
 return clone(p);
}
export const equipmentSignature=(e:EquipmentSelection)=>stableEquipmentValue(equipmentProperties(e));
export function centralizerProperties(spec:CentralizerSpec):EquipmentProperties{
 const {libraryReference,...s}=clone(spec),p=s.passport;
 return {kind:'centralizer',model:p?.model??'',manufacturer:p?.manufacturer??'',...(p?.sourceUrl?{sourceUrl:p.sourceUrl}:{}),...(p?.casingOD!==undefined?{casingOD:p.casingOD}:{}),...(p?.outerDiameter!==undefined?{outerDiameter:p.outerDiameter}:{}),centralizerSpec:s};
}
function validateRevision(r:EquipmentRevision){
 const p=r?.properties;if(!p||!Object.prototype.hasOwnProperty.call(EQUIPMENT_LABELS,p.kind)||typeof p.model!=='string'||!p.model.trim()||p.model.length>200||typeof p.manufacturer!=='string'||!p.manufacturer.trim()||p.manufacturer.length>200)throw new Error('Укажите модель и производителя (до 200 символов).');
 if(typeof r.source!=='string'||!r.source.trim()||r.source.length>2000||typeof r.notes!=='string'||r.notes.length>4000||!Object.prototype.hasOwnProperty.call(EQUIPMENT_BASES,r.basis))throw new Error('Укажите источник данных и основание.');
 for(const k of EQUIPMENT_PROPERTY_TEXT)if(p[k]!==undefined&&(typeof p[k]!=='string'||p[k].length>4000))throw new Error('Некорректное текстовое поле паспорта.');
 for(const url of [p.sourceUrl,p.centralizerSpec?.passport?.sourceUrl].filter(Boolean)){let u:URL;try{u=new URL(url);}catch{throw new Error('Источник-ссылка должен быть полным адресом http/https.');}if(!['https:','http:'].includes(u.protocol))throw new Error('Допустимы только ссылки http/https.');}
 for(const k of EQUIPMENT_PROPERTY_NUMBERS)if(p[k]!==undefined&&(!Number.isFinite(p[k])||p[k]<0))throw new Error('Параметры оснастки должны быть конечными неотрицательными числами.');
 if(p.centralizerSpec){
  const normalized=normalizeLibraryCentralizer(p.centralizerSpec);
  if(p.kind!=='centralizer'||!normalized||stableEquipmentValue(normalized)!==stableEquipmentValue(p.centralizerSpec)||!Number.isInteger(normalized.bladesCount)||normalized.bladesCount<1||normalized.bladesCount>100)throw new Error('Некорректные паспортные параметры центратора.');
  if(normalized.passport?.model!==p.model||(normalized.passport?.manufacturer??'')!==p.manufacturer)throw new Error('Модель и изготовитель центратора должны совпадать с паспортом.');
  if(normalized.passport?.restoringStandoff!==undefined&&(normalized.passport.restoringStandoff<=0||normalized.passport.restoringStandoff>=100))throw new Error('Степень центрирования при испытании должна быть больше 0 и меньше 100%.');
 }
 if(p.kind==='centralizer'&&!p.centralizerSpec)throw new Error('Для центратора заполните расчётный паспорт во вкладке «Центрирование» и сохраните его оттуда.');
 const canonical=equipmentProperties(normalizeEquipment([{id:'check',quantity:1,...p}])[0]);
 if(stableEquipmentValue(canonical)!==stableEquipmentValue(p))throw new Error('Свойства не соответствуют схеме оснастки. Глубины, количество и сценарий корзины не входят в библиотечную запись.');
}
export function saveEquipmentRevision(lib:EquipmentLibrary,properties:EquipmentProperties,meta:Pick<EquipmentRevision,'source'|'basis'|'notes'>,entryId?:string):EquipmentLibrary{
 const next=clone(lib),entry=entryId?next.entries.find(e=>e.id===entryId):undefined;
 if(entryId&&(!entry||entry.kind!==properties.kind))throw new Error('Запись изменилась. Обновите список.');
 if((entry?.revisions.length??0)>=50||(!entry&&next.entries.length>=500))throw new Error('Лимит: 500 записей, 50 версий на запись.');
 const r:EquipmentRevision={...meta,properties:clone(properties),version:(entry?.revisions.at(-1)?.version??0)+1,createdAt:new Date().toISOString()};validateRevision(r);
 if(entry)entry.revisions.push(r);else next.entries.push({id:crypto.randomUUID(),kind:properties.kind,revisions:[r]});return next;
}
function chosen(e:EquipmentEntry,version:number){const r=e.revisions.find(r=>r.version===version);if(!r)throw new Error('Версия не найдена.');validateRevision(r);return r;}
const reference=(e:EquipmentEntry,r:EquipmentRevision,signature:string):EquipmentLibraryReference=>({entryId:e.id,revision:r.version,source:r.source,basis:r.basis,notes:r.notes,appliedAt:new Date().toISOString(),signature});
export function applyEquipmentRevision(target:EquipmentSelection,e:EquipmentEntry,version:number):EquipmentSelection{
 const r=chosen(e,version);if(e.kind!==target.kind)throw new Error('Тип оснастки не совпадает.');
 const {id,quantity,depthMD,basketSupportPct,basketBridgeMin,basketCarrierDensityGcm3}=target;
 const out:EquipmentSelection={id,quantity,depthMD,basketSupportPct,basketBridgeMin,basketCarrierDensityGcm3,...clone(r.properties)};
 out.libraryReference=reference(e,r,equipmentSignature(out));return out;
}
export function applyCentralizerRevision(e:EquipmentEntry,version:number):CentralizerSpec{
 const r=chosen(e,version);if(e.kind!=='centralizer'||!r.properties.centralizerSpec)throw new Error('Не выбран паспорт центратора.');
 const out=clone(r.properties.centralizerSpec);out.libraryReference=reference(e,r,centralizerSignature(out));return out;
}
export function parseEquipmentLibrary(text:string):EquipmentLibrary{
 if(text.length>5000000)throw new Error('Библиотека больше 5 МБ.');const raw=JSON.parse(text),ids=new Set();
 if(raw?.schemaVersion!==1||!Array.isArray(raw.entries)||raw.entries.length>500)throw new Error('Неподдерживаемый формат библиотеки оснастки.');
 for(const e of raw.entries){if(!e||typeof e.id!=='string'||!e.id||e.id.length>200||ids.has(e.id)||!Object.prototype.hasOwnProperty.call(EQUIPMENT_LABELS,e.kind)||!Array.isArray(e.revisions)||!e.revisions.length||e.revisions.length>50)throw new Error('Некорректная запись библиотеки.');ids.add(e.id);
 e.revisions.forEach((r:EquipmentRevision,i:number)=>{if(r.version!==i+1||r.properties?.kind!==e.kind||typeof r.createdAt!=='string'||!Number.isFinite(Date.parse(r.createdAt)))throw new Error('Некорректная история версий.');validateRevision(r);});}
 return clone(raw);
}
export function readEquipmentLibrary(storage:Pick<Storage,'getItem'>){const raw=storage.getItem(EQUIPMENT_LIBRARY_KEY);return {raw,library:raw?parseEquipmentLibrary(raw):emptyEquipmentLibrary()};}
export function writeEquipmentLibrary(storage:Pick<Storage,'getItem'|'setItem'>,lib:EquipmentLibrary,expectedRaw:string|null){
 if(storage.getItem(EQUIPMENT_LIBRARY_KEY)!==expectedRaw)throw new Error('Библиотека изменена в другой вкладке. Нажмите «Обновить список».');
 const text=JSON.stringify(lib);parseEquipmentLibrary(text);storage.setItem(EQUIPMENT_LIBRARY_KEY,text);return text;
}
