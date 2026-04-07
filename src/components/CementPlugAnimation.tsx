import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, RotateCcw, FastForward } from "lucide-react";
import type { PlugInputs, PlugResults, FluidColumn } from "@/lib/cement-plug-calculations";

interface Props {
  inputs: PlugInputs;
  results: PlugResults;
}

type FluidKey = "mud" | "spacer" | "cement" | "displacement" | "viscousPad";

interface DepthSeg {
  fluid: FluidKey;
  label: string;
  topMD: number;
  botMD: number;
}

interface Frame {
  timeMin: number;
  stage: string;
  desc: string;
  pipeTipMD: number;
  wellSegs: DepthSeg[];
  pipeSegs: DepthSeg[];
  rateLs: number;
  cumVol: number;
  washDir: "direct" | "reverse" | null;
}

const COLORS: Record<FluidKey, string> = {
  mud: "hsl(30 40% 42%)",
  spacer: "hsl(198 68% 56%)",
  cement: "hsl(210 14% 42%)",
  displacement: "hsl(118 28% 42%)",
  viscousPad: "hsl(280 46% 50%)",
};

const SPEED_OPTIONS = [1, 2, 5, 10];
const EPS = 1e-6;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function segLength(seg: DepthSeg) {
  return Math.max(0, seg.botMD - seg.topMD);
}

