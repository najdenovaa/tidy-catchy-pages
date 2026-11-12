/** Shared bore geometry. Diameters are mm, MD is m, areas m², volumes m³.
 * A measured diameter is independent of the nominal bit diameter. Legacy K remains relative. */
import type { CavernInterval, WellData } from './cementing-calculations';
export const WELL_GEOMETRY_MODEL_VERSION = 2;
export interface CaliperLog {
  fileName: string; curve: string; importedAt: string;
  depthUnit: string; diameterUnit: string; nominalDiameterMm: number;
  intervalStepM: number; maxGapM: number; intervalsEdited?: boolean;
  samples: {md:number;diameterMm:number|null}[];
}
export type GeometryWell = Pick<WellData,'holeDiameter'|'casingOD'|'prevCasingID'|'prevCasingDepth'|'cavernCoeff'|'cavernIntervals'>;
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0;
export function cavernIntervalCoeff(iv:CavernInterval,nominalDiameterMm:number):number {
  return positive(iv.diameterMm)&&positive(nominalDiameterMm) ? (iv.diameterMm/nominalDiameterMm)**2 : iv.coeff;
}
export function openBoreDiameter(w:GeometryWell,md:number):number {
  const iv=w.cavernIntervals?.find(v=>md>=v.fromMD&&md<v.toMD);
  if(iv&&positive(iv.diameterMm))return iv.diameterMm;
  return w.holeDiameter*Math.sqrt(Math.max(0,iv?.coeff??w.cavernCoeff??1));
}
export function boreDiameterAtDepth(w:GeometryWell & {casingDepthMD?:number},md:number):number {
  if(md>0&&md===w.casingDepthMD)md=Math.max(0,md-1e-7);
  return md<w.prevCasingDepth&&w.prevCasingID>0?w.prevCasingID:openBoreDiameter(w,md);
}
export function scaleCavernInterval(iv:CavernInterval,areaFactor:number,nominalDiameterMm:number,diameterFactor=1):CavernInterval {
  return {...iv,coeff:cavernIntervalCoeff(iv,nominalDiameterMm)*areaFactor,
    ...(positive(iv.diameterMm)?{diameterMm:iv.diameterMm*Math.sqrt(Math.max(0,areaFactor))*diameterFactor}:{})};
}
export interface GeometryCell {topMD:number;bottomMD:number;diameterMm:number;areaM2:number;source:'measured'|'coefficient'|'previous-casing';}
/** Exact piecewise-constant geometry, with prefix volumes and inverse volume-to-MD lookup.
 * First input interval wins for legacy overlaps. Measured gaps use default K, never extrapolation. */
export function createAnnularGeometry(w:GeometryWell,bottomMD:number){
  const end=Math.max(0,bottomMD),bounds=new Set([0,end]);
  const starts=new Map<number,number[]>(),ends=new Map<number,number[]>();
  const add=(m:Map<number,number[]>,d:number,i:number)=>m.set(d,[...(m.get(d)??[]),i]);
  (w.cavernIntervals??[]).forEach((v,i)=>{
    const a=Math.max(0,v.fromMD),b=Math.min(end,v.toMD);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return;
    bounds.add(a);bounds.add(b);add(starts,a,i);add(ends,b,i);
  });
  if(w.prevCasingDepth>0&&w.prevCasingDepth<end)bounds.add(w.prevCasingDepth);
  const depths=[...bounds].sort((a,b)=>a-b),cells:GeometryCell[]=[],prefix=[0],active=new Set<number>();
  for(let i=0;i<depths.length-1;i++){
    const topMD=depths[i],bottomMD=depths[i+1];
    for(const j of ends.get(topMD)??[])active.delete(j);for(const j of starts.get(topMD)??[])active.add(j);
    let first=Infinity;for(const j of active)first=Math.min(first,j);
    const iv=first<Infinity?w.cavernIntervals![first]:undefined,cased=topMD<w.prevCasingDepth&&w.prevCasingID>0;
    const measured=!cased&&positive(iv?.diameterMm);
    const diameterMm=cased?w.prevCasingID:measured?iv!.diameterMm!:w.holeDiameter*Math.sqrt(Math.max(0,iv?.coeff??w.cavernCoeff??1));
    const areaM2=Math.PI/4*Math.max(0,(diameterMm/1000)**2-(w.casingOD/1000)**2);
    cells.push({topMD,bottomMD,diameterMm,areaM2,source:cased?'previous-casing':measured?'measured':'coefficient'});
    prefix.push(prefix[prefix.length-1]+areaM2*(bottomMD-topMD));
  }
  const indexAt=(md:number)=>{
    let lo=0,hi=cells.length;while(lo<hi){const m=(lo+hi)>>1;if(cells[m].bottomMD<=md)lo=m+1;else hi=m;}return Math.min(lo,cells.length-1);
  };
  const cumulative=(md:number)=>{
    const z=Math.max(0,Math.min(end,md));if(!cells.length||z<=0)return 0;if(z>=end)return prefix[prefix.length-1];
    const i=indexAt(z);return prefix[i]+cells[i].areaM2*(z-cells[i].topMD);
  };
  const volume=(top:number,bottom:number)=>Math.max(0,cumulative(bottom)-cumulative(top));
  const depthAboveVolume=(bottom:number,v:number)=>{
    const b=Math.max(0,Math.min(end,bottom)),target=Math.max(0,cumulative(b)-Math.max(0,v));
    if(v<=0)return b;if(target<=0)return 0;
    let lo=0,hi=cells.length;while(lo<hi){const m=(lo+hi)>>1;if(prefix[m+1]<=target)lo=m+1;else hi=m;}
    const i=Math.min(lo,cells.length-1),c=cells[i];return c.areaM2>0?Math.min(b,c.topMD+(target-prefix[i])/c.areaM2):c.topMD;
  };
  const at=(md:number)=>cells.length?cells[indexAt(Math.max(0,Math.min(end,md)))]:undefined;
  return {cells,totalVolume:prefix[prefix.length-1],volume,depthAboveVolume,at};
}
export function normalizeCaliperLog(value:unknown):CaliperLog|undefined{
  if(!value||typeof value!=='object')return undefined;const s=value as Record<string,unknown>;
  if(!Array.isArray(s.samples)||s.samples.length>100000||!positive(s.nominalDiameterMm))return undefined;
  const samples:CaliperLog['samples']=[];
  for(const row of s.samples){
    if(!row||typeof row!=='object')return undefined;const r=row as Record<string,unknown>;
    if(typeof r.md!=='number'||!Number.isFinite(r.md)||r.md<0)return undefined;
    samples.push({md:r.md,diameterMm:typeof r.diameterMm==='number'&&Number.isFinite(r.diameterMm)?r.diameterMm:null});
  }
  if(!samples.length)return undefined;
  const text=(key:string)=>typeof s[key]==='string'?(s[key] as string).slice(0,500):'';
  return {fileName:text('fileName'),curve:text('curve'),importedAt:text('importedAt'),depthUnit:text('depthUnit'),diameterUnit:text('diameterUnit'),nominalDiameterMm:s.nominalDiameterMm,intervalStepM:positive(s.intervalStepM)?s.intervalStepM:5,maxGapM:positive(s.maxGapM)?s.maxGapM:2,samples,...(s.intervalsEdited===true?{intervalsEdited:true}:{})};
}
