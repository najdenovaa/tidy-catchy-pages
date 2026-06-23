import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Drill, Gauge, Weight, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import {
  CEMENT_CLASS_LABEL, compressiveStrengthVsTime,
  type CementClass,
} from "@/lib/cement-plug-types";
import {
  calculatePlugLoadCapacity, loadCapacityRecommendations,
} from "@/lib/cement-plug-load-capacity";

interface Props {
  plugLengthM: number;
  boreDiameterMm: number;
  defaultBhctC?: number;
  defaultClass?: CementClass;
  defaultWOCHours?: number;
  /** есть ли открытый ствол в зоне моста (для авто-выбора шероховатости) */
  isOpenHole?: boolean;
}

export default function PlugLoadCapacityCard({
  plugLengthM, boreDiameterMm,
  defaultBhctC = 60, defaultClass = "G", defaultWOCHours = 24,
  isOpenHole = true,
}: Props) {
  const [bhct, setBhct] = useState(defaultBhctC);
  const [cementClass, setCementClass] = useState<CementClass>(defaultClass);
  const [wocHours, setWocHours] = useState(defaultWOCHours);
  const [roughness, setRoughness] = useState(isOpenHole ? 1.2 : 0.5);
  const [designTestPressure, setDesignTestPressure] = useState(15);
  const [toolWeight, setToolWeight] = useState(200);

  const valid = plugLengthM > 0 && boreDiameterMm > 0 && bhct > 0;

  const result = useMemo(() => {
    if (!valid) return null;
    return calculatePlugLoadCapacity({
      cementClass, temperatureC: bhct, wocHours,
      boreDiameterMm, plugLengthM, roughnessFactor: roughness,
      designTestPressureMPa: designTestPressure,
      toolWeightKN: toolWeight,
    });
  }, [valid, cementClass, bhct, wocHours, boreDiameterMm, plugLengthM, roughness, designTestPressure, toolWeight]);

  const recs = useMemo(
    () => result ? loadCapacityRecommendations(result, { designTestPressureMPa: designTestPressure, toolWeightKN: toolWeight }) : [],
    [result, designTestPressure, toolWeight]
  );

  /** Кривые maxTestPressure, sideLoad, weightCapacity vs время */
  const chartData = useMemo(() => {
    if (!valid) return [];
    const D = boreDiameterMm / 1000;
    const L = plugLengthM;
    const A_side = Math.PI * D * L;
    const A_cross = (Math.PI / 4) * D * D;
    const out: { h: number; press: number; side: number; weight: number; ucs: number }[] = [];
    for (let h = 0; h <= 72; h += 2) {
      const ucs = compressiveStrengthVsTime(cementClass, bhct, h);
      const tensile = 0.10 * ucs;
      const shearBond = roughness * tensile;
      const bondLimit = A_cross > 0 ? (shearBond * A_side) / A_cross : 0;
      const press = Math.min(bondLimit, ucs) * 0.8;
      const side = ucs * A_cross * 1000 * 0.5;
      const weight = shearBond * A_side * 1000;
      out.push({ h, press, side, weight, ucs });
    }
    return out;
  }, [valid, cementClass, bhct, roughness, boreDiameterMm, plugLengthM]);

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Drill className="w-4 h-4" />
          Несущая способность моста — разбуривание и опрессовка
          {result && (
            <Badge variant={result.canKickoff && result.hydraulicSeal ? "default" : "destructive"} className="ml-auto text-[10px]">
              UCS {result.ucsMPa.toFixed(1)} МПа · t {wocHours} ч
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Параметры */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Класс цемента</Label>
            <Select value={cementClass} onValueChange={(v) => setCementClass(v as CementClass)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(CEMENT_CLASS_LABEL) as CementClass[]).map((k) => (
                  <SelectItem key={k} value={k}>{CEMENT_CLASS_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <NumField label="BHCT, °C" value={bhct} onChange={setBhct} step={1} />
          <NumField label="ОЗЦ, ч" value={wocHours} onChange={setWocHours} step={1} />
          <NumField label="Шероховатость стенки" value={roughness} onChange={setRoughness} step={0.05} />
          <NumField label="Pопр. план, МПа" value={designTestPressure} onChange={setDesignTestPressure} step={0.5} />
          <NumField label="Вес инструмента, кН" value={toolWeight} onChange={setToolWeight} step={10} />
        </div>
        <div className="text-[10px] text-muted-foreground italic">
          Шероховатость: открытый ствол 1.0–1.5, гладкая обсадная 0.4–0.6, корродированная ОК 0.7–0.9.
        </div>

        {!valid && (
          <div className="text-xs text-muted-foreground italic">
            Задайте длину моста, диаметр ствола и BHCT для расчёта.
          </div>
        )}

        {result && (
          <>
            {/* Свойства цемента в момент t */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Mini k="UCS (одноосное)" v={`${result.ucsMPa.toFixed(2)} МПа`} />
              <Mini k="σ растяжения (0.10·UCS)" v={`${result.tensileMPa.toFixed(2)} МПа`} />
              <Mini k="Сцепление со стенкой" v={`${result.shearBondMPa.toFixed(2)} МПа`} />
            </div>

            {/* 3 блока: kickoff / опрессовка / вес */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* KICKOFF */}
              <CapacityBlock
                icon={<Drill className="w-4 h-4" />}
                title="Зарезка (kickoff)"
                ok={result.canKickoff}
                badText={`UCS < ${result.minUCSForKickoff} МПа`}
                goodText={`UCS ≥ ${result.minUCSForKickoff} МПа — можно зарезать`}
                rows={[
                  { k: "Боковая нагрузка", v: `${result.sideLoadCapacityKN.toFixed(0)} кН` },
                  { k: "Минимум UCS", v: `${result.minUCSForKickoff} МПа` },
                  { k: "Готов к kickoff через", v: isFinite(result.readyForKickoffHours)
                      ? `${result.readyForKickoffHours.toFixed(1)} ч`
                      : "недостижимо" },
                ]}
              />

              {/* ОПРЕССОВКА */}
              <CapacityBlock
                icon={<Gauge className="w-4 h-4" />}
                title="Опрессовка"
                ok={result.hydraulicSeal || designTestPressure === 0}
                badText={`Pопр. > предела моста`}
                goodText={`Предел ${result.maxTestPressureMPa.toFixed(1)} МПа ≥ ${designTestPressure.toFixed(1)} МПа`}
                rows={[
                  { k: "Предел опрессовки", v: `${result.maxTestPressureMPa.toFixed(2)} МПа` },
                  { k: "Запас по давлению", v: isFinite(result.pressureSafetyFactor) ? `×${result.pressureSafetyFactor.toFixed(2)}` : "—" },
                  { k: "Готов к опрессовке через", v: isFinite(result.readyForTestHours)
                      ? `${result.readyForTestHours.toFixed(1)} ч`
                      : "недостижимо" },
                ]}
              />

              {/* ВЕС */}
              <CapacityBlock
                icon={<Weight className="w-4 h-4" />}
                title="Вес инструмента"
                ok={result.weightSafetyFactor >= 1.5 || toolWeight === 0}
                badText={`Запас < 1.5`}
                goodText={`Несёт ${result.weightCapacityKN.toFixed(0)} кН`}
                rows={[
                  { k: "Несущая способность", v: `${result.weightCapacityKN.toFixed(0)} кН` },
                  { k: "Запас по весу", v: isFinite(result.weightSafetyFactor) ? `×${result.weightSafetyFactor.toFixed(2)}` : "—" },
                  { k: "Площадь сцепления", v: `${(Math.PI * (boreDiameterMm/1000) * plugLengthM).toFixed(2)} м²` },
                ]}
              />
            </div>

            {/* Графики во времени */}
            <div>
              <div className="text-xs font-medium mb-1">Несущая способность во времени (ОЗЦ от 0 до 72 ч)</div>
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="h" stroke="hsl(var(--muted-foreground))"
                      label={{ value: "ОЗЦ, ч", position: "insideBottom", offset: -10, fontSize: 10 }} />
                    <YAxis yAxisId="L" stroke="hsl(var(--muted-foreground))"
                      label={{ value: "P, МПа", angle: -90, position: "insideLeft", fontSize: 10 }} />
                    <YAxis yAxisId="R" orientation="right" stroke="hsl(var(--muted-foreground))"
                      label={{ value: "F, кН", angle: 90, position: "insideRight", fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <ReferenceLine yAxisId="L" y={designTestPressure} stroke="hsl(var(--destructive))" strokeDasharray="4 4"
                      label={{ value: `Pопр ${designTestPressure}`, fontSize: 10, fill: "hsl(var(--destructive))" }} />
                    <ReferenceLine yAxisId="R" y={toolWeight} stroke="hsl(40 80% 55%)" strokeDasharray="4 4"
                      label={{ value: `Wинстр ${toolWeight}`, fontSize: 10, fill: "hsl(40 80% 55%)" }} />
                    <ReferenceLine yAxisId="L" x={wocHours} stroke="hsl(var(--primary))" strokeDasharray="2 2"
                      label={{ value: `ОЗЦ ${wocHours}ч`, fontSize: 10, fill: "hsl(var(--primary))" }} />
                    <Line yAxisId="L" type="monotone" dataKey="press" name="Pmax опрессовки, МПа"
                      stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line yAxisId="R" type="monotone" dataKey="weight" name="Несущая способность, кН"
                      stroke="hsl(150 70% 45%)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line yAxisId="R" type="monotone" dataKey="side" name="Боковая нагрузка, кН"
                      stroke="hsl(280 70% 60%)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Рекомендации */}
            <div className="space-y-1">
              {recs.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs border-l-2 border-primary/40 pl-2">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <div>{r}</div>
                </div>
              ))}
            </div>

            <div className="text-[10px] text-muted-foreground italic">
              Физика: σt = 0.10·UCS; shearBond = roughness·σt; Wнес = shearBond·π·D·L;
              Pmax = min(shearBond·π·D·L / (π/4·D²); UCS) · 0.8; Fбок = UCS·A_cross·0.5.
              UCS(t) — кинетика API 10A класса цемента при заданной T.
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NumField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-8 text-xs" />
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded border border-border/60 px-2 py-1">
      <div className="text-[10px] text-muted-foreground">{k}</div>
      <div className="font-semibold">{v}</div>
    </div>
  );
}

function CapacityBlock({
  icon, title, ok, goodText, badText, rows,
}: {
  icon: React.ReactNode;
  title: string;
  ok: boolean;
  goodText: string;
  badText: string;
  rows: { k: string; v: string }[];
}) {
  return (
    <div className={`rounded border p-2 space-y-1 ${ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
      <div className="flex items-center gap-2 text-xs font-semibold">
        {icon}{title}
        {ok
          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 ml-auto" />
          : <AlertTriangle className="w-3.5 h-3.5 text-destructive ml-auto" />}
      </div>
      <div className={`text-[11px] ${ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}`}>
        {ok ? goodText : badText}
      </div>
      <div className="space-y-0.5 pt-1">
        {rows.map((r, i) => (
          <div key={i} className="flex justify-between text-[11px] border-t border-border/40 pt-0.5">
            <span className="text-muted-foreground">{r.k}</span>
            <span className="font-medium">{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
