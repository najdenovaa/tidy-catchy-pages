import {rheologyReportFluids,type RheologyReportInput} from './rheology-fluids';
import {rheologyFigure} from './rheology-figure';
import {rheologyHierarchyFigures} from './rheology-hierarchy';
export {rheologyReportFluids,type RheologyReportInput} from './rheology-fluids';
export function rheologyReportFigures(p:RheologyReportInput){return [...rheologyHierarchyFigures(p),...rheologyReportFluids(p).flatMap(f=>[rheologyFigure(f.r,false,f.name,f.appliedR,'rheology-'+f.id+'-flow'),rheologyFigure(f.r,true,f.name,f.appliedR,'rheology-'+f.id+'-residual')].filter((x):x is NonNullable<typeof x>=>!!x))];}
