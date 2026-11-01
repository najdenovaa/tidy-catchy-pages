import {it,expect} from "vitest";
import {summarizeV2FormationChecks} from "./advanced-v2-formation-summary";
const frames=[
 {timeMin:0,profile:[{md:500,tvd:480,pressureMPa:6}]},
 {timeMin:2,profile:[{md:500,tvd:480,pressureMPa:8}]},
 {timeMin:4,profile:[{md:500,tvd:480,pressureMPa:5}]}
];
it("uses maximum for fracture risk and minimum for influx risk",()=>{
 const [z]=summarizeV2FormationChecks(frames,[{name:"Layer",md:500,fractureMPa:7,poreMPa:5.5}]);
 expect(z.fractureMarginMPa).toBe(-1);
 expect(z.poreMarginMPa).toBe(-0.5);
 expect(z.exceedsFracture).toBe(true);
 expect(z.belowPore).toBe(true);
 expect(z.maxAtTimeMin).toBe(2);
 expect(z.minAtTimeMin).toBe(4);
});
it("fails when a zone has no corresponding pressure depth in any frame",()=>{
 expect(()=>summarizeV2FormationChecks(frames,[{name:"Missing",md:600}])).toThrow();
});
