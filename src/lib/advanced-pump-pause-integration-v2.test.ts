import {describe,it,expect} from "vitest";
import {simulateCoupledHydraulicsV2} from "./advanced-coupled-hydraulics-v2";
const mud={name:"Mud",densityKgM3:1200,rheology:{pv:20,yp:5}};
const water={name:"Water",densityKgM3:1000,rheology:{pv:1,yp:0}};
const base={
 pipe:{fromMD:0,toMD:1000,casingODmm:100,defaultWallMm:10,flowRateLps:10},
 annulus:{topMD:0,shoeMD:1000,previousShoeMD:500,casingODmm:100,previousCasingIDmm:150,holeDiameterMm:200},
 trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}],
 initialPipe:mud,initialAnnulus:mud
};
describe("integrated pump pause and restart",()=>{
 it("holds volume and fluid distribution during stop, restarts without double pumping",()=>{
  const r=simulateCoupledHydraulicsV2({...base,stages:[
   {...water,rateLps:10,volumeM3:6,pauseAfterMin:5},
   {...mud,rateLps:10,volumeM3:6}
  ],timesMin:[9,10,12,15,16,25]});
  [5.4,6,6,6,6.6,12].forEach((v,i)=>expect(r.frames[i].pumpedM3).toBeCloseTo(v,9));
  expect(r.frames[2].rateLps).toBe(0);
  expect(r.frames[3].rateLps).toBe(10);
  expect(r.frames[2].annulusFrictionMPa).toBe(0);
  expect(r.frames[2].pipeFrictionMPa).toBe(0);
  expect(r.frames[1].pumpedM3).toBe(r.frames[2].pumpedM3);
  expect(r.frames[1].returnedM3).toBe(r.frames[2].returnedM3);
  r.frames.forEach(f=>expect(f.balanceErrorM3).toBeCloseTo(0,8));
  expect(r.stageMetadata.stopTime).toBe(25);
 });
});
