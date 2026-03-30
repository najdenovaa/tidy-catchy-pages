import { useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceArea } from "recharts";
import type { PressurePoint, StageBoundary } from "@/lib/cementing-calculations";
import CopyImageButton from "./CopyImageButton";

function ScrollableChart({ children, chartRef, height }: { children: React.ReactNode; chartRef: React.RefObject<HTMLDivElement>; height: string }) {
  return (
    <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
      <div ref={chartRef} className={`${height} min-w-[700px]`}>
        {children}
      </div>
    </div>
  );
}

interface Props {
  pressureData: PressurePoint[];
  safeTime: number;
  cementStartTime: number;
  stopTime: number;
  stageBoundaries: StageBoundary[];
  equilibriumTimeMin: number;
}

const STAGE_COLORS = ["hsl(200, 50%, 55%)", "hsl(120, 40%, 45%)", "hsl(35, 70%, 50%)", "hsl(280, 50%, 55%)", "hsl(340, 50%, 50%)"];

export default function ChartsSection({ pressureData, safeTime, cementStartTime, stopTime, stageBoundaries, equilibriumTimeMin }: Props) {
  const chartRef1 = useRef<HTMLDivElement>(null);
  const chartRef2 = useRef<HTMLDivElement>(null);
  const chartRef3 = useRef<HTMLDivElement>(null);
  const chartRef4 = useRef<HTMLDivElement>(null);
  const chartRef5 = useRef<HTMLDivElement>(null);

  if (pressureData.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Нет данных для построения графиков. Заполните все вкладки.
        </CardContent>
      </Card>
    );
  }

  const maxTime = Math.ceil(pressureData[pressureData.length - 1]?.time || 0);
  const timeTicks = Array.from({ length: maxTime + 1 }, (_, i) => i);

  const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
  };

  const safeTimeEnd = cementStartTime + safeTime;

  return (
    <div className="space-y-6">
      {/* Безопасное время */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-muted-foreground">Начало закачки цемента:</span>{" "}
              <span className="font-semibold">{cementStartTime.toFixed(1)} мин</span>
            </div>
            <div>
              <span className="text-muted-foreground">Время СТОП:</span>{" "}
              <span className="font-semibold">{stopTime.toFixed(1)} мин</span>
            </div>
            <div>
              <span className="text-muted-foreground">Время работы с цементом:</span>{" "}
              <span className="font-semibold">{(stopTime - cementStartTime).toFixed(1)} мин</span>
            </div>
            <div className={safeTime > 0 ? "text-green-700 font-semibold" : ""}>
              <span className="text-muted-foreground">Безопасное время (75%):</span>{" "}
              <span className="font-bold">{safeTime.toFixed(1)} мин</span>
            </div>
            <div>
              <span className="text-muted-foreground">Время равновесия (U-tube):</span>{" "}
              <span className="font-semibold">{equilibriumTimeMin > 0 ? `~${equilibriumTimeMin.toFixed(0)} мин после остановки` : "—"}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Совмещённый график */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Совмещённый график цементирования</CardTitle>
            <CopyImageButton targetRef={chartRef1} />
          </div>
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef1} height="h-[550px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pressureData} margin={{ top: 20, right: 115, left: 25, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.5} />
                <XAxis dataKey="time" type="number" domain={[0, maxTime]} ticks={timeTicks} tickFormatter={(v) => `${Math.round(v)}`} label={{ value: "Время, мин", position: "insideBottomRight", offset: -10, fontSize: 12 }} className="text-xs" />
                <YAxis yAxisId="pressure" domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.15)]} label={{ value: "Давление, МПа", angle: -90, position: "insideLeft", offset: -5, fontSize: 12 }} className="text-xs" width={55} />
                <YAxis yAxisId="rate" orientation="right" domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.3)]} label={{ value: "Расход, л/с", angle: 90, position: "insideRight", offset: 5, fontSize: 12 }} className="text-xs" width={50} />
                <YAxis yAxisId="density" orientation="right" domain={[(dataMin: number) => Math.floor(Math.max(0, dataMin - 0.2) * 10) / 10, (dataMax: number) => Math.ceil((dataMax + 0.2) * 10) / 10]} label={{ value: "ρ, г/см³", angle: 90, position: "insideRight", offset: 5, fontSize: 12 }} className="text-xs" width={50} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Время: ${Number(v).toFixed(1)} мин`} formatter={(value: number, name: string) => { if (name === "Производительность" || name === "Выход на устье") return [value.toFixed(1) + " л/с", name]; if (name === "Плотность закачки") return [value.toFixed(2) + " г/см³", name]; return [value.toFixed(2) + " МПа", name]; }} />
                <Legend wrapperStyle={{ paddingTop: "10px", fontSize: "12px" }} />
                
                {stageBoundaries.map((b, i) => <ReferenceLine key={`stage-${i}`} yAxisId="pressure" x={b.time} stroke={STAGE_COLORS[i % STAGE_COLORS.length]} strokeDasharray="6 3" strokeWidth={1.5} label={{ value: b.label, position: "insideTopLeft", fontSize: 9, fill: STAGE_COLORS[i % STAGE_COLORS.length], fontWeight: 600 }} />)}
                <Line yAxisId="pressure" type="linear" dataKey="fracturePressure" name="Давление ГРП" stroke="hsl(0, 70%, 50%)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                <Line yAxisId="pressure" type="linear" dataKey="bottomholePressure" name="Давление на забое" stroke="hsl(215, 70%, 45%)" strokeWidth={2} dot={false} />
                <Line yAxisId="pressure" type="linear" dataKey="surfacePressure" name="Давление на насосе" stroke="hsl(160, 60%, 40%)" strokeWidth={2} dot={false} />
                <Line yAxisId="rate" type="stepAfter" dataKey="pumpRateLps" name="Производительность" stroke="hsl(280, 60%, 55%)" strokeWidth={1.5} dot={false} strokeDasharray="3 2" />
                <Line yAxisId="density" type="stepAfter" dataKey="densityGcm3" name="Плотность закачки" stroke="hsl(345, 80%, 35%)" strokeWidth={2.5} dot={false} />
                <Line yAxisId="rate" type="linear" dataKey="annularReturnRate" name="Выход на устье" stroke="hsl(30, 80%, 50%)" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Давление на забое vs ГРП */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Давление на забое vs Давление ГРП</CardTitle>
            <CopyImageButton targetRef={chartRef2} />
          </div>
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef2} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pressureData} margin={{ top: 5, right: 30, left: 20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" type="number" domain={[0, maxTime]} ticks={timeTicks} tickFormatter={(v) => `${Math.round(v)}`} label={{ value: "Время, мин", position: "insideBottomRight", offset: -5 }} className="text-xs" />
                <YAxis label={{ value: "МПа", angle: -90, position: "insideLeft" }} className="text-xs" />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Время: ${Number(v).toFixed(1)} мин`} formatter={(value: number, name: string) => [value.toFixed(2) + " МПа", name]} />
                <Legend />
                <Line type="linear" dataKey="bottomholePressure" name="Забойное давление" stroke="hsl(215, 70%, 45%)" strokeWidth={2} dot={false} />
                <Line type="linear" dataKey="fracturePressure" name="Давление ГРП" stroke="hsl(0, 70%, 50%)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Объём vs давление */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Сводный график: объём vs давление</CardTitle>
            <CopyImageButton targetRef={chartRef3} />
          </div>
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef3} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pressureData} margin={{ top: 5, right: 30, left: 20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="cumulativeVolume" label={{ value: "Накопит. объём, м³", position: "insideBottomRight", offset: -5 }} className="text-xs" />
                <YAxis label={{ value: "МПа", angle: -90, position: "insideLeft" }} className="text-xs" />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Объём: ${Number(v).toFixed(1)} м³`} formatter={(value: number, name: string) => [value.toFixed(2) + " МПа", name]} />
                <Legend />
                <Line type="linear" dataKey="surfacePressure" name="На устье" stroke="hsl(220, 70%, 50%)" strokeWidth={2} dot={false} />
                <Line type="linear" dataKey="bottomholePressure" name="На забое" stroke="hsl(215, 70%, 45%)" strokeWidth={2} dot={false} />
                <Line type="linear" dataKey="fracturePressure" name="ГРП" stroke="hsl(0, 70%, 50%)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* План продавки */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">План продавки: давления и макс. производительность</CardTitle>
            <CopyImageButton targetRef={chartRef4} />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Макс. производительность — предельная скорость закачки, при которой забойное давление не превышает давление ГРП. Оператор должен придерживаться указанных ограничений.
          </p>
          <ScrollableChart chartRef={chartRef4} height="h-[500px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pressureData} margin={{ top: 20, right: 65, left: 25, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.5} />
                <XAxis dataKey="time" type="number" domain={[0, maxTime]} ticks={timeTicks} tickFormatter={(v) => `${Math.round(v)}`} label={{ value: "Время, мин", position: "insideBottomRight", offset: -10, fontSize: 12 }} className="text-xs" />
                <YAxis yAxisId="pressure" domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.15)]} label={{ value: "Давление, МПа", angle: -90, position: "insideLeft", offset: -5, fontSize: 12 }} className="text-xs" width={55} />
                <YAxis yAxisId="rate" orientation="right" domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.3)]} label={{ value: "Расход, л/с", angle: 90, position: "insideRight", offset: -5, fontSize: 12 }} className="text-xs" width={55} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Время: ${Number(v).toFixed(1)} мин`} formatter={(value: number, name: string) => { if (name.includes("л/с") || name.includes("Производительность") || name.includes("Макс.")) return [value.toFixed(1) + " л/с", name]; return [value.toFixed(2) + " МПа", name]; }} />
                <Legend wrapperStyle={{ paddingTop: "10px", fontSize: "12px" }} />
                {stageBoundaries.map((b, i) => <ReferenceLine key={`plan-stage-${i}`} yAxisId="pressure" x={b.time} stroke={STAGE_COLORS[i % STAGE_COLORS.length]} strokeDasharray="6 3" strokeWidth={1.5} label={{ value: b.label, position: "insideTopLeft", fontSize: 9, fill: STAGE_COLORS[i % STAGE_COLORS.length], fontWeight: 600 }} />)}
                <Line yAxisId="pressure" type="linear" dataKey="fracturePressure" name="Давление ГРП" stroke="hsl(0, 70%, 50%)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                <Line yAxisId="pressure" type="linear" dataKey="bottomholePressure" name="Давление на забое" stroke="hsl(215, 70%, 45%)" strokeWidth={2} dot={false} />
                <Line yAxisId="pressure" type="linear" dataKey="surfacePressure" name="Давление на насосе" stroke="hsl(160, 60%, 40%)" strokeWidth={2} dot={false} />
                <Line yAxisId="rate" type="stepAfter" dataKey="pumpRateLps" name="Производительность (факт)" stroke="hsl(280, 60%, 55%)" strokeWidth={1.5} dot={false} strokeDasharray="3 2" />
                <Line yAxisId="rate" type="linear" dataKey="maxSafeRateLps" name="Макс. безопасная Q, л/с" stroke="hsl(25, 90%, 50%)" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Режим потока */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Режим потока в затрубном пространстве</CardTitle>
            <CopyImageButton targetRef={chartRef5} />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            Режим потока зависит от производительности: при высокой скорости закачки Re растёт и поток переходит из ламинарного в переходный/турбулентный.
          </p>
          <div className="flex flex-wrap gap-4 mb-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "hsla(120, 50%, 50%, 0.15)", border: "1px solid hsla(120, 50%, 50%, 0.4)" }} />
              <span className="text-muted-foreground">Ламинарный: <span className="font-semibold text-foreground">Re &lt; 2100</span></span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "hsla(45, 80%, 50%, 0.15)", border: "1px solid hsla(45, 80%, 50%, 0.4)" }} />
              <span className="text-muted-foreground">Переходный: <span className="font-semibold text-foreground">2100 ≤ Re &lt; 3000</span></span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: "hsla(0, 70%, 50%, 0.12)", border: "1px solid hsla(0, 70%, 50%, 0.4)" }} />
              <span className="text-muted-foreground">Турбулентный: <span className="font-semibold text-foreground">Re ≥ 3000</span></span>
            </div>
          </div>
          {(() => {
            const maxRe = Math.max(...pressureData.map(p => p.reynoldsAnn || 0), 3500);
            const reYMax = Math.ceil(maxRe * 1.2);
            return (
              <ScrollableChart chartRef={chartRef5} height="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={pressureData} margin={{ top: 5, right: 65, left: 25, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.5} />
                    {/* Цветные зоны режимов */}
                    <ReferenceArea yAxisId="re" y1={0} y2={2100} fill="hsla(120, 50%, 50%, 0.08)" />
                    <ReferenceArea yAxisId="re" y1={2100} y2={3000} fill="hsla(45, 80%, 50%, 0.08)" />
                    <ReferenceArea yAxisId="re" y1={3000} y2={reYMax} fill="hsla(0, 70%, 50%, 0.06)" />
                    <XAxis dataKey="time" type="number" domain={[0, maxTime]} ticks={timeTicks} tickFormatter={(v) => `${Math.round(v)}`} label={{ value: "Время, мин", position: "insideBottomRight", offset: -5, fontSize: 12 }} className="text-xs" />
                    <YAxis yAxisId="re" domain={[0, reYMax]} label={{ value: "Re", angle: -90, position: "insideLeft", offset: -5, fontSize: 12 }} className="text-xs" width={55} />
                    <YAxis yAxisId="rate" orientation="right" domain={[0, (dataMax: number) => Math.ceil(dataMax * 1.3)]} label={{ value: "Расход, л/с", angle: 90, position: "insideRight", offset: -5, fontSize: 12 }} className="text-xs" width={55} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Время: ${Number(v).toFixed(1)} мин`} formatter={(value: number, name: string) => {
                      if (name === "Производительность") return [value.toFixed(1) + " л/с", name];
                      if (name === "Re (затрубье)") {
                        const re = Math.round(value);
                        const regime = re < 2100 ? "Ламинарный" : re < 3000 ? "Переходный" : "Турбулентный";
                        return [`${re} (${regime})`, name];
                      }
                      return [value.toString(), name];
                    }} />
                    <Legend wrapperStyle={{ paddingTop: "10px", fontSize: "12px" }} />
                    <ReferenceLine yAxisId="re" y={2100} stroke="hsl(45, 80%, 50%)" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: "Re = 2100", position: "right", fontSize: 10, fill: "hsl(45, 80%, 40%)" }} />
                    <ReferenceLine yAxisId="re" y={3000} stroke="hsl(0, 70%, 50%)" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: "Re = 3000", position: "right", fontSize: 10, fill: "hsl(0, 70%, 50%)" }} />
                    {stageBoundaries.map((b, i) => <ReferenceLine key={`regime-stage-${i}`} yAxisId="re" x={b.time} stroke={STAGE_COLORS[i % STAGE_COLORS.length]} strokeDasharray="6 3" strokeWidth={1} />)}
                    <Line yAxisId="re" type="linear" dataKey="reynoldsAnn" name="Re (затрубье)" stroke="hsl(200, 60%, 50%)" strokeWidth={2.5} dot={false} />
                    <Line yAxisId="rate" type="stepAfter" dataKey="pumpRateLps" name="Производительность" stroke="hsl(280, 60%, 55%)" strokeWidth={1.5} dot={false} strokeDasharray="3 2" />
                  </LineChart>
                </ResponsiveContainer>
              </ScrollableChart>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}
