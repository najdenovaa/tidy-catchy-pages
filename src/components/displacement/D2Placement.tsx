import {useMemo,useState} from 'react';
import {displacementPlacement,PLACEMENT_NOTE} from '@/lib/displacement-placement';
import {placementSvg} from '@/lib/displacement-placement-figures';
import {sectionTimeline,type SectionSource} from '@/lib/displacement-section';
import {Button} from '@/components/ui/button';
import D2Placement3D from './D2Placement3D';
export default function D2Placement({data,frame,onFrame,stale}:{data:SectionSource;frame:number;onFrame:(i:number)=>void;stale:boolean}){
 const state=useMemo(()=>displacementPlacement(data,frame),[data,frame]),[view,setView]=useState<'3d'|'projection'>('3d');
 const figure=useMemo(()=>('error'in state?null:placementSvg(state)),[state]);
 if('error'in state)return <p role="alert">{state.error}</p>;
 const projection=figure?<img className="w-full max-w-[900px] mx-auto" alt="Общая скважина: проекция состава трубы и затрубья" src={'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(figure.svg)}/>:<p>Нет рассчитанного пространства для изображения.</p>;
 const save=async()=>{const[{displacementPlacementWorkbook},XLSX]=await Promise.all([import('@/lib/displacement-placement-workbook'),import('xlsx')]);XLSX.writeFile(displacementPlacementWorkbook(state),'Конечное-размещение-жидкостей.xlsx');};
 return <section className="border rounded p-3 space-y-3" aria-label="Общая скважина и размещение жидкостей">
 <h3 className="font-semibold">Общая 3D-скважина: труба и затрубье</h3>
 <p className="text-xs text-muted-foreground">{PLACEMENT_NOTE}</p>
 <div className="flex flex-wrap gap-2"><Button size="sm" variant={view==='3d'?'default':'outline'} onClick={()=>setView('3d')}>Общий 3D-вид</Button><Button size="sm" variant={view==='projection'?'default':'outline'} onClick={()=>setView('projection')}>Проекция без WebGL</Button><Button size="sm" variant="outline" onClick={()=>onFrame(sectionTimeline(data).length-1)}>К концу расчёта</Button><Button size="sm" variant="outline" disabled={stale} onClick={save}>Размещение в XLSX</Button></div>
 <p>Кадр {state.frame}; {(state.timeS/60).toFixed(3)} мин от начала закачки. {state.isLast?'Последний сохранённый кадр.':'Промежуточное размещение.'} {!state.completed&&'Расчёт неполный; плановый итог не достигнут.'} {stale&&'Результат устарел. Пересчитайте модель.'}</p>
 <p>Труба: {state.pipeEnabled?'рассчитана':'отключена'}. Затрубье: {state.annulusEnabled?'рассчитано':'отключено'}. Осевых интервалов: {state.rows.length}.</p>
 {view==='3d'?<D2Placement3D data={state} fallback={<><p role="status">3D недоступен в этом браузере. Показана проекция тех же данных.</p>{projection}</>}/>:projection}
 <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr>{['Жидкость','В трубе, м³','Профиль минус баланс трубы, м³','В затрубном поле, м³'].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{state.fluids.map((f,i)=><tr key={i}><td><span className="inline-block w-3 h-3 mr-1" style={{background:state.colors[i]}}/>{i+1}. {f.name}</td><td>{state.pipeInventory?.[i].toFixed(5)??'Нет расчёта'}</td><td>{state.pipeInventory&&state.pipeLedger?(state.pipeInventory[i]-state.pipeLedger[i].insideM3).toExponential(2):'Нет расчёта'}</td><td>{state.annulusInventory?.[i].toFixed(5)??'Нет расчёта'}</td></tr>)}</tbody></table></div>
 <p className="text-xs text-muted-foreground">В XLSX - все интервалы MD/TVD и доли каждой жидкости без сокращения. Пункт Word «Конечное размещение» использует последний сохранённый кадр этого расчёта.</p>
 </section>;
}
