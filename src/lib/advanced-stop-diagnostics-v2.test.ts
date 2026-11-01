import {describe,it,expect} from "vitest";
import {assessStaticStopV2} from "./advanced-stop-diagnostics-v2";
const mud={name:"Mud",densityKgM3:1200,rheology:{pv:20,yp:5}};
const pipe={fromMD:0,toMD:1000,casingODmm:100,defaultWallMm:10,flowRateLps:0};
const annulus={topMD:0,shoeMD:1000,previousShoeMD:500,casingODmm:100,previousCasingIDmm:150,holeDiameterMm:200};
const trajectory=[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}];
const base={pipe,annulus,initialAnnulus:mud,shoeStream:[],shoeExitedM3:0,trajectory};
describe("static zero-pump stop diagnostics",()=>{
 it("equal mud density has no driving differential, no friction and no motion",()=>{
  const result=assessStaticStopV2({...base,pipeFluids:[{...mud,fromMD:0,toMD:1000}]});
  expect(result.drivingPressureMPa).toBeCloseTo(0,9);
  expect(result.tendency).toBe("equilibrium");
  expect(result.pumpedVolumeChangeM3).toBe(0);
  expect(result.pipeFrictionMPa).toBe(0);
 });
 it("heavy pipe column is a positive U-tube driving potential, not computed fall",()=>{
  const result=assessStaticStopV2({...base,pipeFluids:[{...mud,densityKgM3:1800,fromMD:0,toMD:1000}]});
  expect(result.drivingPressureMPa).toBeCloseTo(5.886,8);
  expect(result.tendency).toBe("pipe-to-annulus");
  expect(result.resultKind).toBe("static-driving-potential-only");
  expect(result.pumpedVolumeChangeM3).toBe(0);
 });
 it("lighter pipe column reverses potential",()=>{
  const result=assessStaticStopV2({...base,pipeFluids:[{...mud,densityKgM3:1000,fromMD:0,toMD:1000}]});
  expect(result.tendency).toBe("annulus-to-pipe");
 });
});
