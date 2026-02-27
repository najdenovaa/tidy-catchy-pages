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
      <rect x={cx - jw / 2} y={jy} width={jw} height={jh} rx={2.5}
        fill={`url(#cp-casing-${mode})`} stroke="#616161" strokeWidth={0.6} />
      <line x1={cx - jw / 2 + 2} y1={jy + 3} x2={cx + jw / 2 - 2} y2={jy + 3} stroke="#757575" strokeWidth={0.5} />
      <line x1={cx - jw / 2 + 1.5} y1={jy + jh / 2} x2={cx + jw / 2 - 1.5} y2={jy + jh / 2} stroke="#888" strokeWidth={0.4} />
      <line x1={cx - jw / 2 + 2} y1={jy + jh - 3} x2={cx + jw / 2 - 2} y2={jy + jh - 3} stroke="#757575" strokeWidth={0.5} />
      <rect x={cx - jw / 2 + 1} y={jy + 1} width={jw - 2} height={2.5} rx={1} fill="rgba(255,255,255,0.18)" />
      <rect x={cx - pipePx / 2 - 1} y={bottomY - 2.5} width={pipePx + 2} height={3} rx={1} fill="#BDBDBD" stroke="#9E9E9E" strokeWidth={0.4} />
    </g>
  );
}

/** Side annotation bracket with label */
function SideAnnotation({ x, yTop, yBot, label, color }: { x: number; yTop: number; yBot: number; label: string; color: string }) {
  const h = yBot - yTop;
  if (h < 3) return null;
  const midY = yTop + h / 2;
  const bw = 4;
  return (
    <g>
      <line x1={x} y1={yTop} x2={x + bw} y2={yTop} stroke={color} strokeWidth={0.6} />
      <line x1={x + bw} y1={yTop} x2={x + bw} y2={yBot} stroke={color} strokeWidth={0.6} />
      <line x1={x} y1={yBot} x2={x + bw} y2={yBot} stroke={color} strokeWidth={0.6} />
      <text x={x + bw + 3} y={midY + 3} fill={color} fontSize={6} fontWeight="bold">
        {label}
      </text>
    </g>
  );
}

/** Generate a wavy edge path across the bore width */
function wavyEdgePath(cx: number, borePx: number, baseY: number, amplitude: number, seed: number): string {
  const left = cx - borePx / 2 + 4;
  const right = cx + borePx / 2 - 4;
  const w = right - left;
  const segments = 8;
  const step = w / segments;
  let d = `M${left},${baseY}`;
  for (let i = 0; i < segments; i++) {
    const x1 = left + i * step + step * 0.5;
    const x2 = left + (i + 1) * step;
    // Deterministic pseudo-random based on seed+i
    const phase = Math.sin(seed * 7.3 + i * 2.7) * amplitude;
    const phase2 = Math.sin(seed * 4.1 + i * 1.9) * amplitude * 0.6;
    d += ` Q${x1},${baseY + phase} ${x2},${baseY + phase2}`;
  }
  return d;
}

