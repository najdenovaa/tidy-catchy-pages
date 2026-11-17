import { useMemo } from 'react';
import type { D2Result } from '@/lib/displacement-2d';
import { displacementDepthHistory, displacementHistoryPlots, HISTORY_NOTE } from '@/lib/displacement-depth-history';
import { Button } from '@/components/ui/button';

export default function D2DepthHistory({res,colors,md,frame,annulusStartS,onDepth,onFrame,stale}: {
  res:D2Result; colors:string[]; md:number; frame:number; annulusStartS:number;
  onDepth:(md:number)=>void; onFrame:(frame:number)=>void; stale:boolean;
}) {
  const history=useMemo(()=>displacementDepthHistory(res,md),[res,md]);
  const plots=useMemo(()=>displacementHistoryPlots(res,colors,md),[res,colors,md]);
  const current=history?.rows[frame];
  const exportWorkbook=async()=>{
    const [{displacementHistoryWorkbook},XLSX]=await Promise.all([import('@/lib/displacement-history-workbook'),import('xlsx')]);
    XLSX.writeFile(displacementHistoryWorkbook(res,md,frame,annulusStartS),'Замещение-доли-по-глубине.xlsx');
  };
  return <section className="rounded-md border p-3 space-y-2" aria-label="Доли жидкостей во времени">
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="font-semibold">Доли жидкостей в затрубье во времени</h3>
      <label>Выбранная MD, м <input aria-label="Глубина состава MD" type="number" step="any" value={Number.isFinite(md)?md:''}
        onChange={e=>onDepth(e.target.value===''?NaN:Number(e.target.value))} className="w-28 rounded border bg-background px-2 py-1" /></label>
      <Button size="sm" variant="outline" disabled={!history||stale} onClick={exportWorkbook}>Все кадры в XLSX</Button>
    </div>
    <p className="text-muted-foreground text-[11px]">{HISTORY_NOTE}</p>
    {!history?<p role="alert">Глубина вне расчётного интервала. Укажите MD в пределах сетки.</p>:<>
      <p>Ячейка MD {history.topMD.toFixed(1)}-{history.bottomMD.toFixed(1)} м, центр {history.md.toFixed(1)} м.
        Кадр {frame}: {(current?.timeS/60).toFixed(2)} мин вытеснения; {((annulusStartS+(current?.timeS??0))/60).toFixed(2)} мин от начала закачки.
        {stale&&<strong className="text-amber-700"> Результат устарел. Пересчитайте перед экспортом.</strong>}</p>
      <table className="w-full text-[11px]"><thead><tr><th className="text-left">Жидкость</th><th className="text-right">Доля в выбранном кадре, %</th></tr></thead>
        <tbody>{res.fluids.map((fluid,i)=><tr key={i}><td>{i+1}. {fluid.name}</td><td className="text-right tabular-nums">{current?.fractions[i]==null?'Нет данных':(current.fractions[i]!*100).toFixed(2)}</td></tr>)}</tbody></table>
      {plots.map(plot=><img key={plot.plotId} src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(plot.svg)} alt={plot.title} className="w-full max-w-[900px]"/>)}
      <details><summary className="cursor-pointer">Все сохранённые кадры: выбрать время для таблицы и 3D</summary>
        <div className="max-h-64 overflow-auto"><table className="w-full"><thead><tr><th>Кадр</th><th>Вытеснение, мин</th><th>Действие</th></tr></thead><tbody>
          {history.rows.map(row=><tr key={row.frame} aria-selected={row.frame===frame}><td>{row.frame}</td><td>{(row.timeS/60).toFixed(3)}</td><td><button className="underline" onClick={()=>onFrame(row.frame)}>Показать кадр {row.frame}</button></td></tr>)}
        </tbody></table></div>
      </details>
    </>}
  </section>;
}
