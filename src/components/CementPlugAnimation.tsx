import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, RotateCcw, FastForward } from "lucide-react";
import type { PlugInputs, PlugResults, PumpingStage } from "@/lib/cement-plug-calculations";

interface Props {
  inputs: PlugInputs;
  results: PlugResults;
}

type FluidKey = "mud" | "spacer" | "cement" | "displacement" | "viscousPad";
type FlowMode = "trip_down" | "trip_up" | "down_pipe" | "down_annulus" | "hold";

interface VolumeSegment {
  fluid: FluidKey;
  label: string;
  volumeM3: number;
}

interface DepthSegment {
  fluid: FluidKey;
  label: string;
  topMD: number;
  botMD: number;
  volumeM3: number;
}

interface Frame {
  timeMin: number;
  stage: string;
  stageDescription: string;
  flowMode: FlowMode;
  pipeTipMD: number;
  pipeSegs: DepthSegment[];
  annSegs: DepthSegment[];
  belowPipeSegs: DepthSegment[];
  pumpRateLs: number;
  volumeM3: number;
}

interface TimelineStage {
  name: string;
  description: string;
  startMin: number;
  endMin: number;
}

const COLORS: Record<FluidKey, string> = {
  mud: "hsl(30, 50%, 45%)",
  spacer: "hsl(200, 60%, 55%)",
  cement: "hsl(0, 0%, 62%)",
  displacement: "hsl(120, 40%, 45%)",
  viscousPad: "hsl(280, 50%, 50%)",
};

const SPEED_OPTIONS = [1, 2, 5, 10];
const EPS = 1e-6;

function areaM2(dMm: number) {
  const d = dMm / 1000;
  return (Math.PI / 4) * d * d;
}

