import { useMemo, useState } from 'react';
import type { CentralizationResult, CentralizerSpec } from '@/lib/centralization-calculations';
import { centralizerShape, bladeCurve, bladePoint, bladeSection, bladeRadius, displayCentralizerPoint } from '@/lib/centralizer-shape';
import { centralizerMesh, surveyTransform, type Vec3 } from '@/lib/centralizer-mesh';

export default function Centralizer3DInspector({spec,result,casingOD,casingID,boreDiameter,cased,azimuth=0,targetStandoff}:{
 spec:CentralizerSpec;result:CentralizationResult;casingOD:number;casingID:number;boreDiameter:number;cased:boolean;azimuth?:number;targetStandoff?:number;
}) {
 const [orbit,setOrbit]=useState(0),[elevation,setElevation]=useState(12),[selected,setSelected]=useState(1),[wall,setWall]=useState(true);
 const [axial,setAxial]=useState(false),[transparent,setTransparent]=useState(true);
 const [gain,setGain]=useState(6),[showFree,setShowFree]=useState(true);
 const g=centralizerShape(spec,casingOD,boreDiameter,(result.supportEccentricity ?? result.eccentricity));
 const faces=useMemo(()=>centralizerMesh(spec,casingOD,casingID,boreDiameter,(result.supportEccentricity ?? result.eccentricity),selected),[spec,casingOD,casingID,boreDiameter,(result.supportEccentricity ?? result.eccentricity),selected]);
 if(!g)return <p className="p-4">Для объёмного вида внесите длину и наружный диаметр изделия в паспорт.</p>;
 const camera=(v:Vec3):Vec3=>{
   if(axial)return [-v[1],-v[0],v[2]];
   const [x,y,z]=surveyTransform(v,result.zenith,azimuth),a=(orbit-azimuth)*Math.PI/180,p=elevation*Math.PI/180;
   const rx=x*Math.cos(a)-y*Math.sin(a),ry=x*Math.sin(a)+y*Math.cos(a);
   return [rx,z*Math.cos(p)-ry*Math.sin(p),ry*Math.cos(p)+z*Math.sin(p)];
 };
 const visualRadius=(r:number)=>r <= g.pipeRadius ? r : g.pipeRadius+(r-g.pipeRadius)*gain;
 const visualOffset=g.offset*gain,visualBore=visualRadius(g.boreRadius);
 const device=(v:Vec3):Vec3=>displayCentralizerPoint(g,v,gain);
 const transformed=faces.map(f=>({...f,v:f.points.map(v=>camera(device(v)))}));
 const freePaths=g.blades.map(b=>bladeCurve(g,b,'free').map(v=>camera(device(v))));
 const ring=(z:number)=>Array.from({length:65},(_,i)=>camera(device([g.boreRadius*Math.cos(i*Math.PI/32),g.boreRadius*Math.sin(i*Math.PI/32),z])));
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
   if(kind==='selected')return `hsl(30,95%,${35+light*30}%)`;
   if(kind==='edge')return `hsl(220,14%,${18+light*30}%)`;
   return `hsl(215,12%,${25+light*48+shine*15}%)`;
 };
 const fmt=(n:number)=>n.toFixed(2),active=g.blades.find(b=>b.index===selected)??g.blades[0];
 const crossPoint=(v:Vec3)=>{const d=device(v);return {x:150-d[1]*crossScale,y:150+d[0]*crossScale};};
 const crossBore=Array.from({length:65},(_,i)=>[g.boreRadius*Math.cos(i*Math.PI/32),g.boreRadius*Math.sin(i*Math.PI/32),0] as Vec3);
 const crossBounds=[...crossBore,...(showFree?g.blades.flatMap(b=>bladeSection(g,b,'free')):[])].map(device);
 const crossScale=118/Math.max(...crossBounds.flatMap(p=>[Math.abs(p[0]),Math.abs(p[1])]),1);
 const crossPoints=(path:Vec3[])=>path.map(v=>{const p=crossPoint(v);return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;}).join(' ');
 const profile=(state:'free'|'installed'|'loaded')=>Array.from({length:65},(_,i)=>`${30+i/64*540},${220-(bladeRadius(g,active,i/64,state)-g.pipeRadius)*180/Math.max(1,active.freeRadius-g.pipeRadius)}`).join(' ');
 const pipeCross=crossPoint([g.offset,0,0]);
 const activeLoaded=bladeCurve(g,active).map(v=>camera(device(v))),activeFree=bladeCurve(g,active,'free').map(v=>camera(device(v)));
 const arrow=[camera(device(bladePoint(g,active,.5))),camera(device(bladePoint(g,active,.5,0,false,'free')))];
 const lowSide=project(camera([visualBore*1.12,0,0])),highSide=project(camera([-visualBore*1.12,0,0]));
 return <section className="rounded-xl border border-border overflow-hidden" aria-label="3D оснастки и зазоры">
  <div className="p-4 border-b border-border"><p className="text-xs text-muted-foreground uppercase tracking-widest">Оснастка в скважине · MD {result.md} м</p><h3 className="text-lg font-semibold mt-1">{spec.passport?.model}</h3><p className="text-sm mt-1">Зенит <b>{result.zenith.toFixed(1)}°</b> · Азимут <b>{azimuth.toFixed(1)}°</b> · TVD {result.tvd.toFixed(1)} м · {cased?'предыдущая колонна':'открытый ствол'}</p></div>
  <div className="grid grid-cols-3 gap-2 p-3 text-center border-b border-border"><div className="text-xs">Цель расстановки<b className="block text-lg">{targetStandoff === undefined ? 'Ручная' : `${targetStandoff}%`}</b></div><div className="text-xs">Standoff в пролёте<b className="block text-lg">{result.standoff.toFixed(1)}%</b></div><div className="text-xs">Standoff на опоре<b className="block text-lg">{(100*(1-(result.supportEccentricity ?? result.eccentricity))).toFixed(1)}%</b></div></div>
  {result.calculationAssumptions?.length ? <div className="px-4 py-2 text-xs text-amber-600 bg-amber-500/5">Оценочная модель. {result.calculationAssumptions.join(' ')}</div> : null}
  <div className="grid lg:grid-cols-[1.35fr_1fr]">
   <div className="p-3 bg-slate-950 text-slate-200">
    <svg viewBox="0 0 600 520" className="w-full" style={{maxHeight:620}} role="img" aria-label="Объёмный центратор с широкими рессорами и кольцами под углом траектории">
     <defs><radialGradient id="cz-stage"><stop stopColor="#25354a"/><stop offset="1" stopColor="#080f1d"/></radialGradient></defs>
     <rect width="600" height="520" rx="12" fill="url(#cz-stage)"/>
     <line x1="40" y1="60" x2="40" y2="140" stroke="#718096" strokeDasharray="4 5"/><path d="M35,133 L40,143 L45,133" fill="#94a3b8"/><text x="28" y="48" fill="#94a3b8" fontSize="11">Вес ↓</text>
     {wall&&<g fill="none" stroke="#8193a9" strokeWidth="1" opacity=".35">{ends.map((r,i)=><polyline key={i} points={points(r)}/>)}{[4,12,20,28,36,44,52,60].map(i=><polyline key={i} points={points([ends[0][i],ends[1][i]])}/>)}</g>}
     {showFree&&spec.type==='spring'&&<g fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="6 5" opacity=".8">{freePaths.map((path,i)=><polyline key={i} points={points(path)}/>)}</g>}
     {transformed.sort((a,b)=>a.v.reduce((n,v)=>n+v[2],0)/a.v.length-b.v.reduce((n,v)=>n+v[2],0)/b.v.length).map((f,i)=><polygon key={i} points={points(f.v)} fill={shade(f.v,f.kind)} stroke={shade(f.v,f.kind)} strokeWidth=".25" strokeLinejoin="round" opacity={transparent&&f.part==='pipe'?.18:1}/>)}
     {spec.type==='spring'&&<g fill="none" strokeLinejoin="round"><polyline points={points(activeLoaded)} stroke="#fbbf24" strokeWidth="3"/>{showFree&&<><polyline points={points(activeFree)} stroke="#22d3ee" strokeWidth="2" strokeDasharray="6 4"/><polyline points={points(arrow)} stroke="#fbbf24" strokeWidth="2"/></>}</g>}
     {result.zenith>.1&&<g fontSize="12" fontWeight="600" textAnchor="middle"><text x={highSide[0]} y={highSide[1]-8} fill="#cbd5e1">Верх</text><text x={lowSide[0]} y={lowSide[1]+16} fill="#fbbf24">Низ · вес</text></g>}
     <text x="24" y="493" fill="#94a3b8" fontSize="11">Радиальные зазоры и деформация ×{gain} · наклон по инклинометрии</text>
    </svg>
    <div className="rounded border border-slate-700 p-3 my-2 text-xs space-y-2"><label className="block">Увеличение радиальных зазоров и прогиба ×{gain}<input aria-label="Увеличение деформации" type="range" min="1" max="12" step="1" value={gain} onChange={e=>setGain(+e.target.value)} className="w-full"/></label><label className="block"><input type="checkbox" checked={showFree} onChange={e=>setShowFree(e.target.checked)}/> Пунктиром показать свободную форму до сжатия</label><p>Выбрана планка {active.index}: полное сжатие {fmt(active.compression)} мм, изменение под нагрузкой {active.loadCompression >= 0 ? "+" : ""}{fmt(active.loadCompression)} мм.</p><p>Масштаб усилен только для наглядности. Все числа в мм - расчётные, без увеличения.</p></div>
    <div className="grid grid-cols-2 gap-3 mt-2"><label className="text-xs">Обход вокруг скважины {orbit}°<input aria-label="Поворот 3D" type="range" min="-180" max="180" value={orbit} onChange={e=>setOrbit(+e.target.value)} className="w-full"/></label><label className="text-xs">Высота камеры {elevation}°<input aria-label="Высота камеры" type="range" min="-35" max="60" value={elevation} onChange={e=>setElevation(+e.target.value)} className="w-full"/></label></div>
    <div className="flex flex-wrap justify-between gap-2 mt-2 text-xs"><label><input type="checkbox" checked={wall} onChange={e=>setWall(e.target.checked)}/> Контур ствола</label><label><input type="checkbox" checked={transparent} onChange={e=>setTransparent(e.target.checked)}/> Прозрачная труба</label><button className="underline" onClick={()=>{setAxial(false);setOrbit(0);setElevation(0);}}>Вид сбоку по траектории</button><button className="underline" onClick={()=>setAxial(true)}>Вид вдоль оси</button><button className="underline" onClick={()=>{setAxial(false);setOrbit(-30);setElevation(25);}}>Объёмный вид</button></div>
   </div>
   <div className="p-4 space-y-4">
    <div className="grid grid-cols-2 gap-2">{[['Зазор труба - стенка, мин.',g.minPipeGap],['Зазор труба - стенка, макс.',g.maxPipeGap],['Проход ствола / колонны',boreDiameter],['Смещение оси по модели',g.offset]].map(([label,value])=><div key={label} className="rounded-lg bg-muted/50 p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="text-xl font-semibold tabular-nums">{fmt(value as number)} <span className="text-xs font-normal">мм</span></p></div>)}</div>
    <div className="border border-border rounded-lg p-3"><h4 className="text-sm font-medium">Сжатая и свободная форма · зазоры ×{gain}</h4><p className="text-xs text-muted-foreground mt-1">Сечение через вершины планок. Голубой пунктир - свободная форма, красные полосы - реальные сечения планок. При контакте вершины лежат на стенке, но их сжатие различается. Изгиб вдоль планки показан ниже.</p>
     <svg viewBox="0 0 300 300" className="w-full mx-auto max-w-[260px]" role="img" aria-label="Сечение с выбранной рессорой">
      {result.zenith>.1&&<g fontSize="12" textAnchor="middle" fill="currentColor"><text x="150" y="18">ВЕРХ</text><text x="150" y="293">НИЗ · ВЕС ↓</text></g>}
      <polygon points={crossPoints(crossBore)} fill="#94a3b8" fillOpacity=".10" stroke="#94a3b8"/>
      <circle cx={pipeCross.x} cy={pipeCross.y} r={g.pipeRadius*crossScale} fill="#64748b"/><circle cx={pipeCross.x} cy={pipeCross.y} r={casingID/2*crossScale} fill="#0f172a"/>
      {g.blades.map(b=>{const actual=bladePoint(g,b,.5),free=bladePoint(g,b,.5,0,false,'free'),a=crossPoint(actual),f=crossPoint(free);return <g key={b.index} onClick={()=>setSelected(b.index)} style={{cursor:'pointer'}} aria-label={`Сечение планки ${b.index}`}>
        {showFree&&<><polygon points={crossPoints(bladeSection(g,b,'free'))} fill="none" stroke="#0891b2" strokeWidth="1.5" strokeDasharray="4 3"/><line x1={a.x} y1={a.y} x2={f.x} y2={f.y} stroke="#0891b2" strokeWidth="1.5" strokeDasharray="3 3"/></>}
        <polygon points={crossPoints(bladeSection(g,b))} fill={b.index===active.index?'#f59e0b':'#e11d48'} stroke={b.index===active.index?'#f59e0b':'#e11d48'} strokeWidth="1"/>
        <text x={f.x} y={f.y+(Math.cos(b.angle)>0?12:-5)} textAnchor="middle" fontSize="10" fill="currentColor">{b.index}: {fmt(b.compression)} мм</text>
      </g>;})}

     </svg><p className="text-xs text-center">Рессора {active.index}: зазор <b>{fmt(active.gap)} мм</b> · сжатие <b>{fmt(active.compression)} мм</b></p>
    </div>
    {spec.type==='spring'&&<div className="border border-border rounded-lg p-3 space-y-2"><h4 className="text-sm font-medium">Продольный профиль планки {active.index}</h4>
      <svg viewBox="0 0 600 250" className="w-full" role="img" aria-label="Свободная, установленная и нагруженная форма планки"><rect x="20" y="222" width="560" height="12" fill="#64748b"/><polyline points={profile('free')} fill="none" stroke="#0891b2" strokeWidth="3" strokeDasharray="7 4"/><polyline points={profile('installed')} fill="none" stroke="#94a3b8" strokeWidth="3" strokeDasharray="3 4"/><polyline points={profile('loaded')} fill="none" stroke="#e11d48" strokeWidth="4"/></svg>
      <p className="text-xs">Голубой - свободная планка. Серый - монтаж в стволе при соосной колонне. Красный - под расчётной нагрузкой. Осевой и поперечный масштабы различаются для наглядности.</p>
      <p className="text-xs">Монтажное сжатие: <b>{fmt(active.mountingCompression)} мм</b>. Изменение от нагрузки: <b>{active.loadCompression>=0?'+':''}{fmt(active.loadCompression)} мм</b>. Полное сжатие: <b>{fmt(active.compression)} мм</b>.</p>
      <p className="text-xs text-muted-foreground">Целевой Standoff управляет расстановкой. Деформацию планок определяют нагрузка и смещение на опоре. Меньший Standoff обычно допускает большее сжатие нижних планок; верхние могут разгружаться. При неизменных шаге и нагрузке форма не меняется.</p>
    </div>}
    {result.spanSagMM !== undefined && <div className="border border-border rounded-lg p-3"><h4 className="text-sm font-medium">Прогиб трубы между опорами</h4><svg viewBox="0 0 320 130" className="w-full" role="img" aria-label="Продольный профиль расчётного прогиба трубы"><line x1="20" y1="30" x2="300" y2="30" stroke="#94a3b8" strokeDasharray="5 4"/>{[20,300].map(x=><path key={x} d={`M${x-8},100 L${x},80 L${x+8},100 Z`} fill="#0891b2"/>)}<path d={`M20,${45+g.offset/Math.max(1,g.boreRadius-g.pipeRadius)*15} Q160,${45+g.offset/Math.max(1,g.boreRadius-g.pipeRadius)*15+Math.min(65,(result.spanSagMM??0)*2)} 300,${45+g.offset/Math.max(1,g.boreRadius-g.pipeRadius)*15}`} stroke="#e11d48" strokeWidth="9" fill="none"/><text x="160" y="122" textAnchor="middle" fontSize="12" fill="currentColor">Прогиб пролёта {fmt(result.spanSagMM)} мм</text></svg><p className="text-xs text-muted-foreground">Схема с усиленной поперечной деформацией. Сечение выше показано на опоре; минимум Standoff может находиться между центраторами.</p></div>}
    {result.lateralLoadKN !== undefined && <div className="rounded-lg border border-border p-3 text-xs space-y-1"><p>Расчётный пролёт между опорами: <b>{result.supportSpanM === undefined ? "не задан" : fmt(result.supportSpanM)+" м"}</b></p><p>Расчётная нагрузка на опору: <b>{fmt(result.lateralLoadKN)} кН</b></p><p>Прогиб трубы между опорами: <b>{fmt(result.spanSagMM ?? 0)} мм</b></p><p>В 3D показан прогиб рессор на опоре; Standoff в профиле учитывает также прогиб пролёта.</p>{result.supportOverloaded && <p className="text-destructive">Нагрузка превышает реакцию модельных рессор до касания трубы со стенкой.</p>}</div>}
    <div className="overflow-x-auto"><table className="w-full text-xs tabular-nums"><thead><tr className="text-muted-foreground border-b"><th className="p-2 text-left">Рессора / лопасть</th><th>Монтаж, мм</th><th>От нагрузки, мм</th><th>Всего, мм</th><th>Зазор, мм</th></tr></thead><tbody>{g.blades.map(b=><tr key={b.index} className={b.index===selected?'bg-amber-500/10':'border-b border-border/40'}><td><button aria-label={`Выбрать рессору ${b.index}`} className="p-2 w-full text-left" onClick={()=>setSelected(b.index)}>{b.index===selected?'● ':''}{b.index}</button></td><td className="text-center">{fmt(b.mountingCompression)}</td><td className="text-center">{b.loadCompression>=0?"+":""}{fmt(b.loadCompression)}</td><td className="text-center">{fmt(b.compression)}</td><td className="text-center">{fmt(b.gap)}</td></tr>)}</tbody></table></div>
    {g.spring&&g.blades.some(b=>b.wallRadius<g.pipeRadius+g.thickness)&&<p role="alert" className="text-xs text-destructive">Геометрический конфликт: в зоне контакта не хватает места для толщины планки. Форма в этой зоне не является физически допустимой; проверьте нагрузку, шаг и размеры.</p>}
    {g.rigidConflict&&<p role="alert" className="text-xs text-destructive">Отрицательный зазор означает пересечение со стенкой. Положение жёсткого изделия несовместимо с расчётным смещением оси.</p>}
   </div>
  </div>
  <details className="border-t border-border p-4 text-xs text-muted-foreground"><summary className="cursor-pointer">Исходные размеры и точность модели</summary><div className="space-y-2 mt-3"><p>Труба OD {fmt(casingOD)} мм, ID {fmt(casingID)} мм. Изделие OD {fmt(spec.passport!.outerDiameter!)} мм, длина {g.length} мм. Зенит и азимут определяют физический наклон; управление камерой меняет только ракурс.</p><p>Зазоры рассчитаны для круглого местного прохода и модельного эксцентриситета, вдоль радиуса каждой лопасти в её среднем сечении. Это не измеренная кавернометрия и не минимальная щель по всей ширине рессоры. Положительное смещение направлено к гравитационной нижней стороне ствола; сверху остаётся больший зазор. Ориентация изделия вокруг трубы условная. Полный вектор реакции на криволинейном участке (включая направление прижатия натяжением) не рассчитывается: его нельзя восстановить по одному модулю эксцентриситета. Полная площадь прохода с учётом оснастки не рассчитывается.</p><p>Для 555 и SPRING ширина, длина рессор и OD колец взяты из паспортов. Длина кольца принята как половина разности общей длины и длины рессоры. Если размер ширины, толщины или колец не указан, для изображения использовано приближение; оно не входит в таблицу зазоров. Фото задаёт красное покрытие, а не материал. Для жёстких изделий форма зависит от типа и доступного угла лопастей.</p><p>Смещение опоры рассчитано из равновесия поперечной нагрузки и суммарной реакции рессор. Рессоры линейные, контакт со стенкой односторонний; форма деформированной дуги - аппроксимация с ограничением по стенке. Силовая характеристика и фактическая глубина установки не подтверждены. Для расчёта напряжений и реального прогиба нужны испытания и чертёж.</p></div></details>
 </section>;
}
