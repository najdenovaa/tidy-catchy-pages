import {useMemo,useState} from 'react';
import {buildProcessContract,processContractCsv} from '@/lib/cementing-process';
import type {CementingSnapshot} from '@/lib/cementing-normalizers';
export default function ProcessContractPanel({input}:{input:CementingSnapshot}){
 const [open,setOpen]=useState(false),c=useMemo(()=>open?buildProcessContract(input):undefined,[open,input]);
 return <section className="border rounded-lg p-3 space-y-2"><button type="button" className="text-sm font-semibold" onClick={()=>setOpen(!open)}>{open?'▾':'▸'} Расписание и баланс закачки</button>
 {c&&<><p className="text-xs text-muted-foreground">План назначенных порций при фиксированной плотности. Время до Стоп в динамике может измениться из-за свободного падения, сжатия и посадки пробки. Подготовка и демонтаж сюда не входят.</p>
 <div className="grid sm:grid-cols-3 gap-3 text-sm"><p>В скважину: <b>{c.wellVolumeM3.toFixed(3)} м³</b><br/>Масса порций: {c.canRun?c.wellMassKg.toFixed(1)+' кг':'не подтверждена'}</p><p>ЛВД отдельно: <b>{c.surfaceVolumeM3.toFixed(3)} м³</b></p><p>Плановое время: <b>{c.totalTimeMin===null?'не определено':c.totalTimeMin.toFixed(2)+' мин'}</b></p></div>
 {c.issues.map((x,i)=><p key={i} role={x.severity==='error'?'alert':'status'} className={'text-xs '+(x.severity==='error'?'text-destructive':'text-amber-700')}>{x.message}</p>)}
 <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th>Порция / режим</th><th>Назначение</th><th>м³</th><th>л/с</th><th>Начало, мин</th><th>Конец, мин</th></tr></thead><tbody>{c.stages.map(s=><tr key={s.id}><td>{s.name} / {s.stepIndex+1}</td><td>{s.destination==='well'?'В скважину':'ЛВД мимо скважины'}</td><td>{s.volumeM3.toFixed(3)}</td><td>{s.rateLps.toFixed(2)}</td><td>{s.startMin===null?'—':s.startMin.toFixed(2)}</td><td>{s.endMin===null?'—':s.endMin.toFixed(2)}</td></tr>)}</tbody></table></div>
 <p className="text-xs text-muted-foreground">Невязка интеграла расхода по времени: {c.volumeResidualM3.toExponential(2)} м³; {c.massResidualKg.toExponential(2)} кг. Это проверка расписания, не подтверждение конечного распределения масс в скважине.</p>
 <button type="button" className="text-xs text-primary underline" onClick={()=>{const url=URL.createObjectURL(new Blob(['\uFEFF'+processContractCsv(c)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='cementing-process.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Скачать расписание CSV</button></>}
 </section>;
}
