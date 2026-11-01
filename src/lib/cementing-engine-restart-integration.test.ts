import {expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {getRestartChartFrames} from "./cementing-engine";
import type {PressureProfileResult} from "./cementing-calculations";
it("does not fabricate V2 restart data for V1 pressure results",()=>{
 const result={points:[],envelope:[],zoneChecks:[],safeWorkingTimeMin:0,
  cementStartTime:0,stopTime:0,stageBoundaries:[],equilibriumTimeMin:0} satisfies PressureProfileResult;
 expect(getRestartChartFrames(result)).toBeUndefined();
});
it("the main page passes only canonical engine restart frames into charts",()=>{
 const src=readFileSync(resolve(process.cwd(),"src/pages/Index.tsx"),"utf8");
 expect(src).toContain("restartChartFrames={getRestartChartFrames(pressureResult)}");
 expect(src).not.toContain("simulateCoupledHydraulicsV2(");
});
