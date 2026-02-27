import { useMemo } from "react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { PlugInputs, PlugResults } from "@/lib/cement-plug-calculations";
import { simulatePlugPressures, type PressureTimePoint } from "@/lib/cement-plug-pressure-sim";

interface Props {
  inputs: PlugInputs;
  results: PlugResults;
  fracGradient: number; // МПа/м
}

const COLORS = {
  bhp: "hsl(0, 80%, 55%)",
  shoe: "hsl(330, 70%, 55%)",
  surface: "hsl(210, 80%, 55%)",
  frac: "hsl(40, 90%, 50%)",
  rate: "hsl(270, 60%, 60%)",
  spacer: "hsl(195, 70%, 55%)",
  cement: "hsl(0, 0%, 65%)",
  displ: "hsl(30, 60%, 50%)",
  wash: "hsl(120, 50%, 50%)",
};

const stageColors: Record<string, string> = {
  'Статика': 'hsl(var(--muted))',
  'Ниж. буфер': 'hsl(195, 70%, 55%)',
  'Цемент': 'hsl(0, 0%, 70%)',
  'Верх. буфер': 'hsl(195, 70%, 55%)',
  'Продавка': 'hsl(30, 60%, 50%)',
  'Подъём': 'hsl(60, 50%, 50%)',
  'Промывка': 'hsl(120, 50%, 50%)',
};

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload as PressureTimePoint;
  return (
    <div className="bg-popover border border-border rounded-md p-2 text-xs shadow-lg">
      <p className="font-semibold mb-1">{data?.stage} — {Number(label).toFixed(1)} мин</p>
      {payload.filter((p: any) => Number(p.value) > 0.001).map((p: any, i: number) => {
        const isVol = p.name.includes('м³');
        const isRate = p.name.includes('л/с');
        const unit = isVol ? 'м³' : isRate ? 'л/с' : 'МПа';
        return (
          <div key={i} className="flex justify-between gap-3">
            <span style={{ color: p.color }}>{p.name}:</span>
            <span className="font-medium">{Number(p.value).toFixed(isVol ? 3 : 2)} {unit}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function CementPlugPressureChart({ inputs, results, fracGradient }: Props) {
  const data = useMemo(() => {
    return simulatePlugPressures(inputs, results, fracGradient);
  }, [inputs, results, fracGradient]);

  if (!data.length) return null;

  const maxP = Math.max(
    ...data.map(d => Math.max(d.bhpMPa, d.shoePressMPa, d.surfaceMPa, d.fracMPa))
  );
  const maxVol = Math.max(...data.map(d => d.volumePumpedM3));
  const maxRate = Math.max(...data.map(d => d.pumpRateLs));
  const safeTimeMin = results.safeTimeMin;

  // Stage color bands
  const stageBands: { x1: number; x2: number; stage: string }[] = [];
  let currentStage = data[0]?.stage;
  let bandStart = data[0]?.timeMin ?? 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i].stage !== currentStage) {
      stageBands.push({ x1: bandStart, x2: data[i - 1].timeMin, stage: currentStage });
      currentStage = data[i].stage;
      bandStart = data[i].timeMin;
    }
  }
  stageBands.push({ x1: bandStart, x2: data[data.length - 1].timeMin, stage: currentStage });

  return (
    <div className="w-full">
      {/* Stage legend */}
      <div className="flex flex-wrap gap-2 mb-2">
        {stageBands.map((band, i) => (
          <div key={i} className="flex items-center gap-1 text-[10px]">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: stageColors[band.stage] || 'hsl(var(--muted))' }} />
            <span>{band.stage}</span>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />

          {/* Stage background bands */}
          {stageBands.map((band, i) => (
            <ReferenceLine
              key={`band-${i}`}
              yAxisId="pressure"
              x={band.x1}
              stroke={stageColors[band.stage] || 'hsl(var(--muted))'}
              strokeWidth={0}
            />
          ))}

          <XAxis
            dataKey="timeMin"
            type="number"
            domain={[0, 'auto']}
            tickFormatter={(v: number) => v.toFixed(0)}
            label={{ value: 'Время, мин', position: 'insideBottom', offset: -2, style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } }}
            tick={{ fontSize: 10 }}
          />

          {/* Left Y axis: Pressure */}
          <YAxis
            yAxisId="pressure"
            domain={[0, Math.ceil(maxP * 1.15)]}
            tickFormatter={(v: number) => v.toFixed(0)}
            label={{ value: 'Давление, МПа', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } }}
            tick={{ fontSize: 10 }}
          />

          {/* Right Y axis: Volume / Rate */}
          <YAxis
            yAxisId="volume"
            orientation="right"
            domain={[0, Math.ceil(Math.max(maxVol * 1.2, maxRate * 1.2))]}
            tickFormatter={(v: number) => v.toFixed(1)}
            label={{ value: 'Объём м³ / Q л/с', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' } }}
            tick={{ fontSize: 10 }}
          />

          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />

          {/* Safe time line */}
          <ReferenceLine
            x={safeTimeMin}
            yAxisId="pressure"
            stroke="hsl(var(--destructive))"
            strokeDasharray="5 3"
            strokeWidth={1.5}
            label={{ value: `Безоп. ${safeTimeMin.toFixed(0)}′`, position: 'top', style: { fontSize: 9, fill: 'hsl(var(--destructive))' } }}
          />

          {/* Frac pressure */}
          <Line
            yAxisId="pressure"
            type="stepAfter"
            dataKey="fracMPa"
            name="ГРП"
            stroke={COLORS.frac}
            strokeWidth={2}
            strokeDasharray="8 4"
            dot={false}
            isAnimationActive={false}
          />

          {/* BHP */}
          <Line
            yAxisId="pressure"
            type="monotone"
            dataKey="bhpMPa"
            name="Р забой"
            stroke={COLORS.bhp}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />

          {/* Pressure at casing shoe */}
          <Line
            yAxisId="pressure"
            type="monotone"
            dataKey="shoePressMPa"
            name="Р на башмаке"
            stroke={COLORS.shoe}
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            isAnimationActive={false}
          />

          {/* Surface pressure */}
          <Line
            yAxisId="pressure"
            type="monotone"
            dataKey="surfaceMPa"
            name="Р агрегат"
            stroke={COLORS.surface}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />

          {/* Volumes — stacked areas */}
          <Area
            yAxisId="volume"
            type="monotone"
            dataKey="volSpacerM3"
            name="V буфер, м³"
            stroke={COLORS.spacer}
            fill={COLORS.spacer}
            fillOpacity={0.3}
            strokeWidth={1}
            dot={false}
            stackId="vol"
            isAnimationActive={false}
          />
          <Area
            yAxisId="volume"
            type="monotone"
            dataKey="volCementM3"
            name="V цемент, м³"
            stroke={COLORS.cement}
            fill={COLORS.cement}
            fillOpacity={0.35}
            strokeWidth={1}
            dot={false}
            stackId="vol"
            isAnimationActive={false}
          />
          <Area
            yAxisId="volume"
            type="monotone"
            dataKey="volDisplM3"
            name="V продавка, м³"
            stroke={COLORS.displ}
            fill={COLORS.displ}
            fillOpacity={0.25}
            strokeWidth={1}
            dot={false}
            stackId="vol"
            isAnimationActive={false}
          />
          <Area
            yAxisId="volume"
            type="monotone"
            dataKey="volWashM3"
            name="V промывка, м³"
            stroke={COLORS.wash}
            fill={COLORS.wash}
            fillOpacity={0.25}
            strokeWidth={1}
            dot={false}
            stackId="vol"
            isAnimationActive={false}
          />

          {/* Pump rate */}
          <Line
            yAxisId="volume"
            type="stepAfter"
            dataKey="pumpRateLs"
            name="Q, л/с"
            stroke={COLORS.rate}
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
