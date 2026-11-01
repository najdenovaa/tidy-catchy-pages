import { calculateWocHydrostaticProfileV2, type WocDensityScenarioV2 } from "./advanced-v2-woc-hydrostatics";
import { assessStaticStopV2 } from "./advanced-stop-diagnostics-v2";
import { assessV2RestartPumpSafety } from "./advanced-v2-pump-pressure-safety";
import { calculateV2StageMetadata } from "./advanced-v2-stage-metadata";
import { summarizeV2FormationChecks } from "./advanced-v2-formation-summary";
import { buildRestartPressureFramesV2, type RestartEventV2 } from "./advanced-restart-pressure-frames-v2";
import type { PumpIntervalV2 } from "./advanced-pump-timeline-v2";
import { calculateSafeAnnularRateV2 } from "./advanced-safe-rate-v2";
import { simulatePipePressureTimelineV2 } from "./advanced-pipe-timeline-v2";
import { calculateAnnulusV2, type AnnulusGeometryV2, type AnnulusFluidV2 } from "./advanced-annulus-v2";
import { annularFrictionMPa, interpolateTVD, type TrajectoryPoint } from "./cementing-calculations";
import type { PumpStageV2 } from "./advanced-pipe-advection-v2";
import type { PipeFrictionV2Input } from "./advanced-pipe-hydraulics-v2";

