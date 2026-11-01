import { describe, expect, it } from "vitest";
import { simulatePipePressureTimelineV2 } from "./advanced-pipe-timeline-v2";
const g={fromMD:0,toMD:1000,casingODmm:100,defaultWallMm:10,flowRateLps:10};
const mud={name:"Mud",densityKgM3:1200,rheology:{pv:20,yp:5}};
const water={name:"Water",densityKgM3:1000,rheology:{pv:1,yp:0}};
const trajectory=[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}];
describe("V2 advection and pressure timeline",()=>{
 it("computes hydrostatic change as lighter fluid displaces heavier fluid",()=>{
   const volume=Math.PI*0.08**2/4*1000;
   const result=simulatePipePressureTimelineV2(g,mud,[{...water,rateLps:10,volumeM3:volume}],
     trajectory,[0,volume/(2*0.6),volume/0.6]);
   [11.772,10.791,9.81].forEach((expected,i)=>expect(result.frames[i].pressure.bottomHydrostaticMPa).toBeCloseTo(expected,8));
   expect(result.frames[0].pressure.bottomFrictionMPa).toBe(0);
   expect(result.frames[1].pressure.bottomFrictionMPa).toBeGreaterThan(0);
   expect(result.frames[2].fluids[0].name).toBe("Water");
 });
});
