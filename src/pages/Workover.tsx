import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import SaveToCabinetDialog, { type SaveCalcPayload } from "@/components/SaveToCabinetDialog";
import { openWorkoverReport, type ReportSection } from "@/lib/workover-report";
import * as XLSX from "xlsx";
import { calculateTVDFromSurvey, type TrajectoryPoint } from "@/lib/cementing-calculations";
import { Link, useSearchParams } from "react-router-dom";
import { Home, ArrowLeft, Wrench, Anchor, Activity, Magnet, Search, Construction as Crane, Droplets } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { BlurInput } from "@/components/BlurInput";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine, BarChart, Bar,
} from "recharts";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import TermsFooter from "@/components/TermsFooter";
import {
  STEEL_GRADES, CONNECTION_LABELS, type ConnectionType, GOST_TUBING_SIZES, tvdAtMD,
  pipeYieldForceKN, pipeBodyYieldKN, pipeTorsionalYieldKNm, STUCK_LABELS,
  calculatePacker, calculatePackerRelease, calculateDrag, calculateLubricant,
  calculateFreePoint, diagnoseStuck, calculateFishing, calculateRigCapacity,
  calculateKill, KILL_FLUIDS,
  KILL_SALTS, calculateBrineRecipe, autoSelectSalt, planMultiIntervalKill,
  type WorkoverWellData, type PackerInput, type PackerReleaseInput, type DragInput, type LubricantInput,
  type FreePointInput, type StuckSymptoms, type FishingInput, type RigInput, type KillInput,
  type KillSalt, type KillInterval,
} from "@/lib/workover-calculations";
import { Trash2, Plus, Waves, Layers, Save, FileDown } from "lucide-react";
import {
  calculateCleanout, checkCasing, calculateSwab, calculateBlockingPill, selectFishingTools, calculateBackOff,
  type CleanoutInput, type CasingCheckInput, type SwabInput, type BlockingPillInput, type FishingToolInput,
} from "@/lib/workover-operations";

const num = (v: string) => (isNaN(parseFloat(v)) ? 0 : parseFloat(v));

const NumberField = memo(function NumberField({ label, value, onChange, unit, hint, step = "any" }: {
  label: string; value: number; onChange: (v: number) => void; unit?: string; hint?: string; step?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}{unit && <span className="text-muted-foreground/70"> ({unit})</span>}</Label>
      <BlurInput type="number" step={step} value={value} onValueCommit={(v) => onChange(num(v))} className="h-9" />
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
});

const DEFAULT_WELL: WorkoverWellData = {
  wellDepthMD: 2500,
  trajectory: calculateTVDFromSurvey([
    { md: 0, tvd: 0, zenith: 0, azimuth: 0 },
    { md: 800, tvd: 800, zenith: 0, azimuth: 0 },
    { md: 1500, tvd: 0, zenith: 35, azimuth: 90 },
    { md: 2500, tvd: 0, zenith: 55, azimuth: 90 },
  ]),
  casingID_mm: 152,
  holeDiameter_mm: 215.9,
  pipeOD_mm: 73,
  pipeID_mm: 62,
  pipeWeight_kgm: 9.67,
  pipeGrade: "Е",
  pipeYieldMPa: STEEL_GRADES["Е"],
  pipeYoungModulusGPa: 210,
  fluidDensity_gcm3: 1.10,
  fluidPV_cP: 15,
  fluidYP_Pa: 5,
  connectionType: "nu",
  pipeConditionPct: 100,
};

