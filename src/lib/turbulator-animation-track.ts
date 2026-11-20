import type {FlowTracePoint,FlowVertex} from './turbulator-streamlines';

/** One physical-time track per streamline. Front/back copies share the same complete clock and path. */
export function turbulatorAnimationTrack(trace:FlowTracePoint[],project:(v:FlowVertex)=>number[],isFront:(v:FlowVertex)=>boolean){
 if(trace.length<2)return null;
 const seconds=trace.at(-1)!.travelS-trace[0].travelS;
 if(!(seconds>0))return null;
 const points=trace.map(p=>project(p.particle)),arc=[0];
 for(let i=1;i<points.length;i++)arc.push(arc[i-1]+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
 const total=arc.at(-1)!;
 const times=trace.map((p,i)=>i===trace.length-1?1:(p.travelS-trace[0].travelS)/seconds);
 const front=trace.map(p=>isFront(p.particle));
 return {seconds,path:'M '+points.map(p=>p.map(x=>x.toFixed(3)).join(',')).join(' L '),
   keyTimes:times.map(t=>t.toFixed(9)).join(';'),keyPoints:arc.map((d,i)=>(total>1e-12?d/total:times[i]).toFixed(9)).join(';'),
   frontOpacity:front.map(f=>f?'1':'0').join(';'),backOpacity:front.map(f=>f?'0':'1').join(';')};
}
