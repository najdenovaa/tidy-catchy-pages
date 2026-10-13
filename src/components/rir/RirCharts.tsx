import { ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ReferenceArea, LineChart } from "recharts";
import { useMeasuredWidth } from "@/hooks/use-measured-width";
import { COMPOSITION_LABEL, D95_UM, type RirResult } from "@/lib/rir-calculations";

const tipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 };
const axisTick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

/** Приёмистость: замеры, линейная аппроксимация, давление начала и допустимое давление. */
export function InjectivityChart({ res }: { res: RirResult }) {
  const [ref, w] = useMeasuredWidth<HTMLDivElement>();
  const fit = res.fit;
  if (!fit) return <p className="text-xs text-muted-foreground">Нет замеров приёмистости.</p>;
  const pMin = Math.min(fit.openingBhpMPa, ...fit.points.map((p) => p.bhpMPa)) - 1;
  const pMax = Math.max(res.maxBhpMPa, ...fit.points.map((p) => p.bhpMPa)) + 2;
  const line = Array.from({ length: 21 }, (_, i) => {
    const p = pMin + ((pMax - pMin) * i) / 20;
    return { p: Math.round(p * 10) / 10, fit: Math.max(0, fit.J * (p - fit.openingBhpMPa)) };
  });
  const data = [...line, ...fit.points.map((x) => ({ p: Math.round(x.bhpMPa * 10) / 10, meas: x.rateM3h }))].sort((a, b) => a.p - b.p);
  return (
    <div ref={ref} className="h-64">
      <ComposedChart width={w || 520} height={256} data={data} margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
        <XAxis dataKey="p" type="number" domain={[pMin, pMax]} tick={axisTick} tickFormatter={(v) => v.toFixed(0)} label={{ value: "Давление на глубине нарушения, МПа", position: "insideBottom", offset: -8, fontSize: 11 }} />
        <YAxis tick={axisTick} label={{ value: "Расход, м³/ч", angle: -90, position: "insideLeft", fontSize: 11 }} />
        <Tooltip contentStyle={tipStyle} formatter={(v: number) => `${Number(v).toFixed(2)} м³/ч`} labelFormatter={(p) => `P = ${p} МПа`} />
        <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 11 }} />
        <ReferenceArea x1={fit.openingBhpMPa} x2={res.maxBhpMPa} fill="hsl(142 70% 45%)" fillOpacity={0.08} />
        <ReferenceLine x={fit.openingBhpMPa} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 3" label={{ value: "начало", fontSize: 10, position: "top" }} />
        <ReferenceLine x={res.maxBhpMPa} stroke="hsl(0 72% 51%)" strokeDasharray="4 3" label={{ value: "допустимое", fontSize: 10, position: "top", fill: "hsl(0 72% 51%)" }} />
        <Line dataKey="fit" name={`Аппроксимация: J = ${fit.J.toFixed(2)} м³/(ч·МПа)`} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
        <Scatter dataKey="meas" name="Замер" fill="hsl(var(--foreground))" isAnimationActive={false} />
      </ComposedChart>
    </div>
  );
}

/** Проходимость: раскрытие канала против 3·d95 составов (логарифмическая шкала). */
export function PenetrationDiagram({ res }: { res: RirResult }) {
  const W = 560, H = 150, x0 = 140, x1 = W - 20;
  const lo = Math.log10(5), hi = Math.log10(2000);
  const x = (um: number) => x0 + ((Math.log10(Math.max(5, Math.min(2000, um))) - lo) / (hi - lo)) * (x1 - x0);
  const rows = (["cement", "microcement", "resin"] as const).map((k) => ({ k, need: k === "resin" ? 5 : 3 * D95_UM[k] }));
  const ap = res.apertureUm;
  const COLORS: Record<string, string> = { cement: "#94a3b8", microcement: "#60a5fa", resin: "#f59e0b" };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Проходимость составов">
      {[5, 10, 20, 50, 100, 200, 500, 1000, 2000].map((v) => (
        <g key={v}>
          <line x1={x(v)} x2={x(v)} y1={14} y2={H - 26} className="stroke-border" strokeDasharray="2 3" />
          <text x={x(v)} y={H - 12} textAnchor="middle" fontSize={10} className="fill-muted-foreground">{v}</text>
        </g>
      ))}
      <text x={(x0 + x1) / 2} y={H - 1} textAnchor="middle" fontSize={10} className="fill-muted-foreground">раскрытие канала, мкм (лог. шкала)</text>
      {rows.map((r, i) => {
        const yy = 22 + i * 32;
        return (
          <g key={r.k}>
            <text x={x0 - 6} y={yy + 12} textAnchor="end" fontSize={10.5} className={res.composition === r.k || (res.composition === "resin_micro" && r.k !== "cement") ? "fill-foreground font-semibold" : "fill-muted-foreground"}>
              {r.k === "cement" ? "Цемент (d95≈90)" : r.k === "microcement" ? "Микроцемент (d95≈15)" : "Смола (без частиц)"}
            </text>
            <rect x={x(r.need)} y={yy} width={Math.max(2, x1 - x(r.need))} height={18} fill={COLORS[r.k]} opacity={0.55} rx={3} />
            <text x={x(r.need) + 4} y={yy + 13} fontSize={9.5} className="fill-foreground">проходит при ≥ {r.k === "resin" ? "любом" : `${r.need} мкм`}</text>
          </g>
        );
      })}
      {ap !== null && (
        <g>
          <line x1={x(ap)} x2={x(ap)} y1={12} y2={H - 26} className="stroke-red-600" strokeWidth={2.5} />
          <text x={x(ap) + 4} y={12} fontSize={10.5} fontWeight={600} className="fill-red-600">канал ≈ {ap.toFixed(0)} мкм</text>
        </g>
      )}
    </svg>
  );
}

