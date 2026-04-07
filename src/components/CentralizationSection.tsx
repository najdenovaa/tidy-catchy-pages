import { useState, useMemo, useCallback, useRef } from "react";
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

// ─── Cross-section SVG ───────────────────────────────────────────
function CrossSectionView({ eccentricity, holeD, casingOD, casingID }: {
  eccentricity: number; holeD: number; casingOD: number; casingID: number;
}) {
  const size = 220;
  const cx = size / 2, cy = size / 2;
  const scale = (size - 40) / holeD;
  const holeR = (holeD / 2) * scale;
  const casODR = (casingOD / 2) * scale;
  const casIDR = (casingID / 2) * scale;
  const clearance = holeR - casODR;
  const offset = eccentricity * clearance;

  return (
    <svg width={size} height={size} className="mx-auto">
      <circle cx={cx} cy={cy} r={holeR} fill="hsl(var(--muted))" stroke="hsl(var(--border))" strokeWidth={2} />
      <circle cx={cx} cy={cy + offset} r={casODR} fill="hsl(var(--secondary))" stroke="hsl(var(--foreground))" strokeWidth={1.5} />
      <circle cx={cx} cy={cy + offset} r={casIDR} fill="hsl(var(--background))" stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
      <circle cx={cx} cy={cy} r={2} fill="hsl(var(--destructive))" />
      <circle cx={cx} cy={cy + offset} r={2} fill="hsl(var(--primary))" />
      <text x={cx + 5} y={cy - 5} fill="hsl(var(--destructive))" fontSize={9}>ось скважины</text>
      {offset > 8 && (
        <text x={cx + 5} y={cy + offset - 5} fill="hsl(var(--primary))" fontSize={9}>ось колонны</text>
      )}
    </svg>
  );
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
export default function CentralizationSection({ wellData, mudDensity, fluidPV = 25, fluidYP = 25, flowRateLps = 10, onResultsChange, onIntervalsChange }: Props) {
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
                        <Input type="number" value={tp.md || ""} onChange={e => updateTurbPoint(tp.id, { md: +e.target.value })} className="h-7 text-xs w-20" />
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
                  <span>📋 Таблица спуска — расстановка центраторов</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    Всего Ф: <span className="text-primary font-bold">{jointSchedule.filter(j => j.hasCentralizer).length} шт.</span>
                    {' '}/ {jointSchedule.length} труб
                  </span>
                </CardTitle>
                <p className="text-[10px] text-muted-foreground">Спуск с устья. Ф — установить центратор на указанной глубине.</p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[500px] overflow-auto">
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
                        <TableRow
                          key={j.jointNum}
                          className={j.hasCentralizer ? "bg-primary/5" : ""}
                        >
                          <TableCell className="text-xs px-2 py-1 font-medium">{j.jointNum}</TableCell>
                          <TableCell className="text-xs px-2 py-1">{j.topMD}</TableCell>
                          <TableCell className="text-xs px-2 py-1">{j.bottomMD}</TableCell>
                          <TableCell className="text-xs px-2 py-1 text-center">
                            {j.hasCentralizer
                              ? <span className="text-primary font-bold text-sm">Ф</span>
                              : <span className="text-muted-foreground">—</span>
                            }
                          </TableCell>
                          <TableCell className="text-xs px-2 py-1 font-medium">
                            {j.centralizerDepths.length > 0
                              ? j.centralizerDepths.map(d => `${d} м`).join(", ")
                              : ""
                            }
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
