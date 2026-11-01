import {it,expect} from "vitest";
import {calculateSafeAnnularRateV2} from "./advanced-safe-rate-v2";
import {calculateAnnulusV2} from "./advanced-annulus-v2";
const mud={name:"Mud",densityKgM3:1200,rheology:{pv:20,yp:5}};
const annulus={topMD:0,shoeMD:1000,previousShoeMD:500,casingODmm:100,previousCasingIDmm:150,holeDiameterMm:200};
const trajectory=[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}];
const base={annulus,initialAnnulus:mud,shoeStream:[],shoeExitedM3:0,trajectory,maxRateLps:30};
it("pressure-limited rate remains within allowed range",()=>{
 const staticP=calculateAnnulusV2(annulus,mud,[],0,0,trajectory).bottomPressureRelativeToReturnMPa;
 const maxP=calculateAnnulusV2(annulus,mud,[],0,30,trajectory).bottomPressureRelativeToReturnMPa;
 const limit=staticP+0.9*(maxP-staticP);
 const r=calculateSafeAnnularRateV2({...base,zones:[{name:"shoe",md:1000,pressureLimitMPa:limit}]});
 expect(r.maxSafeRateLps).toBeGreaterThan(0);
 expect(r.maxSafeRateLps).toBeLessThan(30);
 expect(r.pressuresAtLimit[0].pressureMPa).toBeLessThanOrEqual(limit+1e-6);
});
it("static overpressure prohibits any safe rate",()=>{
 const r=calculateSafeAnnularRateV2({...base,zones:[{name:"weak",md:1000,pressureLimitMPa:10}]});
 expect(r.staticViolation).toBe(true);
 expect(r.maxSafeRateLps).toBe(0);
});
it("high limit permits maximum requested rate",()=>{
 const r=calculateSafeAnnularRateV2({...base,zones:[{name:"strong",md:1000,pressureLimitMPa:100}]});
 expect(r.maxSafeRateLps).toBe(30);
});
