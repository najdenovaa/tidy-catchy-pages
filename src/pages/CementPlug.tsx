import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Send, Home, Calculator, ArrowLeft } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { BlurInput } from "@/components/BlurInput";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import deallsoftLogo from "@/assets/deallsoft-logo.png";
import CementPlugVisualization from "@/components/CementPlugVisualization";
import { calculateBalancedPlug, type PlugInputs, type PlugWellData, type PlugFluid, type PlugInterval, type PlugResults } from "@/lib/cement-plug-calculations";
import { calculateTVDFromSurvey, type TrajectoryPoint } from "@/lib/cementing-calculations";
import { supabase } from "@/integrations/supabase/client";
import * as XLSX from "xlsx";

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

  const [plug, setPlug] = useState<PlugInterval>({ topMD: 2600, bottomMD: 2650 });

  /* ── State: fluids ── */
  const [cement, setCement] = useState<PlugFluid>({ name: "Тампонажный р-р", density: 1.85, rheology: { pv: 50, yp: 10 } });
  const [spacer, setSpacer] = useState<PlugFluid>({ name: "Буферная жидкость", density: 1.10, rheology: { pv: 5, yp: 2 } });
  const [wellFluid, setWellFluid] = useState<PlugFluid>({ name: "Буровой раствор", density: 1.20, rheology: { pv: 15, yp: 5 } });
  const [spacerVolumeAbove, setSpacerVolumeAbove] = useState(0.3);
  const [spacerVolumeBelow, setSpacerVolumeBelow] = useState(0.3);
  const [thickeningTime, setThickeningTime] = useState(120);
  const [pullOutAbove, setPullOutAbove] = useState(50);

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
      plug, cement, spacer, wellFluid,
      spacerVolumeAboveM3: spacerVolumeAbove,
      spacerVolumeBelowM3: spacerVolumeBelow,
      safetyMarginM: 30,
      thickeningTimeMin: thickeningTime,
      pullOutAbovePlugM: pullOutAbove,
    };
    setResults(calculateBalancedPlug(inp));
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

  const buildInputs = (): PlugInputs => ({
    well: { ...well, trajectory: trajPoints.length > 1 ? trajPoints : well.trajectory },
    plug, cement, spacer, wellFluid,
    spacerVolumeAboveM3: spacerVolumeAbove,
    spacerVolumeBelowM3: spacerVolumeBelow,
    safetyMarginM: 30,
    thickeningTimeMin: thickeningTime,
    pullOutAbovePlugM: pullOutAbove,
  });

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
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <Field label="Время загустевания" value={thickeningTime} onChange={v => setThickeningTime(num(v))} unit="мин" />
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
                        <Field label="Объём буфера сверху" value={spacerVolumeAbove} onChange={v => setSpacerVolumeAbove(num(v))} unit="м³" />
                        <Field label="Объём буфера снизу" value={spacerVolumeBelow} onChange={v => setSpacerVolumeBelow(num(v))} unit="м³" />
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
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Подъём над кровлей моста на промывку" value={pullOutAbove} onChange={v => setPullOutAbove(num(v))} unit="м" />
                      <div className="space-y-1">
                        <Label className="text-xs">Промывка</Label>
                        <p className="text-sm text-foreground font-medium mt-1">1,5 цикла</p>
                      </div>
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
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="Цемент (затрубье)" value={results.cementVolumeAnn} unit="м³" />
                      <ResultRow label="Цемент (трубы)" value={results.cementVolumePipe} unit="м³" />
                      <ResultRow label="Цемент ИТОГО" value={results.cementVolumeTotal} unit="м³" highlight />
                      <ResultRow label="Буфер сверху" value={results.spacerVolumeAbove} unit="м³" />
                      <ResultRow label="Буфер снизу" value={results.spacerVolumeBelow} unit="м³" />
                      <ResultRow label="Высота цем. в трубах" value={results.cementHeightPipeMD} unit="м" />
                      <ResultRow label="Объём продавки" value={results.displacementVolume} unit="м³" highlight />
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="P затрубье (дно моста)" value={results.pressureAnnulus} unit="МПа" />
                      <ResultRow label="P трубы (дно моста)" value={results.pressurePipe} unit="МПа" />
                      <ResultRow label="ΔP" value={Math.abs(results.pressureAnnulus - results.pressurePipe).toFixed(2)} unit="МПа" raw highlight />
                      <Separator className="col-span-full my-1" />
                      <ResultRow label="Подъём на промывку до" value={results.pullOutDepthMD} unit="м MD" />
                      <ResultRow label="Объём промывки (1,5 цикла)" value={results.washVolumeM3} unit="м³" />
                      <ResultRow label="Загустевание цемента" value={results.thickeningTimeMin} unit="мин" />
                    </div>
                  </CardContent>
                </Card>

                {/* Pumping schedule */}
                <Card>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm">📋 Порядок закачки</CardTitle>
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
                            <TableHead className="text-xs">Описание</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {results.pumpingStages.map((stage, i) => (
                            <TableRow key={i}>
                              <TableCell className="text-xs font-medium">{i + 1}</TableCell>
                              <TableCell className="text-xs font-medium">{stage.name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{stage.fluid}</TableCell>
                              <TableCell className="text-xs text-right font-medium">{stage.volumeM3.toFixed(3)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[200px]">{stage.description}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

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
                <CardContent className="pt-0 flex justify-center">
                  <CementPlugVisualization results={results} inputs={buildInputs()} />
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
