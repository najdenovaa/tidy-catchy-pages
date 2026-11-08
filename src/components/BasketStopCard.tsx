import type { BasketStopResult } from '@/lib/cement-basket-stop';
import type { WellData } from '@/lib/cementing-calculations';
import { Card } from './ui/card';
export default function BasketStopCard({result,well}:{result?:BasketStopResult;well:WellData}) {
 if(!result)return <Card className="p-4 text-sm"><h3 className="font-semibold">Корзина и давление после «Стоп»</h3><p className="text-xs text-muted-foreground mt-2">Без корзины действует полный жидкий столб. Для сравнения добавьте корзину и её глубину в комплектации колонны, задайте сценарий формирования перемычки и пересчитайте.</p></Card>;
 const f=(n:number)=>n.toFixed(2),maxP=Math.max(1,...result.rows.flatMap(r=>[r.withoutMPa,r.limitMPa??0,r.poreMPa??0])),depth=well.casingDepthMD||1;
 const x=(v:number)=>55+v/maxP*440,y=(v:number)=>25+v/depth*330;
 const path=(key:'withoutMPa'|'scenarioMPa')=>result.rows.map((r,i)=>`${i?'L':'M'}${x(r[key])},${y(r.md)}`).join(' ');
 const relevant=new Set([well.casingDepthMD,...result.baskets.map(b=>b.md),...(well.reservoirLayers??[]).flatMap(l=>[l.topMD,l.bottomMD])]);
 const rows=result.rows.filter(r=>relevant.has(r.md));
 const under=result.rows.some(r=>r.poreMPa!==null&&r.scenarioMPa<r.poreMPa),over=result.rows.some(r=>r.limitMPa!==null&&r.scenarioMPa>r.limitMPa);
 return <Card className="p-4 space-y-3" data-testid="basket-stop-comparison">
  <h3 className="font-semibold">Корзина и давление после «Стоп»</h3>
  <p className="text-xs">Сразу после остановки: полный столб. Отдельный сценарий через {result.elapsedMin} мин: заданная передача нагрузки. Основные проверки ГРП не получают скидку за корзину.</p>
  <div className="flex flex-wrap gap-3 text-xs"><span className={under?'text-red-600':'text-muted-foreground'}>{under?'В сценарии есть недодавление относительно пласта':'Недодавление не выявлено в точках с заданным пластовым давлением'}</span><span className={over?'text-red-600':'text-muted-foreground'}>{over?'Сценарий превышает предел ГРП / поглощения':'Превышение заданных пределов в сценарии не выявлено'}</span></div>
  <svg viewBox="0 0 560 410" role="img" aria-label="Давление без корзины и сценарий после формирования перемычки" className="w-full max-w-2xl mx-auto">
   <path d="M55 25V355H505" fill="none" stroke="currentColor"/>
   {[0,.25,.5,.75,1].map(t=><g key={t} fontSize="10" fill="currentColor"><path d={`M55 ${y(t*depth)}H505`} stroke="#94a3b8" strokeOpacity=".25"/><text x="5" y={y(t*depth)+4}>{Math.round(t*depth)}</text><text x={x(t*maxP)-8} y="374">{(t*maxP).toFixed(1)}</text></g>)}
   <path d={path('withoutMPa')} fill="none" stroke="#2563eb" strokeWidth="2.5"/>
   <path d={path('scenarioMPa')} fill="none" stroke="#ea580c" strokeWidth="2.5" strokeDasharray="6 3"/>
   {result.baskets.map(b=><g key={b.id}><path d={`M55 ${y(b.md)}H505`} stroke="#64748b" strokeDasharray="3 4"/><text x="350" y={y(b.md)-4} fontSize="9" fill="currentColor">Корзина {Math.round(b.md)} м</text></g>)}
   <text x="220" y="400" fill="currentColor" fontSize="11">Давление, МПа · глубина MD, м</text>
  </svg>
  <p className="text-xs"><span className="text-blue-600">Синий - полный столб сразу после «Стоп»</span>; <span className="text-orange-600">пунктир - сценарий передачи нагрузки</span>. Перепад на корзине схематичен, это не уплотнение пакера.</p>
  <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr>{['MD, м','Без разгрузки, МПа','Сценарий, МПа','Снижение, МПа','Пластовое, МПа','ГРП / поглощение, МПа'].map(t=><th className="p-2 text-right" key={t}>{t}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.md} className="border-t"><td className="p-2">{r.md.toFixed(1)}</td><td className="p-2">{f(r.withoutMPa)}</td><td className="p-2">{f(r.scenarioMPa)}</td><td className="p-2">{f(r.reductionMPa)}</td><td className="p-2">{r.poreMPa===null?'Не задано':f(r.poreMPa)}</td><td className="p-2">{r.limitMPa===null?'Не задано':f(r.limitMPa)}</td></tr>)}</tbody></table></div>
  {result.baskets.map(b=><div key={b.id} className="text-xs rounded border p-2"><p className="font-semibold">{b.model||'Корзина'} · MD {b.md} м</p><p>Передача {b.transferPct.toFixed(0)}%; снижение {f(b.transferredMPa)} МПа; реакция опоры {f(b.reactionKN)} кН; предел {b.capacityKN===undefined?'не задан':f(b.capacityKN)+' кН'}.</p>{b.notes.map(n=><p className="text-amber-700" key={n}>{n}</p>)}</div>)}
  <details className="text-xs text-muted-foreground"><summary>Модель и границы применимости</summary>{result.notes.map(n=><p className="mt-2" key={n}>{n}</p>)}<a className="underline" href="https://gk-avrora.ru/korzina-cementirovochnaja-avrora-500s/" target="_blank" rel="noreferrer">Описание изготовителя AVRORA 500S</a></details>
 </Card>;
}
