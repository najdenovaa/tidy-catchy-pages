import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, RotateCcw, FastForward } from "lucide-react";
import type { PressurePoint, StageBoundary, SlurryInput, BufferFluid, ReservoirLayer } from "@/lib/cementing-calculations";

interface Props {
  pressureData: PressurePoint[];
  stageBoundaries: StageBoundary[];
  casingDepthMD: number;
  wellDepthMD: number;
  slurries?: SlurryInput[];
  buffers?: BufferFluid[];
  reservoirLayers?: ReservoirLayer[];
  pipeCapacityM3?: number; // internal pipe volume
}

const FLUID_COLORS: Record<string, string> = {
  mud: "hsl(30, 50%, 45%)",
  buffer: "hsl(200, 60%, 50%)",
  cement: "hsl(0, 0%, 55%)",
  displacement: "hsl(120, 40%, 45%)",
};

const RESERVOIR_COLORS: Record<string, string> = {
  "нефть": "hsl(120, 60%, 35%)",
  "газ": "hsl(0, 70%, 50%)",
  "вода": "hsl(210, 70%, 55%)",
  "нефть+газ": "hsl(45, 80%, 50%)",
  "газоконденсат": "hsl(30, 70%, 50%)",
};

const SPEED_OPTIONS = [1, 2, 5, 10];

