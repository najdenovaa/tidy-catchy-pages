import { useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from "recharts";
import type { PressurePoint } from "@/lib/cementing-calculations";
import CopyImageButton from "./CopyImageButton";

interface Props {
  pressureData: PressurePoint[];
  casingDepthMD: number;
  annVPM: number; // annular volume per meter, m³/m
}

interface ContactData {
  depthMD: number;
  bufferContactMin: number;   // duration buffer is in contact at this depth
  cementFrontMin: number;     // time when cement front arrives at this depth
  bufferFrontMin: number;     // time when buffer front arrives at this depth
  displFrontMin: number;      // time when displacement front arrives at this depth
  totalContactMin: number;    // total non-mud contact time
}

interface FrontPositionData {
  timeMin: number;
  cementTopMD: number;
  bufferTopMD: number;
  cementBottomMD: number;
}

function ScrollableChart({ children, chartRef, height }: { children: React.ReactNode; chartRef: React.RefObject<HTMLDivElement>; height: string }) {
  return (
    <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
      <div ref={chartRef} className={`${height} min-w-[600px]`}>
        {children}
      </div>
    </div>
  );
}

export default function ContactTimeSection({ pressureData, casingDepthMD, annVPM }: Props) {
  const chartRef1 = useRef<HTMLDivElement>(null);
  const chartRef2 = useRef<HTMLDivElement>(null);
  const chartRef3 = useRef<HTMLDivElement>(null);

  const { contactByDepth, frontPositions, summary } = useMemo(() => {
    if (pressureData.length < 2 || casingDepthMD <= 0 || annVPM <= 0) {
      return { contactByDepth: [], frontPositions: [], summary: null };
    }

    // Track fluid front positions over time
    const frontPositions: FrontPositionData[] = [];

    for (const pt of pressureData) {
      // Cement top = casingDepth - cementHeight (from bottom)
      const cementTopMD = casingDepthMD - pt.annCementHeightM;
      const cementBottomMD = casingDepthMD; // cement starts from bottom

      // Buffer sits above cement (or at bottom if no cement)
      const bufferTopMD = cementTopMD - pt.annBufferHeightM;

      frontPositions.push({
        timeMin: pt.time,
        cementTopMD: pt.annCementHeightM > 0 ? cementTopMD : casingDepthMD,
        bufferTopMD: pt.annBufferHeightM > 0 ? bufferTopMD : casingDepthMD,
        cementBottomMD,
      });
    }

    // Calculate contact time at each depth
    const depthStep = Math.max(10, casingDepthMD / 100);
    const contactByDepth: ContactData[] = [];

    for (let d = 0; d <= casingDepthMD; d += depthStep) {
      let bufferStart = -1;
      let bufferEnd = -1;
      let cementArrival = -1;
      let bufferArrival = -1;
      let displArrival = -1;

      for (const fp of frontPositions) {
        // Check if buffer is at this depth
        if (fp.bufferTopMD <= d && fp.cementTopMD >= d) {
          if (bufferStart < 0) {
            bufferStart = fp.timeMin;
            bufferArrival = fp.timeMin;
          }
          bufferEnd = fp.timeMin;
        }

        // Check if cement has reached this depth
        if (fp.cementTopMD <= d && cementArrival < 0) {
          cementArrival = fp.timeMin;
        }
      }

      const bufferContactMin = bufferStart >= 0 && bufferEnd >= 0 ? bufferEnd - bufferStart : 0;
      const totalContactMin = bufferContactMin + (cementArrival >= 0 && bufferArrival >= 0 ? cementArrival - bufferArrival : 0);

      contactByDepth.push({
        depthMD: d,
        bufferContactMin: Math.max(0, bufferContactMin),
        cementFrontMin: cementArrival >= 0 ? cementArrival : 0,
        bufferFrontMin: bufferArrival >= 0 ? bufferArrival : 0,
        displFrontMin: displArrival >= 0 ? displArrival : 0,
        totalContactMin: Math.max(0, totalContactMin),
      });
    }

    // Summary
    const avgBufferContact = contactByDepth.length > 0
      ? contactByDepth.reduce((s, c) => s + c.bufferContactMin, 0) / contactByDepth.length
      : 0;
    const minBufferContact = contactByDepth.length > 0
      ? Math.min(...contactByDepth.filter(c => c.bufferContactMin > 0).map(c => c.bufferContactMin))
      : 0;
    const maxBufferContact = contactByDepth.length > 0
      ? Math.max(...contactByDepth.map(c => c.bufferContactMin))
      : 0;

    // Cement rise time
    const cementFirstAppear = frontPositions.find(fp => fp.cementTopMD < casingDepthMD);
    const cementLastPoint = [...frontPositions].reverse().find(fp => fp.cementTopMD < casingDepthMD);
    const cementRiseTime = cementFirstAppear && cementLastPoint
      ? cementLastPoint.timeMin - cementFirstAppear.timeMin
      : 0;

    return {
      contactByDepth,
      frontPositions,
      summary: {
        avgBufferContact,
        minBufferContact: isFinite(minBufferContact) ? minBufferContact : 0,
        maxBufferContact,
        cementRiseTime,
        finalCementTopMD: frontPositions.length > 0 ? frontPositions[frontPositions.length - 1].cementTopMD : casingDepthMD,
      },
    };
  }, [pressureData, casingDepthMD, annVPM]);

  if (pressureData.length < 2) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Нет данных. Нажмите «РАСЧЁТ».
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
    <div className="space-y-4">
      {/* Summary */}
      {summary && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Сводка по контакту</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <SummaryCard label="Ср. время контакта буфера" value={`${summary.avgBufferContact.toFixed(1)} мин`} />
              <SummaryCard label="Мин. время контакта" value={`${summary.minBufferContact.toFixed(1)} мин`} />
              <SummaryCard label="Макс. время контакта" value={`${summary.maxBufferContact.toFixed(1)} мин`} />
              <SummaryCard label="Время подъёма цемента" value={`${summary.cementRiseTime.toFixed(1)} мин`} />
              <SummaryCard label="Кровля цемента" value={`${summary.finalCementTopMD.toFixed(0)} м`} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chart 1: Front positions vs time */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Фронт флюидов vs Время</CardTitle>
          <CopyImageButton targetRef={chartRef1} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef1} height="h-[350px]">
            <ResponsiveContainer>
              <LineChart data={frontPositions} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="timeMin"
                  label={{ value: "Время, мин", position: "insideBottom", offset: -2, style: { fontSize: 11 } }}
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  reversed
                  domain={[0, casingDepthMD]}
                  label={{ value: "Глубина MD, м", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(0)} м`} labelFormatter={(t: number) => `${t.toFixed(1)} мин`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="stepAfter" dataKey="cementTopMD" name="Кровля цемента" stroke="hsl(0, 0%, 55%)" strokeWidth={2} dot={false} />
                <Line type="stepAfter" dataKey="bufferTopMD" name="Кровля буфера" stroke="hsl(200, 60%, 50%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 2: Contact time vs depth */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Продолжительность контакта буфера vs Глубина</CardTitle>
          <CopyImageButton targetRef={chartRef2} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef2} height="h-[350px]">
            <ResponsiveContainer>
              <AreaChart data={contactByDepth} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="depthMD"
                  label={{ value: "Глубина MD, м", position: "insideBottom", offset: -2, style: { fontSize: 11 } }}
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  label={{ value: "Время контакта, мин", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)} мин`} labelFormatter={(d: number) => `${d.toFixed(0)} м`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="bufferContactMin" name="Контакт буфера" fill="hsl(200, 60%, 50%)" fillOpacity={0.3} stroke="hsl(200, 60%, 50%)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 3: Cement front arrival time vs depth */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Время прихода цементного фронта vs Глубина</CardTitle>
          <CopyImageButton targetRef={chartRef3} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef3} height="h-[350px]">
            <ResponsiveContainer>
              <LineChart data={contactByDepth.filter(c => c.cementFrontMin > 0)} margin={{ top: 10, right: 30, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="cementFrontMin"
                  label={{ value: "Время, мин", position: "insideBottom", offset: -2, style: { fontSize: 11 } }}
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  reversed
                  dataKey="depthMD"
                  label={{ value: "Глубина MD, м", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => name === "depthMD" ? `${v.toFixed(0)} м` : `${v.toFixed(1)} мин`} />
                <Line type="monotone" dataKey="depthMD" name="Глубина фронта" stroke="hsl(0, 0%, 55%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Таблица контакта по глубине</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 px-2">Глубина, м</th>
                  <th className="text-right py-1.5 px-2">Приход буфера, мин</th>
                  <th className="text-right py-1.5 px-2">Приход цемента, мин</th>
                  <th className="text-right py-1.5 px-2">Контакт буфера, мин</th>
                </tr>
              </thead>
              <tbody>
                {contactByDepth.filter((_, i) => i % Math.max(1, Math.floor(contactByDepth.length / 20)) === 0).map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1 px-2">{row.depthMD.toFixed(0)}</td>
                    <td className="text-right py-1 px-2">{row.bufferFrontMin > 0 ? row.bufferFrontMin.toFixed(1) : "—"}</td>
                    <td className="text-right py-1 px-2">{row.cementFrontMin > 0 ? row.cementFrontMin.toFixed(1) : "—"}</td>
                    <td className="text-right py-1 px-2">{row.bufferContactMin > 0 ? row.bufferContactMin.toFixed(1) : "—"}</td>
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold font-mono">{value}</div>
    </div>
  );
}
