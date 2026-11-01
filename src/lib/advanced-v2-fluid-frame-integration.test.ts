import {it,expect} from "vitest";
import {simulateCoupledHydraulicsV2} from "./advanced-coupled-hydraulics-v2";
it("exports actual moving fluid segments from the same pressure frames for animations",()=>{
 const mud={name:"Mud",densityKgM3:1200,rheology:{pv:20,yp:5}};
 const water={name:"Spacer",densityKgM3:1000,rheology:{pv:1,yp:0}};
 const r=simulateCoupledHydraulicsV2({
  pipe:{fromMD:0,toMD:1000,casingODmm:100,defaultWallMm:10,flowRateLps:10},
  annulus:{topMD:0,shoeMD:1000,previousShoeMD:500,casingODmm:100,previousCasingIDmm:150,holeDiameterMm:200},
  trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}],
  initialPipe:mud,initialAnnulus:mud,
  stages:[{...water,rateLps:10,volumeM3:6,pauseAfterMin:5}],timesMin:[0,10,12,15]
 });
 expect(r.frames[0].pipeFluids.map(x=>x.name)).toEqual(["Mud"]);
 expect(r.frames[1].pipeFluids.some(x=>x.name==="Spacer")).toBe(true);
 expect(r.frames[1].annularFluids.some(x=>x.name==="Mud")).toBe(true);
 expect(r.frames[2].pipeFluids).toEqual(r.frames[1].pipeFluids);
 expect(r.frames[2].annularFluids).toEqual(r.frames[1].annularFluids);
 for(const f of r.frames){
  const p=f.pipeFluids.reduce((v,x)=>v+x.toMD-x.fromMD,0);
  const a=f.annularFluids.reduce((v,x)=>v+x.toMD-x.fromMD,0);
  expect(p).toBeCloseTo(1000,7);
  expect(a).toBeCloseTo(1000,7);
 }
});
