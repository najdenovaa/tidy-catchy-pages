import { describe, it, expect } from "vitest";
import { calculateSpotSqueeze, DEFAULT_SPOT_SQUEEZE } from "./rir-spot-squeeze";

describe("РИР Bradenhead: предварительное размещение, подъём и задавливание", () => {
 const base=DEFAULT_SPOT_SQUEEZE;
 it("сохраняет геометрический баланс цемента до и после подъёма",()=>{
   const r=calculateSpotSqueeze(base);
   expect(r.errors).toEqual([]);
   const vBefore=r.annularAreaM2*(base.initialShoeMD-r.slurryTopBeforeMD)
     +r.casingAreaM2*(base.slurryBottomMD-base.initialShoeMD);
   expect(vBefore).toBeCloseTo(base.slurryVolumeM3,8);
   expect(r.casingAreaM2*(base.slurryBottomMD-r.slurryTopAfterLiftMD)).toBeCloseTo(base.slurryVolumeM3,8);
   expect(r.placedM3).toBeCloseTo(r.plannedSqueezeM3+r.residualM3,8);
 });
 it("after lift tubing must be above new cement top",()=>{
   expect(calculateSpotSqueeze({...base,liftedShoeMD:base.leakTopMD}).ok).toBe(false);
 });
 it("squeeze cannot exceed placed volume",()=>{
   expect(calculateSpotSqueeze({...base,plannedSqueezeM3:1.2}).ok).toBe(false);
 });
 it("pressure limit is capped by the weakest surface element and fracture hydrostatic envelope",()=>{
   const r=calculateSpotSqueeze(base);
   expect(r.conservativeSurfaceLimitMPa).toBeLessThanOrEqual(base.bopWorkingMPa);
   expect(r.conservativeSurfaceLimitMPa).toBeLessThanOrEqual(base.casingAllowableSurfaceMPa);
   expect(r.conservativeSurfaceLimitMPa).toBeLessThanOrEqual(base.tubingAllowableSurfaceMPa);
   expect(r.conservativeSurfaceLimitMPa + Math.max(r.liquidHydroMPa,r.cementHydroMPa))
      .toBeLessThanOrEqual(r.fractureLimitBhpMPa+1e-8);
 });
 it("refuses unavailable pressure window rather than recommending a safe pressure",()=>{
   const r=calculateSpotSqueeze({...base,fracGradientMPaM:0.009});
   expect(r.ok).toBe(false);
   expect(r.conservativeSurfaceLimitMPa).toBe(0);
 });
 it("larger casing reduces top height for fixed cement volume after lift",()=>{
   const a=calculateSpotSqueeze(base);
   const b=calculateSpotSqueeze({...base,casingIdMm:160});
   expect(b.slurryTopAfterLiftMD).toBeGreaterThan(a.slurryTopAfterLiftMD);
 });
});
