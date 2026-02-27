import type { PlugResults, PlugInputs } from "@/lib/cement-plug-calculations";

interface Props {
  results: PlugResults;
  inputs: PlugInputs;
}

/** Single detailed tool joint (муфта) at pipe bottom */
function BottomToolJoint({ cx, pipePx, bottomY, mode }: { cx: number; pipePx: number; bottomY: number; mode: string }) {
  const jw = pipePx * 1.6;
  const jh = 14;
  const jy = bottomY - jh;
  return (
    <g>
      {/* Joint body */}
      <rect x={cx - jw / 2} y={jy} width={jw} height={jh} rx={2.5}
        fill={`url(#cp-casing-${mode})`} stroke="#616161" strokeWidth={0.6} />
      {/* Upper groove */}
      <line x1={cx - jw / 2 + 2} y1={jy + 3} x2={cx + jw / 2 - 2} y2={jy + 3} stroke="#757575" strokeWidth={0.5} />
      {/* Center groove */}
      <line x1={cx - jw / 2 + 1.5} y1={jy + jh / 2} x2={cx + jw / 2 - 1.5} y2={jy + jh / 2} stroke="#888" strokeWidth={0.4} />
      {/* Lower groove */}
      <line x1={cx - jw / 2 + 2} y1={jy + jh - 3} x2={cx + jw / 2 - 2} y2={jy + jh - 3} stroke="#757575" strokeWidth={0.5} />
      {/* Highlight reflection */}
      <rect x={cx - jw / 2 + 1} y={jy + 1} width={jw - 2} height={2.5} rx={1} fill="rgba(255,255,255,0.18)" />
      {/* Bottom cap */}
      <rect x={cx - pipePx / 2 - 1} y={bottomY - 2.5} width={pipePx + 2} height={3} rx={1} fill="#BDBDBD" stroke="#9E9E9E" strokeWidth={0.4} />
    </g>
  );
}

