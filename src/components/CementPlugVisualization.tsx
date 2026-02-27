import type { PlugResults, PlugInputs } from "@/lib/cement-plug-calculations";

interface Props {
  results: PlugResults;
  inputs: PlugInputs;
}

/** Shared SVG drawing for a cement plug cross-section */
function PlugSVG({ results, inputs, mode }: Props & { mode: 'equilibrium' | 'wash' }) {
  const { well, plug } = inputs;
  const plugLen = plug.bottomMD - plug.topMD;
  if (plugLen <= 0) return null;

  const W = 340;
  const H = 540;
  const margin = { top: 30, bottom: 20, left: 55, right: 10 };
  const drawH = H - margin.top - margin.bottom;
  const drawW = W - margin.left - margin.right;

  // View range depends on mode
  const viewMargin = Math.max(plugLen * 0.6, 50);
  let viewTop: number, viewBottom: number;

  if (mode === 'equilibrium') {
    viewTop = Math.max(0, plug.topMD - viewMargin - results.spacerAboveHeightAnnMD);
    viewBottom = Math.min(well.wellDepthMD, plug.bottomMD + viewMargin + results.spacerBelowHeightAnnMD);
  } else {
    // Wash: show from pull-out depth to plug bottom + margin
    viewTop = Math.max(0, results.pullOutDepthMD - 30);
    viewBottom = Math.min(well.wellDepthMD, plug.bottomMD + viewMargin + results.spacerBelowHeightAnnMD);
  }
  const viewRange = viewBottom - viewTop;

  const y = (md: number) => margin.top + ((md - viewTop) / viewRange) * drawH;

  const maxBorePx = drawW * 0.5;
  const borePx = maxBorePx;
  const pipePx = borePx * (well.pipeOD / (well.holeDiameter || 1));
  const pipeIDPx = borePx * (well.pipeID / (well.holeDiameter || 1));
  const cx = margin.left + drawW / 2;

  const shoeY = y(well.casingShoe);
  const shoeVisible = well.casingShoe >= viewTop && well.casingShoe <= viewBottom;

  const tickStep = viewRange > 500 ? 100 : viewRange > 200 ? 50 : viewRange > 100 ? 20 : 10;
  const ticks: number[] = [];
  const firstTick = Math.ceil(viewTop / tickStep) * tickStep;
  for (let d = firstTick; d <= viewBottom; d += tickStep) ticks.push(d);

  const annCols = results.fluidColumns.filter(c => c.location === 'annulus' && c.bottomMD > viewTop && c.topMD < viewBottom);
  const pipeCols = results.fluidColumns.filter(c => c.location === 'pipe' && c.bottomMD > viewTop && c.topMD < viewBottom);

  // Pipe extent depends on mode
  const pipeTopMD = mode === 'equilibrium' ? Math.max(viewTop, 0) : Math.max(viewTop, results.pullOutDepthMD);
  const pipeBottomMD = mode === 'equilibrium' ? Math.min(viewBottom, plug.bottomMD) : Math.min(viewBottom, results.pullOutDepthMD);

  const pipeTopY = y(pipeTopMD);
  const pipeBottomY = mode === 'equilibrium' ? y(Math.min(viewBottom, plug.bottomMD)) : y(results.pullOutDepthMD);

  const showPipe = mode === 'equilibrium' || results.pullOutDepthMD > viewTop;

  const title = mode === 'equilibrium'
    ? "Равновесие (до подъёма)"
    : `Промывка (инструмент на ${results.pullOutDepthMD} м)`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-sm mx-auto" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <defs>
        <linearGradient id={`cp-cement-grad-${mode}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#90A4AE" />
          <stop offset="100%" stopColor="#546E7A" />
        </linearGradient>
        <linearGradient id={`cp-spacer-grad-${mode}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4FC3F7" />
          <stop offset="100%" stopColor="#0288D1" />
        </linearGradient>
        <linearGradient id={`cp-mud-grad-${mode}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#A1887F" />
          <stop offset="100%" stopColor="#6D4C41" />
        </linearGradient>
        <pattern id={`cp-hatch-${mode}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#FFD54F" strokeWidth="0.5" opacity="0.3" />
        </pattern>
      </defs>

      <rect x={0} y={0} width={W} height={H} fill="#1a1a2e" rx={8} />

      <text x={W / 2} y={14} textAnchor="middle" fill="#eee" fontSize={9} fontWeight="bold">{title}</text>
      <text x={W / 2} y={24} textAnchor="middle" fill="#888" fontSize={7}>
        {viewTop.toFixed(0)}–{viewBottom.toFixed(0)} м MD
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
        const gradId = col.color === "#B0BEC5" ? `cp-cement-grad-${mode}` : col.color === "#4FC3F7" ? `cp-spacer-grad-${mode}` : `cp-mud-grad-${mode}`;
        return (
          <g key={`ann-${i}`}>
            <rect x={cx - borePx / 2 + 3} y={yTop} width={(borePx - pipePx) / 2 - 3} height={h} fill={`url(#${gradId})`} opacity={0.85} />
            <rect x={cx + pipePx / 2} y={yTop} width={(borePx - pipePx) / 2 - 3} height={h} fill={`url(#${gradId})`} opacity={0.85} />
          </g>
        );
      })}

      {/* Drill pipe */}
      {showPipe && pipeBottomY > pipeTopY && (
        <>
          <rect x={cx - pipePx / 2} y={pipeTopY} width={2} height={pipeBottomY - pipeTopY} fill="#B0BEC5" />
          <rect x={cx + pipePx / 2 - 2} y={pipeTopY} width={2} height={pipeBottomY - pipeTopY} fill="#B0BEC5" />
          {/* Pipe shoe indicator */}
          <line x1={cx - pipePx / 2 - 2} y1={pipeBottomY} x2={cx + pipePx / 2 + 2} y2={pipeBottomY} stroke="#E0E0E0" strokeWidth={1.5} />
        </>
      )}

      {/* Pipe fluid columns (only in equilibrium mode) */}
      {mode === 'equilibrium' && pipeCols.map((col, i) => {
        const yTop = y(Math.max(col.topMD, viewTop));
        const yBot = y(Math.min(col.bottomMD, viewBottom));
        const h = yBot - yTop;
        if (h <= 0) return null;
        const gradId = col.color === "#B0BEC5" ? `cp-cement-grad-${mode}` : col.color === "#4FC3F7" ? `cp-spacer-grad-${mode}` : `cp-mud-grad-${mode}`;
        return (
          <rect key={`pipe-${i}`} x={cx - pipeIDPx / 2} y={yTop} width={pipeIDPx} height={h} fill={`url(#${gradId})`} opacity={0.8} />
        );
      })}

      {/* In wash mode, pipe has well fluid inside */}
      {mode === 'wash' && showPipe && pipeBottomY > pipeTopY && (
        <rect x={cx - pipeIDPx / 2} y={pipeTopY} width={pipeIDPx} height={pipeBottomY - pipeTopY}
          fill={`url(#cp-mud-grad-${mode})`} opacity={0.6} />
      )}

      {/* Plug interval markers */}
      <line x1={cx - borePx / 2 - 8} y1={y(plug.topMD)} x2={cx + borePx / 2 + 8} y2={y(plug.topMD)} stroke="#FFD54F" strokeWidth={1} strokeDasharray="4,2" />
      <line x1={cx - borePx / 2 - 8} y1={y(plug.bottomMD)} x2={cx + borePx / 2 + 8} y2={y(plug.bottomMD)} stroke="#FFD54F" strokeWidth={1} strokeDasharray="4,2" />
      <text x={cx + borePx / 2 + 10} y={y(plug.topMD) + 3} fill="#FFD54F" fontSize={7}>▲ {plug.topMD} м</text>
      <text x={cx + borePx / 2 + 10} y={y(plug.bottomMD) + 3} fill="#FFD54F" fontSize={7}>▼ {plug.bottomMD} м</text>

      {/* Highlight plug zone */}
      <rect x={cx - borePx / 2 - 8} y={y(plug.topMD)} width={borePx + 16} height={y(plug.bottomMD) - y(plug.topMD)} fill={`url(#cp-hatch-${mode})`} />

      {/* In wash mode show pull-out depth label */}
      {mode === 'wash' && showPipe && (
        <text x={cx + borePx / 2 + 10} y={pipeBottomY + 3} fill="#81C784" fontSize={7}>
          🔧 {results.pullOutDepthMD} м
        </text>
      )}

      {/* Spacer interval labels */}
      {results.spacerBelowHeightAnnMD > 0 && (
        <text x={cx} y={y(plug.bottomMD + results.spacerBelowHeightAnnMD / 2) + 3} textAnchor="middle" fill="#4FC3F7" fontSize={6} fontWeight="bold">
          ↕ {results.spacerBelowHeightAnnMD.toFixed(1)} м
        </text>
      )}
      {results.spacerAboveHeightAnnMD > 0 && (
        <text x={cx} y={y(plug.topMD - results.spacerAboveHeightAnnMD / 2) + 3} textAnchor="middle" fill="#4FC3F7" fontSize={6} fontWeight="bold">
          ↕ {results.spacerAboveHeightAnnMD.toFixed(1)} м
        </text>
      )}

      {/* Static pressure labels */}
      <text x={W / 2} y={H - 15} textAnchor="middle" fill="#aaa" fontSize={7}>
        P_затр={results.pressureAnnulus.toFixed(2)} | P_труб={results.pressurePipe.toFixed(2)} МПа
      </text>

      {/* Legend */}
      <g transform={`translate(${margin.left + 5}, ${H - 5})`}>
        <rect width={8} height={8} fill={`url(#cp-mud-grad-${mode})`} rx={1} />
        <text x={10} y={7} fill="#ccc" fontSize={6}>{inputs.wellFluid.name.substring(0, 10)}</text>
        <rect x={75} width={8} height={8} fill={`url(#cp-spacer-grad-${mode})`} rx={1} />
        <text x={85} y={7} fill="#ccc" fontSize={6}>Буфер</text>
        <rect x={120} width={8} height={8} fill={`url(#cp-cement-grad-${mode})`} rx={1} />
        <text x={130} y={7} fill="#ccc" fontSize={6}>Цемент</text>
      </g>
    </svg>
  );
}

export default function CementPlugVisualization({ results, inputs }: Props) {
  const plugLen = inputs.plug.bottomMD - inputs.plug.topMD;
  if (plugLen <= 0) return null;

  return (
    <div className="space-y-4">
      <PlugSVG results={results} inputs={inputs} mode="equilibrium" />
      <PlugSVG results={results} inputs={inputs} mode="wash" />
    </div>
  );
}
