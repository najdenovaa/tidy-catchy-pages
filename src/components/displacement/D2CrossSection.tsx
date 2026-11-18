import {useMemo,useState} from 'react';
import {displacementSection,SECTION_NOTE,type SectionSource} from '@/lib/displacement-section';
import {Button} from '@/components/ui/button';
import D2Section3D from './D2Section3D';
export default function D2CrossSection({data,md,frame,onDepth,stale}:{data:SectionSource;md:number;frame:number;onDepth:(md:number)=>void;stale:boolean}){
 const section=useMemo(()=>displacementSection(data,md,frame),[data,md,frame]),[view,setView]=useState<'3d'|'top'>('3d');
 const save=async()=>{if('error' in section)return;const[{displacementSectionWorkbook},XLSX]=await Promise.all([import('@/lib/displacement-section-workbook'),import('xlsx')]);XLSX.writeFile(displacementSectionWorkbook(section),'Сечение-трубы-и-затрубья.xlsx');};
 return <section aria-label="Общее сечение вытеснения" className="rounded border p-3 space-y-2">
 <div className="flex flex-wrap gap-3 items-center"><h3 className="font-semibold">Сечение трубы и затрубья</h3><label>MD, м <input aria-label="Глубина общего сечения MD" type="number" step="any" value={Number.isFinite(md)?md:''} onChange={e=>onDepth(e.target.value===''?NaN:Number(e.target.value))} className="w-28 border rounded bg-background px-2 py-1"/></label><Button size="sm" variant={view==='3d'?'default':'outline'} onClick={()=>setView('3d')}>3D</Button><Button size="sm" variant={view==='top'?'default':'outline'} onClick={()=>setView('top')}>Сверху</Button><Button size="sm" variant="outline" disabled={stale||'error' in section} onClick={save}>Сечение в XLSX</Button></div>
 <p className="text-muted-foreground">{SECTION_NOTE}</p>
 {'error' in section?<p role="alert">{section.error}</p>:<>
 <p>Кадр {section.frame}, от начала закачки {(section.timeS/60).toFixed(3)} мин. Труба: {section.pipeStatus}. Затрубье: {section.annulusStatus}.</p>
 <p>Ячейка трубы: {section.pipeBounds?.map(x=>x.toFixed(2)).join(' / ')??'нет'} м. Ячейка затрубья: {section.annulusBounds?.map(x=>x.toFixed(2)).join(' / ')??'нет'} м (верх / низ / центр).</p>
 <div className="grid gap-3 lg:grid-cols-2"><D2Section3D data={section} view={view}/><div className="space-y-2">
 <p>ОК Ø{(section.geometry.ro*2).toFixed(1)} / {(section.geometry.ri*2).toFixed(1)} мм. Ствол Ø{(section.geometry.rh*2).toFixed(1)} мм.</p><p>Смещение осей {section.geometry.offset.toFixed(2)} мм; зазор min {section.geometry.minGapMm.toFixed(2)} / max {section.geometry.maxGapMm.toFixed(2)} мм.</p>
 <table className="w-full"><thead><tr><th className="text-left">Жидкость</th><th>Труба, %</th><th>Затрубье, %</th></tr></thead><tbody>{section.fluids.map((f,i)=><tr key={i}><td><span className="inline-block h-3 w-3 mr-1" style={{background:section.colors[i]}}/>{i+1}. {f.name}</td><td className="text-right">{section.pipeFractions[i]===null?'Нет расчёта':(section.pipeFractions[i]*100).toFixed(2)}</td><td className="text-right">{section.annulusFractions[i]===null?'Нет расчёта':(section.annulusFractions[i]*100).toFixed(2)}</td></tr>)}</tbody></table>
 {([['Труба',section.pipeFractions],['Затрубье',section.annulusFractions]] as const).map(([label,values])=><div key={label}><p>{label}: объёмные доли</p><div className="flex h-4 w-full overflow-hidden rounded bg-slate-200" aria-label={label+': полосы объёмных долей'}>{values.every(v=>v!==null)&&values.map((v,i)=><span key={i} style={{width:(v!*100)+'%',background:section.colors[i]}} title={section.fluids[i].name+': '+(v!*100).toFixed(2)+'%'}/>)}</div></div>)}
 <p className="text-muted-foreground">В исходном ракурсе широкая сторона сечения сверху, узкая снизу. Вращение мышью, масштаб колесом. Площади секторов сохраняют объёмные веса модели; цвет смеси осреднён.</p></div></div>
 </>}
 {stale&&<p className="text-amber-700">Показан прежний расчёт. Для текущих исходных данных нужен пересчёт.</p>}
 </section>;
}