function mergeSegments(segments: DepthSeg[]): DepthSeg[] {
  const sorted = [...segments]
    .filter((segment) => segLength(segment) > EPS)
    .sort((a, b) => a.topMD - b.topMD);

  const merged: DepthSeg[] = [];
  for (const segment of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.fluid === segment.fluid &&
      last.label === segment.label &&
      Math.abs(last.botMD - segment.topMD) <= EPS
    ) {
      last.botMD = segment.botMD;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

function ensureMudCoverage(segments: DepthSeg[], totalDepth: number, mudLabel: string): DepthSeg[] {
  const merged = mergeSegments(segments.filter((segment) => segment.fluid !== "mud"));
  const covered: DepthSeg[] = [];
  let cursor = 0;

  for (const segment of merged) {
    if (segment.topMD > cursor + EPS) {
      covered.push({ fluid: "mud", label: mudLabel, topMD: cursor, botMD: segment.topMD });
    }
    covered.push(segment);
    cursor = segment.botMD;
  }

  if (cursor < totalDepth - EPS) {
    covered.push({ fluid: "mud", label: mudLabel, topMD: cursor, botMD: totalDepth });
  }

  return mergeSegments(covered);
}

function clipSegments(segments: DepthSeg[], topMD: number, botMD: number): DepthSeg[] {
  return mergeSegments(
    segments
      .map((segment) => ({
        ...segment,
        topMD: Math.max(topMD, segment.topMD),
        botMD: Math.min(botMD, segment.botMD),
      }))
      .filter((segment) => segLength(segment) > EPS),
  );
}

function clipPipeSegments(staticSegs: DepthSeg[], tipMD: number, mudLabel: string): DepthSeg[] {
  if (tipMD <= EPS) return [];
  return ensureMudCoverage(clipSegments(staticSegs, 0, tipMD), tipMD, mudLabel);
}

function buildMudPipe(tipMD: number, mudLabel: string): DepthSeg[] {
  if (tipMD <= EPS) return [];
  return [{ fluid: "mud", label: mudLabel, topMD: 0, botMD: tipMD }];
}

function revealSegmentsFromBottom(segments: DepthSeg[], progress: number): DepthSeg[] {
  const fraction = clamp01(progress);
  const ordered = [...segments]
    .filter((segment) => segLength(segment) > EPS)
    .sort((a, b) => b.botMD - a.botMD);

  const totalLength = ordered.reduce((sum, segment) => sum + segLength(segment), 0);
  let remaining = totalLength * fraction;
  const revealed: DepthSeg[] = [];

  for (const segment of ordered) {
    if (remaining <= EPS) break;
    const length = segLength(segment);
    const used = Math.min(length, remaining);
    if (used > EPS) {
      revealed.push({
        fluid: segment.fluid,
        label: segment.label,
        topMD: segment.botMD - used,
        botMD: segment.botMD,
      });
      remaining -= used;
    }
  }

  return mergeSegments(revealed);
}

function washPipeSegments(
  sourceSegs: DepthSeg[],
  tipMD: number,
  progress: number,
  direction: "direct" | "reverse",
  mudLabel: string,
): DepthSeg[] {
  if (tipMD <= EPS) return [];

  const cleanedLength = tipMD * clamp01(progress);
  const source = clipPipeSegments(sourceSegs, tipMD, mudLabel).filter((segment) => segment.fluid !== "mud");

  if (cleanedLength <= EPS) return clipPipeSegments(sourceSegs, tipMD, mudLabel);
  if (cleanedLength >= tipMD - EPS) return buildMudPipe(tipMD, mudLabel);

  const untouched = direction === "direct"
    ? clipSegments(source, cleanedLength, tipMD)
    : clipSegments(source, 0, tipMD - cleanedLength);

  const mudSeg = direction === "direct"
    ? { fluid: "mud" as const, label: mudLabel, topMD: 0, botMD: cleanedLength }
    : { fluid: "mud" as const, label: mudLabel, topMD: tipMD - cleanedLength, botMD: tipMD };

  return ensureMudCoverage([...untouched, mudSeg], tipMD, mudLabel);
}

function fluidKeyFromColumn(column: FluidColumn): FluidKey {
  const label = column.label.toLowerCase();
  if (column.color === "#AB47BC" || /вязк|пачк/.test(label)) return "viscousPad";
  if (column.color === "#B0BEC5" || /цемент/.test(label)) return "cement";
  if (column.color === "#4FC3F7" || /буфер/.test(label)) return "spacer";
  return "mud";
}

function buildStaticSegmentsFromColumns(columns: FluidColumn[], totalDepth: number, mudLabel: string): DepthSeg[] {
  const mapped = columns.map((column) => ({
    fluid: fluidKeyFromColumn(column),
    label: column.label,
    topMD: column.topMD,
    botMD: column.bottomMD,
  }));
  return ensureMudCoverage(mapped, totalDepth, mudLabel);
}

function splitWellSegmentsForTip(segments: DepthSeg[], tipMD: number) {
  const annulusSegs: DepthSeg[] = [];
  const openSegs: DepthSeg[] = [];

  for (const segment of segments) {
    if (segment.botMD <= tipMD + EPS) {
      annulusSegs.push(segment);
      continue;
    }
    if (segment.topMD >= tipMD - EPS) {
      openSegs.push(segment);
      continue;
    }

    annulusSegs.push({ ...segment, botMD: tipMD });
    openSegs.push({ ...segment, topMD: tipMD });
  }

  return {
    annulusSegs: mergeSegments(annulusSegs),
    openSegs: mergeSegments(openSegs),
  };
}

export default function CementPlugAnimation({ inputs, results }: Props) {
  const { well, plug, cement, spacer, wellFluid } = inputs;
  const wellDepth = well.wellDepthMD;
  const padHeight = results.spacerBelowHeightAnnMD || 0;
  const spacerAboveHeight = results.spacerAboveHeightAnnMD || 0;
  const usePad = Boolean(inputs.useViscousPad && padHeight > EPS);
  const padLabel = inputs.viscousPadFluid?.name || spacer.name;
  const initialRunDepth = usePad ? Math.min(wellDepth, plug.bottomMD + padHeight) : plug.bottomMD;
  const padPullUpMD = usePad ? (results.padPullUpMD ?? Math.max(0, plug.bottomMD - 5)) : plug.bottomMD;
  const pullOutMD = results.pullOutDepthMD;

  const viewMargin = 500;
  const viewTop = Math.max(
    0,
    Math.min(plug.topMD - spacerAboveHeight, padPullUpMD, pullOutMD) - viewMargin,
  );
  const viewBot = Math.min(wellDepth, Math.max(initialRunDepth, plug.bottomMD + padHeight) + viewMargin);

  const mudWell = useMemo(
    () => ensureMudCoverage([], wellDepth, wellFluid.name),
    [wellDepth, wellFluid.name],
  );

  const padWellStatic = useMemo(() => {
    if (!usePad) return mudWell;
    return ensureMudCoverage(
      [{ fluid: "viscousPad", label: padLabel, topMD: plug.bottomMD, botMD: Math.min(wellDepth, plug.bottomMD + padHeight) }],
      wellDepth,
      wellFluid.name,
    );
  }, [mudWell, padHeight, padLabel, plug.bottomMD, usePad, wellDepth, wellFluid.name]);

  const padPipeStatic = useMemo(() => {
    if (!usePad) return buildMudPipe(initialRunDepth, wellFluid.name);
    return ensureMudCoverage(
      [{ fluid: "viscousPad", label: padLabel, topMD: plug.bottomMD, botMD: initialRunDepth }],
      initialRunDepth,
      wellFluid.name,
    );
  }, [initialRunDepth, padLabel, plug.bottomMD, usePad, wellFluid.name]);

  const finalWell = useMemo(
    () => buildStaticSegmentsFromColumns(results.fluidColumns.filter((column) => column.location === "annulus"), wellDepth, wellFluid.name),
    [results.fluidColumns, wellDepth, wellFluid.name],
  );

  const finalPipeStatic = useMemo(
    () => buildStaticSegmentsFromColumns(results.fluidColumns.filter((column) => column.location === "pipe"), wellDepth, wellFluid.name),
    [results.fluidColumns, wellDepth, wellFluid.name],
  );

  const finalPipeAtPlug = useMemo(
    () => clipPipeSegments(finalPipeStatic, plug.bottomMD, wellFluid.name),
    [finalPipeStatic, plug.bottomMD, wellFluid.name],
  );

  const upperSpacerWellSegs = useMemo(
    () => finalWell.filter((segment) => segment.fluid === "spacer"),
    [finalWell],
  );
  const cementWellSegs = useMemo(
    () => finalWell.filter((segment) => segment.fluid === "cement"),
    [finalWell],
  );
  const padWellSegs = useMemo(
    () => finalWell.filter((segment) => segment.fluid === "viscousPad"),
    [finalWell],
  );

  const cementPipeSegs = useMemo(
    () => finalPipeAtPlug.filter((segment) => segment.fluid === "cement"),
    [finalPipeAtPlug],
  );
  const upperSpacerPipeSegs = useMemo(
    () => finalPipeAtPlug.filter((segment) => segment.fluid === "spacer"),
    [finalPipeAtPlug],
  );

  const buildPadPipeProgress = useCallback((progress: number) => {
    if (!usePad) return buildMudPipe(initialRunDepth, wellFluid.name);
    const filled = padHeight * clamp01(progress);
    return ensureMudCoverage(
      filled > EPS
        ? [{ fluid: "viscousPad", label: padLabel, topMD: initialRunDepth - filled, botMD: initialRunDepth }]
        : [],
      initialRunDepth,
      wellFluid.name,
    );
  }, [initialRunDepth, padHeight, padLabel, usePad, wellFluid.name]);

  const buildPadWellProgress = useCallback((progress: number) => {
    if (!usePad) return mudWell;
    const filled = padHeight * clamp01(progress);
    return ensureMudCoverage(
      filled > EPS
        ? [{ fluid: "viscousPad", label: padLabel, topMD: plug.bottomMD, botMD: Math.min(wellDepth, plug.bottomMD + filled) }]
        : [],
      wellDepth,
      wellFluid.name,
    );
  }, [mudWell, padHeight, padLabel, plug.bottomMD, usePad, wellDepth, wellFluid.name]);

  const buildMainWellLayout = useCallback((bufferProgress: number, cementProgress: number, finalized: boolean) => {
    if (finalized) return finalWell;
    return ensureMudCoverage(
      [
        ...padWellSegs,
        ...revealSegmentsFromBottom(upperSpacerWellSegs, bufferProgress),
        ...revealSegmentsFromBottom(cementWellSegs, cementProgress),
      ],
      wellDepth,
      wellFluid.name,
    );
  }, [cementWellSegs, finalWell, padWellSegs, upperSpacerWellSegs, wellDepth, wellFluid.name]);

  const buildMainPipeLayout = useCallback((cementProgress: number, spacerProgress: number, finalized: boolean) => {
    if (finalized) return finalPipeAtPlug;
    return ensureMudCoverage(
      [
        ...revealSegmentsFromBottom(cementPipeSegs, cementProgress),
        ...revealSegmentsFromBottom(upperSpacerPipeSegs, spacerProgress),
      ],
      plug.bottomMD,
      wellFluid.name,
    );
  }, [cementPipeSegs, finalPipeAtPlug, plug.bottomMD, upperSpacerPipeSegs, wellFluid.name]);

  const simulation = useMemo(() => {
    const frames: Frame[] = [];
    let t = 0;
    let cumVol = 0;
    let currentTipMD = 0;

    const tripSpeed = inputs.tripSpeedMs > 0 ? inputs.tripSpeedMs : 0.3;
    const tripInTime = initialRunDepth / tripSpeed / 60;

    const pushFrame = (
      stage: string,
      desc: string,
      wellSegs: DepthSeg[],
      pipeSegs: DepthSeg[],
      rateLs: number,
      washDir: "direct" | "reverse" | null = null,
    ) => {
      frames.push({
        timeMin: t,
        stage,
        desc,
        pipeTipMD: currentTipMD,
        wellSegs,
        pipeSegs,
        rateLs,
        cumVol,
        washDir,
      });
    };

    const tripSteps = Math.max(1, Math.ceil(Math.max(tripInTime, 0.25) / 0.25));
    pushFrame("Спуск инструмента", `Спуск до ${initialRunDepth.toFixed(0)} м`, mudWell, [], 0, null);
    for (let step = 1; step <= tripSteps; step++) {
      const frac = step / tripSteps;
      currentTipMD = initialRunDepth * frac;
      t = tripInTime * frac;
      pushFrame(
        "Спуск инструмента",
        `Спуск до ${initialRunDepth.toFixed(0)} м`,
        mudWell,
        buildMudPipe(currentTipMD, wellFluid.name),
        0,
        null,
      );
    }

    const runStage = (
      stageName: string,
      stageDesc: string,
      stageTime: number,
      stageVol: number,
      render: (progress: number) => {
        wellSegs: DepthSeg[];
        pipeSegs: DepthSeg[];
        pipeTipMD?: number;
        washDir?: "direct" | "reverse" | null;
      },
    ) => {
      const startTime = t;
      const startCum = cumVol;
      const stepCount = stageTime > EPS ? Math.max(1, Math.ceil(stageTime / 0.25)) : 1;
      const rateLs = stageVol > EPS && stageTime > EPS ? (stageVol * 1000) / (stageTime * 60) : 0;

      for (let step = 1; step <= stepCount; step++) {
        const frac = stageTime > EPS ? step / stepCount : 1;
        const state = render(frac);
        if (state.pipeTipMD !== undefined) currentTipMD = state.pipeTipMD;
        t = startTime + stageTime * frac;
        cumVol = startCum + stageVol * frac;
        pushFrame(stageName, stageDesc, state.wellSegs, state.pipeSegs, rateLs, state.washDir ?? null);
      }
    };

    for (const stage of results.pumpingStages) {
      const lowerName = stage.name.toLowerCase();
      const stageTime = Math.max(stage.timeMin, 0);
      const stageVol = Math.max(stage.volumeM3, 0);

      if (lowerName.includes("закачка вязкой пачки")) {
        runStage(stage.name, stage.description, stageTime, stageVol, (progress) => ({
          pipeTipMD: initialRunDepth,
          wellSegs: mudWell,
          pipeSegs: buildPadPipeProgress(progress),
        }));
        continue;
      }

      if (lowerName.includes("продавка вязкой пачки")) {
        runStage(stage.name, stage.description, stageTime, stageVol, (progress) => ({
          pipeTipMD: initialRunDepth,
          wellSegs: buildPadWellProgress(progress),
          pipeSegs: buildPadPipeProgress(1),
        }));
        continue;
      }

      if (lowerName.includes("подъём над пачкой")) {
        runStage(stage.name, stage.description, stageTime, stageVol, (progress) => {
          const tip = initialRunDepth + (padPullUpMD - initialRunDepth) * progress;
          return {
            pipeTipMD: tip,
            wellSegs: padWellStatic,
            pipeSegs: clipPipeSegments(padPipeStatic, tip, wellFluid.name),
          };
        });
        continue;
      }

      if (lowerName.includes("обратная промывка")) {
        const sourcePipe = clipPipeSegments(padPipeStatic, padPullUpMD, wellFluid.name);
        runStage(stage.name, stage.description, stageTime, stageVol, (progress) => ({
          pipeTipMD: padPullUpMD,
          wellSegs: padWellStatic,
          pipeSegs: washPipeSegments(sourcePipe, padPullUpMD, progress, "reverse", wellFluid.name),
          washDir: "reverse",
        }));
        continue;
      }

      if (lowerName.includes("спуск на кровлю пачки")) {
        runStage(stage.name, stage.description, stageTime, stageVol, (progress) => {
          const tip = padPullUpMD + (plug.bottomMD - padPullUpMD) * progress;
          return {
            pipeTipMD: tip,
            wellSegs: padWellStatic,
            pipeSegs: buildMudPipe(tip, wellFluid.name),
          };
        });
        continue;
      }

      if (lowerName.includes("верхний буфер") && lowerName.includes("затруб")) {
        runStage(stage.name, stage.description, stageTime, stageVol, (progress) => ({
          pipeTipMD: plug.bottomMD,
          wellSegs: buildMainWellLayout(progress, 0, false),
          pipeSegs: buildMudPipe(plug.bottomMD, wellFluid.name),
        }));
        continue;
      }

      if (lowerName.includes("цемент")) {
        runStage(stage.name, stage.description, stageTime, stageVol, (progress) => ({
          pipeTipMD: plug.bottomMD,
          wellSegs: buildMainWellLayout(1, progress, false),
          pipeSegs: buildMainPipeLayout(progress, 0, false),
        }));
        continue;
      }

      if (lowerName.includes("верхний буфер") && lowerName.includes("труб")) {
        runStage(stage.name, stage.description, stageTime, stageVol, (progress) => ({
          pipeTipMD: plug.bottomMD,
          wellSegs: buildMainWellLayout(1, 1, false),
          pipeSegs: buildMainPipeLayout(1, progress, false),
        }));
        continue;
      }

      if (lowerName.includes("продавка")) {
        runStage(stage.name, stage.description, stageTime, stageVol, (progress) => ({
          pipeTipMD: plug.bottomMD,
          wellSegs: finalWell,
          pipeSegs: progress < 0.4 ? buildMainPipeLayout(1, 1, false) : finalPipeAtPlug,
        }));
        continue;
      }

      if (lowerName.includes("подъём инструмента")) {
        runStage(stage.name, stage.description, stageTime, stageVol, (progress) => {
          const tip = plug.bottomMD + (pullOutMD - plug.bottomMD) * progress;
          return {
            pipeTipMD: tip,
            wellSegs: finalWell,
            pipeSegs: buildMudPipe(tip, wellFluid.name),
          };
        });
        continue;
      }

      if (lowerName.includes("промывка")) {
        const washDir = lowerName.includes("обрат") || results.washType === "reverse" ? "reverse" : "direct";
        const sourcePipe = clipPipeSegments(finalPipeAtPlug, pullOutMD, wellFluid.name);
        runStage(stage.name, stage.description, stageTime, stageVol, (progress) => ({
          pipeTipMD: pullOutMD,
          wellSegs: finalWell,
          pipeSegs: washPipeSegments(sourcePipe, pullOutMD, progress, washDir, wellFluid.name),
          washDir,
        }));
        continue;
      }

      runStage(stage.name, stage.description, stageTime, stageVol, () => ({
        pipeTipMD: currentTipMD,
        wellSegs: finalWell,
        pipeSegs: clipPipeSegments(finalPipeAtPlug, currentTipMD || plug.bottomMD, wellFluid.name),
      }));
    }

    if (frames.length === 0) {
      pushFrame("Нет данных", "Нет расчётных стадий", mudWell, [], 0, null);
    }

    return frames;
  }, [
    buildMainPipeLayout,
    buildMainWellLayout,
    buildPadPipeProgress,
    buildPadWellProgress,
    finalPipeAtPlug,
    finalWell,
    initialRunDepth,
    inputs.tripSpeedMs,
    mudWell,
    padPipeStatic,
    padPullUpMD,
    padWellStatic,
    plug.bottomMD,
    pullOutMD,
    results.pumpingStages,
    results.washType,
    wellFluid.name,
  ]);

  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const animRef = useRef<number>(0);
  const lastFrameTime = useRef(0);

  const maxIndex = Math.max(simulation.length - 1, 0);
  const speed = SPEED_OPTIONS[speedIdx];
  const frame = simulation[Math.min(currentIndex, maxIndex)] || simulation[0];

  const animate = useCallback((timestamp: number) => {
    if (!lastFrameTime.current) lastFrameTime.current = timestamp;
    if (timestamp - lastFrameTime.current > 33) {
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

  if (!frame) return null;

  const svgW = 360;
  const svgH = 560;
  const topY = 40;
  const botY = svgH - 28;
  const usableH = botY - topY;
  const cx = svgW / 2 - 22;
  const pipeW = 22;
  const annW = 18;
  const wallW = 5;
  const viewRange = Math.max(viewBot - viewTop, 1);
  const mdToY = (md: number) => topY + ((Math.max(viewTop, Math.min(viewBot, md)) - viewTop) / viewRange) * usableH;
  const tipY = mdToY(frame.pipeTipMD);
  const plugTopY = mdToY(plug.topMD);
  const plugBotY = mdToY(plug.bottomMD);
  const shoeY = mdToY(well.casingShoe);
  const showPipe = frame.pipeTipMD > viewTop + EPS;

  const visibleWell = clipSegments(frame.wellSegs, viewTop, viewBot);
  const { annulusSegs, openSegs } = splitWellSegmentsForTip(visibleWell, frame.pipeTipMD);
  const visiblePipe = clipSegments(frame.pipeSegs, viewTop, Math.min(viewBot, frame.pipeTipMD));

  const fluidColor = (fluid: FluidKey) => COLORS[fluid] || COLORS.mud;
  const totalTime = simulation[maxIndex]?.timeMin || 1;
  const arrowY = Math.max(topY + 24, mdToY(Math.max(viewTop, frame.pipeTipMD - viewRange * 0.25)));

  const timelineStages = useMemo(() => {
    const items: { name: string; startMin: number; endMin: number }[] = [];
    const tripSpeed = inputs.tripSpeedMs > 0 ? inputs.tripSpeedMs : 0.3;
    const tripInTime = initialRunDepth / tripSpeed / 60;
    items.push({ name: "Спуск инструмента", startMin: 0, endMin: tripInTime });
    let cursor = tripInTime;
    for (const stage of results.pumpingStages) {
      items.push({ name: stage.name, startMin: cursor, endMin: cursor + stage.timeMin });
      cursor += stage.timeMin;
    }
    return items;
  }, [initialRunDepth, inputs.tripSpeedMs, results.pumpingStages]);

  const activeIdx = timelineStages.findIndex((item) => frame.timeMin >= item.startMin - EPS && frame.timeMin <= item.endMin + EPS);

  const legendMap = new Map<string, string>();
  legendMap.set(wellFluid.name, COLORS.mud);
  legendMap.set(cement.name, COLORS.cement);
  legendMap.set(spacer.name, COLORS.spacer);
  if (usePad) legendMap.set(padLabel, COLORS.viscousPad);
  legendMap.set("Продавка/промывка", COLORS.displacement);

  const stageWellRows = clipSegments(frame.wellSegs, viewTop, viewBot).filter((segment) => segment.fluid !== "mud");
  const stagePipeRows = clipSegments(frame.pipeSegs, viewTop, Math.min(frame.pipeTipMD, viewBot));

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setPlaying((prev) => !prev)} className="gap-1">
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {playing ? "Пауза" : "Старт"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setPlaying(false); setCurrentIndex(0); }} className="gap-1">
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
            <CardTitle className="text-sm">Анимация установки цементного моста ({viewTop.toFixed(0)}–{viewBot.toFixed(0)} м)</CardTitle>
          </CardHeader>
          <CardContent>
            <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full max-w-[400px] mx-auto" style={{ height: svgH }}>
              {(() => {
                const tickStep = viewRange > 1200 ? 200 : viewRange > 700 ? 100 : viewRange > 300 ? 50 : 20;
                const ticks: number[] = [];
                for (let md = Math.ceil(viewTop / tickStep) * tickStep; md <= viewBot; md += tickStep) ticks.push(md);
                return ticks.map((md) => {
                  const y = mdToY(md);
                  return (
                    <g key={`tick-${md}`}>
                      <line x1={cx - pipeW - annW - wallW - 12} y1={y} x2={cx - pipeW - annW - wallW - 4} y2={y} stroke="hsl(var(--border))" strokeWidth="0.7" />
                      <text x={cx - pipeW - annW - wallW - 14} y={y + 3} textAnchor="end" className="text-[7px] fill-muted-foreground">{md}</text>
                    </g>
                  );
                });
              })()}

              <rect x={cx - pipeW - annW - wallW} y={topY} width={wallW} height={usableH} fill="hsl(var(--muted-foreground) / 0.35)" rx="1" />
              <rect x={cx + pipeW + annW} y={topY} width={wallW} height={usableH} fill="hsl(var(--muted-foreground) / 0.35)" rx="1" />

              {well.casingShoe >= viewTop && well.casingShoe <= viewBot && (
                <>
                  <line x1={cx - pipeW - annW - wallW - 6} y1={shoeY} x2={cx + pipeW + annW + wallW + 6} y2={shoeY} stroke="hsl(var(--primary))" strokeWidth="0.9" strokeDasharray="3 2" />
                  <text x={cx + pipeW + annW + wallW + 8} y={shoeY + 3} className="text-[6px] fill-primary" fontWeight="bold">
                    Башмак {well.casingShoe.toFixed(0)} м
                  </text>
                </>
              )}

              {openSegs.map((segment, index) => {
                const y1 = mdToY(segment.topMD);
                const y2 = mdToY(segment.botMD);
                if (y2 - y1 < 0.5) return null;
                return (
                  <rect
                    key={`open-${index}`}
                    x={cx - pipeW - annW}
                    y={y1}
                    width={2 * (pipeW + annW)}
                    height={y2 - y1}
                    fill={fluidColor(segment.fluid)}
                    opacity={0.55}
                  />
                );
              })}

              {annulusSegs.map((segment, index) => {
                const y1 = mdToY(segment.topMD);
                const y2 = mdToY(segment.botMD);
                if (y2 - y1 < 0.5) return null;
                return (
                  <g key={`ann-${index}`}>
                    <rect x={cx - pipeW - annW} y={y1} width={annW} height={y2 - y1} fill={fluidColor(segment.fluid)} opacity={0.88} />
                    <rect x={cx + pipeW} y={y1} width={annW} height={y2 - y1} fill={fluidColor(segment.fluid)} opacity={0.88} />
                    {segment.fluid !== "mud" && y2 - y1 > 18 && (
                      <>
                        <text x={cx + pipeW + annW + wallW + 8} y={(y1 + y2) / 2 - 2} className="text-[7px] fill-foreground" style={{ fontWeight: 700 }}>
                          {segment.label.length > 16 ? `${segment.label.slice(0, 16)}…` : segment.label}
                        </text>
                        <text x={cx + pipeW + annW + wallW + 8} y={(y1 + y2) / 2 + 7} className="text-[6px] fill-muted-foreground">
                          {segment.topMD.toFixed(0)}–{segment.botMD.toFixed(0)} м
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

              {showPipe && (
                <>
                  <rect x={cx - pipeW} y={topY} width={3} height={Math.max(0, tipY - topY)} fill="hsl(var(--foreground) / 0.7)" rx="1" />
                  <rect x={cx + pipeW - 3} y={topY} width={3} height={Math.max(0, tipY - topY)} fill="hsl(var(--foreground) / 0.7)" rx="1" />
                  {frame.pipeTipMD >= viewTop && frame.pipeTipMD <= viewBot && (
                    <line x1={cx - pipeW} y1={tipY} x2={cx + pipeW} y2={tipY} stroke="hsl(var(--foreground))" strokeWidth="2" opacity="0.8" />
                  )}
                </>
              )}

              {visiblePipe.map((segment, index) => {
                const y1 = mdToY(segment.topMD);
                const y2 = mdToY(segment.botMD);
                if (y2 - y1 < 0.5) return null;
                return (
                  <g key={`pipe-${index}`}>
                    <rect x={cx - pipeW + 3} y={y1} width={2 * pipeW - 6} height={y2 - y1} fill={fluidColor(segment.fluid)} opacity={0.92} />
                    {segment.fluid !== "mud" && y2 - y1 > 16 && (
                      <>
                        <text x={cx} y={(y1 + y2) / 2 - 1} textAnchor="middle" className="text-[6px] fill-background" style={{ fontWeight: 700 }}>
                          {segment.label.length > 10 ? `${segment.label.slice(0, 10)}…` : segment.label}
                        </text>
                        <text x={cx} y={(y1 + y2) / 2 + 8} textAnchor="middle" className="text-[5px] fill-background">
                          {segment.topMD.toFixed(0)}–{segment.botMD.toFixed(0)} м
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

              <line x1={cx - pipeW - annW - wallW - 2} y1={plugTopY} x2={cx + pipeW + annW + wallW + 2} y2={plugTopY} stroke="hsl(var(--destructive))" strokeWidth="0.9" strokeDasharray="3 2" />
              <line x1={cx - pipeW - annW - wallW - 2} y1={plugBotY} x2={cx + pipeW + annW + wallW + 2} y2={plugBotY} stroke="hsl(var(--destructive))" strokeWidth="0.9" strokeDasharray="3 2" />
              <text x={4} y={plugTopY - 2} className="text-[7px] fill-destructive" fontWeight="bold">Кровля {plug.topMD.toFixed(0)} м</text>
              <text x={4} y={plugBotY + 9} className="text-[7px] fill-destructive" fontWeight="bold">Подошва {plug.bottomMD.toFixed(0)} м</text>

              {frame.pipeTipMD >= viewTop && frame.pipeTipMD <= viewBot && (
                <text x={cx} y={tipY + 14} textAnchor="middle" className="text-[8px] fill-foreground" fontWeight="bold">
                  ▼ {frame.pipeTipMD.toFixed(0)} м
                </text>
              )}

              {frame.rateLs > 0 && showPipe && !frame.washDir && (
                <g opacity="0.75">
                  <text x={cx} y={arrowY} textAnchor="middle" className="text-[12px] fill-primary">↓</text>
                  <text x={cx - pipeW - annW / 2} y={arrowY} textAnchor="middle" className="text-[12px] fill-primary">↑</text>
                  <text x={cx + pipeW + annW / 2} y={arrowY} textAnchor="middle" className="text-[12px] fill-primary">↑</text>
                </g>
              )}

              {frame.washDir === "direct" && showPipe && (
                <g opacity="0.75">
                  <text x={cx} y={arrowY} textAnchor="middle" className="text-[12px] fill-primary">↓</text>
                  <text x={cx - pipeW - annW / 2} y={arrowY} textAnchor="middle" className="text-[12px] fill-primary">↑</text>
                  <text x={cx + pipeW + annW / 2} y={arrowY} textAnchor="middle" className="text-[12px] fill-primary">↑</text>
                  <text x={cx + pipeW + annW + wallW + 18} y={arrowY} className="text-[8px] fill-primary" fontWeight="bold">Прямая</text>
                </g>
              )}

              {frame.washDir === "reverse" && showPipe && (
                <g opacity="0.75">
                  <text x={cx} y={arrowY} textAnchor="middle" className="text-[12px] fill-primary">↑</text>
                  <text x={cx - pipeW - annW / 2} y={arrowY} textAnchor="middle" className="text-[12px] fill-primary">↓</text>
                  <text x={cx + pipeW + annW / 2} y={arrowY} textAnchor="middle" className="text-[12px] fill-primary">↓</text>
                  <text x={cx + pipeW + annW + wallW + 18} y={arrowY} className="text-[8px] fill-primary" fontWeight="bold">Обратная</text>
                </g>
              )}

              {frame.rateLs === 0 && !frame.washDir && showPipe && /спуск|подъём/i.test(frame.stage) && (
                <text x={cx + pipeW + 8} y={tipY - 6} className="text-[14px] fill-primary" fontWeight="bold">
                  {/подъём/i.test(frame.stage) ? "↑" : "↓"}
                </text>
              )}

              <text x={cx} y={topY - 6} textAnchor="middle" className="text-[8px] fill-muted-foreground">{viewTop.toFixed(0)} м</text>
              <text x={cx} y={botY + 14} textAnchor="middle" className="text-[8px] fill-muted-foreground">{viewBot.toFixed(0)} м</text>
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
              <InfoRow label="Время" value={`${frame.timeMin.toFixed(1)} мин`} />
              <InfoRow label="Глубина инструм." value={`${frame.pipeTipMD.toFixed(1)} м`} />
              <InfoRow label="Расход" value={frame.rateLs > 0 ? `${frame.rateLs.toFixed(1)} л/с` : "—"} />
              <InfoRow label="Объём закачан" value={`${frame.cumVol.toFixed(3)} м³`} />
              {frame.washDir && <InfoRow label="Направление" value={frame.washDir === "direct" ? "Прямая" : "Обратная"} />}
              <div className="pt-1 text-[10px] leading-4 text-muted-foreground">{frame.desc}</div>
            </div>

            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Растворы в интервале работ</div>
              <div className="space-y-1">
                {stageWellRows.length > 0 ? stageWellRows.map((segment, index) => (
                  <div key={`well-${index}`} className="flex items-center gap-1.5 text-[10px]">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: fluidColor(segment.fluid) }} />
                    <span className="text-muted-foreground truncate">{segment.label}</span>
                    <span className="ml-auto font-mono">{segment.topMD.toFixed(0)}–{segment.botMD.toFixed(0)} м</span>
                  </div>
                )) : <div className="text-[10px] text-muted-foreground">Только скважинная жидкость</div>}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Содержимое трубы</div>
              <div className="space-y-1">
                {stagePipeRows.length > 0 ? stagePipeRows.map((segment, index) => (
                  <div key={`pipe-row-${index}`} className="flex items-center gap-1.5 text-[10px]">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: fluidColor(segment.fluid) }} />
                    <span className="text-muted-foreground truncate">{segment.label}</span>
                    <span className="ml-auto font-mono">{segment.topMD.toFixed(0)}–{segment.botMD.toFixed(0)} м</span>
                  </div>
                )) : <div className="text-[10px] text-muted-foreground">Труба вне окна анимации</div>}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Хронометраж</div>
              {timelineStages.map((item, index) => {
                const isActive = index === activeIdx;
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
              <div className="text-[10px] text-muted-foreground mb-1">Прогресс</div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-100" style={{ width: `${totalTime > 0 ? (frame.timeMin / totalTime) * 100 : 0}%` }} />
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
