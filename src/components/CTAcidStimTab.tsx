import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BlurInput } from "@/components/BlurInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { FlaskConical, AlertTriangle, CheckCircle2, Beaker } from "lucide-react";
import {
  calculateAcidStim, AcidStimInputs, ACID_SYSTEMS, FORMATION_TYPES,
  type AcidSystem, type FormationType,
} from "@/lib/ct-acid-stim";
import type { CTStringData, WellGeometry, PumpData } from "@/lib/coiled-tubing-calculations";

interface Props {
  ct: CTStringData;
  well: WellGeometry;
  pump: PumpData;
}

const Field = ({ label, value, onChange, unit, step = "any" }: {
  label: string; value: number; onChange: (v: number) => void; unit?: string; step?: string;
}) => (
  <div className="space-y-1">
    <Label className="text-xs">{label}{unit ? ` (${unit})` : ""}</Label>
    <BlurInput type="number" step={step} value={value || ""}
      onValueCommit={(v) => onChange(parseFloat(v) || 0)} className="h-8 text-xs" />
  </div>
);

const KPI = ({ label, value, unit, tone = "default" }: {
  label: string; value: string | number; unit?: string;
  tone?: "default" | "success" | "danger" | "warning";
}) => {
  const cls =
    tone === "success" ? "border-green-500/30 bg-green-500/5"
    : tone === "danger" ? "border-destructive/30 bg-destructive/5"
    : tone === "warning" ? "border-yellow-500/30 bg-yellow-500/5"
    : "border-border bg-muted/30";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-lg font-semibold tabular-nums">
        {value}{unit && <span className="ml-1 text-xs text-muted-foreground font-normal">{unit}</span>}
      </div>
    </div>
  );
};

