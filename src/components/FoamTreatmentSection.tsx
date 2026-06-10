import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell, AreaChart, Area,
  ComposedChart,
} from "recharts";
import {
  calculateFoamTreatment,
  buildCyclogram,
  recommendEquipment,
  buildReagentConsumption,
  buildRateProfile,
  buildSkinEvolution,
  buildProductionForecast,
  FOAM_TREATMENT_RECIPES,
  type FoamTreatmentWellData,
  type FoamTreatmentRecipe,
  type FoamTreatmentOptions,
} from "@/lib/foam-treatment-calculations";
import {
  CheckCircle2, AlertTriangle, Beaker, FlaskConical, Droplets, Wind,
  Layers, Sparkles, Pencil, Plus, Trash2, RotateCcw,
} from "lucide-react";

const fmt = (v: number | undefined, d = 2) =>
  Number.isFinite(v as number) ? (v as number).toFixed(d) : "—";

const DEFAULT_WELL: FoamTreatmentWellData = {
  wellDepthMD: 2800, casingID_mm: 130, nktOD_mm: 73, nktID_mm: 62, nktDepthMD: 2700,
  trajectory: [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: 2800, azimuth: 0, zenith: 0, tvd: 2800 }],
  reservoirTopMD: 2720, reservoirBottomMD: 2790, netPayM: 8, permeability_mD: 25,
  porosity: 0.18, reservoirPressureMPa: 22, reservoirTemperatureC: 78, skinFactor: 8.5,
  wellFluidDensity: 1.05, wellFluidType: "brine", fracturePressureMPa: 38,
  perfIntervalTopMD: 2725, perfIntervalBottomMD: 2785, perfDensity: 20, perfDiameter_mm: 10,
  currentRateTpd: 5, oilViscosityCp: 4, oilFVF: 1.15, drainageRadiusM: 500,
};

const COLLECTOR_LABEL: Record<FoamTreatmentRecipe["collectorType"], string> = {
  carbonate: "Карбонат", terrigenous: "Терриген", any: "Универсальный",
};

const RECIPE_ICONS: Record<string, typeof Beaker> = {
  foam_pav_clean: Droplets, foam_acid_hcl_carb: FlaskConical, foam_acid_glina: FlaskConical,
  foam_solvent_aspo: Beaker, foam_sgps_thermo: Sparkles, foam_polymer_div: Layers, n2_lift_gas: Wind,
};

const REAGENT_COLORS: Record<string, string> = {
  base_fluid: "hsl(217 91% 60%)",
  surfactant: "hsl(280 70% 60%)",
  additive: "hsl(45 95% 55%)",
  nitrogen: "hsl(192 91% 60%)",
  displacement: "hsl(160 60% 45%)",
};

const REAGENT_CAT_LABEL: Record<string, string> = {
  base_fluid: "Базовая жидк.", surfactant: "ПАВ",
  additive: "Доб.", nitrogen: "Азот", displacement: "Продавка",
};

function cloneRecipe(r: FoamTreatmentRecipe): FoamTreatmentRecipe {
  return {
    ...r,
    id: "custom",
    type: "custom",
    nameRu: `Своя: ${r.nameRu}`,
    additives: r.additives.map((a) => ({ ...a })),
    skinReductionEstimate: [r.skinReductionEstimate[0], r.skinReductionEstimate[1]],
  };
}

