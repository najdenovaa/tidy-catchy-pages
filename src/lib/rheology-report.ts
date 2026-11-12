import {effectiveRheology,cementCategory} from './cementing-calculations';
import type {DrillingFluid,BufferFluid,SlurryInput,DisplacementFluid,Rheology} from './cementing-calculations';
import {rheologyFigure} from './rheology-figure';
export function rheologyReportFluids(p:{drillingFluid:DrillingFluid;buffers:BufferFluid[];slurries:SlurryInput[];displacementFluids:DisplacementFluid[]}){
 const row=(name:string,r:Rheology,category:Parameters<typeof effectiveRheology>[1])=>({name,r,appliedR:effectiveRheology(r,category)});
 return [row(p.drillingFluid.name||'Буровой раствор',p.drillingFluid.rheology,'mud'),
  ...(p.drillingFluid.rheologyBottomhole?[row((p.drillingFluid.name||'Буровой раствор')+' (забой)',p.drillingFluid.rheologyBottomhole,'mud')]:[]),
  ...p.buffers.map(f=>row(f.name,f.rheology,'buffer')),
  ...p.slurries.map(f=>row(f.name,f.rheology,cementCategory(f.density))),
  ...p.displacementFluids.map(f=>row(f.name,f.rheology,'displacement'))];
}
export function rheologyReportFigures(p:Parameters<typeof rheologyReportFluids>[0]){return rheologyReportFluids(p).flatMap(f=>[rheologyFigure(f.r,false,f.name),rheologyFigure(f.r,true,f.name)].filter((x):x is NonNullable<typeof x>=>!!x));}
