import {it,expect} from "vitest";
import {simulateCoupledHydraulicsV2} from "./advanced-coupled-hydraulics-v2";
it("provides a calculated hydrostatic U-tube differential at stop, without inventing passive flow",()=>{
 const mud={name:"Mud",densityKgM3:1200,rheology:{pv:20,yp:5}};
 const water={name:"Water",densityKgM3:1000,rheology:{pv:1,yp:0}};
 const r=simulateCoupledHydraulicsV2({
  pipe:{fromMD:0,toMD:1000,casingODmm:100,defaultWallMm:10,flowRateLps:10},
  annulus:{topMD:0,shoeMD:1000,previousShoeMD:500,casingODmm:100,previousCasingIDmm:150,holeDiameterMm:200},
  trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}],
  initialPipe:mud,initialAnnulus:mud,
  stages:[{...water,rateLps:10,volumeM3:6,pauseAfterMin:5}],
  timesMin:[9,10,12,15]
 });
 const stopped=r.frames[2];
 expect(stopped.rateLps).toBe(0);
 expect(stopped.stopDiagnostics?.resultKind).toBe("static-driving-potential-only");
 expect(stopped.stopDiagnostics?.drivingPressureMPa).toBeCloseTo(
  stopped.pipeHydrostaticMPa-stopped.annulusHydrostaticMPa,6);
 expect(stopped.pumpedM3).toBeCloseTo(r.frames[1].pumpedM3,9);
 expect(stopped.stopDiagnostics?.pumpedVolumeChangeM3).toBe(0);
 expect(r.frames[0].stopDiagnostics).toBeNull();
});
