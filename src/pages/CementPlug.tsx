import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { Send, Home, Calculator, ArrowLeft, FileDown } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { BlurInput } from "@/components/BlurInput";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import CementPlugVisualization from "@/components/CementPlugVisualization";
import CementPlugPressureChart from "@/components/CementPlugPressureChart";
import { calculateBalancedPlug, type PlugInputs, type PlugWellData, type PlugFluid, type PlugInterval, type PlugResults, type WashType } from "@/lib/cement-plug-calculations";
import { calculateTVDFromSurvey, type TrajectoryPoint } from "@/lib/cementing-calculations";
import { captureElementAsDataUrl } from "@/lib/capture-image";
import { exportCementPlugToDocx, type CementPlugExportData } from "@/lib/export-cement-plug-docx";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import * as XLSX from "xlsx";

const SESSION_KEY = "cement_plug_session_v2";

function num(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

/** Compute annular area for spacer height preview */
function annArea(boreMm: number, pipeODMm: number): number {
  const bo = boreMm / 1000;
  const pi = pipeODMm / 1000;
  return (Math.PI / 4) * (bo * bo - pi * pi);
}

interface SessionState {
  well: PlugWellData;
  plug: PlugInterval;
  cement: PlugFluid;
  spacer: PlugFluid;
  wellFluid: PlugFluid;
  spacerVolumeAbove: number;
  spacerVolumeBelow: number;
  thickeningTime: number;
  wocTimeHours: number;
  pullOutAbove: number;
  washType: WashType;
  washCycles: number;
  tripSpeed: number;
  trajPoints: TrajectoryPoint[];
  lastResults: PlugResults | null;
  wcRatio: number;
  slurryYield: number;
  additives: { name: string; percent: number }[];
  spacerAdditives: { name: string; percent: number }[];
  pumpRateCement: number;
  pumpRateSpacer: number;
  pumpRateDisplacement: number;
  pumpRateWash: number;
  fracGradient: number;
}

function loadSession(): Partial<SessionState> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function saveSession(state: SessionState) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {}
}

const defaultWell: PlugWellData = {
  wellDepthMD: 3000, holeDiameter: 215.9, casingShoe: 2500, casingID: 220,
  pipeOD: 89, pipeID: 75.9, cavernCoeff: 1.3,
  trajectory: [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }],
};

