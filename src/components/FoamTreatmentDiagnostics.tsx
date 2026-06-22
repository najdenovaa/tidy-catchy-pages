import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine, ReferenceDot, ComposedChart, Area, Scatter,
} from "recharts";
import {
  AlertTriangle, CheckCircle2, TrendingUp, Wallet, Activity, Plus, Trash2,
} from "lucide-react";
import {
  calculateIPR,
  decomposeSkin,
  diagnoseDamage,
  fitArpsDecline,
  forecastPostTreatment,
  foamApparentViscosity,
  mobilityReductionFactor,
  calculateInjectivity,
  penetrationRadius,
  hawkinsWaterfall,
  interpretStepRateTest,
  type ReservoirSnapshot,
  type Mineralogy,
  type DrillingHistory,
  type CollectorType,
  type ProductionPoint,
  type DamageAssessment,
  type StepRatePoint,
} from "@/lib/foam-treatment-diagnostics";


const fmt = (v: number | undefined | null, d = 1) =>
  v === undefined || v === null || !Number.isFinite(v) ? "—" : v.toFixed(d);

const fmtMoney = (v: number) => {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)} млн ₽`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)} тыс ₽`;
  return `${v.toFixed(0)} ₽`;
};

const SEV_COLOR: Record<DamageAssessment["severity"], string> = {
  low: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  medium: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  high: "bg-red-500/15 text-red-600 border-red-500/30",
};

const COLLECTOR_OPTIONS: { value: CollectorType; label: string }[] = [
  { value: "sandstone", label: "Терриген (песчаник)" },
  { value: "carbonate", label: "Карбонат" },
  { value: "fractured", label: "Трещиноватый" },
  { value: "tight", label: "Низкопроницаемый" },
];

export interface FoamTreatmentDiagnosticsProps {
  /** Скважинные данные из родителя для предзаполнения. */
  well: {
    netPayM: number;
    permeability_mD: number;
    porosity: number;
    reservoirPressureMPa: number;
    reservoirTemperatureC: number;
    skinFactor: number;
    perfDensity: number;
    currentRateTpd?: number;
    oilViscosityCp?: number;
    oilFVF?: number;
    drainageRadiusM?: number;
  };
  /** Ожидаемое снижение скина из рассчитанной рецептуры (для прогноза). */
  expectedSkinReduction: number;
  /** Зенитный угол на интервале перфорации, ° (опционально). */
  zenithDeg?: number;
  /** Опционально: объём раствора (для расчёта радиуса проникновения). */
  treatmentVolumeM3?: number;
  /** Опционально: качество пены на забое, % (для радиуса и μ_app). */
  foamQualityAtFormationPct?: number;
  /** Опционально: концентрация ПАВ в рецептуре, %. */
  surfactantPct?: number;
  /** Опционально: вязкость базовой жидкости, сПз. */
  baseFluidViscosityCp?: number;
  /** Callback: применить рецепт из авто-диагностики. */
  onApplyRecipe?: (recipeId: string) => void;
  /** Callback: бандл всех расчётов для DOCX-экспорта. */
  onDataChange?: (bundle: import("@/lib/export-foam-treatment-docx").FoamDiagnosticsBundle) => void;
}



const DEFAULT_MINERALOGY: Mineralogy = {
  quartz: 65, feldspar: 10, calcite: 5, dolomite: 2, clay: 12, montmorillonite: 4,
};

const DEFAULT_DRILLING: DrillingHistory = {
  mudType: "wbm", mudWeight: 1.18, overbalanceMPa: 3.5, soakTimeDays: 8,
};

const DEFAULT_HISTORY: ProductionPoint[] = [
  { month: 0,  qOil: 12, waterCut: 5,  bhpMPa: 16 },
  { month: 3,  qOil: 10, waterCut: 12, bhpMPa: 16 },
  { month: 6,  qOil: 8,  waterCut: 22, bhpMPa: 15 },
  { month: 9,  qOil: 6.5, waterCut: 32, bhpMPa: 15 },
  { month: 12, qOil: 5,  waterCut: 45, bhpMPa: 14 },
];

