import { useMemo, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Droplets, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, RadialBarChart, RadialBar, PolarAngleAxis } from "recharts";
import CopyImageButton from "@/components/CopyImageButton";
import type { CentralizationResult } from "@/lib/centralization-calculations";
import type { DrillingFluid, BufferFluid, SlurryInput } from "@/lib/cementing-calculations";
import { calculateMREI, type FluidProps } from "@/lib/mud-removal-efficiency";

interface Props {
  drillingFluid: DrillingFluid;
  buffers: BufferFluid[];
  slurries: SlurryInput[];
  centralizationResults: CentralizationResult[];
  holeDiameterMm: number;
  casingODmm: number;
}

const bufferKindMap = {
  chemical_wash: "chemical_wash",
  elastic_spacer: "elastic_spacer",
  weighted: "weighted_spacer",
  cement_wash: "chemical_wash",
  water: "chemical_wash",
} as const;

// pv (сПз) → Па·с; yp in Pa already
const toPaS = (cP: number) => cP * 1e-3;

export default function MudRemovalEfficiencyCard({
  drillingFluid, buffers, slurries, centralizationResults, holeDiameterMm, casingODmm,
}: Props) {
  const [flowRateLps, setFlowRateLps] = useState(20);
  const [rotationRpm, setRotationRpm] = useState(15);
  const [reciprocationMpm, setReciprocationMpm] = useState(0);

  const chartRef = useRef<HTMLDivElement>(null);

  const result = useMemo(() => {
    if (!centralizationResults || centralizationResults.length === 0) return null;

    const fluidChain: FluidProps[] = [];
    fluidChain.push({
      label: drillingFluid.name || "ОБР",
      kind: "mud",
      density: drillingFluid.density,
      yp: drillingFluid.rheology.yp,
      pv: toPaS(drillingFluid.rheology.pv),
    });
    for (const b of buffers) {
      const kind: FluidProps["kind"] = b.bufferType ? bufferKindMap[b.bufferType] ?? "spacer" : "spacer";
      fluidChain.push({
        label: b.name || "Буфер",
        kind,
        density: b.density,
        yp: b.rheology.yp,
        pv: toPaS(b.rheology.pv),
        volumeM3: b.volume,
      });
    }
    for (const s of slurries) {
      const dens = s.density > 100 ? s.density : s.density * 1000;
      fluidChain.push({
        label: s.name || "Цемент",
        kind: "cement",
        density: dens,
        yp: s.rheology.yp,
        pv: toPaS(s.rheology.pv),
      });
    }

    return calculateMREI({
      fluidChain,
      centralization: centralizationResults,
      flowRateLps,
      holeDiameterMm,
      casingODmm,
      rotationRpm,
      reciprocationMpm,
    });
  }, [drillingFluid, buffers, slurries, centralizationResults, flowRateLps, rotationRpm, reciprocationMpm, holeDiameterMm, casingODmm]);

  if (!result || result.segments.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Рассчитайте центрирование и задайте жидкости (ОБР, буфер, цемент) для оценки MREI.
        </CardContent>
      </Card>
    );
  }

  const avg = result.averageMREI;
  const avgColor = avg >= 75 ? "text-emerald-600" : avg >= 55 ? "text-amber-500" : "text-red-600";
  const avgLabel = avg >= 75 ? "Высокое" : avg >= 55 ? "Удовлетворительное" : "Низкое";

  const chartData = result.segments.map(s => ({
    md: +s.md.toFixed(0),
    overall: +s.overallMREI.toFixed(1),
    spacerMud: +s.spacerMud.toFixed(1),
    cementSpacer: +s.cementSpacer.toFixed(1),
    standoff: +s.standoff.toFixed(1),
  }));

  const radialData = [
    { name: "Стэндофф", value: result.globalScores.standoffScore * 100, fill: "hsl(200, 70%, 50%)" },
    { name: "Re", value: result.globalScores.flowRegimeScore * 100, fill: "hsl(180, 60%, 45%)" },
    { name: "Вращение", value: result.globalScores.rotationScore * 100, fill: "hsl(280, 60%, 55%)" },
    { name: "ρ-иерархия", value: result.globalScores.densityHierarchyScore * 100, fill: "hsl(35, 80%, 50%)" },
    { name: "τy-иерархия", value: result.globalScores.rheologyHierarchyScore * 100, fill: "hsl(140, 50%, 45%)" },
    { name: "Контакт", value: result.globalScores.contactTimeScore * 100, fill: "hsl(320, 60%, 55%)" },
  ];

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <Droplets className="h-5 w-5 text-cyan-600" />
          MREI · Индекс качества вытеснения ОБР (Brice–Holmes / Tartaglione)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Расход вытеснения, л/с</label>
            <input type="number" step="1" value={flowRateLps} onChange={e => setFlowRateLps(+e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Вращение колонны, об/мин</label>
            <input type="number" step="1" value={rotationRpm} onChange={e => setRotationRpm(+e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Реципрокация, м/мин</label>
            <input type="number" step="0.5" value={reciprocationMpm} onChange={e => setReciprocationMpm(+e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
          </div>
        </div>

        {/* Headline */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="border border-border rounded-lg p-3 bg-card">
            <div className="text-xs text-muted-foreground mb-1">Средний MREI по стволу</div>
            <div className={`text-3xl font-bold ${avgColor}`}>{avg.toFixed(1)}%</div>
            <div className="text-xs text-muted-foreground mt-0.5">{avgLabel}</div>
          </div>
          <div className="border border-border rounded-lg p-3 bg-card">
            <div className="text-xs text-muted-foreground mb-1">Время контакта</div>
            <div className="text-lg font-semibold">
              спейсер: <span className="text-cyan-600">{result.contactTimeMinutes.spacerMin.toFixed(1)} мин</span>
            </div>
            <div className="text-[11px] text-muted-foreground">цемент-head: {result.contactTimeMinutes.cementHeadMin.toFixed(1)} мин</div>
          </div>
          <div className="border border-border rounded-lg p-3 bg-card">
            <div className="text-xs text-muted-foreground mb-1">Слабые интервалы (MREI&lt;50%)</div>
            <div className="text-3xl font-bold text-red-600">{result.weakIntervals.length}</div>
            <div className="text-[11px] text-muted-foreground">
              суммарно {result.weakIntervals.reduce((s, w) => s + (w.bottomMd - w.topMd), 0).toFixed(0)} м
            </div>
          </div>
        </div>

        {/* Charts: depth profile + radial */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-cyan-600" />
                MREI по глубине
              </div>
              <CopyImageButton targetRef={chartRef} />
            </div>
            <div ref={chartRef} className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <YAxis dataKey="md" type="number" reversed domain={['dataMin', 'dataMax']}
                    label={{ value: "MD, м", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                    tick={{ fontSize: 10 }} />
                  <XAxis type="number" domain={[0, 100]}
                    label={{ value: "%", position: "insideBottom", offset: -5, style: { fontSize: 11 } }}
                    tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "12px" }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <ReferenceLine x={75} stroke="hsl(140,60%,45%)" strokeDasharray="4 4" label={{ value: "75%", fill: "hsl(140,60%,45%)", fontSize: 10 }} />
                  <ReferenceLine x={50} stroke="hsl(0,80%,55%)" strokeDasharray="4 4" label={{ value: "50%", fill: "hsl(0,80%,55%)", fontSize: 10 }} />
                  <Line dataKey="spacerMud" name="Спейсер→ОБР" stroke="hsl(200,70%,50%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  <Line dataKey="cementSpacer" name="Цемент→Спейсер" stroke="hsl(35,80%,50%)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                  <Line dataKey="overall" name="Итоговый MREI" stroke="hsl(280,70%,50%)" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium mb-2">Компоненты качества</div>
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart innerRadius="20%" outerRadius="95%" data={radialData} startAngle={90} endAngle={-270}>
                  <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                  <RadialBar background dataKey="value" cornerRadius={4} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => `${v.toFixed(0)}%`} />
                  <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
                </RadialBarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Weak intervals */}
        {result.weakIntervals.length > 0 && (
          <div className="border border-red-500/30 bg-red-500/5 rounded-lg p-3">
            <div className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4" />
              Слабые зоны вытеснения
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {result.weakIntervals.slice(0, 8).map((w, i) => (
                <div key={i} className="text-xs flex items-center justify-between p-1.5 rounded bg-card border border-border">
                  <span>{w.topMd.toFixed(0)}–{w.bottomMd.toFixed(0)} м</span>
                  <span className="text-muted-foreground">
                    MREI {w.minMREI.toFixed(0)}% · стэнд. {w.avgStandoff.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations */}
        <div className="space-y-1.5">
          {result.recommendations.map((r, i) => {
            const ok = r.startsWith("Качество");
            return (
              <div key={i} className={`text-xs flex items-start gap-2 p-2 rounded border ${ok ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"}`}>
                {ok ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                <span>{r}</span>
              </div>
            );
          })}
        </div>

        <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
          Модель: парный MREI (спейсер→ОБР и цемент→спейсер) с агрегацией по правилу слабого звена. Учитываются: иерархия плотности (API 10TR4), иерархия τy, центрирование, Re в кольцевом, вращение/реципрокация, время контакта, зенит, тип буфера.
        </div>
      </CardContent>
    </Card>
  );
}
