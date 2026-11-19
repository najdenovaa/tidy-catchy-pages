import type {TrajectoryPoint} from './cementing-calculations';
const rad=Math.PI/180;
export const surveyAngleDelta=(a:number,b:number)=>((b-a+540)%360+360)%360-180;
/** Piecewise-linear angles, shortest azimuth arc; terminal angles continue below the survey. */
export function mechanicalSurvey(traj:TrajectoryPoint[],md:number){
 if(!traj.length)return {zenith:0,azimuth:0,tvd:md};
 if(md<=traj[0].md)return {...traj[0],tvd:traj[0].tvd+(md-traj[0].md)*Math.cos(traj[0].zenith*rad)};
 for(let i=1;i<traj.length;i++)if(md<=traj[i].md){const a=traj[i-1],b=traj[i],f=(md-a.md)/(b.md-a.md);return {zenith:a.zenith+f*(b.zenith-a.zenith),azimuth:a.azimuth+f*surveyAngleDelta(a.azimuth,b.azimuth),tvd:a.tvd+f*(b.tvd-a.tvd)};}
 const a=traj.at(-1)!;return {...a,tvd:a.tvd+(md-a.md)*Math.cos(a.zenith*rad)};
}
/** Direction gradients averaged over a physical window, clipped at the string ends. */
export function surveyCurvature(traj:TrajectoryPoint[],md:number,depth:number,windowM=30){
 const top=Math.max(0,md-windowM/2),bottom=Math.min(depth,md+windowM/2),L=bottom-top;
 if(!(L>0))return {inclinationPerM:0,azimuthPerM:0,dlsDegPer30m:0};
 const a=mechanicalSurvey(traj,top),b=mechanicalSurvey(traj,bottom),di=(b.zenith-a.zenith)*rad/L,da=surveyAngleDelta(a.azimuth,b.azimuth)*rad/L;
 const dot=Math.cos(a.zenith*rad)*Math.cos(b.zenith*rad)+Math.sin(a.zenith*rad)*Math.sin(b.zenith*rad)*Math.cos(surveyAngleDelta(a.azimuth,b.azimuth)*rad);
 return {inclinationPerM:di,azimuthPerM:da,dlsDegPer30m:Math.acos(Math.max(-1,Math.min(1,dot)))/rad*30/L};
}
/** Frictionless axial weight below MD: exact integral of cos(inclination) for linear-angle segments. */
export function freeAxialWeight(traj:TrajectoryPoint[],md:number,depth:number,buoyantWeightNPerM:number){
 const bounds=[md,...traj.map(p=>p.md).filter(z=>z>md&&z<depth),depth];let force=0;
 for(let j=1;j<bounds.length;j++){const a=bounds[j-1],b=bounds[j],ia=mechanicalSurvey(traj,a).zenith*rad,ib=mechanicalSurvey(traj,b).zenith*rad,d=ib-ia;force+=buoyantWeightNPerM*(b-a)*(Math.abs(d)<1e-10?Math.cos((ia+ib)/2):(Math.sin(ib)-Math.sin(ia))/d);}
 return force;
}
/** Soft-string normal load per metre; curvature and gravity in the build plane add with their signs. */
export function normalLineLoad(weightNPerM:number,inclinationDeg:number,tensionN:number,curvature:ReturnType<typeof surveyCurvature>){
 const sin=Math.sin(inclinationDeg*rad);return Math.hypot(weightNPerM*sin+tensionN*curvature.inclinationPerM,tensionN*sin*curvature.azimuthPerM);
}
