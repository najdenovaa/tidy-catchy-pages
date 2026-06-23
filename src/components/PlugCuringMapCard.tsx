import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { Thermometer, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  buildPlugCuringMap, CEMENT_CLASS_LABEL,
  type CementClass,
} from "@/lib/cement-plug-types";
import type { TrajectoryPoint } from "@/lib/cementing-calculations";

interface Props {
  plugTopMD: number;
  plugBottomMD: number;
  trajectory?: TrajectoryPoint[];
  /** дефолтная BHCT (можно из основной формы) */
  defaultBhctC?: number;
  /** дефолтный класс цемента */
  defaultClass?: CementClass;
  /** требуемая прочность UCS (МПа) — обычно из назначения моста */
  requiredUcsMPa?: number;
}

export default function PlugCuringMapCard({
  plugTopMD, plugBottomMD, trajectory,
  defaultBhctC = 60, defaultClass = "G", requiredUcsMPa = 3.5,
}: Props) {
  const [bhct, setBhct] = useState(defaultBhctC);
  const [gradient, setGradient] = useState(2.5);          // °C/100 м TVD — типично 2–3
  const [cementClass, setCementClass] = useState<CementClass>(defaultClass);
  const [reqUcs, setReqUcs] = useState(requiredUcsMPa);

  const plugLen = Math.max(0, plugBottomMD - plugTopMD);
  const valid = plugLen > 0 && bhct > 0;

  const map = useMemo(() => {
    if (!valid) return null;
    return buildPlugCuringMap({
      cementClass,
      bhctBottomC: bhct,
      gradientCPer100m: gradient,
      plugTopMD, plugBottomMD,
      trajectory: trajectory?.length ? trajectory.map(t => ({ md: t.md, tvd: t.tvd })) : undefined,
      requiredUcsMPa: reqUcs,
      nodes: 11,
    });
  }, [valid, cementClass, bhct, gradient, plugTopMD, plugBottomMD, trajectory, reqUcs]);

  const chartData = useMemo(() => {
    if (!map) return [];
    // По оси X — MD (верх → низ). Для удобства — сортировка по убыванию глубины (верх слева).
    return [...map.points]
      .sort((a, b) => a.md - b.md)
      .map(p => ({
        md: Number(p.md.toFixed(1)),
        tvd: Number(p.tvd.toFixed(1)),
        T: Number(p.temperatureC.toFixed(1)),
        ucs8: Number(p.ucsAt8h.toFixed(2)),
        ucs12: Number(p.ucsAt12h.toFixed(2)),
        ucs24: Number(p.ucsAt24h.toFixed(2)),
      }));
  }, [map]);

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Thermometer className="w-4 h-4" />
          Температурная карта твердения по длине моста
          {map && (
            <Badge variant={map.spreadHours > 4 ? "destructive" : "secondary"} className="ml-auto text-[10px]">
              Δt твердения: {isFinite(map.spreadHours) ? `${map.spreadHours.toFixed(1)} ч` : "—"}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Параметры */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <NumField label="BHCT низ моста, °C" value={bhct} onChange={setBhct} step={1} />
          <NumField label="Градиент, °C/100м TVD" value={gradient} onChange={setGradient} step={0.1} />
          <NumField label="Треб. UCS, МПа" value={reqUcs} onChange={setReqUcs} step={0.5} />
          <div className="space-y-1">
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
        </div>

        {!valid && (
          <div className="text-xs text-muted-foreground italic">
            Задайте интервал моста и BHCT, чтобы построить карту твердения.
          </div>
        )}

        {map && (
          <>
            {/* Сводка */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <Mini k="Длина моста" v={`${plugLen.toFixed(0)} м`} />
              <Mini k="T низ → верх" v={`${map.points[0].temperatureC.toFixed(1)} → ${map.points[map.points.length-1].temperatureC.toFixed(1)} °C`} />
              <Mini k="Самая медл. точка" v={`MD ${map.slowestPointMD.toFixed(0)} м · ${map.slowestTemperatureC.toFixed(1)}°C`} warn />
              <Mini
                k="Рекоменд. ОЗЦ (по медл.)"
                v={isFinite(map.recommendedWOCHours) ? `${map.recommendedWOCHours.toFixed(1)} ч` : "недостижимо"}
                good={isFinite(map.recommendedWOCHours)}
              />
            </div>

            {/* График UCS vs MD в моменты 8/12/24 ч */}
            <div>
              <div className="text-xs font-medium mb-1">UCS по длине моста — снимки во времени</div>
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="md"
                      stroke="hsl(var(--muted-foreground))"
                      label={{ value: "MD, м (низ → верх)", position: "insideBottom", offset: -10, fontSize: 10 }}
                    />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      label={{ value: "UCS, МПа", angle: -90, position: "insideLeft", fontSize: 10 }}
                    />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <ReferenceLine y={reqUcs} stroke="hsl(var(--destructive))" strokeDasharray="4 4"
                      label={{ value: `треб. ${reqUcs} МПа`, fontSize: 10, fill: "hsl(var(--destructive))" }} />
                    <Line type="monotone" dataKey="ucs8" name="8 ч" stroke="hsl(var(--chart-1, 200 80% 50%))" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="ucs12" name="12 ч" stroke="hsl(var(--chart-2, 280 70% 55%))" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                    <Line type="monotone" dataKey="ucs24" name="24 ч" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* График профиля температуры */}
            <div>
              <div className="text-xs font-medium mb-1">Температура цемента по длине моста</div>
              <div style={{ width: "100%", height: 160 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="md" stroke="hsl(var(--muted-foreground))"
                      label={{ value: "MD, м", position: "insideBottom", offset: -10, fontSize: 10 }} />
                    <YAxis stroke="hsl(var(--muted-foreground))"
                      label={{ value: "T, °C", angle: -90, position: "insideLeft", fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Line type="monotone" dataKey="T" stroke="hsl(20 80% 55%)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Таблица по узлам */}
            <div className="rounded border border-border/60 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-right px-2 py-1">MD, м</th>
                    <th className="text-right px-2 py-1">TVD, м</th>
                    <th className="text-right px-2 py-1">T, °C</th>
                    <th className="text-right px-2 py-1">UCS 8ч</th>
                    <th className="text-right px-2 py-1">UCS 12ч</th>
                    <th className="text-right px-2 py-1">UCS 24ч</th>
                    <th className="text-right px-2 py-1">t до {reqUcs} МПа</th>
                  </tr>
                </thead>
                <tbody>
                  {map.points.map((p, i) => {
                    const isSlow = p.md === map.slowestPointMD;
                    return (
                      <tr key={i} className={`border-t border-border/40 ${isSlow ? "bg-destructive/10" : ""}`}>
                        <td className="px-2 py-1 text-right">{p.md.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{p.tvd.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{p.temperatureC.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{p.ucsAt8h.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{p.ucsAt12h.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right">{p.ucsAt24h.toFixed(1)}</td>
                        <td className="px-2 py-1 text-right font-medium">
                          {isFinite(p.readyTimeHours) ? `${p.readyTimeHours.toFixed(1)} ч` : "∞"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Итог */}
            <div className={`flex items-start gap-2 text-xs rounded border p-2 ${
              isFinite(map.recommendedWOCHours)
                ? "border-emerald-500/40 bg-emerald-500/5"
                : "border-destructive/40 bg-destructive/5"
            }`}>
              {isFinite(map.recommendedWOCHours)
                ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                : <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />}
              <div>
                {isFinite(map.recommendedWOCHours) ? (
                  <>
                    <div>
                      <Clock className="w-3 h-3 inline mr-1" />
                      Рекомендуемое ОЗЦ <b>{map.recommendedWOCHours.toFixed(1)} ч</b> — определено по самой медленной точке
                      (верх моста, MD {map.slowestPointMD.toFixed(0)} м, T {map.slowestTemperatureC.toFixed(1)} °C).
                    </div>
                    {map.spreadHours > 2 && (
                      <div className="text-muted-foreground mt-0.5">
                        Разброс времени твердения по длине моста — {map.spreadHours.toFixed(1)} ч.
                        Низ готов раньше верха. Не разбуривать раньше расчётного ОЗЦ.
                      </div>
                    )}
                  </>
                ) : (
                  <div>
                    Прочность {reqUcs} МПа недостижима для класса <b>{CEMENT_CLASS_LABEL[cementClass]}</b>.
                    Выберите более прочный класс или снизьте требование.
                  </div>
                )}
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground italic">
              Модель: T(z) = BHCT − grad·(TVDниз − TVD)/100; UCS(t) = UCSmax·(1−exp(−k(T)·t));
              k(T) = kref·exp(α·(T−20)). Паспортные kref, α, UCSmax выбранного класса цемента (API Spec 10A).
              ОЗЦ — по самой холодной точке.
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

function Mini({ k, v, good, warn }: { k: string; v: string; good?: boolean; warn?: boolean }) {
  return (
    <div className="rounded border border-border/60 px-2 py-1">
      <div className="text-[10px] text-muted-foreground">{k}</div>
      <div className={`font-semibold ${
        good === true ? "text-emerald-600 dark:text-emerald-400" :
        warn ? "text-amber-500 dark:text-amber-400" : ""
      }`}>{v}</div>
    </div>
  );
}
