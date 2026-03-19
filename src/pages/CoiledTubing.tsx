import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Send, Gauge, Shield, Droplets, Activity, ChevronDown, ChevronRight, Calculator, Save, RotateCcw, FileDown, LogOut, User, Plus, Trash2, Home, Thermometer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, AreaChart, Area, ReferenceLine, ScatterChart, Scatter, ZAxis } from "recharts";
import { BlurInput } from "@/components/BlurInput";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import {
  CTStringData, WellGeometry, FluidData, PumpData, ToolsData,
  calculateTubingForces, calculateLimits, calculateHydraulics, calculateFatigue,
  CT_PRESETS, FLUID_PRESETS, ctWeightPerMeter,
  ForceResult, LimitResult, HydraulicsResult, FatigueResult,
  generateForceDepthProfile, generateHydraulicsCurve, generateFatigueCurve, generatePressureLoadEnvelope,
  generateTempProfile,
  assessRisks, RiskItem,
  calculateTVDFromSurvey, type TrajectoryPoint,
} from "@/lib/coiled-tubing-calculations";
import { exportCTDocx } from "@/lib/export-ct-docx";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import CopyImageButton from "@/components/CopyImageButton";
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
      };
    }
  } catch {}
  return { ct: defaultCT, well: defaultWell, fluid: defaultFluid, pump: defaultPump, tools: defaultTools, friction: 0.25, reelSize: "medium", prevTrips: 0, trajPoints: defaultTraj };
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

