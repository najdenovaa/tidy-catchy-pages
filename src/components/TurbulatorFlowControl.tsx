import { useMemo, useState } from 'react';
import { Gauge, Minus, Plus, Square } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import Turbulator3DInspector from './Turbulator3DInspector';
import TurbulatorDecayPlot from './TurbulatorDecayPlot';
import type { WellData } from '@/lib/cementing-calculations';
import { interpolateTrajectory } from '@/lib/centralization-calculations';
import { trajectoryAzimuth } from '@/lib/centralizer-mesh';
import { createAnnularGeometry } from '@/lib/well-geometry';
import { turbulatorRegimeThresholds, type TurbulatorFluid, type TurbulatorFlowResult } from '@/lib/turbulator-flow';

interface Props { well: WellData; result: TurbulatorFlowResult; fluid: TurbulatorFluid; rateLps: number; onRateChange: (rate:number)=>void; }
const fmt=(n:number,d=2)=>n.toLocaleString('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d});

export default function TurbulatorFlowControl({well,result,fluid,rateLps,onRateChange}:Props) {
  const thresholds=useMemo(()=>turbulatorRegimeThresholds(well,result.point.md,fluid),[well,result.point.md,fluid]);
  const [requestedMax,setRequestedMax]=useState(()=>Math.min(200,Math.max(50,Math.ceil((thresholds.turbulentLps??0)*1.2/10)*10)));
  const [windowM,setWindowM]=useState(1);
  const maxRate=Math.max(requestedMax,rateLps);
  const percent=(q:number|null)=>q===null?100:Math.max(0,Math.min(100,q/maxRate*100));
  const lam=percent(thresholds.transitionLps),turb=percent(thresholds.turbulentLps);
  const stopped=rateLps===0;
  const regime=stopped?'Насосы остановлены':result.regime===0?'Ламинарный':result.regime===1?'Турбулентный':'Переходный';
  const color=stopped?'#94a3b8':result.regime===0?'#22d3ee':result.regime===1?'#f472b6':'#fbbf24';
  const md=result.point.md,survey=interpolateTrajectory(well.trajectory,md),azimuth=trajectoryAzimuth(well.trajectory,md);
  const cell=createAnnularGeometry(well,well.casingDepthMD).at(md);
  // A local cylindrical inspector ends at the actual geometry boundary; it never invents a constant bore beyond it.
  const upM=Math.max(0,Math.min(windowM,md-(cell?.topMD??0)));
  const downM=Math.max(0,Math.min((result.point.lengthMm??180)/1000+.18,(cell?.bottomMD??well.casingDepthMD)-md));
  const topMD=md-upM,bottomMD=md+downM;
  const topSurvey=interpolateTrajectory(well.trajectory,topMD),bottomSurvey=interpolateTrajectory(well.trajectory,bottomMD);
  const titleQ=(q:number|null)=>q===null?`> ${thresholds.searchLimitLps} л/с`:`${fmt(q)} л/с`;
  return <div className="grid gap-3 xl:grid-cols-[minmax(260px,360px)_minmax(0,1fr)] items-start min-w-0" data-turbulator-control data-transition-lps={thresholds.transitionLps??undefined} data-turbulent-lps={thresholds.turbulentLps??undefined}>
    <section className="xl:col-start-1 xl:row-start-1 rounded-xl border border-slate-700 bg-slate-950 p-4 text-slate-200 space-y-4 min-w-0" aria-label="Пульт производительности насосов">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h4 className="text-sm font-medium flex items-center gap-2"><Gauge className="w-4 h-4"/> Производительность насосов</h4><p className="text-xs text-slate-400 mt-1">Суммарная подача · {fluid.name}</p></div>
        <div className="text-right"><output className="text-2xl font-semibold tabular-nums" data-turbulator-rate style={{color}}>{fmt(rateLps,1)} <span className="text-sm">л/с</span></output><p className="text-xs text-slate-400 tabular-nums">{fmt(rateLps*60,0)} л/мин · {fmt(rateLps*.06)} м³/мин</p></div>
      </div>
      <div className="space-y-2">
        <label className="text-xs text-slate-300" htmlFor="turbulator-pump-slider">Подача насосов — двигайте шкалу</label>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="icon" className="shrink-0 bg-slate-900 border-slate-700 text-slate-200" aria-label="Уменьшить подачу на 0,5 л/с" onClick={()=>onRateChange(Math.max(0,Math.round((rateLps-.5)*10)/10))}><Minus className="w-4 h-4"/></Button>
          <input id="turbulator-pump-slider" aria-label="Производительность насосов" aria-valuetext={`${fmt(rateLps,1)} л/с; ${regime}; скорость ${fmt(result.axialMs,3)} м/с`} type="range" min={0} max={maxRate} step={.1} value={rateLps} onChange={e=>onRateChange(+e.target.value)} className="w-full min-w-0 h-8 cursor-pointer accent-cyan-400" style={{accentColor:color}}/>
          <Button type="button" variant="outline" size="icon" className="shrink-0 bg-slate-900 border-slate-700 text-slate-200" aria-label="Увеличить подачу на 0,5 л/с" onClick={()=>onRateChange(Math.min(maxRate,Math.round((rateLps+.5)*10)/10))}><Plus className="w-4 h-4"/></Button>
        </div>
        <div className="h-2 rounded-full relative" aria-hidden="true" style={{background:`linear-gradient(to right,#0891b2 0%,#0891b2 ${lam}%,#d97706 ${lam}%,#d97706 ${turb}%,#db2777 ${turb}%,#db2777 100%)`}}>
          <span className="absolute h-4 w-1 bg-white -top-1 rounded" style={{left:`calc(${percent(rateLps)}% - 2px)`}}/>
        </div>
        <div className="flex justify-between text-[11px] text-slate-400"><span>0 · стоп</span><span>{fmt(maxRate,0)} л/с</span></div>
        <div className="flex flex-wrap justify-between items-center gap-3 text-xs">
          <Button type="button" size="sm" variant="outline" className="bg-slate-900 border-slate-700 text-slate-200" onClick={()=>onRateChange(0)}><Square className="w-3 h-3 mr-2"/>Стоп насосов</Button>
          <label className="flex items-center gap-2">Предел шкалы, л/с<Input aria-label="Предел шкалы подачи" type="number" min={1} max={2000} step={10} value={requestedMax} className="w-20 h-8 bg-slate-900 border-slate-700" onChange={e=>{const n=+e.target.value;if(Number.isFinite(n)&&n>=1&&n<=2000)setRequestedMax(n);}}/></label>
        </div>
      </div>
    </section>
    <div className="xl:col-start-2 xl:row-start-1 xl:row-span-4 min-w-0">
      <Turbulator3DInspector result={result} pipeOD={well.casingOD} zenith={survey.zenith} azimuth={azimuth} viewAboveM={upM} viewBelowM={downM} rateLps={rateLps}/>
    </div>
    <section className="xl:col-start-1 xl:row-start-2 rounded-xl border border-slate-700 bg-slate-950 p-3 text-slate-200 space-y-3 min-w-0" aria-label="Скорости и режим потока">
      <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
        {([['Скорость вверх',fmt(result.axialMs,3)+' м/с'],['Скорость закрутки',fmt(result.tangentialMs,3)+' м/с'],['Угол потока к оси',stopped?'—':fmt(Math.atan(result.ratio)*180/Math.PI,1)+'°'],['Re обобщённое',fmt(result.reynolds,0)]]).map(([a,b])=><div key={a} className="rounded-lg border border-slate-700 p-2.5"><span className="text-slate-400">{a}</span><b className="block mt-1 text-sm" data-flow-metric={a}>{b}</b></div>)}
      </div>
      <div className="rounded-lg border border-slate-700 p-3 space-y-2">
        <div className="flex flex-wrap justify-between gap-2 text-sm"><b style={{color}} data-flow-regime>{regime}</b><span className="text-slate-400 text-xs">Режим в затрубье на MD {fmt(md)} м</span></div>
        <div className="grid sm:grid-cols-2 gap-2 text-xs">
          <p><span className="text-amber-400">Начало перехода</span><b className="block mt-1">Q ≈ {titleQ(thresholds.transitionLps)}</b><span className="text-slate-400">Re = {fmt(thresholds.reLaminar,0)}</span></p>
          <p><span className="text-pink-400">Турбулентный режим</span><b className="block mt-1">Q &gt; {titleQ(thresholds.turbulentLps)}</b><span className="text-slate-400">Re &gt; {fmt(thresholds.reTurbulent,0)}</span></p>
        </div>
        <p className="text-[11px] text-slate-400">Пороги рассчитаны общей моделью гидравлики по выбранной реологии и местному диаметру. Это режим осевого потока; рёбра создают закрутку и при ламинарном течении. Шкала задаёт локальный сценарий; расходы ступеней общей программы задаются в закачке. Диапазон шкалы задаётся для просмотра.</p>
      </div>
    </section>
    <section className="xl:col-start-1 xl:row-start-3 rounded-xl border p-3 space-y-3 text-xs min-w-0" aria-label="Длина затухания вращения">
      <b>Затухание после турбулизатора</b>
      <div className="grid grid-cols-3 gap-2">{([['90%',result.decay90M],['99%',result.decay99M],['99,9%',result.decay999M]] as const).map(([label,length])=><div key={label} className="rounded border p-2"><span>Потеря {label}</span><b className="block">{length===undefined?'не достигнуто':fmt(length)+' м'}</b></div>)}</div>
      <p>Остаток вращательного момента на конце расчётного участка: <b>{fmt((result.residualFraction??0)*100,3)}%</b>. Расстояния отсчитываются вверх от MD {fmt(md)} м.</p>
      <p className="text-muted-foreground">Практическое затухание — потеря 99,9% начального вращательного момента. Для точного нуля при плавном вязком затухании конечная длина не задаётся.</p>
      <TurbulatorDecayPlot result={result}/>
    </section>
    <section className="xl:col-start-1 xl:row-start-4 rounded-xl border p-3 space-y-3 text-xs min-w-0" aria-label="Интервал наблюдения турбулизатора">
      <div className="flex flex-wrap justify-between gap-2"><b>Место наблюдения · MD {fmt(md)} м</b><span>TVD {fmt(survey.tvd)} м</span></div>
      <div className="grid grid-cols-2 gap-2">
        <p>Зенитный угол<b className="block">{fmt(survey.zenith,1)}°</b></p><p>Азимут<b className="block">{fmt(azimuth,1)}°</b></p>
        <p>Ствол / труба<b className="block">{fmt(result.boreMm,1)} / {fmt(well.casingOD,1)} мм</b></p><p>Standoff<b className="block">{fmt(result.standoffPct,1)}%</b></p>
      </div>
      <div className="relative h-2 rounded bg-muted" aria-hidden="true"><span className="absolute top-[-3px] h-3.5 w-1 rounded bg-primary" style={{left:`${well.casingDepthMD>0?md/well.casingDepthMD*100:0}%`}}/></div>
      <div className="flex justify-between text-muted-foreground"><span>Устье · 0 м</span><span>Башмак · {fmt(well.casingDepthMD,0)} м MD</span></div>
      <label className="block">Окно выше изделия: {fmt(windowM,1)} м<input aria-label="Длина окна наблюдения" type="range" min={.25} max={5} step={.25} value={windowM} onChange={e=>setWindowM(+e.target.value)} className="block w-full mt-1 accent-cyan-500"/></label>
      <p data-turbulator-interval>Видимый интервал MD <b>{fmt(topMD)}–{fmt(bottomMD)} м</b> · TVD {fmt(topSurvey.tvd)}–{fmt(bottomSurvey.tvd)} м.</p>
      <p className="text-muted-foreground">{cell?.source==='previous-casing'?'Внутри предыдущей колонны':cell?.source==='measured'?'Открытый ствол · измеренный диаметр':'Открытый ствол · диаметр с кавернозностью'}. Участок геометрии MD {fmt(cell?.topMD??0)}–{fmt(cell?.bottomMD??well.casingDepthMD)} м. {upM<windowM?'Окно ограничено границей участка или устьем.':''}</p>
    </section>
  </div>;
}
