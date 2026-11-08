/** Compatibility adapter: running loads now share the broomstick equilibrium engine. */
import type { WellData } from './cementing-calculations';
import type { CentralizationResult, CentralizerInterval } from './centralization-calculations';
import { calculateCasingRunning, normalizeRunningSettings } from './casing-running-analysis';
export interface RunningForceInput {
  wellData:WellData; mudDensity:number; frictionCoeff:number;
  centralizerIntervals:CentralizerInterval[]; centralization:CentralizationResult[];
  casingGrade?:'K-55'|'N-80'|'P-110';
}
export interface RunningForceResult {
  hookloadDryKN:number; hookloadBuoyKN:number; hookloadRunningKN:number; hookloadPickupKN:number;
  willRunFreely:boolean; minSlackOffMargin:number;
  maxBendingStressMPa:number; bendingUtilization:number; yieldStrengthMPa:number;
  /** Retained for API compatibility; eccentricity is NOT spring compression. */
  avgSpringCompression:number|null; maxSpringCompression:number|null; warnings:string[];
}
export function calculateRunningForces(input:RunningForceInput):RunningForceResult {
  const w=input.wellData,s=normalizeRunningSettings({...w.runningSettings,frictionCased:input.frictionCoeff,frictionOpenhole:input.frictionCoeff,grade:input.casingGrade??'N-80'});
  const a=calculateCasingRunning({well:w,mudDensity:input.mudDensity,intervals:input.centralizerIntervals,pv:0,yp:0,settings:s});
  const area=Math.PI/4*((w.casingOD/1000)**2-((w.casingOD-2*w.casingWall)/1000)**2);
  const dry=area*7850*9.80665*w.casingDepthMD/1000;
  return {hookloadDryKN:dry,hookloadBuoyKN:dry*(1-input.mudDensity/7850),
    hookloadRunningKN:(a.final?.runIn??0)*9.80665,hookloadPickupKN:(a.final?.pullOut??0)*9.80665,
    willRunFreely:a.valid&&a.firstCompressionMD===null,minSlackOffMargin:Math.min(0,...a.profile.map(p=>p.runInKN))*1000,
    maxBendingStressMPa:a.maxBendingMPa,bendingUtilization:a.maxBendingMPa/a.yieldMPa,yieldStrengthMPa:a.yieldMPa,
    avgSpringCompression:null,maxSpringCompression:null,warnings:[...a.errors,...a.notes,'Сжатие рессор оценивается по геометрии планок в инспекторе центратора, а не по эксцентриситету трубы.']};
}
