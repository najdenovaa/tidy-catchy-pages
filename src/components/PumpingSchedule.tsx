import MovingPlugBench from './MovingPlugBench';
import CompressibleTransportPanel from "./CompressibleTransportPanel";
import type {TransportResult} from "@/lib/compressible-transport";
import PvtHydrostaticsPanel from "./PvtHydrostaticsPanel";
import {useMemo} from 'react';
import {Card,CardHeader,CardTitle,CardContent} from './ui/card';
import {Table,TableHeader,TableHead,TableRow,TableCell,TableBody} from './ui/table';
import {buildProcessContract,processContractCsv} from '@/lib/cementing-process';
import type {CementingSnapshot} from '@/lib/cementing-normalizers';
import type {PressureProfileResult} from '@/lib/cementing-calculations';
import FluidInventoryPanel from './FluidInventoryPanel';
import {StopStoragePanel} from './StopStorageSection';
/** One calculated snapshot, one schedule. Service volumes never increase well injection. */
export default function PumpingSchedule({input,result,transportResult,onTransportResult}:{input:CementingSnapshot;result?:PressureProfileResult;transportResult?:TransportResult|null;onTransportResult?:(r:TransportResult|null)=>void}){
 const c=useMemo(()=>result?.processContract??buildProcessContract(input),[input,result]);
 let wellVolume=0;
 const rows=c.stages.map(s=>{if(s.destination==='well')wellVolume+=s.volumeM3;return {...s,wellVolume};});
 const time=(n:number|null)=>n===null?'не определено':n.toFixed(2);
 return <div className="space-y-4">
 <Card><CardHeader><CardTitle className="text-lg">Расписание и баланс закачки</CardTitle></CardHeader><CardContent className="space-y-4">
 <p className="text-xs text-muted-foreground">План по рассчитанному снимку программы. Промывка ЛВД идёт мимо скважины. Незаданные подготовка, опрессовка и демонтаж сюда не добавляются.</p>
 <div className="grid sm:grid-cols-3 gap-3 text-sm"><p>План в скважину: <b>{c.wellVolumeM3.toFixed(3)} м³</b><br/>Масса порций: {c.canRun?(c.wellMassKg/1000).toFixed(3)+' т':'не подтверждена'}</p><p>ЛВД отдельно: <b>{c.surfaceVolumeM3.toFixed(3)} м³</b></p><p>Плановое время: <b>{time(c.totalTimeMin)}{c.totalTimeMin!==null?' мин':''}</b></p></div>
 {c.issues.map((x,i)=><p key={i} role={x.severity==='error'?'alert':'status'} className={'text-xs '+(x.severity==='error'?'text-destructive':'text-amber-700')}>{x.message}</p>)}
 <div className="overflow-x-auto"><Table><TableHeader><TableRow>{['Порция / режим','Жидкость / назначение','л/с','Объём, м³','Длительность, мин','Конец, мин','В скважину накопленно, м³'].map(t=><TableHead key={t} className="text-xs">{t}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map(s=>{const f=c.fluids.find(f=>f.id===s.fluidId);return <TableRow key={s.id}><TableCell>{s.name} / {s.stepIndex+1}</TableCell><TableCell className="text-xs">{f?.densityKgM3.toFixed(0)} кг/м³<br/>{s.destination==='well'?'В скважину':'ЛВД мимо скважины'}</TableCell><TableCell>{s.rateLps.toFixed(2)}</TableCell><TableCell>{s.volumeM3.toFixed(3)}</TableCell><TableCell>{time(s.durationMin)}</TableCell><TableCell>{time(s.endMin)}</TableCell><TableCell>{s.wellVolume.toFixed(3)}</TableCell></TableRow>;})}</TableBody></Table></div>
 <p className="text-xs text-muted-foreground">Невязка интеграла расхода по времени: {c.volumeResidualM3.toExponential(2)} м³; {c.massResidualKg.toExponential(2)} кг. Это проверка назначенных порций. Фактическое распределение в модели показано отдельным балансом ниже.</p>
 {result?.processAudit&&<p className="text-xs text-muted-foreground">Стоп в модели: {result.stopTime.toFixed(2)} мин. Разница закачанного объёма с планом: {result.processAudit.differenceM3.toFixed(3)} м³. {result.processAudit.reason}</p>}
 <button type="button" className="text-xs text-primary underline" onClick={()=>{const url=URL.createObjectURL(new Blob(['\uFEFF'+processContractCsv(c)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='cementing-process.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Скачать расписание CSV</button>
 </CardContent></Card>
 {result&&<FluidInventoryPanel result={result}/>}
 <StopStoragePanel result={result?.stopStorage}/>
 <PvtHydrostaticsPanel result={result?.pvtHydrostatics}/>
 <MovingPlugBench rheologyEnabled={input.wellData.stopStorage?.plugRheologyEnabled} backRheology={input.wellData.stopStorage?.plugBackRheology} aheadRheology={input.wellData.stopStorage?.plugAheadRheology} studyEnabled={input.wellData.stopStorage?.plugStudyEnabled} coupledEnabled={input.wellData.stopStorage?.plugCoupledEnabled} hydraulicsEnabled={input.wellData.stopStorage?.plugHydraulicsEnabled} viscosityMpas={input.wellData.stopStorage?.plugViscosityMpas} enabled={input.wellData.stopStorage?.plugBenchEnabled} input={input.wellData.stopStorage?.plugBenchCase} aleEnabled={input.wellData.stopStorage?.plugAleEnabled} cells={input.wellData.stopStorage?.plugAleCells} switchSec={input.wellData.stopStorage?.plugAleSwitchSec}/>
 <CompressibleTransportPanel input={input} cachedResult={transportResult} onResult={onTransportResult}/>
 </div>;
}
