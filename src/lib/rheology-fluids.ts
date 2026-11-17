import {effectiveRheology,cementCategory} from './cementing-calculations';
import type {DrillingFluid,BufferFluid,SlurryInput,DisplacementFluid,Rheology} from './cementing-calculations';
export function rheologyReportFluids(p:{drillingFluid:DrillingFluid;buffers:BufferFluid[];slurries:SlurryInput[];displacementFluids:DisplacementFluid[];wellData?:import('./cementing-calculations').WellData;flushTimeMin?:number;flushVolumeM3?:number}){
 const row=(id:string,name:string,r:Rheology,category:Parameters<typeof effectiveRheology>[1])=>{const appliedR=effectiveRheology(r,category);return {id,name,r,appliedR,appliedSource:appliedR===r?'Введённая / выбранная реология':appliedR.fann?'PV/YP восстановлены из Fann; выбор модели сохранён':'Модельные PV/YP по типу жидкости (не измерения)'};};
 return [row('mud',p.drillingFluid.name||'Буровой раствор',p.drillingFluid.rheology,'mud'),
  ...(p.drillingFluid.rheologyBottomhole?[row('mud-bottomhole',(p.drillingFluid.name||'Буровой раствор')+' (забой)',p.drillingFluid.rheologyBottomhole,'mud')]:[]),
  ...p.buffers.map((f,i)=>row('buffer-'+(i+1),f.name,f.rheology,'buffer')),
  ...p.slurries.map((f,i)=>row('slurry-'+(i+1),f.name,f.rheology,cementCategory(f.density))),
  ...p.displacementFluids.map((f,i)=>row('displacement-'+(i+1),f.name,f.rheology,'displacement'))];
}

export type RheologyReportInput=Parameters<typeof rheologyReportFluids>[0];