export default function Workover() {
  const [well, setWell] = useState<WorkoverWellData>(DEFAULT_WELL);
  const updateWell = <K extends keyof WorkoverWellData>(k: K, v: WorkoverWellData[K]) =>
    setWell((w) => ({ ...w, [k]: v }));

  // ──── Траектория ────
  const [trajOpen, setTrajOpen] = useState(false);
  const trajFileRef = useRef<HTMLInputElement>(null);
  const updateTrajectory = (pts: TrajectoryPoint[]) => {
    const calc = calculateTVDFromSurvey(pts.filter((p) => Number.isFinite(p.md)));
    setWell((w) => ({ ...w, trajectory: calc }));
  };
  const importTrajectory = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "array" });
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        const find = (row: Record<string, unknown>, keys: string[]) => {
          for (const k of Object.keys(row)) if (keys.some((s) => k.toLowerCase().includes(s))) return row[k];
          return null;
        };
        const pts = rows.map((r) => ({
          md: parseFloat(String(find(r, ["md", "глубина", "depth", "ствол"]))),
          zenith: parseFloat(String(find(r, ["zenith", "зенит", "incl", "угол"]))),
          azimuth: parseFloat(String(find(r, ["azimuth", "азимут", "az"]))),
          tvd: 0,
        })).filter((p) => [p.md, p.zenith, p.azimuth].every(Number.isFinite));
        if (pts.length >= 2) {
          updateTrajectory(pts);
          setTrajOpen(true);
          const lastMD = Math.max(...pts.map((p) => p.md));
          if (lastMD > well.wellDepthMD) updateWell("wellDepthMD", lastMD);
        }
      } catch { /* неверный файл — оставляем текущую траекторию */ }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const pipeYield = useMemo(() => pipeYieldForceKN(well), [well]);
  const pipeBody = useMemo(() => pipeBodyYieldKN(well), [well]);

  // ──── Drag + lubricant ────
  const [drag, setDrag] = useState<DragInput>({ operation: "pull_out", frictionCoeff: 0.30 });
  const [lube, setLube] = useState<LubricantInput>({
    name: "DeAll Slip-X", concentration: 2, baseFrictionCoeff: 0.34,
    lubricatedFrictionCoeff: 0.12, penetrationIndex: 7,
  });
  const [useLube, setUseLube] = useState(false);
  const dragNoLube = useMemo(() => calculateDrag({ ...drag, lubricant: undefined }, well), [drag, well]);
  const dragLube = useMemo(() => calculateDrag({ ...drag, lubricant: lube }, well), [drag, well, lube]);
  const activeDrag = useLube ? dragLube : dragNoLube;
  /** Нагрузка на крюке при подъёме колонны длиной depth (вес + затяжки), кН */
  const pullOutLoadTo = (depth: number) =>
    calculateDrag({ operation: "pull_out", frictionCoeff: drag.frictionCoeff }, { ...well, wellDepthMD: Math.max(10, Math.min(depth, well.wellDepthMD)) }).maxHookLoadKN;
  const pullOutFull = useMemo(() => pullOutLoadTo(well.wellDepthMD), [well, drag.frictionCoeff]); // eslint-disable-line react-hooks/exhaustive-deps

  // ──── Rig (used by summary) ────
  const [rig, setRig] = useState<RigInput>({
    rigCapacityKN: 1000, derrickCapacityKN: 1250, safetyFactor: 1.5, currentHookLoadKN: 0,
  });
  const rigHookAuto = rig.currentHookLoadKN <= 0;
  const rigEffective = useMemo<RigInput>(
    () => ({ ...rig, currentHookLoadKN: rigHookAuto ? pullOutFull : rig.currentHookLoadKN }),
    [rig, rigHookAuto, pullOutFull],
  );
  const rigResult = useMemo(() => calculateRigCapacity(rigEffective), [rigEffective]);

  // ──── Packer ────
  const [packer, setPacker] = useState<PackerInput>({
    type: "hydraulic", setDepthMD: 2200, sealBoreID_mm: 80, ratingDiffMPa: 35, ratingLoadKN: 300,
    connection: "free", sealStrokeMM: 1500,
    tubingSurfaceMPa0: 0, annulusSurfaceMPa0: 0, tubingFluidDensity0: 1.10, annulusFluidDensity: 1.10,
    tubingSurfaceMPa1: 15, annulusSurfaceMPa1: 0, tubingFluidDensity1: 1.10, avgTempChangeC: -20,
  });
  const packerResult = useMemo(() => calculatePacker(packer, well), [packer, well]);

  // ──── Packer RELEASE ────
  const [releaseExtra, setReleaseExtra] = useState({
    releaseShearKN: 90, extraStuckKN: 0, pipeWeightAboveKN: 0,
  });
  const weightAbovePackerAuto = useMemo(() => pullOutLoadTo(packer.setDepthMD), [well, drag.frictionCoeff, packer.setDepthMD]); // eslint-disable-line react-hooks/exhaustive-deps
  const weightAbovePacker = releaseExtra.pipeWeightAboveKN > 0 ? releaseExtra.pipeWeightAboveKN : weightAbovePackerAuto;
  const releaseResult = useMemo(() => calculatePackerRelease({
    packerType: packer.type,
    releaseShearKN: releaseExtra.releaseShearKN,
    extraStuckKN: releaseExtra.extraStuckKN,
    pipeWeightAboveKN: weightAbovePacker,
    pipeTensileLimitKN: pipeYield,
    rigAllowableKN: rigResult.allowableLoadKN,
  } as PackerReleaseInput), [packer.type, releaseExtra, weightAbovePacker, pipeYield, rigResult.allowableLoadKN]);

  // ──── Kill ────
  const [kill, setKill] = useState<KillInput>({
    method: "wait_weight",
    formationPressureMPa: 28, reservoirDepthTVD: 2200, fracturePressureMPa: 42,
    currentMudDensity: 1.10,
    wellDepthMD: 2500, casingID_mm: 152, tubingOD_mm: 73, tubingID_mm: 62,
    killFluidPV_cP: 20, killFluidYP_Pa: 6, pumpRateLs: 8, safetyMarginPct: 5, marginMode: "pb",
  });
  // Геометрия и текущая жидкость — из общих данных скважины
  const killInput = useMemo<KillInput>(() => ({
    ...kill,
    wellDepthMD: well.wellDepthMD, casingID_mm: well.casingID_mm,
    tubingOD_mm: well.pipeOD_mm, tubingID_mm: well.pipeID_mm,
    currentMudDensity: well.fluidDensity_gcm3,
    currentFluidPV_cP: well.fluidPV_cP, currentFluidYP_Pa: well.fluidYP_Pa,
  }), [kill, well]);
  const killResult = useMemo(() => calculateKill(killInput), [killInput]);
  const killChart = useMemo(() => {
    // Ожидание/бурильщик: ICP → FCP, пока жидкость глушения заполняет НКТ, далее FCP.
    // Задавка: начальное → конечное устьевое давление по объёму НКТ.
    const isBull = kill.method === "bullhead";
    const p0 = isBull ? killResult.bullheadSurfacePressureMPa : killResult.initialCircPressureMPa;
    const p1 = isBull ? killResult.bullheadEndPressureMPa : killResult.finalCircPressureMPa;
    const vt = killResult.tubingVolumeM3;
    const vTotal = isBull ? vt : killResult.killVolumeM3;
    const steps = 30;
    const out: { v: number; p: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const v = (vTotal * i) / steps;
      const f = Math.min(1, v / Math.max(1e-6, vt));
      out.push({ v: +v.toFixed(2), p: +(p0 + (p1 - p0) * f).toFixed(2) });
    }
    return out;
  }, [killResult, kill.method]);

  // ──── Рецептура жидкости глушения ────
  const [brineSaltId, setBrineSaltId] = useState<string>("auto");
  const [brineTargetDensity, setBrineTargetDensity] = useState<number>(0); // 0 = из killResult
  const [brineVolumeM3, setBrineVolumeM3] = useState<number>(0);            // 0 = из killResult
  const [brineMixing, setBrineMixing] = useState<"low" | "medium" | "high">("medium");
  const [brineTempC, setBrineTempC] = useState<number>(20);
  const effectiveBrineDensity = brineTargetDensity > 0 ? brineTargetDensity : killResult.killDensity;
  const effectiveBrineVolume = brineVolumeM3 > 0 ? brineVolumeM3 : killResult.killVolumeM3;
  const selectedSalt: KillSalt | null = brineSaltId === "auto"
    ? autoSelectSalt(effectiveBrineDensity)
    : KILL_SALTS.find((s) => s.id === brineSaltId) || null;
  const brineRecipe = useMemo(() => {
    if (!selectedSalt) return null;
    return calculateBrineRecipe(selectedSalt, effectiveBrineDensity, Math.max(0.1, effectiveBrineVolume), brineMixing, brineTempC);
  }, [selectedSalt, effectiveBrineDensity, effectiveBrineVolume, brineMixing, brineTempC]);

  // ──── Многоинтервальное глушение ────
  const [killIntervals, setKillIntervals] = useState<KillInterval[]>([
    { topMD: 1900, bottomMD: 1950, topTVD: 1750, bottomTVD: 1790, formationPressureMPa: 19, fracturePressureMPa: 30, intervalType: "kick_zone", requiredKillDensity: 0 },
    { topMD: 2300, bottomMD: 2400, topTVD: 2050, bottomTVD: 2125, formationPressureMPa: 24, fracturePressureMPa: 36, intervalType: "kill_zone", requiredKillDensity: 0 },
  ]);
  const multiIntervalPlan = useMemo(() => {
    if (!selectedSalt || killIntervals.length === 0) return null;
    return planMultiIntervalKill(killIntervals, selectedSalt, Math.max(0.1, effectiveBrineVolume), brineMixing, kill.safetyMarginPct, brineTempC, kill.marginMode ?? "manual");
  }, [killIntervals, selectedSalt, effectiveBrineVolume, brineMixing, kill.safetyMarginPct, brineTempC, kill.marginMode]);

  // ──── Stuck pipe ────
  const [fp, setFp] = useState<FreePointInput>({ pulledForceKN: 196, measuredStretchM: 1.5 });
  const fpResult = useMemo(() => calculateFreePoint(fp, well, drag.frictionCoeff), [fp, well, drag.frictionCoeff]);
  const [symptoms, setSymptoms] = useState<StuckSymptoms>({
    canRotate: true, canMoveDown: false, canMoveUp: false,
    stuckDepthMD: 1800, circulation: "restricted", onset: "gradual",
    packerInString: false, sandProduction: true, deposits: false, afterCementing: false,
    perfTopMD: 2300, perfBottomMD: 2350,
    deltaP_MPa: 8, contactLenM: 30, mudcakeFriction: 0.25,
  });
  const symptomsEff = useMemo<StuckSymptoms>(() => ({ ...symptoms, packerDepthMD: packer.setDepthMD }), [symptoms, packer.setDepthMD]);
  const stuckStringLoad = useMemo(() => pullOutLoadTo(symptoms.stuckDepthMD), [well, drag.frictionCoeff, symptoms.stuckDepthMD]); // eslint-disable-line react-hooks/exhaustive-deps
  const stuckDiag = useMemo(
    () => diagnoseStuck(well, symptomsEff, rigResult.allowableLoadKN, stuckStringLoad),
    [well, symptomsEff, rigResult.allowableLoadKN, stuckStringLoad],
  );
  const lubeResult = useMemo(
    () => calculateLubricant(lube, dragNoLube.maxHookLoadKN, dragLube.maxHookLoadKN,
      symptoms.contactLenM, symptoms.deltaP_MPa, well.fluidPV_cP),
    [lube, dragNoLube, dragLube, symptoms.contactLenM, symptoms.deltaP_MPa, well.fluidPV_cP],
  );

  // ──── Fishing ────
  const [fish, setFish] = useState<FishingInput>({
    fishTopMD: 1600, fishWeightKN: 120, overpullKN: 150, jarType: "hydraulic",
    collarLengthM: 0, collarOD_mm: 95, collarID_mm: 38,
  });
  const fishResult = useMemo(
    () => calculateFishing({ ...fish, frictionCoeff: drag.frictionCoeff }, well),
    [fish, well, drag.frictionCoeff],
  );

  // ──── Ловильный инструмент и отворот ────
  const [fishTool, setFishTool] = useState<FishingToolInput>({
    fishOD_mm: 88.9, fishID_mm: 62, headDamaged: false, minClearance_mm: 6, externalBodyWall_mm: 10,
  });
  const fishTools = useMemo(() => selectFishingTools(fishTool, well), [fishTool, well]);
  const [backOff, setBackOff] = useState({ backOffMD: 0, breakoutTorqueKNm: 2.0 });
  const backOffDepth = backOff.backOffMD > 0 ? backOff.backOffMD : fpResult.backOffMD;
  const backOffResult = useMemo(
    () => calculateBackOff({ backOffMD: backOffDepth, breakoutTorqueKNm: backOff.breakoutTorqueKNm, frictionCoeff: drag.frictionCoeff }, well),
    [backOffDepth, backOff.breakoutTorqueKNm, drag.frictionCoeff, well],
  );

  // ──── Промывка пробки ────
  const [cleanout, setCleanout] = useState<CleanoutInput>({
    plugTopMD: 2350, plugBottomMD: 2450, method: "direct", rateLs: 8, grainDiameter_mm: 0.25, feedRate_mh: 6, plugPorosity: 0.4,
  });
  const cleanoutResult = useMemo(() => calculateCleanout(cleanout, well), [cleanout, well]);

  // ──── Освоение ────
  const [swab, setSwab] = useState<SwabInput>({
    reservoirMD: 2300, reservoirPressureMPa: 18, targetDrawdownMPa: 5, fluidDensity: 1.0,
    packerInstalled: true, swabSubmergenceM: 200, swabEfficiency: 0.8, swabSpeedMs: 2,
  });
  const swabResult = useMemo(() => calculateSwab(swab, well), [swab, well]);

  // ──── Колонна: опрессовка и смятие ────
  const [casing, setCasing] = useState<CasingCheckInput & { casingGrade: string }>({
    casingOD_mm: 168.3, casingWall_mm: 8.0, casingGrade: "Д", casingYieldMPa: STEEL_GRADES["Д"], wearPct: 10,
    bottomMD: 2500, testPressureMPa: 15, insideDensity: 1.0, outsideDensity: 1.05, levelMD: 0, sfBurst: 1.15, sfCollapse: 1.1,
  });
  const casingLevel = casing.levelMD > 0 ? casing.levelMD : swabResult.requiredLevelMD;
  const casingResult = useMemo(
    () => checkCasing({ ...casing, levelMD: casingLevel, bottomMD: Math.min(casing.bottomMD, well.wellDepthMD) }, well),
    [casing, casingLevel, well],
  );

  // ──── Блокирующая пачка ────
  const [pill, setPill] = useState<BlockingPillInput>({
    perfTopMD: 2300, perfBottomMD: 2320, porosityPct: 18, penetrationRadiusM: 0.5, coverAboveM: 30, excessPct: 15, tubingShoeMD: 2200,
  });
  const pillResult = useMemo(() => calculateBlockingPill(pill, well), [pill, well]);

  // ──── Сохранение в кабинет / загрузка / отчёт ────
  const [searchParams] = useSearchParams();
  const calcId = searchParams.get("calc");
  const selectedWellId = searchParams.get("well");
  const [saveOpen, setSaveOpen] = useState(false);

  const buildPayload = (): SaveCalcPayload => ({
    module: "workover",
    title: `КРС ${new Date().toLocaleDateString("ru-RU")}`,
    well_data: well,
    calc_params: {
      rig, packer, releaseExtra, kill, brineSaltId, brineTargetDensity, brineVolumeM3, brineMixing, brineTempC,
      killIntervals, drag, lube, useLube, fp, symptoms, fish, fishTool, backOff, cleanout, swab, casing, pill,
    },
    results: {
      hookLoadPullOutKN: pullOutFull, pipeAllowableKN: pipeYield,
      killDensity: killResult.killDensity, icp: killResult.initialCircPressureMPa, fcp: killResult.finalCircPressureMPa,
      packerMovementMM: packerResult.dLTotalMM, freePointMD: fpResult.freePointMD, stuckType: stuckDiag.type,
      cleanoutMinRateLs: cleanoutResult.minRateLs, maxTestPressureMPa: casingResult.maxTestPressureMPa,
      maxLevelMD: casingResult.maxLevelMD, pillVolumeM3: pillResult.pillVolumeM3,
    },
  });

  useEffect(() => {
    if (!calcId) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast.error("Войдите в кабинет, чтобы открыть расчёт"); return; }
      const { data, error } = await supabase.from("saved_calculations").select("*").eq("id", calcId).single();
      if (error || !data || data.user_id !== session.user.id) { toast.error("Не удалось загрузить расчёт"); return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = (data.calc_params ?? {}) as any;
      if (data.well_data) setWell({ ...DEFAULT_WELL, ...(data.well_data as Partial<WorkoverWellData>) });
      if (p.rig) setRig(p.rig);
      if (p.packer) setPacker((x) => ({ ...x, ...p.packer }));
      if (p.releaseExtra) setReleaseExtra((x) => ({ ...x, ...p.releaseExtra }));
      if (p.kill) setKill((x) => ({ ...x, ...p.kill }));
      if (typeof p.brineSaltId === "string") setBrineSaltId(p.brineSaltId);
      if (typeof p.brineTargetDensity === "number") setBrineTargetDensity(p.brineTargetDensity);
      if (typeof p.brineVolumeM3 === "number") setBrineVolumeM3(p.brineVolumeM3);
      if (p.brineMixing) setBrineMixing(p.brineMixing);
      if (typeof p.brineTempC === "number") setBrineTempC(p.brineTempC);
      if (Array.isArray(p.killIntervals)) setKillIntervals(p.killIntervals);
      if (p.drag) setDrag(p.drag);
      if (p.lube) setLube(p.lube);
      if (typeof p.useLube === "boolean") setUseLube(p.useLube);
      if (p.fp) setFp(p.fp);
      if (p.symptoms) setSymptoms((x) => ({ ...x, ...p.symptoms }));
      if (p.fish) setFish((x) => ({ ...x, ...p.fish }));
      if (p.fishTool) setFishTool((x) => ({ ...x, ...p.fishTool }));
      if (p.backOff) setBackOff((x) => ({ ...x, ...p.backOff }));
      if (p.cleanout) setCleanout((x) => ({ ...x, ...p.cleanout }));
      if (p.swab) setSwab((x) => ({ ...x, ...p.swab }));
      if (p.casing) setCasing((x) => ({ ...x, ...p.casing }));
      if (p.pill) setPill((x) => ({ ...x, ...p.pill }));
      toast.success(`Расчёт «${data.title}» загружен`);
    })();
  }, [calcId]);

  const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");
  const openReport = () => {
    const sections: ReportSection[] = [
      { title: "Скважина и колонна НКТ", rows: [
        ["Глубина MD / TVD забоя", `${well.wellDepthMD} / ${f1(tvdAtMD(well.wellDepthMD, well.trajectory), 0)} м`],
        ["Обсадная колонна, ID", `${well.casingID_mm} мм`],
        ["НКТ", `${well.pipeOD_mm}×${well.pipeID_mm} мм, ${well.pipeWeight_kgm} кг/м, гр. ${well.pipeGrade}, ${CONNECTION_LABELS[well.connectionType ?? "nu"]}`],
        ["Остаточная прочность НКТ", `${well.pipeConditionPct ?? 100} %`],
        ["Жидкость в скважине", `${well.fluidDensity_gcm3} г/см³, PV ${well.fluidPV_cP} сП, YP ${well.fluidYP_Pa} Па`],
        ["Траектория", well.trajectory.map((t) => `${t.md}/${t.zenith}°/${t.azimuth}°`).join("; ")],
      ] },
      { title: "Сводка нагрузок", rows: [
        ["Нагрузка на крюке при подъёме", `${f1(pullOutFull, 0)} кН`],
        ["Допустимо на НКТ (резьба, износ, ÷1.25)", `${f1(pipeYield, 0)} кН`],
        ["Допустимая нагрузка подъёмника", `${f1(rigResult.allowableLoadKN, 0)} кН`],
      ], warnings: rigResult.warnings },
      { title: "Пакер (Lubinski)", rows: [
        ["Глубина посадки MD / TVD", `${packer.setDepthMD} / ${f1(packerResult.packerTVD, 0)} м`],
        ["Перепад на пакер в работе", `${f1(packerResult.diffPressureMPa)} МПа (паспорт ${packer.ratingDiffMPa})`],
        ["Перемещение НКТ: поршень / раздувание / температура / изгиб", `${f1(packerResult.dLPistonMM, 0)} / ${f1(packerResult.dLBallooningMM, 0)} / ${f1(packerResult.dLTemperatureMM, 0)} / ${f1(packerResult.dLBucklingMM, 0)} мм`],
        ["Итого перемещение", `${f1(packerResult.dLTotalMM, 0)} мм`],
        ...(packer.connection === "anchored" ? [["Нагрузка на пакер", `${f1(packerResult.packerLoadKN, 0)} кН`] as [string, string]] : []),
        ["Нагрузка на крюке для срыва", `${f1(releaseResult.totalPullRequiredKN, 0)} кН`],
      ], warnings: [...packerResult.warnings, ...releaseResult.warnings] },
      { title: "Глушение", rows: [
        ["Pпл / TVD пласта / Pгрп", `${kill.formationPressureMPa} МПа / ${kill.reservoirDepthTVD} м / ${kill.fracturePressureMPa} МПа`],
        ["Запас", `${killResult.marginRule}: +${f1(killResult.appliedMarginMPa, 2)} МПа`],
        ["Плотность глушения", `${f1(killResult.killDensity, 3)} г/см³`],
        ["Объём скважины", `${f1(killResult.killVolumeM3, 2)} м³`],
        ["Трение НКТ / затрубье", `${f1(killResult.tubingFrictionMPa, 2)} / ${f1(killResult.annulusFrictionMPa, 2)} МПа`],
        ["ICP / FCP", `${f1(killResult.initialCircPressureMPa, 2)} / ${f1(killResult.finalCircPressureMPa, 2)} МПа`],
        ...(brineRecipe ? [
          ["Рецептура", `${brineRecipe.salt.name}: ${f1(brineRecipe.productMassKg, 0)} кг товарного + ${f1(brineRecipe.waterVolumeL, 0)} л воды`] as [string, string],
          ["Температура кристаллизации", brineRecipe.crystallizationC === null ? "нет данных" : `${f1(brineRecipe.crystallizationC, 0)} °C`] as [string, string],
        ] : []),
        ["Блокирующая пачка / продавка", `${f1(pillResult.pillVolumeM3, 2)} / ${f1(pillResult.displacementVolumeM3, 2)} м³`],
      ], warnings: [...killResult.warnings, ...(brineRecipe?.warnings ?? []), ...(multiIntervalPlan?.warnings ?? [])] },
      { title: "Затяжки и момент", rows: [
        ["Коэффициент трения", `${drag.frictionCoeff}`],
        ["Подъём / спуск", `${f1(activeDrag.pickUpKN, 0)} / ${f1(activeDrag.slackOffKN, 0)} кН`],
        ["Момент на устье при вращении", `${f1(activeDrag.surfaceTorqueKNm, 2)} кН·м`],
      ] },
      { title: "Прихват", rows: [
        ["Натяжка / удлинение", `${fp.pulledForceKN} кН / ${fp.measuredStretchM} м`],
        ["Точка прихвата (по Гуку / с трением)", `${f1(fpResult.idealFreePointMD, 0)} / ${f1(fpResult.freePointMD, 0)} м`],
        ["Глубина отворота", `≈ ${f1(fpResult.backOffMD, 0)} м`],
        ["Вероятный вид прихвата", `${STUCK_LABELS[stuckDiag.type]} (${f1(stuckDiag.probability * 100, 0)}%)`],
        ["Рекомендация", stuckDiag.recommendation],
      ] },
      { title: "Ловильные работы", rows: [
        ["Нагрузка на крюке при натяжке", `${f1(fishResult.requiredHookLoadKN, 0)} кН`],
        ["Ясс: растяжение / скорость / удар", `${f1(fishResult.jarStretchM, 2)} м / ${f1(fishResult.jarVelocityMs)} м/с / ${f1(fishResult.jarImpactLowKN, 0)}–${f1(fishResult.jarImpactHighKN, 0)} кН`],
        ["Инструмент", fishTools.options.filter((o) => o.feasible).map((o) => o.tool).join(", ")],
        ["Отворот: момент на устье / закрутка", `${f1(backOffResult.surfaceTorqueKNm, 2)} кН·м / ${f1(backOffResult.turns)} об.`],
      ], warnings: [...fishResult.warnings, ...backOffResult.warnings] },
      { title: "Промывка песчаной пробки", rows: [
        ["Пробка", `${cleanout.plugTopMD}–${cleanout.plugBottomMD} м, ${cleanout.method === "direct" ? "прямая" : "обратная"} промывка`],
        ["Скорость осаждения / восходящая", `${f1(cleanoutResult.settlingVelocityMs, 3)} / ${f1(cleanoutResult.upflowVelocityMs, 2)} м/с`],
        ["Минимальный расход", `${f1(cleanoutResult.minRateLs)} л/с`],
        ["Время размыва / давление на насосе", `${f1(cleanoutResult.washTimeH)} ч / ${f1(cleanoutResult.pumpPressureMPa)} МПа`],
      ], warnings: cleanoutResult.warnings },
      { title: "Колонна и освоение", rows: [
        ["Колонна", `${casing.casingOD_mm}×${casing.casingWall_mm} мм, гр. ${casing.casingGrade}, износ ${casing.wearPct}%`],
        ["Давление разрыва / смятия (API 5C3)", `${f1(casingResult.burstRatingMPa)} / ${f1(casingResult.collapseRatingMPa)} МПа`],
        ["Допустимое давление опрессовки на устье", `${f1(casingResult.maxTestPressureMPa)} МПа`],
        ["Допустимое снижение уровня до", `${f1(casingResult.maxLevelMD, 0)} м`],
        ["Освоение: уровень для депрессии", `${f1(swabResult.requiredLevelMD, 0)} м, ${swabResult.runs} рейсов сваба, ${f1(swabResult.timeH)} ч`],
      ], warnings: [...casingResult.warnings, ...swabResult.warnings] },
    ];
    if (!openWorkoverReport("Расчёт КРС", sections)) toast.error("Браузер заблокировал окно отчёта — разрешите всплывающие окна для сайта");
  };

  // ──── Drag chart ────
  const dragChart = useMemo(() => {
    const a = dragNoLube.points;
    const b = dragLube.points;
    return a.map((p, i) => ({
      md: Math.round(p.md),
      base: +p.hookLoadKN.toFixed(1),
      lube: +(b[i]?.hookLoadKN ?? 0).toFixed(1),
    }));
  }, [dragNoLube, dragLube]);
  const torqueChart = useMemo(() => {
    if (drag.operation !== "rotate") return [];
    // момент в сечении = трение всей колонны ниже этого сечения
    const a = dragNoLube.points, b = dragLube.points;
    return a.map((p, i) => ({
      md: Math.round(p.md),
      base: +p.torqueKNm.toFixed(3),
      lube: +(b[i]?.torqueKNm ?? 0).toFixed(3),
    }));
  }, [dragNoLube, dragLube, drag.operation]);

  // NumberField is defined at module scope (below) to avoid remount-on-render (focus loss).

  // ────────── render ──────────
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img src={deallsoftLogo} alt="DeAllsoft" className="h-10 sm:h-14 object-cover" />
            <p className="text-sm sm:text-lg font-normal tracking-tight uppercase text-foreground">
              КРС — Капитальный ремонт скважин
            </p>
          </Link>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={openReport}>
              <FileDown className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Отчёт PDF</span>
            </Button>
            <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setSaveOpen(true)}>
              <Save className="w-3.5 h-3.5" /> <span className="hidden sm:inline">В кабинет</span>
            </Button>
            <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-xs">
              <ArrowLeft className="w-4 h-4" /> <span>Назад</span>
            </Link>
            <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-xs">
              <Home className="w-4 h-4" /> <span>Главная</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-4 py-6 w-full space-y-4">
        {/* ─── Шапка с общими данными ─── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Wrench className="w-4 h-4" /> Общие данные скважины и колонны</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <NumberField label="Глубина MD" unit="м" value={well.wellDepthMD} onChange={(v) => updateWell("wellDepthMD", v)} />
            <NumberField label="ID обсадной" unit="мм" value={well.casingID_mm} onChange={(v) => updateWell("casingID_mm", v)} />
            <div className="space-y-1">
              <Label className="text-xs">НКТ по ГОСТ 633-80</Label>
              <Select value={GOST_TUBING_SIZES.find((t) => Math.abs(t.od - well.pipeOD_mm) < 0.5 && Math.abs(t.od - 2 * t.wall - well.pipeID_mm) < 0.5)?.label ?? "custom"}
                onValueChange={(v) => {
                  const t = GOST_TUBING_SIZES.find((x) => x.label === v);
                  if (t) setWell((w) => ({ ...w, pipeOD_mm: t.od, pipeID_mm: +(t.od - 2 * t.wall).toFixed(1), pipeWeight_kgm: t.massKgm }));
                }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom" disabled>Свой размер</SelectItem>
                  {GOST_TUBING_SIZES.map((t) => <SelectItem key={t.label} value={t.label}>{t.label} мм, {t.massKgm} кг/м</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <NumberField label="НКТ OD" unit="мм" value={well.pipeOD_mm} onChange={(v) => updateWell("pipeOD_mm", v)} />
            <NumberField label="НКТ ID" unit="мм" value={well.pipeID_mm} onChange={(v) => updateWell("pipeID_mm", v)} />
            <NumberField label="Вес погонный" unit="кг/м" value={well.pipeWeight_kgm} onChange={(v) => updateWell("pipeWeight_kgm", v)} />
            <div className="space-y-1">
              <Label className="text-xs">Марка стали</Label>
              <Select value={well.pipeGrade} onValueChange={(v) => {
                setWell((w) => ({ ...w, pipeGrade: v, pipeYieldMPa: STEEL_GRADES[v] ?? w.pipeYieldMPa }));
              }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(STEEL_GRADES).map((g) => (
                    <SelectItem key={g} value={g}>{g} — σy {STEEL_GRADES[g]} МПа</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Соединение НКТ</Label>
              <Select value={well.connectionType ?? "nu"} onValueChange={(v) => updateWell("connectionType", v as ConnectionType)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONNECTION_LABELS) as ConnectionType[]).map((c) => (
                    <SelectItem key={c} value={c}>{CONNECTION_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <NumberField label="Остаточная прочность" unit="%" value={well.pipeConditionPct ?? 100}
              onChange={(v) => updateWell("pipeConditionPct", v)} hint="новая 100; б/у 70–85" />
            <NumberField label="Плотность жидкости" unit="г/см³" value={well.fluidDensity_gcm3} onChange={(v) => updateWell("fluidDensity_gcm3", v)} />
            <NumberField label="PV жидкости" unit="сП" value={well.fluidPV_cP} onChange={(v) => updateWell("fluidPV_cP", v)} />
            <NumberField label="YP жидкости" unit="Па" value={well.fluidYP_Pa} onChange={(v) => updateWell("fluidYP_Pa", v)} />
            <NumberField label="Диаметр ствола" unit="мм" value={well.holeDiameter_mm} onChange={(v) => updateWell("holeDiameter_mm", v)} />
          </CardContent>
        </Card>


        {/* ─── Траектория ─── */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              Траектория (инклинометрия)
              <span className="text-xs font-normal text-muted-foreground">
                {well.trajectory.length} точек · забой TVD {tvdAtMD(well.wellDepthMD, well.trajectory).toFixed(0)} м · max зенит {Math.max(0, ...well.trajectory.map((t) => t.zenith)).toFixed(0)}°
              </span>
            </CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setTrajOpen((o) => !o)}>
                {trajOpen ? "Свернуть" : "Редактировать"}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => trajFileRef.current?.click()}>Импорт Excel</Button>
              <input ref={trajFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={importTrajectory} />
            </div>
          </CardHeader>
          {trajOpen && (
            <CardContent className="space-y-2">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">MD, м</TableHead>
                      <TableHead className="text-xs">Зенит, °</TableHead>
                      <TableHead className="text-xs">Азимут, °</TableHead>
                      <TableHead className="text-xs">TVD, м (расчёт)</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {well.trajectory.map((t, idx) => (
                      <TableRow key={idx}>
                        {(["md", "zenith", "azimuth"] as const).map((k) => (
                          <TableCell key={k}>
                            <BlurInput type="number" value={t[k]} className="h-7 text-xs w-24"
                              onValueCommit={(v) => updateTrajectory(well.trajectory.map((p, i) => (i === idx ? { ...p, [k]: num(v) } : p)))} />
                          </TableCell>
                        ))}
                        <TableCell className="text-xs">{t.tvd.toFixed(1)}</TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={well.trajectory.length <= 2}
                            onClick={() => updateTrajectory(well.trajectory.filter((_, i) => i !== idx))}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => {
                    const last = well.trajectory[well.trajectory.length - 1];
                    updateTrajectory([...well.trajectory, { md: (last?.md ?? 0) + 100, zenith: last?.zenith ?? 0, azimuth: last?.azimuth ?? 0, tvd: 0 }]);
                  }}>
                  <Plus className="w-3 h-3 mr-1" />Точка
                </Button>
                <a href="/trajectory_template.xlsx" download className="text-xs text-primary hover:underline">Шаблон Excel</a>
                <span className="text-[10px] text-muted-foreground">TVD — по методу минимальной кривизны. Ниже последней точки зенит считается постоянным.</span>
              </div>
            </CardContent>
          )}
        </Card>

        {/* ─── Сводка нагрузок (всегда видна) ─── */}
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wider text-primary">Сводка нагрузок</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
            <Stat label="Грузоподъёмность" v={`${rig.rigCapacityKN} кН`} />
            <Stat label={`Допустимая (÷${rig.safetyFactor})`} v={`${rigResult.allowableLoadKN.toFixed(0)} кН`} />
            <Stat label={rigHookAuto ? "На крюке при подъёме (расчёт)" : "Текущая на крюке"} v={`${rigEffective.currentHookLoadKN.toFixed(0)} кН (${rigResult.utilizationPct.toFixed(0)}%)`}
              tone={rigResult.status === "overload" ? "danger" : rigResult.status === "caution" ? "warn" : "ok"} />
            <Stat label="Запас на натяжку" v={`${rigResult.maxOverpullKN.toFixed(0)} кН`} />
            <Stat label={`Допустимо на НКТ ${well.pipeGrade}`} v={`${pipeYield.toFixed(0)} кН`} />
            <Stat label="Свободный вес колонны" v={`${dragNoLube.freeWeightKN.toFixed(0)} кН`} />
          </CardContent>
        </Card>

        <Tabs defaultValue="packer" className="w-full">
          <TabsList className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 w-full h-auto">
            <TabsTrigger value="packer" className="text-xs gap-1"><Anchor className="w-3.5 h-3.5" /> Пакеры</TabsTrigger>
            <TabsTrigger value="kill" className="text-xs gap-1"><Droplets className="w-3.5 h-3.5" /> Глушение</TabsTrigger>
            <TabsTrigger value="drag" className="text-xs gap-1"><Activity className="w-3.5 h-3.5" /> Затяжки / T&D</TabsTrigger>
            <TabsTrigger value="stuck" className="text-xs gap-1"><Magnet className="w-3.5 h-3.5" /> Прихваты</TabsTrigger>
            <TabsTrigger value="fishing" className="text-xs gap-1"><Search className="w-3.5 h-3.5" /> Ловильные</TabsTrigger>
            <TabsTrigger value="cleanout" className="text-xs gap-1"><Waves className="w-3.5 h-3.5" /> Промывка</TabsTrigger>
            <TabsTrigger value="casing" className="text-xs gap-1"><Layers className="w-3.5 h-3.5" /> Колонна / освоение</TabsTrigger>
            <TabsTrigger value="rig" className="text-xs gap-1"><Crane className="w-3.5 h-3.5" /> Подъёмник</TabsTrigger>
          </TabsList>


          {/* ──────────────── PACKER ──────────────── */}
          <TabsContent value="packer" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Пакер и паспортные данные</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Тип</Label>
                    <Select value={packer.type} onValueChange={(v) => setPacker((p) => ({ ...p, type: v as PackerInput["type"] }))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mechanical">Механический</SelectItem>
                        <SelectItem value="hydraulic">Гидравлический</SelectItem>
                        <SelectItem value="hydrostatic">Гидростатический</SelectItem>
                        <SelectItem value="permanent">Постоянный (PBR)</SelectItem>
                        <SelectItem value="retrievable">Извлекаемый</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Соединение НКТ с пакером</Label>
                    <Select value={packer.connection} onValueChange={(v) => setPacker((p) => ({ ...p, connection: v as PackerInput["connection"] }))}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="free">Свободное (уплотнения в стволе)</SelectItem>
                        <SelectItem value="anchored">Заякорено (жёстко)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberField label="Глубина посадки MD" unit="м" value={packer.setDepthMD} onChange={(v) => setPacker((p) => ({ ...p, setDepthMD: v }))}
                    hint={`TVD ${packerResult.packerTVD.toFixed(0)} м`} />
                  <NumberField label="ID уплотнительного ствола" unit="мм" value={packer.sealBoreID_mm} onChange={(v) => setPacker((p) => ({ ...p, sealBoreID_mm: v }))} hint="по паспорту пакера" />
                  <NumberField label="Допустимый перепад (паспорт)" unit="МПа" value={packer.ratingDiffMPa} onChange={(v) => setPacker((p) => ({ ...p, ratingDiffMPa: v }))} />
                  <NumberField label="Допустимая нагрузка (паспорт)" unit="кН" value={packer.ratingLoadKN} onChange={(v) => setPacker((p) => ({ ...p, ratingLoadKN: v }))} />
                  {packer.connection === "free" && (
                    <NumberField label="Ход уплотнений" unit="мм" value={packer.sealStrokeMM} onChange={(v) => setPacker((p) => ({ ...p, sealStrokeMM: v }))} />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Давления и температура: посадка → работа</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <NumberField label="P в НКТ на устье, при посадке" unit="МПа" value={packer.tubingSurfaceMPa0} onChange={(v) => setPacker((p) => ({ ...p, tubingSurfaceMPa0: v }))} />
                  <NumberField label="P в НКТ на устье, в работе" unit="МПа" value={packer.tubingSurfaceMPa1} onChange={(v) => setPacker((p) => ({ ...p, tubingSurfaceMPa1: v }))} hint="закачка, опрессовка, ГРП" />
                  <NumberField label="P в затрубье на устье, при посадке" unit="МПа" value={packer.annulusSurfaceMPa0} onChange={(v) => setPacker((p) => ({ ...p, annulusSurfaceMPa0: v }))} />
                  <NumberField label="P в затрубье на устье, в работе" unit="МПа" value={packer.annulusSurfaceMPa1} onChange={(v) => setPacker((p) => ({ ...p, annulusSurfaceMPa1: v }))} />
                  <NumberField label="ρ в НКТ при посадке" unit="г/см³" value={packer.tubingFluidDensity0} onChange={(v) => setPacker((p) => ({ ...p, tubingFluidDensity0: v }))} />
                  <NumberField label="ρ в НКТ в работе" unit="г/см³" value={packer.tubingFluidDensity1} onChange={(v) => setPacker((p) => ({ ...p, tubingFluidDensity1: v }))} />
                  <NumberField label="ρ в затрубье" unit="г/см³" value={packer.annulusFluidDensity} onChange={(v) => setPacker((p) => ({ ...p, annulusFluidDensity: v }))} />
                  <NumberField label="ΔT средняя по НКТ" unit="°C" value={packer.avgTempChangeC} onChange={(v) => setPacker((p) => ({ ...p, avgTempChangeC: v }))} hint="закачка холодной жидкости < 0" />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Перемещения и усилия НКТ (Lubinski)</CardTitle></CardHeader>
              <CardContent className="grid lg:grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <Row k="P под пакером (в НКТ): посадка → работа" v={`${packerResult.pTubingAtPacker[0].toFixed(1)} → ${packerResult.pTubingAtPacker[1].toFixed(1)} МПа`} />
                  <Row k="P над пакером (затрубье): посадка → работа" v={`${packerResult.pAnnulusAtPacker[0].toFixed(1)} → ${packerResult.pAnnulusAtPacker[1].toFixed(1)} МПа`} />
                  <Row k="Перепад на пакер в работе" v={<strong>{packerResult.diffPressureMPa.toFixed(1)} МПа</strong>}
                    tone={Math.abs(packerResult.diffPressureMPa) > packer.ratingDiffMPa ? "danger" : "ok"} />
                  <Row k="Фиктивная сила Ff = Ap·(Pi − Po)" v={`${packerResult.fictitiousForceKN.toFixed(0)} кН`} />
                  <Row k="Спиральный изгиб над пакером" v={packerResult.buckled ? `да, ${packerResult.neutralPointFromPackerM.toFixed(0)} м` : "нет"}
                    tone={packerResult.buckled ? "warn" : undefined} />
                  {packer.connection === "anchored" && (
                    <Row k="Нагрузка на пакер (+ натяжение, − сжатие)" v={<strong>{packerResult.packerLoadKN.toFixed(0)} кН</strong>}
                      tone={Math.abs(packerResult.packerLoadKN) > packer.ratingLoadKN ? "danger" : "ok"} />
                  )}
                </div>
                <div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Эффект</TableHead>
                        <TableHead className="text-xs text-right">ΔL, мм</TableHead>
                        <TableHead className="text-xs text-right">Сила при заякоривании, кН</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow><TableCell className="text-xs">Поршневой</TableCell><TableCell className="text-xs text-right">{packerResult.dLPistonMM.toFixed(0)}</TableCell><TableCell className="text-xs text-right">{packerResult.fPistonKN.toFixed(0)}</TableCell></TableRow>
                      <TableRow><TableCell className="text-xs">Раздувание</TableCell><TableCell className="text-xs text-right">{packerResult.dLBallooningMM.toFixed(0)}</TableCell><TableCell className="text-xs text-right">{packerResult.fBallooningKN.toFixed(0)}</TableCell></TableRow>
                      <TableRow><TableCell className="text-xs">Температура</TableCell><TableCell className="text-xs text-right">{packerResult.dLTemperatureMM.toFixed(0)}</TableCell><TableCell className="text-xs text-right">{packerResult.fTemperatureKN.toFixed(0)}</TableCell></TableRow>
                      <TableRow><TableCell className="text-xs">Продольный изгиб</TableCell><TableCell className="text-xs text-right">{packerResult.dLBucklingMM.toFixed(0)}</TableCell><TableCell className="text-xs text-right">—</TableCell></TableRow>
                      <TableRow><TableCell className="text-xs font-semibold">Итого</TableCell><TableCell className="text-xs text-right font-semibold">{packerResult.dLTotalMM.toFixed(0)}</TableCell>
                        <TableCell className="text-xs text-right font-semibold">{(packerResult.fPistonKN + packerResult.fBallooningKN + packerResult.fTemperatureKN).toFixed(0)}</TableCell></TableRow>
                    </TableBody>
                  </Table>
                  <p className="text-[10px] text-muted-foreground pt-1">ΔL &lt; 0 — НКТ укорачиваются (уплотнения выходят вверх). Сила &gt; 0 — растяжение НКТ у пакера.</p>
                </div>
                <div className="lg:col-span-2 space-y-2">
                  <div>
                    {packerResult.isSecure
                      ? <Badge className="bg-green-600">🟢 В пределах паспорта пакера</Badge>
                      : <Badge variant="destructive">🔴 Превышение паспортных пределов</Badge>}
                  </div>
                  {packerResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* ─── Срыв пакера ─── */}
            <Card className="border-amber-500/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  🔧 Срыв пакера — операция извлечения
                </CardTitle>
              </CardHeader>
              <CardContent className="grid lg:grid-cols-2 gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="Усилие срыва по паспорту" unit="кН"
                    value={releaseExtra.releaseShearKN}
                    onChange={(v) => setReleaseExtra((s) => ({ ...s, releaseShearKN: v }))}
                    hint="срезные винты/кольцо; вращением — 0" />
                  <NumberField label="Доп. усилие (отложения, прихват)" unit="кН"
                    value={releaseExtra.extraStuckKN}
                    onChange={(v) => setReleaseExtra((s) => ({ ...s, extraStuckKN: v }))}
                    hint="по опыту на месторождении" />
                  <NumberField label="Вес колонны над пакером" unit="кН"
                    value={releaseExtra.pipeWeightAboveKN}
                    onChange={(v) => setReleaseExtra((s) => ({ ...s, pipeWeightAboveKN: v }))}
                    hint={`0 = расчёт с затяжками (${weightAbovePackerAuto.toFixed(0)} кН)`} />
                </div>
                <div className="space-y-2 text-sm">
                  <Row k="Срыв по паспорту" v={`${releaseResult.breakdown.shear.toFixed(0)} кН`} />
                  <Row k="Дополнительное усилие" v={`+${releaseResult.breakdown.extra.toFixed(0)} кН`} />
                  <Row k="Вес колонны над пакером" v={`+${weightAbovePacker.toFixed(0)} кН`} />
                  <Row k="Нагрузка на крюке для срыва" v={<strong>{releaseResult.totalPullRequiredKN.toFixed(0)} кН</strong>}
                    tone={releaseResult.canReleaseByTension ? "ok" : "danger"} />
                  <Row k="Допустимо на колонну (резьба, износ, ÷1.25)" v={`${releaseResult.pipeTensileLimitKN.toFixed(0)} кН`} />
                  <Row k="Лимит подъёмника" v={`${rigResult.allowableLoadKN.toFixed(0)} кН`} />
                  <div className="pt-1 flex flex-wrap gap-2">
                    {releaseResult.canReleaseByTension
                      ? <Badge className="bg-green-600">🟢 Сорвётся натяжкой</Badge>
                      : <Badge variant="destructive">🔴 Натяжкой не сорвать</Badge>}
                    <Badge variant="secondary">
                      Метод: {{ tension: "Натяжка", rotation: "Вращение", pressure_release: "Сброс давления", mill_out: "Фрезерование" }[releaseResult.recommendedMechanism]}
                    </Badge>
                  </div>
                  {releaseResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ──────────────── KILL ──────────────── */}
          <TabsContent value="kill" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Метод и параметры глушения</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Метод</Label>
                    <Select value={kill.method} onValueChange={(v) => setKill({ ...kill, method: v as KillInput["method"] })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="driller">Метод бурильщика (2 цикла)</SelectItem>
                        <SelectItem value="wait_weight">Метод ожидания и утяжеления (1 цикл)</SelectItem>
                        <SelectItem value="volumetric">Объёмный (без циркуляции)</SelectItem>
                        <SelectItem value="bullhead">Bullhead — задавка в пласт</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberField label="Pпл" unit="МПа" value={kill.formationPressureMPa}
                    onChange={(v) => setKill({ ...kill, formationPressureMPa: v })} />
                  <NumberField label="TVD пласта" unit="м" value={kill.reservoirDepthTVD}
                    onChange={(v) => setKill({ ...kill, reservoirDepthTVD: v })} hint={`TVD забоя по траектории: ${tvdAtMD(well.wellDepthMD, well.trajectory).toFixed(0)} м`} />
                  <NumberField label="Pгрп (предел)" unit="МПа" value={kill.fracturePressureMPa}
                    onChange={(v) => setKill({ ...kill, fracturePressureMPa: v })} />
                  <div className="space-y-1">
                    <Label className="text-xs">Запас противодавления</Label>
                    <Select value={kill.marginMode ?? "manual"} onValueChange={(v) => setKill({ ...kill, marginMode: v as "pb" | "manual" })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pb">По ПБ НГП (10% / 5%)</SelectItem>
                        <SelectItem value="manual">Вручную, %</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground">10% до 1200 м TVD, 5% глубже</p>
                  </div>
                  {(kill.marginMode ?? "manual") === "manual" && (
                    <NumberField label="Запас плотности" unit="%" value={kill.safetyMarginPct}
                      onChange={(v) => setKill({ ...kill, safetyMarginPct: v })} />
                  )}
                  <NumberField label="PV жидкости глушения" unit="сП" value={kill.killFluidPV_cP}
                    onChange={(v) => setKill({ ...kill, killFluidPV_cP: v })} hint="рассол 1–3, полимерная 10–30" />
                  <NumberField label="YP жидкости глушения" unit="Па" value={kill.killFluidYP_Pa}
                    onChange={(v) => setKill({ ...kill, killFluidYP_Pa: v })} />
                  <NumberField label="Расход насоса" unit="л/с" value={kill.pumpRateLs}
                    onChange={(v) => setKill({ ...kill, pumpRateLs: v })} />
                  <p className="col-span-2 text-[10px] text-muted-foreground">
                    Глубина ({well.wellDepthMD} м), обсадная ({well.casingID_mm} мм), НКТ ({well.pipeOD_mm}×{well.pipeID_mm} мм)
                    и текущая жидкость ({well.fluidDensity_gcm3} г/см³) берутся из общих данных скважины. Расчёт — для НКТ, спущенных до забоя.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Результаты глушения</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row k="Плотность баланса" v={`${killResult.balanceDensity.toFixed(3)} г/см³`} />
                  <Row k={`Запас: ${killResult.marginRule}`} v={`+${killResult.appliedMarginMPa.toFixed(2)} МПа (${killResult.appliedMarginPct.toFixed(1)}%)`} />
                  <Row k="Плотность глушения"
                    v={<strong>{killResult.killDensity.toFixed(3)} г/см³</strong>} />
                  <Row k="Подбор жидкости" v={<Badge variant="secondary">{killResult.selectedFluid}</Badge>} />
                  <Row k="Забойное (после глушения)" v={`${killResult.bottomholePressureMPa.toFixed(2)} МПа`}
                    tone={killResult.exceedsFracture ? "danger" : "ok"} />
                  <Row k="Pгрп" v={`${kill.fracturePressureMPa.toFixed(2)} МПа`} />
                  <Row k="Объём скважины (НКТ + затрубье)"
                    v={`${killResult.killVolumeM3.toFixed(2)} м³ (${killResult.tubingVolumeM3.toFixed(1)} + ${killResult.annulusVolumeM3.toFixed(1)})`} />
                  <Row k={`Трение в НКТ (${killResult.tubingTurbulent ? "турб." : "лам."}, ${killResult.tubingVelocityMs.toFixed(1)} м/с)`}
                    v={`${killResult.tubingFrictionMPa.toFixed(2)} МПа`} />
                  <Row k={`Трение в затрубье (${killResult.annulusTurbulent ? "турб." : "лам."}, ${killResult.annulusVelocityMs.toFixed(2)} м/с)`}
                    v={`${killResult.annulusFrictionMPa.toFixed(2)} МПа`} />
                  {(kill.method === "driller" || kill.method === "wait_weight") && (
                    <>
                      <Row k="Избыточное в трубах (Pпл − ρтек·g·H)" v={`${killResult.sidppMPa.toFixed(2)} МПа`} />
                      <Row k="ICP — начало циркуляции" v={<strong>{killResult.initialCircPressureMPa.toFixed(2)} МПа</strong>} />
                      <Row k="FCP — конец циркуляции" v={<strong>{killResult.finalCircPressureMPa.toFixed(2)} МПа</strong>} />
                    </>
                  )}
                  {kill.method === "bullhead" && (
                    <>
                      <Row k="Устьевое задавки — начало" v={<strong>{killResult.bullheadSurfacePressureMPa.toFixed(2)} МПа</strong>}
                        tone={killResult.bullheadSurfacePressureMPa >= killResult.bullheadMaxSurfaceMPa ? "danger"
                          : killResult.bullheadSurfacePressureMPa > 0.85 * killResult.bullheadMaxSurfaceMPa ? "warn" : "ok"} />
                      <Row k="Устьевое задавки — конец" v={`${killResult.bullheadEndPressureMPa.toFixed(2)} МПа`} />
                      <Row k="Предел на устье по ГРП" v={`${killResult.bullheadMaxSurfaceMPa.toFixed(2)} МПа`} />
                    </>
                  )}
                  <div className="pt-1">
                    {killResult.exceedsFracture || killResult.warnings.some((w) => w.startsWith("🔴"))
                      ? <Badge variant="destructive">🔴 Превышение ГРП</Badge>
                      : <Badge className="bg-green-600">🟢 В безопасном окне</Badge>}
                  </div>
                  <Alert className="py-2"><AlertDescription className="text-xs">{killResult.recommendation}</AlertDescription></Alert>
                  {killResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Давление циркуляции vs объём прокачки</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={killChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="v" type="number" domain={[0, "dataMax"]} tickFormatter={(x: number) => x.toFixed(0)} label={{ value: "Объём, м³", position: "insideBottom", offset: -5 }} />
                    <YAxis label={{ value: "Давление, МПа", angle: -90, position: "insideLeft" }} />
                    <Tooltip />
                    <Legend />
                    {kill.method === "bullhead" && (
                      <ReferenceLine y={killResult.bullheadMaxSurfaceMPa} stroke="#f59e0b" strokeDasharray="4 4" label="Предел на устье" />
                    )}
                    <Line type="linear" dataKey="p" name="Давление на устье (насос)" stroke="#0ea5e9" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Каталог жидкостей глушения</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Жидкость</TableHead>
                      <TableHead>Max плотность, г/см³</TableHead>
                      <TableHead>Тип</TableHead>
                      <TableHead>Подходит</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {KILL_FLUIDS.map((f) => (
                      <TableRow key={f.name}>
                        <TableCell className="text-xs">{f.name}</TableCell>
                        <TableCell className="text-xs">{f.maxDensity.toFixed(2)}</TableCell>
                        <TableCell className="text-xs">{f.type}</TableCell>
                        <TableCell className="text-xs">
                          {f.maxDensity >= killResult.killDensity
                            ? <Badge className="bg-green-600">да</Badge>
                            : <Badge variant="secondary">нет</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* ─── Приготовление жидкости глушения ─── */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Droplets className="w-4 h-4" /> Приготовление жидкости глушения (рецептура)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Добавка</Label>
                    <Select value={brineSaltId} onValueChange={setBrineSaltId}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">🎯 Авто-подбор по плотности</SelectItem>
                        {KILL_SALTS.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberField label="Целевая плотность" unit="г/см³" value={brineTargetDensity}
                    onChange={setBrineTargetDensity} hint={`0 = из расчёта (${killResult.killDensity.toFixed(3)})`} step="0.01" />
                  <NumberField label="Объём раствора" unit="м³" value={brineVolumeM3}
                    onChange={setBrineVolumeM3} hint={`0 = из расчёта (${killResult.killVolumeM3.toFixed(1)})`} />
                  <div className="space-y-1">
                    <Label className="text-xs">Перемешивание</Label>
                    <Select value={brineMixing} onValueChange={(v) => setBrineMixing(v as "low" | "medium" | "high")}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Низкое (×1.5)</SelectItem>
                        <SelectItem value="medium">Среднее (×1.0)</SelectItem>
                        <SelectItem value="high">Высокое (×0.6)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberField label="T воды" unit="°C" value={brineTempC} onChange={setBrineTempC}
                    hint="<10°C → ×1.4 времени" />
                </div>

                {!selectedSalt && (
                  <Alert><AlertDescription className="text-xs">
                    🔴 Плотность {effectiveBrineDensity.toFixed(2)} г/см³ выше 1.40 — солями не достичь. Нужен утяжелитель (барит, гематит) или бромидные рассолы.
                  </AlertDescription></Alert>
                )}

                {brineRecipe && (
                  <div className="grid md:grid-cols-2 gap-3">
                    <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">РЕЦЕПТУРА</div>
                      <Row k="Плотность" v={<strong>{brineRecipe.targetDensity.toFixed(3)} г/см³</strong>} />
                      <Row k="Добавка" v={<Badge variant="secondary">{brineRecipe.salt.name} ({brineRecipe.salt.purity}%)</Badge>} />
                      <Row k="Объём раствора" v={`${effectiveBrineVolume.toFixed(2)} м³`} />
                      <div className="border-t pt-2 mt-2 space-y-1">
                        <Row k={`${brineRecipe.salt.formula} (товарный)`}
                          v={<strong>{brineRecipe.productMassKg.toFixed(0)} кг</strong>} />
                        <Row k={`${brineRecipe.salt.formula} (чистой соли)`}
                          v={`${brineRecipe.pureSaltKg.toFixed(0)} кг`} />
                        <Row k="Вода" v={<strong>{brineRecipe.waterVolumeL.toFixed(0)} л</strong>} />
                        <Row k="Концентрация" v={`${brineRecipe.wtPctClean.toFixed(1)}% масс.`} />
                      </div>
                      <div className="border-t pt-2 mt-2">
                        <Row k="⏱ Время растворения"
                          v={<strong>~{brineRecipe.dissolveTimeMin.toFixed(0)} мин</strong>} />
                        <Row k="❄ Температура начала кристаллизации"
                          v={brineRecipe.crystallizationC === null ? "нет справочных данных" : `${brineRecipe.crystallizationC.toFixed(0)} °C`}
                          tone={brineRecipe.crystallizationC !== null && brineRecipe.crystallizationC > -10 ? "warn" : undefined} />
                      </div>
                      {brineRecipe.feasible
                        ? <Badge className="bg-green-600">🟢 Плотность достижима</Badge>
                        : <Badge variant="destructive">🔴 Недостижимо данной солью</Badge>}
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted-foreground">ПРЕДУПРЕЖДЕНИЯ</div>
                      {brineRecipe.warnings.length === 0
                        ? <Alert className="py-2"><AlertDescription className="text-xs">Нет критичных замечаний.</AlertDescription></Alert>
                        : brineRecipe.warnings.map((w, i) => (
                            <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                          ))}
                      <div className="rounded border p-2 text-xs space-y-1">
                        <div className="font-semibold">Достижимые плотности солями:</div>
                        {KILL_SALTS.filter((s) => s.id !== "water").map((s) => (
                          <div key={s.id} className="flex justify-between">
                            <span className="text-muted-foreground">{s.formula} ({s.purity}%)</span>
                            <span className={effectiveBrineDensity <= s.maxDensity ? "text-green-600" : "text-muted-foreground"}>
                              до {s.maxDensity.toFixed(2)} г/см³ {effectiveBrineDensity <= s.maxDensity ? "✓" : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ─── Блокирующая пачка ─── */}
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Блокирующая пачка (поглощающий пласт)</CardTitle></CardHeader>
              <CardContent className="grid lg:grid-cols-2 gap-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <NumberField label="Перфорация, верх" unit="м" value={pill.perfTopMD} onChange={(v) => setPill({ ...pill, perfTopMD: v })} />
                  <NumberField label="Перфорация, низ" unit="м" value={pill.perfBottomMD} onChange={(v) => setPill({ ...pill, perfBottomMD: v })} />
                  <NumberField label="Перекрытие над кровлей" unit="м" value={pill.coverAboveM} onChange={(v) => setPill({ ...pill, coverAboveM: v })} />
                  <NumberField label="Пористость" unit="%" value={pill.porosityPct} onChange={(v) => setPill({ ...pill, porosityPct: v })} />
                  <NumberField label="Радиус проникновения" unit="м" value={pill.penetrationRadiusM} onChange={(v) => setPill({ ...pill, penetrationRadiusM: v })} hint="обычно 0.3–1.0" />
                  <NumberField label="Запас объёма" unit="%" value={pill.excessPct} onChange={(v) => setPill({ ...pill, excessPct: v })} />
                  <NumberField label="Башмак НКТ" unit="м" value={pill.tubingShoeMD} onChange={(v) => setPill({ ...pill, tubingShoeMD: v })} />
                </div>
                <div className="space-y-2 text-sm">
                  <Row k={`Объём в стволе (${pillResult.pillTopMD.toFixed(0)}–${Math.max(pill.perfTopMD, pill.perfBottomMD).toFixed(0)} м)`} v={`${pillResult.wellboreVolumeM3.toFixed(2)} м³`} />
                  <Row k="Поровый объём зоны проникновения" v={`${pillResult.formationVolumeM3.toFixed(2)} м³`} />
                  <Row k={`Объём пачки (+${pill.excessPct}%)`} v={<strong>{pillResult.pillVolumeM3.toFixed(2)} м³</strong>} />
                  <Row k="Объём продавки до кровли пачки" v={`${pillResult.displacementVolumeM3.toFixed(2)} м³`} />
                  {pillResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* ─── Интервалы глушения ─── */}
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Интервалы глушения / проявления</CardTitle>
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  onClick={() => setKillIntervals([...killIntervals, {
                    topMD: 0, bottomMD: 0, topTVD: 0, bottomTVD: 0,
                    formationPressureMPa: 0, fracturePressureMPa: 0, intervalType: "kill_zone", requiredKillDensity: 0,
                  }])}>
                  <Plus className="w-3 h-3 mr-1" />Интервал
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">MD верх</TableHead>
                      <TableHead className="text-xs">MD низ</TableHead>
                      <TableHead className="text-xs">TVD низ</TableHead>
                      <TableHead className="text-xs">Pпл, МПа</TableHead>
                      <TableHead className="text-xs">Pгрп, МПа</TableHead>
                      <TableHead className="text-xs">Тип</TableHead>
                      <TableHead className="text-xs">Треб. ρ</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {killIntervals.map((iv, idx) => (
                      <TableRow key={idx} className={multiIntervalPlan?.governingInterval === idx ? "bg-amber-500/10" : ""}>
                        <TableCell><Input type="number" value={iv.topMD} className="h-7 text-xs w-20"
                          onChange={(e) => { const a = [...killIntervals]; a[idx] = { ...iv, topMD: num(e.target.value) }; setKillIntervals(a); }} /></TableCell>
                        <TableCell><Input type="number" value={iv.bottomMD} className="h-7 text-xs w-20"
                          onChange={(e) => { const a = [...killIntervals]; a[idx] = { ...iv, bottomMD: num(e.target.value) }; setKillIntervals(a); }} /></TableCell>
                        <TableCell><Input type="number" value={iv.bottomTVD} className="h-7 text-xs w-20"
                          onChange={(e) => { const a = [...killIntervals]; a[idx] = { ...iv, bottomTVD: num(e.target.value), topTVD: iv.topTVD || num(e.target.value) - (iv.bottomMD - iv.topMD) }; setKillIntervals(a); }} /></TableCell>
                        <TableCell><Input type="number" value={iv.formationPressureMPa} className="h-7 text-xs w-20"
                          onChange={(e) => { const a = [...killIntervals]; a[idx] = { ...iv, formationPressureMPa: num(e.target.value) }; setKillIntervals(a); }} /></TableCell>
                        <TableCell><Input type="number" value={iv.fracturePressureMPa ?? 0} className="h-7 text-xs w-20"
                          onChange={(e) => { const a = [...killIntervals]; a[idx] = { ...iv, fracturePressureMPa: num(e.target.value) }; setKillIntervals(a); }} /></TableCell>
                        <TableCell>
                          <Select value={iv.intervalType} onValueChange={(v) => { const a = [...killIntervals]; a[idx] = { ...iv, intervalType: v as KillInterval["intervalType"] }; setKillIntervals(a); }}>
                            <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="kill_zone">Глушение</SelectItem>
                              <SelectItem value="kick_zone">Проявление</SelectItem>
                              <SelectItem value="transit">Транзит</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-xs">
                          {multiIntervalPlan
                            ? <strong>{multiIntervalPlan.intervals[idx]?.requiredKillDensity.toFixed(3)}</strong>
                            : "—"}
                          {multiIntervalPlan?.governingInterval === idx && <Badge className="ml-1 bg-amber-600 text-[10px]">определяющий</Badge>}
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => setKillIntervals(killIntervals.filter((_, i) => i !== idx))}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {multiIntervalPlan && (
                  <div className="space-y-2">
                    <Row k="Определяющая плотность"
                      v={<strong>{multiIntervalPlan.governingDensity.toFixed(3)} г/см³</strong>} />
                    {multiIntervalPlan.warnings.map((w, i) => (
                      <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>


          {/* ──────────────── DRAG / LUBE ──────────────── */}
          <TabsContent value="drag" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Операция и трение</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Операция</Label>
                    <Select value={drag.operation} onValueChange={(v) => setDrag({ ...drag, operation: v as DragInput["operation"] })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pull_out">Подъём (POOH)</SelectItem>
                        <SelectItem value="run_in">Спуск (RIH)</SelectItem>
                        <SelectItem value="rotate">Вращение</SelectItem>
                        <SelectItem value="work_pipe">Расхаживание</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberField label="μ базовой жидкости (без смазки)" value={drag.frictionCoeff}
                    onChange={(v) => setDrag({ ...drag, frictionCoeff: v })} hint="из Лубрисити тестера" />
                  <div className="flex items-center gap-2 pt-2">
                    <input id="usel" type="checkbox" checked={useLube} onChange={(e) => setUseLube(e.target.checked)} />
                    <Label htmlFor="usel" className="text-xs cursor-pointer">Применить смазку (лубрикант)</Label>
                  </div>
                  {useLube && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Наименование</Label>
                        <Input value={lube.name} onChange={(e) => setLube({ ...lube, name: e.target.value })} className="h-9" />
                      </div>
                      <NumberField label="Концентрация" unit="%" value={lube.concentration} onChange={(v) => setLube({ ...lube, concentration: v })} />
                      <NumberField label="Индекс проникновения" value={lube.penetrationIndex} onChange={(v) => setLube({ ...lube, penetrationIndex: v })} hint="1–10 (лаб.)" />
                      <NumberField label="CoF базовой жидкости" value={lube.baseFrictionCoeff} onChange={(v) => setLube({ ...lube, baseFrictionCoeff: v })} hint="OFITE/Fann" />
                      <NumberField label="CoF со смазкой" value={lube.lubricatedFrictionCoeff} onChange={(v) => setLube({ ...lube, lubricatedFrictionCoeff: v })} hint="OFITE/Fann" />
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Результаты T&D</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row k="Свободный вес колонны" v={`${dragNoLube.freeWeightKN.toFixed(0)} кН`} />
                  <Row k="Нагрузка на крюке (без смазки)" v={`${dragNoLube.maxHookLoadKN.toFixed(0)} кН`} />
                  <Row k="Нагрузка на крюке (со смазкой)" v={`${dragLube.maxHookLoadKN.toFixed(0)} кН`} />
                  <Row k="Применённый μ" v={`${activeDrag.appliedFrictionCoeff.toFixed(2)}`} />
                  <Row k="Расхаживание: подъём / спуск" v={`${activeDrag.pickUpKN.toFixed(0)} / ${activeDrag.slackOffKN.toFixed(0)} кН`} />
                  <Row k="Момент на устье при вращении" v={`${activeDrag.surfaceTorqueKNm.toFixed(2)} кН·м`} />
                  <Row k="Предел тела трубы на кручение" v={`${pipeTorsionalYieldKNm(well).toFixed(1)} кН·м`} />
                  {useLube && (
                    <>
                      <Row k="Снижение трения" v={`${lubeResult.frictionReductionPct.toFixed(0)} %`} />
                      <Row k="Снижение нагрузки" v={`${lubeResult.dragReductionKN.toFixed(0)} кН`} />
                      <Row k="Время проникновения" v={`${lubeResult.penetrationTimeHours.toFixed(1)} ч`} />
                      <div className="pt-1">
                        {lubeResult.effectiveForStuck
                          ? <Badge className="bg-green-600">Эффективна для дифф. прихвата</Badge>
                          : <Badge variant="secondary">Слабо подходит для дифф. прихвата</Badge>}
                      </div>
                    </>
                  )}
                  <Row k="Лимит подъёмника" v={`${rigResult.allowableLoadKN.toFixed(0)} кН`} />
                  <Row k="Допустимо на НКТ (резьба, износ, ÷1.25)" v={`${pipeYield.toFixed(0)} кН`} />
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Натяжение колонны по глубине</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={dragChart}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="md" label={{ value: "MD, м", position: "insideBottom", offset: -5 }} />
                    <YAxis label={{ value: "Нагрузка, кН", angle: -90, position: "insideLeft" }} />
                    <Tooltip />
                    <Legend />
                    <ReferenceLine y={rigResult.allowableLoadKN} stroke="#f43f5e" strokeDasharray="4 4" label="Лимит подъёмника" />
                    <ReferenceLine y={pipeYield} stroke="#a855f7" strokeDasharray="4 4" label="Допустимо на НКТ" />
                    <Line type="monotone" dataKey="base" name="Без смазки" stroke="#0ea5e9" dot={false} />
                    <Line type="monotone" dataKey="lube" name="Со смазкой" stroke="#10b981" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {drag.operation === "rotate" && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Крутящий момент по глубине</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={torqueChart}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="md" label={{ value: "MD, м", position: "insideBottom", offset: -5 }} />
                      <YAxis label={{ value: "Момент, кН·м", angle: -90, position: "insideLeft" }} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="base" name="Без смазки" stroke="#0ea5e9" dot={false} />
                      <Line type="monotone" dataKey="lube" name="Со смазкой" stroke="#10b981" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-[10px] text-muted-foreground">Для гладких НКТ ограничение по моменту — момент свинчивания резьбы по паспорту/ГОСТ, он значительно ниже предела тела трубы.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ──────────────── STUCK ──────────────── */}
          <TabsContent value="stuck" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Точка прихвата (растяжение с учётом трения)</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <NumberField label="Приложенное натяжение ΔF" unit="кН" value={fp.pulledForceKN} onChange={(v) => setFp({ ...fp, pulledForceKN: v })} hint="сверх веса колонны" />
                  <NumberField label="Измеренное удлинение ΔL" unit="м" value={fp.measuredStretchM} onChange={(v) => setFp({ ...fp, measuredStretchM: v })} />
                  <div className="border-t pt-3 text-sm space-y-1">
                    <Row k="По закону Гука L = E·A·ΔL/ΔF (без трения)" v={`${fpResult.idealFreePointMD.toFixed(0)} м`} />
                    <Row k={`С учётом трения (μ = ${drag.frictionCoeff}), средний зенит ${fpResult.avgZenithDeg.toFixed(0)}°`} v={`+${fpResult.frictionCorrectionPct.toFixed(1)}%`} />
                    <Row k="Точка прихвата" v={<strong>{fpResult.freePointMD.toFixed(0)} м</strong>} />
                    <Row k="Отворот / отрезание (1–2 трубы выше)" v={`≈ ${fpResult.backOffMD.toFixed(0)} м`} />
                  </div>
                  {fpResult.belowBottom && (
                    <Alert className="py-2"><AlertDescription className="text-xs">
                      🔴 Удлинение {fp.measuredStretchM} м больше, чем даёт вся колонна до забоя ({fpResult.maxStretchToBottomM.toFixed(2)} м). Проверьте замер, натяжку и данные колонны.
                    </AlertDescription></Alert>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Натяжка затухает по глубине из-за трения в искривлённом стволе, поэтому замеренное удлинение меньше, чем без трения, а точка прихвата глубже. Расчёт — для однородной колонны.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Признаки прихвата</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2">
                    {([["canRotate", "Вращается"], ["canMoveDown", "Ходит вниз"], ["canMoveUp", "Ходит вверх"]] as const).map(([k, lbl]) => (
                      <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox" checked={symptoms[k]} onChange={(e) => setSymptoms({ ...symptoms, [k]: e.target.checked })} />
                        {lbl}
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Циркуляция</Label>
                      <Select value={symptoms.circulation} onValueChange={(v) => setSymptoms({ ...symptoms, circulation: v as StuckSymptoms["circulation"] })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="free">Свободная</SelectItem>
                          <SelectItem value="restricted">Затруднена (рост давления)</SelectItem>
                          <SelectItem value="none">Нет</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Как возник</Label>
                      <Select value={symptoms.onset} onValueChange={(v) => setSymptoms({ ...symptoms, onset: v as StuckSymptoms["onset"] })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="moving_sudden">Резко при движении</SelectItem>
                          <SelectItem value="gradual">Затяжки нарастали</SelectItem>
                          <SelectItem value="after_static">После остановки</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ["sandProduction", "Пескопроявление"],
                      ["deposits", "АСПО / соли"],
                      ["packerInString", `Пакер в компоновке (${packer.setDepthMD} м)`],
                      ["afterCementing", "После цементных работ"],
                    ] as const).map(([k, lbl]) => (
                      <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox" checked={symptoms[k]} onChange={(e) => setSymptoms({ ...symptoms, [k]: e.target.checked })} />
                        {lbl}
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <NumberField label="Глубина прихвата" unit="м" value={symptoms.stuckDepthMD} onChange={(v) => setSymptoms({ ...symptoms, stuckDepthMD: v })} />
                    <NumberField label="Перфорация, верх" unit="м" value={symptoms.perfTopMD ?? 0} onChange={(v) => setSymptoms({ ...symptoms, perfTopMD: v })} />
                    <NumberField label="Перфорация, низ" unit="м" value={symptoms.perfBottomMD ?? 0} onChange={(v) => setSymptoms({ ...symptoms, perfBottomMD: v })} />
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Диагностика: вероятный вид прихвата</CardTitle></CardHeader>
              <CardContent className="grid lg:grid-cols-2 gap-4">
                <div className="space-y-2">
                  {stuckDiag.ranking.map((r, i) => (
                    <div key={r.type} className="space-y-0.5">
                      <div className="flex justify-between text-xs">
                        <span className={i === 0 ? "font-semibold" : "text-muted-foreground"}>{STUCK_LABELS[r.type]}</span>
                        <span className={i === 0 ? "font-semibold" : "text-muted-foreground"}>{(r.probability * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 rounded bg-muted overflow-hidden">
                        <div className={`h-full ${i === 0 ? "bg-primary" : "bg-muted-foreground/40"}`} style={{ width: `${r.probability * 100}%` }} />
                      </div>
                      {i === 0 && r.reasons.length > 0 && (
                        <p className="text-[10px] text-muted-foreground">{r.reasons.join("; ")}</p>
                      )}
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground pt-1">Экспертная балльная оценка по признакам, не замена исследованию (печать, ПГИ, прихватоопределитель).</p>
                </div>
                <div className="space-y-2 text-sm">
                  <Row k="Вероятный вид" v={<Badge>{STUCK_LABELS[stuckDiag.type]}</Badge>} />
                  <Row k="Вес колонны до прихвата (с затяжками)" v={`${stuckDiag.stringLoadKN.toFixed(0)} кН`} />
                  {stuckDiag.type === "differential" && (
                    <div className="grid grid-cols-3 gap-2 py-1">
                      <NumberField label="Репрессия ΔP" unit="МПа" value={symptoms.deltaP_MPa ?? 0} onChange={(v) => setSymptoms({ ...symptoms, deltaP_MPa: v })} />
                      <NumberField label="Длина контакта" unit="м" value={symptoms.contactLenM ?? 0} onChange={(v) => setSymptoms({ ...symptoms, contactLenM: v })} />
                      <NumberField label="μ корки" value={symptoms.mudcakeFriction ?? 0.25} onChange={(v) => setSymptoms({ ...symptoms, mudcakeFriction: v })} hint="0.15–0.35" />
                    </div>
                  )}
                  {stuckDiag.freeingForceKN > 0 && (
                    <>
                      <Row k="Усилие освобождения (μ·ΔP·A)" v={`${stuckDiag.freeingForceKN.toFixed(0)} кН`} />
                      <Row k="Требуемая нагрузка на крюке" v={<strong>{stuckDiag.requiredHookLoadKN.toFixed(0)} кН</strong>} />
                      <Row k="Освободится натяжением" v={stuckDiag.canFreeByPull
                        ? <Badge className="bg-green-600">ДА</Badge>
                        : <Badge variant="destructive">НЕТ</Badge>} />
                    </>
                  )}
                  <Row k="Допустимо на НКТ" v={`${stuckDiag.pipeYieldKN.toFixed(0)} кН`} />
                  <Row k="Лимит подъёмника" v={`${rigResult.allowableLoadKN.toFixed(0)} кН`} />
                  <Row k="Запас натяжки сверх веса" v={`${Math.max(0, Math.min(stuckDiag.pipeYieldKN, rigResult.allowableLoadKN) - stuckDiag.stringLoadKN).toFixed(0)} кН`} />
                  <Alert><AlertDescription className="text-xs">{stuckDiag.recommendation}</AlertDescription></Alert>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ──────────────── FISHING ──────────────── */}
          <TabsContent value="fishing" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Параметры ловильной операции</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <NumberField label="Голова рыбы (MD)" unit="м" value={fish.fishTopMD} onChange={(v) => setFish({ ...fish, fishTopMD: v })} />
                  <NumberField label="Вес рыбы" unit="кН" value={fish.fishWeightKN} onChange={(v) => setFish({ ...fish, fishWeightKN: v })} />
                  <NumberField label="Overpull" unit="кН" value={fish.overpullKN} onChange={(v) => setFish({ ...fish, overpullKN: v })} hint="доп. натяжение" />
                  <div className="space-y-1">
                    <Label className="text-xs">Тип ясса</Label>
                    <Select value={fish.jarType ?? "hydraulic"} onValueChange={(v) => setFish({ ...fish, jarType: v as "hydraulic" | "mechanical" })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hydraulic">Гидравлический</SelectItem>
                        <SelectItem value="mechanical">Механический</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberField label="УБТ над яссом, длина" unit="м" value={fish.collarLengthM ?? 0} onChange={(v) => setFish({ ...fish, collarLengthM: v })} hint="0 — без УБТ" />
                  <NumberField label="УБТ OD" unit="мм" value={fish.collarOD_mm ?? 0} onChange={(v) => setFish({ ...fish, collarOD_mm: v })} />
                  <NumberField label="УБТ ID" unit="мм" value={fish.collarID_mm ?? 0} onChange={(v) => setFish({ ...fish, collarID_mm: v })} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Результаты</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row k="Вес колонны с рыбой (с затяжками)" v={`${fishResult.stringLoadKN.toFixed(0)} кН`} />
                  <Row k="Нагрузка на крюке при натяжке" v={<strong>{fishResult.requiredHookLoadKN.toFixed(0)} кН</strong>}
                    tone={fishResult.requiredHookLoadKN > Math.min(fishResult.maxSafeHookLoadKN, rigResult.allowableLoadKN) ? "danger" : "ok"} />
                  <Row k="Растяжение колонны при натяжке (Гук)" v={`${fishResult.jarStretchM.toFixed(2)} м`} />
                  <Row k="Энергия взвода (½·F·x)" v={`${(fishResult.jarEnergyJ / 1000).toFixed(1)} кДж`} />
                  <Row k="Скорость ударной части (F / A√(Eρ))" v={`${fishResult.jarVelocityMs.toFixed(1)} м/с`} />
                  <Row k="Ударная сила (оценка)" v={<strong>{fishResult.jarImpactLowKN.toFixed(0)}–{fishResult.jarImpactHighKN.toFixed(0)} кН</strong>} />
                  <Row k="Допустимо на НКТ (резьба, износ, ÷1.25)" v={`${fishResult.maxSafeHookLoadKN.toFixed(0)} кН`} />
                  <Row k="Лимит подъёмника" v={`${rigResult.allowableLoadKN.toFixed(0)} кН`} />
                  <div className="pt-1">
                    {fishResult.canEngage && fishResult.requiredHookLoadKN < rigResult.allowableLoadKN
                      ? <Badge className="bg-green-600">🟢 Операция в безопасном окне</Badge>
                      : <Badge variant="destructive">🔴 Превышение пределов</Badge>}
                  </div>
                  <Alert><AlertDescription className="text-xs">{fishResult.recommendation}</AlertDescription></Alert>
                  {fishResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </CardContent>
              </Card>
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Подбор ловильного инструмента (ориентировочно)</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField label="Наружный диаметр головы рыбы" unit="мм" value={fishTool.fishOD_mm} onChange={(v) => setFishTool({ ...fishTool, fishOD_mm: v })} hint="муфта НКТ 73 — 88.9 мм" />
                    <NumberField label="Внутренний диаметр головы" unit="мм" value={fishTool.fishID_mm} onChange={(v) => setFishTool({ ...fishTool, fishID_mm: v })} hint="0 — нет канала" />
                    <NumberField label="Мин. зазор с колонной (по диаметру)" unit="мм" value={fishTool.minClearance_mm} onChange={(v) => setFishTool({ ...fishTool, minClearance_mm: v })} />
                    <NumberField label="Стенка корпуса наружного захвата" unit="мм" value={fishTool.externalBodyWall_mm} onChange={(v) => setFishTool({ ...fishTool, externalBodyWall_mm: v })} hint="на сторону, по каталогу" />
                    <label className="flex items-center gap-2 text-xs cursor-pointer col-span-2">
                      <input type="checkbox" checked={fishTool.headDamaged} onChange={(e) => setFishTool({ ...fishTool, headDamaged: e.target.checked })} />
                      Голова рыбы повреждена / неизвестна
                    </label>
                  </div>
                  <Row k={`Макс. диаметр инструмента в колонне ID ${well.casingID_mm} мм`} v={`${fishTools.maxToolOD_mm.toFixed(0)} мм`} />
                  <div className="space-y-1.5">
                    {fishTools.options.map((o) => (
                      <div key={o.tool} className="flex items-start gap-2 text-xs">
                        <Badge className={o.feasible ? "bg-green-600" : ""} variant={o.feasible ? "default" : "secondary"}>{o.feasible ? "да" : "нет"}</Badge>
                        <div><span className="font-medium">{o.tool}.</span> <span className="text-muted-foreground">{o.note}</span></div>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Размеры конкретного инструмента — по каталогу поставщика: проверить диапазон захвата и наружный диаметр.</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Отворот: момент и число оборотов</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField label="Глубина отворота" unit="м" value={backOff.backOffMD} onChange={(v) => setBackOff({ ...backOff, backOffMD: v })}
                      hint={`0 = по точке прихвата (${fpResult.backOffMD.toFixed(0)} м)`} />
                    <NumberField label="Момент отворота резьбы" unit="кН·м" value={backOff.breakoutTorqueKNm} onChange={(v) => setBackOff({ ...backOff, breakoutTorqueKNm: v })}
                      hint="≈ момент свинчивания × 1.2–1.5" />
                  </div>
                  <div className="text-sm space-y-1">
                    <Row k="Момент трения колонны в стволе" v={`${backOffResult.frictionTorqueKNm.toFixed(2)} кН·м`} />
                    <Row k="Момент на устье" v={<strong>{backOffResult.surfaceTorqueKNm.toFixed(2)} кН·м</strong>}
                      tone={backOffResult.ok ? "ok" : "danger"} />
                    <Row k="Закрутка колонны до передачи момента" v={<strong>{backOffResult.turns.toFixed(1)} об.</strong>} />
                    <Row k="Предел тела трубы на кручение" v={`${backOffResult.torsionalYieldKNm.toFixed(1)} кН·м`} />
                  </div>
                  {backOffResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ──────────────── CLEANOUT ──────────────── */}
          <TabsContent value="cleanout" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Промывка песчаной пробки</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <div className="space-y-1 col-span-2">
                    <Label className="text-xs">Способ промывки</Label>
                    <Select value={cleanout.method} onValueChange={(v) => setCleanout({ ...cleanout, method: v as CleanoutInput["method"] })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="direct">Прямая (вниз по НКТ, вверх по затрубью)</SelectItem>
                        <SelectItem value="reverse">Обратная (вниз по затрубью, вверх по НКТ)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <NumberField label="Кровля пробки" unit="м" value={cleanout.plugTopMD} onChange={(v) => setCleanout({ ...cleanout, plugTopMD: v })} />
                  <NumberField label="Подошва пробки" unit="м" value={cleanout.plugBottomMD} onChange={(v) => setCleanout({ ...cleanout, plugBottomMD: v })} />
                  <NumberField label="Расход" unit="л/с" value={cleanout.rateLs} onChange={(v) => setCleanout({ ...cleanout, rateLs: v })} />
                  <NumberField label="Диаметр зёрен песка" unit="мм" value={cleanout.grainDiameter_mm} onChange={(v) => setCleanout({ ...cleanout, grainDiameter_mm: v })} hint="0.1–0.5" />
                  <NumberField label="Скорость подачи (размыва)" unit="м/ч" value={cleanout.feedRate_mh} onChange={(v) => setCleanout({ ...cleanout, feedRate_mh: v })} />
                  <NumberField label="Пористость пробки" value={cleanout.plugPorosity} onChange={(v) => setCleanout({ ...cleanout, plugPorosity: v })} hint="доля, 0.35–0.45" />
                  <p className="col-span-2 text-[10px] text-muted-foreground">
                    Жидкость промывки — из общих данных ({well.fluidDensity_gcm3} г/см³, PV {well.fluidPV_cP} сП).
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Результаты промывки</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row k={`Скорость осаждения песка (${cleanoutResult.settlingRegime})`} v={`${cleanoutResult.settlingVelocityMs.toFixed(3)} м/с`} />
                  <Row k={`Восходящая скорость (${cleanoutResult.upflowArea})`} v={<strong>{cleanoutResult.upflowVelocityMs.toFixed(2)} м/с</strong>}
                    tone={cleanoutResult.upflowVelocityMs >= 2 * cleanoutResult.settlingVelocityMs ? "ok" : "danger"} />
                  <Row k="Коэффициент выноса (v − vос)/v" v={`${(cleanoutResult.transportRatio * 100).toFixed(0)} %`} />
                  <Row k="Минимальный расход (v ≥ 2·vос)" v={`${cleanoutResult.minRateLs.toFixed(1)} л/с`} />
                  <Row k="Время подъёма песка от кровли до устья" v={Number.isFinite(cleanoutResult.liftTimeMin) ? `${cleanoutResult.liftTimeMin.toFixed(0)} мин` : "не выносится"} />
                  <Row k="Песок в пробке" v={`${cleanoutResult.sandVolumeM3.toFixed(2)} м³ / ${(cleanoutResult.sandMassKg / 1000).toFixed(1)} т`} />
                  <Row k="Концентрация песка в потоке" v={`${cleanoutResult.sandConcentrationPct.toFixed(1)} % об.`}
                    tone={cleanoutResult.sandConcentrationPct > 5 ? "warn" : undefined} />
                  <Row k="Время размыва пробки" v={`${cleanoutResult.washTimeH.toFixed(1)} ч`} />
                  <Row k="Давление на насосе (трение)" v={`${cleanoutResult.pumpPressureMPa.toFixed(1)} МПа`} />
                  <Row k="Доп. давление на забой от трения" v={`${cleanoutResult.bottomholeExtraMPa.toFixed(2)} МПа`} />
                  <div className="pt-1">
                    {cleanoutResult.ok ? <Badge className="bg-green-600">🟢 Песок выносится</Badge> : <Badge variant="destructive">🔴 Недостаточный вынос</Badge>}
                  </div>
                  {cleanoutResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ──────────────── CASING / SWAB ──────────────── */}
          <TabsContent value="casing" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Освоение снижением уровня (свабирование)</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField label="Глубина пласта MD" unit="м" value={swab.reservoirMD} onChange={(v) => setSwab({ ...swab, reservoirMD: v })} />
                    <NumberField label="Pпл" unit="МПа" value={swab.reservoirPressureMPa} onChange={(v) => setSwab({ ...swab, reservoirPressureMPa: v })} />
                    <NumberField label="Требуемая депрессия" unit="МПа" value={swab.targetDrawdownMPa} onChange={(v) => setSwab({ ...swab, targetDrawdownMPa: v })} />
                    <NumberField label="Плотность жидкости" unit="г/см³" value={swab.fluidDensity} onChange={(v) => setSwab({ ...swab, fluidDensity: v })} />
                    <NumberField label="Погружение сваба" unit="м" value={swab.swabSubmergenceM} onChange={(v) => setSwab({ ...swab, swabSubmergenceM: v })} hint="100–300" />
                    <NumberField label="Коэффициент подачи" value={swab.swabEfficiency} onChange={(v) => setSwab({ ...swab, swabEfficiency: v })} hint="0.6–0.9" />
                    <NumberField label="Скорость сваба" unit="м/с" value={swab.swabSpeedMs} onChange={(v) => setSwab({ ...swab, swabSpeedMs: v })} />
                    <label className="flex items-end gap-2 text-xs cursor-pointer pb-2">
                      <input type="checkbox" checked={swab.packerInstalled} onChange={(e) => setSwab({ ...swab, packerInstalled: e.target.checked })} />
                      Пакер установлен
                    </label>
                  </div>
                  <div className="text-sm space-y-1">
                    <Row k="Статический уровень" v={`${swabResult.staticLevelMD.toFixed(0)} м MD (TVD ${swabResult.staticLevelTVD.toFixed(0)})`} />
                    <Row k="Уровень для заданной депрессии" v={<strong>{swabResult.requiredLevelMD.toFixed(0)} м MD</strong>} tone={swabResult.feasible ? undefined : "danger"} />
                    <Row k="Объём отбора" v={`${swabResult.volumeToRemoveM3.toFixed(2)} м³`} />
                    <Row k="За один рейс сваба" v={`${(swabResult.volumePerRunM3 * 1000).toFixed(0)} л`} />
                    <Row k="Число рейсов / время" v={`${swabResult.runs} / ${swabResult.timeH.toFixed(1)} ч`} />
                  </div>
                  {swabResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Эксплуатационная колонна: опрессовка и смятие (API 5C3)</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <NumberField label="OD колонны" unit="мм" value={casing.casingOD_mm} onChange={(v) => setCasing({ ...casing, casingOD_mm: v })} />
                    <NumberField label="Стенка" unit="мм" value={casing.casingWall_mm} onChange={(v) => setCasing({ ...casing, casingWall_mm: v })}
                      hint={`ID ${(casing.casingOD_mm - 2 * casing.casingWall_mm).toFixed(1)} мм`} />
                    <div className="space-y-1">
                      <Label className="text-xs">Группа прочности</Label>
                      <Select value={casing.casingGrade} onValueChange={(v) => setCasing({ ...casing, casingGrade: v, casingYieldMPa: STEEL_GRADES[v] ?? casing.casingYieldMPa })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.keys(STEEL_GRADES).map((g) => <SelectItem key={g} value={g}>{g} — {STEEL_GRADES[g]} МПа</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <NumberField label="Износ стенки" unit="%" value={casing.wearPct} onChange={(v) => setCasing({ ...casing, wearPct: v })} />
                    <NumberField label="Низ интервала MD" unit="м" value={casing.bottomMD} onChange={(v) => setCasing({ ...casing, bottomMD: v })} hint="пакер/забой" />
                    <NumberField label="Давление опрессовки" unit="МПа" value={casing.testPressureMPa} onChange={(v) => setCasing({ ...casing, testPressureMPa: v })} />
                    <NumberField label="ρ внутри" unit="г/см³" value={casing.insideDensity} onChange={(v) => setCasing({ ...casing, insideDensity: v })} />
                    <NumberField label="ρ за колонной" unit="г/см³" value={casing.outsideDensity} onChange={(v) => setCasing({ ...casing, outsideDensity: v })} hint="опорное давление" />
                    <NumberField label="Уровень в колонне" unit="м" value={casing.levelMD} onChange={(v) => setCasing({ ...casing, levelMD: v })}
                      hint={`0 = из освоения (${swabResult.requiredLevelMD.toFixed(0)} м)`} />
                    <NumberField label="Запас на разрыв" value={casing.sfBurst} onChange={(v) => setCasing({ ...casing, sfBurst: v })} />
                    <NumberField label="Запас на смятие" value={casing.sfCollapse} onChange={(v) => setCasing({ ...casing, sfCollapse: v })} />
                  </div>
                  <div className="text-sm space-y-1">
                    <Row k="Давление разрыва / допустимое" v={`${casingResult.burstRatingMPa.toFixed(1)} / ${casingResult.burstAllowableMPa.toFixed(1)} МПа`} />
                    <Row k={`Давление смятия (${casingResult.collapseRegime}, D/t ${casingResult.dt.toFixed(1)}) / допустимое`} v={`${casingResult.collapseRatingMPa.toFixed(1)} / ${casingResult.collapseAllowableMPa.toFixed(1)} МПа`} />
                    <Row k="Макс. нагрузка при опрессовке" v={`${casingResult.maxBurstLoadMPa.toFixed(1)} МПа на ${casingResult.maxBurstAtMD.toFixed(0)} м`} tone={casingResult.burstOk ? "ok" : "danger"} />
                    <Row k="Допустимое давление опрессовки на устье" v={<strong>{casingResult.maxTestPressureMPa.toFixed(1)} МПа</strong>} />
                    <Row k={`Макс. нагрузка на смятие (уровень ${casingLevel.toFixed(0)} м)`} v={`${casingResult.maxCollapseLoadMPa.toFixed(1)} МПа`} tone={casingResult.collapseOk ? "ok" : "danger"} />
                    <Row k="Допустимое снижение уровня до" v={<strong>{casingResult.maxLevelMD.toFixed(0)} м</strong>} />
                  </div>
                  {casingResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Нагрузки на колонну по глубине</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={casingResult.profile.map((p) => ({ md: Math.round(p.md), burst: +p.burstLoad.toFixed(2), collapse: +p.collapseLoad.toFixed(2) }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="md" label={{ value: "MD, м", position: "insideBottom", offset: -5 }} />
                    <YAxis label={{ value: "Давление, МПа", angle: -90, position: "insideLeft" }} />
                    <Tooltip />
                    <Legend />
                    <ReferenceLine y={casingResult.burstAllowableMPa} stroke="#f43f5e" strokeDasharray="4 4" label="Допустимо: разрыв" />
                    <ReferenceLine y={casingResult.collapseAllowableMPa} stroke="#f59e0b" strokeDasharray="4 4" label="Допустимо: смятие" />
                    <Line type="monotone" dataKey="burst" name="Опрессовка (внутр. − наруж.)" stroke="#0ea5e9" dot={false} />
                    <Line type="monotone" dataKey="collapse" name="Снижение уровня (наруж. − внутр.)" stroke="#a855f7" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ──────────────── RIG ──────────────── */}
          <TabsContent value="rig" className="space-y-4">
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Параметры подъёмника</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 gap-3">
                  <NumberField label="Грузоподъёмность лебёдки" unit="кН" value={rig.rigCapacityKN} onChange={(v) => setRig({ ...rig, rigCapacityKN: v })} />
                  <NumberField label="Грузоподъёмность мачты" unit="кН" value={rig.derrickCapacityKN} onChange={(v) => setRig({ ...rig, derrickCapacityKN: v })} />
                  <NumberField label="Коэфф. запаса" value={rig.safetyFactor} onChange={(v) => setRig({ ...rig, safetyFactor: v })} hint="обычно 1.5–2.0" />
                  <NumberField label="Текущая нагрузка на крюке" unit="кН" value={rig.currentHookLoadKN} onChange={(v) => setRig({ ...rig, currentHookLoadKN: v })}
                    hint={`0 = подъём колонны по расчёту (${pullOutFull.toFixed(0)} кН)`} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Окно безопасности</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row k="Ограничивающий элемент" v={rigResult.limitingComponent === "rig" ? "Лебёдка" : "Мачта"} />
                  <Row k={`Допустимая (÷${rig.safetyFactor})`} v={`${rigResult.allowableLoadKN.toFixed(0)} кН`} />
                  <Row k="Загрузка" v={`${rigResult.utilizationPct.toFixed(1)} %`}
                    tone={rigResult.status === "overload" ? "danger" : rigResult.status === "caution" ? "warn" : "ok"} />
                  <Row k="Запас (на расхаживание)" v={`${rigResult.maxOverpullKN.toFixed(0)} кН`} />
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      layout="vertical"
                      data={[
                        { name: "Тек. нагрузка", v: rigEffective.currentHookLoadKN, fill: "#0ea5e9" },
                        { name: "Допустимая", v: rigResult.allowableLoadKN, fill: "#10b981" },
                        { name: "Допустимо на НКТ", v: pipeYield, fill: "#a855f7" },
                        { name: "Тело трубы", v: pipeBody, fill: "#c084fc" },
                        { name: "Лебёдка", v: rig.rigCapacityKN, fill: "#f59e0b" },
                        { name: "Мачта", v: rig.derrickCapacityKN, fill: "#f43f5e" },
                      ]}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" label={{ value: "кН", position: "insideBottom", offset: -5 }} />
                      <YAxis type="category" dataKey="name" width={110} />
                      <Tooltip />
                      <Bar dataKey="v" />
                    </BarChart>
                  </ResponsiveContainer>
                  {rigResult.warnings.map((w, i) => (
                    <Alert key={i} className="py-2"><AlertDescription className="text-xs">{w}</AlertDescription></Alert>
                  ))}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Сводная таблица сценариев</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Операция</TableHead>
                      <TableHead>Требуемая нагрузка</TableHead>
                      <TableHead>Лимит подъёмника</TableHead>
                      <TableHead>Допустимо на НКТ</TableHead>
                      <TableHead>Статус</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <ScenarioRow label="Подъём колонны (без смазки)" need={pullOutFull} allow={rigResult.allowableLoadKN} pipe={pipeYield} />
                    <ScenarioRow label="Подъём со смазкой" need={calculateDrag({ operation: "pull_out", frictionCoeff: drag.frictionCoeff, lubricant: lube }, well).maxHookLoadKN} allow={rigResult.allowableLoadKN} pipe={pipeYield} />
                    <ScenarioRow label="Срыв пакера" need={releaseResult.totalPullRequiredKN} allow={rigResult.allowableLoadKN} pipe={pipeYield} />
                    {stuckDiag.freeingForceKN > 0 && (
                      <ScenarioRow label="Освобождение прихвата" need={stuckDiag.requiredHookLoadKN} allow={rigResult.allowableLoadKN} pipe={pipeYield} />
                    )}
                    <ScenarioRow label="Ловильная операция" need={fishResult.requiredHookLoadKN} allow={rigResult.allowableLoadKN} pipe={pipeYield} />
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <TermsFooter />
      <SaveToCabinetDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        defaultTitle={`КРС ${new Date().toLocaleDateString("ru-RU")}`}
        initialWellId={selectedWellId}
        calcId={calcId}
        buildPayload={buildPayload}
      />
    </div>
  );
}

// ───── small helpers ─────

function Stat({ label, v, tone }: { label: string; v: React.ReactNode; tone?: "ok" | "warn" | "danger" }) {
  const color =
    tone === "danger" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-green-600" : "";
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-semibold ${color}`}>{v}</span>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "ok" | "warn" | "danger" }) {
  const color =
    tone === "danger" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-green-600" : "";
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground text-xs">{k}</span>
      <span className={`font-medium text-right ${color}`}>{v}</span>
    </div>
  );
}

function ScenarioRow({ label, need, allow, pipe }: { label: string; need: number; allow: number; pipe: number }) {
  const ok = need <= Math.min(allow, pipe);
  const overRig = need > allow;
  const overPipe = need > pipe;
  return (
    <TableRow>
      <TableCell className="text-xs">{label}</TableCell>
      <TableCell className="text-xs">{need.toFixed(0)} кН</TableCell>
      <TableCell className="text-xs">{allow.toFixed(0)} кН</TableCell>
      <TableCell className="text-xs">{pipe.toFixed(0)} кН</TableCell>
      <TableCell className="text-xs">
        {ok
          ? <Badge className="bg-green-600">OK</Badge>
          : <Badge variant="destructive">{overPipe ? "ПРЕДЕЛ НКТ" : overRig ? "ПЕРЕГРУЗ" : "—"}</Badge>}
      </TableCell>
    </TableRow>
  );
}

function labelStuck(t: string) {
  return { differential: "Дифференциальный", mechanical: "Механический", keyseat: "Желобной", cuttings: "Шламовый", cement: "Цементный" }[t] ?? t;
}
