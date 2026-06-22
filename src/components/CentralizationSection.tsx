import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Calculator, Target, Settings2, Wind, TrendingDown } from "lucide-react";
import CopyImageButton from "@/components/CopyImageButton";
import type { WellData } from "@/lib/cementing-calculations";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import { calculateTDSummary, calculateTD, type TDInput, type TDSummary, type TDResult, type CentralizerDragItem } from "@/lib/torque-drag-calculations";
import {
  calculateCentralization,
  autoPlaceCentralizers,
  autoPlaceTurbulators,
  calcTurbulenceMultiplier,
  centralizerPresets,
  centralizerTypeLabels,
  type CentralizerInterval,
  type CentralizerType,
  type CentralizerSpec,
  type CentralizationResult,
  type AutoPlacementInterval,
  type TurbulatorInterval,
  type TurbulatorPoint,
  type AutoTurbulatorResult,
} from "@/lib/centralization-calculations";
import { calculateRunningForces, type RunningForceResult } from "@/lib/casing-running-forces";
import { Wrench } from "lucide-react";

interface Props {
  wellData: WellData;
  mudDensity: number;
  fluidPV?: number;
  fluidYP?: number;
  flowRateLps?: number;
  pipeWeightKgPerM?: number;
  frictionCased?: number;
  frictionOpenhole?: number;
  onResultsChange?: (results: CentralizationResult[] | null) => void;
  onIntervalsChange?: (intervals: CentralizerInterval[]) => void;
}

type CalcMode = "manual" | "auto";

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getCasingEdgeDistanceOnRay(angle: number, offset: number, casingOuterRadius: number) {
  const sinA = Math.sin(angle);
  const b = -2 * sinA * offset;
  const c = offset * offset - casingOuterRadius * casingOuterRadius;
  const disc = b * b - 4 * c;

  if (disc < 0) return casingOuterRadius;

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-b + sqrtDisc) / 2;
  const t2 = (-b - sqrtDisc) / 2;

  return Math.max(t1, t2);
}

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

function newInterval(casingDepthMD: number): CentralizerInterval {
  const preset = centralizerPresets.rigid;
  return {
    id: makeId(),
    fromMD: 0,
    toMD: casingDepthMD,
    centralizersPerJoint: 1,
    jointLength: 12,
    spec: {
      type: "rigid",
      bladesCount: preset.bladesCount!,
      bladeHeight: preset.bladeHeight!,
      restoringForce: preset.restoringForce!,
      maxAxialLoad: preset.maxAxialLoad!,
    },
  };
}