export default function CTAcidStimTab({ ct, well, pump }: Props) {
  const [formation, setFormation] = useState<FormationType>("carbonate");
  const [acidSystem, setAcidSystem] = useState<AcidSystem>("HCl-15");
  const [perfLength, setPerfLength] = useState(20);
  const [volumePerM, setVolumePerM] = useState(1.0);
  const [pumpRate, setPumpRate] = useState(Math.max(pump.flowRate * 60, 300));
  const [preflush, setPreflush] = useState(0);
  const [overflush, setOverflush] = useState(5);
  const [reservoirP, setReservoirP] = useState(20);
  const [fracGrad, setFracGrad] = useState(well.fracGradient || 0.017);
  const [surfP, setSurfP] = useState(35);
  const [fricFactor, setFricFactor] = useState(1.0);

  const inputs: AcidStimInputs = useMemo(() => ({
    tvd: well.tvd, md: well.md,
    perforationLength: perfLength,
    formation, acidSystem,
    reservoirPressure: reservoirP,
    fracGradient: fracGrad,
    volumePerMeter: volumePerM,
    pumpRate, whTemp: well.whTemp, bhct: well.bhct,
    ctID: ct.od - 2 * ct.wall,
    pipeFrictionFactor: fricFactor,
    preflushVolume: preflush,
    overflushVolume: overflush,
    surfacePressure: surfP,
  }), [well, ct, formation, acidSystem, perfLength, volumePerM, pumpRate, preflush, overflush, reservoirP, fracGrad, surfP, fricFactor]);

  const r = useMemo(() => calculateAcidStim(inputs), [inputs]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FlaskConical className="w-4 h-4" />
            Кислотная обработка (Matrix Acidizing)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Расчёт объёмов кислоты, макс. расхода ниже Pгрп, химической ёмкости и расписания закачки через ГНКТ.
          </p>
        </CardHeader>
      </Card>

      {/* Inputs */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Параметры обработки</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Тип породы</Label>
              <Select value={formation} onValueChange={(v) => setFormation(v as FormationType)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FORMATION_TYPES.map(f => <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Кислотная система</Label>
              <Select value={acidSystem} onValueChange={(v) => setAcidSystem(v as AcidSystem)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACID_SYSTEMS.map(a => <SelectItem key={a.id} value={a.id}>{a.label} — {a.desc}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Field label="Длина перфорации" value={perfLength} onChange={setPerfLength} unit="м" />
            <Field label="Объём кислоты" value={volumePerM} onChange={setVolumePerM} unit="м³/м" />
            <Field label="Расход закачки" value={pumpRate} onChange={setPumpRate} unit="л/мин" />
            <Field label="Предпоток HCl" value={preflush} onChange={setPreflush} unit="м³" />
            <Field label="Продавка" value={overflush} onChange={setOverflush} unit="м³" />
            <Field label="P пластовое" value={reservoirP} onChange={setReservoirP} unit="MPa" />
            <Field label="Градиент ГРП" value={fracGrad} onChange={setFracGrad} unit="MPa/м" />
            <Field label="Pуст макс. (насос)" value={surfP} onChange={setSurfP} unit="MPa" />
            <Field label="Коэф. трения (×)" value={fricFactor} onChange={setFricFactor} step="0.1" />
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Объём кислоты" value={r.acidVolumeUsed} unit="м³" />
        <KPI label="Рекомендуемый объём" value={r.acidVolumeRecommended} unit="м³" tone="default" />
        <KPI label="Всего жидкости" value={r.totalLiquidVolume} unit="м³" />
        <KPI label="Время закачки" value={r.totalPumpTime} unit="мин" />
        <KPI label="Pзаб расчёт." value={r.bhpAtMaxRate.toFixed(1)}
             unit="MPa"
             tone={r.withinPressureLimit ? "success" : "danger"} />
        <KPI label="Pгрп" value={r.fracPressure.toFixed(1)} unit="MPa" />
        <KPI label="Макс. безоп. расход" value={r.maxAllowableRate} unit="л/мин"
             tone={r.maxAllowableRate >= pumpRate ? "success" : "warning"} />
        <KPI label="Статус" value={r.feasible ? "ОК" : "НЕТ"}
             tone={r.feasible ? "success" : "danger"} />
      </div>

      {/* Chemistry */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Beaker className="w-4 h-4" />Химическая ёмкость</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <KPI label="Растворено породы" value={r.dissolvedRock.toLocaleString()} unit="кг" />
            <KPI label="CO₂ выделится" value={r.co2Generated.toLocaleString()} unit="нм³"
                 tone={r.co2Generated > 100 ? "warning" : "default"} />
            <KPI label="ΔP трение по ГНКТ" value={r.frictionLoss.toFixed(2)} unit="MPa" />
          </div>
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Рекомендации</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {r.recommendations.map((rec, i) => (
              <div key={i} className="text-xs px-3 py-2 rounded-lg bg-muted/40 border border-border/50">{rec}</div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Sensitivity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Чувствительность: Pзаб vs расход</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={r.sensitivity}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="rate" label={{ value: "Расход (л/мин)", position: "insideBottom", offset: -5, fontSize: 11 }} fontSize={11} />
              <YAxis label={{ value: "Давление (MPa)", angle: -90, position: "insideLeft", fontSize: 11 }} fontSize={11} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={r.fracPressure} stroke="#ef4444" strokeDasharray="4 4"
                label={{ value: "Pгрп", fontSize: 10, fill: "#ef4444" }} />
              <ReferenceLine x={pumpRate} stroke="#3b82f6" strokeDasharray="4 4" />
              <Bar dataKey="bhp" name="Pзаб" fill="#16a34a" fillOpacity={0.55} />
              <Line dataKey="surfaceP" name="Pустье" stroke="#a855f7" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Расписание закачки</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left p-2">№</th>
                  <th className="text-left p-2">Стадия</th>
                  <th className="text-left p-2">Жидкость</th>
                  <th className="text-right p-2">V, м³</th>
                  <th className="text-right p-2">Q, л/мин</th>
                  <th className="text-right p-2">t, мин</th>
                  <th className="text-right p-2">ΣV, м³</th>
                  <th className="text-right p-2">Σt, мин</th>
                </tr>
              </thead>
              <tbody>
                {r.stages.map((s, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="p-2 text-muted-foreground">{i + 1}</td>
                    <td className="p-2 font-medium">{s.name}</td>
                    <td className="p-2">{s.fluid}</td>
                    <td className="p-2 text-right tabular-nums">{s.volume}</td>
                    <td className="p-2 text-right tabular-nums">{s.rate}</td>
                    <td className="p-2 text-right tabular-nums">{s.duration}</td>
                    <td className="p-2 text-right tabular-nums">{s.cumVolume}</td>
                    <td className="p-2 text-right tabular-nums">{s.cumTime}</td>
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
