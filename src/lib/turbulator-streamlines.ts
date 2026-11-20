import type { TurbulatorFlowResult } from './turbulator-flow';

export type FlowVertex = [number,number,number];
export interface FlowTracePoint { mean:FlowVertex; particle:FlowVertex; travelS:number; physicalPhase:number; }

/** Read the computed mean field. Below-cutoff tails remain continuous instead of freezing their phase. */
export function turbulatorMeanAt(result:TurbulatorFlowResult,z:number,pipeOD:number) {
  const radius=(pipeOD+result.boreMm)/4000;
  if(z<=0)return {phase:0,axialMs:result.axialMs,tangentialMs:result.tangentialMs};
  const samples=result.samples;
  if(samples.length&&z<=samples[samples.length-1].distanceM){
    let n=1;while(n<samples.length&&samples[n].distanceM<z)n++;
    const b=samples[Math.min(n,samples.length-1)],a=samples[Math.max(0,n-1)];
    const t=Math.max(0,Math.min(1,(z-a.distanceM)/(b.distanceM-a.distanceM||1)));
    return {phase:a.phase+t*(b.phase-a.phase),axialMs:a.axialMs+t*(b.axialMs-a.axialMs),tangentialMs:a.tangentialMs+t*(b.tangentialMs-a.tangentialMs)};
  }
  const last=samples.at(-1),previous=samples.at(-2);
  // The tail uses the last local decay rate. It is used only within the local constant-diameter viewport.
  const alpha=previous&&last&&previous.tangentialMs>0&&last.tangentialMs>0?
    Math.max(0,Math.log(previous.tangentialMs/last.tangentialMs)/(last.distanceM-previous.distanceM||1)):result.outletDecayPerM??0;
  const start=last?.distanceM??0,phase=last?.phase??0,axialMs=last?.axialMs??result.axialMs;
  const v=last?.tangentialMs??result.tangentialMs,d=Math.max(0,z-start),end=v*Math.exp(-alpha*d);
  const turn=axialMs>0?(alpha>1e-12?(v-end)/alpha:v*d)/(axialMs*radius):0;
  return {phase:phase+turn,axialMs,tangentialMs:end};
}

/** Physical mean trace plus an explicitly qualitative turbulence overlay; never changes solver results. */
export function turbulatorTrace(result:TurbulatorFlowResult,pipeOD:number,lo:number,hi:number,seed:number,swirlScale=1,pulsations=true):FlowTracePoint[] {
  if(!result.valid||result.axialMs<=0||hi<=lo)return [];
  const p=result.point,pr=pipeOD/2000,br=result.boreMm/2000;
  const offset=(br-pr)*(1-Math.max(0,Math.min(100,result.standoffPct))/100);
  const length=(p.lengthMm??180)/1000,outer=pr+(p.sleeveThicknessMm??3)/1000,fin=pr+p.bladeHeight/1000;
  const ribTurn=length*Math.tan(p.bladeAngle*Math.PI/180)/Math.max(outer,1e-4);
  const strength=pulsations?Math.max(0,Math.min(1,result.regime)):0;
  const vertices:FlowTracePoint[]=[],steps=320,wavelength=Math.max(.02,2*(br-pr));
  let travelS=0;
  for(let j=0;j<=steps;j++){
    const z=lo+(hi-lo)*j/steps,s=turbulatorMeanAt(result,z,pipeOD);
    if(j)travelS+=(hi-lo)/steps/Math.max(1e-9,s.axialMs);
    const physicalPhase=z>0?s.phase:0;
    const meanAngle=seed+(z>0?ribTurn+physicalPhase*swirlScale:z>=-length?(z+length)/length*ribTurn:0);
    const position=(angle:number,fraction:number):FlowVertex=>{
      const wall=offset*Math.cos(angle)+Math.sqrt(Math.max(0,br*br-offset*offset*Math.sin(angle)**2));
      const inner=z>=-length&&z<=0?fin:pr;
      const rad=inner+Math.max(0,wall-inner)*fraction;
      return [rad*Math.cos(angle),rad*Math.sin(angle),z];
    };
    // A spatially varying tracer path illustrates unsteadiness, not a predicted RMS fluctuation or CFD.
    const wave=z/wavelength*2*Math.PI;
    const angular=strength*(br-pr)/Math.max(pr,1e-6)*(.42*Math.sin(wave+seed*3)+.18*Math.sin(wave*1.73-seed));
    const radial=.5+strength*(.24*Math.sin(wave*1.31+seed*2)+.08*Math.sin(wave*2.37+seed));
    vertices.push({mean:position(meanAngle,.5),particle:position(meanAngle+angular,radial),travelS,physicalPhase});
  }
  return vertices;
}
