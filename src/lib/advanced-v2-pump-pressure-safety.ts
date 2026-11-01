/** Equipment pressure limits using the identical restart-pressure frames shown on the V2 chart.
 * Gel yield is a required surface pumping differential, not added to the formation profile.
 */
import type {buildRestartPressureFramesV2} from "./advanced-restart-pressure-frames-v2";
type RestartFrames=ReturnType<typeof buildRestartPressureFramesV2>;
export function assessV2RestartPumpSafety(frames:RestartFrames,maxPumpPressureMPa:number){
 if(!Number.isFinite(maxPumpPressureMPa)||maxPumpPressureMPa<=0)
  throw Error("Invalid pump working pressure");
 if(!frames.length)throw Error("Restart pressure frames required");
 for(let i=0;i<frames.length;i++){
  const f=frames[i];
  if(!Number.isFinite(f.timeMin)||!Number.isFinite(f.surfacePressureMPa)||!Number.isFinite(f.gelRestartExcessMPa))
   throw Error("Invalid pump pressure frame");
  if(i>0&&f.timeMin<frames[i-1].timeMin)throw Error("Unordered pump pressure times");
 }
 const peak=frames.reduce((a,b)=>b.surfacePressureMPa>a.surfacePressureMPa?b:a);
 return {maximumOperatingPressureMPa:maxPumpPressureMPa,
  peakSurfacePressureMPa:peak.surfacePressureMPa,peakAtTimeMin:peak.timeMin,
  peakGelExcessMPa:peak.gelRestartExcessMPa,
  minimumPressureMarginMPa:maxPumpPressureMPa-peak.surfacePressureMPa,
  exceedsEquipmentLimit:peak.surfacePressureMPa>maxPumpPressureMPa,
  source:"canonical-V2-restart-frames" as const};
}
