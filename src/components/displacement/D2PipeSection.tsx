import type {DisplacementTimingSettings,DisplacementTimingStats} from '@/lib/displacement-timing';
import {useMemo} from 'react';
import {pipeDepthComposition,pipeBalance,pipeHistoryPlots,PIPE_NOTE,type PipeTransport,type DisplacementFrame} from '@/lib/displacement-pipe';
import {Button} from '@/components/ui/button';
export default function D2PipeSection({pipe,colors,timeline,frame,md,onDepth,onFrame,stale,timingSettings,timingStats}:{pipe:PipeTransport;colors:string[];timeline:DisplacementFrame[];frame:number;md:number;onDepth:(md:number)=>void;onFrame:(i:number)=>void;stale:boolean;timingSettings?:DisplacementTimingSettings;timingStats?:DisplacementTimingStats}){
 const time=timeline[frame]?.timeS??0,cell=useMemo(()=>pipeDepthComposition(pipe,md,time),[pipe,md,time]),balance=useMemo(()=>pipeBalance(pipe,time),[pipe,time]),plots=useMemo(()=>pipeHistoryPlots(pipe,colors,md,timeline),[pipe,colors,md,timeline]);
 const save=async()=>{const[{pipeWorkbook},XLSX]=await Promise.all([import('@/lib/displacement-pipe-workbook'),import('xlsx')]);XLSX.writeFile(pipeWorkbook(pipe,md,timeline,frame,timingSettings,timingStats),'Труба-доли-баланс.xlsx');};
 return <section aria-label="Трубное пространство" className="rounded border p-3 space-y-2">
 <div className="flex flex-wrap gap-3 items-center"><h3 className="font-semibold">Состав в трубе</h3><label>MD, м <input aria-label="Глубина состава в трубе MD" type="number" step="any" value={Number.isFinite(md)?md:''} onChange={e=>onDepth(e.target.value===''?NaN:+e.target.value)} className="w-28 border rounded bg-background px-2 py-1"/></label>
 <Button variant="outline" size="sm" disabled={!cell||stale} onClick={save}>Труба и баланс в XLSX</Button></div>
 <p className="text-muted-foreground">{PIPE_NOTE}</p>
 <label className="flex gap-3 items-center">Время обоих пространств <input aria-label="Общий кадр вытеснения" type="range" min={0} max={Math.max(0,timeline.length-1)} value={frame} onChange={e=>onFrame(+e.target.value)} className="flex-1"/></label>
 <p>Кадр {frame}; от начала закачки {(time/60).toFixed(3)} мин. Вместимость трубы {pipe.capacityM3.toFixed(3)} м³.{stale&&' Результат устарел, требуется пересчёт.'}</p>
 {cell?<><p>Ячейка MD {cell.topMD.toFixed(2)}-{cell.bottomMD.toFixed(2)} м, центр {cell.md.toFixed(2)} м.</p><table className="w-full"><thead><tr><th className="text-left">Жидкость</th><th className="text-right">Доля, %</th></tr></thead><tbody>{pipe.fluids.map((f,i)=><tr key={i}><td>{i+1}. {f.name}</td><td className="text-right">{(cell.fractions[i]*100).toFixed(2)}</td></tr>)}</tbody></table></>:<p role="alert">Глубина вне трубного пространства. Состав не определён.</p>}
 <details><summary>Независимый баланс в трубе на выбранное время</summary><div className="overflow-x-auto"><table className="w-full"><thead><tr>{['Жидкость','Исходно, м³','Вошло, м³','В трубе, м³','Через башмак, м³','Невязка, м³'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{balance.map(b=><tr key={b.fluid}><td>{b.name}</td>{[b.initialM3,b.injectedM3,b.insideM3,b.outletM3,b.residualM3].map((v,i)=><td key={i} className="text-right">{v.toFixed(6)}</td>)}</tr>)}</tbody></table></div><p>Исходный объём плюс вошедший минус оставшийся минус вышедший через башмак. Это баланс трубы; он не подтверждает баланс затрубного 2D-решателя.</p></details>
 {plots.map(p=><img key={p.plotId} className="w-full max-w-[900px]" alt={p.title} src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(p.svg)}/>)}
 </section>;
}
