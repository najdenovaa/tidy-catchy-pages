import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, AlertTriangle, FlaskConical, Sparkles, Calculator, ListChecks, TrendingUp, FileText, Activity } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from "recharts";
import { rankMethods, type ReservoirData, type RankedMethod, scoreColor } from "@/lib/stimulation-ranking";
import { STIMULATION_METHODS, METHOD_CATEGORY_LABEL, COLLECTOR_LABEL, type StimulationMethod, type CollectorType, type MethodCategory } from "@/lib/stimulation-methods";
import { buildAcidStages, computeAcidKinetics, computeAcidStoichiometry } from "@/lib/stimulation-acid";
import { DEFAULT_ACID_COMPOSITION, calculateDissolvingPower, formatAcidLabel, acidPenetration, type AcidComposition } from "@/lib/acid-chemistry";
import AcidCompositionEditor from "@/components/AcidCompositionEditor";
import WormholeVisualization from "@/components/WormholeVisualization";

import Wormhole3D from "@/components/Wormhole3D";
import {
  diagnoseDamage, decomposeSkin, fitArpsDecline, forecastPostTreatment,
  type DamageAssessment, type ReservoirSnapshot, type Mineralogy, type DrillingHistory,
  type ProductionPoint,
} from "@/lib/foam-treatment-diagnostics";
import {
  DEFAULT_MINERALOGY_CARBONATE, DEFAULT_MINERALOGY_SANDSTONE, DEFAULT_FLUID, DEFAULT_DEPTH, DEFAULT_STRESS,
  toLegacyMineralogy, stoichiometricDemandByMineralogy, fracturePressureMPa,
  type DetailedMineralogy, type FluidProperties, type DepthProfile, type StressState,
} from "@/lib/geology-model";
import GeologyEditor from "@/components/GeologyEditor";
import { exportStimulationDocx } from "@/lib/export-stimulation-docx";
import {
  calculateGasIPR, diagnoseGasDamage, WELL_FLUID_LABEL,
  type WellFluidType, type GasDamage,
} from "@/lib/stimulation-gas-ipr";
import { SharedWellCard } from "@/components/SharedWellCard";
import SolventCalcPanel from "@/components/SolventCalcPanel";
import NitrogenCalcPanel from "@/components/NitrogenCalcPanel";
import type { SolventResult, NitrogenResult } from "@/lib/stimulation-special";
import {
  calculateMatrixInjection, displacementVolumeM3, DEFAULT_CONSTRUCTION, injectivity, type WellConstruction,
} from "@/lib/stimulation-injection";
import { calculateWormholes, treatedDamageSkin, REGIME_LABEL } from "@/lib/stimulation-wormhole";
import { CEMENT_LABEL, type CementQuality } from "@/lib/stimulation-ranking";
import {
  buildInjectionSchedule, calculateStimulationEconomics, allocateAcidToZones,
  type ScheduleStage, type Zone,
} from "@/lib/stimulation-operations";
import { interpretStepRateTest, type StepRatePoint } from "@/lib/foam-treatment-diagnostics";
import SaveToCabinetDialog, { type SaveCalcPayload } from "@/components/SaveToCabinetDialog";
import { supabase } from "@/integrations/supabase/client";
import { Save } from "lucide-react";
import * as XLSX from "xlsx";
import { Plus, Trash2 } from "lucide-react";

const REAGENT_COLOR_MAP: Record<string, "acid" | "foam" | "solvent" | "nitrogen" | "combo"> = {
  acid: "acid", foam: "foam", solvent: "solvent", nitrogen: "nitrogen", combo: "combo",
};

const TABS = [
  { id: "diag", label: "Диагностика", icon: FlaskConical },
  { id: "method", label: "Метод", icon: Sparkles },
  { id: "calc", label: "Расчёт", icon: Calculator },
  { id: "plan", label: "План", icon: ListChecks },
  { id: "forecast", label: "Прогноз", icon: TrendingUp },
  { id: "report", label: "Отчёт", icon: FileText },
] as const;


