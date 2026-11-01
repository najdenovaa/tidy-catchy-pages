import { describe, expect, it } from "vitest";
import { calculatePipePressureProfileV2 } from "./advanced-pipe-pressure-v2";
import { pipeFrictionMPa } from "./cementing-calculations";
const geometry={fromMD:0,toMD:1000,casingODmm:168.3,defaultWallMm:8.9,flowRateLps:2,
  sections:[{fromMD:500,toMD:1000,wallThickness:12}]};
const water={name:"Water",densityKgM3:1000,rheology:{pv:1,yp:0}};
const cement={name:"Cement",densityKgM3:1800,rheology:{pv:60,yp:8}};
const vertical=[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}];
describe("V2 hydrostatic and friction pressure integration",()=>{
  it("computes static hydrostatic head of a vertical single-fluid column",()=>{
    const r=calculatePipePressureProfileV2({...geometry,flowRateLps:0},
      [{...water,fromMD:0,toMD:1000}],vertical);
    expect(r.bottomHydrostaticMPa).toBeCloseTo(9.81,10);
    expect(r.bottomFrictionMPa).toBe(0);
    expect(r.bottomPressureRelativeToInletMPa).toBeCloseTo(9.81,10);
  });
  it("integrates separate fluid densities over their own vertical intervals",()=>{
    const r=calculatePipePressureProfileV2({...geometry,flowRateLps:0},[
      {...water,fromMD:0,toMD:400},{...cement,fromMD:400,toMD:1000}],vertical);
    expect(r.bottomHydrostaticMPa).toBeCloseTo((1000*400+1800*600)*9.81/1e6,10);
  });
  it("integrates hydrostatic pressure by TVD rather than MD",()=>{
    const r=calculatePipePressureProfileV2({...geometry,flowRateLps:0},[
      {...water,fromMD:0,toMD:500},{...cement,fromMD:500,toMD:1000}],
      [{md:0,tvd:0,zenith:0,azimuth:0},{md:500,tvd:400,zenith:0,azimuth:0},{md:1000,tvd:600,zenith:0,azimuth:0}]);
    expect(r.bottomHydrostaticMPa).toBeCloseTo((1000*400+1800*200)*9.81/1e6,10);
  });
  it("subtracts sectional friction from inlet-to-bottom pressure for downward pumping",()=>{
    const r=calculatePipePressureProfileV2(geometry,[
      {...water,fromMD:0,toMD:500},{...cement,fromMD:500,toMD:1000}],vertical);
    const reference=pipeFrictionMPa(2,500,150.5,1,0,1000).pressureMPa
      +pipeFrictionMPa(2,500,144.3,60,8,1800).pressureMPa;
    expect(r.bottomFrictionMPa).toBeCloseTo(reference,9);
    expect(r.bottomPressureRelativeToInletMPa).toBeCloseTo(r.bottomHydrostaticMPa-reference,9);
    expect(r.nodes.map(n=>n.md)).toEqual([0,500,1000]);
  });
  it("rejects incomplete trajectory and fluid gaps",()=>{
    expect(()=>calculatePipePressureProfileV2(geometry,[{...water,fromMD:0,toMD:1000}],[])).toThrow();
    expect(()=>calculatePipePressureProfileV2(geometry,[{...water,fromMD:0,toMD:900}],vertical)).toThrow();
    expect(()=>calculatePipePressureProfileV2(geometry,[{...water,fromMD:0,toMD:1000}],vertical,[1001])).toThrow();
  });
});
