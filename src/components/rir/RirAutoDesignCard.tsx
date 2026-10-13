import { useState } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceArea, Cell, ZAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Check } from "lucide-react";
import { useMeasuredWidth } from "@/hooks/use-measured-width";
import { autoDesignRir, type RirAutoResult, type RirVariant } from "@/lib/rir-autodesign";
import { COMPOSITION_LABEL, type RirInputs } from "@/lib/rir-calculations";

const f = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const tipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 };
const axisTick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const OUT_COLOR = { sealed: "hsl(142 70% 40%)", partial: "hsl(35 90% 50%)", no_squeeze: "hsl(0 72% 51%)" } as const;
const OUT_LABEL = { sealed: "задавлено", partial: "частично", no_squeeze: "не задавлено" } as const;
const TOOL_SHORT = { retainer: "Ретейнер", packer: "Пакер", bradenhead: "С устья" } as const;
const compShort = (k: RirVariant["composition"]) => COMPOSITION_LABEL[k].split(" (")[0].replace("Тампонажный портландцемент", "Цемент").replace("Двухкомпонентная смола", "Смола");

function VariantMap({ r, bestId }: { r: RirAutoResult; bestId?: string }) {
  const [ref, w] = useMeasuredWidth<HTMLDivElement>();
  const data = r.variants.map((v) => ({ x: Math.round(v.totalTimeMin), y: Math.round(v.workLifeUsedPct), v }));
  const yMax = Math.max(120, ...data.map((d) => d.y + 10));
  return (
    <div ref={ref} className="h-64">
      <ScatterChart width={w || 480} height={256} margin={{ top: 8, right: 12, bottom: 18, left: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
        <ReferenceArea y1={0} y2={75} fill="hsl(142 70% 45%)" fillOpacity={0.06} />
        <XAxis type="number" dataKey="x" name="Время" tick={axisTick} label={{ value: "Время операции, мин", position: "insideBottom", offset: -8, fontSize: 11 }} />
        <YAxis type="number" dataKey="y" name="Время жизни" domain={[0, yMax]} tick={axisTick} label={{ value: "Использовано времени жизни, %", angle: -90, position: "insideLeft", fontSize: 10, dy: 60 }} />
        <ZAxis range={[28, 28]} />
        <ReferenceLine y={75} stroke="hsl(0 72% 51%)" strokeDasharray="4 3" label={{ value: "75%", fontSize: 10, position: "insideTopRight", fill: "hsl(0 72% 51%)" }} />
        <Tooltip contentStyle={tipStyle} content={({ payload }) => {
          const v = payload?.[0]?.payload?.v as RirVariant | undefined;
          if (!v) return null;
          return <div style={tipStyle} className="p-2 rounded"><b>{TOOL_SHORT[v.tool]}{v.tool !== "bradenhead" ? ` ${v.toolDepthMD} м` : ""} · {compShort(v.composition)}</b><br />{v.stages} ступ. × {v.holdMin} мин · {OUT_LABEL[v.outcome]}<br />{f(v.totalTimeMin)} мин · {f(v.workLifeUsedPct)}% времени жизни</div>;
        }} />
        <Scatter data={data} isAnimationActive={false}>
          {data.map((d) => <Cell key={d.v.id} fill={OUT_COLOR[d.v.outcome]} stroke={d.v.id === bestId ? "hsl(var(--foreground))" : "none"} strokeWidth={d.v.id === bestId ? 3 : 0} fillOpacity={d.v.id === bestId ? 1 : 0.55} />)}
        </Scatter>
      </ScatterChart>
    </div>
  );
}

export default function RirAutoDesignCard({ inp, onApply }: { inp: RirInputs; onApply: (v: RirVariant) => void }) {
  const [r, setR] = useState<RirAutoResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  const run = () => {
    setBusy(true);
    setTimeout(() => { setR(autoDesignRir(inp)); setApplied(null); setBusy(false); }, 20);
  };
  // лучший по каждому сочетанию «инструмент + состав» и общий топ-3
  const byGroup = r ? Object.values(r.variants.reduce<Record<string, RirVariant>>((m, v) => { const k = `${v.tool}-${v.composition}`; if (!m[k] || m[k].score > v.score) m[k] = v; return m; }, {})).sort((a, b) => a.score - b.score) : [];
  const list = r ? [...new Map([...r.variants.slice(0, 3), ...byGroup].map((v) => [v.id, v])).values()].sort((a, b) => a.score - b.score).slice(0, 8) : [];
  return (
    <Card data-testid="rir-auto">
      <CardHeader className="py-2.5 px-4">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Sparkles className="w-4 h-4" /> Автоподбор технологии
          <span className="text-[11px] font-normal text-muted-foreground">инструмент и глубина · состав · ступени и выдержки — с моделированием каждого варианта</span>
          <Button size="sm" className="ml-auto h-7 text-[11px]" onClick={run} disabled={busy}>{busy ? "Считаю…" : r ? "Пересчитать" : "Подобрать"}</Button>
        </CardTitle>
      </CardHeader>
      {r && (
        <CardContent className="pt-0 space-y-3 text-xs">
          {r.best && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5 flex flex-wrap items-center gap-2">
              <div className="flex-1 min-w-[240px]">
                <p className="font-semibold">Рекомендация: {TOOL_SHORT[r.best.tool]}{r.best.tool !== "bradenhead" ? ` на ${r.best.toolDepthMD} м` : ""} · {compShort(r.best.composition)} · {r.best.stages} ступ. × {r.best.holdMin} мин</p>
                <p className="text-muted-foreground">{OUT_LABEL[r.best.outcome]}; операция {f(r.best.totalTimeMin)} мин; {f(r.best.workLifeUsedPct)}% времени жизни; в канал {f(r.best.compInChannelL)} из {f(r.best.squeezeL)} л. {r.best.reasons.join("; ")}.</p>
              </div>
              <Button size="sm" className="h-7 text-[11px]" onClick={() => { onApply(r.best!); setApplied(r.best!.id); }} disabled={applied === r.best.id}>
                {applied === r.best.id ? <><Check className="w-3.5 h-3.5 mr-1" />Применено</> : "Применить"}
              </Button>
            </div>
          )}
          {r.notes.map((n) => <p key={n} className="text-muted-foreground">ℹ {n}</p>)}
          <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div>
              <p className="text-[11px] font-semibold">Карта вариантов ({r.evaluated}): цвет — итог моделирования, обведён рекомендуемый</p>
              <VariantMap r={r} bestId={r.best?.id} />
              <div className="flex gap-3 text-[10px] text-muted-foreground">
                {(["sealed", "partial", "no_squeeze"] as const).map((k) => <span key={k}><span className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle" style={{ background: OUT_COLOR[k] }} />{OUT_LABEL[k]} ({r.variants.filter((v) => v.outcome === k).length})</span>)}
              </div>
            </div>
            <div className="overflow-x-auto">
              <p className="text-[11px] font-semibold mb-1">Лучшие варианты (по одному на сочетание инструмента и состава)</p>
              <table className="w-full text-[11px]">
                <thead className="bg-muted/50"><tr>
                  <th className="p-1 text-left">#</th><th className="p-1 text-left">Инструмент</th><th className="p-1 text-left">Состав</th><th className="p-1 text-right">Ступени</th>
                  <th className="p-1 text-left">Итог</th><th className="p-1 text-right">Время</th><th className="p-1 text-right">Вр. жизни</th><th className="p-1 text-right">В канал, л</th><th className="p-1 text-right">Стоим.</th><th />
                </tr></thead>
                <tbody>
                  {list.map((v, i) => (
                    <tr key={v.id} className={`border-t border-border/40 ${i === 0 ? "font-semibold" : ""}`}>
                      <td className="p-1">{i + 1}</td>
                      <td className="p-1 whitespace-nowrap">{TOOL_SHORT[v.tool]}{v.tool !== "bradenhead" ? ` ${v.toolDepthMD} м` : ""}</td>
                      <td className="p-1">{compShort(v.composition)}</td>
                      <td className="p-1 text-right whitespace-nowrap">{v.stages}×{v.holdMin}′</td>
                      <td className="p-1"><Badge variant="outline" className="text-[10px]" style={{ borderColor: OUT_COLOR[v.outcome], color: OUT_COLOR[v.outcome] }}>{OUT_LABEL[v.outcome]}</Badge></td>
                      <td className="p-1 text-right">{f(v.totalTimeMin)}′</td>
                      <td className={`p-1 text-right ${v.workLifeUsedPct > 75 ? "text-destructive" : ""}`}>{f(v.workLifeUsedPct)}%</td>
                      <td className="p-1 text-right">{f(v.compInChannelL)}/{f(v.squeezeL)}</td>
                      <td className="p-1 text-right">{f(v.costIndex, 1)}</td>
                      <td className="p-1"><Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => { onApply(v); setApplied(v.id); }}>{applied === v.id ? "✓" : "применить"}</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[10px] text-muted-foreground">Стоимость — относительный индекс материалов (цемент 1 м³ = 1). Ретейнер: +время на разбуривание; пакер с суспензией: риск прихвата. Время жизни состава подбирается под моделирование автоматически.</p>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
