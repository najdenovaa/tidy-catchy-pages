import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, ShieldCheck, Play } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import {
  PLUG_PURPOSE_LABEL, CEMENT_CLASS_LABEL,
  type PlugPurpose, type CementClass,
  checkCompliance, buildUcsCurve, waitOnCementTime, buildAbandonmentString,
} from "@/lib/cement-plug-types";

interface Props {
  plugLengthMD: number;
  plugTopMD: number;
  reservoirPressureMPa?: number;
  bhctC?: number;
  casingShoeMD?: number;
}

export default function CementPlugTypesCard({
  plugLengthMD, plugTopMD, reservoirPressureMPa = 20, bhctC = 60, casingShoeMD = 2700,
}: Props) {
  const [purpose, setPurpose] = useState<PlugPurpose>("abandonment");
  const [cementClass, setCementClass] = useState<CementClass>("G");
  const [tempC, setTempC] = useState(bhctC);
  const [wocHours, setWocHours] = useState(24);
  const [designTestPressureMPa, setDesignTestPressureMPa] = useState(15);
  const [reservoirTopMD, setReservoirTopMD] = useState(plugTopMD + 30);
  const [pRes, setPRes] = useState(reservoirPressureMPa);

  const compliance = useMemo(() => checkCompliance({
    purpose, plugLengthMD, plugTopMD, reservoirTopMD,
    cementClass, bhctC: tempC, wocHours, testPressureMPa: designTestPressureMPa,
    designTestPressureMPa, reservoirPressureMPa: pRes,
  }), [purpose, plugLengthMD, plugTopMD, reservoirTopMD, cementClass, tempC, wocHours, designTestPressureMPa, pRes]);

  const ucsCurve = useMemo(() => buildUcsCurve(cementClass, tempC, 72, 36).map(p => ({
    h: Number(p.hours.toFixed(1)), ucs: Number(p.ucs.toFixed(2)),
  })), [cementClass, tempC]);

  const wocTarget = useMemo(
    () => waitOnCementTime(compliance.requirements.minCompressiveStrengthMPa, cementClass, tempC),
    [compliance, cementClass, tempC]
  );

  const abandonmentSeries = useMemo(() => {
    if (purpose !== "abandonment") return null;
    return buildAbandonmentString({
      reservoirTopMD, casingShoeMD,
      plugLengthM: compliance.requirements.minPlugLengthM,
    });
  }, [purpose, reservoirTopMD, casingShoeMD, compliance]);

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" /> Тип моста, ОЗЦ и нормы РФ
          <Badge variant={compliance.passed ? "default" : "destructive"} className="ml-auto text-[10px]">
            {compliance.passed ? "Соответствует ПБ НГП" : `Несоответствие: ${compliance.checks.filter(c => !c.passed).length}`}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Параметры */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Назначение моста</Label>
            <Select value={purpose} onValueChange={(v) => setPurpose(v as PlugPurpose)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(PLUG_PURPOSE_LABEL) as PlugPurpose[]).map((k) => (
                  <SelectItem key={k} value={k}>{PLUG_PURPOSE_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
          <NumField label="BHCT, °C" value={tempC} onChange={setTempC} step={1} />
          <NumField label="ОЗЦ, ч" value={wocHours} onChange={setWocHours} step={1} />
          <NumField label="P опрессовки, МПа" value={designTestPressureMPa} onChange={setDesignTestPressureMPa} step={0.5} />
          <NumField label="P пласта, МПа" value={pRes} onChange={setPRes} step={0.5} />
          {purpose === "abandonment" && (
            <NumField label="Кровля пласта, м MD" value={reservoirTopMD} onChange={setReservoirTopMD} step={10} />
          )}
        </div>

        {/* Требования и достижения */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Mini k="UCS треб." v={`${compliance.requirements.minCompressiveStrengthMPa.toFixed(1)} МПа`} />
          <Mini k="UCS факт." v={`${compliance.achievedStrengthMPa.toFixed(1)} МПа`}
            good={compliance.achievedStrengthMPa >= compliance.requirements.minCompressiveStrengthMPa} />
          <Mini k="ОЗЦ до цели" v={isFinite(wocTarget) ? `${wocTarget.toFixed(1)} ч` : "недостижимо"} />
          <Mini k="Опрессовка треб." v={`${compliance.requirements.testPressureMPa.toFixed(1)} МПа`} />
        </div>

        {/* Кривая UCS с анимацией ОЗЦ */}
        <UcsAnimatedChart
          curve={ucsCurve}
          wocHours={wocHours}
          minUcs={compliance.requirements.minCompressiveStrengthMPa}
        />


        {/* Чек-лист соответствия */}
        <div className="space-y-1">
          <div className="text-xs font-medium">Проверка по ПБ НГП РФ и API</div>
          {compliance.checks.map((c, i) => (
            <div key={i} className="flex items-start gap-2 text-xs border-b border-border/40 pb-1">
              {c.passed
                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                : <AlertTriangle className="w-3.5 h-3.5 text-destructive mt-0.5 shrink-0" />}
              <div className="flex-1">
                <div className="font-medium">{c.requirement}</div>
                <div className="text-muted-foreground">{c.message}</div>
                {c.reference && <div className="text-[10px] text-muted-foreground italic">{c.reference}</div>}
              </div>
            </div>
          ))}
        </div>

        <div className="text-[11px] text-muted-foreground italic border-l-2 border-primary/30 pl-2">
          {compliance.requirements.notes}
        </div>

        {/* Многомостовая компоновка для ликвидации */}
        {abandonmentSeries && (
          <div className="space-y-1">
            <div className="text-xs font-medium">Серия мостов для ликвидации скважины</div>
            <div className="rounded border border-border/60 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-2 py-1">№</th>
                    <th className="text-left px-2 py-1">Мост</th>
                    <th className="text-right px-2 py-1">Верх, м</th>
                    <th className="text-right px-2 py-1">Низ, м</th>
                    <th className="text-right px-2 py-1">L, м</th>
                  </tr>
                </thead>
                <tbody>
                  {abandonmentSeries.map((s) => (
                    <tr key={s.index} className="border-t border-border/40">
                      <td className="px-2 py-1">{s.index}</td>
                      <td className="px-2 py-1">
                        <div>{s.name}</div>
                        <div className="text-[10px] text-muted-foreground">{s.purpose}</div>
                      </td>
                      <td className="px-2 py-1 text-right">{s.topMD.toFixed(0)}</td>
                      <td className="px-2 py-1 text-right">{s.bottomMD.toFixed(0)}</td>
                      <td className="px-2 py-1 text-right font-medium">{s.lengthM.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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

function Mini({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div className="rounded border border-border/60 px-2 py-1">
      <div className="text-[10px] text-muted-foreground">{k}</div>
      <div className={`font-semibold ${good === true ? "text-emerald-600 dark:text-emerald-400" : good === false ? "text-destructive" : ""}`}>{v}</div>
    </div>
  );
}

/** Анимированная кривая UCS(t) с прогрессом ОЗЦ от 0 до wocHours. */
function UcsAnimatedChart({
  curve, wocHours, minUcs,
}: {
  curve: { h: number; ucs: number }[];
  wocHours: number;
  minUcs: number;
}) {
  const [playT, setPlayT] = useState<number | null>(null);  // текущая "анимированная" точка времени
  const rafRef = useRef<number | null>(null);

  const play = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const start = performance.now();
    const duration = 2500;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setPlayT(t * wocHours);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else { rafRef.current = null; setTimeout(() => setPlayT(null), 800); }
    };
    rafRef.current = requestAnimationFrame(step);
  };

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const animMark = playT ?? wocHours;
  // данные с дополнительным полем "fill" — UCS только до animMark, далее null
  const data = curve.map((p) => ({
    ...p,
    filled: p.h <= animMark ? p.ucs : null,
  }));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-medium">Набор прочности UCS(t)</div>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1" onClick={play}>
          <Play className="w-3 h-3" /> ОЗЦ анимация
        </Button>
      </div>
      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id="ucsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="h" stroke="hsl(var(--muted-foreground))" label={{ value: "ч", position: "insideBottom", offset: -2, fontSize: 10 }} />
            <YAxis stroke="hsl(var(--muted-foreground))" label={{ value: "UCS, МПа", angle: -90, position: "insideLeft", fontSize: 10 }} />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
            <ReferenceLine y={minUcs} stroke="hsl(var(--destructive))" strokeDasharray="4 4" label={{ value: "min", fontSize: 10, fill: "hsl(var(--destructive))" }} />
            <ReferenceLine x={animMark} stroke="hsl(var(--primary))" strokeDasharray="2 2"
              label={{ value: playT !== null ? `${animMark.toFixed(1)} ч` : "ОЗЦ", fontSize: 10, fill: "hsl(var(--primary))" }} />
            {/* фоновая кривая */}
            <Area type="monotone" dataKey="ucs" stroke="hsl(var(--muted-foreground))" strokeOpacity={0.5} fill="transparent" strokeDasharray="2 2" isAnimationActive={false} />
            {/* заливка до animMark */}
            <Area type="monotone" dataKey="filled" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#ucsFill)" isAnimationActive={false} connectNulls={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