/** Окно давлений по глубине: гидростатика, ГРП, допустимое по колонне, максимальное при задавливании. */
export function PressureWindowChart({ res, leakTopMD, leakBottomMD, toolMD }: { res: RirResult; leakTopMD: number; leakBottomMD: number; toolMD: number }) {
  const [ref, w] = useMeasuredWidth<HTMLDivElement>();
  const data = res.profile.map((p) => ({ md: Math.round(p.md), hydro: p.hydroMPa, frac: p.fracMPa, burst: p.burstLimitMPa, sq: p.squeezeMaxMPa }));
  return (
    <div ref={ref} className="h-80">
      <LineChart layout="vertical" width={w || 520} height={320} data={data} margin={{ top: 8, right: 16, bottom: 18, left: 8 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
        <XAxis type="number" tick={axisTick} label={{ value: "Давление, МПа", position: "insideBottom", offset: -8, fontSize: 11 }} />
        <YAxis type="number" dataKey="md" reversed tick={axisTick} domain={[0, "dataMax"]} label={{ value: "Глубина, м", angle: -90, position: "insideLeft", fontSize: 11 }} />
        <Tooltip contentStyle={tipStyle} formatter={(v: number) => `${Number(v).toFixed(1)} МПа`} labelFormatter={(m) => `${m} м`} />
        <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 11 }} />
        <ReferenceArea y1={leakTopMD} y2={leakBottomMD} fill="hsl(0 72% 51%)" fillOpacity={0.15} />
        {toolMD > 0 && <ReferenceLine y={toolMD} stroke="hsl(var(--foreground))" strokeDasharray="5 3" label={{ value: "пакер", fontSize: 10, position: "insideTopRight" }} />}
        <Line dataKey="hydro" name="Гидростатика раствора" stroke="hsl(205 80% 50%)" dot={false} isAnimationActive={false} />
        <Line dataKey="frac" name="ГРП" stroke="hsl(30 90% 50%)" strokeDasharray="6 3" dot={false} isAnimationActive={false} />
        <Line dataKey="burst" name="Допустимое по разрыву колонны" stroke="hsl(0 72% 51%)" strokeDasharray="3 3" dot={false} isAnimationActive={false} />
        <Line dataKey="sq" name="Макс. давление в трубах при задавливании" stroke="hsl(142 70% 40%)" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </div>
  );
}

/** План ступенчатого задавливания: давление на устье и закачанный объём по времени. */
export function HesitationChart({ res }: { res: RirResult }) {
  const [ref, w] = useMeasuredWidth<HTMLDivElement>();
  const data = res.hesitation.map((h) => ({ t: Math.round(h.timeMin * 10) / 10, p: h.surfaceMPa, v: h.volumeM3 }));
  return (
    <div ref={ref} className="h-64">
      <ComposedChart width={w || 520} height={256} data={data} margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
        <XAxis dataKey="t" type="number" tick={axisTick} label={{ value: "Время задавливания, мин", position: "insideBottom", offset: -8, fontSize: 11 }} />
        <YAxis yAxisId="p" tick={axisTick} label={{ value: "P устье, МПа", angle: -90, position: "insideLeft", fontSize: 11 }} />
        <YAxis yAxisId="v" orientation="right" tick={axisTick} label={{ value: "V, м³", angle: 90, position: "insideRight", fontSize: 11 }} />
        <Tooltip contentStyle={tipStyle} />
        <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine yAxisId="p" y={res.maxSurfaceMPa} stroke="hsl(0 72% 51%)" strokeDasharray="4 3" label={{ value: `допустимо ${res.maxSurfaceMPa.toFixed(1)}`, fontSize: 10, position: "insideTopRight", fill: "hsl(0 72% 51%)" }} />
        <Line yAxisId="p" type="linear" dataKey="p" name="Давление на устье" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
        <Line yAxisId="v" type="stepAfter" dataKey="v" name="Закачано" stroke="hsl(30 90% 50%)" dot={false} isAnimationActive={false} />
      </ComposedChart>
    </div>
  );
}

export { COMPOSITION_LABEL };
