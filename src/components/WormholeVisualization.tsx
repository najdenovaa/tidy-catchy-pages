import { useMemo } from "react";

interface Props {
  /** Длина wormhole, м (из computeAcidKinetics) */
  wormholeLengthM: number;
  /** Радиус проникновения раствора без wormhole, м */
  penetrationRadiusM: number;
  /** Радиус скважины, м */
  wellboreRadiusM: number;
  /** Число Дамкёлера (для подсветки Da-оптимума) */
  damkohler?: number;
}

/**
 * Визуализация распространения wormhole в карбонатном коллекторе.
 * Показывает Da-оптимум: при Da ≈ 0.29 wormhole максимально проникает,
 * при низком Da — кислота "съедает" ПЗП (face dissolution),
 * при высоком Da — компактное растворение (compact).
 */
export default function WormholeVisualization({
  wormholeLengthM, penetrationRadiusM, wellboreRadiusM, damkohler = 0.29,
}: Props) {
  const W = 360, H = 280;
  const cx = 60, cy = H / 2;
  // масштаб: максимальный радиус, который влезает справа
  const maxR = Math.max(wormholeLengthM, penetrationRadiusM, wellboreRadiusM * 5, 1);
  const scale = (W - cx - 30) / maxR;

  const r_w = wellboreRadiusM * scale;
  const r_pen = penetrationRadiusM * scale;
  const r_wh = wormholeLengthM * scale;

  // регенерация wormhole "ветвей"
  const wormholes = useMemo(() => {
    if (wormholeLengthM <= 0) return [];
    const n = 14;
    const out: { x1: number; y1: number; x2: number; y2: number; w: number }[] = [];
    for (let i = 0; i < n; i++) {
      // ветви идут радиально, длина варьирует ±30%
      const angle = (Math.PI * 2 * i) / n + Math.random() * 0.1;
      const len = r_wh * (0.5 + 0.5 * Math.random());
      // только в правом полупространстве для наглядности (визуально направлено в пласт)
      const x1 = cx + Math.cos(angle) * r_w;
      const y1 = cy + Math.sin(angle) * r_w;
      const x2 = cx + Math.cos(angle) * (r_w + len);
      const y2 = cy + Math.sin(angle) * (r_w + len);
      out.push({ x1, y1, x2, y2, w: 1 + Math.random() * 1.5 });
    }
    return out;
  }, [r_w, r_wh, wormholeLengthM]);

  // классификация режима по Da
  const regime =
    damkohler < 0.1 ? { label: "Face dissolution", color: "#f59e0b", note: "Расход слишком высокий — кислота смывается, ПЗП «изъедается»" }
    : damkohler < 0.5 ? { label: "Wormholing (оптимум)", color: "#10b981", note: "Da ≈ 0.29 — максимальное проникновение wormhole" }
    : damkohler < 5 ? { label: "Conical / Ramified", color: "#3b82f6", note: "Расход умеренно низкий — ветвистые каналы" }
    : { label: "Compact dissolution", color: "#ef4444", note: "Расход слишком низкий — кислота расходуется у стенки" };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Wormhole визуализация (Da-режим)</span>
        <span className="px-2 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: `${regime.color}22`, color: regime.color }}>
          {regime.label} · Da={damkohler.toFixed(2)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full border border-border/40 rounded bg-card">
        {/* пласт (фон) */}
        <rect x={cx - r_w} y="0" width={W - (cx - r_w)} height={H} fill="hsl(var(--muted))" opacity="0.25" />
        {/* зона проникновения раствора (бледный круг) */}
        {r_pen > r_w && (
          <circle cx={cx} cy={cy} r={r_pen} fill="hsl(var(--primary) / 0.12)" stroke="hsl(var(--primary) / 0.4)" strokeDasharray="3 3" />
        )}
        {/* wormhole ветви */}
        {wormholes.map((w, i) => (
          <line key={i} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}
            stroke={regime.color} strokeWidth={w.w} strokeLinecap="round" opacity="0.85" />
        ))}
        {/* скважина */}
        <circle cx={cx} cy={cy} r={r_w} fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
        {/* подписи радиусов */}
        <g fontSize="9" fill="hsl(var(--muted-foreground))">
          <text x={cx} y={H - 8} textAnchor="middle">скважина r_w={wellboreRadiusM.toFixed(2)} м</text>
          {r_pen > r_w && (
            <text x={cx + r_pen + 4} y={cy - r_pen - 4} textAnchor="start">
              R проник.={penetrationRadiusM.toFixed(2)} м
            </text>
          )}
          {r_wh > 0 && (
            <text x={cx + r_w + 8} y={cy + 12} textAnchor="start" fill={regime.color}>
              L wormhole={wormholeLengthM.toFixed(2)} м
            </text>
          )}
        </g>
      </svg>
      <p className="text-[11px] text-muted-foreground">{regime.note}</p>
    </div>
  );
}
