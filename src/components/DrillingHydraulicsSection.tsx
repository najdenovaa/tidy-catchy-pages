import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea, ReferenceLine } from "recharts";
import { calculateDrillingHydraulics, type DrillingHydraulicsInput } from "@/lib/drilling-hydraulics-calculations";
import { calculateGasKick, kickMigrationProfile } from "@/lib/gas-kick-tolerance";
import type { WellData } from "@/lib/cementing-calculations";
import { getCasingID } from "@/lib/cementing-calculations";
import CopyImageButton from "./CopyImageButton";
import { Wind, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Props {
  wellData: WellData;
  mudDensity: number;
  mudRheology: { pv: number; yp: number };
}

const fmt = (v: number, dec = 2) => v.toFixed(dec);

function ScrollableChart({ children, chartRef, height }: { children: React.ReactNode; chartRef: React.RefObject<HTMLDivElement>; height: string }) {
  return (
    <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
      <div ref={chartRef} className={`${height} min-w-[700px]`}>{children}</div>
    </div>
  );
}

export default function DrillingHydraulicsSection({ wellData, mudDensity, mudRheology }: Props) {
  const [flowRate, setFlowRate] = useState(25);
  const [rop, setRop] = useState(15);
  const [cuttingsDensity, setCuttingsDensity] = useState(2650);
  const [nozzlesStr, setNozzlesStr] = useState("12,12,12");
  const [dpWeight, setDpWeight] = useState(30);
  const [dcLength, setDcLength] = useState(100);
  const [dcOD, setDcOD] = useState(172);
  const [dcID, setDcID] = useState(57);
  const [dcWeight, setDcWeight] = useState(145);

  const chartRef1 = useRef<HTMLDivElement>(null);
  const chartRef2 = useRef<HTMLDivElement>(null);
  const chartRef3 = useRef<HTMLDivElement>(null);
  const chartRef4 = useRef<HTMLDivElement>(null);
  const chartRef5 = useRef<HTMLDivElement>(null);

  const nozzles = useMemo(() => nozzlesStr.split(",").map(s => parseFloat(s.trim())).filter(n => n > 0), [nozzlesStr]);
  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);

  const result = useMemo(() => {
    if (!wellData.wellDepthMD || wellData.wellDepthMD <= 0) return null;
    const input: DrillingHydraulicsInput = {
      trajectory: wellData.trajectory,
      wellDepthMD: wellData.wellDepthMD,
      wellDepthTVD: wellData.wellDepthTVD,
      holeDiameter: wellData.holeDiameter,
      casingOD: wellData.casingOD,
      casingID: casingID,
      prevCasingDepth: wellData.prevCasingDepth,
      prevCasingID: wellData.prevCasingID,
      mudDensity,
      mudRheology,
      flowRate,
      rop,
      cuttingsDensity,
      nozzles,
      surfaceTemp: 20,
      bottomTemp: wellData.bottomTempStatic,
      dpWeight,
      dcLength,
      dcOD,
      dcID,
      dcWeight,
    };
    return calculateDrillingHydraulics(input);
  }, [wellData, mudDensity, mudRheology, flowRate, rop, cuttingsDensity, nozzles, casingID, dpWeight, dcLength, dcOD, dcID, dcWeight]);

  if (!result) {
    return (
      <Card><CardContent className="py-8 text-center text-muted-foreground">
        Заполните данные скважины для расчёта гидравлики бурения
      </CardContent></Card>
    );
  }

  const chartData = result.depthPoints.map(p => ({
    md: p.md,
    annVel: p.annVelocity,
    pipeVel: p.pipeVelocity,
    ecd: p.ecd,
    mudDensity,
    pipeLoss: p.pressureLossPipe,
    annLoss: p.pressureLossAnn,
    totalLoss: p.pressureLossPipe + p.pressureLossAnn,
    reAnn: p.reynoldsAnn,
    rePipe: p.reynoldsPipe,
    bedHeight: p.cuttingsBedHeight,
    temp: p.temperature,
  }));

  const ts = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
  };

  const bh = result.bitHydraulics;

  return (
    <div className="space-y-6">
      {/* Inputs */}
      <Card>
        <CardHeader className="pb-4"><CardTitle className="text-lg">⚙️ Параметры гидравлики бурения</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">Q бурения, л/с</label>
              <input type="number" step="1" value={flowRate} onChange={e => setFlowRate(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">ROP, м/ч</label>
              <input type="number" step="1" value={rop} onChange={e => setRop(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Плотн. шлама, кг/м³</label>
              <input type="number" step="50" value={cuttingsDensity} onChange={e => setCuttingsDensity(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Насадки долота, мм</label>
              <input type="text" value={nozzlesStr} onChange={e => setNozzlesStr(e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" placeholder="12,12,12" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Вес БТ, кг/м</label>
              <input type="number" step="1" value={dpWeight} onChange={e => setDpWeight(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Длина УБТ, м</label>
              <input type="number" step="10" value={dcLength} onChange={e => setDcLength(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">OD УБТ, мм</label>
              <input type="number" step="1" value={dcOD} onChange={e => setDcOD(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">ID УБТ, мм</label>
              <input type="number" step="1" value={dcID} onChange={e => setDcID(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader className="pb-4"><CardTitle className="text-lg">📊 Сводка гидравлики</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Row label="Давление на стояке" value={`${fmt(result.surfacePressure)} МПа`} />
              <Row label="Потери в трубе" value={`${fmt(result.depthPoints[result.depthPoints.length - 1]?.pressureLossPipe ?? 0)} МПа`} />
              <Row label="Потери в затрубье" value={`${fmt(result.depthPoints[result.depthPoints.length - 1]?.pressureLossAnn ?? 0)} МПа`} />
              <Row label="Потери на долоте" value={`${fmt(bh.bitPressureLoss)} МПа`} />
              <Row label="Суммарные потери" value={`${fmt(result.totalPressureLoss)} МПа`} />
            </div>
            <div className="space-y-1">
              <Row label="ECD на забое" value={`${fmt(result.ecdAtTD, 0)} кг/м³`} />
              <Row label="V затрубья на забое" value={`${fmt(result.annVelocityAtTD, 2)} м/с`} />
              <Row label="Крит. производит." value={`${fmt(result.criticalFlowRate, 1)} л/с`} />
              <Row label="Мин. расход (вынос)" value={`${fmt(result.minFlowRate, 1)} л/с`} />
            </div>
            <div className="space-y-1">
              <Row label="TFA (суммарная)" value={`${fmt(bh.totalFlowArea, 1)} мм²`} />
              <Row label="V на насадках" value={`${fmt(bh.nozzleVelocity, 1)} м/с`} />
              <Row label="Ударная сила" value={`${fmt(bh.impactForce, 2)} кН`} />
              <Row label="Гидр. мощность" value={`${fmt(bh.hydraulicPower, 1)} кВт`} />
              <Row label="HSI" value={`${fmt(bh.specificHydPower, 3)} кВт/см²`} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chart 1: ECD vs Depth */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 ECD по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef1} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef1} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'кг/м³', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={ts} formatter={(v: number) => fmt(v, 0) + ' кг/м³'} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line dataKey="ecd" name="ECD" stroke="hsl(0, 70%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="mudDensity" name="ρ бур. р-ра" stroke="hsl(var(--muted-foreground))" dot={false} strokeWidth={1} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 2: Pressure Losses vs Depth */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Потери давления по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef2} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef2} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'МПа', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={ts} formatter={(v: number) => fmt(v, 3) + ' МПа'} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line dataKey="pipeLoss" name="Потери в трубе" stroke="hsl(200, 70%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="annLoss" name="Потери в затрубье" stroke="hsl(35, 80%, 50%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 3: Annular velocity vs depth */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Скорость в затрубье по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef3} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef3} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'м/с', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={ts} formatter={(v: number) => fmt(v, 2) + ' м/с'} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line dataKey="annVel" name="V затрубья" stroke="hsl(120, 50%, 45%)" dot={false} strokeWidth={2} />
                <Line dataKey="pipeVel" name="V в трубе" stroke="hsl(280, 60%, 50%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 4: Reynolds (flow regime) */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Режим потока (Reynolds) по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef4} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef4} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: 'Re', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={ts} formatter={(v: number) => fmt(v, 0)} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line dataKey="reAnn" name="Re затрубья" stroke="hsl(35, 80%, 50%)" dot={false} strokeWidth={2} />
                <Line dataKey="rePipe" name="Re в трубе" stroke="hsl(200, 70%, 50%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 5: Temperature + Cuttings bed */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Температура и шламовая подушка по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef5} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef5} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" xAxisId="left" label={{ value: '°C', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <XAxis type="number" xAxisId="right" orientation="top" label={{ value: 'мм', position: 'insideTop', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={ts} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line dataKey="temp" name="Температура, °C" stroke="hsl(0, 70%, 50%)" dot={false} strokeWidth={2} xAxisId="left" />
                <Line dataKey="bedHeight" name="Шламовая подушка, мм" stroke="hsl(35, 60%, 45%)" dot={false} strokeWidth={2} xAxisId="right" />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Detail Table */}
      <Card>
        <CardHeader className="pb-4"><CardTitle className="text-lg">📋 Детальная таблица по глубине</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  <th className="py-2 px-1 text-left text-muted-foreground">MD</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">TVD</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">V затр, м/с</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">V трубы, м/с</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Re затр</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Режим затр</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">ΔP труба, МПа</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">ΔP затр, МПа</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">ECD, кг/м³</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">T, °C</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Подушка, мм</th>
                </tr>
              </thead>
              <tbody>
                {result.depthPoints.filter((_, i) => i % 2 === 0 || i === result.depthPoints.length - 1).map((p, i) => (
                  <tr key={i} className="border-b border-border">
                    <td className="py-1 px-1">{fmt(p.md, 0)}</td>
                    <td className="py-1 px-1 text-right">{fmt(p.tvd, 0)}</td>
                    <td className="py-1 px-1 text-right">{fmt(p.annVelocity, 2)}</td>
                    <td className="py-1 px-1 text-right">{fmt(p.pipeVelocity, 2)}</td>
                    <td className="py-1 px-1 text-right">{fmt(p.reynoldsAnn, 0)}</td>
                    <td className="py-1 px-1 text-right">{p.flowRegimeAnn}</td>
                    <td className="py-1 px-1 text-right">{fmt(p.pressureLossPipe, 3)}</td>
                    <td className="py-1 px-1 text-right">{fmt(p.pressureLossAnn, 3)}</td>
                    <td className="py-1 px-1 text-right">{fmt(p.ecd, 0)}</td>
                    <td className="py-1 px-1 text-right">{fmt(p.temperature, 1)}</td>
                    <td className="py-1 px-1 text-right">{fmt(p.cuttingsBedHeight, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Gas Kick Tolerance (Part 3.3) */}
      <GasKickToleranceCard wellData={wellData} mudDensity={mudDensity} />
    </div>
  );
}

function GasKickToleranceCard({ wellData, mudDensity }: { wellData: WellData; mudDensity: number }) {
  const [porePressureGrad, setPorePressureGrad] = useState(1.05);
  const [fracPressureGrad, setFracPressureGrad] = useState(1.65);
  const [gasSG, setGasSG] = useState(0.65);
  const [drillPipeOD, setDrillPipeOD] = useState(127);
  const [influxBh, setInfluxBh] = useState(2.0);

  const chartRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  const tvdShoe = wellData.prevCasingDepth || Math.min(wellData.wellDepthTVD * 0.5, 1500);
  const prevID = wellData.prevCasingID || 220;

  const kick = useMemo(() => {
    if (!wellData.wellDepthTVD || wellData.wellDepthTVD <= 0 || tvdShoe <= 0) return null;
    return calculateGasKick({
      tvdBottom: wellData.wellDepthTVD,
      tvdShoe,
      holeDiameter: wellData.holeDiameter,
      prevCasingID: prevID,
      drillPipeOD,
      mudDensity,
      porePressureGrad,
      fracPressureGradShoe: fracPressureGrad,
      gasSpecificGravity: gasSG,
      surfaceTempC: 20,
      bottomTempC: wellData.bottomTempStatic,
      influxVolumeBhM3: influxBh,
    });
  }, [wellData, mudDensity, porePressureGrad, fracPressureGrad, gasSG, drillPipeOD, influxBh, tvdShoe, prevID]);

  const profile = useMemo(() => {
    if (!kick || !wellData.wellDepthTVD) return null;
    return kickMigrationProfile({
      tvdBottom: wellData.wellDepthTVD,
      tvdShoe,
      holeDiameter: wellData.holeDiameter,
      prevCasingID: prevID,
      drillPipeOD,
      mudDensity,
      porePressureGrad,
      fracPressureGradShoe: fracPressureGrad,
      gasSpecificGravity: gasSG,
      surfaceTempC: 20,
      bottomTempC: wellData.bottomTempStatic,
    }, influxBh, 25);
  }, [kick, wellData, mudDensity, porePressureGrad, fracPressureGrad, gasSG, drillPipeOD, influxBh, tvdShoe, prevID]);

  if (!kick) return null;

  const ts = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" };
  const profileData = profile?.points.map(p => ({
    tvd: +p.tvdTop.toFixed(0),
    volume: +p.volumeM3.toFixed(2),
    height: +p.heightM.toFixed(1),
    pShoe: +p.pShoeMPa.toFixed(2),
    safe: p.safe,
  })) ?? [];

  const safe = kick.current?.safe ?? true;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <Wind className="h-5 w-5 text-cyan-600" />
          Сжимаемость газа · Kick Tolerance (Papay Z)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Inputs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Град. пласт. давл., S.G.</label>
            <input type="number" step="0.01" value={porePressureGrad} onChange={e => setPorePressureGrad(+e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Град. ГРП у башмака, S.G.</label>
            <input type="number" step="0.01" value={fracPressureGrad} onChange={e => setFracPressureGrad(+e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">γ газа (возд.=1)</label>
            <input type="number" step="0.01" value={gasSG} onChange={e => setGasSG(+e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">OD БТ, мм</label>
            <input type="number" step="1" value={drillPipeOD} onChange={e => setDrillPipeOD(+e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Приток на забое, м³</label>
            <input type="number" step="0.5" value={influxBh} onChange={e => setInfluxBh(+e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
          </div>
        </div>

        {/* Z & gas density */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="Z (забой)" value={kick.zBottom.toFixed(3)} sub={`P=${kick.bhpShutInMPa.toFixed(1)} МПа`} />
          <Metric label="Z (башмак)" value={kick.zShoe.toFixed(3)} sub={`P≈${(kick.bhpShutInMPa - mudDensity * 9.81 * (wellData.wellDepthTVD - tvdShoe) / 1e6).toFixed(1)} МПа`} />
          <Metric label="ρ газа на забое" value={`${kick.gasDensityBottom.toFixed(0)} кг/м³`} />
          <Metric label="ρ газа у башмака" value={`${kick.gasDensityShoe.toFixed(0)} кг/м³`} />
        </div>

        {/* Tolerance & shoe */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="border border-border rounded-lg p-3 bg-card">
            <div className="text-xs text-muted-foreground mb-1">Допустимый объём кика (на забое)</div>
            <div className="text-2xl font-bold text-emerald-600">{kick.maxKickVolumeBhM3.toFixed(2)} м³</div>
            <div className="text-xs text-muted-foreground mt-0.5">высота у башмака: {kick.maxKickHeightShoeM.toFixed(0)} м</div>
          </div>
          <div className="border border-border rounded-lg p-3 bg-card">
            <div className="text-xs text-muted-foreground mb-1">Давление ГРП у башмака</div>
            <div className="text-2xl font-bold">{kick.fracPressureShoeMPa.toFixed(2)} МПа</div>
            <div className="text-xs text-muted-foreground mt-0.5">гидростат: {kick.hydrostaticShoeMPa.toFixed(2)} МПа</div>
          </div>
          <div className={`border rounded-lg p-3 ${safe ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5"}`}>
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              {safe ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
              Текущий приток {influxBh.toFixed(1)} м³
            </div>
            <div className={`text-2xl font-bold ${safe ? "text-emerald-600" : "text-red-600"}`}>
              {kick.current ? `×${kick.current.expansionRatio.toFixed(1)}` : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              запас по ГРП: {kick.current ? kick.current.shoeMarginMPa.toFixed(2) : "—"} МПа
            </div>
          </div>
        </div>

        {/* Migration profile chart */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Миграция пузыря: объём и давление у башмака vs TVD верха пузыря</div>
            <CopyImageButton targetRef={profileRef} />
          </div>
          <div ref={profileRef} className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={profileData} margin={{ top: 5, right: 40, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="tvd" reversed type="number" domain={['dataMin', 'dataMax']} label={{ value: 'TVD верха пузыря, м', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="L" label={{ value: 'V, м³', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="R" orientation="right" label={{ value: 'P у башмака, МПа', angle: 90, position: 'insideRight' }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={ts} />
                <Legend />
                <ReferenceLine yAxisId="R" y={kick.fracPressureShoeMPa} stroke="hsl(0,80%,55%)" strokeDasharray="4 4" label={{ value: 'P ГРП', fill: 'hsl(0,80%,55%)', fontSize: 11 }} />
                <Line yAxisId="L" dataKey="volume" name="Объём, м³" stroke="hsl(200,70%,50%)" strokeWidth={2} dot={false} />
                <Line yAxisId="R" dataKey="pShoe" name="P башмак, МПа" stroke="hsl(35,80%,50%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Warnings */}
        {kick.warnings.length > 0 && (
          <div className="space-y-1">
            {kick.warnings.map((w, i) => (
              <div key={i} className="text-xs flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}

        <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
          Модель: Z-фактор по Papay, псевдо-критические параметры по Sutton (γ_g). Допустимый объём кика — бинарный поиск V_bh, при котором давление у башмака после полной миграции газа ≤ P_ГРП.
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}
