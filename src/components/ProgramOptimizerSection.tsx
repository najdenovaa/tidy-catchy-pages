import {runOptimizerInWorker} from '@/lib/optimizer-worker-client';
import {buildProcessContract} from '@/lib/cementing-process';
import EquipmentLibrary from './EquipmentLibrary';
import {readEquipmentLibrary} from '@/lib/equipment-library';
import {optimizerHardwareCatalog} from '@/lib/optimizer-hardware';
import type {CompleteProgramPlan} from '@/lib/optimizer-turnkey';
import {bufferPlanningDefaults} from '@/lib/chemical-wash-recipes';
import ChemicalWashRecipes from './ChemicalWashRecipes';
import type {BufferFluid,DrillingFluid} from '@/lib/cementing-calculations';
import {cleaningInputKey,type HighQualityScenario} from '@/lib/optimizer-cleaning';
import QualityCleaningCard from './QualityCleaningCard';
import { useEffect, useRef, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_OPTIMIZER_SETTINGS, type OptimizerResult, type OptimizerSettings, type ProgramInput,
  type ProgramVariant, type VariantEval, type Violation, type CentralizerPlan,
} from "@/lib/cement-optimizer";
import { centralizerTypeLabels, type CentralizerType } from "@/lib/centralization-calculations";

interface Props {
  input: ProgramInput;
  onChemicalBuffersChange?:(b:BufferFluid[])=>void;onDrillingFluidChange?:(m:DrillingFluid)=>void;
  onApplyComplete?:(p:CompleteProgramPlan)=>void;
  onApplyQuality?: (p:HighQualityScenario)=>void;
  onApply: (v: ProgramVariant, centralization?: CentralizerPlan) => void;
}

