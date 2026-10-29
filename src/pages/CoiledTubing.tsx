import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Send, Gauge, Shield, Droplets, Activity, ChevronDown, ChevronRight, Calculator, Save, RotateCcw, FileDown, LogOut, User, Plus, Trash2, Home, Thermometer, LayoutDashboard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import TermsFooter from "@/components/TermsFooter";
import SaveToCabinetDialog, { type SaveCalcPayload } from "@/components/SaveToCabinetDialog";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, Area, ComposedChart, ReferenceLine, ScatterChart, Scatter, ZAxis } from "recharts";
import { BlurInput } from "@/components/BlurInput";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import {
  CTStringData, WellGeometry, FluidData, PumpData, ToolsData,
  calculateTubingForces, calculateLimits, calculateHydraulics, calculateFatigue,
  calculateTempering,
  CT_PRESETS, FLUID_PRESETS, ctWeightPerMeter,
  ForceResult, LimitResult, HydraulicsResult, FatigueResult, TemperingResult,
  generateForceDepthProfile, generateHydraulicsCurve, generatePressureLoadEnvelope,
  generateTempProfile,
  assessRisks, RiskItem,
  calculateTVDFromSurvey, type TrajectoryPoint,
  generateOperatingPath, CT_SURFACE_DEFAULTS, REEL_DIAMETERS, type CTSurfaceOptions,
} from "@/lib/coiled-tubing-calculations";
import { generateHookLoadProfile, type HookLoadPoint, type CTSection } from "@/lib/coiled-tubing-calculations";
import CTWell3D from "@/components/CTWell3D";
import { exportCTDocx } from "@/lib/export-ct-docx";
import CTOperationsLibrary from "@/components/CTOperationsLibrary";
import CTReachAnalysisTab from "@/components/CTReachAnalysisTab";
import CTCleanoutTab from "@/components/CTCleanoutTab";
import CTNitrogenKickoffTab from "@/components/CTNitrogenKickoffTab";
import CTAcidStimTab from "@/components/CTAcidStimTab";
import CTTripSimulator from "@/components/CTTripSimulator";
import CTOperationSummary from "@/components/CTOperationSummary";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import CopyImageButton from "@/components/CopyImageButton";
import CTStringLifeCard from "@/components/CTStringLifeCard";
import CTActualMatchTab from "@/components/CTActualMatchTab";
import CTBuckling3D from "@/components/CTBuckling3D";
import { buildCTProgram } from "@/lib/ct-program";
import type { ActualPoint } from "@/lib/ct-actual-match";
import { analyzeStringLife, defaultPassport, type CTStringPassport } from "@/lib/ct-string-life";
import * as XLSX from "xlsx";

// ─── Session ───
const CT_SESSION_KEY = "ct_session_v2";

interface CTSession {
  ct: CTStringData;
  well: WellGeometry;
  fluid: FluidData;
  pump: PumpData;
  tools: ToolsData;
  friction: number;
  reelSize: "small" | "medium" | "large";
  prevTrips: number;
  trajPoints: TrajectoryPoint[];
  ctSections: CTSection[];
  surface: CTSurfaceOptions;
  stringPassport: CTStringPassport | null;
  actualData: ActualPoint[];
}

const defaultCT: CTStringData = { od: 50.8, wall: 3.96, grade: "CT-80", length: 3000, ovality: 1 };
const defaultWell: WellGeometry = {
  md: 3000, tvd: 2800, casingID: 168.3, tubingID: 62, wellheadPressure: 5,
  bhst: 80, bhct: 65, whTemp: 20, fracGradient: 0.017,
  trajectory: [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }],
};
const defaultFluid: FluidData = { name: "Вода", density: 1.0, pv: 1, yp: 0, nIndex: 1, kIndex: 0.001 };
const defaultPump: PumpData = { flowRate: 5, surfacePressure: 0 };
const defaultTools: ToolsData = { bhaWeight: 200, bhaLength: 5, bhaOD: 48, nozzleDiam: 4, nozzleCount: 3 };
const defaultTraj: TrajectoryPoint[] = [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }];
const defaultSections: CTSection[] = [];

function makeSecId() { return Math.random().toString(36).slice(2, 9); }

function loadSession(): CTSession {
  try {
    const raw = sessionStorage.getItem(CT_SESSION_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        ct: { ...defaultCT, ...p.ct },
        well: { ...defaultWell, ...p.well },
        fluid: { ...defaultFluid, ...p.fluid },
        pump: { ...defaultPump, ...p.pump },
        tools: { ...defaultTools, ...p.tools },
        friction: p.friction ?? 0.25,
        reelSize: p.reelSize ?? "medium",
        prevTrips: p.prevTrips ?? 0,
        trajPoints: Array.isArray(p.trajPoints) ? p.trajPoints : defaultTraj,
        ctSections: Array.isArray(p.ctSections) ? p.ctSections : defaultSections,
        surface: p.surface && typeof p.surface === "object" ? p.surface : {},
        stringPassport: p.stringPassport && Array.isArray(p.stringPassport.journal) ? p.stringPassport : null,
        actualData: Array.isArray(p.actualData) ? p.actualData : [],
      };
    }
  } catch {}
  return { ct: defaultCT, well: defaultWell, fluid: defaultFluid, pump: defaultPump, tools: defaultTools, friction: 0.25, reelSize: "medium", prevTrips: 0, trajPoints: defaultTraj, ctSections: defaultSections, surface: {}, stringPassport: null, actualData: [] };
}

