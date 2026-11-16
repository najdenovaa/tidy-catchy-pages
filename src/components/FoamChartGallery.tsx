import {foamCharts} from '@/lib/foam-chart-data';
import type {FoamReportBundle} from '@/lib/foam-cement-types';
export default function FoamChartGallery({bundle}:{bundle:FoamReportBundle}){return <div className="grid xl:grid-cols-2 gap-4">{foamCharts(bundle).map(p=><div key={p.plotId} className="overflow-auto border rounded bg-white" role="img" aria-label={p.title}><div className="min-w-[650px] [&_svg]:w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{__html:p.svg}}/></div>)}</div>;}
