import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, RotateCcw, FastForward } from "lucide-react";
import type {
  PressurePoint,
  StageBoundary,
  SlurryInput,
  BufferFluid,
  ReservoirLayer,
} from "@/lib/cementing-calculations";

interface Props {
  pressureData: PressurePoint[];
  stageBoundaries: StageBoundary[];
  casingDepthMD: number;
  wellDepthMD: number;
  slurries?: SlurryInput[];
  buffers?: BufferFluid[];
  reservoirLayers?: ReservoirLayer[];
  pipeCapacityM3?: number;
  annularVolumeM3?: number;
  prevCasingDepth?: number;
}

type FluidKey = "mud" | "buffer" | "cement" | "displacement";

interface PumpBatch {
  fluid: FluidKey;
  label: string;
  volumeM3: number;
}

interface PipeSegment {
  fluid: FluidKey;
  label: string;
  fracTop: number;
  fracBot: number;
  volM3: number;
  topMD: number;
  botMD: number;
}

interface AnnulusSegment {
  fluid: FluidKey;
  label: string;
  heightM: number;
  topMD: number;
  botMD: number;
}

interface VisualFrame {
  pipeSegments: PipeSegment[];
  annulusSegments: AnnulusSegment[];
  activeExit: PumpBatch | null;
  flowConnected: boolean;
}

interface CementTarget {
  label: string;
  lengthM: number;
}

interface BufferTarget {
  label: string;
  share: number;
}

const FLUID_COLORS: Record<FluidKey, string> = {
  mud: "hsl(30, 50%, 45%)",
  buffer: "hsl(200, 60%, 50%)",
  cement: "hsl(0, 0%, 55%)",
  displacement: "hsl(120, 40%, 45%)",
};

const FLUID_LABELS: Record<FluidKey, string> = {
  mud: "Буровой р-р",
  buffer: "Буфер",
  cement: "Цемент",
  displacement: "Продавка",
};

const RESERVOIR_COLORS: Record<string, string> = {
  нефть: "hsl(120, 60%, 35%)",
  газ: "hsl(0, 70%, 50%)",
  вода: "hsl(210, 70%, 55%)",
  "нефть+газ": "hsl(45, 80%, 50%)",
  газоконденсат: "hsl(30, 70%, 50%)",
};

const SPEED_OPTIONS = [1, 2, 5, 10];
const EPS = 1e-6;
const BOTTOM_UP_FLOW_ORDER: FluidKey[] = ["displacement", "cement", "buffer", "mud"];
const TOP_DOWN_FLOW_ORDER: FluidKey[] = ["mud", "buffer", "cement", "displacement"];

function buildCementTargets(slurries: SlurryInput[], casingDepthMD: number): CementTarget[] {
  return [...slurries]
    .sort((a, b) => a.topDepthMD - b.topDepthMD)
    .map((slurry, index, ordered) => {
      const nextTop = index === ordered.length - 1 ? casingDepthMD : ordered[index + 1].topDepthMD;
      return {
        label: slurry.name || `${FLUID_LABELS.cement} ${index + 1}`,
        lengthM: Math.max(0, Math.min(casingDepthMD, nextTop) - slurry.topDepthMD),
      };
    })
    .filter((target) => target.lengthM > EPS)
    .reverse();
}

function buildBufferTargets(buffers: BufferFluid[]): BufferTarget[] {
  const ordered = [...buffers].reverse();
  const totalVolume = ordered.reduce((sum, buffer) => sum + Math.max(0, buffer.volume), 0);
  return ordered.map((buffer, index) => ({
    label: buffer.name || `${FLUID_LABELS.buffer} ${ordered.length - index}`,
    share: totalVolume > EPS ? Math.max(0, buffer.volume) / totalVolume : 1 / Math.max(ordered.length, 1),
  }));
}

