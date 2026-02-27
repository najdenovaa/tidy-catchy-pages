import type { PlugResults, PlugInputs } from "@/lib/cement-plug-calculations";
import type { FluidColumn } from "@/lib/cement-plug-calculations";

interface Props {
  results: PlugResults;
  inputs: PlugInputs;
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

/** Generate rough wall path following tilted bore wall */
function generateTiltedRoughWall(wallXFn: (y: number) => number, topY: number, bottomY: number, dir: number, width: number): string {
  const amplitude = 4;
  const step = 8;
  let path = `M${wallXFn(topY) + dir * width},${topY}`;
  // Outward edge (rough)
  for (let yy = topY; yy <= bottomY; yy += step) {
    const offset = dir * (Math.sin(yy * 0.3) * amplitude + Math.cos(yy * 0.7) * amplitude * 0.5);
    path += ` L${wallXFn(yy) + dir * width + offset},${yy}`;
  }
  path += ` L${wallXFn(bottomY) + dir * width},${bottomY}`;
  // Inner edge (smooth, follows bore wall)
  path += ` L${wallXFn(bottomY)},${bottomY}`;
  path += ` L${wallXFn(topY)},${topY}`;
  path += ` Z`;
  return path;
}

/** Build wash-mode fluid columns from equilibrium annular columns */
function buildWashCols(annCols: FluidColumn[], cementTopMD: number, plug: { topMD: number; bottomMD: number }, spacerWashTop: number, spacerWashBottom: number): FluidColumn[] {
  const washCols: FluidColumn[] = [];
  for (const col of annCols) {
    const isCement = col.color === '#B0BEC5';
    const isSpacer = col.color === '#4FC3F7';
    if (isCement) {
      const ct = Math.max(col.topMD, plug.topMD);
      const cb = Math.min(col.bottomMD, plug.bottomMD);
      if (cb > ct) washCols.push({ ...col, topMD: ct, bottomMD: cb });
    } else if (isSpacer && col.bottomMD <= cementTopMD + 1 && col.topMD < cementTopMD) {
      washCols.push({ ...col, topMD: spacerWashTop, bottomMD: spacerWashBottom });
    } else if (col.location === 'annulus' && col.bottomMD <= cementTopMD && col.topMD < col.bottomMD) {
      washCols.push({ ...col, bottomMD: spacerWashTop });
    } else {
      washCols.push(col);
    }
  }
  washCols.sort((a, b) => a.topMD - b.topMD);
  return washCols;
}

function getGradId(color: string, mode: string): string {
  if (color === "#B0BEC5") return `cp-cement-grad-${mode}`;
  if (color === "#4FC3F7") return `cp-spacer-grad-${mode}`;
  return `cp-mud-grad-${mode}`;
}

function PlugSVG({ results, inputs, mode, sharedViewTop, sharedViewBottom }: Props & { mode: 'equilibrium' | 'wash'; sharedViewTop?: number; sharedViewBottom?: number }) {
  const { well, plug } = inputs;
  const plugLen = plug.bottomMD - plug.topMD;
  if (plugLen <= 0) return null;

  // === TILT GEOMETRY ===
  const zenithDeg = results.plugZenithDeg ?? 0;
  const visualTiltDeg = Math.min(zenithDeg, 30);
  const visualTiltRad = (visualTiltDeg * Math.PI) / 180;
  const isTilted = visualTiltDeg > 3;
  const sinVT = Math.sin(visualTiltRad);

  // === LAYOUT ===
  const H = 580;
  const marginRight = isTilted ? 130 : 115;
  const margin = { top: 35, bottom: 30, left: 55, right: marginRight };
  const drawH = H - margin.top - margin.bottom;
  const tiltShift = drawH * sinVT * 0.35;
  const W = 440 + Math.ceil(tiltShift * 2);
  const drawW = W - margin.left - margin.right;
  const cx = margin.left + drawW / 2;

  // === VIEW RANGE ===
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

  // === COORDINATE TRANSFORMS ===
  const toY = (md: number) => margin.top + ((md - viewTop) / viewRange) * drawH;
  const clampY = (md: number) => toY(Math.max(viewTop, Math.min(viewBottom, md)));
  const centerY = margin.top + drawH / 2;
  // Bore center x-offset: tilts right as depth increases
  const dx = (yPos: number) => (yPos - centerY) * Math.tan(visualTiltRad) * 0.35;

  // === BORE DIMENSIONS ===
  const borePx = drawW * (isTilted ? 0.32 : 0.4);
  const halfBore = borePx / 2;
  const pipePx = borePx * (well.pipeOD / (results.boreDiamUsed || well.holeDiameter || 1));
  const pipeIDPx = borePx * (well.pipeID / (results.boreDiamUsed || well.holeDiameter || 1));
  const halfPipe = pipePx / 2;
  const halfPipeID = pipeIDPx / 2;

  // Bore wall position functions
  const boreL = (yy: number) => cx + dx(yy) - halfBore;
  const boreR = (yy: number) => cx + dx(yy) + halfBore;

  const topPx = margin.top;
  const botPx = margin.top + drawH;

  // Bore clip polygon (tilted parallelogram)
  const boreClipPts = `${boreL(topPx)},${topPx} ${boreR(topPx)},${topPx} ${boreR(botPx)},${botPx} ${boreL(botPx)},${botPx}`;

  // Shoe
  const shoeY = toY(well.casingShoe);
  const shoeVisible = well.casingShoe >= viewTop && well.casingShoe <= viewBottom;
  const isOpenHole = results.isOpenHole;

  // Depth ticks
  const tickStep = viewRange > 500 ? 100 : viewRange > 200 ? 50 : viewRange > 100 ? 20 : 10;
  const ticks: number[] = [];
  for (let d = Math.ceil(viewTop / tickStep) * tickStep; d <= viewBottom; d += tickStep) ticks.push(d);

  // Fluid columns
  const annCols = results.fluidColumns.filter(c => c.location === 'annulus' && c.bottomMD > viewTop && c.topMD < viewBottom);
  const pipeCols = results.fluidColumns.filter(c => c.location === 'pipe' && c.bottomMD > viewTop && c.topMD < viewBottom);

  // Pipe range
  const pipeTopMD = Math.max(viewTop, 0);
  const pipeBottomMD = mode === 'equilibrium' ? Math.min(viewBottom, plug.bottomMD) : Math.min(viewBottom, results.pullOutDepthMD);
  const pipeTopY = toY(pipeTopMD);
  const pipeBottomY = toY(pipeBottomMD);
  const showPipe = pipeBottomMD > pipeTopMD;

  // Pipe clip
  const pipeClipPts = showPipe
    ? `${cx + dx(pipeTopY) - halfPipeID},${pipeTopY} ${cx + dx(pipeTopY) + halfPipeID},${pipeTopY} ${cx + dx(pipeBottomY) + halfPipeID},${pipeBottomY} ${cx + dx(pipeBottomY) - halfPipeID},${pipeBottomY}`
    : '';

  // Cement positions
  const cementTopMD = plug.bottomMD - results.cementHeightAnnMD;
  const boreAreaM2 = (Math.PI / 4) * ((results.boreDiamUsed || well.holeDiameter) / 1000) ** 2;
  const spacerWashHeight = boreAreaM2 > 0 ? inputs.spacerVolumeAboveM3 / boreAreaM2 : results.spacerAboveHeightAnnMD;
  const spacerWashTop = plug.topMD - spacerWashHeight;

  // Contamination
  const contaminationM = results.stability?.contaminationDepthM ?? 0;
  const contaminationPx = contaminationM > 0 ? (contaminationM / viewRange) * drawH : 0;
  const interfaceY = clampY(plug.bottomMD);

  // Annotation x
  const annX = Math.max(boreR(topPx), boreR(botPx)) + 8;

  const title = mode === 'equilibrium'
    ? "Равновесие (до подъёма)"
    : `Промывка (инструмент на ${results.pullOutDepthMD} м)`;

  // Open hole
  const ohTop = Math.max(viewTop, well.casingShoe);
  const ohTopY = toY(ohTop);
  const ohBottomY = botPx;
  const ohVisible = isOpenHole && ohTop < viewBottom;

  // Build fluid columns for current mode
  const fluidCols = mode === 'equilibrium' ? annCols : buildWashCols(annCols, cementTopMD, plug, spacerWashTop, plug.topMD);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ fontFamily: 'system-ui, sans-serif', maxWidth: `${W}px` }}>
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
        </pattern>
        <linearGradient id={`cp-casing-${mode}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#90A4AE" />
          <stop offset="50%" stopColor="#B0BEC5" />
          <stop offset="100%" stopColor="#78909C" />
        </linearGradient>
        <clipPath id={`bore-clip-${mode}`}>
          <polygon points={boreClipPts} />
        </clipPath>
        {showPipe && (
          <clipPath id={`pipe-clip-${mode}`}>
            <polygon points={pipeClipPts} />
          </clipPath>
        )}
        <filter id={`fg-blur-${mode}`}>
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <linearGradient id={`fg-grad-${mode}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#78909C" stopOpacity={0.6} />
          <stop offset="30%" stopColor="#E65100" stopOpacity={0.35} />
          <stop offset="60%" stopColor="#FF6D00" stopOpacity={0.25} />
          <stop offset="100%" stopColor="#4FC3F7" stopOpacity={0.1} />
        </linearGradient>
      </defs>

      {/* Background */}
      <rect x={0} y={0} width={W} height={H} fill="#1a1a2e" rx={8} />

      {/* Title */}
      <text x={W / 2} y={14} textAnchor="middle" fill="#eee" fontSize={9} fontWeight="bold">{title}</text>
      <text x={W / 2} y={24} textAnchor="middle" fill="#888" fontSize={7}>
        {viewTop.toFixed(0)}–{viewBottom.toFixed(0)} м MD
        {zenithDeg > 1 ? ` · θ=${zenithDeg.toFixed(1)}°` : ''}
      </text>

      {/* Depth scale (vertical, NOT tilted) */}
      {ticks.map(d => (
        <g key={d}>
          <line x1={margin.left - 5} y1={toY(d)} x2={margin.left} y2={toY(d)} stroke="#555" strokeWidth={0.5} />
          <text x={margin.left - 8} y={toY(d) + 3} textAnchor="end" fill="#999" fontSize={8}>{d}</text>
        </g>
      ))}
      <text x={margin.left - 8} y={margin.top - 5} textAnchor="end" fill="#aaa" fontSize={7}>MD, м</text>

      {/* Rock/formation strips alongside bore */}
      <polygon
        points={`${boreL(topPx) - 12},${topPx} ${boreL(topPx)},${topPx} ${boreL(botPx)},${botPx} ${boreL(botPx) - 12},${botPx}`}
        fill={`url(#cp-rock-${mode})`}
      />
      <polygon
        points={`${boreR(topPx)},${topPx} ${boreR(topPx) + 12},${topPx} ${boreR(botPx) + 12},${botPx} ${boreR(botPx)},${botPx}`}
        fill={`url(#cp-rock-${mode})`}
      />

      {/* Open hole rough walls */}
      {ohVisible && (
        <>
          <path d={generateTiltedRoughWall(boreL, ohTopY, ohBottomY, -1, 6)} fill={`url(#cp-openhole-${mode})`} stroke="#6a5a4e" strokeWidth={0.5} />
          <path d={generateTiltedRoughWall(boreR, ohTopY, ohBottomY, 1, 6)} fill={`url(#cp-openhole-${mode})`} stroke="#6a5a4e" strokeWidth={0.5} />
        </>
      )}

      {/* ═══ BORE INTERIOR (clipped to tilted parallelogram) ═══ */}
      <g clipPath={`url(#bore-clip-${mode})`}>
        {/* Dark bore interior */}
        <rect x={0} y={topPx} width={W} height={drawH} fill="#2d2d44" />

        {/* Casing walls inside bore */}
        {well.casingShoe >= viewTop && (() => {
          const caseBottomY = Math.min(shoeY, botPx);
          return (
            <>
              <polygon
                points={`${boreL(topPx)},${topPx} ${boreL(topPx) + 4},${topPx} ${boreL(caseBottomY) + 4},${caseBottomY} ${boreL(caseBottomY)},${caseBottomY}`}
                fill={`url(#cp-casing-${mode})`}
              />
              <polygon
                points={`${boreR(topPx) - 4},${topPx} ${boreR(topPx)},${topPx} ${boreR(caseBottomY)},${caseBottomY} ${boreR(caseBottomY) - 4},${caseBottomY}`}
                fill={`url(#cp-casing-${mode})`}
              />
              {shoeVisible && (
                <>
                  <rect x={boreL(shoeY) - 2} y={shoeY - 2} width={8} height={4} fill="#FFB74D" rx={1} />
                  <rect x={boreR(shoeY) - 6} y={shoeY - 2} width={8} height={4} fill="#FFB74D" rx={1} />
                </>
              )}
            </>
          );
        })()}

        {/* ─── FLUID COLUMNS (horizontal rects, clipped to tilted bore) ─── */}
        {fluidCols.map((col, i) => {
          const yTop = clampY(col.topMD);
          const yBot = clampY(col.bottomMD);
          const h = yBot - yTop;
          if (h <= 0) return null;
          return <rect key={`fl-${i}`} x={0} y={yTop} width={W} height={h} fill={`url(#${getGradId(col.color, mode)})`} opacity={0.85} />;
        })}

        {/* ─── FINGERING / CONTAMINATION at bottom cement/spacer interface ─── */}
        {contaminationPx > 1 && (() => {
          const numFingers = Math.min(Math.max(3, Math.floor(contaminationPx / 2.5)), 8);
          const dxAtIF = dx(interfaceY);
          const usableW = borePx * 0.8;

          return (
            <g>
              {/* Gradient blend zone */}
              <rect x={0} y={interfaceY - contaminationPx * 0.15} width={W} height={contaminationPx * 1.15}
                fill={`url(#fg-grad-${mode})`} filter={`url(#fg-blur-${mode})`} />

              {/* Individual finger shapes (teardrop cement fingers going into spacer) */}
              {Array.from({ length: numFingers }).map((_, i) => {
                const frac = numFingers > 1 ? i / (numFingers - 1) : 0.5;
                const fingerX = cx + dxAtIF - usableW / 2 + frac * usableW;
                // Low side bias: fingers longer on right (low side) when tilted
                const lowBias = isTilted ? (0.15 + 0.85 * frac) : (0.4 + 0.6 * Math.abs(Math.sin(i * 1.7)));
                const fingerDepth = contaminationPx * lowBias;
                const fw = 3 + Math.sin(i * 2.3 + 0.7) * 1.5;
                const startY = interfaceY;
                const endY = interfaceY + fingerDepth;
                // Teardrop path
                const path = [
                  `M${fingerX - fw},${startY}`,
                  `C${fingerX - fw * 1.1},${startY + fingerDepth * 0.35} ${fingerX - fw * 0.3},${startY + fingerDepth * 0.8} ${fingerX},${endY}`,
                  `C${fingerX + fw * 0.3},${startY + fingerDepth * 0.8} ${fingerX + fw * 1.1},${startY + fingerDepth * 0.35} ${fingerX + fw},${startY}`,
                  `Z`
                ].join(' ');
                const opacity = 0.3 + 0.3 * lowBias;
                return <path key={i} d={path} fill="#78909C" opacity={opacity} />;
              })}

              {/* Asymmetric interface curve: cement rises on low side */}
              {isTilted && contaminationPx > 3 && (
                <path
                  d={`M${cx + dxAtIF - usableW / 2},${interfaceY + contaminationPx * 0.1} Q${cx + dxAtIF},${interfaceY} ${cx + dxAtIF + usableW / 2},${interfaceY - contaminationPx * 0.12}`}
                  stroke="rgba(255,109,0,0.5)" strokeWidth={1.2} fill="none" strokeDasharray="4,2"
                />
              )}

              {/* Wavy mixing lines */}
              {Array.from({ length: Math.min(4, Math.floor(contaminationPx / 5)) }).map((_, i) => {
                const frac = (i + 1) / (Math.min(4, Math.floor(contaminationPx / 5)) + 1);
                const lineY = interfaceY + frac * contaminationPx * 0.8;
                const amp = 3 + Math.sin(i * 1.7) * 2;
                const lx = cx + dx(lineY) - usableW / 2;
                const rx = cx + dx(lineY) + usableW / 2;
                return (
                  <path key={`wl-${i}`}
                    d={`M${lx},${lineY} Q${lx + usableW * 0.25},${lineY + amp} ${lx + usableW * 0.5},${lineY - amp * 0.5} T${rx},${lineY}`}
                    stroke={i % 2 === 0 ? "rgba(255,109,0,0.4)" : "rgba(79,195,247,0.35)"}
                    strokeWidth={0.7} fill="none"
                  />
                );
              })}
            </g>
          );
        })()}
      </g>

      {/* Bore wall outlines (tilted lines) */}
      <line x1={boreL(topPx)} y1={topPx} x2={boreL(botPx)} y2={botPx} stroke="#666" strokeWidth={1} />
      <line x1={boreR(topPx)} y1={topPx} x2={boreR(botPx)} y2={botPx} stroke="#666" strokeWidth={1} />

      {/* Pipe walls (tilted lines) */}
      {showPipe && (
        <>
          <line x1={cx + dx(pipeTopY) - halfPipe} y1={pipeTopY} x2={cx + dx(pipeBottomY) - halfPipe} y2={pipeBottomY} stroke="#B0BEC5" strokeWidth={2.5} />
          <line x1={cx + dx(pipeTopY) + halfPipe} y1={pipeTopY} x2={cx + dx(pipeBottomY) + halfPipe} y2={pipeBottomY} stroke="#B0BEC5" strokeWidth={2.5} />
          {/* Tool joint at pipe bottom */}
          {(() => {
            const jw = pipePx * 1.5;
            const jh = 12;
            const jy = pipeBottomY - jh;
            const jcx = cx + dx(pipeBottomY);
            return (
              <g>
                <rect x={jcx - jw / 2} y={jy} width={jw} height={jh} rx={2}
                  fill={`url(#cp-casing-${mode})`} stroke="#616161" strokeWidth={0.6} />
                <line x1={jcx - jw / 2 + 2} y1={jy + 3} x2={jcx + jw / 2 - 2} y2={jy + 3} stroke="#757575" strokeWidth={0.5} />
                <line x1={jcx - jw / 2 + 2} y1={jy + jh - 3} x2={jcx + jw / 2 - 2} y2={jy + jh - 3} stroke="#757575" strokeWidth={0.5} />
              </g>
            );
          })()}
        </>
      )}

      {/* Pipe interior fluid */}
      {showPipe && mode === 'equilibrium' && (
        <g clipPath={`url(#pipe-clip-${mode})`}>
          {pipeCols.map((col, i) => {
            const yTop = clampY(col.topMD);
            const yBot = clampY(col.bottomMD);
            const h = yBot - yTop;
            if (h <= 0) return null;
            return <rect key={`pc-${i}`} x={0} y={yTop} width={W} height={h} fill={`url(#${getGradId(col.color, mode)})`} opacity={0.8} />;
          })}
        </g>
      )}
      {showPipe && mode === 'wash' && (
        <g clipPath={`url(#pipe-clip-${mode})`}>
          <rect x={0} y={pipeTopY} width={W} height={pipeBottomY - pipeTopY} fill={`url(#cp-mud-grad-${mode})`} opacity={0.6} />
        </g>
      )}

      {/* ─── ANNOTATIONS ─── */}
      {(() => {
        const spacerTopMD = mode === 'wash' ? spacerWashTop : (cementTopMD - results.spacerAboveHeightAnnMD);
        if (spacerTopMD > viewTop) {
          return <SideAnnotation x={annX} yTop={clampY(viewTop)} yBot={clampY(spacerTopMD)} label={inputs.wellFluid.name.substring(0, 12)} color="#A1887F" />;
        }
        return null;
      })()}

      {results.spacerAboveHeightAnnMD > 0 && (() => {
        const sTop = mode === 'wash' ? spacerWashTop : (cementTopMD - results.spacerAboveHeightAnnMD);
        const sBot = mode === 'wash' ? plug.topMD : cementTopMD;
        const sH = mode === 'wash' ? spacerWashHeight : results.spacerAboveHeightAnnMD;
        const note = mode === 'equilibrium' ? ' (с БИ)' : '';
        return <SideAnnotation x={annX} yTop={clampY(sTop)} yBot={clampY(sBot)} label={`Буфер ↕${sH.toFixed(1)}м${note}`} color="#4FC3F7" />;
      })()}

      {mode === 'equilibrium' ? (
        <SideAnnotation x={annX} yTop={clampY(cementTopMD)} yBot={clampY(plug.bottomMD)} label={`Цемент ↕${results.cementHeightAnnMD.toFixed(1)}м (с БИ)`} color="#B0BEC5" />
      ) : (
        <SideAnnotation x={annX} yTop={clampY(plug.topMD)} yBot={clampY(plug.bottomMD)} label={`Цем. мост ↕${plugLen}м`} color="#B0BEC5" />
      )}

      {contaminationM > 0.05 && (
        <SideAnnotation x={annX} yTop={interfaceY} yBot={interfaceY + contaminationPx} label={`Смешение ~${contaminationM.toFixed(1)}м`} color="#FF6D00" />
      )}

      {results.spacerBelowHeightAnnMD > 0 && (
        <SideAnnotation x={annX} yTop={clampY(plug.bottomMD)} yBot={clampY(plug.bottomMD + results.spacerBelowHeightAnnMD)} label={`Буфер ↕${results.spacerBelowHeightAnnMD.toFixed(1)}м`} color="#4FC3F7" />
      )}

      {plug.bottomMD + results.spacerBelowHeightAnnMD < viewBottom && (
        <SideAnnotation x={annX} yTop={clampY(plug.bottomMD + results.spacerBelowHeightAnnMD)} yBot={clampY(viewBottom)} label={inputs.wellFluid.name.substring(0, 12)} color="#A1887F" />
      )}

      {/* Pipe label */}
      {showPipe && (
        <text x={cx + dx((pipeTopY + pipeBottomY) / 2) + halfPipe + 4} y={(pipeTopY + pipeBottomY) / 2} fill="#81C784" fontSize={6} fontWeight="bold" dominantBaseline="middle">
          БИ ∅{well.pipeOD}
        </text>
      )}

      {/* Shoe label */}
      {shoeVisible && (
        <text x={boreL(shoeY) - 5} y={shoeY + 3} textAnchor="end" fill="#FFB74D" fontSize={6}>башмак {well.casingShoe}м</text>
      )}

      {/* Plug interval markers */}
      <line x1={boreL(clampY(plug.topMD)) - 8} y1={clampY(plug.topMD)} x2={boreR(clampY(plug.topMD)) + 5} y2={clampY(plug.topMD)} stroke="#FFD54F" strokeWidth={1} strokeDasharray="4,2" />
      <line x1={boreL(clampY(plug.bottomMD)) - 8} y1={clampY(plug.bottomMD)} x2={boreR(clampY(plug.bottomMD)) + 5} y2={clampY(plug.bottomMD)} stroke="#FFD54F" strokeWidth={1} strokeDasharray="4,2" />
      <text x={boreL(clampY(plug.topMD)) - 10} y={clampY(plug.topMD) + 3} textAnchor="end" fill="#FFD54F" fontSize={6.5}>▲ {plug.topMD}м</text>
      <text x={boreL(clampY(plug.bottomMD)) - 10} y={clampY(plug.bottomMD) + 3} textAnchor="end" fill="#FFD54F" fontSize={6.5}>▼ {plug.bottomMD}м</text>

      {/* Cement top marker (equilibrium) */}
      {mode === 'equilibrium' && results.cementHeightAnnMD > results.plugLengthMD && (
        <>
          <line x1={boreL(clampY(cementTopMD)) - 8} y1={clampY(cementTopMD)} x2={boreR(clampY(cementTopMD)) + 5} y2={clampY(cementTopMD)} stroke="#E0E0E0" strokeWidth={0.8} strokeDasharray="3,2" />
          <text x={boreL(clampY(cementTopMD)) - 10} y={clampY(cementTopMD) + 3} textAnchor="end" fill="#E0E0E0" fontSize={6}>верх цем. {cementTopMD.toFixed(0)}м</text>
        </>
      )}

      {/* Pull-out label */}
      {mode === 'wash' && showPipe && (
        <text x={boreL(pipeBottomY) - 10} y={pipeBottomY + 3} textAnchor="end" fill="#81C784" fontSize={6.5}>🔧 {results.pullOutDepthMD}м</text>
      )}

      {/* Gravity arrow (tilted wells) */}
      {isTilted && (
        <g>
          <line x1={W - 28} y1={margin.top + 12} x2={W - 28} y2={margin.top + 38} stroke="#FFD54F" strokeWidth={1.2} />
          <polygon points={`${W - 31},${margin.top + 35} ${W - 25},${margin.top + 35} ${W - 28},${margin.top + 42}`} fill="#FFD54F" />
          <text x={W - 21} y={margin.top + 28} fill="#FFD54F" fontSize={7} fontWeight="bold">g</text>
        </g>
      )}

      {/* Pressure */}
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
        {contaminationM > 0 && (
          <>
            <rect x={170} width={8} height={8} fill="rgba(255,109,0,0.5)" rx={1} />
            <text x={180} y={7} fill="#ccc" fontSize={6}>Смешение</text>
          </>
        )}
      </g>
    </svg>
  );
}

