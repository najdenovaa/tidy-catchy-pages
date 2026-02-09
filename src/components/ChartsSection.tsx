import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import type { PressurePoint } from "@/lib/cementing-calculations";

interface Props {
  pressureData: PressurePoint[];
}

export default function ChartsSection({ pressureData }: Props) {
  if (pressureData.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Нет данных для построения графиков. Заполните все вкладки.
        </CardContent>
      </Card>
    );
  }

  const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">11. Давление на забое vs Давление ГРП</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pressureData} margin={{ top: 5, right: 30, left: 20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" label={{ value: "Время, мин", position: "insideBottomRight", offset: -5 }} className="text-xs" />
                <YAxis label={{ value: "МПа", angle: -90, position: "insideLeft" }} className="text-xs" />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Время: ${Number(v).toFixed(1)} мин`} formatter={(value: number, name: string) => [value.toFixed(2) + " МПа", name]} />
                <Legend />
                <Line type="monotone" dataKey="bottomholePressure" name="Забойное давление" stroke="hsl(215, 70%, 45%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="fracturePressure" name="Давление ГРП" stroke="hsl(0, 70%, 50%)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Давление на устье</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pressureData} margin={{ top: 5, right: 30, left: 20, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="time" label={{ value: "Время, мин", position: "insideBottomRight", offset: -5 }} className="text-xs" />
                <YAxis label={{ value: "МПа", angle: -90, position: "insideLeft" }} className="text-xs" />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `Время: ${Number(v).toFixed(1)} мин`} formatter={(value: number, name: string) => [value.toFixed(2) + " МПа", name]} />
                <Legend />
                <Line type="monotone" dataKey="surfacePressure" name="Устьевое давление" stroke="hsl(220, 70%, 50%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

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
                <Line type="monotone" dataKey="surfacePressure" name="На устье" stroke="hsl(220, 70%, 50%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="bottomholePressure" name="На забое" stroke="hsl(215, 70%, 45%)" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="fracturePressure" name="ГРП" stroke="hsl(0, 70%, 50%)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