function buildAnnulusSegmentsFromTargets(
  point: PressurePoint,
  casingDepthMD: number,
  cementTargets: CementTarget[],
  bufferTargets: BufferTarget[],
): AnnulusSegment[] {
  if (casingDepthMD <= EPS) return [];

  const segments: AnnulusSegment[] = [];
  let cursorBot = casingDepthMD;

  const addSegment = (fluid: FluidKey, label: string, rawHeight: number) => {
    const heightM = Math.max(0, Math.min(rawHeight, cursorBot));
    if (heightM <= EPS) return;

    const topMD = Math.max(0, cursorBot - heightM);
    segments.push({ fluid, label, heightM, topMD, botMD: cursorBot });
    cursorBot = topMD;
  };

  addSegment("displacement", FLUID_LABELS.displacement, point.annDisplHeightM);

  let remainingCement = Math.min(point.annCementHeightM, cursorBot);
  for (const target of cementTargets) {
    if (remainingCement <= EPS) break;
    const heightM = Math.min(target.lengthM, remainingCement);
    addSegment("cement", target.label, heightM);
    remainingCement -= heightM;
  }
  if (remainingCement > EPS) {
    addSegment("cement", FLUID_LABELS.cement, remainingCement);
  }

  let remainingBuffer = Math.min(point.annBufferHeightM, cursorBot);
  const totalShare = bufferTargets.reduce((sum, target) => sum + target.share, 0) || 1;
  for (const target of bufferTargets) {
    if (remainingBuffer <= EPS) break;
    const plannedHeight = point.annBufferHeightM * (target.share / totalShare);
    const heightM = Math.min(plannedHeight, remainingBuffer);
    addSegment("buffer", target.label, heightM);
    remainingBuffer -= heightM;
  }
  if (remainingBuffer > EPS) {
    addSegment("buffer", FLUID_LABELS.buffer, remainingBuffer);
  }

  if (cursorBot > EPS) {
    addSegment("mud", FLUID_LABELS.mud, cursorBot);
  }

  return segments;
}

function pushBatch(target: PumpBatch[], batch: PumpBatch) {
  if (batch.volumeM3 <= EPS) return;
  const last = target[target.length - 1];
  if (last && last.fluid === batch.fluid && last.label === batch.label) {
    last.volumeM3 += batch.volumeM3;
  } else {
    target.push({ ...batch });
  }
}

/** Stages that flush surface lines — fluid goes to waste, NOT into the well */
function isSurfaceOnlyStage(stage: string): boolean {
  return /промывка лвд|заполнение лвд|опрессовка лвд/i.test(stage);
}

function classifyStage(stage: string, bufferNames: Set<string>, slurryNames: Set<string>): Omit<PumpBatch, "volumeM3"> | null {
  if (isSurfaceOnlyStage(stage)) return null; // surface-only, skip
  if (slurryNames.has(stage)) return { fluid: "cement", label: stage };
  if (bufferNames.has(stage)) return { fluid: "buffer", label: stage };
  return { fluid: "displacement", label: stage || FLUID_LABELS.displacement };
}

function buildExitedBatches(history: PumpBatch[], cumulativeVolume: number, pipeCapacityM3: number): PumpBatch[] {
  const exited: PumpBatch[] = [];
  const mudExited = Math.min(cumulativeVolume, pipeCapacityM3);
  if (mudExited > EPS) {
    exited.push({ fluid: "mud", label: FLUID_LABELS.mud, volumeM3: mudExited });
  }

  let pumpedExited = Math.max(0, cumulativeVolume - pipeCapacityM3);
  for (const batch of history) {
    if (pumpedExited <= EPS) break;
    const take = Math.min(batch.volumeM3, pumpedExited);
    if (take > EPS) {
      exited.push({ fluid: batch.fluid, label: batch.label, volumeM3: take });
      pumpedExited -= take;
    }
  }

  return exited;
}

function buildPipeSegments(
  history: PumpBatch[],
  cumulativeVolume: number,
  pipeCapacityM3: number,
  casingDepthMD: number,
): PipeSegment[] {
  if (pipeCapacityM3 <= EPS || casingDepthMD <= EPS) return [];

  const pipeBatches: PumpBatch[] = [];
  const mudStillInPipe = Math.max(0, pipeCapacityM3 - cumulativeVolume);
  if (mudStillInPipe > EPS) {
    pipeBatches.push({ fluid: "mud", label: FLUID_LABELS.mud, volumeM3: mudStillInPipe });
  }

  let pumpedExited = Math.max(0, cumulativeVolume - pipeCapacityM3);
  for (const batch of history) {
    const exitedOfBatch = Math.min(batch.volumeM3, pumpedExited);
    const inPipe = Math.max(0, batch.volumeM3 - exitedOfBatch);
    pumpedExited = Math.max(0, pumpedExited - exitedOfBatch);
    if (inPipe > EPS) {
      pipeBatches.push({ fluid: batch.fluid, label: batch.label, volumeM3: inPipe });
    }
  }

  const totalInPipe = pipeBatches.reduce((sum, batch) => sum + batch.volumeM3, 0);
  if (totalInPipe < pipeCapacityM3 - EPS) {
    pipeBatches.push({
      fluid: "mud",
      label: FLUID_LABELS.mud,
      volumeM3: pipeCapacityM3 - totalInPipe,
    });
  }

  const segments: PipeSegment[] = [];
  let cursor = 0;
  for (const batch of pipeBatches) {
    const frac = Math.min(batch.volumeM3 / pipeCapacityM3, 1 - cursor);
    if (frac <= EPS) continue;

    const fracTop = cursor;
    const fracBot = cursor + frac;
    const topMD = Math.max(0, casingDepthMD * (1 - fracBot));
    const botMD = Math.min(casingDepthMD, casingDepthMD * (1 - fracTop));

    segments.push({
      fluid: batch.fluid,
      label: batch.label,
      fracTop,
      fracBot,
      volM3: batch.volumeM3,
      topMD,
      botMD,
    });

    cursor += frac;
    if (cursor >= 1 - EPS) break;
  }

  return segments;
}

