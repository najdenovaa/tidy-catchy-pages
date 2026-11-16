import {effectiveRheology,cementCategory} from './cementing-calculations';
import type {DrillingFluid,BufferFluid,SlurryInput,DisplacementFluid,Rheology} from './cementing-calculations';
import {rheologyFigure} from './rheology-figure';
export function rheologyReportFluids(p:{drillingFluid:DrillingFluid;buffers:BufferFluid[];slurries:SlurryInput[];displacementFluids:DisplacementFluid[]}){
 const row=(id:string,name:string,r:Rheology,category:Parameters<typeof effectiveRheology>[1])=>{const appliedR=effectiveRheology(r,category);return {id,name,r,appliedR,appliedSource:appliedR===r?'Введённая / выбранная реология':appliedR.fann?'PV/YP восстановлены из Fann; выбор модели сохранён':'Модельные PV/YP по типу жидкости (не измерения)'};};
 return [row('mud',p.drillingFluid.name||'Буровой раствор',p.drillingFluid.rheology,'mud'),
  ...(p.drillingFluid.rheologyBottomhole?[row('mud-bottomhole',(p.drillingFluid.name||'Буровой раствор')+' (забой)',p.drillingFluid.rheologyBottomhole,'mud')]:[]),
  ...p.buffers.map((f,i)=>row('buffer-'+(i+1),f.name,f.rheology,'buffer')),
  ...p.slurries.map((f,i)=>row('slurry-'+(i+1),f.name,f.rheology,cementCategory(f.density))),
  ...p.displacementFluids.map((f,i)=>row('displacement-'+(i+1),f.name,f.rheology,'displacement'))];
}
export function rheologyReportFigures(p:Parameters<typeof rheologyReportFluids>[0]){return rheologyReportFluids(p).flatMap(f=>[rheologyFigure(f.r,false,f.name,f.appliedR,'rheology-'+f.id+'-flow'),rheologyFigure(f.r,true,f.name,f.appliedR,'rheology-'+f.id+'-residual')].filter((x):x is NonNullable<typeof x>=>!!x));}

export type RheologyReportInput=Parameters<typeof rheologyReportFluids>[0];
