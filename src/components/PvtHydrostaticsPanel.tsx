import type {PvtHydrostaticResult} from '@/lib/pvt-hydrostatics';
import {pvtHydrostaticsCsv,pvtProfileCsv} from '@/lib/pvt-hydrostatics';
import {Card,CardHeader,CardTitle,CardContent} from './ui/card';
import {LineChart,Line,XAxis,YAxis,CartesianGrid,Tooltip,Legend,ResponsiveContainer} from 'recharts';
export default function PvtHydrostaticsPanel({result:r}:{result:PvtHydrostaticResult|undefined}){
 if(!r)return null;const last=r.curve.at(-1);
 const download=(profile=false)=>{const url=URL.createObjectURL(new Blob(['\uFEFF'+(profile?pvtProfileCsv(r):pvtHydrostaticsCsv(r))],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=profile?'cementing-pvt-profile.csv':'cementing-pvt-hydrostatics.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <Card><CardHeader><CardTitle className="text-lg">PVT-гидростатика: сравнение по кадрам закачки</CardTitle></CardHeader><CardContent className="space-y-3">
 {r.issues.map((t,i)=><p role="alert" key={i} className="text-sm text-destructive">{t}</p>)}
 {last&&<><div className="grid sm:grid-cols-3 gap-3 text-sm"><p>PVT-гидростатика у башмака на Стоп<br/><b>{last.annularBottomMPa.toFixed(3)} МПа</b></p><p>Максимальное отличие от постоянной плотности<br/><b>{r.maxPressureDifferenceMPa.toFixed(3)} МПа</b></p><p>Максимальное изменение плотности<br/><b>{r.maxDensityChangePct.toFixed(3)}%</b></p></div>
 <div className="h-64" role="img" aria-label="Сравнение гидростатики PVT и постоянной плотности"><ResponsiveContainer width="100%" height="100%"><LineChart data={r.curve}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="timeMin" type="number" unit=" мин"/><YAxis unit=" МПа"/><Tooltip/><Legend/><Line dataKey="annularBottomMPa" name="PVT: затрубье у башмака, МПа" stroke="#4f46e5" dot={false}/><Line dataKey="constantAnnularBottomMPa" name="Постоянная плотность, МПа" stroke="#64748b" strokeDasharray="4 4" dot={false}/></LineChart></ResponsiveContainer></div>
 <p className="text-xs">Масса для заполнения равновесного столба на Стоп: труба {(last.pipeMassKg/1000).toFixed(3)} т, затрубье {(last.annularMassKg/1000).toFixed(3)} т. Это отдельное равновесное состояние, а не фактический баланс закачки.</p>
 <details className="text-xs"><summary>Плотности и давления по глубине на Стоп</summary><div className="overflow-x-auto"><table className="w-full"><thead><tr>{['Столб','MD, м','Жидкость','P верх/низ, МПа','ρ верх/низ, кг/м³'].map(t=><th key={t} className="text-left p-2">{t}</th>)}</tr></thead><tbody>{[...r.finalPipe.map(c=>({...c,leg:'Труба'})),...r.finalAnnulus.map(c=>({...c,leg:'Затрубье'}))].slice(0,200).map((c,i)=><tr key={i}>{[c.leg,c.topMD.toFixed(1)+'–'+c.bottomMD.toFixed(1),c.fluidName,c.topPressureMPa.toFixed(3)+' / '+c.bottomPressureMPa.toFixed(3),c.topDensityKgM3.toFixed(1)+' / '+c.bottomDensityKgM3.toFixed(1)].map((x,j)=><td key={j} className="p-2 border-t">{x}</td>)}</tr>)}</tbody></table></div>{r.finalPipe.length+r.finalAnnulus.length>200&&<p>Показаны первые 200 сегментов.</p>}</details>
 <div className="flex flex-wrap gap-4"><button type="button" className="text-xs text-primary underline" onClick={()=>download()}>Скачать PVT-сравнение CSV</button><button type="button" className="text-xs text-primary underline" onClick={()=>download(true)}>Скачать конечный PVT-профиль CSV</button></div></>}
 <p className="text-xs">Модули K: {r.properties.map(p=>p.name+' - '+p.bulkModulusMPa.toFixed(1)+' МПа').join('; ')}</p>
 <p className="text-xs">Опорное давление: {r.referencePressureMPa.toFixed(3)} МПа изб.; противодавление: {r.surfaceBackpressureMPa.toFixed(3)} МПа изб. Источник: {r.source.trim()||'Не указан; свойства требуют подтверждения.'}</p>
 {r.limitations.map(t=><p key={t} className="text-xs text-muted-foreground">{t}</p>)}
 </CardContent></Card>;
}
