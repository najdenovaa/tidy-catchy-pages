import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Box, Pause, Play, RotateCcw, Scissors, Waypoints } from "lucide-react";
import type { D2Result } from "@/lib/displacement-2d";
import type { RirChannelMeta } from "@/lib/rir-channel-2d";
import type { RirInputs, RirResult } from "@/lib/rir-calculations";
import type { CompositionDesign } from "@/lib/rir-compositions";
import type { SqueezeSimResult } from "@/lib/rir-squeeze-sim";
import D2Map from "@/components/displacement/D2Map";
import D2Annulus3D from "@/components/displacement/D2Annulus3D";

const f = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export default function RirChannelCard({ inp, res, sim, design }: { inp: RirInputs; res: RirResult; sim: SqueezeSimResult; design: CompositionDesign | null }) {
  const [out, setOut] = useState<{ result: D2Result; meta: RirChannelMeta } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [snap, setSnap] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cut, setCut] = useState(false);
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);
  const key = useMemo(() => JSON.stringify([inp.leak, inp.casing.odMm, res.composition, res.apertureUm, sim.totalTimeMin, sim.compInChannelM3]), [inp, res, sim]);
  const [runKey, setRunKey] = useState<string | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);

  const start = () => {
    worker.current?.terminate();
    const w = new Worker(new URL("../../workers/rirChannel.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    const id = ++reqId.current;
    setBusy(true); setErr(null); setProgress(0); setPlaying(false);
    w.onmessage = (e) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.progress !== undefined) { setProgress(m.progress); return; }
      setBusy(false);
      if (m.error) { setErr(m.error); return; }
      setOut({ result: m.result, meta: m.meta });
      setRunKey(key);
      setSnap(m.result.snapshots.length - 1);
      w.terminate(); worker.current = null;
    };
    w.onerror = (e) => { setBusy(false); setErr(e.message || "Ошибка расчёта"); };
    w.postMessage({ id, args: [inp, res, sim, design] });
  };

  useEffect(() => {
    if (!playing || !out) return;
    const n = out.result.snapshots.length;
    const h = window.setInterval(() => setSnap((s) => { if (s >= n - 1) { setPlaying(false); return s; } return s + 1; }), 90);
    return () => window.clearInterval(h);
  }, [playing, out]);

  const r = out?.result, meta = out?.meta;
  const sn = r ? r.snapshots[Math.min(snap, r.snapshots.length - 1)] : null;
  // синхронизация с одномерной моделью: давление и этап в этот момент
  const simAt = useMemo(() => {
    if (!sn || !meta) return null;
    const tm = meta.tStartMin + sn.t / 60;
    let best = sim.points[0];
    for (const p of sim.points) { if (p.t <= tm) best = p; else break; }
    return best;
  }, [sn, meta, sim]);
  const trajectory = useMemo(() => (r ? [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: r.zCenters[r.nZ - 1] + 100, tvd: r.zCenters[r.nZ - 1] + 100, zenith: 0, azimuth: 0 }] : []), [r]);
  const markers = useMemo(() => meta ? [{ md: (meta.leak.mdTop + meta.leak.mdBot) / 2, theta: meta.leak.thetaTo - meta.leak.thetaFrom >= 6 ? 0.5 * Math.PI : (meta.leak.thetaFrom + meta.leak.thetaTo) / 2, label: "нарушение" }] : [], [meta]);
  const mapMarks = useMemo(() => meta ? [{ mdTop: meta.leak.mdTop, mdBot: Math.max(meta.leak.mdBot, meta.leak.mdTop + 0.5), label: "нарушение",
    xFrom: meta.leak.thetaTo - meta.leak.thetaFrom >= 6 ? 0 : meta.leak.thetaFrom / (2 * Math.PI), xTo: meta.leak.thetaTo - meta.leak.thetaFrom >= 6 ? 1 : meta.leak.thetaTo / (2 * Math.PI) }] : [], [meta]);
  const stale = out && runKey !== key;

  return (
    <Card data-testid="rir-channel">
      <CardHeader className="py-2.5 px-4">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Waypoints className="w-4 h-4" /> Канал за колонной: куда идёт состав (2D / 3D)
          <Badge variant="outline" className="text-[10px]">расход — из моделирования задавливания</Badge>
          <Button size="sm" className="ml-auto h-7 text-[11px]" onClick={start} disabled={busy} data-testid="rir-channel-run">{busy ? "Считаю…" : out ? "Пересчитать" : "Показать распределение"}</Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 text-xs">
        {!out && !busy && <p className="text-muted-foreground">Канал за колонной разворачивается в карту «глубина × окружность колонны» с неоднородным раскрытием. Расход в канал по времени и момент подхода состава берутся из моделирования выше; двумерный расчёт показывает, где состав растекается, какие участки обходит, как стекает и где останавливается при загустевании. Расчёт 2–5 с.</p>}
        {busy && <div className="space-y-1"><Progress value={progress * 100} className="h-2" /><p className="text-muted-foreground">Расчёт… {f(progress * 100)}%</p></div>}
        {err && <p className="text-destructive">Ошибка: {err}</p>}
        {stale && <p className="text-amber-700 dark:text-amber-500">Данные изменились — нажмите «Пересчитать».</p>}
        {r && meta && sn && (
          <>
            <p className="text-muted-foreground">{meta.channelLabel}. {meta.outletsText}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ["Заполнено составом", `${f(meta.stats.filledPct)}%`, "площади канала в зоне"],
                ["Состава в канале", `${f(meta.stats.compInSheetL)} л`, meta.stats.compOutL > 1 ? `ушло дальше ${f(meta.stats.compOutL)} л` : "весь — в зоне нарушения"],
                ["Не заполнено у нарушения", `${f(meta.stats.nearLeakUnfilledPct)}%`, "±5 м от нарушения"],
                ["Площадь канала", `${f(meta.stats.channelAreaM2, 1)} м²`, `${f(r.zCenters[0])}–${f(r.zCenters[r.nZ - 1])} м`],
              ].map(([n, v, s]) => (
                <div key={n} className="rounded-md border border-border/60 p-2"><p className="text-[10px] text-muted-foreground">{n}</p><p className={`text-base font-semibold ${n === "Не заполнено у нарушения" && meta.stats.nearLeakUnfilledPct > 20 ? "text-destructive" : ""}`}>{v}</p><p className="text-[10px] text-muted-foreground">{s}</p></div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={() => { if (!playing && snap >= r.snapshots.length - 1) setSnap(0); setPlaying((x) => !x); }}>
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label="В начало" onClick={() => { setPlaying(false); setSnap(0); }}><RotateCcw className="w-3.5 h-3.5" /></Button>
              <input type="range" min={0} max={r.snapshots.length - 1} value={snap} onChange={(e) => { setPlaying(false); setSnap(+e.target.value); }} className="flex-1 min-w-[160px] accent-[hsl(var(--primary))]" aria-label="Время" />
              <span className="tabular-nums text-muted-foreground text-right w-72">
                t = {mmss(sn.t)} от начала ухода в канал{simAt ? ` · ${simAt.stage} · P устье ${f(simAt.surfaceMPa, 1)} МПа` : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {r.fluids.map((fl, i) => <span key={i} className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: meta.colors[i] }} />{fl.name}</span>)}
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: "#5b5f66" }} />цементный камень (вне канала)</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-semibold flex items-center gap-1"><Box className="w-3.5 h-3.5" />3D: колонна и канал за ней (масштаб по радиусу увеличен)</p>
                  <Button size="sm" variant={cut ? "default" : "outline"} className="h-6 text-[10px] px-2" onClick={() => setCut((x) => !x)}><Scissors className="w-3 h-3 mr-1" />разрез</Button>
                </div>
                <D2Annulus3D res={r} colors={meta.colors} snap={snap} trajectory={trajectory} cut={cut} lowLabel={null} solidMask={meta.solidMask} markers={markers} radii={[1.9, 1.7]} height={480} />
              </div>
              <div>
                <p className="text-[11px] font-semibold mb-1">Развёртка канала по окружности колонны</p>
                <D2Map res={r} colors={meta.colors} snap={snap} solidMask={meta.solidMask} height={480}
                  axisLabels={[[0, "0°"], [0.25, "90°"], [0.5, "180°"], [0.75, "270°"], [1, "360°"]]} axisTitle="окружность колонны (0° — верх ствола)" marks={mapMarks} />
              </div>
            </div>
            {meta.notes.map((n) => <p key={n} className="text-muted-foreground">ℹ {n}</p>)}
            <p className="text-[10px] text-muted-foreground">
              Модель: течение в тонком канале (осреднение по раскрытию), раскрытие неоднородно (логнормальный разброс вокруг оценки по приёмистости), плотности и вязкости
              жидкостей, рост вязкости / структуры состава по кривой загустевания, закупорка частицами для микроцемента. Расход по времени — из моделирования задавливания,
              поэтому объёмы согласованы. Геометрия канала по типу нарушения — типовая; картина показывает характер заполнения, а не точное положение каналов в скважине.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
