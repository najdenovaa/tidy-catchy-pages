import { useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { BlurInput } from "@/components/BlurInput";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ShieldCheck, ShieldAlert, Droplets } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from "recharts";
import { calculatePlugSedimentation } from "@/lib/cement-plug-sedimentation";

interface Props {
  plugLengthM: number;
  boreDiameterMm: number;
  slurryDensityGcm3: number;
  zenithDeg: number;
  gel10secPa: number;
  gel10minPa: number;
  wocHours: number;
}

function num(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function NumField({ label, unit, value, onChange, step = "0.01" }: {
  label: string; unit?: string; value: number;
  onChange: (v: number) => void; step?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}{unit ? ` (${unit})` : ""}</Label>
      <BlurInput type="number" step={step} value={String(value)}
        onCommit={(v) => onChange(num(v))} className="h-8 text-sm" />
    </div>
  );
}

export default function PlugSedimentationCard(props: Props) {
  const [d50, setD50] = useState(30);             // μm
  const [plasmaCp, setPlasmaCp] = useState(5);    // cP
  const [freeWaterPct, setFreeWaterPct] = useState(0.5); // %
  const [gelPlateauPa, setGelPlateauPa] = useState(props.gel10minPa * 2 || 30);
  const [gelPlateauMin, setGelPlateauMin] = useState(60);

  const res = useMemo(() => calculatePlugSedimentation({
    slurryDensityKgM3: props.slurryDensityGcm3 * 1000,
    plasmaViscosityPaS: plasmaCp / 1000,
    particleD50um: d50,
    plugLengthM: props.plugLengthM,
    boreDiameterM: props.boreDiameterMm / 1000,
    zenithDeg: props.zenithDeg,
    freeTimeMin: props.wocHours * 60,
    gel10secPa: props.gel10secPa,
    gel10minPa: props.gel10minPa,
    gelPlateauPa,
    gelPlateauMin,
    freeWaterPct,
  }), [props, d50, plasmaCp, freeWaterPct, gelPlateauPa, gelPlateauMin]);

  const allPass = res.passFreeWater && res.passDensityGradient && res.passBoycott;

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Droplets className="w-4 h-4 text-blue-600" />
          Оседание и сегрегация (Stokes + Boycott + гель-арест)
          <Badge variant={allPass ? "default" : "destructive"} className="ml-auto">
            {allPass ? "В норме" : "Внимание"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Inputs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <NumField label="d50 частиц" unit="μm" value={d50} onChange={setD50} step="1" />
          <NumField label="Вязк. плазмы" unit="cP" value={plasmaCp} onChange={setPlasmaCp} step="0.1" />
          <NumField label="Free water" unit="%" value={freeWaterPct} onChange={setFreeWaterPct} step="0.05" />
          <NumField label="Гель плато" unit="Па" value={gelPlateauPa} onChange={setGelPlateauPa} step="1" />
          <NumField label="Время плато" unit="мин" value={gelPlateauMin} onChange={setGelPlateauMin} step="5" />
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <Mini label="Stokes v_s" value={`${res.stokesVelocityMmH.toFixed(2)} мм/ч`} />
          <Mini label="v_hindered" value={`${res.hinderedVelocityMmH.toFixed(2)} мм/ч`} />
          <Mini label="Boycott E(θ)" value={`×${res.boycottFactor.toFixed(2)}`}
            warn={!res.passBoycott} />
          <Mini label="v_eff" value={`${res.effectiveVelocityMmH.toFixed(2)} мм/ч`} />
          <Mini label="Гель-арест (τ=48 Па)" value={`${res.timeToGelArrestMin.toFixed(0)} мин`} />
          <Mini label="Свободное время" value={`${res.effectiveSettlingTimeMin.toFixed(0)} мин`} />
          <Mini label="Путь оседания Δ" value={`${(res.sedimentationDistanceM * 1000).toFixed(1)} мм`} />
          <Mini label="φ (солиды)" value={`${(res.solidsFraction * 100).toFixed(1)} %`} />
        </div>

        {/* Density gradient */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-medium">
            <span>Распределение плотности по длине моста</span>
            <span>
              Δρ = <span className={res.passDensityGradient ? "text-green-700" : "text-red-700"}>
                {res.densityDeltaKgM3} кг/м³
              </span> (норма ≤ 60)
            </span>
          </div>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={res.profile.map(p => ({
                pos: `${Math.round(p.positionFracFromTop * 100)}%`,
                ρ: p.densityKgM3,
              }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="pos" tick={{ fontSize: 10 }}
                  label={{ value: "позиция от верха моста", position: "insideBottom", offset: -5, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={["dataMin - 20", "dataMax + 20"]}
                  label={{ value: "кг/м³", angle: -90, position: "insideLeft", fontSize: 10 }} />
                <Tooltip />
                <ReferenceLine y={props.slurryDensityGcm3 * 1000} stroke="#888"
                  strokeDasharray="4 4" label={{ value: "ρ исходн.", fontSize: 10 }} />
                <Bar dataKey="ρ" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Верх: {res.densityTopKgM3} кг/м³ (св. вода {res.freeWaterHeightMm.toFixed(1)} мм)</span>
            <span>Низ: {res.densityBottomKgM3} кг/м³</span>
          </div>
        </div>

        {/* Compliance flags */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
          <CheckRow ok={res.passFreeWater} text="API 10B: free water ≤ 0.5 %" />
          <CheckRow ok={res.passDensityGradient} text="РФ ПБ НГП: Δρ ≤ 0.06 г/см³ по длине" />
          <CheckRow ok={res.passBoycott} text="Boycott × ≤ 3 (приемлемый наклон)" />
        </div>

        {/* Warnings */}
        {res.warnings.length > 0 && (
          <div className="space-y-1">
            {res.warnings.map((w, i) => (
              <div key={i} className="text-xs leading-snug">{w}</div>
            ))}
          </div>
        )}

        <Alert>
          <AlertDescription className="text-xs whitespace-pre-line">
            {res.recommendation}
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>
  );
}

function Mini({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded border p-2 ${warn ? "border-red-300 bg-red-50" : "bg-muted/30"}`}>
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function CheckRow({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className={`flex items-center gap-1.5 rounded border p-2 ${ok ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}>
      {ok
        ? <ShieldCheck className="w-3.5 h-3.5 text-green-700 shrink-0" />
        : <ShieldAlert className="w-3.5 h-3.5 text-red-700 shrink-0" />}
      <span>{text}</span>
    </div>
  );
}
