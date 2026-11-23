import {passportExamples} from './centralizer-passports';
import {applyCentralizerRevision,type EquipmentLibrary} from './equipment-library';
import {centralizerSignature,normalizeLibraryCentralizer} from './equipment-library-reference';
import type {CentralizerSpec,TurbulatorPoint} from './centralization-calculations';
import type {WellData} from './cementing-calculations';
import {createAnnularGeometry} from './well-geometry';
import type {HardwareIdentity} from './optimizer-hardware-identity';
export type {HardwareIdentity} from './optimizer-hardware-identity';
export interface CatalogCentralizer {identity:HardwareIdentity;maxTemperatureC?:number;spec:CentralizerSpec}
export interface CatalogTurbulator {identity:HardwareIdentity;maxTemperatureC?:number;casingOD:number;outerDiameter:number;innerDiameter:number;point:Omit<TurbulatorPoint,'md'|'id'>}
export interface OptimizerHardwareCatalog {centralizers:CatalogCentralizer[];turbulators:CatalogTurbulator[]}
/** Frozen copies of built-in passports and the user's selected latest library revisions. No inferred product sizes. */
export function optimizerHardwareCatalog(lib?:EquipmentLibrary):OptimizerHardwareCatalog{
 const centralizers:CatalogCentralizer[]=passportExamples.map(({id,spec})=>{
  const p=spec.passport,identity:HardwareIdentity={id:'builtin:'+id,model:p.model,manufacturer:p.manufacturer||'Не указан в источнике',source:p.source||'Встроенный паспорт',sourceUrl:p.sourceUrl,revision:1,basis:'catalog'};
  const copy=structuredClone(spec);copy.libraryReference={entryId:identity.id,revision:1,source:identity.source,basis:'catalog',notes:p.note??'',appliedAt:new Date().toISOString(),signature:centralizerSignature(copy)};
  return {identity,spec:copy};
 });
 const turbulators:CatalogTurbulator[]=centralizers.filter(x=>x.spec.type!=='spring'&&x.spec.passport?.bladeAngle>0&&x.spec.passport?.length>0&&x.spec.passport?.innerDiameter>0).map(x=>({identity:x.identity,casingOD:x.spec.passport.casingOD,outerDiameter:x.spec.passport.outerDiameter,innerDiameter:x.spec.passport.innerDiameter,point:{bladesCount:x.spec.bladesCount,bladeAngle:x.spec.passport.bladeAngle,bladeHeight:x.spec.bladeHeight,lengthMm:x.spec.passport.length,bladeWidthMm:x.spec.passport.bladeWidth,catalog:x.identity}}));
 for(const e of lib?.entries??[]){const r=e.revisions.at(-1);if(!r)continue;const p=r.properties,identity:HardwareIdentity={id:e.id,model:p.model,manufacturer:p.manufacturer,source:r.source,sourceUrl:p.sourceUrl,revision:r.version,basis:r.basis};
  if(e.kind==='centralizer'&&p.centralizerSpec)centralizers.push({identity,maxTemperatureC:p.maxTemperatureC,spec:applyCentralizerRevision(e,r.version)});
  if(e.kind==='turbulator')turbulators.push({identity,maxTemperatureC:p.maxTemperatureC,casingOD:p.casingOD,outerDiameter:p.outerDiameter,innerDiameter:p.passageID,point:{bladesCount:p.bladesCount,bladeAngle:p.bladeAngle,bladeHeight:p.bladeHeight,lengthMm:p.lengthMm,bladeWidthMm:p.bladeWidthMm,sleeveThicknessMm:p.sleeveThicknessMm,catalog:identity}});
 }
 return {centralizers,turbulators};
}
export function compatibleHardware(w:WellData,catalog:OptimizerHardwareCatalog){
 const cells=createAnnularGeometry(w,w.casingDepthMD).cells,minBore=Math.min(...cells.map(c=>c.diameterMm));
 const match=(od:number,id:number,body:number)=>Number.isFinite(od)&&Math.abs(od-w.casingOD)<=1&&id>w.casingOD&&body>0&&body<minBore;
 const temperature=Math.max(w.bottomTempStatic,w.bottomTempCirc),allowed=(x:{maxTemperatureC?:number})=>x.maxTemperatureC==null||temperature<=x.maxTemperatureC;
 const centralizers=catalog.centralizers.filter(x=>{if(!allowed(x))return false;const s=normalizeLibraryCentralizer(x.spec),p=s?.passport;if(!p||!match(p.casingOD,p.innerDiameter,s.type==='spring'?(p.ringOD??p.innerDiameter+2*(p.materialThickness??3)):p.outerDiameter))return false;
  if(s.type!=='spring'&&p.outerDiameter>=minBore)return false;
  // Free spring OD may exceed the bore; the existing spring mechanics handles compression.
  return p.outerDiameter>w.casingOD&&s.bladesCount>0&&p.length>0;
 });
 const turbulators=catalog.turbulators.filter(x=>allowed(x)&&match(x.casingOD,x.innerDiameter,x.outerDiameter)&&x.outerDiameter>w.casingOD&&x.point.bladesCount>=1&&x.point.bladeAngle>0&&x.point.lengthMm>0);
 return {centralizers,turbulators,minBore};
}
