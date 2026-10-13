import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, AlertTriangle, Wrench, Gauge, FlaskConical, ListChecks, LineChart as LineIcon } from "lucide-react";
import {
  calculateRir, DEFAULT_RIR, STEEL_GRADES, LEAK_KIND_LABEL, TOOL_LABEL, COMPOSITION_LABEL,
  type RirInputs, type LeakKind, type ToolKind, type CompositionKind,
} from "@/lib/rir-calculations";
import RirWellSchematic from "./RirWellSchematic";
import RirTubingCard from "./RirTubingCard";
import { analyseTubing, DEFAULT_TUBING_MECH, type TubingMechInputs } from "@/lib/rir-tubing";
import { InjectivityChart, PenetrationDiagram, PressureWindowChart, HesitationChart } from "./RirCharts";

const KEY = "rir_inputs_v1";
const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

function load(): RirInputs {
  try { const raw = localStorage.getItem(KEY); return raw ? { ...DEFAULT_RIR, ...JSON.parse(raw) } : DEFAULT_RIR; } catch { return DEFAULT_RIR; }
}

function Num({ label, unit, value, onChange, step }: { label: string; unit?: string; value: number; onChange: (v: number) => void; step?: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <label className="flex flex-col gap-0.5 text-[11px]">
      <span className="text-muted-foreground">{label}{unit ? `, ${unit}` : ""}</span>
      <input
        inputMode="decimal" step={step} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { const v = parseFloat(draft.replace(",", ".")); if (Number.isFinite(v)) onChange(v); else setDraft(String(value)); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="h-8 rounded border border-border bg-background px-2 text-xs"
      />
    </label>
  );
}

function Sel<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Record<string, string>; onChange: (v: T) => void }) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="h-8 rounded border border-border bg-background px-2 text-xs">
        {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
    </label>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className={`rounded-lg border p-2.5 ${tone === "bad" ? "border-destructive/60" : tone === "warn" ? "border-amber-500/60" : "border-border"}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-base font-semibold leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

const GRADE_OPTIONS = Object.fromEntries(Object.keys(STEEL_GRADES).map((k) => [k, `${k} — ${STEEL_GRADES[k]} МПа`]));

/** РИР: ликвидация негерметичности колонны и заколонных / межколонных перетоков (этап 1). */
export default function RirModule({ trajectory }: { trajectory?: RirInputs["trajectory"] }) {
  const [inp, setInp] = useState<RirInputs>(load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(inp)); } catch { /* недоступно */ } }, [inp]);
  const full = useMemo(() => ({ ...inp, trajectory: trajectory && trajectory.length > 1 ? trajectory : inp.trajectory }), [inp, trajectory]);
  const res = useMemo(() => calculateRir(full), [full]);
  const [mech, setMech] = useState<TubingMechInputs>(() => { try { return { ...DEFAULT_TUBING_MECH, ...JSON.parse(localStorage.getItem("rir_mech_v1") || "{}") }; } catch { return DEFAULT_TUBING_MECH; } });
  useEffect(() => { try { localStorage.setItem("rir_mech_v1", JSON.stringify(mech)); } catch { /* недоступно */ } }, [mech]);
  const mechRes = useMemo(() => {
    if (inp.tool.kind === "bradenhead") return null;
    const tdT = res.leakTVD > 0 ? res.toolTVD / res.leakTVD : 1;
    return analyseTubing({
      toolMD: inp.tool.setDepthMD, toolTVD: res.toolTVD, tubingOdMm: inp.tubing.odMm, tubingWallMm: inp.tubing.wallMm, tubingGrade: inp.tubing.grade,
      casingIdMm: res.casingID, wellFluidDensity: inp.wellFluidDensity, surfaceTempC: inp.surfaceTempC,
      toolStaticC: inp.surfaceTempC + (res.temps.bhstC - inp.surfaceTempC) * tdT, toolCircC: inp.surfaceTempC + (res.temps.bhctC - inp.surfaceTempC) * tdT,
      squeezeSurfaceMPa: res.maxSurfaceMPa, annulusBackPressureMPa: inp.annulusBackPressureMPa,
    }, mech);
  }, [inp, res, mech]);
  const workProgram = useMemo(() => {
    if (!mechRes) return res.workProgram;
    const i = res.workProgram.findIndex((s) => s.title.startsWith("Спуск и установка"));
    const step = {
      title: "Контроль НКТ при задавливании",
      text: `По расчёту Лубинского НКТ ${mechRes.totalDLmm < 0 ? "укоротятся" : "удлинятся"} на ${Math.abs(mechRes.totalDLmm).toFixed(0)} мм. ${mech.mode === "free"
        ? `Разгрузка на ретейнер ${Math.max(mech.setDownKN, mechRes.setDownNeededKN ?? 0)} кН${mechRes.backPressureNeededMPa !== null ? `, противодавление в затрубье ${mechRes.backPressureNeededMPa.toFixed(1)} МПа` : ""} — стингер остаётся в уплотнении.`
        : `Усилие на пакер в конце задавливания ${mechRes.packerForceKN.toFixed(0)} кН.`} Контролировать вес на крюке: ${mechRes.hookLoad.initialKN.toFixed(0)} → ${mechRes.hookLoad.squeezeKN.toFixed(0)} кН.`,
    };
    const w = [...res.workProgram];
    w.splice(i >= 0 ? i + 1 : 2, 0, step);
    return w;
  }, [res, mechRes, mech]);
  const up = (patch: Partial<RirInputs>) => setInp((s) => ({ ...s, ...patch }));
  const setCasing = (p: Partial<RirInputs["casing"]>) => setInp((s) => ({ ...s, casing: { ...s.casing, ...p } }));
  const setLeak = (p: Partial<RirInputs["leak"]>) => setInp((s) => ({ ...s, leak: { ...s.leak, ...p } }));
  const setTool = (p: Partial<RirInputs["tool"]>) => setInp((s) => ({ ...s, tool: { ...s.tool, ...p } }));
  const setTub = (p: Partial<RirInputs["tubing"]>) => setInp((s) => ({ ...s, tubing: { ...s.tubing, ...p } }));
  const setOuter = (p: Partial<NonNullable<RirInputs["outerCasing"]>>) => setInp((s) => ({ ...s, outerCasing: { ...(s.outerCasing ?? { odMm: 244.5, wallMm: 8.9, shoeMD: 0 }), ...p } }));

  const winSurf = res.maxSurfaceMPa;
  const fitOk = !res.fit || res.maxBhpMPa > res.fit.openingBhpMPa;

  return (
    <div className="space-y-3" data-testid="rir-module">
      <Card className="border-primary/30">
        <CardContent className="py-3 px-4 text-xs text-muted-foreground">
          <b className="text-foreground">РИР — ремонтно-изоляционные работы.</b> Ликвидация негерметичности колонны (тело, муфты), заколонных и межколонных перетоков,
          отключение интервалов задавливанием состава через пакер-ретейнер, извлекаемый пакер или с устья. Расчёт пересчитывается сразу при вводе.
        </CardContent>
      </Card>

      {/* ═══ Исходные данные ═══ */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="py-2.5 px-4"><CardTitle className="text-sm flex items-center gap-2"><Wrench className="w-4 h-4" />Скважина и колонны</CardTitle></CardHeader>
          <CardContent className="pt-0 grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Num label="Глубина скважины" unit="м" value={inp.wellDepthMD} onChange={(v) => up({ wellDepthMD: v })} />
            <Num label="t° статич. на забое" unit="°C" value={inp.bottomTempStaticC} onChange={(v) => up({ bottomTempStaticC: v })} />
            <Num label="t° на устье" unit="°C" value={inp.surfaceTempC} onChange={(v) => up({ surfaceTempC: v })} />
            <Num label="Колонна: нар. ∅" unit="мм" value={inp.casing.odMm} onChange={(v) => setCasing({ odMm: v })} />
            <Num label="Колонна: стенка" unit="мм" value={inp.casing.wallMm} onChange={(v) => setCasing({ wallMm: v })} />
            <Sel label="Колонна: группа прочности" value={inp.casing.grade} options={GRADE_OPTIONS} onChange={(v) => setCasing({ grade: v })} />
            <Num label="Цемент за колонной от" unit="м" value={inp.casing.cementTopMD} onChange={(v) => setCasing({ cementTopMD: v })} />
            <Num label="Предыдущая колонна: ∅" unit="мм" value={inp.outerCasing?.odMm ?? 0} onChange={(v) => setOuter({ odMm: v })} />
            <Num label="Предыдущая: башмак" unit="м" value={inp.outerCasing?.shoeMD ?? 0} onChange={(v) => setOuter({ shoeMD: v })} />
            <Num label="НКТ: нар. ∅" unit="мм" value={inp.tubing.odMm} onChange={(v) => setTub({ odMm: v })} />
            <Num label="НКТ: стенка" unit="мм" value={inp.tubing.wallMm} onChange={(v) => setTub({ wallMm: v })} />
            <Sel label="НКТ: группа прочности" value={inp.tubing.grade} options={GRADE_OPTIONS} onChange={(v) => setTub({ grade: v })} />
            <Num label="Раствор в скважине" unit="г/см³" value={inp.wellFluidDensity} onChange={(v) => up({ wellFluidDensity: v })} />
            <Num label="Градиент ГРП" unit="МПа/м" value={inp.fracGradientMPaM} onChange={(v) => up({ fracGradientMPaM: v })} />
            <Num label="Давление в зоне за колонной" unit="МПа (0 — гидростат.)" value={inp.zonePressureMPa} onChange={(v) => up({ zonePressureMPa: v })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2.5 px-4"><CardTitle className="text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-red-500" />Нарушение и оборудование</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="col-span-2 sm:col-span-3"><Sel label="Тип нарушения" value={inp.leak.kind} options={LEAK_KIND_LABEL} onChange={(v) => setLeak({ kind: v as LeakKind })} /></div>
              <Num label="Кровля нарушения" unit="м" value={inp.leak.topMD} onChange={(v) => setLeak({ topMD: v })} />
              <Num label="Подошва нарушения" unit="м" value={inp.leak.bottomMD} onChange={(v) => setLeak({ bottomMD: v })} />
              <Num label="Межколонное давление" unit="МПа" value={inp.leak.annulusPressureMPa} onChange={(v) => setLeak({ annulusPressureMPa: v })} />
              <div className="col-span-2 sm:col-span-3"><Sel label="Способ задавливания" value={inp.tool.kind} options={TOOL_LABEL} onChange={(v) => setTool({ kind: v as ToolKind })} /></div>
              {inp.tool.kind !== "bradenhead" && <Num label="Глубина установки" unit="м" value={inp.tool.setDepthMD} onChange={(v) => setTool({ setDepthMD: v })} />}
              {inp.tool.kind !== "bradenhead" && <Num label="Рабочий перепад" unit="МПа" value={inp.tool.ratingMPa} onChange={(v) => setTool({ ratingMPa: v })} />}
              {inp.tool.kind !== "bradenhead" && <Num label="Противодавление в затрубье" unit="МПа" value={inp.annulusBackPressureMPa} onChange={(v) => up({ annulusBackPressureMPa: v })} />}
              <div className="col-span-2 sm:col-span-3"><Sel label="Состав" value={inp.composition} options={{ auto: "Автовыбор по приёмистости", ...COMPOSITION_LABEL }} onChange={(v) => up({ composition: v as CompositionKind | "auto" })} /></div>
              <Num label="Плотность состава" unit="г/см³ (0 — типовая)" value={inp.compositionDensity} onChange={(v) => up({ compositionDensity: v })} />
              <Num label="Расход закачки" unit="л/с" value={inp.pumpRateLs} onChange={(v) => up({ pumpRateLs: v })} />
              <Num label="Кз на разрыв" value={inp.sfBurst} onChange={(v) => up({ sfBurst: v })} />
              <Num label="Ступеней задавливания" value={inp.hesitationStages} onChange={(v) => up({ hesitationStages: Math.max(1, Math.round(v)) })} />
              <Num label="Выдержка на ступени" unit="мин" value={inp.hesitationHoldMin} onChange={(v) => up({ hesitationHoldMin: v })} />
            </div>
            <div className="rounded-md border border-border p-2 space-y-1.5">
              <p className="text-[11px] font-semibold">Приёмистость (закачка технической воды)</p>
              {inp.injectivity.map((p, i) => (
                <div key={i} className="flex items-end gap-2">
                  <div className="flex-1"><Num label={`Режим ${i + 1}: расход`} unit="м³/ч" value={p.rateM3h} onChange={(v) => setInp((s) => ({ ...s, injectivity: s.injectivity.map((x, j) => (j === i ? { ...x, rateM3h: v } : x)) }))} /></div>
                  <div className="flex-1"><Num label="давление на устье" unit="МПа" value={p.surfacePressureMPa} onChange={(v) => setInp((s) => ({ ...s, injectivity: s.injectivity.map((x, j) => (j === i ? { ...x, surfacePressureMPa: v } : x)) }))} /></div>
                  <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setInp((s) => ({ ...s, injectivity: s.injectivity.filter((_, j) => j !== i) }))}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setInp((s) => ({ ...s, injectivity: [...s.injectivity, { rateM3h: 0.5, surfacePressureMPa: 8 }] }))}><Plus className="w-3.5 h-3.5 mr-1" />режим</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══ Итоги ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2" data-testid="rir-kpi">
        <Kpi label="Рекомендуемый состав" value={COMPOSITION_LABEL[res.composition].split(" (")[0]} sub={`${f(res.compositionDensity, 2)} г/см³`} />
        <Kpi label="Канал (оценка)" value={res.apertureUm !== null ? `~${f(res.apertureUm, 0)} мкм` : "—"} sub={res.fit ? `J = ${f(res.fit.J, 2)} м³/(ч·МПа)` : "нет приёмистости"} />
        <Kpi label="Допустимо на устье" value={`${f(winSurf, 1)} МПа`} sub={`на глубине ${f(res.maxBhpMPa, 1)} МПа`} tone={winSurf <= 0 ? "bad" : undefined} />
        <Kpi label="Ограничивает" value={res.governing.split(" (")[0]} tone={!fitOk ? "bad" : undefined} />
        <Kpi label="Объём состава" value={`${f(res.volumes.totalM3, 2)} м³`} sub={`задавливание ${f(res.volumes.squeezeM3, 2)} м³`} />
        <Kpi label="Время жизни состава" value={`≥ ${res.timing.requiredWorkLifeMin} мин`} sub={`операция ${f(res.timing.jobMin, 0)} мин · BHCT ${f(res.temps.bhctC, 0)} °C`} />
      </div>
      {res.warnings.map((w) => <div key={w} className="text-xs text-amber-700 dark:text-amber-500 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{w}</div>)}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
        <Card>
          <CardHeader className="py-2.5 px-4"><CardTitle className="text-sm">Схема работ</CardTitle></CardHeader>
          <CardContent className="pt-0 flex justify-center"><RirWellSchematic inp={full} res={res} /></CardContent>
        </Card>
        <div className="space-y-3">
          <Card>
            <CardHeader className="py-2.5 px-4"><CardTitle className="text-sm flex items-center gap-2"><FlaskConical className="w-4 h-4" />Выбор состава: проходимость в канал</CardTitle></CardHeader>
            <CardContent className="pt-0 space-y-2">
              <PenetrationDiagram res={res} />
              {res.compositionReason.map((r) => <p key={r} className="text-xs">• {r}</p>)}
              {res.apertureNote && <p className="text-[11px] text-muted-foreground">{res.apertureNote} Правило проходимости: раскрытие ≥ 3·d95 частиц состава. Оценка ориентировочная — уточняется поведением давления при задавливании.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-2.5 px-4"><CardTitle className="text-sm flex items-center gap-2"><LineIcon className="w-4 h-4" />Приёмистость</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <InjectivityChart res={res} />
              <p className="text-[11px] text-muted-foreground">Устьевое давление пересчитано на глубину нарушения (+ гидростатика воды − трение в НКТ). Зелёная зона — рабочее окно задавливания{res.fit ? `; при допустимом давлении расход ≈ ${f(res.squeezeRateAtMaxM3h, 2)} м³/ч` : ""}.</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="py-2.5 px-4"><CardTitle className="text-sm flex items-center gap-2"><Gauge className="w-4 h-4" />Окно давлений по глубине</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <PressureWindowChart res={res} leakTopMD={inp.leak.topMD} leakBottomMD={inp.leak.bottomMD} toolMD={inp.tool.kind === "bradenhead" ? 0 : inp.tool.setDepthMD} />
            <table className="w-full text-[11px] mt-2">
              <thead className="bg-muted/50"><tr><th className="p-1 text-left">Ограничение</th><th className="p-1 text-right">На глубине нарушения</th><th className="p-1 text-right">На устье</th></tr></thead>
              <tbody>
                {res.constraints.map((c) => (
                  <tr key={c.name} className={`border-t border-border/40 ${c.name === res.governing ? "font-semibold text-primary" : ""}`}>
                    <td className="p-1">{c.name}<div className="text-[10px] text-muted-foreground font-normal">{c.note}</div></td>
                    <td className="p-1 text-right">{f(c.limitBhpMPa, 1)} МПа</td>
                    <td className="p-1 text-right">{f(Math.max(0, c.limitSurfaceMPa), 1)} МПа</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-2.5 px-4"><CardTitle className="text-sm">План ступенчатого задавливания</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-2">
            <HesitationChart res={res} />
            <p className="text-[11px] text-muted-foreground">Схема: {inp.hesitationStages} ступеней по ~{f(res.volumes.squeezeM3 / Math.max(1, inp.hesitationStages), 2)} м³ с выдержкой {inp.hesitationHoldMin} мин; давление растёт по мере заполнения канала. Фактическая кривая пишется при работе и сравнивается с планом.</p>
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50"><tr><th className="p-1 text-left">Объёмы</th><th className="p-1 text-right">м³</th></tr></thead>
              <tbody>
                {[
                  ["Состав в колонне под инструментом (до подошвы + 5 м)", res.volumes.belowToolM3],
                  ["Задавливание в канал", res.volumes.squeezeM3],
                  ["Запас (линии, смешение)", res.volumes.reserveM3],
                  ["ИТОГО состава", res.volumes.totalM3],
                  ["Продавка (объём НКТ до инструмента)", res.volumes.displacementM3],
                  ["Обратная промывка", res.volumes.reverseOutM3],
                ].map(([n, v]) => <tr key={n as string} className="border-t border-border/40"><td className="p-1">{n}</td><td className="p-1 text-right">{f(v as number, 2)}</td></tr>)}
              </tbody>
            </table>
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50"><tr><th className="p-1 text-left">Прочность труб (API 5C3)</th><th className="p-1 text-right">Разрыв</th><th className="p-1 text-right">Смятие</th></tr></thead>
              <tbody>
                <tr className="border-t border-border/40"><td className="p-1">Колонна {inp.casing.odMm}×{inp.casing.wallMm}, {inp.casing.grade}</td><td className="p-1 text-right">{f(res.casingBurstMPa, 1)} МПа</td><td className="p-1 text-right">{f(res.casingCollapse.pMPa, 1)} МПа ({res.casingCollapse.regime})</td></tr>
                <tr className="border-t border-border/40"><td className="p-1">НКТ {inp.tubing.odMm}×{inp.tubing.wallMm}, {inp.tubing.grade}</td><td className="p-1 text-right">{f(res.tubingBurstMPa, 1)} МПа</td><td className="p-1 text-right">{f(res.tubingCollapse.pMPa, 1)} МПа ({res.tubingCollapse.regime})</td></tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {mechRes && <RirTubingCard r={mechRes} m={mech} onChange={(p) => setMech((x) => ({ ...x, ...p }))} />}

      <Card>
        <CardHeader className="py-2.5 px-4"><CardTitle className="text-sm flex items-center gap-2"><ListChecks className="w-4 h-4" />Ход работ <Badge variant="outline" className="text-[10px]">формируется по расчёту</Badge></CardTitle></CardHeader>
        <CardContent className="pt-0">
          <ol className="space-y-2">
            {workProgram.map((s, i) => (
              <li key={s.title} className="flex gap-3 text-xs">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-semibold">{i + 1}</span>
                <div><p className="font-semibold">{s.title}{s.timeMin ? <span className="font-normal text-muted-foreground"> · ~{f(s.timeMin, 0)} мин</span> : null}</p><p className="text-muted-foreground">{s.text}</p></div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
