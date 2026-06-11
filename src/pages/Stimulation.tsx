import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, AlertTriangle, FlaskConical, Sparkles, Calculator, ListChecks, TrendingUp, FileText } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { rankMethods, type ReservoirData, type RankedMethod, scoreColor } from "@/lib/stimulation-ranking";
import { STIMULATION_METHODS, METHOD_CATEGORY_LABEL, COLLECTOR_LABEL, type StimulationMethod, type CollectorType, type MethodCategory } from "@/lib/stimulation-methods";
import { buildAcidStages, computeAcidKinetics, acidDistribution } from "@/lib/stimulation-acid";
import type { DamageAssessment } from "@/lib/foam-treatment-diagnostics";

const TABS = [
  { id: "diag", label: "Диагностика", icon: FlaskConical },
  { id: "method", label: "Метод", icon: Sparkles },
  { id: "calc", label: "Расчёт", icon: Calculator },
  { id: "plan", label: "План операции", icon: ListChecks },
  { id: "forecast", label: "Прогноз", icon: TrendingUp },
  { id: "report", label: "Отчёт", icon: FileText },
] as const;

export default function Stimulation() {
  const [tab, setTab] = useState<string>("diag");

  // Reservoir input
  const [reservoir, setReservoir] = useState<ReservoirData>({
    collectorType: "carbonate",
    temperatureC: 75,
    permeability_mD: 15,
    porosity: 0.15,
    payZoneM: 12,
    reservoirPressureMPa: 22,
  });
  const [damage, setDamage] = useState<DamageAssessment[]>([]);
  const [selectedMethodId, setSelectedMethodId] = useState<string>("hcl-matrix");
  const [categoryFilter, setCategoryFilter] = useState<MethodCategory | "all">("all");

  const ranked = useMemo(() => rankMethods(reservoir, damage), [reservoir, damage]);
  const selected = useMemo(() => STIMULATION_METHODS.find((m) => m.id === selectedMethodId)!, [selectedMethodId]);

  const acidVol = useMemo(() => selected.volumePerMeterPay * reservoir.payZoneM * selected.numberOfCycles, [selected, reservoir]);

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
      const perM3 = a.unit === "%" ? a.concentration / 100 * 1000 : a.unit === "кг/м³" ? a.concentration : a.concentration;
      return s + acidVol * perM3 * a.costPerUnit;
    }, 0);
    return Math.round(main + adds);
  }, [selected, acidVol]);

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
        <p className="text-sm text-muted-foreground max-w-3xl">
          Единый модуль выбора и расчёта обработки ПЗП: кислотные, пенные, комбинированные, азотные, растворительные
          и физические методы. Диагностика → подбор технологии → расчёт → план → прогноз → отчёт.
        </p>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6 h-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="text-xs sm:text-sm py-2 gap-1.5">
                <t.icon className="w-3.5 h-3.5" /> <span className="hidden sm:inline">{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* DIAGNOSTICS */}
          <TabsContent value="diag" className="space-y-4 mt-4">
            <Card className="p-4 space-y-4">
              <h2 className="font-semibold">Параметры скважины и коллектора</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
              </div>
              <p className="text-xs text-muted-foreground">
                Полная диагностика (IPR Вогель/Дюпюи, скин-декомпозиция, кривые Арпса, авто-механизм повреждения)
                доступна в модуле <Link to="/well-treatment/foam-opz" className="underline">Пенообработка ПЗП</Link>.
                В этой версии задайте параметры вручную; результат диагностики используется ниже для ранжирования методов.
              </p>
            </Card>
            <Card className="p-4">
              <Button onClick={() => setTab("method")}>Перейти к выбору метода →</Button>
            </Card>
          </TabsContent>

          {/* METHOD SELECTION */}
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
              {ranked
                .filter((r) => categoryFilter === "all" || r.method.category === categoryFilter)
                .map((r) => (
                  <MethodCard key={r.method.id} ranked={r} selected={selectedMethodId === r.method.id} onSelect={() => { setSelectedMethodId(r.method.id); toast.success(`Выбран: ${r.method.nameRu}`); setTab("calc"); }} />
                ))}
            </div>
          </TabsContent>

          {/* CALCULATION */}
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
              <Card className="p-4">
                <h3 className="font-semibold mb-3">Кинетика и проникновение</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <KV k="Скорость реакции" v={`${kinetics.reactionRate.toExponential(2)} моль/(м²·с)`} />
                  <KV k="Радиус проникновения" v={`${kinetics.penetrationRadius.toFixed(2)} м`} />
                  {kinetics.wormholeLength > 0 && <KV k="Длина wormhole" v={`${kinetics.wormholeLength.toFixed(2)} м`} />}
                  <KV k="Растворено породы" v={`${kinetics.dissolutionVolume.toFixed(2)} м³`} />
                  <KV k="Отработанной кислоты" v={`${kinetics.spentAcidVolume.toFixed(2)} м³`} />
                  <KV k="Остаточная конц." v={`${kinetics.residualAcidConcentration.toFixed(1)}%`} />
                </div>
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

          {/* PLAN */}
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
                Детальная циклограмма формируется для кислотных и комбинированных методов. Для метода
                «{selected.nameRu}» используйте параметры закачки из вкладки «Расчёт».
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

            {selected.risks.length > 0 && (
              <Card className="p-4 border-amber-500/40">
                <h3 className="font-semibold mb-2 flex items-center gap-2 text-amber-600 dark:text-amber-400"><AlertTriangle className="w-4 h-4" /> Риски и противопоказания</h3>
                <ul className="text-sm space-y-1 list-disc pl-5">
                  {selected.risks.map((r, i) => <li key={i}>{r}</li>)}
                  {selected.contraindications.map((c, i) => <li key={`c${i}`} className="text-destructive">Противопоказано: {c}</li>)}
                </ul>
              </Card>
            )}
          </TabsContent>

          {/* FORECAST (simple stub linking to foam module) */}
          <TabsContent value="forecast" className="space-y-4 mt-4">
            <Card className="p-4 space-y-3">
              <h3 className="font-semibold">Прогноз эффекта</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="ΔS (мин)" value={`-${selected.skinReductionRange[0]}`} />
                <Stat label="ΔS (макс)" value={`-${selected.skinReductionRange[1]}`} />
                <Stat label="Эффект" value={`${selected.effectDurationMonths[0]}–${selected.effectDurationMonths[1]} мес`} />
                <Stat label="Успешность" value={`${selected.successRate}%`} />
              </div>
              <p className="text-xs text-muted-foreground">
                Полный прогноз IPR/Арпс/NPV доступен в модуле{" "}
                <Link to="/well-treatment/foam-opz" className="underline">Пенообработка ПЗП</Link>{" "}
                — там же экономика и tornado-анализ чувствительности.
              </p>
            </Card>
          </TabsContent>

          {/* REPORT */}
          <TabsContent value="report" className="space-y-4 mt-4">
            <Card className="p-4 space-y-3">
              <h3 className="font-semibold">DOCX-отчёт</h3>
              <p className="text-sm text-muted-foreground">План-программа ОПЗ со всеми этапами, реагентами, режимами и рисками.</p>
              <Button onClick={() => toast.info("Экспорт в DOCX будет добавлен в следующем релизе модуля стимуляции.")}>
                <FileText className="w-4 h-4 mr-2" /> Скачать план-программу
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
