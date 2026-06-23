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
  /** Цвет реагента (по типу метода) */
  reagentColor?: string;
}

/**
 * Вид сверху на ПЗП. Скважина в центре, проникновение реагента — полным кругом,
 * wormhole-каналы — звездой во все стороны. Da-режим задаёт паттерн и цвет.
 */
export default function WormholeVisualization({
  wormholeLengthM, penetrationRadiusM, wellboreRadiusM,
  damkohler = 0.29, reagentColor,
}: Props) {
  const W = 380, H = 320;
  const cx = W / 2, cy = H / 2;

  const maxR = Math.max(penetrationRadiusM, wormholeLengthM, wellboreRadiusM * 5, 1);
  const margin = 36;
  const scale = (Math.min(W, H) / 2 - margin) / maxR;

  const r_w = Math.max(3, wellboreRadiusM * scale);
  const r_pen = penetrationRadiusM * scale;
  const r_wh = wormholeLengthM * scale;

  // классификация режима по Da
  const regime =
    damkohler < 0.1 ? { key: "face", label: "Face dissolution", color: "#f59e0b", note: "Расход слишком высокий — кислота смывается, ПЗП «изъедается»" }
    : damkohler < 0.5 ? { key: "wormhole", label: "Wormholing (оптимум)", color: "#10b981", note: "Da ≈ 0.29 — максимальное проникновение wormhole" }
    : damkohler < 5 ? { key: "conical", label: "Conical / Ramified", color: "#3b82f6", note: "Расход умеренно низкий — ветвистые каналы" }
    : { key: "compact", label: "Compact dissolution", color: "#ef4444", note: "Расход слишком низкий — кислота расходуется у стенки" };

  const channelColor = reagentColor ?? regime.color;

  // ветви wormhole в зависимости от Da
  const wormholes = useMemo(() => {
    if (wormholeLengthM <= 0) return [];
    const cfg =
      regime.key === "compact" ? { n: 36, lenF: 0.3, w: 1 }
      : regime.key === "face" ? { n: 24, lenF: 0.45, w: 1.2 }
      : regime.key === "wormhole" ? { n: 8, lenF: 1.0, w: 2.2 }
      : { n: 16, lenF: 0.65, w: 1.5 };
    const out: { x1: number; y1: number; x2: number; y2: number; w: number; branches: { x1: number; y1: number; x2: number; y2: number; w: number }[] }[] = [];
    let seed = 1337;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < cfg.n; i++) {
      const angle = (Math.PI * 2 * i) / cfg.n + (rnd() - 0.5) * 0.15;
      const len = r_wh * cfg.lenF * (0.65 + 0.5 * rnd());
      const x1 = cx + Math.cos(angle) * r_w;
      const y1 = cy + Math.sin(angle) * r_w;
      const x2 = cx + Math.cos(angle) * (r_w + len);
      const y2 = cy + Math.sin(angle) * (r_w + len);
      const branches: { x1: number; y1: number; x2: number; y2: number; w: number }[] = [];
      if (regime.key === "wormhole" || regime.key === "conical") {
        const nB = regime.key === "wormhole" ? 2 : 3;
        for (let b = 0; b < nB; b++) {
          const t = 0.45 + rnd() * 0.45;
          const bx = x1 + (x2 - x1) * t;
          const by = y1 + (y2 - y1) * t;
          const bAng = angle + (rnd() - 0.5) * 1.0;
          const bLen = len * (0.25 + rnd() * 0.35);
          branches.push({
            x1: bx, y1: by,
            x2: bx + Math.cos(bAng) * bLen,
            y2: by + Math.sin(bAng) * bLen,
            w: cfg.w * 0.55,
          });
        }
      }
      out.push({ x1, y1, x2, y2, w: cfg.w, branches });
    }
    return out;
  }, [r_w, r_wh, wormholeLengthM, regime.key, cx, cy]);

  // концентрические "масштабные" кольца через каждый 0.5 м
  const gridRings = useMemo(() => {
    const rings: number[] = [];
    for (let r = 0.5; r * scale < Math.min(W, H) / 2 - 8; r += 0.5) rings.push(r);
    return rings;
  }, [scale]);

  // Линейка масштаба (м)
  const barMeters = maxR >= 4 ? 1 : maxR >= 2 ? 0.5 : 0.25;
  const barPx = barMeters * scale;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">Вид сверху · ПЗП</span>
        <span className="px-2 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: `${regime.color}22`, color: regime.color }}>
          {regime.label} · Da={damkohler.toFixed(2)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full border border-border/40 rounded bg-card">
        {/* фон пласта */}
        <rect x="0" y="0" width={W} height={H} fill="hsl(var(--muted))" opacity="0.18" />

        {/* концентрические кольца сетки */}
        {gridRings.map((r) => (
          <circle key={r} cx={cx} cy={cy} r={r * scale}
            fill="none" stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.45" />
        ))}

        {/* зона проникновения (полный круг) */}
        {r_pen > r_w && (
          <circle cx={cx} cy={cy} r={r_pen}
            fill={`${channelColor}22`}
            stroke={`${channelColor}AA`} strokeDasharray="3 3" strokeWidth="1" />
        )}

        {/* wormhole каналы */}
        {wormholes.map((w, i) => (
          <g key={i}>
            <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}
              stroke={channelColor} strokeWidth={w.w} strokeLinecap="round" opacity="0.9" />
            {w.branches.map((b, j) => (
              <line key={j} x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2}
                stroke={channelColor} strokeWidth={b.w} strokeLinecap="round" opacity="0.7" />
            ))}
          </g>
        ))}

        {/* скважина (центр) */}
        <circle cx={cx} cy={cy} r={r_w}
          fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r={Math.max(1.5, r_w * 0.35)} fill="hsl(var(--foreground))" opacity="0.6" />

        {/* выноска радиуса проникновения */}
        {r_pen > r_w && (
          <g>
            <line x1={cx} y1={cy} x2={cx + r_pen * 0.707} y2={cy - r_pen * 0.707}
              stroke="hsl(var(--muted-foreground))" strokeWidth="0.6" strokeDasharray="2 2" />
            <text x={cx + r_pen * 0.707 + 4} y={cy - r_pen * 0.707 - 4}
              fontSize="9" fill="hsl(var(--muted-foreground))">
              R={penetrationRadiusM.toFixed(2)} м
            </text>
          </g>
        )}

        {/* выноска wormhole */}
        {r_wh > 0 && (
          <text x={cx} y={cy + r_w + r_wh + 12} textAnchor="middle" fontSize="9" fill={channelColor}>
            L wormhole = {wormholeLengthM.toFixed(2)} м
          </text>
        )}

        {/* подпись скважины */}
        <text x={cx} y={cy - r_w - 6} textAnchor="middle" fontSize="9" fill="hsl(var(--foreground))">
          r_w = {wellboreRadiusM.toFixed(3)} м
        </text>

        {/* линейка масштаба */}
        <g transform={`translate(${12}, ${H - 16})`}>
          <line x1="0" y1="0" x2={barPx} y2="0" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
          <line x1="0" y1="-3" x2="0" y2="3" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
          <line x1={barPx} y1="-3" x2={barPx} y2="3" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
          <text x={barPx / 2} y="-6" textAnchor="middle" fontSize="9" fill="hsl(var(--foreground))">
            {barMeters} м
          </text>
        </g>
      </svg>
      <p className="text-[11px] text-muted-foreground">{regime.note}</p>
    </div>
  );
}
