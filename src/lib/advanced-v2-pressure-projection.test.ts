import { expect,it } from "vitest";
import { simulateCoupledHydraulicsV2 } from "./advanced-coupled-hydraulics-v2";
import { projectV2CorePressurePoints } from "./advanced-v2-pressure-projection";
it("projects exact coupled V2 pressure and return values without fake legacy fields",()=>{
 const fluid={name:"Mud",densityKgM3:1200,rheology:{pv:20,yp:5}};
 const trajectory=[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}];
 const result=simulateCoupledHydraulicsV2({
  pipe:{fromMD:0,toMD:1000,casingODmm:100,defaultWallMm:10,flowRateLps:10},
  annulus:{topMD:0,shoeMD:1000,previousShoeMD:500,casingODmm:100,previousCasingIDmm:150,holeDiameterMm:200},
  trajectory,initialPipe:fluid,initialAnnulus:fluid,
  stages:[{...fluid,rateLps:10,volumeM3:6}],timesMin:[0,5]
 });
 const points=projectV2CorePressurePoints(result,500);
 expect(points).toHaveLength(result.frames.length);
 points.forEach((p,i)=>{
  const f=result.frames[i];
  expect(p.surfacePressure).toBe(f.surfacePressureMPa);
  expect(p.bottomholePressure).toBe(f.shoePressureMPa);
  expect(p.annularReturnVolumeM3).toBe(f.pumpedM3);
  expect(p.ecdAtBottomGcm3).toBeCloseTo(f.profile[f.profile.length-1].ecdGcm3!,8);
  expect("freefallSettledM3" in p).toBe(false);
 });
 expect(()=>projectV2CorePressurePoints(result,1200)).toThrow();
});
