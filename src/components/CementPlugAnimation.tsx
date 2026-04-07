import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, RotateCcw, FastForward } from "lucide-react";
import type { PlugInputs, PlugResults, PumpingStage, WashType } from "@/lib/cement-plug-calculations";

interface Props {
  inputs: PlugInputs;
  results: PlugResults;
}

/* ───── Fluid colors ───── */
const COLORS: Record<string, string> = {
  mud: "hsl(30, 50%, 45%)",
  spacer: "hsl(200, 60%, 55%)",
  cement: "hsl(0, 0%, 62%)",
  displacement: "hsl(120, 40%, 45%)",
  viscousPad: "hsl(280, 50%, 50%)",
};

const SPEED_OPTIONS = [1, 2, 5, 10];

/* ───── Animation keyframe ───── */
interface Frame {
  timeMin: number;
  stage: string;
  /** Pipe tip depth, m MD */
  pipeTipMD: number;
  /** Fluid segments inside pipe, from surface downward */
  pipeSegs: { fluid: string; label: string; topMD: number; botMD: number }[];
  /** Fluid segments in annulus (around pipe), from bottom upward */
  annSegs: { fluid: string; label: string; topMD: number; botMD: number }[];
  /** Fluid below pipe tip (open hole below) */
  belowPipeSegs: { fluid: string; label: string; topMD: number; botMD: number }[];
  /** Current pump rate, L/s */
  pumpRateLs: number;
  /** Cumulative volume pumped */
  volumeM3: number;
}

function areaM2(dMm: number) { const d = dMm / 1000; return (Math.PI / 4) * d * d; }
function annAreaM2(outer: number, inner: number) { return areaM2(outer) - areaM2(inner); }

