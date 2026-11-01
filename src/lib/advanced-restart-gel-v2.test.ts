import {it,expect} from "vitest";
import {calculateRestartGelV2,restartPressureSeriesV2} from "./advanced-restart-gel-v2";
const base={stoppedAtMin:10,restartAtMin:20,baselinePressureMPa:5,
 breakdownVolumeM3:2,intervals:[
 {location:"pipe" as const,fromMD:0,toMD:1000,outerDiameterMm:100,gelStrengthPa:20},
 {location:"annulus" as const,fromMD:0,toMD:1000,outerDiameterMm:200,innerDiameterMm:100,gelStrengthPa:10}
]};
it("converts static gel strength into restart pressure and conserved chart values",()=>{
 const r=calculateRestartGelV2({...base,movingVolumeM3:0});
 expect(r.gelPressureMPa).toBeCloseTo(1.2,9);
 expect(r.initialBreakPressureMPa).toBeCloseTo(6.2,9);
 const series=restartPressureSeriesV2(base,[0,1,2,3]);
 expect(series.map(x=>x.plottedPressureMPa)).toEqual([6.2,5.6,5,5]);
});
it("zero gel strength yields no restart peak",()=>{
 const r=calculateRestartGelV2({...base,movingVolumeM3:0,
 intervals:base.intervals.map(v=>({...v,gelStrengthPa:0}))});
 expect(r.gelPressureMPa).toBe(0);
 expect(r.plottedPressureMPa).toBe(5);
});
it("rejects physically impossible geometries",()=>{
 expect(()=>calculateRestartGelV2({...base,movingVolumeM3:0,intervals:[
 {...base.intervals[1],innerDiameterMm:300}
 ]})).toThrow();
});
