import {it,expect} from "vitest";
import {buildRestartPressureFramesV2} from "./advanced-restart-pressure-frames-v2";
const stages=[{name:"Buffer",rateLps:10,volumeM3:6,pauseAfterMin:5},{name:"Cement",rateLps:10,volumeM3:6}];
const samples=[{pumpedM3:0,surfacePressureMPa:3,shoePressureMPa:12},
 {pumpedM3:6,surfacePressureMPa:4,shoePressureMPa:13},
 {pumpedM3:12,surfacePressureMPa:5,shoePressureMPa:14}];
const events=[{stageIndex:1,breakdownVolumeM3:3,gelIntervals:[
 {location:"pipe" as const,fromMD:0,toMD:1000,outerDiameterMm:100,gelStrengthPa:20}
]}];
it("one chart series retains volume in stop and includes gel breakout peak at restart",()=>{
 const f=buildRestartPressureFramesV2(stages,samples,events,[9,12,15,16,20,25]);
 expect(f[1].phase).toBe("stopped");
 expect(f[1].pumpedM3).toBe(6);
 expect(f[1].gelRestartExcessMPa).toBe(0);
 expect(f[2].surfacePressureMPa).toBeCloseTo(4.8,7);
 expect(f[2].shoePressureMPa).toBeCloseTo(13,7);
 expect(f[3].gelRestartExcessMPa).toBeGreaterThan(0);
 expect(f[4].gelRestartExcessMPa).toBeCloseTo(0,7);
 expect(f[5].pumpedM3).toBeCloseTo(12,7);
});
it("restart requires a corresponding stop",()=>{
 expect(()=>buildRestartPressureFramesV2(
 [{name:"No stop",rateLps:10,volumeM3:6},{name:"Next",rateLps:10,volumeM3:6}],
 samples,events,[11])).toThrow();
});

it("maps restart to paused preceding stage, even when earlier stages had no pauses",()=>{
 const ss=[{name:"A",rateLps:10,volumeM3:6},{name:"B",rateLps:10,volumeM3:6,pauseAfterMin:4},{name:"C",rateLps:10,volumeM3:6}];
 const ps=[...samples,{pumpedM3:18,surfacePressureMPa:6,shoePressureMPa:15}];
 const e=[{...events[0],stageIndex:2}];
 const frames=buildRestartPressureFramesV2(ss,ps,e,[23,24,25]);
 expect(frames[0].phase).toBe("stopped");
 expect(frames[1].gelRestartExcessMPa).toBeCloseTo(0.8,8);
 expect(frames[2].gelRestartExcessMPa).toBeLessThan(0.8);
});
