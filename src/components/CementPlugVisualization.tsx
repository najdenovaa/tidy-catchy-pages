import type { PlugResults, PlugInputs } from "@/lib/cement-plug-calculations";

interface Props {
  results: PlugResults;
  inputs: PlugInputs;
}

export default function CementPlugVisualization({ results, inputs }: Props) {
  const { well, plug } = inputs;
  const totalDepth = well.wellDepthMD;
  if (totalDepth <= 0) return null;

  const W = 340;
  const H = 600;
  const margin = { top: 30, bottom: 20, left: 55, right: 10 };
  const drawH = H - margin.top - margin.bottom;
  const drawW = W - margin.left - margin.right;

  const y = (md: number) => margin.top + (md / totalDepth) * drawH;

  // Bore widths (px)
  const maxBorePx = drawW * 0.5;
  const borePx = maxBorePx;
  const pipePx = borePx * (well.pipeOD / (well.holeDiameter || 1));
  const pipeIDPx = borePx * (well.pipeID / (well.holeDiameter || 1));
  const cx = margin.left + drawW / 2;

  // Casing shoe
  const shoeY = y(well.casingShoe);

  // Depth ticks
  const tickStep = totalDepth > 3000 ? 500 : totalDepth > 1000 ? 200 : totalDepth > 500 ? 100 : 50;
  const ticks: number[] = [];
  for (let d = 0; d <= totalDepth; d += tickStep) ticks.push(d);
  if (ticks[ticks.length - 1] < totalDepth) ticks.push(totalDepth);

  // Fluid column rectangles
  const annCols = results.fluidColumns.filter(c => c.location === 'annulus' && c.bottomMD > c.topMD);
  const pipeCols = results.fluidColumns.filter(c => c.location === 'pipe' && c.bottomMD > c.topMD);

  // Pipe goes to plug bottom
  const pipeBottomY = y(plug.bottomMD);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-sm mx-auto" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <defs>
        <linearGradient id="cement-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#90A4AE" />
          <stop offset="100%" stopColor="#546E7A" />
        </linearGradient>
        <linearGradient id="spacer-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4FC3F7" />
          <stop offset="100%" stopColor="#0288D1" />
        </linearGradient>
        <linearGradient id="mud-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A1887F" />
          <stop offset="100%" stopColor="#6D4C41" />
        </linearGradient>
      </defs>

      {/* Background */}
      <rect x={0} y={0} width={W} height={H} fill="#1a1a2e" rx={8} />

      {/* Depth scale */}
      {ticks.map(d => (
        <g key={d}>
          <line x1={margin.left - 5} y1={y(d)} x2={margin.left} y2={y(d)} stroke="#555" strokeWidth={0.5} />
          <text x={margin.left - 8} y={y(d) + 3} textAnchor="end" fill="#999" fontSize={8}>{d}</text>
        </g>
      ))}
      <text x={margin.left - 8} y={margin.top - 10} textAnchor="end" fill="#aaa" fontSize={7}>MD, м</text>

      {/* Borehole wall */}
      <rect x={cx - borePx / 2 - 3} y={margin.top} width={borePx + 6} height={drawH} fill="#2d2d44" rx={2} />

      {/* Casing above shoe */}
      {well.casingShoe > 0 && (
        <>
          <rect x={cx - borePx / 2} y={margin.top} width={3} height={shoeY - margin.top} fill="#78909C" />
          <rect x={cx + borePx / 2 - 3} y={margin.top} width={3} height={shoeY - margin.top} fill="#78909C" />
        </>
      )}

      {/* Annulus fluid columns */}
      {annCols.map((col, i) => {
        const yTop = y(col.topMD);
        const yBot = y(col.bottomMD);
        const h = yBot - yTop;
        if (h <= 0) return null;
        const gradId = col.color === "#B0BEC5" ? "cement-grad" : col.color === "#4FC3F7" ? "spacer-grad" : "mud-grad";
        return (
          <g key={`ann-${i}`}>
            {/* Left annulus */}
            <rect x={cx - borePx / 2 + 3} y={yTop} width={(borePx - pipePx) / 2 - 3} height={h} fill={`url(#${gradId})`} opacity={0.85} />
            {/* Right annulus */}
            <rect x={cx + pipePx / 2} y={yTop} width={(borePx - pipePx) / 2 - 3} height={h} fill={`url(#${gradId})`} opacity={0.85} />
          </g>
        );
      })}

      {/* Drill pipe (outer) */}
      <rect x={cx - pipePx / 2} y={margin.top} width={2} height={pipeBottomY - margin.top} fill="#B0BEC5" />
      <rect x={cx + pipePx / 2 - 2} y={margin.top} width={2} height={pipeBottomY - margin.top} fill="#B0BEC5" />

      {/* Pipe fluid columns */}
      {pipeCols.map((col, i) => {
        const yTop = y(Math.max(0, col.topMD));
        const yBot = y(Math.min(plug.bottomMD, col.bottomMD));
        const h = yBot - yTop;
        if (h <= 0) return null;
        const gradId = col.color === "#B0BEC5" ? "cement-grad" : col.color === "#4FC3F7" ? "spacer-grad" : "mud-grad";
        return (
          <rect key={`pipe-${i}`} x={cx - pipeIDPx / 2} y={yTop} width={pipeIDPx} height={h} fill={`url(#${gradId})`} opacity={0.8} />
        );
      })}

      {/* Plug interval markers */}
      <line x1={cx - borePx / 2 - 8} y1={y(plug.topMD)} x2={cx + borePx / 2 + 8} y2={y(plug.topMD)} stroke="#FFD54F" strokeWidth={1} strokeDasharray="4,2" />
      <line x1={cx - borePx / 2 - 8} y1={y(plug.bottomMD)} x2={cx + borePx / 2 + 8} y2={y(plug.bottomMD)} stroke="#FFD54F" strokeWidth={1} strokeDasharray="4,2" />
      <text x={cx + borePx / 2 + 10} y={y(plug.topMD) + 3} fill="#FFD54F" fontSize={7}>▲ {plug.topMD} м</text>
      <text x={cx + borePx / 2 + 10} y={y(plug.bottomMD) + 3} fill="#FFD54F" fontSize={7}>▼ {plug.bottomMD} м</text>

      {/* Legend */}
      <g transform={`translate(${margin.left + 5}, ${H - 15})`}>
        <rect width={8} height={8} fill="url(#mud-grad)" rx={1} />
        <text x={10} y={7} fill="#ccc" fontSize={7}>Бур. р-р</text>
        <rect x={55} width={8} height={8} fill="url(#spacer-grad)" rx={1} />
        <text x={65} y={7} fill="#ccc" fontSize={7}>Буфер</text>
        <rect x={100} width={8} height={8} fill="url(#cement-grad)" rx={1} />
        <text x={110} y={7} fill="#ccc" fontSize={7}>Цемент</text>
      </g>

      {/* Title */}
      <text x={W / 2} y={14} textAnchor="middle" fill="#eee" fontSize={10} fontWeight="bold">
        Продольное сечение — цементный мост
      </text>
    </svg>
  );
}