/** Contamination zone gradient at cement/spacer interface */
function ContaminationZone({ cx, borePx, interfaceY, contaminationPx, mode }: {
  cx: number; borePx: number; interfaceY: number; contaminationPx: number; mode: string;
}) {
  if (contaminationPx < 2) return null;
  const halfZone = contaminationPx / 2;
  const gradId = `cp-contam-${mode}`;
  const clipId = `cp-contam-clip-${mode}`;
  const filterId = `cp-contam-blur-${mode}`;
  const left = cx - borePx / 2 + 4;
  const right = cx + borePx / 2 - 4;
  const topY = interfaceY - halfZone;
  const botY = interfaceY + halfZone;
  const amp = Math.max(3, contaminationPx * 0.25);

  // Build wavy clip path: top wavy edge → right side → bottom wavy edge → left side
  const topEdge = wavyEdgePath(cx, borePx, topY, amp, 1.0);
  const botEdge = wavyEdgePath(cx, borePx, botY, amp, 3.5);
  // Reverse bottom edge for closing
  const botParts = botEdge.split(/[MQ]/).filter(Boolean);
  // Simple close: top wavy → line down right → bottom wavy reversed → line up left
  const clipPath = `${topEdge} L${right},${botY} L${left},${botY} Z`;
  const clipPath2 = `${botEdge} L${right},${topY} L${left},${topY} Z`;

  const numWaves = Math.min(Math.max(Math.floor(contaminationPx / 3), 3), 8);

  return (
    <g>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#90A4AE" stopOpacity={0.5} />
          <stop offset="25%" stopColor="#E65100" stopOpacity={0.3} />
          <stop offset="50%" stopColor="#FF6D00" stopOpacity={0.45} />
          <stop offset="75%" stopColor="#E65100" stopOpacity={0.3} />
          <stop offset="100%" stopColor="#4FC3F7" stopOpacity={0.5} />
        </linearGradient>
        <filter id={filterId}>
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
      </defs>
      {/* Main gradient zone with soft blur */}
      <rect
        x={left} y={topY - amp} width={right - left} height={contaminationPx + amp * 2}
        fill={`url(#${gradId})`} filter={`url(#${filterId})`}
      />
      {/* Wavy mixing lines — organic curves across the zone */}
      {Array.from({ length: numWaves }).map((_, i) => {
        const frac = (i + 1) / (numWaves + 1);
        const yy = topY + frac * contaminationPx;
        const waveAmp = amp * (0.6 + 0.4 * Math.sin(i * 1.7));
        const seed = 2.0 + i * 1.3;
        const wavePath = wavyEdgePath(cx, borePx, yy, waveAmp, seed);
        const opacity = 0.25 + 0.2 * Math.sin(i * 2.1);
        return (
          <path
            key={i}
            d={wavePath}
            stroke={i % 2 === 0 ? "rgba(255,109,0,0.5)" : "rgba(79,195,247,0.4)"}
            strokeWidth={0.8 + Math.sin(i * 1.3) * 0.3}
            fill="none"
            opacity={opacity + 0.3}
          />
        );
      })}
    </g>
  );
}

