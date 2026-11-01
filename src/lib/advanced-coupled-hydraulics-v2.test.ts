import { describe, expect, it } from "vitest";
import { simulateCoupledHydraulicsV2 } from "./advanced-coupled-hydraulics-v2";
import { hydrostaticPressure } from "./cementing-calculations";
const fluid={name:"Mud",densityKgM3:1200,rheology:{pv:20,yp:5}};
const water={name:"Water",densityKgM3:1000,rheology:{pv:1,yp:0}};
const trajectory=[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}];
const pipe={fromMD:0,toMD:1000,casingODmm:100,defaultWallMm:10,flowRateLps:10};
const annulus={topMD:0,shoeMD:1000,previousShoeMD:500,casingODmm:100,previousCasingIDmm:150,holeDiameterMm:200};
const c=Math.PI*.08**2/4*1000;
const common={pipe,annulus,trajectory,initialPipe:fluid,initialAnnulus:fluid};
describe("coupled hydraulics V2: analytical and volume benchmarks",()=>{
 it("at rest matches V1 hydrostatic head and produces zero surface differential",()=>{
  const r=simulateCoupledHydraulicsV2({...common,stages:[],timesMin:[0]});
  expect(r.frames[0].shoePressureMPa).toBeCloseTo(hydrostaticPressure(1.2,1000),9);
  expect(r.frames[0].surfacePressureMPa).toBeCloseTo(0,9);
  expect(r.frames[0].balanceErrorM3).toBeCloseTo(0,9);
 });
 it("the initial pipe fluid exits shoe immediately, with strict volume balance",()=>{
  const r=simulateCoupledHydraulicsV2({...common,stages:[{...water,rateLps:10,volumeM3:c*1.1}],timesMin:[0,c/(2*.6),c*1.1/.6]});
  expect(r.frames[1].shoeExitedM3).toBeCloseTo(c/2,9);
  expect(r.frames[1].returnedM3).toBe(0);
  expect(r.frames[2].shoeExitedM3).toBeCloseTo(c*1.1,9);
  r.frames.forEach(f=>expect(Math.abs(f.balanceErrorM3)).toBeLessThan(1e-8));
 });
 it("returns start at the annular capacity, and weak-formation margins are tracked",()=>{
  const ac=500*Math.PI*(200**2-100**2)/4e6+500*Math.PI*(150**2-100**2)/4e6;
  const volume=c+ac+1;
  const r=simulateCoupledHydraulicsV2({...common,stages:[{...water,rateLps:10,volumeM3:volume}],
    timesMin:[0,volume/.6],formations:[{name:"Weak",md:750,fractureMPa:8,poreMPa:5}]});
  expect(r.annulusCapacityM3).toBeCloseTo(ac,9);
  expect(r.frames[1].returnedM3).toBeCloseTo(volume-ac,8);
  expect(r.formations[0].maxPressureMPa).toBeGreaterThan(0);
  expect(r.formations[0].minFracMarginMPa).toBeLessThan(8);
 });
 it("pressure decreases with TVD in inclined geometries at fixed fluid density",()=>{
  const tr=[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:600,zenith:0,azimuth:0}];
  const r=simulateCoupledHydraulicsV2({...common,trajectory:tr,stages:[],timesMin:[0]});
  expect(r.frames[0].shoePressureMPa).toBeCloseTo(hydrostaticPressure(1.2,600),9);
 });
});