type Pipe = Omit<PipeFrictionV2Input, "densityKgM3"|"rheology">;
export interface FormationCheckV2 { name:string; md:number; fractureMPa?:number; poreMPa?:number }
export function simulateCoupledHydraulicsV2(input:{
 pipe:Pipe; annulus:AnnulusGeometryV2; trajectory:TrajectoryPoint[];
 initialPipe:AnnulusFluidV2; initialAnnulus:AnnulusFluidV2;
 stages:PumpStageV2[]; timesMin:number[]; formations?:FormationCheckV2[];
 returnPressureMPa?:number; profileStepM?:number; safeRateCeilingLps?:number;
 restartTimeline?:{stages:PumpIntervalV2[];events:RestartEventV2[];timesMin:number[]};
 cementStageIndices?:number[];
 maxPumpPressureMPa?:number;
 wocScenario?:WocDensityScenarioV2;
}){
 const {pipe,annulus,trajectory,stages}=input;
 if(pipe.fromMD!==annulus.topMD||pipe.toMD!==annulus.shoeMD)throw Error("Pipe and annulus geometry not connected");
 const bp=input.returnPressureMPa??0;
 if(!Number.isFinite(bp)||bp<0)throw Error("Invalid return pressure");
 const step=input.profileStepM??50;
 if(!Number.isFinite(step)||step<=0||step>annulus.shoeMD-annulus.topMD)throw Error("Invalid profile grid spacing");
 const grid=Array.from({length:Math.ceil((annulus.shoeMD-annulus.topMD)/step)+1},(_,i)=>Math.min(annulus.shoeMD,annulus.topMD+i*step));
 const checks=input.formations??[];
 checks.forEach(z=>{if(!z.name.trim()||!Number.isFinite(z.md)||z.md<annulus.topMD||z.md>annulus.shoeMD||
 (z.fractureMPa!==undefined&&(!Number.isFinite(z.fractureMPa)||z.fractureMPa<=0))||
 (z.poreMPa!==undefined&&(!Number.isFinite(z.poreMPa)||z.poreMPa<0)))throw Error("Invalid formation");});
 if(input.restartTimeline){
  const planned=input.restartTimeline.stages;
  if(planned.length!==stages.length||planned.some((x,i)=>
   x.name!==stages[i].name||x.rateLps!==stages[i].rateLps||
   x.volumeM3!==stages[i].volumeM3||(x.pauseAfterMin??0)!==(stages[i].pauseAfterMin??0)))
   throw Error("Restart programme must match hydraulic fluid programme exactly");
 }
 const sampleTimes=input.restartTimeline
  ?[...new Set([...input.timesMin,...input.restartTimeline.timesMin])].sort((a,b)=>a-b)
  :input.timesMin;
 const pipeRun=simulatePipePressureTimelineV2(pipe,input.initialPipe,stages,trajectory,sampleTimes);
 const initialOut:PumpStageV2={...input.initialPipe,rateLps:1,volumeM3:pipeRun.pipeCapacityM3};
 const shoeStream=[initialOut,...stages];
 let time=0;
 const schedule=stages.map(s=>{const start=time;const end=start+s.volumeM3/(s.rateLps*0.06);time=end+(s.pauseAfterMin??0);return {start,end,q:s.rateLps};});
 const annulusCapacityM3=calculateAnnulusV2(annulus,input.initialAnnulus,shoeStream,0,0,trajectory).capacityM3;
 const envelopes=checks.map(z=>({...z,minPressureMPa:Infinity,maxPressureMPa:-Infinity,minFracMarginMPa:Infinity,minPoreMarginMPa:Infinity}));
 const frames=pipeRun.frames.map(p=>{
  const rateLps=schedule.find(s=>p.timeMin>=s.start&&p.timeMin<s.end)?.q??0;
  // Fluid initially in pipe begins exiting at shoe as soon as pumping begins.
  const a=calculateAnnulusV2(annulus,input.initialAnnulus,shoeStream,p.pumpedM3,rateLps,trajectory);
  const shoePressureMPa=bp+a.bottomPressureRelativeToReturnMPa;
  const pipeFrictionMPa=rateLps>0?p.pressure.bottomFrictionMPa:0;
  const surfacePressureMPa=shoePressureMPa-p.pressure.bottomHydrostaticMPa+pipeFrictionMPa;
  const xs=[...new Set([annulus.topMD,annulus.shoeMD,annulus.previousShoeMD,...grid,...trajectory.map(x=>x.md),
   ...a.fluids.flatMap(x=>[x.fromMD,x.toMD]),...checks.map(x=>x.md)]
   .filter(d=>d>=annulus.topMD&&d<=annulus.shoeMD))].sort((x,y)=>x-y);
  let hydro=0,loss=0;
  const profile=xs.map((md,i)=>{
   if(i>0){const last=xs[i-1],mid=(last+md)/2;
    const fluid=a.fluids.find(s=>mid>=s.fromMD-1e-7&&mid<s.toMD+1e-7);
    if(!fluid)throw Error("Annulus interval gap");
    hydro+=fluid.densityKgM3*9.81*(interpolateTVD(md,trajectory)-interpolateTVD(last,trajectory))/1e6;
    const outer=mid>=annulus.previousShoeMD?annulus.holeDiameterMm:annulus.previousCasingIDmm;
    loss+=annularFrictionMPa(rateLps,md-last,outer,annulus.casingODmm,fluid.rheology.pv,fluid.rheology.yp,
     fluid.densityKgM3,annulus.standoffPct??100).pressureMPa;
   }
   const tvd=interpolateTVD(md,trajectory),pressureMPa=bp+hydro+loss;
   return {md,tvd,pressureMPa,ecdGcm3:tvd>0?pressureMPa/(0.00981*tvd):null};
  });
  envelopes.forEach(z=>{const n=profile.find(n=>Math.abs(n.md-z.md)<1e-7);
   if(!n)throw Error("Missing formation point");
   z.minPressureMPa=Math.min(z.minPressureMPa,n.pressureMPa);
   z.maxPressureMPa=Math.max(z.maxPressureMPa,n.pressureMPa);
   if(z.fractureMPa!==undefined)z.minFracMarginMPa=Math.min(z.minFracMarginMPa,z.fractureMPa-n.pressureMPa);
   if(z.poreMPa!==undefined)z.minPoreMarginMPa=Math.min(z.minPoreMarginMPa,n.pressureMPa-z.poreMPa);
  });
  const newFluidInPipe=Math.min(p.pumpedM3,pipeRun.pipeCapacityM3);
  const newFluidInAnnulus=Math.min(Math.max(0,p.pumpedM3-pipeRun.pipeCapacityM3),annulusCapacityM3);
  const newFluidReturned=Math.max(0,p.pumpedM3-pipeRun.pipeCapacityM3-annulusCapacityM3);
  const balanceErrorM3=p.pumpedM3-newFluidInPipe-newFluidInAnnulus-newFluidReturned;
  const limited=checks.filter(z=>z.fractureMPa!==undefined).map(z=>({name:z.name,md:z.md,pressureLimitMPa:z.fractureMPa!}));
  const stopDiagnostics=rateLps===0?assessStaticStopV2({pipe,pipeFluids:p.fluids,annulus,
   initialAnnulus:input.initialAnnulus,shoeStream,shoeExitedM3:p.pumpedM3,
   trajectory,returnPressureMPa:bp}):null;
  const safeRate=limited.length?calculateSafeAnnularRateV2({annulus,initialAnnulus:input.initialAnnulus,
   shoeStream,shoeExitedM3:p.pumpedM3,trajectory,zones:limited,maxRateLps:input.safeRateCeilingLps??50,
   returnPressureMPa:bp}):null;
  return {timeMin:p.timeMin,pumpedM3:p.pumpedM3,shoeExitedM3:a.enteredM3,returnedM3:p.pumpedM3,returnedNewFluidM3:newFluidReturned,
   maxSafeRateLps:safeRate?.maxSafeRateLps??null,staticFormationOverpressure:safeRate?.staticViolation??false,
   balanceErrorM3,rateLps,stopDiagnostics,pipeFluids:p.fluids,annularFluids:a.fluids,
   pipeHydrostaticMPa:p.pressure.bottomHydrostaticMPa,
   pipeFrictionMPa,annulusHydrostaticMPa:a.hydrostaticMPa,annulusFrictionMPa:a.frictionMPa,
   shoePressureMPa,surfacePressureMPa,profile};
 });
 const formationSummary=summarizeV2FormationChecks(frames,checks);
 const pressureEnvelope=grid.map(md=>{const samples=frames.map(f=>f.profile.find(p=>Math.abs(p.md-md)<1e-7));
  if(samples.some(p=>!p))throw Error("Missing shared grid pressure value");
  const vals=samples.map(p=>p!.pressureMPa);
  const max=Math.max(...vals), min=Math.min(...vals);
  const atIndex=vals.indexOf(max);
  return {md,tvd:interpolateTVD(md,trajectory),maxPressureMPa:max,minPressureMPa:min,
   maxAtTimeMin:frames[atIndex].timeMin};
 });
 const wocProfile=input.wocScenario?calculateWocHydrostaticProfileV2(
  frames[frames.length-1].annularFluids,trajectory,grid,{...input.wocScenario,
   returnPressureMPa:input.wocScenario.returnPressureMPa??bp}):null;
 const stageMetadata=calculateV2StageMetadata(stages,input.cementStageIndices??[]);
 const restartPressureFrames=input.restartTimeline?buildRestartPressureFramesV2(
  input.restartTimeline.stages,frames.map(f=>({timeMin:f.timeMin,pumpedM3:f.pumpedM3,
   surfacePressureMPa:f.surfacePressureMPa,shoePressureMPa:f.shoePressureMPa})),
  input.restartTimeline.events,input.restartTimeline.timesMin):null;
 const restartPumpSafety=input.maxPumpPressureMPa!==undefined
  ?assessV2RestartPumpSafety(restartPressureFrames??[],input.maxPumpPressureMPa):null;
 return {pipeCapacityM3:pipeRun.pipeCapacityM3,annulusCapacityM3,frames,formations:envelopes,formationSummary,pressureEnvelope,wocProfile,restartPressureFrames,restartPumpSafety,stageMetadata,
  method:"coupled-quasi-steady-incompressible" as const};
}
