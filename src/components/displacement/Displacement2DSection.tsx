import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Box, Pause, Play, RotateCcw, Waves, Scissors } from "lucide-react";
import { useMeasuredWidth } from "@/hooks/use-measured-width";
import type { D2Result, D2Stage } from "@/lib/displacement-2d";
import type { D2Meta } from "@/lib/displacement-2d-input";
import type { WellData, SlurryInput, BufferFluid, DrillingFluid, DisplacementFluid, VolumeResults, TrajectoryPoint } from "@/lib/cementing-calculations";
import { getEffectiveTrajectory } from "@/lib/cementing-calculations";
import D2Map from "./D2Map";
import D2Annulus3D from "./D2Annulus3D";

const f = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const tipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 };
const axisTick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

interface Run { result: D2Result; meta: D2Meta; stages: D2Stage[] }

function ProfileChart({ res, designTop }: { res: D2Result; designTop: number }) {
  const [ref, w] = useMeasuredWidth<HTMLDivElement>();
  const data = res.rows.map((r) => ({ md: Math.round(r.md), cem: +(r.cement * 100).toFixed(1), mud: +(r.mud * 100).toFixed(1), sp: +(r.spacer * 100).toFixed(1), so: +(r.standoff * 100).toFixed(0) }));
  return (
    <div ref={ref} className="h-[520px]">
      <LineChart layout="vertical" width={w || 360} height={520} data={data} margin={{ top: 8, right: 12, bottom: 18, left: 8 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
        <XAxis type="number" domain={[0, 100]} tick={axisTick} label={{ value: "% сечения / отступ, %", position: "insideBottom", offset: -8, fontSize: 11 }} />
        <YAxis type="number" dataKey="md" domain={["dataMin", "dataMax"]} tick={axisTick} width={48} label={{ value: "Глубина, м", angle: -90, position: "insideLeft", fontSize: 11 }} />
        <Tooltip contentStyle={tipStyle} labelFormatter={(m) => `${m} м`} formatter={(v: number, n) => [`${v}%`, n]} />
        <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine y={Math.round(designTop)} stroke="hsl(0 72% 51%)" strokeDasharray="5 3" label={{ value: "проектный верх", fontSize: 10, position: "insideTopRight", fill: "hsl(0 72% 51%)" }} />
        <Line dataKey="cem" name="Цемент" stroke="#64748b" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="mud" name="Буровой раствор" stroke="#3f7d55" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="sp" name="Буфер" stroke="#e0a63a" dot={false} isAnimationActive={false} />
        <Line dataKey="so" name="Отступ колонны" stroke="hsl(var(--primary))" strokeDasharray="4 3" dot={false} isAnimationActive={false} />
      </LineChart>
    </div>
  );
}

export default function Displacement2DSection(p: {
  wellData: WellData; slurries: SlurryInput[]; buffers: BufferFluid[]; drillingFluid: DrillingFluid;
  displacementFluids: DisplacementFluid[]; volumes: VolumeResults;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [snap, setSnap] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cut, setCut] = useState(true);
  const [fine, setFine] = useState(false);
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const trajectory: TrajectoryPoint[] = useMemo(() => getEffectiveTrajectory(p.wellData), [p.wellData]);

  // Входные данные изменились — результат устарел
  const inputKey = useMemo(() => JSON.stringify([p.wellData.casingDepthMD, p.wellData.standoffProfile?.length, p.slurries.map((s) => [s.density, s.topDepthMD, s.rheology]), p.buffers.map((b) => [b.volume, b.density, b.rheology]), p.drillingFluid.density, p.drillingFluid.rheology]), [p]);
  const [runKey, setRunKey] = useState<string | null>(null);
  const stale = run && runKey !== inputKey;

  useEffect(() => () => worker.current?.terminate(), []);
  const start = () => {
    worker.current?.terminate();
    const w = new Worker(new URL("../../workers/displacement2d.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    const id = ++reqId.current;
    setBusy(true); setErr(null); setProgress(0); setPlaying(false);
    w.onmessage = (e) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.progress !== undefined) { setProgress(m.progress); return; }
      setBusy(false);
      if (m.error) { setErr(m.error); return; }
      setRun({ result: m.result, meta: m.meta, stages: m.stages });
      setRunKey(inputKey);
      setSnap(m.result.snapshots.length - 1);
      w.terminate(); worker.current = null;
    };
    w.onerror = (e) => { setBusy(false); setErr(e.message || "Ошибка расчёта"); };
    w.postMessage({ id, fine, data: { wellData: p.wellData, slurries: p.slurries, buffers: p.buffers, drillingFluid: p.drillingFluid, displacementFluids: p.displacementFluids, volumes: p.volumes } });
  };

  useEffect(() => {
    if (!playing || !run) return;
    const n = run.result.snapshots.length;
    const h = window.setInterval(() => setSnap((s) => { if (s >= n - 1) { setPlaying(false); return s; } return s + 1; }), 90);
    return () => window.clearInterval(h);
  }, [playing, run]);

  const res = run?.result;
  const meta = run?.meta;
  const sn = res ? res.snapshots[Math.min(snap, res.snapshots.length - 1)] : null;
  const stageName = res && sn && run ? res.fluids[run.stages[sn.stage]?.fluid ?? 0]?.name : "";
  const fillTone = res ? (res.summary.cementFillPct >= 95 ? "text-emerald-600" : res.summary.cementFillPct >= 85 ? "text-amber-600" : "text-destructive") : "";

  return (
    <Card data-testid="d2-section">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Waves className="w-4 h-4" /> Вытеснение в затрубье: 2D-модель и 3D-вид
          <Badge variant="outline" className="text-[10px]">эксцентриситет · реология · плотности · наклон</Badge>
          <span className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] font-normal text-muted-foreground"><input type="checkbox" checked={fine} onChange={(e) => setFine(e.target.checked)} />подробная сетка</label>
            <Button size="sm" className="h-8 text-xs" onClick={start} disabled={busy} data-testid="d2-run">{busy ? "Считаю…" : run ? "Пересчитать" : "Рассчитать вытеснение"}</Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 text-xs">
        {!run && !busy && (
          <p className="text-muted-foreground">
            Затрубье разворачивается в карту «глубина × окружность»; в каждой точке учитывается ширина зазора (колонна смещена к нижней стенке по расчёту центрирования),
            реология и плотности жидкостей, наклон ствола. Результат — где цемент вытесняет раствор полностью, а где на узкой стороне остаётся канал. Расчёт идёт в фоне 5–30 с.
          </p>
        )}
        {busy && <div className="space-y-1"><Progress value={progress * 100} className="h-2" /><p className="text-muted-foreground">Расчёт вытеснения… {f(progress * 100)}%</p></div>}
        {err && <p className="text-destructive">Ошибка: {err}</p>}
        {stale && <p className="text-amber-700 dark:text-amber-500">Исходные данные изменились — нажмите «Пересчитать».</p>}
        {res && meta && sn && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[
                ["Заполнение цементом", `${f(res.summary.cementFillPct, 1)}%`, fillTone, "в интервале цементирования"],
                ["Невытесненный раствор", `${f(res.summary.mudLeftPct, 1)}%`, res.summary.mudLeftPct > 5 ? "text-destructive" : "", "доля сечения"],
                ["Канал на узкой стороне", `${f(res.summary.channelM)} м`, res.summary.channelM > 0 ? "text-amber-600" : "", "цемента < 50% внизу ствола"],
                ["Раствор не сдвигается", `${f(res.summary.staticM)} м`, res.summary.staticM > 0 ? "text-destructive" : "", "ДНС не преодолено"],
                ["Расчёт", `${f(res.summary.computeMs / 1000, 1)} с`, "", `${res.nZ}×${res.nTheta * 2} ячеек, ${res.summary.steps} шагов`],
              ].map(([n, v, c, s]) => (
                <div key={n} className="rounded-md border border-border/60 p-2"><p className="text-[10px] text-muted-foreground">{n}</p><p className={`text-base font-semibold ${c}`}>{v}</p><p className="text-[10px] text-muted-foreground">{s}</p></div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={() => { if (!playing && snap >= res.snapshots.length - 1) setSnap(0); setPlaying((x) => !x); }}>
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label="В начало" onClick={() => { setPlaying(false); setSnap(0); }}><RotateCcw className="w-3.5 h-3.5" /></Button>
              <input type="range" min={0} max={res.snapshots.length - 1} value={snap} onChange={(e) => { setPlaying(false); setSnap(+e.target.value); }} className="flex-1 min-w-[160px] accent-[hsl(var(--primary))]" aria-label="Время" />
              <span className="tabular-nums text-muted-foreground w-44 text-right">t = {mmss(sn.t)} от выхода в затрубье · {stageName}</span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {res.fluids.map((fl, i) => <span key={i} className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: meta.colors[i] }} />{fl.name} <span className="text-muted-foreground">{f(fl.density)} кг/м³, ДНС {f(fl.yp, 1)} Па</span></span>)}
            </div>
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)_minmax(0,1fr)]">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-semibold flex items-center gap-1"><Box className="w-3.5 h-3.5" />3D: затрубье по траектории (радиус увеличен)</p>
                  <Button size="sm" variant={cut ? "default" : "outline"} className="h-6 text-[10px] px-2" onClick={() => setCut((x) => !x)}><Scissors className="w-3 h-3 mr-1" />разрез</Button>
                </div>
                <D2Annulus3D res={res} colors={meta.colors} snap={snap} trajectory={trajectory} cut={cut} />
                <p className="mt-1 text-[10px] text-muted-foreground">Вращение — мышью, масштаб — колесом. Колонна прижата к нижней стенке; вырез показывает её и обе стороны затрубья.</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold mb-1">Развёртка затрубья</p>
                <D2Map res={res} colors={meta.colors} snap={snap} designTopMD={meta.designCementTopMD} />
              </div>
              <div>
                <p className="text-[11px] font-semibold mb-1">Итог по глубине (после продавки)</p>
                <ProfileChart res={res} designTop={meta.designCementTopMD} />
              </div>
            </div>
            {res.summary.worst.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold mb-1">Интервалы с неполным вытеснением (цемент по окружности &lt; 75%)</p>
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/50"><tr><th className="p-1 text-left">Интервал, м</th><th className="p-1 text-right">Длина, м</th><th className="p-1 text-right">Мин. охват цементом</th></tr></thead>
                  <tbody>{res.summary.worst.map((w) => <tr key={w.topMD} className="border-t border-border/40"><td className="p-1">{f(w.topMD)}–{f(w.bottomMD)}</td><td className="p-1 text-right">{f(w.bottomMD - w.topMD)}</td><td className="p-1 text-right">{f(w.minCoverage * 100)}%</td></tr>)}</tbody>
                </table>
              </div>
            )}
            {[...meta.notes, ...res.warnings].map((n) => <p key={n} className="text-amber-700 dark:text-amber-500">⚠ {n}</p>)}
            <p className="text-[10px] text-muted-foreground">
              Модель: течение вязкопластичных жидкостей в эксцентричном зазоре, осреднённое по ширине зазора (подход Bittleston–Frigaard, как в промышленных симуляторах вытеснения);
              ламинарный режим, без вращения и расхаживания колонны. Баланс объёмов {f(Math.abs(res.summary.massBalanceErrPct), 2)}%. Результат — прогноз для сравнения вариантов
              (центрирование, буфер, расход, реология), а не гарантия качества крепи.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
