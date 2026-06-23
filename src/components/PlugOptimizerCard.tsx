import { useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { BlurInput } from "@/components/BlurInput";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, Trophy } from "lucide-react";
import {
  RadioGroup, RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import {
  optimizePlugDesign, bestUcsCurve, type PlugPurposeOpt,
} from "@/lib/cement-plug-optimizer";

interface Props {
  defaultBHCT?: number;
  defaultBoreMm?: number;
  defaultMaxLengthM?: number;
}

function num(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function NumField({ label, unit, value, onChange, step = "1" }: {
  label: string; unit?: string; value: number; onChange: (v: number) => void; step?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}{unit ? ` (${unit})` : ""}</Label>
      <BlurInput type="number" step={step} value={String(value)}
        onValueCommit={(v) => onChange(num(v))} className="h-8 text-sm" />
    </div>
  );
}

const PURPOSES: { value: PlugPurposeOpt; label: string }[] = [
  { value: "abandonment",   label: "Ликвидация" },
  { value: "kickoff",       label: "Зарезка бок." },
  { value: "pressureTest",  label: "Опрессовка" },
  { value: "lostCirc",      label: "Поглощение" },
];

export default function PlugOptimizerCard(props: Props) {
  const [purpose, setPurpose] = useState<PlugPurposeOpt>("abandonment");
  const [bhct, setBhct] = useState(props.defaultBHCT ?? 60);
  const [bore, setBore] = useState(props.defaultBoreMm ?? 215.9);
  const [maxLen, setMaxLen] = useState(props.defaultMaxLengthM ?? 100);
  const [testP, setTestP] = useState(15);

  const res = useMemo(() => optimizePlugDesign({
    purpose,
    bhctC: bhct,
    boreDiameterMm: bore,
    maxPlugLengthM: maxLen,
    testPressureMPa: testP,
    lengthStepM: 10,
  }), [purpose, bhct, bore, maxLen, testP]);

  const curve = useMemo(() =>
    res.best ? bestUcsCurve(res.best, bhct, Math.max(48, Math.ceil(res.best.wocHours * 1.5))) : [],
    [res.best, bhct]);

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-600" />
          Оптимизатор конструкции моста (минимум ОЗЦ при соблюдении норм)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Purpose */}
        <div className="space-y-1.5">
          <Label className="text-xs">Назначение моста</Label>
          <RadioGroup value={purpose} onValueChange={(v) => setPurpose(v as PlugPurposeOpt)}
            className="grid grid-cols-2 md:grid-cols-4 gap-1">
            {PURPOSES.map(p => (
              <label key={p.value}
                className={`flex items-center gap-1.5 rounded border p-2 text-xs cursor-pointer ${purpose === p.value ? "border-primary bg-primary/5" : ""}`}>
                <RadioGroupItem value={p.value} id={`opt-${p.value}`} />
                {p.label}
              </label>
            ))}
          </RadioGroup>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <NumField label="BHCT" unit="°C" value={bhct} onChange={setBhct} />
          <NumField label="Ø ствола" unit="мм" value={bore} onChange={setBore} step="0.1" />
          <NumField label="L_max" unit="м" value={maxLen} onChange={setMaxLen} step="5" />
          {purpose === "pressureTest" && (
            <NumField label="P_опресс." unit="МПа" value={testP} onChange={setTestP} step="0.5" />
          )}
        </div>

        <div className="text-[11px] text-muted-foreground">
          Норма: {res.normNote}. UCS_цель = <b>{res.ucsTargetMPa.toFixed(1)} МПа</b>,
          L_min = <b>{res.minLengthM} м</b>.
        </div>

        {/* Best */}
        {res.best ? (
          <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-medium">Оптимум</span>
              <Badge variant="default" className="ml-auto">{res.best.wocHours} ч ОЗЦ</Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <Mini label="Цемент" value={res.best.cementLabel} />
              <Mini label="Длина моста" value={`${res.best.plugLengthM} м`} />
              <Mini label="UCS цель" value={`${res.best.ucsTargetMPa.toFixed(1)} МПа`} />
              <Mini label="Объём цемента" value={`${res.best.cementVolumeM3} м³`} />
            </div>
          </div>
        ) : (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">
              Нет реализуемых вариантов. Увеличьте BHCT, измените класс цемента или снизьте требования.
            </AlertDescription>
          </Alert>
        )}

        {/* UCS curve */}
        {curve.length > 0 && res.best && (
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <LineChart data={curve}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hours" tick={{ fontSize: 10 }}
                  label={{ value: "ОЗЦ, ч", position: "insideBottom", offset: -5, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }}
                  label={{ value: "UCS, МПа", angle: -90, position: "insideLeft", fontSize: 10 }} />
                <Tooltip />
                <ReferenceLine y={res.ucsTargetMPa} stroke="#dc2626" strokeDasharray="4 4"
                  label={{ value: `цель ${res.ucsTargetMPa.toFixed(1)}`, fontSize: 10, fill: "#dc2626" }} />
                <ReferenceLine x={res.best.wocHours} stroke="#16a34a" strokeDasharray="4 4"
                  label={{ value: `${res.best.wocHours} ч`, fontSize: 10, fill: "#16a34a" }} />
                <Line type="monotone" dataKey="ucs" stroke="#2563eb" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Top alternatives */}
        {res.top.length > 1 && (
          <div className="space-y-1">
            <div className="text-xs font-medium">Альтернативы (топ-5):</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left p-1.5">#</th>
                    <th className="text-left p-1.5">Цемент</th>
                    <th className="text-right p-1.5">L, м</th>
                    <th className="text-right p-1.5">V, м³</th>
                    <th className="text-right p-1.5">ОЗЦ, ч</th>
                  </tr>
                </thead>
                <tbody>
                  {res.top.map((c, i) => (
                    <tr key={i} className={`border-t ${i === 0 ? "bg-amber-50" : ""}`}>
                      <td className="p-1.5">{i + 1}</td>
                      <td className="p-1.5">{c.cementLabel}</td>
                      <td className="text-right p-1.5">{c.plugLengthM}</td>
                      <td className="text-right p-1.5">{c.cementVolumeM3}</td>
                      <td className="text-right p-1.5 font-medium">{c.wocHours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {res.warnings.length > 0 && (
          <div className="space-y-1">
            {res.warnings.map((w, i) => <div key={i} className="text-xs">{w}</div>)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border p-2 bg-white">
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
