import { useState } from 'react';
import type { CentralizationResult, CentralizerSpec } from '@/lib/centralization-calculations';
import { inspectCentralizer } from '@/lib/centralizer-clearance';

export default function Centralizer3DInspector({spec, result, casingOD, boreDiameter, cased}: {
 spec:CentralizerSpec; result:CentralizationResult; casingOD:number; boreDiameter:number; cased:boolean;
}) {
 const [rotation,setRotation]=useState(35);
 const [tilt,setTilt]=useState(25);
 const [cutaway,setCutaway]=useState(true);
 const g=inspectCentralizer(spec,casingOD,boreDiameter,result.eccentricity);
 if(!g) return <p role="status" className="p-4 text-sm">Для 3D внесите наружный диаметр и длину изделия из паспорта. Диаметр прохода должен быть больше диаметра трубы.</p>;
 const angle=rotation*Math.PI/180, pitch=tilt*Math.PI/180;
 const scale=330/Math.max(g.length,boreDiameter*1.5);
 const project=(x:number,y:number,z:number):[number,number] => {
   const rx=x*Math.cos(angle)-y*Math.sin(angle), ry=x*Math.sin(angle)+y*Math.cos(angle);
   return [250+rx*scale,210+(ry*Math.sin(pitch)-z*Math.cos(pitch))*scale];
 };
 const path=(pts:[number,number,number][])=>pts.map(v=>project(...v).map(n=>n.toFixed(2)).join(',')).join(' ');
 const ring=(radius:number,z:number,offset=0)=>Array.from({length:65},(_,i)=>{const a=i*Math.PI*2/64;return [offset+radius*Math.cos(a),radius*Math.sin(a),z] as [number,number,number];});
 const fmt=(n:number)=>n.toFixed(2);
 return <section className="border border-border rounded-lg p-4 space-y-3" aria-label="3D оснастки и зазоры">
   <h3 className="font-medium">3D оснастки в выбранном сечении MD {result.md} м</h3>
   <p className="text-xs">{spec.passport?.model} · TVD {result.tvd.toFixed(1)} м · зенит {result.zenith.toFixed(1)}° · {cased?'внутри предыдущей колонны':'открытый ствол'}</p>
   <div className="grid md:grid-cols-2 gap-4">
    <div>
     <svg viewBox="0 0 500 420" className="w-full max-h-[480px] rounded bg-slate-950" role="img" aria-label="Вращаемая пространственная модель трубы, стенки и рессор">
      <polyline points={path(ring(g.boreRadius,-g.length/2))} fill="none" stroke="#64748b" />
      {[0,1,2,3,4,5,6,7].filter(i=>!cutaway||i>=4).map(i=>{const a=i*Math.PI/4;return <line key={i} x1={project(g.boreRadius*Math.cos(a),g.boreRadius*Math.sin(a),-g.length/2)[0]} y1={project(g.boreRadius*Math.cos(a),g.boreRadius*Math.sin(a),-g.length/2)[1]} x2={project(g.boreRadius*Math.cos(a),g.boreRadius*Math.sin(a),g.length/2)[0]} y2={project(g.boreRadius*Math.cos(a),g.boreRadius*Math.sin(a),g.length/2)[1]} stroke="#64748b" opacity=".45"/>;})}
      {Array.from({length:24},(_,i)=>{const a=i*Math.PI*2/24,b=(i+1)*Math.PI*2/24;return <polygon key={i} points={path([[g.offset+g.pipeRadius*Math.cos(a),g.pipeRadius*Math.sin(a),-g.length/2],[g.offset+g.pipeRadius*Math.cos(b),g.pipeRadius*Math.sin(b),-g.length/2],[g.offset+g.pipeRadius*Math.cos(b),g.pipeRadius*Math.sin(b),g.length/2],[g.offset+g.pipeRadius*Math.cos(a),g.pipeRadius*Math.sin(a),g.length/2]])} fill={i%2?'#475569':'#64748b'} opacity=".7"/>;})}
      {g.blades.map(b=>{const pts=Array.from({length:41},(_,j)=>{const t=j/40;const r=spec.type==='spring'?g.pipeRadius+(b.loadedRadius-g.pipeRadius)*Math.sin(Math.PI*t):b.loadedRadius;return [g.offset+r*Math.cos(b.angle),r*Math.sin(b.angle),(t-.5)*g.length] as [number,number,number];});const mid=project(g.offset+b.loadedRadius*Math.cos(b.angle),b.loadedRadius*Math.sin(b.angle),0);return <g key={b.index}><polyline points={path(pts)} fill="none" stroke={b.interference>.1?'#fb923c':'#22d3ee'} strokeWidth="5"/><text x={mid[0]+6} y={mid[1]} fill="white" fontSize="13">{b.index}</text></g>;})}
      <polyline points={path(ring(g.boreRadius,g.length/2))} fill="none" stroke="#94a3b8"/>
     </svg>
     <label className="block text-xs">Поворот {rotation}°<input aria-label="Поворот 3D" type="range" min="0" max="360" value={rotation} onChange={e=>setRotation(+e.target.value)} className="w-full"/></label>
     <label className="block text-xs">Наклон вида {tilt}°<input aria-label="Наклон 3D" type="range" min="5" max="80" value={tilt} onChange={e=>setTilt(+e.target.value)} className="w-full"/></label>
     <label className="text-xs flex gap-2"><input type="checkbox" checked={cutaway} onChange={e=>setCutaway(e.target.checked)}/>Скрыть передние образующие стенки</label>
    </div>
    <div className="text-sm space-y-2">
     <p>Проход ствола / колонны: <b>{fmt(boreDiameter)} мм</b></p><p>Труба OD: <b>{fmt(casingOD)} мм</b></p><p>Оснастка OD: <b>{fmt(spec.passport!.outerDiameter!)} мм</b></p>
     <p>Смещение оси по модели: <b>{fmt(g.offset)} мм</b></p><p>Зазор труба - стенка: <b>{fmt(g.minPipeGap)}–{fmt(g.maxPipeGap)} мм</b></p>
     <p>Кольцевое сечение без учёта оснастки: <b>{fmt(g.annularArea/100)} см²</b></p>
     <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th>Лопасть</th><th>Сжатие, мм</th><th>Зазор, мм</th></tr></thead><tbody>{g.blades.map(b=><tr key={b.index}><td>{b.index}</td><td>{fmt(b.compression)}</td><td>{fmt(b.gap)}</td></tr>)}</tbody></table></div>
     {g.rigidConflict&&<p role="alert" className="text-destructive">Жёсткое изделие пересекает стенку при смещении, полученном моделью. Такое положение физически несовместимо: требуется пересчёт контакта и сил. Отрицательный зазор показывает пересечение, а не доступный проход.</p>}
    </div>
   </div>
   <p className="text-xs text-amber-500">Расчётная геометрия, не измеренный профиль. Показано пробное размещение изделия в выбранном сечении, а не подтверждённая глубина установки. Ствол принят круглым; используется локальный ID предыдущей колонны или номинальный диаметр открытого ствола. Эксцентриситет взят из модели центрирования. Направление смещения и ориентация лопастей условные.</p>
   <p className="text-xs text-muted-foreground">Сжатие рессоры - геометрическое ограничение по стенке. Форма дуги синусоидальная, ширина, толщина, кольца и винтовой профиль не воспроизводятся. Это не расчёт напряжений или несущей способности. Для подтверждённого прогиба нужны кривая усилие-сжатие, геометрия рессоры, материал и локальная кавернометрия. Свободная площадь прохода вокруг оснастки без этих размеров не определяется.</p>
 </section>;
}
