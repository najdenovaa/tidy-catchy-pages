import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { GitCompareArrows, Save, Trash2, ChevronRight } from "lucide-react";
import type { PressureProfileResult, VolumeResults, WellData } from "@/lib/cementing-calculations";
import type { CentralizationResult } from "@/lib/centralization-calculations";

const STORAGE_KEY = "deallsoft.cementing.scenarios.v1";
const MAX_SCENARIOS = 5;

interface ScenarioSnapshot {
  id: string;
  name: string;
  savedAt: number;
  wellName: string;
  metrics: ScenarioMetrics;
}

interface ScenarioMetrics {
  maxBHP: number;        // МПа
  fracP: number;         // МПа
  ecdRatio: number;      // %
  safeTimeMin: number;
  totalCementM3: number;
  avgStandoff: number;   // %
  minStandoff: number;   // %
  centralizerCount: number;
  flowRateMaxLps: number;
  rotationRpm: number;
}

interface Props {
  wellData: WellData;
  pressureResult: PressureProfileResult | null;
  volumes: VolumeResults | null;
  centralizationResults: CentralizationResult[] | null;
}

function loadScenarios(): ScenarioSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveScenarios(list: ScenarioSnapshot[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota — ignore */
  }
}

function computeMetrics(
  wellData: WellData,
  pressureResult: PressureProfileResult | null,
  volumes: VolumeResults | null,
  cent: CentralizationResult[] | null,
): ScenarioMetrics | null {
  if (!pressureResult || !volumes) return null;
  const maxBHP = Math.max(...pressureResult.points.map((p) => p.bottomholePressure));
  const fracP = pressureResult.points[0]?.fracturePressure ?? 0;
  const flowMax = Math.max(...pressureResult.points.map((p) => p.pumpRateLps || 0));
  const standoffs = cent && cent.length > 0 ? cent.map((c) => c.standoff) : [];
  const cz = cent ? cent.filter((c) => c.hasCentralizer).length : 0;
  return {
    maxBHP,
    fracP,
    ecdRatio: fracP > 0 ? (maxBHP / fracP) * 100 : 0,
    safeTimeMin: pressureResult.safeWorkingTimeMin,
    totalCementM3: volumes.totalSlurryVolume,
    avgStandoff: standoffs.length ? standoffs.reduce((s, v) => s + v, 0) / standoffs.length : 0,
    minStandoff: standoffs.length ? Math.min(...standoffs) : 0,
    centralizerCount: cz,
    flowRateMaxLps: flowMax,
    rotationRpm: 0,
  };
}