// ─── Cross-section Canvas — annular cement distribution ──────────
function CrossSectionView({ eccentricity, holeD, casingOD, casingID, standoff }: {
  eccentricity: number; holeD: number; casingOD: number; casingID: number; standoff?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = 280;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = 2;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const cx = size / 2, cy = size / 2;
    const maxR = (size - 20) / 2;
    const scale = maxR / (holeD / 2);
    const holeR = (holeD / 2) * scale;
    const casODR = (casingOD / 2) * scale;
    const casIDR = (casingID / 2) * scale;
    const clearance = holeR - casODR;
    const nominalGap = Math.max(clearance, 1);
    const offset = eccentricity * clearance;
    const standoffValue = standoff ?? Math.max(0, (1 - eccentricity) * 100);
    const centeringSeverity = clamp01(Math.max(eccentricity, (100 - standoffValue) / 100));

    // Render pixel-perfect at full resolution (no ctx.scale — manual dpr)
    const W = size * dpr;
    const imgData = ctx.createImageData(W, W);
    const pixels = imgData.data;

    for (let py = 0; py < W; py++) {
      for (let px = 0; px < W; px++) {
        const x = px / dpr - cx;
        const y = py / dpr - cy;

        const distHole = Math.sqrt(x * x + y * y);
        const distCasing = Math.sqrt(x * x + (y - offset) * (y - offset));

        const idx = (py * W + px) * 4;

        if (distHole > holeR + 0.5) {
          pixels[idx + 3] = 0;
          continue;
        }

        if (distCasing < casIDR - 0.5) {
          // Inside casing — dark void
          pixels[idx] = 22; pixels[idx + 1] = 24; pixels[idx + 2] = 30; pixels[idx + 3] = 255;
          continue;
        }

        if (distCasing >= casIDR - 0.5 && distCasing <= casODR + 0.5) {
          // Casing wall — metallic gradient based on angle from casing center
          const angleFromCenter = Math.atan2(x, -(y - offset));
          const casingFrac = (distCasing - casIDR) / (casODR - casIDR);
          // Metallic highlight: brighter on top-left, darker on bottom-right
          const highlight = 0.5 + 0.5 * Math.cos(angleFromCenter - 0.8);
          const baseVal = 80 + highlight * 100;
          const edgeDark = 1 - Math.pow(Math.abs(casingFrac - 0.5) * 2, 2) * 0.3;
          const v = Math.round(baseVal * edgeDark);
          pixels[idx] = v; pixels[idx + 1] = v + 2; pixels[idx + 2] = v + 5; pixels[idx + 3] = 255;
          continue;
        }

        if (distCasing > casODR && distHole <= holeR) {
          // Annulus — dark = cement, light = mud channel.
          // Important: brightness must depend on the ABSOLUTE narrowing of the gap,
          // not on min/max normalization of the current frame. Otherwise even tiny
          // eccentricity creates a full white band, which is physically wrong.
          const angle = Math.atan2(y, x);
          const casingEdgeDist = getCasingEdgeDistanceOnRay(angle, offset, casODR);
          const localGap = Math.max(0, holeR - casingEdgeDist);
          const localGapRatio = clamp01(localGap / nominalGap);
          const gapNarrowing = clamp01(1 - localGapRatio);
          const channelRisk = clamp01(Math.pow(gapNarrowing * Math.max(centeringSeverity, 0.001), 0.72) * 1.6);

          // Brighter mud channels: dark cement ~25, bright mud channel ~235.
          // With good centering (e.g. standoff 95–100%) channelRisk stays near zero,
          // so the annulus remains uniformly dark.
          const darkVal = 25;
          const lightVal = 235;
          const baseVal = darkVal + channelRisk * (lightVal - darkVal);

          // Radial texture only in poor-displacement zones; remove "patches"
          // when the pipe is centered well.
          const radFrac = (distCasing - casODR) / Math.max(1, localGap);
          const textureShift = Math.sin(radFrac * Math.PI) * 8 * Math.min(1, channelRisk * 1.4);
          const finalVal = Math.max(18, Math.min(240, baseVal + textureShift));

          pixels[idx] = finalVal;
          pixels[idx + 1] = finalVal;
          pixels[idx + 2] = Math.min(255, finalVal + 4);
          pixels[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // All further drawing uses dpr-scaled coordinates directly (no ctx.scale)
    const D = dpr;

    // Hole boundary — earthy brown
    ctx.strokeStyle = "hsl(30, 20%, 42%)";
    ctx.lineWidth = 2.5 * D;
    ctx.beginPath();
    ctx.arc(cx * D, cy * D, holeR * D, 0, Math.PI * 2);
    ctx.stroke();

    // Casing OD outline
    ctx.strokeStyle = "hsl(210, 12%, 60%)";
    ctx.lineWidth = 1.5 * D;
    ctx.beginPath();
    ctx.arc(cx * D, (cy + offset) * D, casODR * D, 0, Math.PI * 2);
    ctx.stroke();

    // Casing ID outline
    ctx.strokeStyle = "hsl(210, 10%, 38%)";
    ctx.lineWidth = 1 * D;
    ctx.beginPath();
    ctx.arc(cx * D, (cy + offset) * D, casIDR * D, 0, Math.PI * 2);
    ctx.stroke();

    // Center dots
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.arc(cx * D, cy * D, 3 * D, 0, Math.PI * 2);
    ctx.fill();

    if (offset > 3) {
      ctx.fillStyle = "#3b82f6";
      ctx.beginPath();
      ctx.arc(cx * D, (cy + offset) * D, 3 * D, 0, Math.PI * 2);
      ctx.fill();
    }

    // Legend gradient bar
    const barX = 12 * D;
    const barY = (size - 60) * D;
    const barW = 12 * D;
    const barH = 50 * D;
    for (let i = 0; i < barH; i++) {
      const f = i / barH;
      const v = Math.round(25 + f * (235 - 25));
      ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
      ctx.fillRect(barX, barY + i, barW, 1);
    }
    ctx.strokeStyle = "hsl(210, 10%, 40%)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.fillStyle = "#aaa";
    ctx.font = `${9 * D}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText("100%", barX + barW + 4, barY + 9 * D);
    ctx.fillText("0%", barX + barW + 4, barY + barH);

  }, [eccentricity, holeD, casingOD, casingID, size, standoff]);

  return <canvas ref={canvasRef} className="mx-auto" />;
}

function standoffColor(standoff: number): string {
  if (standoff >= 67) return "text-green-400";
  if (standoff >= 50) return "text-yellow-400";
  return "text-red-400";
}

function standoffBg(standoff: number): string {
  if (standoff >= 67) return "bg-green-500";
  if (standoff >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

// ─── Main component ─────────────────────────────────────────────
export default function CentralizationSection({ wellData, mudDensity, fluidPV = 25, fluidYP = 25, flowRateLps = 10, pipeWeightKgPerM, frictionCased = 0.25, frictionOpenhole = 0.35, onResultsChange, onIntervalsChange }: Props) {
  const [mode, setMode] = useState<CalcMode>("manual");
  const [intervals, setIntervals] = useState<CentralizerInterval[]>(() => [newInterval(wellData.casingDepthMD)]);
  const [results, setResults] = useState<CentralizationResult[] | null>(null);
  const [selectedMD, setSelectedMD] = useState<number | null>(null);
  const [autoResults, setAutoResults] = useState<AutoPlacementInterval[] | null>(null);

  // Auto mode state
  const [targetStandoff, setTargetStandoff] = useState(67);
  const [autoJointLength, setAutoJointLength] = useState(12);
  const [autoSpecType, setAutoSpecType] = useState<CentralizerType>("rigid");
  const [autoSpec, setAutoSpec] = useState<CentralizerSpec>({
    type: "rigid",
    bladesCount: centralizerPresets.rigid.bladesCount!,
    bladeHeight: centralizerPresets.rigid.bladeHeight!,
    restoringForce: centralizerPresets.rigid.restoringForce!,
    maxAxialLoad: centralizerPresets.rigid.maxAxialLoad!,
  });
  // Turbulizer state — point-based manual + auto
  const [turbPoints, setTurbPoints] = useState<TurbulatorPoint[]>([]);
  const [autoTurbResults, setAutoTurbResults] = useState<AutoTurbulatorResult[] | null>(null);
  const [turbSpacing, setTurbSpacing] = useState(6);
  const [turbBladesCount, setTurbBladesCount] = useState(4);
  const [turbBladeAngle, setTurbBladeAngle] = useState(45);
  const [turbBladeHeight, setTurbBladeHeight] = useState(15);

  const addTurbPoint = useCallback(() => {
    setTurbPoints(prev => [...prev, {
      id: makeId(),
      md: 0,
      bladesCount: turbBladesCount,
      bladeAngle: turbBladeAngle,
      bladeHeight: turbBladeHeight,
    }]);
  }, [turbBladesCount, turbBladeAngle, turbBladeHeight]);

  const removeTurbPoint = useCallback((id: string) => {
    setTurbPoints(prev => prev.filter(t => t.id !== id));
  }, []);

  const updateTurbPoint = useCallback((id: string, patch: Partial<TurbulatorPoint>) => {
    setTurbPoints(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  const handleAutoTurbulators = useCallback(() => {
    const { points, summary } = autoPlaceTurbulators(
      wellData, mudDensity, fluidPV, fluidYP, flowRateLps,
      turbBladesCount, turbBladeAngle, turbBladeHeight, turbSpacing
    );
    setTurbPoints(points);
    setAutoTurbResults(summary);
  }, [wellData, mudDensity, fluidPV, fluidYP, flowRateLps, turbBladesCount, turbBladeAngle, turbBladeHeight, turbSpacing]);


  const crossSectionRef = useRef<HTMLDivElement>(null);
  const standoffProfileRef = useRef<HTMLDivElement>(null);
  const resultsTableRef = useRef<HTMLDivElement>(null);
  const placementTableRef = useRef<HTMLDivElement>(null);
  const jointScheduleTableRef = useRef<HTMLDivElement>(null);


  const casingID = wellData.casingOD - 2 * wellData.casingWall;

  const addInterval = useCallback(() => {
    setIntervals(prev => [...prev, newInterval(wellData.casingDepthMD)]);
  }, [wellData.casingDepthMD]);

  const removeInterval = useCallback((id: string) => {
    setIntervals(prev => prev.filter(iv => iv.id !== id));
  }, []);

  const updateInterval = useCallback((id: string, patch: Partial<CentralizerInterval>) => {
    setIntervals(prev => prev.map(iv => iv.id === id ? { ...iv, ...patch } : iv));
  }, []);

  const updateSpec = useCallback((id: string, patch: Partial<CentralizerInterval["spec"]>) => {
    setIntervals(prev => prev.map(iv => iv.id === id ? { ...iv, spec: { ...iv.spec, ...patch } } : iv));
  }, []);

  const applyPreset = useCallback((id: string, type: CentralizerType) => {
    const p = centralizerPresets[type];
    setIntervals(prev => prev.map(iv => iv.id === id ? {
      ...iv,
      spec: { ...iv.spec, type, bladesCount: p.bladesCount!, bladeHeight: p.bladeHeight!, restoringForce: p.restoringForce!, maxAxialLoad: p.maxAxialLoad! },
    } : iv));
  }, []);

  const applyAutoPreset = useCallback((type: CentralizerType) => {
    const p = centralizerPresets[type];
    setAutoSpecType(type);
    setAutoSpec({
      type,
      bladesCount: p.bladesCount!,
      bladeHeight: p.bladeHeight!,
      restoringForce: p.restoringForce!,
      maxAxialLoad: p.maxAxialLoad!,
    });
  }, []);

  const handleCalculateManual = useCallback(() => {
    const res = calculateCentralization(wellData, intervals, mudDensity, undefined, turbPoints.length > 0 ? turbPoints : undefined);
    setResults(res);
    setAutoResults(null);
    onResultsChange?.(res);
    onIntervalsChange?.(intervals);
    if (res.length > 0) {
      const worst = res.reduce((a, b) => a.eccentricity > b.eccentricity ? a : b);
      setSelectedMD(worst.md);
    }
  }, [wellData, intervals, mudDensity, turbPoints, onResultsChange, onIntervalsChange]);

  const handleCalculateAuto = useCallback(() => {
    const placement = autoPlaceCentralizers(wellData, autoSpec, autoJointLength, targetStandoff, mudDensity);
    setAutoResults(placement);

    const autoIntervals: CentralizerInterval[] = placement.map(p => ({
      id: makeId(),
      fromMD: p.fromMD,
      toMD: p.toMD,
      centralizersPerJoint: p.centralizersPerJoint,
      jointLength: autoJointLength,
      spec: { ...autoSpec },
    }));

    const res = calculateCentralization(wellData, autoIntervals, mudDensity, undefined, turbPoints.length > 0 ? turbPoints : undefined);
    setResults(res);
    onResultsChange?.(res);
    onIntervalsChange?.(autoIntervals);
    if (res.length > 0) {
      const worst = res.reduce((a, b) => a.eccentricity > b.eccentricity ? a : b);
      setSelectedMD(worst.md);
    }
  }, [wellData, autoSpec, autoJointLength, targetStandoff, mudDensity, turbPoints, onResultsChange, onIntervalsChange]);

  const selectedResult = useMemo(() => {
    if (results && selectedMD !== null) {
      return results.find(r => r.md === selectedMD) ?? null;
    }
    return null;
  }, [results, selectedMD]);

  const avgStandoff = useMemo(() => {
    if (!results || results.length === 0) return null;
    return Math.round(results.reduce((s, r) => s + r.standoff, 0) / results.length * 10) / 10;
  }, [results]);

  const minStandoff = useMemo(() => {
    if (!results || results.length === 0) return null;
    return Math.min(...results.map(r => r.standoff));
  }, [results]);

  const totalCentralizers = useMemo(() => {
    if (!autoResults) return null;
    return autoResults.reduce((s, r) => s + r.totalCentralizers, 0);
  }, [autoResults]);

  // ─── Generate joint-by-joint placement schedule for field crew ───
  const jointSchedule = useMemo(() => {
    if (!results || results.length === 0) return null;

    // Determine active intervals (from manual or auto mode)
    const activeIntervals: CentralizerInterval[] = autoResults
      ? autoResults.map(p => ({
          id: makeId(),
          fromMD: p.fromMD,
          toMD: p.toMD,
          centralizersPerJoint: p.centralizersPerJoint,
          jointLength: autoJointLength,
          spec: { ...autoSpec },
        }))
      : intervals;

    // Build joint-by-joint list from surface (0) down to casing shoe
    const schedule: { jointNum: number; topMD: number; bottomMD: number; hasCentralizer: boolean; centralizerDepths: number[] }[] = [];
    
    let currentMD = 0;
    let jointNum = 1;
    const totalDepth = wellData.casingDepthMD;

    while (currentMD < totalDepth) {
      // Find which interval this joint falls into
      const midMD = currentMD;
      const interval = activeIntervals.find(iv => midMD >= iv.fromMD && midMD < iv.toMD);
      const jl = interval?.jointLength ?? 12;
      const bottomMD = Math.min(currentMD + jl, totalDepth);

      let hasCent = false;
      const centDepths: number[] = [];

      if (interval && interval.centralizersPerJoint > 0) {
        const cpj = interval.centralizersPerJoint;
        if (cpj >= 1) {
          // ≥1 centralizer per joint: place evenly along the joint
          const count = Math.floor(cpj);
          const spacing = jl / (count + 1);
          for (let c = 1; c <= count; c++) {
            centDepths.push(Math.round(currentMD + spacing * c));
          }
          hasCent = true;
        } else {
          // <1 centralizer per joint (e.g. 0.5 = every 2nd joint, 0.3 = every ~3rd)
          const everyNth = Math.round(1 / cpj);
          if ((jointNum - 1) % everyNth === 0) {
            centDepths.push(Math.round(currentMD + jl / 2));
            hasCent = true;
          }
        }
      }

      schedule.push({
        jointNum,
        topMD: Math.round(currentMD),
        bottomMD: Math.round(bottomMD),
        hasCentralizer: hasCent,
        centralizerDepths: centDepths,
      });

      currentMD = bottomMD;
      jointNum++;
    }

    return schedule;
  }, [results, intervals, autoResults, autoJointLength, autoSpec, wellData.casingDepthMD]);

  return (
    <div className="space-y-4">
      {/* Mode switcher */}
      <div className="flex gap-2">
        <Button
          variant={mode === "manual" ? "default" : "outline"}
          size="sm"
          className="gap-1.5 flex-1"
          onClick={() => setMode("manual")}
        >
          <Settings2 className="w-3.5 h-3.5" />
          Ручная расстановка
        </Button>
        <Button
          variant={mode === "auto" ? "default" : "outline"}
          size="sm"
          className="gap-1.5 flex-1"
          onClick={() => setMode("auto")}
        >
          <Target className="w-3.5 h-3.5" />
          По целевому Standoff
        </Button>
      </div>

      {/* ═══════ MANUAL MODE ═══════ */}
      {mode === "manual" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Интервалы установки центраторов</span>
              <Button size="sm" variant="outline" onClick={addInterval} className="text-xs gap-1">
                <Plus className="w-3 h-3" /> Добавить интервал
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {intervals.map((iv, idx) => (
              <div key={iv.id} className="border border-border rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Интервал {idx + 1}</span>
                  {intervals.length > 1 && (
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeInterval(iv.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">От (MD), м</label>
                    <Input type="number" value={iv.fromMD || ""} onChange={e => updateInterval(iv.id, { fromMD: +e.target.value })} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">До (MD), м</label>
                    <Input type="number" value={iv.toMD || ""} onChange={e => updateInterval(iv.id, { toMD: +e.target.value })} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Тип центратора</label>
                    <Select value={iv.spec.type} onValueChange={(v) => applyPreset(iv.id, v as CentralizerType)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(centralizerTypeLabels) as CentralizerType[]).map(t => (
                          <SelectItem key={t} value={t}>{centralizerTypeLabels[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Центр. на трубу</label>
                    <Input type="number" min={0} step={0.1} value={iv.centralizersPerJoint || ""} onChange={e => updateInterval(iv.id, { centralizersPerJoint: +e.target.value })} className="h-8 text-xs" />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground">Длина трубы, м</label>
                    <Input type="number" value={iv.jointLength || ""} onChange={e => updateInterval(iv.id, { jointLength: +e.target.value })} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Кол-во планок</label>
                    <Input type="number" value={iv.spec.bladesCount || ""} onChange={e => updateSpec(iv.id, { bladesCount: +e.target.value })} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Вылет планки, мм</label>
                    <Input type="number" value={iv.spec.bladeHeight || ""} onChange={e => updateSpec(iv.id, { bladeHeight: +e.target.value })} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Восст. сила, кН</label>
                    <Input type="number" step={0.1} value={iv.spec.restoringForce || ""} onChange={e => updateSpec(iv.id, { restoringForce: +e.target.value })} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">Макс. осев. нагр., кН</label>
                    <Input type="number" value={iv.spec.maxAxialLoad || ""} onChange={e => updateSpec(iv.id, { maxAxialLoad: +e.target.value })} className="h-8 text-xs" />
                  </div>
                </div>
              </div>
            ))}
            <Button onClick={handleCalculateManual} className="w-full gap-2">
              <Calculator className="w-4 h-4" /> Рассчитать центрирование
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ═══════ TURBULIZERS — POINT-BASED ═══════ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="flex items-center gap-1.5"><Wind className="w-4 h-4" /> Турбулизаторы потока</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={addTurbPoint} className="text-xs gap-1">
                <Plus className="w-3 h-3" /> Добавить точку
              </Button>
              <Button size="sm" variant="secondary" onClick={handleAutoTurbulators} className="text-xs gap-1">
                <Target className="w-3 h-3" /> Авто
              </Button>
            </div>
          </CardTitle>
          <p className="text-[10px] text-muted-foreground mt-1">
            Установите турбулизаторы на конкретных глубинах. «Авто» расставит их в зонах ламинарного потока с учётом реологии (PV={fluidPV} сПз, YP={fluidYP} Па, Q={flowRateLps} л/с).
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Auto-placement params */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground">Шаг расстановки, м</label>
              <Input type="number" min={1} max={50} value={turbSpacing} onChange={e => setTurbSpacing(+e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Кол-во лопастей</label>
              <Input type="number" min={2} max={8} value={turbBladesCount} onChange={e => setTurbBladesCount(+e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Угол лопасти, °</label>
              <Input type="number" min={15} max={75} step={5} value={turbBladeAngle} onChange={e => setTurbBladeAngle(+e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground">Высота лопасти, мм</label>
              <Input type="number" min={5} max={30} value={turbBladeHeight} onChange={e => setTurbBladeHeight(+e.target.value)} className="h-8 text-xs" />
            </div>
          </div>

          {/* Auto results summary */}
          {autoTurbResults && autoTurbResults.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] px-2">Интервал, м</TableHead>
                    <TableHead className="text-[10px] px-2">Кол-во</TableHead>
                    <TableHead className="text-[10px] px-2">Шаг, м</TableHead>
                    <TableHead className="text-[10px] px-2">Re исх.</TableHead>
                    <TableHead className="text-[10px] px-2">Re с турб.</TableHead>
                    <TableHead className="text-[10px] px-2">Множ. (расч.)</TableHead>
                    <TableHead className="text-[10px] px-2">Режим</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {autoTurbResults.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs px-2 py-1">{r.fromMD}–{r.toMD}</TableCell>
                      <TableCell className="text-xs px-2 py-1 font-medium">{r.count}</TableCell>
                      <TableCell className="text-xs px-2 py-1">{r.spacingM}</TableCell>
                      <TableCell className="text-xs px-2 py-1">{r.avgReOriginal}</TableCell>
                      <TableCell className="text-xs px-2 py-1 font-medium">{r.avgReWithTurb}</TableCell>
                      <TableCell className="text-xs px-2 py-1 font-medium">×{r.turbMultiplier}</TableCell>
                      <TableCell className="text-xs px-2 py-1">{r.flowRegime}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {autoTurbResults && autoTurbResults.length === 0 && (
            <p className="text-xs text-green-400 text-center py-2">Поток уже турбулентный — турбулизаторы не требуются</p>
          )}

          {turbPoints.length === 0 && !autoTurbResults && (
            <p className="text-xs text-muted-foreground text-center py-2">Нет точек установки. Добавьте вручную или нажмите «Авто».</p>
          )}

          {/* Manual points list */}
          {turbPoints.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] px-2">Глубина, м</TableHead>
                    <TableHead className="text-[10px] px-2">Лопасти</TableHead>
                    <TableHead className="text-[10px] px-2">Угол, °</TableHead>
                    <TableHead className="text-[10px] px-2">Высота, мм</TableHead>
                    <TableHead className="text-[10px] px-2">Расч. множ.</TableHead>
                    <TableHead className="text-[10px] px-2 w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {turbPoints.map((tp) => {
                    const annGap = (wellData.holeDiameter - wellData.casingOD) / 2;
                    const mult = calcTurbulenceMultiplier(tp.bladesCount, tp.bladeAngle, tp.bladeHeight, annGap);
                    return (
                    <TableRow key={tp.id}>
                      <TableCell className="px-1 py-0.5">
                        <Input type="number" value={tp.md || ""} onChange={e => updateTurbPoint(tp.id, { md: +e.target.value })} className="h-7 text-xs w-28" />
                      </TableCell>
                      <TableCell className="px-1 py-0.5">
                        <Input type="number" min={2} max={8} value={tp.bladesCount} onChange={e => updateTurbPoint(tp.id, { bladesCount: +e.target.value })} className="h-7 text-xs w-14" />
                      </TableCell>
                      <TableCell className="px-1 py-0.5">
                        <Input type="number" min={15} max={75} step={5} value={tp.bladeAngle} onChange={e => updateTurbPoint(tp.id, { bladeAngle: +e.target.value })} className="h-7 text-xs w-14" />
                      </TableCell>
                      <TableCell className="px-1 py-0.5">
                        <Input type="number" min={5} max={30} value={tp.bladeHeight} onChange={e => updateTurbPoint(tp.id, { bladeHeight: +e.target.value })} className="h-7 text-xs w-14" />
                      </TableCell>
                      <TableCell className="px-1 py-0.5 text-xs text-blue-400 font-medium">
                        ×{mult}
                      </TableCell>
                      <TableCell className="px-1 py-0.5">
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeTurbPoint(tp.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">Всего турбулизаторов: <span className="text-foreground font-medium">{turbPoints.length} шт.</span></p>
        </CardContent>
      </Card>
      {mode === "auto" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Целевой Standoff — автоматическая расстановка</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-muted-foreground">Целевой Standoff, %</label>
                <Input type="number" min={10} max={99} step={1} value={targetStandoff} onChange={e => setTargetStandoff(+e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Длина трубы, м</label>
                <Input type="number" value={autoJointLength} onChange={e => setAutoJointLength(+e.target.value)} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Тип центратора</label>
                <Select value={autoSpecType} onValueChange={(v) => applyAutoPreset(v as CentralizerType)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(centralizerTypeLabels) as CentralizerType[]).map(t => (
                      <SelectItem key={t} value={t}>{centralizerTypeLabels[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Spec details */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground">Кол-во планок</label>
                <Input type="number" value={autoSpec.bladesCount} onChange={e => setAutoSpec(s => ({ ...s, bladesCount: +e.target.value }))} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Вылет планки, мм</label>
                <Input type="number" value={autoSpec.bladeHeight} onChange={e => setAutoSpec(s => ({ ...s, bladeHeight: +e.target.value }))} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Восст. сила, кН</label>
                <Input type="number" step={0.1} value={autoSpec.restoringForce} onChange={e => setAutoSpec(s => ({ ...s, restoringForce: +e.target.value }))} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Макс. осев. нагр., кН</label>
                <Input type="number" value={autoSpec.maxAxialLoad} onChange={e => setAutoSpec(s => ({ ...s, maxAxialLoad: +e.target.value }))} className="h-8 text-xs" />
              </div>
            </div>

            <Button onClick={handleCalculateAuto} className="w-full gap-2">
              <Target className="w-4 h-4" /> Рассчитать расстановку
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ═══════ AUTO PLACEMENT TABLE ═══════ */}
      {autoResults && autoResults.length > 0 && mode === "auto" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Расстановка центраторов по интервалам</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-normal text-muted-foreground">
                  Всего: <span className="text-foreground font-medium">{totalCentralizers} шт.</span>
                </span>
                <CopyImageButton targetRef={placementTableRef} label="Копировать" />
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div ref={placementTableRef}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] px-2">Интервал, м</TableHead>
                    <TableHead className="text-[10px] px-2">Ср. зенит, °</TableHead>
                    <TableHead className="text-[10px] px-2">Центр./трубу</TableHead>
                    <TableHead className="text-[10px] px-2">Шаг, м</TableHead>
                    <TableHead className="text-[10px] px-2">Standoff, %</TableHead>
                    <TableHead className="text-[10px] px-2">Кол-во, шт</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {autoResults.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs px-2 py-1.5">{r.fromMD} — {r.toMD}</TableCell>
                      <TableCell className="text-xs px-2 py-1.5">{r.avgZenith}°</TableCell>
                      <TableCell className="text-xs px-2 py-1.5 font-medium">{r.centralizersPerJoint}</TableCell>
                      <TableCell className="text-xs px-2 py-1.5">{(autoJointLength / r.centralizersPerJoint).toFixed(1)}</TableCell>
                      <TableCell className={`text-xs px-2 py-1.5 font-medium ${standoffColor(r.standoffAchieved)}`}>{r.standoffAchieved}%</TableCell>
                      <TableCell className="text-xs px-2 py-1.5 font-medium">{r.totalCentralizers}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════ RESULTS (shared) ═══════ */}
      {results && results.length > 0 && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-[10px] text-muted-foreground">Средний Standoff</p>
                <p className={`text-xl font-bold ${standoffColor(avgStandoff ?? 0)}`}>{avgStandoff}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-[10px] text-muted-foreground">Мин. Standoff</p>
                <p className={`text-xl font-bold ${standoffColor(minStandoff ?? 0)}`}>{minStandoff}%</p>
              </CardContent>
            </Card>
            <Card className="col-span-2 sm:col-span-1">
              <CardContent className="pt-4 pb-3 text-center">
                <p className="text-[10px] text-muted-foreground">Точек расчёта</p>
                <p className="text-xl font-bold text-foreground">{results.length}</p>
              </CardContent>
            </Card>
          </div>

          {/* Cross-section preview */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Поперечное сечение</span>
                <CopyImageButton targetRef={crossSectionRef} label="Копировать" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div ref={crossSectionRef} className="flex flex-col sm:flex-row items-center gap-4">
                <CrossSectionView
                  eccentricity={selectedResult?.eccentricity ?? 0}
                  holeD={wellData.holeDiameter}
                  casingOD={wellData.casingOD}
                  casingID={casingID}
                  standoff={selectedResult?.standoff}
                />
                <div className="text-xs space-y-1 text-muted-foreground">
                  {selectedResult && (
                    <>
                      <p>Глубина: <span className="text-foreground font-medium">{selectedResult.md} м (MD)</span></p>
                      <p>Зенит: <span className="text-foreground font-medium">{selectedResult.zenith.toFixed(1)}°</span></p>
                      <p>Эксцентриситет: <span className="text-foreground font-medium">{selectedResult.eccentricity.toFixed(3)}</span></p>
                      <p>Standoff: <span className={`font-medium ${standoffColor(selectedResult.standoff)}`}>{selectedResult.standoff.toFixed(1)}%</span></p>
                      <p>Центратор: <span className="text-foreground font-medium">{selectedResult.hasCentralizer ? "Да" : "Нет"}</span></p>
                    </>
                  )}
                  <p className="text-[10px] mt-2">Нажмите на строку таблицы для просмотра сечения</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Standoff bar chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Профиль Standoff по стволу</span>
                <CopyImageButton targetRef={standoffProfileRef} label="Копировать" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div ref={standoffProfileRef}>
                <div className="h-40 flex items-end gap-[1px] overflow-hidden">
                  {results.map((r, i) => {
                    const h = Math.max(1, r.standoff);
                    const bg = standoffBg(r.standoff);
                    return (
                      <div
                        key={i}
                        className={`flex-1 min-w-[2px] ${bg} cursor-pointer opacity-80 hover:opacity-100 transition-opacity`}
                        style={{ height: `${h}%` }}
                        title={`${r.md}м: ${r.standoff}%`}
                        onClick={() => setSelectedMD(r.md)}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>0 м</span>
                  <span>{wellData.casingDepthMD} м</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Data table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>Таблица результатов</span>
                <CopyImageButton targetRef={resultsTableRef} label="Копировать" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div ref={resultsTableRef} className="max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] px-2">MD, м</TableHead>
                      <TableHead className="text-[10px] px-2">TVD, м</TableHead>
                      <TableHead className="text-[10px] px-2">Зенит, °</TableHead>
                      <TableHead className="text-[10px] px-2">Эксц.</TableHead>
                      <TableHead className="text-[10px] px-2">Standoff, %</TableHead>
                      <TableHead className="text-[10px] px-2">Турб.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r, i) => (
                      <TableRow
                        key={i}
                        className={`cursor-pointer ${selectedMD === r.md ? "bg-primary/10" : ""}`}
                        onClick={() => setSelectedMD(r.md)}
                      >
                        <TableCell className="text-xs px-2 py-1">{r.md}</TableCell>
                        <TableCell className="text-xs px-2 py-1">{r.tvd.toFixed(1)}</TableCell>
                        <TableCell className="text-xs px-2 py-1">{r.zenith.toFixed(1)}</TableCell>
                        <TableCell className="text-xs px-2 py-1">{r.eccentricity.toFixed(3)}</TableCell>
                        <TableCell className={`text-xs px-2 py-1 font-medium ${standoffColor(r.standoff)}`}>{r.standoff.toFixed(1)}</TableCell>
                        <TableCell className="text-xs px-2 py-1">
                          {r.hasTurbulizer ? <span className="text-blue-400 font-medium">×{r.turbulenceMultiplier.toFixed(1)}</span> : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* JOINT-BY-JOINT PLACEMENT SCHEDULE */}
          {jointSchedule && jointSchedule.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Таблица спуска — расстановка центраторов</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-normal text-muted-foreground">
                      Всего Ф: <span className="text-primary font-bold">{jointSchedule.filter(j => j.hasCentralizer).length} шт.</span>
                      {' '}/ {jointSchedule.length} труб
                    </span>
                    <CopyImageButton targetRef={jointScheduleTableRef} label="Копировать" />
                  </div>
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">Спуск с устья. Ф — установить центратор на указанной глубине.</p>
              </CardHeader>
              <CardContent className="p-0">
                <div ref={jointScheduleTableRef} className="max-h-[500px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px] px-2 w-12">№ трубы</TableHead>
                        <TableHead className="text-[10px] px-2">Верх, м</TableHead>
                        <TableHead className="text-[10px] px-2">Низ, м</TableHead>
                        <TableHead className="text-[10px] px-2 text-center">Центратор</TableHead>
                        <TableHead className="text-[10px] px-2">Глубина уст., м</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {jointSchedule.map((j) => (
                        <TableRow key={j.jointNum} className={j.hasCentralizer ? "bg-primary/5" : ""}>
                          <TableCell className="text-xs px-2 py-1 font-medium">{j.jointNum}</TableCell>
                          <TableCell className="text-xs px-2 py-1">{j.topMD}</TableCell>
                          <TableCell className="text-xs px-2 py-1">{j.bottomMD}</TableCell>
                          <TableCell className="text-xs px-2 py-1 text-center">
                            {j.hasCentralizer ? <span className="text-primary font-bold text-sm">Ф</span> : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-xs px-2 py-1 font-medium">
                            {j.centralizerDepths.length > 0 ? j.centralizerDepths.map(d => `${d} м`).join(", ") : ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}


          {/* ═══════ T&D CHARTS — Спуск колонны с учётом центраторов ═══════ */}
          <TDChartsBlock
            wellData={wellData}
            mudDensity={mudDensity}
            intervals={autoResults
              ? autoResults.map(p => ({
                  id: makeId(), fromMD: p.fromMD, toMD: p.toMD,
                  centralizersPerJoint: p.centralizersPerJoint,
                  jointLength: autoJointLength, spec: { ...autoSpec },
                }))
              : intervals
            }
            turbPoints={turbPoints}
            autoTurbResults={autoTurbResults}
            turbBladeHeight={turbBladeHeight}
            pipeWeightKgPerM={pipeWeightKgPerM}
            frictionCased={frictionCased}
            frictionOpenhole={frictionOpenhole}
            fluidPV={fluidPV}
            fluidYP={fluidYP}
          />

          {results && results.length > 0 && (
            <RunningForcesCard
              wellData={wellData}
              mudDensity={mudDensity}
              frictionCoeff={frictionOpenhole}
              centralizerIntervals={intervals}
              centralization={results}
            />
          )}

          <TriaxialCasingCard wellData={wellData} mudDensity={mudDensity} />
        </>
      )}
    </div>
  );
}

// ─── T&D Charts sub-component ────────────────────────────────────
function TDChartsBlock({
  wellData, mudDensity, intervals, turbPoints, autoTurbResults, turbBladeHeight,
  pipeWeightKgPerM, frictionCased, frictionOpenhole, fluidPV, fluidYP,
}: {
  wellData: WellData; mudDensity: number; intervals: CentralizerInterval[];
  turbPoints?: TurbulatorPoint[]; autoTurbResults?: AutoTurbulatorResult[] | null;
  turbBladeHeight?: number;
  pipeWeightKgPerM?: number; frictionCased: number; frictionOpenhole: number;
  fluidPV: number; fluidYP: number;
}) {
  const tdChartRef = useRef<HTMLDivElement>(null);

  // Default pipe weight from casing geometry
  const casingID = wellData.casingOD - 2 * wellData.casingWall;
  const defaultPipeWeight = Math.PI / 4 * ((wellData.casingOD / 1000) ** 2 - (casingID / 1000) ** 2) * 7850;
  const pipeWt = pipeWeightKgPerM ?? defaultPipeWeight;

  const tdData = useMemo(() => {
    // Build centralizer drag items from centralization intervals
    const centDrag: CentralizerDragItem[] = intervals
      .filter(iv => iv.centralizersPerJoint > 0)
      .map(iv => ({
        fromMD: iv.fromMD,
        toMD: iv.toMD,
        centralizersPerJoint: iv.centralizersPerJoint,
        jointLength: iv.jointLength,
        dragForcePerUnit: iv.spec.type === "rigid" ? 2.0 : iv.spec.type === "solid" ? 3.0 : 0.8,
      }));

    // Add turbulizer drag — turbulizers create flow restriction → additional drag during trip
    // Drag per turbulizer ≈ 0.3–1.0 kN depending on blade height
    const bladeH = turbBladeHeight ?? 15;
    const annGap = (wellData.holeDiameter - wellData.casingOD) / 2;
    const blockageRatio = Math.min(0.7, bladeH / annGap);
    const turbDragPerUnit = 0.3 + blockageRatio * 1.5; // kN per turbulizer

    // Manual turbulizer points → treat each as a drag point (small interval around it)
    if (turbPoints && turbPoints.length > 0) {
      for (const tp of turbPoints) {
        if (tp.md > 0) {
          centDrag.push({
            fromMD: tp.md - 0.5,
            toMD: tp.md + 0.5,
            centralizersPerJoint: 1,
            jointLength: 1,
            dragForcePerUnit: turbDragPerUnit,
          });
        }
      }
    }
    // Auto turbulizer results → intervals with spacing
    if (autoTurbResults && autoTurbResults.length > 0) {
      for (const at of autoTurbResults) {
        const spacing = at.toMD - at.fromMD > 0 ? (at.toMD - at.fromMD) / Math.max(1, Math.round((at.toMD - at.fromMD) / 6)) : 6;
        centDrag.push({
          fromMD: at.fromMD,
          toMD: at.toMD,
          centralizersPerJoint: 1,
          jointLength: spacing,
          dragForcePerUnit: turbDragPerUnit,
        });
      }
    }

    const input: TDInput = {
      trajectory: wellData.trajectory,
      wellDepthMD: wellData.casingDepthMD,
      casingDepthMD: wellData.casingDepthMD,
      casingShoe: wellData.casingDepthMD,
      holeDiameter: wellData.holeDiameter,
      casingOD: wellData.casingOD,
      casingID: casingID,
      pipeWeightKgPerM: pipeWt,
      mudDensity: mudDensity / 1000, // кг/м³ → г/см³
      frictionCased,
      frictionOpenhole,
      wob: 0,
      rpm: 0,
      blockWeight: 50,
      centralizerDrag: centDrag,
      fluidSegments: [{
        name: "Буровой раствор", density: mudDensity,
        pv: fluidPV, yp: fluidYP,
        topMD: 0, bottomMD: wellData.casingDepthMD,
      }],
      tripSpeedMps: 0.5,
    };

    const summary = calculateTDSummary(input);
    // Additional modes
    const pickup = calculateTD(input, 'pickup');
    const slackoff = calculateTD(input, 'slackoff');

    return { summary, pickup, slackoff };
  }, [wellData, mudDensity, intervals, pipeWt, frictionCased, frictionOpenhole, fluidPV, fluidYP, casingID]);

  const { summary, pickup, slackoff } = tdData;

  // Prepare chart data
  const chartData = useMemo(() => {
    return summary.tripIn.points.map((pt, i) => {
      const tripOutPt = summary.tripOut.points[i];
      const rotatePt = summary.rotate.points[i];
      const pickupPt = pickup.points[i];
      const slackoffPt = slackoff.points[i];
      return {
        md: pt.md,
        tripIn: +(pt.hookLoad / 9.81).toFixed(1),       // кН → тонн
        tripOut: +(tripOutPt?.hookLoad / 9.81).toFixed(1) || 0,
        freeWeight: +(summary.freeWeight * pt.md / summary.tripIn.points[summary.tripIn.points.length - 1].md / 9.81).toFixed(1),
        pickup: +(pickupPt?.hookLoad / 9.81).toFixed(1) || 0,
        slackoff: +(slackoffPt?.hookLoad / 9.81).toFixed(1) || 0,
        torqueRot: +(rotatePt?.torque ?? 0).toFixed(2),
        sideForce: +(pt.sideForce ?? 0).toFixed(2),
        centDrag: +(pt.centralizerDragForce ?? 0).toFixed(2),
        viscDrag: +(pt.viscousDrag ?? 0).toFixed(2),
        dragForce: +(pt.dragForce ?? 0).toFixed(2),
      };
    });
  }, [summary, pickup, slackoff]);

  // Doliv (top-up) calculation: when pipe sinks into mud, fluid level drops in annulus
  // Doliv volume per joint ≈ pipe displacement volume
  const pipeDisplPerM = Math.PI / 4 * (wellData.casingOD / 1000) ** 2; // m³/m (outer volume)
  const pipeInternalPerM = Math.PI / 4 * (casingID / 1000) ** 2;
  const annularArea = Math.PI / 4 * ((wellData.holeDiameter / 1000) ** 2 - (wellData.casingOD / 1000) ** 2);

  // Level drop per joint spud: displacement of steel + filling inside
  const dolivPerJoint = (jointLen: number) => {
    const steelVol = (pipeDisplPerM - pipeInternalPerM) * jointLen;
    // Mud rises in annulus by: steel volume / annular area → that's fine
    // But pipe internal volume needs filling → doliv needed = pipe internal volume per joint
    return pipeInternalPerM * jointLen;
  };

  const jointLen = intervals[0]?.jointLength ?? 12;
  const dolivM3 = dolivPerJoint(jointLen);
  const totalDolivM3 = pipeInternalPerM * wellData.casingDepthMD;

  // Max hook load and drag
  const maxTripInHL = summary.tripIn.maxHookLoad / 9.81;
  const maxTripOutHL = summary.tripOut.maxHookLoad / 9.81;
  const maxTorque = summary.rotate.maxTorque;
  const freeWtTons = summary.freeWeight / 9.81;
  const totalCentDrag = summary.tripIn.totalCentralizerDrag ?? 0;
  const totalViscDrag = summary.tripIn.totalViscousDrag ?? 0;
  const overpull = maxTripOutHL - freeWtTons; // затяжка, тонн

  const fmt = (v: number, d: number = 1) => v.toFixed(d);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingDown className="w-4 h-4" />
            Расчёт спуска колонны (с учётом центраторов)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <div className="rounded-lg border border-border p-2 text-center">
              <p className="text-[10px] text-muted-foreground">Свободный вес</p>
              <p className="text-sm font-bold text-foreground">{fmt(freeWtTons, 1)} т</p>
            </div>
            <div className="rounded-lg border border-border p-2 text-center">
              <p className="text-[10px] text-muted-foreground">Вес при спуске</p>
              <p className="text-sm font-bold text-foreground">{fmt(maxTripInHL, 1)} т</p>
            </div>
            <div className="rounded-lg border border-border p-2 text-center">
              <p className="text-[10px] text-muted-foreground">Вес при подъёме</p>
              <p className="text-sm font-bold text-foreground">{fmt(maxTripOutHL, 1)} т</p>
            </div>
            <div className={`rounded-lg border p-2 text-center ${overpull > 20 ? "border-destructive" : "border-border"}`}>
              <p className="text-[10px] text-muted-foreground">Затяжка (макс.)</p>
              <p className={`text-sm font-bold ${overpull > 20 ? "text-destructive" : "text-foreground"}`}>{fmt(overpull, 1)} т</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <div className="rounded-lg border border-border p-2 text-center">
              <p className="text-[10px] text-muted-foreground">Макс. момент</p>
              <p className="text-sm font-bold text-foreground">{fmt(maxTorque, 2)} кН·м</p>
            </div>
            <div className="rounded-lg border border-border p-2 text-center">
              <p className="text-[10px] text-muted-foreground">Сопр. центраторов</p>
              <p className="text-sm font-bold text-foreground">{fmt(totalCentDrag, 1)} кН</p>
            </div>
            <div className="rounded-lg border border-border p-2 text-center">
              <p className="text-[10px] text-muted-foreground">Вязкостное сопр.</p>
              <p className="text-sm font-bold text-foreground">{fmt(totalViscDrag, 1)} кН</p>
            </div>
            <div className="rounded-lg border border-border p-2 text-center">
              <p className="text-[10px] text-muted-foreground">Долив (на трубу / всего)</p>
              <p className="text-sm font-bold text-foreground">{fmt(dolivM3 * 1000, 0)} л / {fmt(totalDolivM3, 2)} м³</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div ref={tdChartRef}>
        {/* Hook Load chart */}
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Вес на крюке при спуске колонны</span>
              <CopyImageButton targetRef={tdChartRef} label="Копировать" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="md" label={{ value: "MD, м", position: "insideBottom", offset: -3, style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                <YAxis label={{ value: "тонн", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="tripIn" name="Спуск" stroke="hsl(200, 70%, 50%)" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="tripOut" name="Подъём" stroke="hsl(0, 70%, 50%)" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="freeWeight" name="Своб. вес" stroke="hsl(var(--muted-foreground))" dot={false} strokeWidth={1} strokeDasharray="5 5" />
                <Line type="monotone" dataKey="pickup" name="Расхаживание↑" stroke="hsl(45, 80%, 50%)" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="slackoff" name="Посадка↓" stroke="hsl(280, 60%, 55%)" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Torque chart */}
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Крутящий момент (вращение)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="md" tick={{ fontSize: 9 }} />
                <YAxis label={{ value: "кН·м", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Line type="monotone" dataKey="torqueRot" name="Момент" stroke="hsl(30, 80%, 55%)" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Drag forces chart */}
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Силы сопротивления при спуске</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="md" tick={{ fontSize: 9 }} />
                <YAxis label={{ value: "кН", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 9 }} />
                <Tooltip contentStyle={{ fontSize: 11, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="dragForce" name="Трение" stroke="hsl(0, 60%, 50%)" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="centDrag" name="Центраторы" stroke="hsl(120, 50%, 50%)" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="viscDrag" name="Вязкость" stroke="hsl(200, 60%, 50%)" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="sideForce" name="Боковая сила" stroke="hsl(280, 50%, 55%)" dot={false} strokeWidth={1.5} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Running forces / Bending stresses card ──────────────────────

function RunningForcesCard({
  wellData,
  mudDensity,
  frictionCoeff,
  centralizerIntervals,
  centralization,
}: {
  wellData: WellData;
  mudDensity: number;
  frictionCoeff: number;
  centralizerIntervals: CentralizerInterval[];
  centralization: CentralizationResult[];
}) {
  const [grade, setGrade] = useState<"K-55" | "N-80" | "P-110">("N-80");

  const res: RunningForceResult = useMemo(
    () =>
      calculateRunningForces({
        wellData,
        mudDensity,
        frictionCoeff,
        centralizerIntervals,
        centralization,
        casingGrade: grade,
      }),
    [wellData, mudDensity, frictionCoeff, centralizerIntervals, centralization, grade],
  );

  const utilColor =
    res.bendingUtilization >= 0.9
      ? "text-red-600 dark:text-red-400"
      : res.bendingUtilization >= 0.7
      ? "text-amber-600 dark:text-amber-400"
      : "text-emerald-600 dark:text-emerald-400";

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Wrench className="h-4 w-4" />
          Усилия установки колонны и изгибные напряжения
        </CardTitle>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Группа:</span>
          {(["K-55", "N-80", "P-110"] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrade(g)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                grade === g ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">
          Soft-string модель (Johansik): осевые силы и боковая нагрузка от DLS,
          изгиб от посадки между центраторами, сжатие bow-spring.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MiniStat label="Сухой вес" value={`${res.hookloadDryKN.toFixed(0)} кН`} />
          <MiniStat label="Вес с плавучестью" value={`${res.hookloadBuoyKN.toFixed(0)} кН`} />
          <MiniStat
            label="Слак-офф (спуск)"
            value={`${res.hookloadRunningKN.toFixed(0)} кН`}
            sub={res.willRunFreely ? "проходит свободно" : "может застрять"}
            status={res.willRunFreely ? "ok" : "danger"}
          />
          <MiniStat label="Пик-ап (подъём)" value={`${res.hookloadPickupKN.toFixed(0)} кН`} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <div className="rounded-lg border p-2.5">
            <div className="text-[10px] text-muted-foreground">Макс. изгибное σ</div>
            <div className={`text-base font-bold font-mono ${utilColor}`}>
              {res.maxBendingStressMPa.toFixed(0)} МПа
            </div>
            <div className="text-[10px] text-muted-foreground">
              {(res.bendingUtilization * 100).toFixed(0)}% от σ_T ({res.yieldStrengthMPa.toFixed(0)} МПа)
            </div>
          </div>
          <div className="rounded-lg border p-2.5">
            <div className="text-[10px] text-muted-foreground">Ср. сжатие bow-spring</div>
            <div className="text-base font-bold font-mono">{res.avgSpringCompression.toFixed(0)}%</div>
            <div className="text-[10px] text-muted-foreground">от свободной длины</div>
          </div>
          <div className="rounded-lg border p-2.5">
            <div className="text-[10px] text-muted-foreground">Макс. сжатие bow-spring</div>
            <div className={`text-base font-bold font-mono ${res.maxSpringCompression > 90 ? "text-red-600 dark:text-red-400" : ""}`}>
              {res.maxSpringCompression.toFixed(0)}%
            </div>
            <div className="text-[10px] text-muted-foreground">{res.maxSpringCompression > 90 ? "близко к пределу" : "в норме"}</div>
          </div>
        </div>

        <ul className="space-y-1">
          {res.warnings.map((w, i) => (
            <li key={i} className="text-[11px] text-muted-foreground flex gap-2">
              <span>•</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function MiniStat({
  label,
  value,
  sub,
  status,
}: {
  label: string;
  value: string;
  sub?: string;
  status?: "ok" | "danger";
}) {
  const c = status === "danger" ? "text-red-600 dark:text-red-400" : status === "ok" ? "text-emerald-600 dark:text-emerald-400" : "";
  return (
    <div className="rounded-lg border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-bold font-mono ${c}`}>{value}</div>
      {sub && <div className={`text-[10px] ${c || "text-muted-foreground"}`}>{sub}</div>}
    </div>
  );
}
