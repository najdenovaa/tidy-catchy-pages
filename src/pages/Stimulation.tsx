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
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, BarChart, Bar } from "recharts";
import { rankMethods, type ReservoirData, type RankedMethod, scoreColor } from "@/lib/stimulation-ranking";
import { STIMULATION_METHODS, METHOD_CATEGORY_LABEL, COLLECTOR_LABEL, type StimulationMethod, type CollectorType, type MethodCategory } from "@/lib/stimulation-methods";
import { buildAcidStages, computeAcidKinetics, optimalAcidRate } from "@/lib/stimulation-acid";
import WormholeVisualization from "@/components/WormholeVisualization";
import NpvTornado from "@/components/NpvTornado";
import type { SensitivityParam } from "@/lib/foam-treatment-diagnostics";
import {
  diagnoseDamage, fitArpsDecline, forecastPostTreatment, calculateEconomics, DEFAULT_COSTS,
  type DamageAssessment, type ReservoirSnapshot, type Mineralogy, type DrillingHistory,
  type ProductionPoint, type CostInputs,
} from "@/lib/foam-treatment-diagnostics";
import { exportStimulationDocx } from "@/lib/export-stimulation-docx";
import {
  calculateGasIPR, diagnoseGasDamage, WELL_FLUID_LABEL,
  type WellFluidType, type GasDamage,
} from "@/lib/stimulation-gas-ipr";

