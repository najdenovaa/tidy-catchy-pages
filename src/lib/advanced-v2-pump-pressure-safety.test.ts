import {describe,it,expect} from "vitest";
import {buildRestartPressureFramesV2} from "./advanced-restart-pressure-frames-v2";
import {assessV2RestartPumpSafety} from "./advanced-v2-pump-pressure-safety";
describe("V2 restart pump pressure safety",()=>{
 const frames=buildRestartPressureFramesV2(
  [{name:"First",rateLps:10,volumeM3:6,pauseAfterMin:5},{name:"Second",rateLps:10,volumeM3:6}],
  [{pumpedM3:0,surfacePressureMPa:4,shoePressureMPa:10},
   {pumpedM3:6,surfacePressureMPa:5,shoePressureMPa:11},
   {pumpedM3:12,surfacePressureMPa:6,shoePressureMPa:12}],
  [{stageIndex:1,breakdownVolumeM3:2,gelIntervals:[
   {location:"pipe",fromMD:0,toMD:1000,outerDiameterMm:100,gelStrengthPa:50}]}],
  [12,15,16,20,25]);
 it("detects restart gel peak over equipment working pressure",()=>{
  const r=assessV2RestartPumpSafety(frames,6);
  expect(r.peakSurfacePressureMPa).toBeCloseTo(7,7);
  expect(r.peakAtTimeMin).toBe(15);
  expect(r.exceedsEquipmentLimit).toBe(true);
  expect(r.minimumPressureMarginMPa).toBeCloseTo(-1,7);
 });
 it("does not confuse surface breakout with bottomhole pressure",()=>{
  expect(frames[1].surfacePressureMPa).toBeGreaterThan(frames[1].shoePressureMPa-5);
  expect(frames[1].shoePressureMPa).toBe(11);
 });
 it("rejects invalid pressure rating and absent samples",()=>{
  expect(()=>assessV2RestartPumpSafety(frames,0)).toThrow();
  expect(()=>assessV2RestartPumpSafety([],12)).toThrow();
 });
});
