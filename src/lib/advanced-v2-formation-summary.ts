/** Formation safety report derived solely from coupled V2 annular pressure frames.
 * No separate pressure solver and no V1 values.
 */
export interface V2PressureNode { md:number; tvd:number; pressureMPa:number }
export interface V2ZoneLimit { name:string; md:number; fractureMPa?:number; poreMPa?:number }
export interface V2PressureFrame { timeMin:number; profile:V2PressureNode[] }
export function summarizeV2FormationChecks(frames:V2PressureFrame[],zones:V2ZoneLimit[]){
 if(!frames.length)throw Error("Formation report requires pressure frames");
 return zones.map(z=>{
  if(!z.name.trim()||!Number.isFinite(z.md)||
   (z.fractureMPa!==undefined&&(!Number.isFinite(z.fractureMPa)||z.fractureMPa<=0))||
   (z.poreMPa!==undefined&&(!Number.isFinite(z.poreMPa)||z.poreMPa<0)))
   throw Error("Invalid formation limit");
  const observations=frames.map(f=>{
   const n=f.profile.find(p=>Math.abs(p.md-z.md)<1e-7);
   if(!n||![n.pressureMPa,n.tvd].every(Number.isFinite))
    throw Error("Formation depth missing from V2 pressure profile");
   return {timeMin:f.timeMin,pressureMPa:n.pressureMPa,tvd:n.tvd};
  });
  const max=observations.reduce((a,b)=>b.pressureMPa>a.pressureMPa?b:a);
  const min=observations.reduce((a,b)=>b.pressureMPa<a.pressureMPa?b:a);
  return {name:z.name,md:z.md,tvd:max.tvd,
   maxPressureMPa:max.pressureMPa,maxAtTimeMin:max.timeMin,
   minPressureMPa:min.pressureMPa,minAtTimeMin:min.timeMin,
   fractureMPa:z.fractureMPa??null,poreMPa:z.poreMPa??null,
   fractureMarginMPa:z.fractureMPa===undefined?null:z.fractureMPa-max.pressureMPa,
   poreMarginMPa:z.poreMPa===undefined?null:min.pressureMPa-z.poreMPa,
   exceedsFracture:z.fractureMPa===undefined?null:max.pressureMPa>z.fractureMPa,
   belowPore:z.poreMPa===undefined?null:min.pressureMPa<z.poreMPa};
 });
}