export default function FoamTreatmentSection() {
  const [well, setWell] = useState<FoamTreatmentWellData>(DEFAULT_WELL);
  const [recipeId, setRecipeId] = useState<string>(FOAM_TREATMENT_RECIPES[0].id);
  const [customRecipe, setCustomRecipe] = useState<FoamTreatmentRecipe | null>(null);
  const [opts, setOpts] = useState<FoamTreatmentOptions>({
    numberOfCycles: 3, soakTimeMin: 60, injectionRateLps: 4,
    targetPenetrationM: 2, usePacker: true,
  });

  const recipe: FoamTreatmentRecipe =
    recipeId === "custom" && customRecipe
      ? customRecipe
      : FOAM_TREATMENT_RECIPES.find((r) => r.id === recipeId) ?? FOAM_TREATMENT_RECIPES[0];

  const result = useMemo(() => calculateFoamTreatment(well, recipe, opts), [well, recipe, opts]);
  const cyclo = useMemo(() => buildCyclogram(well, recipe, opts, result), [well, recipe, opts, result]);
  const equipment = useMemo(() => recommendEquipment(result), [result]);
  const reagents = useMemo(() => buildReagentConsumption(recipe, result), [recipe, result]);
  const rateProfile = useMemo(() => buildRateProfile(recipe, opts, result), [recipe, opts, result]);
  const skinEvo = useMemo(() => buildSkinEvolution(well, recipe, result), [well, recipe, result]);
  const production = useMemo(() => buildProductionForecast(well, result, 90), [well, result]);
  const productionHours = useMemo(() => production.filter((p) => p.hours <= 72), [production]);
  const productionDays = useMemo(() => production.filter((p) => p.hours >= 24), [production]);

  const setW = <K extends keyof FoamTreatmentWellData>(k: K, v: FoamTreatmentWellData[K]) =>
    setWell((p) => ({ ...p, [k]: v }));
  const num = (v: string) => {
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  const startCustom = () => {
    setCustomRecipe(cloneRecipe(recipe));
    setRecipeId("custom");
  };
  const resetCustom = () => {
    setCustomRecipe(cloneRecipe(FOAM_TREATMENT_RECIPES[0]));
    setRecipeId("custom");
  };

  const setCR = <K extends keyof FoamTreatmentRecipe>(k: K, v: FoamTreatmentRecipe[K]) =>
    setCustomRecipe((p) => (p ? { ...p, [k]: v } : p));

  return (
    <div className="space-y-6">
      {/* ───────── Шаг 1: Данные ───────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Шаг 1 — Данные скважины и пласта</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Глубина скважины, м"><Input type="number" value={well.wellDepthMD} onChange={(e) => setW("wellDepthMD", num(e.target.value))} /></Field>
          <Field label="ID эксп. колонны, мм"><Input type="number" value={well.casingID_mm} onChange={(e) => setW("casingID_mm", num(e.target.value))} /></Field>
          <Field label="OD НКТ, мм"><Input type="number" value={well.nktOD_mm} onChange={(e) => setW("nktOD_mm", num(e.target.value))} /></Field>
          <Field label="ID НКТ, мм"><Input type="number" value={well.nktID_mm} onChange={(e) => setW("nktID_mm", num(e.target.value))} /></Field>
          <Field label="Спуск НКТ, м"><Input type="number" value={well.nktDepthMD} onChange={(e) => setW("nktDepthMD", num(e.target.value))} /></Field>
          <Field label="Перф. кровля, м"><Input type="number" value={well.perfIntervalTopMD} onChange={(e) => setW("perfIntervalTopMD", num(e.target.value))} /></Field>
          <Field label="Перф. подошва, м"><Input type="number" value={well.perfIntervalBottomMD} onChange={(e) => setW("perfIntervalBottomMD", num(e.target.value))} /></Field>
          <Field label="Эфф. толщина h, м"><Input type="number" value={well.netPayM} onChange={(e) => setW("netPayM", num(e.target.value))} /></Field>
          <Field label="k, мД"><Input type="number" value={well.permeability_mD} onChange={(e) => setW("permeability_mD", num(e.target.value))} /></Field>
          <Field label="Пористость φ"><Input type="number" step="0.01" value={well.porosity} onChange={(e) => setW("porosity", num(e.target.value))} /></Field>
          <Field label="Pпл, МПа"><Input type="number" value={well.reservoirPressureMPa} onChange={(e) => setW("reservoirPressureMPa", num(e.target.value))} /></Field>
          <Field label="Tпл, °C"><Input type="number" value={well.reservoirTemperatureC} onChange={(e) => setW("reservoirTemperatureC", num(e.target.value))} /></Field>
          <Field label="P ГРП, МПа"><Input type="number" value={well.fracturePressureMPa} onChange={(e) => setW("fracturePressureMPa", num(e.target.value))} /></Field>
          <Field label="Скин текущий S"><Input type="number" step="0.1" value={well.skinFactor} onChange={(e) => setW("skinFactor", num(e.target.value))} /></Field>
          <Field label="ρ жидкости, г/см³"><Input type="number" step="0.01" value={well.wellFluidDensity} onChange={(e) => setW("wellFluidDensity", num(e.target.value))} /></Field>
          <Field label="Тек. дебит, т/сут"><Input type="number" value={well.currentRateTpd ?? 0} onChange={(e) => setW("currentRateTpd", num(e.target.value))} /></Field>
        </CardContent>
      </Card>

      {/* ───────── Шаг 2: Рецептура ───────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-lg">Шаг 2 — Выбор технологии обработки</CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={startCustom}>
              <Pencil className="w-4 h-4 mr-1.5" />
              {recipeId === "custom" ? "Своя рецептура" : "Редактировать выбранную"}
            </Button>
            {recipeId === "custom" && (
              <Button size="sm" variant="ghost" onClick={resetCustom}>
                <RotateCcw className="w-4 h-4 mr-1.5" /> Сброс
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {FOAM_TREATMENT_RECIPES.map((r) => {
              const Icon = RECIPE_ICONS[r.id] ?? Beaker;
              const active = r.id === recipeId;
              return (
                <button key={r.id} onClick={() => setRecipeId(r.id)}
                  className={`text-left rounded-xl border p-4 transition-all ${
                    active ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                      : "border-border bg-card hover:border-primary/40"
                  }`}>
                  <div className="flex items-start gap-3 mb-2">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${active ? "bg-primary/15" : "bg-muted"}`}>
                      <Icon className={`w-5 h-5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-sm">{r.nameRu}</h4>
                      <div className="flex gap-1 flex-wrap mt-1">
                        <Badge variant="outline" className="text-[10px]">{COLLECTOR_LABEL[r.collectorType]}</Badge>
                        <Badge variant="outline" className="text-[10px]">FQ {r.targetFoamQuality}%</Badge>
                        <Badge variant="outline" className="text-[10px]">≤{r.maxTempC}°C</Badge>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug">{r.description}</p>
                </button>
              );
            })}

            {/* Карточка для своей рецептуры */}
            <button onClick={() => (customRecipe ? setRecipeId("custom") : startCustom())}
              className={`text-left rounded-xl border p-4 transition-all border-dashed ${
                recipeId === "custom" ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                  : "border-border bg-card hover:border-primary/40"
              }`}>
              <div className="flex items-start gap-3 mb-2">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${recipeId === "custom" ? "bg-primary/15" : "bg-muted"}`}>
                  <Pencil className={`w-5 h-5 ${recipeId === "custom" ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-sm">Своя рецептура</h4>
                  <Badge variant="outline" className="text-[10px] mt-1">Полное редактирование</Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-snug">
                Создайте собственную рецептуру: базовая жидкость, ПАВ, концентрации, неограниченное число добавок.
              </p>
            </button>
          </div>

          {/* ───── Редактор своей рецептуры ───── */}
          {recipeId === "custom" && customRecipe && (
            <RecipeEditor recipe={customRecipe} setCR={setCR} num={num} />
          )}
        </CardContent>
      </Card>

      {/* ───────── Шаг 3: Параметры ───────── */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Шаг 3 — Параметры операции</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <SliderRow label="Количество циклов" value={opts.numberOfCycles} min={1} max={5} step={1}
            display={`${opts.numberOfCycles}`} onChange={(v) => setOpts({ ...opts, numberOfCycles: v })} />
          <SliderRow label="Расход закачки, л/с" value={opts.injectionRateLps} min={1} max={15} step={0.5}
            display={`${opts.injectionRateLps.toFixed(1)} л/с`} onChange={(v) => setOpts({ ...opts, injectionRateLps: v })} />
          <SliderRow label="Время выдержки, мин" value={opts.soakTimeMin} min={15} max={240} step={15}
            display={`${opts.soakTimeMin} мин`} onChange={(v) => setOpts({ ...opts, soakTimeMin: v })} />
          <SliderRow label="Целевой радиус, м" value={opts.targetPenetrationM} min={0.5} max={5} step={0.1}
            display={`${opts.targetPenetrationM.toFixed(1)} м`} onChange={(v) => setOpts({ ...opts, targetPenetrationM: v })} />
          <div className="flex items-center gap-3">
            <Switch checked={opts.usePacker} onCheckedChange={(v) => setOpts({ ...opts, usePacker: !!v })} id="use-packer" />
            <Label htmlFor="use-packer">Установлен пакер (изолирует ОК от давления)</Label>
          </div>
        </CardContent>
      </Card>

      {/* ───────── Шаг 4: Результат ───────── */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Шаг 4 — Результат расчёта</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {/* Сводка */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ResultBlock title="Объёмы">
              <Row k="Раствор обр. (всего)" v={`${fmt(result.treatmentVolumeM3)} м³`} />
              <Row k="Пена на устье" v={`${fmt(result.foamVolumeAtSurfaceM3)} м³`} />
              <Row k="Пена на забое" v={`${fmt(result.foamVolumeAtFormationM3)} м³`} />
              <Row k="N₂ (стд. усл.)" v={`${fmt(result.n2VolumeStdM3)} м³`} />
              <Row k="Продавка (всего)" v={`${fmt(result.displacementVolumeM3 * result.numberOfCycles)} м³`} />
            </ResultBlock>
            <ResultBlock title="Давления">
              <Row k="P устья (закачка)" v={`${fmt(result.injectionPressureMPa)} МПа`} />
              <Row k="P забой" v={`${fmt(result.bottomholePressureMPa)} МПа`} />
              <Row k="P ГРП" v={`${fmt(result.maxAllowedPressureMPa)} МПа`} />
              <Row k="Запас до ГРП" v={`${fmt(result.pressureMarginMPa)} МПа`}
                accent={result.pressureMarginMPa < 1 ? "danger" : result.pressureMarginMPa < 3 ? "warn" : "ok"} />
              <Row k="Потери на трение" v={`${fmt(result.frictionMPa)} МПа`} />
              <Row k="FQ на забое" v={`${fmt(result.foamQualityAtFormation, 1)} %`} />
            </ResultBlock>
            <ResultBlock title="Операция">
              <Row k="Циклов" v={`${result.numberOfCycles}`} />
              <Row k="Длительность цикла" v={`${fmt(result.cycleTimeMin, 0)} мин`} />
              <Row k="Общее время" v={`${fmt(result.totalTreatmentTimeMin / 60, 1)} ч`} />
              <Row k="Пиковый расход N₂" v={`${fmt(result.n2PeakRateM3min, 2)} м³/мин`} />
              <Row k="Радиус проникновения" v={`${fmt(result.penetrationRadiusM, 2)} м`} />
              <Row k="ρ пены на забое" v={`${fmt(result.foamDensityAtFormation, 2)} г/см³`} />
            </ResultBlock>
          </div>

          {/* Предупреждения */}
          {result.warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-1">
              {result.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" /><span>{w}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Все параметры в допустимом диапазоне — операция безопасна.
            </div>
          )}

          {/* ═════════════ ГРАФИКИ ═════════════ */}

          {/* 1. Циклограмма давления */}
          <ChartBlock title="График 1 — Циклограмма давления P(t)"
            subtitle="Устьевое и забойное давление по всем циклам обработки">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={cyclo.points}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" type="number" domain={[0, "dataMax"]}
                  label={{ value: "Время, мин", position: "insideBottom", offset: -5 }}
                  stroke="hsl(var(--muted-foreground))" />
                <YAxis label={{ value: "P, МПа", angle: -90, position: "insideLeft" }}
                  stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  formatter={(v: number, n) => [`${v.toFixed(2)} МПа`, n as string]}
                  labelFormatter={(t: number) => `t = ${t.toFixed(1)} мин`} />
                <Legend />
                <ReferenceLine y={well.fracturePressureMPa} stroke="hsl(0 84% 60%)" strokeDasharray="6 4"
                  label={{ value: "P ГРП", fill: "hsl(0 84% 60%)", position: "right" }} />
                <ReferenceLine y={well.reservoirPressureMPa} stroke="hsl(142 71% 45%)" strokeDasharray="4 4"
                  label={{ value: "Pпл", fill: "hsl(142 71% 45%)", position: "right" }} />
                <Line type="monotone" dataKey="surfacePressure" stroke="hsl(217 91% 60%)" name="P устья" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="bhp" stroke="hsl(25 95% 53%)" name="P забой" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ChartBlock>

          {/* 2. Профиль расхода q(t) */}
          <ChartBlock title="График 2 — Профиль закачки q(t)"
            subtitle="Расход жидкости (ПАВ-раствор / кислота) и азота во времени">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={rateProfile}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" type="number" domain={[0, "dataMax"]}
                  label={{ value: "Время, мин", position: "insideBottom", offset: -5 }}
                  stroke="hsl(var(--muted-foreground))" />
                <YAxis yAxisId="left" label={{ value: "Жидкость, л/с", angle: -90, position: "insideLeft" }}
                  stroke="hsl(217 91% 60%)" />
                <YAxis yAxisId="right" orientation="right"
                  label={{ value: "N₂, м³/мин", angle: 90, position: "insideRight" }}
                  stroke="hsl(192 91% 60%)" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  labelFormatter={(t: number) => `t = ${t.toFixed(1)} мин`} />
                <Legend />
                <Area yAxisId="left" type="stepAfter" dataKey="liquidRateLps" stroke="hsl(217 91% 60%)"
                  fill="hsl(217 91% 60% / 0.25)" name="Жидкость, л/с" />
                <Area yAxisId="right" type="stepAfter" dataKey="n2RateM3min" stroke="hsl(192 91% 60%)"
                  fill="hsl(192 91% 60% / 0.25)" name="N₂, м³/мин" />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartBlock>

          {/* 3. Расход реагентов */}
          <ChartBlock title="График 3 — Расход материалов и реагентов"
            subtitle="Объёмы и массы всех компонентов на операцию">
            <ResponsiveContainer width="100%" height={Math.max(220, reagents.length * 38)}>
              <BarChart data={reagents} layout="vertical" margin={{ left: 140, right: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" />
                <YAxis dataKey="name" type="category" stroke="hsl(var(--muted-foreground))" width={140}
                  tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  formatter={(v: number, _n, item: any) =>
                    [`${v.toFixed(2)} ${item?.payload?.unit ?? ""}`, REAGENT_CAT_LABEL[item?.payload?.category] ?? ""]
                  } />
                <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                  {reagents.map((r, i) => (
                    <Cell key={i} fill={REAGENT_COLORS[r.category] ?? "hsl(var(--primary))"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
              {Object.entries(REAGENT_CAT_LABEL).map(([k, l]) => (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: REAGENT_COLORS[k] }} />
                  <span className="text-muted-foreground">{l}</span>
                </div>
              ))}
            </div>
          </ChartBlock>

          {/* 4. Эволюция скина по циклам */}
          <ChartBlock title="График 4 — Эволюция скин-фактора и продуктивности по циклам"
            subtitle="Закон убывающей отдачи: первый цикл даёт ~60% эффекта, далее насыщение">
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={skinEvo}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="cycle"
                  label={{ value: "Цикл №", position: "insideBottom", offset: -5 }}
                  stroke="hsl(var(--muted-foreground))" />
                <YAxis yAxisId="left" label={{ value: "Скин S", angle: -90, position: "insideLeft" }}
                  stroke="hsl(0 84% 60%)" />
                <YAxis yAxisId="right" orientation="right"
                  label={{ value: "PI / PI₀", angle: 90, position: "insideRight" }}
                  stroke="hsl(142 71% 45%)" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                <Legend />
                <Bar yAxisId="left" dataKey="skin" fill="hsl(0 84% 60% / 0.6)" name="Скин S" />
                <Line yAxisId="right" type="monotone" dataKey="productivityRatio"
                  stroke="hsl(142 71% 45%)" strokeWidth={2} name="Прирост продуктивности" />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartBlock>

          {/* 5a. Прогноз дебита: часы */}
          <ChartBlock title="График 5 — Выход на режим (первые 72 часа)"
            subtitle="Чистка ПЗП: экспоненциальный рост дебита после стравливания (τ ≈ 8 ч)">
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={productionHours}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hours" type="number" domain={[0, 72]} ticks={[0, 8, 16, 24, 36, 48, 60, 72]}
                  label={{ value: "Часы после обработки", position: "insideBottom", offset: -5 }}
                  stroke="hsl(var(--muted-foreground))" />
                <YAxis label={{ value: "Дебит, т/сут", angle: -90, position: "insideLeft" }}
                  stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  formatter={(v: number) => `${v.toFixed(2)} т/сут`}
                  labelFormatter={(h: number) => `${h} ч`} />
                <Legend />
                <ReferenceLine y={well.currentRateTpd ?? 0} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4"
                  label={{ value: "Дебит до", position: "insideTopLeft", fill: "hsl(var(--muted-foreground))" }} />
                <Line type="monotone" dataKey="rateTpd" stroke="hsl(142 71% 45%)" strokeWidth={2.5}
                  dot={false} name="Дебит q(t)" />
              </LineChart>
            </ResponsiveContainer>
          </ChartBlock>

          {/* 5b. Прогноз дебита: сутки */}
          <ChartBlock title="График 6 — Динамика дебита (90 суток)"
            subtitle="Накопленная добыча и затухание эффекта (T½ ≈ 180 сут)">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={productionDays}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="days" type="number" domain={[1, 90]}
                  label={{ value: "Сутки", position: "insideBottom", offset: -5 }}
                  stroke="hsl(var(--muted-foreground))" />
                <YAxis yAxisId="left" label={{ value: "Дебит, т/сут", angle: -90, position: "insideLeft" }}
                  stroke="hsl(142 71% 45%)" />
                <YAxis yAxisId="right" orientation="right"
                  label={{ value: "Накопленный прирост, т", angle: 90, position: "insideRight" }}
                  stroke="hsl(45 95% 55%)" />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  labelFormatter={(d: number) => `${d.toFixed(0)} сут`} />
                <Legend />
                <ReferenceLine yAxisId="left" y={well.currentRateTpd ?? 0}
                  stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                <Line yAxisId="left" type="monotone" dataKey="rateTpd" stroke="hsl(142 71% 45%)"
                  strokeWidth={2} dot={false} name="Дебит, т/сут" />
                <Area yAxisId="right" type="monotone" dataKey="cumulativeGainT" stroke="hsl(45 95% 55%)"
                  fill="hsl(45 95% 55% / 0.2)" name="Доп. добыча накопл., т" />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
              <MiniStat label="Через 24 ч" value={`${fmt(production.find((p) => p.hours === 24)?.rateTpd, 1)} т/сут`} />
              <MiniStat label="Через 7 сут" value={`${fmt(production.find((p) => p.hours === 7 * 24)?.rateTpd, 1)} т/сут`} />
              <MiniStat label="Через 30 сут" value={`${fmt(production.find((p) => p.hours === 30 * 24)?.rateTpd, 1)} т/сут`} />
              <MiniStat label="Доп. добыча / 90 сут" value={`+${fmt(production[production.length - 1]?.cumulativeGainT, 0)} т`} />
            </div>
          </ChartBlock>

          {/* Прогноз скина (сводка) */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Сводный прогноз эффекта
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Metric label="Скин текущий" value={fmt(result.currentSkin, 1)} />
              <Metric label="Скин ожидаемый" value={fmt(result.expectedSkin, 1)} accent="ok" />
              <Metric label="Снижение скина" value={`−${fmt(result.expectedSkinReduction, 1)}`} accent="ok" />
              <Metric label="Прирост дебита" value={`+${fmt(result.expectedProductionIncreasePct, 0)} %`} accent="ok" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              Прогноз по формуле Дюпюи: Q = (k·h·ΔP)/(18.41·μ·B·(ln(Re/rw)+S)).
            </p>
          </div>

          {/* Оборудование */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h4 className="text-sm font-semibold mb-3">Рекомендуемое оборудование</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <EquipBlock label="Насосный агрегат" value={equipment.pumpUnit} />
              <EquipBlock label="Азотная установка" value={equipment.n2Unit} />
              <EquipBlock label="Пеногенератор" value={equipment.foamGenerator} />
            </div>
            {equipment.comments.length > 0 && (
              <ul className="mt-3 list-disc list-inside text-xs text-muted-foreground space-y-1">
                {equipment.comments.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ─────────── Редактор рецептуры ─────────── */

function RecipeEditor({
  recipe, setCR, num,
}: {
  recipe: FoamTreatmentRecipe;
  setCR: <K extends keyof FoamTreatmentRecipe>(k: K, v: FoamTreatmentRecipe[K]) => void;
  num: (v: string) => number;
}) {
  const addAdditive = () =>
    setCR("additives", [
      ...recipe.additives,
      { name: "Новая добавка", concentration: 0.5, unit: "%", purpose: "" },
    ]);
  const removeAdditive = (i: number) =>
    setCR("additives", recipe.additives.filter((_, idx) => idx !== i));
  const updAdditive = (i: number, patch: Partial<FoamTreatmentRecipe["additives"][number]>) =>
    setCR(
      "additives",
      recipe.additives.map((a, idx) => (idx === i ? { ...a, ...patch } : a)),
    );

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <Pencil className="w-4 h-4 text-primary" /> Редактор собственной рецептуры
        </h4>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Название рецептуры">
          <Input value={recipe.nameRu} onChange={(e) => setCR("nameRu", e.target.value)} />
        </Field>
        <Field label="Тип коллектора">
          <Select value={recipe.collectorType}
            onValueChange={(v) => setCR("collectorType", v as FoamTreatmentRecipe["collectorType"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="carbonate">Карбонатный</SelectItem>
              <SelectItem value="terrigenous">Терригенный</SelectItem>
              <SelectItem value="any">Универсальный</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Тип базовой жидкости">
          <Select value={recipe.baseFluidType}
            onValueChange={(v) => setCR("baseFluidType", v as FoamTreatmentRecipe["baseFluidType"])}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="water">Вода</SelectItem>
              <SelectItem value="brine">Рассол</SelectItem>
              <SelectItem value="acid_hcl">Кислота HCl</SelectItem>
              <SelectItem value="acid_hf_mud">Глинокислота HCl+HF</SelectItem>
              <SelectItem value="solvent">Растворитель</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="ρ базовой жидк., г/см³">
          <Input type="number" step="0.01" value={recipe.baseFluidDensity}
            onChange={(e) => setCR("baseFluidDensity", num(e.target.value))} />
        </Field>
        <Field label="Концентрация баз. жидк., %">
          <Input type="number" step="0.5" value={recipe.baseFluidConcentration ?? 0}
            onChange={(e) => setCR("baseFluidConcentration", num(e.target.value))} />
        </Field>
        <Field label="Макс. T, °C">
          <Input type="number" value={recipe.maxTempC}
            onChange={(e) => setCR("maxTempC", num(e.target.value))} />
        </Field>

        <Field label="Тип ПАВ">
          <Input value={recipe.surfactantType} onChange={(e) => setCR("surfactantType", e.target.value)} />
        </Field>
        <Field label="Концентрация ПАВ, %">
          <Input type="number" step="0.1" value={recipe.surfactantConc}
            onChange={(e) => setCR("surfactantConc", num(e.target.value))} />
        </Field>
        <Field label="Целевое FQ, %">
          <Input type="number" value={recipe.targetFoamQuality}
            onChange={(e) => setCR("targetFoamQuality", num(e.target.value))} />
        </Field>

        <Field label="Объём / м эфф.толщины, м³/м">
          <Input type="number" step="0.1" value={recipe.volumePerMeterPayZone}
            onChange={(e) => setCR("volumePerMeterPayZone", num(e.target.value))} />
        </Field>
        <Field label="ΔS мин (ожид.)">
          <Input type="number" step="0.5" value={recipe.skinReductionEstimate[0]}
            onChange={(e) => setCR("skinReductionEstimate",
              [num(e.target.value), recipe.skinReductionEstimate[1]])} />
        </Field>
        <Field label="ΔS макс (ожид.)">
          <Input type="number" step="0.5" value={recipe.skinReductionEstimate[1]}
            onChange={(e) => setCR("skinReductionEstimate",
              [recipe.skinReductionEstimate[0], num(e.target.value)])} />
        </Field>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Описание</Label>
        <Input className="mt-1" value={recipe.description}
          onChange={(e) => setCR("description", e.target.value)} />
      </div>

      {/* Добавки */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h5 className="text-sm font-semibold">Добавки и реагенты</h5>
          <Button size="sm" variant="outline" onClick={addAdditive}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Добавить
          </Button>
        </div>

        <div className="space-y-2">
          {recipe.additives.length === 0 && (
            <p className="text-xs text-muted-foreground italic">Нет добавок. Нажмите «Добавить» чтобы внести реагент.</p>
          )}
          {recipe.additives.map((a, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end p-2 rounded-lg bg-background border border-border">
              <div className="col-span-12 md:col-span-4">
                <Label className="text-[10px] text-muted-foreground">Название</Label>
                <Input className="h-9" value={a.name}
                  onChange={(e) => updAdditive(i, { name: e.target.value })} />
              </div>
              <div className="col-span-4 md:col-span-2">
                <Label className="text-[10px] text-muted-foreground">Конц.</Label>
                <Input className="h-9" type="number" step="0.1" value={a.concentration}
                  onChange={(e) => updAdditive(i, { concentration: num(e.target.value) })} />
              </div>
              <div className="col-span-4 md:col-span-2">
                <Label className="text-[10px] text-muted-foreground">Ед.</Label>
                <Select value={a.unit}
                  onValueChange={(v) => updAdditive(i, { unit: v as "%" | "кг/м³" })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="%">%</SelectItem>
                    <SelectItem value="кг/м³">кг/м³</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3 md:col-span-3">
                <Label className="text-[10px] text-muted-foreground">Назначение</Label>
                <Input className="h-9" value={a.purpose}
                  onChange={(e) => updAdditive(i, { purpose: e.target.value })} />
              </div>
              <div className="col-span-1 md:col-span-1 flex justify-end">
                <Button size="icon" variant="ghost" onClick={() => removeAdditive(i)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────── Вспомогательные UI ─────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SliderRow({
  label, value, min, max, step, display, onChange,
}: { label: string; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void; }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <Label>{label}</Label>
        <span className="font-mono text-foreground">{display}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(arr) => onChange(arr[0])} />
    </div>
  );
}

function ResultBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ k, v, accent }: { k: string; v: string; accent?: "ok" | "warn" | "danger" }) {
  const cls = accent === "ok" ? "text-emerald-500"
    : accent === "warn" ? "text-amber-500"
    : accent === "danger" ? "text-red-500" : "text-foreground";
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className={`font-mono font-medium ${cls}`}>{v}</span>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: "ok" }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold mt-0.5 ${accent === "ok" ? "text-emerald-500" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="text-sm font-semibold text-foreground mt-0.5">{value}</div>
    </div>
  );
}

function EquipBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="font-medium text-foreground mt-0.5">{value}</div>
    </div>
  );
}

function ChartBlock({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold">{title}</h4>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
