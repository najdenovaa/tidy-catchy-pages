import type { SettlementResult, MultiPlugProgram, LossZoneFull, ProfilePoint } from "@/lib/cement-plug-complications";

interface Props {
  plannedTopMD: number;
  plannedBottomMD: number;
  result: SettlementResult;
  multiPlug?: MultiPlugProgram | null;
  lossZone: LossZoneFull;
  trajectory: ProfilePoint[];
  /** Высота нижней вязкой пачки в стволе, м (если ставилась) */
  padHeightM?: number;
  width?: number;
  height?: number;
}

export function PlugSettlementSVG({
  plannedTopMD, plannedBottomMD, result, multiPlug, lossZone, trajectory,
  padHeightM = 0,
  width = 360, height = 460,
}: Props) {
  // Геометрия пачки: пачка стоит ПОД подошвой моста
  const hasPad = padHeightM > 0.05;
  const plannedPadTopMD = plannedBottomMD;
  const plannedPadBottomMD = plannedBottomMD + padHeightM;
  // Факт: пачка опускается вместе с цементом, часть её уходит в зону поглощения
  const settle = Math.max(0, result.settlementM);
  const realPadTopMD = result.finalBottomMD;
  // Сколько пачки осталось: пачка вытесняется в зону по мере проседания цемента
  const remainingPadHeight = Math.max(0, padHeightM - settle);
  const realPadBottomMD = Math.min(realPadTopMD + remainingPadHeight, lossZone.topMD);
  const padFullyConsumed = hasPad && remainingPadHeight < 0.05;
  // Глубинный диапазон
  const topMd = Math.max(0, Math.min(plannedTopMD, result.finalHeadMD) - 100);
  const botMd = Math.max(plannedBottomMD, result.finalBottomMD, plannedPadBottomMD, realPadBottomMD, lossZone.topMD + lossZone.thicknessM) + 60;
  const padX = 90;
  const trackX = width / 2;
  const halfW = 32;

  const y = (md: number) => 24 + ((md - topMd) / Math.max(1, botMd - topMd)) * (height - 48);

  // Построение траектории как ломаной с горизонтальным сдвигом по зениту
  const pts: { x: number; y: number }[] = [];
  let curX = trackX;
  let prevMd = topMd;
  if (trajectory.length) {
    pts.push({ x: trackX, y: y(topMd) });
    for (const p of trajectory) {
      if (p.md < topMd) continue;
      if (p.md > botMd) break;
      const dx = Math.sin((p.zenithDeg || 0) * Math.PI / 180) * (p.md - prevMd) * 0.15;
      curX += dx;
      pts.push({ x: curX, y: y(p.md) });
      prevMd = p.md;
    }
    pts.push({ x: curX, y: y(botMd) });
  }
  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  const xAt = (md: number) => {
    if (!pts.length) return trackX;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const mdA = topMd + (a.y - 24) / (height - 48) * (botMd - topMd);
      const mdB = topMd + (b.y - 24) / (height - 48) * (botMd - topMd);
      if (md <= mdB) {
        const f = (md - mdA) / Math.max(1e-6, mdB - mdA);
        return a.x + (b.x - a.x) * f;
      }
    }
    return pts[pts.length - 1].x;
  };

  const ticks = [topMd, topMd + (botMd - topMd) * 0.25, topMd + (botMd - topMd) * 0.5, topMd + (botMd - topMd) * 0.75, botMd];

  return (
    <svg width={width} height={height} className="bg-muted/30 rounded">
      {/* шкала глубин */}
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padX - 10} y1={y(t)} x2={padX - 4} y2={y(t)} stroke="currentColor" className="text-muted-foreground" />
          <text x={padX - 12} y={y(t) + 3} textAnchor="end" fontSize="9" className="fill-muted-foreground">
            {t.toFixed(0)}
          </text>
        </g>
      ))}
      <text x={padX - 12} y={14} textAnchor="end" fontSize="9" className="fill-muted-foreground">MD, м</text>

      {/* Профиль скважины */}
      {pathD && <path d={pathD} stroke="hsl(var(--border))" strokeWidth={halfW * 2} fill="none" strokeLinecap="round" />}

      {/* Зона поглощения */}
      <rect
        x={xAt(lossZone.topMD) - halfW - 8} y={y(lossZone.topMD)}
        width={halfW * 2 + 16} height={Math.max(4, y(lossZone.topMD + lossZone.thicknessM) - y(lossZone.topMD))}
        fill="url(#lossHatch)" stroke="hsl(var(--destructive))" strokeWidth={1}
      />
      <defs>
        <pattern id="lossHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--destructive))" strokeWidth="1.5" />
        </pattern>
      </defs>
      <text x={xAt(lossZone.topMD) + halfW + 14} y={y(lossZone.topMD + lossZone.thicknessM / 2)}
        fontSize="9" className="fill-destructive font-semibold">
        Поглощение {lossZone.initialLossRateM3h} м³/ч
      </text>
      <text x={xAt(lossZone.topMD) + halfW + 14} y={y(lossZone.topMD + lossZone.thicknessM / 2) + 11}
        fontSize="8" className="fill-muted-foreground">
        h={lossZone.thicknessM} м, {lossZone.zoneType}
      </text>

      {/* Планируемый мост (пунктир) */}
      <rect
        x={xAt(plannedTopMD) - halfW} y={y(plannedTopMD)}
        width={halfW * 2} height={y(plannedBottomMD) - y(plannedTopMD)}
        fill="none" stroke="hsl(142 71% 45%)" strokeWidth={1.5} strokeDasharray="4 3"
      />
      <text x={xAt(plannedTopMD) - halfW - 6} y={y(plannedTopMD) - 2} textAnchor="end"
        fontSize="9" className="fill-green-500">
        План {plannedTopMD.toFixed(0)} м
      </text>

      {/* Реальный мост (заливка) — основной или multi */}
      {multiPlug && multiPlug.required ? (
        multiPlug.plugs.map((p, i) => (
          <g key={i}>
            <rect
              x={xAt(p.topMD) - halfW} y={y(p.topMD)}
              width={halfW * 2} height={y(p.bottomMD) - y(p.topMD)}
              fill={p.purpose === 'support' ? 'hsl(220 8% 46% / 0.85)' : 'hsl(217 91% 60% / 0.7)'}
              stroke={p.purpose === 'support' ? 'hsl(220 8% 30%)' : 'hsl(217 91% 50%)'}
              strokeWidth={1}
            />
            <text x={xAt(p.topMD) + halfW + 8} y={y((p.topMD + p.bottomMD) / 2)}
              fontSize="9" className="fill-foreground font-semibold">
              {p.purpose === 'support' ? '🪨 Опорный' : '🧱 Основной'}
            </text>
            <text x={xAt(p.topMD) + halfW + 8} y={y((p.topMD + p.bottomMD) / 2) + 11}
              fontSize="8" className="fill-muted-foreground">
              {p.topMD.toFixed(0)}–{p.bottomMD.toFixed(0)} м, {p.cementVolumeM3.toFixed(1)} м³
            </text>
          </g>
        ))
      ) : (
        <>
          <rect
            x={xAt(result.finalHeadMD) - halfW} y={y(result.finalHeadMD)}
            width={halfW * 2} height={y(result.finalBottomMD) - y(result.finalHeadMD)}
            fill={result.reachesLossZone ? 'hsl(var(--destructive) / 0.7)' : 'hsl(38 92% 50% / 0.6)'}
            stroke={result.reachesLossZone ? 'hsl(var(--destructive))' : 'hsl(38 92% 40%)'}
            strokeWidth={1.2}
          />
          <text x={xAt(result.finalHeadMD) - halfW - 6} y={y(result.finalHeadMD) - 2} textAnchor="end"
            fontSize="9" className={result.reachesLossZone ? "fill-destructive font-semibold" : "fill-amber-500 font-semibold"}>
            Факт {result.finalHeadMD.toFixed(0)} м
          </text>
        </>
      )}

      {/* Стрелка проседания */}
      {!multiPlug?.required && result.settlementM > 1 && (
        <g>
          <line
            x1={xAt(plannedTopMD) + halfW + 4} y1={y(plannedTopMD)}
            x2={xAt(plannedTopMD) + halfW + 4} y2={y(result.finalHeadMD)}
            stroke="hsl(var(--destructive))" strokeWidth={1.5} markerEnd="url(#arr)"
          />
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="hsl(var(--destructive))" />
            </marker>
          </defs>
          <text x={xAt(plannedTopMD) + halfW + 8}
            y={(y(plannedTopMD) + y(result.finalHeadMD)) / 2}
            fontSize="9" className="fill-destructive font-semibold">
            −{result.settlementM.toFixed(0)} м
          </text>
        </g>
      )}
    </svg>
  );
}
