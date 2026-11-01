/** V2 exact sectional annular geometry. Depth in MD, diameters in mm. */
import { annularFrictionMPa, type Rheology } from "./cementing-calculations";

export interface AnnularDiameterIntervalV2 {
  fromMD:number;
  toMD:number;
  outerDiameterMm:number;
}
export interface AnnularGeometryV2 {
  fromMD:number;
  toMD:number;
  casingODmm:number;
  defaultOuterDiameterMm:number;
  diameterIntervals?:AnnularDiameterIntervalV2[];
}
export interface AnnularGeometrySegmentV2 {
  fromMD:number;toMD:number;outerDiameterMm:number;innerDiameterMm:number;
  areaM2:number;volumeM3:number;hydraulicDiameterMm:number;
}
export function sectionalAnnularGeometryV2(g:AnnularGeometryV2):AnnularGeometrySegmentV2[]{
  const vals=[g.fromMD,g.toMD,g.casingODmm,g.defaultOuterDiameterMm];
  if(vals.some(v=>!Number.isFinite(v))||g.fromMD<0||g.toMD<=g.fromMD||
    g.casingODmm<=0||g.defaultOuterDiameterMm<=g.casingODmm)throw Error("Invalid annular geometry");
  const iv=[...(g.diameterIntervals??[])].sort((a,b)=>a.fromMD-b.fromMD);
  for(let i=0;i<iv.length;i++){
    const s=iv[i];
    if(![s.fromMD,s.toMD,s.outerDiameterMm].every(Number.isFinite)||s.fromMD<0||
      s.toMD<=s.fromMD||s.outerDiameterMm<=g.casingODmm||
      (i>0&&s.fromMD<iv[i-1].toMD))throw Error("Overlapping or nonphysical annular diameters");
  }
  const bounds=[g.fromMD,g.toMD,...iv.flatMap(s=>[s.fromMD,s.toMD].filter(d=>d>g.fromMD&&d<g.toMD))]
    .sort((a,b)=>a-b).filter((d,i,all)=>i===0||d>all[i-1]);
  return bounds.slice(1).map((end,i)=>{
    const start=bounds[i],mid=(start+end)/2;
    const outerDiameterMm=iv.find(s=>mid>=s.fromMD&&mid<s.toMD)?.outerDiameterMm??g.defaultOuterDiameterMm;
    const areaM2=Math.PI*(outerDiameterMm**2-g.casingODmm**2)/4e6;
    return {fromMD:start,toMD:end,outerDiameterMm,innerDiameterMm:g.casingODmm,
      areaM2,volumeM3:(end-start)*areaM2,
      hydraulicDiameterMm:outerDiameterMm-g.casingODmm};
  });
}
export function sectionalAnnulusFrictionV2(
  g:AnnularGeometryV2,flowRateLps:number,densityKgM3:number,
  rheology:Rheology,standoffPct=100
):{volumeM3:number;pressureLossMPa:number;segments:AnnularGeometrySegmentV2[]} {
  if(![flowRateLps,densityKgM3,rheology.pv,rheology.yp,standoffPct].every(Number.isFinite)||
    flowRateLps<0||densityKgM3<=0||rheology.pv<0||rheology.yp<0||
    standoffPct<0||standoffPct>100)throw Error("Invalid annular fluid conditions");
  const segments=sectionalAnnularGeometryV2(g);
  const pressureLossMPa=segments.reduce((sum,s)=>sum+annularFrictionMPa(flowRateLps,
    s.toMD-s.fromMD,s.outerDiameterMm,s.innerDiameterMm,rheology.pv,rheology.yp,
    densityKgM3,standoffPct).pressureMPa,0);
  return {volumeM3:segments.reduce((sum,s)=>sum+s.volumeM3,0),pressureLossMPa,segments};
}
