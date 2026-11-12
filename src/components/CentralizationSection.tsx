import { centralizerMaterialGeometryKey } from "@/lib/materials-equipment-inventory";
import { boreDiameterAtDepth } from "@/lib/well-geometry";
import ReportContentsDialog from "./ReportContentsDialog";
import { exportCasingDesignDocx } from "@/lib/export-casing-design-docx";
import type { ReportSelection } from "@/lib/cementing-report-options";
import { buildCentralizerJointSchedule, type CentralizationReportData } from "@/lib/cementing-report-data";
import CentralizerCatalogPreview from "./CentralizerCatalogPreview";
import { trajectoryAzimuth } from "@/lib/centralizer-mesh";
import Centralizer3DInspector from "./Centralizer3DInspector";
import { passportWarnings } from "@/lib/centralizer-passports";
import CentralizerPassportFields from "./CentralizerPassportFields";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Calculator, Target, Settings2, Wind } from "lucide-react";
import CopyImageButton from "@/components/CopyImageButton";
import type { WellData } from "@/lib/cementing-calculations";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import CasingRunningSection from "./CasingRunningSection";
import {
  calculateCentralization,
  autoPlaceCentralizers,
  autoPlaceTurbulators,
  calcTurbulenceMultiplier,
  centralizerPresets,
  centralizerTypeLabels,
  placementZoneLabels,
  type CentralizerInterval,
  type CentralizerType,
  type CentralizerSpec,
  type CentralizationResult,
  type AutoPlacementInterval,
  type TurbulatorInterval,
  type TurbulatorPoint,
  type AutoTurbulatorResult,
} from "@/lib/centralization-calculations";

import TriaxialCasingCard from "@/components/TriaxialCasingCard";


