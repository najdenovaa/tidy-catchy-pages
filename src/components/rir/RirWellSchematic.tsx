import type { RirInputs, RirResult } from "@/lib/rir-calculations";

const COMP_COLOR: Record<string, string> = { cement: "#94a3b8", microcement: "#60a5fa", resin: "#f59e0b", resin_micro: "#a78bfa" };

/** Схема скважины для РИР: колонны, цемент, НКТ, ретейнер, интервал нарушения и путь состава. */
export default function RirWellSchematic({ inp, res }: { inp: RirInputs; res: RirResult }) {
  const W = 420, H = 460, top = 24, bot = H - 20;
  const zMax = Math.max(inp.leak.bottomMD + 120, inp.tool.setDepthMD + 150);
  // нелинейная шкала: верх ствола сжат, интервал работ растянут
  const focus0 = Math.max(0, Math.min(inp.tool.setDepthMD, inp.leak.topMD) - 80);
  const y = (md: number) => {
    const f = focus0 / zMax;
    const split = top + (bot - top) * 0.25;
    if (md <= focus0) return top + (md / Math.max(1, focus0)) * (split - top) * (f > 0 ? 1 : 0);
    return split + ((md - focus0) / Math.max(1, zMax - focus0)) * (bot - split);
  };
  const cx = 120;
  const rOuter = 62, rInner = 40, rHole = 52, rTub = 14;
  const color = COMP_COLOR[res.composition] ?? "#60a5fa";
  const toolY = y(inp.tool.setDepthMD);
  const leakY0 = y(inp.leak.topMD), leakY1 = y(inp.leak.bottomMD);
  const hasTool = inp.tool.kind !== "bradenhead";
  const belowFrom = hasTool ? inp.tool.setDepthMD : Math.max(0, inp.leak.topMD - 50);
  const outerShoe = inp.outerCasing?.shoeMD ?? 0;
  const labels: { y: number; text: string; cls: string }[] = [];
  const addL = (yy: number, text: string, cls = "fill-foreground") => labels.push({ y: yy, text, cls });
  if (outerShoe > 0) addL(y(outerShoe), `башмак ${inp.outerCasing!.odMm} — ${outerShoe.toFixed(0)} м`, "fill-muted-foreground");
  addL(y(inp.casing.cementTopMD), `цемент от ${inp.casing.cementTopMD.toFixed(0)} м`, "fill-muted-foreground");
  if (hasTool) addL(toolY, `${inp.tool.kind === "retainer" ? "ретейнер" : "пакер"} ${inp.tool.setDepthMD.toFixed(0)} м`, "fill-foreground");
  addL((leakY0 + leakY1) / 2, `нарушение ${inp.leak.topMD.toFixed(0)}–${inp.leak.bottomMD.toFixed(0)} м`, "fill-red-600");
  // разнести подписи
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;

  const leakSide = res.composition === "resin" ? 0.9 : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[440px] h-auto" role="img" aria-label="Схема скважины для РИР">
      <defs>
        <pattern id="rir-cem" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" className="fill-stone-300 dark:fill-stone-600" />
          <line x1="0" y1="0" x2="0" y2="6" className="stroke-stone-400 dark:stroke-stone-500" strokeWidth="1.5" />
        </pattern>
        <marker id="rir-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill={color} /></marker>
      </defs>
      {/* порода */}
      <rect x={cx - rOuter - 18} y={top} width={2 * (rOuter + 18)} height={bot - top} className="fill-amber-900/15" />
      {/* цемент за эксплуатационной колонной */}
      <rect x={cx - rHole} y={y(inp.casing.cementTopMD)} width={rHole - rInner} height={bot - y(inp.casing.cementTopMD)} fill="url(#rir-cem)" />
      <rect x={cx + rInner} y={y(inp.casing.cementTopMD)} width={rHole - rInner} height={bot - y(inp.casing.cementTopMD)} fill="url(#rir-cem)" />
      {/* внешняя колонна */}
      {outerShoe > 0 && (
        <g className="stroke-slate-500" strokeWidth={3}>
          <line x1={cx - rOuter} x2={cx - rOuter} y1={top} y2={y(outerShoe)} />
          <line x1={cx + rOuter} x2={cx + rOuter} y1={top} y2={y(outerShoe)} />
        </g>
      )}
      {/* скважинная жидкость в колонне */}
      <rect x={cx - rInner} y={top} width={2 * rInner} height={bot - top} className="fill-sky-200/40 dark:fill-sky-900/40" />
      {/* состав под инструментом до нарушения */}
      <rect x={cx - rInner} y={y(belowFrom)} width={2 * rInner} height={y(inp.leak.bottomMD + 5) - y(belowFrom)} fill={color} opacity={0.75} />
      {/* эксплуатационная колонна */}
      <g className="stroke-slate-700 dark:stroke-slate-300" strokeWidth={3}>
        <line x1={cx - rInner} x2={cx - rInner} y1={top} y2={bot} />
        <line x1={cx + rInner} x2={cx + rInner} y1={top} y2={bot} />
      </g>
      {/* нарушение: разрыв стенки + язык состава наружу */}
      <rect x={cx + rInner - 2} y={leakY0} width={5} height={Math.max(4, leakY1 - leakY0)} className="fill-red-600" />
      {inp.leak.kind === "coupling" && <rect x={cx - rInner - 3} y={leakY0} width={5} height={Math.max(4, leakY1 - leakY0)} className="fill-red-600" />}
      <path d={`M${cx + rInner + 3},${(leakY0 + leakY1) / 2} q 14,-10 ${(rHole - rInner + 22) * leakSide},${-18}`} stroke={color} strokeWidth={4} fill="none" markerEnd="url(#rir-arrow)" />
      <path d={`M${cx + rInner + 3},${(leakY0 + leakY1) / 2} q 14,10 ${(rHole - rInner + 22) * leakSide},${18}`} stroke={color} strokeWidth={4} fill="none" markerEnd="url(#rir-arrow)" />
      {/* НКТ */}
      {hasTool && (
        <g>
          <rect x={cx - rTub} y={top} width={2 * rTub} height={toolY - top} className="fill-sky-100/60 dark:fill-sky-950/60" />
          <rect x={cx - rTub + 4} y={top + 8} width={2 * rTub - 8} height={Math.max(0, toolY - top - 8)} fill={color} opacity={0.35} />
          <g className="stroke-slate-600 dark:stroke-slate-400" strokeWidth={2}>
            <line x1={cx - rTub} x2={cx - rTub} y1={top} y2={toolY} />
            <line x1={cx + rTub} x2={cx + rTub} y1={top} y2={toolY} />
          </g>
          {/* ретейнер / пакер */}
          <rect x={cx - rInner + 2} y={toolY - 7} width={2 * rInner - 4} height={14} className="fill-slate-800 dark:fill-slate-200" rx={2} />
          <line x1={cx - rInner + 6} x2={cx + rInner - 6} y1={toolY - 5} y2={toolY + 5} className="stroke-amber-400" strokeWidth={2} />
          <line x1={cx - rInner + 6} x2={cx + rInner - 6} y1={toolY + 5} y2={toolY - 5} className="stroke-amber-400" strokeWidth={2} />
          {/* поток вниз по НКТ */}
          <line x1={cx} x2={cx} y1={top + 14} y2={toolY - 12} stroke={color} strokeWidth={2} strokeDasharray="6 4" markerEnd="url(#rir-arrow)" />
        </g>
      )}
      {!hasTool && <line x1={cx} x2={cx} y1={top + 14} y2={y(belowFrom) - 6} stroke={color} strokeWidth={2} strokeDasharray="6 4" markerEnd="url(#rir-arrow)" />}
      {/* устье */}
      <rect x={cx - rOuter - 6} y={top - 10} width={2 * (rOuter + 6)} height={10} className="fill-slate-500" />
      {/* подписи */}
      {labels.map((l) => (
        <g key={l.text}>
          <line x1={cx + rOuter + 4} x2={cx + rOuter + 14} y1={l.y} y2={l.y} className="stroke-muted-foreground" strokeWidth={1} />
          <text x={cx + rOuter + 17} y={l.y + 3} fontSize={10} className={l.cls}>{l.text}</text>
        </g>
      ))}
      <text x={8} y={H - 4} fontSize={10} className="fill-muted-foreground">масштаб по глубине: верх сжат, интервал работ растянут</text>
      {/* легенда */}
      <g transform={`translate(8, ${top + 4})`}>
        <rect width={10} height={10} fill={color} opacity={0.8} /><text x={14} y={9} fontSize={9} className="fill-foreground">состав</text>
        <rect y={14} width={10} height={10} fill="url(#rir-cem)" /><text x={14} y={23} fontSize={9} className="fill-foreground">цемент</text>
        <rect y={28} width={10} height={10} className="fill-red-600" /><text x={14} y={37} fontSize={9} className="fill-foreground">нарушение</text>
      </g>
    </svg>
  );
}
