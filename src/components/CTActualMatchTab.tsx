import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, LineChart, Line } from "recharts";
import { ClipboardPaste, Upload, Sparkles, Trash2, Check, Plus } from "lucide-react";
import type { CTSection, CTStringData, FluidData, ToolsData, WellGeometry, CTSurfaceOptions } from "@/lib/coiled-tubing-calculations";
import { demoActual, matchActual, parseActualTable, WEIGHT_LABEL, type ActualDir, type ActualPoint, type WeightUnit } from "@/lib/ct-actual-match";

interface Props {
  ct: CTStringData; well: WellGeometry; fluid: FluidData; tools: ToolsData; sections?: CTSection[]; opts: CTSurfaceOptions;
  friction: number;
  data: ActualPoint[];
  onData: (d: ActualPoint[]) => void;
  onApplyFriction: (mu: number) => void;
  onApplyHydFactor: (k: number) => void;
}

const f = (v: number | null | undefined, d = 1) => (v !== null && v !== undefined && Number.isFinite(v) ? v.toFixed(d) : "—");
const DIR_LABEL: Record<ActualDir, string> = { rih: "спуск", pooh: "подъём", static: "стоянка" };
const uid = () => Math.random().toString(36).slice(2, 9);

export default function CTActualMatchTab({ ct, well, fluid, tools, sections, opts, friction, data, onData, onApplyFriction, onApplyHydFactor }: Props) {
  const [unit, setUnit] = useState<WeightUnit>("kN");
  const [paste, setPaste] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const ctx = useMemo(() => ({ ct, well, fluid, tools, sections, opts }), [ct, well, fluid, tools, sections, opts]);
  const res = useMemo(() => (data.some((p) => Number.isFinite(p.wiKN)) || data.some((p) => Number.isFinite(p.pumpMPa)) ? matchActual(ctx, data, friction) : null), [ctx, data, friction]);

  const loadRows = (rows: unknown[][]) => {
    const pts = parseActualTable(rows, unit);
    if (!pts.length) { toast.error("Не найдено строк с глубиной"); return; }
    onData(pts);
    toast.success(`Загружено замеров: ${pts.length}`);
  };
  const onFile = (file: File) => {
    const rd = new FileReader();
    rd.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "array" });
        loadRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true }) as unknown[][]);
      } catch { toast.error("Не удалось прочитать файл"); }
    };
    rd.readAsArrayBuffer(file);
  };
  const onPaste = () => {
    if (!paste) return;
    const rows = paste.trim().split(/\r?\n/).map((l) => l.split(/\t|;|,(?=\s*[^\d])/).map((x) => x.trim()));
    loadRows(rows);
    setPaste(null);
  };
  const setPt = (id: string, patch: Partial<ActualPoint>) => onData(data.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const measured = res?.points ?? [];
  const dirColor: Record<ActualDir, string> = { rih: "#2563eb", pooh: "#dc2626", static: "#64748b" };
  const rows = showAll ? data : data.slice(0, 25);

  return (
    <div className="space-y-4" data-testid="ct-actual">
      <Card>
        <CardHeader className="py-3 px-4"><CardTitle className="text-sm">📈 Сравнение с фактом и калибровка модели</CardTitle></CardHeader>
        <CardContent className="px-4 pb-4 space-y-3 text-xs">
          <p className="text-muted-foreground">
            Введите фактические замеры с работы: глубина КНБК, показания индикатора веса (при спуске, подъёме, на стоянке), давление насоса и расход, давление на устье.
            Программа подберёт коэффициент трения, при котором расчёт лучше всего совпадает с фактом (отдельно для спуска и подъёма), поправку потерь давления на трение
            и покажет интервалы затяжек и посадок — отклонения от откалиброванной модели.
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Единицы веса:</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value as WeightUnit)} className="h-7 rounded border border-border bg-background px-1">{(Object.keys(WEIGHT_LABEL) as WeightUnit[]).map((k) => <option key={k} value={k}>{WEIGHT_LABEL[k]}</option>)}</select>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setPaste(paste === null ? "" : null)}><ClipboardPaste className="w-3.5 h-3.5 mr-1" />Вставить таблицу</Button>
            <label className="inline-flex h-7 items-center rounded-md border border-input px-2 text-[11px] cursor-pointer hover:bg-accent"><Upload className="w-3.5 h-3.5 mr-1" />Файл Excel/CSV
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const fl = e.target.files?.[0]; if (fl) onFile(fl); e.target.value = ""; }} /></label>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => onData([...data, { id: uid(), md: Math.round(well.md / 2), dir: "rih" }])}><Plus className="w-3.5 h-3.5 mr-1" />Строка</Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px]" data-testid="ct-actual-demo" onClick={() => { onData(demoActual(ctx, 0.28)); toast.info("Демо: «факт» сгенерирован моделью при μ = 0.28, потерях +18% и затяжке в середине интервала"); }}><Sparkles className="w-3.5 h-3.5 mr-1" />Демо-данные</Button>
            {data.length > 0 && <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground" onClick={() => onData([])}><Trash2 className="w-3.5 h-3.5 mr-1" />Очистить</Button>}
          </div>
          {paste !== null && (
            <div className="space-y-1">
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder={"Скопируйте столбцы из Excel или станции контроля и вставьте сюда.\nС заголовками: Глубина | Вес | Давление насоса | Расход | Давление на устье | Направление\nБез заголовков — в этом порядке. Направление можно не указывать: определяется по изменению глубины."}
                className="w-full rounded border border-border bg-background p-2 font-mono text-[11px]" />
              <Button size="sm" className="h-7 text-[11px]" onClick={onPaste}>Загрузить</Button>
            </div>
          )}
          {data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[11px]">
                <thead className="bg-muted/50"><tr><th className="p-1 text-right">Глубина, м</th><th className="p-1 text-left">Режим</th><th className="p-1 text-right">Вес, кН</th><th className="p-1 text-right">P насоса, МПа</th><th className="p-1 text-right">Q, л/с</th><th className="p-1 text-right">P устья, МПа</th><th className="w-6" /></tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="border-t border-border/40">
                      {(["md"] as const).map((k) => <td key={k} className="p-1 text-right"><Cell v={p[k]} on={(v) => setPt(p.id, { [k]: v ?? 0 })} /></td>)}
                      <td className="p-1"><select value={p.dir} onChange={(e) => setPt(p.id, { dir: e.target.value as ActualDir })} className="h-6 rounded border border-border bg-background px-1">{(Object.keys(DIR_LABEL) as ActualDir[]).map((k) => <option key={k} value={k}>{DIR_LABEL[k]}</option>)}</select></td>
                      {(["wiKN", "pumpMPa", "rateLps", "whpMPa"] as const).map((k) => <td key={k} className="p-1 text-right"><Cell v={p[k]} on={(v) => setPt(p.id, { [k]: v })} /></td>)}
                      <td className="p-1"><button aria-label="Удалить" onClick={() => onData(data.filter((x) => x.id !== p.id))} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.length > 25 && <button className="text-primary mt-1" onClick={() => setShowAll((x) => !x)}>{showAll ? "Свернуть" : `Показать все ${data.length} замеров`}</button>}
            </div>
          )}
        </CardContent>
      </Card>

      {res && (
        <Card>
          <CardHeader className="py-3 px-4"><CardTitle className="text-sm flex items-center gap-2 flex-wrap">🎯 Результат калибровки
            <Badge variant={res.rmsBest < 3 ? "default" : res.rmsBest < 6 ? "secondary" : "destructive"} className="text-[10px]">отклонение ±{f(res.rmsBest)} кН</Badge></CardTitle></CardHeader>
          <CardContent className="px-4 pb-4 space-y-3 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ["Трение по факту", f(res.muBest, 3), `сейчас в расчёте ${friction}`],
                ["μ спуск / подъём", `${f(res.muRIH, 2)} / ${f(res.muPOOH, 2)}`, "раздельный подбор"],
                ["Отклонение веса", `${f(res.rmsCurrent)} → ${f(res.rmsBest)} кН`, "среднеквадратичное, до → после"],
                ["Потери давления", res.hyd ? `×${f(res.hyd.factor, 2)}` : "—", res.hyd ? `${res.hyd.n} замеров · ±${f(res.hyd.rmsBefore)} → ±${f(res.hyd.rmsAfter)} МПа` : "нет замеров давления с расходом"],
              ].map(([n, v, s]) => (
                <div key={n} className="rounded-md border border-border/60 p-2"><p className="text-[10px] text-muted-foreground">{n}</p><p className="text-base font-semibold">{v}</p><p className="text-[10px] text-muted-foreground">{s}</p></div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="h-8" data-testid="ct-actual-apply-mu" onClick={() => { onApplyFriction(res.muBest); toast.success(`Коэффициент трения ${res.muBest} применён — пересчитайте`); }} disabled={Math.abs(res.muBest - friction) < 0.001}><Check className="w-4 h-4 mr-1" />Применить μ = {f(res.muBest, 3)}</Button>
              {res.hyd && <Button size="sm" variant="outline" className="h-8" onClick={() => { onApplyHydFactor(res.hyd!.factor); toast.success(`Поправка потерь ×${res.hyd!.factor} применена — пересчитайте`); }}><Check className="w-4 h-4 mr-1" />Применить поправку потерь ×{f(res.hyd.factor, 2)}</Button>}
            </div>
            {res.anomalies.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 space-y-0.5">
                <p className="font-semibold">Отклонения от модели</p>
                {res.anomalies.map((a, i) => <p key={i}>• {a.kind === "overpull" ? "Затяжка при подъёме" : "Посадка при спуске"} {a.from === a.to ? `на ${Math.round(a.from)} м` : `в интервале ${Math.round(a.from)}–${Math.round(a.to)} м`}: до {f(a.maxKN)} кН сверх расчёта. {a.kind === "overpull" ? "Возможны шлам/песок над КНБК, сужение, налипание — промывка, расхаживание, снижение скорости." : "Возможны препятствие, уступ, отложения — промывка, снижение скорости, проверка КНБК."}</p>)}
              </div>
            )}
            {res.notes.map((n) => <p key={n} className="text-amber-700 dark:text-amber-500">⚠ {n}</p>)}

            <div className="bg-card rounded-lg">
              <p className="text-xs font-semibold text-center mb-1">📊 Индикатор веса: факт и расчёт</p>
              <p className="text-[10px] text-muted-foreground text-center mb-1">Точки — факт; сплошные — расчёт с подобранным трением, пунктир — с текущим. Крупные точки — затяжки и посадки.</p>
              <div className="overflow-x-auto -mx-2 px-2"><div className="min-w-[560px]">
                <ResponsiveContainer width="100%" height={420}>
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 22, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" dataKey="x" tick={{ fontSize: 10 }} domain={["auto", "auto"]} label={{ value: "Индикатор веса, кН", position: "insideBottom", offset: -10, style: { fontSize: 10 } }} />
                    <YAxis type="number" dataKey="y" reversed domain={[0, "dataMax"]} tick={{ fontSize: 10 }} label={{ value: "Глубина КНБК, м", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                    <ZAxis dataKey="z" range={[18, 90]} />
                    <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number, n: string) => [Number(v).toFixed(1), n === "x" ? "кН" : n === "y" ? "м" : n]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} verticalAlign="top" />
                    <Scatter name={`Спуск, μ ${f(res.muBest, 2)}`} data={res.lines.filter((l) => l.rihBest !== null).map((l) => ({ x: l.rihBest, y: l.depth, z: 1 }))} fill="#2563eb" line={{ stroke: "#2563eb", strokeWidth: 2 }} shape={() => null} legendType="line" isAnimationActive={false} />
                    <Scatter name={`Подъём, μ ${f(res.muBest, 2)}`} data={res.lines.map((l) => ({ x: l.poohBest, y: l.depth, z: 1 }))} fill="#dc2626" line={{ stroke: "#dc2626", strokeWidth: 2 }} shape={() => null} legendType="line" isAnimationActive={false} />
                    <Scatter name={`μ ${friction} (текущий)`} data={res.lines.filter((l) => l.rihCur !== null).map((l) => ({ x: l.rihCur, y: l.depth, z: 1 }))} fill="#94a3b8" line={{ stroke: "#94a3b8", strokeWidth: 1.2, strokeDasharray: "5 4" }} shape={() => null} legendType="plainline" isAnimationActive={false} />
                    <Scatter name="" data={res.lines.map((l) => ({ x: l.poohCur, y: l.depth, z: 1 }))} fill="#94a3b8" line={{ stroke: "#94a3b8", strokeWidth: 1.2, strokeDasharray: "5 4" }} shape={() => null} legendType="none" isAnimationActive={false} />
                    {(["rih", "pooh", "static"] as ActualDir[]).map((d) => {
                      const ps = measured.filter((p) => p.dir === d);
                      return ps.length ? <Scatter key={d} name={`Факт: ${DIR_LABEL[d]}`} data={ps.map((p) => ({ x: p.measured, y: p.md, z: p.flag ? 6 : 1 }))} fill={dirColor[d]} fillOpacity={0.75} stroke={dirColor[d]} isAnimationActive={false} /> : null;
                    })}
                    <ReferenceLine x={0} stroke="hsl(var(--foreground))" strokeWidth={0.6} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div></div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-center mb-1">Отклонение факта от расчёта в зависимости от μ</p>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={res.curve} margin={{ top: 10, right: 16, bottom: 18, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="mu" type="number" domain={[0.05, 0.5]} tick={{ fontSize: 10 }} label={{ value: "μ", position: "insideBottom", offset: -8, style: { fontSize: 10 } }} />
                    <YAxis tick={{ fontSize: 10 }} label={{ value: "кН", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                    <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => `${Number(v).toFixed(2)} кН`} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line dataKey="rms" name="все замеры" stroke="#16a34a" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line dataKey="rmsRIH" name="спуск" stroke="#2563eb" strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
                    <Line dataKey="rmsPOOH" name="подъём" stroke="#dc2626" strokeWidth={1.2} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
                    <ReferenceLine x={res.muBest} stroke="#16a34a" label={{ value: `μ ${f(res.muBest, 3)}`, position: "top", style: { fontSize: 10, fill: "#16a34a" } }} />
                    <ReferenceLine x={friction} stroke="#94a3b8" strokeDasharray="4 3" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {res.hyd && (
                <div>
                  <p className="text-xs font-semibold text-center mb-1">Давление насоса: факт и расчёт</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <ScatterChart margin={{ top: 10, right: 16, bottom: 18, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" dataKey="x" tick={{ fontSize: 10 }} label={{ value: "Глубина, м", position: "insideBottom", offset: -8, style: { fontSize: 10 } }} />
                      <YAxis type="number" dataKey="y" tick={{ fontSize: 10 }} domain={["auto", "auto"]} label={{ value: "МПа", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                      <ZAxis range={[24, 24]} />
                      <Tooltip contentStyle={{ fontSize: 11 }} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Scatter name="Факт" data={res.hyd.points.map((p) => ({ x: p.md, y: p.measured }))} fill="#0f172a" isAnimationActive={false} />
                      <Scatter name="Расчёт до калибровки" data={[...res.hyd.points].sort((a, b) => a.md - b.md).map((p) => ({ x: p.md, y: p.modelBefore }))} fill="#94a3b8" line={{ stroke: "#94a3b8", strokeDasharray: "5 4" }} shape={() => null} legendType="plainline" isAnimationActive={false} />
                      <Scatter name={`После поправки ×${f(res.hyd.factor, 2)}`} data={[...res.hyd.points].sort((a, b) => a.md - b.md).map((p) => ({ x: p.md, y: p.modelAfter }))} fill="#7c3aed" line={{ stroke: "#7c3aed", strokeWidth: 2 }} shape={() => null} legendType="line" isAnimationActive={false} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Показания приводятся к модели с учётом фактического давления на устье в момент замера. Затяжка/посадка — отклонение более max(5 кН; 15%) от откалиброванного расчёта.
              Калибровку обновляйте по каждой работе: подобранное трение для данного ствола и жидкости — лучший прогноз для следующего рейса.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Cell({ v, on }: { v: number | undefined; on: (v: number | undefined) => void }) {
  return (
    <input type="number" step="any" inputMode="decimal" key={String(v)} defaultValue={v ?? ""}
      onBlur={(e) => { const s = e.target.value.trim().replace(",", "."); const x = parseFloat(s); on(s === "" ? undefined : Number.isFinite(x) ? x : undefined); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="h-6 w-20 rounded border border-border bg-background px-1 text-right" />
  );
}
