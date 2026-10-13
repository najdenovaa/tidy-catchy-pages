import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis, ReferenceArea } from "recharts";
import { Upload, FileDown, Eye, EyeOff, FlaskConical } from "lucide-react";
import { readSkcFile, parseText, guessMapping, toSeries, type SkcRaw, type SkcMapping, type SkcField } from "@/lib/skc-import";
import { analyzeSkc, syntheticSkcCsv, type SkcAnalysis, type EventLevel } from "@/lib/skc-analysis";
import { exportSkcReportDocx } from "@/lib/skc-report-docx";
import { useMeasuredWidth } from "@/hooks/use-measured-width";
import type { WellData, SlurryInput, BufferFluid, DrillingFluid, DisplacementFluid, PressureProfileResult, VolumeResults } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  displacementFluids: DisplacementFluid[];
  plan: PressureProfileResult;
  volumes: VolumeResults;
  onApplyCalibration: (patch: { frictionCalibration: number; cavernCoeff?: number }) => void;
}

const FIELD_LABEL: Record<SkcField, string> = { time: "Время", pressure: "Давление", rate: "Расход", density: "Плотность", volume: "Объём" };
const LVL: Record<EventLevel, { cls: string; icon: string }> = {
  critical: { cls: "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300", icon: "🔴" },
  warning: { cls: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-300", icon: "⚠" },
  info: { cls: "border-border bg-muted/30", icon: "ℹ" },
  ok: { cls: "border-green-300 bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300", icon: "✓" },
};
const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d));

type FsHandle = { getFile: () => Promise<File>; name: string };

