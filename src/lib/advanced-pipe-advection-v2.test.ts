import { describe, it, expect } from "vitest";
import { simulatePipeAdvectionV2 } from "./advanced-pipe-advection-v2";
const geom={fromMD:0,toMD:1000,casingODmm:100,defaultWallMm:10,flowRateLps:10,
  sections:[{fromMD:500,toMD:1000,wallThickness:20}]};
const mud={name:"Mud",densityKgM3:1200,rheology:{pv:20,yp:5}};
const water={name:"Water",densityKgM3:1000,rheology:{pv:1,yp:0}};
const cement={name:"Cement",densityKgM3:1850,rheology:{pv:60,yp:8}};
describe("V2 volume-based plug advection",()=>{
  const area80=Math.PI*0.08**2/4, area60=Math.PI*0.06**2/4;
  const cap=500*(area80+area60);
  it("calculates pipe capacity with actual internal diameters",()=>{
    const r=simulatePipeAdvectionV2(geom,mud,[],[0]);
    expect(r.pipeCapacityM3).toBeCloseTo(cap,10);
    expect(r.frames[0].inside).toHaveLength(1);
    expect(r.frames[0].frictionMPa).toBe(0);
  });
  it("transports a fluid front by displaced volume, not averaged diameter",()=>{
    const pumped=250*area80;
    const r=simulatePipeAdvectionV2(geom,mud,[{...water,rateLps:10,volumeM3:pumped}],[pumped/0.6]);
    expect(r.frames[0].inside[0].name).toBe("Water");
    expect(r.frames[0].inside[0].toMD).toBeCloseTo(250,7);
    expect(r.frames[0].inside[1].name).toBe("Mud");
    expect(r.frames[0].inside[1].fromMD).toBeCloseTo(250,7);
  });
  it("crosses casing transition with exact fluid capacity",()=>{
    const pumped=500*area80+100*area60;
    const r=simulatePipeAdvectionV2(geom,mud,[{...water,rateLps:10,volumeM3:pumped}],[pumped/0.6]);
    expect(r.frames[0].inside[0].toMD).toBeCloseTo(600,7);
  });
  it("orders consecutive fluids and accounts for volumes exiting the bottom",()=>{
    const r=simulatePipeAdvectionV2(geom,mud,[
      {...water,rateLps:10,volumeM3:cap},
      {...cement,rateLps:10,volumeM3:cap/2},
    ],[cap/0.6,1.5*cap/0.6]);
    expect(r.frames[0].inside[0].name).toBe("Water");
    expect(r.frames[1].inside.map(x=>x.name)).toEqual(["Cement","Water"]);
    expect(r.frames[1].exitedM3).toBeCloseTo(cap/2,9);
    expect(r.frames[1].inside[0].toMD).toBeCloseTo(500,7);
  });
  it("rejects missing data and sample times outside operation",()=>{
    expect(()=>simulatePipeAdvectionV2(geom,mud,[{...water,rateLps:0,volumeM3:1}],[0])).toThrow();
    expect(()=>simulatePipeAdvectionV2(geom,mud,[],[1])).toThrow();
  });
});
