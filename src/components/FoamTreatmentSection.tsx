import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  calculateFoamTreatment,
  buildCyclogram,
  recommendEquipment,
  FOAM_TREATMENT_RECIPES,
  type FoamTreatmentWellData,
  type FoamTreatmentRecipe,
  type FoamTreatmentOptions,
} from "@/lib/foam-treatment-calculations";
import { CheckCircle2, AlertTriangle, Beaker, FlaskConical, Droplets, Wind, Layers, Sparkles } from "lucide-react";

const fmt = (v: number | undefined, d = 2) =>
  Number.isFinite(v as number) ? (v as number).toFixed(d) : "—";

const DEFAULT_WELL: FoamTreatmentWellData = {
  wellDepthMD: 2800,
  casingID_mm: 130,
  nktOD_mm: 73,
  nktID_mm: 62,
  nktDepthMD: 2700,
  trajectory: [
    { md: 0, inc: 0, azi: 0, tvd: 0, north: 0, east: 0, dls: 0 },
    { md: 2800, inc: 0, azi: 0, tvd: 2800, north: 0, east: 0, dls: 0 },
  ],
  reservoirTopMD: 2720,
  reservoirBottomMD: 2790,
  netPayM: 8,
  permeability_mD: 25,
  porosity: 0.18,
  reservoirPressureMPa: 22,
  reservoirTemperatureC: 78,
  skinFactor: 8.5,
  wellFluidDensity: 1.05,
  wellFluidType: "brine",
  fracturePressureMPa: 38,
  perfIntervalTopMD: 2725,
  perfIntervalBottomMD: 2785,
  perfDensity: 20,
  perfDiameter_mm: 10,
  currentRateTpd: 5,
  oilViscosityCp: 4,
  oilFVF: 1.15,
  drainageRadiusM: 500,
};

const COLLECTOR_LABEL: Record<FoamTreatmentRecipe["collectorType"], string> = {
  carbonate: "Карбонат",
  terrigenous: "Терриген",
  any: "Универсальный",
};

const RECIPE_ICONS: Record<string, typeof Beaker> = {
  foam_pav_clean: Droplets,
  foam_acid_hcl_carb: FlaskConical,
  foam_acid_glina: FlaskConical,
  foam_solvent_aspo: Beaker,
  foam_sgps_thermo: Sparkles,
  foam_polymer_div: Layers,
  n2_lift_gas: Wind,
};

