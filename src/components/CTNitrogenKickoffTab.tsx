import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BlurInput } from "@/components/BlurInput";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, AreaChart, Area, ComposedChart, Bar,
} from "recharts";
import {
  calculateN2Kickoff, N2KickoffInputs,
} from "@/lib/ct-nitrogen-kickoff";
import type { WellGeometry, FluidData, CTStringData } from "@/lib/coiled-tubing-calculations";
import { Wind, Gauge, Droplets, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Props {
  ct: CTStringData;
  well: WellGeometry;
  fluid: FluidData;
}

const Field = ({ label, value, onChange, unit, step = "any" }: {
  label: string; value: number; onChange: (v: number) => void; unit?: string; step?: string;
}) => (
  <div className="space-y-1">
    <Label className="text-xs">{label}{unit ? ` (${unit})` : ""}</Label>
    <BlurInput
      type="number" step={step} value={value || ""}
      onValueCommit={(v) => onChange(parseFloat(v) || 0)}
      className="h-8 text-xs"
    />
  </div>
);

const KPI = ({ label, value, unit, tone = "default", icon }: {
  label: string; value: string | number; unit?: string;
  tone?: "default" | "success" | "danger" | "warning";
  icon?: React.ReactNode;
}) => {
  const cls =
    tone === "success" ? "border-green-500/30 bg-green-500/5"
    : tone === "danger" ? "border-destructive/30 bg-destructive/5"
    : tone === "warning" ? "border-yellow-500/30 bg-yellow-500/5"
    : "border-border bg-muted/30";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        {icon}{label}
      </div>
      <div className="text-lg font-semibold tabular-nums">
        {value}{unit && <span className="ml-1 text-xs text-muted-foreground font-normal">{unit}</span>}
      </div>
    </div>
  );
};

