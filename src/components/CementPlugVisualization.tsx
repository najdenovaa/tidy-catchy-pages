import type { PlugResults, PlugInputs } from "@/lib/cement-plug-calculations";

interface Props {
  results: PlugResults;
  inputs: PlugInputs;
}

export default function CementPlugVisualization({ results, inputs }: Props) {
  const { well, plug } = inputs;
  const plugLen = plug.bottomMD - plug.topMD;
  if (plugLen <= 0) return null;

  const W = 340;
  const H = 600;
  const margin = { top: 30, bottom: 20, left: 55, right: 10 };
  const drawH = H - margin.top - margin.bottom;
  const drawW = W - margin.left - margin.right;

  // Zoomed view: show plug interval + margin above/below
  const viewMargin = Math.max(plugLen * 0.6, 50);
  const viewTop = Math.max(0, plug.topMD - viewMargin);
  const viewBottom = Math.min(well.wellDepthMD, plug.bottomMD + viewMargin);
  const viewRange = viewBottom - viewTop;

  const y = (md: number) => margin.top + ((md - viewTop) / viewRange) * drawH;

  // Bore widths (px)
  const maxBorePx = drawW * 0.5;
  const borePx = maxBorePx;
  const pipePx = borePx * (well.pipeOD / (well.holeDiameter || 1));
  const pipeIDPx = borePx * (well.pipeID / (well.holeDiameter || 1));
  const cx = margin.left + drawW / 2;

  // Casing shoe (only if visible in view)
  const shoeY = y(well.casingShoe);
  const shoeVisible = well.casingShoe >= viewTop && well.casingShoe <= viewBottom;

  // Depth ticks
  const tickStep = viewRange > 500 ? 100 : viewRange > 200 ? 50 : viewRange > 100 ? 20 : 10;
  const ticks: number[] = [];
  const firstTick = Math.ceil(viewTop / tickStep) * tickStep;
  for (let d = firstTick; d <= viewBottom; d += tickStep) ticks.push(d);

  // Fluid columns clipped to view
  const annCols = results.fluidColumns.filter(c => c.location === 'annulus' && c.bottomMD > viewTop && c.topMD < viewBottom);
  const pipeCols = results.fluidColumns.filter(c => c.location === 'pipe' && c.bottomMD > viewTop && c.topMD < viewBottom);

  const pipeTopY = y(Math.max(viewTop, 0));
  const pipeBottomY = y(Math.min(viewBottom, plug.bottomMD));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-sm mx-auto" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <defs>
        <linearGradient id="cp-cement-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#90A4AE" />
          <stop offset="100%" stopColor="#546E7A" />
        </linearGradient>
        <linearGradient id="cp-spacer-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4FC3F7" />
          <stop offset="100%" stopColor="#0288D1" />
        </linearGradient>
        <linearGradient id="cp-mud-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A1887F" />
          <stop offset="100%" stopColor="#6D4C41" />
        </linearGradient>
        <pattern id="cp-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#FFD54F" strokeWidth="0.5" opacity="0.3" />
        </pattern>
      </defs>

      {/* Background */}
      <rect x={0} y={0} width={W} height={H} fill="#1a1a2e" rx={8} />

      {/* Zoom indicator */}
      <text x={W / 2} y={14} textAnchor="middle" fill="#eee" fontSize={10} fontWeight="bold">
        Интервал моста ({plug.topMD}–{plug.bottomMD} м)
      </text>
      <text x={W / 2} y={24} textAnchor="middle" fill="#888" fontSize={7}>
        Увеличенный участок {viewTop.toFixed(0)}–{viewBottom.toFixed(0)} м MD
      </text>

      {/* Depth scale */}
      {ticks.map(d => (
        <g key={d}>
          <line x1={margin.left - 5} y1={y(d)} x2={margin.left} y2={y(d)} stroke="#555" strokeWidth={0.5} />
          <text x={margin.left - 8} y={y(d) + 3} textAnchor="end" fill="#999" fontSize={8}>{d}</text>
        </g>
      ))}
      <text x={margin.left - 8} y={margin.top - 5} textAnchor="end" fill="#aaa" fontSize={7}>MD, м</text>

      {/* Borehole wall */}
      <rect x={cx - borePx / 2 - 3} y={margin.top} width={borePx + 6} height={drawH} fill="#2d2d44" rx={2} />

      {/* Casing above shoe */}
      {shoeVisible && well.casingShoe > viewTop && (
        <>
          <rect x={cx - borePx / 2} y={margin.top} width={3} height={shoeY - margin.top} fill="#78909C" />
          <rect x={cx + borePx / 2 - 3} y={margin.top} width={3} height={shoeY - margin.top} fill="#78909C" />
        </>
      )}

      {/* Annulus fluid columns */}
      {annCols.map((col, i) => {
        const yTop = y(Math.max(col.topMD, viewTop));
        const yBot = y(Math.min(col.bottomMD, viewBottom));
        const h = yBot - yTop;
        if (h <= 0) return null;
        const gradId = col.color === "#B0BEC5" ? "cp-cement-grad" : col.color === "#4FC3F7" ? "cp-spacer-grad" : "cp-mud-grad";
        return (
          <g key={`ann-${i}`}>
            <rect x={cx - borePx / 2 + 3} y={yTop} width={(borePx - pipePx) / 2 - 3} height={h} fill={`url(#${gradId})`} opacity={0.85} />
            <rect x={cx + pipePx / 2} y={yTop} width={(borePx - pipePx) / 2 - 3} height={h} fill={`url(#${gradId})`} opacity={0.85} />
          </g>
        );
      })}

      {/* Drill pipe (outer) */}
      <rect x={cx - pipePx / 2} y={pipeTopY} width={2} height={pipeBottomY - pipeTopY} fill="#B0BEC5" />
      <rect x={cx + pipePx / 2 - 2} y={pipeTopY} width={2} height={pipeBottomY - pipeTopY} fill="#B0BEC5" />

      {/* Pipe fluid columns */}
      {pipeCols.map((col, i) => {
        const yTop = y(Math.max(col.topMD, viewTop));
        const yBot = y(Math.min(col.bottomMD, viewBottom));
        const h = yBot - yTop;
        if (h <= 0) return null;
        const gradId = col.color === "#B0BEC5" ? "cp-cement-grad" : col.color === "#4FC3F7" ? "cp-spacer-grad" : "cp-mud-grad";
        return (
          <rect key={`pipe-${i}`} x={cx - pipeIDPx / 2} y={yTop} width={pipeIDPx} height={h} fill={`url(#${gradId})`} opacity={0.8} />
        );
      })}

      {/* Plug interval markers */}
      <line x1={cx - borePx / 2 - 8} y1={y(plug.topMD)} x2={cx + borePx / 2 + 8} y2={y(plug.topMD)} stroke="#FFD54F" strokeWidth={1} strokeDasharray="4,2" />
      <line x1={cx - borePx / 2 - 8} y1={y(plug.bottomMD)} x2={cx + borePx / 2 + 8} y2={y(plug.bottomMD)} stroke="#FFD54F" strokeWidth={1} strokeDasharray="4,2" />
      <text x={cx + borePx / 2 + 10} y={y(plug.topMD) + 3} fill="#FFD54F" fontSize={7}>▲ {plug.topMD} м</text>
      <text x={cx + borePx / 2 + 10} y={y(plug.bottomMD) + 3} fill="#FFD54F" fontSize={7}>▼ {plug.bottomMD} м</text>

      {/* Highlight plug zone */}
      <rect x={cx - borePx / 2 - 8} y={y(plug.topMD)} width={borePx + 16} height={y(plug.bottomMD) - y(plug.topMD)} fill="url(#cp-hatch)" />

      {/* Legend */}
      <g transform={`translate(${margin.left + 5}, ${H - 15})`}>
        <rect width={8} height={8} fill="url(#cp-mud-grad)" rx={1} />
        <text x={10} y={7} fill="#ccc" fontSize={7}>{inputs.wellFluid.name.substring(0, 12)}</text>
        <rect x={80} width={8} height={8} fill="url(#cp-spacer-grad)" rx={1} />
        <text x={90} y={7} fill="#ccc" fontSize={7}>Буфер</text>
        <rect x={130} width={8} height={8} fill="url(#cp-cement-grad)" rx={1} />
        <text x={140} y={7} fill="#ccc" fontSize={7}>Цемент</text>
      </g>
    </svg>
  );
}
