import {useEffect,useRef,useState} from 'react';
import {Card,CardHeader,CardTitle,CardContent} from './ui/card';
import {transportInputKey,transportCsv,type TransportResult} from '@/lib/compressible-transport';
import {startTransportWorker} from '@/lib/compressible-worker-client';
import type {CementingSnapshot} from '@/lib/cementing-normalizers';
import {LineChart,Line,XAxis,YAxis,CartesianGrid,Tooltip,Legend,ResponsiveContainer} from 'recharts';
export default function CompressibleTransportPanel({input,cachedResult,onResult}:{input:CementingSnapshot;cachedResult?:TransportResult|null;onResult?:(r:TransportResult|null)=>void}){
 const key=transportInputKey(input),[running,setRunning]=useState(false),[fraction,setFraction]=useState(0),[error,setError]=useState(''),job=useRef<ReturnType<typeof startTransportWorker>>(),generation=useRef(0);
 const r=cachedResult?.inputKey===key?cachedResult:undefined;
 useEffect(()=>{generation.current++;job.current?.cancel();job.current=undefined;setRunning(false);setFraction(0);setError('');return()=>{generation.current++;job.current?.cancel();};},[key]);
 if(!input.wellData.stopStorage?.flowEnabled)return null;
 const run=()=>{const id=++generation.current;onResult?.(null);setRunning(true);setError('');setFraction(0);try{const task=startTransportWorker(input,value=>{if(generation.current===id)setFraction(value);});job.current=task;task.promise.then(result=>{if(generation.current===id)onResult?.(result);}).catch(e=>{if(generation.current===id)setError(String(e.message??e));}).finally(()=>{if(generation.current===id)setRunning(false);});}catch(e){setRunning(false);setError(e instanceof Error?e.message:String(e));}};
 return <Card><CardHeader><CardTitle className="text-lg">Сжимаемый 1D-перенос: исследовательская ветка</CardTitle></CardHeader><CardContent className="space-y-3">
 <p className="text-xs text-muted-foreground">Давление, массовые потоки и состав рассчитываются совместно в заполненном жёстком контуре. Пробки и свободная поверхность не моделируются. Основной расчёт и его ограничения остаются отдельными.</p>
 <div className="flex gap-3"><button type="button" className="text-sm px-3 py-2 rounded bg-primary text-primary-foreground" disabled={running} onClick={run}>Рассчитать исследовательскую ветку</button>{running&&<button type="button" onClick={()=>{generation.current++;job.current?.cancel();setRunning(false);setError('Расчёт отменён.');}}>Отменить</button>}</div>
 {running&&<p role="status">Вычисление в отдельном потоке: {Math.round(fraction*100)}%</p>}{error&&<p role="alert" className="text-destructive">{error}</p>}
 {r&&<><p role={r.status==='complete'?'status':'alert'} className={r.status==='complete'?'text-sm':'text-sm text-destructive'}>{r.status==='complete'?'Расписание циркуляции рассчитано.':'Расчёт остановлен; показан только принятый участок.'} {r.reason}</p>
 <p className="text-xs">Ячеек: {r.cellCount}; назначенная длина {r.cellLengthM} м; максимальный шаг {r.stepSeconds} с; принято шагов {r.acceptedSteps}. Максимальная относительная пошаговая невязка: {r.maxStepRelativeResidual.toExponential(2)}.</p>
 {r.frames.length>1&&<div className="h-64" role="img" aria-label="Давление сжимаемого 1D-переноса"><ResponsiveContainer width="100%" height="100%"><LineChart data={r.frames}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="timeMin" type="number" unit=" мин"/><YAxis unit=" МПа"/><Tooltip/><Legend/><Line dataKey="inletMPa" name="Давление подачи, МПа" stroke="#4f46e5" dot={false}/><Line dataKey="shoeCellMPa" name="Ячейка трубы у башмака, МПа" stroke="#0284c7" dot={false}/></LineChart></ResponsiveContainer></div>}
 <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr>{['Жидкость','Исходно, кг','Закачано, кг','Возврат, кг','В контуре, кг','Невязка, кг'].map(t=><th className="text-left p-2" key={t}>{t}</th>)}</tr></thead><tbody>{r.components.map(f=><tr key={f.id}>{[f.name,...[f.initialKg,f.injectedKg,f.returnedKg,f.retainedKg].map(v=>v.toFixed(3)),f.residualKg.toExponential(2)].map((v,i)=><td key={i} className="p-2 border-t">{v}</td>)}</tr>)}</tbody></table></div>
 <details className="text-xs"><summary>Массовые доли в ячейках конечного состояния</summary><div className="space-y-1 pt-2">{r.profile.map((p,i)=><p key={i}>{p.leg==='pipe'?'Труба':'Затрубье'}, MD {p.md.toFixed(1)} м: {p.fractions.filter(f=>f.massFraction>.001).map(f=>f.name+' '+(f.massFraction*100).toFixed(1)+'%').join('; ')}</p>)}</div></details>
 <button type="button" className="text-xs text-primary underline" onClick={()=>{const url=URL.createObjectURL(new Blob(['\uFEFF'+transportCsv(r)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='compressible-transport-'+r.status+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Скачать временной ряд CSV</button>
 {r.limitations.map(t=><p key={t} className="text-xs text-muted-foreground">{t}</p>)}</>}
 </CardContent></Card>;
}