const Field = ({ label, value, onChange, unit }: { label: string; value: number; onChange: (v: string) => void; unit?: string }) => (
  <div className="space-y-1">
    <Label className="text-xs">{label}{unit ? ` (${unit})` : ""}</Label>
    <BlurInput type="number" step="any" value={value || ""} onValueCommit={onChange} className="h-8 text-xs" />
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
  const [calculated, setCalculated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // Collapsible sections
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    ct: false, well: false, fluid: false, pump: false, fatigue: false,
  });
  const toggle = (k: string) => setOpenSections(s => ({ ...s, [k]: !s[k] }));

  // Chart refs
  const forcesChartRef = useRef<HTMLDivElement>(null);
  const limitsChartRef = useRef<HTMLDivElement>(null);
  const hydraulicsChartRef = useRef<HTMLDivElement>(null);
  const fatigueChartRef = useRef<HTMLDivElement>(null);

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
        sessionStorage.setItem(CT_SESSION_KEY, JSON.stringify({ ct, well, fluid, pump, tools, friction, reelSize, prevTrips, trajPoints }));
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [ct, well, fluid, pump, tools, friction, reelSize, prevTrips, trajPoints]);

  const markDirty = useCallback(() => setCalculated(false), []);

  // Results
  const [forces, setForces] = useState<ForceResult | null>(null);
  const [limits, setLimits] = useState<LimitResult | null>(null);
  const [hydraulics, setHydraulics] = useState<HydraulicsResult | null>(null);
  const [fatigue, setFatigue] = useState<FatigueResult | null>(null);
  const [risks, setRisks] = useState<RiskItem[]>([]);

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

    const f = calculateTubingForces(ct, wellWithTraj, fluid, tools, friction);
    const l = calculateLimits(ct, pump.surfacePressure || 0, wellWithTraj.wellheadPressure, f.surfaceLoadPOOH);
    const h = calculateHydraulics(ct, wellWithTraj, fluid, pump, tools);
    const ft = calculateFatigue(ct, reelSize, pump.surfacePressure || h.dpTotal, prevTrips);
    const r = assessRisks(f, l, h, ft, wellWithTraj);

    setForces(f);
    setLimits(l);
    setHydraulics(h);
    setFatigue(ft);
    setRisks(r);
    setCalculated(true);

    supabase.functions.invoke("log-activity", {
      body: { type: "calculation", module: "coiled-tubing", page_url: "/coiled-tubing" },
    }).catch(() => {});

    toast.success("Расчёт выполнен ✅");
  }, [ct, well, fluid, pump, tools, friction, reelSize, prevTrips, trajPoints]);

  const handleReset = useCallback(() => {
    setCT(defaultCT); setWell(defaultWell); setFluid(defaultFluid);
    setPump(defaultPump); setTools(defaultTools); setFriction(0.25);
    setReelSize("medium"); setPrevTrips(0); setCalculated(false);
    setTrajPoints(defaultTraj);
    setForces(null); setLimits(null); setHydraulics(null); setFatigue(null);
    setRisks([]);
    sessionStorage.removeItem(CT_SESSION_KEY);
    toast.info("Данные обнулены");
  }, []);

  // Save to database
  const handleSave = useCallback(async () => {
    if (!userId) { toast.error("Необходимо войти в систему"); navigate("/auth"); return; }
    if (!calculated || !forces) { toast.error("Сначала выполните расчёт"); return; }

    const { data: wells } = await supabase.from("wells").select("id, name").eq("user_id", userId).limit(100);
    if (!wells || wells.length === 0) {
      toast.error("Создайте скважину в личном кабинете");
      navigate("/dashboard");
      return;
    }

    const wellId = wells[0].id;
    const title = `ГНКТ ${ct.od}мм ${ct.grade} — MD ${well.md}м`;

    const { error } = await supabase.from("saved_calculations").upsert({
      user_id: userId,
      well_id: wellId,
      module: "coiled-tubing",
      title,
      well_data: { ct, well, fluid, pump, tools, friction, reelSize, prevTrips, trajPoints } as any,
      calc_params: { forces, limits, hydraulics, fatigue, risks } as any,
      results: { forces, limits, hydraulics, fatigue } as any,
    }, { onConflict: "id" });

    if (error) { toast.error("Ошибка сохранения"); console.error(error); }
    else toast.success("Расчёт сохранён в личном кабинете 💾");
  }, [userId, calculated, forces, limits, hydraulics, fatigue, risks, ct, well, fluid, pump, tools, friction, reelSize, prevTrips, trajPoints, navigate]);

  // Export DOCX
  const handleExportDocx = useCallback(async () => {
    if (!calculated || !forces || !limits || !hydraulics || !fatigue) {
      toast.error("Сначала выполните расчёт");
      return;
    }

    toast.info("Формирование документа...");

    const [forcesImg, limitsImg, hydraulicsImg, fatigueImg] = await Promise.all([
      captureChart(forcesChartRef),
      captureChart(limitsChartRef),
      captureChart(hydraulicsChartRef),
      captureChart(fatigueChartRef),
    ]);

    await exportCTDocx({
      ct, well, fluid, pump, tools, friction, reelSize, prevTrips,
      forces, limits, hydraulics, fatigue, risks,
      trajPoints,
      chartImages: { forces: forcesImg, limits: limitsImg, hydraulics: hydraulicsImg, fatigue: fatigueImg },
    });

    toast.success("DOCX сформирован 📄");
  }, [calculated, forces, limits, hydraulics, fatigue, risks, ct, well, fluid, pump, tools, friction, reelSize, prevTrips]);

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

  const forceProfile = useMemo(() => calculated ? generateForceDepthProfile(ct, wellWithTraj, fluid, tools, friction) : [], [calculated, ct, wellWithTraj, fluid, tools, friction]);
  const hydraulicsCurve = useMemo(() => calculated ? generateHydraulicsCurve(ct, wellWithTraj, fluid, tools) : [], [calculated, ct, wellWithTraj, fluid, tools]);
  const fatigueCurve = useMemo(() => calculated ? generateFatigueCurve(ct, reelSize, pump.surfacePressure || (hydraulics?.dpTotal ?? 0)) : [], [calculated, ct, reelSize, pump.surfacePressure, hydraulics?.dpTotal]);
  const pressureEnvelope = useMemo(() => calculated ? generatePressureLoadEnvelope(ct) : [], [calculated, ct]);
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
              {userId && (
                <>
                  <button onClick={() => navigate("/dashboard")} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                    <User className="w-4 h-4" /> <span>Кабинет</span>
                  </button>
                  <button onClick={handleLogout} className="flex items-center gap-1.5 text-muted-foreground hover:text-destructive transition-colors text-xs">
                    <LogOut className="w-4 h-4" /> <span>Выйти</span>
                  </button>
                </>
              )}
              <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs">
                <Send className="w-4 h-4" /> <span>Поддержка</span>
              </a>
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
      </header>

      <main className="flex-1 max-w-7xl mx-auto px-3 py-4 w-full">
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
                    <Field label="Нар. Ø" value={ct.od} onChange={v => { setCT(p => ({ ...p, od: num(v) })); markDirty(); }} unit="мм" />
                    <Field label="Стенка" value={ct.wall} onChange={v => { setCT(p => ({ ...p, wall: num(v) })); markDirty(); }} unit="мм" />
                    <div className="space-y-1">
                      <Label className="text-xs">Марка стали</Label>
                      <Select value={ct.grade} onValueChange={v => { setCT(p => ({ ...p, grade: v })); markDirty(); }}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["CT-70", "CT-80", "CT-90", "CT-110"].map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <Field label="Длина на барабане" value={ct.length} onChange={v => { setCT(p => ({ ...p, length: num(v) })); markDirty(); }} unit="м" />
                    <Field label="Овальность" value={ct.ovality} onChange={v => { setCT(p => ({ ...p, ovality: num(v) })); markDirty(); }} unit="%" />
                  </div>
                  <p className="text-[10px] text-muted-foreground">Вн.Ø: {(ct.od - 2 * ct.wall).toFixed(1)} мм · Вес: {linWeight.toFixed(3)} кг/м</p>
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
                    <Field label="Глубина MD" value={well.md} onChange={v => { setWell(w => ({ ...w, md: num(v) })); markDirty(); }} unit="м" />
                    <Field label="Глубина TVD" value={well.tvd} onChange={v => { setWell(w => ({ ...w, tvd: num(v) })); markDirty(); }} unit="м" />
                    <Field label="Вн. ∅ колонны" value={well.casingID} onChange={v => { setWell(w => ({ ...w, casingID: num(v) })); markDirty(); }} unit="мм" />
                    <Field label="НКТ ID (0=нет)" value={well.tubingID} onChange={v => { setWell(w => ({ ...w, tubingID: num(v) })); markDirty(); }} unit="мм" />
                    <Field label="Устьевое давление" value={well.wellheadPressure} onChange={v => { setWell(w => ({ ...w, wellheadPressure: num(v) })); markDirty(); }} unit="МПа" />
                    <Field label="Коэфф. трения" value={friction} onChange={v => { setFriction(num(v)); markDirty(); }} unit="" />
                  </div>

                  <Separator />
                  <p className="text-xs font-medium text-muted-foreground">🌡 Температуры и ГРП</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Field label="BHST (стат.)" value={well.bhst} onChange={v => { setWell(w => ({ ...w, bhst: num(v) })); markDirty(); }} unit="°C" />
                    <Field label="BHCT (цирк.)" value={well.bhct} onChange={v => { setWell(w => ({ ...w, bhct: num(v) })); markDirty(); }} unit="°C" />
                    <Field label="T° на устье" value={well.whTemp} onChange={v => { setWell(w => ({ ...w, whTemp: num(v) })); markDirty(); }} unit="°C" />
                    <Field label="Градиент ГРП" value={well.fracGradient} onChange={v => { setWell(w => ({ ...w, fracGradient: num(v) })); markDirty(); }} unit="МПа/м" />
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
                    <Field label="Плотность" value={fluid.density} onChange={v => { setFluid(f => ({ ...f, density: num(v) })); markDirty(); }} unit="г/см³" />
                    <Field label="PV (пласт. вязк.)" value={fluid.pv} onChange={v => { setFluid(f => ({ ...f, pv: num(v) })); markDirty(); }} unit="сП" />
                    <Field label="YP (ДНС)" value={fluid.yp} onChange={v => { setFluid(f => ({ ...f, yp: num(v) })); markDirty(); }} unit="Па" />
                    <Field label="n (индекс потока)" value={fluid.nIndex} onChange={v => { setFluid(f => ({ ...f, nIndex: num(v) })); markDirty(); }} unit="" />
                    <Field label="K (конс. индекс)" value={fluid.kIndex} onChange={v => { setFluid(f => ({ ...f, kIndex: num(v) })); markDirty(); }} unit="Па·сⁿ" />
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
                    <Field label="Расход" value={pump.flowRate} onChange={v => { setPump(p => ({ ...p, flowRate: num(v) })); markDirty(); }} unit="л/с" />
                    <Field label="Вес КНБК" value={tools.bhaWeight} onChange={v => { setTools(t => ({ ...t, bhaWeight: num(v) })); markDirty(); }} unit="кг" />
                    <Field label="Длина КНБК" value={tools.bhaLength} onChange={v => { setTools(t => ({ ...t, bhaLength: num(v) })); markDirty(); }} unit="м" />
                    <Field label="Ø КНБК" value={tools.bhaOD} onChange={v => { setTools(t => ({ ...t, bhaOD: num(v) })); markDirty(); }} unit="мм" />
                    <Field label="Ø насадки" value={tools.nozzleDiam} onChange={v => { setTools(t => ({ ...t, nozzleDiam: num(v) })); markDirty(); }} unit="мм" />
                    <Field label="Кол-во насадок" value={tools.nozzleCount} onChange={v => { setTools(t => ({ ...t, nozzleCount: num(v) })); markDirty(); }} unit="шт" />
                  </div>
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
                    <Field label="Выполнено рейсов" value={prevTrips} onChange={v => { setPrevTrips(num(v)); markDirty(); }} unit="" />
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
                <TabsList className="inline-flex min-w-max w-full sm:w-full sm:grid sm:grid-cols-4">
                  <TabsTrigger value="forces" className="gap-1 text-xs whitespace-nowrap">⚡ Силы</TabsTrigger>
                  <TabsTrigger value="limits" className="gap-1 text-xs whitespace-nowrap">🛡 Пределы</TabsTrigger>
                  <TabsTrigger value="hydraulics" className="gap-1 text-xs whitespace-nowrap">💧 Гидравлика</TabsTrigger>
                  <TabsTrigger value="fatigue" className="gap-1 text-xs whitespace-nowrap">🔄 Усталость</TabsTrigger>
                </TabsList>
              </div>

              {/* Forces */}
              <TabsContent value="forces">
                <Card>
                  <CardHeader className="py-3 px-4 flex-row items-center justify-between">
                    <CardTitle className="text-sm">⚡ Tubing Forces — Силы на ГНКТ</CardTitle>
                    <CopyImageButton targetRef={forcesChartRef} label="📋" />
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <Num label="Вес в воздухе" value={forces.weightInAir.toFixed(1)} unit="кН" />
                    <Num label="Коэффициент плавучести" value={forces.buoyancyFactor.toFixed(3)} />
                    <Num label="Вес в жидкости" value={forces.weightInFluid.toFixed(1)} unit="кН" />
                    <div className="border-t border-border my-2" />
                    <Num label="Сила трения (СПО ↓)" value={forces.dragForceRIH.toFixed(1)} unit="кН" />
                    <Num label="Сила трения (СПО ↑)" value={forces.dragForcePOOH.toFixed(1)} unit="кН" />
                    <div className="border-t border-border my-2" />
                    <Num label="Нагрузка на устье (СПО ↓)" value={forces.surfaceLoadRIH.toFixed(1)} unit="кН" warn={forces.surfaceLoadRIH < 0} />
                    <Num label="Нагрузка на устье (СПО ↑)" value={forces.surfaceLoadPOOH.toFixed(1)} unit="кН" />
                    <div className="border-t border-border my-2" />
                    <Num label="Синус. потеря устойчивости" value={forces.sinusoidalBucklingLoad.toFixed(1)} unit="кН" />
                    <Num label="Спиральный изгиб" value={forces.helicalBucklingLoad.toFixed(1)} unit="кН" />
                    <Num label="Глубина lock-up" value={forces.lockUpDepth > 0 ? forces.lockUpDepth.toFixed(0) : "—"} unit={forces.lockUpDepth > 0 ? "м" : ""} warn={forces.lockUpDepth > 0} />

                    <div ref={forcesChartRef} className="mt-4 bg-card rounded-lg p-2">
                      <p className="text-xs font-semibold text-center mb-2">📊 Осевая нагрузка по глубине (MD)</p>
                      <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={forceProfile} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="depth" label={{ value: "Глубина MD, м", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                          <YAxis label={{ value: "кН", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          <Line type="monotone" dataKey="axialRIH" name="СПО ↓" stroke="#3b82f6" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="axialPOOH" name="СПО ↑" stroke="#ef4444" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="bucklingLimit" name="Синус. изгиб" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
                          <Line type="monotone" dataKey="helicalLimit" name="Спирал. изгиб" stroke="#a855f7" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
                          <ReferenceLine y={0} stroke="hsl(var(--foreground))" strokeWidth={0.5} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Limits */}
              <TabsContent value="limits">
                <Card>
                  <CardHeader className="py-3 px-4 flex-row items-center justify-between">
                    <CardTitle className="text-sm">🛡 CoilLIMIT — Пределы</CardTitle>
                    <CopyImageButton targetRef={limitsChartRef} label="📋" />
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <Num label="Давление разрыва (Barlow)" value={limits.burstPressure.toFixed(1)} unit="МПа" />
                    <Num label="Макс. рабочее давление (80%)" value={limits.maxWorkingPressure.toFixed(1)} unit="МПа" />
                    <div className="border-t border-border my-2" />
                    <Num label="Давление смятия" value={limits.collapsePressure.toFixed(1)} unit="МПа" />
                    <Num label="Смятие с овальностью" value={limits.collapseWithOvality.toFixed(1)} unit="МПа" warn={limits.collapseWithOvality < well.wellheadPressure} />
                    <div className="border-t border-border my-2" />
                    <Num label="Предел текучести (растяж.)" value={limits.yieldTension.toFixed(1)} unit="кН" />
                    <Num label="Макс. раб. натяжение (80%)" value={limits.maxWorkingTension.toFixed(1)} unit="кН" />
                    <div className="border-t border-border my-2" />
                    <Num label="Коэфф. Мизеса (σ_vm / σ_y)" value={limits.vonMisesRatio.toFixed(3)} warn={limits.vonMisesRatio >= 0.8} />

                    <div ref={limitsChartRef} className="mt-4 bg-card rounded-lg p-2">
                      <p className="text-xs font-semibold text-center mb-2">📊 Диаграмма пределов (Давление vs Нагрузка)</p>
                      <ResponsiveContainer width="100%" height={350}>
                        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis type="number" dataKey="axialLoad" name="Нагрузка" unit=" кН" tick={{ fontSize: 10 }}
                            label={{ value: "Осевая нагрузка, кН", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} />
                          <YAxis type="number" dataKey="pressure" name="Давление" unit=" МПа" tick={{ fontSize: 10 }}
                            label={{ value: "Давление, МПа", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                          <Tooltip contentStyle={{ fontSize: 11 }} />
                          <Scatter name="Предельная оболочка" data={pressureEnvelope} fill="#3b82f6" line={{ stroke: "#3b82f6", strokeWidth: 2 }} shape="circle" legendType="line" />
                          <Scatter name="Рабочая точка" data={[{ axialLoad: forces.surfaceLoadPOOH, pressure: hydraulics.dpTotal }]} fill="#ef4444" shape="star" legendType="star" />
                          <ZAxis range={[15, 15]} />
                          <ReferenceLine y={0} stroke="hsl(var(--foreground))" strokeWidth={0.5} />
                          <ReferenceLine x={0} stroke="hsl(var(--foreground))" strokeWidth={0.5} />
                        </ScatterChart>
                      </ResponsiveContainer>
                      <p className="text-[10px] text-muted-foreground text-center mt-1">⭐ Красная звезда = текущая рабочая точка</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Hydraulics */}
              <TabsContent value="hydraulics">
                <Card>
                  <CardHeader className="py-3 px-4 flex-row items-center justify-between">
                    <CardTitle className="text-sm">💧 Гидравлика циркуляции</CardTitle>
                    <CopyImageButton targetRef={hydraulicsChartRef} label="📋" />
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <Num label="Скорость в ГНКТ" value={hydraulics.velocityInCT.toFixed(2)} unit="м/с" />
                    <Num label="Скорость в затрубье" value={hydraulics.velocityAnnulus.toFixed(2)} unit="м/с" />
                    <Num label="Мин. скорость транспорта" value={hydraulics.minTransportVelocity.toFixed(2)} unit="м/с" />
                    <Num label="Транспорт шлама" value={hydraulics.transportOk ? "✅ Достаточно" : "⚠ Недостаточно"} warn={!hydraulics.transportOk} />
                    <div className="border-t border-border my-2" />
                    <Num label="Re в ГНКТ" value={hydraulics.reynoldsInCT} />
                    <Num label="Режим в ГНКТ" value={hydraulics.flowRegimeCT} />
                    <Num label="Re в затрубье" value={hydraulics.reynoldsAnnulus} />
                    <Num label="Режим в затрубье" value={hydraulics.flowRegimeAnnulus} />
                    <div className="border-t border-border my-2" />
                    <Num label="ΔP внутри ГНКТ" value={hydraulics.dpInsideCT.toFixed(2)} unit="МПа" />
                    <Num label="ΔP в затрубье" value={hydraulics.dpAnnulus.toFixed(2)} unit="МПа" />
                    <Num label="ΔP на насадках" value={hydraulics.dpNozzle.toFixed(2)} unit="МПа" />
                    <Num label="Общее ΔP" value={hydraulics.dpTotal.toFixed(2)} unit="МПа" warn={hydraulics.dpTotal > limits.maxWorkingPressure} />
                    <div className="border-t border-border my-2" />
                    <Num label="ECD на забое (TVD)" value={hydraulics.ecdAtTD.toFixed(3)} unit="г/см³" />
                    <Num label="BHP (цирк., TVD)" value={hydraulics.bhCircPressure.toFixed(2)} unit="МПа" />
                    <Num label="Давление ГРП (TVD)" value={hydraulics.fracPressureAtTD.toFixed(2)} unit="МПа" />
                    <Num label="BHP / P_грп" value={hydraulics.fracSafetyFactor.toFixed(2)} warn={hydraulics.fracSafetyFactor >= 0.85} />

                    <div ref={hydraulicsChartRef} className="mt-4 bg-card rounded-lg p-2">
                      <p className="text-xs font-semibold text-center mb-2">📊 Потери давления vs Расход</p>
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={hydraulicsCurve} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="flowRate" label={{ value: "Расход, л/с", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                          <YAxis label={{ value: "МПа", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          <Area type="monotone" dataKey="dpCT" name="ΔP ГНКТ" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} />
                          <Area type="monotone" dataKey="dpAnn" name="ΔP Затрубье" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.6} />
                          <Area type="monotone" dataKey="dpNozzle" name="ΔP Насадки" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.6} />
                          <Line type="monotone" dataKey="dpTotal" name="Общее ΔP" stroke="#ef4444" strokeWidth={2} dot={false} />
                          <ReferenceLine y={limits.maxWorkingPressure} stroke="#dc2626" strokeDasharray="6 3" label={{ value: `Макс. ${limits.maxWorkingPressure.toFixed(0)} МПа`, position: "top", style: { fontSize: 9, fill: "#dc2626" } }} />
                        </AreaChart>
                      </ResponsiveContainer>

                      <p className="text-xs font-semibold text-center mt-4 mb-2">Распределение ΔP при Q={pump.flowRate} л/с</p>
                      <ResponsiveContainer width="100%" height={120}>
                        <BarChart data={[{ name: "ΔP", ct: hydraulics.dpInsideCT, ann: hydraulics.dpAnnulus, nozzle: hydraulics.dpNozzle }]} layout="vertical" margin={{ left: 10, right: 20 }}>
                          <XAxis type="number" tick={{ fontSize: 10 }} />
                          <YAxis type="category" dataKey="name" hide />
                          <Tooltip contentStyle={{ fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          <Bar dataKey="ct" name="ГНКТ" stackId="a" fill="#3b82f6" />
                          <Bar dataKey="ann" name="Затрубье" stackId="a" fill="#10b981" />
                          <Bar dataKey="nozzle" name="Насадки" stackId="a" fill="#f59e0b" />
                        </BarChart>
                      </ResponsiveContainer>

                      {/* Temperature profile */}
                      {tempProfile.length > 0 && (
                        <>
                          <p className="text-xs font-semibold text-center mt-4 mb-2">🌡 Температурный профиль по глубине (TVD)</p>
                          <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={tempProfile} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                              <XAxis dataKey="tvd" label={{ value: "TVD, м", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                              <YAxis label={{ value: "°C", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                              <Tooltip contentStyle={{ fontSize: 11 }} />
                              <Legend wrapperStyle={{ fontSize: 10 }} />
                              <Line type="monotone" dataKey="tempStatic" name="BHST (стат.)" stroke="#ef4444" strokeWidth={2} dot={false} />
                              <Line type="monotone" dataKey="tempCirculating" name="BHCT (цирк.)" stroke="#3b82f6" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Fatigue */}
              <TabsContent value="fatigue">
                <Card>
                  <CardHeader className="py-3 px-4 flex-row items-center justify-between">
                    <CardTitle className="text-sm">🔄 CoilLIFE — Ресурс усталости</CardTitle>
                    <CopyImageButton targetRef={fatigueChartRef} label="📋" />
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <Num label="Деформация на барабане" value={fatigue.bendingStrainReel.toFixed(3)} unit="%" />
                    <Num label="Деформация на направл. арке" value={fatigue.bendingStrainGuideArch.toFixed(3)} unit="%" />
                    <Num label="Суммарная деформация за рейс" value={fatigue.totalStrainPerTrip.toFixed(3)} unit="%" />
                    <div className="border-t border-border my-2" />
                    <Num label="Расчётный ресурс" value={fatigue.estimatedCycles} unit="рейсов" />
                    <Num label="Безопасный ресурс (SF=2)" value={fatigue.maxSafeTrips} unit="рейсов" />
                    <Num label="Использовано ресурса" value={fatigue.fatigueLifeUsed.toFixed(1)} unit="%" warn={fatigue.fatigueLifeUsed > 60} />
                    <Num label="Снижение давления разрыва" value={fatigue.pressureDerate.toFixed(1)} unit="%" warn={fatigue.pressureDerate > 15} />
                    {fatigue.fatigueLifeUsed > 80 && <p className="text-xs text-destructive mt-2">💀 Ресурс ГНКТ критически исчерпан!</p>}

                    <div ref={fatigueChartRef} className="mt-4 bg-card rounded-lg p-2">
                      <p className="text-xs font-semibold text-center mb-2">📊 Кривая ресурса усталости</p>
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={fatigueCurve} margin={{ top: 5, right: 30, bottom: 5, left: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="trips" label={{ value: "Рейсы", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                          <YAxis yAxisId="left" label={{ value: "Ресурс, %", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 10 }} domain={[0, 120]} />
                          <YAxis yAxisId="right" orientation="right" label={{ value: "МПа", angle: 90, position: "insideRight", style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ fontSize: 11 }} />
                          <Legend wrapperStyle={{ fontSize: 10 }} />
                          <Line yAxisId="left" type="monotone" dataKey="lifeUsed" name="Ресурс, %" stroke="#ef4444" strokeWidth={2} dot={false} />
                          <Line yAxisId="right" type="monotone" dataKey="effectiveBurst" name="Эфф. P разрыва, МПа" stroke="#3b82f6" strokeWidth={2} dot={false} />
                          <ReferenceLine yAxisId="left" y={100} stroke="#dc2626" strokeDasharray="6 3" label={{ value: "100%", position: "top", style: { fontSize: 9, fill: "#dc2626" } }} />
                          <ReferenceLine yAxisId="left" y={50} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "50%", position: "right", style: { fontSize: 9, fill: "#d97706" } }} />
                          {prevTrips > 0 && <ReferenceLine x={prevTrips} stroke="#a855f7" strokeWidth={2} label={{ value: `Сейчас: ${prevTrips}`, position: "top", style: { fontSize: 9, fill: "#7c3aed" } }} />}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </main>
    </div>
  );
}
