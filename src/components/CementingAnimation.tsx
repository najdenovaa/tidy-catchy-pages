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
  ckodDepth?: number;
  holeDiameter?: number;
  casingOD?: number;
  prevCasingID?: number;
}

type FluidKey = "mud" | "buffer" | "cement" | "displacement" | "void";
type AnnulusFluidKey = Exclude<FluidKey, "void">;

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
  void: "hsl(var(--muted))",
};

const FLUID_LABELS: Record<FluidKey, string> = {
  mud: "Буровой р-р",
  buffer: "Буфер",
  cement: "Цемент",
  displacement: "Продавка",
  void: "Воздух",
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
const TOP_DOWN_FLOW_ORDER: AnnulusFluidKey[] = ["mud", "buffer", "cement", "displacement"];

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

/**
 * Build annulus segments ALWAYS from engine-reported heights.
 * This ensures the animation is perfectly synchronized with the calc engine.
 */
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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function splitDepthInterval(topMD: number, botMD: number, breakpoints: number[]) {
  const points = [
    topMD,
    ...breakpoints.filter((point) => point > topMD + EPS && point < botMD - EPS).sort((a, b) => a - b),
    botMD,
  ];

  return points.slice(0, -1).map((point, index) => ({
    topMD: point,
    botMD: points[index + 1],
  }));
}

function createDepthScaler(topY: number, botY: number, wellDepthMD: number, casingDepthMD: number, ckodDepth: number) {
  const usableHeight = botY - topY;
  const totalDepth = Math.max(wellDepthMD, casingDepthMD, ckodDepth, EPS);
  const shoeTrackTop = ckodDepth > EPS && ckodDepth < casingDepthMD ? ckodDepth : casingDepthMD;
  const upperLen = Math.max(0, shoeTrackTop);
  const shoeTrackLen = Math.max(0, casingDepthMD - shoeTrackTop);
  const sumpLen = Math.max(0, totalDepth - casingDepthMD);
  const baseScale = usableHeight / totalDepth;

  const detailLen = shoeTrackLen + sumpLen;
  const minDetailHeight = (shoeTrackLen > EPS ? 14 : 0) + (sumpLen > EPS ? 18 : 0);
  const reservedDetailHeight = detailLen > EPS
    ? Math.min(Math.max(detailLen * baseScale, minDetailHeight), usableHeight * 0.34)
    : 0;

  const detailScale = detailLen > EPS ? reservedDetailHeight / detailLen : baseScale;
  const shoeTrackScale = shoeTrackLen > EPS ? Math.max(baseScale, detailScale) : baseScale;
  const sumpScale = sumpLen > EPS ? Math.max(baseScale, detailScale) : baseScale;
  const usedDetailHeight = shoeTrackLen * shoeTrackScale + sumpLen * sumpScale;
  const upperHeight = Math.max(0, usableHeight - usedDetailHeight);
  const upperScale = upperLen > EPS ? upperHeight / upperLen : baseScale;
  const upperEndY = topY + upperLen * upperScale;
  const casingShoeY = upperEndY + shoeTrackLen * shoeTrackScale;

  return {
    toY: (md: number) => {
      const depth = clamp(md, 0, totalDepth);
      if (depth <= upperLen + EPS) {
        return topY + depth * upperScale;
      }
      if (depth <= casingDepthMD + EPS) {
        return upperEndY + (depth - upperLen) * shoeTrackScale;
      }
      return casingShoeY + (depth - casingDepthMD) * sumpScale;
    },
  };
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
  ckodDepth = 0,
  holeDiameter = 0,
  casingOD = 0,
  prevCasingID = 0,
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
    let preFlushCumVol = 0;
    let preFlushNonMudH = 0;
    let freefallOffset = 0;
    let cumDisplacementVol = 0;
    const annVPM = annularVolumeM3 / Math.max(casingDepthMD, EPS);

    return pressureData.map((point, idx) => {
      const isFlushStage = /промывка лвд/i.test(point.stage);
      const deltaVol = Math.max(0, point.cumulativeVolume - lastCumVol);

      // During flush: cement falls in pipe under gravity, exits into annulus
      // Annulus uses calc engine heights (progressive settling), not frozen
      if (isFlushStage) {
        if (!inFlush) {
          inFlush = true;
          preFlushCumVol = lastCumVol;
          const prev = idx > 0 ? pressureData[idx - 1] : point;
          preFlushNonMudH = prev.annCementHeightM + prev.annBufferHeightM + prev.annDisplHeightM;
        }

        const currentNonMudH = point.annCementHeightM + point.annBufferHeightM + point.annDisplHeightM;
        const settledVol = Math.max(0, (currentNonMudH - preFlushNonMudH) * annVPM);
        const effectivePumpedVol = preFlushCumVol + settledVol;

        const annulusSegments = buildAnnulusSegmentsFromTargets(point, casingDepthMD, cementTargets, bufferTargets);
        const pipeSegments = buildPipeSegments(history, effectivePumpedVol, pipeCapacityM3, casingDepthMD, "void");

        lastCumVol = point.cumulativeVolume;
        return { pipeSegments, annulusSegments, activeExit: null, flowConnected: false } as VisualFrame;
      }

      if (inFlush && !isFlushStage) {
        inFlush = false;
        const currentNonMudH = point.annCementHeightM + point.annBufferHeightM + point.annDisplHeightM;
        freefallOffset = Math.max(0, (currentNonMudH - preFlushNonMudH) * annVPM);
      }

      if (deltaVol > EPS) {
        const batchMeta = classifyStage(point.stage, bufferNames, slurryNames);
        if (batchMeta) {
          pushBatch(history, { ...batchMeta, volumeM3: deltaVol });
          if (batchMeta.fluid === "displacement") {
            cumDisplacementVol += deltaVol;
          }
        }
      }

      const residualFreefallOffset = Math.max(0, freefallOffset - cumDisplacementVol);
      const effectivePumpedVol = point.cumulativeVolume + residualFreefallOffset;
      const exitedBatches = buildExitedBatches(history, effectivePumpedVol, pipeCapacityM3);
      const isStaticFrame = point.pumpRateLps <= EPS && point.annularReturnRate <= EPS;
      const annulusSegments = isStaticFrame
        ? buildAnnulusSegmentsFromTargets(point, casingDepthMD, cementTargets, bufferTargets)
        : buildAnnulusSegments(exitedBatches, point, casingDepthMD);
      const flowConnected = point.annularReturnRate > EPS && effectivePumpedVol > pipeCapacityM3 + EPS;
      const activeExit = flowConnected
        ? [...exitedBatches]
            .reverse()
            .find((batch) => batch.fluid !== "mud" && batch.volumeM3 > EPS) || null
        : null;

      const frame: VisualFrame = {
        pipeSegments: buildPipeSegments(
          history,
          effectivePumpedVol,
          pipeCapacityM3,
          casingDepthMD,
          residualFreefallOffset > EPS ? "void" : "mud",
        ),
        annulusSegments,
        activeExit,
        flowConnected,
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

  const wellHeight = 520;
  const topY = 40;
  const botY = wellHeight - 28;
  const safeCasingOD = Math.max(casingOD || 178, 1);
  const safeUpperBoreID = Math.max(prevCasingID || holeDiameter || safeCasingOD * 1.15, safeCasingOD * 1.05);
  const safeLowerBoreID = Math.max(holeDiameter || safeUpperBoreID, safeUpperBoreID);
  const casingOuterHalf = 22;
  const pipeInnerHalf = 18;
  const upperBoreHalf = Math.round(clamp(casingOuterHalf * (safeUpperBoreID / safeCasingOD) * 0.95, casingOuterHalf + 10, 50));
  const lowerBoreHalf = Math.round(clamp(casingOuterHalf * (safeLowerBoreID / safeCasingOD) * 0.98, upperBoreHalf, 58));
  const wellWidth = lowerBoreHalf * 2 + 120;
  const cx = wellWidth / 2;
  const depthScale = createDepthScaler(topY, botY, wellDepthMD, casingDepthMD, ckodDepth);
  const depthToY = depthScale.toY;
  const casingShoeY = depthToY(casingDepthMD);
  const wellBottomY = depthToY(wellDepthMD);
  const prevCasingY = prevCasingDepth > 0 && prevCasingDepth < casingDepthMD ? depthToY(prevCasingDepth) : null;
  const ckodY = ckodDepth > 0 && ckodDepth < casingDepthMD ? depthToY(ckodDepth) : null;
  const annulusBreakpoints = prevCasingDepth > 0 && prevCasingDepth < casingDepthMD ? [prevCasingDepth] : [];
  const annulusPieces = namedAnnulusSegments.flatMap((segment, segmentIndex) =>
    splitDepthInterval(segment.topMD, segment.botMD, annulusBreakpoints).map((part, partIndex) => {
      const isUpperSection = prevCasingDepth > EPS && part.botMD <= prevCasingDepth + EPS;
      const outerHalf = isUpperSection ? upperBoreHalf : lowerBoreHalf;
      const y = depthToY(part.topMD);

      return {
        ...segment,
        key: `${segmentIndex}-${partIndex}`,
        y,
        heightPx: Math.max(0, depthToY(part.botMD) - y),
        outerHalf,
      };
    }),
  );
  const annulusLabels = namedAnnulusSegments
    .filter((segment) => segment.fluid !== "mud" && depthToY(segment.botMD) - depthToY(segment.topMD) > 20)
    .map((segment) => ({
      ...segment,
      yMid: (depthToY(segment.topMD) + depthToY(segment.botMD)) / 2,
    }));

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
      yTop: depthToY(layer.topMD),
      yBot: depthToY(Math.min(layer.bottomMD, wellDepthMD)),
    }));

  const hasVoidInPipe = pipeSegments.some((segment) => segment.fluid === "void");
  const legendItems = [
    ...(hasVoidInPipe ? [{ color: FLUID_COLORS.void, label: FLUID_LABELS.void }] : []),
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

              <rect
                x={cx - upperBoreHalf}
                y={topY}
                width={upperBoreHalf * 2}
                height={(prevCasingY ?? casingShoeY) - topY}
                fill="hsl(var(--muted) / 0.16)"
                rx="6"
              />
              <rect
                x={cx - lowerBoreHalf}
                y={prevCasingY ?? topY}
                width={lowerBoreHalf * 2}
                height={wellBottomY - (prevCasingY ?? topY)}
                fill="hsl(var(--muted) / 0.10)"
                rx="6"
              />

              {wellDepthMD > casingDepthMD + EPS && (
                <>
                  <rect
                    x={cx - lowerBoreHalf}
                    y={casingShoeY}
                    width={lowerBoreHalf * 2}
                    height={Math.max(0, wellBottomY - casingShoeY)}
                    fill="hsl(var(--secondary) / 0.18)"
                  />
                  <text x={cx - lowerBoreHalf - 8} y={(casingShoeY + wellBottomY) / 2 + 2} textAnchor="end" className="text-[6px] fill-muted-foreground">
                    Зумпф
                  </text>
                </>
              )}

              {reservoirRects.map((layer, index) => (
                <g key={`reservoir-${index}`}>
                  <rect
                    x={cx - lowerBoreHalf - 8}
                    y={layer.yTop}
                    width={4}
                    height={layer.yBot - layer.yTop}
                    fill={RESERVOIR_COLORS[layer.fluidType] || "hsl(120, 60%, 35%)"}
                    opacity={0.7}
                  />
                  <rect
                    x={cx + lowerBoreHalf + 4}
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

              <path
                d={`M ${cx - upperBoreHalf} ${topY} L ${cx - upperBoreHalf} ${prevCasingY ?? topY} L ${cx - lowerBoreHalf} ${prevCasingY ?? topY} L ${cx - lowerBoreHalf} ${wellBottomY}`}
                stroke="hsl(var(--border))"
                strokeWidth="2"
                fill="none"
              />
              <path
                d={`M ${cx + upperBoreHalf} ${topY} L ${cx + upperBoreHalf} ${prevCasingY ?? topY} L ${cx + lowerBoreHalf} ${prevCasingY ?? topY} L ${cx + lowerBoreHalf} ${wellBottomY}`}
                stroke="hsl(var(--border))"
                strokeWidth="2"
                fill="none"
              />

              {prevCasingY !== null && (
                <g>
                  <line
                    x1={cx - lowerBoreHalf - 10}
                    y1={prevCasingY}
                    x2={cx + lowerBoreHalf + 10}
                    y2={prevCasingY}
                    stroke="hsl(var(--primary))"
                    strokeWidth="0.8"
                    strokeDasharray="3,2"
                  />
                  <text x={cx + lowerBoreHalf + 12} y={prevCasingY + 3} className="text-[6px] fill-primary">
                    Башмак пред. колонны {prevCasingDepth.toFixed(0)} м
                  </text>
                </g>
              )}

              {annulusPieces.map((segment) => (
                <g key={`annulus-${segment.key}`}>
                  <rect
                    x={cx - segment.outerHalf}
                    y={segment.y}
                    width={segment.outerHalf - casingOuterHalf}
                    height={segment.heightPx}
                    fill={FLUID_COLORS[segment.fluid]}
                    opacity={0.88}
                  />
                  <rect
                    x={cx + casingOuterHalf}
                    y={segment.y}
                    width={segment.outerHalf - casingOuterHalf}
                    height={segment.heightPx}
                    fill={FLUID_COLORS[segment.fluid]}
                    opacity={0.88}
                  />
                </g>
              ))}

              {annulusLabels.map((segment, index) => (
                <g key={`annulus-label-${index}`}>
                  <text
                    x={cx + lowerBoreHalf + 10}
                    y={segment.yMid - 3}
                    className="text-[6px] fill-foreground"
                    style={{ fontWeight: 700 }}
                  >
                    {segment.label.length > 18 ? `${segment.label.slice(0, 18)}…` : segment.label}
                  </text>
                  <text
                    x={cx + lowerBoreHalf + 10}
                    y={segment.yMid + 5}
                    className="text-[5px] fill-muted-foreground"
                  >
                    {segment.topMD.toFixed(0)}–{segment.botMD.toFixed(0)} м
                  </text>
                </g>
              ))}

              <rect x={cx - casingOuterHalf - 2} y={topY} width={4} height={Math.max(0, casingShoeY - topY)} fill="hsl(var(--foreground))" opacity={0.65} />
              <rect x={cx + casingOuterHalf - 2} y={topY} width={4} height={Math.max(0, casingShoeY - topY)} fill="hsl(var(--foreground))" opacity={0.65} />

              {pipeSegments.length > 0 ? (
                pipeSegments.map((segment, index) => {
                  const pipeInnerWidth = pipeInnerHalf * 2;
                  const segmentY = depthToY(segment.topMD);
                  const segmentH = Math.max(0, depthToY(segment.botMD) - segmentY);
                  return (
                    <g key={`pipe-${index}`}>
                      <rect
                        x={cx - pipeInnerHalf}
                        y={segmentY}
                        width={pipeInnerWidth}
                        height={segmentH}
                        fill={FLUID_COLORS[segment.fluid]}
                        opacity={segment.fluid === "void" ? 0.9 : 0.78}
                      />
                      {segmentH > 18 && (
                        <>
                          <text
                            x={cx}
                            y={segmentY + segmentH / 2 - 1}
                            textAnchor="middle"
                            className={segment.fluid === "void" ? "text-[6px] fill-foreground" : "text-[6px] fill-background"}
                            style={{ fontWeight: 700 }}
                          >
                            {segment.label.length > 12 ? `${segment.label.slice(0, 12)}…` : segment.label}
                          </text>
                          <text
                            x={cx}
                            y={segmentY + segmentH / 2 + 8}
                            textAnchor="middle"
                            className={segment.fluid === "void" ? "text-[5px] fill-foreground" : "text-[5px] fill-background"}
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
                  x={cx - pipeInnerHalf}
                  y={topY}
                  width={pipeInnerHalf * 2}
                  height={Math.max(0, casingShoeY - topY)}
                  fill={FLUID_COLORS.mud}
                  opacity={0.3}
                />
              )}

              {ckodY !== null && (
                <g>
                  <line
                    x1={cx - lowerBoreHalf - 10}
                    y1={ckodY}
                    x2={cx + lowerBoreHalf + 10}
                    y2={ckodY}
                    stroke="hsl(var(--accent))"
                    strokeWidth="0.8"
                    strokeDasharray="3,2"
                  />
                  <text x={cx + lowerBoreHalf + 12} y={ckodY + 3} className="text-[6px] fill-accent">
                    ЦКОД {ckodDepth.toFixed(0)} м
                  </text>
                  <rect
                    x={cx + casingOuterHalf + 8}
                    y={ckodY}
                    width={8}
                    height={Math.max(0, casingShoeY - ckodY)}
                    fill="none"
                    stroke="hsl(var(--accent))"
                    strokeWidth="0.8"
                    strokeDasharray="2,2"
                  />
                  <text x={cx + casingOuterHalf + 20} y={(ckodY + casingShoeY) / 2 + 2} className="text-[6px] fill-accent">
                    Башм. труба
                  </text>
                </g>
              )}

              {currentVisual.flowConnected && currentVisual.activeExit && (
                <g opacity="0.92">
                  <rect
                    x={cx - pipeInnerHalf}
                    y={casingShoeY - 5}
                    width={pipeInnerHalf * 2}
                    height={5}
                    fill={FLUID_COLORS[currentVisual.activeExit.fluid]}
                  />
                  <rect
                    x={cx - lowerBoreHalf}
                    y={casingShoeY - 5}
                    width={lowerBoreHalf - casingOuterHalf}
                    height={5}
                    fill={FLUID_COLORS[currentVisual.activeExit.fluid]}
                  />
                  <rect
                    x={cx + casingOuterHalf}
                    y={casingShoeY - 5}
                    width={lowerBoreHalf - casingOuterHalf}
                    height={5}
                    fill={FLUID_COLORS[currentVisual.activeExit.fluid]}
                  />
                </g>
              )}

              <line
                x1={cx - lowerBoreHalf - 4}
                y1={casingShoeY}
                x2={cx + lowerBoreHalf + 4}
                y2={casingShoeY}
                stroke="hsl(var(--primary))"
                strokeWidth="3"
              />
              <text x={cx} y={casingShoeY + 14} textAnchor="middle" className="text-[8px] fill-muted-foreground">
                Башмак ОК {casingDepthMD.toFixed(0)} м
              </text>

              <line
                x1={cx - lowerBoreHalf - 4}
                y1={wellBottomY}
                x2={cx + lowerBoreHalf + 4}
                y2={wellBottomY}
                stroke="hsl(var(--border))"
                strokeWidth="2"
              />
              <text x={cx} y={wellBottomY + 14} textAnchor="middle" className="text-[8px] fill-muted-foreground">
                Забой {wellDepthMD.toFixed(0)} м
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
