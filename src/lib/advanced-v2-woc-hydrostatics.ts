/** WOC (waiting on cement) hydrostatics from the final V2 annular fluid positions.
 * Cement effective hydrostatic density must be supplied from a documented
 * test/scenario: the simulator cannot infer pressure transmission from slurry density.
 * This is an equilibrium hydrostatic scenario, not a prediction of set time.
 */
import {interpolateTVD,type TrajectoryPoint} from "./cementing-calculations";
import type {AnnulusSegmentV2} from "./advanced-annulus-v2";
export interface WocDensityScenarioV2{
 cementFluidNames:string[];
 cementEffectiveDensityKgM3:number;
 returnPressureMPa?:number;
}
export function calculateWocHydrostaticProfileV2(
 fluids:AnnulusSegmentV2[],trajectory:TrajectoryPoint[],depthsMD:number[],scenario:WocDensityScenarioV2
){
 const {cementFluidNames,cementEffectiveDensityKgM3}=scenario;
 const bp=scenario.returnPressureMPa??0;
 if(!cementFluidNames.length||cementFluidNames.some(n=>!n.trim())||
   !Number.isFinite(cementEffectiveDensityKgM3)||cementEffectiveDensityKgM3<=0||
   !Number.isFinite(bp)||bp<0||fluids.length===0||
   depthsMD.some(d=>!Number.isFinite(d)))throw Error("Invalid WOC scenario");
 const sorted=[...fluids].sort((a,b)=>a.fromMD-b.fromMD);
 for(let i=0;i<sorted.length;i++){
  const s=sorted[i];
  if(!Number.isFinite(s.fromMD)||!Number.isFinite(s.toMD)||s.toMD<=s.fromMD||
   !Number.isFinite(s.densityKgM3)||s.densityKgM3<=0||
   (i>0&&Math.abs(s.fromMD-sorted[i-1].toMD)>1e-7))
   throw Error("Invalid WOC annular intervals");
 }
 const top=sorted[0].fromMD,bottom=sorted[sorted.length-1].toMD;
 if(depthsMD.some(d=>d<top-1e-7||d>bottom+1e-7)||
  trajectory.length<2||trajectory[0].md>top||trajectory[trajectory.length-1].md<bottom)
  throw Error("WOC profile depth outside modeled well");
 if(!sorted.some(s=>cementFluidNames.includes(s.name)))throw Error("No cement in WOC annulus");
 const compute=(md:number)=>{
  let pressureMPa=bp;
  for(const s of sorted){
   const a=Math.max(top,s.fromMD),b=Math.min(md,s.toMD);
   if(b<=a)continue;
   const rho=cementFluidNames.includes(s.name)?cementEffectiveDensityKgM3:s.densityKgM3;
   pressureMPa+=rho*9.81*(interpolateTVD(b,trajectory)-interpolateTVD(a,trajectory))/1e6;
  }
  return {md,tvd:interpolateTVD(md,trajectory),wocHydrostaticMPa:pressureMPa};
 };
 return depthsMD.map(compute);
}