export default function CTNitrogenKickoffTab({ ct, well, fluid }: Props) {
  const [reservoirPressure, setReservoirPressure] = useState(20);
  const [drawdownTarget, setDrawdownTarget] = useState(5);
  const [n2Rate, setN2Rate] = useState(30);
  const [liquidRate, setLiquidRate] = useState(0);
  const [ctRunDepth, setCtRunDepth] = useState(Math.round(well.tvd * 0.8));
  const [whP, setWhP] = useState(0.5);

  const inputs: N2KickoffInputs = useMemo(() => ({
    tvd: well.tvd,
    md: well.md,
    reservoirPressure,
    wellheadPressure: whP,
    fluidDensity: fluid.density,
    bhct: well.bhct,
    whTemp: well.whTemp,
    csgID: well.casingID,
    ctOD: ct.od,
    ctID: ct.od - 2 * ct.wall,
    n2RateSm3min: n2Rate,
    liquidRateLpm: liquidRate,
    ctRunDepth,
    drawdownTarget,
  }), [well, fluid, ct, reservoirPressure, whP, n2Rate, liquidRate, ctRunDepth, drawdownTarget]);

  const result = useMemo(() => calculateN2Kickoff(inputs), [inputs]);

  const depthChart = result.steps.map(s => ({
    depth: +s.depth.toFixed(0),
    pressure: +s.pressure.toFixed(2),
    rhoMix: +s.mixtureDensity.toFixed(0),
    alphaG: +(s.gasFraction * 100).toFixed(1),
  }));

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wind className="w-4 h-4" />
            Освоение скважины азотом (N₂ Kickoff)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Газлифтное снижение забойного давления: расчёт Pзаб, депрессии и потребного объёма N₂.
            Модель — реальный газ (Papay Z-factor), скважинный профиль.
          </p>
        </CardHeader>
      </Card>

      {/* Inputs */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Параметры освоения</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Pплаcт" value={reservoirPressure} onChange={setReservoirPressure} unit="MPa" />
            <Field label="Целевая депрессия" value={drawdownTarget} onChange={setDrawdownTarget} unit="MPa" />
            <Field label="Pустье начальное" value={whP} onChange={setWhP} unit="MPa" />
            <Field label="Глубина спуска ГНКТ" value={ctRunDepth} onChange={setCtRunDepth} unit="м" />
            <Field label="Расход N₂" value={n2Rate} onChange={setN2Rate} unit="ст.м³/мин" />
            <Field label="Жидкость по ГНКТ" value={liquidRate} onChange={setLiquidRate} unit="л/мин" />
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Плотность жидкости</Label>
              <div className="h-8 flex items-center text-xs font-medium px-2 rounded bg-muted/40">
                {fluid.density.toFixed(2)} г/см³ (из скважины)
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">TVD / BHCT</Label>
              <div className="h-8 flex items-center text-xs font-medium px-2 rounded bg-muted/40">
                {well.tvd} м / {well.bhct} °C
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI
          label="Pзаб (расчёт)"
          value={result.bottomholePressure}
          unit="MPa"
          icon={<Gauge className="w-3 h-3" />}
        />
        <KPI
          label="Депрессия"
          value={result.drawdown.toFixed(2)}
          unit="MPa"
          tone={result.feasible ? "success" : "danger"}
          icon={result.feasible ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
        />
        <KPI
          label="Pнагнетания N₂"
          value={result.surfacePressure}
          unit="MPa"
          tone={result.surfacePressure > 35 ? "warning" : "default"}
        />
        <KPI
          label="Средняя ρсмеси"
          value={result.avgMixDensity}
          unit="кг/м³"
          icon={<Droplets className="w-3 h-3" />}
        />
        <KPI label="Объём N₂ (цикл)" value={result.n2VolumeTotal.toLocaleString()} unit="нм³" />
        <KPI label="Жидкости вытеснено" value={result.liquidUnloaded.toFixed(1)} unit="м³" />
        <KPI label="Расход N₂ базовый" value={n2Rate} unit="ст.м³/мин" />
        <KPI
          label="Статус"
          value={result.feasible ? "Достижимо" : "Не достигнуто"}
          tone={result.feasible ? "success" : "danger"}
        />
      </div>

      {/* Recommendations */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Рекомендации</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {result.recommendations.map((r, i) => (
              <div key={i} className="text-xs px-3 py-2 rounded-lg bg-muted/40 border border-border/50">{r}</div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Sensitivity chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Чувствительность: депрессия vs расход N₂</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={result.sensitivity}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="rate" label={{ value: "Расход N₂ (ст.м³/мин)", position: "insideBottom", offset: -5, fontSize: 11 }} fontSize={11} />
              <YAxis yAxisId="L" label={{ value: "Pзаб (MPa)", angle: -90, position: "insideLeft", fontSize: 11 }} fontSize={11} />
              <YAxis yAxisId="R" orientation="right" label={{ value: "Депрессия (MPa)", angle: 90, position: "insideRight", fontSize: 11 }} fontSize={11} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine yAxisId="R" y={drawdownTarget} stroke="#16a34a" strokeDasharray="4 4" label={{ value: "Цель", fontSize: 10, fill: "#16a34a" }} />
              <ReferenceLine yAxisId="L" x={n2Rate} stroke="#3b82f6" strokeDasharray="4 4" />
              <Bar yAxisId="R" dataKey="drawdown" name="Депрессия" fill="#16a34a" fillOpacity={0.5} />
              <Line yAxisId="L" type="monotone" dataKey="bhp" name="Pзаб" stroke="#ef4444" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Depth profile */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Профиль по глубине: давление, ρсмеси, газосодержание</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={depthChart} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis type="number" fontSize={11} />
              <YAxis dataKey="depth" type="number" reversed domain={[0, well.tvd]} label={{ value: "Глубина (м)", angle: -90, position: "insideLeft", fontSize: 11 }} fontSize={11} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line dataKey="pressure" name="P (MPa)" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line dataKey="alphaG" name="αg (%)" stroke="#a855f7" strokeWidth={2} dot={false} />
              <Line dataKey="rhoMix" name="ρсмеси (кг/м³)" stroke="#16a34a" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Sensitivity table */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Таблица чувствительности</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-2">Расход N₂, ст.м³/мин</th>
                  <th className="text-right p-2">Pзаб, MPa</th>
                  <th className="text-right p-2">Депрессия, MPa</th>
                  <th className="text-center p-2">Статус</th>
                </tr>
              </thead>
              <tbody>
                {result.sensitivity.map((s, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="p-2 font-medium">{s.rate}</td>
                    <td className="p-2 text-right tabular-nums">{s.bhp}</td>
                    <td className="p-2 text-right tabular-nums">{s.drawdown}</td>
                    <td className="p-2 text-center">
                      {s.drawdown >= drawdownTarget
                        ? <Badge variant="default" className="bg-green-500/20 text-green-700 hover:bg-green-500/20">OK</Badge>
                        : <Badge variant="outline" className="text-muted-foreground">—</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
