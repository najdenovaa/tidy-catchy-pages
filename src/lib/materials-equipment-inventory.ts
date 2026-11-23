import { WELL_GEOMETRY_MODEL_VERSION } from './well-geometry';
import { EQUIPMENT_LABELS, equipmentDetails, type EquipmentSelection } from './cementing-equipment';
import type { WellData } from './cementing-calculations';
export interface CentralizerMaterialItem { model:string; manufacturer:string; quantity:number; sourceUrl?:string }
export interface CalculatedCentralizerMaterials { geometryKey:string; items:CentralizerMaterialItem[] }
export interface EquipmentMaterialItem { name:string; amount:number; unit:string; manufacturer?:string; details?:string; sourceUrl?:string; calculated?:boolean }
export function centralizerMaterialGeometryKey(w:WellData):string {
 return JSON.stringify([WELL_GEOMETRY_MODEL_VERSION,w.casingDepthMD,w.casingOD,w.casingWall,w.holeDiameter,w.prevCasingDepth,w.prevCasingID,w.cavernCoeff,w.cavernIntervals??[],w.trajectory??[],w.pumpZoneTop,w.pumpZoneBottom,w.centralizerDesign??null]);
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
 const turbines=new Map<string,{amount:number;manufacturer?:string;sourceUrl?:string;details:string}>();
 for(const p of w.turbulatorDesign?.points??[])if(Number.isFinite(p.md)&&p.md>=0&&p.md<=w.casingDepthMD){const label=p.catalog?.model??(p.bladesCount+' рёбер, '+p.bladeAngle+'°, вылет '+p.bladeHeight+' мм'),key=label+'|'+(p.catalog?.id??'')+'|'+(p.catalog?.revision??'');const old=turbines.get(key);turbines.set(key,{amount:(old?.amount??0)+1,manufacturer:p.catalog?.manufacturer,sourceUrl:p.catalog?.sourceUrl,details:p.catalog?label+'; версия '+p.catalog.revision+'; '+p.catalog.source:label+'; производитель и паспорт не подтверждаются геометрией'});}
 const manual=(w.equipment??[]).filter(e=>Number.isInteger(e.quantity)&&e.quantity>0&&(!calculated||e.kind!=='centralizer')&&(!(w.turbulatorDesign?.points?.length)||e.kind!=='turbulator'));
 return [
  ...manual.map((e:EquipmentSelection)=>({name:`${EQUIPMENT_LABELS[e.kind]}${e.model?' / '+e.model:''}`,amount:e.quantity,unit:'шт',manufacturer:e.manufacturer||'Не задан',details:equipmentDetails(e)+(e.passport?'':'; паспорт не подтверждён')+(e.note?'; '+e.note:''),sourceUrl:e.sourceUrl})),
  ...[...turbines.values()].map(x=>({name:'Турбулизатор / '+x.details.split(';')[0],amount:x.amount,unit:'шт',manufacturer:x.manufacturer,sourceUrl:x.sourceUrl,details:'По рассчитанным точкам установки; '+x.details,calculated:true})),
  ...(calculated??[]).filter(x=>x.quantity>0).map(x=>({name:`Центратор / ${x.model}`,amount:x.quantity,unit:'шт',manufacturer:x.manufacturer,details:'Количество по рассчитанным точкам установки',sourceUrl:x.sourceUrl,calculated:true})),
 ];
}