export default function FoamTreatmentDiagnostics({
  well, expectedSkinReduction, zenithDeg = 0,
  treatmentVolumeM3, foamQualityAtFormationPct, surfactantPct = 0.5, baseFluidViscosityCp = 1,
  onApplyRecipe, onDataChange,
}: FoamTreatmentDiagnosticsProps) {
  /* ── Состояние ── */
  const [collector, setCollector] = useState<CollectorType>("sandstone");
  const [mineralogy, setMineralogy] = useState<Mineralogy>(DEFAULT_MINERALOGY);
  const [drilling, setDrilling] = useState<DrillingHistory>(DEFAULT_DRILLING);
  const [history, setHistory] = useState<ProductionPoint[]>(DEFAULT_HISTORY);
  const [srtPoints, setSrtPoints] = useState<StepRatePoint[]>([
    { rate: 50,  pressure: 8 },
    { rate: 100, pressure: 11 },
    { rate: 150, pressure: 14 },
    { rate: 200, pressure: 17 },
    { rate: 250, pressure: 19 },
    { rate: 300, pressure: 20 },
    { rate: 350, pressure: 21 },
  ]);

  /** Сколько от рассчитанного ΔS реально достигнем (0..1). */

  const [efficiencyFactor, setEfficiencyFactor] = useState(0.8);
  /** Скорость возврата скина, %/мес */
  const [skinRecoveryPct, setSkinRecoveryPct] = useState(2);

  /* ── Снимок пласта ── */
  const reservoir: ReservoirSnapshot = useMemo(() => ({
    Pr: well.reservoirPressureMPa,
    Pb: Math.max(8, well.reservoirPressureMPa * 0.6),
    k_mD: well.permeability_mD,
    h: well.netPayM,
    mu_cP: well.oilViscosityCp ?? 4,
    Bo: well.oilFVF ?? 1.15,
    re: well.drainageRadiusM ?? 500,
    rw: 0.1,
    skin: well.skinFactor,
    tempC: well.reservoirTemperatureC,
  }), [well]);

  const skinNew = Math.max(-2, well.skinFactor - expectedSkinReduction * efficiencyFactor);

  /* ── Расчёты ── */
  const ipr = useMemo(() => calculateIPR(reservoir, history), [reservoir, history]);
  const iprAfter = useMemo(
    () => calculateIPR({ ...reservoir, skin: skinNew }, history),
    [reservoir, skinNew, history],
  );
  const skinDecomp = useMemo(
    () => decomposeSkin(reservoir.skin, reservoir, zenithDeg, well.perfDensity),
    [reservoir, zenithDeg, well.perfDensity],
  );
  const damage = useMemo(
    () => diagnoseDamage(reservoir, mineralogy, collector, history, drilling, well.perfDensity),
    [reservoir, mineralogy, collector, history, drilling, well.perfDensity],
  );
  const arps = useMemo(() => fitArpsDecline(history), [history]);
  const forecast = useMemo(
    () => forecastPostTreatment(arps, reservoir, reservoir.skin, skinNew, 36, skinRecoveryPct / 100),
    [arps, reservoir, skinNew, skinRecoveryPct],
  );
  // (экономика убрана — модуль инженерный; финансы заказчик считает отдельно)


  /* ── Реология пены, приёмистость, радиус ── */
  const fqAtBottom = (foamQualityAtFormationPct ?? 70) / 100;
  const injectivity = useMemo(
    () => calculateInjectivity(reservoir.k_mD, reservoir.h, reservoir.mu_cP, reservoir.re, reservoir.rw, reservoir.skin),
    [reservoir],
  );
  const injectivityAfter = useMemo(
    () => calculateInjectivity(reservoir.k_mD, reservoir.h, reservoir.mu_cP, reservoir.re, reservoir.rw, skinNew),
    [reservoir, skinNew],
  );
  const mrf = useMemo(() => mobilityReductionFactor(fqAtBottom, surfactantPct), [fqAtBottom, surfactantPct]);

  // μ_app vs FQ для трёх скоростей фильтрации
  const rheologyData = useMemo(() => {
    const rows: Array<{ fq: number; vFast: number; vMed: number; vSlow: number }> = [];
    for (let i = 0; i <= 18; i++) {
      const fq = i * 0.05; // 0..0.90
      rows.push({
        fq: Math.round(fq * 100),
        vFast: foamApparentViscosity(fq, baseFluidViscosityCp, reservoir.k_mD, 1e-3, surfactantPct),
        vMed:  foamApparentViscosity(fq, baseFluidViscosityCp, reservoir.k_mD, 1e-4, surfactantPct),
        vSlow: foamApparentViscosity(fq, baseFluidViscosityCp, reservoir.k_mD, 1e-5, surfactantPct),
      });
    }
    return rows;
  }, [baseFluidViscosityCp, reservoir.k_mD, surfactantPct]);

  // Радиус проникновения (если задан объём)
  const radiusInfo = useMemo(() => {
    if (!treatmentVolumeM3 || treatmentVolumeM3 <= 0) return null;
    const r = penetrationRadius(treatmentVolumeM3, reservoir.h, well.porosity ?? 0.18, 0.2, reservoir.rw, fqAtBottom);
    return { r, rDamage: 0.5, rWell: reservoir.rw };
  }, [treatmentVolumeM3, reservoir, fqAtBottom, well.porosity]);

  // (Tornado NPV убран — финансы вне инженерного контура)



  /* ── Hawkins waterfall ── */
  const waterfall = useMemo(
    () => hawkinsWaterfall(reservoir.skin, reservoir, damage, Math.max(0.1, expectedSkinReduction * efficiencyFactor)),
    [reservoir, damage, expectedSkinReduction, efficiencyFactor],
  );

  // Waterfall chart data: floating bars (running skin with delta segments)
  const waterfallChart = useMemo(() => {
    const rows: Array<{ label: string; base: number; delta: number; skinAfter: number; fill: string }> = [
      { label: "Скин до", base: 0, delta: reservoir.skin, skinAfter: reservoir.skin, fill: "hsl(0 70% 55%)" },
    ];
    let running = reservoir.skin;
    waterfall.forEach((st) => {
      const newRun = st.skinAfter;
      // floating bar: base = min(running,newRun), delta = |running - newRun|, sign negative
      const base = Math.min(running, newRun);
      const height = Math.abs(running - newRun);
      rows.push({
        label: st.label,
        base,
        delta: height,
        skinAfter: newRun,
        fill: "hsl(160 60% 45%)",
      });
      running = newRun;
    });
    rows.push({ label: "Скин после", base: 0, delta: running, skinAfter: running, fill: "hsl(220 80% 55%)" });
    return rows;
  }, [waterfall, reservoir.skin]);

  /* ── Step-Rate Test интерпретация ── */
  const srt = useMemo(() => interpretStepRateTest(srtPoints), [srtPoints]);
  const srtChartData = useMemo(() => {
    const scatter = srtPoints.map((p) => ({ rate: p.rate, pActual: p.pressure }));
    return scatter;
  }, [srtPoints]);

  /* ── Эмиссия бандла наверх для DOCX-экспорта ── */
  useEffect(() => {
    if (!onDataChange) return;
    onDataChange({
      ipr,
      iprAfterFE: iprAfter.flowEfficiency,
      skinDecomp,
      skinBefore: reservoir.skin,
      skinAfter: skinNew,
      damage,
      arps: { qi: arps.qi, di: arps.di, b: arps.b, r2: arps.r2, type: arps.type },
      forecast: {
        incrementalOilM3: economics.incrementalOilM3,
        firstYearBoostPct: forecast.length > 12 && forecast[0].qBaseline > 0
          ? ((forecast[12].qTreated - forecast[12].qBaseline) / forecast[12].qBaseline) * 100
          : 0,
      },
      economics: {
        totalCost: economics.totalCost,
        netProfit: economics.netProfit,
        roi: economics.roi,
        npv: economics.npv,
        paybackMonths: economics.paybackMonths,
      },
      waterfall,
      srt,
      injectivityBefore: injectivity,
      injectivityAfter: injectivityAfter,
      mrf,
      penetrationRadiusM: radiusInfo?.r ?? null,
    });
  }, [onDataChange, ipr, iprAfter, skinDecomp, reservoir.skin, skinNew, damage, arps, economics, forecast, waterfall, srt, injectivity, injectivityAfter, mrf, radiusInfo]);







  /* ── Charts data ── */
  const iprChartData = ipr.iprCurve.map((p, i) => ({
    bhp: p.bhp,
    qBefore: p.qOil,
    qAfter: iprAfter.iprCurve[i]?.qOil ?? 0,
  }));

  const skinBars = [
    { name: "Повреждение", value: skinDecomp.skinDamage, fill: "hsl(0 70% 55%)" },
    { name: "Механич.", value: skinDecomp.skinMechanical, fill: "hsl(35 80% 55%)" },
    { name: "Псевдо", value: skinDecomp.skinPseudo, fill: "hsl(45 80% 55%)" },
    { name: "Наклон", value: skinDecomp.skinDeviation, fill: "hsl(160 60% 45%)" },
    { name: "Итого", value: skinDecomp.totalSkin, fill: "hsl(220 80% 55%)" },
  ];

  const historyChartData = history.map((h) => {
    const pred = arps.qi / Math.pow(
      1 + (arps.b || 0.001) * arps.di * h.month,
      1 / Math.max(0.001, arps.b),
    );
    return { month: h.month, actual: h.qOil, fitted: pred };
  });

  /* ── Handlers ── */
  const updHistoryRow = (i: number, patch: Partial<ProductionPoint>) =>
    setHistory((h) => h.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const addHistoryRow = () =>
    setHistory((h) => [
      ...h,
      { month: (h[h.length - 1]?.month ?? 0) + 3, qOil: h[h.length - 1]?.qOil ?? 5, waterCut: 0, bhpMPa: reservoir.Pr * 0.7 },
    ]);
  const removeHistoryRow = (i: number) => setHistory((h) => h.filter((_, idx) => idx !== i));

  const updSrtRow = (i: number, patch: Partial<StepRatePoint>) =>
    setSrtPoints((s) => s.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const addSrtRow = () =>
    setSrtPoints((s) => [
      ...s,
      { rate: (s[s.length - 1]?.rate ?? 0) + 50, pressure: (s[s.length - 1]?.pressure ?? 0) + 1 },
    ]);
  const removeSrtRow = (i: number) => setSrtPoints((s) => s.filter((_, idx) => idx !== i));

  const num = (s: string) => {
    const n = parseFloat(s.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          Диагностика, прогноз и экономика
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          IPR (Вогель/Дюпюи) → декомпозиция скина → авто-диагностика повреждения → Арпс → прогноз добычи → NPV/ROI/окупаемость.
        </p>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ───── Ввод: коллектор, минералогия, бурение ───── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Коллектор</h4>
            <Select value={collector} onValueChange={(v) => setCollector(v as CollectorType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {COLLECTOR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground pt-2">Минералогия, %</h4>
            <div className="grid grid-cols-2 gap-2">
              {(["clay", "montmorillonite", "calcite", "quartz"] as const).map((k) => (
                <div key={k} className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">
                    {k === "clay" ? "Глины"
                      : k === "montmorillonite" ? "Монтмориллонит"
                      : k === "calcite" ? "Кальцит"
                      : "Кварц"}
                  </Label>
                  <Input type="number" step="1" value={mineralogy[k]}
                    onChange={(e) => setMineralogy({ ...mineralogy, [k]: num(e.target.value) })} />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">История бурения</h4>
            <div className="space-y-2">
              <Label className="text-[10px] text-muted-foreground">Тип бурового раствора</Label>
              <Select value={drilling.mudType} onValueChange={(v) => setDrilling({ ...drilling, mudType: v as DrillingHistory["mudType"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="wbm">ВБР (на воде)</SelectItem>
                  <SelectItem value="obm">НБР (на нефти)</SelectItem>
                  <SelectItem value="sbm">Синтетический</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">ρ, г/см³</Label>
                <Input type="number" step="0.01" value={drilling.mudWeight}
                  onChange={(e) => setDrilling({ ...drilling, mudWeight: num(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Δp, МПа</Label>
                <Input type="number" step="0.1" value={drilling.overbalanceMPa}
                  onChange={(e) => setDrilling({ ...drilling, overbalanceMPa: num(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Контакт, сут</Label>
                <Input type="number" step="1" value={drilling.soakTimeDays}
                  onChange={(e) => setDrilling({ ...drilling, soakTimeDays: num(e.target.value) })} />
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Эффективность обработки</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <Label>Доля от расчётного ΔS</Label>
                <span className="font-mono">{(efficiencyFactor * 100).toFixed(0)}%</span>
              </div>
              <Slider value={[efficiencyFactor]} min={0.3} max={1} step={0.05}
                onValueChange={(a) => setEfficiencyFactor(a[0])} />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <Label>Скин возвращается, %/мес</Label>
                <span className="font-mono">{skinRecoveryPct.toFixed(1)}</span>
              </div>
              <Slider value={[skinRecoveryPct]} min={0} max={8} step={0.5}
                onValueChange={(a) => setSkinRecoveryPct(a[0])} />
            </div>
            <div className="rounded-md bg-primary/10 px-3 py-2 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Скин до:</span>
                <span className="font-mono">{fmt(reservoir.skin, 1)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Скин после:</span>
                <span className="font-mono text-emerald-600">{fmt(skinNew, 1)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Расчётный ΔS:</span>
                <span className="font-mono">−{fmt(expectedSkinReduction, 1)}</span></div>
            </div>
          </div>
        </div>

        {/* ───── История добычи ───── */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold">История добычи</h4>
            <Button size="sm" variant="outline" onClick={addHistoryRow}>
              <Plus className="w-4 h-4 mr-1" /> Точка
            </Button>
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium text-muted-foreground">Мес.</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">qн, м³/сут</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Обв., %</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground">Pзаб, МПа</th>
                  <th className="px-3 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {history.map((p, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2 py-1"><Input className="h-8" type="number" value={p.month}
                      onChange={(e) => updHistoryRow(i, { month: num(e.target.value) })} /></td>
                    <td className="px-2 py-1"><Input className="h-8" type="number" step="0.1" value={p.qOil}
                      onChange={(e) => updHistoryRow(i, { qOil: num(e.target.value) })} /></td>
                    <td className="px-2 py-1"><Input className="h-8" type="number" value={p.waterCut ?? 0}
                      onChange={(e) => updHistoryRow(i, { waterCut: num(e.target.value) })} /></td>
                    <td className="px-2 py-1"><Input className="h-8" type="number" step="0.1" value={p.bhpMPa ?? 0}
                      onChange={(e) => updHistoryRow(i, { bhpMPa: num(e.target.value) })} /></td>
                    <td className="px-2 py-1 text-right">
                      <Button size="icon" variant="ghost" onClick={() => removeHistoryRow(i)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ───── Авто-диагностика повреждения ───── */}
        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Вероятные механизмы повреждения ПЗП
          </h4>
          {damage.length === 0 ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              По введённым данным значимых механизмов повреждения не обнаружено.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {damage.map((d) => (
                <div key={d.mechanism} className={`rounded-lg border p-3 ${SEV_COLOR[d.severity]}`}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h5 className="font-semibold text-sm">{d.nameRu}</h5>
                    <Badge variant="outline" className="text-[10px]">{(d.probability * 100).toFixed(0)}%</Badge>
                  </div>
                  <p className="text-xs opacity-90 mb-1">{d.evidence}</p>
                  <div className="flex items-center justify-between mt-1 gap-2">
                    <p className="text-[11px] opacity-75">Рецепт: <code className="font-mono">{d.recommendedRecipeId}</code></p>
                    {onApplyRecipe && (
                      <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                        onClick={() => onApplyRecipe(d.recommendedRecipeId)}>
                        Применить
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ───── Метрики IPR / скин ───── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricBox label="J идеальная" value={`${fmt(ipr.J_ideal, 2)} м³/сут·МПа`} />
          <MetricBox label="J фактическая" value={`${fmt(ipr.J_actual, 2)} м³/сут·МПа`} />
          <MetricBox label="Flow efficiency" value={`${fmt(ipr.flowEfficiency * 100, 0)}%`}
            tone={ipr.flowEfficiency < 0.5 ? "warn" : "ok"} />
          <MetricBox label="AOF (до)" value={`${fmt(ipr.qMax_vogel, 1)} м³/сут`} />
        </div>

        {/* ───── Графики ───── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* IPR before/after */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="text-sm font-semibold mb-2">IPR: до и после обработки</h4>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={iprChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="qBefore" type="number" name="q" label={{ value: "Q, м³/сут", position: "insideBottom", offset: -3 }} />
                <YAxis dataKey="bhp" label={{ value: "Pзаб, МПа", angle: -90, position: "insideLeft" }} />
                <Tooltip />
                <Legend />
                <Line dataKey="qBefore" data={iprChartData} stroke="hsl(0 70% 55%)" dot={false} name="До" />
                <Line dataKey="qAfter" data={iprChartData} stroke="hsl(160 60% 45%)" dot={false} name="После" />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground mt-1">Чем правее кривая — тем выше дебит при том же забойном давлении.</p>
          </div>

          {/* Skin decomposition */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="text-sm font-semibold mb-2">Декомпозиция скин-фактора</h4>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={skinBars}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis label={{ value: "S", angle: -90, position: "insideLeft" }} />
                <Tooltip />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Bar dataKey="value">
                  {skinBars.map((b, i) => <Cell key={i} fill={b.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground mt-1">
              k_d = {fmt(skinDecomp.damagedPermeability, 1)} мД (k/k_d = {fmt(skinDecomp.damageRatio, 1)}),
              r_d = {fmt(skinDecomp.damagedZoneRadius, 2)} м.
            </p>
          </div>

          {/* Arps fit */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="text-sm font-semibold mb-2">
              Кривая Арпса · {arps.type} · b = {fmt(arps.b, 2)} · R² = {fmt(arps.r2, 2)}
            </h4>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={historyChartData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" label={{ value: "Мес.", position: "insideBottom", offset: -3 }} />
                <YAxis label={{ value: "q, м³/сут", angle: -90, position: "insideLeft" }} />
                <Tooltip />
                <Legend />
                <Line dataKey="actual" stroke="hsl(217 91% 60%)" name="Факт" />
                <Line dataKey="fitted" stroke="hsl(280 70% 60%)" strokeDasharray="5 5" dot={false} name="Подбор" />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground mt-1">
              qi = {fmt(arps.qi, 1)} м³/сут, di = {fmt(arps.di * 12, 3)} 1/год{arps.eurM3 ? `, EUR ≈ ${fmt(arps.eurM3 / 1000, 1)} тыс. м³` : ""}.
            </p>
          </div>

          {/* Production forecast */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              Прогноз дебита, 36 мес
            </h4>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={forecast}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="month" label={{ value: "Мес.", position: "insideBottom", offset: -3 }} />
                <YAxis yAxisId="L" label={{ value: "q, м³/сут", angle: -90, position: "insideLeft" }} />
                <YAxis yAxisId="R" orientation="right" label={{ value: "Накопл. ΔQ, м³", angle: 90, position: "insideRight" }} />
                <Tooltip />
                <Legend />
                <Area yAxisId="R" dataKey="cumulativeDeltaM3" fill="hsl(160 60% 45% / 0.2)" stroke="hsl(160 60% 45%)" name="Накопл. прирост" />
                <Line yAxisId="L" dataKey="qBaseline" stroke="hsl(0 70% 55%)" dot={false} name="Без обработки" />
                <Line yAxisId="L" dataKey="qTreated" stroke="hsl(160 60% 45%)" dot={false} name="С обработкой" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ───── Экономика ───── */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-primary" />
            <h4 className="text-sm font-semibold">Экономика операции</h4>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Реагенты, ₽</Label>
              <Input type="number" value={chemCost} onChange={(e) => setChemCost(num(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">N₂, ₽</Label>
              <Input type="number" value={n2Cost} onChange={(e) => setN2Cost(num(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Техника, сут</Label>
              <Input type="number" step="0.5" value={equipDays} onChange={(e) => setEquipDays(num(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Бригада КРС, сут</Label>
              <Input type="number" step="0.5" value={crewDays} onChange={(e) => setCrewDays(num(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Цена нефти, ₽/м³</Label>
              <Input type="number" value={oilPrice} onChange={(e) => setOilPrice(num(e.target.value))} />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricBox label="Затраты" value={fmtMoney(economics.totalCost)} tone="warn" />
            <MetricBox label="Доп. добыча 36 мес" value={`${fmt(economics.incrementalOilM3, 0)} м³`} />
            <MetricBox label="Окупаемость" value={economics.paybackMonths !== null ? `${economics.paybackMonths} мес` : "—"}
              tone={economics.paybackMonths !== null && economics.paybackMonths <= 12 ? "ok" : "warn"} />
            <MetricBox label="ROI" value={`${fmt(economics.roi, 0)}%`} tone={economics.roi > 100 ? "ok" : "warn"} />
            <MetricBox label="Чист. прибыль" value={fmtMoney(economics.netProfit)}
              tone={economics.netProfit > 0 ? "ok" : "danger"} />
            <MetricBox label={`NPV @ ${(DEFAULT_COSTS.discountRateAnnual * 100).toFixed(0)}%`}
              value={fmtMoney(economics.npv)} tone={economics.npv > 0 ? "ok" : "danger"} />
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={economics.monthly}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" label={{ value: "Мес.", position: "insideBottom", offset: -3 }} />
              <YAxis tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} label={{ value: "₽", angle: -90, position: "insideLeft" }} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
              <Legend />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Line dataKey="cumulativeProfit" stroke="hsl(217 91% 60%)" dot={false} name="Накопл. прибыль" />
              <Line dataKey="cumulativeProfitDiscounted" stroke="hsl(280 70% 60%)" strokeDasharray="4 4" dot={false} name="NPV (диск.)" />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-muted-foreground">
            Точка пересечения с нулём = срок окупаемости. Дисконтированный денежный поток учитывает ставку {(DEFAULT_COSTS.discountRateAnnual * 100).toFixed(0)}% годовых.
          </p>
        </div>

        {/* ───── Гидродинамика закачки + реология пены ───── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricBox label="II до" value={`${fmt(injectivity, 2)} м³/сут·МПа`} />
          <MetricBox label="II после" value={`${fmt(injectivityAfter, 2)} м³/сут·МПа`} tone="ok" />
          <MetricBox label="MRF пены" value={`×${fmt(mrf, 1)}`} />
          <MetricBox label="μ_app @ FQ забоя" value={`${fmt(foamApparentViscosity(fqAtBottom, baseFluidViscosityCp, reservoir.k_mD, 1e-4, surfactantPct), 1)} сПз`} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Penetration radius (концентрические круги) */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="text-sm font-semibold mb-2">Радиус проникновения раствора</h4>
            {radiusInfo ? (
              <div className="flex items-center justify-center py-2">
                <svg viewBox="-110 -110 220 220" className="w-full max-w-[260px] h-auto">
                  {/* Reservoir background */}
                  <circle cx="0" cy="0" r="100" fill="hsl(45 30% 90%)" stroke="hsl(45 20% 60%)" strokeDasharray="3 3" />
                  {/* Penetration zone (foam) */}
                  <circle cx="0" cy="0" r={Math.min(100, (radiusInfo.r / Math.max(1, radiusInfo.r)) * 80)} fill="hsl(160 70% 70% / 0.4)" stroke="hsl(160 60% 45%)" strokeWidth="1.5" />
                  {/* Damage zone */}
                  <circle cx="0" cy="0" r={Math.min(60, (radiusInfo.rDamage / Math.max(1, radiusInfo.r)) * 80)} fill="hsl(0 70% 60% / 0.3)" stroke="hsl(0 70% 50%)" strokeWidth="1.5" />
                  {/* Wellbore */}
                  <circle cx="0" cy="0" r="4" fill="hsl(220 80% 40%)" stroke="hsl(0 0% 100%)" strokeWidth="1" />
                  <text x="0" y="-14" textAnchor="middle" fontSize="6" fill="hsl(220 80% 40%)">rw</text>
                  <text x="0" y="-65" textAnchor="middle" fontSize="6" fill="hsl(0 70% 40%)">r_damage</text>
                  <text x="0" y="-95" textAnchor="middle" fontSize="6" fill="hsl(160 60% 30%)">r_foam</text>
                </svg>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground py-8 text-center">Объём раствора не задан — радиус не рассчитан.</div>
            )}
            {radiusInfo && (
              <div className="text-[11px] text-muted-foreground grid grid-cols-3 gap-2 mt-2">
                <div>r_well: <span className="font-mono text-foreground">{fmt(radiusInfo.rWell, 2)} м</span></div>
                <div>r_damage: <span className="font-mono text-foreground">{fmt(radiusInfo.rDamage, 2)} м</span></div>
                <div>r_foam: <span className="font-mono text-emerald-600">{fmt(radiusInfo.r, 2)} м</span></div>
              </div>
            )}
          </div>

          {/* Foam apparent viscosity vs FQ */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="text-sm font-semibold mb-2">Реология пены в пласте (Hirasaki-Lawson)</h4>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={rheologyData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="fq" label={{ value: "FQ, %", position: "insideBottom", offset: -3 }} />
                <YAxis label={{ value: "μ_app, сПз", angle: -90, position: "insideLeft" }} />
                <Tooltip />
                <Legend />
                <Line dataKey="vSlow" stroke="hsl(0 70% 55%)" dot={false} name="v=1e-5 м/с (вглубь)" />
                <Line dataKey="vMed"  stroke="hsl(45 80% 50%)" dot={false} name="v=1e-4 м/с" />
                <Line dataKey="vFast" stroke="hsl(160 60% 45%)" dot={false} name="v=1e-3 м/с (у скв.)" />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground mt-1">
              μ_app растёт с FQ и снижается со скоростью фильтрации. Пена «густеет» вдали от скважины.
            </p>
          </div>
        </div>

        {/* Tornado NPV sensitivity */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h4 className="text-sm font-semibold mb-2">Чувствительность NPV (±20…30%)</h4>
          <ResponsiveContainer width="100%" height={Math.max(220, tornado.length * 38)}>
            <BarChart data={tornado} layout="vertical" margin={{ left: 60, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis type="number" tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} />
              <ReferenceLine x={0} stroke="hsl(var(--border))" />
              <Bar dataKey="low" fill="hsl(0 70% 55%)" name="− изменение" />
              <Bar dataKey="high" fill="hsl(160 60% 45%)" name="+ изменение" />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-muted-foreground mt-1">
            Длина бара = диапазон ΔNPV при изменении параметра. Параметры сверху — самые влиятельные.
          </p>
        </div>
        {/* ───── Hawkins waterfall — поэтапное снятие скина ───── */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Waterfall снятия скина (Hawkins) по этапам обработки
          </h4>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={waterfallChart} margin={{ top: 10, right: 10, bottom: 30, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
              <YAxis label={{ value: "Скин S", angle: -90, position: "insideLeft" }} />
              <Tooltip
                formatter={(_: number, __: string, ctx: { payload?: { skinAfter?: number; delta?: number } }) => {
                  const p = ctx?.payload;
                  if (!p) return "";
                  return [`S после = ${(p.skinAfter ?? 0).toFixed(2)}, Δ = ${(p.delta ?? 0).toFixed(2)}`, ""];
                }}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" />
              <Bar dataKey="base" stackId="w" fill="transparent" />
              <Bar dataKey="delta" stackId="w">
                {waterfallChart.map((r, i) => <Cell key={i} fill={r.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
            {waterfall.map((st) => (
              <div key={st.id} className="rounded-md border border-border bg-muted/30 p-2 text-xs">
                <div className="flex justify-between font-semibold">
                  <span>{st.label}</span>
                  <span className="text-emerald-600 font-mono">ΔS = {st.delta.toFixed(2)}</span>
                </div>
                <div className="text-muted-foreground mt-0.5">{st.mechanism}</div>
                <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
                  <span>S после: <span className="font-mono text-foreground">{st.skinAfter.toFixed(2)}</span></span>
                  <span>k_ПЗП: <span className="font-mono text-foreground">{st.effectivePermeability.toFixed(1)} мД</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ───── Step-Rate Test — давление разрыва пласта ───── */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Step-Rate Test (SRT) — определение давления разрыва пласта
            </h4>
            <Button size="sm" variant="outline" onClick={addSrtRow}>
              <Plus className="w-4 h-4 mr-1" /> Ступень
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Введите ступенчатую закачку: на каждой ступени — стабильное забойное давление при заданном расходе.
            Излом на p–q диаграмме = формационное давление разрыва (FPP). Безопасный максимум для пенообработки = 0.9·FPP.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Таблица ступеней */}
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium text-muted-foreground">#</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Расход, м³/сут</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Pзаб, МПа</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {srtPoints.map((p, i) => (
                    <tr key={i} className={`border-t border-border ${srt.fppIndex !== null && i === srt.fppIndex ? "bg-amber-500/10" : ""}`}>
                      <td className="px-3 py-1 text-muted-foreground">{i + 1}</td>
                      <td className="px-2 py-1"><Input className="h-8" type="number" step="10" value={p.rate}
                        onChange={(e) => updSrtRow(i, { rate: num(e.target.value) })} /></td>
                      <td className="px-2 py-1"><Input className="h-8" type="number" step="0.5" value={p.pressure}
                        onChange={(e) => updSrtRow(i, { pressure: num(e.target.value) })} /></td>
                      <td className="px-2 py-1 text-right">
                        <Button size="icon" variant="ghost" onClick={() => removeSrtRow(i)}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* График */}
            <div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={srtChartData} margin={{ top: 10, right: 20, bottom: 25, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="rate" type="number" label={{ value: "q, м³/сут", position: "insideBottom", offset: -3 }} />
                  <YAxis label={{ value: "Pзаб, МПа", angle: -90, position: "insideLeft" }} />
                  <Tooltip />
                  <Legend />
                  <Scatter dataKey="pActual" name="Замеры" fill="hsl(217 91% 60%)" />
                  {srt.matrixLine.length === 2 && (
                    <Line
                      data={srt.matrixLine.map((p) => ({ rate: p.rate, pMatrix: p.pressure }))}
                      dataKey="pMatrix" stroke="hsl(160 60% 45%)" strokeWidth={2} dot={false} name="Матричный режим"
                    />
                  )}
                  {srt.fractureLine.length === 2 && (
                    <Line
                      data={srt.fractureLine.map((p) => ({ rate: p.rate, pFrac: p.pressure }))}
                      dataKey="pFrac" stroke="hsl(0 70% 55%)" strokeWidth={2} strokeDasharray="5 3" dot={false} name="Трещинный режим"
                    />
                  )}
                  {srt.formationPartingPressure !== null && (
                    <ReferenceLine y={srt.formationPartingPressure} stroke="hsl(45 90% 50%)" strokeDasharray="3 3"
                      label={{ value: `FPP = ${srt.formationPartingPressure.toFixed(1)} МПа`, fontSize: 10, fill: "hsl(45 90% 40%)", position: "insideTopRight" }} />
                  )}
                  {srt.safeMaxPressure !== null && (
                    <ReferenceLine y={srt.safeMaxPressure} stroke="hsl(160 60% 45%)" strokeDasharray="2 2"
                      label={{ value: `Безоп. макс ${srt.safeMaxPressure.toFixed(1)}`, fontSize: 10, fill: "hsl(160 60% 30%)", position: "insideBottomRight" }} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={`rounded-lg border p-3 text-sm ${
            srt.verdict === "fracture_detected" ? "bg-amber-500/10 border-amber-500/30 text-amber-700"
              : srt.verdict === "matrix_only" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700"
              : "bg-muted/30 border-border text-muted-foreground"
          }`}>
            <div className="font-semibold mb-1">Интерпретация:</div>
            <div>{srt.verdictText}</div>
            {srt.verdict !== "insufficient_data" && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs">
                <div>II матричный: <span className="font-mono">{srt.matrixInjectivity.toFixed(2)} м³/сут·МПа</span></div>
                <div>Наклон матр.: <span className="font-mono">{srt.matrixSlope.toFixed(3)}</span></div>
                {srt.verdict === "fracture_detected" && (
                  <>
                    <div>Наклон трещ.: <span className="font-mono">{srt.fractureSlope.toFixed(3)}</span></div>
                    <div>Расход @ FPP: <span className="font-mono">{srt.fppRate?.toFixed(0)} м³/сут</span></div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

      </CardContent>

    </Card>
  );
}

function MetricBox({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "danger" }) {
  const cls = tone === "ok" ? "text-emerald-600"
    : tone === "warn" ? "text-amber-600"
    : tone === "danger" ? "text-red-600"
    : "text-foreground";
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${cls}`}>{value}</div>
    </div>
  );
}
