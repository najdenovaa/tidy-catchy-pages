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
  pipeSegs: DepthSeg[];
  annSegs: DepthSeg[];
  belowSegs: DepthSeg[];
  rateLs: number;
  cumVol: number;
  washDir: "direct" | "reverse" | null;
}

const COLORS: Record<FluidKey, string> = {
  mud: "hsl(30, 50%, 45%)",
  spacer: "hsl(200, 60%, 55%)",
  cement: "hsl(0, 0%, 58%)",
  displacement: "hsl(120, 40%, 45%)",
  viscousPad: "hsl(280, 50%, 50%)",
};

const SPEED_OPTIONS = [1, 2, 5, 10];
const EPS = 1e-6;

function areaM2(dMm: number) { const d = dMm / 1000; return (Math.PI / 4) * d * d; }

/**
 * Balanced placement model:
 * Fluids pumped down the pipe exit at pipe tip and rise equally in annulus AND pipe.
 * Height of fluid = volume / (annArea + pipeArea).
 *
 * State: a stack of fluid layers from bottom up, each with a height.
 * Both annulus and pipe share the same stack (same boundaries).
 * Above the stack in annulus = mud. Above stack in pipe = displacement/mud.
 */
interface BalancedLayer {
  fluid: FluidKey;
  label: string;
  heightM: number;
}

function cloneStack(s: BalancedLayer[]): BalancedLayer[] {
  return s.map(l => ({ ...l }));
}

