import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Target } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Area, ComposedChart,
} from "recharts";
import { analyzeReach } from "@/lib/ct-reach-analysis";
import type {
  CTStringData, WellGeometry, FluidData, ToolsData,
} from "@/lib/coiled-tubing-calculations";
import type { CTSection } from "@/lib/coiled-tubing-calculations";

interface Props {
  ct: CTStringData;
  well: WellGeometry;
  fluid: FluidData;
  tools: ToolsData;
  sections?: CTSection[];
  baselineFriction: number;
}

export default function CTReachAnalysisTab({
  ct, well, fluid, tools, sections, baselineFriction,
}: Props) {
  const [target, setTarget] = useState<number>(Math.round(well.md * 0.95));
  const [muMin, setMuMin] = useState(0.15);
  const [muMax, setMuMax] = useState(0.45);

  const result = useMemo(
    () =>
      analyzeReach({
        ct, well, fluid, tools, sections,
        targetDepthMD: target,
        baselineFriction,
        frictionMin: muMin,
        frictionMax: muMax,
        step: 0.025,
      }),
    [ct, well, fluid, tools, sections, target, baselineFriction, muMin, muMax],
  );

  const chartData = result.sensitivity.map(s => ({
    friction: s.friction,
    // Если не запирается — показываем total length (доходит до конца)
    lockUp: s.lockUpDepth === 0 ? well.md : s.lockUpDepth,
    target: target,
  }));

  const ok = result.canReach && result.marginAtBaselineM > 200;
  const warn = result.canReach && result.marginAtBaselineM <= 200;
  const fail = !result.canReach;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" /> Reach Analysis — чувствительность к трению
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Параметры */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Целевая глубина MD, м</Label>
                <Input
                  type="number"
                  value={target}
                  onChange={e => setTarget(parseFloat(e.target.value) || 0)}
                  className="h-7 w-24 text-right font-mono"
                />
              </div>
              <Slider
                value={[target]}
                min={100}
                max={well.md}
                step={50}
                onValueChange={v => setTarget(v[0])}
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <Label className="text-xs">μ min</Label>
                <span className="text-xs font-mono">{muMin.toFixed(2)}</span>
              </div>
              <Slider value={[muMin]} min={0.05} max={0.40} step={0.01}
                onValueChange={v => setMuMin(Math.min(v[0], muMax - 0.05))} />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <Label className="text-xs">μ max</Label>
                <span className="text-xs font-mono">{muMax.toFixed(2)}</span>
              </div>
              <Slider value={[muMax]} min={0.10} max={0.60} step={0.01}
                onValueChange={v => setMuMax(Math.max(v[0], muMin + 0.05))} />
            </div>
          </div>

          {/* Сводка */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Базовое μ" value={result.baselineFriction.toFixed(2)} />
            <Stat
              label="Lock-up при базовом μ"
              value={result.baselineLockUpDepth === 0 ? "доходит" : `${result.baselineLockUpDepth.toFixed(0)} м`}
              tone={fail ? "danger" : "ok"}
            />
            <Stat
              label="Запас до цели"
              value={`${result.marginAtBaselineM >= 0 ? "+" : ""}${result.marginAtBaselineM.toFixed(0)} м`}
              tone={fail ? "danger" : warn ? "warn" : "ok"}
            />
            <Stat
              label="Критическое μ"
              value={result.criticalFriction != null ? result.criticalFriction.toFixed(3) : "—"}
              tone="muted"
            />
          </div>

          {/* Статус */}
          <div className={`rounded-lg border p-3 flex items-start gap-2 text-sm ${
            ok ? "border-emerald-500/40 bg-emerald-500/5" :
            warn ? "border-amber-500/40 bg-amber-500/5" :
            "border-red-500/40 bg-red-500/5"
          }`}>
            {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" /> :
             <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${warn ? "text-amber-500" : "text-red-500"}`} />}
            <div className="space-y-1">
              {result.recommendations.map((r, i) => <div key={i}>{r}</div>)}
            </div>
          </div>

          {/* График */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">
              Достижимая глубина (lock-up) vs коэффициент трения μ
            </h4>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="friction"
                  type="number"
                  domain={[muMin, muMax]}
                  tickFormatter={v => v.toFixed(2)}
                  label={{ value: "Коэффициент трения μ", position: "insideBottom", offset: -10 }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  reversed
                  domain={[0, well.md]}
                  label={{ value: "Глубина MD, м (вниз)", angle: -90, position: "insideLeft" }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  formatter={(v: number, n) => [
                    n === "lockUp" ? `${v.toFixed(0)} м` : `${v.toFixed(0)} м`,
                    n === "lockUp" ? "Lock-up глубина" : "Цель",
                  ]}
                  labelFormatter={(mu: number) => `μ = ${Number(mu).toFixed(3)}`}
                />
                <Legend />
                {/* Зоны: выше цели = достижимо (зелёная), ниже = не достижимо (красная) */}
                <ReferenceArea y1={0} y2={target} fill="hsl(142 71% 45%)" fillOpacity={0.06} />
                <ReferenceArea y1={target} y2={well.md} fill="hsl(0 84% 60%)" fillOpacity={0.06} />
                <ReferenceLine y={target} stroke="hsl(217 91% 60%)" strokeDasharray="6 4"
                  label={{ value: `Цель ${target} м`, fill: "hsl(217 91% 60%)", position: "right" }} />
                <ReferenceLine x={baselineFriction} stroke="hsl(280 70% 60%)" strokeDasharray="4 4"
                  label={{ value: `μ=${baselineFriction}`, fill: "hsl(280 70% 60%)", position: "top" }} />
                {result.criticalFriction != null && (
                  <ReferenceLine x={result.criticalFriction} stroke="hsl(0 84% 60%)" strokeDasharray="3 3"
                    label={{ value: `μ_crit ${result.criticalFriction.toFixed(2)}`, fill: "hsl(0 84% 60%)", position: "top" }} />
                )}
                <Line type="monotone" dataKey="lockUp" stroke="hsl(25 95% 53%)"
                  name="Lock-up глубина" dot={{ r: 3 }} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground mt-1">
              Зелёная зона — глубины выше цели (достижимо). Красная — за пределами. Если кривая Lock-up входит в красную зону при базовом μ — цель не достигается.
            </p>
          </div>

          {/* Таблица чувствительности */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-1.5 px-2">μ</th>
                  <th className="text-right py-1.5 px-2">Lock-up, м</th>
                  <th className="text-right py-1.5 px-2">Запас до цели, м</th>
                  <th className="text-center py-1.5 px-2">Статус</th>
                </tr>
              </thead>
              <tbody>
                {result.sensitivity.map((s, i) => {
                  const isBase = Math.abs(s.friction - baselineFriction) < 0.013;
                  return (
                    <tr key={i} className={`border-b border-border/40 ${isBase ? "bg-primary/5" : ""}`}>
                      <td className="py-1 px-2 font-mono">
                        {isBase && <span className="text-primary mr-1">◀</span>}
                        {s.friction.toFixed(3)}
                      </td>
                      <td className="text-right py-1 px-2 font-mono">
                        {s.lockUpDepth === 0 ? <span className="text-emerald-500">доходит</span> : s.lockUpDepth.toFixed(0)}
                      </td>
                      <td className={`text-right py-1 px-2 font-mono ${s.marginM < 0 ? "text-red-500" : s.marginM < 200 ? "text-amber-500" : "text-emerald-500"}`}>
                        {s.marginM >= 0 ? "+" : ""}{s.marginM.toFixed(0)}
                      </td>
                      <td className="text-center py-1 px-2">
                        {s.canReach ? (
                          <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-500">OK</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[9px] border-red-500/40 text-red-500">stuck</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "danger" | "muted" }) {
  const cls =
    tone === "ok" ? "text-emerald-500" :
    tone === "warn" ? "text-amber-500" :
    tone === "danger" ? "text-red-500" :
    tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-base font-bold mt-0.5 font-mono ${cls}`}>{value}</div>
    </div>
  );
}
