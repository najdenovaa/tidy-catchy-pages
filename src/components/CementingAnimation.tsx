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

function interCasingVolumePerMeter(prevCasingIDmm: number, casingODmm: number): number {
  if (prevCasingIDmm <= casingODmm + EPS) return 0;
  const prevIdM = prevCasingIDmm / 1000;
  const casingODM = casingODmm / 1000;
  return (Math.PI / 4) * (prevIdM * prevIdM - casingODM * casingODM);
}

function openHoleVolumePerMeter(holeDiameterMm: number, casingODmm: number): number {
  if (holeDiameterMm <= casingODmm + EPS) return 0;
  const holeM = holeDiameterMm / 1000;
  const casingODM = casingODmm / 1000;
  return (Math.PI / 4) * (holeM * holeM - casingODM * casingODM);
}

function resolveAnnulusGeometry(
  casingDepthMD: number,
  annularVolumeM3: number,
  prevCasingDepth: number,
  holeDiameter: number,
  casingOD: number,
  prevCasingID: number,
) {
  const upperLen = prevCasingDepth > EPS ? Math.min(prevCasingDepth, casingDepthMD) : 0;
  const lowerLen = Math.max(0, casingDepthMD - upperLen);
  const upperVPM = upperLen > EPS ? interCasingVolumePerMeter(prevCasingID, casingOD) : 0;
  const fallbackLowerVPM = openHoleVolumePerMeter(holeDiameter, casingOD);

  let lowerVPM = fallbackLowerVPM;
  if (lowerLen > EPS && annularVolumeM3 > EPS) {
    const derivedLowerVPM = (annularVolumeM3 - upperLen * upperVPM) / lowerLen;
    if (derivedLowerVPM > EPS) {
      lowerVPM = derivedLowerVPM;
    }
  }

  if (lowerLen <= EPS) {
    lowerVPM = upperVPM > EPS ? upperVPM : Math.max(annularVolumeM3 / Math.max(casingDepthMD, 1), EPS);
  }

  return {
    upperLen,
    lowerLen,
    upperVPM: Math.max(upperVPM, EPS),
    lowerVPM: Math.max(lowerVPM, EPS),
  };
}

function buildExitedAnnulusBatches(
  history: PumpBatch[],
  effectivePumpedVol: number,
  pipeCapacityM3: number,
): PumpBatch[] {
  const exitBatches: PumpBatch[] = [];
  const mudExited = Math.min(Math.max(0, effectivePumpedVol), Math.max(0, pipeCapacityM3));
  if (mudExited > EPS) {
    exitBatches.push({ fluid: "mud", label: FLUID_LABELS.mud, volumeM3: mudExited });
  }

  let pumpedExited = Math.max(0, effectivePumpedVol - pipeCapacityM3);
  for (const batch of history) {
    if (pumpedExited <= EPS) break;
    if (batch.fluid === "displacement" || batch.fluid === "void") continue;

    const exitedOfBatch = Math.min(batch.volumeM3, pumpedExited);
    if (exitedOfBatch > EPS) {
      exitBatches.push({ ...batch, volumeM3: exitedOfBatch });
    }
    pumpedExited = Math.max(0, pumpedExited - exitedOfBatch);
  }

  if (pumpedExited > EPS) {
    exitBatches.push({ fluid: "mud", label: FLUID_LABELS.mud, volumeM3: pumpedExited });
  }

  return exitBatches;
}

