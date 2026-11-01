import {it,expect} from "vitest";
import {simulateCoupledHydraulicsV2} from "./advanced-coupled-hydraulics-v2";
import {projectV2CorePressurePoints} from "./advanced-v2-pressure-projection";
it("projects fluid density, actual stage and static pressure from unified V2 output",()=>{
 const mud={name:"Mud",densityKgM3:1200,rheology:{pv:20,yp:5}};
 const spacer={name:"Spacer",densityKgM3:1000,rheology:{pv:1,yp:0}};
 const result=simulateCoupledHydraulicsV2({
  pipe:{fromMD:0,toMD:1000,casingODmm:100,defaultWallMm:10,flowRateLps:10},
  annulus:{topMD:0,shoeMD:1000,previousShoeMD:500,casingODmm:100,previousCasingIDmm:150,holeDiameterMm:200},
  trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}],
  initialPipe:mud,initialAnnulus:mud,
  stages:[{...spacer,rateLps:10,volumeM3:6,pauseAfterMin:5},{...mud,rateLps:10,volumeM3:6}],
  timesMin:[0,1,10,12,15,16,25]
 });
 const points=projectV2CorePressurePoints(result,500);
 expect(points[1].stage).toBe("Spacer");
 expect(points[1].densityGcm3).toBeCloseTo(1,8);
 expect(points[3].stage).toBe("Остановка насосов");
 expect(points[3].densityGcm3).toBeNull();
 expect(points[4].stage).toBe("Mud");
 expect(points[5].densityGcm3).toBeCloseTo(1.2,8);
 for(let i=0;i<points.length;i++){
  expect(points[i].surfaceStaticMPa).toBeCloseTo(
   result.frames[i].shoePressureMPa-result.frames[i].annulusFrictionMPa-result.frames[i].pipeHydrostaticMPa,8);
 }
});