export default function FoamTreatmentSection() {
  const [well, setWell] = useState<FoamTreatmentWellData>(DEFAULT_WELL);
  const [recipeId, setRecipeId] = useState<string>(FOAM_TREATMENT_RECIPES[0].id);
  const [opts, setOpts] = useState<FoamTreatmentOptions>({
    numberOfCycles: 3,
    soakTimeMin: 60,
    injectionRateLps: 4,
    targetPenetrationM: 2,
    usePacker: true,
  });

  const recipe =
    FOAM_TREATMENT_RECIPES.find((r) => r.id === recipeId) ??
    FOAM_TREATMENT_RECIPES[0];

  const result = useMemo(
    () => calculateFoamTreatment(well, recipe, opts),
    [well, recipe, opts],
  );
  const cyclo = useMemo(
    () => buildCyclogram(well, recipe, opts, result),
    [well, recipe, opts, result],
  );
  const equipment = useMemo(() => recommendEquipment(result), [result]);

  const setW = <K extends keyof FoamTreatmentWellData>(
    k: K,
    v: FoamTreatmentWellData[K],
  ) => setWell((p) => ({ ...p, [k]: v }));

  const num = (v: string) => {
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <div className="space-y-6">
      {/* ───────── Шаг 1: Данные ───────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Шаг 1 — Данные скважины и пласта</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Глубина скважины, м">
            <Input type="number" value={well.wellDepthMD} onChange={(e) => setW("wellDepthMD", num(e.target.value))} />
          </Field>
          <Field label="ID эксп. колонны, мм">
            <Input type="number" value={well.casingID_mm} onChange={(e) => setW("casingID_mm", num(e.target.value))} />
          </Field>
          <Field label="OD НКТ, мм">
            <Input type="number" value={well.nktOD_mm} onChange={(e) => setW("nktOD_mm", num(e.target.value))} />
          </Field>
          <Field label="ID НКТ, мм">
            <Input type="number" value={well.nktID_mm} onChange={(e) => setW("nktID_mm", num(e.target.value))} />
          </Field>
          <Field label="Спуск НКТ, м">
            <Input type="number" value={well.nktDepthMD} onChange={(e) => setW("nktDepthMD", num(e.target.value))} />
          </Field>
          <Field label="Перф. кровля, м">
            <Input type="number" value={well.perfIntervalTopMD} onChange={(e) => setW("perfIntervalTopMD", num(e.target.value))} />
          </Field>
          <Field label="Перф. подошва, м">
            <Input type="number" value={well.perfIntervalBottomMD} onChange={(e) => setW("perfIntervalBottomMD", num(e.target.value))} />
          </Field>
          <Field label="Эфф. толщина h, м">
            <Input type="number" value={well.netPayM} onChange={(e) => setW("netPayM", num(e.target.value))} />
          </Field>
          <Field label="k, мД">
            <Input type="number" value={well.permeability_mD} onChange={(e) => setW("permeability_mD", num(e.target.value))} />
          </Field>
          <Field label="Пористость φ, д.е.">
            <Input type="number" step="0.01" value={well.porosity} onChange={(e) => setW("porosity", num(e.target.value))} />
          </Field>
          <Field label="Pпл, МПа">
            <Input type="number" value={well.reservoirPressureMPa} onChange={(e) => setW("reservoirPressureMPa", num(e.target.value))} />
          </Field>
          <Field label="Tпл, °C">
            <Input type="number" value={well.reservoirTemperatureC} onChange={(e) => setW("reservoirTemperatureC", num(e.target.value))} />
          </Field>
          <Field label="P ГРП, МПа">
            <Input type="number" value={well.fracturePressureMPa} onChange={(e) => setW("fracturePressureMPa", num(e.target.value))} />
          </Field>
          <Field label="Скин текущий S">
            <Input type="number" step="0.1" value={well.skinFactor} onChange={(e) => setW("skinFactor", num(e.target.value))} />
          </Field>
          <Field label="ρ скваж. жидкости, г/см³">
            <Input type="number" step="0.01" value={well.wellFluidDensity} onChange={(e) => setW("wellFluidDensity", num(e.target.value))} />
          </Field>
          <Field label="Тек. дебит, т/сут">
            <Input type="number" value={well.currentRateTpd ?? 0} onChange={(e) => setW("currentRateTpd", num(e.target.value))} />
          </Field>
        </CardContent>
      </Card>

      {/* ───────── Шаг 2: Рецептура ───────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Шаг 2 — Выбор технологии обработки</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {FOAM_TREATMENT_RECIPES.map((r) => {
              const Icon = RECIPE_ICONS[r.id] ?? Beaker;
              const active = r.id === recipeId;
              return (
                <button
                  key={r.id}
                  onClick={() => setRecipeId(r.id)}
                  className={`text-left rounded-xl border p-4 transition-all ${
                    active
                      ? "border-primary bg-primary/5 ring-2 ring-primary/30"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
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
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    ПАВ: <span className="text-foreground">{r.surfactantType}</span>
                    {r.surfactantConc > 0 && ` (${r.surfactantConc}%)`}
                    <br />
                    Объём: <span className="text-foreground">{r.volumePerMeterPayZone} м³/м</span> · ΔS:{" "}
                    <span className="text-foreground">−{r.skinReductionEstimate[0]}…−{r.skinReductionEstimate[1]}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ───────── Шаг 3: Параметры ───────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Шаг 3 — Параметры операции</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <SliderRow
            label="Количество циклов"
            value={opts.numberOfCycles}
            min={1} max={5} step={1}
            display={`${opts.numberOfCycles}`}
            onChange={(v) => setOpts({ ...opts, numberOfCycles: v })}
          />
          <SliderRow
            label="Расход закачки, л/с"
            value={opts.injectionRateLps}
            min={1} max={15} step={0.5}
            display={`${opts.injectionRateLps.toFixed(1)} л/с`}
            onChange={(v) => setOpts({ ...opts, injectionRateLps: v })}
          />
          <SliderRow
            label="Время выдержки, мин"
            value={opts.soakTimeMin}
            min={15} max={240} step={15}
            display={`${opts.soakTimeMin} мин`}
            onChange={(v) => setOpts({ ...opts, soakTimeMin: v })}
          />
          <SliderRow
            label="Целевой радиус проникновения, м"
            value={opts.targetPenetrationM}
            min={0.5} max={5} step={0.1}
            display={`${opts.targetPenetrationM.toFixed(1)} м`}
            onChange={(v) => setOpts({ ...opts, targetPenetrationM: v })}
          />
          <div className="flex items-center gap-3">
            <Switch
              checked={opts.usePacker}
              onCheckedChange={(v) => setOpts({ ...opts, usePacker: !!v })}
              id="use-packer"
            />
            <Label htmlFor="use-packer">Установлен пакер (изолирует ОК от давления)</Label>
          </div>
        </CardContent>
      </Card>

      {/* ───────── Шаг 4: Результат ───────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Шаг 4 — Результат расчёта</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Сводка */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ResultBlock title="Объёмы">
              <Row k="Раствор обр. (всего)" v={`${fmt(result.treatmentVolumeM3)} м³`} />
              <Row k="Пена на устье" v={`${fmt(result.foamVolumeAtSurfaceM3)} м³`} />
              <Row k="Пена на забое" v={`${fmt(result.foamVolumeAtFormationM3)} м³`} />
              <Row k="N₂ (стд. усл.)" v={`${fmt(result.n2VolumeStdM3)} м³`} />
              <Row k="N₂ (забой)" v={`${fmt(result.n2VolumeAtFormationM3)} м³`} />
              <Row k="Продавка" v={`${fmt(result.displacementVolumeM3)} м³`} />
            </ResultBlock>

            <ResultBlock title="Давления">
              <Row k="P устья (закачка)" v={`${fmt(result.injectionPressureMPa)} МПа`} />
              <Row k="P забой" v={`${fmt(result.bottomholePressureMPa)} МПа`} />
              <Row k="P ГРП" v={`${fmt(result.maxAllowedPressureMPa)} МПа`} />
              <Row
                k="Запас до ГРП"
                v={`${fmt(result.pressureMarginMPa)} МПа`}
                accent={result.pressureMarginMPa < 1 ? "danger" : result.pressureMarginMPa < 3 ? "warn" : "ok"}
              />
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
                  <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Все параметры в допустимом диапазоне — операция безопасна.
            </div>
          )}

          {/* Циклограмма */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Циклограмма P(t)</h4>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={cyclo.points}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={[0, "dataMax"]}
                  label={{ value: "Время, мин", position: "insideBottom", offset: -5 }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  label={{ value: "Давление, МПа", angle: -90, position: "insideLeft" }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  formatter={(v: number, n) => [`${v.toFixed(2)} МПа`, n as string]}
                  labelFormatter={(t: number) => `t = ${t.toFixed(1)} мин`}
                />
                <Legend />
                <ReferenceLine y={well.fracturePressureMPa} stroke="hsl(0 84% 60%)" strokeDasharray="6 4"
                  label={{ value: "P ГРП", fill: "hsl(0 84% 60%)", position: "right" }} />
                <ReferenceLine y={well.reservoirPressureMPa} stroke="hsl(142 71% 45%)" strokeDasharray="4 4"
                  label={{ value: "Pпл", fill: "hsl(142 71% 45%)", position: "right" }} />
                <Line type="monotone" dataKey="surfacePressure" stroke="hsl(217 91% 60%)" name="P устья" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="bhp" stroke="hsl(25 95% 53%)" name="P забой" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>

            {/* Легенда циклов */}
            <div className="mt-3 flex flex-wrap gap-2">
              {cyclo.cycles.map((c) => (
                <div key={c.cycleNumber} className="rounded-md border border-border bg-card px-3 py-1.5 text-xs">
                  <span className="font-semibold">Цикл {c.cycleNumber}:</span>{" "}
                  {c.steps.map((s) => `${s.name} (${s.durationMin.toFixed(0)} мин)`).join(" → ")}
                </div>
              ))}
            </div>
          </div>

          {/* Прогноз эффекта */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Прогноз эффекта обработки
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Metric label="Скин текущий" value={fmt(result.currentSkin, 1)} />
              <Metric label="Скин ожидаемый" value={fmt(result.expectedSkin, 1)} accent="ok" />
              <Metric label="Снижение скина" value={`−${fmt(result.expectedSkinReduction, 1)}`} accent="ok" />
              <Metric
                label="Прирост дебита"
                value={`+${fmt(result.expectedProductionIncreasePct, 0)} %`}
                accent="ok"
              />
              {result.expectedRateTpd != null && well.currentRateTpd != null && (
                <>
                  <Metric label="Дебит до" value={`${fmt(well.currentRateTpd, 1)} т/сут`} />
                  <Metric label="Дебит после" value={`${fmt(result.expectedRateTpd, 1)} т/сут`} accent="ok" />
                </>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              Прогноз по формуле Дюпюи: Q = (k·h·ΔP)/(18.41·μ·B·(ln(Re/rw)+S)). Прирост = (Sтек+ln(Re/rw))/(Sпосле+ln(Re/rw)) − 1.
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

          {/* SVG-схема обвязки */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Схема обвязки КРС</h4>
            <TreatmentRigSchematic recipe={recipe} usePacker={opts.usePacker} />
          </div>
        </CardContent>
      </Card>
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
}: {
  label: string; value: number; min: number; max: number; step: number;
  display: string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <Label>{label}</Label>
        <span className="font-mono text-foreground">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(arr) => onChange(arr[0])}
      />
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
  const cls =
    accent === "ok" ? "text-emerald-500" :
    accent === "warn" ? "text-amber-500" :
    accent === "danger" ? "text-red-500" : "text-foreground";
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

function EquipBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="font-medium text-foreground mt-0.5">{value}</div>
    </div>
  );
}

/* ─────────── SVG-схема обвязки ─────────── */

function TreatmentRigSchematic({
  recipe, usePacker,
}: { recipe: FoamTreatmentRecipe; usePacker: boolean }) {
  const fluidLabel =
    recipe.baseFluidType === "acid_hcl" ? "HCl" :
    recipe.baseFluidType === "acid_hf_mud" ? "HCl+HF" :
    recipe.baseFluidType === "solvent" ? "Растворитель" :
    recipe.baseFluidType === "brine" ? "Рассол" : "Вода + ПАВ";

  const showN2 = recipe.type !== "foam_sgps";

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox="0 0 720 360" className="w-full min-w-[640px] h-auto rounded-lg border border-border bg-card">
        {/* Заголовок */}
        <text x="360" y="22" textAnchor="middle" className="fill-foreground" style={{ fontSize: 13, fontWeight: 600 }}>
          Обвязка для пенообработки ПЗП
        </text>

        {/* Ёмкость с раствором */}
        <rect x="20" y="80" width="100" height="70" fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
        <text x="70" y="110" textAnchor="middle" className="fill-foreground" style={{ fontSize: 11, fontWeight: 600 }}>Ёмкость</text>
        <text x="70" y="128" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>{fluidLabel}</text>
        <text x="70" y="142" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>ПАВ {recipe.surfactantConc}%</text>

        {/* Насос */}
        <rect x="180" y="80" width="100" height="70" fill="hsl(217 91% 60% / 0.15)" stroke="hsl(217 91% 60%)" />
        <text x="230" y="110" textAnchor="middle" className="fill-foreground" style={{ fontSize: 11, fontWeight: 600 }}>Насос</text>
        <text x="230" y="128" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>ЦА-320 / СИН</text>

        {/* Линия ёмкость → насос */}
        <line x1="120" y1="115" x2="180" y2="115" stroke="hsl(217 91% 60%)" strokeWidth="2" />
        <polygon points="178,111 184,115 178,119" fill="hsl(217 91% 60%)" />

        {/* Азотная установка */}
        {showN2 && (
          <>
            <rect x="180" y="200" width="100" height="70" fill="hsl(192 91% 60% / 0.15)" stroke="hsl(192 91% 60%)" />
            <text x="230" y="230" textAnchor="middle" className="fill-foreground" style={{ fontSize: 11, fontWeight: 600 }}>АГУ-8К</text>
            <text x="230" y="248" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>N₂ газ</text>
            <text x="230" y="262" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>до 8 м³/мин</text>
          </>
        )}

        {/* Пеногенератор */}
        <rect x="330" y="140" width="100" height="70" fill="hsl(280 70% 60% / 0.15)" stroke="hsl(280 70% 60%)" />
        <text x="380" y="170" textAnchor="middle" className="fill-foreground" style={{ fontSize: 11, fontWeight: 600 }}>Пеногенератор</text>
        <text x="380" y="188" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>ПГ-150</text>
        <text x="380" y="202" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>FQ {recipe.targetFoamQuality}%</text>

        {/* Линии в пеногенератор */}
        <line x1="280" y1="115" x2="330" y2="160" stroke="hsl(217 91% 60%)" strokeWidth="2" />
        {showN2 && <line x1="280" y1="235" x2="330" y2="190" stroke="hsl(192 91% 60%)" strokeWidth="2" />}

        {/* Устьевая арматура */}
        <rect x="490" y="140" width="80" height="70" fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
        <text x="530" y="170" textAnchor="middle" className="fill-foreground" style={{ fontSize: 11, fontWeight: 600 }}>Устьевая</text>
        <text x="530" y="186" textAnchor="middle" className="fill-foreground" style={{ fontSize: 11, fontWeight: 600 }}>арматура</text>

        {/* Линия пеногенератор → устье */}
        <line x1="430" y1="175" x2="490" y2="175" stroke="hsl(280 70% 60%)" strokeWidth="3" />
        <polygon points="488,170 494,175 488,180" fill="hsl(280 70% 60%)" />

        {/* Скважина */}
        <rect x="620" y="140" width="60" height="200" fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
        <line x1="635" y1="140" x2="635" y2="340" stroke="hsl(var(--border))" />
        <line x1="665" y1="140" x2="665" y2="340" stroke="hsl(var(--border))" />
        <text x="650" y="160" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>НКТ</text>

        {/* Пакер */}
        {usePacker && (
          <>
            <rect x="625" y="270" width="50" height="14" fill="hsl(0 84% 60%)" />
            <text x="690" y="282" className="fill-muted-foreground" style={{ fontSize: 10 }}>Пакер</text>
          </>
        )}

        {/* Перфорация */}
        <g stroke="hsl(25 95% 53%)" strokeWidth="2">
          <line x1="620" y1="300" x2="610" y2="300" />
          <line x1="620" y1="310" x2="610" y2="310" />
          <line x1="620" y1="320" x2="610" y2="320" />
          <line x1="680" y1="300" x2="690" y2="300" />
          <line x1="680" y1="310" x2="690" y2="310" />
          <line x1="680" y1="320" x2="690" y2="320" />
        </g>
        <text x="650" y="355" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 10 }}>Перфорация → Пласт</text>

        {/* Линия устье → скважина */}
        <line x1="570" y1="175" x2="635" y2="175" stroke="hsl(280 70% 60%)" strokeWidth="3" />
        <line x1="635" y1="175" x2="635" y2="270" stroke="hsl(280 70% 60%)" strokeWidth="3" />
        <polygon points="631,268 635,276 639,268" fill="hsl(280 70% 60%)" />
      </svg>
    </div>
  );
}
