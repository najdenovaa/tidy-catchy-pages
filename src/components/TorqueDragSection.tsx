import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { calculateTDSummary, calculateTD, type TDInput, type TDMode, type TDResult, type TDSummary } from "@/lib/torque-drag-calculations";
import type { WellData } from "@/lib/cementing-calculations";
import { getCasingID } from "@/lib/cementing-calculations";
import CopyImageButton from "./CopyImageButton";

interface Props {
  wellData: WellData;
  mudDensity: number; // кг/м³
}

const fmt = (v: number, dec = 2) => v.toFixed(dec);

function ScrollableChart({ children, chartRef, height }: { children: React.ReactNode; chartRef: React.RefObject<HTMLDivElement>; height: string }) {
  return (
    <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
      <div ref={chartRef} className={`${height} min-w-[700px]`}>
        {children}
      </div>
    </div>
  );
}

export default function TorqueDragSection({ wellData, mudDensity }: Props) {
  const [frictionCased, setFrictionCased] = useState(0.20);
  const [frictionOpenhole, setFrictionOpenhole] = useState(0.30);
  const [pipeWeight, setPipeWeight] = useState(47); // кг/м
  const [wob, setWob] = useState(50); // кН
  const [rpm, setRpm] = useState(60);
  const [blockWeight, setBlockWeight] = useState(20); // кН

  const chartRef1 = useRef<HTMLDivElement>(null);
  const chartRef2 = useRef<HTMLDivElement>(null);
  const chartRef3 = useRef<HTMLDivElement>(null);
  const chartRef4 = useRef<HTMLDivElement>(null);

  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);

  const summary = useMemo<TDSummary | null>(() => {
    if (!wellData.casingDepthMD || wellData.casingDepthMD <= 0) return null;
    const input: TDInput = {
      trajectory: wellData.trajectory,
      wellDepthMD: wellData.wellDepthMD,
      casingDepthMD: wellData.casingDepthMD,
      casingShoe: wellData.prevCasingDepth,
      holeDiameter: wellData.holeDiameter,
      casingOD: wellData.casingOD,
      casingID: wellData.prevCasingID || casingID,
      pipeWeightKgPerM: pipeWeight,
      mudDensity: mudDensity / 1000,
      frictionCased,
      frictionOpenhole,
      wob,
      rpm,
      blockWeight,
    };
    return calculateTDSummary(input);
  }, [wellData, mudDensity, frictionCased, frictionOpenhole, pipeWeight, wob, rpm, blockWeight, casingID]);

  const drillResult = useMemo<TDResult | null>(() => {
    if (!wellData.casingDepthMD || wellData.casingDepthMD <= 0) return null;
    const input: TDInput = {
      trajectory: wellData.trajectory,
      wellDepthMD: wellData.wellDepthMD,
      casingDepthMD: wellData.casingDepthMD,
      casingShoe: wellData.prevCasingDepth,
      holeDiameter: wellData.holeDiameter,
      casingOD: wellData.casingOD,
      casingID: wellData.prevCasingID || casingID,
      pipeWeightKgPerM: pipeWeight,
      mudDensity: mudDensity / 1000,
      frictionCased,
      frictionOpenhole,
      wob,
      rpm,
      blockWeight,
    };
    return calculateTD(input, 'drill_rotary');
  }, [wellData, mudDensity, frictionCased, frictionOpenhole, pipeWeight, wob, rpm, blockWeight, casingID]);

  if (!summary) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Заполните данные скважины для расчёта Torque & Drag
        </CardContent>
      </Card>
    );
  }

  // Prepare chart data (depth on Y axis — inverted)
  const chartData = summary.tripIn.points.map((pt, i) => ({
    md: pt.md,
    tripInHL: summary.tripIn.points[i]?.hookLoad ?? 0,
    tripOutHL: summary.tripOut.points[i]?.hookLoad ?? 0,
    rotateHL: summary.rotate.points[i]?.hookLoad ?? 0,
    freeWeight: summary.freeWeight,
    tripInTension: summary.tripIn.points[i]?.effectiveTension ?? 0,
    tripOutTension: summary.tripOut.points[i]?.effectiveTension ?? 0,
    torque: summary.rotate.points[i]?.torque ?? 0,
    sideForce: summary.tripIn.points[i]?.sideForce ?? 0,
    sideForceOut: summary.tripOut.points[i]?.sideForce ?? 0,
    clearance: summary.tripIn.points[i]?.clearance ?? 0,
    drillHL: drillResult?.points[i]?.hookLoad ?? 0,
  }));

  const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
  };

  return (
    <div className="space-y-6">
      {/* Inputs */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">⚙️ Параметры расчёта T&D</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">μ в ОК</label>
              <input type="number" step="0.01" min="0.05" max="0.5" value={frictionCased} onChange={e => setFrictionCased(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">μ в откр. стволе</label>
              <input type="number" step="0.01" min="0.05" max="0.6" value={frictionOpenhole} onChange={e => setFrictionOpenhole(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Вес трубы, кг/м</label>
              <input type="number" step="1" min="10" max="200" value={pipeWeight} onChange={e => setPipeWeight(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">WOB, кН</label>
              <input type="number" step="5" min="0" max="300" value={wob} onChange={e => setWob(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">RPM</label>
              <input type="number" step="5" min="0" max="200" value={rpm} onChange={e => setRpm(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Вес блока, кН</label>
              <input type="number" step="1" min="0" max="100" value={blockWeight} onChange={e => setBlockWeight(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary table */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">📊 Сводка Torque & Drag</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2 text-muted-foreground font-medium">Параметр</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium">Спуск</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium">Подъём</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium">Вращение</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium">Бурение рот.</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  <td className="py-2 px-2 text-muted-foreground">Вес на крюке (макс.), кН</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(summary.tripIn.maxHookLoad, 0)}</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(summary.tripOut.maxHookLoad, 0)}</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(summary.rotate.maxHookLoad, 0)}</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(drillResult?.maxHookLoad ?? 0, 0)}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 px-2 text-muted-foreground">Вес на крюке (мин.), кН</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(summary.tripIn.minHookLoad, 0)}</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(summary.tripOut.minHookLoad, 0)}</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(summary.rotate.minHookLoad, 0)}</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(drillResult?.minHookLoad ?? 0, 0)}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 px-2 text-muted-foreground">Макс. момент, кН·м</td>
                  <td className="py-2 px-2 text-right">—</td>
                  <td className="py-2 px-2 text-right">—</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(summary.rotate.maxTorque, 1)}</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(drillResult?.maxTorque ?? 0, 1)}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 px-2 text-muted-foreground">Макс. бок. сила, кН/м</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(summary.tripIn.maxSideForce, 2)}</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(summary.tripOut.maxSideForce, 2)}</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(summary.rotate.maxSideForce, 2)}</td>
                  <td className="py-2 px-2 text-right font-semibold">{fmt(drillResult?.maxSideForce ?? 0, 2)}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 px-2 text-muted-foreground">Свободный вес колонны, кН</td>
                  <td colSpan={4} className="py-2 px-2 text-right font-semibold">{fmt(summary.freeWeight, 0)}</td>
                </tr>
                <tr>
                  <td className="py-2 px-2 text-muted-foreground">Коэфф. плавучести</td>
                  <td colSpan={4} className="py-2 px-2 text-right font-semibold">{fmt(summary.buoyancyFactor, 3)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Chart 1: Hook Load vs Depth */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Вес на крюке по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef1} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef1} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'кН', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmt(v, 0) + ' кН'} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line dataKey="tripInHL" name="Спуск" stroke="hsl(200, 70%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="tripOutHL" name="Подъём" stroke="hsl(0, 70%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="rotateHL" name="Вращение" stroke="hsl(120, 50%, 45%)" dot={false} strokeWidth={2} />
                <Line dataKey="freeWeight" name="Свободный вес" stroke="hsl(var(--muted-foreground))" dot={false} strokeWidth={1} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 2: Effective Tension vs Depth */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Эффективное натяжение по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef2} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef2} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'кН', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmt(v, 1) + ' кН'} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <ReferenceLine x={0} stroke="hsl(var(--border))" strokeWidth={1} />
                <Line dataKey="tripInTension" name="Спуск" stroke="hsl(200, 70%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="tripOutTension" name="Подъём" stroke="hsl(0, 70%, 50%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 3: Torque vs Depth */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Крутящий момент по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef3} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef3} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'кН·м', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmt(v, 2) + ' кН·м'} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line dataKey="torque" name="Момент (вращ.)" stroke="hsl(280, 60%, 50%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 4: Side Force + Clearance */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Боковая сила и зазор по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef4} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef4} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'кН/м | мм', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line dataKey="sideForce" name="Бок. сила (спуск), кН/м" stroke="hsl(35, 80%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="clearance" name="Зазор, мм" stroke="hsl(160, 60%, 45%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Detail Table */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">📋 Детальная таблица по глубине</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  <th className="py-2 px-1 text-left text-muted-foreground">MD, м</th>
                  <th className="py-2 px-1 text-left text-muted-foreground">TVD, м</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Зенит, °</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">HL спуск, кН</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">HL подъём, кН</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">HL вращ., кН</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Момент, кН·м</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Бок. сила, кН/м</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Зазор, мм</th>
                </tr>
              </thead>
              <tbody>
                {summary.tripIn.points.filter((_, i) => i % 5 === 0 || i === summary.tripIn.points.length - 1).map((pt, i) => {
                  const idx = summary.tripIn.points.indexOf(pt);
                  return (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/50">
                      <td className="py-1.5 px-1">{fmt(pt.md, 0)}</td>
                      <td className="py-1.5 px-1">{fmt(pt.tvd, 0)}</td>
                      <td className="py-1.5 px-1 text-right">{fmt(pt.zenith, 1)}</td>
                      <td className="py-1.5 px-1 text-right">{fmt(pt.hookLoad, 0)}</td>
                      <td className="py-1.5 px-1 text-right">{fmt(summary.tripOut.points[idx]?.hookLoad ?? 0, 0)}</td>
                      <td className="py-1.5 px-1 text-right">{fmt(summary.rotate.points[idx]?.hookLoad ?? 0, 0)}</td>
                      <td className="py-1.5 px-1 text-right">{fmt(summary.rotate.points[idx]?.torque ?? 0, 2)}</td>
                      <td className="py-1.5 px-1 text-right">{fmt(pt.sideForce, 2)}</td>
                      <td className="py-1.5 px-1 text-right">{fmt(pt.clearance, 1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
