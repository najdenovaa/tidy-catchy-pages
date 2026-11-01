import { it, expect } from "vitest";
import { calculateAnnulusV2 } from "./advanced-annulus-v2";
it("exports annular model", () => { expect(typeof calculateAnnulusV2).toBe("function"); });

it("computes two-section annulus capacity", () => { const g={topMD:0,shoeMD:1000,previousShoeMD:500,casingODmm:100,previousCasingIDmm:150,holeDiameterMm:200}; const fluid={name:"A",densityKgM3:1200,rheology:{pv:20,yp:5}}; const trajectory=[{md:0,tvd:0,zenith:0,azimuth:0},{md:1000,tvd:1000,zenith:0,azimuth:0}]; const result=calculateAnnulusV2(g,fluid,[],0,0,trajectory); expect(result.capacityM3).toBeCloseTo(500*Math.PI*(200*200-100*100)/4000000+500*Math.PI*(150*150-100*100)/4000000,9); expect(result.hydrostaticMPa).toBeCloseTo(11.772,9); });
