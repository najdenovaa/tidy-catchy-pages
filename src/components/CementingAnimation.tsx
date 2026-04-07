import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, RotateCcw, FastForward } from "lucide-react";
import type { PressurePoint, StageBoundary } from "@/lib/cementing-calculations";

interface Props {
  pressureData: PressurePoint[];
  stageBoundaries: StageBoundary[];
  casingDepthMD: number;
  wellDepthMD: number;
}

const FLUID_COLORS: Record<string, string> = {
  mud: "hsl(30, 50%, 45%)",
  buffer: "hsl(200, 60%, 50%)",
  cement: "hsl(0, 0%, 55%)",
  displacement: "hsl(120, 40%, 45%)",
};

const FLUID_LABELS: Record<string, string> = {
  mud: "Буровой р-р",
  buffer: "Буфер",
  cement: "Цемент",
  displacement: "Продавка",
};

const SPEED_OPTIONS = [1, 2, 5, 10];

export default function CementingAnimation({ pressureData, stageBoundaries, casingDepthMD, wellDepthMD }: Props) {
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const animRef = useRef<number>(0);
  const lastFrameTime = useRef(0);

  const maxIndex = pressureData.length - 1;
  const speed = SPEED_OPTIONS[speedIdx];

  const currentPoint = pressureData[Math.min(currentIndex, maxIndex)] || pressureData[0];
  if (!currentPoint) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Нет данных. Нажмите «РАСЧЁТ».
        </CardContent>
      </Card>
    );
  }

  // Animation loop
  const animate = useCallback((timestamp: number) => {
    if (!lastFrameTime.current) lastFrameTime.current = timestamp;
    const delta = timestamp - lastFrameTime.current;
    // advance ~30fps, scaled by speed
    if (delta > 33) {
      lastFrameTime.current = timestamp;
      setCurrentIndex(prev => {
        const next = prev + speed;
        if (next >= maxIndex) {
          setPlaying(false);
          return maxIndex;
        }
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

  const handleReset = () => {
    setPlaying(false);
    setCurrentIndex(0);
  };

  const toggleSpeed = () => {
    setSpeedIdx(prev => (prev + 1) % SPEED_OPTIONS.length);
  };

  // Get current stage name
  const currentStage = useMemo(() => {
    let stage = "Начало";
    for (const sb of stageBoundaries) {
      if (currentPoint.time >= sb.time) stage = sb.label;
    }
    return stage;
  }, [currentPoint.time, stageBoundaries]);

  // Well visualization dimensions
  const wellHeight = 400;
  const wellWidth = 200;
  const pipeWidth = 40;
  const annWidth = 25;
  const topY = 40;
  const botY = wellHeight - 20;
  const usableH = botY - topY;

  // Calculate fluid heights as fractions
  const totalAnnH = currentPoint.annMudHeightM + currentPoint.annBufferHeightM + currentPoint.annCementHeightM + currentPoint.annDisplHeightM;
  const scaleFactor = casingDepthMD > 0 ? usableH / casingDepthMD : 1;

  // Build annulus fluid segments (from bottom up)
  const annSegments: { fluid: string; height: number; y: number }[] = [];
  let curY = botY;
  
  // Cement at bottom
  if (currentPoint.annCementHeightM > 0) {
    const h = currentPoint.annCementHeightM * scaleFactor;
    curY -= h;
    annSegments.push({ fluid: "cement", height: h, y: curY });
  }
  // Buffer above cement  
  if (currentPoint.annBufferHeightM > 0) {
    const h = currentPoint.annBufferHeightM * scaleFactor;
    curY -= h;
    annSegments.push({ fluid: "buffer", height: h, y: curY });
  }
  // Displacement above buffer
  if (currentPoint.annDisplHeightM > 0) {
    const h = currentPoint.annDisplHeightM * scaleFactor;
    curY -= h;
    annSegments.push({ fluid: "displacement", height: h, y: curY });
  }
  // Mud fills the rest
  const mudH = Math.max(0, curY - topY);
  if (mudH > 0) {
    annSegments.push({ fluid: "mud", height: mudH, y: topY });
  }

  // Elapsed time progress
  const maxTime = pressureData[maxIndex]?.time || 1;
  const progressPct = (currentPoint.time / maxTime) * 100;

  // Rise height of cement top
  const cementTopMD = casingDepthMD - currentPoint.annCementHeightM;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPlaying(!playing)}
              className="gap-1"
            >
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
                onValueChange={([v]) => { setCurrentIndex(v); setPlaying(false); }}
              />
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
            <svg viewBox={`0 0 ${wellWidth} ${wellHeight}`} className="w-full max-w-[250px] mx-auto" style={{ height: wellHeight }}>
              {/* Surface line */}
              <line x1="0" y1={topY} x2={wellWidth} y2={topY} stroke="hsl(var(--border))" strokeWidth="2" />
              <text x={wellWidth / 2} y={topY - 8} textAnchor="middle" className="text-[9px] fill-muted-foreground">Устье</text>

              {/* Open hole walls */}
              <rect x={wellWidth / 2 - pipeWidth - annWidth - 4} y={topY} width={4} height={usableH} fill="hsl(30, 30%, 35%)" rx="1" />
              <rect x={wellWidth / 2 + pipeWidth + annWidth} y={topY} width={4} height={usableH} fill="hsl(30, 30%, 35%)" rx="1" />

              {/* Annulus fluid segments */}
              {annSegments.map((seg, i) => (
                <g key={i}>
                  {/* Left annulus */}
                  <rect
                    x={wellWidth / 2 - pipeWidth - annWidth}
                    y={seg.y}
                    width={annWidth}
                    height={seg.height}
                    fill={FLUID_COLORS[seg.fluid]}
                    opacity={0.85}
                  />
                  {/* Right annulus */}
                  <rect
                    x={wellWidth / 2 + pipeWidth}
                    y={seg.y}
                    width={annWidth}
                    height={seg.height}
                    fill={FLUID_COLORS[seg.fluid]}
                    opacity={0.85}
                  />
                </g>
              ))}

              {/* Casing pipe walls */}
              <rect x={wellWidth / 2 - pipeWidth} y={topY} width={3} height={usableH} fill="hsl(var(--foreground))" opacity={0.6} />
              <rect x={wellWidth / 2 + pipeWidth - 3} y={topY} width={3} height={usableH} fill="hsl(var(--foreground))" opacity={0.6} />

              {/* Pipe interior — just mud color for simplicity */}
              <rect
                x={wellWidth / 2 - pipeWidth + 3}
                y={topY}
                width={pipeWidth * 2 - 6}
                height={usableH}
                fill={FLUID_COLORS.mud}
                opacity={0.3}
              />

              {/* Bottom */}
              <line x1={wellWidth / 2 - pipeWidth - annWidth - 4} y1={botY} x2={wellWidth / 2 + pipeWidth + annWidth + 4} y2={botY} stroke="hsl(30, 30%, 35%)" strokeWidth="3" />
              <text x={wellWidth / 2} y={botY + 14} textAnchor="middle" className="text-[8px] fill-muted-foreground">{casingDepthMD.toFixed(0)} м</text>

              {/* Cement top marker */}
              {currentPoint.annCementHeightM > 0 && (
                <>
                  <line
                    x1={wellWidth / 2 + pipeWidth + annWidth + 6}
                    y1={botY - currentPoint.annCementHeightM * scaleFactor}
                    x2={wellWidth / 2 + pipeWidth + annWidth + 30}
                    y2={botY - currentPoint.annCementHeightM * scaleFactor}
                    stroke="hsl(0, 70%, 50%)"
                    strokeWidth="1"
                    strokeDasharray="3,2"
                  />
                  <text
                    x={wellWidth / 2 + pipeWidth + annWidth + 32}
                    y={botY - currentPoint.annCementHeightM * scaleFactor + 3}
                    className="text-[7px]"
                    fill="hsl(0, 70%, 50%)"
                  >
                    {cementTopMD.toFixed(0)} м
                  </text>
                </>
              )}
            </svg>

            {/* Legend */}
            <div className="flex flex-wrap gap-2 mt-3 justify-center">
              {Object.entries(FLUID_LABELS).map(([key, label]) => (
                <div key={key} className="flex items-center gap-1 text-[10px]">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: FLUID_COLORS[key] }} />
                  <span>{label}</span>
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
            {/* Stage badge */}
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

            {/* Fluid heights bar */}
            <div className="mt-4">
              <div className="text-xs text-muted-foreground mb-1">Состав затрубного пространства</div>
              <div className="h-6 rounded-md overflow-hidden flex" style={{ border: "1px solid hsl(var(--border))" }}>
                {casingDepthMD > 0 && (
                  <>
                    {currentPoint.annDisplHeightM > 0 && (
                      <div
                        style={{ width: `${(currentPoint.annDisplHeightM / casingDepthMD) * 100}%`, backgroundColor: FLUID_COLORS.displacement }}
                        className="h-full transition-all duration-200"
                        title={`Продавка: ${currentPoint.annDisplHeightM.toFixed(1)} м`}
                      />
                    )}
                    {currentPoint.annBufferHeightM > 0 && (
                      <div
                        style={{ width: `${(currentPoint.annBufferHeightM / casingDepthMD) * 100}%`, backgroundColor: FLUID_COLORS.buffer }}
                        className="h-full transition-all duration-200"
                        title={`Буфер: ${currentPoint.annBufferHeightM.toFixed(1)} м`}
                      />
                    )}
                    {currentPoint.annMudHeightM > 0 && (
                      <div
                        style={{ width: `${(currentPoint.annMudHeightM / casingDepthMD) * 100}%`, backgroundColor: FLUID_COLORS.mud }}
                        className="h-full transition-all duration-200"
                        title={`Буровой р-р: ${currentPoint.annMudHeightM.toFixed(1)} м`}
                      />
                    )}
                    {currentPoint.annCementHeightM > 0 && (
                      <div
                        style={{ width: `${(currentPoint.annCementHeightM / casingDepthMD) * 100}%`, backgroundColor: FLUID_COLORS.cement }}
                        className="h-full transition-all duration-200"
                        title={`Цемент: ${currentPoint.annCementHeightM.toFixed(1)} м`}
                      />
                    )}
                  </>
                )}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                <span>Устье (0 м)</span>
                <span>Забой ({casingDepthMD.toFixed(0)} м)</span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-4">
              <div className="text-xs text-muted-foreground mb-1">Прогресс операции</div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-100"
                  style={{ width: `${progressPct}%` }}
                />
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
