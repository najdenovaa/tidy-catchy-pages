import {it,expect} from "vitest";
import {simulateCoupledHydraulicsV2} from "./advanced-coupled-hydraulics-v2";
const f={name:"Mud",densityKgM3:1200,rheology:{pv:20,yp:5}};
const w={name:"Water",densityKgM3:1000,rheology:{pv:1,yp:0}};
const stage={...w,rateLps:10,volumeM3:6,pauseAfterMin:5};
const next={...f,rateLps:10,volumeM3:6};
const config={
 pipe:{fromMD:0,toMD:1000,casingODmm:100,defaultWallMm:10,flowRateLps:10},
 annulus:{topMD:0,shoeMD:1000,previousShoeMD:500,casingODmm:100,previousCasingIDmm:150,holeDiameterMm:200},
 trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}],
 initialPipe:f,initialAnnulus:f,stages:[stage,next],timesMin:[0,25]
};
it("uses exact hydraulic snapshots for chart time points and conserves injected volume",()=>{
 const result=simulateCoupledHydraulicsV2({...config,restartTimeline:{
  stages:[stage,next],timesMin:[10,12,15,16],events:[]}});
 expect(result.frames.map(x=>x.timeMin)).toEqual([0,10,12,15,16,25]);
 expect(result.frames[2].pumpedM3).toBeCloseTo(6);
 expect(result.frames[2].rateLps).toBe(0);
 expect(result.restartPressureFrames![1].baseSurfacePressureMPa).toBeCloseTo(result.frames[2].surfacePressureMPa,8);
 expect(result.frames.every(x=>Math.abs(x.balanceErrorM3)<1e-8)).toBe(true);
});
it("rejects an independently defined restart schedule",()=>{
 expect(()=>simulateCoupledHydraulicsV2({...config,restartTimeline:{
  stages:[{...stage,rateLps:12},next],timesMin:[15],events:[]}})).toThrow();
});
