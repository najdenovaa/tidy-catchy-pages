/** Strict V2 pressure-point projection. No V1 backfill or fabricated defaults.
 * Partial projection is intentionally NOT the legacy PressurePoint contract.
 */
import type { simulateCoupledHydraulicsV2 } from "./advanced-coupled-hydraulics-v2";

type CoupledV2=ReturnType<typeof simulateCoupledHydraulicsV2>;
export interface V2CorePressurePoint {
 time:number; cumulativeVolume:number; pumpRateLps:number;
 surfacePressure:number; bottomholePressure:number;
 annularReturnVolumeM3:number; returnedNewFluidM3:number;
 maxSafeRateLps:number|null;
 ecdAtBottomGcm3:number|null;
 ecdAtPrevShoeGcm3:number|null;
 gelRestartExcessMPa:number|null;
}
export function projectV2CorePressurePoints(
 result:CoupledV2,previousShoeMD:number
):V2CorePressurePoint[]{
 if(!Number.isFinite(previousShoeMD)||previousShoeMD<0)throw Error("Invalid previous casing shoe");
 if(!result.frames.length)throw Error("V2 has no pressure frames");
 return result.frames.map(frame=>{
  const bottom=frame.profile[frame.profile.length-1];
  const previous=frame.profile.find(p=>Math.abs(p.md-previousShoeMD)<1e-7);
  if(!bottom||!previous)throw Error("Missing shoe depth in V2 pressure profile");
  const gel=result.restartPressureFrames?.find(f=>Math.abs(f.timeMin-frame.timeMin)<1e-7);
  const record:V2CorePressurePoint={
   time:frame.timeMin,cumulativeVolume:frame.pumpedM3,pumpRateLps:frame.rateLps,
   surfacePressure:frame.surfacePressureMPa,bottomholePressure:frame.shoePressureMPa,
   annularReturnVolumeM3:frame.returnedM3,returnedNewFluidM3:frame.returnedNewFluidM3,
   maxSafeRateLps:frame.maxSafeRateLps,ecdAtBottomGcm3:bottom.ecdGcm3,
   ecdAtPrevShoeGcm3:previous.ecdGcm3,
   gelRestartExcessMPa:gel?.gelRestartExcessMPa??null
  };
  if(Object.entries(record).some(([k,v])=>v!==null&&typeof v==="number"&&!Number.isFinite(v)))
   throw Error("Nonfinite V2 pressure point");
  return record;
 });
}