export default function SkcControlSection(props: Props) {
  const [raw, setRaw] = useState<SkcRaw | null>(null);
  const [map, setMap] = useState<SkcMapping | null>(null);
  const [fileName, setFileName] = useState("");
  const [offsetManual, setOffsetManual] = useState<string>("");
  const [watching, setWatching] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const handleRef = useRef<FsHandle | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sync = (fn: () => void) => { try { flushSync(fn); } catch { fn(); } };

  const load = (r: SkcRaw, name: string) => sync(() => { setRaw(r); setMap(guessMapping(r)); setFileName(name); setMsg(null); });

  const onFile = async (file: File) => {
    try { load(await readSkcFile(file), file.name); } catch (e) { setMsg(`Не удалось прочитать файл: ${(e as Error).message}`); }
  };

  const canWatch = typeof window !== "undefined" && "showOpenFilePicker" in window;
  const startWatch = async () => {
    try {
      // File System Access API (Chrome / Edge / Яндекс.Браузер): держим файл открытым и перечитываем
      const [h] = await (window as unknown as { showOpenFilePicker: (o: unknown) => Promise<FsHandle[]> }).showOpenFilePicker({
        types: [{ description: "Запись СКЦ", accept: { "text/csv": [".csv", ".txt"], "application/vnd.ms-excel": [".xls", ".xlsx"] } }],
      });
      handleRef.current = h;
      await onFile(await h.getFile());
      setWatching(true);
    } catch { /* отменено */ }
  };
  useEffect(() => {
    if (!watching) return;
    const id = setInterval(async () => {
      const h = handleRef.current; if (!h) return;
      try {
        const file = await h.getFile();
        const r = await readSkcFile(file);
        sync(() => { setRaw(r); setFileName(`${file.name} (обновлено ${new Date().toLocaleTimeString("ru-RU")})`); });
      } catch { /* файл занят записью — попробуем позже */ }
    }, 10000);
    return () => clearInterval(id);
  }, [watching]);

  const loadExample = () => {
    const cemOut = props.plan.points.find((p) => p.annCementHeightM > 1)?.cumulativeVolume ?? props.volumes.totalPipeVolume;
    const csv = syntheticSkcCsv(props.plan, { frictionK: 1.3, lossFromV: cemOut + 10, lossMPa: 2.5, bumpExtraM3: 0.4 });
    load(parseText(csv), "Пример (синтетическая запись по расчёту: трение ×1,3, поглощение во время продавки)");
  };

  const series = useMemo(() => (raw && map ? toSeries(raw, map) : null), [raw, map]);
  const analysis: SkcAnalysis | null = useMemo(() => {
    if (!series || series.points.length < 10) return null;
    const off = offsetManual.trim() === "" ? null : parseFloat(offsetManual.replace(",", "."));
    return analyzeSkc({
      series: series.points, plan: props.plan, slurries: props.slurries, buffers: props.buffers,
      displacementFluids: props.displacementFluids, drillingFluid: props.drillingFluid, volumes: props.volumes,
      plugBumpMPa: props.wellData.ckodShearPressureMPa ?? 1.5, volumeOffsetM3: Number.isFinite(off as number) ? (off as number) : null,
    });
  }, [series, offsetManual, props.plan, props.slurries, props.buffers, props.displacementFluids, props.drillingFluid, props.volumes, props.wellData.ckodShearPressureMPa]);

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="max-w-3xl">
            <h3 className="font-semibold">Контроль цементирования по данным станции (СКЦ)</h3>
            <p className="text-xs text-muted-foreground">
              Загрузите запись станции контроля цементирования (CSV, TXT или Excel): время, давление на устье, расход, плотность (объём — по желанию).
              Запись совмещается с расчётом по накопленному объёму, модель калибруется по фактическому трению, затем автоматически
              ищутся поглощение, отклонения давления, плотность вне допуска, посадка пробки и смещение верха цемента.
              Режим «Следить за файлом» перечитывает выгрузку каждые 10 с — для контроля прямо во время работ.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <input ref={fileRef} type="file" accept=".csv,.txt,.xlsx,.xls,.ods" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) onFile(file); e.target.value = ""; }} />
            <Button onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1" />Загрузить запись</Button>
            {canWatch && (watching
              ? <Button variant="outline" onClick={() => { setWatching(false); handleRef.current = null; }}><EyeOff className="h-4 w-4 mr-1" />Остановить слежение</Button>
              : <Button variant="outline" onClick={startWatch}><Eye className="h-4 w-4 mr-1" />Следить за файлом</Button>)}
            <Button variant="ghost" onClick={loadExample}><FlaskConical className="h-4 w-4 mr-1" />Пример записи</Button>
          </div>
        </div>
        {msg && <div className="text-xs text-red-600">{msg}</div>}
        {raw && map && (
          <div className="space-y-2">
            <div className="text-xs"><span className="text-muted-foreground">Файл:</span> {fileName} · строк данных: {raw.rows.length}{watching && <Badge variant="outline" className="ml-2 text-green-700 border-green-300">● слежение</Badge>}</div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              {(Object.keys(FIELD_LABEL) as SkcField[]).map((fld) => (
                <label key={fld} className="space-y-1">
                  <div className="text-muted-foreground">{FIELD_LABEL[fld]}</div>
                  <select value={map.columns[fld] ?? -1} onChange={(e) => { const v = Number(e.target.value); setMap({ ...map, columns: { ...map.columns, [fld]: v < 0 ? undefined : v } }); }}
                    className="h-8 w-full rounded border border-border bg-background px-1">
                    <option value={-1}>— нет —</option>
                    {raw.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              <UnitSel label="Время" value={map.units.time} opts={["чч:мм:сс", "с", "мин", "дата-время"]} onChange={(v) => setMap({ ...map, units: { ...map.units, time: v as SkcMapping["units"]["time"] } })} />
              <UnitSel label="Давление" value={map.units.pressure} opts={["МПа", "атм", "кгс/см²", "бар", "psi"]} onChange={(v) => setMap({ ...map, units: { ...map.units, pressure: v as SkcMapping["units"]["pressure"] } })} />
              <UnitSel label="Расход" value={map.units.rate} opts={["л/с", "м³/мин", "м³/ч", "bbl/мин"]} onChange={(v) => setMap({ ...map, units: { ...map.units, rate: v as SkcMapping["units"]["rate"] } })} />
              <UnitSel label="Плотность" value={map.units.density} opts={["г/см³", "кг/м³", "ppg"]} onChange={(v) => setMap({ ...map, units: { ...map.units, density: v as SkcMapping["units"]["density"] } })} />
              <UnitSel label="Объём" value={map.units.volume} opts={["м³", "л", "bbl"]} onChange={(v) => setMap({ ...map, units: { ...map.units, volume: v as SkcMapping["units"]["volume"] } })} />
            </div>
            <div className="overflow-x-auto">
              <table className="text-[11px]">
                <thead><tr>{raw.headers.map((h, i) => <th key={i} className="px-2 py-0.5 text-left bg-muted/50">{h}</th>)}</tr></thead>
                <tbody>{raw.rows.slice(0, 4).map((r, i) => <tr key={i}>{raw.headers.map((_, j) => <td key={j} className="px-2 py-0.5 border-t border-border/40">{r[j]}</td>)}</tr>)}</tbody>
              </table>
            </div>
            {series?.warnings.map((w) => <div key={w} className="text-xs text-amber-700">⚠ {w}</div>)}
            {series && <div className="text-[11px] text-muted-foreground">Объём: {series.volumeSource}. Точек: {series.points.length}, длительность записи {f(series.points[series.points.length - 1]?.t ?? 0, 0)} мин.</div>}
          </div>
        )}
      </Card>

      {analysis && <AnalysisView a={analysis} {...props} offsetManual={offsetManual} setOffsetManual={setOffsetManual} fileName={fileName} />}
    </div>
  );
}

function UnitSel({ label, value, opts, onChange }: { label: string; value: string; opts: string[]; onChange: (v: string) => void }) {
  return (
    <label className="space-y-1">
      <div className="text-muted-foreground">{label}, ед.</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-full rounded border border-border bg-background px-1">
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function AnalysisView({ a, offsetManual, setOffsetManual, fileName, ...props }: Props & { a: SkcAnalysis; offsetManual: string; setOffsetManual: (s: string) => void; fileName: string }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [applyCav, setApplyCav] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const data = useMemo(() => {
    const step = Math.max(1, Math.ceil(a.aligned.length / 1200));
    return a.aligned.filter((_, i) => i % step === 0).map((p) => ({
      v: Math.round(p.v * 100) / 100, fact: p.pFact, model: p.pModel, plan: p.pPlan, q: p.qFact, qPlan: p.qPlan,
      rho: Number.isFinite(p.rhoFact) ? p.rhoFact : null, rhoPlan: p.rhoPlan,
    }));
  }, [a]);
  const kOld = props.wellData.frictionCalibration ?? 1;
  const kNew = kOld * a.calibration.kFriction;
  const cavNew = useMemo(() => {
    const t = a.tocEstimate;
    if (!t || !t.cavernFactor || !Number.isFinite(t.cavernFactor)) return null;
    const H = (Math.PI / 4) * (props.wellData.holeDiameter / 1000) ** 2, C = (Math.PI / 4) * (props.wellData.casingOD / 1000) ** 2;
    const c = (t.cavernFactor * (H * props.wellData.cavernCoeff - C) + C) / H;
    return Math.min(2, Math.max(1, c));
  }, [a, props.wellData]);
  const evs = [...a.events].sort((x, y) => ["critical", "warning", "info", "ok"].indexOf(x.level) - ["critical", "warning", "info", "ok"].indexOf(y.level));
  const w = width || 900;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Tile label="Множитель трения (факт / расчёт)" value={f(a.calibration.kFriction)} sub={`СКО ${f(a.calibration.rmsBefore)} → ${f(a.calibration.rmsAfter)} МПа`} />
        <Tile label="Совпадение с моделью по всей операции" value={`СКО ${f(a.rmsResidualMPa)} МПа`} sub={`совмещение: ${a.offsetSource}, ${f(a.offsetM3)} м³`} />
        <Tile label="Посадка пробки «СТОП»" value={a.plug.detected ? `${f(a.plug.deviationPct, 1)}%` : "не найдена"} sub={a.plug.detected ? `${f(a.plug.displacementFactM3)} из ${f(a.plug.displacementPlanM3)} м³ продавки` : "нет скачка давления в конце"} />
        <Tile label="Верх цемента (оценка)" value={a.tocEstimate ? `${f(a.tocEstimate.estimatedTopMD, 0)} м` : "—"} sub={a.tocEstimate ? `проект ${f(a.tocEstimate.plannedTopMD, 0)} м; по «подъёмному» давлению` : "недостаточно данных в конце продавки"} />
      </div>

      <Card className="p-4 space-y-2">
        <h3 className="font-semibold text-sm">События</h3>
        {evs.map((e, i) => (
          <div key={i} className={`rounded-md border px-3 py-2 text-xs ${LVL[e.level].cls}`}>
            <div className="font-semibold">{LVL[e.level].icon} {e.title}</div>
            <div className="mt-0.5">{e.detail}</div>
          </div>
        ))}
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-semibold text-sm">Давление на устье: факт, модель с калибровкой, исходный расчёт</h3>
          <label className="text-xs flex items-center gap-2">Смещение объёма, м³
            <input value={offsetManual} placeholder={`авто ${f(a.offsetM3)}`} onChange={(e) => setOffsetManual(e.target.value)} className="h-7 w-24 rounded border border-border bg-background px-2" />
          </label>
        </div>
        <div ref={ref} className="h-72">
          <LineChart width={w} height={288} data={data} margin={{ top: 4, right: 16, bottom: 16, left: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
            <XAxis dataKey="v" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 10 }} label={{ value: "Накопленный объём, м³", position: "insideBottom", offset: -8, fontSize: 11 }} />
            <YAxis tick={{ fontSize: 10 }} label={{ value: "МПа", angle: -90, position: "insideLeft", fontSize: 11 }} />
            <Tooltip formatter={(v: number) => (typeof v === "number" ? v.toFixed(2) : v)} labelFormatter={(v) => `${v} м³`} contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
            <Legend verticalAlign="top" height={26} wrapperStyle={{ fontSize: 11 }} />
            {a.events.filter((e) => e.fromV !== undefined && e.level === "critical").map((e, i) => (
              <ReferenceArea key={i} x1={e.fromV} x2={e.toV} fill="hsl(var(--destructive))" fillOpacity={0.08} />
            ))}
            <Line dataKey="fact" name="Факт СКЦ" stroke="hsl(var(--foreground))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="model" name={`Модель (трение ×${f(a.calibration.kFriction)}, факт. расход)`} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="plan" name="Исходный расчёт" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium">Расход, л/с</div>
            <LineChart width={Math.max(300, (w - 16) / 2)} height={170} data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
              <XAxis dataKey="v" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => (typeof v === "number" ? v.toFixed(1) : v)} contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
              <Line dataKey="q" name="Факт" stroke="hsl(var(--foreground))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line dataKey="qPlan" name="План" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            </LineChart>
          </div>
          <div>
            <div className="text-xs font-medium">Плотность, г/см³</div>
            <LineChart width={Math.max(300, (w - 16) / 2)} height={170} data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
              <XAxis dataKey="v" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip formatter={(v: number) => (typeof v === "number" ? v.toFixed(3) : v)} contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
              <Line dataKey="rho" name="Факт" stroke="hsl(var(--foreground))" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
              <Line dataKey="rhoPlan" name="План" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            </LineChart>
          </div>
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <h3 className="font-semibold text-sm">Тампонажные растворы</h3>
          <table className="w-full text-xs">
            <thead className="bg-muted/50"><tr><th className="p-1 text-left">Раствор</th><th className="p-1 text-right">ρ проект / факт</th><th className="p-1 text-right">Вне допуска, м³</th><th className="p-1 text-right">Объём план / факт</th></tr></thead>
            <tbody>{a.cement.map((c) => (
              <tr key={c.name} className="border-t border-border/40"><td className="p-1">{c.name}</td><td className="p-1 text-right">{f(c.planDensity)} / {f(c.meanDensity, 3)}</td><td className="p-1 text-right">{f(c.outOfSpecM3, 1)}</td><td className="p-1 text-right">{f(c.volumePlanM3, 1)} / {f(c.volumeFactM3, 1)}</td></tr>
            ))}</tbody>
          </table>
          <Button size="sm" variant="outline" onClick={() => exportSkcReportDocx(a, { well: `Колонна Ø${props.wellData.casingOD} мм, ${props.wellData.casingDepthMD} м`, fileName })}><FileDown className="h-4 w-4 mr-1" />Отчёт по факту (Word)</Button>
        </Card>
        <Card className="p-4 space-y-2">
          <h3 className="font-semibold text-sm">Калибровка для следующих программ</h3>
          <div className="text-xs space-y-1">
            <div>Множитель трения в программе: {f(kOld)} → <b>{f(kNew)}</b>{!a.calibration.reliable && <span className="text-amber-700"> (оценка ненадёжна: мало точек или вышла за пределы 0,3–3)</span>}</div>
            {cavNew !== null && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={applyCav} onChange={(e) => setApplyCav(e.target.checked)} />
                Коэффициент кавернозности: {f(props.wellData.cavernCoeff)} → <b>{f(cavNew)}</b> (оценка по «подъёмному» давлению; надёжнее — по кавернометрии)
              </label>
            )}
          </div>
          <Button size="sm" onClick={() => {
            props.onApplyCalibration({ frictionCalibration: Math.round(kNew * 100) / 100, ...(applyCav && cavNew !== null ? { cavernCoeff: Math.round(cavNew * 100) / 100 } : {}) });
            setApplied(`Записано: трение ×${f(kNew)}${applyCav && cavNew !== null ? `, кавернозность ${f(cavNew)}` : ""}. Расчёт программы обновлён — используйте для следующей скважины этого куста/месторождения.`);
          }}>Записать калибровку в программу</Button>
          {applied && <div className="text-xs text-green-700">{applied}</div>}
          <div className="text-[11px] text-muted-foreground">Множитель умножает все потери на трение в расчёте закачки. Сохраните программу с калибровкой в кабинете — она станет основой для следующих скважин.</div>
        </Card>
      </div>
    </>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border/60 p-2 bg-card">
      <div className="text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
