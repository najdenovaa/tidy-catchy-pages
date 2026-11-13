import { CENTRALIZER_PATTERNS } from './centralizer-layout';
import type {CentralizerSpec,CentralizerInterval} from './centralization-calculations';
export interface EquipmentLibraryReference {entryId:string;revision:number;source:string;basis:'passport'|'catalog'|'user';notes:string;appliedAt:string;signature:string}
export function normalizeEquipmentReference(v:unknown):EquipmentLibraryReference|undefined{
 if(!v||typeof v!=='object')return;const x=v as EquipmentLibraryReference;
 if(typeof x.entryId!=='string'||!x.entryId||x.entryId.length>200||!Number.isInteger(x.revision)||x.revision<1||typeof x.source!=='string'||x.source.length>2000||!['passport','catalog','user'].includes(x.basis)||typeof x.notes!=='string'||x.notes.length>4000||typeof x.signature!=='string'||x.signature.length>200000||typeof x.appliedAt!=='string'||!Number.isFinite(Date.parse(x.appliedAt)))return;
 return {entryId:x.entryId,revision:x.revision,source:x.source,basis:x.basis,notes:x.notes,signature:x.signature,appliedAt:x.appliedAt};
}
export const stableEquipmentValue=(v:unknown):string=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const PASSPORT_TEXT=['model','manufacturer','sourceUrl','series','boreDiameterRange','lengthRange','bladeWidthRange','source','note'] as const;
export const PASSPORT_NUMBERS=['estimatedRestoringForceKN','massKg','restoringForceSourceKN','startingForceSourceKN','casingOD','boreDiameter','outerDiameter','innerDiameter','length','springLength','bladeWidth','ringOD','ringLength','materialThickness','restoringForceKgf','restoringStandoff','startingForceKgf','runningForceKgf','holdingForceKN','frictionCoefficient','bladeAngle'] as const;
export function normalizeLibraryCentralizer(v:unknown):CentralizerSpec|undefined{
 if(!v||typeof v!=='object')return;const s=v as CentralizerSpec;
 if(!['spring','rigid','solid'].includes(s.type)||!['bladesCount','bladeHeight','restoringForce','maxAxialLoad'].every(k=>typeof s[k]==='number'&&Number.isFinite(s[k])&&s[k]>=0))return;
 const out:CentralizerSpec={type:s.type,bladesCount:s.bladesCount,bladeHeight:s.bladeHeight,restoringForce:s.restoringForce,maxAxialLoad:s.maxAxialLoad};
 if(s.passport&&typeof s.passport==='object'){
  const p:NonNullable<CentralizerSpec['passport']>={model:typeof s.passport.model==='string'?s.passport.model:''};
  for(const k of PASSPORT_TEXT)if(typeof s.passport[k]==='string')p[k]=s.passport[k];
  for(const k of PASSPORT_NUMBERS)if(typeof s.passport[k]==='number'&&Number.isFinite(s.passport[k])&&s.passport[k]>=0)p[k]=s.passport[k];
  if(typeof s.passport.forceLimitAmbiguous==='boolean')p.forceLimitAmbiguous=s.passport.forceLimitAmbiguous;
  out.passport=p;
 }
 const ref=normalizeEquipmentReference(s.libraryReference);if(ref)out.libraryReference=ref;
 return out;
}
export function centralizerSignature(s:CentralizerSpec):string{const n=normalizeLibraryCentralizer(s);if(!n)return '';const {libraryReference,...props}=n;return stableEquipmentValue(props);}
export function equipmentReferenceText(ref:EquipmentLibraryReference|undefined,signature:string):string{
 if(!ref)return '';return `Библиотека: версия ${ref.revision}; ${ref.basis==='passport'?'данные паспорта':ref.basis==='catalog'?'данные каталога':'ввод технолога'}; источник: ${ref.source}; ${ref.signature===signature?'снимок выбранной версии':'параметры изменены в проекте'}${ref.notes?'; '+ref.notes:''}`;
}
export interface CentralizerDesign {mode:'manual'|'auto';targetStandoff:number;jointLength:number;autoSpec:CentralizerSpec;intervals:CentralizerInterval[]}
export function normalizeCentralizerDesign(v:unknown):CentralizerDesign|undefined{
 if(!v||typeof v!=='object')return;const d=v as CentralizerDesign,autoSpec=normalizeLibraryCentralizer(d.autoSpec);
 if(!autoSpec||!['manual','auto'].includes(d.mode)||!Number.isFinite(d.targetStandoff)||d.targetStandoff<10||d.targetStandoff>99||!Number.isFinite(d.jointLength)||d.jointLength<=0||!Array.isArray(d.intervals)||d.intervals.length>2000)return;
 const intervals:CentralizerInterval[]=[];
 for(const x of d.intervals){const spec=normalizeLibraryCentralizer(x?.spec);if(!spec||typeof x.id!=='string'||!['fromMD','toMD','centralizersPerJoint','jointLength'].every(k=>typeof x[k]==='number'&&Number.isFinite(x[k])&&x[k]>=0))return;const specB=x.specB===undefined?undefined:normalizeLibraryCentralizer(x.specB);if(x.specB!==undefined&&!specB)return;if(x.pattern!==undefined&&!CENTRALIZER_PATTERNS.includes(x.pattern))return;intervals.push({id:x.id,fromMD:x.fromMD,toMD:x.toMD,centralizersPerJoint:x.centralizersPerJoint,jointLength:x.jointLength,spec,...(specB?{specB}:{}),...(x.pattern?{pattern:x.pattern}:{})});}
 return {mode:d.mode,targetStandoff:d.targetStandoff,jointLength:d.jointLength,autoSpec,intervals};
}
