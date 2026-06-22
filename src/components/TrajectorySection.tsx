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
              <CasingSchematic wellData={wellData} trajectory={pts} />
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

// ── Casing Schematic SVG (учитывает зенитный угол) ──

function CasingSchematic({ wellData, trajectory }: { wellData: WellData; trajectory: TrajectoryCalcPoint[] }) {
  const svgW = 320;
  const svgH = 480;
  const marginT = 30;
  const marginB = 40;
  const marginL = 50;
  const marginR = 70;

  const maxDepthMD = Math.max(wellData.wellDepthMD, wellData.casingDepthMD, wellData.prevCasingDepth || 0);
  if (maxDepthMD <= 0) return <div className="text-sm text-muted-foreground text-center py-4">Нет данных о колоннах</div>;

  // Построить путь скважины: (horizontal, TVD) для каждой точки
  // Если траектории нет — построим вертикаль
  const pathPoints: { x: number; tvd: number; md: number }[] = [];
  if (trajectory.length >= 2) {
    for (const p of trajectory) {
      const h = Math.sqrt(p.northM * p.northM + p.eastM * p.eastM);
      pathPoints.push({ x: h, tvd: p.tvd, md: p.md });
    }
  } else {
    // Fallback — вертикальная скважина
    pathPoints.push({ x: 0, tvd: 0, md: 0 });
    pathPoints.push({ x: 0, tvd: wellData.wellDepthTVD || maxDepthMD, md: maxDepthMD });
  }

  const maxX = Math.max(...pathPoints.map(p => p.x), 1);
  const maxTVD = Math.max(...pathPoints.map(p => p.tvd), 1);

  // Масштаб с сохранением пропорций
  const usableW = svgW - marginL - marginR;
  const usableH = svgH - marginT - marginB;
  // Если скважина почти вертикальная — даём X немного места, чтобы стенки колонн были видны
  const effectiveMaxX = Math.max(maxX, maxTVD * 0.05);
  const scaleX = usableW / effectiveMaxX;
  const scaleY = usableH / maxTVD;
  const scale = Math.min(scaleX, scaleY);

  const toX = (xVal: number) => marginL + xVal * scale;
  const toY = (tvdVal: number) => marginT + tvdVal * scale;

  // Интерполяция точки траектории по MD
  const findPoint = (md: number): { x: number; y: number; tvd: number; horiz: number } => {
    if (md <= pathPoints[0].md) {
      return { x: toX(pathPoints[0].x), y: toY(pathPoints[0].tvd), tvd: pathPoints[0].tvd, horiz: pathPoints[0].x };
    }
    for (let i = 1; i < pathPoints.length; i++) {
      if (pathPoints[i].md >= md) {
        const a = pathPoints[i - 1];
        const b = pathPoints[i];
        const t = (md - a.md) / Math.max(1e-6, b.md - a.md);
        const x = a.x + (b.x - a.x) * t;
        const tvd = a.tvd + (b.tvd - a.tvd) * t;
        return { x: toX(x), y: toY(tvd), tvd, horiz: x };
      }
    }
    const last = pathPoints[pathPoints.length - 1];
    return { x: toX(last.x), y: toY(last.tvd), tvd: last.tvd, horiz: last.x };
  };

  // SVG-путь от устья до глубины MD
  const pathToMD = (maxMD: number): string => {
    const segs: string[] = [];
    let drawn = false;
    for (let i = 0; i < pathPoints.length; i++) {
      const p = pathPoints[i];
      if (p.md <= maxMD) {
        segs.push(`${!drawn ? "M" : "L"} ${toX(p.x).toFixed(1)} ${toY(p.tvd).toFixed(1)}`);
        drawn = true;
      } else {
        const pt = findPoint(maxMD);
        segs.push(`L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`);
        break;
      }
    }
    return segs.join(" ");
  };

  // Толщины (px) — пропорционально диаметрам, но с минимумом для видимости
  const maxDiamMm = Math.max(wellData.holeDiameter, wellData.prevCasingID || 0, wellData.casingOD);
  const pxPerMm = maxDiamMm > 0 ? Math.min(0.12, 30 / maxDiamMm) : 0.1;
  const holeWidthPx = Math.max(10, wellData.holeDiameter * pxPerMm);
  const prevCasingWidthPx = Math.max(6, (wellData.prevCasingOD || (wellData.prevCasingID || wellData.holeDiameter) + 20) * pxPerMm);
  const casingWidthPx = Math.max(4, wellData.casingOD * pxPerMm);

  const wellPathAll = pathToMD(wellData.wellDepthMD || maxDepthMD);
  const prevCasingPath = wellData.prevCasingDepth > 0 ? pathToMD(wellData.prevCasingDepth) : "";
  const casingPath = pathToMD(wellData.casingDepthMD);

  const shoePt = findPoint(wellData.casingDepthMD);
  const prevShoePt = wellData.prevCasingDepth > 0 ? findPoint(wellData.prevCasingDepth) : null;
  const bottomPt = findPoint(wellData.wellDepthMD || maxDepthMD);
  const ckodPt = wellData.ckodDepth > 0 ? findPoint(wellData.ckodDepth) : null;

  // TVD-сетка (5 линий)
  const tvdMarks: number[] = [];
  for (let i = 0; i <= 4; i++) tvdMarks.push((maxTVD * i) / 4);

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full max-w-[340px] mx-auto" style={{ height: svgH }}>
      {/* Сетка TVD */}
      {tvdMarks.map((tvd, i) => (
        <g key={i}>
          <line x1={marginL - 4} y1={toY(tvd)} x2={svgW - marginR + 4} y2={toY(tvd)} stroke="hsl(var(--border))" strokeWidth={0.5} strokeDasharray="2,3" opacity={0.5} />
          <text x={marginL - 6} y={toY(tvd) + 3} textAnchor="end" className="text-[7px] fill-muted-foreground">{tvd.toFixed(0)}</text>
        </g>
      ))}
      <text x={10} y={marginT - 12} className="text-[8px] fill-muted-foreground">TVD, м</text>

      {/* Устье */}
      <line x1={marginL - 10} y1={marginT} x2={marginL + 30} y2={marginT} stroke="hsl(var(--foreground))" strokeWidth={2} />
      <text x={marginL - 12} y={marginT - 6} textAnchor="start" className="text-[8px] fill-muted-foreground">Устье (0 м)</text>

      {/* Открытый ствол (от prevShoe до забоя) */}
      {wellData.prevCasingDepth > 0 ? (
        <path d={pathToMD(wellData.wellDepthMD || maxDepthMD).split("M").slice(1).map(s => "M" + s).join(" ")} fill="none" stroke="hsl(30, 25%, 75%)" strokeWidth={holeWidthPx} strokeLinecap="round" opacity={0.55} />
      ) : (
        <path d={wellPathAll} fill="none" stroke="hsl(30, 25%, 75%)" strokeWidth={holeWidthPx} strokeLinecap="round" opacity={0.55} />
      )}

      {/* Предыдущая колонна */}
      {prevCasingPath && (
        <path d={prevCasingPath} fill="none" stroke="hsl(210, 15%, 55%)" strokeWidth={prevCasingWidthPx} strokeLinecap="round" opacity={0.7} />
      )}

      {/* Текущая колонна */}
      <path d={casingPath} fill="none" stroke="hsl(var(--foreground))" strokeWidth={casingWidthPx} strokeLinecap="round" opacity={0.55} />

      {/* Башмак предыдущей колонны */}
      {prevShoePt && (
        <>
          <circle cx={prevShoePt.x} cy={prevShoePt.y} r={3.5} fill="hsl(210, 15%, 45%)" />
          <text x={prevShoePt.x + 6} y={prevShoePt.y - 3} className="text-[7px] fill-muted-foreground">
            Пред. башмак {wellData.prevCasingDepth.toFixed(0)} м
          </text>
        </>
      )}

      {/* Башмак текущей колонны */}
      <path d={`M ${shoePt.x - 7} ${shoePt.y - 1} L ${shoePt.x} ${shoePt.y + 9} L ${shoePt.x + 7} ${shoePt.y - 1} Z`} fill="#FF6B35" stroke="#C84A1F" strokeWidth={0.5} />
      <text x={shoePt.x + 9} y={shoePt.y + 3} className="text-[8px] fill-foreground font-medium">
        Башмак {wellData.casingDepthMD.toFixed(0)} м
      </text>
      <text x={shoePt.x + 9} y={shoePt.y + 12} className="text-[7px] fill-muted-foreground">
        ⌀{wellData.casingOD.toFixed(0)}×{wellData.casingWall.toFixed(1)} мм
      </text>

      {/* ЦКОД */}
      {ckodPt && (
        <>
          <circle cx={ckodPt.x} cy={ckodPt.y} r={3} fill="hsl(0, 70%, 50%)" />
          <text x={ckodPt.x + 6} y={ckodPt.y + 3} className="text-[7px]" fill="hsl(0, 70%, 50%)">
            ЦКОД {wellData.ckodDepth.toFixed(0)} м
          </text>
        </>
      )}

      {/* Забой */}
      <circle cx={bottomPt.x} cy={bottomPt.y} r={4} fill="hsl(30, 30%, 35%)" />
      <text x={bottomPt.x} y={bottomPt.y + 16} textAnchor="middle" className="text-[8px] fill-muted-foreground">
        Забой MD {wellData.wellDepthMD.toFixed(0)} / TVD {bottomPt.tvd.toFixed(0)} м
      </text>

      {/* Горизонтальное отклонение — подпись */}
      {maxX > 5 && (
        <text x={svgW - marginR + 6} y={svgH - marginB + 14} textAnchor="end" className="text-[8px] fill-muted-foreground">
          Гориз. отклонение: {maxX.toFixed(0)} м
        </text>
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
