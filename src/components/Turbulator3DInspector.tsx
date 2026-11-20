import { surveyTransform } from '@/lib/centralizer-mesh';
import { turbulatorMeanAt, turbulatorTrace } from '@/lib/turbulator-streamlines';
import { useId, useMemo, useState } from 'react';
import type { TurbulatorFlowResult } from '@/lib/turbulator-flow';
import type { TurbulatorPoint } from '@/lib/centralization-calculations';

type V = [number,number,number];
/** Same lightweight SVG/painter renderer as Centralizer3DInspector. Metres internally. */
export default function Turbulator3DInspector({result,pipeOD,zenith=0,azimuth=0,viewAboveM,viewBelowM,rateLps}:{result:TurbulatorFlowResult;pipeOD:number;zenith?:number;azimuth?:number;viewAboveM?:number;viewBelowM?:number;rateLps?:number}){
 const uid=useId().replace(/:/g,''),[orbit,setOrbit]=useState(25),[axial,setAxial]=useState(false),[wall,setWall]=useState(true),[flow,setFlow]=useState(true),[play,setPlay]=useState(true);
 const p=result.point,pr=pipeOD/2000,br=result.boreMm/2000;
 const offset=(br-pr)*(1-Math.max(0,Math.min(100,result.standoffPct))/100);
 const length=(p.lengthMm??180)/1000,thickness=(p.sleeveThicknessMm??3)/1000;
 const outer=pr+thickness,fin=pr+p.bladeHeight/1000;
 const visible=viewAboveM??Math.min(2,Math.max(.3,result.lengthM)),lo=-(viewBelowM??length+.18),hi=visible+(viewAboveM===undefined?.12:0);
 const color=result.axialMs===0?'#94a3b8':result.regime===1?'#f472b6':result.regime===0?'#22d3ee':'#fbbf24';
 const regime=result.axialMs===0?'Стоп':result.regime===1?'Турбулентный':result.regime===0?'Ламинарный':'Переходный';
 const transform=(v:V):V=>{
  const raw=axial?v:surveyTransform(v,zenith,azimuth);
  const a=(orbit-(axial?0:azimuth))*Math.PI/180,c=Math.cos(a),s=Math.sin(a),x=raw[0]*c-raw[1]*s,y=raw[0]*s+raw[1]*c;
  return axial?[x,y,raw[2]]:[x,raw[2]*.97-y*.24,y*.97+raw[2]*.24];
 };
 const bounds=[lo,hi].flatMap(z=>Array.from({length:32},(_,i)=>transform([offset+br*Math.cos(i*Math.PI/16),br*Math.sin(i*Math.PI/16),z])));
 const xs=bounds.map(p=>p[0]),ys=bounds.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 const scale=Math.min(480/Math.max(.01,maxX-minX),420/Math.max(.01,maxY-minY)),cx=300-(minX+maxX)/2*scale,cy=285+(minY+maxY)/2*scale;
 const xy=(v:V)=>{const t=transform(v);return [cx+t[0]*scale,cy-t[1]*scale];};
 const str=(vs:V[])=>vs.map(v=>xy(v).map(x=>x.toFixed(2)).join(',')).join(' ');
 const ring=(r:number,z:number)=>Array.from({length:65},(_,i)=>[r*Math.cos(i*Math.PI/32),r*Math.sin(i*Math.PI/32),z] as V);
 const wallRing=(z:number)=>ring(br,z).map(([x,y,z])=>[x+offset,y,z] as V);
 const faces=useMemo(()=>{
  const fs:{points:V[];red:boolean;light:number}[]=[];
  const cyl=(r:number,z0:number,z1:number,red:boolean)=>{const nz=red?8:32;for(let j=0;j<nz;j++)for(let i=0;i<64;i++){const za=z0+(z1-z0)*j/nz,zb=z0+(z1-z0)*(j+1)/nz,a=i*Math.PI/32,b=(i+1)*Math.PI/32;fs.push({red,light:(Math.cos(a-orbit*Math.PI/180)+1)/2,points:[[r*Math.cos(a),r*Math.sin(a),za],[r*Math.cos(b),r*Math.sin(b),za],[r*Math.cos(b),r*Math.sin(b),zb],[r*Math.cos(a),r*Math.sin(a),zb]]});}};
  cyl(pr,lo,hi,false);cyl(outer,-length,0,true);
  for(const z of [-length,0])for(let i=0;i<64;i++){const a=i*Math.PI/32,b=(i+1)*Math.PI/32;fs.push({red:true,light:.65,points:[[pr*Math.cos(a),pr*Math.sin(a),z],[outer*Math.cos(a),outer*Math.sin(a),z],[outer*Math.cos(b),outer*Math.sin(b),z],[pr*Math.cos(b),pr*Math.sin(b),z]]});}
  const width=(p.bladeWidthMm??8)/1000/Math.max(outer,1e-4);
  for(let k=0;k<Math.min(24,p.bladesCount);k++)for(let j=0;j<20;j++){
   const vertex=(t:number,r:number,side:number):V=>{const z=-length+t*length,a=k*2*Math.PI/p.bladesCount+t*length*Math.tan(p.bladeAngle*Math.PI/180)/Math.max(outer,1e-4)+side*width/2;return [r*Math.cos(a),r*Math.sin(a),z];};
   const t=j/20,u=(j+1)/20;
   for(const side of [-1,1])fs.push({red:true,light:side===1?.85:.4,points:[vertex(t,outer,side),vertex(u,outer,side),vertex(u,fin,side),vertex(t,fin,side)]});
   fs.push({red:true,light:.95,points:[vertex(t,fin,-1),vertex(u,fin,-1),vertex(u,fin,1),vertex(t,fin,1)]});
  }
  return fs.sort((a,b)=>a.points.reduce((n,v)=>n+transform(v)[2],0)/4-b.points.reduce((n,v)=>n+transform(v)[2],0)/4);
 // Camera and dimensions are the only mesh inputs.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[p,pipeOD,orbit,axial,visible,result.boreMm,zenith,azimuth]);
 const paths:{d:string;meanD:string;front:boolean;id:string;seconds:number}[]=[];
 let transitSeconds=0;
 const turnInWindow=turbulatorMeanAt(result,hi,pipeOD).phase*180/Math.PI;
 const pitch=result.ratio>0?2*Math.PI*(pipeOD+result.boreMm)/4000/result.ratio:Infinity;
 if(result.valid&&flow&&result.axialMs>0&&br>pr){
  for(let k=0;k<8;k++){
   const trace=turbulatorTrace(result,pipeOD,lo,hi,k*2*Math.PI/8);
   if(k===0)transitSeconds=trace.at(-1)?.travelS??0;
   let segment:typeof trace=[],front:boolean|undefined;
   const path=(points:V[])=>'M '+str(points).replace(/ /g,' L ');
   const push=()=>{if(segment.length>1)paths.push({id:`${uid}-${k}-${paths.length}`,d:path(segment.map(v=>v.particle)),meanD:path(segment.map(v=>v.mean)),front:!!front,seconds:Math.max(.001,segment.at(-1)!.travelS-segment[0].travelS)});};
   for(const sample of trace){
    const v=sample.particle,f=transform(v)[2]>transform([0,0,v[2]])[2];
    if(front!==undefined&&f!==front){segment.push(sample);push();segment=[sample];}else segment.push(sample);
    front=f;
   }push();
  }
 }
 const drawPaths=(front:boolean)=>paths.filter(p=>p.front===front).map(p=><g key={p.id}>
  <path data-flow-mean="true" d={p.meanD} fill="none" stroke={color} strokeWidth="1.5" opacity={front?.85:.25}/>

  {play&&[0,1,2].map(i=><circle key={i} className="turbulator-particle" r="2.4" fill={color}><animateMotion dur={`${p.seconds}s`} begin={`${-i*p.seconds/3}s`} calcMode="linear" repeatCount="indefinite" path={p.d}/></circle>)}
 </g>);
 return <section className="rounded-xl border border-border overflow-hidden" aria-label="3D турбулизатора и вихревого потока">
  <div className="p-3 border-b text-sm"><b>Турбулизатор · MD {p.md} м</b><p className="text-xs text-muted-foreground">Зенит {zenith.toFixed(1)}° · азимут {azimuth.toFixed(1)}° · Standoff {result.standoffPct.toFixed(1)}% · посадка на трубе без проточного зазора</p></div>
  <div className="bg-slate-950 text-slate-200 p-3">
   <div className="flex flex-wrap justify-between gap-2 px-1 pb-2 text-xs tabular-nums"><b style={{color}}>{regime} · Re {result.reynolds.toFixed(0)}</b><span>{rateLps!==undefined?`${rateLps.toFixed(1)} л/с · `:''}{result.axialMs.toFixed(3)} м/с</span></div>
   <p className="text-[11px] text-slate-400 mb-2">MD {Math.max(0,p.md-hi).toFixed(2)}–{(p.md-lo).toFixed(2)} м · угол рёбер {p.bladeAngle}°</p>
   <div className="rounded border border-slate-700 p-2 mb-2 text-xs space-y-2">
    <p data-flow-turn>Средний поворот в окне: {turnInWindow.toFixed(1)}° · шаг спирали на выходе: {Number.isFinite(pitch)&&result.axialMs>0?pitch.toFixed(1)+' м':'—'}</p>
    <p className="text-slate-400">Линии и частицы следуют рассчитанному полю окружной скорости. Масштаб 1:1. Поворот, время прохода и затухание пересчитываются при изменении подачи.</p>
   </div>
   <style>{'@media (prefers-reduced-motion: reduce){.turbulator-particle{display:none}}'}</style>
   <svg data-flow-transit-s={transitSeconds} data-calculated-swirl="true" viewBox="0 0 600 560" className="w-full max-h-[620px]" role="img" aria-label="Красная втулка с наклонными рёбрами; поток снаружи, закрутка выше изделия">
    <defs><radialGradient id={`${uid}-bg`}><stop stopColor="#223149"/><stop offset="1" stopColor="#080f1d"/></radialGradient></defs>
    <rect width="600" height="560" rx="12" fill={`url(#${uid}-bg)`}/>
    {wall&&<g stroke="#64748b" opacity=".4" fill="none">{[lo,hi].map(z=><polyline key={z} points={str(wallRing(z))}/>)}{[0,1,2,3,4,5,6,7].map(k=><polyline key={k} points={str([[offset+br*Math.cos(k*Math.PI/4),br*Math.sin(k*Math.PI/4),lo],[offset+br*Math.cos(k*Math.PI/4),br*Math.sin(k*Math.PI/4),hi]])}/>)}</g>}
    {drawPaths(false)}
    {faces.map((f,i)=><polygon key={i} points={str(f.points)} fill={f.red?`rgb(${Math.round(145+100*f.light)},${Math.round(12+26*f.light)},${Math.round(30+32*f.light)})`:`hsl(215,10%,${28+30*f.light}%)`} stroke="none"/>)}
    {drawPaths(true)}
    <g fill="#cbd5e1" fontSize="12"><text x="20" y="28">{axial?'Вид вдоль оси':'Восходящий поток · к устью ↑'}</text><text x="20" y="526">Поток только снаружи втулки и трубы</text><text x="20" y="547">{result.lengthM>visible?`Окно ${visible.toFixed(1)} м; закрутка продолжается выше`:'Затухание вращательного момента рассчитано по длине'}</text></g>
    {result.valid&&result.lengthM>0&&!axial&&<g stroke="#fbbf24" fill="#fbbf24" fontSize="12">{(()=>{const a=xy([br*1.35,0,0]),b=xy([br*1.35,0,Math.min(visible,result.lengthM)]);return <><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}/><text x="20" y="52" stroke="none">L₉₉․₉ {result.reachedThreshold?'':'≥ '}{result.lengthM.toFixed(2)} м MD</text></>;})()}</g>}
   </svg>
   <div className="flex flex-wrap gap-4 text-xs my-2"><label><input type="checkbox" checked={wall} onChange={e=>setWall(e.target.checked)}/> Контур ствола</label><label><input type="checkbox" checked={flow} onChange={e=>setFlow(e.target.checked)}/> Поток</label><label><input type="checkbox" checked={play} onChange={e=>setPlay(e.target.checked)}/> Анимация</label><button className="underline" onClick={()=>setAxial(!axial)}>{axial?'Объёмный вид':'Вдоль оси'}</button></div>
   <label className="text-xs block">Обход вокруг трубы {orbit}°<input aria-label="Поворот турбулизатора" type="range" min="-180" max="180" value={orbit} onChange={e=>setOrbit(+e.target.value)} className="w-full"/></label>
   <p className="text-xs text-slate-400">Наклон по инклинометрии; камера вращается для обзора. Траектории вычислены по окружной скорости и времени прохода. Осесимметричное приближение локального затрубья.</p>
  </div>
 </section>;
}
export type { TurbulatorPoint };