export default function Stimulation() {
  const [tab, setTab] = useState<string>("diag");
  const [wellName, setWellName] = useState("Скважина-1");

  // Тип скважины (нефть/газ/конденсат/нагнетательная)
  const [fluidType, setFluidType] = useState<WellFluidType>("oil");
  const [gasGravity, setGasGravity] = useState(0.68);
  const [zFactorManual, setZFactorManual] = useState(0); // 0 = авто (Papay)
  const [dewPointMPa, setDewPointMPa] = useState(18);
  const [condGasRatio, setCondGasRatio] = useState(150);
  const [bhpCurrentMPa, setBhpCurrentMPa] = useState(10);

  // Reservoir input
  const [reservoir, setReservoir] = useState<ReservoirData>({
    collectorType: "carbonate",
    temperatureC: 75,
    permeability_mD: 15,
    porosity: 0.15,
    payZoneM: 12,
    reservoirPressureMPa: 22,
  });

  // Production history (used for auto-diagnosis + Arps)
  const [qInitial, setQInitial] = useState(80);
  const [qCurrent, setQCurrent] = useState(35);
  const [waterCut, setWaterCut] = useState(30);
  const [monthsHistory, setMonthsHistory] = useState(18);
  const [skinCurrent, setSkinCurrent] = useState(8);

  // Геология: детальная минералогия + флюид + глубина + геомеханика
  const [detailedMin, setDetailedMin] = useState<DetailedMineralogy>(DEFAULT_MINERALOGY_CARBONATE);
  const [geologyMode, setGeologyMode] = useState<"detailed" | "averaged">("detailed");
  const [fluidProps, setFluidProps] = useState<FluidProperties>(DEFAULT_FLUID);
  const [depthProfile, setDepthProfile] = useState<DepthProfile>(DEFAULT_DEPTH);
  const [stressState, setStressState] = useState<StressState>(DEFAULT_STRESS);

  // Заканчивание / буровая история
  const [perfDensity, setPerfDensity] = useState(20);
  const [mudType, setMudType] = useState<"wbm" | "obm" | "sbm">("wbm");
  const [overbalanceMPa, setOverbalanceMPa] = useState(3);
  const [soakDays, setSoakDays] = useState(7);

  // Авто-подмена дефолтов минералогии при смене типа коллектора
  useEffect(() => {
    if (reservoir.collectorType === "sandstone") setDetailedMin(DEFAULT_MINERALOGY_SANDSTONE);
    else setDetailedMin(DEFAULT_MINERALOGY_CARBONATE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservoir.collectorType]);

  const [selectedMethodId, setSelectedMethodId] = useState<string>("hcl-matrix");
  const [searchParams] = useSearchParams();
  const initialCategory = (searchParams.get("category") as MethodCategory | null) ?? null;
  const [categoryFilter, setCategoryFilter] = useState<MethodCategory | "all">(initialCategory ?? "all");

  // При первом заходе с ?category=foam (после редиректа со старой страницы пенообработки)
  // — переключаемся сразу на вкладку выбора метода
  useEffect(() => {
    if (initialCategory) setTab("method");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isGas = fluidType === "gas" || fluidType === "gas_condensate";
  const rateUnit = isGas ? "тыс.м³/сут" : "м³/сут";


  // ── Derived: build synthetic history ───────────────────────────────
  const syntheticHistory: ProductionPoint[] = useMemo(() => {
    const pts: ProductionPoint[] = [];
    const months = Math.max(3, monthsHistory);
    const d = qInitial > 0 ? Math.log(Math.max(0.05, qCurrent) / qInitial) / months : 0;
    for (let m = 0; m <= months; m++) {
      const q = qInitial * Math.exp(d * m);
      pts.push({ month: m, qOil: q, waterCut });
    }
    return pts;
  }, [qInitial, qCurrent, monthsHistory, waterCut]);

  // Замеры добычи (вводятся вручную или из Excel). Если замеров < 3 — используется оценка по Q нач/текущ.
  const [historyMode, setHistoryMode] = useState<"synthetic" | "measured">("synthetic");
  const [measured, setMeasured] = useState<ProductionPoint[]>([]);
  const history: ProductionPoint[] = useMemo(
    () => (historyMode === "measured" && measured.filter((p) => p.qOil > 0).length >= 3
      ? [...measured].sort((a, b) => a.month - b.month)
      : syntheticHistory),
    [historyMode, measured, syntheticHistory],
  );
  const switchToMeasured = () => {
    if (measured.length === 0) setMeasured(syntheticHistory.map((p) => ({ ...p, qOil: +p.qOil.toFixed(1) })));
    setHistoryMode("measured");
  };
  const importHistory = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "array" });
        const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        const find = (row: Record<string, unknown>, keys: string[]) => {
          for (const k of Object.keys(row)) if (keys.some((x) => k.toLowerCase().includes(x))) return row[k];
          return undefined;
        };
        const pts = rows.map((r, i) => {
          const month = parseFloat(String(find(r, ["мес", "month", "период"]) ?? i));
          const q = parseFloat(String(find(r, ["дебит", "q", "rate", "нефт", "газ"])));
          const wc = parseFloat(String(find(r, ["обв", "wc", "water", "вод"])));
          const bhp = parseFloat(String(find(r, ["pзаб", "забой", "bhp", "pwf"])));
          return { month: Number.isFinite(month) ? month : i, qOil: q, waterCut: Number.isFinite(wc) ? wc : undefined, bhpMPa: Number.isFinite(bhp) ? bhp : undefined };
        }).filter((p) => Number.isFinite(p.qOil) && p.qOil > 0);
        if (pts.length >= 3) { setMeasured(pts); setHistoryMode("measured"); toast.success(`Загружено ${pts.length} замеров`); }
        else toast.error("Нужно не меньше 3 строк с дебитом (столбцы: месяц, дебит, обводнённость, Pзаб)");
      } catch { toast.error("Не удалось прочитать файл"); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  // Конструкция скважины (для продавки, давления на устье и Pгрп по TVD)
  const [construction, setConstruction] = useState<WellConstruction>(DEFAULT_CONSTRUCTION);
  const displacement = useMemo(() => displacementVolumeM3(construction), [construction]);
  const [plannedRateLpm, setPlannedRateLpm] = useState(0); // 0 = авто
  const [injFluidViscosity, setInjFluidViscosity] = useState(1.2);
  const [fracMarginMPa, setFracMarginMPa] = useState(1.5);
  // Параметры керна для червоточин и зоны повреждения
  const [viOptCmMin, setViOptCmMin] = useState(1.5);
  const [pvBtOpt, setPvBtOpt] = useState(0.6);
  const [damageRadiusM, setDamageRadiusM] = useState(0.5);
  const [hfLiveRadiusM, setHfLiveRadiusM] = useState(0.3);
  // Риск обводнения
  const [distanceToContactM, setDistanceToContactM] = useState(0);
  const [cementQuality, setCementQuality] = useState<CementQuality>("unknown");

  const reservoirSnap: ReservoirSnapshot = useMemo(() => ({
    Pr: reservoir.reservoirPressureMPa,
    Pb: reservoir.reservoirPressureMPa * 0.7,
    k_mD: reservoir.permeability_mD,
    h: reservoir.payZoneM,
    mu_cP: fluidProps.oilViscosity_cP,
    Bo: fluidProps.Bo,
    re: 250,
    rw: 0.108,
    skin: skinCurrent,
    tempC: reservoir.temperatureC,
  }), [reservoir, skinCurrent, fluidProps.oilViscosity_cP, fluidProps.Bo]);

  // Совместимое представление минералогии для diagnoseDamage
  const mineralogy: Mineralogy = useMemo(() => toLegacyMineralogy(detailedMin), [detailedMin]);

  // Давление гидроразрыва (упрощённая Eaton) — для сравнения с давлением обработки
  const pFracEaton = useMemo(
    () => fracturePressureMPa(depthProfile, reservoir.reservoirPressureMPa, stressState, construction.perfTopTVD),
    [depthProfile, reservoir.reservoirPressureMPa, stressState, construction.perfTopTVD]
  );
  // Ступенчатая закачка (SRT): давление разрыва по факту
  const [srtPoints, setSrtPoints] = useState<StepRatePoint[]>([]);
  const [srtPressureType, setSrtPressureType] = useState<"bhp" | "surface">("surface");
  const [srtFluidDensity, setSrtFluidDensity] = useState(1.0);
  const [pFracOverride, setPFracOverride] = useState(0);
  const srtBhpPoints = useMemo(() => srtPoints.map((p) => ({
    rate: p.rate,
    pressure: srtPressureType === "bhp" ? p.pressure : p.pressure + (srtFluidDensity * 1000 * 9.81 * construction.perfTopTVD) / 1e6,
  })), [srtPoints, srtPressureType, srtFluidDensity, construction.perfTopTVD]);
  const srt = useMemo(() => interpretStepRateTest(srtBhpPoints), [srtBhpPoints]);
  const pFracMPa = pFracOverride > 0 ? pFracOverride : pFracEaton;

  // График закачки, пропластки, экономика
  const [pumpMaxLpm, setPumpMaxLpm] = useState(400);
  const [wellFluidDensity, setWellFluidDensity] = useState(1.05);
  const [zones, setZones] = useState<Zone[]>([
    { name: "Пропласток 1", h_m: 4, k_mD: 60, skin: 4 },
    { name: "Пропласток 2", h_m: 8, k_mD: 8, skin: 9 },
  ]);
  const [diverterEff, setDiverterEff] = useState(0);
  const [econ, setEcon] = useState({
    pricePerUnit: 30000, mineralTaxPerUnit: 15000, opexPerUnit: 3000, profitTaxRate: 0.25, discountRate: 0.15,
    reagentCostRub: 0, serviceCostRub: 600000, mobilizationRub: 300000, downtimeDays: 3,
  });

  const drilling: DrillingHistory = useMemo(() => ({
    mudType, mudWeight: 1.18, overbalanceMPa, soakTimeDays: soakDays,
  }), [mudType, overbalanceMPa, soakDays]);

  const damage = useMemo(
    () => diagnoseDamage(reservoirSnap, mineralogy, reservoir.collectorType, history, drilling, perfDensity),
    [reservoirSnap, mineralogy, reservoir.collectorType, history, drilling, perfDensity]
  );

  // Gas IPR (Rawlins-Schellhardt) — считаем только для газовых типов
  const gasIPR = useMemo(() => {
    if (!isGas) return null;
    return calculateGasIPR({
      reservoirPressureMPa: reservoir.reservoirPressureMPa,
      reservoirTempC: reservoir.temperatureC,
      permeability_mD: reservoir.permeability_mD,
      netPayM: reservoir.payZoneM,
      drainageRadiusM: 250,
      wellboreRadiusM: 0.108,
      skin: skinCurrent,
      gasGravity,
      zFactor: zFactorManual > 0 ? zFactorManual : undefined,
    });
  }, [isGas, reservoir, skinCurrent, gasGravity, zFactorManual]);

  const gasDamage: GasDamage[] = useMemo(() => {
    if (!gasIPR) return [];
    return diagnoseGasDamage({
      fluidType,
      reservoirPressureMPa: reservoir.reservoirPressureMPa,
      bottomholePressureMPa: bhpCurrentMPa,
      dewPointMPa: fluidType === "gas_condensate" ? dewPointMPa : undefined,
      condensateGasRatio: fluidType === "gas_condensate" ? condGasRatio : undefined,
      waterCutPct: waterCut,
      permeability_mD: reservoir.permeability_mD,
      aofMcmd: gasIPR.aofMcmd,
      currentRateMcmd: qCurrent, // для газа qCurrent в тыс.м³/сут
      nonDarcySkinAtAOF: gasIPR.nonDarcySkinAtAOF,
    });
  }, [gasIPR, fluidType, reservoir, bhpCurrentMPa, dewPointMPa, condGasRatio, waterCut, qCurrent]);

  const ranked = useMemo(
    () => rankMethods({ ...reservoir, waterCutPct: historyMode === "measured" ? (history[history.length - 1]?.waterCut ?? waterCut) : waterCut, distanceToContactM, cementQuality }, damage),
    [reservoir, damage, waterCut, distanceToContactM, cementQuality, historyMode, history],
  );
  const selected = useMemo(() => STIMULATION_METHODS.find((m) => m.id === selectedMethodId)!, [selectedMethodId]);
  const selectedRanked = useMemo(() => ranked.find((r) => r.method.id === selectedMethodId), [ranked, selectedMethodId]);

  const acidVol = useMemo(
    () => selected.volumePerMeterPay * reservoir.payZoneM * selected.numberOfCycles,
    [selected, reservoir]
  );

  // Универсальный пользовательский состав. Инициализируется из выбранного метода
  // и далее редактируется пользователем (слайдеры HCl/HF/добавки).
  const [composition, setComposition] = useState<AcidComposition>(DEFAULT_ACID_COMPOSITION);
  useEffect(() => {
    const name = selected.mainReagent.name;
    const hasHF = /HF/i.test(name);
    const hfMatch = name.match(/HF[^\d]*(\d+(?:\.\d+)?)\s*%/i);
    const hfPct = hasHF ? (hfMatch ? parseFloat(hfMatch[1]) : 3) : 0;
    const hclPct = hasHF
      ? Math.max(0, selected.mainReagent.concentration - hfPct)
      : selected.mainReagent.concentration;
    setComposition(c => ({ ...c, hclPct, hfPct }));
  }, [selected.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rockType: "carbonate" | "dolomite" | "sandstone" =
    reservoir.collectorType === "sandstone" ? "sandstone"
    : /доломит|dolomit/i.test(selected.mainReagent.name) ? "dolomite"
    : "carbonate";

  const kinetics = useMemo(() => {
    if (selected.category !== "acid" && selected.category !== "foam" && selected.category !== "combo") return null;
    return computeAcidKinetics({
      tempC: reservoir.temperatureC,
      concentration: composition.hclPct + composition.hfPct,
      acidVolumeM3: acidVol,
      payZoneM: reservoir.payZoneM,
      porosity: reservoir.porosity,
      wellboreRadiusM: 0.108,
      collectorType: reservoir.collectorType === "sandstone" ? "sandstone" : "carbonate",
    });
  }, [selected, reservoir, acidVol, composition]);

  // Live-метка состава и плотности (для всех текстов и стехиометрии)
  const acidLabel = useMemo(() => formatAcidLabel(composition), [composition]);
  const dissLive = useMemo(
    () => calculateDissolvingPower(composition, reservoir.reservoirPressureMPa, reservoir.temperatureC),
    [composition, reservoir.reservoirPressureMPa, reservoir.temperatureC]
  );

  const stages = useMemo(() => {
    if (selected.category !== "acid" && selected.category !== "combo") return null;
    return buildAcidStages({
      collectorType: reservoir.collectorType === "sandstone" ? "sandstone" : "carbonate",
      payZoneM: reservoir.payZoneM,
      mainAcidName: acidLabel,
      mainAcidVolPerM: selected.volumePerMeterPay,
      tubingVolumeM3: displacement.totalM3,
      hasHF: composition.hfPct > 0,
    });
  }, [selected, reservoir, acidLabel, composition.hfPct, displacement.totalM3]);

  // Стехиометрия растворения породы — плотность раствора из ЖИВОГО состава
  const stoichiometry = useMemo(() => {
    if (selected.category !== "acid" && selected.category !== "combo") return null;
    return computeAcidStoichiometry({
      acidVolumeM3: acidVol,
      acidDensityKgM3: dissLive.densityGcc * 1000,
      hclConcentrationPct: composition.hclPct,
      hfConcentrationPct: composition.hfPct,
      rock: rockType,
      preflushUsed: true,
      bhPressureMPa: reservoir.reservoirPressureMPa,
      bhTemperatureC: reservoir.temperatureC,
    });
  }, [selected, reservoir, acidVol, composition, rockType, dissLive.densityGcc]);

  // Реальная растворяющая способность с учётом полного минерального состава
  const mineralDissolution = useMemo(
    () => stoichiometricDemandByMineralogy(detailedMin, dissLive.dissolvingPowerCalcite, dissLive.dissolvingPowerQuartz),
    [detailedMin, dissLive.dissolvingPowerCalcite, dissLive.dissolvingPowerQuartz]
  );

  // Чувствительность: радиус проникновения и масса растворённой породы от HCl%
  const sensitivityData = useMemo(() => {
    if (selected.category !== "acid" && selected.category !== "combo" && selected.category !== "foam") return [];
    const rockKind: "carbonate" | "sandstone" | "dolomite" = rockType;
    const pumpLpm = plannedRateLpm > 0 ? plannedRateLpm : (selected.recommendedRate[0] + selected.recommendedRate[1]) / 2;
    const pts: { hcl: number; rPen: number; rockKg: number; co2: number }[] = [];
    for (let h = 5; h <= 30; h += 1) {
      const comp = { ...composition, hclPct: h };
      const d = calculateDissolvingPower(comp, reservoir.reservoirPressureMPa, reservoir.temperatureC);
      const p = acidPenetration(comp, d, acidVol, reservoir.payZoneM, reservoir.porosity, 0.108, rockKind, reservoir.temperatureC, pumpLpm);
      const rockKg = (rockKind === "carbonate" ? d.dissolvingPowerCalcite
        : rockKind === "dolomite" ? d.dissolvingPowerDolomite
        : d.dissolvingPowerQuartz) * acidVol;
      pts.push({ hcl: h, rPen: +(p.penetrationRadiusM - 0.108).toFixed(3), rockKg: +rockKg.toFixed(0), co2: +(d.co2GeneratedStdM3PerM3 * acidVol).toFixed(1) });
    }
    return pts;
  }, [selected.category, composition, reservoir, acidVol, rockType, selected.recommendedRate, plannedRateLpm]);



  // Live results from sub-panels (solvent/nitrogen)
  const [solventResult, setSolventResult] = useState<(SolventResult & { penetrationRadiusM: number }) | null>(null);
  const [nitrogenResult, setNitrogenResult] = useState<(NitrogenResult & { targetBhpMPa: number }) | null>(null);

  // Декомпозиция скина: механический, от наклона, псевдо и компонента повреждения S_damage
  const skinDecomp = useMemo(
    () => decomposeSkin(skinCurrent, reservoirSnap, 0, perfDensity),
    [skinCurrent, reservoirSnap, perfDensity]
  );

  // Расход: плановый или авто = 90% от максимального матричного в начале закачки (при текущем скине)
  const maxRateStartLpmPre = useMemo(() => {
    const J = injectivity(reservoir.permeability_mD, reservoir.payZoneM, injFluidViscosity, 250, 0.108, skinCurrent);
    return (J * Math.max(0, pFracMPa - fracMarginMPa - reservoir.reservoirPressureMPa) * 1000) / 1440;
  }, [reservoir, injFluidViscosity, skinCurrent, pFracMPa, fracMarginMPa]);
  const autoRateLpm = Math.max(10, Math.floor(maxRateStartLpmPre * 0.9));
  const effectiveRateLpm = plannedRateLpm > 0 ? plannedRateLpm : autoRateLpm;

  // Червоточины (карбонаты, кислота/комбо) — Buijse–Glasbergen
  const usesWormholes = reservoir.collectorType !== "sandstone"
    && (selected.category === "acid" || selected.category === "combo")
    && composition.hfPct === 0;
  const wormhole = useMemo(() => {
    if (!usesWormholes) return null;
    return calculateWormholes({
      acidVolumeM3: acidVol, rateLpm: effectiveRateLpm, payZoneM: reservoir.payZoneM,
      porosity: reservoir.porosity, wellboreRadiusM: 0.108, viOptCmMin, pvBtOpt,
    });
  }, [usesWormholes, acidVol, effectiveRateLpm, reservoir.payZoneM, reservoir.porosity, viOptCmMin, pvBtOpt]);

  // Радиус обработанной зоны и скин повреждения после обработки (Хокинс по зонам)
  const treatment = useMemo(() => {
    const rw = 0.108;
    let rTreated = rw;
    let wormholes = false;
    let basis = "";
    if (wormhole) {
      rTreated = wormhole.wormholeRadiusM; wormholes = true; basis = "фронт червоточин (Buijse–Glasbergen)";
    } else if ((selected.category === "acid" || selected.category === "combo") && kinetics) {
      // терриген: активная HF расходуется в первых десятках см
      rTreated = Math.min(rw + kinetics.penetrationRadius, rw + hfLiveRadiusM); basis = "зона активной кислоты (ограничена расходом HF)";
    } else if (selected.category === "foam" && kinetics) {
      rTreated = rw + kinetics.penetrationRadius; basis = "объём жидкой фазы пены";
    } else if (selected.category === "solvent" && solventResult) {
      rTreated = solventResult.penetrationRadiusM; basis = "радиус растворителя";
    } else {
      return null;
    }
    const r = treatedDamageSkin({
      damageSkin: skinDecomp.skinDamage, damageRadiusM, treatedRadiusM: rTreated, wellboreRadiusM: rw, wormholes,
    });
    return { rTreated, basis, ...r };
  }, [wormhole, selected, kinetics, hfLiveRadiusM, solventResult, skinDecomp.skinDamage, damageRadiusM]);

  const skinAfterTreatment = treatment
    ? Math.max(-6, skinDecomp.skinMechanical + skinDecomp.skinDeviation + skinDecomp.skinPseudo + treatment.skinAfter)
    : skinCurrent;
  // Снижение скина — из физики расчёта, а не из таблицы
  const skinReductionCalc = skinCurrent - skinAfterTreatment;

  // Forecast: для большинства методов — снятие скина; для азота — изменение Pwf
  const arps = useMemo(() => fitArpsDecline(history), [history]);
  // Прогноз начинается с текущего момента — после последнего замера истории
  const historyEndMonth = history.length ? history[history.length - 1].month : 0;
  const forecast = useMemo(() => {
    if (selected.category === "nitrogen" && nitrogenResult) {
      // Прирост дебита пропорционален росту депрессии (Pr - Pwf)
      const Pr = reservoir.reservoirPressureMPa;
      const dpOld = Math.max(0.5, Pr - bhpCurrentMPa);
      const dpNew = Math.max(0.5, Pr - nitrogenResult.targetBhpMPa);
      const liftRatio = dpNew / dpOld;
      // используем тот же контейнер ForecastPoint, считаем вручную
      const out = forecastPostTreatment(arps, reservoirSnap, skinCurrent, skinCurrent, 36, 0.035, historyEndMonth);
      let cum = 0;
      return out.map((p) => {
        const qT = p.qBaseline * liftRatio;
        const eff = 1 + (liftRatio - 1) * Math.exp(-0.035 * p.month);
        const qTreated = p.qBaseline * eff;
        cum += Math.max(0, qTreated - p.qBaseline) * 30;
        return { ...p, qTreated, deltaQ: qTreated - p.qBaseline, cumulativeDeltaM3: cum };
      });
    }
    return forecastPostTreatment(arps, reservoirSnap, skinCurrent, skinAfterTreatment, 36, 0.025, historyEndMonth);
  }, [arps, reservoirSnap, skinCurrent, selected, skinAfterTreatment, nitrogenResult, reservoir, bhpCurrentMPa, historyEndMonth]);

  // Матричная закачка: максимальный расход без ГРП и давление на устье
  const injectionBase = useMemo(() => ({
    k_mD: reservoir.permeability_mD, h_m: reservoir.payZoneM, skin: skinCurrent, skinAfter: skinAfterTreatment,
    fluidViscosity_cP: injFluidViscosity, fluidDensity_gcm3: dissLive.densityGcc,
    reservoirPressureMPa: reservoir.reservoirPressureMPa, fracturePressureMPa: pFracMPa,
    drainageRadiusM: 250, wellboreRadiusM: 0.108, safetyMarginMPa: fracMarginMPa, construction,
  }), [reservoir, skinCurrent, skinAfterTreatment, injFluidViscosity, dissLive.densityGcc, pFracMPa, fracMarginMPa, construction]);
  const injection = useMemo(
    () => calculateMatrixInjection({ ...injectionBase, plannedRateLpm: effectiveRateLpm }),
    [injectionBase, effectiveRateLpm],
  );
  const catalogRateMid = (selected.recommendedRate[0] + selected.recommendedRate[1]) / 2;

  const scheduleStages: ScheduleStage[] = useMemo(() => {
    if (stages) return [
      { name: "Preflush", volumeM3: stages.preflush.volumeM3, density_gcm3: 1.03 },
      { name: "Основная кислота", volumeM3: stages.mainAcid.volumeM3, density_gcm3: dissLive.densityGcc, isMainAcid: true },
      { name: "Afterflush", volumeM3: stages.afterflush.volumeM3, density_gcm3: 1.03 },
      { name: "Продавка", volumeM3: displacement.totalM3, density_gcm3: wellFluidDensity },
    ];
    return [
      { name: "Основной реагент", volumeM3: acidVol, density_gcm3: Math.max(0.7, selected.mainReagent.density), isMainAcid: true },
      { name: "Продавка", volumeM3: displacement.totalM3, density_gcm3: wellFluidDensity },
    ];
  }, [stages, dissLive.densityGcc, displacement.totalM3, wellFluidDensity, acidVol, selected.mainReagent.density]);

  const schedule = useMemo(() => {
    if (selected.category === "nitrogen") return null;
    return buildInjectionSchedule({
      stages: scheduleStages, wellboreVolumeM3: displacement.totalM3, pathMD: construction.perfTopMD,
      perfTVD: construction.perfTopTVD, tubingID_mm: construction.tubingID_mm, tubingLengthM: Math.min(construction.tubingShoeMD, construction.perfTopMD),
      initialWellboreDensity_gcm3: wellFluidDensity, reservoirPressureMPa: reservoir.reservoirPressureMPa,
      fracturePressureMPa: pFracMPa, safetyMarginMPa: fracMarginMPa, k_mD: reservoir.permeability_mD, h_m: reservoir.payZoneM,
      fluidViscosity_cP: injFluidViscosity, skinStart: skinCurrent, skinEnd: skinAfterTreatment,
      pumpMaxLpm, minRateLpm: 10, drainageRadiusM: 250, wellboreRadiusM: 0.108,
    });
  }, [selected.category, scheduleStages, displacement.totalM3, construction, wellFluidDensity, reservoir, pFracMPa, fracMarginMPa, injFluidViscosity, skinCurrent, skinAfterTreatment, pumpMaxLpm]);

  const zoneAllocation = useMemo(
    () => allocateAcidToZones(zones, acidVol, selected.volumePerMeterPay * selected.numberOfCycles, diverterEff),
    [zones, acidVol, selected.volumePerMeterPay, selected.numberOfCycles, diverterEff],
  );

  useEffect(() => {
    setDiverterEff(selected.type === "acid_diversion" ? 0.7 : selected.category === "foam" || selected.type === "foam_acid_combo" ? 0.5 : 0);
  }, [selected.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reagentCostAuto = selected.mainReagent.costPerM3 * acidVol;
  const economics = useMemo(() => calculateStimulationEconomics(forecast, {
    ...econ,
    reagentCostRub: econ.reagentCostRub > 0 ? econ.reagentCostRub : reagentCostAuto,
    oilDensity_kgm3: fluidProps.oilDensity_kgm3, isGas,
  }), [forecast, econ, reagentCostAuto, fluidProps.oilDensity_kgm3, isGas]);

  const chartData = useMemo(() => forecast.map((p) => ({
    month: p.month,
    baseline: Number(p.qBaseline.toFixed(2)),
    treated: Number(p.qTreated.toFixed(2)),
    delta: Number(Math.max(0, p.deltaQ).toFixed(2)),
    cum: Number(p.cumulativeDeltaM3.toFixed(0)),
  })), [forecast]);


  // ── Сохранение в кабинет / загрузка ──
  const calcId = searchParams.get("calc");
  const selectedWellId = searchParams.get("well");
  const [saveOpen, setSaveOpen] = useState(false);
  const buildPayload = (): SaveCalcPayload => ({
    module: "stimulation",
    title: `ОПЗ ${wellName} ${new Date().toLocaleDateString("ru-RU")}`,
    well_data: { wellName, reservoir, construction, fluidType },
    calc_params: {
      gasGravity, zFactorManual, dewPointMPa, condGasRatio, bhpCurrentMPa,
      qInitial, qCurrent, waterCut, monthsHistory, skinCurrent, historyMode, measured,
      detailedMin, geologyMode, fluidProps, depthProfile, stressState,
      perfDensity, mudType, overbalanceMPa, soakDays, distanceToContactM, cementQuality,
      selectedMethodId, composition, plannedRateLpm, injFluidViscosity, fracMarginMPa,
      viOptCmMin, pvBtOpt, damageRadiusM, hfLiveRadiusM,
      srtPoints, srtPressureType, srtFluidDensity, pFracOverride,
      pumpMaxLpm, wellFluidDensity, zones, diverterEff, econ,
    },
    results: {
      method: selected.nameRu, acidVolM3: acidVol, skinAfter: skinAfterTreatment, pFracMPa,
      maxRateStartLpm: injection.maxRateStartLpm, maxSurfaceMPa: injection.maxSurfacePressureMPa,
      cumulativeDeltaM3: forecast[forecast.length - 1]?.cumulativeDeltaM3 ?? 0, npv: economics.npv,
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
      const w = (data.well_data ?? {}) as any, p = (data.calc_params ?? {}) as any;
      if (w.wellName) setWellName(w.wellName);
      if (w.reservoir) setReservoir(w.reservoir);
      if (w.construction) setConstruction(w.construction);
      if (w.fluidType) setFluidType(w.fluidType);
      const num = (k: string, f: (v: number) => void) => { if (typeof p[k] === "number") f(p[k]); };
      num("gasGravity", setGasGravity); num("zFactorManual", setZFactorManual); num("dewPointMPa", setDewPointMPa);
      num("condGasRatio", setCondGasRatio); num("bhpCurrentMPa", setBhpCurrentMPa); num("qInitial", setQInitial);
      num("qCurrent", setQCurrent); num("waterCut", setWaterCut); num("monthsHistory", setMonthsHistory);
      num("skinCurrent", setSkinCurrent); num("perfDensity", setPerfDensity); num("overbalanceMPa", setOverbalanceMPa);
      num("soakDays", setSoakDays); num("distanceToContactM", setDistanceToContactM); num("plannedRateLpm", setPlannedRateLpm);
      num("injFluidViscosity", setInjFluidViscosity); num("fracMarginMPa", setFracMarginMPa); num("viOptCmMin", setViOptCmMin);
      num("pvBtOpt", setPvBtOpt); num("damageRadiusM", setDamageRadiusM); num("hfLiveRadiusM", setHfLiveRadiusM);
      num("srtFluidDensity", setSrtFluidDensity); num("pFracOverride", setPFracOverride); num("pumpMaxLpm", setPumpMaxLpm);
      num("wellFluidDensity", setWellFluidDensity); num("diverterEff", setDiverterEff);
      if (p.historyMode) setHistoryMode(p.historyMode);
      if (Array.isArray(p.measured)) setMeasured(p.measured);
      if (p.detailedMin) setDetailedMin(p.detailedMin);
      if (p.geologyMode) setGeologyMode(p.geologyMode);
      if (p.fluidProps) setFluidProps(p.fluidProps);
      if (p.depthProfile) setDepthProfile(p.depthProfile);
      if (p.stressState) setStressState(p.stressState);
      if (p.mudType) setMudType(p.mudType);
      if (p.cementQuality) setCementQuality(p.cementQuality);
      if (p.selectedMethodId) setSelectedMethodId(p.selectedMethodId);
      if (p.composition) setTimeout(() => setComposition(p.composition), 0);
      if (Array.isArray(p.srtPoints)) setSrtPoints(p.srtPoints);
      if (p.srtPressureType) setSrtPressureType(p.srtPressureType);
      if (Array.isArray(p.zones)) setZones(p.zones);
      if (p.econ) setEcon((x) => ({ ...x, ...p.econ }));
      toast.success(`Расчёт «${data.title}» загружен`);
    })();
  }, [calcId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleExport() {
    try {
      await exportStimulationDocx({
        reservoir, method: selected, ranked: selectedRanked,
        acidVolM3: acidVol, damage, kinetics: kinetics ? { ...kinetics, wormholeLength: wormhole?.wormholeLengthM ?? 0 } : null, stages, forecast, wellName,
        composition, acidLabel,
        acidDensityGcc: dissLive.densityGcc,
        effectiveAcidStrength: dissLive.effectiveAcidStrength,
        stoichiometry, mineralDissolution, sensitivity: sensitivityData,
        pFracMPa,
        injection: selected.category !== "nitrogen" ? { ...injection, plannedRateLpm: effectiveRateLpm } : undefined,
      });

      toast.success("DOCX-отчёт сформирован");
    } catch (e) {
      console.error(e);
      toast.error("Не удалось сформировать DOCX");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> На главную
          </Link>
          <h1 className="text-base sm:text-lg font-semibold text-foreground">Интенсификация добычи (ОПЗ)</h1>
          <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setSaveOpen(true)}>
            <Save className="w-3.5 h-3.5" /> <span className="hidden sm:inline">В кабинет</span>
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6 h-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="text-xs sm:text-sm py-2 gap-1.5">
                <t.icon className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ─────────── DIAGNOSTICS ─────────── */}
          <TabsContent value="diag" className="space-y-4 mt-4">
            <SharedWellCard
              module="stimulation"
              current={{
                wellName,
                reservoirPressureMPa: reservoir.reservoirPressureMPa,
                reservoirTempC: reservoir.temperatureC,
              }}
              onApply={(d) => {
                if (d.wellName) setWellName(d.wellName);
                setReservoir((r) => ({
                  ...r,
                  reservoirPressureMPa: d.reservoirPressureMPa ?? r.reservoirPressureMPa,
                  temperatureC: d.reservoirTempC ?? r.temperatureC,
                }));
              }}
            />
            <Card className="p-4 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="font-semibold">Тип скважины</h2>
                <Badge variant="outline" className="text-xs">{WELL_FLUID_LABEL[fluidType]}</Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <Label title="Тип флюида определяет модель IPR и набор повреждений ПЗП">Флюид</Label>
                  <Select value={fluidType} onValueChange={(v) => setFluidType(v as WellFluidType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(WELL_FLUID_LABEL) as WellFluidType[]).map((k) => (
                        <SelectItem key={k} value={k}>{WELL_FLUID_LABEL[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground leading-tight">Нефть/газ/конденсат/нагнетательная — определяет модель притока</p>
                </div>
                {isGas && (
                  <>
                    <Field label="γ газа (возд.=1)" value={gasGravity} onChange={setGasGravity} step={0.01} hint="Относительная плотность газа по воздуху. Сухой газ 0.55–0.70, жирный/конденсатный 0.70–0.95" />
                    <Field label="Z-фактор (0=авто Papay)" value={zFactorManual} onChange={setZFactorManual} step={0.01} hint="Коэф. сверхсжимаемости газа. 0 = автоматический расчёт по корреляции Papay (рекомендуется)" />
                    <Field label="P забоя текущая, МПа" value={bhpCurrentMPa} onChange={setBhpCurrentMPa} step={0.5} hint="Текущее давление на забое (Pwf) — замер ТМС или расчёт по устью. Нужно для диагностики конденсатной пробки" />
                  </>
                )}
                {fluidType === "gas_condensate" && (
                  <>
                    <Field label="P росы, МПа" value={dewPointMPa} onChange={setDewPointMPa} step={0.5} hint="Давление начала конденсации (Pdew). При Pwf<Pdew образуется конденсатная пробка в ПЗП" />
                    <Field label="КГФ, см³/м³" value={condGasRatio} onChange={setCondGasRatio} step={10} hint="Конденсатогазовый фактор — объём стабильного конденсата на 1 м³ газа (н.у.)" />
                  </>
                )}
              </div>
            </Card>

            <Card className="p-4 space-y-4">
              <h2 className="font-semibold">Параметры коллектора</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Имя скважины</Label>
                  <Input value={wellName} onChange={(e) => setWellName(e.target.value)} />
                  <p className="text-[10px] text-muted-foreground leading-tight">Идентификатор для отчёта</p>
                </div>
                <div className="space-y-1">
                  <Label title="Литология — определяет выбор кислотной системы и кинетику реакции">Тип коллектора</Label>
                  <Select value={reservoir.collectorType} onValueChange={(v) => setReservoir({ ...reservoir, collectorType: v as CollectorType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(COLLECTOR_LABEL) as CollectorType[]).map((k) => (
                        <SelectItem key={k} value={k}>{COLLECTOR_LABEL[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground leading-tight">Карбонат → HCl-системы; терриген → HCl+HF (глинокислота)</p>
                </div>
                <Field label="T пласта, °C" value={reservoir.temperatureC} onChange={(v) => setReservoir({ ...reservoir, temperatureC: v })} hint="Пластовая температура (BHST). Влияет на вязкость флюидов и выбор ингибиторов коррозии кислоты" />
                <Field label="k, мД" value={reservoir.permeability_mD} onChange={(v) => setReservoir({ ...reservoir, permeability_mD: v })} step={0.1} hint="Абсолютная проницаемость. <1 мД — низкопроницаемый, 1–100 — средний, >100 — высокопроницаемый" />
                <Field label="Пористость, д.ед." value={reservoir.porosity} onChange={(v) => setReservoir({ ...reservoir, porosity: v })} step={0.01} hint="Открытая пористость в долях единицы (например, 0.15 = 15%)" />
                <Field label="h эфф, м" value={reservoir.payZoneM} onChange={(v) => setReservoir({ ...reservoir, payZoneM: v })} step={0.5} hint="Эффективная нефте/газонасыщенная толщина пласта (net pay)" />
                <Field label="P пл, МПа" value={reservoir.reservoirPressureMPa} onChange={(v) => setReservoir({ ...reservoir, reservoirPressureMPa: v })} step={0.5} hint="Текущее пластовое давление (Pr) на середине перфорации" />
                <Field label="Текущий скин" value={skinCurrent} onChange={setSkinCurrent} step={0.5} hint="Скин-фактор по ГДИС. >0 — загрязнение ПЗП; <0 — стимулированная скважина; цель после ОПЗ: −2…−4" />
              </div>
            </Card>

            <Card className="p-4 space-y-4">
              <h2 className="font-semibold">Конструкция скважины</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <Field label="Кровля перфорации MD, м" value={construction.perfTopMD} onChange={(v) => setConstruction({ ...construction, perfTopMD: v })} hint="Глубина по стволу до верхних отверстий" />
                <Field label="Кровля перфорации TVD, м" value={construction.perfTopTVD} onChange={(v) => setConstruction({ ...construction, perfTopTVD: v })} hint="Вертикальная глубина: для гидростатики и давления ГРП" />
                <Field label="Башмак НКТ MD, м" value={construction.tubingShoeMD} onChange={(v) => setConstruction({ ...construction, tubingShoeMD: v })} hint="Глубина спуска НКТ/ГНКТ, через которые идёт закачка" />
                <Field label="ID НКТ, мм" value={construction.tubingID_mm} onChange={(v) => setConstruction({ ...construction, tubingID_mm: v })} step={0.5} hint="73×5.5 → 62 мм; 89×6.5 → 76 мм" />
                <Field label="ID колонны, мм" value={construction.casingID_mm} onChange={(v) => setConstruction({ ...construction, casingID_mm: v })} step={0.5} hint="146 мм → ~130; 168 мм → ~150" />
              </div>
              <div className="text-xs text-muted-foreground">
                Объём продавки: НКТ {displacement.tubingM3.toFixed(2)} м³ + колонна до перфорации {displacement.casingM3.toFixed(2)} м³ = <b className="text-foreground">{displacement.totalM3.toFixed(2)} м³</b>
              </div>
            </Card>

            <Card className="p-4 space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="font-semibold">История добычи</h2>
                <div className="flex gap-2 items-center">
                  <Button size="sm" variant={historyMode === "synthetic" ? "default" : "outline"} onClick={() => setHistoryMode("synthetic")}>Оценка по Q нач/текущ</Button>
                  <Button size="sm" variant={historyMode === "measured" ? "default" : "outline"} onClick={switchToMeasured}>Замеры</Button>
                  <label className="text-xs text-primary cursor-pointer hover:underline">
                    Импорт Excel
                    <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={importHistory} />
                  </label>
                </div>
              </div>
              {historyMode === "measured" && (
                <div className="space-y-2">
                  <div className="overflow-x-auto max-h-72 overflow-y-auto border rounded">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr><th className="p-1.5 text-left">Месяц</th><th className="p-1.5 text-left">Дебит, {rateUnit}</th><th className="p-1.5 text-left">Обводн., %</th><th className="p-1.5 text-left">Pзаб, МПа</th><th></th></tr>
                      </thead>
                      <tbody>
                        {measured.map((r, i) => (
                          <tr key={i} className="border-t border-border/40">
                            {(["month", "qOil", "waterCut", "bhpMPa"] as const).map((k) => (
                              <td key={k} className="p-1">
                                <Input type="number" className="h-7 text-xs" value={r[k] ?? ""}
                                  onChange={(e) => {
                                    const v = e.target.value === "" ? undefined : parseFloat(e.target.value);
                                    setMeasured(measured.map((x, j) => (j === i ? { ...x, [k]: k === "month" || k === "qOil" ? (v ?? 0) : v } : x)));
                                  }} />
                              </td>
                            ))}
                            <td className="p-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setMeasured(measured.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3" /></Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button size="sm" variant="outline" onClick={() => {
                      const last = measured[measured.length - 1];
                      setMeasured([...measured, { month: (last?.month ?? -1) + 1, qOil: last?.qOil ?? 0, waterCut: last?.waterCut }]);
                    }}><Plus className="w-3 h-3 mr-1" />Замер</Button>
                    <span className="text-[10px] text-muted-foreground">
                      {measured.filter((p) => p.qOil > 0).length < 3 ? "Нужно не меньше 3 замеров с дебитом — пока используется оценка." : `Кривая Арпса подбирается по ${measured.filter((p) => p.qOil > 0).length} замерам.`}
                    </span>
                  </div>
                </div>
              )}
              {historyMode === "synthetic" && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label={`Q начальный, ${rateUnit}`} value={qInitial} onChange={setQInitial} hint="Стартовый дебит после ввода или предыдущего ГТМ — база оценки потери продуктивности" />
                <Field label={`Q текущий, ${rateUnit}`} value={qCurrent} onChange={setQCurrent} hint="Дебит на момент анализа. Сравнение с Q нач. показывает степень деградации ПЗП" />
                <Field label={isGas ? "Влагосодержание, %" : "Обводнённость, %"} value={waterCut} onChange={setWaterCut} hint={isGas ? "Содержание воды в продукции газовой скважины — индикатор жидкостной нагрузки и блокады" : "Доля воды в добываемой жидкости (% объёмных)"} />
                <Field label="Период истории, мес" value={monthsHistory} onChange={setMonthsHistory} hint="За какой период произошло падение Q нач. → Q текущ. Нужно для оценки темпа деградации" />
              </div>
              )}
              {historyMode === "synthetic" && (
                <p className="text-[10px] text-muted-foreground">Оценка: экспоненциальное падение от Q нач. к Q текущ. Для подбора реальной кривой падения введите замеры.</p>
              )}
            </Card>

            {gasIPR && (
              <Card className="p-4 space-y-3">
                <h2 className="font-semibold flex items-center gap-2">
                  <Activity className="w-4 h-4" /> Газовый IPR (Rawlins-Schellhardt + не-Дарси)
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <KV k="AOF (Pwf→0)" v={`${gasIPR.aofMcmd.toFixed(1)} тыс.м³/сут`} />
                  <KV k="Z-фактор" v={gasIPR.zFactor.toFixed(3)} />
                  <KV k="μ газа" v={`${gasIPR.gasViscosityCP.toFixed(4)} сПз`} />
                  <KV k="P_pc / T_pc" v={`${gasIPR.ppc.toFixed(2)} МПа / ${gasIPR.tpc.toFixed(0)} K`} />
                  <KV k="Не-Дарси скин на AOF" v={gasIPR.nonDarcySkinAtAOF.toFixed(2)} />
                  <KV k="Текущий q / AOF" v={`${(100 * qCurrent / Math.max(0.01, gasIPR.aofMcmd)).toFixed(0)}%`} />
                </div>
                <div style={{ width: "100%", height: 220 }}>
                  <ResponsiveContainer>
                    <LineChart data={gasIPR.iprCurve.map(p => ({ pwf: Number(p.pwf.toFixed(2)), q: Number(p.qGas.toFixed(2)) }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="q" stroke="hsl(var(--muted-foreground))" label={{ value: "q, тыс.м³/сут", position: "insideBottom", offset: -2, fontSize: 11 }} />
                      <YAxis dataKey="pwf" stroke="hsl(var(--muted-foreground))" label={{ value: "Pwf, МПа", angle: -90, position: "insideLeft", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Line type="monotone" dataKey="pwf" stroke="hsl(var(--primary))" name="IPR (q vs Pwf)" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {gasDamage.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/40">
                    <div className="text-sm font-medium">Газоспецифичные повреждения ({gasDamage.length})</div>
                    {gasDamage.map((d) => (
                      <div key={d.mechanism} className="border border-border/40 rounded p-2 space-y-1">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="text-sm font-medium">{d.nameRu}</div>
                            <div className="text-xs text-muted-foreground">{d.evidence}</div>
                          </div>
                          <Badge variant={d.severity === "high" ? "destructive" : d.severity === "medium" ? "default" : "secondary"}>
                            {(d.probability * 100).toFixed(0)}%
                          </Badge>
                        </div>
                        <div className="text-xs text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="w-3 h-3 inline mr-1" />{d.recommendedTreatment}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            <GeologyEditor
              mineralogy={detailedMin}
              setMineralogy={setDetailedMin}
              fluid={fluidProps}
              setFluid={setFluidProps}
              depth={depthProfile}
              setDepth={setDepthProfile}
              stress={stressState}
              setStress={setStressState}
              currentReservoirPressureMPa={reservoir.reservoirPressureMPa}
              currentReservoirTempC={reservoir.temperatureC}
              onApplyPressure={(p) => setReservoir((r) => ({ ...r, reservoirPressureMPa: p }))}
              onApplyTemperature={(t) => setReservoir((r) => ({ ...r, temperatureC: t }))}
              mode={geologyMode}
              onModeChange={setGeologyMode}
            />

            <Card className="p-4 space-y-4">
              <h2 className="font-semibold">Заканчивание и буровая история</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Field label="Плотность перф., отв/м" value={perfDensity} onChange={setPerfDensity} />
                <div className="space-y-1">
                  <Label>Тип бурового раствора</Label>
                  <Select value={mudType} onValueChange={(v) => setMudType(v as "wbm" | "obm" | "sbm")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wbm">На водной основе (WBM)</SelectItem>
                      <SelectItem value="obm">На нефтяной основе (OBM)</SelectItem>
                      <SelectItem value="sbm">Синтетический (SBM)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Репрессия, МПа" value={overbalanceMPa} onChange={setOverbalanceMPa} step={0.5} />
                <Field label="Контакт с буровым, сут" value={soakDays} onChange={setSoakDays} />
                <Field label="До ВНК/ГВК от подошвы перф., м (0 — нет данных)" value={distanceToContactM} onChange={setDistanceToContactM} hint="Близкий контакт — риск прорыва воды при кислотной обработке" />
                <div className="space-y-1">
                  <Label>Цемент за колонной (АКЦ)</Label>
                  <Select value={cementQuality} onValueChange={(v) => setCementQuality(v as CementQuality)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(CEMENT_LABEL) as CementQuality[]).map((k) => <SelectItem key={k} value={k}>{CEMENT_LABEL[k]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Card>

            <Card className="p-4 space-y-3">
              <h2 className="font-semibold flex items-center gap-2">
                <FlaskConical className="w-4 h-4" /> Выявленные механизмы повреждения ({damage.length})
              </h2>
              {damage.length === 0 ? (
                <p className="text-sm text-muted-foreground">Повреждения не выявлены при текущих параметрах. Проверьте историю добычи и минералогию.</p>
              ) : (
                <div className="space-y-2">
                  {damage.map((d) => (
                    <div key={d.mechanism} className="flex items-start justify-between gap-3 border-b border-border/40 pb-2">
                      <div className="flex-1">
                        <div className="text-sm font-medium">{d.nameRu}</div>
                        <div className="text-xs text-muted-foreground">{d.evidence}</div>
                      </div>
                      <div className="text-right">
                        <Badge variant={d.severity === "high" ? "destructive" : d.severity === "medium" ? "default" : "secondary"}>
                          {(d.probability * 100).toFixed(0)}%
                        </Badge>
                        <div className="text-[10px] text-muted-foreground mt-1">{d.severity}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button onClick={() => setTab("method")}>Перейти к подбору метода →</Button>
            </Card>
          </TabsContent>

          {/* ─────────── METHOD ─────────── */}
          <TabsContent value="method" className="space-y-4 mt-4">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-sm text-muted-foreground">Фильтр:</span>
              <Button size="sm" variant={categoryFilter === "all" ? "default" : "outline"} onClick={() => setCategoryFilter("all")}>Все</Button>
              {(Object.keys(METHOD_CATEGORY_LABEL) as MethodCategory[]).map((c) => (
                <Button key={c} size="sm" variant={categoryFilter === c ? "default" : "outline"} onClick={() => setCategoryFilter(c)}>
                  {METHOD_CATEGORY_LABEL[c]}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ranked.filter((r) => categoryFilter === "all" || r.method.category === categoryFilter)
                .map((r) => (
                  <MethodCard key={r.method.id} ranked={r} selected={selectedMethodId === r.method.id}
                    onSelect={() => { setSelectedMethodId(r.method.id); toast.success(`Выбран: ${r.method.nameRu}`); setTab("calc"); }} />
                ))}
            </div>
          </TabsContent>

          {/* ─────────── CALCULATION ─────────── */}
          <TabsContent value="calc" className="space-y-4 mt-4">
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="font-semibold flex items-center gap-2">{selected.icon} {selected.nameRu}</h2>
                  <p className="text-xs text-muted-foreground max-w-2xl mt-1">{selected.description}</p>
                </div>
                <Badge variant="outline">{METHOD_CATEGORY_LABEL[selected.category]}</Badge>
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Stat label="Объём реагента" value={`${acidVol.toFixed(1)} м³`} sub={`${selected.volumePerMeterPay} м³/м × ${reservoir.payZoneM} м × ${selected.numberOfCycles} цикл.`} />
              <Stat label="Плановый расход" value={`${effectiveRateLpm.toFixed(0)} л/мин`}
                sub={selected.category === "nitrogen" ? undefined : `макс. без ГРП: ${injection.maxRateStartLpm.toFixed(0)} → ${injection.maxRateEndLpm.toFixed(0)} л/мин; каталог ${selected.recommendedRate[0]}–${selected.recommendedRate[1]}`} />
              <Stat label="Выдержка" value={`${selected.soakTimeMin[0]}–${selected.soakTimeMin[1]} мин`} />
              <Stat
                label="Расчётное ΔS (из физики)"
                value={selected.category === "nitrogen"
                  ? "—"
                  : `−${skinReductionCalc.toFixed(2)}`}
                sub={selected.category === "nitrogen"
                  ? "N₂: эффект через ΔP, не через скин"
                  : `табличный диапазон: −${selected.skinReductionRange[0]}…−${selected.skinReductionRange[1]}`}
              />
              <Stat label="Успешность" value={`${selected.successRate}%`} />
            </div>

            {selected.category !== "nitrogen" && (
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="font-semibold">Режим матричной закачки</h3>
                  <Badge variant={injection.regime === "frac" ? "destructive" : injection.regime === "near_frac" ? "default" : "outline"}>
                    {injection.regime === "frac" ? "🔴 ГРП" : injection.regime === "near_frac" ? "⚠ близко к ГРП" : "🟢 матричный режим"}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Field label="Плановый расход, л/мин (0 = авто)" value={plannedRateLpm} onChange={setPlannedRateLpm} step={10}
                    hint={`Авто: 90% от максимума в начале закачки = ${autoRateLpm} л/мин`} />
                  <Field label="Вязкость закачиваемой жидкости, сПз" value={injFluidViscosity} onChange={setInjFluidViscosity} step={0.1} hint="HCl 15% ≈ 1.1–1.3; гелированная кислота — по паспорту" />
                  <Field label="Запас до Pгрп, МПа" value={fracMarginMPa} onChange={setFracMarginMPa} step={0.5} hint="Забойное давление держать ниже Pгрп на эту величину" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <KV k="Pгрп (Итон, по TVD)" v={`${pFracMPa.toFixed(1)} МПа`} />
                  <KV k="Приёмистость: сейчас → после" v={`${injection.injectivityStart.toFixed(1)} → ${injection.injectivityEnd.toFixed(1)} м³/(сут·МПа)`} />
                  <KV k="Макс. расход без ГРП: начало → конец" v={`${injection.maxRateStartLpm.toFixed(0)} → ${injection.maxRateEndLpm.toFixed(0)} л/мин`} />
                  <KV k="Забойное при плановом расходе" v={`${injection.bhpAtPlannedMPa.toFixed(1)} МПа`} />
                  <KV k="Гидростатика / трение в НКТ" v={`${injection.hydrostaticMPa.toFixed(1)} / ${injection.frictionAtPlannedMPa.toFixed(2)} МПа`} />
                  <KV k="Давление на устье (план)" v={`${injection.surfacePressureMPa.toFixed(1)} МПа`} />
                  <KV k="Макс. давление на устье" v={`${injection.maxSurfacePressureMPa.toFixed(1)} МПа`} />
                  <KV k="Опрессовка линий (1.5×)" v={`${injection.lineTestPressureMPa.toFixed(1)} МПа`} />
                </div>
                {catalogRateMid > injection.maxRateStartLpm && (
                  <div className="text-xs text-amber-700 dark:text-amber-300">
                    ⚠ Расход из каталога метода ({selected.recommendedRate[0]}–{selected.recommendedRate[1]} л/мин) выше максимального для этого пласта ({injection.maxRateStartLpm.toFixed(0)} л/мин) — на нём пласт будет разорван.
                  </div>
                )}
                {injection.warnings.map((w, i) => (
                  <div key={i} className={`text-xs ${w.startsWith("🔴") ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}`}>{w}</div>
                ))}
              </Card>
            )}

            {selected.category !== "nitrogen" && (
              <Card className="p-4 space-y-3">
                <h3 className="font-semibold">Ступенчатая закачка (определение давления ГРП по факту)</h3>
                <p className="text-xs text-muted-foreground">Введите стабилизированное давление на каждой ступени расхода. Излом на графике «давление — расход» — давление раскрытия трещины.</p>
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="space-y-1">
                    <Label>Давление в таблице</Label>
                    <Select value={srtPressureType} onValueChange={(v) => setSrtPressureType(v as "bhp" | "surface")}>
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="surface">на устье</SelectItem>
                        <SelectItem value="bhp">забойное</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {srtPressureType === "surface" && (
                    <div className="w-48"><Field label="ρ жидкости теста, г/см³" value={srtFluidDensity} onChange={setSrtFluidDensity} step={0.01} hint="Для пересчёта в забойное; трение на малых расходах не учитывается" /></div>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setSrtPoints([...srtPoints, { rate: (srtPoints[srtPoints.length - 1]?.rate ?? 0) + 20, pressure: srtPoints[srtPoints.length - 1]?.pressure ?? 0 }])}>
                    <Plus className="w-3 h-3 mr-1" />Ступень
                  </Button>
                </div>
                {srtPoints.length > 0 && (
                  <table className="w-full text-xs max-w-md">
                    <thead><tr><th className="text-left p-1">Расход, м³/сут</th><th className="text-left p-1">Давление, МПа</th><th></th></tr></thead>
                    <tbody>
                      {srtPoints.map((pt, i) => (
                        <tr key={i}>
                          <td className="p-1"><Input type="number" className="h-7 text-xs" value={pt.rate} onChange={(e) => setSrtPoints(srtPoints.map((x, j) => j === i ? { ...x, rate: parseFloat(e.target.value) || 0 } : x))} /></td>
                          <td className="p-1"><Input type="number" className="h-7 text-xs" value={pt.pressure} onChange={(e) => setSrtPoints(srtPoints.map((x, j) => j === i ? { ...x, pressure: parseFloat(e.target.value) || 0 } : x))} /></td>
                          <td className="p-1"><Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSrtPoints(srtPoints.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3" /></Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <div className="text-sm">{srt.verdictText}</div>
                {srt.verdict !== "insufficient_data" && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    <KV k="Приёмистость по тесту" v={`${srt.matrixInjectivity.toFixed(1)} м³/(сут·МПа)`} />
                    <KV k="Приёмистость по расчёту (текущий скин)" v={`${injection.injectivityStart.toFixed(1)} м³/(сут·МПа)`} />
                    {srt.formationPartingPressure != null && <KV k="Давление раскрытия (забой)" v={`${srt.formationPartingPressure.toFixed(1)} МПа`} />}
                  </div>
                )}
                <div className="flex items-center gap-3 flex-wrap">
                  {srt.formationPartingPressure != null && (
                    <Button size="sm" onClick={() => setPFracOverride(+srt.formationPartingPressure!.toFixed(1))}>Принять Pгрп = {srt.formationPartingPressure.toFixed(1)} МПа</Button>
                  )}
                  {pFracOverride > 0 && (
                    <>
                      <Badge variant="outline">Pгрп из теста: {pFracOverride} МПа (Итон: {pFracEaton.toFixed(1)})</Badge>
                      <Button size="sm" variant="ghost" onClick={() => setPFracOverride(0)}>Вернуть расчёт по Итону</Button>
                    </>
                  )}
                </div>
              </Card>
            )}

            {(selected.category === "acid" || selected.category === "combo" || selected.category === "foam") && (
              <Card className="p-4 space-y-3">
                <h3 className="font-semibold">Распределение реагента по пропласткам</h3>
                <p className="text-xs text-muted-foreground">Без отклонителя реагент уходит в пропласток с наибольшей приёмистостью (k·h и скин). Отклонитель выравнивает профиль.</p>
                <table className="w-full text-xs">
                  <thead className="bg-muted/50"><tr>
                    <th className="p-1.5 text-left">Пропласток</th><th className="p-1.5 text-left">h, м</th><th className="p-1.5 text-left">k, мД</th><th className="p-1.5 text-left">Скин</th>
                    <th className="p-1.5 text-right">Доля</th><th className="p-1.5 text-right">Получит, м³</th><th className="p-1.5 text-right">Нужно, м³</th><th className="p-1.5 text-right">Охват</th><th></th>
                  </tr></thead>
                  <tbody>
                    {zones.map((z, i) => {
                      const a = zoneAllocation[i];
                      return (
                        <tr key={i} className="border-t border-border/40">
                          <td className="p-1"><Input className="h-7 text-xs" value={z.name} onChange={(e) => setZones(zones.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} /></td>
                          {(["h_m", "k_mD", "skin"] as const).map((k) => (
                            <td key={k} className="p-1"><Input type="number" className="h-7 text-xs w-20" value={z[k]} onChange={(e) => setZones(zones.map((x, j) => j === i ? { ...x, [k]: parseFloat(e.target.value) || 0 } : x))} /></td>
                          ))}
                          <td className="p-1 text-right">{a?.sharePct.toFixed(0)}%</td>
                          <td className="p-1 text-right">{a?.volumeM3.toFixed(1)}</td>
                          <td className="p-1 text-right">{a?.requiredM3.toFixed(1)}</td>
                          <td className={`p-1 text-right font-medium ${a && a.coveragePct < 50 ? "text-red-600" : a && a.coveragePct < 80 ? "text-amber-600" : "text-green-600"}`}>{a?.coveragePct.toFixed(0)}%</td>
                          <td className="p-1"><Button size="icon" variant="ghost" className="h-7 w-7" disabled={zones.length <= 1} onClick={() => setZones(zones.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3" /></Button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex flex-wrap items-end gap-3">
                  <Button size="sm" variant="outline" onClick={() => setZones([...zones, { name: `Пропласток ${zones.length + 1}`, h_m: 3, k_mD: 10, skin: 5 }])}><Plus className="w-3 h-3 mr-1" />Пропласток</Button>
                  <div className="w-64"><Field label="Эффективность отклонения (0–1)" value={diverterEff} onChange={(v) => setDiverterEff(Math.min(1, Math.max(0, v)))} step={0.1} hint="0 — без отклонителя; волокна/шары/пена 0.5–0.8; 1 — идеально по толщине" /></div>
                </div>
                {zoneAllocation.some((a) => a.coveragePct < 50) && (
                  <div className="text-xs text-amber-700 dark:text-amber-300">
                    ⚠ {zoneAllocation.filter((a) => a.coveragePct < 50).map((a) => a.name).join(", ")} — получит меньше половины нужного объёма. Нужен отклонитель или поинтервальная обработка (пакер).
                  </div>
                )}
              </Card>
            )}

            {(selected.category === "acid" || selected.category === "foam" || selected.category === "combo") && (
              <AcidCompositionEditor
                value={composition}
                onChange={setComposition}
                rockType={rockType}
                bhPressureMPa={reservoir.reservoirPressureMPa}
                bhTemperatureC={reservoir.temperatureC}
              />
            )}

            {kinetics && (

              <Card className="p-4 space-y-4">
                <h3 className="font-semibold">Кинетика и проникновение</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <KV k="Скорость реакции (Lund–Fogler)" v={`${kinetics.reactionRate.toExponential(2)} моль/(м²·с)`} />
                  <KV k="Радиус заполнения пор кислотой" v={`${kinetics.penetrationRadius.toFixed(2)} м`} />
                  <KV k="Растворено породы" v={`${kinetics.dissolutionVolume.toFixed(2)} м³`} />
                  {wormhole && (
                    <>
                      <KV k="Длина червоточин" v={`${wormhole.wormholeLengthM.toFixed(2)} м`} />
                      <KV k="v_i у стенки / оптимум" v={`${wormhole.viWallCmMin.toFixed(2)} / ${viOptCmMin} см/мин`} />
                      <KV k="Расход для оптимума у стенки" v={`${wormhole.optimalRateAtWallLpm.toFixed(0)} л/мин`} />
                    </>
                  )}
                  {treatment && (
                    <>
                      <KV k="Радиус обработанной зоны" v={`${treatment.rTreated.toFixed(2)} м (${treatment.basis})`} />
                      <KV k="k/k_повр (из скина повреждения)" v={treatment.kOverKd.toFixed(1)} />
                      <KV k="Скин повреждения: до → после" v={`${skinDecomp.skinDamage.toFixed(2)} → ${treatment.skinAfter.toFixed(2)}`} />
                    </>
                  )}
                </div>
                {wormhole && (
                  <div className="text-xs text-muted-foreground">
                    Режим растворения у стенки: <b className="text-foreground">{REGIME_LABEL[wormhole.regimeAtWall]}</b>.
                    {wormhole.regimeAtWall === "face" || wormhole.regimeAtWall === "conical"
                      ? " Расход мал — кислота тратится у стенки; поднять расход в пределах допустимого давления."
                      : wormhole.regimeAtWall === "uniform" ? " Расход велик — кислота расходуется равномерно, червоточины короткие." : ""}
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border/40">
                  {usesWormholes && (
                    <>
                      <Field label="v_i,opt по керну, см/мин" value={viOptCmMin} onChange={setViOptCmMin} step={0.1} hint="Оптимальная межзерновая скорость из кернового теста; известняк + HCl 15%: 0.5–3" />
                      <Field label="PV_bt,opt по керну" value={pvBtOpt} onChange={setPvBtOpt} step={0.1} hint="Поровые объёмы до прорыва при оптимуме; обычно 0.3–1.5" />
                    </>
                  )}
                  <Field label="Радиус зоны повреждения, м" value={damageRadiusM} onChange={setDamageRadiusM} step={0.1} hint="Глубина загрязнения ПЗП: фильтрат 0.3–1 м, АСПО/соли 0.1–0.5 м" />
                  {reservoir.collectorType === "sandstone" && (
                    <Field label="Проникновение активной HF, м" value={hfLiveRadiusM} onChange={setHfLiveRadiusM} step={0.05} hint="HF расходуется быстро: обычно 0.15–0.4 м от стенки" />
                  )}
                </div>
                {/* Wormhole visualization (Da-режим) */}
                {(() => {
                  const damkohler = wormhole ? wormhole.damkohlerEquivalent : 0.29;
                  const whLen = wormhole ? wormhole.wormholeLengthM : 0;
                  return (
                    <>
                      <WormholeVisualization
                        wormholeLengthM={whLen}
                        penetrationRadiusM={kinetics.penetrationRadius}
                        wellboreRadiusM={0.108}
                        damkohler={damkohler}
                        reagentColor={selected.category === "foam" ? "#4fc3f7" : "#ff6b35"}
                      />
                      <Wormhole3D
                        wormholeLengthM={whLen}
                        penetrationRadiusM={kinetics.penetrationRadius}
                        wellboreRadiusM={0.108}
                        damkohler={damkohler}
                        reservoirHeightM={reservoir.payZoneM ?? 10}
                        reagentCategory={REAGENT_COLOR_MAP[selected.category] ?? "acid"}
                        perfDensity={perfDensity}
                      />
                    </>
                  );
                })()}
              </Card>
            )}

            {stoichiometry && (
              <Card className="p-4 space-y-3">
                <h3 className="font-semibold">Стехиометрия растворения породы</h3>
                <div className="text-xs text-muted-foreground">
                  Реакция:{" "}
                  {stoichiometry.rock === "carbonate" && "2 HCl + CaCO₃ → CaCl₂ + H₂O + CO₂"}
                  {stoichiometry.rock === "dolomite" && "4 HCl + CaMg(CO₃)₂ → CaCl₂ + MgCl₂ + 2 H₂O + 2 CO₂"}
                  {stoichiometry.rock === "sandstone" && "6 HF + SiO₂ → H₂SiF₆ + 2 H₂O   (+ HCl растворяет карбонатный цемент)"}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <KV k="HCl в реагенте" v={`${stoichiometry.hclMassKg.toFixed(0)} кг`} />
                  {stoichiometry.hfMassKg > 0 && <KV k="HF в реагенте" v={`${stoichiometry.hfMassKg.toFixed(0)} кг`} />}
                  <KV k="Растворено породы" v={`${stoichiometry.rockDissolvedKg.toFixed(0)} кг (${stoichiometry.rockDissolvedM3.toFixed(2)} м³)`} />
                  {stoichiometry.co2VolumeStdM3 > 0 && (
                    <>
                      <KV k="CO₂ при н.у." v={`${stoichiometry.co2VolumeStdM3.toFixed(1)} м³ст`} />
                      <KV k="CO₂ в забое" v={`${stoichiometry.co2VolumeBhM3.toFixed(2)} м³`} />
                    </>
                  )}
                  <KV k="CaCl₂ (раствор)" v={`${stoichiometry.caCl2MassKg.toFixed(0)} кг`} />
                  {stoichiometry.caF2RiskKg != null && (
                    <KV k="⚠ CaF₂ риск" v={`до ${stoichiometry.caF2RiskKg.toFixed(0)} кг осадка`} />
                  )}
                </div>
                {stoichiometry.notes.length > 0 && (
                  <div className="space-y-1 pt-2 border-t border-border/40">
                    {stoichiometry.notes.map((n, i) => (
                      <div key={i} className={`text-xs ${n.startsWith("ВНИМАНИЕ") ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}`}>
                        {n}
                      </div>
                    ))}
                  </div>
                )}

                {/* Реальная растворяющая способность по минералогии */}
                <div className="pt-2 border-t border-border/40 space-y-1.5">
                  <div className="text-xs font-medium">По реальному минеральному составу:</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                    <KV k="HCl растворит карбонатов" v={`${mineralDissolution.carbonateKgPerM3.toFixed(0)} кг/м³`} />
                    <KV k="HF растворит силикатов" v={`${mineralDissolution.silicateKgPerM3.toFixed(1)} кг/м³`} />
                    <KV k="Эфф. ρ породы" v={`${mineralDissolution.effectiveRockDensity_kgm3.toFixed(0)} кг/м³`} />
                  </div>
                  {mineralDissolution.warnings.map((w, i) => (
                    <div key={i} className="text-xs text-amber-700 dark:text-amber-300">{w}</div>
                  ))}
                </div>

                {/* Давление гидроразрыва (Eaton) */}
                <div className="pt-2 border-t border-border/40 flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs text-muted-foreground">
                    🪨 Pfrac (Eaton) ≈ <b>{pFracMPa.toFixed(1)} МПа</b>
                  </div>
                  <Badge variant={pFracMPa - reservoir.reservoirPressureMPa < 5 ? "destructive" : "outline"} className="text-[10px]">
                    запас ΔP = {(pFracMPa - reservoir.reservoirPressureMPa).toFixed(1)} МПа
                  </Badge>
                </div>
              </Card>
            )}

            {sensitivityData.length > 0 && (
              <Card className="p-4">
                <h3 className="font-semibold mb-2">Чувствительность к концентрации HCl</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Текущий состав: <b>{acidLabel}</b>. Сплошная вертикаль — выбранное значение.
                </p>
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer>
                    <LineChart data={sensitivityData} margin={{ top: 5, right: 25, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="hcl" stroke="hsl(var(--muted-foreground))" label={{ value: "HCl, %", position: "insideBottom", offset: -2, fontSize: 11 }} />
                      <YAxis yAxisId="L" stroke="hsl(var(--primary))" label={{ value: "r проникн., м", angle: -90, position: "insideLeft", fontSize: 11 }} />
                      <YAxis yAxisId="R" orientation="right" stroke="hsl(var(--muted-foreground))" label={{ value: "порода, кг", angle: 90, position: "insideRight", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Legend />
                      <Line yAxisId="L" type="monotone" dataKey="rPen" stroke="hsl(var(--primary))" name="Радиус, м" dot={false} strokeWidth={2} />
                      <Line yAxisId="R" type="monotone" dataKey="rockKg" stroke="#ff6b35" name="Растворено, кг" dot={false} />
                      <Line yAxisId="R" type="monotone" dataKey="co2" stroke="#10b981" name="CO₂ ст, м³" dot={false} strokeDasharray="4 4" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}



            <Card className="p-4">
              <h3 className="font-semibold mb-3">Рецептура и добавки</h3>
              <div className="space-y-2 text-sm">
                <div className="font-medium">
                  Основа: <span className="text-primary">{acidLabel}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    (ρ = {dissLive.densityGcc.toFixed(3)} г/см³, активная HCl = {dissLive.effectiveAcidStrength.toFixed(1)}%)
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Шаблон метода: {selected.mainReagent.name} — фактический состав задаётся слайдерами выше.
                </div>
                {selected.additives.length === 0 && <div className="text-muted-foreground text-xs">Доп. добавки шаблона не требуются</div>}
                {selected.additives.map((a, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-border/40 pb-1">
                    <span>{a.required ? "● " : "○ "}{a.name} <span className="text-xs text-muted-foreground">— {a.purpose}</span></span>
                    <span className="text-xs">{a.concentration} {a.unit}</span>
                  </div>
                ))}
              </div>
            </Card>

            {selected.category === "solvent" && (
              <SolventCalcPanel
                payZoneM={reservoir.payZoneM}
                porosity={reservoir.porosity}
                reservoirTempC={reservoir.temperatureC}
                defaultDamage={selected.type === "solvent_paraffin" ? "paraffin" : "asphaltene"}
                onResult={setSolventResult}
              />
            )}

            {selected.category === "nitrogen" && (
              <NitrogenCalcPanel
                reservoirPressureMPa={reservoir.reservoirPressureMPa}
                reservoirTempC={reservoir.temperatureC}
                operationType={selected.type === "n2_foam_lift" ? "n2_foam_lift" : "n2_lift"}
                defaultFoamQuality={selected.targetFoamQuality}
                onResult={setNitrogenResult}
              />
            )}
          </TabsContent>

          {/* ─────────── PLAN ─────────── */}
          <TabsContent value="plan" className="space-y-4 mt-4">
            {schedule && (
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="font-semibold">График закачки</h3>
                  <span className="text-xs text-muted-foreground">общее время {schedule.totalTimeMin.toFixed(0)} мин · макс. на устье {schedule.maxSurfaceMPa.toFixed(1)} МПа · макс. забойное {schedule.maxBhpMPa.toFixed(1)} МПа (Pгрп {pFracMPa.toFixed(1)})</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Field label="Подача насоса макс., л/мин" value={pumpMaxLpm} onChange={setPumpMaxLpm} step={50} hint="По паспорту агрегата" />
                  <Field label="ρ скважинной жидкости, г/см³" value={wellFluidDensity} onChange={setWellFluidDensity} step={0.01} hint="Заполнение ствола до начала и жидкость продавки" />
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-muted/50"><tr><th className="p-1.5 text-left">Стадия</th><th className="p-1.5 text-right">Объём, м³</th><th className="p-1.5 text-right">Время, мин</th><th className="p-1.5 text-right">Средний расход, л/мин</th><th className="p-1.5 text-right">Макс. на устье, МПа</th></tr></thead>
                  <tbody>
                    {schedule.stages.map((st) => (
                      <tr key={st.name} className="border-t border-border/40">
                        <td className="p-1.5">{st.name}</td>
                        <td className="p-1.5 text-right">{st.volumeM3.toFixed(1)}</td>
                        <td className="p-1.5 text-right">{st.startMin.toFixed(0)}–{st.endMin.toFixed(0)}</td>
                        <td className="p-1.5 text-right">{st.avgRateLpm.toFixed(0)}</td>
                        <td className="p-1.5 text-right">{st.maxSurfaceMPa.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ width: "100%", height: 280 }}>
                  <ResponsiveContainer>
                    <LineChart data={schedule.points.filter((_, i) => i % 3 === 0).map((p) => ({ v: +p.volumeM3.toFixed(1), surf: +p.surfacePressureMPa.toFixed(2), bhp: +p.bhpMPa.toFixed(2), rate: +p.rateLpm.toFixed(0) }))} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="v" type="number" stroke="hsl(var(--muted-foreground))" label={{ value: "закачано, м³", position: "insideBottom", offset: -2, fontSize: 11 }} />
                      <YAxis yAxisId="P" stroke="hsl(var(--muted-foreground))" label={{ value: "МПа", angle: -90, position: "insideLeft", fontSize: 11 }} />
                      <YAxis yAxisId="Q" orientation="right" stroke="#10b981" label={{ value: "л/мин", angle: 90, position: "insideRight", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Legend />
                      <Line yAxisId="P" type="monotone" dataKey="surf" name="На устье, МПа" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                      <Line yAxisId="P" type="monotone" dataKey="bhp" name="Забойное, МПа" stroke="#f59e0b" dot={false} />
                      <Line yAxisId="Q" type="stepAfter" dataKey="rate" name="Расход, л/мин" stroke="#10b981" dot={false} strokeDasharray="4 4" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {schedule.warnings.map((w, i) => (
                  <div key={i} className={`text-xs ${w.startsWith("🔴") ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}`}>{w}</div>
                ))}
              </Card>
            )}


            {stages ? (
              <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-semibold">Многоступенчатая обработка</h3>
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${
                    stages.scheme === "sandstone-glinokislota-3stage"
                      ? "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/40"
                      : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/40"
                  }`}>
                    {stages.scheme === "sandstone-glinokislota-3stage" ? "Глинокислота · 3 стадии (обязательно)" : "Карбонатная схема · 3 стадии"}
                  </span>
                </div>
                <StageRow n={stages.preflush.label} {...stages.preflush} />
                <StageRow n={stages.mainAcid.label} {...stages.mainAcid} />
                <StageRow n={stages.afterflush.label} {...stages.afterflush} />
                <StageRow n="4. Продавка" fluid={stages.displacement.fluid} volumeM3={stages.displacement.volumeM3} purpose="Доставка реагентов в пласт" />
                <div className="border-t pt-2 text-sm font-medium">Итого: {stages.totalVolumeM3.toFixed(1)} м³</div>
                {stages.recommendations.length > 0 && (
                  <div className="pt-2 border-t border-border/40 space-y-1">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Технологические требования</div>
                    {stages.recommendations.map((r, i) => (
                      <div key={i} className="text-xs text-muted-foreground flex gap-2"><span>•</span><span>{r}</span></div>
                    ))}
                  </div>
                )}
              </Card>
            ) : (
              <Card className="p-4 text-sm text-muted-foreground">
                Детальная циклограмма формируется для кислотных и комбинированных методов.
              </Card>
            )}

            <Card className="p-4">
              <h3 className="font-semibold mb-2">Шаги операции</h3>
              <ol className="text-sm space-y-1 list-decimal pl-5">
                <li>Подготовка устья, опрессовка нагнетательных линий на {injection.lineTestPressureMPa.toFixed(1)} МПа (1.5 × макс. давления на устье)</li>
                <li>Закачка preflush (если применимо)</li>
                <li>Закачка основного реагента: начать с {effectiveRateLpm.toFixed(0)} л/мин, давление на устье ≈ {injection.surfacePressureMPa.toFixed(1)} МПа; по мере снижения давления поднимать расход до {injection.maxRateEndLpm.toFixed(0)} л/мин, не превышая {injection.maxSurfacePressureMPa.toFixed(1)} МПа на устье</li>
                {selected.requiresN2 && <li>Поддержание FQ = {selected.targetFoamQuality}% по линии N₂</li>}
                <li>Продавка скважинной жидкостью: {displacement.totalM3.toFixed(2)} м³ (НКТ до башмака + колонна до кровли перфорации)</li>
                <li>Выдержка {selected.soakTimeMin[0]}–{selected.soakTimeMin[1]} мин</li>
                {selected.numberOfCycles > 1 && <li>Повтор циклов ×{selected.numberOfCycles}</li>}
                <li>Вызов притока, освоение, контроль дебита</li>
              </ol>
            </Card>

            {(selected.risks.length > 0 || selected.contraindications.length > 0) && (
              <Card className="p-4 border-amber-500/40">
                <h3 className="font-semibold mb-2 flex items-center gap-2 text-amber-600 dark:text-amber-400"><AlertTriangle className="w-4 h-4" /> Риски</h3>
                <ul className="text-sm space-y-1 list-disc pl-5">
                  {selected.risks.map((r, i) => <li key={i}>{r}</li>)}
                  {selected.contraindications.map((c, i) => <li key={`c${i}`} className="text-destructive">Противопоказано: {c}</li>)}
                </ul>
              </Card>
            )}
          </TabsContent>

          {/* ─────────── FORECAST ─────────── */}
          <TabsContent value="forecast" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Арпс qi" value={`${arps.qi.toFixed(1)} ${rateUnit}`} />
              <Stat label="Арпс di" value={`${(arps.di * 100).toFixed(2)} %/мес`} />
              <Stat label="Тип падения" value={arps.type} sub={`b=${arps.b.toFixed(2)}, R²=${arps.r2.toFixed(2)}`} />
              <Stat label="Накопленный ΔQ (36 мес)" value={`${(forecast[forecast.length - 1]?.cumulativeDeltaM3 ?? 0).toFixed(0)} м³`} />
            </div>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Дебит: baseline vs treated (36 мес)</h3>
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" label={{ value: "мес", position: "insideBottom", offset: -2, fontSize: 11 }} />
                    <YAxis stroke="hsl(var(--muted-foreground))" label={{ value: rateUnit, angle: -90, position: "insideLeft", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Legend />
                    <Line type="monotone" dataKey="baseline" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" name="Без обработки" dot={false} />
                    <Line type="monotone" dataKey="treated" stroke="hsl(var(--primary))" name="С обработкой" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Накопленный прирост, м³</h3>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
                    <YAxis stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Area type="monotone" dataKey="cum" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" name="Накоп. ΔQ, м³" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-4 space-y-3">
              <h3 className="font-semibold">Экономика обработки</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label={`Цена (нетбэк), руб/${economics.unitLabel}`} value={econ.pricePerUnit} onChange={(v) => setEcon({ ...econ, pricePerUnit: v })} step={500} />
                <Field label={`НДПИ, руб/${economics.unitLabel}`} value={econ.mineralTaxPerUnit} onChange={(v) => setEcon({ ...econ, mineralTaxPerUnit: v })} step={500} hint="Ставка меняется ежемесячно — введите актуальную" />
                <Field label={`Опер. затраты, руб/${economics.unitLabel}`} value={econ.opexPerUnit} onChange={(v) => setEcon({ ...econ, opexPerUnit: v })} step={100} />
                <Field label="Налог на прибыль, доля" value={econ.profitTaxRate} onChange={(v) => setEcon({ ...econ, profitTaxRate: v })} step={0.01} />
                <Field label="Ставка дисконтирования, доля/год" value={econ.discountRate} onChange={(v) => setEcon({ ...econ, discountRate: v })} step={0.01} />
                <Field label="Реагенты, руб (0 = по каталогу)" value={econ.reagentCostRub} onChange={(v) => setEcon({ ...econ, reagentCostRub: v })} step={10000} hint={`По каталогу: ${Math.round(reagentCostAuto).toLocaleString("ru-RU")} руб`} />
                <Field label="Сервис (бригада, техника), руб" value={econ.serviceCostRub} onChange={(v) => setEcon({ ...econ, serviceCostRub: v })} step={10000} />
                <Field label="Мобилизация, руб" value={econ.mobilizationRub} onChange={(v) => setEcon({ ...econ, mobilizationRub: v })} step={10000} />
                <Field label="Простой скважины, сут" value={econ.downtimeDays} onChange={(v) => setEcon({ ...econ, downtimeDays: v })} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Затраты на обработку" value={`${(economics.treatmentCostRub / 1e6).toFixed(2)} млн ₽`} sub={`+ потери на простое ${(economics.downtimeLossRub / 1e6).toFixed(2)} млн ₽`} />
                <Stat label={`Доп. добыча (36 мес)`} value={`${economics.incrementalUnitsTotal.toFixed(0)} ${economics.unitLabel}`} sub={`чистый доход ${economics.marginPerUnit.toFixed(0)} руб/${economics.unitLabel}`} />
                <Stat label="NPV" value={`${(economics.npv / 1e6).toFixed(2)} млн ₽`} sub={economics.irrAnnual != null ? `IRR ${(economics.irrAnnual * 100).toFixed(0)}% год.` : undefined} />
                <Stat label="Окупаемость" value={economics.paybackMonths != null ? `${economics.paybackMonths} мес` : "не окупается"} sub={`индекс доходности ${economics.pi.toFixed(2)}`} />
              </div>
              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={economics.months.map((m) => ({ month: m.month, cum: +(m.cumulative / 1e6).toFixed(2), disc: +(m.cumulativeDiscounted / 1e6).toFixed(2) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" label={{ value: "мес", position: "insideBottom", offset: -2, fontSize: 11 }} />
                    <YAxis stroke="hsl(var(--muted-foreground))" label={{ value: "млн ₽", angle: -90, position: "insideLeft", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Legend />
                    <Line type="monotone" dataKey="cum" name="Накопленный поток" stroke="hsl(var(--primary))" dot={false} />
                    <Line type="monotone" dataKey="disc" name="Дисконтированный" stroke="#10b981" dot={false} strokeDasharray="4 4" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {economics.warnings.map((w, i) => (
                <div key={i} className={`text-xs ${w.startsWith("🔴") ? "text-red-600 font-medium" : "text-muted-foreground"}`}>{w}</div>
              ))}
            </Card>
          </TabsContent>

          {/* ─────────── REPORT ─────────── */}
          <TabsContent value="report" className="space-y-4 mt-4">
            <Card className="p-4 space-y-3">
              <h3 className="font-semibold">DOCX-отчёт</h3>
              <p className="text-sm text-muted-foreground">
                Инженерная план-программа ОПЗ: коллектор, диагностика повреждений, выбранный метод,
                рецептура, многоступенчатая обработка, кинетика, прогноз дебита 36 мес.
              </p>

              <Button onClick={handleExport}>
                <FileText className="w-4 h-4 mr-2" /> Скачать план-программу (DOCX)
              </Button>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
      <SaveToCabinetDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        defaultTitle={`ОПЗ ${wellName} ${new Date().toLocaleDateString("ru-RU")}`}
        initialWellId={selectedWellId}
        calcId={calcId}
        buildPayload={buildPayload}
      />

      <footer className="border-t border-border bg-card mt-10">
        <div className="max-w-6xl mx-auto px-4 py-4 text-xs text-muted-foreground text-center">
          Расчёты носят информационный характер. Соответствует требованиям ФЗ-152.{" "}
          <Link to="/terms" className="hover:text-foreground transition-colors underline">Пользовательское соглашение</Link>
        </div>
      </footer>
    </div>
  );
}

function Field({ label, value, onChange, step = 1, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label title={hint}>{label}</Label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <p className="text-[10px] text-muted-foreground leading-tight">{hint}</p>}
    </div>
  );
}
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}
function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-border/40 pb-1">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
function StageRow({ n, fluid, volumePerMeterPay, volumeM3, purpose }: { n: string; fluid: string; volumePerMeterPay?: number; volumeM3: number; purpose: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-sm border-b border-border/40 pb-2">
      <div>
        <div className="font-medium">{n}: {fluid}</div>
        <div className="text-xs text-muted-foreground">{purpose}</div>
      </div>
      <div className="text-right text-xs">
        {volumePerMeterPay !== undefined && <div>{volumePerMeterPay} м³/м</div>}
        <div className="font-semibold text-sm">{volumeM3.toFixed(1)} м³</div>
      </div>
    </div>
  );
}
function MethodCard({ ranked, selected, onSelect }: { ranked: RankedMethod; selected: boolean; onSelect: () => void }) {
  const c = scoreColor(ranked.score);
  const colorCls = c === "green" ? "border-emerald-500/60 bg-emerald-500/5" : c === "yellow" ? "border-amber-500/60 bg-amber-500/5" : "border-border";
  return (
    <Card className={`p-3 cursor-pointer transition hover:shadow-md ${colorCls} ${selected ? "ring-2 ring-primary" : ""}`} onClick={onSelect}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xl">{ranked.method.icon}</span>
            <span className="font-medium text-sm">{ranked.method.nameRu}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{ranked.method.description}</div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold ${c === "green" ? "text-emerald-600 dark:text-emerald-400" : c === "yellow" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{ranked.score}</div>
          <div className="text-[10px] text-muted-foreground">score</div>
        </div>
      </div>
      <div className="mt-2 space-y-0.5">
        {ranked.reasons.slice(0, 2).map((r, i) => (
          <div key={i} className="text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {r}</div>
        ))}
        {ranked.warnings.slice(0, 2).map((w, i) => (
          <div key={i} className="text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {w}</div>
        ))}
      </div>
    </Card>
  );
}
