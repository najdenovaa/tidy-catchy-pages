import {it,expect} from "vitest";
import {calculateWocHydrostaticProfileV2} from "./advanced-v2-woc-hydrostatics";
import {simulateCoupledHydraulicsV2} from "./advanced-coupled-hydraulics-v2";
const mud={name:"Mud",densityKgM3:1200,rheology:{pv:20,yp:5}};
const cement={name:"Cement",densityKgM3:1850,rheology:{pv:65,yp:9}};
const trajectory=[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}];
it("computes only documented post-setting hydrostatic density and preserves non-cement density",()=>{
 const fluids=[
  {...mud,fromMD:0,toMD:500},
  {...cement,fromMD:500,toMD:1000}
 ];
 const result=calculateWocHydrostaticProfileV2(fluids,trajectory,[0,500,1000],
  {cementFluidNames:["Cement"],cementEffectiveDensityKgM3:1000});
 expect(result[0].wocHydrostaticMPa).toBe(0);
 expect(result[1].wocHydrostaticMPa).toBeCloseTo(1200*9.81*500/1e6,9);
 expect(result[2].wocHydrostaticMPa).toBeCloseTo((1200+1000)*9.81*500/1e6,9);
 expect(()=>calculateWocHydrostaticProfileV2(fluids,trajectory,[1000],
  {cementFluidNames:["Cement"],cementEffectiveDensityKgM3:0})).toThrow();
});
it("uses final annular fluid distribution in the coupled V2 WOC scenario",()=>{
 const result=simulateCoupledHydraulicsV2({
  pipe:{fromMD:0,toMD:1000,casingODmm:100,defaultWallMm:10,flowRateLps:10},
  annulus:{topMD:0,shoeMD:1000,previousShoeMD:500,casingODmm:100,previousCasingIDmm:150,holeDiameterMm:200},
  trajectory,initialPipe:mud,initialAnnulus:mud,
  stages:[{...cement,volumeM3:30,rateLps:10}],timesMin:[0,50],
  wocScenario:{cementFluidNames:["Cement"],cementEffectiveDensityKgM3:1000}
 });
 expect(result.wocProfile).not.toBeNull();
 expect(result.wocProfile![0].wocHydrostaticMPa).toBe(0);
 expect(result.wocProfile!.at(-1)!.wocHydrostaticMPa).toBeLessThan(
  result.frames.at(-1)!.annulusHydrostaticMPa);
 expect(result.frames.at(-1)!.balanceErrorM3).toBeCloseTo(0,8);
});
