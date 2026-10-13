import { useEffect, useMemo, useRef, useState } from "react";
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceArea, LineChart } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Pause, Play, RotateCcw, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { useMeasuredWidth } from "@/hooks/use-measured-width";
import type { SqueezePoint, SqueezeSimResult } from "@/lib/rir-squeeze-sim";

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const tipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 };
const axisTick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const STAGE_FILL: Record<string, string> = { pump: "hsl(205 80% 50%)", squeeze: "hsl(30 90% 50%)", hold: "hsl(142 70% 40%)" };
const COMP = "#f59e0b", WATER = "#93c5fd", WELL = "#cbd5e1";

function thin(points: SqueezePoint[], n = 400) {
  if (points.length <= n) return points;
  const step = points.length / n;
  const out: SqueezePoint[] = [];
  for (let i = 0; i < n; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/** Давление / допустимое / расход по времени с полосами этапов и курсором воспроизведения. */
function TimeChart({ sim, cursor }: { sim: SqueezeSimResult; cursor: number }) {
  const [ref, w] = useMeasuredWidth<HTMLDivElement>();
  const data = useMemo(() => thin(sim.points).map((p) => ({ t: p.t, ps: +p.surfaceMPa.toFixed(2), allow: +p.allowSurfaceMPa.toFixed(2), q: +p.qLs.toFixed(3), vc: +(p.vCompChannel * 1000).toFixed(1) })), [sim]);
  return (
    <div ref={ref} className="h-72">
      <ComposedChart width={w || 640} height={288} data={data} margin={{ top: 8, right: 8, bottom: 18, left: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
        {sim.stages.filter((s) => s.kind !== "pump" || s.t1 - s.t0 > 0).map((s, i) => (
          <ReferenceArea key={i} yAxisId="p" x1={s.t0} x2={s.t1} fill={STAGE_FILL[s.kind]} fillOpacity={s.kind === "hold" ? 0.1 : 0.06} />
        ))}
        <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} tick={axisTick} tickFormatter={(v) => v.toFixed(0)} label={{ value: "Время от начала закачки, мин", position: "insideBottom", offset: -8, fontSize: 11 }} />
        <YAxis yAxisId="p" tick={axisTick} label={{ value: "P устье, МПа", angle: -90, position: "insideLeft", fontSize: 11 }} />
        <YAxis yAxisId="q" orientation="right" tick={axisTick} label={{ value: "Состав в канале, л", angle: 90, position: "insideRight", fontSize: 11 }} />
        <Tooltip contentStyle={tipStyle} labelFormatter={(t) => `t = ${Number(t).toFixed(1)} мин`} />
        <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 11 }} />
        <Line yAxisId="p" dataKey="allow" name="Допустимое на устье" stroke="hsl(0 72% 51%)" strokeDasharray="5 3" dot={false} isAnimationActive={false} />
        <Line yAxisId="p" dataKey="ps" name="Давление на устье" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line yAxisId="q" dataKey="vc" name="Состав в канале, л" stroke={COMP} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <ReferenceLine yAxisId="p" x={cursor} stroke="hsl(var(--foreground))" strokeWidth={1.5} />
      </ComposedChart>
    </div>
  );
}

/** Полоса расхода насоса под основным графиком (та же ось времени). */
function RateStrip({ sim, cursor }: { sim: SqueezeSimResult; cursor: number }) {
  const [ref, w] = useMeasuredWidth<HTMLDivElement>();
  const data = useMemo(() => thin(sim.points).map((p) => ({ t: p.t, q: +p.qLs.toFixed(3) })), [sim]);
  return (
    <div ref={ref} className="h-24">
      <LineChart width={w || 640} height={96} data={data} margin={{ top: 4, right: 68, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
        <XAxis dataKey="t" type="number" domain={[0, "dataMax"]} hide />
        <YAxis tick={axisTick} width={60} domain={[0, "auto"]} label={{ value: "Q, л/с", angle: -90, position: "insideLeft", fontSize: 10 }} />
        <Tooltip contentStyle={tipStyle} labelFormatter={(t) => `t = ${Number(t).toFixed(1)} мин`} formatter={(v: number) => `${v} л/с`} />
        <Line dataKey="q" name="Расход" type="stepAfter" stroke="hsl(205 80% 50%)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <ReferenceLine x={cursor} stroke="hsl(var(--foreground))" strokeWidth={1.5} />
      </LineChart>
    </div>
  );
}

/** Диаграмма «давление — закачанный объём» на задавливании: рост наклона = канал заполняется. */
function PVChart({ sim }: { sim: SqueezeSimResult }) {
  const [ref, w] = useMeasuredWidth<HTMLDivElement>();
  const data = useMemo(() => {
    return thin(sim.points.filter((p) => p.vCompChannel > 0 && p.qLs > 0), 250).map((p) => ({ v: +(p.vCompChannel * 1000).toFixed(1), ps: +p.surfaceMPa.toFixed(2), mob: +(p.mobility * 100).toFixed(3) }));
  }, [sim]);
  if (!data.length) return <p className="text-xs text-muted-foreground">Состав в канал не попал.</p>;
  return (
    <div ref={ref} className="h-56">
      <LineChart width={w || 320} height={224} data={data} margin={{ top: 8, right: 8, bottom: 18, left: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
        <XAxis dataKey="v" type="number" domain={[0, "dataMax"]} tick={axisTick} label={{ value: "Состава закачано в канал, л", position: "insideBottom", offset: -8, fontSize: 11 }} />
        <YAxis yAxisId="p" tick={axisTick} width={36} />
        <YAxis yAxisId="m" orientation="right" scale="log" domain={["auto", 100]} allowDataOverflow tick={axisTick} width={40} />
        <Tooltip contentStyle={tipStyle} labelFormatter={(v) => `${v} л`} />
        <Legend verticalAlign="top" height={22} wrapperStyle={{ fontSize: 10 }} />
        <Line yAxisId="p" dataKey="ps" name="P устье, МПа" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line yAxisId="m" dataKey="mob" name="Подвижность канала, % от воды" stroke="hsl(280 60% 55%)" dot={false} isAnimationActive={false} />
      </LineChart>
    </div>
  );
}

/** Анимированная схема: НКТ, инструмент, объём под ним, канал негерметичности. */
function SqueezeAnimation({ p, hasTool, spot, toolLabel }: { p: SqueezePoint; hasTool: boolean; spot: boolean; toolLabel: string }) {
  const W = 300, H = 400;
  const cx = 120, cw = 90, tw = 26; // колонна и НКТ
  const yTop = 40, yTool = 300, yBot = 385, yLeak0 = 345, yLeak1 = 362;
  const tubH = yTool - yTop;
  const circ = /Буфер|Состав$|Продавка|Доводка/.test(p.stage);
  const hold = p.stage.startsWith("Выдержка") || p.stage.startsWith("Посадка");
  const squeeze = !circ && !hold && p.qLs > 0;
  const compIn = p.compTop >= 0;
  const belowH = yBot - yTool;
  const compBelowH = belowH * Math.min(1, p.belowComp);
  // состав под инструментом: сверху (подходит), а после выхода в канал — снизу (продавлен водой)
  const compBelowY = p.vCompChannel > 0 ? yBot - compBelowH : yTool;
  const chLen = 70 * Math.min(1, p.channelFill);
  const gauge = p.allowSurfaceMPa > 0 ? Math.min(1, p.surfaceMPa / p.allowSurfaceMPa) : 0;
  const ang = -210 + 240 * gauge;
  const gx = 52, gy = 34, gr = 22;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[300px] h-auto" role="img" aria-label="Схема задавливания">
      <defs>
        <pattern id="rock" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8 L8 0" stroke="hsl(var(--border))" strokeWidth="1" /></pattern>
      </defs>
      <rect x={cx - cw / 2 - 30} y={yTop - 10} width={cw + 60 + 80} height={H - yTop} fill="url(#rock)" opacity={0.6} />
      {/* затрубье колонна-НКТ */}
      <rect x={cx - cw / 2} y={yTop - 10} width={cw} height={yBot - yTop + 10} fill={WELL} opacity={0.6} />
      {/* стенки колонны */}
      <rect x={cx - cw / 2 - 5} y={yTop - 10} width={5} height={yBot - yTop + 12} fill="#475569" />
      <rect x={cx + cw / 2} y={yTop - 10} width={5} height={yLeak0 - yTop + 10} fill="#475569" />
      <rect x={cx + cw / 2} y={yLeak1} width={5} height={yBot - yLeak1 + 2} fill="#475569" />
      {/* канал */}
      <rect x={cx + cw / 2 + 5} y={yLeak0 + 3} width={70} height={yLeak1 - yLeak0 - 6} fill={WATER} opacity={0.5} rx={2} />
      <rect x={cx + cw / 2 + 5} y={yLeak0 + 3} width={chLen} height={yLeak1 - yLeak0 - 6} fill={COMP} rx={2} />
      <text x={cx + cw / 2 + 42} y={yLeak0 - 4} textAnchor="middle" fontSize={9} className="fill-red-600">нарушение</text>
      {/* НКТ */}
      <rect x={cx - tw / 2 - 3} y={yTop - 10} width={3} height={yTool - yTop + 10} fill="#334155" />
      <rect x={cx + tw / 2} y={yTop - 10} width={3} height={yTool - yTop + 10} fill="#334155" />
      <rect x={cx - tw / 2} y={yTop} width={tw} height={tubH} fill={WATER} />
      {compIn && <rect x={cx - tw / 2} y={yTop + tubH * p.compTop} width={tw} height={Math.max(1, tubH * (p.compBottom - p.compTop))} fill={COMP} />}
      {/* под инструментом */}
      <rect x={cx - cw / 2} y={yTool} width={cw} height={belowH} fill={spot && !hasTool ? WELL : WATER} opacity={0.7} />
      {compBelowH > 0.5 && <rect x={cx - cw / 2} y={compBelowY} width={cw} height={compBelowH} fill={COMP} />}
      {/* инструмент */}
      {hasTool && <rect x={cx - cw / 2} y={yTool - 6} width={cw} height={8} fill="#111827" />}
      {hasTool && <text x={cx - cw / 2 - 8} y={yTool} textAnchor="end" fontSize={9} className="fill-foreground">{toolLabel}</text>}
      {/* стрелки потоков */}
      {(circ || squeeze) && <text x={cx} y={yTop - 14} textAnchor="middle" fontSize={14} className="fill-primary">▼</text>}
      {circ && <><text x={cx - cw / 2 + 14} y={yTop + 40} textAnchor="middle" fontSize={13} className="fill-sky-700">▲</text><text x={cx + cw / 2 - 14} y={yTop + 40} textAnchor="middle" fontSize={13} className="fill-sky-700">▲</text></>}
      {squeeze && <text x={cx + cw / 2 + 80} y={yLeak1 - 3} fontSize={14} className="fill-amber-600">►</text>}
      {/* манометр */}
      <circle cx={gx} cy={gy} r={gr} fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth={1.5} />
      <line x1={gx} y1={gy} x2={gx + gr * 0.8 * Math.cos((ang * Math.PI) / 180)} y2={gy + gr * 0.8 * Math.sin((ang * Math.PI) / 180)} stroke={gauge > 0.95 ? "hsl(0 72% 51%)" : "hsl(var(--primary))"} strokeWidth={2.5} strokeLinecap="round" />
      <text x={gx} y={gy + gr + 12} textAnchor="middle" fontSize={11} fontWeight={600} className="fill-foreground">{f(p.surfaceMPa, 1)} МПа</text>
      <text x={gx} y={gy + gr + 23} textAnchor="middle" fontSize={8.5} className="fill-muted-foreground">доп. {f(p.allowSurfaceMPa, 1)}</text>
      {/* подписи */}
      <text x={W - 6} y={20} textAnchor="end" fontSize={11} fontWeight={600} className="fill-foreground">t = {f(p.t, 0)} мин</text>
      <text x={W - 6} y={34} textAnchor="end" fontSize={10} className="fill-muted-foreground">{p.stage}</text>
      <text x={W - 6} y={48} textAnchor="end" fontSize={10} className="fill-muted-foreground">Q = {f(p.qLs, 2)} л/с</text>
      <text x={W - 6} y={62} textAnchor="end" fontSize={10} className="fill-amber-700">в канале {f(p.vCompChannel * 1000, 0)} л</text>
      <g transform={`translate(${W - 100}, ${H - 40})`} fontSize={9}>
        <rect width={10} height={8} fill={COMP} /><text x={14} y={8} className="fill-foreground">состав</text>
        <rect y={12} width={10} height={8} fill={WATER} /><text x={14} y={20} className="fill-foreground">вода / продавка</text>
        <rect y={24} width={10} height={8} fill={WELL} /><text x={14} y={32} className="fill-foreground">скв. жидкость</text>
      </g>
    </svg>
  );
}

export default function RirSqueezeSimCard({ sim, hasTool, spot, toolLabel, holdMin }: { sim: SqueezeSimResult; hasTool: boolean; spot: boolean; toolLabel: string; holdMin: number }) {
  const [idx, setIdx] = useState(sim.points.length - 1);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => { setIdx(sim.points.length - 1); setPlaying(false); }, [sim]);
  useEffect(() => {
    if (!playing) return;
    const stepN = Math.max(1, Math.round(sim.points.length / 240));
    timer.current = window.setInterval(() => setIdx((i) => {
      if (i + stepN >= sim.points.length - 1) { setPlaying(false); return sim.points.length - 1; }
      return i + stepN;
    }), 40);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, sim]);
  const p = sim.points[Math.min(idx, sim.points.length - 1)];
  const Icon = sim.outcome === "sealed" ? CheckCircle2 : sim.outcome === "partial" ? AlertTriangle : XCircle;
  const tone = sim.outcome === "sealed" ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : sim.outcome === "partial" ? "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300" : "border-red-500/50 bg-red-500/10 text-red-800 dark:text-red-300";
  const label = sim.outcome === "sealed" ? "Задавлено" : sim.outcome === "partial" ? "Частично" : "Не задавлено";
  return (
    <Card data-testid="rir-sim">
      <CardHeader className="py-2.5 px-4">
        <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" />Моделирование закачки и задавливания <Badge variant="outline" className="text-[10px]">расчёт по шагам 15 с</Badge></CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 text-xs">
        <div className={`flex gap-2 rounded-md border p-2.5 ${tone}`}>
          <Icon className="w-5 h-5 shrink-0" />
          <div><p className="font-semibold">{label}</p><p>{sim.outcomeText}</p></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            ["Время операции", `${f(sim.totalTimeMin, 0)} мин`, ""],
            ["Использовано времени жизни", `${f(sim.workLifeUsedPct, 0)}%`, sim.workLifeUsedPct > 75 ? "text-destructive" : ""],
            ["Состава в канале", `${f(sim.compInChannelM3 * 1000, 0)} л`, ""],
            ["Давление в конце", `${f(sim.finalSurfaceMPa, 1)} МПа`, ""],
          ].map(([n, v, c]) => (
            <div key={n} className="rounded-md border border-border/60 p-2"><p className="text-[10px] text-muted-foreground">{n}</p><p className={`text-base font-semibold ${c}`}>{v}</p></div>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-[300px_1fr]" data-docimg="sim">
          <div className="flex flex-col items-center gap-2">
            <SqueezeAnimation p={p} hasTool={hasTool} spot={spot} toolLabel={toolLabel} />
            <div className="flex w-full items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label={playing ? "Пауза" : "Воспроизвести"} onClick={() => { if (!playing && idx >= sim.points.length - 1) setIdx(0); setPlaying((x) => !x); }}>
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label="В начало" onClick={() => { setPlaying(false); setIdx(0); }}><RotateCcw className="w-3.5 h-3.5" /></Button>
              <input type="range" min={0} max={sim.points.length - 1} value={idx} onChange={(e) => { setPlaying(false); setIdx(+e.target.value); }} className="flex-1 accent-[hsl(var(--primary))]" aria-label="Время" />
            </div>
          </div>
          <div className="space-y-2 min-w-0">
            <TimeChart sim={sim} cursor={p.t} />
            <RateStrip sim={sim} cursor={p.t} />
            <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
              <span><span className="inline-block w-3 h-2 mr-1 align-middle" style={{ background: STAGE_FILL.pump, opacity: 0.3 }} />закачка с циркуляцией</span>
              <span><span className="inline-block w-3 h-2 mr-1 align-middle" style={{ background: STAGE_FILL.squeeze, opacity: 0.3 }} />задавливание</span>
              <span><span className="inline-block w-3 h-2 mr-1 align-middle" style={{ background: STAGE_FILL.hold, opacity: 0.3 }} />выдержка</span>
            </div>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold mb-1">Давление — объём в канал (подвижность канала падает по мере заполнения и загустевания)</p>
            <PVChart sim={sim} />
          </div>
          <div>
            <p className="text-[11px] font-semibold mb-1">Выдержки (критерий: падение ≤ 10% за {holdMin} мин при давлении ≥ 70% допустимого)</p>
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50"><tr><th className="p-1 text-left">Ступень</th><th className="p-1 text-right">P начало, МПа</th><th className="p-1 text-right">P конец, МПа</th><th className="p-1 text-right">Падение</th><th className="w-5" /></tr></thead>
              <tbody>
                {sim.holds.map((h) => (
                  <tr key={h.stage} className="border-t border-border/40">
                    <td className="p-1">{h.stage}</td><td className="p-1 text-right">{f(h.pStart, 1)}</td><td className="p-1 text-right">{f(h.pEnd, 1)}</td>
                    <td className={`p-1 text-right ${h.decayPct <= 10 ? "text-emerald-600" : "text-amber-600"}`}>{f(h.decayPct, 0)}%</td>
                    <td className="p-1 text-center">{h.decayPct <= 10 ? "✓" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 space-y-1">
              {sim.warnings.map((w) => <p key={w} className="text-[11px] text-amber-700 dark:text-amber-500">⚠ {w}</p>)}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">Модель: несжимаемая система «НКТ → под инструментом → канал»; приёмистость канала по замерам с водой, снижается по мере заполнения канала составом (вязкость), кольматации (суспензии) и загустевания. Ограничение давления — по забою (ГРП, колонна, пакер) и устью (НКТ). На выдержке давление падает по упругоёмкости системы. Результат — прогноз для планирования; фактическая кривая при работе сравнивается с этой.</p>
      </CardContent>
    </Card>
  );
}