function PlugSVG({ results, inputs, mode, sharedViewTop, sharedViewBottom }: Props & { mode: 'equilibrium' | 'wash'; sharedViewTop?: number; sharedViewBottom?: number }) {
  const { well, plug } = inputs;
  const plugLen = plug.bottomMD - plug.topMD;
  if (plugLen <= 0) return null;

  const W = 420;
  const H = 580;
  const margin = { top: 32, bottom: 28, left: 58, right: 110 };
  const drawH = H - margin.top - margin.bottom;
  const drawW = W - margin.left - margin.right;

  const viewMargin = Math.max(plugLen * 0.6, 50);

  let viewTop: number, viewBottom: number;
  if (sharedViewTop !== undefined && sharedViewBottom !== undefined) {
    viewTop = sharedViewTop;
    viewBottom = sharedViewBottom;
  } else if (mode === 'equilibrium') {
    viewTop = Math.max(0, plug.topMD - viewMargin - results.spacerAboveHeightAnnMD);
    viewBottom = Math.min(well.wellDepthMD, plug.bottomMD + viewMargin + results.spacerBelowHeightAnnMD);
  } else {
    viewTop = Math.max(0, results.pullOutDepthMD - 30);
    viewBottom = Math.min(well.wellDepthMD, plug.bottomMD + viewMargin + results.spacerBelowHeightAnnMD);
  }
  const viewRange = viewBottom - viewTop;

  const y = (md: number) => margin.top + ((md - viewTop) / viewRange) * drawH;
  const clampY = (md: number) => y(Math.max(viewTop, Math.min(viewBottom, md)));

  // Zenith angle for tilting
  const zenithDeg = results.plugZenithDeg ?? 0;
  // Limit visual tilt to max 25° for readability
  const visualTiltDeg = Math.min(zenithDeg, 25);

  const maxBorePx = drawW * 0.55;
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

  // Annotation x position (right side of bore)
  const annX = cx + borePx / 2 + 8;

  // Cement top during placement
  const cementTopMD = plug.bottomMD - results.cementHeightAnnMD;

  // Wash mode spacer recalculation
  const boreAreaM2 = (Math.PI / 4) * ((results.boreDiamUsed || well.holeDiameter) / 1000) ** 2;
  const spacerWashHeight = boreAreaM2 > 0 ? inputs.spacerVolumeAboveM3 / boreAreaM2 : results.spacerAboveHeightAnnMD;
  const spacerWashTop = plug.topMD - spacerWashHeight;

  // Contamination zone
  const contaminationM = results.stability?.contaminationDepthM ?? 0;
  const contaminationPx = contaminationM > 0 ? (contaminationM / viewRange) * drawH : 0;
  const cementBottomY = clampY(plug.bottomMD);

  // Tilt transform: rotate the entire bore section around its center
  const boreGroupCenterY = margin.top + drawH / 2;
  const tiltTransform = visualTiltDeg > 1 ? `rotate(${visualTiltDeg}, ${cx}, ${boreGroupCenterY})` : '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md mx-auto" style={{ fontFamily: 'system-ui, sans-serif' }}>
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
        <pattern id={`cp-rock-${mode}`} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#3a3a40" />
          <circle cx="2" cy="3" r="0.8" fill="#555" />
          <circle cx="8" cy="7" r="1" fill="#4a4a52" />
          <circle cx="5" cy="10" r="0.6" fill="#555" />
          <line x1="0" y1="6" x2="4" y2="5" stroke="#4a4a50" strokeWidth="0.3" />
          <line x1="7" y1="2" x2="11" y2="3" stroke="#4a4a50" strokeWidth="0.3" />
        </pattern>
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
        {zenithDeg > 1 ? ` · θ=${zenithDeg.toFixed(1)}°` : ''}
      </text>

      {/* Depth scale (NOT tilted — stays vertical as reference) */}
      {ticks.map(d => (
        <g key={d}>
          <line x1={margin.left - 5} y1={y(d)} x2={margin.left} y2={y(d)} stroke="#555" strokeWidth={0.5} />
          <text x={margin.left - 8} y={y(d) + 3} textAnchor="end" fill="#999" fontSize={8}>{d}</text>
        </g>
      ))}
      <text x={margin.left - 8} y={margin.top - 5} textAnchor="end" fill="#aaa" fontSize={7}>MD, м</text>

      {/* ═══ TILTED BORE GROUP ═══ */}
      <g transform={tiltTransform}>
        {/* Rock / formation background */}
        <rect x={cx - borePx / 2 - 12} y={margin.top} width={borePx + 24} height={drawH}
          fill={`url(#cp-rock-${mode})`} rx={2} />

        {/* Open hole rough walls */}
        {ohVisible && (
          <>
            <path d={generateRoughWall(cx - borePx / 2 - 6, ohTopY, ohBottomY, -1)}
              fill={`url(#cp-openhole-${mode})`} stroke="#6a5a4e" strokeWidth={0.5} />
            <path d={generateRoughWall(cx + borePx / 2 + 6, ohTopY, ohBottomY, 1)}
              fill={`url(#cp-openhole-${mode})`} stroke="#6a5a4e" strokeWidth={0.5} />
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
            {shoeVisible && (
              <>
                <rect x={cx - borePx / 2 - 2} y={shoeY - 2} width={8} height={4} fill="#FFB74D" rx={1} />
                <rect x={cx + borePx / 2 - 6} y={shoeY - 2} width={8} height={4} fill="#FFB74D" rx={1} />
              </>
            )}
          </>
        )}

        {/* ─── FLUID COLUMNS ─── */}
        {mode === 'equilibrium' ? (
          <>
            {annCols.map((col, i) => {
              const yTop = clampY(col.topMD);
              const yBot = clampY(col.bottomMD);
              const h = yBot - yTop;
              if (h <= 0) return null;
              const gradId = getGradId(col.color, mode);
              return (
                <rect key={`ann-${i}`} x={cx - borePx / 2 + 4} y={yTop} width={borePx - 8} height={h}
                  fill={`url(#${gradId})`} opacity={0.85} />
              );
            })}
            {showPipe && pipeBottomY > pipeTopY && (
              <>
                <rect x={cx - pipePx / 2} y={pipeTopY} width={2.5} height={pipeBottomY - pipeTopY} fill="#B0BEC5" stroke="#90A4AE" strokeWidth={0.3} />
                <rect x={cx + pipePx / 2 - 2.5} y={pipeTopY} width={2.5} height={pipeBottomY - pipeTopY} fill="#B0BEC5" stroke="#90A4AE" strokeWidth={0.3} />
                <BottomToolJoint cx={cx} pipePx={pipePx} bottomY={pipeBottomY} mode={mode} />
              </>
            )}
            {pipeCols.map((col, i) => {
              const yTop = clampY(col.topMD);
              const yBot = clampY(col.bottomMD);
              const h = yBot - yTop;
              if (h <= 0) return null;
              const gradId = getGradId(col.color, mode);
              return (
                <rect key={`pipe-${i}`} x={cx - pipeIDPx / 2} y={yTop} width={pipeIDPx} height={h}
                  fill={`url(#${gradId})`} opacity={0.8} />
              );
            })}
          </>
        ) : (
          <>
            {(() => {
              const boreAreaM2Local = (Math.PI / 4) * ((results.boreDiamUsed || well.holeDiameter) / 1000) ** 2;
              const spacerAboveVol = inputs.spacerVolumeAboveM3;
              const spacerWashHeightLocal = boreAreaM2Local > 0 ? spacerAboveVol / boreAreaM2Local : results.spacerAboveHeightAnnMD;
              const spacerWashBottom = plug.topMD;
              const spacerWashTopLocal = plug.topMD - spacerWashHeightLocal;
              const freedTop = cementTopMD;
              const freedBottom = spacerWashTopLocal;

              const washCols: typeof annCols = [];
              for (const col of annCols) {
                const isCement = col.color === '#B0BEC5';
                const isSpacer = col.color === '#4FC3F7';
                if (isCement) {
                  const ct = Math.max(col.topMD, plug.topMD);
                  const cb = Math.min(col.bottomMD, plug.bottomMD);
                  if (cb > ct) washCols.push({ ...col, topMD: ct, bottomMD: cb });
                } else if (isSpacer && col.bottomMD <= cementTopMD + 1 && col.topMD < cementTopMD) {
                  washCols.push({ ...col, topMD: spacerWashTopLocal, bottomMD: spacerWashBottom });
                } else if (col.location === 'annulus' && col.bottomMD <= cementTopMD && col.topMD < col.bottomMD) {
                  washCols.push({ ...col, bottomMD: spacerWashTopLocal });
                } else {
                  washCols.push(col);
                }
              }
              washCols.sort((a, b) => a.topMD - b.topMD);

              return washCols.map((col, i) => {
                const yTop = clampY(col.topMD);
                const yBot = clampY(col.bottomMD);
                const h = yBot - yTop;
                if (h <= 0) return null;
                const gradId = getGradId(col.color, mode);
                return (
                  <rect key={`wash-ann-${i}`} x={cx - borePx / 2 + 4} y={yTop} width={borePx - 8} height={h}
                    fill={`url(#${gradId})`} opacity={0.85} />
                );
              });
            })()}
            {showPipe && pipeBottomY > pipeTopY && (
              <>
                <rect x={cx - pipePx / 2} y={pipeTopY} width={2.5} height={pipeBottomY - pipeTopY} fill="#B0BEC5" stroke="#90A4AE" strokeWidth={0.3} />
                <rect x={cx + pipePx / 2 - 2.5} y={pipeTopY} width={2.5} height={pipeBottomY - pipeTopY} fill="#B0BEC5" stroke="#90A4AE" strokeWidth={0.3} />
                <BottomToolJoint cx={cx} pipePx={pipePx} bottomY={pipeBottomY} mode={mode} />
                <rect x={cx - pipeIDPx / 2} y={pipeTopY} width={pipeIDPx} height={pipeBottomY - pipeTopY}
                  fill={`url(#cp-mud-grad-${mode})`} opacity={0.6} />
              </>
            )}
          </>
        )}

        {/* ─── CONTAMINATION ZONE at cement/spacer interface ─── */}
        {contaminationPx > 0 && mode === 'wash' && (
          <ContaminationZone
            cx={cx}
            borePx={borePx}
            interfaceY={cementBottomY}
            contaminationPx={contaminationPx}
            mode={mode}
          />
        )}

        {/* ─── SIDE ANNOTATIONS ─── */}
        {(() => {
          const spacerTopMD = mode === 'wash' ? spacerWashTop : (cementTopMD - results.spacerAboveHeightAnnMD);
          if (spacerTopMD > viewTop) {
            return (
              <SideAnnotation x={annX} yTop={clampY(viewTop)} yBot={clampY(spacerTopMD)}
                label={`${inputs.wellFluid.name.substring(0, 12)}`} color="#A1887F" />
            );
          }
          return null;
        })()}

        {results.spacerAboveHeightAnnMD > 0 && (() => {
          const sTop = mode === 'wash' ? spacerWashTop : (cementTopMD - results.spacerAboveHeightAnnMD);
          const sBot = mode === 'wash' ? plug.topMD : cementTopMD;
          const sHeight = mode === 'wash' ? spacerWashHeight : results.spacerAboveHeightAnnMD;
          const note = mode === 'equilibrium' ? ' (с БИ)' : '';
          return (
            <SideAnnotation x={annX}
              yTop={clampY(sTop)}
              yBot={clampY(sBot)}
              label={`Буфер ↕${sHeight.toFixed(1)}м${note}`} color="#4FC3F7" />
          );
        })()}

        {mode === 'equilibrium' ? (
          <SideAnnotation x={annX}
            yTop={clampY(cementTopMD)}
            yBot={clampY(plug.bottomMD)}
            label={`Цемент ↕${results.cementHeightAnnMD.toFixed(1)}м (с БИ)`} color="#B0BEC5" />
        ) : (
          <SideAnnotation x={annX}
            yTop={clampY(plug.topMD)}
            yBot={clampY(plug.bottomMD)}
            label={`Цем. мост ↕${plugLen}м`} color="#B0BEC5" />
        )}

        {/* Contamination annotation */}
        {contaminationM > 0.1 && mode === 'wash' && (
          <SideAnnotation x={annX}
            yTop={cementBottomY - contaminationPx / 2}
            yBot={cementBottomY + contaminationPx / 2}
            label={`Смешение ~${contaminationM.toFixed(1)}м`} color="#FF6D00" />
        )}

        {results.spacerBelowHeightAnnMD > 0 && (
          <SideAnnotation x={annX}
            yTop={clampY(plug.bottomMD)}
            yBot={clampY(plug.bottomMD + results.spacerBelowHeightAnnMD)}
            label={`Буфер ↕${results.spacerBelowHeightAnnMD.toFixed(1)}м`} color="#4FC3F7" />
        )}

        {plug.bottomMD + results.spacerBelowHeightAnnMD < viewBottom && (
          <SideAnnotation x={annX}
            yTop={clampY(plug.bottomMD + results.spacerBelowHeightAnnMD)}
            yBot={clampY(viewBottom)}
            label={inputs.wellFluid.name.substring(0, 12)} color="#A1887F" />
        )}

        {showPipe && (
          <text
            x={cx + pipePx / 2 + 4}
            y={pipeTopY + (pipeBottomY - pipeTopY) / 2}
            fill="#81C784" fontSize={6} fontWeight="bold"
            dominantBaseline="middle"
          >
            БИ ∅{well.pipeOD}
          </text>
        )}

        {shoeVisible && (
          <text x={cx - borePx / 2 - 14} y={shoeY + 3} textAnchor="end" fill="#FFB74D" fontSize={6}>
            башмак {well.casingShoe}м
          </text>
        )}

        {/* Plug interval markers */}
        <line x1={cx - borePx / 2 - 8} y1={clampY(plug.topMD)} x2={cx + borePx / 2 + 5} y2={clampY(plug.topMD)} stroke="#FFD54F" strokeWidth={1} strokeDasharray="4,2" />
        <line x1={cx - borePx / 2 - 8} y1={clampY(plug.bottomMD)} x2={cx + borePx / 2 + 5} y2={clampY(plug.bottomMD)} stroke="#FFD54F" strokeWidth={1} strokeDasharray="4,2" />
        <text x={cx - borePx / 2 - 10} y={clampY(plug.topMD) + 3} textAnchor="end" fill="#FFD54F" fontSize={6.5}>▲ {plug.topMD}м</text>
        <text x={cx - borePx / 2 - 10} y={clampY(plug.bottomMD) + 3} textAnchor="end" fill="#FFD54F" fontSize={6.5}>▼ {plug.bottomMD}м</text>

        {mode === 'equilibrium' && results.cementHeightAnnMD > results.plugLengthMD && (
          <>
            <line x1={cx - borePx / 2 - 8} y1={clampY(cementTopMD)} x2={cx + borePx / 2 + 5} y2={clampY(cementTopMD)}
              stroke="#E0E0E0" strokeWidth={0.8} strokeDasharray="3,2" />
            <text x={cx - borePx / 2 - 10} y={clampY(cementTopMD) + 3} textAnchor="end" fill="#E0E0E0" fontSize={6}>
              верх цем. {cementTopMD.toFixed(0)}м
            </text>
          </>
        )}

        {mode === 'wash' && showPipe && (
          <text x={cx - borePx / 2 - 10} y={pipeBottomY + 3} textAnchor="end" fill="#81C784" fontSize={6.5}>
            🔧 {results.pullOutDepthMD}м
          </text>
        )}
      </g>
      {/* END TILTED GROUP */}

      {/* Static pressure (NOT tilted) */}
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

function getGradId(color: string, mode: string): string {
  if (color === "#B0BEC5") return `cp-cement-grad-${mode}`;
  if (color === "#4FC3F7") return `cp-spacer-grad-${mode}`;
  return `cp-mud-grad-${mode}`;
}

/** Generate a rough/irregular wall path for open hole */
function generateRoughWall(x: number, topY: number, bottomY: number, dir: number): string {
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
  const { well, plug } = inputs;
  const plugLen = plug.bottomMD - plug.topMD;
  if (plugLen <= 0) return null;

  const viewMargin = Math.max(plugLen * 0.6, 50);
  const eqTop = Math.max(0, plug.topMD - viewMargin - results.spacerAboveHeightAnnMD);
  const washTop = Math.max(0, results.pullOutDepthMD - 30);
  const sharedViewTop = Math.min(eqTop, washTop);
  const sharedViewBottom = Math.min(well.wellDepthMD, plug.bottomMD + viewMargin + results.spacerBelowHeightAnnMD);

  return (
    <div className="flex flex-col md:flex-row gap-4 w-full">
      <div className="flex-1 min-w-0">
        <PlugSVG results={results} inputs={inputs} mode="equilibrium" sharedViewTop={sharedViewTop} sharedViewBottom={sharedViewBottom} />
      </div>
      <div className="flex-1 min-w-0">
        <PlugSVG results={results} inputs={inputs} mode="wash" sharedViewTop={sharedViewTop} sharedViewBottom={sharedViewBottom} />
      </div>
    </div>
  );
}