const TABS = [
  { id: "diag", label: "Диагностика", icon: FlaskConical },
  { id: "method", label: "Метод", icon: Sparkles },
  { id: "calc", label: "Расчёт", icon: Calculator },
  { id: "plan", label: "План", icon: ListChecks },
  { id: "forecast", label: "Прогноз", icon: TrendingUp },
  { id: "econ", label: "Экономика", icon: Activity },
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

  // Mineralogy / drilling
  const [clayPct, setClayPct] = useState(6);
  const [montPct, setMontPct] = useState(2);
  const [perfDensity, setPerfDensity] = useState(20);
  const [mudType, setMudType] = useState<"wbm" | "obm" | "sbm">("wbm");
  const [overbalanceMPa, setOverbalanceMPa] = useState(3);
  const [soakDays, setSoakDays] = useState(7);

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

  // Costs
  const [costs, setCosts] = useState<CostInputs>(DEFAULT_COSTS);

  const isGas = fluidType === "gas" || fluidType === "gas_condensate";
  const rateUnit = isGas ? "тыс.м³/сут" : "м³/сут";
  const priceUnit = isGas ? "₽/тыс.м³" : "₽/м³";

  // ── Derived: build synthetic history ───────────────────────────────
  const history: ProductionPoint[] = useMemo(() => {
    const pts: ProductionPoint[] = [];
    const months = Math.max(3, monthsHistory);
    const d = qInitial > 0 ? Math.log(Math.max(0.05, qCurrent) / qInitial) / months : 0;
    for (let m = 0; m <= months; m++) {
      const q = qInitial * Math.exp(d * m);
      pts.push({ month: m, qOil: q, waterCut });
    }
    return pts;
  }, [qInitial, qCurrent, monthsHistory, waterCut]);

  const reservoirSnap: ReservoirSnapshot = useMemo(() => ({
    Pr: reservoir.reservoirPressureMPa,
    Pb: reservoir.reservoirPressureMPa * 0.7,
    k_mD: reservoir.permeability_mD,
    h: reservoir.payZoneM,
    mu_cP: 1.2,
    Bo: 1.15,
    re: 250,
    rw: 0.108,
    skin: skinCurrent,
    tempC: reservoir.temperatureC,
  }), [reservoir, skinCurrent]);

  const mineralogy: Mineralogy = useMemo(() => ({
    quartz: 60, feldspar: 10, calcite: reservoir.collectorType === "carbonate" ? 80 : 5,
    dolomite: 0, clay: clayPct, montmorillonite: montPct,
  }), [clayPct, montPct, reservoir.collectorType]);

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

  const ranked = useMemo(() => rankMethods(reservoir, damage), [reservoir, damage]);
  const selected = useMemo(() => STIMULATION_METHODS.find((m) => m.id === selectedMethodId)!, [selectedMethodId]);
  const selectedRanked = useMemo(() => ranked.find((r) => r.method.id === selectedMethodId), [ranked, selectedMethodId]);

  const acidVol = useMemo(
    () => selected.volumePerMeterPay * reservoir.payZoneM * selected.numberOfCycles,
    [selected, reservoir]
  );

  const kinetics = useMemo(() => {
    if (selected.category !== "acid" && selected.category !== "foam" && selected.category !== "combo") return null;
    return computeAcidKinetics({
      tempC: reservoir.temperatureC,
      concentration: selected.mainReagent.concentration,
      acidVolumeM3: acidVol,
      payZoneM: reservoir.payZoneM,
      porosity: reservoir.porosity,
      wellboreRadiusM: 0.108,
      collectorType: reservoir.collectorType === "sandstone" ? "sandstone" : "carbonate",
    });
  }, [selected, reservoir, acidVol]);

  const stages = useMemo(() => {
    if (selected.category !== "acid" && selected.category !== "combo") return null;
    return buildAcidStages({
      collectorType: reservoir.collectorType === "sandstone" ? "sandstone" : "carbonate",
      payZoneM: reservoir.payZoneM,
      mainAcidName: selected.mainReagent.name,
      mainAcidVolPerM: selected.volumePerMeterPay,
      tubingVolumeM3: 4.0,
    });
  }, [selected, reservoir]);

  const costEstimate = useMemo(() => {
    const main = acidVol * selected.mainReagent.costPerM3;
    const adds = selected.additives.reduce((s, a) => {
      if (!a.required) return s;
      const perM3 = a.unit === "%" ? a.concentration / 100 * 1000 : a.concentration;
      return s + acidVol * perM3 * a.costPerUnit;
    }, 0);
    return Math.round(main + adds);
  }, [selected, acidVol]);

  // Forecast & economics
  const arps = useMemo(() => fitArpsDecline(history), [history]);
  const forecast = useMemo(() => {
    const dS = (selected.skinReductionRange[0] + selected.skinReductionRange[1]) / 2;
    const skinNew = Math.max(-2, skinCurrent - dS);
    return forecastPostTreatment(arps, reservoirSnap, skinCurrent, skinNew, 36, 0.025);
  }, [arps, reservoirSnap, skinCurrent, selected]);

  const economics = useMemo(() => {
    const c: CostInputs = { ...costs, chemicalCost: costEstimate, n2Cost: selected.requiresN2 ? 300_000 : 0 };
    return calculateEconomics(forecast, c);
  }, [forecast, costs, costEstimate, selected.requiresN2]);

  const chartData = useMemo(() => forecast.map((p) => ({
    month: p.month,
    baseline: Number(p.qBaseline.toFixed(2)),
    treated: Number(p.qTreated.toFixed(2)),
    delta: Number(Math.max(0, p.deltaQ).toFixed(2)),
    cum: Number(p.cumulativeDeltaM3.toFixed(0)),
  })), [forecast]);

  const cashflowData = useMemo(() => economics.monthly.filter((_, i) => i % 2 === 0).map((m) => ({
    month: m.month,
    profit: Math.round(m.cumulativeProfit / 1000),
    npv: Math.round(m.cumulativeProfitDiscounted / 1000),
  })), [economics]);

  async function handleExport() {
    try {
      await exportStimulationDocx({
        reservoir, method: selected, ranked: selectedRanked,
        acidVolM3: acidVol, costEstimate, damage, kinetics, stages, forecast, economics, wellName,
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
          <span className="text-xs text-muted-foreground hidden sm:inline">КРС · Стимуляция</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 sm:grid-cols-7 h-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="text-xs sm:text-sm py-2 gap-1.5">
                <t.icon className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ─────────── DIAGNOSTICS ─────────── */}
          <TabsContent value="diag" className="space-y-4 mt-4">
            <Card className="p-4 space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="font-semibold">Тип скважины</h2>
                <Badge variant="outline" className="text-xs">{WELL_FLUID_LABEL[fluidType]}</Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <Label>Флюид</Label>
                  <Select value={fluidType} onValueChange={(v) => setFluidType(v as WellFluidType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(WELL_FLUID_LABEL) as WellFluidType[]).map((k) => (
                        <SelectItem key={k} value={k}>{WELL_FLUID_LABEL[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {isGas && (
                  <>
                    <Field label="γ газа (возд.=1)" value={gasGravity} onChange={setGasGravity} step={0.01} />
                    <Field label="Z-фактор (0=авто Papay)" value={zFactorManual} onChange={setZFactorManual} step={0.01} />
                    <Field label="P забоя текущая, МПа" value={bhpCurrentMPa} onChange={setBhpCurrentMPa} step={0.5} />
                  </>
                )}
                {fluidType === "gas_condensate" && (
                  <>
                    <Field label="P росы, МПа" value={dewPointMPa} onChange={setDewPointMPa} step={0.5} />
                    <Field label="КГФ, см³/м³" value={condGasRatio} onChange={setCondGasRatio} step={10} />
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
                </div>
                <div className="space-y-1">
                  <Label>Тип коллектора</Label>
                  <Select value={reservoir.collectorType} onValueChange={(v) => setReservoir({ ...reservoir, collectorType: v as CollectorType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(COLLECTOR_LABEL) as CollectorType[]).map((k) => (
                        <SelectItem key={k} value={k}>{COLLECTOR_LABEL[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Field label="T пласта, °C" value={reservoir.temperatureC} onChange={(v) => setReservoir({ ...reservoir, temperatureC: v })} />
                <Field label="k, мД" value={reservoir.permeability_mD} onChange={(v) => setReservoir({ ...reservoir, permeability_mD: v })} step={0.1} />
                <Field label="Пористость, д.ед." value={reservoir.porosity} onChange={(v) => setReservoir({ ...reservoir, porosity: v })} step={0.01} />
                <Field label="h эфф, м" value={reservoir.payZoneM} onChange={(v) => setReservoir({ ...reservoir, payZoneM: v })} step={0.5} />
                <Field label="P пл, МПа" value={reservoir.reservoirPressureMPa} onChange={(v) => setReservoir({ ...reservoir, reservoirPressureMPa: v })} step={0.5} />
                <Field label="Текущий скин" value={skinCurrent} onChange={setSkinCurrent} step={0.5} />
              </div>
            </Card>

            <Card className="p-4 space-y-4">
              <h2 className="font-semibold">История добычи</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label={`Q начальный, ${rateUnit}`} value={qInitial} onChange={setQInitial} />
                <Field label={`Q текущий, ${rateUnit}`} value={qCurrent} onChange={setQCurrent} />
                <Field label={isGas ? "Влагосодержание, %" : "Обводнённость, %"} value={waterCut} onChange={setWaterCut} />
                <Field label="Период истории, мес" value={monthsHistory} onChange={setMonthsHistory} />
              </div>
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

            <Card className="p-4 space-y-4">
              <h2 className="font-semibold">Минералогия и заканчивание</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Field label="Глинистость, %" value={clayPct} onChange={setClayPct} step={0.5} />
                <Field label="Монтмориллонит, %" value={montPct} onChange={setMontPct} step={0.5} />
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
              <Stat label="Расход" value={`${selected.recommendedRate[0]}–${selected.recommendedRate[1]} л/мин`} />
              <Stat label="Выдержка" value={`${selected.soakTimeMin[0]}–${selected.soakTimeMin[1]} мин`} />
              <Stat label="Ожидаемое ΔS" value={`-${selected.skinReductionRange[0]}…-${selected.skinReductionRange[1]}`} sub={`Эффект ${selected.effectDurationMonths[0]}–${selected.effectDurationMonths[1]} мес`} />
              <Stat label="Успешность" value={`${selected.successRate}%`} />
              <Stat label="Стоимость реагентов" value={`${(costEstimate / 1000).toFixed(0)} тыс.₽`} />
            </div>

            {kinetics && (
              <Card className="p-4 space-y-4">
                <h3 className="font-semibold">Кинетика и проникновение</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <KV k="Скорость реакции" v={`${kinetics.reactionRate.toExponential(2)} моль/(м²·с)`} />
                  <KV k="Радиус проникновения" v={`${kinetics.penetrationRadius.toFixed(2)} м`} />
                  {kinetics.wormholeLength > 0 && <KV k="Длина wormhole" v={`${kinetics.wormholeLength.toFixed(2)} м`} />}
                  <KV k="Растворено породы" v={`${kinetics.dissolutionVolume.toFixed(2)} м³`} />
                  <KV k="Отработанной кислоты" v={`${kinetics.spentAcidVolume.toFixed(2)} м³`} />
                  <KV k="Остаточная конц." v={`${kinetics.residualAcidConcentration.toFixed(1)}%`} />
                </div>
                {/* Wormhole visualization (Da-режим) */}
                {(() => {
                  const qOptLpm = optimalAcidRate(
                    reservoir.permeability_mD, reservoir.porosity, reservoir.temperatureC, 0.216
                  );
                  const qActual = (selected.recommendedRate[0] + selected.recommendedRate[1]) / 2;
                  const damkohler = 0.29 * (qOptLpm / Math.max(1, qActual));
                  return (
                    <WormholeVisualization
                      wormholeLengthM={kinetics.wormholeLength}
                      penetrationRadiusM={kinetics.penetrationRadius}
                      wellboreRadiusM={0.108}
                      damkohler={damkohler}
                    />
                  );
                })()}
              </Card>
            )}

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Рецептура и добавки</h3>
              <div className="space-y-2 text-sm">
                <div className="font-medium">Основа: {selected.mainReagent.name} ({selected.mainReagent.concentration}%, ρ={selected.mainReagent.density} г/см³)</div>
                {selected.additives.length === 0 && <div className="text-muted-foreground text-xs">Добавки не требуются</div>}
                {selected.additives.map((a, i) => (
                  <div key={i} className="flex items-center justify-between border-b border-border/40 pb-1">
                    <span>{a.required ? "● " : "○ "}{a.name} <span className="text-xs text-muted-foreground">— {a.purpose}</span></span>
                    <span className="text-xs">{a.concentration} {a.unit}</span>
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>

          {/* ─────────── PLAN ─────────── */}
          <TabsContent value="plan" className="space-y-4 mt-4">
            {stages ? (
              <Card className="p-4 space-y-3">
                <h3 className="font-semibold">Многоступенчатая обработка</h3>
                <StageRow n="1. Preflush" {...stages.preflush} />
                <StageRow n="2. Основная кислота" {...stages.mainAcid} />
                <StageRow n="3. Afterflush" {...stages.afterflush} />
                <StageRow n="4. Продавка" fluid={stages.displacement.fluid} volumeM3={stages.displacement.volumeM3} purpose="Доставка реагентов в пласт" />
                <div className="border-t pt-2 text-sm font-medium">Итого: {stages.totalVolumeM3.toFixed(1)} м³</div>
              </Card>
            ) : (
              <Card className="p-4 text-sm text-muted-foreground">
                Детальная циклограмма формируется для кислотных и комбинированных методов.
              </Card>
            )}

            <Card className="p-4">
              <h3 className="font-semibold mb-2">Шаги операции</h3>
              <ol className="text-sm space-y-1 list-decimal pl-5">
                <li>Подготовка устья, опрессовка линий на 1.5×Pзак</li>
                <li>Закачка preflush (если применимо)</li>
                <li>Закачка основного реагента на режиме {selected.recommendedRate[0]}–{selected.recommendedRate[1]} л/мин</li>
                {selected.requiresN2 && <li>Поддержание FQ = {selected.targetFoamQuality}% по линии N₂</li>}
                <li>Продавка скважинной жидкостью</li>
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
          </TabsContent>

          {/* ─────────── ECONOMICS ─────────── */}
          <TabsContent value="econ" className="space-y-4 mt-4">
            <Card className="p-4 space-y-3">
              <h3 className="font-semibold">Стоимостные параметры</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Мобилизация, ₽" value={costs.mobilization} onChange={(v) => setCosts({ ...costs, mobilization: v })} step={50000} />
                <Field label="Дней оборудование" value={costs.equipmentDays} onChange={(v) => setCosts({ ...costs, equipmentDays: v })} />
                <Field label="Дней бригада" value={costs.crewDays} onChange={(v) => setCosts({ ...costs, crewDays: v })} />
                <Field label={`Цена ${isGas ? "газа" : "нефти"}, ${priceUnit}`} value={costs.oilPricePerM3} onChange={(v) => setCosts({ ...costs, oilPricePerM3: v })} step={500} />
                <Field label="Ставка дисконт., д.ед./год" value={costs.discountRateAnnual} onChange={(v) => setCosts({ ...costs, discountRateAnnual: v })} step={0.01} />
              </div>
            </Card>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Полная стоимость" value={`${(economics.totalCost / 1e6).toFixed(2)} млн ₽`} />
              <Stat label="Доход" value={`${(economics.incrementalRevenue / 1e6).toFixed(2)} млн ₽`} />
              <Stat label="NPV" value={`${(economics.npv / 1e6).toFixed(2)} млн ₽`} sub={`ROI ${economics.roi.toFixed(1)}%`} />
              <Stat label="Окупаемость" value={economics.paybackMonths === null ? "не окуп." : `${economics.paybackMonths} мес`} />
            </div>

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Кэшфлоу (тыс. ₽)</h3>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={cashflowData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" />
                    <YAxis stroke="hsl(var(--muted-foreground))" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Legend />
                    <Bar dataKey="profit" fill="hsl(var(--primary))" name="Накоп. прибыль" />
                    <Bar dataKey="npv" fill="hsl(var(--muted-foreground))" name="NPV" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Tornado: чувствительность NPV */}
            <Card className="p-4">
              {(() => {
                const baseNPV = economics.npv;
                const revenueDisc = baseNPV + economics.totalCost;       // выручка дисконтированная
                const baseOilPrice = costs.oilPricePerM3;
                const baseChem = costEstimate;
                const baseDeltaSkin = (selected.skinReductionRange[0] + selected.skinReductionRange[1]) / 2;
                const baseMobil = costs.mobilization;
                const params: SensitivityParam[] = [
                  {
                    name: `Цена ${isGas ? "газа" : "нефти"}`,
                    baseValue: baseOilPrice,
                    variation: 0.25,
                    evaluate: (v) => revenueDisc * (v / baseOilPrice) - economics.totalCost,
                  },
                  {
                    name: "Стоимость реагентов",
                    baseValue: baseChem,
                    variation: 0.3,
                    evaluate: (v) => baseNPV - (v - baseChem),
                  },
                  {
                    name: "Снятие скина ΔS",
                    baseValue: baseDeltaSkin,
                    variation: 0.4,
                    evaluate: (v) => revenueDisc * (v / Math.max(0.1, baseDeltaSkin)) - economics.totalCost,
                  },
                  {
                    name: "Мобилизация",
                    baseValue: baseMobil,
                    variation: 0.3,
                    evaluate: (v) => baseNPV - (v - baseMobil),
                  },
                ];
                return <NpvTornado baseNPV={baseNPV} params={params} />;
              })()}
            </Card>
          </TabsContent>


          {/* ─────────── REPORT ─────────── */}
          <TabsContent value="report" className="space-y-4 mt-4">
            <Card className="p-4 space-y-3">
              <h3 className="font-semibold">DOCX-отчёт</h3>
              <p className="text-sm text-muted-foreground">
                Полная план-программа ОПЗ: коллектор, диагностика повреждений, выбранный метод,
                рецептура, многоступенчатая обработка, кинетика, прогноз 36 мес, экономика.
              </p>
              <Button onClick={handleExport}>
                <FileText className="w-4 h-4 mr-2" /> Скачать план-программу (DOCX)
              </Button>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <footer className="border-t border-border bg-card mt-10">
        <div className="max-w-6xl mx-auto px-4 py-4 text-xs text-muted-foreground text-center">
          Расчёты носят информационный характер. Соответствует требованиям ФЗ-152.{" "}
          <Link to="/terms" className="hover:text-foreground transition-colors underline">Пользовательское соглашение</Link>
        </div>
      </footer>
    </div>
  );
}

function Field({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
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