export default function ScenarioCompare({ wellData, pressureResult, volumes, centralizationResults }: Props) {
  const [scenarios, setScenarios] = useState<ScenarioSnapshot[]>(() => loadScenarios());
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    saveScenarios(scenarios);
  }, [scenarios]);

  const currentMetrics = useMemo(
    () => computeMetrics(wellData, pressureResult, volumes, centralizationResults),
    [wellData, pressureResult, volumes, centralizationResults],
  );

  const handleSave = () => {
    if (!currentMetrics) return;
    const id = `scn_${Date.now()}`;
    const snap: ScenarioSnapshot = {
      id,
      name: name.trim() || `Сценарий ${scenarios.length + 1}`,
      savedAt: Date.now(),
      wellName: (wellData as { wellName?: string }).wellName || "—",
      metrics: currentMetrics,
    };
    const next = [snap, ...scenarios].slice(0, MAX_SCENARIOS);
    setScenarios(next);
    setName("");
  };

  const handleDelete = (id: string) => {
    setScenarios((s) => s.filter((x) => x.id !== id));
  };

  const handleClear = () => setScenarios([]);

  // Сравнение: считаем «лучшее» значение по каждой колонке, чтобы подсветить
  const compareData = useMemo(() => {
    const rows = scenarios;
    if (rows.length === 0) return null;
    const best = {
      ecdRatio: Math.min(...rows.map((r) => r.metrics.ecdRatio)),       // ниже — лучше
      safeTimeMin: Math.max(...rows.map((r) => r.metrics.safeTimeMin)), // выше — лучше
      totalCementM3: Math.min(...rows.map((r) => r.metrics.totalCementM3)),
      avgStandoff: Math.max(...rows.map((r) => r.metrics.avgStandoff)),
      minStandoff: Math.max(...rows.map((r) => r.metrics.minStandoff)),
    };
    return { rows, best };
  }, [scenarios]);

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4" />
          Сценарии A/B/C — сравнение вариантов
        </CardTitle>
        <Badge variant="outline" className="text-[10px]">
          {scenarios.length}/{MAX_SCENARIOS}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="Название сценария (напр.: «10 центр., 8 л/с, 25 об/мин»)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-xs"
          />
          <Button size="sm" onClick={handleSave} disabled={!currentMetrics} className="shrink-0">
            <Save className="h-4 w-4 mr-1" />
            Сохранить
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={scenarios.length < 2} className="shrink-0">
                <GitCompareArrows className="h-4 w-4 mr-1" />
                Сравнить ({scenarios.length})
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl">
              <DialogHeader>
                <DialogTitle>Сравнение сценариев</DialogTitle>
              </DialogHeader>
              {compareData ? <CompareTable data={compareData} /> : null}
            </DialogContent>
          </Dialog>
        </div>

        {scenarios.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3 border border-dashed rounded-lg">
            Нет сохранённых сценариев. Измените параметры, нажмите «РАСЧЁТ», затем «Сохранить» — и так несколько вариантов для сравнения.
          </p>
        ) : (
          <div className="space-y-1.5">
            {scenarios.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-xs rounded-lg border px-2.5 py-1.5">
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{s.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    ЭЦП {s.metrics.ecdRatio.toFixed(0)}% · Tбез {s.metrics.safeTimeMin.toFixed(0)} мин ·
                    Цем {s.metrics.totalCementM3.toFixed(1)} м³ · Standoff {s.metrics.avgStandoff.toFixed(0)}%
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(s.id)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                  aria-label="Удалить"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {scenarios.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleClear} className="w-full text-xs text-muted-foreground">
                Очистить все
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CompareTable({ data }: { data: { rows: ScenarioSnapshot[]; best: Record<string, number> } }) {
  const { rows, best } = data;

  const isBest = (key: keyof ScenarioMetrics, val: number) => {
    const b = best[key as string];
    return b != null && Math.abs(b - val) < 1e-6;
  };

  const cell = (val: string, highlight: boolean) =>
    highlight ? (
      <td className="text-right py-1.5 px-2 font-mono font-bold text-emerald-600 dark:text-emerald-400">{val}</td>
    ) : (
      <td className="text-right py-1.5 px-2 font-mono">{val}</td>
    );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-2">Параметр</th>
            {rows.map((r) => (
              <th key={r.id} className="text-right py-2 px-2 min-w-[120px]">{r.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border/50">
            <td className="py-1.5 px-2 text-muted-foreground">Скважина</td>
            {rows.map((r) => (
              <td key={r.id} className="text-right py-1.5 px-2">{r.wellName}</td>
            ))}
          </tr>
          <tr className="border-b border-border/50">
            <td className="py-1.5 px-2 text-muted-foreground">Макс. ЗД, МПа</td>
            {rows.map((r) => <td key={r.id} className="text-right py-1.5 px-2 font-mono">{r.metrics.maxBHP.toFixed(1)}</td>)}
          </tr>
          <tr className="border-b border-border/50">
            <td className="py-1.5 px-2 text-muted-foreground">Pгрп, МПа</td>
            {rows.map((r) => <td key={r.id} className="text-right py-1.5 px-2 font-mono">{r.metrics.fracP.toFixed(1)}</td>)}
          </tr>
          <tr className="border-b border-border/50">
            <td className="py-1.5 px-2 text-muted-foreground">ЭЦП / Pгрп, %</td>
            {rows.map((r) => cell(`${r.metrics.ecdRatio.toFixed(0)}%`, isBest("ecdRatio", r.metrics.ecdRatio)))}
          </tr>
          <tr className="border-b border-border/50">
            <td className="py-1.5 px-2 text-muted-foreground">Безоп. время, мин</td>
            {rows.map((r) => cell(r.metrics.safeTimeMin.toFixed(0), isBest("safeTimeMin", r.metrics.safeTimeMin)))}
          </tr>
          <tr className="border-b border-border/50">
            <td className="py-1.5 px-2 text-muted-foreground">Объём цемента, м³</td>
            {rows.map((r) => cell(r.metrics.totalCementM3.toFixed(1), isBest("totalCementM3", r.metrics.totalCementM3)))}
          </tr>
          <tr className="border-b border-border/50">
            <td className="py-1.5 px-2 text-muted-foreground">Standoff ср., %</td>
            {rows.map((r) => cell(`${r.metrics.avgStandoff.toFixed(0)}%`, isBest("avgStandoff", r.metrics.avgStandoff)))}
          </tr>
          <tr className="border-b border-border/50">
            <td className="py-1.5 px-2 text-muted-foreground">Standoff мин., %</td>
            {rows.map((r) => cell(`${r.metrics.minStandoff.toFixed(0)}%`, isBest("minStandoff", r.metrics.minStandoff)))}
          </tr>
          <tr className="border-b border-border/50">
            <td className="py-1.5 px-2 text-muted-foreground">Центраторов, шт</td>
            {rows.map((r) => <td key={r.id} className="text-right py-1.5 px-2 font-mono">{r.metrics.centralizerCount.toFixed(0)}</td>)}
          </tr>
          <tr className="border-b border-border/50">
            <td className="py-1.5 px-2 text-muted-foreground">Макс. расход, л/с</td>
            {rows.map((r) => <td key={r.id} className="text-right py-1.5 px-2 font-mono">{r.metrics.flowRateMaxLps.toFixed(1)}</td>)}
          </tr>
          <tr>
            <td className="py-1.5 px-2 text-muted-foreground">Вращение, об/мин</td>
            {rows.map((r) => <td key={r.id} className="text-right py-1.5 px-2 font-mono">{r.metrics.rotationRpm.toFixed(0)}</td>)}
          </tr>
        </tbody>
      </table>
      <p className="text-[10px] text-muted-foreground mt-3">
        Зелёным выделено лучшее значение по каждому критерию. Используйте для обоснования выбора варианта расстановки центраторов, расхода и режима вращения колонны.
      </p>
    </div>
  );
}
