import { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { Send, Home, Calculator, ArrowLeft } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import CementPlugVisualization from "@/components/CementPlugVisualization";
import { calculateBalancedPlug, type PlugInputs, type PlugWellData, type PlugFluid, type PlugInterval, type PlugResults } from "@/lib/cement-plug-calculations";
import { calculateTVDFromSurvey, type TrajectoryPoint } from "@/lib/cementing-calculations";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

/* ─── helper ─── */
function num(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export default function CementPlug() {
  useEffect(() => {
    supabase.functions.invoke("log-activity", {
      body: { type: "visit", module: "cement-plug", page_url: "/cement-plug" },
    }).catch(() => {});
  }, []);

  /* ── State: well ── */
  const [well, setWell] = useState<PlugWellData>({
    wellDepthMD: 3000, holeDiameter: 215.9, casingShoe: 2500, casingID: 220,
    pipeOD: 89, pipeID: 75.9,
    trajectory: [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }],
  });

  /* ── State: plug interval ── */
  const [plug, setPlug] = useState<PlugInterval>({ topMD: 2600, bottomMD: 2650 });

  /* ── State: fluids ── */
  const [cement, setCement] = useState<PlugFluid>({ name: "Тампонажный р-р", density: 1.85, rheology: { pv: 50, yp: 10 } });
  const [spacer, setSpacer] = useState<PlugFluid>({ name: "Буферная жидкость", density: 1.10, rheology: { pv: 5, yp: 2 } });
  const [drillingFluid, setDrillingFluid] = useState<PlugFluid>({ name: "Буровой раствор", density: 1.20, rheology: { pv: 15, yp: 5 } });
  const [spacerVolume, setSpacerVolume] = useState(0.5);

  /* ── Trajectory ── */
  const [trajPoints, setTrajPoints] = useState<TrajectoryPoint[]>(well.trajectory);

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
  const [results, setResults] = useState<PlugResults | null>(null);

  const calculate = () => {
    const inp: PlugInputs = {
      well: { ...well, trajectory: trajPoints.length > 1 ? trajPoints : well.trajectory },
      plug, cement, spacer, drillingFluid, spacerVolumeM3: spacerVolume, safetyMarginM: 30,
    };
    setResults(calculateBalancedPlug(inp));
  };

  /* ── Collapsible state ── */
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ well: true, plug: true, fluids: true });
  const toggle = (k: string) => setOpenSections(s => ({ ...s, [k]: !s[k] }));

  /* ── Render helpers ── */
  const Field = ({ label, value, onChange, unit }: { label: string; value: number; onChange: (v: string) => void; unit?: string }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}{unit ? ` (${unit})` : ""}</Label>
      <Input type="number" step="any" value={value || ""} onChange={e => onChange(e.target.value)} className="h-8 text-xs" />
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
                    </div>

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
                              <td><Input type="number" className="h-6 text-[10px] w-16" value={p.md || ""} onChange={e => updateTrajPoint(i, "md", e.target.value)} /></td>
                              <td><Input type="number" className="h-6 text-[10px] w-16" value={p.azimuth || ""} onChange={e => updateTrajPoint(i, "azimuth", e.target.value)} /></td>
                              <td><Input type="number" className="h-6 text-[10px] w-16" value={p.zenith || ""} onChange={e => updateTrajPoint(i, "zenith", e.target.value)} /></td>
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
                    <CardTitle className="text-sm">🧪 Растворы</CardTitle>
                    <ChevronDown className={`w-4 h-4 transition-transform ${openSections.fluids ? "rotate-180" : ""}`} />
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0 space-y-4">
                    {/* Cement */}
                    <div>
                      <p className="text-xs font-semibold mb-1">Цементный раствор</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="space-y-1"><Label className="text-xs">Название</Label><Input className="h-8 text-xs" value={cement.name} onChange={e => setCement(c => ({ ...c, name: e.target.value }))} /></div>
                        <Field label="Плотность" value={cement.density} onChange={v => setCement(c => ({ ...c, density: num(v) }))} unit="г/см³" />
                        <Field label="PV" value={cement.rheology.pv} onChange={v => setCement(c => ({ ...c, rheology: { ...c.rheology, pv: num(v) } }))} unit="сПз" />
                        <Field label="YP" value={cement.rheology.yp} onChange={v => setCement(c => ({ ...c, rheology: { ...c.rheology, yp: num(v) } }))} unit="Па" />
                      </div>
                    </div>
                    <Separator />
                    {/* Spacer */}
                    <div>
                      <p className="text-xs font-semibold mb-1">Буферная жидкость</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="space-y-1"><Label className="text-xs">Название</Label><Input className="h-8 text-xs" value={spacer.name} onChange={e => setSpacer(s => ({ ...s, name: e.target.value }))} /></div>
                        <Field label="Плотность" value={spacer.density} onChange={v => setSpacer(s => ({ ...s, density: num(v) }))} unit="г/см³" />
                        <Field label="PV" value={spacer.rheology.pv} onChange={v => setSpacer(s => ({ ...s, rheology: { ...s.rheology, pv: num(v) } }))} unit="сПз" />
                        <Field label="YP" value={spacer.rheology.yp} onChange={v => setSpacer(s => ({ ...s, rheology: { ...s.rheology, yp: num(v) } }))} unit="Па" />
                      </div>
                      <div className="mt-2">
                        <Field label="Общий объём буфера" value={spacerVolume} onChange={v => setSpacerVolume(num(v))} unit="м³" />
                      </div>
                    </div>
                    <Separator />
                    {/* Drilling fluid */}
                    <div>
                      <p className="text-xs font-semibold mb-1">Буровой раствор</p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="space-y-1"><Label className="text-xs">Название</Label><Input className="h-8 text-xs" value={drillingFluid.name} onChange={e => setDrillingFluid(d => ({ ...d, name: e.target.value }))} /></div>
                        <Field label="Плотность" value={drillingFluid.density} onChange={v => setDrillingFluid(d => ({ ...d, density: num(v) }))} unit="г/см³" />
                        <Field label="PV" value={drillingFluid.rheology.pv} onChange={v => setDrillingFluid(d => ({ ...d, rheology: { ...d.rheology, pv: num(v) } }))} unit="сПз" />
                        <Field label="YP" value={drillingFluid.rheology.yp} onChange={v => setDrillingFluid(d => ({ ...d, rheology: { ...d.rheology, yp: num(v) } }))} unit="Па" />
                      </div>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Results */}
            {results && (
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
                    <Separator className="col-span-full my-1" />
                    <ResultRow label="Цемент (затрубье)" value={results.cementVolumeAnn} unit="м³" />
                    <ResultRow label="Цемент (трубы)" value={results.cementVolumePipe} unit="м³" />
                    <ResultRow label="Цемент ИТОГО" value={results.cementVolumeTotal} unit="м³" highlight />
                    <ResultRow label="Буфер снизу" value={results.spacerVolumeBelow} unit="м³" />
                    <ResultRow label="Буфер сверху" value={results.spacerVolumeAbove} unit="м³" />
                    <ResultRow label="Высота цем. в трубах" value={results.cementHeightPipeMD} unit="м" />
                    <ResultRow label="Объём продавки" value={results.displacementVolume} unit="м³" highlight />
                    <Separator className="col-span-full my-1" />
                    <ResultRow label="P затрубье (дно моста)" value={results.pressureAnnulus} unit="МПа" />
                    <ResultRow label="P трубы (дно моста)" value={results.pressurePipe} unit="МПа" />
                    <ResultRow label="ΔP" value={Math.abs(results.pressureAnnulus - results.pressurePipe).toFixed(2)} unit="МПа" raw highlight />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right column — visualization */}
          <div className="space-y-3">
            {results && (
              <Card>
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-sm">🖼️ Продольное сечение</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 flex justify-center">
                  <CementPlugVisualization
                    results={results}
                    inputs={{ well: { ...well, trajectory: trajPoints }, plug, cement, spacer, drillingFluid, spacerVolumeM3: spacerVolume, safetyMarginM: 30 }}
                  />
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
