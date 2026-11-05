import { useMemo, useState } from 'react';
import type { CentralizationResult, CentralizerSpec } from '@/lib/centralization-calculations';
import { inspectCentralizer } from '@/lib/centralizer-clearance';
import { centralizerMesh, surveyTransform, type Vec3 } from '@/lib/centralizer-mesh';

export default function Centralizer3DInspector({spec,result,casingOD,casingID,boreDiameter,cased,azimuth=0,targetStandoff}:{
 spec:CentralizerSpec;result:CentralizationResult;casingOD:number;casingID:number;boreDiameter:number;cased:boolean;azimuth?:number;targetStandoff?:number;
}) {
 const [orbit,setOrbit]=useState(0),[elevation,setElevation]=useState(12),[selected,setSelected]=useState(0),[wall,setWall]=useState(true);
 const [gain,setGain]=useState(4),[showFree,setShowFree]=useState(true);
 const g=inspectCentralizer(spec,casingOD,boreDiameter,(result.supportEccentricity ?? result.eccentricity));
 const faces=useMemo(()=>centralizerMesh(spec,casingOD,casingID,boreDiameter,(result.supportEccentricity ?? result.eccentricity),selected),[spec,casingOD,casingID,boreDiameter,(result.supportEccentricity ?? result.eccentricity),selected]);
 if(!g)return <p className="p-4">Для объёмного вида внесите длину и наружный диаметр изделия в паспорт.</p>;
 const camera=(v:Vec3):Vec3=>{
   const [x,y,z]=surveyTransform(v,result.zenith,azimuth),a=(orbit-azimuth)*Math.PI/180,p=elevation*Math.PI/180;
   const rx=x*Math.cos(a)-y*Math.sin(a),ry=x*Math.sin(a)+y*Math.cos(a);
   return [rx,z*Math.cos(p)-ry*Math.sin(p),ry*Math.cos(p)+z*Math.sin(p)];
 };
 const visualRadius=(r:number)=>r <= g.pipeRadius ? r : g.pipeRadius+(r-g.pipeRadius)*gain;
 const visualOffset=g.offset*gain,visualBore=visualRadius(g.boreRadius);
 const device=(v:Vec3):Vec3=>{const x=v[0]-g.offset,y=v[1],r=Math.hypot(x,y),rr=visualRadius(r);return [visualOffset+(r?x*rr/r:0),r?y*rr/r:0,v[2]];};
 const transformed=faces.map(f=>({...f,v:f.points.map(v=>camera(device(v)))}));
 const freePaths=g.blades.map(b=>Array.from({length:41},(_,j)=>{
   const t=j/40,ringRadius=(spec.passport?.ringOD ?? casingOD+6)/2;
   const radius=ringRadius+(b.freeRadius-ringRadius)*Math.sin(Math.PI*t);
   const length=spec.passport?.springLength ?? g.length*.72;
   return camera(device([g.offset+radius*Math.cos(b.angle),radius*Math.sin(b.angle),(t-.5)*length]));
 }));
 const ring=(z:number)=>Array.from({length:65},(_,i)=>camera([visualBore*Math.cos(i*Math.PI/32),visualBore*Math.sin(i*Math.PI/32),z]));
 const ends=[ring(-g.length*.86),ring(g.length*.86)];
 const all=[...transformed.flatMap(f=>f.v),...ends.flat(),...(showFree?freePaths.flat():[])];
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
 const center=150,s=115/Math.max(visualBore,visualOffset+visualRadius(spec.passport!.outerDiameter!/2));
 const tip=(r:number,a:number)=>({x:center+(visualOffset+visualRadius(r)*Math.cos(a))*s,y:center+visualRadius(r)*Math.sin(a)*s});
 return <section className="rounded-xl border border-border overflow-hidden" aria-label="3D оснастки и зазоры">
  <div className="p-4 border-b border-border"><p className="text-xs text-muted-foreground uppercase tracking-widest">Оснастка в скважине · MD {result.md} м</p><h3 className="text-lg font-semibold mt-1">{spec.passport?.model}</h3><p className="text-sm mt-1">Зенит <b>{result.zenith.toFixed(1)}°</b> · Азимут <b>{azimuth.toFixed(1)}°</b> · TVD {result.tvd.toFixed(1)} м · {cased?'предыдущая колонна':'открытый ствол'}</p></div>
  <div className="grid grid-cols-3 gap-2 p-3 text-center border-b border-border"><div className="text-xs">Цель расстановки<b className="block text-lg">{targetStandoff === undefined ? 'Ручная' : `${targetStandoff}%`}</b></div><div className="text-xs">Standoff в пролёте<b className="block text-lg">{result.standoff.toFixed(1)}%</b></div><div className="text-xs">Standoff на опоре<b className="block text-lg">{(100*(1-(result.supportEccentricity ?? result.eccentricity))).toFixed(1)}%</b></div></div>
  {result.calculationAssumptions?.length ? <div className="px-4 py-2 text-xs text-amber-600 bg-amber-500/5">Оценочная модель. {result.calculationAssumptions.join(' ')}</div> : null}
  <div className="grid lg:grid-cols-[1.35fr_1fr]">
   <div className="p-3 bg-slate-950 text-slate-200">
    <svg viewBox="0 0 600 520" className="w-full" style={{maxHeight:620}} role="img" aria-label="Объёмный центратор с широкими рессорами и кольцами под углом траектории">
     <defs><radialGradient id="cz-stage"><stop stopColor="#25354a"/><stop offset="1" stopColor="#080f1d"/></radialGradient></defs>
     <rect width="600" height="520" rx="12" fill="url(#cz-stage)"/>
     <line x1="40" y1="60" x2="40" y2="140" stroke="#718096" strokeDasharray="4 5"/><text x="28" y="48" fill="#94a3b8" fontSize="11">Вертикаль</text>
     {wall&&<g fill="none" stroke="#8193a9" strokeWidth="1" opacity=".35">{ends.map((r,i)=><polyline key={i} points={points(r)}/>)}{[4,12,20,28,36,44,52,60].map(i=><polyline key={i} points={points([ends[0][i],ends[1][i]])}/>)}</g>}
     {showFree&&spec.type==='spring'&&<g fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="6 5" opacity=".8">{freePaths.map((path,i)=><polyline key={i} points={points(path)}/>)}</g>}
     {transformed.sort((a,b)=>a.v.reduce((n,v)=>n+v[2],0)/a.v.length-b.v.reduce((n,v)=>n+v[2],0)/b.v.length).map((f,i)=><polygon key={i} points={points(f.v)} fill={shade(f.v,f.kind)} stroke={shade(f.v,f.kind)} strokeWidth=".25" strokeLinejoin="round"/>)}
     <text x="24" y="493" fill="#94a3b8" fontSize="11">Радиальные зазоры и деформация ×{gain} · наклон по инклинометрии</text>
    </svg>
    <div className="rounded border border-slate-700 p-3 my-2 text-xs space-y-2"><label className="block">Увеличение радиальных зазоров и прогиба ×{gain}<input aria-label="Увеличение деформации" type="range" min="1" max="8" step="1" value={gain} onChange={e=>setGain(+e.target.value)} className="w-full"/></label><label className="block"><input type="checkbox" checked={showFree} onChange={e=>setShowFree(e.target.checked)}/> Пунктиром показать свободную форму до сжатия</label><p>Масштаб усилен только для наглядности. Все числа в мм - расчётные, без увеличения.</p></div>
    <div className="grid grid-cols-2 gap-3 mt-2"><label className="text-xs">Обход вокруг скважины {orbit}°<input aria-label="Поворот 3D" type="range" min="-180" max="180" value={orbit} onChange={e=>setOrbit(+e.target.value)} className="w-full"/></label><label className="text-xs">Высота камеры {elevation}°<input aria-label="Высота камеры" type="range" min="-35" max="60" value={elevation} onChange={e=>setElevation(+e.target.value)} className="w-full"/></label></div>
    <div className="flex flex-wrap justify-between gap-2 mt-2 text-xs"><label><input type="checkbox" checked={wall} onChange={e=>setWall(e.target.checked)}/> Контур ствола</label><button className="underline" onClick={()=>{setOrbit(0);setElevation(0);}}>Вид сбоку по траектории</button></div>
   </div>
   <div className="p-4 space-y-4">
    <div className="grid grid-cols-2 gap-2">{[['Зазор труба - стенка, мин.',g.minPipeGap],['Зазор труба - стенка, макс.',g.maxPipeGap],['Проход ствола / колонны',boreDiameter],['Смещение оси по модели',g.offset]].map(([label,value])=><div key={label} className="rounded-lg bg-muted/50 p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="text-xl font-semibold tabular-nums">{fmt(value as number)} <span className="text-xs font-normal">мм</span></p></div>)}</div>
    <div className="border border-border rounded-lg p-3"><h4 className="text-sm font-medium">Сжатая и свободная форма · зазоры ×{gain}</h4><p className="text-xs text-muted-foreground mt-1">Голубой пунктир - до сжатия. Красный - в стволе. При контакте со стенкой зазор 0 мм, но сжатие рессор различается.</p>
     <svg viewBox="0 0 300 300" className="w-full mx-auto max-w-[260px]" role="img" aria-label="Сечение с выбранной рессорой">
      <circle cx={center} cy={center} r={visualBore*s} fill="#94a3b81a" stroke="#94a3b8"/>
      {showFree&&<circle cx={center+visualOffset*s} cy={center} r={visualRadius(spec.passport!.outerDiameter!/2)*s} fill="none" stroke="#0891b2" strokeDasharray="5 4"/>}
      <circle cx={center+visualOffset*s} cy={center} r={g.pipeRadius*s} fill="#64748b"/><circle cx={center+visualOffset*s} cy={center} r={casingID/2*s} fill="#0f172a"/>
      {g.blades.map(b=>{const start=tip(g.pipeRadius,b.angle),end=tip(b.loadedRadius,b.angle),free=tip(b.freeRadius,b.angle);return <g key={b.index}><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={b.index===selected?'#f59e0b':'#e11d48'} strokeWidth="7"/>{showFree&&<line x1={end.x} y1={end.y} x2={free.x} y2={free.y} stroke="#0891b2" strokeWidth="2" strokeDasharray="3 3"/>}</g>;})}
      <line x1={tip(active.loadedRadius,active.angle).x} y1={tip(active.loadedRadius,active.angle).y} x2={tip(active.wallRadius,active.angle).x} y2={tip(active.wallRadius,active.angle).y} stroke="#f59e0b" strokeWidth="3"/>

     </svg><p className="text-xs text-center">Рессора {active.index}: зазор <b>{fmt(active.gap)} мм</b> · сжатие <b>{fmt(active.compression)} мм</b></p>
    </div>
    {result.spanSagMM !== undefined && <div className="border border-border rounded-lg p-3"><h4 className="text-sm font-medium">Прогиб трубы между опорами</h4><svg viewBox="0 0 320 130" className="w-full" role="img" aria-label="Продольный профиль расчётного прогиба трубы"><line x1="20" y1="30" x2="300" y2="30" stroke="#94a3b8" strokeDasharray="5 4"/>{[20,300].map(x=><path key={x} d={`M${x-8},100 L${x},80 L${x+8},100 Z`} fill="#0891b2"/>)}<path d={`M20,${45+g.offset/Math.max(1,g.boreRadius-g.pipeRadius)*15} Q160,${45+g.offset/Math.max(1,g.boreRadius-g.pipeRadius)*15+Math.min(65,(result.spanSagMM??0)*2)} 300,${45+g.offset/Math.max(1,g.boreRadius-g.pipeRadius)*15}`} stroke="#e11d48" strokeWidth="9" fill="none"/><text x="160" y="122" textAnchor="middle" fontSize="12" fill="currentColor">Прогиб пролёта {fmt(result.spanSagMM)} мм</text></svg><p className="text-xs text-muted-foreground">Схема с усиленной поперечной деформацией. Сечение выше показано на опоре; минимум Standoff может находиться между центраторами.</p></div>}
    {result.lateralLoadKN !== undefined && <div className="rounded-lg border border-border p-3 text-xs space-y-1"><p>Расчётная нагрузка на опору: <b>{fmt(result.lateralLoadKN)} кН</b></p><p>Прогиб трубы между опорами: <b>{fmt(result.spanSagMM ?? 0)} мм</b></p><p>В 3D показан прогиб рессор на опоре; Standoff в профиле учитывает также прогиб пролёта.</p>{result.supportOverloaded && <p className="text-destructive">Нагрузка превышает реакцию модельных рессор до касания трубы со стенкой.</p>}</div>}
    <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums"><thead><tr className="text-muted-foreground border-b"><th className="p-2 text-left">Рессора / лопасть</th><th>Сжатие, мм</th><th>Зазор до стенки, мм</th></tr></thead><tbody>{g.blades.map(b=><tr key={b.index} className={b.index===selected?'bg-amber-500/10':'border-b border-border/40'}><td><button aria-label={`Выбрать рессору ${b.index}`} className="p-2 w-full text-left" onClick={()=>setSelected(b.index)}>{b.index===selected?'● ':''}{b.index}</button></td><td className="text-center">{fmt(b.compression)}</td><td className="text-center">{fmt(b.gap)}</td></tr>)}</tbody></table></div>
    {g.rigidConflict&&<p role="alert" className="text-xs text-destructive">Отрицательный зазор означает пересечение со стенкой. Положение жёсткого изделия несовместимо с расчётным смещением оси.</p>}
   </div>
  </div>
  <details className="border-t border-border p-4 text-xs text-muted-foreground"><summary className="cursor-pointer">Исходные размеры и точность модели</summary><div className="space-y-2 mt-3"><p>Труба OD {fmt(casingOD)} мм, ID {fmt(casingID)} мм. Изделие OD {fmt(spec.passport!.outerDiameter!)} мм, длина {g.length} мм. Зенит и азимут определяют физический наклон; управление камерой меняет только ракурс.</p><p>Зазоры рассчитаны для круглого местного прохода и модельного эксцентриситета, вдоль радиуса каждой лопасти в её среднем сечении. Это не измеренная кавернометрия и не минимальная щель по всей ширине рессоры. Ориентация изделия вокруг трубы и направление эксцентриситета условные. Полная площадь прохода с учётом оснастки не рассчитывается.</p><p>Для 555 и SPRING ширина, длина рессор и OD колец взяты из паспортов. Длина кольца принята как половина разности общей длины и длины рессоры. Если размер ширины, толщины или колец не указан, для изображения использовано приближение; оно не входит в таблицу зазоров. Фото задаёт красное покрытие, а не материал. Для жёстких изделий форма зависит от типа и доступного угла лопастей.</p><p>Смещение опоры рассчитано из равновесия поперечной нагрузки и суммарной реакции рессор. Рессоры линейные, контакт со стенкой односторонний; форма деформированной дуги - аппроксимация с ограничением по стенке. Силовая характеристика и фактическая глубина установки не подтверждены. Для расчёта напряжений и реального прогиба нужны испытания и чертёж.</p></div></details>
 </section>;
}