function num(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function Num({ value, unit, label, warn }: { value: number | string; unit?: string; label: string; warn?: boolean }) {
  return (
    <div className={`flex justify-between items-center py-1.5 px-2 rounded text-sm ${warn ? "bg-destructive/10 text-destructive" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}{unit && <span className="ml-1 text-muted-foreground font-normal text-xs">{unit}</span>}</span>
    </div>
  );
}

function RiskBadge({ risk }: { risk: RiskItem }) {
  const bg = risk.level === "critical" ? "bg-destructive/15 text-destructive border-destructive/30" : risk.level === "warning" ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30" : "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${bg}`}>
      <span className="text-base leading-none mt-0.5">{risk.emoji}</span>
      <span>{risk.message}</span>
    </div>
  );
}

// Chart capture helper
async function captureChart(ref: React.RefObject<HTMLDivElement | null>): Promise<string | undefined> {
  if (!ref.current) return undefined;
  try {
    const { toJpeg } = await import("html-to-image");
    return await toJpeg(ref.current, { quality: 0.85, backgroundColor: "#ffffff" });
  } catch { return undefined; }
}

const Field = ({ label, value, onChange, unit, hint }: { label: string; value: number; onChange: (v: string) => void; unit?: string; hint?: string }) => (
  <div className="space-y-1">
    <Label className="text-xs" title={hint}>{label}{unit ? ` (${unit})` : ""}</Label>
    <BlurInput type="number" step="any" value={value || ""} onValueCommit={onChange} className="h-8 text-xs" />
    {hint && <p className="text-[10px] text-muted-foreground leading-tight">{hint}</p>}
  </div>
);

export default function CoiledTubing() {
  const navigate = useNavigate();
  const initial = loadSession();

  const [ct, setCT] = useState<CTStringData>(initial.ct);
  const [well, setWell] = useState<WellGeometry>(initial.well);
  const [fluid, setFluid] = useState<FluidData>(initial.fluid);
  const [pump, setPump] = useState<PumpData>(initial.pump);
  const [tools, setTools] = useState<ToolsData>(initial.tools);
  const [friction, setFriction] = useState(initial.friction);
  const [reelSize, setReelSize] = useState<"small" | "medium" | "large">(initial.reelSize);
  const [prevTrips, setPrevTrips] = useState(initial.prevTrips);
  const [trajPoints, setTrajPoints] = useState<TrajectoryPoint[]>(initial.trajPoints);
  const [tab, setTab] = useState("forces");
  const [ctSections, setCtSections] = useState<CTSection[]>(initial.ctSections);
  const [surface, setSurface] = useState<CTSurfaceOptions>(initial.surface);
  const [stringPassport, setStringPassport] = useState<CTStringPassport>(() => initial.stringPassport ?? defaultPassport(initial.ct.length, REEL_DIAMETERS[initial.reelSize] ?? 1.83));
  const [searchParams] = useSearchParams();
  const [actualData, setActualData] = useState<ActualPoint[]>(initial.actualData);
  const surfaceOpts = useMemo<CTSurfaceOptions>(() => ({ ...surface, reelCoreD: REEL_DIAMETERS[reelSize] }), [surface, reelSize]);
  const [calculated, setCalculated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [operationType, setOperationType] = useState<string | undefined>(undefined);

  // Collapsible sections
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    ct: false, well: false, fluid: false, pump: false, surface: false, fatigue: false,
  });
  const toggle = (k: string) => setOpenSections(s => ({ ...s, [k]: !s[k] }));

  // Chart refs
  const forcesChartRef = useRef<HTMLDivElement>(null);
  const hookLoadChartRef = useRef<HTMLDivElement>(null);
  const limitsChartRef = useRef<HTMLDivElement>(null);
  const hydraulicsChartRef = useRef<HTMLDivElement>(null);
  const fatigueChartRef = useRef<HTMLDivElement>(null);
  const temperingChartRef = useRef<HTMLDivElement>(null);
  const temperingDegradationRef = useRef<HTMLDivElement>(null);
  const tempProfileChartRef = useRef<HTMLDivElement>(null);
  const well3dRef = useRef<HTMLDivElement>(null);
  const buckOverviewRef = useRef<HTMLDivElement>(null);
  const buckCloseupRef = useRef<HTMLDivElement>(null);

  // Auth check
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setUserId(session.user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Save session on change
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        sessionStorage.setItem(CT_SESSION_KEY, JSON.stringify({ ct, well, fluid, pump, tools, friction, reelSize, prevTrips, trajPoints, ctSections, surface, stringPassport, actualData }));
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [ct, well, fluid, pump, tools, friction, reelSize, prevTrips, trajPoints, ctSections, surface, stringPassport, actualData]);

  // Открытие сохранённого расчёта из кабинета (?calc=…)
  useEffect(() => {
    const calcId = searchParams.get("calc");
    if (!calcId) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data, error } = await supabase.from("saved_calculations").select("*").eq("id", calcId).eq("user_id", session.user.id).single();
      if (error || !data) { toast.error("Не удалось загрузить расчёт"); return; }
      const wd = (data.well_data ?? {}) as Record<string, any>;
      const cp = (data.calc_params ?? {}) as Record<string, any>;
      if (wd.ct) setCT({ ...defaultCT, ...wd.ct });
      if (wd.well) setWell({ ...defaultWell, ...wd.well });
      if (wd.fluid) setFluid({ ...defaultFluid, ...wd.fluid });
      if (wd.pump) setPump({ ...defaultPump, ...wd.pump });
      if (wd.tools) setTools({ ...defaultTools, ...wd.tools });
      if (typeof wd.friction === "number") setFriction(wd.friction);
      if (wd.reelSize) setReelSize(wd.reelSize);
      if (typeof wd.prevTrips === "number") setPrevTrips(wd.prevTrips);
      if (Array.isArray(wd.trajPoints)) setTrajPoints(wd.trajPoints);
      if (wd.surface) setSurface(wd.surface);
      if (wd.stringPassport && Array.isArray(wd.stringPassport.journal)) setStringPassport(wd.stringPassport);
      if (Array.isArray(wd.actualData)) setActualData(wd.actualData);
      if (Array.isArray(cp.ctSections)) setCtSections(cp.ctSections);
      setCalculated(false);
      toast.success(`Загружен расчёт: ${data.title}. Нажмите «Расчёт».`);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markDirty = useCallback(() => setCalculated(false), []);

  // Results
  const [forces, setForces] = useState<ForceResult | null>(null);
  const [limits, setLimits] = useState<LimitResult | null>(null);
  const [hydraulics, setHydraulics] = useState<HydraulicsResult | null>(null);
  const [fatigue, setFatigue] = useState<FatigueResult | null>(null);
  const [tempering, setTempering] = useState<TemperingResult | null>(null);
  const [risks, setRisks] = useState<RiskItem[]>([]);
  const [hookLoadData, setHookLoadData] = useState<HookLoadPoint[]>([]);

  // ── Trajectory ──
  const updateTrajPoint = (idx: number, key: keyof TrajectoryPoint, val: string) => {
    const pts = [...trajPoints];
    pts[idx] = { ...pts[idx], [key]: num(val) };
    setTrajPoints(pts);
    markDirty();
  };
  const addTrajPoint = () => { setTrajPoints(p => [...p, { md: 0, azimuth: 0, zenith: 0, tvd: 0 }]); markDirty(); };
  const removeTrajPoint = (i: number) => { setTrajPoints(p => p.filter((_, idx) => idx !== i)); markDirty(); };

  const recalcTVD = useCallback(() => {
    const sorted = [...trajPoints].sort((a, b) => a.md - b.md);
    const calc = calculateTVDFromSurvey(sorted);
    setTrajPoints(calc);
    if (calc.length > 0) {
      const lastMD = calc[calc.length - 1].md;
      const lastTVD = calc[calc.length - 1].tvd;
      setWell(w => ({ ...w, md: Math.max(w.md, lastMD), tvd: lastTVD, trajectory: calc }));
    }
    markDirty();
    toast.success("TVD пересчитана по инклинометрии");
  }, [trajPoints, markDirty]);

  const importExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target?.result, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (!rows.length) return;
      const find = (row: any, keys: string[]) => {
        for (const k of Object.keys(row)) {
          if (keys.some(s => k.toLowerCase().includes(s))) return row[k];
        }
        return null;
      };
      const mapped = rows.map(r => {
        const md = parseFloat(find(r, ["md", "глубина", "depth", "ствол"]));
        const az = parseFloat(find(r, ["azimuth", "азимут", "az"]));
        const zen = parseFloat(find(r, ["zenith", "зенит", "incl", "угол"]));
        if (isNaN(md) || isNaN(az) || isNaN(zen)) return null;
        return { md, azimuth: az, zenith: zen, tvd: 0 } as TrajectoryPoint;
      }).filter(Boolean) as TrajectoryPoint[];
      if (mapped.length) {
        const calc = calculateTVDFromSurvey(mapped.sort((a, b) => a.md - b.md));
        setTrajPoints(calc);
        setWell(w => ({ ...w, trajectory: calc, md: calc[calc.length - 1].md, tvd: calc[calc.length - 1].tvd }));
        toast.success(`Импортировано ${calc.length} точек`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  // ── Calculation ──
  const runCalculation = useCallback(() => {
    const wellWithTraj: WellGeometry = {
      ...well,
      trajectory: trajPoints.length > 1 ? trajPoints : well.trajectory,
    };
    const secs = ctSections.length > 0 ? ctSections : undefined;

    const f = calculateTubingForces(ct, wellWithTraj, fluid, tools, friction, secs, surfaceOpts);
    const h = calculateHydraulics(ct, wellWithTraj, fluid, pump, tools, secs, surfaceOpts);
    const tp = calculateTempering(ct, wellWithTraj, fluid, pump);
    // проверка прочности на устье (наиболее нагруженное место): давление насоса внутри, давление устья снаружи, натяжение подъёма
    const l = calculateLimits(ct, h.pumpPressure, wellWithTraj.wellheadPressure, f.surfaceLoadPOOH, { wallLossPct: surface.wallLossPct ?? 0 });
    let ft = calculateFatigue(ct, reelSize, h.pumpPressure, prevTrips);
    if (stringPassport.journal.length > 0) {
      // ведётся журнал трубы — ресурс по наиболее изношенному участку
      const dep = Math.min(wellWithTraj.md, ct.length);
      const la = analyzeStringLife(stringPassport, ct.od, ct.wall, ct.grade, { depthM: dep, pressureMPa: h.pumpPressure, env: "normal" }, dep + 150);
      ft = { ...ft, fatigueLifeUsed: Math.round(la.maxDamagePct * 10) / 10, maxSafeTrips: Number.isFinite(la.jobsToRetire) ? Math.floor(la.jobsToRetire) : ft.maxSafeTrips };
    }
    const r = assessRisks(f, l, h, ft, wellWithTraj);
    const hl = generateHookLoadProfile(ct, wellWithTraj, fluid, tools, friction, secs, 50, surfaceOpts);

    setForces(f);
    setLimits(l);
    setHydraulics(h);
    setFatigue(ft);
    setTempering(tp);
    setRisks(r);
    setHookLoadData(hl);
    setCalculated(true);

    supabase.functions.invoke("log-activity", {
      body: { type: "calculation", module: "coiled-tubing", page_url: "/coiled-tubing" },
    }).catch(() => {});

    toast.success("Расчёт выполнен ✅");
  }, [ct, well, fluid, pump, tools, friction, reelSize, prevTrips, trajPoints, ctSections, surface, surfaceOpts, stringPassport]);

  const handleReset = useCallback(() => {
    setCT(defaultCT); setWell(defaultWell); setFluid(defaultFluid);
    setPump(defaultPump); setTools(defaultTools); setFriction(0.25);
    setReelSize("medium"); setPrevTrips(0); setCalculated(false);
    setTrajPoints(defaultTraj);
    setCtSections(defaultSections);
    setSurface({});
    setHookLoadData([]);
    setForces(null); setLimits(null); setHydraulics(null); setFatigue(null);
    setTempering(null);
    setRisks([]);
    sessionStorage.removeItem(CT_SESSION_KEY);
    toast.info("Данные обнулены");
  }, []);

  // Build payload for save dialog
  const buildCTPayload = useCallback((): SaveCalcPayload => ({
    module: "coiled-tubing",
    title: `ГНКТ ${ct.od}мм ${ct.grade} — MD ${well.md}м`,
    well_data: { ct, well, fluid, pump, tools, friction, reelSize, prevTrips, trajPoints, surface, stringPassport, actualData },
    calc_params: { forces, limits, hydraulics, fatigue, risks, ctSections },
    results: { forces, limits, hydraulics, fatigue },
  }), [ct, well, fluid, pump, tools, friction, reelSize, prevTrips, trajPoints, forces, limits, hydraulics, fatigue, risks, ctSections, surface, stringPassport, actualData]);

  // Save to database (opens dialog)
  const handleSave = useCallback(async () => {
    if (!userId) { toast.error("Необходимо войти в систему"); navigate("/auth"); return; }
    if (!calculated || !forces) { toast.error("Сначала выполните расчёт"); return; }
    setSaveDialogOpen(true);
  }, [userId, calculated, forces, navigate]);


  // Export DOCX
  const handleExportDocx = useCallback(async () => {
    if (!calculated || !forces || !limits || !hydraulics || !fatigue) {
      toast.error("Сначала выполните расчёт");
      return;
    }

    toast.info("Формирование документа...");

    // Capture 3D canvas separately (WebGL)
    const canvasImg = (r: React.RefObject<HTMLDivElement | null>) => { const c = r.current?.querySelector("canvas"); try { return c ? c.toDataURL("image/png") : undefined; } catch { return undefined; } };
    const buck3dImg = canvasImg(buckOverviewRef), buckCloseImg = canvasImg(buckCloseupRef);
    let well3dImg: string | undefined;
    if (well3dRef.current) {
      const canvas = well3dRef.current.querySelector("canvas");
      if (canvas) {
        try { well3dImg = canvas.toDataURL("image/png"); } catch { /* security */ }
      }
    }

    const [forcesImg, hookLoadImg, limitsImg, hydraulicsImg, fatigueImg, temperingImg, temperingDegImg, tempProfileImg] = await Promise.all([
      captureChart(forcesChartRef),
      captureChart(hookLoadChartRef),
      captureChart(limitsChartRef),
      captureChart(hydraulicsChartRef),
      captureChart(fatigueChartRef),
      captureChart(temperingChartRef),
      captureChart(temperingDegradationRef),
      captureChart(tempProfileChartRef),
    ]);

    const ctBundle = {
      ct, well, fluid, pump, tools, friction, reelSize, prevTrips,
      forces, limits, hydraulics, fatigue, tempering, risks,
      trajPoints,
      ctSections: ctSections.length > 0 ? ctSections : undefined,
      hookLoadData: hookLoadData.length > 0 ? hookLoadData : undefined,
      forceProfile: forceProfile.length > 0 ? forceProfile : undefined,
      tempProfile: tempProfile.length > 0 ? tempProfile : undefined,
      hydraulicsCurve: hydraulicsCurve.length > 0 ? hydraulicsCurve : undefined,
      program: buildCTProgram({ ct, well: wellWithTraj, fluid, pump, opts: surfaceOpts, friction, forces, limits, hydraulics, fatigue, hookLoad: hookLoadData, life: lifeAnalysis, operationType }),
      stringLife: stringPassport.journal.length > 0 ? { serial: stringPassport.serial, analysis: analyzeStringLife(stringPassport, ct.od, ct.wall, ct.grade, { depthM: Math.min(well.md, ct.length), pressureMPa: hydraulics.pumpPressure, env: "normal" }, Math.min(well.md, ct.length) + 150) } : undefined,
      chartImages: {
        forces: forcesImg, hookLoad: hookLoadImg, limits: limitsImg,
        hydraulics: hydraulicsImg, fatigue: fatigueImg, tempering: temperingImg,
        temperingDegradation: temperingDegImg, tempProfile: tempProfileImg, buckling3d: buck3dImg, bucklingCloseup: buckCloseImg,
        well3d: well3dImg,
      },
    };
    try { sessionStorage.setItem("ct_export_bundle_v1", JSON.stringify(ctBundle)); } catch {}
    await exportCTDocx(ctBundle);

    toast.success("DOCX сформирован 📄");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculated, forces, limits, hydraulics, fatigue, tempering, risks, ct, well, fluid, pump, tools, friction, reelSize, prevTrips, trajPoints, ctSections, hookLoadData, operationType, stringPassport, surfaceOpts]);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    setUserId(null);
    toast.info("Вы вышли из системы");
  }, []);

  // Chart data
  const wellWithTraj = useMemo(() => ({
    ...well,
    trajectory: trajPoints.length > 1 ? trajPoints : well.trajectory,
  }), [well, trajPoints]);

  const forceProfile = useMemo(() => calculated ? generateForceDepthProfile(ct, wellWithTraj, fluid, tools, friction, 80, ctSections.length > 0 ? ctSections : undefined, surfaceOpts, forces && forces.lockUpDepth > 0 ? forces.lockUpDepth * 0.97 : undefined) : [], [calculated, ct, wellWithTraj, fluid, tools, friction, ctSections, surfaceOpts, forces]);
  const hydraulicsCurve = useMemo(() => calculated ? generateHydraulicsCurve(ct, wellWithTraj, fluid, tools, Math.max(6, Math.ceil(pump.flowRate * 2)), 30, ctSections.length > 0 ? ctSections : undefined, surfaceOpts) : [], [calculated, ct, wellWithTraj, fluid, tools, pump.flowRate, ctSections, surfaceOpts]);
  const pressureEnvelope = useMemo(() => calculated ? generatePressureLoadEnvelope(ct, { wallLossPct: surface.wallLossPct ?? 0 }) : [], [calculated, ct, surface.wallLossPct]);
  const operatingPath = useMemo(() => calculated && hydraulics ? generateOperatingPath(ct, wellWithTraj, fluid, tools, friction, ctSections.length > 0 ? ctSections : undefined, hydraulics, surfaceOpts, forces && forces.lockUpDepth > 0 ? forces.lockUpDepth * 0.97 : undefined) : null, [calculated, hydraulics, ct, wellWithTraj, fluid, tools, friction, ctSections, surfaceOpts, forces]);
  const lifeAnalysis = useMemo(() => {
    if (!calculated || !hydraulics || stringPassport.journal.length === 0) return null;
    const dep = Math.min(well.md, ct.length);
    return analyzeStringLife(stringPassport, ct.od, ct.wall, ct.grade, { depthM: dep, pressureMPa: hydraulics.pumpPressure, env: "normal" }, dep + 150);
  }, [calculated, hydraulics, stringPassport, well.md, ct]);
  const lifeHot = useMemo<[number, number] | null>(() => {
    if (!lifeAnalysis) return null;
    const h = lifeAnalysis.profile.filter((x) => x.damagePct >= stringPassport.retireAtPct * 0.6);
    return h.length ? [h[0].pos, h[h.length - 1].pos] : null;
  }, [lifeAnalysis, stringPassport.retireAtPct]);
  const envelopeChart = useMemo(() => [
    ...pressureEnvelope.map((r) => ({ axialLoad: r.axialLoad, burstLimit: r.burstLimit, burstWork: r.burstWork, collapseLimit: r.collapseLimit, collapseWork: r.collapseWork })),
  ], [pressureEnvelope]);
  const tempProfile = useMemo(() => calculated ? generateTempProfile(wellWithTraj) : [], [calculated, wellWithTraj]);

  const linWeight = ctWeightPerMeter(ct.od, ct.wall);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header — unified with Cement Plug style */}
      <header className="border-b border-border bg-card sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex flex-col items-center sm:items-start">
            <Link to="/" className="flex items-center gap-3">
              <img src={deallsoftLogo} alt="DeAllsoft" className="h-16 sm:h-28 object-cover object-center" />
              <p className="text-lg sm:text-2xl font-normal tracking-tight text-foreground uppercase -mt-1">Инженерные расчёты</p>
            </Link>
            <div className="mt-0.5 sm:ml-10 text-center sm:text-left">
              <h1 className="text-sm sm:text-lg font-medium text-muted-foreground leading-tight">🔧 ГНКТ — Гибкие НКТ (Coiled Tubing)</h1>
              <p className="text-xs text-muted-foreground/70">Силы · Пределы · Гидравлика · Усталость</p>
            </div>
          </div>
          <div className="flex items-center sm:flex-col sm:items-end gap-3 sm:gap-6 w-full sm:w-auto">
            <div className="flex items-center gap-3">
              <Link to="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                <Home className="w-4 h-4" /> <span>Главная</span>
              </Link>
              <Link to="/dashboard" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                <LayoutDashboard className="w-4 h-4" /> <span>Кабинет</span>
              </Link>
              <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                <Send className="w-4 h-4" /> <span>Поддержка</span>
              </a>
              <button onClick={handleLogout} className="flex items-center gap-1.5 text-muted-foreground hover:text-destructive transition-colors text-xs">
                <LogOut className="w-4 h-4" /> <span>Выйти</span>
              </button>
            </div>
            <div className="overflow-x-auto scrollbar-hide flex-1 sm:flex-none">
              <div className="flex items-center gap-1.5 sm:gap-3 min-w-max justify-end">
                <button onClick={handleReset} title="Обнулить" className="px-2 sm:px-3 py-2 sm:py-2.5 rounded-lg border border-border text-muted-foreground font-semibold text-[10px] sm:text-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition-colors shadow-sm flex items-center gap-1">
                  <RotateCcw className="w-3.5 h-3.5 shrink-0" /> <span className="hidden sm:inline">Обнулить</span>
                </button>
                <button onClick={handleSave} className="px-2 sm:px-3 py-2 sm:py-2.5 rounded-lg border border-border text-muted-foreground font-semibold text-[10px] sm:text-sm hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors shadow-sm flex items-center gap-1">
                  <Save className="w-3.5 h-3.5 shrink-0" /> <span className="hidden sm:inline">Сохранить</span>
                </button>
                {calculated && (
                  <button onClick={handleExportDocx} className="px-2 sm:px-4 py-2 sm:py-2.5 rounded-lg bg-secondary text-secondary-foreground font-semibold text-[10px] sm:text-sm hover:bg-secondary/80 transition-colors shadow-md flex items-center gap-1">
                    <FileDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" /> DOCX
                  </button>
                )}
                <button onClick={runCalculation} className="px-3 sm:px-6 py-2 sm:py-2.5 rounded-lg bg-primary text-primary-foreground font-bold text-[10px] sm:text-sm hover:bg-primary/90 transition-colors shadow-md whitespace-nowrap">
                  РАСЧЁТ
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-3 py-4 w-full">
        {/* 🎯 Operations library — auto-applies recommended params on click */}
        <div className="mb-3">
          <CTOperationsLibrary
            selectedType={operationType}
            onSelect={(op, params) => {
              setOperationType(op.type);
              if (op.type !== "custom" && (params.flowRateLps > 0 || params.fluidDensityGcc > 0.05)) {
                if (params.flowRateLps > 0) {
                  setPump(p => ({ ...p, flowRate: Number(params.flowRateLps.toFixed(2)) }));
                }
                setFluid(f => ({ ...f, density: params.fluidDensityGcc }));
                markDirty();
                toast.success(`Применена операция: ${op.nameRu}`, {
                  description: `Расход ${(params.flowRateLps * 60).toFixed(0)} л/мин · ρ ${params.fluidDensityGcc} г/см³`,
                });
              } else {
                toast(`Выбрана операция: ${op.nameRu}`);
              }
              // Автопереключение на профильную вкладку
              const tabMap: Record<string, string> = {
                wellbore_cleanout: "cleanout",
                scale_removal: "cleanout",
                paraffin_removal: "cleanout",
                sand_control: "cleanout",
                acid_stimulation: "acid",
                chemical_treatment: "acid",
                nitrogen_kickoff: "n2",
                gas_lift: "n2",
                well_kill: "n2",
              };
              const targetTab = tabMap[op.type];
              if (targetTab) setTab(targetTab);
            }}
          />
        </div>

        {/* Risks banner */}
        {calculated && risks.length > 0 && (
          <div className="space-y-1.5 mb-4">
            {risks.map((r, i) => <RiskBadge key={i} risk={r} />)}
          </div>
        )}

        <div className="space-y-3">
          {/* ══════════════════ INPUTS ══════════════════ */}

          {/* 🔧 CT Parameters */}
          <Collapsible open={openSections.ct} onOpenChange={() => toggle("ct")}>
            <Card>
              <CollapsibleTrigger className="w-full">
                <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm">🔧 Параметры ГНКТ</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">{ct.od}×{ct.wall} мм · {ct.grade}</Badge>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.ct ? "rotate-180" : ""}`} />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Типоразмер</Label>
                      <Select onValueChange={v => {
                        const p = CT_PRESETS.find(x => x.label === v);
                        if (p) { setCT(prev => ({ ...prev, od: p.od, wall: p.wall })); markDirty(); }
                      }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Выбрать..." /></SelectTrigger>
                        <SelectContent>{CT_PRESETS.map(p => <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <Field label="Нар. Ø" value={ct.od} onChange={v => { setCT(p => ({ ...p, od: num(v) })); markDirty(); }} unit="мм" hint="Наружный диаметр гибкой трубы. Типовые: 25.4, 31.75, 38.1, 44.45, 50.8, 60.3 мм" />
                    <Field label="Стенка" value={ct.wall} onChange={v => { setCT(p => ({ ...p, wall: num(v) })); markDirty(); }} unit="мм" hint="Толщина стенки. Чем толще, тем выше прочность и вес погонного метра" />
                    <div className="space-y-1">
                      <Label className="text-xs" title="Класс прочности по API 5ST: число = предел текучести в ksi">Марка стали</Label>
                      <Select value={ct.grade} onValueChange={v => { setCT(p => ({ ...p, grade: v })); markDirty(); }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["CT-70", "CT-80", "CT-90", "CT-110"].map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground leading-tight">API 5ST. CT-80 — стандарт; CT-110 — для глубоких/H2S</p>
                    </div>
                    <Field label="Длина на барабане" value={ct.length} onChange={v => { setCT(p => ({ ...p, length: num(v) })); markDirty(); }} unit="м" hint="Полная намотанная длина трубы на катушке инжектора" />
                    <Field label="Овальность" value={ct.ovality} onChange={v => { setCT(p => ({ ...p, ovality: num(v) })); markDirty(); }} unit="%" hint="(Dmax−Dmin)/Dном × 100. Новая 0.5–1%, отбраковка >5%" />

                  </div>
                  <p className="text-[10px] text-muted-foreground">Вн.Ø: {(ct.od - 2 * ct.wall).toFixed(1)} мм · Вес: {linWeight.toFixed(3)} кг/м</p>

                  <Separator />
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">📏 Секции ГНКТ</p>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => {
                      setCtSections(s => [...s, { id: makeSecId(), od: ct.od, wall: ct.wall, length: 500 }]);
                      markDirty();
                    }}><Plus className="w-3 h-3 mr-0.5" /> секция</Button>
                  </div>
                  {ctSections.length > 0 ? (
                    <>
                      <div className="max-h-48 overflow-auto text-[10px]">
                        <table className="w-full">
                          <thead>
                            <tr className="text-muted-foreground">
                              <th className="px-1 text-left">№</th>
                              <th className="px-1 text-left">Нар.Ø, мм</th>
                              <th className="px-1 text-left">Стенка, мм</th>
                              <th className="px-1 text-left">Длина, м</th>
                              <th className="w-6"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {ctSections.map((sec, i) => (
                              <tr key={sec.id}>
                                <td className="text-muted-foreground px-1">{i + 1}</td>
                                <td><BlurInput type="number" className="h-6 text-[10px] w-16" value={sec.od || ""} onValueCommit={v => { setCtSections(ss => ss.map(s => s.id === sec.id ? { ...s, od: num(v) } : s)); markDirty(); }} /></td>
                                <td><BlurInput type="number" className="h-6 text-[10px] w-16" value={sec.wall || ""} onValueCommit={v => { setCtSections(ss => ss.map(s => s.id === sec.id ? { ...s, wall: num(v) } : s)); markDirty(); }} /></td>
                                <td><BlurInput type="number" className="h-6 text-[10px] w-16" value={sec.length || ""} onValueCommit={v => { setCtSections(ss => ss.map(s => s.id === sec.id ? { ...s, length: num(v) } : s)); markDirty(); }} /></td>
                                <td><button className="text-destructive text-[10px]" onClick={() => { setCtSections(ss => ss.filter(s => s.id !== sec.id)); markDirty(); }}>✕</button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Общая длина: <strong>{ctSections.reduce((s, sec) => s + sec.length, 0).toFixed(1)} м</strong> · {ctSections.length} секций
                      </p>
                    </>
                  ) : (
                    <p className="text-[10px] text-muted-foreground italic">Используется однородная труба {ct.od}×{ct.wall} мм, длина {ct.length} м. Добавьте секции для мультисекционной ГНКТ.</p>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* 🛢 Well Data + Trajectory + Temperature */}
          <Collapsible open={openSections.well} onOpenChange={() => toggle("well")}>
            <Card>
              <CollapsibleTrigger className="w-full">
                <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm">🛢️ Данные скважины</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">MD {well.md} м · TVD {well.tvd} м</Badge>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.well ? "rotate-180" : ""}`} />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <Field label="Глубина MD" value={well.md} onChange={v => { setWell(w => ({ ...w, md: num(v) })); markDirty(); }} unit="м" hint="Measured Depth — длина ствола по стволу скважины (по бурению)" />
                    <Field label="Глубина TVD" value={well.tvd} onChange={v => { setWell(w => ({ ...w, tvd: num(v) })); markDirty(); }} unit="м" hint="True Vertical Depth — истинная вертикальная глубина. Используется для расчёта гидростатики" />
                    <Field label="Вн. ∅ колонны" value={well.casingID} onChange={v => { setWell(w => ({ ...w, casingID: num(v) })); markDirty(); }} unit="мм" hint="Внутренний диаметр последней эксплуатационной колонны на забое" />
                    <Field label="НКТ ID (0=нет)" value={well.tubingID} onChange={v => { setWell(w => ({ ...w, tubingID: num(v) })); markDirty(); }} unit="мм" hint="Внутренний диаметр НКТ. Введите 0, если спуск без НКТ (через колонну)" />
                    <Field label="Устьевое давление" value={well.wellheadPressure} onChange={v => { setWell(w => ({ ...w, wellheadPressure: num(v) })); markDirty(); }} unit="МПа" hint="Давление на устье (СУСГ/буферное) в момент работ" />
                    <Field label="Коэфф. трения" value={friction} onChange={v => { setFriction(num(v)); markDirty(); }} unit="" hint="Коэф. трения металл-металл по Johancsik. Сух: 0.30–0.35; в РЖ: 0.20–0.25; смазка: 0.15" />
                  </div>

                  <Separator />
                  <p className="text-xs font-medium text-muted-foreground">🌡 Температуры и ГРП</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Field label="BHST (стат.)" value={well.bhst} onChange={v => { setWell(w => ({ ...w, bhst: num(v) })); markDirty(); }} unit="°C" hint="Bottom Hole Static Temperature — статическая температура на забое (геотермический градиент)" />
                    <Field label="BHCT (цирк.)" value={well.bhct} onChange={v => { setWell(w => ({ ...w, bhct: num(v) })); markDirty(); }} unit="°C" hint="Bottom Hole Circulating Temperature — температура на забое при циркуляции (обычно ниже BHST)" />
                    <Field label="T° на устье" value={well.whTemp} onChange={v => { setWell(w => ({ ...w, whTemp: num(v) })); markDirty(); }} unit="°C" hint="Температура флюида на устье — для расчёта термического профиля по стволу" />
                    <Field label="Градиент ГРП" value={well.fracGradient} onChange={v => { setWell(w => ({ ...w, fracGradient: num(v) })); markDirty(); }} unit="МПа/м" hint="Градиент давления разрыва пласта. Типично 0.016–0.022 МПа/м. Ограничивает рабочее давление" />
                  </div>
                  {well.fracGradient > 0 && well.tvd > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      Давление ГРП на TVD: <strong>{(well.fracGradient * well.tvd).toFixed(1)} МПа</strong>
                    </p>
                  )}

                  <Separator />
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">📐 Инклинометрия</p>
                    <div className="flex gap-1">
                      <label className="text-[10px] text-primary hover:underline cursor-pointer px-2 py-1 border border-border rounded">
                        📥 Excel
                        <input type="file" accept=".xlsx,.xls" className="hidden" onChange={importExcel} />
                      </label>
                      <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={addTrajPoint}><Plus className="w-3 h-3 mr-0.5" /> точка</Button>
                      <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={recalcTVD}>📐 TVD</Button>
                    </div>
                  </div>
                  <div className="max-h-40 overflow-auto text-[10px]">
                    <table className="w-full">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th className="px-1 text-left">MD, м</th>
                          <th className="px-1 text-left">Азимут, °</th>
                          <th className="px-1 text-left">Зенит, °</th>
                          <th className="px-1 text-left">TVD, м</th>
                          <th className="w-6"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {trajPoints.map((p, i) => (
                          <tr key={i}>
                            <td><BlurInput type="number" className="h-6 text-[10px] w-16" value={p.md || ""} onValueCommit={v => updateTrajPoint(i, "md", v)} /></td>
                            <td><BlurInput type="number" className="h-6 text-[10px] w-16" value={p.azimuth || ""} onValueCommit={v => updateTrajPoint(i, "azimuth", v)} /></td>
                            <td><BlurInput type="number" className="h-6 text-[10px] w-16" value={p.zenith || ""} onValueCommit={v => updateTrajPoint(i, "zenith", v)} /></td>
                            <td className="text-center text-muted-foreground">{p.tvd?.toFixed(1)}</td>
                            <td>{trajPoints.length > 1 && <button className="text-destructive text-[10px]" onClick={() => removeTrajPoint(i)}>✕</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* 💧 Fluid */}
          <Collapsible open={openSections.fluid} onOpenChange={() => toggle("fluid")}>
            <Card>
              <CollapsibleTrigger className="w-full">
                <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm">💧 Рабочая жидкость</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">{fluid.name} · {fluid.density} г/см³</Badge>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.fluid ? "rotate-180" : ""}`} />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Тип жидкости</Label>
                    <Select onValueChange={v => {
                      const p = FLUID_PRESETS.find(x => x.label === v);
                      if (p) { setFluid(p.data); markDirty(); }
                    }}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Выбрать из справочника..." /></SelectTrigger>
                      <SelectContent>{FLUID_PRESETS.map(p => <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <Field label="Плотность" value={fluid.density} onChange={v => { setFluid(f => ({ ...f, density: num(v) })); markDirty(); }} unit="г/см³" hint="Плотность рабочей жидкости. Вода = 1.00; солевые растворы 1.05–1.40; нефть 0.80–0.92" />
                    <Field label="PV (пласт. вязк.)" value={fluid.pv} onChange={v => { setFluid(f => ({ ...f, pv: num(v) })); markDirty(); }} unit="сП" hint="Plastic Viscosity — пластическая вязкость по Бингаму (наклон τ−γ при высоких γ)" />
                    <Field label="YP (ДНС)" value={fluid.yp} onChange={v => { setFluid(f => ({ ...f, yp: num(v) })); markDirty(); }} unit="Па" hint="Yield Point (динамическое напряжение сдвига) — отсечка τ при γ=0 по Бингаму" />
                    <Field label="n (индекс потока)" value={fluid.nIndex} onChange={v => { setFluid(f => ({ ...f, nIndex: num(v) })); markDirty(); }} unit="" hint="Показатель степени по степенной модели. n=1 ньютоновская; <1 псевдопластичная (большинство буровых)" />
                    <Field label="K (конс. индекс)" value={fluid.kIndex} onChange={v => { setFluid(f => ({ ...f, kIndex: num(v) })); markDirty(); }} unit="Па·сⁿ" hint="Коэффициент консистенции степенной модели (K в τ = K·γⁿ)" />
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* ⚙️ Pump & Tools */}
          <Collapsible open={openSections.pump} onOpenChange={() => toggle("pump")}>
            <Card>
              <CollapsibleTrigger className="w-full">
                <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm">⚙️ Насос и инструмент (КНБК)</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">Q={pump.flowRate} л/с · КНБК {tools.bhaWeight} кг</Badge>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.pump ? "rotate-180" : ""}`} />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <Field label="Расход" value={pump.flowRate} onChange={v => { setPump(p => ({ ...p, flowRate: num(v) })); markDirty(); }} unit="л/с" hint="Производительность насоса по жидкости. Типично для ГНКТ: 1–6 л/с" />
                    <Field label="Вес КНБК" value={tools.bhaWeight} onChange={v => { setTools(t => ({ ...t, bhaWeight: num(v) })); markDirty(); }} unit="кг" hint="Сухой вес компоновки низа (BHA): забойный двигатель, долото, переводники" />
                    <Field label="Длина КНБК" value={tools.bhaLength} onChange={v => { setTools(t => ({ ...t, bhaLength: num(v) })); markDirty(); }} unit="м" hint="Суммарная длина компоновки низа. Влияет на проходимость в искривлённых участках" />
                    <Field label="Ø КНБК" value={tools.bhaOD} onChange={v => { setTools(t => ({ ...t, bhaOD: num(v) })); markDirty(); }} unit="мм" hint="Максимальный наружный диаметр инструмента — определяет зазор и пассируемость" />
                    <Field label="Ø насадки" value={tools.nozzleDiam} onChange={v => { setTools(t => ({ ...t, nozzleDiam: num(v) })); markDirty(); }} unit="мм" hint="Диаметр одного сопла промывочной насадки/долота" />
                    <Field label="Кол-во насадок" value={tools.nozzleCount} onChange={v => { setTools(t => ({ ...t, nozzleCount: num(v) })); markDirty(); }} unit="шт" hint="Число рабочих сопел. Вместе с Ø определяет перепад на насадках" />
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* 🏗 Surface equipment */}
          <Collapsible open={openSections.surface} onOpenChange={() => toggle("surface")}>
            <Card>
              <CollapsibleTrigger className="w-full">
                <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm">🏗 Наземное оборудование и условия</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">инжектор {surface.injectorPullKN ?? CT_SURFACE_DEFAULTS.injectorPullKN}/{surface.injectorSnubKN ?? CT_SURFACE_DEFAULTS.injectorSnubKN} кН</Badge>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.surface ? "rotate-180" : ""}`} />
                  </div>
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {([
                      ["injectorPullKN", "Тяга инжектора (подъём)", "кН", "Максимальное тяговое усилие инжектора. Типично 180–360 кН (40–80 тыс. фунтов)"],
                      ["injectorSnubKN", "Усилие проталкивания", "кН", "Максимальное усилие, с которым инжектор толкает трубу вниз (снаббинг). Обычно ~50% от тяги"],
                      ["stripperFrictionKN", "Трение в уплотнителе", "кН", "Трение трубы в уплотнителе (стриппере). 0 — авто: 2 кН + 15% силы давления устья"],
                      ["reelBackTensionKN", "Натяжение барабана", "кН", "Натяжение трубы со стороны барабана — добавляется к требуемой тяге инжектора. Типично 2–9 кН"],
                      ["tubingShoeMD", "Башмак НКТ (MD)", "м", "Глубина башмака НКТ. Ниже — затрубье по эксплуатационной колонне. 0 — НКТ на всю глубину"],
                      ["frictionReducerPct", "Снижатель трения", "%", "Снижение турбулентного трения жидкости в ГНКТ добавкой (ПАА и т.п.). Типично 50–70%; в навитой части эффект ~на 30% меньше"],
                      ["surfaceLineM", "Наземные линии", "м", "Длина нагнетательных линий от насоса до барабана"],
                      ["wallLossPct", "Износ стенки", "%", "Утонение стенки (износ, коррозия, минусовой допуск) — снижает давления разрыва и смятия и предел текучести на растяжение"],
                      ["hydFrictionFactor", "Поправка потерь давления", "×", "Множитель потерь на трение по калибровке с фактом (вкладка «Факт»). 1 — без поправки"],
                    ] as [keyof CTSurfaceOptions, string, string, string][]).map(([k, label, unit, hint]) => (
                      <Field key={k} label={label} unit={unit} hint={hint}
                        value={(surface[k] as number | undefined) ?? ((CT_SURFACE_DEFAULTS as Record<string, number>)[k] ?? 0)}
                        onChange={(v) => { const x = v.trim() === "" ? undefined : num(v); setSurface((o) => ({ ...o, [k]: x })); markDirty(); }} />
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Давление на устье берётся из «Данных скважины»: оно выталкивает трубу с силой P·A наружн. и учитывается в индикаторе веса. Диаметр барабана — из настроек усталости.</p>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* 🔄 Fatigue settings */}
          <Collapsible open={openSections.fatigue} onOpenChange={() => toggle("fatigue")}>
            <Card>
              <CollapsibleTrigger className="w-full">
                <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm">🔄 Усталость (CoilLIFE)</CardTitle>
                  <ChevronDown className={`w-4 h-4 transition-transform ${openSections.fatigue ? "rotate-180" : ""}`} />
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="pt-0 space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Размер барабана</Label>
                      <Select value={reelSize} onValueChange={v => { setReelSize(v as any); markDirty(); }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="small">Малый (1.37 м)</SelectItem>
                          <SelectItem value="medium">Средний (1.83 м)</SelectItem>
                          <SelectItem value="large">Большой (2.44 м)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Field label="Выполнено рейсов" value={prevTrips} onChange={v => { setPrevTrips(num(v)); markDirty(); }} unit="" hint="Если журнал трубы не ведётся. Подробный учёт по длине трубы — вкладка «Усталость»" />
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* ══════════════════ RESULTS ══════════════════ */}
          {!calculated ? (
            <Card className="flex flex-col items-center justify-center py-16 text-center">
              <Calculator className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-sm">Заполните входные данные и нажмите <strong>РАСЧЁТ</strong></p>
              <Button onClick={runCalculation} className="mt-4 gap-1.5">
                <Calculator className="w-4 h-4" /> Рассчитать
              </Button>
            </Card>
          ) : forces && limits && hydraulics && fatigue && (
            <Tabs value={tab} onValueChange={setTab}>
              <div className="overflow-x-auto scrollbar-hide mb-3">
                <TabsList className="inline-flex min-w-max w-full sm:w-full sm:grid sm:grid-cols-[repeat(13,minmax(0,1fr))]">
                  <TabsTrigger value="summary" className="gap-1 text-xs whitespace-nowrap">📋 Сводка</TabsTrigger>
                  <TabsTrigger value="forces" className="gap-1 text-xs whitespace-nowrap">⚡ Дохождение</TabsTrigger>
                  <TabsTrigger value="reach" className="gap-1 text-xs whitespace-nowrap">🎯 Reach</TabsTrigger>
                  <TabsTrigger value="trip" className="gap-1 text-xs whitespace-nowrap">🎬 СПО</TabsTrigger>
                  <TabsTrigger value="actual" className="gap-1 text-xs whitespace-nowrap">📈 Факт</TabsTrigger>
                  <TabsTrigger value="cleanout" className="gap-1 text-xs whitespace-nowrap">🧹 Промывка</TabsTrigger>
                  <TabsTrigger value="n2" className="gap-1 text-xs whitespace-nowrap">💨 N₂ Освоение</TabsTrigger>
                  <TabsTrigger value="acid" className="gap-1 text-xs whitespace-nowrap">🧪 Кислота</TabsTrigger>
                  <TabsTrigger value="limits" className="gap-1 text-xs whitespace-nowrap">🛡 Пределы</TabsTrigger>
                  <TabsTrigger value="hydraulics" className="gap-1 text-xs whitespace-nowrap">💧 Гидравлика</TabsTrigger>
                  <TabsTrigger value="tempering" className="gap-1 text-xs whitespace-nowrap">🌡 Темперирование</TabsTrigger>
                  <TabsTrigger value="fatigue" className="gap-1 text-xs whitespace-nowrap">🔄 Усталость</TabsTrigger>
                  <TabsTrigger value="3d" className="gap-1 text-xs whitespace-nowrap">🌐 3D</TabsTrigger>
                </TabsList>
              </div>
              {/* Summary */}
              <TabsContent value="summary" forceMount className={tab !== "summary" ? "hidden" : ""}>
                <CTOperationSummary
                  operationType={operationType}
                  ct={ct} well={wellWithTraj} fluid={fluid} pump={pump}
                  forces={forces} fatigue={fatigue} risks={risks}
                />
              </TabsContent>

              {/* Forces */}
              <TabsContent value="forces" forceMount className={tab !== "forces" ? "hidden" : ""}>
                <Card>
                  <CardHeader className="py-3 px-4 flex-row items-center justify-between">
                    <CardTitle className="text-sm">⚡ График дохождения ГНКТ</CardTitle>
                    <CopyImageButton targetRef={hookLoadChartRef} label="📋" />
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <div className="grid gap-x-6 sm:grid-cols-2">
                      <div>
                        <Num label="Вес в воздухе (ГНКТ + КНБК)" value={forces.weightInAir.toFixed(1)} unit="кН" />
                        <Num label="Вес в жидкости" value={forces.weightInFluid.toFixed(1)} unit="кН" />
                        <Num label="Выталкивание давлением устья (P·A)" value={`−${forces.pressureAreaForce.toFixed(1)}`} unit="кН" />
                        <Num label="Трение в уплотнителе" value={`±${forces.stripperFriction.toFixed(1)}`} unit="кН" />
                        <Num label="Сила трения в стволе (спуск / подъём)" value={`${forces.dragForceRIH.toFixed(1)} / ${forces.dragForcePOOH.toFixed(1)}`} unit="кН" />
                      </div>
                      <div>
                        <Num label="Индикатор веса на забое — спуск" value={forces.rihLocked ? "запирание" : forces.surfaceLoadRIH.toFixed(1)} unit={forces.rihLocked ? "" : "кН"} warn={forces.rihLocked || forces.surfaceLoadRIH < 0} />
                        <Num label="Индикатор веса на забое — подъём" value={forces.surfaceLoadPOOH.toFixed(1)} unit="кН" warn={forces.maxPullRequired > forces.injectorPullKN * 0.9} />
                        <Num label="Индикатор веса — без движения" value={forces.surfaceLoadStatic.toFixed(1)} unit="кН" />
                        <Num label="Проталкивание: макс. требуемое / инжектор" value={`${forces.maxSnubRequired.toFixed(1)} / ${forces.injectorSnubKN.toFixed(0)}`} unit="кН" warn={forces.maxSnubRequired > forces.injectorSnubKN} />
                        <Num label="Тяга: макс. требуемая / инжектор" value={`${forces.maxPullRequired.toFixed(1)} / ${forces.injectorPullKN.toFixed(0)}`} unit="кН" warn={forces.maxPullRequired > forces.injectorPullKN * 0.9} />
                      </div>
                    </div>
                    <div className="border-t border-border my-2" />
                    <div className="grid gap-x-6 sm:grid-cols-2">
                      <div>
                        <Num label="Глубина запирания" value={forces.lockUpDepth > 0 ? `${forces.lockUpDepth.toFixed(0)} м · ${forces.lockUpReason === "injector" ? "не хватает проталкивания" : "спиральный изгиб"}` : "нет — доходит"} warn={forces.lockUpDepth > 0} />
                        <Num label="Глубина равновесия (выше — проталкивание)" value={forces.pipeLightDepth > 0 ? forces.pipeLightDepth.toFixed(0) : "—"} unit={forces.pipeLightDepth > 0 ? "м" : ""} />
                        <Num label="Спиральный изгиб при спуске" value={forces.helicalZone ? `${forces.helicalZone[0]}–${forces.helicalZone[1]} м` : "нет"} warn={!!forces.helicalZone} />
                      </div>
                      <div>
                        <Num label="Нагрузка на забой: макс. (полное проталкивание)" value={forces.wobMaxAtTD.toFixed(1)} unit="кН" />
                        <Num label="Нагрузка на забой без проталкивания" value={forces.wobNoSnubAtTD.toFixed(1)} unit="кН" />
                        <Num label="Пределы изгиба на забое: синус. / спир." value={`${forces.sinusoidalBucklingLoad.toFixed(1)} / ${forces.helicalBucklingLoad.toFixed(1)}`} unit="кН" />
                      </div>
                    </div>

                    {/* Weight indicator vs depth */}
                    <div ref={hookLoadChartRef} className="mt-4 bg-card rounded-lg p-2">
                      <p className="text-xs font-semibold text-center mb-1">📊 Индикатор веса при спуске и подъёме vs глубина КНБК</p>
                      <p className="text-[10px] text-muted-foreground text-center mb-1">μ = {friction} · давление устья {well.wellheadPressure} МПа · отрицательные значения — труба проталкивается инжектором</p>
                      <div className="overflow-x-auto -mx-2 px-2">
                        <div className="min-w-[560px]">
                          <ResponsiveContainer width="100%" height={420}>
                            <LineChart layout="vertical" data={hookLoadData.map((p) => ({ ...p, hookRIH: p.hookRIH_kN, hookPOOH: p.hookPOOH_kN, hookStatic: p.hookStatic_kN, snub: -forces.injectorSnubKN, pull: forces.injectorPullKN }))} margin={{ top: 20, right: 20, bottom: 5, left: 20 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <YAxis dataKey="depth" type="number" domain={[0, "dataMax"]}
                                label={{ value: "Глубина КНБК, м", angle: -90, position: "insideLeft", offset: -5, style: { fontSize: 10 } }}
                                tick={{ fontSize: 10 }} />
                              <XAxis type="number" orientation="top" domain={[(min: number) => Math.floor(Math.min(min, -forces.injectorSnubKN * 1.05) / 20) * 20, (max: number) => Math.ceil(max * 1.1 / 20) * 20]} allowDataOverflow tickCount={8}
                                label={{ value: "Индикатор веса, кН", position: "insideTop", offset: -18, style: { fontSize: 10 } }}
                                tick={{ fontSize: 10 }} />
                              <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)} кН`)} labelFormatter={(d) => `КНБК на ${d} м`} />
                              <Legend wrapperStyle={{ fontSize: 10 }} />
                              <Line type="monotone" dataKey="hookPOOH" name="Подъём" stroke="#ef4444" strokeWidth={2.5} dot={false} />
                              <Line type="monotone" dataKey="hookRIH" name="Спуск" stroke="#3b82f6" strokeWidth={2.5} dot={false} connectNulls={false} />
                              <Line type="monotone" dataKey="hookStatic" name="Без движения" stroke="#64748b" strokeWidth={1.2} strokeDasharray="4 3" dot={false} />
                              <Line type="monotone" dataKey="snub" name={`Проталкивание инжектора (−${forces.injectorSnubKN} кН)`} stroke="#a855f7" strokeWidth={1.2} strokeDasharray="7 4" dot={false} />
                              <ReferenceLine x={0} stroke="hsl(var(--foreground))" strokeWidth={1} />
                              {forces.lockUpDepth > 0 && <ReferenceLine y={forces.lockUpDepth} stroke="#dc2626" strokeDasharray="6 3" label={{ value: `запирание ${forces.lockUpDepth} м`, position: "insideBottomRight", style: { fontSize: 10, fill: "#dc2626" } }} />}
                              {forces.pipeLightDepth > 0 && <ReferenceLine y={forces.pipeLightDepth} stroke="#a855f7" strokeDasharray="3 3" label={{ value: `равновесие ${forces.pipeLightDepth} м`, position: "insideTopRight", style: { fontSize: 10, fill: "#a855f7" } }} />}
                            </LineChart>
                          </ResponsiveContainer>
                          <p className="text-[10px] text-muted-foreground text-center mt-1 italic">
                            {forces.lockUpDepth > 0 ? `🔒 Спуск невозможен ниже ${forces.lockUpDepth} м` : "✅ ГНКТ доходит до полной глубины"} · индикатор веса = вес в жидкости ± трение − давление устья × площадь ± трение в уплотнителе
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Available WOB */}
                    <div className="mt-4 bg-card rounded-lg p-2">
                      <p className="text-xs font-semibold text-center mb-1">🎯 Доступная нагрузка на забой (фрезерование, посадка, разгрузка) vs глубина</p>
                      <div className="overflow-x-auto -mx-2 px-2">
                        <div className="min-w-[560px]">
                          <ResponsiveContainer width="100%" height={260}>
                            <LineChart data={hookLoadData} margin={{ top: 10, right: 20, bottom: 22, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="depth" type="number" tick={{ fontSize: 10 }} label={{ value: "Глубина КНБК, м", position: "insideBottom", offset: -4, style: { fontSize: 10 } }} />
                              <YAxis tick={{ fontSize: 10 }} label={{ value: "кН", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                              <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => `${Number(v).toFixed(1)} кН`} labelFormatter={(d) => `${d} м`} />
                              <Legend wrapperStyle={{ fontSize: 10 }} />
                              <Line type="monotone" dataKey="wobMax_kN" name={`При полном проталкивании (${forces.injectorSnubKN} кН)`} stroke="#16a34a" strokeWidth={2} dot={false} />
                              <Line type="monotone" dataKey="wobNoSnub_kN" name="Без проталкивания (разгрузка веса)" stroke="#0ea5e9" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>

                    {/* Axial load distribution (internal profile) */}
                    <div ref={forcesChartRef} className="mt-4 bg-card rounded-lg p-2">
                      <p className="text-xs font-semibold text-center mb-1">📊 Эффективная осевая сила по стволу (КНБК на {forces.lockUpDepth > 0 ? `${Math.round(forces.lockUpDepth * 0.97)} м, перед запиранием` : "полной глубине"})</p>
                      <p className="text-[10px] text-muted-foreground text-center mb-1">Сжатие левее пунктира синусоидального изгиба — труба изогнута синусоидой; левее спирального — спиралью, прижатие к стенке и трение быстро растут</p>
                      <div className="overflow-x-auto -mx-2 px-2">
                        <div className="min-w-[560px]">
                          <ResponsiveContainer width="100%" height={340}>
                            <LineChart layout="vertical" data={forceProfile} margin={{ top: 20, right: 20, bottom: 5, left: 20 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <YAxis dataKey="depth" type="number" domain={[0, "dataMax"]}
                                label={{ value: "Глубина, м", angle: -90, position: "insideLeft", offset: -5, style: { fontSize: 10 } }}
                                tick={{ fontSize: 10 }} />
                              <XAxis type="number" orientation="top" domain={[(min: number) => Math.floor(Math.max(min, -forces.injectorSnubKN * 1.5) / 20) * 20, (max: number) => Math.ceil(max / 20) * 20]} allowDataOverflow tickCount={8}
                                label={{ value: "кН (+ растяжение, − сжатие)", position: "insideTop", offset: -18, style: { fontSize: 10 } }}
                                tick={{ fontSize: 10 }} />
                              <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)} кН`)} />
                              <Legend wrapperStyle={{ fontSize: 10 }} />
                              <Line type="monotone" dataKey="axialPOOH" name="Подъём" stroke="#ef4444" strokeWidth={2} dot={false} />
                              <Line type="monotone" dataKey="axialRIH" name="Спуск" stroke="#3b82f6" strokeWidth={2} dot={false} />
                              <Line type="monotone" dataKey="bucklingLimit" name="Синусоидальный изгиб" stroke="#f59e0b" strokeWidth={1.3} strokeDasharray="6 3" dot={false} />
                              <Line type="monotone" dataKey="helicalLimit" name="Спиральный изгиб" stroke="#dc2626" strokeWidth={1.3} strokeDasharray="3 3" dot={false} />
                              <ReferenceLine x={0} stroke="hsl(var(--foreground))" strokeWidth={0.5} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Модель: «мягкая нить» в эффективных силах с кривизной ствола по зениту и азимуту; при сжатии выше критических сил (Досон–Паслей, Лубинский, Чен–Чиатем)
                      учитывается дополнительное прижатие изогнутой трубы к стенке (Митчелл). Индикатор веса включает выталкивание давлением устья и трение в уплотнителе.
                      Коэффициент трения калибруйте по фактическим показаниям индикатора веса.
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Reach Analysis */}
              <TabsContent value="reach" forceMount className={tab !== "reach" ? "hidden" : ""}>
                <CTReachAnalysisTab
                  ct={ct}
                  well={wellWithTraj}
                  surface={surfaceOpts}
                  fluid={fluid}
                  tools={tools}
                  sections={ctSections}
                  baselineFriction={friction}
                />
              </TabsContent>

              {/* СПО Simulator */}
              <TabsContent value="trip" forceMount className={tab !== "trip" ? "hidden" : ""}>
                {calculated && forces && hookLoadData.length > 0 ? (
                  <CTTripSimulator
                    hookLoadData={hookLoadData}
                    forceProfile={forceProfile}
                    totalDepthMD={well.md}
                    lockUpDepth={forces.lockUpDepth ?? 0}
                    helicalBucklingLoad={forces.helicalBucklingLoad ?? 0}
                    injectorPullCapacity={forces.injectorPullKN}
                    injectorSnubCapacity={forces.injectorSnubKN}
                  />
                ) : (
                  <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Запустите расчёт, чтобы построить симулятор СПО.</CardContent></Card>
                )}
              </TabsContent>

              {/* Actual vs model */}
              <TabsContent value="actual" forceMount className={tab !== "actual" ? "hidden" : ""}>
                {tab === "actual" && (
                  <CTActualMatchTab
                    ct={ct} well={wellWithTraj} fluid={fluid} tools={tools}
                    sections={ctSections.length > 0 ? ctSections : undefined} opts={surfaceOpts}
                    friction={friction} data={actualData} onData={setActualData}
                    onApplyFriction={(mu) => { setFriction(mu); markDirty(); }}
                    onApplyHydFactor={(k) => { setSurface((o) => ({ ...o, hydFrictionFactor: k })); markDirty(); }}
                  />
                )}
              </TabsContent>

              {/* Cleanout (wellbore wash) */}
              <TabsContent value="cleanout" forceMount className={tab !== "cleanout" ? "hidden" : ""}>
                <CTCleanoutTab ct={ct} well={well} fluid={fluid} pump={pump} operationType={operationType} />
              </TabsContent>

              {/* N₂ Kickoff (nitrogen well unloading) */}
              <TabsContent value="n2" forceMount className={tab !== "n2" ? "hidden" : ""}>
                <CTNitrogenKickoffTab ct={ct} well={well} fluid={fluid} operationType={operationType} />
              </TabsContent>

              {/* Acid stimulation */}
              <TabsContent value="acid" forceMount className={tab !== "acid" ? "hidden" : ""}>
                <CTAcidStimTab ct={ct} well={well} pump={pump} operationType={operationType} />
              </TabsContent>

              {/* Limits */}
              <TabsContent value="limits" forceMount className={tab !== "limits" ? "hidden" : ""}>
                <Card>
                  <CardHeader className="py-3 px-4 flex-row items-center justify-between">
                    <CardTitle className="text-sm">🛡 CoilLIMIT — Пределы</CardTitle>
                    <CopyImageButton targetRef={limitsChartRef} label="📋" />
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <div className="grid gap-x-6 sm:grid-cols-2">
                      <div>
                        <Num label="Мин. толщина стенки (с износом)" value={limits.minWall.toFixed(2)} unit="мм" />
                        <Num label="Давление разрыва (API RP 5C7)" value={limits.burstPressure.toFixed(1)} unit="МПа" />
                        <Num label="Макс. рабочее давление (80%)" value={limits.maxWorkingPressure.toFixed(1)} unit="МПа" warn={hydraulics.pumpPressure > limits.maxWorkingPressure} />
                        <Num label="Давление насоса при работе" value={hydraulics.pumpPressure.toFixed(1)} unit="МПа" warn={hydraulics.pumpPressure > limits.maxWorkingPressure} />
                        <Num label="Предел текучести (растяжение)" value={limits.yieldTension.toFixed(1)} unit="кН" />
                        <Num label="Макс. раб. натяжение (80%)" value={limits.maxWorkingTension.toFixed(1)} unit="кН" />
                      </div>
                      <div>
                        <Num label="Смятие круглой трубы" value={limits.collapsePressure.toFixed(1)} unit="МПа" />
                        <Num label={`Смятие с овальностью ${ct.ovality}% (Тимошенко)`} value={limits.collapseWithOvality.toFixed(1)} unit="МПа" warn={limits.collapseWithOvality < well.wellheadPressure * 1.25} />
                        <Num label="То же при натяжении подъёма" value={limits.collapseAtLoad.toFixed(1)} unit="МПа" warn={limits.collapseAtLoad < well.wellheadPressure * 1.25} />
                        <Num label="Характер смятия" value={limits.collapseRegime} />
                        <Num label="Мизес на устье (σ_экв / σ_т)" value={limits.vonMisesRatio.toFixed(3)} warn={limits.vonMisesRatio >= 0.8} />
                      </div>
                    </div>

                    <div ref={limitsChartRef} className="mt-4 bg-card rounded-lg p-2">
                      <p className="text-xs font-semibold text-center mb-1">📊 Диаграмма допустимых нагрузок: перепад давления × осевая сила</p>
                      <p className="text-[10px] text-muted-foreground text-center mb-1">Сплошные — предел (Мизес 100%, смятие с овальностью), пунктир — рабочий предел 80%. Линии спуска и подъёма — фактические нагрузки по стволу при циркуляции; ★ — труба на барабане.</p>
                      <div className="overflow-x-auto -mx-2 px-2">
                        <div className="min-w-[560px]">
                          <ResponsiveContainer width="100%" height={380}>
                            <ScatterChart margin={{ top: 10, right: 20, bottom: 18, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis type="number" dataKey="x" name="Осевая сила" unit=" кН" tick={{ fontSize: 10 }} domain={["dataMin", "dataMax"]}
                                label={{ value: "Осевая сила, кН (+ растяжение)", position: "insideBottom", offset: -10, style: { fontSize: 10 } }} />
                              <YAxis type="number" dataKey="y" name="Перепад" unit=" МПа" tick={{ fontSize: 10 }}
                                label={{ value: "Перепад давления (внутр. − наруж.), МПа", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                              <ZAxis range={[10, 10]} />
                              <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number) => Number(v).toFixed(1)} />
                              <Legend wrapperStyle={{ fontSize: 10 }} verticalAlign="top" />
                              <Scatter name="Разрыв (предел)" data={envelopeChart.map((r) => ({ x: r.axialLoad, y: r.burstLimit }))} fill="#2563eb" line={{ stroke: "#2563eb", strokeWidth: 2 }} shape={() => null} legendType="line" />
                              <Scatter name="Смятие (предел)" data={envelopeChart.map((r) => ({ x: r.axialLoad, y: r.collapseLimit }))} fill="#7c3aed" line={{ stroke: "#7c3aed", strokeWidth: 2 }} shape={() => null} legendType="line" />
                              <Scatter name="Рабочий предел 80%" data={envelopeChart.map((r) => ({ x: r.axialLoad, y: r.burstWork }))} fill="#94a3b8" line={{ stroke: "#94a3b8", strokeWidth: 1.2, strokeDasharray: "5 4" }} shape={() => null} legendType="plainline" />
                              <Scatter name="" data={envelopeChart.map((r) => ({ x: r.axialLoad, y: r.collapseWork }))} fill="#94a3b8" line={{ stroke: "#94a3b8", strokeWidth: 1.2, strokeDasharray: "5 4" }} shape={() => null} legendType="none" />
                              {operatingPath && <Scatter name="Спуск (по стволу)" data={operatingPath.rih.map((p) => ({ x: p.axialLoad, y: p.dp, md: p.md }))} fill="#0ea5e9" line={{ stroke: "#0ea5e9", strokeWidth: 2 }} shape="circle" legendType="line" />}
                              {operatingPath && <Scatter name="Подъём (по стволу)" data={operatingPath.pooh.map((p) => ({ x: p.axialLoad, y: p.dp, md: p.md }))} fill="#ef4444" line={{ stroke: "#ef4444", strokeWidth: 2 }} shape="circle" legendType="line" />}
                              {operatingPath && <Scatter name="На барабане" data={[{ x: operatingPath.pooh[0].axialLoad, y: operatingPath.pooh[0].dp }]} fill="#f59e0b" shape="star" legendType="star" />}
                              <ReferenceLine y={0} stroke="hsl(var(--foreground))" strokeWidth={0.5} />
                              <ReferenceLine x={0} stroke="hsl(var(--foreground))" strokeWidth={0.5} />
                            </ScatterChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      API RP 5C7: разрыв — по Барлоу с минимальной толщиной стенки; смятие — по Тимошенко с учётом овальности (упругая и пластическая составляющие),
                      осевое натяжение снижает сопротивление смятию (API 5C3); эквивалентные напряжения — по Мизесу с распределением по Ламе. Температурное снижение прочности — на вкладке «Темперирование».
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Hydraulics */}
              <TabsContent value="hydraulics" forceMount className={tab !== "hydraulics" ? "hidden" : ""}>
                <Card>
                  <CardHeader className="py-3 px-4 flex-row items-center justify-between">
                    <CardTitle className="text-sm">💧 Гидравлика циркуляции</CardTitle>
                    <CopyImageButton targetRef={hydraulicsChartRef} label="📋" />
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <p className="text-[11px] text-muted-foreground px-2">Реология: {hydraulics.rheologyModel}{(surface.frictionReducerPct ?? 0) > 0 ? ` · снижатель трения ${surface.frictionReducerPct}%` : ""}</p>
                    {hydraulics.warnings.map((w) => <p key={w} className="text-[11px] text-amber-600 px-2">⚠ {w}</p>)}
                    <div className="grid gap-x-6 sm:grid-cols-2">
                      <div>
                        <Num label="Давление насоса" value={hydraulics.pumpPressure.toFixed(2)} unit="МПа" warn={hydraulics.pumpPressure > limits.maxWorkingPressure} />
                        <Num label="ΔP в спущенной части ГНКТ" value={hydraulics.dpCTDeployed.toFixed(2)} unit="МПа" />
                        <Num label={`ΔP на барабане (${hydraulics.reelLengthM} м навито) + линии`} value={(hydraulics.dpReel + hydraulics.dpLines).toFixed(2)} unit="МПа" />
                        <Num label="ΔP на насадках" value={hydraulics.dpNozzle.toFixed(2)} unit="МПа" />
                        <Num label="ΔP в затрубье" value={hydraulics.dpAnnulus.toFixed(2)} unit="МПа" />
                        <Num label="Устьевое давление" value={well.wellheadPressure.toFixed(2)} unit="МПа" />
                      </div>
                      <div>
                        <Num label="Скорость в ГНКТ / режим" value={`${hydraulics.velocityInCT.toFixed(2)} м/с · ${hydraulics.flowRegimeCT}`} />
                        <Num label="Re в ГНКТ (обобщённое)" value={hydraulics.reynoldsInCT} />
                        <Num label="Мин. скорость в затрубье / нужно" value={`${hydraulics.velocityAnnulus.toFixed(2)} / ${hydraulics.minTransportVelocity.toFixed(2)}`} unit="м/с" warn={!hydraulics.transportOk} />
                        <Num label="ЭЦП на забое (без устьевого)" value={hydraulics.ecdAtTD.toFixed(3)} unit="г/см³" />
                        <Num label="Забойное давление при циркуляции" value={hydraulics.bhCircPressure.toFixed(2)} unit="МПа" />
                        <Num label="P заб / P ГРП" value={`${hydraulics.fracSafetyFactor.toFixed(2)} (ГРП ${hydraulics.fracPressureAtTD.toFixed(1)} МПа)`} warn={hydraulics.fracSafetyFactor >= 0.85} />
                      </div>
                    </div>
                    {hydraulics.annulusSegments.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px] mt-2">
                          <thead className="bg-muted/50"><tr><th className="p-1 text-left">Затрубье, интервал</th><th className="p-1 text-right">Ø ствола, мм</th><th className="p-1 text-right">Скорость, м/с</th><th className="p-1 text-right">Режим</th><th className="p-1 text-right">ΔP, МПа</th></tr></thead>
                          <tbody>
                            {hydraulics.annulusSegments.map((sg) => (
                              <tr key={sg.from} className="border-t border-border/40">
                                <td className="p-1">{sg.from}–{sg.to} м · {well.tubingID > 0 && sg.holeIdMm === well.tubingID ? "НКТ" : "колонна"}</td>
                                <td className="p-1 text-right">{sg.holeIdMm}</td>
                                <td className={`p-1 text-right ${sg.velocity < hydraulics.minTransportVelocity ? "text-destructive font-semibold" : ""}`}>{sg.velocity.toFixed(2)}</td>
                                <td className="p-1 text-right">{sg.regime}</td>
                                <td className="p-1 text-right">{sg.dp.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div ref={hydraulicsChartRef} className="mt-4 bg-card rounded-lg p-2">
                      <p className="text-xs font-semibold text-center mb-2">📊 Потери давления и давление насоса vs расход</p>
                      <div className="overflow-x-auto -mx-2 px-2">
                        <div className="min-w-[600px]">
                          <ResponsiveContainer width="100%" height={300}>
                            <ComposedChart data={hydraulicsCurve} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="flowRate" label={{ value: "Расход, л/с", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                              <YAxis label={{ value: "МПа", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                              <Tooltip contentStyle={{ fontSize: 11 }} />
                              <Legend wrapperStyle={{ fontSize: 10 }} />
                              <Area type="monotone" dataKey="dpCT" name="ΔP ГНКТ (в скважине)" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} />
                              <Area type="monotone" dataKey="dpReel" name="ΔP на барабане и в линиях" stackId="1" stroke="#6366f1" fill="#6366f1" fillOpacity={0.5} />
                              <Area type="monotone" dataKey="dpAnn" name="ΔP Затрубье" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.6} />
                              <Area type="monotone" dataKey="dpNozzle" name="ΔP Насадки" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.6} />
                              <Line type="monotone" dataKey="pumpPressure" name="Давление насоса (с устьевым)" stroke="#ef4444" strokeWidth={2} dot={false} />
                              <ReferenceLine x={pump.flowRate} stroke="hsl(var(--foreground))" strokeDasharray="3 3" />
                              <ReferenceLine y={limits.maxWorkingPressure} stroke="#dc2626" strokeDasharray="6 3" label={{ value: `Макс. ${limits.maxWorkingPressure.toFixed(0)} МПа`, position: "top", style: { fontSize: 9, fill: "#dc2626" } }} />
                            </ComposedChart>
                          </ResponsiveContainer>

                          <p className="text-xs font-semibold text-center mt-4 mb-2">Из чего складывается давление насоса при Q={pump.flowRate} л/с</p>
                          <ResponsiveContainer width="100%" height={120}>
                            <BarChart data={[{ name: "ΔP", whp: well.wellheadPressure, ct: hydraulics.dpCTDeployed, reel: Math.round((hydraulics.dpReel + hydraulics.dpLines) * 100) / 100, ann: hydraulics.dpAnnulus, nozzle: hydraulics.dpNozzle }]} layout="vertical" margin={{ left: 10, right: 20 }}>
                              <XAxis type="number" tick={{ fontSize: 10 }} />
                              <YAxis type="category" dataKey="name" hide />
                              <Tooltip contentStyle={{ fontSize: 11 }} />
                              <Legend wrapperStyle={{ fontSize: 10 }} />
                              <Bar dataKey="whp" name="Устьевое" stackId="a" fill="#94a3b8" />
                              <Bar dataKey="ct" name="ГНКТ в скважине" stackId="a" fill="#3b82f6" />
                              <Bar dataKey="reel" name="Барабан + линии" stackId="a" fill="#6366f1" />
                              <Bar dataKey="ann" name="Затрубье" stackId="a" fill="#10b981" />
                              <Bar dataKey="nozzle" name="Насадки" stackId="a" fill="#f59e0b" />
                            </BarChart>
                          </ResponsiveContainer>

                          {/* Temperature profile */}
                          {tempProfile.length > 0 && (
                            <div ref={tempProfileChartRef}>
                              <p className="text-xs font-semibold text-center mt-4 mb-2">🌡 Температурный профиль по стволу</p>
                              <ResponsiveContainer width="100%" height={250}>
                                <LineChart data={tempProfile} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                  <XAxis dataKey="depth" type="number" domain={[0, "dataMax"]} label={{ value: "Глубина по стволу (MD), м", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                  <YAxis label={{ value: "°C", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                  <Tooltip contentStyle={{ fontSize: 11 }} />
                                  <Legend wrapperStyle={{ fontSize: 10 }} />
                                  <Line type="monotone" dataKey="tempStatic" name="BHST (стат.)" stroke="#ef4444" strokeWidth={2} dot={false} />
                                  <Line type="monotone" dataKey="tempCirculating" name="BHCT (цирк.)" stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Tempering */}
              <TabsContent value="tempering" forceMount className={tab !== "tempering" ? "hidden" : ""}>
                <Card>
                  <CardHeader className="py-3 px-4 flex-row items-center justify-between">
                    <CardTitle className="text-sm">🌡 Темперирование — Температурная деградация</CardTitle>
                    <CopyImageButton targetRef={temperingChartRef} label="📋" />
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    {tempering && (
                      <>
                        <Num label="Номинальный предел текучести" value={tempering.nominalYield.toFixed(0)} unit="МПа" />
                        <Num label="Макс. температура трубы" value={`${tempering.maxPipeTemp}°C на ${tempering.maxPipeTempDepth} м`} />
                        <Num label="Мин. коэфф. деградации" value={tempering.minDeratingFactor.toFixed(3)} warn={tempering.minDeratingFactor < 0.85} />
                        <div className="border-t border-border my-2" />
                        <Num label="Эфф. σ_y на забое" value={tempering.effectiveYieldAtBH.toFixed(0)} unit="МПа" warn={tempering.effectiveYieldAtBH < tempering.nominalYield * 0.85} />
                        <Num label="Номинальное P разрыва" value={tempering.nominalBurst.toFixed(1)} unit="МПа" />
                        <Num label="P разрыва на забое (с деградацией)" value={tempering.burstAtBH.toFixed(1)} unit="МПа" warn={tempering.burstAtBH < tempering.nominalBurst * 0.85} />
                        <Num label="P смятия на забое (с деградацией)" value={tempering.collapseAtBH.toFixed(1)} unit="МПа" />
                        <div className="border-t border-border my-2" />
                        <Num label="Снижение прочности" value={`${((1 - tempering.minDeratingFactor) * 100).toFixed(1)}%`} warn={(1 - tempering.minDeratingFactor) > 0.1} />

                        <div ref={temperingChartRef} className="mt-4 bg-card rounded-lg p-2">
                          <p className="text-xs font-semibold text-center mb-2">📊 Температура трубы ГНКТ по глубине</p>
                          <div className="overflow-x-auto -mx-2 px-2">
                            <div className="min-w-[600px]">
                              <ResponsiveContainer width="100%" height={300}>
                                <LineChart data={tempering.profile} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                  <XAxis dataKey="depth" label={{ value: "Глубина MD, м", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                  <YAxis label={{ value: "°C", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                  <Tooltip contentStyle={{ fontSize: 11 }} />
                                  <Legend wrapperStyle={{ fontSize: 10 }} />
                                  <Line type="monotone" dataKey="formationTemp" name="T° пласта" stroke="#ef4444" strokeWidth={2} dot={false} />
                                  <Line type="monotone" dataKey="fluidInsideTemp" name="T° жидкости в CT" stroke="#3b82f6" strokeWidth={2} dot={false} />
                                  <Line type="monotone" dataKey="pipeTemp" name="T° тела трубы" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
                                  <ReferenceLine y={150} stroke="#dc2626" strokeDasharray="6 3" label={{ value: "150°C — начало деградации", position: "top", style: { fontSize: 9, fill: "#dc2626" } }} />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        </div>

                        <div ref={temperingDegradationRef} className="mt-4 bg-card rounded-lg p-2">
                          <p className="text-xs font-semibold text-center mb-2">📊 Деградация прочности по глубине</p>
                          <div className="overflow-x-auto -mx-2 px-2">
                            <div className="min-w-[600px]">
                              <ResponsiveContainer width="100%" height={280}>
                                <LineChart data={tempering.profile} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                                  <XAxis dataKey="depth" label={{ value: "Глубина MD, м", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                  <YAxis yAxisId="left" label={{ value: "МПа", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                  <YAxis yAxisId="right" orientation="right" domain={[0, 1.1]} label={{ value: "Коэфф.", angle: 90, position: "insideRight", style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                                  <Tooltip contentStyle={{ fontSize: 11 }} />
                                  <Legend wrapperStyle={{ fontSize: 10 }} />
                                  <Line yAxisId="left" type="monotone" dataKey="effectiveYield" name="Эфф. σ_y" stroke="#10b981" strokeWidth={2} dot={false} />
                                  <Line yAxisId="left" type="monotone" dataKey="burstDerated" name="P разрыва" stroke="#3b82f6" strokeWidth={2} dot={false} />
                                  <Line yAxisId="left" type="monotone" dataKey="collapseDerated" name="P смятия" stroke="#a855f7" strokeWidth={2} dot={false} />
                                  <Line yAxisId="right" type="monotone" dataKey="yieldDerating" name="Коэфф. деградации" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                                  <ReferenceLine yAxisId="right" y={0.85} stroke="#dc2626" strokeDasharray="4 4" label={{ value: "85%", position: "right", style: { fontSize: 9, fill: "#dc2626" } }} />
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        </div>

                        {tempering.minDeratingFactor < 0.90 && (
                          <p className="text-xs text-destructive mt-2">
                            ⚠️ Прочность ГНКТ снижена на {((1 - tempering.minDeratingFactor) * 100).toFixed(1)}% из-за высокой забойной температуры. Учитывайте при планировании операции!
                          </p>
                        )}
                        {tempering.minDeratingFactor >= 0.97 && (
                          <p className="text-xs text-muted-foreground mt-2">
                            ✅ Температурная деградация незначительна ({((1 - tempering.minDeratingFactor) * 100).toFixed(1)}%). Прочностные характеристики в норме.
                          </p>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* 3D Well Profile */}
              <TabsContent value="3d" forceMount className={tab !== "3d" ? "hidden" : ""}>
                {tab === "3d" && (
                  <Card className="mb-4">
                    <CardHeader className="py-3 px-4"><CardTitle className="text-sm">🌀 3D: изгиб ГНКТ в стволе и зоны риска</CardTitle></CardHeader>
                    <CardContent className="px-4 pb-4">
                      <CTBuckling3D ct={ct} well={wellWithTraj} fluid={fluid} tools={tools} sections={ctSections.length > 0 ? ctSections : undefined} opts={surfaceOpts}
                        friction={friction} forces={forces} fatigueHot={lifeHot} overviewRef={buckOverviewRef} closeupRef={buckCloseupRef} />
                    </CardContent>
                  </Card>
                )}
                <Card>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm">🌐 3D Профиль скважины</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <div ref={well3dRef}>
                      <CTWell3D trajectory={wellWithTraj.trajectory} maxMD={wellWithTraj.md} />
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center mt-2">Зажмите мышь для вращения. Колёсико — масштаб.</p>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Fatigue */}
              <TabsContent value="fatigue" forceMount className={tab !== "fatigue" ? "hidden" : ""}>
                <Card className="mb-4">
                  <CardHeader className="py-3 px-4"><CardTitle className="text-sm">🔄 CoilLIFE — ресурс за рейс при текущих условиях</CardTitle></CardHeader>
                  <CardContent className="px-4 pb-4 grid gap-x-6 sm:grid-cols-2">
                    <div>
                      <Num label="Деформация на барабане (внутр. слой)" value={fatigue.bendingStrainReel.toFixed(2)} unit="%" />
                      <Num label="Деформация на гусаке" value={fatigue.bendingStrainGuideArch.toFixed(2)} unit="%" />
                      <Num label="Давление в трубе при работе" value={hydraulics.pumpPressure.toFixed(1)} unit="МПа" />
                    </div>
                    <div>
                      <Num label="Рейсов до разрушения (худший участок)" value={fatigue.estimatedCycles} />
                      <Num label="Израсходовано ресурса" value={fatigue.fatigueLifeUsed.toFixed(1)} unit="%" warn={fatigue.fatigueLifeUsed > 60} />
                      <Num label={stringPassport.journal.length ? "Работ до отбраковки (по журналу)" : "Рейсов до отбраковки (80%)"} value={fatigue.maxSafeTrips} />
                    </div>
                  </CardContent>
                </Card>
                <CTStringLifeCard
                  passport={stringPassport}
                  onChange={(np) => { setStringPassport(np); }}
                  ct={ct}
                  currentDepthM={Math.min(well.md, ct.length)}
                  currentPressureMPa={hydraulics.pumpPressure}
                  wellLabel={`MD ${well.md} м`}
                  userId={userId}
                  chartRef={fatigueChartRef}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </main>
      <TermsFooter />
      <SaveToCabinetDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        defaultTitle={`ГНКТ ${ct.od}мм ${ct.grade} — MD ${well.md}м`}
        buildPayload={buildCTPayload}
      />
    </div>
  );
}