function buildAnnulusSegments(
  exitedBatches: PumpBatch[],
  point: PressurePoint,
  casingDepthMD: number,
): AnnulusSegment[] {
  if (casingDepthMD <= EPS) return [];

  const heights: Record<FluidKey, number> = {
    mud: point.annMudHeightM,
    buffer: point.annBufferHeightM,
    cement: point.annCementHeightM,
    displacement: point.annDisplHeightM,
  };

  const namedBottomUp = exitedBatches.slice().reverse();
  const segments: AnnulusSegment[] = [];
  let filledFromBottom = 0;

  for (const fluid of BOTTOM_UP_FLOW_ORDER) {
    const totalHeight = heights[fluid];
    if (totalHeight <= EPS) continue;

    let batches = namedBottomUp.filter((batch) => batch.fluid === fluid);
    if (fluid === "mud") {
      batches = [{ fluid: "mud", label: FLUID_LABELS.mud, volumeM3: 1 }];
    }
    if (batches.length === 0) {
      batches = [{ fluid, label: FLUID_LABELS[fluid], volumeM3: 1 }];
    }

    const totalBatchVolume = batches.reduce((sum, batch) => sum + batch.volumeM3, 0) || 1;
    let consumedHeight = 0;

    batches.forEach((batch, index) => {
      const isLast = index === batches.length - 1;
      const heightM = isLast
        ? Math.max(0, totalHeight - consumedHeight)
        : totalHeight * (batch.volumeM3 / totalBatchVolume);
      if (heightM <= EPS) return;

      const botMD = Math.max(0, casingDepthMD - filledFromBottom);
      const topMD = Math.max(0, casingDepthMD - (filledFromBottom + heightM));

      segments.push({
        fluid,
        label: batch.label,
        heightM,
        topMD,
        botMD,
      });

      filledFromBottom += heightM;
      consumedHeight += heightM;
    });
  }

  return segments;
}