function mergeSegments(segments: VolumeSegment[]) {
  const merged: VolumeSegment[] = [];
  for (const segment of segments) {
    if (segment.volumeM3 <= EPS) continue;
    const last = merged[merged.length - 1];
    if (last && last.fluid === segment.fluid && last.label === segment.label) {
      last.volumeM3 += segment.volumeM3;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

function sumVolume(segments: VolumeSegment[]) {
  return segments.reduce((sum, segment) => sum + segment.volumeM3, 0);
}

function labelFromFluidText(text: string, fallback: string) {
  if (!text || text === "—") return fallback;
  return text.split(" (")[0] || fallback;
}

function classifyFluid(stage: PumpingStage, inputs: PlugInputs): { fluid: FluidKey; label: string } {
  const fallbackLabel = labelFromFluidText(stage.fluid, stage.name);

  if (/вязк|пачк/i.test(stage.name)) {
    return {
      fluid: "viscousPad",
      label: inputs.viscousPadFluid?.name || fallbackLabel,
    };
  }
  if (/цемент/i.test(stage.name)) {
    return { fluid: "cement", label: inputs.cement.name || fallbackLabel };
  }
  if (/буфер/i.test(stage.name)) {
    return { fluid: "spacer", label: inputs.spacer.name || fallbackLabel };
  }
  if (/продавк/i.test(stage.name)) {
    return { fluid: "displacement", label: "Продавка" };
  }
  return { fluid: "mud", label: inputs.wellFluid.name || fallbackLabel };
}

function modeLabel(mode: FlowMode) {
  switch (mode) {
    case "trip_down":
      return "Спуск инструмента";
    case "trip_up":
      return "Подъём инструмента";
    case "down_pipe":
      return "Подача вниз по трубе, возврат по затрубью";
    case "down_annulus":
      return "Подача вниз по затрубью, возврат по трубе";
    default:
      return "Ожидание";
  }
}

export default function CementPlugAnimation({ inputs, results }: Props) {
  const { well, plug, cement, spacer, wellFluid } = inputs;
  const isOpenHole = results.isOpenHole;
  const boreDiam = results.boreDiamUsed;
  const pipeEndMD = plug.bottomMD;
  const pullOutMD = results.pullOutDepthMD;
  const wellDepth = well.wellDepthMD;

  const annA = Math.max(results.annArea || 0, EPS);
  const pipeA = Math.max(results.pipeArea || areaM2(well.pipeID), EPS);
  const boreA = Math.max(areaM2(boreDiam), annA + pipeA, EPS);

  const simulation = useMemo(() => {
    let currentTipMD = 0;
    let pipeStack: VolumeSegment[] = [];
    let outsideStack: VolumeSegment[] = [
      { fluid: "mud", label: wellFluid.name, volumeM3: boreA * wellDepth },
    ];

    let t = 0;
    let cumVol = 0;

    const frames: Frame[] = [];
    const timeline: TimelineStage[] = [];

    const pipeCapacity = (tipMD: number) => pipeA * Math.max(0, tipMD);
    const outsideCapacity = (tipMD: number) => annA * Math.max(0, tipMD) + boreA * Math.max(0, wellDepth - tipMD);

    function addPipeTop(segment: VolumeSegment) {
      pipeStack.unshift({ ...segment });
      pipeStack = mergeSegments(pipeStack);
    }

    function addPipeBottom(segment: VolumeSegment) {
      pipeStack.push({ ...segment });
      pipeStack = mergeSegments(pipeStack);
    }

    function addOutsideBottom(segment: VolumeSegment) {
      outsideStack.unshift({ ...segment });
      outsideStack = mergeSegments(outsideStack);
    }

    function addOutsideTop(segment: VolumeSegment) {
      outsideStack.push({ ...segment });
      outsideStack = mergeSegments(outsideStack);
    }

    function removeFromPipeBottom(volumeM3: number) {
      const removed: VolumeSegment[] = [];
      let remaining = volumeM3;
      while (remaining > EPS && pipeStack.length > 0) {
        const last = pipeStack[pipeStack.length - 1];
        const take = Math.min(last.volumeM3, remaining);
        removed.push({ fluid: last.fluid, label: last.label, volumeM3: take });
        if (take >= last.volumeM3 - EPS) {
          pipeStack.pop();
        } else {
          last.volumeM3 -= take;
        }
        remaining -= take;
      }
      pipeStack = mergeSegments(pipeStack);
      return removed;
    }

    function removeFromPipeTop(volumeM3: number) {
      let remaining = volumeM3;
      while (remaining > EPS && pipeStack.length > 0) {
        const first = pipeStack[0];
        const take = Math.min(first.volumeM3, remaining);
        if (take >= first.volumeM3 - EPS) {
          pipeStack.shift();
        } else {
          first.volumeM3 -= take;
        }
        remaining -= take;
      }
      pipeStack = mergeSegments(pipeStack);
    }

    function removeFromOutsideBottom(volumeM3: number) {
      const removed: VolumeSegment[] = [];
      let remaining = volumeM3;
      while (remaining > EPS && outsideStack.length > 0) {
        const first = outsideStack[0];
        const take = Math.min(first.volumeM3, remaining);
        removed.push({ fluid: first.fluid, label: first.label, volumeM3: take });
        if (take >= first.volumeM3 - EPS) {
          outsideStack.shift();
        } else {
          first.volumeM3 -= take;
        }
        remaining -= take;
      }
      outsideStack = mergeSegments(outsideStack);
      return removed;
    }

    function removeFromOutsideTop(volumeM3: number) {
      let remaining = volumeM3;
      while (remaining > EPS && outsideStack.length > 0) {
        const last = outsideStack[outsideStack.length - 1];
        const take = Math.min(last.volumeM3, remaining);
        if (take >= last.volumeM3 - EPS) {
          outsideStack.pop();
        } else {
          last.volumeM3 -= take;
        }
        remaining -= take;
      }
      outsideStack = mergeSegments(outsideStack);
    }

    function addBottomToPipeFromOutside(segments: VolumeSegment[]) {
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        addPipeBottom(segments[index]);
      }
    }

    function addBottomToOutsideFromPipe(segments: VolumeSegment[]) {
      for (let index = segments.length - 1; index >= 0; index -= 1) {
        addOutsideBottom(segments[index]);
      }
    }

    function fillOutsideToCapacity(targetCapacity: number) {
      const gap = targetCapacity - sumVolume(outsideStack);
      if (gap <= EPS) return;
      const bottomFluid = outsideStack[0] || { fluid: "mud" as FluidKey, label: wellFluid.name, volumeM3: 0 };
      addOutsideBottom({ fluid: bottomFluid.fluid, label: bottomFluid.label, volumeM3: gap });
    }

    function trimOutsideTopToCapacity(targetCapacity: number) {
      const excess = sumVolume(outsideStack) - targetCapacity;
      if (excess > EPS) removeFromOutsideTop(excess);
    }

    function trimPipeTopToCapacity(targetCapacity: number) {
      const excess = sumVolume(pipeStack) - targetCapacity;
      if (excess > EPS) removeFromPipeTop(excess);
    }

    function moveTipTo(nextTipMD: number) {
      const clampedNextTip = Math.max(0, Math.min(nextTipMD, wellDepth));
      if (Math.abs(clampedNextTip - currentTipMD) <= EPS) return;

      if (clampedNextTip > currentTipMD) {
        const addedPipeVolume = pipeA * (clampedNextTip - currentTipMD);
        const transferred = removeFromOutsideBottom(addedPipeVolume);
        addBottomToPipeFromOutside(transferred);
        currentTipMD = clampedNextTip;
        trimOutsideTopToCapacity(outsideCapacity(currentTipMD));
      } else {
        const releasedPipeVolume = pipeA * (currentTipMD - clampedNextTip);
        const released = removeFromPipeBottom(releasedPipeVolume);
        addBottomToOutsideFromPipe(released);
        currentTipMD = clampedNextTip;
        fillOutsideToCapacity(outsideCapacity(currentTipMD));
      }
    }

    function pumpDownPipe(fluid: FluidKey, label: string, volumeM3: number) {
      if (volumeM3 <= EPS) return;
      addPipeTop({ fluid, label, volumeM3 });
      const excessPipe = sumVolume(pipeStack) - pipeCapacity(currentTipMD);
      if (excessPipe > EPS) {
        const transferred = removeFromPipeBottom(excessPipe);
        addBottomToOutsideFromPipe(transferred);
      }
      trimOutsideTopToCapacity(outsideCapacity(currentTipMD));
    }

    function pumpDownAnnulus(fluid: FluidKey, label: string, volumeM3: number) {
      if (volumeM3 <= EPS) return;
      addOutsideTop({ fluid, label, volumeM3 });
      const excessOutside = sumVolume(outsideStack) - outsideCapacity(currentTipMD);
      if (excessOutside > EPS) {
        const transferred = removeFromOutsideBottom(excessOutside);
        addBottomToPipeFromOutside(transferred);
      }
      trimPipeTopToCapacity(pipeCapacity(currentTipMD));
    }

    function buildPipeDepthSegments(): DepthSegment[] {
      const segments: DepthSegment[] = [];
      let topMD = 0;
      for (const segment of pipeStack) {
        if (topMD >= currentTipMD - EPS) break;
        const lengthMD = segment.volumeM3 / pipeA;
        const botMD = Math.min(currentTipMD, topMD + lengthMD);
        if (botMD - topMD > EPS) {
          segments.push({
            fluid: segment.fluid,
            label: segment.label,
            topMD,
            botMD,
            volumeM3: (botMD - topMD) * pipeA,
          });
          topMD = botMD;
        }
      }
      return segments;
    }

    function buildOutsideDepthSegments(): { annSegs: DepthSegment[]; belowPipeSegs: DepthSegment[] } {
      const annSegs: DepthSegment[] = [];
      const belowPipeSegs: DepthSegment[] = [];

      let cursorBottomMD = wellDepth;
      let remainingBelowLength = Math.max(0, wellDepth - currentTipMD);

      for (const segment of outsideStack) {
        let remainingVolume = segment.volumeM3;

        if (remainingBelowLength > EPS && remainingVolume > EPS) {
          const belowLength = Math.min(remainingBelowLength, remainingVolume / boreA);
          if (belowLength > EPS) {
            belowPipeSegs.push({
              fluid: segment.fluid,
              label: segment.label,
              topMD: cursorBottomMD - belowLength,
              botMD: cursorBottomMD,
              volumeM3: belowLength * boreA,
            });
            remainingVolume -= belowLength * boreA;
            cursorBottomMD -= belowLength;
            remainingBelowLength -= belowLength;
          }
        }

        if (remainingVolume > EPS && currentTipMD > EPS) {
          const annLength = Math.min(cursorBottomMD, remainingVolume / annA);
          if (annLength > EPS) {
            annSegs.push({
              fluid: segment.fluid,
              label: segment.label,
              topMD: cursorBottomMD - annLength,
              botMD: cursorBottomMD,
              volumeM3: annLength * annA,
            });
            remainingVolume -= annLength * annA;
            cursorBottomMD -= annLength;
          }
        }
      }

      if (cursorBottomMD > EPS && currentTipMD > EPS) {
        annSegs.push({
          fluid: "mud",
          label: wellFluid.name,
          topMD: 0,
          botMD: cursorBottomMD,
          volumeM3: cursorBottomMD * annA,
        });
      }

      return { annSegs, belowPipeSegs };
    }

    function pushFrame(stage: string, stageDescription: string, flowMode: FlowMode, pumpRateLs: number) {
      const { annSegs, belowPipeSegs } = buildOutsideDepthSegments();
      frames.push({
        timeMin: t,
        stage,
        stageDescription,
        flowMode,
        pipeTipMD: currentTipMD,
        pipeSegs: buildPipeDepthSegments(),
        annSegs,
        belowPipeSegs,
        pumpRateLs,
        volumeM3: cumVol,
      });
    }

    const runInSpeed = inputs.tripSpeedMs > 0 ? inputs.tripSpeedMs : 0.3;
    const runInTimeMin = pipeEndMD > 0 ? pipeEndMD / runInSpeed / 60 : 0;
    const runInDescription = `Спуск инструмента от устья до ${pipeEndMD.toFixed(0)} м MD со скоростью ${runInSpeed.toFixed(2)} м/с.`;

    timeline.push({
      name: "Спуск инструмента",
      description: runInDescription,
      startMin: t,
      endMin: t + runInTimeMin,
    });

    const runInSteps = Math.max(1, Math.ceil(runInTimeMin / 0.25));
    pushFrame("Спуск инструмента", runInDescription, "trip_down", 0);
    for (let step = 1; step <= runInSteps; step += 1) {
      const frac = step / runInSteps;
      moveTipTo(pipeEndMD * frac);
      t = runInTimeMin * frac;
      pushFrame("Спуск инструмента", runInDescription, "trip_down", 0);
    }

    for (const stage of results.pumpingStages) {
      const stageStart = t;
      const stageTime = Math.max(stage.timeMin, 0);
      const stageVol = Math.max(stage.volumeM3, 0);
      const isTripUp = /подъём/i.test(stage.name);
      const isTripDown = /спуск/i.test(stage.name);
      const isReverseFlow = /обратн/i.test(stage.name) || (/промывк/i.test(stage.name) && results.washType === "reverse");
      const flowMode: FlowMode = isTripUp
        ? "trip_up"
        : isTripDown
          ? "trip_down"
          : isReverseFlow
            ? "down_annulus"
            : stageVol > EPS
              ? "down_pipe"
              : "hold";

      timeline.push({
        name: stage.name,
        description: stage.description,
        startMin: stageStart,
        endMin: stageStart + stageTime,
      });

      if (isTripUp || isTripDown) {
        const fromTip = currentTipMD;
        let toTip = currentTipMD;

        if (/над пачк/i.test(stage.name)) {
          toTip = results.padPullUpMD || Math.max(0, pipeEndMD - 5);
        } else if (/кровл/i.test(stage.name)) {
          toTip = pipeEndMD;
        } else if (isTripUp) {
          toTip = pullOutMD;
        }

        const tripSteps = Math.max(1, Math.ceil(stageTime / 0.25));
        if (tripSteps === 1 && stageTime <= EPS) {
          moveTipTo(toTip);
          pushFrame(stage.name, stage.description, flowMode, 0);
        } else {
          for (let step = 1; step <= tripSteps; step += 1) {
            const frac = step / tripSteps;
            moveTipTo(fromTip + (toTip - fromTip) * frac);
            t = stageStart + stageTime * frac;
            pushFrame(stage.name, stage.description, flowMode, 0);
          }
        }
        continue;
      }

      if (stageTime <= EPS || stageVol <= EPS) {
        pushFrame(stage.name, stage.description, flowMode, 0);
        continue;
      }

      const { fluid, label } = classifyFluid(stage, inputs);
      const rateLs = (stageVol * 1000) / (stageTime * 60);
      const pumpSteps = Math.max(1, Math.ceil(stageTime / 0.25));
      const dVol = stageVol / pumpSteps;

      for (let step = 1; step <= pumpSteps; step += 1) {
        if (flowMode === "down_annulus") {
          pumpDownAnnulus(fluid, label, dVol);
        } else {
          pumpDownPipe(fluid, label, dVol);
        }
        cumVol += dVol;
        t = stageStart + stageTime * (step / pumpSteps);
        pushFrame(stage.name, stage.description, flowMode, rateLs);
      }
    }

    return { frames, timeline };
  }, [annA, boreA, inputs, pipeA, pipeEndMD, pullOutMD, results, wellDepth, wellFluid.name]);

  const frames = simulation.frames;
  const timeline = simulation.timeline;

  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const animRef = useRef<number>(0);
  const lastFrameTime = useRef(0);

  const maxIndex = Math.max(frames.length - 1, 0);
  const speed = SPEED_OPTIONS[speedIdx];
  const frame = frames[Math.min(currentIndex, maxIndex)] || frames[0];

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

  if (!frame) return null;

  const svgW = 300;
  const svgH = 520;
  const topY = 45;
  const botY = svgH - 25;
  const usableH = botY - topY;
  const cx = svgW / 2;
  const pipeW = 18;
  const annW = 14;
  const wallW = 4;
  const mdToY = (md: number) => topY + (md / wellDepth) * usableH;
  const tipY = mdToY(frame.pipeTipMD);
  const shoeMD = well.casingShoe;
  const shoeY = mdToY(shoeMD);
  const plugTopY = mdToY(plug.topMD);
  const plugBotY = mdToY(plug.bottomMD);
  const fluidColor = (fluid: string) => COLORS[fluid as FluidKey] || COLORS.mud;

  const legendMap = new Map<string, string>();
  legendMap.set(wellFluid.name, COLORS.mud);
  legendMap.set(cement.name, COLORS.cement);
  legendMap.set(spacer.name, COLORS.spacer);
  if (inputs.useViscousPad && inputs.viscousPadFluid) legendMap.set(inputs.viscousPadFluid.name, COLORS.viscousPad);
  legendMap.set("Продавка", COLORS.displacement);

  const totalTime = frames[maxIndex]?.timeMin || 1;
  const progressPct = (frame.timeMin / totalTime) * 100;

  const activeTimelineIndex = timeline.findIndex((item) => frame.timeMin >= item.startMin - EPS && frame.timeMin <= item.endMin + EPS);

  const arrowPositions = frame.pipeTipMD > 1
    ? [0.2, 0.45, 0.7].map((ratio) => topY + (tipY - topY) * ratio)
    : [];

  return (
    <div className="space-y-3">
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
            <Button variant="outline" size="sm" onClick={() => setSpeedIdx((prev) => (prev + 1) % SPEED_OPTIONS.length)} className="gap-1">
              <FastForward className="w-4 h-4" /> ×{speed}
            </Button>
            <div className="flex-1 min-w-[180px]">
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
            <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
              {frame.timeMin.toFixed(1)} / {totalTime.toFixed(1)} мин
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Анимация установки цементного моста</CardTitle>
          </CardHeader>
          <CardContent>
            <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full max-w-[340px] mx-auto" style={{ height: svgH }}>
              <defs>
                <pattern id="cp-hatch" patternUnits="userSpaceOnUse" width="6" height="6">
                  <path d="M0 6L6 0" stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.3" />
                </pattern>
              </defs>

              <line x1="0" y1={topY} x2={svgW} y2={topY} stroke="hsl(var(--border))" strokeWidth="2" />
              <text x={cx} y={topY - 6} textAnchor="middle" className="text-[8px] fill-muted-foreground">
                Устье (0 м)
              </text>

              <rect x={cx - pipeW - annW - wallW} y={topY} width={wallW} height={botY - topY} fill="hsl(var(--border))" opacity="0.4" />
              <rect x={cx + pipeW + annW} y={topY} width={wallW} height={botY - topY} fill="hsl(var(--border))" opacity="0.4" />

              {isOpenHole && shoeY < botY && (
                <>
                  <rect x={cx - pipeW - annW - wallW} y={shoeY} width={wallW} height={botY - shoeY} fill="url(#cp-hatch)" />
                  <rect x={cx + pipeW + annW} y={shoeY} width={wallW} height={botY - shoeY} fill="url(#cp-hatch)" />
                </>
              )}

              {frame.belowPipeSegs.map((segment, index) => {
                const y1 = mdToY(segment.topMD);
                const y2 = mdToY(segment.botMD);
                if (y2 - y1 < 0.5) return null;
                return (
                  <g key={`below-${index}`}>
                    <rect
                      x={cx - pipeW - annW}
                      y={y1}
                      width={2 * (pipeW + annW)}
                      height={y2 - y1}
                      fill={fluidColor(segment.fluid)}
                      opacity={0.72}
                    />
                    {y2 - y1 > 18 && segment.fluid !== "mud" && (
                      <>
                        <text x={4} y={(y1 + y2) / 2 - 3} className="text-[6px] fill-foreground" style={{ fontWeight: 700 }}>
                          {segment.label.length > 18 ? `${segment.label.slice(0, 18)}…` : segment.label}
                        </text>
                        <text x={4} y={(y1 + y2) / 2 + 5} className="text-[5px] fill-muted-foreground">
                          {segment.topMD.toFixed(0)}–{segment.botMD.toFixed(0)} м
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

              {frame.annSegs.map((segment, index) => {
                const y1 = mdToY(segment.topMD);
                const y2 = mdToY(segment.botMD);
                if (y2 - y1 < 0.5) return null;
                return (
                  <g key={`ann-${index}`}>
                    <rect x={cx - pipeW - annW} y={y1} width={annW} height={y2 - y1} fill={fluidColor(segment.fluid)} opacity={0.86} />
                    <rect x={cx + pipeW} y={y1} width={annW} height={y2 - y1} fill={fluidColor(segment.fluid)} opacity={0.86} />
                    {y2 - y1 > 16 && segment.fluid !== "mud" && (
                      <>
                        <text x={cx + pipeW + annW + wallW + 10} y={(y1 + y2) / 2 - 3} className="text-[6px] fill-foreground" style={{ fontWeight: 700 }}>
                          {segment.label.length > 18 ? `${segment.label.slice(0, 18)}…` : segment.label}
                        </text>
                        <text x={cx + pipeW + annW + wallW + 10} y={(y1 + y2) / 2 + 5} className="text-[5px] fill-muted-foreground">
                          {segment.topMD.toFixed(0)}–{segment.botMD.toFixed(0)} м
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

              {frame.pipeTipMD > 0.5 && (
                <>
                  <rect x={cx - pipeW} y={topY} width={3} height={tipY - topY} fill="hsl(var(--foreground))" opacity="0.6" rx="1" />
                  <rect x={cx + pipeW - 3} y={topY} width={3} height={tipY - topY} fill="hsl(var(--foreground))" opacity="0.6" rx="1" />
                </>
              )}

              {frame.pipeSegs.map((segment, index) => {
                const y1 = mdToY(segment.topMD);
                const y2 = mdToY(segment.botMD);
                if (y2 - y1 < 0.5) return null;
                return (
                  <g key={`pipe-${index}`}>
                    <rect
                      x={cx - pipeW + 3}
                      y={y1}
                      width={2 * pipeW - 6}
                      height={y2 - y1}
                      fill={fluidColor(segment.fluid)}
                      opacity={0.9}
                    />
                    {y2 - y1 > 14 && (
                      <>
                        <text x={cx} y={(y1 + y2) / 2 - 1} textAnchor="middle" className="text-[6px] fill-background" style={{ fontWeight: 700 }}>
                          {segment.label.length > 12 ? `${segment.label.slice(0, 12)}…` : segment.label}
                        </text>
                        <text x={cx} y={(y1 + y2) / 2 + 7} textAnchor="middle" className="text-[5px] fill-background">
                          {segment.volumeM3.toFixed(2)} м³
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

              {frame.flowMode === "down_pipe" && arrowPositions.map((y, index) => (
                <g key={`flow-pipe-${index}`}>
                  <text x={cx} y={y} textAnchor="middle" className="text-[10px] fill-primary">↓</text>
                  <text x={cx - pipeW - annW / 2} y={y} textAnchor="middle" className="text-[10px] fill-primary">↑</text>
                  <text x={cx + pipeW + annW / 2} y={y} textAnchor="middle" className="text-[10px] fill-primary">↑</text>
                </g>
              ))}

              {frame.flowMode === "down_annulus" && arrowPositions.map((y, index) => (
                <g key={`flow-ann-${index}`}>
                  <text x={cx} y={y} textAnchor="middle" className="text-[10px] fill-primary">↑</text>
                  <text x={cx - pipeW - annW / 2} y={y} textAnchor="middle" className="text-[10px] fill-primary">↓</text>
                  <text x={cx + pipeW + annW / 2} y={y} textAnchor="middle" className="text-[10px] fill-primary">↓</text>
                </g>
              ))}

              {(frame.flowMode === "trip_up" || frame.flowMode === "trip_down") && frame.pipeTipMD > 1 && (
                <text x={cx + pipeW + annW + 8} y={tipY - 4} className="text-[12px] fill-primary">
                  {frame.flowMode === "trip_up" ? "↑" : "↓"}
                </text>
              )}

              {shoeMD > 0 && shoeMD < wellDepth && (
                <>
                  <line
                    x1={cx - pipeW - annW - wallW - 8}
                    y1={shoeY}
                    x2={cx + pipeW + annW + wallW + 8}
                    y2={shoeY}
                    stroke="hsl(var(--primary))"
                    strokeWidth="1"
                    strokeDasharray="3 2"
                  />
                  <text x={cx + pipeW + annW + wallW + 10} y={shoeY + 3} className="text-[7px] fill-primary" fontWeight="bold">
                    Башмак {shoeMD.toFixed(0)}м
                  </text>
                </>
              )}

              <line x1={cx - pipeW - annW - wallW - 4} y1={plugTopY} x2={cx + pipeW + annW + wallW + 4} y2={plugTopY} stroke="hsl(var(--destructive))" strokeWidth="0.8" strokeDasharray="2 2" />
              <line x1={cx - pipeW - annW - wallW - 4} y1={plugBotY} x2={cx + pipeW + annW + wallW + 4} y2={plugBotY} stroke="hsl(var(--destructive))" strokeWidth="0.8" strokeDasharray="2 2" />
              <text x={2} y={plugTopY - 2} className="text-[6px] fill-destructive">Кровля {plug.topMD.toFixed(0)}м</text>
              <text x={2} y={plugBotY + 8} className="text-[6px] fill-destructive">Подошва {plug.bottomMD.toFixed(0)}м</text>

              {frame.pipeTipMD > 1 && (
                <text x={cx} y={tipY + 12} textAnchor="middle" className="text-[7px] fill-foreground" fontWeight="bold">
                  ▼ {frame.pipeTipMD.toFixed(0)} м
                </text>
              )}

              <text x={cx} y={botY + 14} textAnchor="middle" className="text-[7px] fill-muted-foreground">
                Забой {wellDepth.toFixed(0)} м
              </text>
            </svg>

            <div className="flex flex-wrap gap-3 mt-2 justify-center">
              {Array.from(legendMap.entries()).map(([label, color]) => (
                <div key={label} className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                  <span className="text-[10px] text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Параметры</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-accent/30 rounded-lg p-3 space-y-2">
              <div className="text-xs font-bold text-primary">{frame.stage}</div>
              <InfoRow label="Режим" value={modeLabel(frame.flowMode)} />
              <InfoRow label="Время" value={`${frame.timeMin.toFixed(1)} мин`} />
              <InfoRow label="Глубина инстр." value={`${frame.pipeTipMD.toFixed(1)} м`} />
              <InfoRow label="Расход" value={frame.pumpRateLs > 0 ? `${frame.pumpRateLs.toFixed(1)} л/с` : "—"} />
              <InfoRow label="Объём закачан" value={`${frame.volumeM3.toFixed(3)} м³`} />
              <div className="pt-1 text-[10px] leading-4 text-muted-foreground">{frame.stageDescription}</div>
            </div>

            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Трубное пространство</div>
              {frame.pipeSegs.filter((segment) => segment.botMD - segment.topMD > 0.5).map((segment, index) => (
                <div key={index} className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: fluidColor(segment.fluid) }} />
                  <span className="text-muted-foreground truncate">{segment.label}</span>
                  <span className="ml-auto font-mono">{segment.topMD.toFixed(0)}–{segment.botMD.toFixed(0)}м</span>
                </div>
              ))}
            </div>

            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Затрубье</div>
              {frame.annSegs.filter((segment) => segment.botMD - segment.topMD > 0.5).map((segment, index) => (
                <div key={index} className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: fluidColor(segment.fluid) }} />
                  <span className="text-muted-foreground truncate">{segment.label}</span>
                  <span className="ml-auto font-mono">{segment.topMD.toFixed(0)}–{segment.botMD.toFixed(0)}м</span>
                </div>
              ))}
            </div>

            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Ниже инструмента</div>
              {frame.belowPipeSegs.filter((segment) => segment.botMD - segment.topMD > 0.5).map((segment, index) => (
                <div key={index} className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: fluidColor(segment.fluid) }} />
                  <span className="text-muted-foreground truncate">{segment.label}</span>
                  <span className="ml-auto font-mono">{segment.topMD.toFixed(0)}–{segment.botMD.toFixed(0)}м</span>
                </div>
              ))}
            </div>

            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Хронометраж</div>
              {timeline.map((item, index) => {
                const isActive = index === activeTimelineIndex;
                const isDone = frame.timeMin > item.endMin + EPS;
                return (
                  <div key={index} className={`flex items-center gap-1.5 text-[9px] py-0.5 ${isActive ? "text-primary font-bold" : isDone ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                    <span>{isDone ? "✅" : isActive ? "▶" : "○"}</span>
                    <span className="truncate">{item.name}</span>
                    <span className="ml-auto font-mono">{item.startMin.toFixed(1)}–{item.endMin.toFixed(1)}'</span>
                  </div>
                );
              })}
            </div>

            <div>
              <div className="text-[10px] text-muted-foreground mb-1">Прогресс операции</div>
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium text-right">{value}</span>
    </div>
  );
}