interface Props {
  onWellDataChange?: (data: WellData) => void;
  onReportChange?: (data: CentralizationReportData) => void;
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
  /** Расстановка извне (из автоподбора): при смене nonce записывается в интервалы и пересчитывается */
  externalIntervals?: { nonce: number; intervals: CentralizerInterval[] } | null;
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
export default function CentralizationSection({ wellData, mudDensity, fluidPV = 25, fluidYP = 25, flowRateLps = 10, pipeWeightKgPerM, frictionCased = 0.25, frictionOpenhole = 0.35, onResultsChange, onIntervalsChange, externalIntervals, onReportChange, onWellDataChange }: Props) {
  const [reportOpen,setReportOpen]=useState(false),[reportBusy,setReportBusy]=useState(false),[reportError,setReportError]=useState('');
  const [mode, setMode] = useState<CalcMode>(wellData.centralizerDesign?.mode??"manual");
  const [intervals, setIntervals] = useState<CentralizerInterval[]>(() => wellData.centralizerDesign?.intervals??[newInterval(wellData.casingDepthMD)]);
  const [results, setResults] = useState<CentralizationResult[] | null>(null);
  const [selectedMD, setSelectedMD] = useState<number | null>(null);
  const [autoResults, setAutoResults] = useState<AutoPlacementInterval[] | null>(null);

  // Auto mode state
  const [targetStandoff, setTargetStandoff] = useState(wellData.centralizerDesign?.targetStandoff??67);
  const [calculatedTarget, setCalculatedTarget] = useState<number | null>(null);
  const [autoJointLength, setAutoJointLength] = useState(wellData.centralizerDesign?.jointLength??12);
  const [autoSpecType, setAutoSpecType] = useState<CentralizerType>(wellData.centralizerDesign?.autoSpec.type??"rigid");
  const [autoSpec, setAutoSpec] = useState<CentralizerSpec>(wellData.centralizerDesign?.autoSpec??{
    type: "rigid",
    bladesCount: centralizerPresets.rigid.bladesCount!,
    bladeHeight: centralizerPresets.rigid.bladeHeight!,
    restoringForce: centralizerPresets.rigid.restoringForce!,
    maxAxialLoad: centralizerPresets.rigid.maxAxialLoad!,
  });
  // Restore newly loaded project inputs before effects publish a report. Ignore parent echoes.
  const incomingDesign = JSON.stringify(wellData.centralizerDesign ?? null);
  const [lastIncomingDesign,setLastIncomingDesign] = useState(incomingDesign);
  if(lastIncomingDesign!==incomingDesign){
    setLastIncomingDesign(incomingDesign);
    const d=wellData.centralizerDesign;
    const local={mode,targetStandoff,jointLength:autoJointLength,autoSpec,intervals};
    if(!d){
      setMode('manual');setTargetStandoff(67);setAutoJointLength(12);setAutoSpecType('rigid');setAutoSpec({type:'rigid',bladesCount:centralizerPresets.rigid.bladesCount!,bladeHeight:centralizerPresets.rigid.bladeHeight!,restoringForce:centralizerPresets.rigid.restoringForce!,maxAxialLoad:centralizerPresets.rigid.maxAxialLoad!});setIntervals([newInterval(wellData.casingDepthMD)]);setResults(null);setAutoResults(null);setCalculatedTarget(null);
    }else if(JSON.stringify(local)!==JSON.stringify(d)){
      setMode(d.mode);setTargetStandoff(d.targetStandoff);setAutoJointLength(d.jointLength);setAutoSpec(d.autoSpec);setAutoSpecType(d.autoSpec.type);setIntervals(d.intervals);setResults(null);setAutoResults(null);setCalculatedTarget(null);
    }
  }
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


  const geometryKey = JSON.stringify([centralizerMaterialGeometryKey(wellData), mudDensity]);
  const previousGeometryKey = useRef(geometryKey);
  useEffect(() => {
    if (previousGeometryKey.current === geometryKey) return;
    previousGeometryKey.current = geometryKey;
    setResults(null); setAutoResults(null); setCalculatedTarget(null);
    onResultsChange?.(null);
  }, [geometryKey, onResultsChange]);

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
    setResults(null); setAutoResults(null); onResultsChange?.(null);
    setIntervals(prev => prev.map(iv => iv.id === id ? { ...iv, ...patch } : iv));
  }, []);

  const updateSpec = useCallback((id: string, patch: Partial<CentralizerInterval["spec"]>) => {
    setResults(null); setAutoResults(null); onResultsChange?.(null);
    setIntervals(prev => prev.map(iv => iv.id === id ? { ...iv, spec: { ...iv.spec, ...patch } } : iv));
  }, []);

  const applyPreset = useCallback((id: string, type: CentralizerType) => {
    const p = centralizerPresets[type];
    setIntervals(prev => prev.map(iv => iv.id === id ? {
      ...iv,
      spec: { type, bladesCount: p.bladesCount!, bladeHeight: p.bladeHeight!, restoringForce: p.restoringForce!, maxAxialLoad: p.maxAxialLoad! },
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

  // Применение расстановки из автоподбора программы. Состояние обновляется прямо при рендере
  // (синхронно с нажатием «Применить»), а не в эффекте: так обновление не может «зависнуть» в очереди.
  const [appliedNonce, setAppliedNonce] = useState<number | null>(null);
  if (externalIntervals && appliedNonce !== externalIntervals.nonce) {
    const ivs = externalIntervals.intervals.map((iv) => ({ ...iv }));
    setAppliedNonce(externalIntervals.nonce);
    setMode("manual");
    setIntervals(ivs);
    setAutoResults(null);
    setResults(calculateCentralization(wellData, ivs, mudDensity, undefined, turbPoints.length > 0 ? turbPoints : undefined));
  }

  const handleCalculateAuto = useCallback(() => {
    const placement = autoPlaceCentralizers(wellData, autoSpec, autoJointLength, targetStandoff, mudDensity, {
      pumpZoneTop: wellData.pumpZoneTop,
      pumpZoneBottom: wellData.pumpZoneBottom,
    });
    setAutoResults(placement);
    setCalculatedTarget(targetStandoff);

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

  useEffect(() => {
    if (mode !== 'auto' || calculatedTarget === null || calculatedTarget === targetStandoff || targetStandoff < 10 || targetStandoff > 99) return;
    const timer = setTimeout(handleCalculateAuto, 250);
    return () => clearTimeout(timer);
  }, [mode, calculatedTarget, targetStandoff, handleCalculateAuto]);

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

  const runningIntervals = useMemo(() => mode === "auto" && autoResults
    ? autoResults.map((p,i) => ({id:"running-"+i,fromMD:p.fromMD,toMD:p.toMD,centralizersPerJoint:p.centralizersPerJoint,jointLength:autoJointLength,spec:autoSpec}))
    : intervals, [mode,autoResults,autoJointLength,autoSpec,intervals]);

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

    return buildCentralizerJointSchedule(wellData.casingDepthMD, activeIntervals).map(row => ({ ...row, hasCentralizer: row.centralizerDepths.length > 0 }));
  }, [results, intervals, autoResults, autoJointLength, autoSpec, wellData.casingDepthMD]);
  useEffect(() => {
    onReportChange?.({
      mode, targetStandoff, autoSpec, jointLength: autoJointLength,
      running: {mudDensity, pv:fluidPV, yp:fluidYP, pipeWeightKgPerM, frictionCased, frictionOpenhole},
      intervals, results: results ?? [], turbPoints, autoResults: autoResults ?? undefined,
      selectedMD: selectedMD ?? undefined, calculated: !!results?.length, joints: jointSchedule ?? undefined,
    });
  }, [onReportChange, mode, targetStandoff, autoSpec, autoJointLength, intervals, results, turbPoints, autoResults, selectedMD, jointSchedule, mudDensity, fluidPV, fluidYP, pipeWeightKgPerM, frictionCased, frictionOpenhole, wellData.runningSettings]);


  const exportCenter=async(selection:ReportSelection)=>{setReportBusy(true);setReportError('');try{await exportCasingDesignDocx(wellData,{mode,targetStandoff:mode==='auto'?targetStandoff:undefined,autoSpec,jointLength:autoJointLength,intervals:runningIntervals,results:results??[],turbPoints,autoResults:autoResults??undefined,selectedMD:selectedMD??undefined,calculated:!!results?.length,joints:jointSchedule??undefined},mudDensity,'centralization',selection);}catch(e){setReportError(e instanceof Error?e.message:String(e));}finally{setReportBusy(false);}};
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" onClick={()=>setReportOpen(true)} disabled={!results?.length||reportBusy}>{reportBusy?'Формирование…':'Word: центрирование'}</Button><span className="text-xs text-muted-foreground">Отдельный отчёт центрирования без цементажа и дохождения.</span></div>
      <ReportContentsDialog scope="centralization" open={reportOpen} onOpenChange={setReportOpen} onConfirm={exportCenter} busy={reportBusy}/>
      {reportError&&<p role="alert" className="text-destructive">{reportError}</p>}
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

                </div>
                <CentralizerPassportFields spec={iv.spec} casingOD={wellData.casingOD} onChange={spec => updateInterval(iv.id, { spec })} />
                {iv.spec.passport && (!iv.spec.passport.restoringForceKgf || !iv.spec.passport.restoringStandoff) && <CentralizerCatalogPreview spec={iv.spec} wellData={wellData} fromMD={iv.fromMD} toMD={iv.toMD} />}
              </div>
            ))}
            <Button disabled={intervals.some(iv => passportWarnings(iv.spec, wellData.casingOD).length > 0)} onClick={handleCalculateManual} className="w-full gap-2">
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
          <div className="rounded border border-border p-3 space-y-2">
            <p className="text-xs">Из руководства ЦТГП-178/216: 4 лопасти, угол 55°, наружный диаметр не более 210 мм. Высота лопасти вычисляется как (210 − OD трубы) / 2. Обозначение «216» не является наружным диаметром. Эмпирический множитель потока не является паспортной характеристикой.</p>
            <Button variant="outline" onClick={() => { setTurbBladesCount(4); setTurbBladeAngle(55); setTurbBladeHeight(Math.max(0, (210 - wellData.casingOD) / 2)); }}>Внести ЦТГП-178/216 для новых точек</Button>
            {Math.abs(wellData.casingOD - 178) > 1 && <p className="text-xs text-destructive">ЦТГП из паспорта рассчитан на колонну 178 мм. Проверьте выбранную колонну.</p>}
            <p className="text-xs text-muted-foreground">Если изделие уже учтено в интервалах центрирования, не добавляйте его второй раз как отдельное изделие для оценки сопротивления спуску. Для HIGH SLICK 560 угол в паспорте не указан - запросите чертёж или данные изготовителя.</p>
          </div>
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
                    <TableHead className="text-[10px] px-2">Модельный множ.</TableHead>
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
                <label className="text-[10px] text-muted-foreground" htmlFor="centralizer-target">Целевой Standoff, %</label>
                <Input type="number" id="centralizer-target" min={10} max={99} step={1} value={targetStandoff} onChange={e => setTargetStandoff(+e.target.value)} className="h-8 text-xs" />
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

            <p className="text-xs text-muted-foreground">Цель расстановки: {targetStandoff}%. После первого расчёта изменение цели автоматически обновляет количество и результаты. Опорная точка испытания усилия задаёт жёсткость и является отдельным параметром.</p>
            {calculatedTarget !== null && calculatedTarget !== targetStandoff && <p role="status" className="text-sm">Пересчитываем расстановку для цели {targetStandoff}%…</p>}
            <CentralizerPassportFields spec={autoSpec} casingOD={wellData.casingOD} onChange={spec => { setResults(null); setAutoResults(null); onResultsChange?.(null); setAutoSpec(spec); setAutoSpecType(spec.type); }} />

            {autoSpec.passport && (!autoSpec.passport.restoringForceKgf || !autoSpec.passport.restoringStandoff) && <CentralizerCatalogPreview spec={autoSpec} wellData={wellData} toMD={wellData.casingDepthMD} />}
            <Button disabled={passportWarnings(autoSpec, wellData.casingOD).length > 0 || !Number.isFinite(targetStandoff) || targetStandoff < 10 || targetStandoff > 99} onClick={handleCalculateAuto} className="w-full gap-2">
              <Target className="w-4 h-4" /> Рассчитать расстановку
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ═══════ AUTO PLACEMENT TABLE ═══════ */}
      {autoResults && autoResults.length > 0 && mode === "auto" && (
        <Card>
          <CardHeader className="pb-2">
            {autoResults.some(r => r.standoffAchieved < (calculatedTarget ?? targetStandoff)) && <p role="alert" className="text-sm text-destructive">На части интервалов цель не достигается даже при предельной плотности установки. Проверьте достигнутый Standoff в таблице.</p>}
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Расстановка центраторов · цель {calculatedTarget}%</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-normal text-muted-foreground">
                  Всего: <span className="text-foreground font-medium">{totalCentralizers} шт.</span>
                </span>
                <CopyImageButton targetRef={placementTableRef} label="Копировать" />
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(() => {
              const minSo = Math.min(...autoResults.map(r => r.standoffAchieved));
              if (minSo >= targetStandoff - 0.5) return null;
              return (
                <div className="mx-3 mt-3 mb-2 p-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-xs">
                  <div className="font-medium text-amber-700 dark:text-amber-400">
                    ⚠ Целевой Standoff {targetStandoff}% не достигнут в части интервалов (мин. {minSo}%)
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    Достигнут предел плотности (до {Math.max(...autoResults.map(r => r.centralizersPerJoint))} шт./трубу).
                    Попробуйте центратор с большей восстанавливающей силой.
                  </div>
                </div>
              );
            })()}

            <div ref={placementTableRef}>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] px-2">Интервал, м</TableHead>
                    <TableHead className="text-[10px] px-2">Зона</TableHead>
                    <TableHead className="text-[10px] px-2">Ср. зенит, °</TableHead>
                    <TableHead className="text-[10px] px-2">DLS, °/30м</TableHead>
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
                      <TableCell className="text-xs px-2 py-1.5">{placementZoneLabels[r.zone]}</TableCell>
                      <TableCell className="text-xs px-2 py-1.5">{r.avgZenith}°</TableCell>
                      <TableCell className="text-xs px-2 py-1.5">{r.maxDLS}</TableCell>
                      <TableCell className="text-xs px-2 py-1.5 font-medium">{r.centralizersPerJoint}</TableCell>
                      <TableCell className="text-xs px-2 py-1.5">{(autoJointLength / Math.max(0.01, r.centralizersPerJoint)).toFixed(1)}</TableCell>
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

          {selectedResult && (() => {
            const spec = autoResults ? autoSpec : intervals.find(iv => iv.id === selectedResult.intervalId)?.spec;
            const cased = selectedResult.md <= (wellData.prevCasingDepth || 0) && wellData.prevCasingID > 0;
            const currentIntervals = autoResults ? autoResults.map((iv, i) => ({ id: String(i), fromMD: iv.fromMD, toMD: iv.toMD, jointLength: autoJointLength, centralizersPerJoint: iv.centralizersPerJoint, spec: autoSpec })) : intervals;
            const currentResult = calculateCentralization(wellData, currentIntervals, mudDensity, undefined, undefined, {fromMD:selectedResult.md, toMD:selectedResult.md})[0];
            return spec && currentResult ? <div className="space-y-2"><label className="text-sm">Выберите глубину для 3D<select aria-label="Глубина 3D" className="block bg-background border border-input rounded p-2" value={selectedResult.md} onChange={e => setSelectedMD(+e.target.value)}>{results.map(r => <option key={r.md} value={r.md}>{r.md} м MD</option>)}</select></label><Centralizer3DInspector targetStandoff={mode === 'auto' ? calculatedTarget ?? undefined : undefined} spec={spec} result={currentResult} azimuth={trajectoryAzimuth(wellData.trajectory, currentResult.md)} casingID={casingID} casingOD={wellData.casingOD} boreDiameter={boreDiameterAtDepth(wellData,currentResult.md)} cased={cased} /></div> : null;
          })()}
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
                  holeD={boreDiameterAtDepth(wellData,selectedResult?.md??0)}
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
          <CasingRunningSection
            wellData={wellData}
            mudDensity={mudDensity}
            intervals={runningIntervals}
            turbPoints={turbPoints}
            pipeWeightKgPerM={pipeWeightKgPerM}
            frictionCased={frictionCased}
            frictionOpenhole={frictionOpenhole}
            pv={fluidPV}
            yp={fluidYP}
            onSettingsChange={runningSettings => onWellDataChange?.({...wellData, runningSettings})}
          />

          <TriaxialCasingCard wellData={wellData} mudDensity={mudDensity} />
        </>
      )}
    </div>
  );
}
