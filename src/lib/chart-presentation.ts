/** Presentation only: ranges never alter solver results or the exported sample arrays. */
export const PRESENTATION_PLOT_IDS=['combined','combinedDensity','pressures','rate','ecdTime','depthPressure','depthEcd','volumePressure','safeRate','flowRegime','annularFill','selectedDepthPressure','selectedDepthEcd','stopStorage','foamPressure','foamEcd','foamNitrogen','foamBalance','foamDepthPressure','foamDepthQuality','foamDepthDensity','foamPlanFact'] as const;
export type PresentationPlotId=typeof PRESENTATION_PLOT_IDS[number];
export interface ChartRange {min:number;max:number}
export interface ChartPresentation {title?:string;fontFamily?:'sans-serif'|'serif'|'monospace';fontSize?:number;x?:ChartRange;left?:ChartRange;right?:ChartRange;basis?:{x:string;left:string;right?:string}}
export type ChartPresentations=Partial<Record<PresentationPlotId,ChartPresentation>>;
export function validChartRange(v:unknown):v is ChartRange {
 if(!v||typeof v!=='object')return false;const x=v as ChartRange;
 return Number.isFinite(x.min)&&Number.isFinite(x.max)&&Math.abs(x.min)<=1e9&&Math.abs(x.max)<=1e9&&x.max-x.min>=1e-6;
}
export function normalizeChartPresentation(v:unknown):ChartPresentation|undefined {
 if(!v||typeof v!=='object')return;const x=v as ChartPresentation,out:ChartPresentation={};
 if(typeof x.title==='string'&&x.title.trim())out.title=x.title.trim().slice(0,120);
 if(['sans-serif','serif','monospace'].includes(x.fontFamily!))out.fontFamily=x.fontFamily;
 if(Number.isInteger(x.fontSize)&&x.fontSize!>=10&&x.fontSize!<=20)out.fontSize=x.fontSize;
 if(x.basis&&typeof x.basis.x==='string'&&x.basis.x.length<=120&&typeof x.basis.left==='string'&&x.basis.left.length<=120){
  out.basis={x:x.basis.x,left:x.basis.left,...(typeof x.basis.right==='string'&&x.basis.right.length<=120?{right:x.basis.right}:{})};
  for(const key of ['x','left','right'] as const)if((key!=='right'||out.basis.right)&&validChartRange(x[key]))out[key]={min:x[key]!.min,max:x[key]!.max};
 }
 return Object.keys(out).some(k=>k!=='basis')?out:undefined;
}
export function normalizeChartPresentations(v:unknown):ChartPresentations {
 if(!v||typeof v!=='object')return {};const out:ChartPresentations={};
 for(const id of PRESENTATION_PLOT_IDS){const p=normalizeChartPresentation((v as ChartPresentations)[id]);if(p)out[id]=p;}
 return out;
}
export function resolveChartPresentation(v:unknown,basis:{x:string;left:string;right?:string}){
 const p=normalizeChartPresentation(v),ignored:('x'|'left'|'right')[]=[],ranges:Partial<Record<'x'|'left'|'right',ChartRange>>={};
 for(const key of ['x','left','right'] as const)if(p?.[key]){if(p.basis?.[key]===basis[key])ranges[key]=p[key];else ignored.push(key);}
 return {presentation:p,ranges,ignored};
}
