import {foamCharts} from '@/lib/foam-chart-data';
import type {FoamReportBundle} from '@/lib/foam-cement-types';
import type {ChartPresentations} from '@/lib/chart-presentation';
import ChartPresentationEditor from './ChartPresentationEditor';
export default function FoamChartGallery({bundle,onPresentationsChange}:{bundle:FoamReportBundle;onPresentationsChange?:(p:ChartPresentations)=>void}){
 const plots=foamCharts(bundle);
 return <div className="space-y-3">
  <ChartPresentationEditor plots={plots} presentations={bundle.chartPresentations} onChange={onPresentationsChange}/>
  <div className="grid xl:grid-cols-2 gap-4">{plots.map(p=><div key={p.plotId} className="overflow-auto border rounded bg-white" role="img" aria-label={p.title}><div className="min-w-[650px] [&_svg]:w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{__html:p.svg}}/></div>)}</div>
 </div>;
}