export default function CementPlugVisualization({ results, inputs }: Props) {
  const { well, plug } = inputs;
  const plugLen = plug.bottomMD - plug.topMD;
  if (plugLen <= 0) return null;

  const zenithDeg = results.plugZenithDeg ?? 0;
  const isLargeTilt = zenithDeg > 15;

  const viewMargin = Math.max(plugLen * 0.6, 50);
  const eqTop = Math.max(0, plug.topMD - viewMargin - results.spacerAboveHeightAnnMD);
  const washTop = Math.max(0, results.pullOutDepthMD - 30);
  const sharedViewTop = Math.min(eqTop, washTop);
  const sharedViewBottom = Math.min(well.wellDepthMD, plug.bottomMD + viewMargin + results.spacerBelowHeightAnnMD);

  return (
    <div className={isLargeTilt ? "flex flex-col gap-4 w-full" : "flex flex-col md:flex-row gap-4 w-full"}>
      <div className={isLargeTilt ? "w-full" : "flex-1 min-w-0"}>
        <PlugSVG results={results} inputs={inputs} mode="equilibrium" sharedViewTop={sharedViewTop} sharedViewBottom={sharedViewBottom} />
      </div>
      <div className={isLargeTilt ? "w-full" : "flex-1 min-w-0"}>
        <PlugSVG results={results} inputs={inputs} mode="wash" sharedViewTop={sharedViewTop} sharedViewBottom={sharedViewBottom} />
      </div>
    </div>
  );
}