export default function CementingAnimation({
  pressureData,
  stageBoundaries,
  casingDepthMD,
  wellDepthMD,
  slurries = [],
  buffers = [],
  reservoirLayers = [],
  pipeCapacityM3 = 0,
  annularVolumeM3 = 0,
  prevCasingDepth = 0,
}: Props) {
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const animRef = useRef<number>(0);
  const lastFrameTime = useRef(0);

  const maxIndex = Math.max(pressureData.length - 1, 0);
  const speed = SPEED_OPTIONS[speedIdx];
  const currentPoint = pressureData[Math.min(currentIndex, maxIndex)] || pressureData[0];

  const animate = useCallback((timestamp: number) => {
    if (!lastFrameTime.current) lastFrameTime.current = timestamp;
    const delta = timestamp - lastFrameTime.current;
    if (delta > 33) {
      lastFrameTime.current = timestamp;
      setCurrentIndex((prev) => {
        const next = prev + speed;
        if (next >= maxIndex) {
          setPlaying(false);
          return maxIndex;
        }
        return next;
      });
    }
    animRef.current = requestAnimationFrame(animate);
  }, [maxIndex, speed]);

  useEffect(() => {
    if (playing) {
      lastFrameTime.current = 0;
      animRef.current = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(animRef.current);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [animate, playing]);

  const handleReset = () => {
    setPlaying(false);
    setCurrentIndex(0);
  };

  const toggleSpeed = () => setSpeedIdx((prev) => (prev + 1) % SPEED_OPTIONS.length);

  const bufferNames = useMemo(() => new Set(buffers.map((buffer) => buffer.name).filter(Boolean)), [buffers]);
  const slurryNames = useMemo(() => new Set(slurries.map((slurry) => slurry.name).filter(Boolean)), [slurries]);
  const cementTargets = useMemo(() => buildCementTargets(slurries, casingDepthMD), [casingDepthMD, slurries]);
  const bufferTargets = useMemo(() => buildBufferTargets(buffers), [buffers]);

  const visualFrames = useMemo(() => {
    const history: PumpBatch[] = [];
    let lastCumVol = 0;
    let inFlush = false;
    let realPumpedVol = 0;
    // Freefall tracking: pre-flush state to compute gravity settling volume
    let preFlushRealPumpedVol = 0;
    let preFlushNonMudH = 0;
    const annVPM = annularVolumeM3 / Math.max(casingDepthMD, EPS);

    return pressureData.map((point, idx) => {
      const isFlushStage = /промывка лвд/i.test(point.stage);
      const deltaVol = Math.max(0, point.cumulativeVolume - lastCumVol);

      // During flush: cement falls in pipe under gravity, exits into annulus
      // Annulus uses calc engine heights (progressive settling), not frozen
      if (isFlushStage) {
        if (!inFlush) {
          inFlush = true;
          preFlushRealPumpedVol = realPumpedVol;
          const prev = idx > 0 ? pressureData[idx - 1] : point;
          preFlushNonMudH = prev.annCementHeightM + prev.annBufferHeightM + prev.annDisplHeightM;
        }

        // Compute progressive freefall volume from annular height changes
        const currentNonMudH = point.annCementHeightM + point.annBufferHeightM + point.annDisplHeightM;
        const settledVol = Math.max(0, (currentNonMudH - preFlushNonMudH) * annVPM);
        const effectiveRealPumped = preFlushRealPumpedVol + settledVol;

        // Annulus: use calc engine heights directly (shows progressive settling)
        const annulusSegments = buildAnnulusSegmentsFromTargets(point, casingDepthMD, cementTargets, bufferTargets);
        // Pipe: cement settled down, mud pushed out bottom
        const pipeSegments = buildPipeSegments(history, effectiveRealPumped, pipeCapacityM3, casingDepthMD);

        lastCumVol = point.cumulativeVolume;
        return { pipeSegments, annulusSegments, activeExit: null, flowConnected: false } as VisualFrame;
      }

      // Exiting flush — finalize freefall volume for pipe/annulus sync
      if (inFlush && !isFlushStage) {
        inFlush = false;
        const currentNonMudH = point.annCementHeightM + point.annBufferHeightM + point.annDisplHeightM;
        const finalFreefallVol = Math.max(0, (currentNonMudH - preFlushNonMudH) * annVPM);
        realPumpedVol = preFlushRealPumpedVol + finalFreefallVol;
      }

      if (deltaVol > EPS) {
        const batchMeta = classifyStage(point.stage, bufferNames, slurryNames);
        if (batchMeta) {
          pushBatch(history, { ...batchMeta, volumeM3: deltaVol });
          realPumpedVol += deltaVol;
        }
      }

      const exitedBatches = buildExitedBatches(history, realPumpedVol, pipeCapacityM3);
      const isSettled = point.pumpRateLps <= EPS && point.annularReturnRate <= EPS;
      const annulusSegments = isSettled
        ? buildAnnulusSegmentsFromTargets(point, casingDepthMD, cementTargets, bufferTargets)
        : buildAnnulusSegments(exitedBatches, point, casingDepthMD);
      const activeExit = [...exitedBatches]
        .reverse()
        .find((batch) => batch.fluid !== "mud" && batch.volumeM3 > EPS) || null;

      const frame: VisualFrame = {
        pipeSegments: buildPipeSegments(history, realPumpedVol, pipeCapacityM3, casingDepthMD),
        annulusSegments,
        activeExit,
        flowConnected: point.pumpRateLps > EPS && realPumpedVol > pipeCapacityM3 + EPS,
      };

      lastCumVol = point.cumulativeVolume;
      return frame;
    });
  }, [bufferNames, bufferTargets, casingDepthMD, cementTargets, pipeCapacityM3, pressureData, slurryNames, annularVolumeM3]);

  const currentVisual = visualFrames[Math.min(currentIndex, Math.max(visualFrames.length - 1, 0))] || {
    pipeSegments: [] as PipeSegment[],
    annulusSegments: [] as AnnulusSegment[],
    activeExit: null,
    flowConnected: false,
  };

  const pipeSegments = currentVisual.pipeSegments;
  const namedAnnulusSegments = currentVisual.annulusSegments;

  const currentStage = useMemo(() => {
    if (!currentPoint) return "Начало";
    let stage = "Начало";
    for (const boundary of stageBoundaries) {
      if (currentPoint.time >= boundary.time) stage = boundary.label;
    }
    return stage;
  }, [currentPoint, stageBoundaries]);

  if (!currentPoint) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Нет данных. Нажмите «РАСЧЁТ».
        </CardContent>
      </Card>
    );
  }

  const wellHeight = 480;
  // Compute proportional widths: annulus vs pipe based on real volumes
  const volRatio = pipeCapacityM3 > 0 && annularVolumeM3 > 0
    ? Math.min(Math.max(annularVolumeM3 / pipeCapacityM3, 0.5), 4)
    : 1.2;
  const basePipeHalf = 28; // half-width of pipe in px
  const annWidth = Math.round(Math.max(18, basePipeHalf * volRatio * 0.6));
  const pipeWidth = basePipeHalf;
  const wellWidth = 2 * (pipeWidth + annWidth + 14);
  const topY = 40;
  const botY = wellHeight - 20;
  const usableH = botY - topY;
  const scaleFactor = casingDepthMD > 0 ? usableH / casingDepthMD : 1;
  const cx = wellWidth / 2;

  let annCursorY = botY;
  const annSegmentsForRender = namedAnnulusSegments.map((segment) => {
    const heightPx = segment.heightM * scaleFactor;
    annCursorY -= heightPx;
    return {
      ...segment,
      heightPx,
      y: annCursorY,
    };
  });

  const maxTime = pressureData[maxIndex]?.time || 1;
  const progressPct = (currentPoint.time / maxTime) * 100;

  const displacementTopMD = currentPoint.annDisplHeightM > EPS
    ? Math.max(0, casingDepthMD - currentPoint.annDisplHeightM)
    : null;
  const cementTopMD = currentPoint.annCementHeightM > EPS
    ? Math.max(0, casingDepthMD - (currentPoint.annDisplHeightM + currentPoint.annCementHeightM))
    : null;
  const bufferTopMD = currentPoint.annBufferHeightM > EPS
    ? Math.max(0, casingDepthMD - (currentPoint.annDisplHeightM + currentPoint.annCementHeightM + currentPoint.annBufferHeightM))
    : null;

  const reservoirRects = reservoirLayers
    .filter((layer) => layer.topMD > 0 && layer.bottomMD > layer.topMD)
    .map((layer) => ({
      ...layer,
      yTop: topY + layer.topMD * scaleFactor,
      yBot: topY + Math.min(layer.bottomMD, casingDepthMD) * scaleFactor,
    }));

  const legendItems = [
    { color: FLUID_COLORS.mud, label: FLUID_LABELS.mud },
    ...buffers.map((buffer) => ({ color: FLUID_COLORS.buffer, label: buffer.name || FLUID_LABELS.buffer })),
    ...slurries.map((slurry) => ({ color: FLUID_COLORS.cement, label: slurry.name || FLUID_LABELS.cement })),
    { color: FLUID_COLORS.displacement, label: FLUID_LABELS.displacement },
    ...reservoirLayers.map((layer) => ({
      color: RESERVOIR_COLORS[layer.fluidType] || "hsl(120, 60%, 35%)",
      label: `🛢 ${layer.name}`,
    })),
  ];

  const seenLegend = new Set<string>();
  const uniqueLegend = legendItems.filter((item) => {
    if (seenLegend.has(item.label)) return false;
    seenLegend.add(item.label);
    return true;
  });

  const annulusBarSegments = TOP_DOWN_FLOW_ORDER
    .map((fluid) => ({
      fluid,
      heightM:
        fluid === "mud"
          ? currentPoint.annMudHeightM
          : fluid === "buffer"
            ? currentPoint.annBufferHeightM
            : fluid === "cement"
              ? currentPoint.annCementHeightM
              : currentPoint.annDisplHeightM,
    }))
    .filter((segment) => segment.heightM > EPS);

  const prevCasingY = prevCasingDepth > 0 && prevCasingDepth < casingDepthMD
    ? topY + prevCasingDepth * scaleFactor
    : null;

  return (
    <div className="space-y-4">
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
              <Slider
                value={[currentIndex]}
                min={0}
                max={maxIndex}
                step={1}
                onValueChange={([value]) => {
                  setCurrentIndex(value);
                  setPlaying(false);
                }}
              />
            </div>
            <span className="text-sm font-mono text-muted-foreground whitespace-nowrap">
              {currentPoint.time.toFixed(1)} / {maxTime.toFixed(1)} мин
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Анимация закачки</CardTitle>
          </CardHeader>
          <CardContent>
            <svg viewBox={`0 0 ${wellWidth} ${wellHeight}`} className="w-full max-w-[280px] mx-auto" style={{ height: wellHeight }}>
              <line x1="0" y1={topY} x2={wellWidth} y2={topY} stroke="hsl(var(--border))" strokeWidth="2" />
              <text x={cx} y={topY - 8} textAnchor="middle" className="text-[9px] fill-muted-foreground">
                Устье
              </text>

              {reservoirRects.map((layer, index) => (
                <g key={`reservoir-${index}`}>
                  <rect
                    x={cx - pipeWidth - annWidth - 4}
                    y={layer.yTop}
                    width={4}
                    height={layer.yBot - layer.yTop}
                    fill={RESERVOIR_COLORS[layer.fluidType] || "hsl(120, 60%, 35%)"}
                    opacity={0.7}
                  />
                  <rect
                    x={cx + pipeWidth + annWidth}
                    y={layer.yTop}
                    width={4}
                    height={layer.yBot - layer.yTop}
                    fill={RESERVOIR_COLORS[layer.fluidType] || "hsl(120, 60%, 35%)"}
                    opacity={0.7}
                  />
                  <text
                    x={2}
                    y={(layer.yTop + layer.yBot) / 2 + 3}
                    className="text-[6px]"
                    fill={RESERVOIR_COLORS[layer.fluidType] || "hsl(120, 60%, 35%)"}
                  >
                    {layer.name}
                  </text>
                </g>
              ))}

              <rect
                x={cx - pipeWidth - annWidth - 4}
                y={topY}
                width={4}
                height={usableH}
                fill="hsl(30, 30%, 35%)"
                rx="1"
                opacity={0.5}
              />
              <rect
                x={cx + pipeWidth + annWidth}
                y={topY}
                width={4}
                height={usableH}
                fill="hsl(30, 30%, 35%)"
                rx="1"
                opacity={0.5}
              />

              {prevCasingY !== null && (
                <g>
                  <line
                    x1={cx - pipeWidth - annWidth - 10}
                    y1={prevCasingY}
                    x2={cx + pipeWidth + annWidth + 10}
                    y2={prevCasingY}
                    stroke="hsl(var(--primary))"
                    strokeWidth="0.8"
                    strokeDasharray="3,2"
                  />
                  <text x={cx + pipeWidth + annWidth + 12} y={prevCasingY + 3} className="text-[6px] fill-primary">
                    Башмак пред. колонны {prevCasingDepth.toFixed(0)} м
                  </text>
                </g>
              )}

              {annSegmentsForRender.map((segment, index) => (
                <g key={`annulus-${index}`}>
                  <rect
                    x={cx - pipeWidth - annWidth}
                    y={segment.y}
                    width={annWidth}
                    height={segment.heightPx}
                    fill={FLUID_COLORS[segment.fluid]}
                    opacity={0.88}
                  />
                  <rect
                    x={cx + pipeWidth}
                    y={segment.y}
                    width={annWidth}
                    height={segment.heightPx}
                    fill={FLUID_COLORS[segment.fluid]}
                    opacity={0.88}
                  />
                  {segment.heightPx > 18 && segment.fluid !== "mud" && (
                    <>
                      <text
                        x={cx + pipeWidth + annWidth + 10}
                        y={segment.y + segment.heightPx / 2 - 3}
                        className="text-[6px] fill-foreground"
                        style={{ fontWeight: 700 }}
                      >
                        {segment.label.length > 18 ? `${segment.label.slice(0, 18)}…` : segment.label}
                      </text>
                      <text
                        x={cx + pipeWidth + annWidth + 10}
                        y={segment.y + segment.heightPx / 2 + 5}
                        className="text-[5px] fill-muted-foreground"
                      >
                        {segment.topMD.toFixed(0)}–{segment.botMD.toFixed(0)} м
                      </text>
                    </>
                  )}
                </g>
              ))}

              <rect x={cx - pipeWidth} y={topY} width={3} height={usableH} fill="hsl(var(--foreground))" opacity={0.6} />
              <rect x={cx + pipeWidth - 3} y={topY} width={3} height={usableH} fill="hsl(var(--foreground))" opacity={0.6} />

              {pipeSegments.length > 0 ? (
                pipeSegments.map((segment, index) => {
                  const pipeInnerWidth = pipeWidth * 2 - 6;
                  const segmentY = botY - segment.fracBot * usableH;
                  const segmentH = (segment.fracBot - segment.fracTop) * usableH;
                  return (
                    <g key={`pipe-${index}`}>
                      <rect
                        x={cx - pipeWidth + 3}
                        y={segmentY}
                        width={pipeInnerWidth}
                        height={Math.max(0, segmentH)}
                        fill={FLUID_COLORS[segment.fluid]}
                        opacity={0.72}
                      />
                      {segmentH > 18 && (
                        <>
                          <text
                            x={cx}
                            y={segmentY + segmentH / 2 - 1}
                            textAnchor="middle"
                            className="text-[6px] fill-background"
                            style={{ fontWeight: 700 }}
                          >
                            {segment.label.length > 12 ? `${segment.label.slice(0, 12)}…` : segment.label}
                          </text>
                          <text
                            x={cx}
                            y={segmentY + segmentH / 2 + 8}
                            textAnchor="middle"
                            className="text-[5px] fill-background"
                          >
                            {segment.volM3.toFixed(2)} м³
                          </text>
                        </>
                      )}
                    </g>
                  );
                })
              ) : (
                <rect
                  x={cx - pipeWidth + 3}
                  y={topY}
                  width={pipeWidth * 2 - 6}
                  height={usableH}
                  fill={FLUID_COLORS.mud}
                  opacity={0.3}
                />
              )}

              {currentVisual.flowConnected && currentVisual.activeExit && (
                <g opacity="0.92">
                  <rect
                    x={cx - pipeWidth + 3}
                    y={botY - 6}
                    width={pipeWidth * 2 - 6}
                    height={6}
                    fill={FLUID_COLORS[currentVisual.activeExit.fluid]}
                  />
                  <rect
                    x={cx - pipeWidth - annWidth}
                    y={botY - 6}
                    width={annWidth}
                    height={6}
                    fill={FLUID_COLORS[currentVisual.activeExit.fluid]}
                  />
                  <rect
                    x={cx + pipeWidth}
                    y={botY - 6}
                    width={annWidth}
                    height={6}
                    fill={FLUID_COLORS[currentVisual.activeExit.fluid]}
                  />
                </g>
              )}

              <line
                x1={cx - pipeWidth - annWidth - 4}
                y1={botY}
                x2={cx + pipeWidth + annWidth + 4}
                y2={botY}
                stroke="hsl(30, 30%, 35%)"
                strokeWidth="3"
              />
              <text x={cx} y={botY + 14} textAnchor="middle" className="text-[8px] fill-muted-foreground">
                Башмак ОК {casingDepthMD.toFixed(0)} м
              </text>

            </svg>

            <div className="mt-2 text-[10px] text-center text-muted-foreground">
              Глубина скважины {wellDepthMD.toFixed(0)} м MD
            </div>

            <div className="flex flex-wrap gap-2 mt-3 justify-center">
              {uniqueLegend.map((item, index) => (
                <div key={index} className="flex items-center gap-1 text-[10px]">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Параметры в реальном времени</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-2">
              <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-semibold border border-primary/20">
                {currentPoint.stage}
              </span>
              {currentStage !== currentPoint.stage && (
                <span className="inline-block px-3 py-1 rounded-full bg-muted text-muted-foreground text-sm font-semibold border border-border">
                  {currentStage}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <DashCard label="Время" value={`${currentPoint.time.toFixed(1)} мин`} />
              <DashCard label="Объём закачки" value={`${currentPoint.cumulativeVolume.toFixed(2)} м³`} />
              <DashCard label="Q на входе" value={`${currentPoint.pumpRateLps.toFixed(1)} л/с`} />
              <DashCard label="Q на выходе" value={`${currentPoint.annularReturnRate.toFixed(1)} л/с`} />
              <DashCard label="P на насосе" value={`${currentPoint.surfacePressure.toFixed(2)} МПа`} />
              <DashCard label="P на забое" value={`${currentPoint.bottomholePressure.toFixed(2)} МПа`} />
              <DashCard
                label="P ГРП"
                value={`${currentPoint.fracturePressure.toFixed(2)} МПа`}
                highlight={currentPoint.bottomholePressure >= currentPoint.fracturePressure * 0.9}
              />
              <DashCard label="Кровля продавки" value={displacementTopMD !== null ? `${displacementTopMD.toFixed(0)} м` : "—"} />
              <DashCard label="Кровля цемента" value={cementTopMD !== null ? `${cementTopMD.toFixed(0)} м` : "—"} />
              <DashCard label="Кровля буфера" value={bufferTopMD !== null ? `${bufferTopMD.toFixed(0)} м` : "—"} />
              <DashCard label="Высота цемента" value={`${currentPoint.annCementHeightM.toFixed(1)} м`} />
              <DashCard label="Забой скважины" value={`${wellDepthMD.toFixed(0)} м`} />
            </div>

            <div className="mt-4">
              <div className="text-xs text-muted-foreground mb-1">Состав затрубного пространства</div>
              <div className="h-6 rounded-md overflow-hidden flex" style={{ border: "1px solid hsl(var(--border))" }}>
                {annulusBarSegments.map((segment) => (
                  <div
                    key={segment.fluid}
                    style={{
                      width: `${(segment.heightM / casingDepthMD) * 100}%`,
                      backgroundColor: FLUID_COLORS[segment.fluid],
                    }}
                    className="h-full transition-all duration-200"
                    title={`${FLUID_LABELS[segment.fluid]}: ${segment.heightM.toFixed(1)} м`}
                  />
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                <span>Устье (0 м)</span>
                <span>Башмак ОК ({casingDepthMD.toFixed(0)} м)</span>
              </div>
            </div>

            {pipeSegments.length > 0 && (
              <div className="mt-3">
                <div className="text-xs text-muted-foreground mb-1">Состав в трубе</div>
                <div className="h-6 rounded-md overflow-hidden flex" style={{ border: "1px solid hsl(var(--border))" }}>
                  {pipeSegments.map((segment, index) => (
                    <div
                      key={`${segment.label}-${index}`}
                      style={{
                        width: `${(segment.fracBot - segment.fracTop) * 100}%`,
                        backgroundColor: FLUID_COLORS[segment.fluid],
                      }}
                      className="h-full transition-all duration-200"
                      title={`${segment.label}: ${segment.topMD.toFixed(0)}–${segment.botMD.toFixed(0)} м, ${segment.volM3.toFixed(2)} м³`}
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                  <span>Забой</span>
                  <span>Устье</span>
                </div>
              </div>
            )}

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Интервалы в затрубье</div>
                <div className="space-y-1.5">
                  {namedAnnulusSegments.map((segment, index) => (
                    <div key={`annulus-row-${index}`} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-[10px]">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: FLUID_COLORS[segment.fluid] }} />
                      <span className="truncate">{segment.label}</span>
                      <span className="ml-auto font-mono">
                        {segment.topMD.toFixed(0)}–{segment.botMD.toFixed(0)} м
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">Интервалы в трубе</div>
                <div className="space-y-1.5">
                  {pipeSegments.map((segment, index) => (
                    <div key={`pipe-row-${index}`} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-[10px]">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: FLUID_COLORS[segment.fluid] }} />
                      <span className="truncate">{segment.label}</span>
                      <span className="ml-auto font-mono">
                        {segment.topMD.toFixed(0)}–{segment.botMD.toFixed(0)} м
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {reservoirLayers.length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-muted-foreground mb-1">Продуктивные пласты</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {reservoirLayers.map((layer, index) => (
                    <div
                      key={index}
                      className="rounded-md border border-border p-2 text-[10px] space-y-0.5"
                      style={{ borderLeftColor: RESERVOIR_COLORS[layer.fluidType] || "hsl(120, 60%, 35%)", borderLeftWidth: 3 }}
                    >
                      <div className="font-semibold text-xs">
                        {layer.name} ({layer.fluidType})
                      </div>
                      <div>{layer.topMD}–{layer.bottomMD} м MD</div>
                      <div>Pпл: {layer.porePressureGrad} кПа/м | ГРП: {layer.fracGrad} кПа/м</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
