import { WELL_GEOMETRY_MODEL_VERSION } from './well-geometry';
import { EQUIPMENT_LABELS, equipmentDetails, type EquipmentSelection } from './cementing-equipment';
import type { WellData } from './cementing-calculations';
export interface CentralizerMaterialItem { model:string; manufacturer:string; quantity:number; sourceUrl?:string }
export interface CalculatedCentralizerMaterials { geometryKey:string; items:CentralizerMaterialItem[] }
export interface EquipmentMaterialItem { name:string; amount:number; unit:string; manufacturer?:string; details?:string; sourceUrl?:string; calculated?:boolean }
export function centralizerMaterialGeometryKey(w:WellData):string {
 return JSON.stringify([WELL_GEOMETRY_MODEL_VERSION,w.casingDepthMD,w.casingOD,w.casingWall,w.holeDiameter,w.prevCasingDepth,w.prevCasingID,w.cavernCoeff,w.cavernIntervals??[],w.trajectory??[],w.pumpZoneTop,w.pumpZoneBottom]);
}
export function normalizeCentralizerMaterials(v:unknown):CalculatedCentralizerMaterials|undefined {
 if(!v||typeof v!=='object')return undefined;
 const o=v as Record<string,unknown>;if(typeof o.geometryKey!=='string'||!Array.isArray(o.items))return undefined;
 const items=o.items.filter((x):x is CentralizerMaterialItem=>!!x&&typeof x==='object'&&typeof x.model==='string'&&typeof x.manufacturer==='string'&&Number.isInteger(x.quantity)&&x.quantity>=0)
  .map(x=>({model:x.model,manufacturer:x.manufacturer,quantity:x.quantity,...(typeof x.sourceUrl==='string'?{sourceUrl:x.sourceUrl}:{})}));
 return {geometryKey:o.geometryKey,items};
}
export function equipmentMaterialInventory(w:WellData):EquipmentMaterialItem[] {
 const calculated=w.centralizerMaterials?.geometryKey===centralizerMaterialGeometryKey(w)?w.centralizerMaterials.items:undefined;
 const manual=(w.equipment??[]).filter(e=>Number.isInteger(e.quantity)&&e.quantity>0&&(!calculated||e.kind!=='centralizer'));
 return [
  ...manual.map((e:EquipmentSelection)=>({name:`${EQUIPMENT_LABELS[e.kind]}${e.model?' / '+e.model:''}`,amount:e.quantity,unit:'шт',manufacturer:e.manufacturer||'Не задан',details:equipmentDetails(e)+(e.passport?'':'; паспорт не подтверждён')+(e.note?'; '+e.note:''),sourceUrl:e.sourceUrl})),
  ...(calculated??[]).filter(x=>x.quantity>0).map(x=>({name:`Центратор / ${x.model}`,amount:x.quantity,unit:'шт',manufacturer:x.manufacturer,details:'Количество по рассчитанным точкам установки',sourceUrl:x.sourceUrl,calculated:true})),
 ];
}
