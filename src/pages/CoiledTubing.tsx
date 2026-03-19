import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Send, Gauge, Shield, Droplets, Activity, ChevronDown, ChevronRight, Calculator, Save, RotateCcw, FileDown, LogOut, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, AreaChart, Area, ReferenceLine, ScatterChart, Scatter, ZAxis } from "recharts";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import {
  CTStringData, WellGeometry, FluidData, PumpData, ToolsData,
  calculateTubingForces, calculateLimits, calculateHydraulics, calculateFatigue,
  CT_PRESETS, FLUID_PRESETS, ctWeightPerMeter,
  ForceResult, LimitResult, HydraulicsResult, FatigueResult,
  generateForceDepthProfile, generateHydraulicsCurve, generateFatigueCurve, generatePressureLoadEnvelope,
  assessRisks, RiskItem,
} from "@/lib/coiled-tubing-calculations";
import { exportCTDocx } from "@/lib/export-ct-docx";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { copyElementAsImage } from "@/lib/capture-image";
import CopyImageButton from "@/components/CopyImageButton";

// ─── Session ───
const CT_SESSION_KEY = "ct_session_v1";

interface CTSession {
  ct: CTStringData;
  well: WellGeometry;
  fluid: FluidData;
  pump: PumpData;
  tools: ToolsData;
  friction: number;
  reelSize: "small" | "medium" | "large";
  prevTrips: number;
}

const defaultCT: CTStringData = { od: 50.8, wall: 3.96, grade: "CT-80", length: 3000, ovality: 1 };
const defaultWell: WellGeometry = {
  md: 3000, tvd: 2800, casingID: 168.3, tubingID: 62, wellheadPressure: 5,
  bhTemp: 80, whTemp: 20, trajectory: [{ md: 0, inc: 0, azi: 0, tvd: 0 }, { md: 3000, inc: 15, azi: 0, tvd: 2800 }],
};
const defaultFluid: FluidData = { name: "Вода", density: 1.0, pv: 1, yp: 0, nIndex: 1, kIndex: 0.001 };
const defaultPump: PumpData = { flowRate: 300, surfacePressure: 0 };
const defaultTools: ToolsData = { bhaWeight: 200, bhaLength: 5, bhaOD: 48, nozzleDiam: 4, nozzleCount: 3 };

function loadSession(): CTSession {
  try {
    const raw = sessionStorage.getItem(CT_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ct: { ...defaultCT, ...parsed.ct }, well: { ...defaultWell, ...parsed.well }, fluid: { ...defaultFluid, ...parsed.fluid }, pump: { ...defaultPump, ...parsed.pump }, tools: { ...defaultTools, ...parsed.tools }, friction: parsed.friction ?? 0.25, reelSize: parsed.reelSize ?? "medium", prevTrips: parsed.prevTrips ?? 0 };
    }
  } catch {}
  return { ct: defaultCT, well: defaultWell, fluid: defaultFluid, pump: defaultPump, tools: defaultTools, friction: 0.25, reelSize: "medium", prevTrips: 0 };
}

function Num({ value, unit, label, warn }: { value: number | string; unit?: string; label: string; warn?: boolean }) {
  return (
    <div className={`flex justify-between items-center py-1.5 px-2 rounded text-sm ${warn ? "bg-destructive/10 text-destructive" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}{unit && <span className="ml-1 text-muted-foreground font-normal text-xs">{unit}</span>}</span>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-2">
      <Label className="text-xs text-muted-foreground whitespace-nowrap">{label}</Label>
      {children}
    </div>
  );
}

function RiskBadge({ risk }: { risk: RiskItem }) {
  const bg = risk.level === "critical" ? "bg-destructive/15 text-destructive border-destructive/30" : risk.level === "warning" ? "bg-yellow-500/15 text-yellow-700 border-yellow-500/30" : "bg-green-500/15 text-green-700 border-green-500/30";
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${bg}`}>
      <span className="text-base leading-none mt-0.5">{risk.emoji}</span>
      <span>{risk.message}</span>
    </div>
  );
}

