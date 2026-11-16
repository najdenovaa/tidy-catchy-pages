import {basketStopCharts} from '@/lib/basket-chart-data';
import type {DepthChartSettings} from '@/lib/depth-chart-settings';
import type { BasketStopResult } from '@/lib/cement-basket-stop';
import type { WellData } from '@/lib/cementing-calculations';
import { Card } from './ui/card';
export default function BasketStopCard({result,well,settings}:{result?:BasketStopResult;well:WellData;settings?:DepthChartSettings}) {
 if(!result)return <Card className="p-4 text-sm"><h3 className="font-semibold">Корзина и давление после «Стоп»</h3><p className="text-xs text-muted-foreground mt-2">Без корзины действует полный жидкий столб. Для сравнения добавьте корзину и её глубину в комплектации колонны, задайте сценарий формирования перемычки и пересчитайте.</p></Card>;
 const f=(n:number)=>n.toFixed(2),plot=basketStopCharts(result,settings)[0];
 const relevant=new Set([well.casingDepthMD,...result.baskets.map(b=>b.md),...(well.reservoirLayers??[]).flatMap(l=>[l.topMD,l.bottomMD])]);
 const rows=result.rows.filter(r=>relevant.has(r.md));
 const under=result.rows.some(r=>r.poreMPa!==null&&r.scenarioMPa<r.poreMPa),over=result.rows.some(r=>r.limitMPa!==null&&r.scenarioMPa>r.limitMPa);
 return <Card className="p-4 space-y-3" data-testid="basket-stop-comparison">
  <h3 className="font-semibold">Корзина и давление после «Стоп»</h3>
  <p className="text-xs">Сразу после остановки: полный столб. Отдельный сценарий через {result.elapsedMin} мин: заданная передача нагрузки. Основные проверки ГРП не получают скидку за корзину.</p>
  <div className="flex flex-wrap gap-3 text-xs"><span className={under?'text-red-600':'text-muted-foreground'}>{under?'В сценарии есть недодавление относительно пласта':'Недодавление не выявлено в точках с заданным пластовым давлением'}</span><span className={over?'text-red-600':'text-muted-foreground'}>{over?'Сценарий превышает предел ГРП / поглощения':'Превышение заданных пределов в сценарии не выявлено'}</span></div>
  {plot&&<div role="img" aria-label="Давление без корзины и сценарий после формирования перемычки" className="overflow-auto"><div className="min-w-[700px] [&_svg]:w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{__html:plot.svg}}/></div>}
  <p className="text-xs"><span className="text-blue-600">Синий - полный столб сразу после «Стоп»</span>; <span className="text-orange-600">пунктир - сценарий передачи нагрузки</span>. Передача веса распределена по цементному интервалу; на проницаемой корзине нет скачка давления.</p>
  <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr>{['MD, м','Без разгрузки, МПа','Сценарий, МПа','Снижение, МПа','Пластовое, МПа','ГРП / поглощение, МПа'].map(t=><th className="p-2 text-right" key={t}>{t}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.md} className="border-t"><td className="p-2">{r.md.toFixed(1)}</td><td className="p-2">{f(r.withoutMPa)}</td><td className="p-2">{f(r.scenarioMPa)}</td><td className="p-2">{f(r.reductionMPa)}</td><td className="p-2">{r.poreMPa===null?'Не задано':f(r.poreMPa)}</td><td className="p-2">{r.limitMPa===null?'Не задано':f(r.limitMPa)}</td></tr>)}</tbody></table></div>
  {result.baskets.map(b=><div key={b.id} className="text-xs rounded border p-2"><p className="font-semibold">{b.model||'Корзина'} · MD {b.md} м</p><p>Передача {b.transferPct.toFixed(0)}%; снижение {f(b.transferredMPa)} МПа; реакция опоры {f(b.reactionKN)} кН; предел {b.capacityKN===undefined?'не задан':f(b.capacityKN)+' кН'}.</p>{b.notes.map(n=><p className="text-amber-700" key={n}>{n}</p>)}</div>)}
  <details className="text-xs text-muted-foreground"><summary>Модель и границы применимости</summary>{result.notes.map(n=><p className="mt-2" key={n}>{n}</p>)}<a className="underline" href="https://gk-avrora.ru/korzina-cementirovochnaja-avrora-500s/" target="_blank" rel="noreferrer">Описание изготовителя AVRORA 500S</a></details>
 </Card>;
}
