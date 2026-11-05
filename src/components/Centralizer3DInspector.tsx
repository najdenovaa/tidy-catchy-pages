import { useMemo, useState } from 'react';
import type { CentralizationResult, CentralizerSpec } from '@/lib/centralization-calculations';
import { inspectCentralizer } from '@/lib/centralizer-clearance';
import { centralizerMesh, surveyTransform, type Vec3 } from '@/lib/centralizer-mesh';

export default function Centralizer3DInspector({spec,result,casingOD,casingID,boreDiameter,cased,azimuth=0}:{
 spec:CentralizerSpec;result:CentralizationResult;casingOD:number;casingID:number;boreDiameter:number;cased:boolean;azimuth?:number;
}) {
 const [orbit,setOrbit]=useState(0),[elevation,setElevation]=useState(12),[selected,setSelected]=useState(0),[wall,setWall]=useState(true);
 const g=inspectCentralizer(spec,casingOD,boreDiameter,result.eccentricity);
 const faces=useMemo(()=>centralizerMesh(spec,casingOD,casingID,boreDiameter,result.eccentricity,selected),[spec,casingOD,casingID,boreDiameter,result.eccentricity,selected]);
 if(!g)return <p className="p-4">Для объёмного вида внесите длину и наружный диаметр изделия в паспорт.</p>;
 const camera=(v:Vec3):Vec3=>{
   const [x,y,z]=surveyTransform(v,result.zenith,azimuth),a=(orbit-azimuth)*Math.PI/180,p=elevation*Math.PI/180;
   const rx=x*Math.cos(a)-y*Math.sin(a),ry=x*Math.sin(a)+y*Math.cos(a);
   return [rx,z*Math.cos(p)-ry*Math.sin(p),ry*Math.cos(p)+z*Math.sin(p)];
 };
 const transformed=faces.map(f=>({...f,v:f.points.map(camera)}));
 const ring=(z:number)=>Array.from({length:65},(_,i)=>camera([g.boreRadius*Math.cos(i*Math.PI/32),g.boreRadius*Math.sin(i*Math.PI/32),z]));
 const ends=[ring(-g.length*.86),ring(g.length*.86)];
 const all=[...transformed.flatMap(f=>f.v),...ends.flat()];
 const xs=all.map(v=>v[0]),ys=all.map(v=>v[1]);const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 const scale=Math.min(480/(maxX-minX),430/(maxY-minY));
 const project=([x,y]:Vec3)=>[300+(x-(maxX+minX)/2)*scale,260-(y-(maxY+minY)/2)*scale];
 const points=(v:Vec3[])=>v.map(p=>project(p).map(n=>n.toFixed(2)).join(',')).join(' ');
 const shade=(v:Vec3[],kind:string)=>{
   const a=v[0],b=v[1],c=v[2];const u=b.map((n,i)=>n-a[i]),w=c.map((n,i)=>n-a[i]);const n=[u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0]];const len=Math.hypot(...n)||1;
   const light=Math.abs((n[0]*-.45+n[1]*.45+n[2]*.77)/len);const shine=Math.pow(light,14);
   if(kind==='red')return `rgb(${Math.round(115+115*light+25*shine)},${Math.round(8+19*light+90*shine)},${Math.round(22+24*light+90*shine)})`;
   if(kind==='selected')return `hsl(30 95% ${35+light*30}%)`;
   if(kind==='edge')return `hsl(220 14% ${18+light*30}%)`;
   return `hsl(215 12% ${25+light*48+shine*15}%)`;
 };
 const fmt=(n:number)=>n.toFixed(2),active=g.blades.find(b=>b.index===selected)??g.blades[0];
 const center=150,s=115/g.boreRadius;
 return <section className="rounded-xl border border-border overflow-hidden" aria-label="3D оснастки и зазоры">
  <div className="p-4 border-b border-border"><p className="text-xs text-muted-foreground uppercase tracking-widest">Оснастка в скважине · MD {result.md} м</p><h3 className="text-lg font-semibold mt-1">{spec.passport?.model}</h3><p className="text-sm mt-1">Зенит <b>{result.zenith.toFixed(1)}°</b> · Азимут <b>{azimuth.toFixed(1)}°</b> · TVD {result.tvd.toFixed(1)} м · {cased?'предыдущая колонна':'открытый ствол'}</p></div>
  <div className="grid lg:grid-cols-[1.35fr_1fr]">
   <div className="p-3 bg-slate-950 text-slate-200">
    <svg viewBox="0 0 600 520" className="w-full" style={{maxHeight:620}} role="img" aria-label="Объёмный центратор с широкими рессорами и кольцами под углом траектории">
     <defs><radialGradient id="cz-stage"><stop stopColor="#25354a"/><stop offset="1" stopColor="#080f1d"/></radialGradient></defs>
     <rect width="600" height="520" rx="12" fill="url(#cz-stage)"/>
     <line x1="40" y1="60" x2="40" y2="140" stroke="#718096" strokeDasharray="4 5"/><text x="28" y="48" fill="#94a3b8" fontSize="11">Вертикаль</text>
     {wall&&<g fill="none" stroke="#8193a9" strokeWidth="1" opacity=".35">{ends.map((r,i)=><polyline key={i} points={points(r)}/>)}{[4,12,20,28,36,44,52,60].map(i=><polyline key={i} points={points([ends[0][i],ends[1][i]])}/>)}</g>}
     {transformed.sort((a,b)=>a.v.reduce((n,v)=>n+v[2],0)/a.v.length-b.v.reduce((n,v)=>n+v[2],0)/b.v.length).map((f,i)=><polygon key={i} points={points(f.v)} fill={shade(f.v,f.kind)} stroke={shade(f.v,f.kind)} strokeWidth=".25" strokeLinejoin="round"/>)}
     <text x="24" y="493" fill="#94a3b8" fontSize="11">Размеры в одном масштабе · наклон по инклинометрии</text>
    </svg>
    <div className="grid grid-cols-2 gap-3 mt-2"><label className="text-xs">Обход вокруг скважины {orbit}°<input aria-label="Поворот 3D" type="range" min="-180" max="180" value={orbit} onChange={e=>setOrbit(+e.target.value)} className="w-full"/></label><label className="text-xs">Высота камеры {elevation}°<input aria-label="Высота камеры" type="range" min="-35" max="60" value={elevation} onChange={e=>setElevation(+e.target.value)} className="w-full"/></label></div>
    <div className="flex flex-wrap justify-between gap-2 mt-2 text-xs"><label><input type="checkbox" checked={wall} onChange={e=>setWall(e.target.checked)}/> Контур ствола</label><button className="underline" onClick={()=>{setOrbit(0);setElevation(0);}}>Вид сбоку по траектории</button></div>
   </div>
   <div className="p-4 space-y-4">
    <div className="grid grid-cols-2 gap-2">{[['Зазор труба - стенка, мин.',g.minPipeGap],['Зазор труба - стенка, макс.',g.maxPipeGap],['Проход ствола / колонны',boreDiameter],['Смещение оси по модели',g.offset]].map(([label,value])=><div key={label} className="rounded-lg bg-muted/50 p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="text-xl font-semibold tabular-nums">{fmt(value as number)} <span className="text-xs font-normal">мм</span></p></div>)}</div>
    <div className="border border-border rounded-lg p-3"><h4 className="text-sm font-medium">Сечение через вершины рессор</h4>
     <svg viewBox="0 0 300 300" className="w-full mx-auto max-w-[260px]" role="img" aria-label="Сечение с выбранной рессорой">
      <circle cx={center} cy={center} r={g.boreRadius*s} fill="#94a3b81a" stroke="#94a3b8"/><circle cx={center+g.offset*s} cy={center} r={g.pipeRadius*s} fill="#64748b"/><circle cx={center+g.offset*s} cy={center} r={casingID/2*s} fill="#0f172a"/>
      {g.blades.map(b=><line key={b.index} x1={center+(g.offset+g.pipeRadius*Math.cos(b.angle))*s} y1={center+g.pipeRadius*Math.sin(b.angle)*s} x2={center+(g.offset+b.loadedRadius*Math.cos(b.angle))*s} y2={center+b.loadedRadius*Math.sin(b.angle)*s} stroke={b.index===selected?'#f59e0b':'#e11d48'} strokeWidth="7"/>)}
      <line x1={center+(g.offset+active.loadedRadius*Math.cos(active.angle))*s} y1={center+active.loadedRadius*Math.sin(active.angle)*s} x2={center+(g.offset+active.wallRadius*Math.cos(active.angle))*s} y2={center+active.wallRadius*Math.sin(active.angle)*s} stroke="#f59e0b" strokeWidth="3"/>
     </svg><p className="text-xs text-center">Рессора {active.index}: зазор <b>{fmt(active.gap)} мм</b> · сжатие <b>{fmt(active.compression)} мм</b></p>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums"><thead><tr className="text-muted-foreground border-b"><th className="p-2 text-left">Рессора / лопасть</th><th>Сжатие, мм</th><th>Зазор до стенки, мм</th></tr></thead><tbody>{g.blades.map(b=><tr key={b.index} className={b.index===selected?'bg-amber-500/10':'border-b border-border/40'}><td><button aria-label={`Выбрать рессору ${b.index}`} className="p-2 w-full text-left" onClick={()=>setSelected(b.index)}>{b.index===selected?'● ':''}{b.index}</button></td><td className="text-center">{fmt(b.compression)}</td><td className="text-center">{fmt(b.gap)}</td></tr>)}</tbody></table></div>
    {g.rigidConflict&&<p role="alert" className="text-xs text-destructive">Отрицательный зазор означает пересечение со стенкой. Положение жёсткого изделия несовместимо с расчётным смещением оси.</p>}
   </div>
  </div>
  <details className="border-t border-border p-4 text-xs text-muted-foreground"><summary className="cursor-pointer">Исходные размеры и точность модели</summary><div className="space-y-2 mt-3"><p>Труба OD {fmt(casingOD)} мм, ID {fmt(casingID)} мм. Изделие OD {fmt(spec.passport!.outerDiameter!)} мм, длина {g.length} мм. Зенит и азимут определяют физический наклон; управление камерой меняет только ракурс.</p><p>Зазоры рассчитаны для круглого местного прохода и модельного эксцентриситета, вдоль радиуса каждой лопасти в её среднем сечении. Это не измеренная кавернометрия и не минимальная щель по всей ширине рессоры. Ориентация изделия вокруг трубы и направление эксцентриситета условные. Полная площадь прохода с учётом оснастки не рассчитывается.</p><p>Для 555 и SPRING ширина, длина рессор и OD колец взяты из паспортов. Длина кольца принята как половина разности общей длины и длины рессоры. Если размер ширины, толщины или колец не указан, для изображения использовано приближение; оно не входит в таблицу зазоров. Фото задаёт красное покрытие, а не материал. Для жёстких изделий форма зависит от типа и доступного угла лопастей.</p><p>Форма прогиба рессоры остаётся геометрической аппроксимацией с ограничением по стенке. Силовая характеристика и фактическая глубина установки не подтверждены. Для расчёта напряжений и реального прогиба нужны испытания и чертёж.</p></div></details>
 </section>;
}
