import {useState} from "react";
import {Card,CardHeader,CardTitle,CardContent} from "./ui/card";
import SectionHeader from "./InputSectionHeader";
import type {WellData} from '@/lib/cementing-calculations';
import {normalizeStopStorage,stopStorageCsv,type StopStorageResult,type StopStorageSettings} from '@/lib/stop-storage';
import {DebouncedInput} from './DebouncedInput';
import {LineChart,Line,XAxis,YAxis,CartesianGrid,Tooltip,Legend,ResponsiveContainer} from 'recharts';
export function StopStorageControls({well,onChange}:{well:WellData;onChange:(w:WellData)=>void}){
 const [open,setOpen]=useState(false);
 const s:StopStorageSettings=normalizeStopStorage(well.stopStorage)??{enabled:false,pressureRiseMPa:1.5,rateLps:.2,youngModulusMPa:206000,poissonRatio:.3,restraint:'fixedLength',bulkModuliMPa:{},source:''};
 const update=(patch:Partial<StopStorageSettings>)=>onChange({...well,stopStorage:{...s,...patch}});
 return <Card>
 <SectionHeader title="🔩 Сжимаемость жидкостей и упругость колонны" isOpen={open} onClick={()=>setOpen(!open)}/>
 {open&&<CardContent className="pt-4 space-y-3">
 <label className="text-sm font-semibold flex gap-2 items-center"><input type="checkbox" checked={s.enabled} onChange={e=>update({enabled:e.target.checked})}/> Учитывать сжатие и упругость после посадки пробки</label>
 <label className="text-sm font-semibold flex gap-2 items-center"><input type="checkbox" checked={s.hydrostaticsEnabled??false} onChange={e=>update({hydrostaticsEnabled:e.target.checked})}/> Сравнить PVT-гидростатику по кадрам закачки</label>
 {s.hydrostaticsEnabled&&<><p className="text-xs text-muted-foreground">Сравнение по фиксированным границам жидкостей из основного расчёта. Плотности из программы относятся к опорному давлению. Расходы, возвраты и Стоп остаются из основной модели.</p><div className="grid sm:grid-cols-2 gap-3">{([['referencePressureMPa','Опорное давление плотностей, МПа изб.'],['surfaceBackpressureMPa','Противодавление на поверхности, МПа изб.']] as const).map(([key,label])=><label className="text-xs" key={key}>{label}<DebouncedInput aria-label={label} type="number" step="any" value={s[key]??0} onChange={e=>update({[key]:Number(e.target.value)})}/></label>)}</div></>}
 {s.enabled&&<><p className="text-xs text-muted-foreground">Отдельный расчёт дополнительной подачи при приросте давления после герметичной посадки. K задаётся по PVT или лаборатории при рабочих условиях. E = 206 000 МПа и ν = 0,30 - редактируемые справочные допущения. Газ и пена не поддержаны. Изменения применяются после пересчёта программы.</p>
 <div className="grid sm:grid-cols-2 gap-3">{([['pressureRiseMPa','Прирост давления ΔP, МПа'],['rateLps','Дополнительная подача, л/с'],['youngModulusMPa','Модуль Юнга E, МПа'],['poissonRatio','Коэффициент Пуассона ν']] as const).map(([key,label])=><label className="text-xs space-y-1" key={key}>{label}<DebouncedInput aria-label={label} type="number" step="any" value={s[key]} onChange={e=>update({[key]:Number(e.target.value)})}/></label>)}</div>
 <label className="block text-xs">Закрепление по оси<select aria-label="Закрепление по оси" className="block border rounded p-2 mt-1" value={s.restraint} onChange={e=>update({restraint:e.target.value as StopStorageSettings['restraint']})}><option value="fixedLength">Длина закреплена</option><option value="closedEnds">Закрытые торцы, свободное удлинение</option></select></label>
 </>}
 {(s.enabled||s.hydrostaticsEnabled)&&<>
 <div className="grid sm:grid-cols-2 gap-3">{([['mud','K бурового раствора, МПа'],['buffer','K буфера, МПа'],['cement','K цементного раствора, МПа'],['displacement','K продавочной жидкости, МПа']] as const).map(([key,label])=><label className="text-xs space-y-1" key={key}>{label}<DebouncedInput aria-label={label} type="number" step="any" placeholder="По лабораторным данным" value={s.bulkModuliMPa[key]??''} onChange={e=>update({bulkModuliMPa:{...s.bulkModuliMPa,[key]:Number(e.target.value)}})}/></label>)}</div>
 <label className="block text-xs">Источник параметров и условия испытания<DebouncedInput aria-label="Источник параметров и условия испытания" value={s.source} onChange={e=>update({source:e.target.value})}/></label>
 <p className="text-xs text-muted-foreground">Для фазы после посадки нужны K жидкостей над пробкой и подачи; для PVT-гидростатики - всех жидкостей в расчётных столбах. Один K на категорию применяется ко всем её порциям. Коэффициент запаса продавки не заменяет K.</p>
 </>}
 </CardContent>}
 </Card>;
}
export function StopStoragePanel({result:r}:{result:StopStorageResult|undefined}){
 if(!r)return null;const end=r.curve.at(-1);
 return <Card><CardHeader><CardTitle className="text-lg">Сжатие и упругость после посадки пробки</CardTitle></CardHeader><CardContent className="space-y-3">
 {r.issues.map((t,i)=><p key={i} role="alert" className="text-sm text-destructive">{t}</p>)}
 {end&&<><div className="grid sm:grid-cols-3 gap-3 text-sm"><p>Дополнительная подача<br/><b>{(end.injectedReferenceM3*1000).toFixed(1)} л</b></p><p>На сжатие жидкостей<br/><b>{(end.fluidCompressionReferenceM3*1000).toFixed(1)} л</b></p><p>На расширение колонны<br/><b>{(end.steelExpansionReferenceM3*1000).toFixed(1)} л</b></p></div>
 <p className="text-sm">При ΔP = {end.pressureRiseMPa.toFixed(2)} МПа: {end.timeMin.toFixed(2)} мин дополнительной подачи. Условный коэффициент к объёму над пробкой: {(1+end.injectedReferenceM3/r.baselineCapacityM3).toFixed(5)}. Возврат через пробку: 0 л.</p>
 <p className="text-xs">Объёмы подачи приведены к исходному состоянию этой фазы. Невязки: {Math.max(...r.curve.map(p=>Math.abs(p.residualM3))).toExponential(2)} м³; {Math.max(...r.curve.map(p=>Math.abs(p.residualKg))).toExponential(2)} кг.</p>
 <div className="h-64" role="img" aria-label="Дополнительная подача и прирост давления после посадки пробки"><ResponsiveContainer width="100%" height="100%"><LineChart data={r.curve.map(p=>({...p,litres:p.injectedReferenceM3*1000}))}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="litres" type="number" name="Дополнительная подача" unit=" л"/><YAxis dataKey="pressureRiseMPa" unit=" МПа"/><Tooltip/><Legend/><Line dataKey="pressureRiseMPa" name="Прирост давления, МПа" stroke="#4f46e5" dot={false}/></LineChart></ResponsiveContainer></div>
 <button type="button" className="text-xs text-primary underline" onClick={()=>{const url=URL.createObjectURL(new Blob(['\uFEFF'+stopStorageCsv(r)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='cementing-stop-storage.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Скачать расчёт сжатия CSV</button></>}
 <p className="text-xs">Источник: {r.settings.source.trim()||'Не указан; параметры требуют подтверждения.'}</p>
 {r.limitations.map(t=><p className="text-xs text-muted-foreground" key={t}>{t}</p>)}
 </CardContent></Card>;
}