const VIOL_CODE: Record<Violation, { code: string; label: string }> = {
  "ГРП/поглощение": { code: "Г", label: "превышен предел ГРП/поглощения" },
  "проявление": { code: "П", label: "давление ниже пластового" },
  "загустевание": { code: "З", label: "не хватает времени загустевания" },
  "давление на устье": { code: "У", label: "превышен предел давления на устье" },
};

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const thick = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(0)} мин` : "не задано");
const bufText = (e: VariantEval, base: { volume: number; density: number } | null) => {
  if (!base) return "—";
  const vol = e.variant.bufferVolumeM3 ?? base.volume;
  const rho = e.variant.bufferDensity ?? base.density;
  return `${f(vol, 1)} м³ · ${rho.toFixed(0)} кг/м³`;
};

export default function ProgramOptimizerSection({ input, onApply,onApplyQuality,onApplyComplete,onChemicalBuffersChange,onDrillingFluidChange }: Props) {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const [settings, setSettings] = useState<OptimizerSettings>(DEFAULT_OPTIMIZER_SETTINGS);
  const [error,setError]=useState('');
  const [resultKey,setResultKey]=useState('');
  const [resultSettingsKey,setResultSettingsKey]=useState('');
  const stale=!!resultKey&&(resultKey!==cleaningInputKey(input)||resultSettingsKey!==JSON.stringify(settings));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<OptimizerResult | null>(null);
  const [bufIdx, setBufIdx] = useState(0);
  const [applied, setApplied] = useState<string | null>(null);

  const originalLastBuf = input.buffers[input.buffers.length - 1];
  const lastBuf = originalLastBuf?bufferPlanningDefaults(originalLastBuf):undefined;
  const baseBuf = lastBuf ? { volume: lastBuf.volume, density: lastBuf.density } : null;

  // Обновления — через flushSync: асинхронные setState не должны ждать посторонних «подвисших» обновлений
  // (например, 3D-сцены, которая грузит шрифт с CDN), иначе прогресс и результат «замерзают».
  const sync = (fn: () => void) => { try { flushSync(fn); } catch { fn(); } };
  const run = async () => {
    sync(() => { setRunning(true); setProgress(0); setResult(null); setApplied(null);setError('');setResultKey(cleaningInputKey(input));setResultSettingsKey(JSON.stringify(settings)); });
    controller.current?.abort();
    const job = new AbortController(); controller.current = job;
    let lastPct = -1;
    try {
      const hardware=optimizerHardwareCatalog(readEquipmentLibrary(localStorage).library);
      const r = await runOptimizerInWorker(input, settings, hardware, (d, t) => {
        const pct = Math.round((d / t) * 100);
        if (pct !== lastPct) { lastPct = pct; sync(() => setProgress(pct)); }
      },job.signal);
      const bestBuf = r.best[0] ? r.bufferOptions.findIndex((b) => b.volumeM3 === r.best[0].ev.variant.bufferVolumeM3 && b.density === r.best[0].ev.variant.bufferDensity) : 0;
      sync(() => { setResult(r); setBufIdx(Math.max(0, bestBuf)); });
    } catch(e){if(!(e instanceof DOMException&&e.name==='AbortError'))setError(e instanceof Error?e.message:String(e));} finally {
      sync(() => setRunning(false));
    }
  };

  const num = (k: keyof OptimizerSettings, label: string, step = "1") => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        aria-label={label} type="number" step={step} className="h-8 text-sm" value={String(settings[k])}
        onChange={(e) => setSettings({ ...settings, [k]: parseFloat(e.target.value) || 0 })}
      />
    </div>
  );

  const cols = result ? [{ label: "Текущая программа", hint: "", ev: result.current }, ...result.best] : [];

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold">Автоподбор полной программы цементирования</h3>
            <p className="text-xs text-muted-foreground max-w-3xl">
              Перебираются расходы буфера/цемента и продавки и параметры разделительного буфера. Каждый вариант прогоняется через полную
              симуляцию закачки: давление на каждом пласте и на забое, давление на устье, время загустевания, проявление. Из допустимых
              выбирается лучшее качество цементирования по существующей модели CQI. Вытеснение — отдельный показатель, а не общая оценка качества.
            </p>
          </div>
          <div className="flex gap-2">{running&&<Button variant="outline" onClick={()=>controller.current?.abort()}>Отменить</Button>}<Button onClick={run} disabled={running}>{running ? `Считаю… ${progress}%` : "Подобрать программу"}</Button></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {num("minRateLps", "Мин. расход, л/с")}
          {num("maxRateLps", "Макс. расход продавки, л/с")}
          {num("maxCementRateLps", "Макс. расход затворения, л/с")}
          {num("rateStepLps", "Шаг, л/с")}
          {num("pumpPressureLimitMPa", "Предел на устье, МПа")}
          {num("marginReqMPa", "Запас до ГРП, МПа", "0.1")}
          {num("rotationRpm", "Вращение, об/мин")}
          <label className="flex items-end gap-2 text-xs pb-2">
            <input type="checkbox" checked={settings.optimizeBuffer} onChange={(e) => setSettings({ ...settings, optimizeBuffer: e.target.checked })} />
            Усилить качество подбором буферов
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" checked={settings.optimizeCentralizers} onChange={(e) => setSettings({ ...settings, optimizeCentralizers: e.target.checked })} />
            Подбирать центрирование
          </label>
          <label className="space-y-1">
            <div className="text-muted-foreground">Предпочтительный тип центраторов</div>
            <select value={settings.centralizerType} disabled={!settings.optimizeCentralizers}
              onChange={(e) => setSettings({ ...settings, centralizerType: e.target.value as CentralizerType })}
              className="h-8 rounded border border-border bg-background px-2 text-sm">
              {(["rigid", "spring"] as CentralizerType[]).map((t) => <option key={t} value={t}>{centralizerTypeLabels[t]}</option>)}
            </select>
          </label>
          <div className="w-32">{num("jointLengthM", "Длина трубы, м")}</div>
        </div>
        <p className="text-xs">Основной результат — «Лучшее качество» с учётом CQI, центрирования, условий контакта и гидравлических ограничений. Буферы — дополнительное усиление: пласты +150 м TVD, химическая и тяжёлая пачки, оснастка и ступенчатая подача. Каждый предлагаемый вариант проверяется как полная программа с оснасткой и интервальным графиком.</p>
        {settings.optimizeBuffer&&<div className="max-w-sm">{num('chemicalContactMin','Стартовое время контакта химбуфера, мин')}</div>}
        <p className="text-xs text-muted-foreground">{settings.optimizeBuffer?'Недостающие параметры буферов заполняются стартовыми значениями. Лабораторные протоколы необязательны для расчёта.':'Буферное усиление отключено. Подбор лучшего качества продолжается на заданных буферах.'}</p>
        <EquipmentLibrary/>
        <p className="text-xs text-muted-foreground">Оснастка выбирается из встроенных паспортов и пользовательской библиотеки. Версии и параметры копируются в выбранную программу. Если типоразмер отсутствует, добавьте запись в библиотеку оснастки.</p>
        {settings.optimizeBuffer&&<ChemicalWashRecipes mud={input.drillingFluid} buffers={input.buffers} onMudChange={onDrillingFluidChange} onBuffersChange={onChemicalBuffersChange}/>}
        {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
        {stale&&<p role="alert" className="text-sm text-amber-700">Исходные данные изменились. Повторите автоподбор перед применением.</p>}
        {running && <Progress value={progress} className="h-2" />}
      </Card>

      {result && (
        <>
          {result.planningNotes?.map(note=><p className="text-xs text-amber-700" key={note}>{note}</p>)}
          {result.blocker && (
            <Card className="p-4 border-destructive/60">
              <div className="text-sm text-red-600 font-medium">Нет ни одного допустимого варианта</div>
              <div className="text-xs mt-1">{result.blocker}</div>
            </Card>
          )}


          <Card className="p-4 space-y-3" data-testid="optimizer-comparison">
            <h3 className="font-semibold">Сравнение программ цементирования</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-1.5 text-left w-48">Параметр</th>
                    {cols.map((c) => (
                      <th key={c.label} className="p-1.5 text-left align-top">
                        <div>{c.label}</div>
                        {c.hint && <div className="font-normal text-[10px] text-muted-foreground">{c.hint}</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Расход буфера и цемента", (e: VariantEval) => `${f(e.variant.q1, 0)} л/с`],
                    ["Расход продавки", (e: VariantEval) => `${f(e.variant.q2, 0)} л/с`],
                    ["Разделительный буфер", (e: VariantEval) => bufText(e, baseBuf)],
                    ["Центрирование", (e: VariantEval) => e.centralization ? `${e.centralization.label}: ${e.centralization.countInCement} шт. в интервале цементирования, мин. отступ ${f(e.centralization.minStandoffPct, 0)}%` : (input.centralization?.length ? "как в программе" : "не рассчитано (принят отступ 67%)")],
                    ["Турбулизаторы", (e:VariantEval)=>{const c=result.best.find(x=>x.ev===e)?.complete;return c?c.record.hardware.filter(h=>h.kind==='turbulator').map(h=>h.identity.model+': '+h.quantity+' шт.').join('; ')||'Не устанавливаются: нет допустимого изделия или места':'как в исходной программе';}],
                    ["Качество цементирования CQI, баллы", (e: VariantEval) => f(e.cqi, 1)],
                    ["Минимальный CQI по интервалу", (e: VariantEval) => f(e.minCqi, 1)],
                    ["Зоны низкого качества CQI < 55", (e: VariantEval) => `${f(e.badQualityLengthM, 0)} м`],
                    ["Индекс вытеснения", (e: VariantEval) => `${f(e.mrei, 0)}%`],
                    ["Застойный раствор на узкой стороне", (e: VariantEval) => `${f(e.channelLengthM, 0)} м`],
                    ["Мин. запас до ГРП/поглощения", (e: VariantEval) => `${f(e.minMarginMPa, 2)} МПа · ${e.minMarginAt}`],
                    ["Макс. давление на устье", (e: VariantEval) => `${f(e.maxSurfaceMPa, 1)} МПа`],
                    ["Время операции", (e: VariantEval) => `${f(e.jobTimeMin, 0)} мин`],
                    ["Запас по загустеванию", (e: VariantEval) => thick(e.thickeningReserveMin)],
                    ["Ограничивает вытеснение", (e: VariantEval) => e.limitingFactor],
                  ].map(([label, fn]) => (
                    <tr key={label as string} className="border-t border-border/40">
                      <td className="p-1.5 text-muted-foreground">{label as string}</td>
                      {cols.map((c, i) => (
                        <td key={c.label} className={`p-1.5 ${i > 0 ? "font-medium" : ""}`}>{(c.complete?.program??c.cleaning?.program)&&(label==='Расход буфера и цемента'||label==='Расход продавки')?[...new Set((label==='Расход продавки'?(c.complete?.program??c.cleaning.program).displacementFluids:[...(c.complete?.program??c.cleaning.program).buffers,...(c.complete?.program??c.cleaning.program).slurries]).flatMap(x=>x.flowRateSteps.map(s=>s.rateLps)))].sort((a,b)=>a-b).join(' / ')+' л/с (ступени)':(c.complete?.program??c.cleaning?.program)&&label==='Разделительный буфер'?(c.complete?.program??c.cleaning.program).buffers.map(b=>`${b.name}: ${f(b.volume,1)} м³ · ${f(b.density,0)} кг/м³`).join('; '):(fn as (e: VariantEval) => string)(c.ev)}</td>
                      ))}
                    </tr>
                  ))}
                  <tr className="border-t border-border/40">
                    <td className="p-1.5 text-muted-foreground">Нарушения</td>
                    {cols.map((c) => (
                      <td key={c.label} className="p-1.5">
                        {c.ev.violations.length === 0
                          ? <span className="text-green-600">нет</span>
                          : <span className="text-red-600">{c.ev.violations.map((v) => VIOL_CODE[v].label).join("; ")}</span>}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t border-border/40">
                    <td />
                    {cols.map((c, i) => (
                      <td key={c.label} className="p-1.5">
                        {i > 0 && (
                          <Button disabled={stale||running||!!c.cleaning&&!onApplyQuality||!!c.complete&&!onApplyComplete} size="sm" variant={applied === c.label ? "secondary" : "default"} onClick={() => { if(c.complete)onApplyComplete?.(c.complete);else if(c.cleaning)onApplyQuality?.(c.cleaning);else onApply(c.ev.variant, c.ev.centralization); setApplied(c.label); }}>
                            {applied === c.label ? "Применено ✓" : "Применить"}
                          </Button>
                        )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            {applied && <div className="text-xs text-green-700">Вариант «{applied}» записан в исходные данные и пересчитан. Остальные вкладки показывают уже новую программу.</div>}
            {result.best[0]?.ev.recommendations.length ? (
              <ul className="text-xs list-disc pl-5 space-y-0.5 text-muted-foreground">
                {result.best[0].ev.recommendations.map((r) => <li key={r}>{r}</li>)}
              </ul>
            ) : null}
          </Card>

          {result.best.some(x=>x.complete)&&<details className="border rounded" data-testid="complete-program-details"><summary>Полная программа: проход буферов, оснастка и график каждого варианта</summary><div className="p-3 space-y-4">{result.best.filter(x=>x.complete).map(x=><section key={x.label} data-complete-variant={x.label}><h4 className="font-semibold">{x.label}</h4><p className="text-xs">Целевая зона MD {f(x.complete.record.targetFromMD)}–{f(x.complete.record.targetToMD)} м. Расходы ниже относятся к буферам в этой зоне.</p>{x.complete.record.transit.map(t=><p className="text-xs" key={t.fluidId}>{t.name}: {f(t.minRateLps)}–{f(t.maxRateLps)} л/с; контакт не менее {f(t.minContactMin)} мин; проверено глубин {t.coveredDepths}/{t.totalDepths}.</p>)}{x.complete.record.hardware.map(h=><p className="text-xs" key={h.kind+h.identity.id}>{h.kind==='centralizer'?'Центратор':'Турбулизатор'}: {h.identity.model} · {h.quantity} шт. · {h.identity.manufacturer} · {h.identity.source} · v{h.identity.revision}</p>)}<details><summary>Ступени закачки на устье</summary><div className="p-2 text-xs">{buildProcessContract(x.complete.program).stages.map(st=><p key={st.id}>{st.name}: {f(st.volumeM3)} м³ · {f(st.rateLps)} л/с · с {f(st.startMin)} мин</p>)}</div></details>{x.complete.record.notes.map((n,i)=><p className="text-xs text-muted-foreground" key={i}>{n}</p>)}</section>)}</div></details>}
          <p className="text-xs text-muted-foreground">CQI — расчётная сравнительная оценка по действующей модели, не измеренное качество крепи и не процент смытия.</p>
          {settings.optimizeBuffer&&result.highQuality&&<details className="rounded border" data-testid="buffer-boost-details"><summary>Дополнительное буферное усиление: расчёт и составы</summary><div className="p-3 space-y-2"><p className="text-xs">{result.best[0]?.cleaning?'Усиление включено в «Лучшее качество» и применяется общей кнопкой этого варианта.':result.highQuality.ready?'Буферный вариант проверен, но не улучшает общую оценку относительно выбранной программы.':'Буферный вариант не прошёл дополнительные проверки; основной подбор качества сохраняется.'}</p><QualityCleaningCard value={result.highQuality} disabled={true} onApply={()=>{}} detailsOnly/></div></details>}
          {result.centralizerStudy && <CentralizerStudyCard study={result.centralizerStudy} />}

          <RateMap result={result} bufIdx={bufIdx} setBufIdx={setBufIdx} />
        </>
      )}
    </div>
  );
}

function RateMap({ result, bufIdx, setBufIdx }: { result: OptimizerResult; bufIdx: number; setBufIdx: (i: number) => void }) {
  const bo = result.bufferOptions[bufIdx];
  const grid = useMemo(() => {
    const m = new Map<string, VariantEval>();
    result.evaluations
      .filter((e) => e.variant.bufferVolumeM3 === bo.volumeM3 && e.variant.bufferDensity === bo.density)
      .forEach((e) => m.set(`${e.variant.q1}|${e.variant.q2}`, e));
    return m;
  }, [result, bo]);
  const feas = [...grid.values()].filter((e) => e.feasible);
  const lo = feas.length ? Math.min(...feas.map((e) => e.cqi??0)) : 0;
  const hi = feas.length ? Math.max(...feas.map((e) => e.cqi??0)) : 100;
  const bestKeys = new Set(result.best.filter(b=>!b.cleaning).map((b) => `${b.ev.variant.q1}|${b.ev.variant.q2}|${b.ev.variant.bufferVolumeM3}|${b.ev.variant.bufferDensity}`));
  const cur = result.current.variant;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold">Базовая карта качества CQI</h3>
        <div className="flex gap-1 flex-wrap">
          {result.bufferOptions.map((b, i) => (
            <button key={b.label} onClick={() => setBufIdx(i)}
              className={`text-xs px-2 py-1 rounded border ${i === bufIdx ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"}`}>
              Буфер: {b.label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-[11px] border-separate" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="p-1 text-right text-muted-foreground font-normal">цемент ↓ / продавка →</th>
              {result.rates.map((q) => <th key={q} className="p-1 w-12 text-center font-normal text-muted-foreground">{q}</th>)}
            </tr>
          </thead>
          <tbody>
            {result.rates1.map((q1) => (
              <tr key={q1}>
                <td className="p-1 text-right text-muted-foreground">{q1} л/с</td>
                {result.rates.map((q2) => {
                  const e = grid.get(`${q1}|${q2}`);
                  if (!e) return <td key={q2} />;
                  const isBest = bestKeys.has(`${q1}|${q2}|${bo.volumeM3}|${bo.density}`);
                  const isCur = bufIdx === 0 && cur.q1 === q1 && cur.q2 === q2;
                  const t = hi > lo ? ((e.cqi??0) - lo) / (hi - lo) : 1;
                  const title = e.feasible
                    ? `Цемент ${q1} л/с, продавка ${q2} л/с\nКачество CQI ${f(e.cqi, 1)} баллов\nЗапас ${f(e.minMarginMPa, 2)} МПа (${e.minMarginAt})\nУстье ${f(e.maxSurfaceMPa, 1)} МПа · ${f(e.jobTimeMin, 0)} мин`
                    : `Цемент ${q1} л/с, продавка ${q2} л/с\nНедопустимо: ${e.violations.map((v) => VIOL_CODE[v].label).join("; ")}`;
                  return (
                    <td key={q2} title={title}
                      className={`h-9 w-12 text-center rounded ${isBest ? "ring-2 ring-foreground" : ""} ${isCur ? "outline outline-2 outline-dashed outline-amber-500" : ""}`}
                      style={e.feasible
                        ? { background: `hsl(var(--primary) / ${0.15 + 0.75 * t})`, color: t > 0.55 ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))" }
                        : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                      {e.feasible ? f(e.cqi, 1) : e.violations.map((v) => VIOL_CODE[v].code).join("")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span>Число в клетке — CQI, баллы; темнее — лучше. Карта базовых расходов без дополнительной ступенчатой программы.</span>
        <span><Badge variant="outline" className="text-[10px] px-1 py-0">Г</Badge> ГРП/поглощение</span>
        <span><Badge variant="outline" className="text-[10px] px-1 py-0">З</Badge> загустевание</span>
        <span><Badge variant="outline" className="text-[10px] px-1 py-0">У</Badge> давление на устье</span>
        <span><Badge variant="outline" className="text-[10px] px-1 py-0">П</Badge> проявление</span>
        <span>сплошная рамка — предложенные варианты, пунктир — текущая программа</span>
      </div>
    </Card>
  );
}

function CentralizerStudyCard({ study }: { study: NonNullable<OptimizerResult["centralizerStudy"]> }) {
  return (
    <Card className="p-4 space-y-2">
      <h3 className="font-semibold">Подбор центрирования — вариант «{study.base}»</h3>
      <p className="text-xs text-muted-foreground max-w-3xl">
        Для каждого целевого отступа центраторы расставлены по той же модели прогиба колонны, что и в расчёте центрирования
        (вес в растворе, натяжение, пространственная кривизна): на каждом участке в 2 трубы — минимум центраторов, при котором
        отступ не ниже цели. Затем вся закачка пересчитывается: лучшее центрирование улучшает вытеснение, но повышает трение в затрубье.
        Рекомендуется наименьшее число центраторов при отступе не ниже 67% (API RP 10D-2) без потери качества.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-1.5 text-left">Расстановка</th>
              <th className="p-1.5 text-right">Центраторов всего / в интервале цем.</th>
              <th className="p-1.5 text-right">Отступ мин. / средн., %</th>
              <th className="p-1.5 text-right">Индекс вытеснения</th>
              <th className="p-1.5 text-right">Застойный раствор, м</th>
              <th className="p-1.5 text-right">Мин. запас до ГРП, МПа</th>
              <th className="p-1.5 text-left">Ограничения</th>
            </tr>
          </thead>
          <tbody>
            {study.options.map((o, i) => {
              const c = o.centralization!;
              const rec = i === study.recommendedIdx;
              return (
                <tr key={c.label} className={`border-t border-border/40 ${rec ? "bg-primary/10 font-medium" : ""}`}>
                  <td className="p-1.5">{rec ? "★ " : ""}{c.label}{rec ? " — рекомендуется" : ""}</td>
                  <td className="p-1.5 text-right">{c.totalCount || "—"} / {c.countInCement || "—"}</td>
                  <td className="p-1.5 text-right">{f(c.minStandoffPct, 0)} / {f(c.avgStandoffPct, 0)}</td>
                  <td className="p-1.5 text-right">{f(o.mrei, 0)}%</td>
                  <td className="p-1.5 text-right">{f(o.channelLengthM, 0)}</td>
                  <td className="p-1.5 text-right">{f(o.minMarginMPa, 2)}</td>
                  <td className="p-1.5">{o.violations.length ? <span className="text-red-600">{o.violations.map((v) => VIOL_CODE[v].label).join("; ")}</span> : <span className="text-green-600">нет</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-muted-foreground">Кнопка «Применить» у варианта записывает и расходы с буфером, и рекомендованную расстановку центраторов (вкладка «Центрация»).</div>
    </Card>
  );
}