function PlugSVG({ results, inputs, mode }: Props & { mode: 'equilibrium' | 'wash' }) {
  const { well, plug } = inputs;
  const plugLen = plug.bottomMD - plug.topMD;
  if (plugLen <= 0) return null;

  const W = 360;
  const H = 580;
  const margin = { top: 32, bottom: 24, left: 58, right: 14 };
  const drawH = H - margin.top - margin.bottom;
  const drawW = W - margin.left - margin.right;

  const viewMargin = Math.max(plugLen * 0.6, 50);
  let viewTop: number, viewBottom: number;

  if (mode === 'equilibrium') {
    viewTop = Math.max(0, plug.topMD - viewMargin - results.spacerAboveHeightAnnMD);
    viewBottom = Math.min(well.wellDepthMD, plug.bottomMD + viewMargin + results.spacerBelowHeightAnnMD);
  } else {
    viewTop = Math.max(0, results.pullOutDepthMD - 30);
    viewBottom = Math.min(well.wellDepthMD, plug.bottomMD + viewMargin + results.spacerBelowHeightAnnMD);
  }
  const viewRange = viewBottom - viewTop;

  const y = (md: number) => margin.top + ((md - viewTop) / viewRange) * drawH;

  const maxBorePx = drawW * 0.5;
  const borePx = maxBorePx;
  const pipePx = borePx * (well.pipeOD / (results.boreDiamUsed || well.holeDiameter || 1));
  const pipeIDPx = borePx * (well.pipeID / (results.boreDiamUsed || well.holeDiameter || 1));
  const cx = margin.left + drawW / 2;

  const shoeY = y(well.casingShoe);
  const shoeVisible = well.casingShoe >= viewTop && well.casingShoe <= viewBottom;
  const isOpenHole = results.isOpenHole;

  const tickStep = viewRange > 500 ? 100 : viewRange > 200 ? 50 : viewRange > 100 ? 20 : 10;
  const ticks: number[] = [];
  const firstTick = Math.ceil(viewTop / tickStep) * tickStep;
  for (let d = firstTick; d <= viewBottom; d += tickStep) ticks.push(d);

  const annCols = results.fluidColumns.filter(c => c.location === 'annulus' && c.bottomMD > viewTop && c.topMD < viewBottom);
  const pipeCols = results.fluidColumns.filter(c => c.location === 'pipe' && c.bottomMD > viewTop && c.topMD < viewBottom);

  const pipeTopMD = Math.max(viewTop, 0);
  const pipeBottomMD = mode === 'equilibrium' ? Math.min(viewBottom, plug.bottomMD) : Math.min(viewBottom, results.pullOutDepthMD);

  const pipeTopY = y(pipeTopMD);
  const pipeBottomY = y(pipeBottomMD);

  const showPipe = pipeBottomMD > pipeTopMD;

  const title = mode === 'equilibrium'
    ? "Равновесие (до подъёма)"
    : `Промывка (инструмент на ${results.pullOutDepthMD} м)`;

  // Open hole zone
  const ohTop = Math.max(viewTop, well.casingShoe);
  const ohBottom = viewBottom;
  const ohTopY = y(ohTop);
  const ohBottomY = y(ohBottom);
  const ohVisible = isOpenHole && ohTop < ohBottom;

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
        {/* Rock texture pattern */}
        <pattern id={`cp-rock-${mode}`} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#3a3a40" />
          <circle cx="2" cy="3" r="0.8" fill="#555" />
          <circle cx="8" cy="7" r="1" fill="#4a4a52" />
          <circle cx="5" cy="10" r="0.6" fill="#555" />
          <line x1="0" y1="6" x2="4" y2="5" stroke="#4a4a50" strokeWidth="0.3" />
          <line x1="7" y1="2" x2="11" y2="3" stroke="#4a4a50" strokeWidth="0.3" />
        </pattern>
        {/* Open hole rough texture */}
        <pattern id={`cp-openhole-${mode}`} width="8" height="10" patternUnits="userSpaceOnUse">
          <rect width="8" height="10" fill="#4a3a2e" />
          <circle cx="2" cy="2" r="1.2" fill="#5a4a3e" />
          <circle cx="6" cy="6" r="1.5" fill="#6a5a4e" />
          <circle cx="4" cy="9" r="0.8" fill="#5a4a3e" />
          <path d="M0,4 Q2,3 4,4 T8,4" stroke="#6a5a4e" strokeWidth="0.5" fill="none" />
        </pattern>
        <pattern id={`cp-hatch-${mode}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#FFD54F" strokeWidth="0.5" opacity="0.3" />
        </pattern>
        {/* Casing gradient */}
        <linearGradient id={`cp-casing-${mode}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#90A4AE" />
          <stop offset="50%" stopColor="#B0BEC5" />
          <stop offset="100%" stopColor="#78909C" />
        </linearGradient>
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

      {/* Rock / formation background */}
      <rect x={cx - borePx / 2 - 12} y={margin.top} width={borePx + 24} height={drawH}
        fill={`url(#cp-rock-${mode})`} rx={2} />

      {/* Open hole rough walls */}
      {ohVisible && (
        <>
          {/* Irregular left wall */}
          <path d={generateRoughWall(cx - borePx / 2 - 6, ohTopY, ohBottomY, -1, borePx)}
            fill={`url(#cp-openhole-${mode})`} stroke="#6a5a4e" strokeWidth={0.5} />
          {/* Irregular right wall */}
          <path d={generateRoughWall(cx + borePx / 2 + 6, ohTopY, ohBottomY, 1, borePx)}
            fill={`url(#cp-openhole-${mode})`} stroke="#6a5a4e" strokeWidth={0.5} />
          {/* Open hole label */}
          <text x={cx + borePx / 2 + 18} y={ohTopY + (ohBottomY - ohTopY) / 2}
            fill="#8B7355" fontSize={6} transform={`rotate(90, ${cx + borePx / 2 + 18}, ${ohTopY + (ohBottomY - ohTopY) / 2})`}
            textAnchor="middle">ОТКРЫТЫЙ СТВОЛ</text>
        </>
      )}

      {/* Borehole interior */}
      <rect x={cx - borePx / 2} y={margin.top} width={borePx} height={drawH} fill="#2d2d44" rx={1} />

      {/* Casing walls */}
      {well.casingShoe >= viewTop && (
        <>
          <rect x={cx - borePx / 2} y={margin.top} width={4} height={Math.min(shoeY, margin.top + drawH) - margin.top}
            fill={`url(#cp-casing-${mode})`} />
          <rect x={cx + borePx / 2 - 4} y={margin.top} width={4} height={Math.min(shoeY, margin.top + drawH) - margin.top}
            fill={`url(#cp-casing-${mode})`} />
          {/* Casing shoe marker */}
          {shoeVisible && (
            <>
              <rect x={cx - borePx / 2 - 2} y={shoeY - 2} width={8} height={4} fill="#FFB74D" rx={1} />
              <rect x={cx + borePx / 2 - 6} y={shoeY - 2} width={8} height={4} fill="#FFB74D" rx={1} />
              <text x={cx - borePx / 2 - 14} y={shoeY + 3} textAnchor="end" fill="#FFB74D" fontSize={6}>башмак</text>
            </>
          )}
        </>
      )}

      {/* Fluid columns — full bore width, then pipe overlays on top */}
      {mode === 'equilibrium' ? (
        <>
          {/* Equilibrium: annulus fills full bore, pipe draws on top */}
          {annCols.map((col, i) => {
            const yTop = y(Math.max(col.topMD, viewTop));
            const yBot = y(Math.min(col.bottomMD, viewBottom));
            const h = yBot - yTop;
            if (h <= 0) return null;
            const gradId = col.color === "#B0BEC5" ? `cp-cement-grad-${mode}` : col.color === "#4FC3F7" ? `cp-spacer-grad-${mode}` : `cp-mud-grad-${mode}`;
            return (
              <rect key={`ann-${i}`} x={cx - borePx / 2 + 4} y={yTop} width={borePx - 8} height={h}
                fill={`url(#${gradId})`} opacity={0.85} />
            );
          })}
          {/* Pipe walls on top */}
          {showPipe && pipeBottomY > pipeTopY && (
            <>
              <rect x={cx - pipePx / 2} y={pipeTopY} width={2.5} height={pipeBottomY - pipeTopY} fill="#B0BEC5" stroke="#90A4AE" strokeWidth={0.3} />
              <rect x={cx + pipePx / 2 - 2.5} y={pipeTopY} width={2.5} height={pipeBottomY - pipeTopY} fill="#B0BEC5" stroke="#90A4AE" strokeWidth={0.3} />
              <BottomToolJoint cx={cx} pipePx={pipePx} bottomY={pipeBottomY} mode={mode} />
            </>
          )}
          {/* Pipe interior fluid */}
          {pipeCols.map((col, i) => {
            const yTop = y(Math.max(col.topMD, viewTop));
            const yBot = y(Math.min(col.bottomMD, viewBottom));
            const h = yBot - yTop;
            if (h <= 0) return null;
            const gradId = col.color === "#B0BEC5" ? `cp-cement-grad-${mode}` : col.color === "#4FC3F7" ? `cp-spacer-grad-${mode}` : `cp-mud-grad-${mode}`;
            return (
              <rect key={`pipe-${i}`} x={cx - pipeIDPx / 2} y={yTop} width={pipeIDPx} height={h}
                fill={`url(#${gradId})`} opacity={0.8} />
            );
          })}
          {/* Cement top marker (placement height, above plug.topMD) */}
          {results.cementHeightAnnMD > results.plugLengthMD && (
            <>
              <line x1={cx - borePx / 2} y1={y(plug.bottomMD - results.cementHeightAnnMD)}
                x2={cx + borePx / 2} y2={y(plug.bottomMD - results.cementHeightAnnMD)}
                stroke="#E0E0E0" strokeWidth={0.8} strokeDasharray="3,2" />
              <text x={cx + borePx / 2 + 16} y={y(plug.bottomMD - results.cementHeightAnnMD) + 3}
                fill="#E0E0E0" fontSize={6}>
                верх цем. {(plug.bottomMD - results.cementHeightAnnMD).toFixed(1)} м
              </text>
            </>
          )}
        </>
      ) : (
        <>
          {/* Wash mode: pipe pulled out, cement settled to plug interval */}
          {/* Mud above settled cement — full bore */}
          {annCols.filter(c => c.color !== "#B0BEC5").map((col, i) => {
            const yTop = y(Math.max(col.topMD, viewTop));
            const yBot = y(Math.min(col.bottomMD, viewBottom));
            const h = yBot - yTop;
            if (h <= 0) return null;
            const gradId = col.color === "#4FC3F7" ? `cp-spacer-grad-${mode}` : `cp-mud-grad-${mode}`;
            return (
              <rect key={`wash-fluid-${i}`} x={cx - borePx / 2 + 4} y={yTop} width={borePx - 8} height={h}
                fill={`url(#${gradId})`} opacity={0.85} />
            );
          })}
          {/* Settled cement plug — full bore, plug.topMD to plug.bottomMD */}
          <rect x={cx - borePx / 2 + 4} y={y(Math.max(plug.topMD, viewTop))}
            width={borePx - 8} height={y(Math.min(plug.bottomMD, viewBottom)) - y(Math.max(plug.topMD, viewTop))}
            fill={`url(#cp-cement-grad-${mode})`} opacity={0.9} />
          {/* Pipe above cement with tool joint */}
          {showPipe && pipeBottomY > pipeTopY && (
            <>
              <rect x={cx - pipePx / 2} y={pipeTopY} width={2.5} height={pipeBottomY - pipeTopY} fill="#B0BEC5" stroke="#90A4AE" strokeWidth={0.3} />
              <rect x={cx + pipePx / 2 - 2.5} y={pipeTopY} width={2.5} height={pipeBottomY - pipeTopY} fill="#B0BEC5" stroke="#90A4AE" strokeWidth={0.3} />
              <BottomToolJoint cx={cx} pipePx={pipePx} bottomY={pipeBottomY} mode={mode} />
              {/* Mud inside pipe */}
              <rect x={cx - pipeIDPx / 2} y={pipeTopY} width={pipeIDPx} height={pipeBottomY - pipeTopY}
                fill={`url(#cp-mud-grad-${mode})`} opacity={0.6} />
            </>
          )}
          {/* Pull-out label */}
          {showPipe && (
            <text x={cx + borePx / 2 + 16} y={pipeBottomY + 3} fill="#81C784" fontSize={7}>
              🔧 {results.pullOutDepthMD} м
            </text>
          )}
        </>
      )}

      {/* Plug interval markers */}
      <line x1={cx - borePx / 2 - 14} y1={y(plug.topMD)} x2={cx + borePx / 2 + 14} y2={y(plug.topMD)} stroke="#FFD54F" strokeWidth={1} strokeDasharray="4,2" />
      <line x1={cx - borePx / 2 - 14} y1={y(plug.bottomMD)} x2={cx + borePx / 2 + 14} y2={y(plug.bottomMD)} stroke="#FFD54F" strokeWidth={1} strokeDasharray="4,2" />
      <text x={cx + borePx / 2 + 16} y={y(plug.topMD) + 3} fill="#FFD54F" fontSize={7}>▲ {plug.topMD} м</text>
      <text x={cx + borePx / 2 + 16} y={y(plug.bottomMD) + 3} fill="#FFD54F" fontSize={7}>▼ {plug.bottomMD} м</text>
      <rect x={cx - borePx / 2 - 14} y={y(plug.topMD)} width={borePx + 28} height={y(plug.bottomMD) - y(plug.topMD)} fill={`url(#cp-hatch-${mode})`} />

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

      {/* Static pressure */}
      <text x={W / 2} y={H - 18} textAnchor="middle" fill="#aaa" fontSize={7}>
        P_затр={results.pressureAnnulus.toFixed(2)} | P_труб={results.pressurePipe.toFixed(2)} МПа
      </text>

      {/* Legend */}
      <g transform={`translate(${margin.left + 5}, ${H - 7})`}>
        <rect width={8} height={8} fill={`url(#cp-mud-grad-${mode})`} rx={1} />
        <text x={10} y={7} fill="#ccc" fontSize={6}>{inputs.wellFluid.name.substring(0, 10)}</text>
        <rect x={75} width={8} height={8} fill={`url(#cp-spacer-grad-${mode})`} rx={1} />
        <text x={85} y={7} fill="#ccc" fontSize={6}>Буфер</text>
        <rect x={120} width={8} height={8} fill={`url(#cp-cement-grad-${mode})`} rx={1} />
        <text x={130} y={7} fill="#ccc" fontSize={6}>Цемент</text>
        <rect x={170} width={8} height={8} fill={`url(#cp-rock-${mode})`} rx={1} stroke="#555" strokeWidth={0.3} />
        <text x={180} y={7} fill="#ccc" fontSize={6}>Порода</text>
      </g>
    </svg>
  );
}

/** Generate a rough/irregular wall path for open hole */
function generateRoughWall(x: number, topY: number, bottomY: number, dir: number, borePx: number): string {
  const amplitude = 4;
  const step = 8;
  let path = `M${x},${topY}`;
  for (let yy = topY; yy <= bottomY; yy += step) {
    const offset = dir * (Math.sin(yy * 0.3) * amplitude + Math.cos(yy * 0.7) * amplitude * 0.5);
    path += ` L${x + offset},${yy}`;
  }
  path += ` L${x},${bottomY}`;
  path += ` Z`;
  return path;
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
