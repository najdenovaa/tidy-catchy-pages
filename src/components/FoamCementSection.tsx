import { useState, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea } from "recharts";
import { calculateFoamCement, type FoamCementInput } from "@/lib/foam-cement-calculations";
import type { WellData, SlurryInput } from "@/lib/cementing-calculations";
import CopyImageButton from "./CopyImageButton";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  mudDensity: number; // кг/м³
  pumpRateLps?: number;
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

export default function FoamCementSection({ wellData, slurries, mudDensity, pumpRateLps }: Props) {
  const [targetQuality, setTargetQuality] = useState(35);
  const [backPressure, setBackPressure] = useState(0.5);
  const [surfaceTemp, setSurfaceTemp] = useState(20);
  const [pumpingTime, setPumpingTime] = useState<number | "">("");
  const [baseDensity, setBaseDensity] = useState(() => {
    const s = slurries[0];
    return s ? (s.density >= 100 ? s.density / 1000 : s.density) : 1.85;
  });

  const chartRef1 = useRef<HTMLDivElement>(null);
  const chartRef2 = useRef<HTMLDivElement>(null);
  const chartRef3 = useRef<HTMLDivElement>(null);
  const chartRef4 = useRef<HTMLDivElement>(null);

  const cementTopMD = slurries.length > 0 ? Math.min(...slurries.map(s => s.topDepthMD)) : wellData.cementRiseHeight;
  const cementBottomMD = wellData.casingDepthMD;

  const result = useMemo(() => {
    if (cementBottomMD <= cementTopMD) return null;
    const input: FoamCementInput = {
      baseDensity,
      targetFoamQuality: targetQuality,
      backPressure,
      surfaceTemperature: surfaceTemp,
      bottomTemperature: wellData.bottomTempStatic,
      wellDepthMD: wellData.wellDepthMD,
      casingDepthMD: wellData.casingDepthMD,
      holeDiameter: wellData.holeDiameter,
      casingOD: wellData.casingOD,
      cementTopMD,
      cementBottomMD,
      trajectory: wellData.trajectory,
      mudDensity: mudDensity / 1000,
      cavernCoeff: wellData.cavernCoeff,
      pumpingTimeMin: typeof pumpingTime === "number" && pumpingTime > 0 ? pumpingTime : undefined,
      pumpRateLps,
    };
    return calculateFoamCement(input);
  }, [baseDensity, targetQuality, backPressure, surfaceTemp, pumpingTime, wellData, cementTopMD, cementBottomMD, mudDensity, pumpRateLps]);

  if (!result) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Заполните данные скважины и растворы для расчёта пеноцементирования
        </CardContent>
      </Card>
    );
  }

  // Данные для основного графика (FQ + ρ) и графика N₂ по времени
  const chartData = result.points.map(pt => ({
    md: pt.md,
    foamQuality: pt.foamQuality,
    foamDensity: pt.foamDensity,
    pressure: pt.pressure,
    n2Ratio: pt.n2VolumeRatio * 100,
    temperature: pt.temperature,
    zFactor: pt.zFactor,
  }));

  // Расписание N₂ по времени закачки (линейно по объёму)
  const totalSeg = result.points.length;
  const n2ScheduleData = result.points.map((pt, i) => {
    const timeMin = totalSeg > 0 ? (i / Math.max(1, totalSeg - 1)) * result.pumpingTimeMin : 0;
    return {
      timeMin: Math.round(timeMin * 10) / 10,
      depthMD: pt.md,
      foamQuality: pt.foamQuality,
      pressure: pt.pressure,
    };
  });

  const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
  };

  const qualityOk = result.minFoamQuality >= 20 && result.maxFoamQuality <= 80;

  return (
    <div className="space-y-6">
      {/* Inputs */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">🫧 Параметры пеноцементирования</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-muted-foreground">Базовая плотность цемента, г/см³</label>
              <input type="number" step="0.01" min="1.0" max="2.5" value={baseDensity}
                onChange={e => setBaseDensity(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Целевое качество пены, %</label>
              <input type="number" step="5" min="10" max="85" value={targetQuality}
                onChange={e => setTargetQuality(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
              <div className="text-[10px] text-muted-foreground mt-0.5">Рекомендуемый диапазон: 20–80%</div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Обратное давление, МПа</label>
              <input type="number" step="0.1" min="0" max="10" value={backPressure}
                onChange={e => setBackPressure(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Температура на устье, °C</label>
              <input type="number" step="1" min="-30" max="60" value={surfaceTemp}
                onChange={e => setSurfaceTemp(+e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Время закачки, мин (опц.)</label>
              <input type="number" step="1" min="0" value={pumpingTime}
                placeholder={pumpRateLps ? "из расхода" : "60"}
                onChange={e => setPumpingTime(e.target.value === "" ? "" : +e.target.value)}
                className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
              <div className="text-[10px] text-muted-foreground mt-0.5">Принято: {fmt(result.pumpingTimeMin, 1)} мин</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">📊 Результаты пеноцементирования</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <Row label="Объём пеноцемента в скважине (затрубье)" value={`${fmt(result.finalVolumeM3, 2)} м³`} />
            <Row label="Объём базовой суспензии (без газа)" value={`${fmt(result.slurryVolumeM3, 2)} м³`} />
            <Row label="Объём пеноцемента на устье (с газом при P_устья)" value={`${fmt(result.initialVolumeM3, 2)} м³`} />
            <Row label="Объём N₂ при стд. условиях" value={`${fmt(result.n2VolumeStdM3, 1)} м³`} />
            <Row label="Расход подачи N₂ (ср.)" value={`${fmt(result.n2RateM3PerMin, 2)} м³/мин`} />
            <Row label="Время закачки" value={`${fmt(result.pumpingTimeMin, 1)} мин`} />
            <Row label="Качество пены (среднее)" value={`${fmt(result.avgFoamQuality, 1)}%`} />
            <Row label="Качество пены (мин. / макс.)" value={`${fmt(result.minFoamQuality, 1)}% / ${fmt(result.maxFoamQuality, 1)}%`} />
            <Row label="Плотность пеноцемента (средняя)" value={`${fmt(result.avgFoamDensity, 3)} г/см³`} />
            <Row label="Плотность пеноцемента (мин. / макс.)" value={`${fmt(result.minFoamDensity, 3)} / ${fmt(result.maxFoamDensity, 3)} г/см³`} />
          </div>
          <div className={`mt-3 p-3 rounded-lg text-sm font-medium ${qualityOk ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"}`}>
            {qualityOk
              ? "✓ Качество пены в допустимом диапазоне (20–80%) по всей глубине"
              : `⚠ Качество пены выходит за диапазон 20–80% на некоторых глубинах — скорректируйте параметры`}
          </div>
        </CardContent>
      </Card>

      {/* Chart 1: Foam Quality & Density by Depth — две Y-оси, зоны FQ */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Качество пены и плотность по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef1} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef1} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 60, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis xAxisId="quality" type="number" domain={[0, 100]} orientation="bottom"
                  label={{ value: 'FQ, %', position: 'insideBottom', offset: -2 }} tick={{ fontSize: 11 }} />
                <XAxis xAxisId="density" type="number" domain={['auto', 'auto']} orientation="top"
                  label={{ value: 'ρ, г/см³', position: 'insideTop', offset: -2 }} tick={{ fontSize: 11 }} />
                {/* Зоны качества пены */}
                <ReferenceArea xAxisId="quality" x1={20} x2={80} fill="hsl(var(--primary))" fillOpacity={0.04} />
                <ReferenceArea xAxisId="quality" x1={0} x2={15} fill="hsl(var(--destructive))" fillOpacity={0.06} />
                <ReferenceArea xAxisId="quality" x1={85} x2={100} fill="hsl(var(--destructive))" fillOpacity={0.06} />
                <ReferenceArea xAxisId="quality" x1={15} x2={20} fill="hsl(45, 90%, 50%)" fillOpacity={0.06} />
                <ReferenceArea xAxisId="quality" x1={80} x2={85} fill="hsl(45, 90%, 50%)" fillOpacity={0.06} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line xAxisId="quality" dataKey="foamQuality" name="Качество пены, %" stroke="hsl(200, 70%, 50%)" dot={false} strokeWidth={2} />
                <Line xAxisId="density" dataKey="foamDensity" name="Плотность, г/см³" stroke="hsl(35, 80%, 50%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 2: Pressure & Temperature by Depth */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Давление и температура по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef2} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef2} height="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 60, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis xAxisId="p" type="number" orientation="bottom" label={{ value: 'P, МПа', position: 'insideBottom', offset: -2 }} tick={{ fontSize: 11 }} />
                <XAxis xAxisId="t" type="number" orientation="top" label={{ value: 'T, °C', position: 'insideTop', offset: -2 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line xAxisId="p" dataKey="pressure" name="Давление, МПа" stroke="hsl(0, 60%, 50%)" dot={false} strokeWidth={2} />
                <Line xAxisId="t" dataKey="temperature" name="Температура, °C" stroke="hsl(280, 50%, 55%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 3: N₂ volume ratio by depth */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 Объёмная доля N₂ по глубине</CardTitle>
          <CopyImageButton targetRef={chartRef3} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef3} height="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <YAxis dataKey="md" type="number" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <XAxis type="number" label={{ value: '%', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmt(v, 1) + '%'} labelFormatter={(l: number) => `MD: ${l} м`} />
                <Legend />
                <Line dataKey="n2Ratio" name="Доля N₂, %" stroke="hsl(160, 60%, 40%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Chart 4: N₂ schedule по времени закачки */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-lg">📈 График закачки по времени (FQ и глубина)</CardTitle>
          <CopyImageButton targetRef={chartRef4} />
        </CardHeader>
        <CardContent>
          <ScrollableChart chartRef={chartRef4} height="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={n2ScheduleData} margin={{ top: 5, right: 60, bottom: 30, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="timeMin" type="number" label={{ value: 'Время, мин', position: 'insideBottom', offset: -5 }} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="fq" orientation="left" domain={[0, 100]} label={{ value: 'FQ, %', angle: -90, position: 'insideLeft' }} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="depth" orientation="right" reversed domain={[0, 'dataMax']} label={{ value: 'MD, м', angle: 90, position: 'insideRight' }} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(l: number) => `Время: ${l} мин`} />
                <Legend />
                <Line yAxisId="fq" dataKey="foamQuality" name="FQ, %" stroke="hsl(200, 70%, 50%)" dot={false} strokeWidth={2} />
                <Line yAxisId="depth" dataKey="depthMD" name="Глубина заполнения, м" stroke="hsl(15, 75%, 50%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ScrollableChart>
        </CardContent>
      </Card>

      {/* Detail Table */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">📋 Профиль пеноцемента по глубине</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b border-border">
                  <th className="py-2 px-1 text-left text-muted-foreground">MD, м</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">TVD, м</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">P, МПа</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">T, °C</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Z (N₂)</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Кач. пены, %</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">Плотн., г/см³</th>
                  <th className="py-2 px-1 text-right text-muted-foreground">N₂, %</th>
                </tr>
              </thead>
              <tbody>
                {result.points.filter((_, i) => i % 3 === 0 || i === result.points.length - 1).map((pt, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/50">
                    <td className="py-1.5 px-1">{fmt(pt.md, 0)}</td>
                    <td className="py-1.5 px-1 text-right">{fmt(pt.tvd, 0)}</td>
                    <td className="py-1.5 px-1 text-right">{fmt(pt.pressure, 2)}</td>
                    <td className="py-1.5 px-1 text-right">{fmt(pt.temperature, 1)}</td>
                    <td className="py-1.5 px-1 text-right">{fmt(pt.zFactor, 3)}</td>
                    <td className="py-1.5 px-1 text-right">{fmt(pt.foamQuality, 1)}</td>
                    <td className="py-1.5 px-1 text-right">{fmt(pt.foamDensity, 3)}</td>
                    <td className="py-1.5 px-1 text-right">{fmt(pt.n2VolumeRatio * 100, 1)}</td>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}
