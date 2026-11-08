import { useMemo, useRef, useState } from 'react';
import { Card,CardHeader,CardTitle,CardContent } from './ui/card';
import { Input } from './ui/input';
import { Button } from './ui/button';
import CopyImageButton from './CopyImageButton';
import type { WellData } from '@/lib/cementing-calculations';
import type { CentralizerInterval,TurbulatorPoint } from '@/lib/centralization-calculations';
import { calculateCasingRunning, normalizeRunningSettings, RUNNING_SOURCES, type CasingRunningSettings, type RunningMeasurement } from '@/lib/casing-running-analysis';
import { runningBroomSVG } from '@/lib/casing-running-plot';
import { LineChart,Line,XAxis,YAxis,Tooltip,Legend,CartesianGrid,ResponsiveContainer,ReferenceLine } from 'recharts';
export interface CasingRunningProps {
  wellData:WellData; mudDensity:number; intervals:CentralizerInterval[]; turbPoints:TurbulatorPoint[];
  pv:number; yp:number; frictionCased:number; frictionOpenhole:number; pipeWeightKgPerM?:number;
  onSettingsChange?:(s:CasingRunningSettings)=>void;
}
const G=9.80665;
export default function CasingRunningSection(props:CasingRunningProps){
  const {wellData:w,mudDensity,intervals,turbPoints,pv,yp,pipeWeightKgPerM}=props;
  const [local,setLocal]=useState<CasingRunningSettings>();
  const settings=useMemo(()=>normalizeRunningSettings(w.runningSettings??local,props.frictionCased,props.frictionOpenhole),[w.runningSettings,local,props.frictionCased,props.frictionOpenhole]);
  const patch=(p:Partial<CasingRunningSettings>)=>{const next=normalizeRunningSettings({...settings,...p});setLocal(next);props.onSettingsChange?.(next);};
  const result=useMemo(()=>calculateCasingRunning({well:w,mudDensity,intervals,turbPoints,pv,yp,pipeWeightKgPerM,settings}),[w,mudDensity,intervals,turbPoints,pv,yp,pipeWeightKgPerM,settings]);
  const chart=useRef<HTMLDivElement>(null);
  const [selected,setSelected]=useState<number>();
  const [measurement,setMeasurement]=useState<RunningMeasurement>({md:w.casingDepthMD,mode:'runIn',hookTF:0});
  const row=result.broom.reduce((best,p)=>Math.abs(p.md-(selected??w.casingDepthMD))<Math.abs(best.md-(selected??w.casingDepthMD))?p:best,result.broom[0]);
  const final=result.final;
  const fields:[keyof CasingRunningSettings,string,number][]=[
    ['frictionCased','Трение в предыдущей колонне, μ',.01],['frictionOpenhole','Трение в открытом стволе, μ',.01],
    ['frictionSpread','Вариация трения для веника, ±μ',.01],['speedMps','Скорость движения, м/с',.05],
    ['pipeWeightKgPerM','Погонная масса трубы с муфтами, кг/м (0 - по геометрии)',.1],
    ['blockWeightKN','Вес блока / подвески, кН',1],['maxHookKN','Предел нагрузки на крюк, кН (0 - не задан)',10],
    ['centralizerRunningKN','Сопротивление центратора без испытания, кН/шт.',.1],['turbulatorRunningKN','Сопротивление турбулизатора, кН/шт.',.1],
  ];
  return <section data-testid="casing-running-analysis" className="space-y-4">
    <Card><CardHeader><CardTitle>Спуск колонны: расчёт и график «веник»</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Каждая точка веника - отдельный расчёт нагрузки на крюке при текущей глубине башмака. Профиль усилий вдоль полностью спущенной колонны приведён отдельно.</p>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">{fields.map(([key,label,step])=><label key={key} className="text-xs">{label}<Input aria-label={label} type="number" min="0" step={step} value={settings[key] as number} onChange={e=>patch({[key]:Number(e.target.value)})}/></label>)}</div>
      <label className="text-xs block">Группа прочности для оценки напряжений<select aria-label="Группа прочности для оценки напряжений" className="border rounded p-2 ml-2 bg-background" value={settings.grade} onChange={e=>patch({grade:e.target.value as CasingRunningSettings['grade']})}>{['K-55','N-80','P-110'].map(g=><option key={g}>{g}</option>)}</select></label>
      <p className="text-xs text-muted-foreground">Вес блока по умолчанию 0 кН: скрытой добавки к показанию нет. Предел крюка задаётся по оборудованию. Пусковое, восстанавливающее усилие и удержание стоп-колец не заменяют сопротивление движению. Если испытания нет, задайте сценарий вручную; 0 означает, что добавочное сопротивление оснастки не учтено.</p>
      {result.unknownRunningCount>0&&<p role="status" className="text-sm text-amber-600">Нет испытанного сопротивления движению для {result.unknownRunningCount} центраторов. Принято {settings.centralizerRunningKN.toFixed(2)} кН/шт. по сценарию; при нуле добавка не учитывается.</p>}
      {result.errors.map(e=><p role="alert" key={e} className="text-destructive">{e}</p>)}
      {final&&<>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[
          ['Спуск на проектной глубине',`${final.runIn.toFixed(1)} тс`],['Подъём на проектной глубине',`${final.pullOut.toFixed(1)} тс`],
          ['Максимум подъёма за весь спуск',`${(result.maxPullKN/G).toFixed(1)} тс при ${result.maxPullMD.toFixed(0)} м`],
          ['Вклад оснастки при спуске',`${(final.noTools-final.runIn).toFixed(1)} тс / ${result.centralizerCount} центр.`],
        ].map(([label,value])=><div key={label} className="border rounded p-3"><p className="text-xs text-muted-foreground">{label}</p><b>{value}</b></div>)}</div>
        <div role="status" className="rounded border p-3 space-y-1 text-sm">
          {result.firstPassageConflictMD!==null&&<p className="text-destructive">Геометрический конфликт прохода при глубине башмака {result.firstPassageConflictMD.toFixed(0)} м: проверьте трубу, кольца и жёсткую оснастку по всему пути спуска.</p>}
          <p>{result.firstCompressionMD===null?'По модели осевое сжатие при спуске не выявлено.':`Осевое сжатие появляется к глубине башмака ${result.firstCompressionMD.toFixed(0)} м (шаг расчёта). Это сигнал для проверки устойчивости, а не доказательство прихвата.`}</p>
          <p>{settings.maxHookKN===0?'Грузоподъёмность не задана: запас по крюку не оценён.':result.firstCapacityMD===null?`Минимальный запас крюка при подъёме: ${((settings.maxHookKN-result.maxPullKN)/G).toFixed(1)} тс.`:`Предел крюка превышен к глубине башмака ${result.firstCapacityMD.toFixed(0)} м.`}</p>
        </div>
        <div className="overflow-x-auto"><div ref={chart} className="bg-white rounded border min-w-[640px]" dangerouslySetInnerHTML={{__html:runningBroomSVG(result,settings)}}/></div>
        <CopyImageButton targetRef={chart} label="Копировать веник"/>
        <p className="text-xs text-muted-foreground">Сплошные линии - заданное трение μ={settings.frictionCased.toFixed(2)} / {settings.frictionOpenhole.toFixed(2)} (колонна / ствол). Штриховые - μ±{settings.frictionSpread.toFixed(2)} с ограничением 0-1. Это сценарии чувствительности, не доверительный интервал. Точки - фактические замеры. На узком экране график прокручивается по горизонтали. 1 тс = 9,80665 кН.</p>
        <label className="block text-sm">Контрольная глубина башмака: {row?.md.toFixed(0)} м<Input aria-label="Контрольная глубина башмака" type="range" min="0" max={w.casingDepthMD} step="1" value={selected??w.casingDepthMD} onChange={e=>setSelected(Number(e.target.value))}/></label>
        {row&&<div className="text-sm grid grid-cols-2 gap-2"><p>Спуск: <b>{row.runIn.toFixed(2)} тс</b></p><p>Подъём: <b>{row.pullOut.toFixed(2)} тс</b></p><p>Без трения: <b>{row.free.toFixed(2)} тс</b></p><p>Вращение, сухое трение: <b>{row.torqueKNm.toFixed(2)} кН·м</b></p></div>}
      </>}
    </CardContent></Card>
    {final&&<>
      <Card><CardHeader><CardTitle>План / факт и подбор трения</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Сравнивайте установившееся движение при одинаковой скорости и учёте веса подвески. Подбор ищет общую поправку Δμ в диапазоне ±0,20, с шагом 0,01, одновременно для колонны и ствола. По этим точкам нельзя независимо определить два коэффициента.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2"><label className="text-xs">Замер MD, м<Input aria-label="Замер MD, м" type="number" value={measurement.md} onChange={e=>setMeasurement({...measurement,md:Number(e.target.value)})}/></label>
          <label className="text-xs">Замер нагрузки, тс<Input aria-label="Замер нагрузки, тс" type="number" value={measurement.hookTF} onChange={e=>setMeasurement({...measurement,hookTF:Number(e.target.value)})}/></label>
          <label className="text-xs">Режим замера<select aria-label="Режим замера" className="block border rounded p-2 bg-background" value={measurement.mode} onChange={e=>setMeasurement({...measurement,mode:e.target.value as RunningMeasurement['mode']})}><option value="runIn">Спуск</option><option value="pullOut">Подъём</option></select></label>
          <Button disabled={!(measurement.md>0&&measurement.md<=w.casingDepthMD&&measurement.hookTF>=0)||settings.measurements.length>=100} onClick={()=>patch({measurements:[...settings.measurements,{...measurement}]})}>Добавить замер</Button></div>
        {settings.measurements.map((m,i)=><div key={i} className="text-sm flex items-center gap-3"><span>{m.md} м · {m.mode==='runIn'?'спуск':'подъём'} · {m.hookTF} тс {m.md>w.casingDepthMD?'(вне расчётной глубины)':''}</span><Button variant="ghost" size="sm" aria-label={`Удалить замер ${i+1}`} onClick={()=>patch({measurements:settings.measurements.filter((_,j)=>j!==i)})}>Удалить</Button></div>)}
        {result.calibration&&<div className="text-sm border rounded p-3"><p>{result.calibration.informative?`Подобрана поправка Δμ=${result.calibration.deltaMu.toFixed(2)}; среднеквадратичное отклонение ${result.calibration.rmseTF.toFixed(2)} тс (${result.calibration.count} замеров).`:'Трение не определяется этими замерами: чувствительность слишком мала (например, вертикальный ствол).'}</p>
          {result.calibration.atBoundary&&result.calibration.informative&&<p>Лучший вариант на границе поиска: проверьте вес колонны, плотность, подвеску и дополнительные сопротивления.</p>}
          <Button variant="outline" disabled={!result.calibration.informative||result.calibration.atBoundary} onClick={()=>patch({frictionCased:settings.frictionCased+result.calibration!.deltaMu,frictionOpenhole:settings.frictionOpenhole+result.calibration!.deltaMu})}>Применить поправку трения</Button></div>}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Усилия вдоль колонны на проектной глубине</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Здесь MD - координата сечения трубы; на венике MD - текущая глубина башмака. Отрицательная осевая сила означает сжатие. Вес блока в профиль трубы не входит.</p>
        <ResponsiveContainer width="100%" height={280}><LineChart data={result.profile}>
          <CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="md" type="number" domain={[0,w.casingDepthMD]} tick={{fontSize:10}}/><YAxis unit=" кН" tick={{fontSize:10}}/><Tooltip/><Legend/><ReferenceLine y={0}/>
          <Line dataKey="runInKN" name="Осевое усилие, спуск" stroke="#15803d" dot={false}/><Line dataKey="pullOutKN" name="Осевое усилие, подъём" stroke="#dc2626" dot={false}/>
          <Line dataKey="toolDragKN" name="Накопленное сопротивление оснастки" stroke="#7c3aed" dot={false}/><Line dataKey="viscousDragKN" name="Накопленное вязкое сопротивление" stroke="#0284c7" dot={false}/>
        </LineChart></ResponsiveContainer>
        <div className="grid sm:grid-cols-3 gap-3 text-sm"><p>Макс. изгиб, оценка: <b>{result.maxBendingMPa.toFixed(1)} МПа</b></p><p>Осевое + изгиб, оценка: <b>{result.maxCombinedMPa.toFixed(1)} МПа</b> / текучесть {result.yieldMPa} МПа</p><p>Вместимость колонны: <b>{result.internalVolumeM3.toFixed(2)} м³</b>; объём стали: <b>{result.steelDisplacementM3.toFixed(2)} м³</b></p></div>
        <p className="text-xs text-muted-foreground">Вместимость - полный объём заполнения колонны, не автоматический долив. При спуске заполненной трубы объём стали вытесняет раствор в возврат; при закрытом конце баланс зависит от заполнения. Автоматического «долива на трубу» в этой модели нет.</p>
      </CardContent></Card>
    </>}
    <details className="border rounded p-3 text-xs space-y-2"><summary className="cursor-pointer font-medium">Методика, допущения и качество данных</summary>
      <p>Soft-string: интегрирование снизу вверх с нулевой нагрузкой у башмака. Нормальная сила учитывает вес, зенит, поворот азимута и натяжение отдельно для спуска и подъёма. Оснастка перемещается вместе с трубой; количество берётся из потрубной ведомости, а не из дробной плотности на метр. Вязкость: приближение Couette / Bingham при заданной скорости.</p>
      {result.notes.map(n=><p key={n}>{n}</p>)}
      <p>Модель не заменяет stiff-string расчёт контакта и устойчивости. Давления surge/swab проверяются в отдельном T&amp;D-модуле.</p>
      {RUNNING_SOURCES.map((url,i)=><a key={url} className="block text-primary underline" href={url} target="_blank" rel="noreferrer">Источник методики {i+1}</a>)}
    </details>
  </section>;
}
