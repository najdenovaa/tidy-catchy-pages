import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import type { PressurePoint, StageBoundary } from "@/lib/cementing-calculations";

interface Props {
  pressureData: PressurePoint[];
  safeTime: number;
  cementStartTime: number;
  stopTime: number;
  stageBoundaries: StageBoundary[];
}

const STAGE_COLORS = ["hsl(200, 50%, 55%)", "hsl(120, 40%, 45%)", "hsl(35, 70%, 50%)", "hsl(280, 50%, 55%)", "hsl(340, 50%, 50%)"];

export default function ChartsSection({ pressureData, safeTime, cementStartTime, stopTime, stageBoundaries }: Props) {
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
          </div>
        </CardContent>
      </Card>

      {/* Совмещённый график */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Совмещённый график цементирования</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[450px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pressureData} margin={{ top: 5, right: 60, left: 20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" type="number" domain={[0, maxTime]} ticks={timeTicks} tickFormatter={(v) => `${Math.round(v)}`} label={{ value: "Время, мин", position: "insideBottomRight", offset: -5 }} className="text-xs" />
                <YAxis yAxisId="pressure" label={{ value: "МПа", angle: -90, position: "insideLeft" }} className="text-xs" />
                <YAxis yAxisId="rate" orientation="right" label={{ value: "л/с", angle: 90, position: "insideRight" }} className="text-xs" />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(v) => `Время: ${Number(v).toFixed(1)} мин`}
                  formatter={(value: number, name: string) => {
                    if (name === "Производительность" || name === "Выход на устье") return [value.toFixed(1) + " л/с", name];
                    return [value.toFixed(2) + " МПа", name];
                  }}
                />
                <Legend />
                {safeTimeEnd > 0 && (
                  <ReferenceLine yAxisId="pressure" x={safeTimeEnd} stroke="hsl(45, 90%, 45%)" strokeDasharray="4 4" strokeWidth={2} label={{ value: "75% безоп.", position: "top", fontSize: 10, fill: "hsl(45, 90%, 45%)" }} />
                )}
                {stageBoundaries.filter(b => b.time > 0).map((b, i) => (
                  <ReferenceLine key={`stage-${i}`} yAxisId="pressure" x={b.time} stroke={STAGE_COLORS[i % STAGE_COLORS.length]} strokeDasharray="6 3" strokeWidth={1.5} label={{ value: b.label, position: "top", fontSize: 9, fill: STAGE_COLORS[i % STAGE_COLORS.length] }} />
                ))}
                <Line yAxisId="pressure" type="linear" dataKey="fracturePressure" name="Давление ГРП" stroke="hsl(0, 70%, 50%)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                <Line yAxisId="pressure" type="linear" dataKey="bottomholePressure" name="Давление на забое" stroke="hsl(215, 70%, 45%)" strokeWidth={2} dot={false} />
                <Line yAxisId="pressure" type="linear" dataKey="surfacePressure" name="Давление на насосе" stroke="hsl(160, 60%, 40%)" strokeWidth={2} dot={false} />
                <Line yAxisId="rate" type="stepAfter" dataKey="pumpRateLps" name="Производительность" stroke="hsl(280, 60%, 55%)" strokeWidth={1.5} dot={false} strokeDasharray="3 2" />
                <Line yAxisId="rate" type="linear" dataKey="annularReturnRate" name="Выход на устье" stroke="hsl(30, 80%, 50%)" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Давление на забое vs ГРП */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Давление на забое vs Давление ГРП</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
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
          </div>
        </CardContent>
      </Card>

      {/* Объём vs давление */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Сводный график: объём vs давление</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
