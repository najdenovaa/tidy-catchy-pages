import type { TurbulatorFlowResult } from './turbulator-flow';
import type { SwirlState } from './swirl-transport';
export type FlowVertex = [number,number,number];
export interface FlowTracePoint { mean:FlowVertex; particle:FlowVertex; travelS:number; physicalPhase:number; }
const fieldLists=new WeakMap<TurbulatorFlowResult,{vane:{z:number;state:SwirlState;phase:number}[];wake:{z:number;state:SwirlState;phase:number}[]}>();
function radial(state:SwirlState,fraction:number){
 const n=state.omega.length,r=Math.sqrt(state.innerM**2+fraction*(state.outerM**2-state.innerM**2));
 const x=(r-state.innerM)/(state.outerM-state.innerM)*n-.5;
 const a=Math.max(0,Math.min(n-1,Math.floor(x))),b=Math.min(n-1,a+1),t=Math.max(0,Math.min(1,x-a));
 const omega=state.omega[a]+t*(state.omega[b]-state.omega[a]);
 return {radius:r,omega};
}
/** Read the computed radial velocity field; no visual multiplier or prescribed fluctuation. */
export function turbulatorMeanAt(result:TurbulatorFlowResult,z:number,pipeOD:number,fraction=.5) {
 const area=Math.PI*((result.boreMm/2000)**2-(pipeOD/2000)**2),q=result.axialMs*area;
 const zero={phase:0,axialMs:result.axialMs,tangentialMs:0,radiusM:(pipeOD+result.boreMm)/4000,angularPerM:0};
 if(result.axialMs<=0)return zero;
 let fields=fieldLists.get(result);if(!fields){fields={vane:(result.vaneProfiles??[]).map(p=>({z:p.z,state:p.state,phase:0})),wake:result.samples.filter(s=>s.profile).map(s=>({z:s.distanceM,state:s.profile!,phase:s.phase}))};fieldLists.set(result,fields);}
 const list=z<0?fields.vane:fields.wake;
 if(!list.length||z<list[0].z)return zero;
 const last=list[list.length-1];
 if(z>last.z&&z>=0&&result.reachedThreshold)return {...zero,phase:last.phase};
 let i=1;while(i<list.length&&list[i].z<z)i++;
 const b=list[Math.min(i,list.length-1)],a=list[Math.max(0,i-1)],t=Math.max(0,Math.min(1,(z-a.z)/(b.z-a.z||1)));
 const ra=radial(a.state,fraction),rb=radial(b.state,fraction),r=ra.radius+t*(rb.radius-ra.radius),omega=ra.omega+t*(rb.omega-ra.omega);
 const aa=Math.PI*(a.state.outerM**2-a.state.innerM**2)*(a.state.flowAreaScale??1),ab=Math.PI*(b.state.outerM**2-b.state.innerM**2)*(b.state.flowAreaScale??1),u=q/(aa+t*(ab-aa));
 return {phase:a.phase+t*(b.phase-a.phase),axialMs:u,tangentialMs:omega*r,radiusM:r,angularPerM:u>0?omega/u:0};
}
/** Path integration dθ/dz=vθ/(r uz), dt/dz=1/uz using the solved radial field. */
export function turbulatorTrace(result:TurbulatorFlowResult,pipeOD:number,lo:number,hi:number,seed:number):FlowTracePoint[] {
 if(!result.valid||result.axialMs<=0||hi<=lo)return [];
 const pr=pipeOD/2000,br=result.boreMm/2000,offset=(br-pr)*(1-Math.max(0,Math.min(100,result.standoffPct))/100);
 const length=(result.point.lengthMm??180)/1000,outer=pr+(result.point.sleeveThicknessMm??3)/1000;
 const fraction=.2+.6*((Math.sin(seed*2.37)+1)/2),steps=320,vertices:FlowTracePoint[]=[];
 let phase=0,travelS=0,previous=turbulatorMeanAt(result,lo,pipeOD,fraction);
 for(let j=0;j<=steps;j++){
  const z=lo+(hi-lo)*j/steps,s=turbulatorMeanAt(result,z,pipeOD,fraction),dz=(hi-lo)/steps;
  if(j){phase+=(previous.angularPerM+s.angularPerM)*dz/2;travelS+=dz/2*(1/Math.max(1e-9,previous.axialMs)+1/Math.max(1e-9,s.axialMs));}
  const angle=seed+phase,wall=offset*Math.cos(angle)+Math.sqrt(Math.max(0,br*br-offset*offset*Math.sin(angle)**2));
  const inner=z>=-length&&z<=0?outer:pr,r=Math.sqrt(inner*inner+fraction*Math.max(0,wall*wall-inner*inner));
  const mean:FlowVertex=[r*Math.cos(angle),r*Math.sin(angle),z];vertices.push({mean,particle:mean,travelS,physicalPhase:phase});previous=s;
 }
 return vertices;
}
