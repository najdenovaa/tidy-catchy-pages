import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Calculator } from "lucide-react";
import type { WellData } from "@/lib/cementing-calculations";
import {
  calculateCentralization,
  centralizerPresets,
  centralizerTypeLabels,
  type CentralizerInterval,
  type CentralizerType,
  type CentralizationResult,
} from "@/lib/centralization-calculations";

interface Props {
  wellData: WellData;
  mudDensity: number;
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
      {/* Hole */}
      <circle cx={cx} cy={cy} r={holeR} fill="hsl(var(--muted))" stroke="hsl(var(--border))" strokeWidth={2} />
      {/* Casing body */}
      <circle cx={cx} cy={cy + offset} r={casODR} fill="hsl(var(--secondary))" stroke="hsl(var(--foreground))" strokeWidth={1.5} />
      {/* Casing bore */}
      <circle cx={cx} cy={cy + offset} r={casIDR} fill="hsl(var(--background))" stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
      {/* Center marks */}
      <circle cx={cx} cy={cy} r={2} fill="hsl(var(--destructive))" />
      <circle cx={cx} cy={cy + offset} r={2} fill="hsl(var(--primary))" />
      {/* Labels */}
      <text x={cx + 5} y={cy - 5} fill="hsl(var(--destructive))" fontSize={9}>ось скважины</text>
      {offset > 8 && (
        <text x={cx + 5} y={cy + offset - 5} fill="hsl(var(--primary))" fontSize={9}>ось колонны</text>
      )}
    </svg>
  );
}

// ─── Standoff color ──────────────────────────────────────────────
function standoffColor(standoff: number): string {
  if (standoff >= 67) return "text-green-400";
  if (standoff >= 50) return "text-yellow-400";
  return "text-red-400";
}

// ─── Main component ─────────────────────────────────────────────
export default function CentralizationSection({ wellData, mudDensity }: Props) {
  const [intervals, setIntervals] = useState<CentralizerInterval[]>(() => [newInterval(wellData.casingDepthMD)]);
  const [results, setResults] = useState<CentralizationResult[] | null>(null);
  const [selectedMD, setSelectedMD] = useState<number | null>(null);

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

  const handleCalculate = useCallback(() => {
    const res = calculateCentralization(wellData, intervals, mudDensity);
    setResults(res);
    if (res.length > 0) {
      // Select point with worst eccentricity for preview
      const worst = res.reduce((a, b) => a.eccentricity > b.eccentricity ? a : b);
      setSelectedMD(worst.md);
    }
  }, [wellData, intervals, mudDensity]);

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

  return (
    <div className="space-y-4">
      {/* Input card */}
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
              {/* Row 1: interval range + type */}
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
                  <Input type="number" min={0} value={iv.centralizersPerJoint || ""} onChange={e => updateInterval(iv.id, { centralizersPerJoint: +e.target.value })} className="h-8 text-xs" />
                </div>
              </div>
              {/* Row 2: specs */}
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

          <Button onClick={handleCalculate} className="w-full gap-2">
            <Calculator className="w-4 h-4" /> Рассчитать центрирование
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
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
              <CardTitle className="text-sm">Поперечное сечение</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row items-center gap-4">
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

          {/* Standoff bar chart (simple inline) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Профиль Standoff по стволу</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-40 flex items-end gap-[1px] overflow-hidden">
                {results.map((r, i) => {
                  const h = Math.max(1, r.standoff);
                  const bg = r.standoff >= 67 ? "bg-green-500" : r.standoff >= 50 ? "bg-yellow-500" : "bg-red-500";
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
            </CardContent>
          </Card>

          {/* Data table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Таблица результатов</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] px-2">MD, м</TableHead>
                      <TableHead className="text-[10px] px-2">TVD, м</TableHead>
                      <TableHead className="text-[10px] px-2">Зенит, °</TableHead>
                      <TableHead className="text-[10px] px-2">Эксц.</TableHead>
                      <TableHead className="text-[10px] px-2">Standoff, %</TableHead>
                      <TableHead className="text-[10px] px-2">Центратор</TableHead>
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
                        <TableCell className="text-xs px-2 py-1">{r.hasCentralizer ? "●" : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
