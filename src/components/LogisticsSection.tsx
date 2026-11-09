import { cementFleetLayout } from "@/lib/cement-fleet-layout";
import { FLEET_SCHEMES, FLEET_MANUFACTURERS, FLEET_SOURCES, fleetTemplate, type FleetScheme } from "@/lib/cement-fleet-catalog";
import { useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { planLogistics, DEFAULT_LOGISTICS, normalizeLogisticsSettings, type LogisticsSettings } from "@/lib/cement-logistics";
import type { PressureProfileResult, MaterialSummary, SlurryInput } from "@/lib/cementing-calculations";
import { useMeasuredWidth } from "@/hooks/use-measured-width";

interface Props {
  pressure: PressureProfileResult;
  materials: MaterialSummary;
  slurries: SlurryInput[];
  settings?: LogisticsSettings;
  onSettingsChange?: (s: LogisticsSettings) => void;
}

const f = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const hm = (min: number) => `${Math.floor(min / 60)} ч ${String(Math.round(min % 60)).padStart(2, "0")} мин`;

export default function LogisticsSection({ pressure, materials, slurries, settings, onSettingsChange }: Props) {
  const s=normalizeLogisticsSettings(settings??DEFAULT_LOGISTICS);
  const write=(next:LogisticsSettings)=>onSettingsChange?.(normalizeLogisticsSettings(next));
  useEffect(()=>{
    if(settings || !onSettingsChange)return;
    try { const legacy=localStorage.getItem('deallsoft:cement-logistics-settings:v1');if(legacy)onSettingsChange(normalizeLogisticsSettings(JSON.parse(legacy))); } catch { /* Legacy local settings may be unavailable. */ }
  },[settings,onSettingsChange]);
  const set = (k: keyof LogisticsSettings, v: string) => {
    const numeric=typeof s[k]==='number'||['bulkVolumeM3','bulkPayloadT','bulkDensityTm3','bulkUnloadTmin','maxBulkConnections'].includes(k);
    write({...s,[k]:numeric?Number(v):v,passportConfirmed:false});
  };
  const r = useMemo(() => planLogistics(pressure, materials, slurries, s), [pressure, materials, slurries, s]);
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();

  const field = (k: keyof LogisticsSettings, label: string, step = "1") => (
    <label className="space-y-1 text-xs">
      <div className="text-muted-foreground">{label}</div>
      <input type={typeof s[k] === "number" ? "number" : "text"} step={step} value={String(s[k])} onChange={(e) => set(k, e.target.value)}
        className="h-8 w-full rounded border border-border bg-background px-2 text-sm" />
    </label>
  );

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Техника и логистика</h3>
        <p className="text-xs text-muted-foreground max-w-3xl">
          Выберите схему. Машины подбираются по совместным расходу и давлению, отдельно проверяются смешивание и пневмоподача сухого материала. Все Q-P и гидравлическая мощность относятся к целому агрегату, а не к одному насосу. Параметры шаблона требуют сверки с паспортом конкретного исполнения.
        </p>
        <label className="block text-sm font-medium">Схема комплекса<select aria-label="Схема комплекса" className="block w-full rounded border bg-background p-2 mt-1" value={s.scheme} onChange={e=>write(fleetTemplate(e.target.value as FleetScheme,s))}>{Object.entries(FLEET_SCHEMES).map(([k,n])=><option key={k} value={k}>{n}</option>)}</select></label>
        {s.scheme!=='classic'&&<label className="block text-xs">Производитель / семейство<select aria-label="Производитель комплекса" className="block rounded border bg-background p-2" value={s.manufacturer??'SERVA'} onChange={e=>write({...s,manufacturer:e.target.value,passportConfirmed:false})}>{FLEET_MANUFACTURERS.map(n=><option key={n}>{n}</option>)}</select></label>}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {field("unitName", "Агрегат")}
          {field("unitPowerKW", "Доступная гидр. мощность машины, кВт")}
          {field("unitMaxPressureMPa", "Макс. давление, МПа")}
          {field("unitMaxRateLps", "Макс. подача, л/с")}
          {field("mixerName", s.scheme==='classic'?"Смесительная машина":"Смесительная система")}
          {s.scheme==='classic'&&field("mixerCapacityT", "Бункер СМН, т")}
          {field("mixRatePerPairLps", s.scheme==='classic'?"Затворение одним ЦА через воронку, л/с":"Смешивание одной системы, л/с")}
          {field("tankerM3", "Автоцистерна воды, м³")}
          {field("reserveUnits", "Резервных ЦА, шт.")}
          {s.scheme!=='classic'&&<>{field('bulkVolumeM3','Цементовоз, объём м³')}{field('bulkPayloadT','Грузоподъёмность, т')}{field('bulkDensityTm3','Насыпная плотность, т/м³','0.05')}{field('bulkUnloadTmin','Пневмоподача одной линии, т/мин','0.1')}{field('maxBulkConnections','Линий сухого материала на смеситель')}</>}
        </div>
        <label className="block text-sm">Источник воды<select aria-label="Источник воды" className="block border rounded bg-background p-2" value={s.waterSource} onChange={e=>write({...s,waterSource:e.target.value as 'rig'|'tankers'})}><option value="rig">Вода с буровой</option><option value="tankers">Доставка автоцистернами</option></select></label>
        {(s.scheme==='single'||s.scheme==='twin')&&<div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{field('supportUnitName','Дополнительный и резервный ЦА')}{field('supportPowerKW','Гидр. мощность ЦА, кВт')}{field('supportMaxPressureMPa','Предел давления ЦА, МПа')}{field('supportMaxRateLps','Подача ЦА, л/с')}</div>}
        <p className="text-xs">Миксер одно- и двухнасосного агрегата входит в его состав. Всегда предусмотрен отдельный СКЦ; при интегрированном агрегате - минимум один резервный ЦА. Цементовоз с тягачом - один автопоезд и один водитель-оператор. На основной агрегат - оператор и помощник, они же водители.</p>
        <div className="flex flex-wrap gap-4 text-xs"><label><input type="checkbox" checked={s.passportConfirmed??false} onChange={e=>write({...s,passportConfirmed:e.target.checked})}/> Характеристики сверены с паспортом / Q-P</label>{s.scheme!=='classic'&&<label><input type="checkbox" checked={s.closedMixing??false} onChange={e=>write({...s,closedMixing:e.target.checked})}/> Закрытая беспылевая подача</label>}</div>
        <details className="text-xs"><summary>Рабочие точки Q-P и источники</summary><p className="my-2">Внесите точки для всей машины. Между точками применяется консервативная ступенчатая огибающая; выше последней точки экстраполяции нет. Значения Qmax и Pmax не считаются одновременным режимом.</p>
          {(s.pumpCurve??[]).map((point,i)=><div key={i} className="flex gap-2 my-1"><label>P, МПа<input aria-label={`Давление характеристики ${i+1}`} className="w-24 rounded border bg-background p-1" type="number" min="0.01" step="any" value={point.pressureMPa} onChange={e=>write({...s,passportConfirmed:false,pumpCurve:s.pumpCurve!.map((x,j)=>j===i?{...x,pressureMPa:Number(e.target.value)}:x)})}/></label><label>Q, л/с<input aria-label={`Подача характеристики ${i+1}`} className="w-24 rounded border bg-background p-1" type="number" min="0.01" step="any" value={point.rateLps} onChange={e=>write({...s,passportConfirmed:false,pumpCurve:s.pumpCurve!.map((x,j)=>j===i?{...x,rateLps:Number(e.target.value)}:x)})}/></label><button onClick={()=>write({...s,pumpCurve:s.pumpCurve!.filter((_,j)=>j!==i),passportConfirmed:false})}>Удалить</button></div>)}
          <button className="underline" onClick={()=>write({...s,pumpCurve:[...(s.pumpCurve??[]),{pressureMPa:s.unitMaxPressureMPa,rateLps:Math.min(s.unitMaxRateLps,s.unitPowerKW/s.unitMaxPressureMPa)}],passportConfirmed:false})}>Добавить рабочую точку</button>
          {FLEET_SOURCES.map(source=><p className="mt-2" key={source.url}><a className="underline" href={source.url} target="_blank" rel="noreferrer">{source.name}</a>: {source.note}</p>)}
        </details>
      </Card>
      {!r.feasible&&<p role="alert" className="text-red-600 font-semibold">Комплекс не обеспечивает заданный режим давления и подачи. Количество машин не является подтверждением выполнимости.</p>}
      <button className="text-sm underline" onClick={()=>write({...s,equipmentQuantities:{},personnelQuantities:{}})}>Вернуть расчётное количество техники и людей</button>
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <h3 className="font-semibold text-sm">Состав техники</h3><p className="text-xs">{r.unitsWorking} рабочих машин (на скважину {r.dischargeUnits}, на затворение {r.mixingCA}), {r.workingPumps} насосов, {r.mixingSystems} смесительных систем. Отказ одного нагнетательного насоса: {f(r.onePumpOutRateLps,1)} л/с; {r.onePumpOutMeetsPeak?"пиковая подача сохраняется":"пиковая подача не обеспечена"}.</p>
          <table className="w-full text-xs">
            <thead className="bg-muted/50"><tr><th className="p-1.5 text-left">Техника</th><th className="p-1.5 text-right">Кол-во</th><th className="p-1.5 text-left">Обоснование</th></tr></thead>
            <tbody>{r.equipment.map((e) => (
              <tr key={e.id} className="border-t border-border/40 align-top"><td className="p-1.5 font-medium">{e.name}</td><td className="p-1.5 text-right"><input aria-label={`Количество техники: ${e.name}`} type="number" min={e.id==='skc'||(e.id==='reserve-ca'&&(s.scheme==='single'||s.scheme==='twin'))?1:0} step="1" className="w-16 border rounded bg-background p-1" value={e.count} onChange={event=>write({...s,equipmentQuantities:{...s.equipmentQuantities,[e.id]:Number(event.target.value)}})}/><div className="text-[10px] text-muted-foreground">расчёт {e.recommendedCount}</div></td><td className="p-1.5 text-muted-foreground">{e.note}</td></tr>
            ))}</tbody>
          </table>
          <div className="text-xs text-muted-foreground">
            Пиковая гидравлическая мощность {f(r.peakHydPowerKW)} кВт; макс. давление на устье {f(r.maxSurfaceMPa, 1)} МПа; испытание линий на {r.lineTestMPa} МПа.
          </div>
        </Card>
        <Card className="p-4 space-y-2">
          <h3 className="font-semibold text-sm">Состав бригады</h3>
          <table className="w-full text-xs">
            <tbody>{r.personnel.map((p) => (
              <tr key={p.id} className="border-t border-border/40"><td className="p-1.5">{p.role}</td><td className="p-1.5 text-right"><input aria-label={`Персонал: ${p.role}`} type="number" min="0" step="1" className="w-16 border rounded bg-background p-1" value={p.count} onChange={e=>write({...s,personnelQuantities:{...s.personnelQuantities,[p.id]:Number(e.target.value)}})}/> чел.</td></tr>
            ))}
              <tr className="border-t border-border font-semibold"><td className="p-1.5">Итого</td><td className="p-1.5 text-right">{r.personnel.reduce((t, p) => t + p.count, 0)} чел.</td></tr>
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="p-4 space-y-2"><h3 className="font-semibold">Схема расстановки оборудования</h3><p className="text-xs">Вид сверху. Каждая машина показана отдельно. В классике вода поступает в ЦА затворения, сухой цемент из СМН - в воронку; готовый раствор из осреднительной ёмкости откачивают отдельные ЦА. СКЦ подключена к конечной нагнетательной линии.</p><div className="overflow-x-auto"><div className="min-w-[760px]" dangerouslySetInnerHTML={{__html:cementFleetLayout(r,s)}}/></div></Card>
      <Card className="p-4 space-y-2">
        <h3 className="font-semibold text-sm">Потребность в нагнетательных машинах по Q-P</h3>
        <div ref={ref} className="h-52">
          <LineChart width={width || 900} height={208} data={r.unitsProfile} margin={{ top: 6, right: 16, bottom: 14, left: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
            <XAxis dataKey="time" type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v)}`} label={{ value: "Время, мин", position: "insideBottom", offset: -6, fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip labelFormatter={(t) => `${Math.round(Number(t))} мин`} formatter={(v: number, _n, item) => [`${v} шт. (${(item.payload as { stage: string }).stage})`, "Агрегатов"]} contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
            <Line type="stepAfter" dataKey="units" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </div>
        <div className="text-xs text-muted-foreground">
          Пик — {r.peakUnitsHydraulic} шт.: «{r.peakAt.stage}», {f(r.peakAt.time)} мин, {f(r.peakAt.rateLps)} л/с при {f(r.peakAt.pressureMPa, 1)} МПа
          (один {s.unitName} при этом давлении даёт {f(r.unitRateAt(r.peakAt.pressureMPa), 1)} л/с). Для смешивания нужно {r.mixingSystems} систем. {s.scheme!=="classic"&&`ЦТ-25: по запасу ${r.bulkStockCount}, по темпу ${r.bulkFeedCount} линий; принято ${r.bulkTrucks} машин с тягачами.`}
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <h3 className="font-semibold text-sm">График работ</h3>
        <table className="w-full text-xs">
          <thead className="bg-muted/50"><tr><th className="p-1.5 text-left">Этап</th><th className="p-1.5 text-right">Начало</th><th className="p-1.5 text-right">Длительность</th></tr></thead>
          <tbody>{r.timeline.map((t) => (
            <tr key={t.step} className="border-t border-border/40"><td className="p-1.5">{t.step}</td><td className="p-1.5 text-right">{hm(t.startMin)}</td><td className="p-1.5 text-right">{hm(t.durationMin)}</td></tr>
          ))}
            <tr className="border-t border-border font-semibold"><td className="p-1.5">Итого на скважине</td><td /><td className="p-1.5 text-right">{hm(r.timeline.reduce((a, t) => a + t.durationMin, 0))}</td></tr>
          </tbody>
        </table>
        {r.notes.map((n) => <div key={n} className="text-xs text-amber-700 dark:text-amber-500">⚠ {n}</div>)}
      </Card>
    </div>
  );
}
