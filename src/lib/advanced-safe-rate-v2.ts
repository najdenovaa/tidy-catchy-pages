/** Safe annular flow-rate upper bound for a FIXED instantaneous fluid distribution.
 * Quasi-steady, incompressible, upward flow, no leakoff. Conservative pressure margin.
 * Not valid as an unconditional limit throughout a changing pumping programme.
 */
import { calculateAnnulusV2, type AnnulusGeometryV2, type AnnulusFluidV2 } from "./advanced-annulus-v2";
import { annularFrictionMPa, interpolateTVD, type TrajectoryPoint } from "./cementing-calculations";
import type { PumpStageV2 } from "./advanced-pipe-advection-v2";

export interface SafeRateZoneV2 { name:string; md:number; pressureLimitMPa:number }
export interface SafeRateInputV2 {
 annulus:AnnulusGeometryV2; initialAnnulus:AnnulusFluidV2; shoeStream:PumpStageV2[];
 shoeExitedM3:number; trajectory:TrajectoryPoint[]; zones:SafeRateZoneV2[];
 maxRateLps:number; marginMPa?:number; returnPressureMPa?:number;
}
export function calculateSafeAnnularRateV2(input:SafeRateInputV2):{
 maxSafeRateLps:number; limitingZone:string|null;
 staticViolation:boolean; maxRateLps:number;
 pressuresAtLimit:Array<{name:string;pressureMPa:number;allowableMPa:number}>;
}{
 const {annulus:g,trajectory,zones}=input;
 const margin=input.marginMPa??0,back=input.returnPressureMPa??0;
 if(![input.maxRateLps,margin,back].every(Number.isFinite)||input.maxRateLps<=0||margin<0||back<0)
  throw Error("Invalid safe-flow inputs");
 const fluid=calculateAnnulusV2(g,input.initialAnnulus,input.shoeStream,input.shoeExitedM3,0,trajectory);
 if(!zones.length)throw Error("At least one formation pressure limit is required");
 zones.forEach(z=>{
  if(!z.name.trim()||![z.md,z.pressureLimitMPa].every(Number.isFinite)||
   z.md<g.topMD||z.md>g.shoeMD||z.pressureLimitMPa<=0)throw Error("Invalid formation limit");
 });
 function pressures(q:number){
  return zones.map(z=>{
   let p=back;
   for(const f of fluid.fluids){
    const top=f.fromMD,bottom=Math.min(f.toMD,z.md);
    if(bottom<=top)continue;
    const pieces=[top,bottom,...[g.previousShoeMD].filter(d=>d>top&&d<bottom)].sort((a,b)=>a-b);
    for(let i=1;i<pieces.length;i++){
     const from=pieces[i-1],to=pieces[i],mid=(from+to)/2;
     p+=f.densityKgM3*9.81*(interpolateTVD(to,trajectory)-interpolateTVD(from,trajectory))/1e6;
     const outer=mid>=g.previousShoeMD?g.holeDiameterMm:g.previousCasingIDmm;
     p+=annularFrictionMPa(q,to-from,outer,g.casingODmm,f.rheology.pv,f.rheology.yp,
      f.densityKgM3,g.standoffPct??100).pressureMPa;
    }
   }
   return {name:z.name,pressureMPa:p,allowableMPa:z.pressureLimitMPa-margin};
  });
 }
 const feasible=(q:number)=>pressures(q).every(v=>v.pressureMPa<=v.allowableMPa+1e-9);
 const staticViolation=!feasible(0);
 let limit=0;
 if(!staticViolation){
  if(feasible(input.maxRateLps))limit=input.maxRateLps;
  else{
   let lo=0,hi=input.maxRateLps;
   for(let k=0;k<34;k++){const mid=(lo+hi)/2;if(feasible(mid))lo=mid;else hi=mid;}
   limit=lo;
  }
 }
 const at=pressures(limit);
 const worst=at.reduce((a,b)=>a.allowableMPa-a.pressureMPa<b.allowableMPa-b.pressureMPa?a:b);
 return {maxSafeRateLps:limit,limitingZone:worst.name,staticViolation,maxRateLps:input.maxRateLps,pressuresAtLimit:at};
}
