import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Activity, AlertTriangle, Zap } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, Area, AreaChart } from "recharts";
import CopyImageButton from "@/components/CopyImageButton";
import type { CTStringData } from "@/lib/coiled-tubing-calculations";
import { calculateCTFatigueAdvanced, type CTTripEvent } from "@/lib/ct-fatigue-advanced";

interface Props {
  ct: CTStringData;
  reelSize: "small" | "medium" | "large";
  totalLengthM: number;
  currentDepthM: number;
  currentPressureMPa: number;
}

export default function CTFatigueAdvancedCard({ ct, reelSize, totalLengthM, currentDepthM, currentPressureMPa }: Props) {
  const [trips, setTrips] = useState<CTTripEvent[]>([
    { label: "История (агрегат)", depthM: Math.round(currentDepthM * 0.9) || 2500, pressureMPa: Math.max(15, currentPressureMPa * 0.7), count: 30 },
    { label: "Текущая операция", depthM: currentDepthM || 3000, pressureMPa: currentPressureMPa || 30, count: 1 },
  ]);
  const chartRef = useRef<HTMLDivElement>(null);

  const result = useMemo(() => calculateCTFatigueAdvanced({
    ct, reelSize, totalLengthM,
    trips: trips.filter(t => t.depthM > 0 && t.count > 0),
    step: Math.max(25, Math.round(totalLengthM / 80)),
  }), [ct, reelSize, totalLengthM, trips]);

  const addTrip = () => setTrips([...trips, { label: `Рейс ${trips.length + 1}`, depthM: 1000, pressureMPa: 20, count: 1 }]);
  const removeTrip = (i: number) => setTrips(trips.filter((_, idx) => idx !== i));
  const updateTrip = (i: number, patch: Partial<CTTripEvent>) =>
    setTrips(trips.map((t, idx) => idx === i ? { ...t, ...patch } : t));

  const chartData = result.damageProfile.map(p => ({
    position: p.position,
    damagePct: +(p.damage * 100).toFixed(1),
    threshold50: 50,
    threshold100: 100,
  }));

  const maxDamagePct = result.maxDamage * 100;
  const dmgColor = maxDamagePct >= 100 ? "text-red-600"
    : maxDamagePct >= 80 ? "text-red-500"
    : maxDamagePct >= 50 ? "text-amber-500"
    : "text-emerald-600";

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="h-4 w-4 text-purple-600" />
          CoilLIFE+ · Депт-распределённая усталость (Halal–Tipton · Miner)
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {/* Summary metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="Макс. повреждение" value={`${maxDamagePct.toFixed(1)}%`} valueClass={dmgColor}
            sub={`на ${result.maxDamagePosition.toFixed(0)} м от BHA`} />
          <Tile label="Горячая зона (>50%)" value={`${result.hotZoneLengthM.toFixed(0)} м`}
            sub={`из ${totalLengthM.toFixed(0)} м`} />
          <Tile label="Снижение P разрыва" value={`${result.pressureDeratePct.toFixed(1)}%`}
            sub={`P_эфф = ${result.effectiveBurstMPa.toFixed(1)} МПа`} />
          <Tile label="Остаток рейсов" value={result.remainingTripsToFailure >= 99999 ? "∞" : String(result.remainingTripsToFailure)}
            sub="на тек. глубине/давл." />
        </div>

        {/* Trip history editor */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-muted/40 px-3 py-2 flex items-center justify-between">
            <div className="text-xs font-semibold">История рейсов</div>
            <Button size="sm" variant="outline" onClick={addTrip} className="h-7 text-xs gap-1">
              <Plus className="h-3 w-3" /> Добавить
            </Button>
          </div>
          <div className="divide-y divide-border">
            <div className="grid grid-cols-12 gap-2 px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/20">
              <div className="col-span-4">Метка</div>
              <div className="col-span-3 text-right">Глубина, м</div>
              <div className="col-span-2 text-right">P, МПа</div>
              <div className="col-span-2 text-right">N рейсов</div>
              <div className="col-span-1"></div>
            </div>
            {trips.map((t, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 px-3 py-1.5 items-center">
                <input value={t.label || ""} onChange={e => updateTrip(i, { label: e.target.value })}
                  className="col-span-4 border border-border rounded px-2 py-1 text-xs bg-background" />
                <input type="number" value={t.depthM} onChange={e => updateTrip(i, { depthM: +e.target.value })}
                  className="col-span-3 border border-border rounded px-2 py-1 text-xs bg-background text-right" />
                <input type="number" step="0.5" value={t.pressureMPa} onChange={e => updateTrip(i, { pressureMPa: +e.target.value })}
                  className="col-span-2 border border-border rounded px-2 py-1 text-xs bg-background text-right" />
                <input type="number" value={t.count} onChange={e => updateTrip(i, { count: +e.target.value })}
                  className="col-span-2 border border-border rounded px-2 py-1 text-xs bg-background text-right" />
                <Button size="sm" variant="ghost" onClick={() => removeTrip(i)} className="col-span-1 h-7 w-7 p-0">
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Damage profile chart */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-amber-500" />
              Профиль повреждений по длине ГНКТ
            </div>
            <CopyImageButton targetRef={chartRef} />
          </div>
          <div ref={chartRef} className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <defs>
                  <linearGradient id="dmgGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(0,75%,55%)" stopOpacity={0.6} />
                    <stop offset="50%" stopColor="hsl(35,85%,55%)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(140,60%,50%)" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="position" type="number" domain={[0, totalLengthM]}
                  label={{ value: "Позиция от BHA-end, м", position: "insideBottom", offset: -5, style: { fontSize: 11 } }}
                  tick={{ fontSize: 10 }} />
                <YAxis domain={[0, Math.max(120, maxDamagePct * 1.1)]}
                  label={{ value: "Повреждение, %", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                  tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "12px" }} />
                <ReferenceLine y={100} stroke="hsl(0,80%,55%)" strokeDasharray="6 3"
                  label={{ value: "Разрушение", fill: "hsl(0,80%,55%)", fontSize: 10, position: "right" }} />
                <ReferenceLine y={50} stroke="hsl(35,85%,55%)" strokeDasharray="4 4"
                  label={{ value: "50%", fill: "hsl(35,85%,55%)", fontSize: 10, position: "right" }} />
                <Area dataKey="damagePct" name="Damage, %" stroke="hsl(0,75%,55%)" strokeWidth={2} fill="url(#dmgGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Warnings */}
        {result.warnings.length > 0 && (
          <div className="space-y-1.5">
            {result.warnings.map((w, i) => (
              <div key={i} className="text-xs flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
          Модель: Nf = A·ε_a<sup>−b</sup> с поправкой (1 − P/P<sub>burst</sub>)<sup>c</sup>. Накопление по правилу Майнера, 4 пластических цикла за рейс (барабан + направляющая дуга). Депт-распределение: метр в позиции p циклируется только если рейс достигает глубины ≥ p.
        </div>
      </CardContent>
    </Card>
  );
}

function Tile({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-xl font-bold ${valueClass ?? ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