export default function CementPlug() {
  useEffect(() => {
    supabase.functions.invoke("log-activity", {
      body: { type: "visit", module: "cement-plug", page_url: "/cement-plug" },
    }).catch(() => {});
  }, []);

  const saved = useMemo(() => loadSession(), []);
  const vizRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  /* ── State ── */
  const [well, setWell] = useState<PlugWellData>(saved.well || defaultWell);
  const [plug, setPlug] = useState<PlugInterval>(saved.plug || { topMD: 2600, bottomMD: 2650 });
  const [cement, setCement] = useState<PlugFluid>(saved.cement || { name: "Тампонажный р-р", density: 1.85, rheology: { pv: 50, yp: 10 } });
  const [spacer, setSpacer] = useState<PlugFluid>(saved.spacer || { name: "Буферная жидкость", density: 1.10, rheology: { pv: 5, yp: 2 } });
  const [wellFluid, setWellFluid] = useState<PlugFluid>(saved.wellFluid || { name: "Буровой раствор", density: 1.20, rheology: { pv: 15, yp: 5 } });
  const [spacerVolumeAbove, setSpacerVolumeAbove] = useState(saved.spacerVolumeAbove ?? 0.3);
  const [spacerVolumeBelow, setSpacerVolumeBelow] = useState(saved.spacerVolumeBelow ?? 0.3);
  const [thickeningTime, setThickeningTime] = useState(saved.thickeningTime ?? 120);
  const [wocTimeHours, setWocTimeHours] = useState(saved.wocTimeHours ?? 24);
  const [pullOutAbove, setPullOutAbove] = useState(saved.pullOutAbove ?? 50);
  const [washType, setWashType] = useState<WashType>(saved.washType || 'direct');
  const [washCycles, setWashCycles] = useState(saved.washCycles ?? 2);
  const [tripSpeed, setTripSpeed] = useState(saved.tripSpeed ?? 0.3);
  const [trajPoints, setTrajPoints] = useState<TrajectoryPoint[]>(saved.trajPoints || well.trajectory);
  const [results, setResults] = useState<PlugResults | null>(() => {
    const r = saved.lastResults;
    // Invalidate stale cached results missing newer fields
    return r && r.pumpTimeCementMin !== undefined ? r : null;
  });
  const [wcRatio, setWcRatio] = useState(saved.wcRatio ?? 0.44);
  const [slurryYield, setSlurryYield] = useState(saved.slurryYield ?? 0.63);
  const [additives, setAdditives] = useState<{ name: string; percent: number }[]>(saved.additives || []);
  const [spacerAdditives, setSpacerAdditives] = useState<{ name: string; percent: number }[]>(saved.spacerAdditives || []);
  const [pumpRateCement, setPumpRateCement] = useState(saved.pumpRateCement ?? 3); // л/с
  const [pumpRateSpacer, setPumpRateSpacer] = useState(saved.pumpRateSpacer ?? 5); // л/с
  const [pumpRateDisplacement, setPumpRateDisplacement] = useState(saved.pumpRateDisplacement ?? 8); // л/с
  const [pumpRateWash, setPumpRateWash] = useState(saved.pumpRateWash ?? 10); // л/с
  const [fracGradient, setFracGradient] = useState(saved.fracGradient ?? 0.017); // МПа/м

  /* ── Session save ── */
  useEffect(() => {
    const timer = setTimeout(() => {
      saveSession({ well, plug, cement, spacer, wellFluid, spacerVolumeAbove, spacerVolumeBelow, thickeningTime, wocTimeHours, pullOutAbove, washType, washCycles, tripSpeed, trajPoints, lastResults: results, wcRatio, slurryYield, additives, spacerAdditives, pumpRateCement, pumpRateSpacer, pumpRateDisplacement, pumpRateWash, fracGradient });
    }, 500);
    return () => clearTimeout(timer);
  }, [well, plug, cement, spacer, wellFluid, spacerVolumeAbove, spacerVolumeBelow, thickeningTime, wocTimeHours, pullOutAbove, washType, washCycles, tripSpeed, trajPoints, results, wcRatio, slurryYield, additives, spacerAdditives, pumpRateCement, pumpRateSpacer, pumpRateDisplacement, pumpRateWash, fracGradient]);

  /* ── Spacer height preview (real-time) ── */
  const isOpenHole = plug.bottomMD > well.casingShoe;
  const effectiveBore = isOpenHole ? well.holeDiameter * Math.sqrt(Math.max(1, well.cavernCoeff)) : well.casingID;
  const previewAnnArea = annArea(effectiveBore, well.pipeOD);
  const previewBoreArea = (Math.PI / 4) * (effectiveBore / 1000) ** 2;
  const spacerAboveHeight = previewAnnArea > 0 ? spacerVolumeAbove / previewAnnArea : 0;
  const spacerBelowHeight = previewBoreArea > 0 ? spacerVolumeBelow / previewBoreArea : 0;

  /* ── Trajectory ── */
  const updateTrajPoint = (idx: number, key: keyof TrajectoryPoint, val: string) => {
    const pts = [...trajPoints];
    pts[idx] = { ...pts[idx], [key]: num(val) };
    setTrajPoints(pts);
  };
  const addTrajPoint = () => setTrajPoints(p => [...p, { md: 0, azimuth: 0, zenith: 0, tvd: 0 }]);
  const removeTrajPoint = (i: number) => setTrajPoints(p => p.filter((_, idx) => idx !== i));

  const recalcTVD = () => {
    const sorted = [...trajPoints].sort((a, b) => a.md - b.md);
    const calc = calculateTVDFromSurvey(sorted);
    setTrajPoints(calc);
    if (calc.length > 0) {
      setWell(w => ({ ...w, trajectory: calc, wellDepthMD: Math.max(w.wellDepthMD, calc[calc.length - 1].md) }));
    }
  };

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
        setWell(w => ({ ...w, trajectory: calc }));
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  /* ── Calculation ── */
  const buildInputs = (): PlugInputs => ({
    well: { ...well, trajectory: trajPoints.length > 1 ? trajPoints : well.trajectory },
    plug, cement, spacer, wellFluid,
    spacerVolumeAboveM3: spacerVolumeAbove,
    spacerVolumeBelowM3: spacerVolumeBelow,
    safetyMarginM: 30,
    thickeningTimeMin: thickeningTime,
    pullOutAbovePlugM: pullOutAbove,
    washType,
    washCycles,
    tripSpeedMs: tripSpeed,
    pumpRateCementLs: pumpRateCement,
    pumpRateSpacerLs: pumpRateSpacer,
    pumpRateDisplacementLs: pumpRateDisplacement,
    pumpRateWashLs: pumpRateWash,
  });

  const calculate = () => {
    setResults(calculateBalancedPlug(buildInputs()));
  };

  const handleExportDocx = async () => {
    if (!results) return;
    try {
      toast.info("Формирование документа...");
      let vizImage: string | undefined;
      let chartImage: string | undefined;
      if (vizRef.current) {
        try { vizImage = await captureElementAsDataUrl(vizRef.current); } catch {}
      }
      if (chartRef.current) {
        try { chartImage = await captureElementAsDataUrl(chartRef.current); } catch {}
      }
      const exportData: CementPlugExportData = {
        inputs: buildInputs(), results, fracGradient,
        wcRatio, slurryYield, additives, spacerAdditives, trajPoints,
        visualizationImage: vizImage, pressureChartImage: chartImage,
      };
      await exportCementPlugToDocx(exportData);
      toast.success("Документ сохранён!");
    } catch (e) {
      console.error(e);
      toast.error("Ошибка экспорта");
    }
  };

  /* ── Collapsible state ── */
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ well: true, plug: true, fluids: true, process: true });
  const toggle = (k: string) => setOpenSections(s => ({ ...s, [k]: !s[k] }));

  const Field = ({ label, value, onChange, unit }: { label: string; value: number; onChange: (v: string) => void; unit?: string }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}{unit ? ` (${unit})` : ""}</Label>
      <BlurInput type="number" step="any" value={value || ""} onValueCommit={onChange} className="h-8 text-xs" />
    </div>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/">
              <img src={deallsoftLogo} alt="DeAllsoft" className="h-10 object-cover" />
            </Link>
            <h1 className="text-sm sm:text-base font-semibold text-foreground">Цементные мосты</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="gap-1" onClick={calculate}>
              <Calculator className="w-4 h-4" /> Расчёт
            </Button>
            {results && (
              <Button size="sm" variant="outline" className="gap-1" onClick={handleExportDocx}>
                <FileDown className="w-4 h-4" /> Word
              </Button>
            )}
            <Link to="/cementing" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" /> Цементирование
            </Link>
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Home className="w-3.5 h-3.5" /> Главная
            </Link>
            <a href="https://t.me/deall_support" target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <Send className="w-3.5 h-3.5" /> Поддержка
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-3 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left column — inputs */}
          <div className="lg:col-span-2 space-y-3">
            {/* Well data */}
            <Collapsible open={openSections.well} onOpenChange={() => toggle("well")}>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">🛢️ Данные скважины</CardTitle>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.well ? "rotate-180" : ""}`} />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <Field label="Глубина скважины" value={well.wellDepthMD} onChange={v => setWell(w => ({ ...w, wellDepthMD: num(v) }))} unit="м MD" />
                      <Field label="Диаметр ствола" value={well.holeDiameter} onChange={v => setWell(w => ({ ...w, holeDiameter: num(v) }))} unit="мм" />
                      <Field label="Башмак колонны" value={well.casingShoe} onChange={v => setWell(w => ({ ...w, casingShoe: num(v) }))} unit="м MD" />
                      <Field label="Вн. ∅ колонны" value={well.casingID} onChange={v => setWell(w => ({ ...w, casingID: num(v) }))} unit="мм" />
                      <Field label="Нар. ∅ труб" value={well.pipeOD} onChange={v => setWell(w => ({ ...w, pipeOD: num(v) }))} unit="мм" />
                      <Field label="Вн. ∅ труб" value={well.pipeID} onChange={v => setWell(w => ({ ...w, pipeID: num(v) }))} unit="мм" />
                      <Field label="Коэфф. кавернозности" value={well.cavernCoeff} onChange={v => setWell(w => ({ ...w, cavernCoeff: num(v) }))} unit="" />
                      <Field label="Градиент ГРП" value={fracGradient} onChange={v => setFracGradient(num(v))} unit="МПа/м" />
                    </div>
                    {isOpenHole && (
                      <p className="text-[10px] text-amber-400">⚠ Открытый ствол: эфф. диаметр = {effectiveBore.toFixed(1)} мм (Kкав = {well.cavernCoeff})</p>
                    )}
                    <Separator />
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">Инклинометрия</p>
                      <div className="flex gap-1">
                        <label className="text-[10px] text-primary hover:underline cursor-pointer">
                          📥 Excel
                          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={importExcel} />
                        </label>
                        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={addTrajPoint}>+ точка</Button>
                        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={recalcTVD}>📐 TVD</Button>
                      </div>
                    </div>
                    <div className="max-h-40 overflow-auto text-[10px]">
                      <table className="w-full">
                        <thead><tr className="text-muted-foreground"><th className="px-1">MD</th><th className="px-1">Азимут°</th><th className="px-1">Зенит°</th><th className="px-1">TVD</th><th></th></tr></thead>
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

            {/* Plug interval */}
            <Collapsible open={openSections.plug} onOpenChange={() => toggle("plug")}>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">🧱 Интервал моста</CardTitle>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.plug ? "rotate-180" : ""}`} />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Верх моста" value={plug.topMD} onChange={v => setPlug(p => ({ ...p, topMD: num(v) }))} unit="м MD" />
                      <Field label="Низ моста" value={plug.bottomMD} onChange={v => setPlug(p => ({ ...p, bottomMD: num(v) }))} unit="м MD" />
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">Длина моста: {Math.max(0, plug.bottomMD - plug.topMD)} м</p>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Fluids */}
            <Collapsible open={openSections.fluids} onOpenChange={() => toggle("fluids")}>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">🧪 Растворы и жидкости</CardTitle>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.fluids ? "rotate-180" : ""}`} />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-4">
                    {/* Cement */}
                    <div>
                      <p className="text-xs font-semibold mb-1">Цементный раствор</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="space-y-1"><Label className="text-xs">Название</Label><BlurInput className="h-8 text-xs" value={cement.name} onValueCommit={v => setCement(c => ({ ...c, name: v }))} /></div>
                        <Field label="Плотность" value={cement.density} onChange={v => setCement(c => ({ ...c, density: num(v) }))} unit="г/см³" />
                        <Field label="PV" value={cement.rheology.pv} onChange={v => setCement(c => ({ ...c, rheology: { ...c.rheology, pv: num(v) } }))} unit="сПз" />
                        <Field label="YP" value={cement.rheology.yp} onChange={v => setCement(c => ({ ...c, rheology: { ...c.rheology, yp: num(v) } }))} unit="Па" />
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2">
                        <Field label="Загустевание (50Bc)" value={thickeningTime} onChange={v => setThickeningTime(num(v))} unit="мин" />
                        <div className="space-y-1">
                          <Label className="text-xs">Безопасн. время (0.75×50Bc)</Label>
                          <div className="h-8 flex items-center text-xs font-semibold text-amber-400">{(thickeningTime * 0.75).toFixed(0)} мин</div>
                        </div>
                        <Field label="Время ОЗЦ" value={wocTimeHours} onChange={v => setWocTimeHours(num(v))} unit="ч" />
                      </div>
                      <Separator className="my-2" />
                      <p className="text-[10px] font-medium text-muted-foreground mb-1">Рецептура</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <Field label="В/Ц" value={wcRatio} onChange={v => setWcRatio(num(v))} unit="" />
                        <Field label="Выход раствора" value={slurryYield} onChange={v => setSlurryYield(num(v))} unit="м³/т" />
                      </div>
                      <div className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[10px] font-medium text-muted-foreground">Добавки (% BWOC)</p>
                          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1" onClick={() => setAdditives(a => [...a, { name: "Добавка", percent: 0 }])}>+ добавка</Button>
                        </div>
                        {additives.map((add, i) => (
                          <div key={i} className="flex gap-1 items-center mb-1">
                            <BlurInput className="h-6 text-[10px] flex-1" value={add.name} onValueCommit={v => { const a = [...additives]; a[i] = { ...a[i], name: v }; setAdditives(a); }} />
                            <BlurInput type="number" className="h-6 text-[10px] w-16" value={add.percent || ""} onValueCommit={v => { const a = [...additives]; a[i] = { ...a[i], percent: num(v) }; setAdditives(a); }} />
                            <span className="text-[10px] text-muted-foreground">%</span>
                            <button className="text-destructive text-[10px]" onClick={() => setAdditives(a => a.filter((_, idx) => idx !== i))}>✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Separator />
                    {/* Spacer */}
                    <div>
                      <p className="text-xs font-semibold mb-1">Буферная жидкость</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="space-y-1"><Label className="text-xs">Название</Label><BlurInput className="h-8 text-xs" value={spacer.name} onValueCommit={v => setSpacer(s => ({ ...s, name: v }))} /></div>
                        <Field label="Плотность" value={spacer.density} onChange={v => setSpacer(s => ({ ...s, density: num(v) }))} unit="г/см³" />
                        <Field label="PV" value={spacer.rheology.pv} onChange={v => setSpacer(s => ({ ...s, rheology: { ...s.rheology, pv: num(v) } }))} unit="сПз" />
                        <Field label="YP" value={spacer.rheology.yp} onChange={v => setSpacer(s => ({ ...s, rheology: { ...s.rheology, yp: num(v) } }))} unit="Па" />
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="space-y-1">
                          <Field label="Объём буфера сверху" value={spacerVolumeAbove} onChange={v => setSpacerVolumeAbove(num(v))} unit="м³" />
                          <p className="text-[10px] text-muted-foreground">↕ Высота в затрубье: {spacerAboveHeight.toFixed(2)} м</p>
                        </div>
                        <div className="space-y-1">
                          <Field label="Объём буфера снизу" value={spacerVolumeBelow} onChange={v => setSpacerVolumeBelow(num(v))} unit="м³" />
                          <p className="text-[10px] text-muted-foreground">↕ Высота в затрубье: {spacerBelowHeight.toFixed(2)} м</p>
                        </div>
                      </div>
                      <div className="mt-2">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-[10px] font-medium text-muted-foreground">Добавки буфера (% BWOB)</p>
                          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1" onClick={() => setSpacerAdditives(a => [...a, { name: "Добавка", percent: 0 }])}>+ добавка</Button>
                        </div>
                        {spacerAdditives.map((add, i) => (
                          <div key={i} className="flex gap-1 items-center mb-1">
                            <BlurInput className="h-6 text-[10px] flex-1" value={add.name} onValueCommit={v => { const a = [...spacerAdditives]; a[i] = { ...a[i], name: v }; setSpacerAdditives(a); }} />
                            <BlurInput type="number" className="h-6 text-[10px] w-16" value={add.percent || ""} onValueCommit={v => { const a = [...spacerAdditives]; a[i] = { ...a[i], percent: num(v) }; setSpacerAdditives(a); }} />
                            <span className="text-[10px] text-muted-foreground">%</span>
                            <button className="text-destructive text-[10px]" onClick={() => setSpacerAdditives(a => a.filter((_, idx) => idx !== i))}>✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <Separator />
                    {/* Well fluid */}
                    <div>
                      <p className="text-xs font-semibold mb-1">Жидкость заполнения скважины</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="space-y-1"><Label className="text-xs">Название</Label><BlurInput className="h-8 text-xs" value={wellFluid.name} onValueCommit={v => setWellFluid(d => ({ ...d, name: v }))} /></div>
                        <Field label="Плотность" value={wellFluid.density} onChange={v => setWellFluid(d => ({ ...d, density: num(v) }))} unit="г/см³" />
                        <Field label="PV" value={wellFluid.rheology.pv} onChange={v => setWellFluid(d => ({ ...d, rheology: { ...d.rheology, pv: num(v) } }))} unit="сПз" />
                        <Field label="YP" value={wellFluid.rheology.yp} onChange={v => setWellFluid(d => ({ ...d, rheology: { ...d.rheology, yp: num(v) } }))} unit="Па" />
                      </div>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Process parameters */}
            <Collapsible open={openSections.process} onOpenChange={() => toggle("process")}>
              <Card>
                <CollapsibleTrigger className="w-full">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm">⚙️ Параметры процесса</CardTitle>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.process ? "rotate-180" : ""}`} />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-3">
                    <p className="text-[10px] font-medium text-muted-foreground">Производительность насосов</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Field label="Q цемент" value={pumpRateCement} onChange={v => setPumpRateCement(num(v))} unit="л/с" />
                      <Field label="Q буфер" value={pumpRateSpacer} onChange={v => setPumpRateSpacer(num(v))} unit="л/с" />
                      <Field label="Q продавка" value={pumpRateDisplacement} onChange={v => setPumpRateDisplacement(num(v))} unit="л/с" />
                      <Field label="Q промывка" value={pumpRateWash} onChange={v => setPumpRateWash(num(v))} unit="л/с" />
                    </div>
                    <Separator />
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      <Field label="Подъём над кровлей моста" value={pullOutAbove} onChange={v => setPullOutAbove(num(v))} unit="м" />
                      <Field label="Кол-во циклов промывки" value={washCycles} onChange={v => setWashCycles(Math.max(1, num(v)))} unit="" />
                      <Field label="Скорость подъёма" value={tripSpeed} onChange={v => setTripSpeed(num(v))} unit="м/с" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Тип промывки</Label>
                      <RadioGroup value={washType} onValueChange={v => setWashType(v as WashType)} className="flex gap-4">
                        <div className="flex items-center space-x-1.5">
                          <RadioGroupItem value="direct" id="wash-direct" />
                          <Label htmlFor="wash-direct" className="text-xs cursor-pointer">Прямая</Label>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          <RadioGroupItem value="reverse" id="wash-reverse" />
                          <Label htmlFor="wash-reverse" className="text-xs cursor-pointer">Обратная</Label>
                        </div>
                      </RadioGroup>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Results */}
            {results && (
              <>
                <Card className="border-primary/30">
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      📊 Результаты расчёта
                      <Badge variant={results.isBalanced ? "default" : "destructive"} className="text-[10px]">
                        {results.isBalanced ? "Сбалансировано ✓" : "Дисбаланс ⚠"}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
                      <ResultRow label="Длина моста (MD)" value={results.plugLengthMD} unit="м" />
                      <ResultRow label="Длина моста (TVD)" value={results.plugLengthTVD} unit="м" />
                      <ResultRow label="Верх моста TVD" value={results.plugTopTVD} unit="м" />
                      <ResultRow label="Низ моста TVD" value={results.plugBottomTVD} unit="м" />
                      <ResultRow label="Sзатр." value={(results.annArea * 1e4).toFixed(1)} unit="см²" raw />
                      <ResultRow label="Sтруб." value={(results.pipeArea * 1e4).toFixed(1)} unit="см²" raw />
                      {results.isOpenHole && (
                        <ResultRow label="Kкав / эфф.∅" value={`${results.cavernCoeff.toFixed(2)} / ${results.boreDiamUsed.toFixed(1)} мм`} unit="" raw />
                      )}
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="Цемент (затрубье)" value={results.cementVolumeAnn} unit="м³" />
                      <ResultRow label="Цемент (трубы)" value={results.cementVolumePipe} unit="м³" />
                      <ResultRow label="Цемент ИТОГО" value={results.cementVolumeTotal} unit="м³" highlight />
                      <ResultRow label="Высота цем. (затрубье)" value={results.cementHeightAnnMD} unit="м" />
                      <ResultRow label="Высота цем. (трубы)" value={results.cementHeightPipeMD} unit="м" />
                      <div className="col-span-full text-[10px] text-muted-foreground italic mt-1">
                        {results.heightDifferenceExplanation}
                      </div>
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="Буфер сверху" value={results.spacerVolumeAbove} unit="м³" />
                      <ResultRow label="↕ Интервал буфера сверху" value={results.spacerAboveHeightAnnMD} unit="м" />
                      <ResultRow label="Буфер снизу" value={results.spacerVolumeBelow} unit="м³" />
                      <ResultRow label="↕ Интервал буфера снизу" value={results.spacerBelowHeightAnnMD} unit="м" />
                      <ResultRow label="Объём продавки" value={results.displacementVolume} unit="м³" highlight />
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="P_статич. затрубье" value={results.pressureAnnulus} unit="МПа" />
                      <ResultRow label="P_статич. трубы" value={results.pressurePipe} unit="МПа" />
                      <ResultRow label="ΔP" value={Math.abs(results.pressureAnnulus - results.pressurePipe).toFixed(2)} unit="МПа" raw highlight />
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="Подъём на промывку до" value={results.pullOutDepthMD} unit="м MD" />
                      <ResultRow label="Скорость подъёма" value={results.tripSpeedMs.toFixed(2)} unit="м/с" raw />
                      <ResultRow label={`Промывка (${results.washType === 'direct' ? 'прямая' : 'обратная'}, ${results.washCycles} ц.)`} value={results.washVolumeM3} unit="м³" />
                      <Separator className="col-span-full my-1" />
                      <div className="col-span-full text-[10px] font-semibold text-muted-foreground">⏱ Хронометраж операции (от начала закачки цемента)</div>
                      <ResultRow label="Закачка цемента" value={results.pumpTimeCementMin.toFixed(1)} unit="мин" raw />
                      {results.pumpTimeSpacerAboveMin > 0 && (
                        <ResultRow label="Закачка верх. буфера" value={results.pumpTimeSpacerAboveMin.toFixed(1)} unit="мин" raw />
                      )}
                      <ResultRow label="Продавка" value={results.pumpTimeDisplacementMin.toFixed(1)} unit="мин" raw />
                      <ResultRow label="Подъём инструмента" value={results.tripTimeMin.toFixed(1)} unit="мин" raw />
                      <ResultRow label="Промывка" value={results.washTimeMin.toFixed(1)} unit="мин" raw />
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="Итого время операции" value={results.totalOperationTimeMin.toFixed(1)} unit="мин" raw highlight />
                      <ResultRow label="Загустевание (50Bc)" value={results.thickeningTimeMin} unit="мин" />
                      <ResultRow label="Безопасное время (0.75×50Bc)" value={results.safeTimeMin.toFixed(0)} unit="мин" raw highlight />
                      <div className={`col-span-full text-xs font-bold mt-1 ${results.isTimeSafe ? 'text-green-400' : 'text-destructive'}`}>
                        {results.isTimeSafe 
                          ? `✅ Запас: ${(results.safeTimeMin - results.totalOperationTimeMin).toFixed(1)} мин` 
                          : `⛔ Превышение на ${(results.totalOperationTimeMin - results.safeTimeMin).toFixed(1)} мин! Увеличьте производительность или время загустевания`}
                      </div>
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="Время ОЗЦ" value={wocTimeHours} unit="ч" highlight />
                    </div>
                  </CardContent>
                </Card>

                {/* Pumping schedule */}
                <Card>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm">📋 Порядок работ</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">№</TableHead>
                            <TableHead className="text-xs">Этап</TableHead>
                            <TableHead className="text-xs">Жидкость</TableHead>
                            <TableHead className="text-xs text-right">Объём, м³</TableHead>
                            <TableHead className="text-xs text-right">Время, мин</TableHead>
                            <TableHead className="text-xs">Описание</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {results.pumpingStages.map((stage, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs font-medium">{i + 1}</TableCell>
                              <TableCell className="text-xs font-medium">{stage.name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{stage.fluid}</TableCell>
                              <TableCell className="text-xs text-right font-medium">{stage.volumeM3 > 0 ? stage.volumeM3.toFixed(3) : "—"}</TableCell>
                              <TableCell className="text-xs text-right font-medium">{stage.timeMin > 0 ? stage.timeMin.toFixed(1) : "—"}</TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[200px]">{stage.description}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Materials */}
                {slurryYield > 0 && (
                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm">🏗️ Материалы</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {(() => {
                        const dryMass = results.cementVolumeTotal / slurryYield; // tonnes
                        const waterMass = dryMass * wcRatio; // tonnes
                        const spacerTotalVol = results.spacerVolumeAbove + results.spacerVolumeBelow;
                        const spacerMassKg = spacerTotalVol * spacer.density * 1000; // kg total spacer
                        return (
                          <div className="space-y-3">
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground mb-1">Цемент</p>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                <ResultRow label="Сухой цемент" value={(dryMass * 1000).toFixed(0)} unit="кг" raw />
                                <ResultRow label="Вода затворения" value={(waterMass * 1000).toFixed(0)} unit="кг" raw />
                                <ResultRow label="В/Ц" value={wcRatio.toFixed(2)} unit="" raw />
                                <ResultRow label="Выход" value={slurryYield.toFixed(2)} unit="м³/т" raw />
                                {additives.filter(a => a.percent > 0).map((add, i) => (
                                  <ResultRow key={i} label={add.name} value={(dryMass * 1000 * add.percent / 100).toFixed(1)} unit={`кг (${add.percent}%)`} raw />
                                ))}
                              </div>
                            </div>
                            {spacerTotalVol > 0 && (
                              <div>
                                <Separator className="mb-2" />
                                <p className="text-[10px] font-semibold text-muted-foreground mb-1">Буфер</p>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                  <ResultRow label="Объём буфера (всего)" value={spacerTotalVol.toFixed(3)} unit="м³" raw />
                                  <ResultRow label="Масса буфера" value={spacerMassKg.toFixed(0)} unit="кг" raw />
                                  {spacerAdditives.filter(a => a.percent > 0).map((add, i) => (
                                    <ResultRow key={i} label={add.name} value={(spacerMassKg * add.percent / 100).toFixed(1)} unit={`кг (${add.percent}%)`} raw />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                )}

                {/* Process description */}
                <Card>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm">📝 Описание процесса</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-1.5 text-xs text-foreground whitespace-pre-line leading-relaxed">
                      {results.processDescription}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          {/* Right column — visualization */}
          <div className="space-y-3">
            {results && (
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">🖼️ Продольное сечение</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 flex justify-center" ref={vizRef}>
                  <CementPlugVisualization results={results} inputs={buildInputs()} />
                </CardContent>
              </Card>
            )}
            {results && (
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">📈 Совмещённый график давлений</CardTitle>
                </CardHeader>
                <CardContent className="pt-0" ref={chartRef}>
                  <CementPlugPressureChart inputs={buildInputs()} results={results} fracGradient={fracGradient} />
                </CardContent>
              </Card>
            )}
            {!results && (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground text-sm">
                  Заполните данные и нажмите <strong>Расчёт</strong> для получения результатов и визуализации
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function ResultRow({ label, value, unit, highlight, raw }: { label: string; value: number | string; unit: string; highlight?: boolean; raw?: boolean }) {
  const display = raw ? String(value) : typeof value === "number" ? value.toFixed(3) : value;
  return (
    <div className={`flex justify-between ${highlight ? "font-semibold text-primary" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{display} {unit}</span>
    </div>
  );
}
