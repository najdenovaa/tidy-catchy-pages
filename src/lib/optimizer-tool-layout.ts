import type { ProgramInput, CentralizerPlan } from './cement-optimizer';
import type { CatalogTurbulator } from './optimizer-hardware';
import type { CleaningTarget } from './optimizer-cleaning';
import { buildCentralizerJointSchedule } from './centralizer-layout';
import { calculateTurbulatorFlow, defaultTurbulatorDesign, turbulatorGeometryErrors, turbulatorStandoff, swirlRatioAt } from './turbulator-flow';
import type { TurbulatorPoint } from './centralization-calculations';

/** Place real products in available joint slots. Wake decay is an output, not a demand for continuous swirl coverage. */
export function placeProgramTurbulators(p: ProgramInput, cp: CentralizerPlan, target: CleaningTarget, product: CatalogTurbulator, fluid: ProgramInput['buffers'][number], rate: number, joint: number) {
  const w = {...p.wellData, standoffProfile:cp.profile.map(r=>({md:r.md,standoffPct:r.standoff}))};
  const supports=buildCentralizerJointSchedule(w.casingDepthMD,cp.intervals).flatMap(j=>j.placements);
  const length=(product.point.lengthMm??180)/1000;
  const points:TurbulatorPoint[]=[],swirlDepths=new Set<number>();
  const standoffs=new Map<number,number>();
  const standoff=(md:number)=>{let value=standoffs.get(md);if(value===undefined){value=turbulatorStandoff(w,md);standoffs.set(md,value);}return value;};
  const overlaps=(md:number)=>supports.some(c=>md<c.md+(c.spec.passport?.length??0)/2000+.01&&md+length>c.md-(c.spec.passport?.length??0)/2000-.01)||points.some(t=>md<t.md+length+.01&&md+length>t.md-.01);
  for(let bottom=target.bottomMD;bottom>target.topMD+1e-6;bottom-=joint){
    const top=Math.max(target.topMD,bottom-joint),last=Math.min(bottom,w.casingDepthMD)-length;
    const candidates=[last,top,(top+last)/2,...w.standoffProfile.filter(r=>r.md>=top&&r.md<=last).map(r=>r.md)];
    for(const c of supports) for(const md of [c.md+(c.spec.passport?.length??0)/2000+.02,c.md-(c.spec.passport?.length??0)/2000-length-.02])if(md>=top&&md<=last)candidates.push(md);
    candidates.sort((a,b)=>standoff(b)-standoff(a)||b-a);
    for(const md of [...new Set(candidates)]){
      if(md<top||md>last||overlaps(md))continue;
      const point={...product.point,id:`program-turb-${md.toFixed(6)}`,md};
      if(turbulatorGeometryErrors(w,point).length)continue;
      const flow=calculateTurbulatorFlow(w,point,rate,{id:'program-spacer',name:fluid.name,density:fluid.density,rheology:fluid.rheology});
      if(!flow.valid||!(flow.tangentialMs>0))continue;
      points.push(point);
      // Retain only the influence at the existing centralization samples. Full radial/wake
      // profiles belong to the visualization, not to every candidate retained by the search.
      for(const row of cp.profile)if(swirlRatioAt(flow,row.md)>0)swirlDepths.add(row.md);
      break;
    }
    if(points.length>=2000)break;
  }
  return {design:{...defaultTurbulatorDesign(),points:points.sort((a,b)=>a.md-b.md),rateLps:rate},swirlDepths,
    notes:[points.length ? `Турбулизаторы ${product.identity.model}: ${points.length} шт. в доступных местах; затухание закрутки рассчитано, непрерывное покрытие интервала не предполагается.` : `Турбулизатор ${product.identity.model}: нет допустимых мест при рассчитанном центрировании; изделие не установлено.`]};
}