export default function CementingAnimation({
  pressureData, stageBoundaries, casingDepthMD, wellDepthMD,
  slurries = [], buffers = [], reservoirLayers = [], pipeCapacityM3 = 0,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const animRef = useRef<number>(0);
  const lastFrameTime = useRef(0);

  const maxIndex = pressureData.length - 1;
  const speed = SPEED_OPTIONS[speedIdx];
  const currentPoint = pressureData[Math.min(currentIndex, maxIndex)] || pressureData[0];

  const animate = useCallback((timestamp: number) => {
    if (!lastFrameTime.current) lastFrameTime.current = timestamp;
    const delta = timestamp - lastFrameTime.current;
    if (delta > 33) {
      lastFrameTime.current = timestamp;
      setCurrentIndex(prev => {
        const next = prev + speed;
        if (next >= maxIndex) { setPlaying(false); return maxIndex; }
        return next;
      });
    }
    animRef.current = requestAnimationFrame(animate);
  }, [speed, maxIndex]);

  useEffect(() => {
    if (playing) {
      lastFrameTime.current = 0;
      animRef.current = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(animRef.current);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [playing, animate]);

  const handleReset = () => { setPlaying(false); setCurrentIndex(0); };
  const toggleSpeed = () => setSpeedIdx(prev => (prev + 1) % SPEED_OPTIONS.length);

  // Build pump schedule for pipe tracking
  const pumpSchedule = useMemo(() => {
    const schedule: { startVol: number; endVol: number; fluidType: string; name: string }[] = [];
    let vol = 0;
    buffers.forEach(b => {
      const bVol = b.volume || b.flowRateSteps.reduce((s, st) => s + st.volumeM3, 0);
      if (bVol > 0) { schedule.push({ startVol: vol, endVol: vol + bVol, fluidType: "buffer", name: b.name }); vol += bVol; }
    });
    slurries.forEach(s => {
      const sVol = s.flowRateSteps.reduce((sum, st) => sum + st.volumeM3, 0);
      if (sVol > 0) { schedule.push({ startVol: vol, endVol: vol + sVol, fluidType: "cement", name: s.name }); vol += sVol; }
    });
    // displacement fills the rest
    schedule.push({ startVol: vol, endVol: vol + (pipeCapacityM3 || 999), fluidType: "displacement", name: "Продавка" });
    return schedule;
  }, [buffers, slurries, pipeCapacityM3]);

  // Compute pipe fluid segments at current cumulative volume
  const pipeSegments = useMemo(() => {
    if (!currentPoint || pipeCapacityM3 <= 0) return [];
    const cumVol = currentPoint.cumulativeVolume;
    const segs: { fluid: string; name: string; fracTop: number; fracBot: number }[] = [];

    // Pipe is filled top-to-bottom: latest pumped fluid is at top, oldest at bottom (exiting to annulus)
    // At cumVol, the pipe contains: bottom = whatever was pumped first and hasn't exited yet
    // What's still in pipe = pumped volumes that haven't fully passed through
    const exitedVol = Math.max(0, cumVol - pipeCapacityM3); // volume that already left pipe into annulus

    // Walk pump schedule; for each batch, determine how much is still in pipe
    let batchStart = 0;
    const pipeBatches: { fluid: string; name: string; volInPipe: number }[] = [];

    // First, the original mud in pipe
    const mudStillInPipe = Math.max(0, pipeCapacityM3 - cumVol);
    if (mudStillInPipe > 0) pipeBatches.push({ fluid: "mud", name: "Буровой р-р", volInPipe: mudStillInPipe });

    for (const batch of pumpSchedule) {
      const pumpedOfBatch = Math.max(0, Math.min(cumVol - batch.startVol, batch.endVol - batch.startVol));
      if (pumpedOfBatch <= 0) break;
      const exitedOfBatch = Math.max(0, exitedVol - batch.startVol);
      const inPipe = Math.max(0, pumpedOfBatch - exitedOfBatch);
      if (inPipe > 0) pipeBatches.push({ fluid: batch.fluidType, name: batch.name, volInPipe: inPipe });
    }

    // Convert volumes to fractions of pipe
    let cursor = 0;
    // Bottom of pipe = first (oldest) batch still in pipe; top = last (newest)
    // Reverse: draw from bottom (oldest) to top (newest)
    for (const pb of pipeBatches) {
      const frac = pb.volInPipe / pipeCapacityM3;
      segs.push({ fluid: pb.fluid, name: pb.name, fracTop: cursor, fracBot: cursor + frac });
      cursor += frac;
    }
    return segs;
  }, [currentPoint?.cumulativeVolume, pipeCapacityM3, pumpSchedule]);

  const currentStage = useMemo(() => {
    if (!currentPoint) return "Начало";
    let stage = "Начало";
    for (const sb of stageBoundaries) {
      if (currentPoint.time >= sb.time) stage = sb.label;
    }
    return stage;
  }, [currentPoint?.time, stageBoundaries]);

  if (!currentPoint) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Нет данных. Нажмите «РАСЧЁТ».
        </CardContent>
      </Card>
    );
  }

  // SVG dimensions
  const wellHeight = 480;
  const wellWidth = 260;
  const pipeWidth = 36;
  const annWidth = 22;
  const topY = 40;
  const botY = wellHeight - 20;
  const usableH = botY - topY;
  const scaleFactor = casingDepthMD > 0 ? usableH / casingDepthMD : 1;
  const cx = wellWidth / 2; // center x

  // Annulus segments (from bottom up)
  const annSegments: { fluid: string; height: number; y: number }[] = [];
  let curY = botY;
  if (currentPoint.annCementHeightM > 0) { const h = currentPoint.annCementHeightM * scaleFactor; curY -= h; annSegments.push({ fluid: "cement", height: h, y: curY }); }
  if (currentPoint.annBufferHeightM > 0) { const h = currentPoint.annBufferHeightM * scaleFactor; curY -= h; annSegments.push({ fluid: "buffer", height: h, y: curY }); }
  if (currentPoint.annDisplHeightM > 0) { const h = currentPoint.annDisplHeightM * scaleFactor; curY -= h; annSegments.push({ fluid: "displacement", height: h, y: curY }); }
  const mudH = Math.max(0, curY - topY);
  if (mudH > 0) annSegments.push({ fluid: "mud", height: mudH, y: topY });

  const maxTime = pressureData[maxIndex]?.time || 1;
  const progressPct = (currentPoint.time / maxTime) * 100;
  const cementTopMD = casingDepthMD - currentPoint.annCementHeightM;

  // Reservoir layer rects
  const reservoirRects = (reservoirLayers || []).filter(r => r.topMD > 0 && r.bottomMD > r.topMD).map(r => ({
    ...r,
    yTop: topY + r.topMD * scaleFactor,
    yBot: topY + Math.min(r.bottomMD, casingDepthMD) * scaleFactor,
  }));

  // Build fluid labels for legend (named)
  const legendItems: { color: string; label: string }[] = [
    { color: FLUID_COLORS.mud, label: "Буровой р-р" },
  ];
  buffers.forEach(b => legendItems.push({ color: FLUID_COLORS.buffer, label: b.name || "Буфер" }));
  slurries.forEach(s => legendItems.push({ color: FLUID_COLORS.cement, label: s.name || "Цемент" }));
  legendItems.push({ color: FLUID_COLORS.displacement, label: "Продавка" });
  reservoirLayers?.forEach(r => legendItems.push({ color: RESERVOIR_COLORS[r.fluidType] || "hsl(120, 60%, 35%)", label: `🛢 ${r.name}` }));

  // Deduplicate legend
  const seen = new Set<string>();
  const uniqueLegend = legendItems.filter(item => { if (seen.has(item.label)) return false; seen.add(item.label); return true; });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setPlaying(!playing)} className="gap-1">
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {playing ? "Пауза" : "Старт"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1">
              <RotateCcw className="w-4 h-4" /> Сброс
            </Button>
            <Button variant="outline" size="sm" onClick={toggleSpeed} className="gap-1">
              <FastForward className="w-4 h-4" /> ×{speed}
            </Button>
            <div className="flex-1 min-w-[200px]">
              <Slider value={[currentIndex]} min={0} max={maxIndex} step={1} onValueChange={([v]) => { setCurrentIndex(v); setPlaying(false); }} />
            </div>
            <span className="text-sm font-mono text-muted-foreground whitespace-nowrap">
              {currentPoint.time.toFixed(1)} / {maxTime.toFixed(1)} мин
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Well animation */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Анимация закачки</CardTitle>
          </CardHeader>
          <CardContent>
            <svg viewBox={`0 0 ${wellWidth} ${wellHeight}`} className="w-full max-w-[280px] mx-auto" style={{ height: wellHeight }}>
              {/* Surface */}
              <line x1="0" y1={topY} x2={wellWidth} y2={topY} stroke="hsl(var(--border))" strokeWidth="2" />
              <text x={cx} y={topY - 8} textAnchor="middle" className="text-[9px] fill-muted-foreground">Устье</text>

              {/* Reservoir layers (behind everything) */}
              {reservoirRects.map((r, i) => (
                <g key={`res-${i}`}>
                  <rect
                    x={cx - pipeWidth - annWidth - 4}
                    y={r.yTop}
                    width={4}
                    height={r.yBot - r.yTop}
                    fill={RESERVOIR_COLORS[r.fluidType] || "hsl(120, 60%, 35%)"}
                    opacity={0.7}
                  />
                  <rect
                    x={cx + pipeWidth + annWidth}
                    y={r.yTop}
                    width={4}
                    height={r.yBot - r.yTop}
                    fill={RESERVOIR_COLORS[r.fluidType] || "hsl(120, 60%, 35%)"}
                    opacity={0.7}
                  />
                  {/* Label on the far left */}
                  <text
                    x={2}
                    y={(r.yTop + r.yBot) / 2 + 3}
                    className="text-[6px]"
                    fill={RESERVOIR_COLORS[r.fluidType] || "hsl(120, 60%, 35%)"}
                  >
                    {r.name}
                  </text>
                </g>
              ))}

              {/* Open hole walls */}
              <rect x={cx - pipeWidth - annWidth - 4} y={topY} width={4} height={usableH} fill="hsl(30, 30%, 35%)" rx="1" opacity={0.5} />
              <rect x={cx + pipeWidth + annWidth} y={topY} width={4} height={usableH} fill="hsl(30, 30%, 35%)" rx="1" opacity={0.5} />

              {/* Annulus fluid segments */}
              {annSegments.map((seg, i) => (
                <g key={`ann-${i}`}>
                  <rect x={cx - pipeWidth - annWidth} y={seg.y} width={annWidth} height={seg.height} fill={FLUID_COLORS[seg.fluid]} opacity={0.85} />
                  <rect x={cx + pipeWidth} y={seg.y} width={annWidth} height={seg.height} fill={FLUID_COLORS[seg.fluid]} opacity={0.85} />
                </g>
              ))}

              {/* Casing pipe walls */}
              <rect x={cx - pipeWidth} y={topY} width={3} height={usableH} fill="hsl(var(--foreground))" opacity={0.6} />
              <rect x={cx + pipeWidth - 3} y={topY} width={3} height={usableH} fill="hsl(var(--foreground))" opacity={0.6} />

              {/* Pipe interior — fluid segments */}
              {pipeSegments.length > 0 ? pipeSegments.map((seg, i) => {
                const pipeInnerW = pipeWidth * 2 - 6;
                const segY = botY - seg.fracBot * usableH;
                const segH = (seg.fracBot - seg.fracTop) * usableH;
                return (
                  <rect
                    key={`pipe-${i}`}
                    x={cx - pipeWidth + 3}
                    y={segY}
                    width={pipeInnerW}
                    height={Math.max(0, segH)}
                    fill={FLUID_COLORS[seg.fluid] || FLUID_COLORS.mud}
                    opacity={0.6}
                  />
                );
              }) : (
                <rect x={cx - pipeWidth + 3} y={topY} width={pipeWidth * 2 - 6} height={usableH} fill={FLUID_COLORS.mud} opacity={0.3} />
              )}

              {/* Bottom */}
              <line x1={cx - pipeWidth - annWidth - 4} y1={botY} x2={cx + pipeWidth + annWidth + 4} y2={botY} stroke="hsl(30, 30%, 35%)" strokeWidth="3" />
              <text x={cx} y={botY + 14} textAnchor="middle" className="text-[8px] fill-muted-foreground">{casingDepthMD.toFixed(0)} м</text>

              {/* Cement top marker */}
              {currentPoint.annCementHeightM > 0 && (
                <>
                  <line
                    x1={cx + pipeWidth + annWidth + 6}
                    y1={botY - currentPoint.annCementHeightM * scaleFactor}
                    x2={cx + pipeWidth + annWidth + 30}
                    y2={botY - currentPoint.annCementHeightM * scaleFactor}
                    stroke="hsl(0, 70%, 50%)" strokeWidth="1" strokeDasharray="3,2"
                  />
                  <text
                    x={cx + pipeWidth + annWidth + 32}
                    y={botY - currentPoint.annCementHeightM * scaleFactor + 3}
                    className="text-[7px]" fill="hsl(0, 70%, 50%)"
                  >
                    {cementTopMD.toFixed(0)} м
                  </text>
                </>
              )}

              {/* Pipe fluid labels (stage name inside pipe) */}
              {pipeSegments.filter(s => (s.fracBot - s.fracTop) * usableH > 12).map((seg, i) => {
                const segY = botY - seg.fracBot * usableH;
                const segH = (seg.fracBot - seg.fracTop) * usableH;
                return (
                  <text
                    key={`pipelbl-${i}`}
                    x={cx}
                    y={segY + segH / 2 + 3}
                    textAnchor="middle"
                    className="text-[6px] fill-background"
                    style={{ fontWeight: 600 }}
                  >
                    {seg.name.length > 12 ? seg.name.slice(0, 12) + "…" : seg.name}
                  </text>
                );
              })}
            </svg>

            {/* Legend */}
            <div className="flex flex-wrap gap-2 mt-3 justify-center">
              {uniqueLegend.map((item, i) => (
                <div key={i} className="flex items-center gap-1 text-[10px]">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Dashboard */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Параметры в реальном времени</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-semibold border border-primary/20">
                {currentStage}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <DashCard label="Время" value={`${currentPoint.time.toFixed(1)} мин`} />
              <DashCard label="Объём закачки" value={`${currentPoint.cumulativeVolume.toFixed(2)} м³`} />
              <DashCard label="Q на входе" value={`${currentPoint.pumpRateLps.toFixed(1)} л/с`} />
              <DashCard label="Q на выходе" value={`${currentPoint.annularReturnRate.toFixed(1)} л/с`} />
              <DashCard label="P на насосе" value={`${currentPoint.surfacePressure.toFixed(2)} МПа`} />
              <DashCard label="P на забое" value={`${currentPoint.bottomholePressure.toFixed(2)} МПа`} />
              <DashCard label="P ГРП" value={`${currentPoint.fracturePressure.toFixed(2)} МПа`} highlight={currentPoint.bottomholePressure >= currentPoint.fracturePressure * 0.9} />
              <DashCard label="Кровля цемента" value={currentPoint.annCementHeightM > 0 ? `${cementTopMD.toFixed(0)} м` : "—"} />
              <DashCard label="Высота цемента" value={`${currentPoint.annCementHeightM.toFixed(1)} м`} />
            </div>

            {/* Annular composition bar */}
            <div className="mt-4">
              <div className="text-xs text-muted-foreground mb-1">Состав затрубного пространства</div>
              <div className="h-6 rounded-md overflow-hidden flex" style={{ border: "1px solid hsl(var(--border))" }}>
                {casingDepthMD > 0 && (
                  <>
                    {currentPoint.annDisplHeightM > 0 && <div style={{ width: `${(currentPoint.annDisplHeightM / casingDepthMD) * 100}%`, backgroundColor: FLUID_COLORS.displacement }} className="h-full transition-all duration-200" title={`Продавка: ${currentPoint.annDisplHeightM.toFixed(1)} м`} />}
                    {currentPoint.annBufferHeightM > 0 && <div style={{ width: `${(currentPoint.annBufferHeightM / casingDepthMD) * 100}%`, backgroundColor: FLUID_COLORS.buffer }} className="h-full transition-all duration-200" title={`Буфер: ${currentPoint.annBufferHeightM.toFixed(1)} м`} />}
                    {currentPoint.annMudHeightM > 0 && <div style={{ width: `${(currentPoint.annMudHeightM / casingDepthMD) * 100}%`, backgroundColor: FLUID_COLORS.mud }} className="h-full transition-all duration-200" title={`Буровой р-р: ${currentPoint.annMudHeightM.toFixed(1)} м`} />}
                    {currentPoint.annCementHeightM > 0 && <div style={{ width: `${(currentPoint.annCementHeightM / casingDepthMD) * 100}%`, backgroundColor: FLUID_COLORS.cement }} className="h-full transition-all duration-200" title={`Цемент: ${currentPoint.annCementHeightM.toFixed(1)} м`} />}
                  </>
                )}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                <span>Устье (0 м)</span>
                <span>Забой ({casingDepthMD.toFixed(0)} м)</span>
              </div>
            </div>

            {/* Pipe composition bar */}
            {pipeSegments.length > 0 && (
              <div className="mt-3">
                <div className="text-xs text-muted-foreground mb-1">Состав в трубе</div>
                <div className="h-6 rounded-md overflow-hidden flex" style={{ border: "1px solid hsl(var(--border))" }}>
                  {pipeSegments.map((seg, i) => (
                    <div key={i} style={{ width: `${(seg.fracBot - seg.fracTop) * 100}%`, backgroundColor: FLUID_COLORS[seg.fluid] }} className="h-full transition-all duration-200" title={`${seg.name}: ${((seg.fracBot - seg.fracTop) * 100).toFixed(1)}%`} />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                  <span>Забой</span>
                  <span>Устье</span>
                </div>
              </div>
            )}

            {/* Reservoir layers info */}
            {reservoirLayers && reservoirLayers.length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-muted-foreground mb-1">Продуктивные пласты</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {reservoirLayers.map((r, i) => (
                    <div key={i} className="rounded-md border border-border p-2 text-[10px] space-y-0.5" style={{ borderLeftColor: RESERVOIR_COLORS[r.fluidType] || "hsl(120,60%,35%)", borderLeftWidth: 3 }}>
                      <div className="font-semibold text-xs">{r.name} ({r.fluidType})</div>
                      <div>{r.topMD}–{r.bottomMD} м MD</div>
                      <div>Pпл: {r.porePressureGrad} кПа/м | ГРП: {r.fracGrad} кПа/м</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Progress bar */}
            <div className="mt-4">
              <div className="text-xs text-muted-foreground mb-1">Прогресс операции</div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-100" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DashCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-2.5 ${highlight ? "border-destructive bg-destructive/5" : "border-border"}`}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold font-mono ${highlight ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}
