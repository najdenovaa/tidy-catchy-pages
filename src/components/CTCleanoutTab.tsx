import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, AreaChart, Area,
} from "recharts";
import { Trash2, Plus, CheckCircle2, AlertTriangle, Droplets } from "lucide-react";
import {
  calculateCleanout, calcMultiFluidSchedule,
  type CleanoutInput, type FluidSlug,
} from "@/lib/ct-cleanout";
import type { CTStringData, WellGeometry, FluidData, PumpData } from "@/lib/coiled-tubing-calculations";

interface Props {
  ct: CTStringData;
  well: WellGeometry;
  fluid: FluidData;
  pump: PumpData;
}

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

export default function CTCleanoutTab({ ct, well, fluid, pump }: Props) {
  // Cleanout inputs (с разумными дефолтами из well/fluid)
  const [input, setInput] = useState<CleanoutInput>({
    casingID_mm: well.casingID,
    ctOD_mm: ct.od,
    sandDepthMD_m: Math.round(well.md * 0.9),
    sandHeightM: 50,
    wellInclinationDeg: 35,
    particleSizeMm: 0.5,
    particleDensityGcc: 2.65,
    sandConcentrationKgM3: 400,
    fluidDensityGcc: fluid.density,
    fluidViscosityCp: Math.max(1, fluid.pv),
    flowRateLpm: Math.round(pump.flowRate * 60), // л/с → л/мин
    minTransportRatio: 0.5,
    pillVolumeM3: 1.5,
  });

  const result = useMemo(() => calculateCleanout(input), [input]);

  // График: TR vs Q
  const trChart = useMemo(() => {
    const out: Array<{ q: number; tr: number; va: number }> = [];
    const qMax = Math.max(400, input.flowRateLpm * 1.6);
    for (let q = 30; q <= qMax; q += 20) {
      const r = calculateCleanout({ ...input, flowRateLpm: q });
      out.push({ q, tr: r.transportRatio, va: r.annularVelocityMps });
    }
    return out;
  }, [input]);

  // Multi-fluid pumping schedule
  const [slugs, setSlugs] = useState<FluidSlug[]>([
    { name: "Пред-промывка", densityGcc: 1.00, viscosityCp: 1, volumeM3: 1.0 },
    { name: "Вязкая пачка (гель)", densityGcc: 1.05, viscosityCp: 30, volumeM3: 1.5 },
    { name: "Основная промывка", densityGcc: fluid.density, viscosityCp: Math.max(1, fluid.pv), volumeM3: 8.0 },
    { name: "Финишная промывка", densityGcc: 1.00, viscosityCp: 1, volumeM3: 0.5 },
  ]);
  const schedule = useMemo(
    () => calcMultiFluidSchedule({ slugs, pumpRateLpm: input.flowRateLpm }),
    [slugs, input.flowRateLpm],
  );

  const setVal = <K extends keyof CleanoutInput>(k: K, v: CleanoutInput[K]) =>
    setInput(p => ({ ...p, [k]: v }));

  const num = (v: string) => parseFloat(v.replace(",", ".")) || 0;

  return (
    <div className="space-y-3">
      {/* ───────── Cleanout inputs + result ───────── */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            🧹 Промывка скважины (cleanout) — транспорт песка
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Inputs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="ID обсадной, мм">
              <Input type="number" value={input.casingID_mm} onChange={e => setVal("casingID_mm", num(e.target.value))} />
            </Field>
            <Field label="OD ГНКТ, мм">
              <Input type="number" value={input.ctOD_mm} onChange={e => setVal("ctOD_mm", num(e.target.value))} />
            </Field>
            <Field label="Глубина пробки MD, м">
              <Input type="number" value={input.sandDepthMD_m} onChange={e => setVal("sandDepthMD_m", num(e.target.value))} />
            </Field>
            <Field label="Высота пробки, м">
              <Input type="number" value={input.sandHeightM} onChange={e => setVal("sandHeightM", num(e.target.value))} />
            </Field>
            <Field label="Зенит интервала, °">
              <Input type="number" value={input.wellInclinationDeg ?? 0} onChange={e => setVal("wellInclinationDeg", num(e.target.value))} />
            </Field>
            <Field label="Размер частиц, мм">
              <Input type="number" step="0.1" value={input.particleSizeMm} onChange={e => setVal("particleSizeMm", num(e.target.value))} />
            </Field>
            <Field label="ρ частиц, г/см³">
              <Input type="number" step="0.05" value={input.particleDensityGcc} onChange={e => setVal("particleDensityGcc", num(e.target.value))} />
            </Field>
            <Field label="Конц. возврата, кг/м³">
              <Input type="number" value={input.sandConcentrationKgM3 ?? 0} onChange={e => setVal("sandConcentrationKgM3", num(e.target.value))} />
            </Field>
            <Field label="ρ жидкости, г/см³">
              <Input type="number" step="0.01" value={input.fluidDensityGcc} onChange={e => setVal("fluidDensityGcc", num(e.target.value))} />
            </Field>
            <Field label="μ жидкости, cP">
              <Input type="number" value={input.fluidViscosityCp} onChange={e => setVal("fluidViscosityCp", num(e.target.value))} />
            </Field>
            <div className="space-y-1 col-span-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs">Расход, л/мин</Label>
                <span className="text-xs font-mono">{input.flowRateLpm.toFixed(0)} л/мин</span>
              </div>
              <Slider
                value={[input.flowRateLpm]}
                min={30} max={600} step={10}
                onValueChange={v => setVal("flowRateLpm", v[0])}
              />
            </div>
          </div>

          {/* Сводка */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Vannulus" value={`${fmt(result.annularVelocityMps, 2)} м/с`} />
            <Stat
              label="Vslip"
              value={`${fmt(result.slipVelocityMps, 2)} м/с`}
              hint={`${result.flowRegime} · Re_p ${fmt(result.reParticle, 1)}`}
            />
            <Stat
              label="Transport ratio"
              value={fmt(result.transportRatio, 2)}
              tone={result.safe ? "ok" : "danger"}
            />
            <Stat
              label="Мин. Q для TR≥0.5"
              value={`${fmt(result.minRequiredFlowLpm, 0)} л/мин`}
              tone={input.flowRateLpm >= result.minRequiredFlowLpm ? "ok" : "warn"}
            />
            <Stat label="Объём пробки" value={`${fmt(result.sandVolumeM3, 2)} м³`} />
            <Stat label="Масса песка" value={`${fmt(result.sandVolumeM3 * input.particleDensityGcc * 1000, 0)} кг`} />
            <Stat label="Время промывки" value={`${fmt(result.cleanoutTimeMin / 60, 1)} ч`} hint={`${fmt(result.cleanoutTimeMin, 0)} мин`} />
            <Stat label="Объём жидкости" value={`${fmt(result.totalFluidVolumeM3, 1)} м³`} />
          </div>

          {/* Статус */}
          {result.warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-1">
              {result.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Параметры промывки в норме — частицы транспортируются.
            </div>
          )}

          {/* Чувствительность TR vs Q */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">
              Transport ratio vs расход
            </h4>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trChart} margin={{ top: 5, right: 25, left: 5, bottom: 20 }}>
                <defs>
                  <linearGradient id="trGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(142 71% 45%)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(142 71% 45%)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="q" label={{ value: "Расход, л/мин", position: "insideBottom", offset: -8 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis domain={[0, 1]} label={{ value: "TR", angle: -90, position: "insideLeft" }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  formatter={(v: number, n) => [typeof v === "number" ? v.toFixed(3) : v, n === "tr" ? "TR" : n]}
                  labelFormatter={(q: number) => `Q = ${q} л/мин`}
                />
                <ReferenceLine y={input.minTransportRatio ?? 0.5} stroke="hsl(0 84% 60%)" strokeDasharray="4 4"
                  label={{ value: "TR_min", fill: "hsl(0 84% 60%)", position: "right" }} />
                <ReferenceLine x={input.flowRateLpm} stroke="hsl(217 91% 60%)" strokeDasharray="4 4"
                  label={{ value: "Q тек.", fill: "hsl(217 91% 60%)", position: "top" }} />
                <ReferenceLine x={result.minRequiredFlowLpm} stroke="hsl(25 95% 53%)" strokeDasharray="3 3"
                  label={{ value: "Q min", fill: "hsl(25 95% 53%)", position: "top" }} />
                <Area type="monotone" dataKey="tr" stroke="hsl(142 71% 45%)" fill="url(#trGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Pill schedule (если задан) */}
          {result.pillSchedule && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">Pill schedule (с вязкой пачкой)</h4>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left py-1 px-2">Этап</th>
                    <th className="text-right py-1 px-2">V, м³</th>
                    <th className="text-right py-1 px-2">t, мин</th>
                    <th className="text-left py-1 px-2">Назначение</th>
                  </tr>
                </thead>
                <tbody>
                  {result.pillSchedule.map((s, i) => (
                    <tr key={i} className="border-b border-border/40">
                      <td className="py-1 px-2 font-medium">{s.name}</td>
                      <td className="text-right py-1 px-2 font-mono">{s.volumeM3.toFixed(2)}</td>
                      <td className="text-right py-1 px-2 font-mono">{s.pumpTimeMin.toFixed(1)}</td>
                      <td className="py-1 px-2 text-muted-foreground">{s.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ───────── Мульти-флюидный график закачки ───────── */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Droplets className="w-4 h-4 text-primary" /> Мульти-флюидная программа закачки
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-1.5 px-2">Порция</th>
                  <th className="text-right py-1.5 px-2">ρ, г/см³</th>
                  <th className="text-right py-1.5 px-2">μ, cP</th>
                  <th className="text-right py-1.5 px-2">V, м³</th>
                  <th className="text-right py-1.5 px-2">Δt, мин</th>
                  <th className="text-right py-1.5 px-2">∑V, м³</th>
                  <th className="text-right py-1.5 px-2">∑масса, кг</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {schedule.stages.map((s, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-1 px-2">
                      <Input
                        className="h-7 text-xs"
                        value={slugs[i]?.name ?? ""}
                        onChange={e => {
                          const next = [...slugs];
                          next[i] = { ...next[i], name: e.target.value };
                          setSlugs(next);
                        }}
                      />
                    </td>
                    <td className="py-1 px-1">
                      <Input
                        type="number" step="0.01"
                        className="h-7 text-xs text-right font-mono"
                        value={slugs[i]?.densityGcc ?? 0}
                        onChange={e => {
                          const next = [...slugs];
                          next[i] = { ...next[i], densityGcc: num(e.target.value) };
                          setSlugs(next);
                        }}
                      />
                    </td>
                    <td className="py-1 px-1">
                      <Input
                        type="number"
                        className="h-7 text-xs text-right font-mono"
                        value={slugs[i]?.viscosityCp ?? 0}
                        onChange={e => {
                          const next = [...slugs];
                          next[i] = { ...next[i], viscosityCp: num(e.target.value) };
                          setSlugs(next);
                        }}
                      />
                    </td>
                    <td className="py-1 px-1">
                      <Input
                        type="number" step="0.1"
                        className="h-7 text-xs text-right font-mono"
                        value={slugs[i]?.volumeM3 ?? 0}
                        onChange={e => {
                          const next = [...slugs];
                          next[i] = { ...next[i], volumeM3: num(e.target.value) };
                          setSlugs(next);
                        }}
                      />
                    </td>
                    <td className="text-right py-1 px-2 font-mono">{s.durationMin.toFixed(1)}</td>
                    <td className="text-right py-1 px-2 font-mono">{s.cumVolumeM3.toFixed(2)}</td>
                    <td className="text-right py-1 px-2 font-mono">{s.cumMassKg.toFixed(0)}</td>
                    <td className="py-1 px-1">
                      <Button
                        variant="ghost" size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => setSlugs(slugs.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-primary/5 border-t border-primary/30 font-semibold">
                  <td className="py-1.5 px-2">Итого</td>
                  <td className="text-right py-1.5 px-2 font-mono">{schedule.avgDensityGcc.toFixed(2)}*</td>
                  <td className="text-right py-1.5 px-2 font-mono">{schedule.avgViscosityCp.toFixed(0)}*</td>
                  <td className="text-right py-1.5 px-2 font-mono">{schedule.totalVolumeM3.toFixed(2)}</td>
                  <td className="text-right py-1.5 px-2 font-mono">{schedule.totalTimeMin.toFixed(0)}</td>
                  <td className="text-right py-1.5 px-2 font-mono">{schedule.totalVolumeM3.toFixed(2)}</td>
                  <td className="text-right py-1.5 px-2 font-mono">
                    {(schedule.avgDensityGcc * schedule.totalVolumeM3 * 1000).toFixed(0)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <Button
            variant="outline" size="sm"
            onClick={() =>
              setSlugs([
                ...slugs,
                { name: `Порция ${slugs.length + 1}`, densityGcc: 1.0, viscosityCp: 1, volumeM3: 1 },
              ])
            }
          >
            <Plus className="w-3 h-3 mr-1" /> Добавить порцию
          </Button>

          {/* График кумулятивного объёма */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">Кумулятивный объём по времени</h4>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                data={[
                  { t: 0, cumV: 0, rho: schedule.stages[0]?.densityGcc ?? 1 },
                  ...schedule.stages.map(s => ({ t: s.endMin, cumV: s.cumVolumeM3, rho: s.densityGcc })),
                ]}
                margin={{ top: 5, right: 25, left: 5, bottom: 25 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="t" label={{ value: "Время, мин", position: "insideBottom", offset: -8 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis yAxisId="v" label={{ value: "∑V, м³", angle: -90, position: "insideLeft" }} stroke="hsl(var(--muted-foreground))" />
                <YAxis yAxisId="rho" orientation="right" label={{ value: "ρ, г/см³", angle: 90, position: "insideRight" }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend />
                <Line yAxisId="v" type="stepAfter" dataKey="cumV" stroke="hsl(217 91% 60%)" name="∑V" dot strokeWidth={2} />
                <Line yAxisId="rho" type="stepAfter" dataKey="rho" stroke="hsl(280 70% 60%)" name="ρ текущая" dot strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground mt-1">
              * Средневзвешенные по объёму. При фактическом расчёте гидравлики каждая порция несёт собственные ρ и μ —
              давление на устье меняется в зависимости от текущей порции в ГНКТ.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Stat({
  label, value, tone, hint,
}: { label: string; value: string; tone?: "ok" | "warn" | "danger"; hint?: string }) {
  const cls =
    tone === "ok" ? "text-emerald-500" :
    tone === "warn" ? "text-amber-500" :
    tone === "danger" ? "text-red-500" : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card p-2.5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-base font-bold mt-0.5 font-mono ${cls}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
