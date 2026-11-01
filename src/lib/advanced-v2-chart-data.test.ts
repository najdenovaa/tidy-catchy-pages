import {it,expect} from "vitest";
import {toRestartChartDataV2} from "./advanced-v2-chart-data";
import {buildRestartPressureFramesV2} from "./advanced-restart-pressure-frames-v2";
it("passes the very same pressure records to the chart without recomputation",()=>{
 const frames=buildRestartPressureFramesV2(
 [{name:"Before stop",rateLps:10,volumeM3:6,pauseAfterMin:5},{name:"Restart",rateLps:10,volumeM3:6}],
 [{pumpedM3:0,surfacePressureMPa:3,shoePressureMPa:10},{pumpedM3:6,surfacePressureMPa:4,shoePressureMPa:11},{pumpedM3:12,surfacePressureMPa:5,shoePressureMPa:12}],
 [{stageIndex:1,breakdownVolumeM3:2,gelIntervals:[{location:"pipe",fromMD:0,toMD:1000,outerDiameterMm:100,gelStrengthPa:20}]}],
 [12,15,16]);
 expect(toRestartChartDataV2(frames)).toBe(frames);
 expect(frames[0].rateLps).toBe(0);
 expect(frames[1].gelRestartExcessMPa).toBeGreaterThan(0);
 expect(frames[1].surfacePressureMPa).toBeGreaterThan(frames[1].baseSurfacePressureMPa);
});