function CollapsibleSection({ title, emoji, defaultOpen = false, children }: { title: string; emoji: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="py-3 px-4 cursor-pointer hover:bg-muted/50 transition-colors">
            <CardTitle className="text-sm flex items-center gap-2">
              {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              <span>{emoji}</span> {title}
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-4 pb-4 space-y-2">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
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
  const [tab, setTab] = useState("forces");
  const [calculated, setCalculated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

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
    const data: CTSession = { ct, well, fluid, pump, tools, friction, reelSize, prevTrips };
    try { sessionStorage.setItem(CT_SESSION_KEY, JSON.stringify(data)); } catch {}
  }, [ct, well, fluid, pump, tools, friction, reelSize, prevTrips]);

  const upCT = useCallback((p: Partial<CTStringData>) => { setCT(prev => ({ ...prev, ...p })); setCalculated(false); }, []);
  const upWell = useCallback((p: Partial<WellGeometry>) => { setWell(prev => ({ ...prev, ...p })); setCalculated(false); }, []);
  const upFluid = useCallback((p: Partial<FluidData>) => { setFluid(prev => ({ ...prev, ...p })); setCalculated(false); }, []);
  const upPump = useCallback((p: Partial<PumpData>) => { setPump(prev => ({ ...prev, ...p })); setCalculated(false); }, []);
  const upTools = useCallback((p: Partial<ToolsData>) => { setTools(prev => ({ ...prev, ...p })); setCalculated(false); }, []);

  // Calculations (only run when "Calculate" is pressed)
  const [forces, setForces] = useState<ForceResult | null>(null);
  const [limits, setLimits] = useState<LimitResult | null>(null);
  const [hydraulics, setHydraulics] = useState<HydraulicsResult | null>(null);
  const [fatigue, setFatigue] = useState<FatigueResult | null>(null);
  const [risks, setRisks] = useState<RiskItem[]>([]);

  const runCalculation = useCallback(() => {
    const f = calculateTubingForces(ct, well, fluid, tools, friction);
    const l = calculateLimits(ct, pump.surfacePressure || 0, well.wellheadPressure, f.surfaceLoadPOOH);
    const h = calculateHydraulics(ct, well, fluid, pump, tools);
    const ft = calculateFatigue(ct, reelSize, pump.surfacePressure || h.dpTotal, prevTrips);
    const r = assessRisks(f, l, h, ft, well);

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
  }, [ct, well, fluid, pump, tools, friction, reelSize, prevTrips]);

  const handleReset = useCallback(() => {
    setCT(defaultCT); setWell(defaultWell); setFluid(defaultFluid);
    setPump(defaultPump); setTools(defaultTools); setFriction(0.25);
    setReelSize("medium"); setPrevTrips(0); setCalculated(false);
    setForces(null); setLimits(null); setHydraulics(null); setFatigue(null);
    setRisks([]);
    sessionStorage.removeItem(CT_SESSION_KEY);
    toast.info("Данные обнулены");
  }, []);

  // Save to database
  const handleSave = useCallback(async () => {
    if (!userId) { toast.error("Необходимо войти в систему"); navigate("/auth"); return; }
    if (!calculated || !forces) { toast.error("Сначала выполните расчёт"); return; }

    // Get user's wells
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
      well_data: { ct, well: well, fluid, pump, tools, friction, reelSize, prevTrips } as any,
      calc_params: { forces, limits, hydraulics, fatigue, risks } as any,
      results: { forces, limits, hydraulics, fatigue } as any,
    }, { onConflict: "id" });

    if (error) { toast.error("Ошибка сохранения"); console.error(error); }
    else toast.success("Расчёт сохранён в личном кабинете 💾");
  }, [userId, calculated, forces, limits, hydraulics, fatigue, risks, ct, well, fluid, pump, tools, friction, reelSize, prevTrips, navigate]);

  // Export DOCX
  const handleExportDocx = useCallback(async () => {
    if (!calculated || !forces || !limits || !hydraulics || !fatigue) {
      toast.error("Сначала выполните расчёт");
      return;
    }

    toast.info("Формирование документа...");

    // Capture charts
    const [forcesImg, limitsImg, hydraulicsImg, fatigueImg] = await Promise.all([
      captureChart(forcesChartRef),
      captureChart(limitsChartRef),
      captureChart(hydraulicsChartRef),
      captureChart(fatigueChartRef),
    ]);

    await exportCTDocx({
      ct, well, fluid, pump, tools, friction, reelSize, prevTrips,
      forces, limits, hydraulics, fatigue, risks,
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
  const forceProfile = useMemo(() => calculated ? generateForceDepthProfile(ct, well, fluid, tools, friction) : [], [calculated, ct, well, fluid, tools, friction]);
  const hydraulicsCurve = useMemo(() => calculated ? generateHydraulicsCurve(ct, well, fluid, tools) : [], [calculated, ct, well, fluid, tools]);
  const fatigueCurve = useMemo(() => calculated ? generateFatigueCurve(ct, reelSize, pump.surfacePressure || (hydraulics?.dpTotal ?? 0)) : [], [calculated, ct, reelSize, pump.surfacePressure, hydraulics?.dpTotal]);
  const pressureEnvelope = useMemo(() => calculated ? generatePressureLoadEnvelope(ct) : [], [calculated, ct]);

  const linWeight = ctWeightPerMeter(ct.od, ct.wall);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <Link to="/" className="flex items-center gap-2">
              <img src={deallsoftLogo} alt="DeAllsoft" className="h-9 object-cover" />
            </Link>
            <span className="text-sm font-semibold text-foreground">🔧 ГНКТ — Гибкие НКТ</span>
          </div>
          <div className="flex items-center gap-2">
            {userId && (
              <>
                <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => navigate("/dashboard")}>
                  <User className="w-3.5 h-3.5" /> Кабинет
                </Button>
                <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={handleLogout}>
                  <LogOut className="w-3.5 h-3.5" /> Выход
                </Button>
              </>
            )}
            <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-xs">
              <Send className="w-4 h-4" />
            </a>
          </div>
        </div>
        {/* Action bar */}
        <div className="max-w-6xl mx-auto px-4 pb-2 flex items-center gap-2 flex-wrap">
          <Button onClick={runCalculation} size="sm" className="gap-1.5 font-bold">
            <Calculator className="w-4 h-4" /> РАСЧЁТ
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={handleSave}>
            <Save className="w-3.5 h-3.5" /> СОХРАНИТЬ
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={handleReset}>
            <RotateCcw className="w-3.5 h-3.5" /> ОБНУЛИТЬ
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={handleExportDocx}>
            <FileDown className="w-3.5 h-3.5" /> DOCX
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto px-4 py-4 w-full">
        {/* Risks banner */}
        {calculated && risks.length > 0 && (
          <div className="space-y-1.5 mb-4">
            {risks.map((r, i) => <RiskBadge key={i} risk={r} />)}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          {/* ── Left: Inputs ── */}
          <div className="space-y-3">
            <CollapsibleSection title="Параметры ГНКТ" emoji="🔧">
              <FieldRow label="Типоразмер">
                <Select onValueChange={v => {
                  const p = CT_PRESETS.find(x => x.label === v);
                  if (p) upCT({ od: p.od, wall: p.wall });
                }}>
                  <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Выбрать..." /></SelectTrigger>
                  <SelectContent>{CT_PRESETS.map(p => <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Нар. Ø, мм">
                <Input type="number" className="w-24 h-8 text-xs" value={ct.od} onChange={e => upCT({ od: +e.target.value })} />
              </FieldRow>
              <FieldRow label="Стенка, мм">
                <Input type="number" className="w-24 h-8 text-xs" value={ct.wall} onChange={e => upCT({ wall: +e.target.value })} />
              </FieldRow>
              <FieldRow label="Марка стали">
                <Select value={ct.grade} onValueChange={v => upCT({ grade: v })}>
                  <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["CT-70", "CT-80", "CT-90", "CT-110"].map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Длина, м">
                <Input type="number" className="w-24 h-8 text-xs" value={ct.length} onChange={e => upCT({ length: +e.target.value })} />
              </FieldRow>
              <FieldRow label="Овальность, %">
                <Input type="number" className="w-24 h-8 text-xs" value={ct.ovality} onChange={e => upCT({ ovality: +e.target.value })} min={0} max={10} step={0.5} />
              </FieldRow>
              <div className="text-[10px] text-muted-foreground pt-1">
                Вн.Ø: {(ct.od - 2 * ct.wall).toFixed(1)} мм · Вес: {linWeight.toFixed(3)} кг/м
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Скважина" emoji="🛢">
              <FieldRow label="MD, м">
                <Input type="number" className="w-24 h-8 text-xs" value={well.md} onChange={e => upWell({ md: +e.target.value })} />
              </FieldRow>
              <FieldRow label="TVD, м">
                <Input type="number" className="w-24 h-8 text-xs" value={well.tvd} onChange={e => upWell({ tvd: +e.target.value })} />
              </FieldRow>
              <FieldRow label="Экспл.кол. ID, мм">
                <Input type="number" className="w-24 h-8 text-xs" value={well.casingID} onChange={e => upWell({ casingID: +e.target.value })} />
              </FieldRow>
              <FieldRow label="НКТ ID, мм (0=нет)">
                <Input type="number" className="w-24 h-8 text-xs" value={well.tubingID} onChange={e => upWell({ tubingID: +e.target.value })} />
              </FieldRow>
              <FieldRow label="Устьевое P, МПа">
                <Input type="number" className="w-24 h-8 text-xs" value={well.wellheadPressure} onChange={e => upWell({ wellheadPressure: +e.target.value })} />
              </FieldRow>
              <FieldRow label="Забойная T, °C">
                <Input type="number" className="w-24 h-8 text-xs" value={well.bhTemp} onChange={e => upWell({ bhTemp: +e.target.value })} />
              </FieldRow>
              <FieldRow label="Зенит. угол, °">
                <Input type="number" className="w-24 h-8 text-xs" value={well.trajectory[1]?.inc ?? 0}
                  onChange={e => {
                    const inc = +e.target.value;
                    upWell({ trajectory: [{ md: 0, inc: 0, azi: 0, tvd: 0 }, { md: well.md, inc, azi: 0, tvd: well.tvd }] });
                  }} />
              </FieldRow>
              <FieldRow label="Коэф. трения">
                <Input type="number" className="w-24 h-8 text-xs" value={friction} onChange={e => { setFriction(+e.target.value); setCalculated(false); }} min={0.1} max={0.5} step={0.05} />
              </FieldRow>
            </CollapsibleSection>

            <CollapsibleSection title="Жидкость" emoji="💧">
              <FieldRow label="Тип">
                <Select onValueChange={v => {
                  const p = FLUID_PRESETS.find(x => x.label === v);
                  if (p) upFluid(p.data);
                }}>
                  <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Выбрать..." /></SelectTrigger>
                  <SelectContent>{FLUID_PRESETS.map(p => <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>)}</SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Плотность, г/см³">
                <Input type="number" className="w-24 h-8 text-xs" value={fluid.density} onChange={e => upFluid({ density: +e.target.value })} step={0.01} />
              </FieldRow>
              <FieldRow label="PV, сП">
                <Input type="number" className="w-24 h-8 text-xs" value={fluid.pv} onChange={e => upFluid({ pv: +e.target.value })} />
              </FieldRow>
              <FieldRow label="YP, Па">
                <Input type="number" className="w-24 h-8 text-xs" value={fluid.yp} onChange={e => upFluid({ yp: +e.target.value })} />
              </FieldRow>
            </CollapsibleSection>

            <CollapsibleSection title="Насос и инструмент" emoji="⚙️">
              <FieldRow label="Расход, л/мин">
                <Input type="number" className="w-24 h-8 text-xs" value={pump.flowRate} onChange={e => upPump({ flowRate: +e.target.value })} />
              </FieldRow>
              <FieldRow label="Вес КНБК, кг">
                <Input type="number" className="w-24 h-8 text-xs" value={tools.bhaWeight} onChange={e => upTools({ bhaWeight: +e.target.value })} />
              </FieldRow>
              <FieldRow label="Длина КНБК, м">
                <Input type="number" className="w-24 h-8 text-xs" value={tools.bhaLength} onChange={e => upTools({ bhaLength: +e.target.value })} />
              </FieldRow>
              <FieldRow label="Ø насадки, мм">
                <Input type="number" className="w-24 h-8 text-xs" value={tools.nozzleDiam} onChange={e => upTools({ nozzleDiam: +e.target.value })} />
              </FieldRow>
              <FieldRow label="Кол-во насадок">
                <Input type="number" className="w-24 h-8 text-xs" value={tools.nozzleCount} onChange={e => upTools({ nozzleCount: +e.target.value })} />
              </FieldRow>
            </CollapsibleSection>

            <CollapsibleSection title="Усталость" emoji="🔄">
              <FieldRow label="Размер барабана">
                <Select value={reelSize} onValueChange={v => { setReelSize(v as any); setCalculated(false); }}>
                  <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="small">Малый (1.37 м)</SelectItem>
                    <SelectItem value="medium">Средний (1.83 м)</SelectItem>
                    <SelectItem value="large">Большой (2.44 м)</SelectItem>
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Выполнено рейсов">
                <Input type="number" className="w-24 h-8 text-xs" value={prevTrips} onChange={e => { setPrevTrips(+e.target.value); setCalculated(false); }} min={0} />
              </FieldRow>
            </CollapsibleSection>
          </div>

          {/* ── Right: Results ── */}
          <div>
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
                <TabsList className="mb-3 w-full flex">
                  <TabsTrigger value="forces" className="flex-1 gap-1 text-xs"><Gauge className="w-3.5 h-3.5" /> ⚡ Силы</TabsTrigger>
                  <TabsTrigger value="limits" className="flex-1 gap-1 text-xs"><Shield className="w-3.5 h-3.5" /> 🛡 Пределы</TabsTrigger>
                  <TabsTrigger value="hydraulics" className="flex-1 gap-1 text-xs"><Droplets className="w-3.5 h-3.5" /> 💧 Гидравлика</TabsTrigger>
                  <TabsTrigger value="fatigue" className="flex-1 gap-1 text-xs"><Activity className="w-3.5 h-3.5" /> 🔄 Усталость</TabsTrigger>
                </TabsList>

                {/* Forces */}
                <TabsContent value="forces">
                  <Card>
                    <CardHeader className="py-3 px-4 flex-row items-center justify-between">
                      <CardTitle className="text-sm">⚡ Tubing Forces — Силы на колтюбинг</CardTitle>
                      <CopyImageButton targetRef={forcesChartRef} label="Копировать график" />
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-1">
                      <Num label="Вес в воздухе" value={forces.weightInAir.toFixed(1)} unit="кН" />
                      <Num label="Коэффициент плавучести" value={forces.buoyancyFactor.toFixed(3)} />
                      <Num label="Вес в жидкости" value={forces.weightInFluid.toFixed(1)} unit="кН" />
                      <div className="border-t border-border my-2" />
                      <Num label="Сила трения (СПО вниз)" value={forces.dragForceRIH.toFixed(1)} unit="кН" />
                      <Num label="Сила трения (СПО вверх)" value={forces.dragForcePOOH.toFixed(1)} unit="кН" />
                      <div className="border-t border-border my-2" />
                      <Num label="Нагрузка на устье (СПО вниз)" value={forces.surfaceLoadRIH.toFixed(1)} unit="кН" warn={forces.surfaceLoadRIH < 0} />
                      <Num label="Нагрузка на устье (СПО вверх)" value={forces.surfaceLoadPOOH.toFixed(1)} unit="кН" />
                      <div className="border-t border-border my-2" />
                      <Num label="Крит. нагрузка синус. потери устойч." value={forces.sinusoidalBucklingLoad.toFixed(1)} unit="кН" />
                      <Num label="Крит. нагрузка спирального изгиба" value={forces.helicalBucklingLoad.toFixed(1)} unit="кН" />
                      <Num label="Глубина запирания (lock-up)" value={forces.lockUpDepth > 0 ? forces.lockUpDepth.toFixed(0) : "—"} unit={forces.lockUpDepth > 0 ? "м" : ""} warn={forces.lockUpDepth > 0} />

                      {/* Force depth profile chart */}
                      <div ref={forcesChartRef} className="mt-4 bg-card rounded-lg p-2">
                        <p className="text-xs font-semibold text-center mb-2">📊 Осевая нагрузка по глубине</p>
                        <ResponsiveContainer width="100%" height={300}>
                          <LineChart data={forceProfile} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="depth" label={{ value: "Глубина, м", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                            <YAxis label={{ value: "кН", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
                            <Tooltip contentStyle={{ fontSize: 11 }} />
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            <Line type="monotone" dataKey="axialRIH" name="СПО вниз" stroke="#3b82f6" strokeWidth={2} dot={false} />
                            <Line type="monotone" dataKey="axialPOOH" name="СПО вверх" stroke="#ef4444" strokeWidth={2} dot={false} />
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
                      <CardTitle className="text-sm">🛡 CoilLIMIT — Пределы давления и нагрузок</CardTitle>
                      <CopyImageButton targetRef={limitsChartRef} label="Копировать график" />
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
                      {limits.vonMisesRatio >= 1.0 && <p className="text-xs text-destructive mt-2">⛔ Критерий Мизеса превышен!</p>}

                      {/* Pressure-Load Envelope */}
                      <div ref={limitsChartRef} className="mt-4 bg-card rounded-lg p-2">
                        <p className="text-xs font-semibold text-center mb-2">📊 Диаграмма пределов (Давление vs Нагрузка)</p>
                        <ResponsiveContainer width="100%" height={350}>
                          <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis type="number" dataKey="axialLoad" name="Осевая нагрузка" unit=" кН" tick={{ fontSize: 10 }}
                              label={{ value: "Осевая нагрузка, кН", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} />
                            <YAxis type="number" dataKey="pressure" name="Давление" unit=" МПа" tick={{ fontSize: 10 }}
                              label={{ value: "Давление, МПа", angle: -90, position: "insideLeft", style: { fontSize: 10 } }} />
                            <Tooltip contentStyle={{ fontSize: 11 }} />
                            <Scatter name="Предельная оболочка" data={pressureEnvelope} fill="#3b82f6" line={{ stroke: "#3b82f6", strokeWidth: 2 }} shape="circle" legendType="line" />
                            {/* Working point */}
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
                      <CopyImageButton targetRef={hydraulicsChartRef} label="Копировать график" />
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
                      <Num label="ECD на забое" value={hydraulics.ecdAtTD.toFixed(3)} unit="г/см³" />
                      <Num label="Забойное давление (цирк.)" value={hydraulics.bhCircPressure.toFixed(2)} unit="МПа" />

                      {/* Hydraulics chart: flow rate vs pressure drops */}
                      <div ref={hydraulicsChartRef} className="mt-4 bg-card rounded-lg p-2">
                        <p className="text-xs font-semibold text-center mb-2">📊 Потери давления vs Расход</p>
                        <ResponsiveContainer width="100%" height={300}>
                          <AreaChart data={hydraulicsCurve} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                            <XAxis dataKey="flowRate" label={{ value: "Расход, л/мин", position: "insideBottom", offset: -2, style: { fontSize: 10 } }} tick={{ fontSize: 10 }} />
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

                        {/* Pressure breakdown bar */}
                        <p className="text-xs font-semibold text-center mt-4 mb-2">Распределение потерь давления при Q={pump.flowRate} л/мин</p>
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
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Fatigue */}
                <TabsContent value="fatigue">
                  <Card>
                    <CardHeader className="py-3 px-4 flex-row items-center justify-between">
                      <CardTitle className="text-sm">🔄 CoilLIFE — Ресурс усталости</CardTitle>
                      <CopyImageButton targetRef={fatigueChartRef} label="Копировать график" />
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
                      {fatigue.fatigueLifeUsed > 80 && <p className="text-xs text-destructive mt-2">💀 Ресурс ГНКТ критически исчерпан! Необходима замена.</p>}

                      {/* Fatigue life chart */}
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
                            <Line yAxisId="left" type="monotone" dataKey="lifeUsed" name="Ресурс использован, %" stroke="#ef4444" strokeWidth={2} dot={false} />
                            <Line yAxisId="right" type="monotone" dataKey="effectiveBurst" name="Эфф. давл. разрыва, МПа" stroke="#3b82f6" strokeWidth={2} dot={false} />
                            <ReferenceLine yAxisId="left" y={100} stroke="#dc2626" strokeDasharray="6 3" label={{ value: "Предел 100%", position: "top", style: { fontSize: 9, fill: "#dc2626" } }} />
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
        </div>
      </main>
    </div>
  );
}
