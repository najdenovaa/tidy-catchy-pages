/**
 * Experimental V2 annulus — incompressible plug flow, two concentric annular sections.
 * Positive flow travels from shoe to surface. No mixing, leakoff, compressibility,
 * restrictions, surge/swab or local losses. Hydrostatics use TVD; friction uses MD.
 */
import { annularFrictionMPa, interpolateTVD, type Rheology, type TrajectoryPoint } from "./cementing-calculations";
import type { PumpStageV2 } from "./advanced-pipe-advection-v2";

export interface AnnulusGeometryV2 {
  topMD: number; shoeMD: number; previousShoeMD: number;
  casingODmm: number; previousCasingIDmm: number; holeDiameterMm: number;
  standoffPct?: number;
}
export interface AnnulusFluidV2 { name: string; densityKgM3: number; rheology: Rheology }
export interface AnnulusSegmentV2 extends AnnulusFluidV2 { fromMD: number; toMD: number }
export interface AnnulusResultV2 {
  capacityM3: number; enteredM3: number; returnedM3: number;
  fluids: AnnulusSegmentV2[]; hydrostaticMPa: number; frictionMPa: number;
  bottomPressureRelativeToReturnMPa: number;
  model: "two-section-quasi-steady";
}

export function calculateAnnulusV2(
  geometry: AnnulusGeometryV2, initial: AnnulusFluidV2, stages: PumpStageV2[],
  shoeExitedM3: number, flowRateLps: number, trajectory: TrajectoryPoint[],
): AnnulusResultV2 {
  const g=geometry;
  const nums=[g.topMD,g.shoeMD,g.previousShoeMD,g.casingODmm,g.previousCasingIDmm,
    g.holeDiameterMm,shoeExitedM3,flowRateLps,g.standoffPct??100];
  if(nums.some(x=>!Number.isFinite(x)) || g.topMD<0 || g.shoeMD<=g.topMD ||
    g.previousShoeMD<g.topMD || g.previousShoeMD>g.shoeMD ||
    g.casingODmm<=0 || g.previousCasingIDmm<=g.casingODmm || g.holeDiameterMm<=g.casingODmm ||
    shoeExitedM3<0 || flowRateLps<0 || (g.standoffPct??100)<0 || (g.standoffPct??100)>100)
    throw new Error("Invalid annulus geometry or flow");
  const checkFluid=(f:AnnulusFluidV2)=>{
    if(!f.name?.trim()||![f.densityKgM3,f.rheology?.pv,f.rheology?.yp].every(Number.isFinite)||
      f.densityKgM3<=0||f.rheology.pv<0||f.rheology.yp<0)throw new Error("Invalid annulus fluid");
  };
  checkFluid(initial); stages.forEach(s=>{checkFluid(s);if(!Number.isFinite(s.volumeM3)||s.volumeM3<=0)throw new Error("Invalid stage volume");});
  if(trajectory.length<2||trajectory.some((p,i)=>!Number.isFinite(p.md)||!Number.isFinite(p.tvd)||(i>0&&p.md<=trajectory[i-1].md))||
    trajectory[0].md>g.topMD||trajectory[trajectory.length-1].md<g.shoeMD)
    throw new Error("Incomplete annulus trajectory");
  // Volume coordinate measured upward from the shoe.
  const pieces=[
    {top:g.previousShoeMD,bottom:g.shoeMD,outer:g.holeDiameterMm},
    {top:g.topMD,bottom:g.previousShoeMD,outer:g.previousCasingIDmm},
  ].filter(s=>s.bottom>s.top);
  let capacityM3=0;
  const geom=pieces.map(p=>{
    const area=Math.PI*(p.outer*p.outer-g.casingODmm*g.casingODmm)/4e6;
    const start=capacityM3;capacityM3+=(p.bottom-p.top)*area;
    return {...p,area,start,end:capacityM3};
  });
  const depthAt=(v:number)=>{
    if(v<=0)return g.shoeMD;
    if(v>=capacityM3)return g.topMD;
    const p=geom.find(x=>v<=x.end+1e-10)!;
    return p.bottom-(v-p.start)/p.area;
  };
  let start=0;
  const batches=stages.map(s=>{const b={start,end:start+s.volumeM3,fluid:s};start=b.end;return b;});
  // Fluid injected before the operation occupies the pipe first, then enters the annulus.
  // Caller supplies shoeExitedM3, NOT total surface-pumped volume.
  const e=shoeExitedM3;
  const atBottom:{lo:number;hi:number;fluid:AnnulusFluidV2}[]=[];
  const latest=Math.min(e,capacityM3);
  // The initially present pipe fluid must be supplied as the first entering batch by the caller.
  for(const b of batches){
    const hi=Math.min(e,b.end),lo=Math.min(e,b.start);
    if(hi<=lo)continue;
    const bottom=Math.max(0,e-hi),top=Math.min(capacityM3,e-lo);
    if(top>bottom+1e-10)atBottom.push({lo:bottom,hi:top,fluid:b.fluid});
  }
  const supplied=atBottom.reduce((v,s)=>v+s.hi-s.lo,0);
  // Fail closed if provided exit history does not account for all fluid entering annulus.
  if(e>0 && Math.abs(supplied-latest)>1e-7)
    throw new Error("Shoe exit history incomplete; include initial pipe fluid as a batch");
  if(e<capacityM3)atBottom.push({lo:e,hi:capacityM3,fluid:initial});
  const fluids:AnnulusSegmentV2[]=[];
  for(const b of atBottom){
    const bounds=[...new Set([b.lo,b.hi,...geom.flatMap(x=>[x.start,x.end].filter(v=>v>b.lo&&v<b.hi))])].sort((a,c)=>a-c);
    for(let i=1;i<bounds.length;i++){
      const fromMD=depthAt(bounds[i]),toMD=depthAt(bounds[i-1]);
      fluids.push({...b.fluid,fromMD,toMD});
    }
  }
  fluids.sort((a,b)=>a.fromMD-b.fromMD);
  let hydrostaticMPa=0,frictionMPa=0;
  for(const f of fluids){
    const cuts=[f.fromMD,f.toMD,...trajectory.map(p=>p.md).filter(d=>d>f.fromMD&&d<f.toMD),
      g.previousShoeMD].filter(d=>d>=f.fromMD&&d<=f.toMD).sort((a,b)=>a-b);
    for(let i=1;i<cuts.length;i++){
      const top=cuts[i-1],bottom=cuts[i];
      if(bottom<=top)continue;
      const dTvd=interpolateTVD(bottom,trajectory)-interpolateTVD(top,trajectory);
      hydrostaticMPa+=f.densityKgM3*9.81*dTvd/1e6;
      const outer=(top+bottom)/2>=g.previousShoeMD?g.holeDiameterMm:g.previousCasingIDmm;
      frictionMPa+=annularFrictionMPa(flowRateLps,bottom-top,outer,g.casingODmm,
        f.rheology.pv,f.rheology.yp,f.densityKgM3,g.standoffPct??100).pressureMPa;
    }
  }
  return {capacityM3,enteredM3:e,returnedM3:Math.max(0,e-capacityM3),
    fluids,hydrostaticMPa,frictionMPa,
    bottomPressureRelativeToReturnMPa:hydrostaticMPa+frictionMPa,
    model:"two-section-quasi-steady"};
}
