import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from "recharts";
import CopyImageButton from "./CopyImageButton";
import type { WellData } from "@/lib/cementing-calculations";
import { calculateTrajectory, type TrajectoryCalcPoint, type TrajectoryResults } from "@/lib/trajectory-calculations";
import { DebouncedInput } from "./DebouncedInput";

interface Props {
  wellData: WellData;
}

function ScrollableChart({ children, chartRef, height }: { children: React.ReactNode; chartRef: React.RefObject<HTMLDivElement>; height: string }) {
  return (
    <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
      <div ref={chartRef} className={`${height} min-w-[550px]`}>
        {children}
      </div>
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export default function TrajectorySection({ wellData }: Props) {
  const [surfaceTemp, setSurfaceTemp] = useState(15);
  const [vsAzimuth, setVsAzimuth] = useState(0);

  const refs = {
    vs: useRef<HTMLDivElement>(null),
    plan: useRef<HTMLDivElement>(null),
    zenith: useRef<HTMLDivElement>(null),
    azimuth: useRef<HTMLDivElement>(null),
    dls: useRef<HTMLDivElement>(null),
    tortuosity: useRef<HTMLDivElement>(null),
    temp: useRef<HTMLDivElement>(null),
    schematic: useRef<HTMLDivElement>(null),
  };

  const results: TrajectoryResults = useMemo(() => {
    return calculateTrajectory(
      wellData.trajectory,
      surfaceTemp,
      wellData.bottomTempStatic || 80,
      wellData.bottomTempCirc || 60,
      vsAzimuth
    );
  }, [wellData.trajectory, surfaceTemp, wellData.bottomTempStatic, wellData.bottomTempCirc, vsAzimuth]);

  const pts = results.points;

  if (pts.length < 2) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Введите не менее 2 точек инклинометрии во вкладке «Данные» → Профиль скважины.
        </CardContent>
      </Card>
    );
  }

  const maxMD = pts[pts.length - 1].md;

  return (
    <div className="space-y-4">
      {/* Settings */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Азимут верт. секции, °</label>
              <DebouncedInput type="number" value={vsAzimuth} onChange={v => setVsAzimuth(Number(v))} className="w-24 h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Т на поверхности, °C</label>
              <DebouncedInput type="number" value={surfaceTemp} onChange={v => setSurfaceTemp(Number(v))} className="w-24 h-8 text-sm" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Сводка по траектории</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            <MiniCard label="Макс. DLS" value={`${results.maxDLS.toFixed(2)}°/30м`} />
            <MiniCard label="Ср. DLS" value={`${results.avgDLS.toFixed(2)}°/30м`} />
            <MiniCard label="Макс. ИИЗУ" value={`${results.maxBuildRate.toFixed(2)}°/30м`} />
            <MiniCard label="Макс. ΔАзимута" value={`${results.maxTurnRate.toFixed(2)}°/30м`} />
            <MiniCard label="Макс. извилистость" value={`${results.maxTortuosity.toFixed(1)}%`} />
            <MiniCard label="Верт. секция" value={`${results.totalVS.toFixed(1)} м`} />
            <MiniCard label="North" value={`${results.totalNorth.toFixed(1)} м`} />
            <MiniCard label="East" value={`${results.totalEast.toFixed(1)} м`} />
            <MiniCard label="T забой (стат.)" value={`${results.bottomTempStaticC.toFixed(0)}°C`} />
            <MiniCard label="T забой (цирк.)" value={`${results.bottomTempCircC.toFixed(0)}°C`} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 1. Vertical Section */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Вертикальная секция</CardTitle>
            <CopyImageButton targetRef={refs.vs} />
          </CardHeader>
          <CardContent>
            <ScrollableChart chartRef={refs.vs} height="h-[350px]">
              <ResponsiveContainer>
                <LineChart data={pts} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="vsM" label={{ value: "Горизонт. смещение, м", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <YAxis reversed domain={[0, "auto"]} dataKey="tvd" label={{ value: "TVD, м", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)} м`} />
                  <Line type="monotone" dataKey="tvd" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ScrollableChart>
          </CardContent>
        </Card>

        {/* 2. Plan View */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Вид сверху (план)</CardTitle>
            <CopyImageButton targetRef={refs.plan} />
          </CardHeader>
          <CardContent>
            <ScrollableChart chartRef={refs.plan} height="h-[350px]">
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis type="number" dataKey="eastM" name="East" label={{ value: "East, м", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <YAxis type="number" dataKey="northM" name="North" label={{ value: "North, м", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)} м`} />
                  <Scatter data={pts} line={{ stroke: "hsl(var(--primary))", strokeWidth: 2 }} fill="hsl(var(--primary))" r={2} name="Траектория" />
                </ScatterChart>
              </ResponsiveContainer>
            </ScrollableChart>
          </CardContent>
        </Card>

        {/* 3. Zenith angle vs MD */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Зенитный угол vs Глубина</CardTitle>
            <CopyImageButton targetRef={refs.zenith} />
          </CardHeader>
          <CardContent>
            <ScrollableChart chartRef={refs.zenith} height="h-[300px]">
              <ResponsiveContainer>
                <LineChart data={pts} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="md" label={{ value: "MD, м", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <YAxis label={{ value: "Зенит, °", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(2)}°`} labelFormatter={(md: number) => `MD: ${md} м`} />
                  <Line type="monotone" dataKey="zenithDeg" name="Зенитный угол" stroke="hsl(200, 70%, 50%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ScrollableChart>
          </CardContent>
        </Card>

        {/* 4. Azimuth vs MD */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Азимут vs Глубина</CardTitle>
            <CopyImageButton targetRef={refs.azimuth} />
          </CardHeader>
          <CardContent>
            <ScrollableChart chartRef={refs.azimuth} height="h-[300px]">
              <ResponsiveContainer>
                <LineChart data={pts} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="md" label={{ value: "MD, м", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <YAxis domain={[0, 360]} label={{ value: "Азимут, °", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)}°`} labelFormatter={(md: number) => `MD: ${md} м`} />
                  <Line type="monotone" dataKey="azimuthDeg" name="Азимут" stroke="hsl(35, 70%, 50%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ScrollableChart>
          </CardContent>
        </Card>

        {/* 5. DLS + Build Rate + Turn Rate vs MD */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">DLS / ИИЗУ / ΔАзимута vs Глубина</CardTitle>
            <CopyImageButton targetRef={refs.dls} />
          </CardHeader>
          <CardContent>
            <ScrollableChart chartRef={refs.dls} height="h-[300px]">
              <ResponsiveContainer>
                <LineChart data={pts} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="md" label={{ value: "MD, м", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <YAxis label={{ value: "°/30м", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => `${v.toFixed(2)}°/30м`} labelFormatter={(md: number) => `MD: ${md} м`} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="dlsDegPer30m" name="DLS" stroke="hsl(0, 70%, 50%)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="buildRateDegPer30m" name="ИИЗУ" stroke="hsl(200, 70%, 50%)" strokeWidth={1.5} dot={false} strokeDasharray="5 3" />
                  <Line type="monotone" dataKey="turnRateDegPer30m" name="ΔАзимута" stroke="hsl(35, 70%, 50%)" strokeWidth={1.5} dot={false} strokeDasharray="3 3" />
                </LineChart>
              </ResponsiveContainer>
            </ScrollableChart>
          </CardContent>
        </Card>

        {/* 6. Tortuosity vs MD */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Относительная извилистость vs Глубина</CardTitle>
            <CopyImageButton targetRef={refs.tortuosity} />
          </CardHeader>
          <CardContent>
            <ScrollableChart chartRef={refs.tortuosity} height="h-[300px]">
              <ResponsiveContainer>
                <LineChart data={pts} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="md" label={{ value: "MD, м", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <YAxis label={{ value: "Извилистость, %", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(2)}%`} labelFormatter={(md: number) => `MD: ${md} м`} />
                  <Line type="monotone" dataKey="tortuosity" name="Извилистость" stroke="hsl(280, 50%, 55%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </ScrollableChart>
          </CardContent>
        </Card>

        {/* 7. Geothermal gradient */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Геотермический градиент</CardTitle>
            <CopyImageButton targetRef={refs.temp} />
          </CardHeader>
          <CardContent>
            <ScrollableChart chartRef={refs.temp} height="h-[300px]">
              <ResponsiveContainer>
                <LineChart data={pts} margin={{ top: 10, right: 15, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="md" label={{ value: "MD, м", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <YAxis label={{ value: "Температура, °C", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => `${v.toFixed(1)}°C`} labelFormatter={(md: number) => `MD: ${md} м`} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="tempStaticC" name="BHST (статич.)" stroke="hsl(0, 60%, 50%)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="tempCircC" name="BHCT (цирк.)" stroke="hsl(200, 60%, 50%)" strokeWidth={2} dot={false} strokeDasharray="5 3" />
                </LineChart>
              </ResponsiveContainer>
            </ScrollableChart>
          </CardContent>
        </Card>

        {/* 8. Casing Schematic */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Схема расположения колонны</CardTitle>
            <CopyImageButton targetRef={refs.schematic} />
          </CardHeader>
          <CardContent>
            <div ref={refs.schematic}>
              <CasingSchematic wellData={wellData} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trajectory Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Таблица траектории</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 px-1.5">MD, м</th>
                  <th className="text-right py-1.5 px-1.5">TVD, м</th>
                  <th className="text-right py-1.5 px-1.5">Зенит, °</th>
                  <th className="text-right py-1.5 px-1.5">Азимут, °</th>
                  <th className="text-right py-1.5 px-1.5">DLS, °/30м</th>
                  <th className="text-right py-1.5 px-1.5">ИИЗУ, °/30м</th>
                  <th className="text-right py-1.5 px-1.5">North, м</th>
                  <th className="text-right py-1.5 px-1.5">East, м</th>
                  <th className="text-right py-1.5 px-1.5">VS, м</th>
                  <th className="text-right py-1.5 px-1.5">T стат, °C</th>
                </tr>
              </thead>
              <tbody>
                {pts.map((p, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1 px-1.5">{p.md.toFixed(0)}</td>
                    <td className="text-right py-1 px-1.5">{p.tvd.toFixed(1)}</td>
                    <td className="text-right py-1 px-1.5">{p.zenithDeg.toFixed(2)}</td>
                    <td className="text-right py-1 px-1.5">{p.azimuthDeg.toFixed(1)}</td>
                    <td className="text-right py-1 px-1.5">{p.dlsDegPer30m.toFixed(2)}</td>
                    <td className="text-right py-1 px-1.5">{p.buildRateDegPer30m.toFixed(2)}</td>
                    <td className="text-right py-1 px-1.5">{p.northM.toFixed(1)}</td>
                    <td className="text-right py-1 px-1.5">{p.eastM.toFixed(1)}</td>
                    <td className="text-right py-1 px-1.5">{p.vsM.toFixed(1)}</td>
                    <td className="text-right py-1 px-1.5">{p.tempStaticC.toFixed(1)}</td>
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

// ── Casing Schematic SVG ──

function CasingSchematic({ wellData }: { wellData: WellData }) {
  const svgW = 300;
  const svgH = 450;
  const topY = 30;
  const botY = svgH - 30;
  const usableH = botY - topY;
  const centerX = svgW / 2;

  const maxDepth = Math.max(wellData.wellDepthMD, wellData.casingDepthMD, wellData.prevCasingDepth || 0);
  if (maxDepth <= 0) return <div className="text-sm text-muted-foreground text-center py-4">Нет данных о колоннах</div>;

  const scale = usableH / maxDepth;
  const toY = (md: number) => topY + md * scale;

  // Size scale: mm → px (approximate)
  const maxDiamMm = Math.max(wellData.holeDiameter, wellData.prevCasingID || 0, wellData.casingOD);
  const pixPerMm = maxDiamMm > 0 ? 80 / maxDiamMm : 0.3;

  const holeW = wellData.holeDiameter * pixPerMm;
  const casingODw = wellData.casingOD * pixPerMm;
  const casingIDw = (wellData.casingOD - 2 * wellData.casingWall) * pixPerMm;
  const prevCasingIDw = (wellData.prevCasingID || wellData.holeDiameter) * pixPerMm;
  const prevCasingODw = (wellData.prevCasingOD || (wellData.prevCasingID || wellData.holeDiameter) + 20) * pixPerMm;

  const prevShoeY = toY(wellData.prevCasingDepth || 0);
  const casingShoeY = toY(wellData.casingDepthMD);
  const wellBottomY = toY(wellData.wellDepthMD);

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full max-w-[320px] mx-auto" style={{ height: svgH }}>
      {/* Surface */}
      <line x1={0} y1={topY} x2={svgW} y2={topY} stroke="hsl(var(--border))" strokeWidth="2" />
      <text x={centerX} y={topY - 6} textAnchor="middle" className="text-[9px] fill-muted-foreground">Устье (0 м)</text>

      {/* Open hole */}
      <rect x={centerX - holeW / 2} y={prevShoeY} width={holeW} height={Math.max(0, wellBottomY - prevShoeY)} fill="hsl(30, 25%, 85%)" stroke="hsl(30, 30%, 50%)" strokeWidth="1" />
      <text x={centerX + holeW / 2 + 5} y={(prevShoeY + wellBottomY) / 2} className="text-[7px] fill-muted-foreground" dominantBaseline="middle">
        ⌀{wellData.holeDiameter.toFixed(0)} мм
      </text>

      {/* Previous casing */}
      {wellData.prevCasingDepth > 0 && (
        <>
          <rect x={centerX - prevCasingODw / 2} y={topY} width={(prevCasingODw - prevCasingIDw) / 2} height={prevShoeY - topY} fill="hsl(210, 15%, 55%)" opacity={0.6} />
          <rect x={centerX + prevCasingIDw / 2} y={topY} width={(prevCasingODw - prevCasingIDw) / 2} height={prevShoeY - topY} fill="hsl(210, 15%, 55%)" opacity={0.6} />
          <line x1={centerX - prevCasingODw / 2} y1={prevShoeY} x2={centerX + prevCasingODw / 2} y2={prevShoeY} stroke="hsl(210, 15%, 45%)" strokeWidth="2" />
          <text x={centerX - prevCasingODw / 2 - 5} y={prevShoeY + 3} textAnchor="end" className="text-[7px] fill-muted-foreground">
            {(wellData.prevCasingDepth).toFixed(0)} м
          </text>
          <text x={centerX - prevCasingODw / 2 - 5} y={(topY + prevShoeY) / 2} textAnchor="end" className="text-[7px] fill-muted-foreground" dominantBaseline="middle">
            ⌀{(wellData.prevCasingID || 0).toFixed(0)} мм
          </text>
        </>
      )}

      {/* Current casing */}
      <rect x={centerX - casingODw / 2} y={topY} width={(casingODw - casingIDw) / 2} height={casingShoeY - topY} fill="hsl(var(--foreground))" opacity={0.35} />
      <rect x={centerX + casingIDw / 2} y={topY} width={(casingODw - casingIDw) / 2} height={casingShoeY - topY} fill="hsl(var(--foreground))" opacity={0.35} />
      {/* Shoe */}
      <line x1={centerX - casingODw / 2} y1={casingShoeY} x2={centerX + casingODw / 2} y2={casingShoeY} stroke="hsl(var(--foreground))" strokeWidth="2" />
      <text x={centerX + casingODw / 2 + 5} y={casingShoeY + 3} className="text-[7px] fill-foreground">
        Башмак {wellData.casingDepthMD.toFixed(0)} м
      </text>
      <text x={centerX + casingODw / 2 + 5} y={(topY + casingShoeY) / 2} className="text-[7px] fill-muted-foreground" dominantBaseline="middle">
        ⌀{wellData.casingOD.toFixed(0)}×{wellData.casingWall.toFixed(1)} мм
      </text>

      {/* Well bottom */}
      <line x1={centerX - holeW / 2 - 5} y1={wellBottomY} x2={centerX + holeW / 2 + 5} y2={wellBottomY} stroke="hsl(30, 30%, 40%)" strokeWidth="3" />
      <text x={centerX} y={wellBottomY + 14} textAnchor="middle" className="text-[8px] fill-muted-foreground">
        Забой {wellData.wellDepthMD.toFixed(0)} м (TVD {wellData.wellDepthTVD.toFixed(0)} м)
      </text>

      {/* CKOD marker */}
      {wellData.ckodDepth > 0 && (
        <>
          <line x1={centerX - casingIDw / 2} y1={toY(wellData.ckodDepth)} x2={centerX + casingIDw / 2} y2={toY(wellData.ckodDepth)} stroke="hsl(0, 70%, 50%)" strokeWidth="1.5" strokeDasharray="4,2" />
          <text x={centerX - casingODw / 2 - 5} y={toY(wellData.ckodDepth) + 3} textAnchor="end" className="text-[7px]" fill="hsl(0, 70%, 50%)">
            ЦКОД {wellData.ckodDepth.toFixed(0)} м
          </text>
        </>
      )}
    </svg>
  );
}

function MiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className="text-xs font-bold font-mono">{value}</div>
    </div>
  );
}
