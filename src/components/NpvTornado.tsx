import { useMemo } from "react";
import { tornadoSensitivity, type SensitivityParam } from "@/lib/foam-treatment-diagnostics";

interface Props {
  baseNPV: number;          // млн ₽
  params: SensitivityParam[];
}

/**
 * Tornado-диаграмма чувствительности NPV к ключевым параметрам.
 * Показывает, какой параметр сильнее всего двигает экономику.
 */
export default function NpvTornado({ baseNPV, params }: Props) {
  const results = useMemo(() => tornadoSensitivity(baseNPV, params), [baseNPV, params]);
  const maxAbs = useMemo(() => {
    let m = 0;
    results.forEach((r) => {
      m = Math.max(m, Math.abs(r.lowNPV - baseNPV), Math.abs(r.highNPV - baseNPV));
    });
    return m || 1;
  }, [results, baseNPV]);

  if (results.length === 0) return null;
  const rowH = 28;
  const H = results.length * rowH + 40;
  const W = 480;
  const cx = W * 0.55;
  const half = W * 0.4;

  const toMln = (v: number) => v / 1e6;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Tornado: чувствительность NPV (±вариация параметра)</span>
        <span className="text-muted-foreground">Базовый NPV: {toMln(baseNPV).toFixed(2)} млн ₽</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full border border-border/40 rounded bg-card">
        {/* центральная ось (baseline NPV) */}
        <line x1={cx} y1="20" x2={cx} y2={H - 20} stroke="hsl(var(--foreground))" strokeWidth="1.5" />
        <text x={cx} y="14" textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">база</text>

        {results.map((r, i) => {
          const y = 30 + i * rowH;
          const dLow = r.lowNPV - baseNPV;
          const dHigh = r.highNPV - baseNPV;
          const wLow = (Math.abs(dLow) / maxAbs) * half;
          const wHigh = (Math.abs(dHigh) / maxAbs) * half;
          // знак: если dLow < 0 → бар уходит влево от cx
          const lowX = dLow < 0 ? cx - wLow : cx;
          const lowW = wLow;
          const highX = dHigh < 0 ? cx - wHigh : cx;
          const highW = wHigh;
          return (
            <g key={r.name}>
              <text x={cx - half - 6} y={y + rowH / 2 + 3} textAnchor="end" fontSize="10" fill="hsl(var(--foreground))">
                {r.name}
              </text>
              {/* Low bar — красный (снижение параметра) */}
              <rect x={lowX} y={y + 3} width={lowW} height={rowH / 2 - 4} fill="#ef4444" opacity="0.75" />
              {/* High bar — зелёный (рост параметра) */}
              <rect x={highX} y={y + rowH / 2 + 1} width={highW} height={rowH / 2 - 4} fill="#10b981" opacity="0.75" />
              {/* подписи дельт */}
              <text x={lowX + (dLow < 0 ? -4 : lowW + 4)} y={y + rowH / 4 + 4}
                textAnchor={dLow < 0 ? "end" : "start"} fontSize="9" fill="#ef4444">
                {dLow >= 0 ? "+" : ""}{toMln(dLow).toFixed(1)}
              </text>
              <text x={highX + (dHigh < 0 ? -4 : highW + 4)} y={y + (3 * rowH) / 4 + 3}
                textAnchor={dHigh < 0 ? "end" : "start"} fontSize="9" fill="#10b981">
                {dHigh >= 0 ? "+" : ""}{toMln(dHigh).toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* легенда */}
        <g transform={`translate(${W - 160}, ${H - 14})`} fontSize="9">
          <rect x="0" y="-8" width="10" height="6" fill="#ef4444" opacity="0.75" />
          <text x="14" y="-3" fill="hsl(var(--muted-foreground))">−вариация</text>
          <rect x="80" y="-8" width="10" height="6" fill="#10b981" opacity="0.75" />
          <text x="94" y="-3" fill="hsl(var(--muted-foreground))">+вариация</text>
        </g>
      </svg>
      <p className="text-[10px] text-muted-foreground">
        Параметры отсортированы по размаху ΔNPV (млн ₽). Цена нефти и прирост дебита обычно — наиболее чувствительные.
      </p>
    </div>
  );
}