function buildAnnulusSegmentsFromTargets(
  point: PressurePoint,
  history: PumpBatch[],
  effectivePumpedVol: number,
  casingDepthMD: number,
  pipeCapacityM3: number,
  annularVolumeM3: number,
  slurries: SlurryInput[],
  prevCasingDepth: number,
  holeDiameter: number,
  casingOD: number,
  prevCasingID: number,
): AnnulusSegment[] {
  if (casingDepthMD <= EPS) return [];

  const segments: AnnulusSegment[] = [];
  let cursorBot = casingDepthMD;
  let filledFromBottom = 0;
  let cementHeight = 0;
  const maxCementHeight = slurries.length > 0
    ? Math.max(0, casingDepthMD - Math.min(...slurries.map((slurry) => slurry.topDepthMD)))
    : casingDepthMD;
  const { upperLen, lowerLen, upperVPM, lowerVPM } = resolveAnnulusGeometry(
    casingDepthMD,
    annularVolumeM3,
    prevCasingDepth,
    holeDiameter,
    casingOD,
    prevCasingID,
  );
  const exitBatches = buildExitedAnnulusBatches(history, effectivePumpedVol, pipeCapacityM3);

  const addSegment = (fluid: FluidKey, label: string, rawHeight: number) => {
    const heightM = Math.max(0, Math.min(rawHeight, cursorBot));
    if (heightM <= EPS) return;

    const topMD = Math.max(0, cursorBot - heightM);
    const last = segments[segments.length - 1];
    if (last && last.fluid === fluid && last.label === label && Math.abs(last.topMD - cursorBot) <= EPS) {
      last.heightM += heightM;
      last.topMD = topMD;
      cursorBot = topMD;
      return;
    }

    segments.push({ fluid, label, heightM, topMD, botMD: cursorBot });
    cursorBot = topMD;
  };

  if (point.annDisplHeightM > EPS) {
    const displHeight = Math.min(point.annDisplHeightM, cursorBot);
    addSegment("displacement", FLUID_LABELS.displacement, displHeight);
    filledFromBottom += displHeight;
  }

  for (let i = exitBatches.length - 1; i >= 0; i--) {
    const batch = exitBatches[i];
    let volRemaining = batch.volumeM3;
    let batchHeight = 0;

    const cementHeightRemaining = () => (
      batch.fluid === "cement"
        ? Math.max(0, maxCementHeight - cementHeight)
        : Number.POSITIVE_INFINITY
    );

    const lowerFilled = Math.min(filledFromBottom, lowerLen);
    const lowerRemaining = Math.max(0, lowerLen - lowerFilled);
    if (lowerRemaining > EPS && volRemaining > EPS) {
      const heightLower = Math.min(
        volRemaining / lowerVPM,
        lowerRemaining,
        cementHeightRemaining(),
      );
      if (heightLower > EPS) {
        batchHeight += heightLower;
        volRemaining -= heightLower * lowerVPM;
        filledFromBottom += heightLower;
        if (batch.fluid === "cement") cementHeight += heightLower;
      }
    }

    const upperFilled = Math.max(0, filledFromBottom - lowerLen);
    const upperRemaining = Math.max(0, upperLen - upperFilled);
    if (upperRemaining > EPS && volRemaining > EPS) {
      const heightUpper = Math.min(
        volRemaining / upperVPM,
        upperRemaining,
        cementHeightRemaining(),
      );
      if (heightUpper > EPS) {
        batchHeight += heightUpper;
        volRemaining -= heightUpper * upperVPM;
        filledFromBottom += heightUpper;
        if (batch.fluid === "cement") cementHeight += heightUpper;
      }
    }

    addSegment(batch.fluid, batch.label, batchHeight);

    if (filledFromBottom >= casingDepthMD - EPS) {
      break;
    }
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
  if (isSurfaceOnlyStage(stage)) return null;
  if (slurryNames.has(stage)) return { fluid: "cement", label: stage };
  if (bufferNames.has(stage)) return { fluid: "buffer", label: stage };
  return { fluid: "displacement", label: stage || FLUID_LABELS.displacement };
}

function buildPipeSegments(
  history: PumpBatch[],
  cumulativeVolume: number,
  pipeCapacityM3: number,
  casingDepthMD: number,
  fillFluid: FluidKey = "mud",
  ckodDepth: number = 0,
  cumDisplacementVol: number = 0,
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
      fluid: fillFluid,
      label: FLUID_LABELS[fillFluid],
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

  // === ЦКОД: цементный «стакан» ниже ЦКОД ===
  // Продавочная пробка садится на ЦКОД, поэтому интервал ЦКОД→башмак
  // всегда занят цементом (как только цемент начал выходить из трубы).
  if (ckodDepth > EPS && ckodDepth < casingDepthMD - EPS) {
    const cementHistory = history.filter((b) => b.fluid === "cement");
    const hasCement = cementHistory.length > 0;
    const cementStartsExiting = cumulativeVolume - pipeCapacityM3;

    if (hasCement && cementStartsExiting > 0) {
      const shoeTrackTopMD = ckodDepth;
      const shoeTrackBotMD = casingDepthMD;
      const shoeTrackFracTop = 1 - shoeTrackBotMD / casingDepthMD;
      const shoeTrackFracBot = 1 - shoeTrackTopMD / casingDepthMD;
      const shoeTrackVolM3 = ((casingDepthMD - ckodDepth) / casingDepthMD) * pipeCapacityM3;
      const cementLabel = cementHistory[cementHistory.length - 1].label;

      const newSegments: PipeSegment[] = [];
      for (const seg of segments) {
        if (seg.botMD <= shoeTrackTopMD + EPS) {
          newSegments.push(seg);
        } else if (seg.topMD >= shoeTrackTopMD - EPS) {
          // полностью ниже ЦКОД — заменяется стаканом
          continue;
        } else {
          // пересекает ЦКОД — обрезаем сверху
          const clippedFracBot = 1 - shoeTrackTopMD / casingDepthMD;
          const denom = Math.max(seg.botMD - seg.topMD, EPS);
          newSegments.push({
            ...seg,
            botMD: shoeTrackTopMD,
            fracBot: clippedFracBot,
            volM3: seg.volM3 * ((shoeTrackTopMD - seg.topMD) / denom),
          });
        }
      }

      newSegments.push({
        fluid: "cement",
        label: cementLabel,
        fracTop: shoeTrackFracTop,
        fracBot: shoeTrackFracBot,
        volM3: shoeTrackVolM3,
        topMD: shoeTrackTopMD,
        botMD: shoeTrackBotMD,
      });

      newSegments.sort((a, b) => a.topMD - b.topMD);
      return newSegments;
    }
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

  /** Always use engine-reported annular heights — no dual-path logic */
  const visualFrames = useMemo(() => {
    const history: PumpBatch[] = [];
    let lastCumVol = 0;
    let inFlush = false;
    let preFlushCumVol = 0;
    let freefallOffset = 0;
    let cumDisplacementVol = 0;

    return pressureData.map((point, idx) => {
      const isFlushStage = /промывка лвд/i.test(point.stage);
      const deltaVol = Math.max(0, point.cumulativeVolume - lastCumVol);

      if (isFlushStage) {
        if (!inFlush) {
          inFlush = true;
          preFlushCumVol = lastCumVol;
        }

        const effectivePumpedVol = preFlushCumVol + (point.freefallSettledM3 || 0);

        const annulusSegments = buildAnnulusSegmentsFromTargets(
          point,
          history,
          effectivePumpedVol,
          casingDepthMD,
          pipeCapacityM3,
          annularVolumeM3,
          slurries,
          prevCasingDepth,
          holeDiameter,
          casingOD,
          prevCasingID,
        );
        const pipeSegments = buildPipeSegments(history, effectivePumpedVol, pipeCapacityM3, casingDepthMD, "void", ckodDepth);

        lastCumVol = point.cumulativeVolume;
        return { pipeSegments, annulusSegments, activeExit: null, flowConnected: false } as VisualFrame;
      }

      if (inFlush && !isFlushStage) {
        inFlush = false;
        freefallOffset = point.freefallSettledM3 || 0;
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
      const flowConnected = point.annularReturnRate > EPS && effectivePumpedVol > pipeCapacityM3 + EPS;

      // Determine what fluid is currently exiting the shoe for the flow indicator
      const totalNonMudH = point.annCementHeightM + point.annBufferHeightM + point.annDisplHeightM;
      let activeExit: PumpBatch | null = null;
      if (flowConnected && totalNonMudH > EPS) {
        // The fluid at the bottom of the annulus (nearest shoe) is what's exiting
        if (point.annDisplHeightM > EPS) {
          activeExit = { fluid: "displacement", label: FLUID_LABELS.displacement, volumeM3: point.annDisplHeightM };
        } else if (point.annCementHeightM > EPS) {
          activeExit = { fluid: "cement", label: FLUID_LABELS.cement, volumeM3: point.annCementHeightM };
        } else if (point.annBufferHeightM > EPS) {
          activeExit = { fluid: "buffer", label: FLUID_LABELS.buffer, volumeM3: point.annBufferHeightM };
        }
      }

      const annulusSegments = buildAnnulusSegmentsFromTargets(
        point,
        history,
        effectivePumpedVol,
        casingDepthMD,
        pipeCapacityM3,
        annularVolumeM3,
        slurries,
        prevCasingDepth,
        holeDiameter,
        casingOD,
        prevCasingID,
      );

      const frame: VisualFrame = {
        pipeSegments: buildPipeSegments(
          history,
          effectivePumpedVol,
          pipeCapacityM3,
          casingDepthMD,
          residualFreefallOffset > EPS ? "void" : "mud",
          ckodDepth,
        ),
        annulusSegments,
        activeExit,
        flowConnected,
      };

      lastCumVol = point.cumulativeVolume;
      return frame;
    });
  }, [annularVolumeM3, bufferNames, casingDepthMD, casingOD, ckodDepth, holeDiameter, pipeCapacityM3, pressureData, prevCasingDepth, prevCasingID, slurryNames, slurries]);

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
                  {/* Sump cement: once cement exits into annulus, sump is filled with cement */}
                  {currentPoint.annCementHeightM > EPS ? (
                    <rect
                      x={cx - lowerBoreHalf}
                      y={casingShoeY}
                      width={lowerBoreHalf * 2}
                      height={Math.max(0, wellBottomY - casingShoeY)}
                      fill={FLUID_COLORS.cement}
                      opacity={0.88}
                    />
                  ) : (
                    <rect
                      x={cx - lowerBoreHalf}
                      y={casingShoeY}
                      width={lowerBoreHalf * 2}
                      height={Math.max(0, wellBottomY - casingShoeY)}
                      fill="hsl(var(--secondary) / 0.18)"
                    />
                  )}
                  <text x={cx - lowerBoreHalf - 8} y={(casingShoeY + wellBottomY) / 2 + 2} textAnchor="end" className="text-[6px] fill-muted-foreground">
                    Зумпф {(wellDepthMD - casingDepthMD).toFixed(0)} м
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