export default function CementPlugAnimation({ inputs, results }: Props) {
  const { well, plug, cement, spacer, wellFluid } = inputs;
  const boreDiam = results.boreDiamUsed;
  const pipeEndMD = plug.bottomMD;
  const pullOutMD = results.pullOutDepthMD;
  const wellDepth = well.wellDepthMD;

  const annA = results.annArea || (areaM2(boreDiam) - areaM2(well.pipeOD));
  const pipeA = results.pipeArea || areaM2(well.pipeID);
  const boreA = areaM2(boreDiam);
  const totalA = annA + pipeA;

  // Viewport: plug ± 100m
  const viewMargin = 100;
  const padBelowH = results.spacerBelowHeightAnnMD || 0;
  const spacerAboveH = results.spacerAboveHeightAnnMD || 0;
  const viewTop = Math.max(0, plug.topMD - spacerAboveH - viewMargin);
  const viewBot = Math.min(wellDepth, plug.bottomMD + padBelowH + viewMargin);

  const simulation = useMemo(() => {
    const frames: Frame[] = [];
    let t = 0;
    let cumVol = 0;
    let currentTipMD = 0; // pipe tip starts at surface

    // Balanced stack: layers from bottom up at pipe tip level
    // Initially empty (below pipe tip is all mud)
    let balancedStack: BalancedLayer[] = [];
    // Track what's in pipe above the balanced zone (from surface down to balanced zone top)
    // Initially all mud
    let pipeTopFluid: FluidKey = "mud";
    let pipeTopLabel: string = wellFluid.name;

    function totalStackHeight() {
      return balancedStack.reduce((s, l) => s + l.heightM, 0);
    }

    function buildFrame(stage: string, desc: string, rateLs: number, washDir: "direct" | "reverse" | null = null): Frame {
      const tipMD = currentTipMD;
      const stackH = totalStackHeight();
      const stackTopMD = tipMD - stackH; // balanced zone starts at tipMD - stackH

      // Build annulus segments (from bottom up = last layer is highest)
      const annSegs: DepthSeg[] = [];
      let cursor = tipMD;
      for (const layer of balancedStack) {
        if (layer.heightM < EPS) continue;
        const top = cursor - layer.heightM;
        annSegs.push({ fluid: layer.fluid, label: layer.label, topMD: Math.max(0, top), botMD: cursor });
        cursor = top;
      }
      // Mud above in annulus
      if (cursor > EPS) {
        annSegs.push({ fluid: "mud", label: wellFluid.name, topMD: 0, botMD: cursor });
      }

      // Build pipe segments (from bottom up, same boundaries)
      const pipeSegs: DepthSeg[] = [];
      cursor = tipMD;
      for (const layer of balancedStack) {
        if (layer.heightM < EPS) continue;
        const top = cursor - layer.heightM;
        pipeSegs.push({ fluid: layer.fluid, label: layer.label, topMD: Math.max(0, top), botMD: cursor });
        cursor = top;
      }
      // Above balanced zone in pipe = displacement or mud
      if (cursor > EPS) {
        pipeSegs.push({ fluid: pipeTopFluid, label: pipeTopLabel, topMD: 0, botMD: cursor });
      }

      // Below pipe tip
      const belowSegs: DepthSeg[] = [];
      if (tipMD < wellDepth - 0.5) {
        belowSegs.push({ fluid: "mud", label: wellFluid.name, topMD: tipMD, botMD: wellDepth });
      }

      return {
        timeMin: t, stage, desc, pipeTipMD: tipMD,
        pipeSegs, annSegs, belowSegs,
        rateLs, cumVol, washDir,
      };
    }

    function addBalancedFluid(fluid: FluidKey, label: string, volumeM3: number) {
      if (volumeM3 <= EPS || totalA <= EPS) return;
      const heightM = volumeM3 / totalA;
      // Add to bottom of stack (index 0)
      if (balancedStack.length > 0 && balancedStack[0].fluid === fluid) {
        balancedStack[0].heightM += heightM;
      } else {
        balancedStack.unshift({ fluid, label, heightM });
      }
    }

    const dt = 0.25;

    // ── PHASE 1: Trip in ──
    const tripSpeed = inputs.tripSpeedMs > 0 ? inputs.tripSpeedMs : 0.3;
    const tripInTime = pipeEndMD / tripSpeed / 60;
    const tripInSteps = Math.max(1, Math.ceil(tripInTime / dt));

    frames.push(buildFrame("Спуск инструмента", `Спуск до ${pipeEndMD.toFixed(0)} м`, 0));
    for (let i = 1; i <= tripInSteps; i++) {
      currentTipMD = pipeEndMD * (i / tripInSteps);
      t = tripInTime * (i / tripInSteps);
      frames.push(buildFrame("Спуск инструмента", `Спуск до ${pipeEndMD.toFixed(0)} м`, 0));
    }
    currentTipMD = pipeEndMD;

    // ── PHASE 2: Process pumping stages ──
    for (const stage of results.pumpingStages) {
      const stageTime = Math.max(stage.timeMin, 0);
      const stageVol = Math.max(stage.volumeM3, 0);
      const stageStart = t;

      // Determine fluid
      let fluid: FluidKey = "mud";
      let label = stage.name;
      if (/вязк|пачк/i.test(stage.name)) { fluid = "viscousPad"; label = inputs.viscousPadFluid?.name || "Вязкая пачка"; }
      else if (/цемент/i.test(stage.name)) { fluid = "cement"; label = cement.name; }
      else if (/буфер/i.test(stage.name)) { fluid = "spacer"; label = spacer.name; }
      else if (/продавк/i.test(stage.name)) { fluid = "displacement"; label = "Продавка"; }
      else if (/промывк/i.test(stage.name) || /промыв/i.test(stage.name)) { fluid = "mud"; label = wellFluid.name; }

      const isTrip = /подъём|спуск/i.test(stage.name);
      const isWash = /промывк|промыв/i.test(stage.name) && !isTrip;
      const isReverse = /обратн/i.test(stage.name);

      if (isTrip) {
        // Trip operation
        const isTripUp = /подъём/i.test(stage.name);
        let toMD = currentTipMD;
        if (/над пачк/i.test(stage.name)) {
          toMD = results.padPullUpMD || Math.max(0, pipeEndMD - 5);
        } else if (/кровл/i.test(stage.name) || /подошв/i.test(stage.name)) {
          toMD = pipeEndMD;
        } else if (isTripUp) {
          toMD = pullOutMD;
        }

        const fromMD = currentTipMD;
        const steps = Math.max(1, Math.ceil(stageTime / dt));
        for (let s = 1; s <= steps; s++) {
          const frac = s / steps;
          currentTipMD = fromMD + (toMD - fromMD) * frac;
          t = stageStart + stageTime * frac;
          // When pulling up, we leave the balanced stack in place (fluids stay)
          // The pipe tip moves but the balanced zone stays anchored at its depths
          frames.push(buildFrame(stage.name, stage.description, 0));
        }
        continue;
      }

      if (isWash) {
        // Wash operation — show direction arrows
        if (stageTime <= EPS) continue;
        const steps = Math.max(1, Math.ceil(stageTime / dt));
        const dVol = stageVol / steps;
        const rateLs = stageVol > 0 && stageTime > 0 ? (stageVol * 1000) / (stageTime * 60) : 0;
        const washType = isReverse || results.washType === "reverse" ? "reverse" as const : "direct" as const;

        for (let s = 1; s <= steps; s++) {
          t = stageStart + stageTime * (s / steps);
          cumVol += dVol;
          frames.push(buildFrame(stage.name, stage.description, rateLs, washType));
        }
        continue;
      }

      if (isReverse) {
        // Reverse flush (for viscous pad cleanup)
        if (stageTime <= EPS) continue;
        const steps = Math.max(1, Math.ceil(stageTime / dt));
        const dVol = stageVol / steps;
        const rateLs = stageVol > 0 && stageTime > 0 ? (stageVol * 1000) / (stageTime * 60) : 0;

        for (let s = 1; s <= steps; s++) {
          t = stageStart + stageTime * (s / steps);
          cumVol += dVol;
          frames.push(buildFrame(stage.name, stage.description, rateLs, "reverse"));
        }
        continue;
      }

      // Normal pumping: balanced placement
      if (stageVol <= EPS || stageTime <= EPS) {
        frames.push(buildFrame(stage.name, stage.description, 0));
        continue;
      }

      const steps = Math.max(1, Math.ceil(stageTime / dt));
      const dVol = stageVol / steps;
      const rateLs = (stageVol * 1000) / (stageTime * 60);

      // "Продавка" pushes displacement fluid from surface, which pushes balanced zone down
      if (/продавк/i.test(stage.name) && !/вязк/i.test(stage.name)) {
        pipeTopFluid = "displacement";
        pipeTopLabel = label;
        for (let s = 1; s <= steps; s++) {
          // Don't add to balanced stack — displacement just pushes everything down
          t = stageStart + stageTime * (s / steps);
          cumVol += dVol;
          frames.push(buildFrame(stage.name, stage.description, rateLs));
        }
        continue;
      }

      for (let s = 1; s <= steps; s++) {
        addBalancedFluid(fluid, label, dVol);
        t = stageStart + stageTime * (s / steps);
        cumVol += dVol;
        frames.push(buildFrame(stage.name, stage.description, rateLs));
      }
    }

    return frames;
  }, [inputs, results, annA, pipeA, totalA, boreA, pipeEndMD, pullOutMD, wellDepth, wellFluid, cement, spacer]);

  // Playback
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const animRef = useRef<number>(0);
  const lastFrameTime = useRef(0);

  const maxIndex = Math.max(simulation.length - 1, 0);
  const speed = SPEED_OPTIONS[speedIdx];
  const frame = simulation[Math.min(currentIndex, maxIndex)] || simulation[0];

  const animate = useCallback((ts: number) => {
    if (!lastFrameTime.current) lastFrameTime.current = ts;
    if (ts - lastFrameTime.current > 33) {
      lastFrameTime.current = ts;
      setCurrentIndex(p => { const n = p + speed; if (n >= maxIndex) { setPlaying(false); return maxIndex; } return n; });
    }
    animRef.current = requestAnimationFrame(animate);
  }, [maxIndex, speed]);

  useEffect(() => {
    if (playing) { lastFrameTime.current = 0; animRef.current = requestAnimationFrame(animate); }
    else cancelAnimationFrame(animRef.current);
    return () => cancelAnimationFrame(animRef.current);
  }, [animate, playing]);

  if (!frame) return null;

  // ── SVG ──
  const svgW = 340;
  const svgH = 520;
  const topY = 40;
  const botY = svgH - 25;
  const usableH = botY - topY;
  const cx = svgW / 2 - 20; // shift left for labels
  const pipeW = 20;
  const annW = 16;
  const wallW = 5;
  const viewRange = viewBot - viewTop;

  const mdToY = (md: number) => topY + ((Math.max(viewTop, Math.min(viewBot, md)) - viewTop) / viewRange) * usableH;
  const tipY = mdToY(frame.pipeTipMD);
  const plugTopY = mdToY(plug.topMD);
  const plugBotY = mdToY(plug.bottomMD);
  const shoeY = mdToY(well.casingShoe);

  const fluidColor = (f: string) => COLORS[f as FluidKey] || COLORS.mud;

  // Filter segments to viewport
  const filterSegs = (segs: DepthSeg[]) =>
    segs.filter(s => s.botMD > viewTop && s.topMD < viewBot).map(s => ({
      ...s,
      topMD: Math.max(viewTop, s.topMD),
      botMD: Math.min(viewBot, s.botMD),
    }));

  const visAnn = filterSegs(frame.annSegs);
  const visPipe = filterSegs(frame.pipeSegs);
  const visBelow = filterSegs(frame.belowSegs);

  // Legend
  const legendMap = new Map<string, string>();
  legendMap.set(wellFluid.name, COLORS.mud);
  legendMap.set(cement.name, COLORS.cement);
  legendMap.set(spacer.name, COLORS.spacer);
  if (inputs.useViscousPad && inputs.viscousPadFluid) legendMap.set(inputs.viscousPadFluid.name, COLORS.viscousPad);
  legendMap.set("Продавка", COLORS.displacement);

  const totalTime = simulation[maxIndex]?.timeMin || 1;

  // Flow arrows
  const showPipe = frame.pipeTipMD > viewTop + 1;
  const arrowY1 = Math.max(topY + 15, mdToY(frame.pipeTipMD - viewRange * 0.3));
  const arrowY2 = Math.max(topY + 30, mdToY(frame.pipeTipMD - viewRange * 0.15));

  // Timeline from pumpingStages
  const timelineStages = useMemo(() => {
    const items: { name: string; startMin: number; endMin: number }[] = [];
    // Trip in
    const tripInTime = pipeEndMD / (inputs.tripSpeedMs > 0 ? inputs.tripSpeedMs : 0.3) / 60;
    items.push({ name: "Спуск инструмента", startMin: 0, endMin: tripInTime });
    let cursor = tripInTime;
    for (const s of results.pumpingStages) {
      items.push({ name: s.name, startMin: cursor, endMin: cursor + s.timeMin });
      cursor += s.timeMin;
    }
    return items;
  }, [results.pumpingStages, pipeEndMD, inputs.tripSpeedMs]);

  const activeIdx = timelineStages.findIndex(s => frame.timeMin >= s.startMin - EPS && frame.timeMin <= s.endMin + EPS);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => setPlaying(!playing)} className="gap-1">
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {playing ? "Пауза" : "Старт"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setPlaying(false); setCurrentIndex(0); }} className="gap-1">
              <RotateCcw className="w-4 h-4" /> Сброс
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSpeedIdx(p => (p + 1) % SPEED_OPTIONS.length)} className="gap-1">
              <FastForward className="w-4 h-4" /> ×{speed}
            </Button>
            <div className="flex-1 min-w-[180px]">
              <Slider value={[currentIndex]} min={0} max={maxIndex} step={1}
                onValueChange={([v]) => { setCurrentIndex(v); setPlaying(false); }} />
            </div>
            <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
              {frame.timeMin.toFixed(1)} / {totalTime.toFixed(1)} мин
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Well SVG */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Анимация установки цементного моста ({viewTop.toFixed(0)}–{viewBot.toFixed(0)} м)</CardTitle>
          </CardHeader>
          <CardContent>
            <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full max-w-[380px] mx-auto" style={{ height: svgH }}>
              {/* Depth scale ticks */}
              {(() => {
                const step = viewRange > 300 ? 50 : viewRange > 100 ? 20 : 10;
                const ticks: number[] = [];
                for (let d = Math.ceil(viewTop / step) * step; d <= viewBot; d += step) ticks.push(d);
                return ticks.map(d => {
                  const y = mdToY(d);
                  return (
                    <g key={`tick-${d}`}>
                      <line x1={cx - pipeW - annW - wallW - 12} y1={y} x2={cx - pipeW - annW - wallW - 4} y2={y} stroke="hsl(var(--border))" strokeWidth="0.5" />
                      <text x={cx - pipeW - annW - wallW - 14} y={y + 3} textAnchor="end" className="text-[7px] fill-muted-foreground">{d}</text>
                    </g>
                  );
                });
              })()}

              {/* Borehole walls */}
              <rect x={cx - pipeW - annW - wallW} y={topY} width={wallW} height={usableH} fill="hsl(30, 25%, 40%)" opacity={0.5} rx="1" />
              <rect x={cx + pipeW + annW} y={topY} width={wallW} height={usableH} fill="hsl(30, 25%, 40%)" opacity={0.5} rx="1" />

              {/* Open hole hatch below shoe */}
              {well.casingShoe >= viewTop && well.casingShoe <= viewBot && (
                <>
                  <line x1={cx - pipeW - annW - wallW - 8} y1={shoeY} x2={cx + pipeW + annW + wallW + 8} y2={shoeY}
                    stroke="hsl(var(--primary))" strokeWidth="1" strokeDasharray="3 2" />
                  <text x={cx + pipeW + annW + wallW + 10} y={shoeY + 3} className="text-[6px] fill-primary" fontWeight="bold">
                    Башмак {well.casingShoe.toFixed(0)}м
                  </text>
                </>
              )}

              {/* Below-pipe segments (full bore, no pipe) */}
              {visBelow.map((seg, i) => {
                const y1 = mdToY(seg.topMD);
                const y2 = mdToY(seg.botMD);
                if (y2 - y1 < 0.5) return null;
                return (
                  <rect key={`below-${i}`} x={cx - pipeW - annW} y={y1} width={2 * (pipeW + annW)} height={y2 - y1}
                    fill={fluidColor(seg.fluid)} opacity={0.5} />
                );
              })}

              {/* Annulus segments */}
              {visAnn.map((seg, i) => {
                const y1 = mdToY(seg.topMD);
                const y2 = mdToY(seg.botMD);
                if (y2 - y1 < 0.5) return null;
                return (
                  <g key={`ann-${i}`}>
                    <rect x={cx - pipeW - annW} y={y1} width={annW} height={y2 - y1} fill={fluidColor(seg.fluid)} opacity={0.88} />
                    <rect x={cx + pipeW} y={y1} width={annW} height={y2 - y1} fill={fluidColor(seg.fluid)} opacity={0.88} />
                    {y2 - y1 > 16 && seg.fluid !== "mud" && (
                      <g>
                        <text x={cx + pipeW + annW + wallW + 8} y={(y1 + y2) / 2 - 2}
                          className="text-[7px] fill-foreground" style={{ fontWeight: 700 }}>
                          {seg.label.length > 16 ? seg.label.slice(0, 16) + "…" : seg.label}
                        </text>
                        <text x={cx + pipeW + annW + wallW + 8} y={(y1 + y2) / 2 + 7}
                          className="text-[6px] fill-muted-foreground">
                          {seg.topMD.toFixed(0)}–{seg.botMD.toFixed(0)} м
                        </text>
                        {/* Dashed boundary line */}
                        <line x1={cx + pipeW + annW} y1={y1} x2={cx + pipeW + annW + wallW + 6} y2={y1}
                          stroke={fluidColor(seg.fluid)} strokeWidth="0.6" strokeDasharray="2,2" />
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Pipe walls */}
              {showPipe && (
                <>
                  <rect x={cx - pipeW} y={Math.max(topY, mdToY(0))} width={3} height={Math.max(0, tipY - Math.max(topY, mdToY(0)))}
                    fill="hsl(var(--foreground))" opacity="0.6" rx="1" />
                  <rect x={cx + pipeW - 3} y={Math.max(topY, mdToY(0))} width={3} height={Math.max(0, tipY - Math.max(topY, mdToY(0)))}
                    fill="hsl(var(--foreground))" opacity="0.6" rx="1" />
                  {/* Pipe tip horizontal line */}
                  {frame.pipeTipMD >= viewTop && frame.pipeTipMD <= viewBot && (
                    <line x1={cx - pipeW} y1={tipY} x2={cx + pipeW} y2={tipY}
                      stroke="hsl(var(--foreground))" strokeWidth="2" opacity="0.7" />
                  )}
                </>
              )}

              {/* Pipe internal segments */}
              {showPipe && visPipe.map((seg, i) => {
                const y1 = mdToY(seg.topMD);
                const y2 = Math.min(tipY, mdToY(seg.botMD));
                if (y2 - y1 < 0.5) return null;
                return (
                  <g key={`pipe-${i}`}>
                    <rect x={cx - pipeW + 3} y={y1} width={2 * pipeW - 6} height={y2 - y1}
                      fill={fluidColor(seg.fluid)} opacity={0.9} />
                    {y2 - y1 > 16 && (
                      <>
                        <text x={cx} y={(y1 + y2) / 2 - 1} textAnchor="middle"
                          className="text-[6px] fill-background" style={{ fontWeight: 700 }}>
                          {seg.label.length > 10 ? seg.label.slice(0, 10) + "…" : seg.label}
                        </text>
                        <text x={cx} y={(y1 + y2) / 2 + 8} textAnchor="middle"
                          className="text-[5px] fill-background">
                          {seg.topMD.toFixed(0)}–{seg.botMD.toFixed(0)} м
                        </text>
                      </>
                    )}
                  </g>
                );
              })}

              {/* Plug interval markers */}
              <line x1={cx - pipeW - annW - wallW - 2} y1={plugTopY} x2={cx + pipeW + annW + wallW + 2} y2={plugTopY}
                stroke="hsl(var(--destructive))" strokeWidth="0.8" strokeDasharray="3 2" />
              <line x1={cx - pipeW - annW - wallW - 2} y1={plugBotY} x2={cx + pipeW + annW + wallW + 2} y2={plugBotY}
                stroke="hsl(var(--destructive))" strokeWidth="0.8" strokeDasharray="3 2" />
              <text x={4} y={plugTopY - 2} className="text-[7px] fill-destructive" fontWeight="bold">Кровля {plug.topMD.toFixed(0)}м</text>
              <text x={4} y={plugBotY + 9} className="text-[7px] fill-destructive" fontWeight="bold">Подошва {plug.bottomMD.toFixed(0)}м</text>

              {/* Pipe tip label */}
              {frame.pipeTipMD >= viewTop && frame.pipeTipMD <= viewBot && (
                <text x={cx} y={tipY + 14} textAnchor="middle" className="text-[8px] fill-foreground" fontWeight="bold">
                  ▼ {frame.pipeTipMD.toFixed(0)} м
                </text>
              )}

              {/* Flow direction arrows */}
              {frame.rateLs > 0 && showPipe && !frame.washDir && (
                <g opacity="0.7">
                  <text x={cx} y={arrowY1} textAnchor="middle" className="text-[12px] fill-primary">↓</text>
                  <text x={cx} y={arrowY2} textAnchor="middle" className="text-[12px] fill-primary">↓</text>
                  <text x={cx - pipeW - annW / 2} y={arrowY1} textAnchor="middle" className="text-[12px] fill-primary">↑</text>
                  <text x={cx + pipeW + annW / 2} y={arrowY1} textAnchor="middle" className="text-[12px] fill-primary">↑</text>
                </g>
              )}
              {frame.washDir === "direct" && showPipe && (
                <g opacity="0.7">
                  <text x={cx} y={arrowY1} textAnchor="middle" className="text-[12px] fill-primary">↓</text>
                  <text x={cx - pipeW - annW / 2} y={arrowY1} textAnchor="middle" className="text-[12px] fill-primary">↑</text>
                  <text x={cx + pipeW + annW / 2} y={arrowY1} textAnchor="middle" className="text-[12px] fill-primary">↑</text>
                  <text x={cx + pipeW + annW + wallW + 30} y={arrowY1} className="text-[8px] fill-primary" fontWeight="bold">Прямая</text>
                </g>
              )}
              {frame.washDir === "reverse" && showPipe && (
                <g opacity="0.7">
                  <text x={cx} y={arrowY1} textAnchor="middle" className="text-[12px] fill-primary">↑</text>
                  <text x={cx - pipeW - annW / 2} y={arrowY1} textAnchor="middle" className="text-[12px] fill-primary">↓</text>
                  <text x={cx + pipeW + annW / 2} y={arrowY1} textAnchor="middle" className="text-[12px] fill-primary">↓</text>
                  <text x={cx + pipeW + annW + wallW + 30} y={arrowY1} className="text-[8px] fill-primary" fontWeight="bold">Обратная</text>
                </g>
              )}

              {/* Trip direction arrow */}
              {frame.rateLs === 0 && !frame.washDir && (/спуск/i.test(frame.stage) || /подъём/i.test(frame.stage)) && showPipe && (
                <text x={cx + pipeW + 8} y={tipY - 6} className="text-[14px] fill-primary" fontWeight="bold">
                  {/подъём/i.test(frame.stage) ? "↑" : "↓"}
                </text>
              )}

              {/* Top/bottom viewport labels */}
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

        {/* Info panel */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">Параметры</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-accent/30 rounded-lg p-3 space-y-2">
              <div className="text-xs font-bold text-primary">{frame.stage}</div>
              <InfoRow label="Время" value={`${frame.timeMin.toFixed(1)} мин`} />
              <InfoRow label="Глубина инстр." value={`${frame.pipeTipMD.toFixed(1)} м`} />
              <InfoRow label="Расход" value={frame.rateLs > 0 ? `${frame.rateLs.toFixed(1)} л/с` : "—"} />
              <InfoRow label="Объём закачан" value={`${frame.cumVol.toFixed(3)} м³`} />
              {frame.washDir && <InfoRow label="Направление" value={frame.washDir === "direct" ? "Прямая" : "Обратная"} />}
              <div className="pt-1 text-[10px] leading-4 text-muted-foreground">{frame.desc}</div>
            </div>

            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Затрубье (интервал моста)</div>
              {frame.annSegs.filter(s => s.botMD > viewTop && s.topMD < viewBot && s.fluid !== "mud" && s.botMD - s.topMD > 0.5).map((seg, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: fluidColor(seg.fluid) }} />
                  <span className="text-muted-foreground truncate">{seg.label}</span>
                  <span className="ml-auto font-mono">{seg.topMD.toFixed(0)}–{seg.botMD.toFixed(0)}м</span>
                </div>
              ))}
            </div>

            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Труба</div>
              {frame.pipeSegs.filter(s => s.botMD > viewTop && s.topMD < viewBot && s.botMD - s.topMD > 0.5).map((seg, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: fluidColor(seg.fluid) }} />
                  <span className="text-muted-foreground truncate">{seg.label}</span>
                  <span className="ml-auto font-mono">{seg.topMD.toFixed(0)}–{seg.botMD.toFixed(0)}м</span>
                </div>
              ))}
            </div>

            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Хронометраж</div>
              {timelineStages.map((item, i) => {
                const isActive = i === activeIdx;
                const isDone = frame.timeMin > item.endMin + EPS;
                return (
                  <div key={i} className={`flex items-center gap-1.5 text-[9px] py-0.5 ${isActive ? "text-primary font-bold" : isDone ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
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
                <div className="h-full bg-primary rounded-full transition-all duration-100" style={{ width: `${(frame.timeMin / totalTime) * 100}%` }} />
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
