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

type Label = {
  side: "left" | "right";
  anchorY: number;
  lines: string[];
  className: string;
  weight?: "normal" | "semibold";
};

export function PlugSettlementSVG({
  plannedTopMD, plannedBottomMD, result, multiPlug, lossZone, trajectory,
  padHeightM = 0,
  width = 460, height = 480,
}: Props) {
  // Геометрия пачки: пачка стоит ПОД подошвой моста
  const hasPad = padHeightM > 0.05;
  const plannedPadTopMD = plannedBottomMD;
  const plannedPadBottomMD = plannedBottomMD + padHeightM;
  const settle = Math.max(0, result.settlementM);
  const realPadTopMD = result.finalBottomMD;
  const remainingPadHeight = Math.max(0, padHeightM - settle);
  const realPadBottomMD = Math.min(realPadTopMD + remainingPadHeight, lossZone.topMD);
  const padFullyConsumed = hasPad && remainingPadHeight < 0.05;

  const topMd = Math.max(0, Math.min(plannedTopMD, result.finalHeadMD) - 100);
  const botMd = Math.max(plannedBottomMD, result.finalBottomMD, plannedPadBottomMD, realPadBottomMD, lossZone.topMD + lossZone.thicknessM) + 60;

  // Сдвинули ствол левее, оставив справа широкую полосу под подписи
  const padX = 70;
  const trackX = padX + 80;
  const halfW = 26;
  const rightLabelX = trackX + halfW + 14;
  const leftLabelX = trackX - halfW - 8;

  const y = (md: number) => 24 + ((md - topMd) / Math.max(1, botMd - topMd)) * (height - 48);

  // Профиль ствола
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

  // ---- Сбор подписей и анти-наслаивание ----
  const labels: Label[] = [];

  // Зона поглощения
  labels.push({
    side: "right",
    anchorY: y(lossZone.topMD + lossZone.thicknessM / 2),
    lines: [`Поглощение ${lossZone.initialLossRateM3h} м³/ч`, `h=${lossZone.thicknessM} м, ${lossZone.zoneType}`],
    className: "fill-destructive",
    weight: "semibold",
  });

  // План голова
  labels.push({
    side: "left",
    anchorY: y(plannedTopMD) - 2,
    lines: [`План ${plannedTopMD.toFixed(0)} м`],
    className: "fill-green-500",
  });

  if (multiPlug && multiPlug.required) {
    for (const p of multiPlug.plugs) {
      labels.push({
        side: "right",
        anchorY: y((p.topMD + p.bottomMD) / 2),
        lines: [
          p.purpose === "support" ? "🪨 Опорный" : "🧱 Основной",
          `${p.topMD.toFixed(0)}–${p.bottomMD.toFixed(0)} м, ${p.cementVolumeM3.toFixed(1)} м³`,
        ],
        className: "fill-foreground",
        weight: "semibold",
      });
    }
  } else {
    if (hasPad) {
      labels.push({
        side: "left",
        anchorY: y(plannedPadBottomMD) + 9,
        lines: [`План пачка ↓ ${plannedPadBottomMD.toFixed(0)}`],
        className: "fill-sky-500",
      });
    }
    if (hasPad && !padFullyConsumed) {
      labels.push({
        side: "right",
        anchorY: y((realPadTopMD + realPadBottomMD) / 2),
        lines: [
          "💧 Пачка (факт)",
          `${realPadTopMD.toFixed(0)}–${realPadBottomMD.toFixed(0)} м (h=${remainingPadHeight.toFixed(1)} м)`,
        ],
        className: "fill-sky-600",
        weight: "semibold",
      });
    }
    if (hasPad && padFullyConsumed) {
      labels.push({
        side: "right",
        anchorY: y(realPadTopMD) + 4,
        lines: ["💧 Пачка ушла полностью"],
        className: "fill-destructive",
        weight: "semibold",
      });
    }
    // Факт голова
    labels.push({
      side: "left",
      anchorY: y(result.finalHeadMD) - 2,
      lines: [`Факт голова ${result.finalHeadMD.toFixed(0)} м`],
      className: result.reachesLossZone ? "fill-destructive" : "fill-amber-500",
      weight: "semibold",
    });
    // Факт подошва
    labels.push({
      side: "left",
      anchorY: y(result.finalBottomMD) + 9,
      lines: [`Факт подошва ${result.finalBottomMD.toFixed(0)} м`],
      className: result.reachesLossZone ? "fill-destructive" : "fill-amber-500",
    });
    // План подошва
    labels.push({
      side: "left",
      anchorY: y(plannedBottomMD) + 9,
      lines: [`План подошва ${plannedBottomMD.toFixed(0)} м`],
      className: "fill-green-500",
    });
  }

  // Стрелка проседания — подпись справа от стрелки
  const showSettleArrow = !multiPlug?.required && result.settlementM > 1;
  if (showSettleArrow) {
    labels.push({
      side: "right",
      anchorY: (y(plannedTopMD) + y(result.finalHeadMD)) / 2,
      lines: [`−${result.settlementM.toFixed(0)} м`],
      className: "fill-destructive",
      weight: "semibold",
    });
  }

  // Анти-наслаивание: для каждой стороны сортируем по Y и раздвигаем
  const LINE_H = 10;
  const GAP = 3;
  function layout(side: "left" | "right") {
    const items = labels
      .map((l, idx) => ({ l, idx }))
      .filter((x) => x.l.side === side)
      .sort((a, b) => a.l.anchorY - b.l.anchorY);
    const placedY: number[] = items.map((x) => x.l.anchorY);
    for (let i = 1; i < items.length; i++) {
      const prevBlockH = items[i - 1].l.lines.length * LINE_H;
      const minY = placedY[i - 1] + prevBlockH + GAP;
      if (placedY[i] < minY) placedY[i] = minY;
    }
    // Clamp снизу
    for (let i = items.length - 1; i >= 0; i--) {
      const blockH = items[i].l.lines.length * LINE_H;
      const maxY = height - blockH - 4;
      if (placedY[i] > maxY) placedY[i] = maxY;
      if (i < items.length - 1) {
        const blockHThis = items[i].l.lines.length * LINE_H;
        const maxAllowed = placedY[i + 1] - blockHThis - GAP;
        if (placedY[i] > maxAllowed) placedY[i] = maxAllowed;
      }
    }
    const out = new Map<number, number>();
    items.forEach((it, i) => out.set(it.idx, placedY[i]));
    return out;
  }
  const yMap = new Map<number, number>();
  layout("left").forEach((v, k) => yMap.set(k, v));
  layout("right").forEach((v, k) => yMap.set(k, v));

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="bg-muted/30 rounded">
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
      <defs>
        <pattern id="lossHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="hsl(var(--destructive))" strokeWidth="1.5" />
        </pattern>
        <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="hsl(var(--destructive))" />
        </marker>
      </defs>
      <rect
        x={xAt(lossZone.topMD) - halfW - 8} y={y(lossZone.topMD)}
        width={halfW * 2 + 16} height={Math.max(4, y(lossZone.topMD + lossZone.thicknessM) - y(lossZone.topMD))}
        fill="url(#lossHatch)" stroke="hsl(var(--destructive))" strokeWidth={1}
      />

      {/* Планируемый мост */}
      <rect
        x={xAt(plannedTopMD) - halfW} y={y(plannedTopMD)}
        width={halfW * 2} height={y(plannedBottomMD) - y(plannedTopMD)}
        fill="none" stroke="hsl(142 71% 45%)" strokeWidth={1.5} strokeDasharray="4 3"
      />

      {/* Реальный мост (или multi) */}
      {multiPlug && multiPlug.required ? (
        multiPlug.plugs.map((p, i) => (
          <rect key={i}
            x={xAt(p.topMD) - halfW} y={y(p.topMD)}
            width={halfW * 2} height={y(p.bottomMD) - y(p.topMD)}
            fill={p.purpose === "support" ? "hsl(220 8% 46% / 0.85)" : "hsl(217 91% 60% / 0.7)"}
            stroke={p.purpose === "support" ? "hsl(220 8% 30%)" : "hsl(217 91% 50%)"}
            strokeWidth={1}
          />
        ))
      ) : (
        <>
          {hasPad && (
            <rect
              x={xAt(plannedPadTopMD) - halfW} y={y(plannedPadTopMD)}
              width={halfW * 2} height={Math.max(2, y(plannedPadBottomMD) - y(plannedPadTopMD))}
              fill="none" stroke="hsl(199 89% 48%)" strokeWidth={1.2} strokeDasharray="3 2"
            />
          )}
          {hasPad && !padFullyConsumed && (
            <rect
              x={xAt(realPadTopMD) - halfW} y={y(realPadTopMD)}
              width={halfW * 2} height={Math.max(2, y(realPadBottomMD) - y(realPadTopMD))}
              fill="hsl(199 89% 48% / 0.55)" stroke="hsl(199 89% 40%)" strokeWidth={1}
            />
          )}
          <rect
            x={xAt(result.finalHeadMD) - halfW} y={y(result.finalHeadMD)}
            width={halfW * 2} height={y(result.finalBottomMD) - y(result.finalHeadMD)}
            fill={result.reachesLossZone ? "hsl(var(--destructive) / 0.7)" : "hsl(38 92% 50% / 0.6)"}
            stroke={result.reachesLossZone ? "hsl(var(--destructive))" : "hsl(38 92% 40%)"}
            strokeWidth={1.2}
          />
        </>
      )}

      {/* Стрелка проседания */}
      {showSettleArrow && (
        <line
          x1={xAt(plannedTopMD) - halfW - 4} y1={y(plannedTopMD)}
          x2={xAt(plannedTopMD) - halfW - 4} y2={y(result.finalHeadMD)}
          stroke="hsl(var(--destructive))" strokeWidth={1.5} markerEnd="url(#arr)"
        />
      )}

      {/* Подписи с анти-наслаиванием + лидеры */}
      {labels.map((lbl, idx) => {
        const adjY = yMap.get(idx) ?? lbl.anchorY;
        const x = lbl.side === "right" ? rightLabelX : leftLabelX;
        const anchor = lbl.side === "right" ? "start" : "end";
        const leaderX2 = lbl.side === "right" ? rightLabelX - 4 : leftLabelX + 4;
        const leaderX1 = lbl.side === "right" ? trackX + halfW + 1 : trackX - halfW - 1;
        const showLeader = Math.abs(adjY - lbl.anchorY) > 3;
        return (
          <g key={idx}>
            {showLeader && (
              <line
                x1={leaderX1} y1={lbl.anchorY}
                x2={leaderX2} y2={adjY}
                stroke="currentColor" strokeWidth={0.5}
                className="text-muted-foreground" strokeDasharray="2 2"
              />
            )}
            {lbl.lines.map((line, i) => (
              <text key={i}
                x={x} y={adjY + i * LINE_H}
                textAnchor={anchor}
                fontSize={i === 0 ? 9 : 8}
                className={`${lbl.className} ${lbl.weight === "semibold" && i === 0 ? "font-semibold" : ""} ${i > 0 ? "fill-muted-foreground" : ""}`.trim()}
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}
