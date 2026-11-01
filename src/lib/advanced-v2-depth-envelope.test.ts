import {it,expect} from "vitest";
import {simulateCoupledHydraulicsV2} from "./advanced-coupled-hydraulics-v2";
it("uses the same V2 depth-grid hydrostatic values in pressure and WOC envelope",()=>{
 const mud={name:"Mud",densityKgM3:1200,rheology:{pv:20,yp:5}};
 const cement={name:"Cement",densityKgM3:1850,rheology:{pv:65,yp:9}};
 const result=simulateCoupledHydraulicsV2({
  pipe:{fromMD:0,toMD:1000,casingODmm:100,defaultWallMm:10,flowRateLps:10},
  annulus:{topMD:0,shoeMD:1000,previousShoeMD:500,casingODmm:100,previousCasingIDmm:150,holeDiameterMm:200},
  trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}],
  initialPipe:mud,initialAnnulus:mud,
  stages:[{...cement,rateLps:10,volumeM3:30}],timesMin:[0,25,50],
  wocScenario:{cementFluidNames:["Cement"],cementEffectiveDensityKgM3:1000}
 });
 expect(result.depthEnvelope.length).toBe(result.pressureEnvelope.length);
 for(const e of result.depthEnvelope){
  const samples=result.frames.map(f=>f.profile.find(x=>x.md===e.md)!);
  expect(e.minHydrostaticMPa).toBeCloseTo(Math.min(...samples.map(x=>x.hydrostaticPressureMPa)),8);
  expect(e.wocHydrostaticMPa).toBeCloseTo(result.wocProfile!.find(x=>x.md===e.md)!.wocHydrostaticMPa,8);
  samples.forEach(p=>expect(p.hydrostaticPressureMPa+p.frictionPressureMPa).toBeCloseTo(p.pressureMPa,8));
 }
});