export default function CementPlugAnimation({ inputs, results }: Props) {
  const { well, plug, cement, spacer, wellFluid } = inputs;
  const isOpenHole = results.isOpenHole;
  const boreDiam = results.boreDiamUsed;
  const pipeEndMD = plug.bottomMD;
  const pullOutMD = results.pullOutDepthMD;
  const wellDepth = well.wellDepthMD;

  const annA = annAreaM2(boreDiam, well.pipeOD);
  const pipeA = areaM2(well.pipeID);
  const boreA = areaM2(boreDiam);

  /* ── Build frames ── */
  const frames = useMemo(() => {
    const fs: Frame[] = [];
    const dt = 0.25; // minutes per frame step
    let t = 0;
    let cumVol = 0;

    // Helper: pipe contents tracking
    // Track what's been pumped into pipe (from surface). Initially pipe is full of mud.
    // pipeStack: array of {fluid, label, volM3} from surface downward.
    let pipeStack: { fluid: string; label: string; volM3: number }[] = [
      { fluid: "mud", label: wellFluid.name, volM3: pipeA * pipeEndMD },
    ];
    // annStack: array of {fluid, label, volM3} from bottom upward
    let annStack: { fluid: string; label: string; volM3: number }[] = [
      { fluid: "mud", label: wellFluid.name, volM3: annA * pipeEndMD },
    ];

    const pipeCapacity = pipeA * pipeEndMD;

    function pushFrame(stage: string, rateLs: number, pipeTipMD: number) {
      // Convert pipeStack to MD segments (surface → pipeTipMD)
      const pSegs: Frame["pipeSegs"] = [];
      let md = 0;
      for (const s of pipeStack) {
        const len = pipeA > 0 ? s.volM3 / pipeA : 0;
        if (len > 0.01) {
          pSegs.push({ fluid: s.fluid, label: s.label, topMD: md, botMD: md + len });
        }
        md += len;
      }
      // Convert annStack to MD segments (bottom → surface)
      const aSegs: Frame["annSegs"] = [];
      let annMD = pipeTipMD;
      for (const s of annStack) {
        const len = annA > 0 ? s.volM3 / annA : 0;
        if (len > 0.01) {
          aSegs.push({ fluid: s.fluid, label: s.label, topMD: annMD - len, botMD: annMD });
          annMD -= len;
        }
      }
      // Below pipe (wellDepth > pipeTipMD): mud
      const belowSegs: Frame["belowPipeSegs"] = [];
      if (pipeTipMD < wellDepth - 0.1) {
        belowSegs.push({ fluid: "mud", label: wellFluid.name, topMD: pipeTipMD, botMD: wellDepth });
      }

      fs.push({
        timeMin: t,
        stage,
        pipeTipMD,
        pipeSegs: pSegs,
        annSegs: aSegs,
        belowPipeSegs: belowSegs,
        pumpRateLs: rateLs,
        volumeM3: cumVol,
      });
    }

    function pumpVolumeIntoPipe(fluid: string, label: string, volM3: number) {
      // Add to top of pipe (surface end)
      pipeStack.unshift({ fluid, label, volM3 });
      // Trim pipe to capacity - overflow goes to annulus bottom
      let total = pipeStack.reduce((s, p) => s + p.volM3, 0);
      while (total > pipeCapacity + 0.0001 && pipeStack.length > 0) {
        const last = pipeStack[pipeStack.length - 1];
        const excess = total - pipeCapacity;
        if (excess >= last.volM3) {
          annStack.unshift({ fluid: last.fluid, label: last.label, volM3: last.volM3 });
          pipeStack.pop();
          total -= last.volM3;
        } else {
          annStack.unshift({ fluid: last.fluid, label: last.label, volM3: excess });
          last.volM3 -= excess;
          total = pipeCapacity;
        }
      }
      // Trim annulus (overflow exits at surface)
      const annCapacity = annA * pipeEndMD;
      let annTotal = annStack.reduce((s, a) => s + a.volM3, 0);
      while (annTotal > annCapacity + 0.0001 && annStack.length > 0) {
        const last = annStack[annStack.length - 1];
        const excess = annTotal - annCapacity;
        if (excess >= last.volM3) {
          annStack.pop();
          annTotal -= last.volM3;
        } else {
          last.volM3 -= excess;
          annTotal = annCapacity;
        }
      }
      // Merge consecutive same-fluid
      pipeStack = merge(pipeStack);
      annStack = merge(annStack);
    }

    function merge(arr: { fluid: string; label: string; volM3: number }[]) {
      const m: typeof arr = [];
      for (const s of arr) {
        if (m.length > 0 && m[m.length - 1].fluid === s.fluid) m[m.length - 1].volM3 += s.volM3;
        else m.push({ ...s });
      }
      return m;
    }

    // ── PHASE 1: Run-in (спуск инструмента) ──
    const runInTimeSec = pipeEndMD / (inputs.tripSpeedMs || 0.3);
    const runInTimeMin = runInTimeSec / 60;
    const runInSteps = Math.max(1, Math.ceil(runInTimeMin / dt));
    const runInDt = runInTimeMin / runInSteps;
    
    for (let i = 0; i <= runInSteps; i++) {
      const frac = i / runInSteps;
      const tipMD = frac * pipeEndMD;
      // During run-in, pipe and annulus are all mud, just the pipe tip depth changes
      fs.push({
        timeMin: t, stage: "Спуск инструмента", pipeTipMD: tipMD,
        pipeSegs: [{ fluid: "mud", label: wellFluid.name, topMD: 0, botMD: tipMD }],
        annSegs: tipMD > 1 ? [{ fluid: "mud", label: wellFluid.name, topMD: 0, botMD: tipMD }] : [],
        belowPipeSegs: tipMD < wellDepth - 1 ? [{ fluid: "mud", label: wellFluid.name, topMD: tipMD, botMD: wellDepth }] : [],
        pumpRateLs: 0, volumeM3: 0,
      });
      t += runInDt;
    }

    // ── PHASE 2: Pumping stages (from results.pumpingStages) ──
    for (const stage of results.pumpingStages) {
      const { name, volumeM3: stageVol, timeMin: stageTime } = stage;
      
      // Determine fluid type
      let fluidKey = "mud";
      let fluidLabel = stage.fluid;
      if (name.includes("Цемент") || name.includes("цемент")) { fluidKey = "cement"; fluidLabel = cement.name; }
      else if (name.includes("буфер") || name.includes("Буфер") || name.includes("буфера")) { fluidKey = "spacer"; fluidLabel = spacer.name; }
      else if (name.includes("Продавка") || name.includes("продавк")) { fluidKey = "displacement"; fluidLabel = wellFluid.name + " (продавка)"; }
      else if (name.includes("вязк") || name.includes("Вязк") || name.includes("пачк")) { fluidKey = "viscousPad"; fluidLabel = inputs.viscousPadFluid?.name || "Вязкая пачка"; }
      else if (name.includes("Промывка") || name.includes("промыв")) { fluidKey = "mud"; fluidLabel = wellFluid.name; }

      // Trip stages (no volume pumped)
      if (name.includes("Подъём") || name.includes("подъём") || name.includes("Спуск на")) {
        const isTripUp = name.includes("Подъём") || name.includes("подъём");
        const steps = Math.max(1, Math.ceil(stageTime / dt));
        const sDt = stageTime / steps;
        
        // For "Подъём инструмента" (final pull-out before wash)
        let startMD = pipeEndMD;
        let endMD = pullOutMD;
        
        if (name.includes("над пачкой") || name.includes("над пачк")) {
          startMD = pipeEndMD;
          endMD = results.padPullUpMD || pipeEndMD - 5;
        } else if (name.includes("Спуск на") || name.includes("кровл")) {
          // Trip back down
          startMD = results.padPullUpMD || pipeEndMD - 5;
          endMD = pipeEndMD;
        }
        
        for (let s = 0; s < steps; s++) {
          t += sDt;
          const frac = (s + 1) / steps;
          const tipMD = startMD + (endMD - startMD) * frac;
          pushFrame(name, 0, tipMD);
        }
        continue;
      }

      // Wash stage
      if (name.includes("Промывка") || name.includes("промыв") || name.includes("промывк")) {
        if (stageVol <= 0 || stageTime <= 0) continue;
        const steps = Math.max(1, Math.ceil(stageTime / dt));
        const sDt = stageTime / steps;
        const dVol = stageVol / steps;
        const rateLs = stageVol > 0 && stageTime > 0 ? (stageVol * 1000) / (stageTime * 60) : 0;
        
        for (let s = 0; s < steps; s++) {
          t += sDt;
          cumVol += dVol;
          pushFrame(name + ` (${results.washType === 'direct' ? 'прям.' : 'обр.'})`, rateLs, pullOutMD);
        }
        continue;
      }

      // Reverse flush (обратная промывка)
      if (name.includes("Обратная") || name.includes("обратн")) {
        if (stageTime <= 0) continue;
        const steps = Math.max(1, Math.ceil(stageTime / dt));
        const sDt = stageTime / steps;
        const dVol = stageVol / steps;
        const rateLs = stageVol > 0 && stageTime > 0 ? (stageVol * 1000) / (stageTime * 60) : 0;
        
        for (let s = 0; s < steps; s++) {
          t += sDt;
          cumVol += dVol;
          const tipMD = results.padPullUpMD || pipeEndMD - 5;
          pushFrame(name, rateLs, tipMD);
        }
        continue;
      }

      // Normal pumping stage
      if (stageVol <= 0 || stageTime <= 0) continue;
      const steps = Math.max(1, Math.ceil(stageTime / dt));
      const sDt = stageTime / steps;
      const dVol = stageVol / steps;
      const rateLs = (stageVol * 1000) / (stageTime * 60);

      for (let s = 0; s < steps; s++) {
        pumpVolumeIntoPipe(fluidKey, fluidLabel, dVol);
        t += sDt;
        cumVol += dVol;
        pushFrame(name, rateLs, pipeEndMD);
      }
    }

    return fs;
  }, [inputs, results]);

  /* ── Playback state ── */
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const animRef = useRef<number>(0);
  const lastFrameTime = useRef(0);

  const maxIndex = frames.length - 1;
  const speed = SPEED_OPTIONS[speedIdx];
  const frame = frames[Math.min(currentIndex, maxIndex)] || frames[0];

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
    if (playing) { lastFrameTime.current = 0; animRef.current = requestAnimationFrame(animate); }
    else cancelAnimationFrame(animRef.current);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing, animate]);

  const handleReset = () => { setPlaying(false); setCurrentIndex(0); };
  const toggleSpeed = () => setSpeedIdx(prev => (prev + 1) % SPEED_OPTIONS.length);

  if (!frame) return null;

  /* ── SVG layout ── */
  const svgW = 300;
  const svgH = 520;
  const topY = 45;
  const botY = svgH - 25;
  const usableH = botY - topY;
  const cx = svgW / 2;
  const pipeW = 18; // half-width of pipe visual
  const annW = 14; // annulus gap
  const wallW = 4; // borehole wall

  // Scale: map 0..wellDepth to topY..botY
  const mdToY = (md: number) => topY + (md / wellDepth) * usableH;
  const tipY = mdToY(frame.pipeTipMD);

  // Casing shoe
  const shoeMD = well.casingShoe;
  const shoeY = mdToY(shoeMD);

  // Plug interval
  const plugTopY = mdToY(plug.topMD);
  const plugBotY = mdToY(plug.bottomMD);

  function fluidColor(f: string) { return COLORS[f] || COLORS.mud; }

  // Legend items
  const legendMap = new Map<string, string>();
  legendMap.set(wellFluid.name, COLORS.mud);
  legendMap.set(cement.name, COLORS.cement);
  legendMap.set(spacer.name, COLORS.spacer);
  if (inputs.useViscousPad && inputs.viscousPadFluid) legendMap.set(inputs.viscousPadFluid.name, COLORS.viscousPad);
  legendMap.set("Продавка", COLORS.displacement);

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
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1">
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
              {frame.timeMin.toFixed(1)} мин
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Well SVG */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">🎬 Анимация установки цементного моста</CardTitle>
          </CardHeader>
          <CardContent>
            <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full max-w-[340px] mx-auto" style={{ height: svgH }}>
              <defs>
                <pattern id="cp-hatch" patternUnits="userSpaceOnUse" width="6" height="6">
                  <path d="M0 6L6 0" stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.3" />
                </pattern>
              </defs>

              {/* Surface line */}
              <line x1="0" y1={topY} x2={svgW} y2={topY} stroke="hsl(var(--border))" strokeWidth="2" />
              <text x={cx} y={topY - 6} textAnchor="middle" className="text-[8px] fill-muted-foreground">Устье (0 м)</text>

              {/* Borehole walls */}
              {/* Left wall */}
              <rect x={cx - pipeW - annW - wallW} y={topY} width={wallW} height={botY - topY}
                fill="hsl(var(--border))" opacity="0.4" />
              {/* Right wall */}
              <rect x={cx + pipeW + annW} y={topY} width={wallW} height={botY - topY}
                fill="hsl(var(--border))" opacity="0.4" />

              {/* Open hole texture below casing shoe */}
              {isOpenHole && shoeY < botY && (
                <>
                  <rect x={cx - pipeW - annW - wallW} y={shoeY} width={wallW} height={botY - shoeY}
                    fill="url(#cp-hatch)" />
                  <rect x={cx + pipeW + annW} y={shoeY} width={wallW} height={botY - shoeY}
                    fill="url(#cp-hatch)" />
                </>
              )}

              {/* Annulus fluid segments */}
              {frame.annSegs.map((seg, i) => {
                const y1 = mdToY(seg.topMD);
                const y2 = mdToY(seg.botMD);
                if (y2 - y1 < 0.5) return null;
                return (
                  <g key={`ann-${i}`}>
                    {/* Left annulus */}
                    <rect x={cx - pipeW - annW} y={y1} width={annW} height={y2 - y1}
                      fill={fluidColor(seg.fluid)} opacity={0.85} />
                    {/* Right annulus */}
                    <rect x={cx + pipeW} y={y1} width={annW} height={y2 - y1}
                      fill={fluidColor(seg.fluid)} opacity={0.85} />
                  </g>
                );
              })}

              {/* Below pipe tip (full bore, no pipe) */}
              {frame.belowPipeSegs.map((seg, i) => {
                const y1 = Math.max(mdToY(seg.topMD), tipY);
                const y2 = mdToY(seg.botMD);
                if (y2 - y1 < 0.5) return null;
                return (
                  <rect key={`below-${i}`}
                    x={cx - pipeW - annW} y={y1}
                    width={2 * (pipeW + annW)} height={y2 - y1}
                    fill={fluidColor(seg.fluid)} opacity={0.6} />
                );
              })}

              {/* Pipe body */}
              {frame.pipeTipMD > 0.5 && (
                <>
                  {/* Left pipe wall */}
                  <rect x={cx - pipeW} y={topY} width={3} height={tipY - topY}
                    fill="hsl(var(--foreground))" opacity="0.6" rx="1" />
                  {/* Right pipe wall */}
                  <rect x={cx + pipeW - 3} y={topY} width={3} height={tipY - topY}
                    fill="hsl(var(--foreground))" opacity="0.6" rx="1" />
                </>
              )}

              {/* Pipe internal fluid segments */}
              {frame.pipeSegs.map((seg, i) => {
                const y1 = mdToY(Math.max(0, seg.topMD));
                const y2 = mdToY(Math.min(frame.pipeTipMD, seg.botMD));
                if (y2 - y1 < 0.5) return null;
                return (
                  <rect key={`pipe-${i}`}
                    x={cx - pipeW + 3} y={y1}
                    width={2 * pipeW - 6} height={y2 - y1}
                    fill={fluidColor(seg.fluid)} opacity={0.9} />
                );
              })}

              {/* Casing shoe marker */}
              {shoeMD > 0 && shoeMD < wellDepth && (
                <>
                  <line x1={cx - pipeW - annW - wallW - 8} y1={shoeY} x2={cx + pipeW + annW + wallW + 8} y2={shoeY}
                    stroke="hsl(var(--primary))" strokeWidth="1" strokeDasharray="3 2" />
                  <text x={cx + pipeW + annW + wallW + 10} y={shoeY + 3} className="text-[7px] fill-primary" fontWeight="bold">
                    Башмак {shoeMD.toFixed(0)}м
                  </text>
                </>
              )}

              {/* Plug interval markers */}
              <line x1={cx - pipeW - annW - wallW - 4} y1={plugTopY} x2={cx + pipeW + annW + wallW + 4} y2={plugTopY}
                stroke="hsl(var(--destructive))" strokeWidth="0.8" strokeDasharray="2 2" />
              <line x1={cx - pipeW - annW - wallW - 4} y1={plugBotY} x2={cx + pipeW + annW + wallW + 4} y2={plugBotY}
                stroke="hsl(var(--destructive))" strokeWidth="0.8" strokeDasharray="2 2" />
              <text x={2} y={plugTopY - 2} className="text-[6px] fill-destructive">
                Кровля {plug.topMD.toFixed(0)}м
              </text>
              <text x={2} y={plugBotY + 8} className="text-[6px] fill-destructive">
                Подошва {plug.bottomMD.toFixed(0)}м
              </text>

              {/* Pipe tip depth label */}
              {frame.pipeTipMD > 1 && (
                <text x={cx} y={tipY + 12} textAnchor="middle" className="text-[7px] fill-foreground" fontWeight="bold">
                  ▼ {frame.pipeTipMD.toFixed(0)} м
                </text>
              )}

              {/* Depth labels along annulus segments */}
              {frame.annSegs.filter(s => {
                const h = mdToY(s.botMD) - mdToY(s.topMD);
                return h > 14 && s.fluid !== "mud";
              }).map((seg, i) => {
                const midY = (mdToY(seg.topMD) + mdToY(seg.botMD)) / 2;
                const len = seg.botMD - seg.topMD;
                const volM3 = annA * len;
                return (
                  <g key={`albl-${i}`}>
                    <text x={cx + pipeW + annW + wallW + 10} y={midY - 4}
                      className="text-[6px] fill-foreground" fontWeight="bold">{seg.label}</text>
                    <text x={cx + pipeW + annW + wallW + 10} y={midY + 4}
                      className="text-[5px] fill-muted-foreground">
                      {seg.topMD.toFixed(0)}-{seg.botMD.toFixed(0)}м ({volM3.toFixed(3)} м³)
                    </text>
                  </g>
                );
              })}

              {/* Bottom depth */}
              <text x={cx} y={botY + 14} textAnchor="middle" className="text-[7px] fill-muted-foreground">
                Забой {wellDepth.toFixed(0)} м
              </text>
            </svg>

            {/* Legend */}
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
            <CardTitle className="text-sm">📊 Параметры</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-accent/30 rounded-lg p-3 space-y-2">
              <div className="text-xs font-bold text-primary">{frame.stage}</div>
              <InfoRow label="Время" value={`${frame.timeMin.toFixed(1)} мин`} />
              <InfoRow label="Глубина инстр." value={`${frame.pipeTipMD.toFixed(1)} м`} />
              <InfoRow label="Расход" value={frame.pumpRateLs > 0 ? `${frame.pumpRateLs.toFixed(1)} л/с` : "—"} />
              <InfoRow label="Объём закачан" value={`${frame.volumeM3.toFixed(3)} м³`} />
            </div>

            {/* Pipe contents */}
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Трубное пространство</div>
              {frame.pipeSegs.filter(s => s.botMD - s.topMD > 0.5).map((seg, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: fluidColor(seg.fluid) }} />
                  <span className="text-muted-foreground">{seg.label}</span>
                  <span className="ml-auto font-mono">{seg.topMD.toFixed(0)}-{seg.botMD.toFixed(0)}м</span>
                </div>
              ))}
            </div>

            {/* Annulus contents */}
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Затрубное пространство</div>
              {frame.annSegs.filter(s => s.botMD - s.topMD > 0.5).map((seg, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px]">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: fluidColor(seg.fluid) }} />
                  <span className="text-muted-foreground">{seg.label}</span>
                  <span className="ml-auto font-mono">{seg.topMD.toFixed(0)}-{seg.botMD.toFixed(0)}м</span>
                </div>
              ))}
            </div>

            {/* Timeline */}
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">Хронометраж</div>
              {results.pumpingStages.map((s, i) => {
                const stageStartTime = results.pumpingStages.slice(0, i).reduce((sum, st) => sum + st.timeMin, 0);
                const isActive = frame.timeMin >= stageStartTime && frame.timeMin < stageStartTime + s.timeMin;
                const isDone = frame.timeMin >= stageStartTime + s.timeMin;
                return (
                  <div key={i} className={`flex items-center gap-1.5 text-[9px] py-0.5 ${isActive ? 'text-primary font-bold' : isDone ? 'text-muted-foreground' : 'text-muted-foreground/50'}`}>
                    <span>{isDone ? "✅" : isActive ? "▶" : "○"}</span>
                    <span className="truncate">{s.name}</span>
                    <span className="ml-auto font-mono">{s.timeMin.toFixed(1)}'</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}
