import { useState, useEffect, useRef, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type {
  WellData,
  SlurryInput,
  BufferFluid,
} from "@/lib/cementing-calculations";
import type {
  FoamSettings,
  FoamJobInput,
  FoamSimulation,
  FoamCandidate,
  FoamObservation,
  FoamReportBundle,
} from "@/lib/foam-cement-types";
import {
  defaultFoamSettings,
  validateFoamJob,
  FOAM_MODEL_VERSION,
} from "@/lib/foam-cement-engine";
import { FOAM_CEMENT_RECIPES } from "@/lib/foam-cement-catalog";
import {
  importLab,
  importObservations,
  compareFoamFact,
  readFoamProject,
  csv,
  LAB_HEADERS,
  FACT_HEADERS,
} from "@/lib/foam-cement-data";
import { Button } from "./ui/button";
import FoamCement3D from "./FoamCement3D";
interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers?: BufferFluid[];
  mudDensity: number;
  pumpRateLps?: number;
  fractureGradient?: number;
  scope?: string;
  active?: boolean;
  onReportChange?: (report: FoamReportBundle | null) => void;
}
const fmt = (v: number | null | undefined, n = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(n);
const inputClass = "w-full rounded-lg border bg-background p-2 mt-1 min-h-11";
function download(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Field({
  label,
  value,
  onChange,
  step = "any",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
}) {
  return (
    <label className="text-sm block">
      {label}
      <input
        className={inputClass}
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? NaN : +e.target.value)
        }
      />
    </label>
  );
}
function Plot({
  data,
  series,
  x = "time",
  label,
}: {
  data: Record<string, unknown>[];
  series: { key: string; name: string; color: string }[];
  x?: string;
  label: string;
}) {
  return (
    <div className="h-72 min-w-0">
      <p className="text-sm font-medium mb-2">{label}</p>
      <ResponsiveContainer width="100%" height="90%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey={x}
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => fmt(v, 0)}
          />
          <YAxis width={50} />
          <Tooltip />
          <Legend />
          {series.map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
function Panel({
  title,
  children,
  open = false,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="rounded-xl border bg-card p-4" open={open || undefined}>
      <summary className="cursor-pointer text-lg font-semibold">
        {title}
      </summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}
export default function FoamCementSection({
  wellData,
  slurries,
  buffers,
  mudDensity,
  pumpRateLps,
  fractureGradient,
  scope = "unsaved",
  active = true,
  onReportChange,
}: Props) {
  const storageKey = `deall-foam-v2:${scope}`;
  const initial = () => {
    const base = slurries[0]?.density ?? 1880;
    return defaultFoamSettings({
      wellData,
      baseDensity: base > 100 ? base / 1000 : base,
      rate: pumpRateLps && pumpRateLps > 0 ? pumpRateLps : 10,
      fractureGradient,
    });
  };
  const [s, setS] = useState<FoamSettings>(initial),
    [result, setResult] = useState<FoamSimulation | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [frameIndex, setFrameIndex] = useState(0),
    [playing, setPlaying] = useState(false),
    [candidates, setCandidates] = useState<FoamCandidate[]>([]),
    [objective, setObjective] = useState<"nitrogen" | "time">("nitrogen"),
    [observations, setObservations] = useState<FoamObservation[]>([]),
    [offset, setOffset] = useState(0),
    [sensitivity, setSensitivity] = useState<
      {
        label: string;
        n2: number;
        pressure: number;
        ecd: number;
        toc: number | null;
      }[]
    >([]);
  const worker = useRef<Worker | null>(null),
    request = useRef(0),
    loadedKey = useRef("");
  const input: FoamJobInput = useMemo(
    () => ({
      wellData,
      mudDensity: mudDensity > 100 ? mudDensity / 1000 : mudDensity,
      settings: s,
    }),
    [wellData, mudDensity, s],
  );
  const errors = useMemo(() => validateFoamJob(input), [input]);
  const stale =
    !!result && JSON.stringify(input) !== JSON.stringify(result.input);
  const fact = useMemo(
    () =>
      result && observations.length
        ? compareFoamFact(result, observations, offset)
        : undefined,
    [result, observations, offset],
  );
  useEffect(() => {
    onReportChange?.(
      result && !stale
        ? { simulation: result, observations, planFact: fact }
        : null,
    );
  }, [result, stale, observations, fact, onReportChange]);
  useEffect(() => {
    worker.current?.terminate();
    setBusy("");
    setPlaying(false);
    setResult(null);
    setCandidates([]);
    setSensitivity([]);
    setObservations([]);
    setOffset(0);
    let value = initial();
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const raw = JSON.parse(stored);
        const candidate = { ...input, settings: raw };
        if (!validateFoamJob(candidate).length) {
          value = raw;
          setNotice(
            "Восстановлен черновик этого расчёта. Проверьте геометрию и запустите расчёт.",
          );
        }
      }
    } catch {
      setNotice("Черновик не удалось прочитать; загружены исходные параметры.");
    }
    setS(value);
    loadedKey.current = storageKey;
    return () => worker.current?.terminate();
  }, [storageKey]);
  useEffect(() => {
    if (loadedKey.current !== storageKey || errors.length) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(s));
    } catch {
      setNotice("Браузер не сохранил черновик. Скачайте проект JSON.");
    }
  }, [s, storageKey, errors.length]);
  useEffect(() => {
    if (!playing || !result || !active) return;
    const timer = setInterval(
      () =>
        setFrameIndex((i) => {
          if (i >= result.frames.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        }),
      180,
    );
    return () => clearInterval(timer);
  }, [playing, result, active]);
  function update<K extends keyof FoamSettings>(
    key: K,
    value: FoamSettings[K],
  ) {
    setS((prev) => ({ ...prev, [key]: value }));
    setCandidates([]);
    setSensitivity([]);
  }
  function run(
    task: "simulate" | "optimise" | "sensitivity" | "size" = "simulate",
    job = input,
  ) {
    const messages = validateFoamJob(job);
    setPlaying(false);
    if (messages.length) {
      setError(messages.join("\n"));
      return;
    }
    worker.current?.terminate();
    const id = ++request.current;
    const w = new Worker(
      new URL("../lib/foam-cement.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    setBusy(task);
    setError("");
    w.onmessage = (e) => {
      if (e.data.id !== request.current) return;
      setBusy("");
      if (e.data.error) {
        setError(e.data.error);
      } else if (task === "simulate" || task === "size") {
        if (task === "size") setS(e.data.result.input.settings);
        setResult(e.data.result);
        setFrameIndex(e.data.result.frames.length - 1);
      } else if (task === "optimise") {
        setCandidates(e.data.result);
      } else setSensitivity(e.data.result);
      w.terminate();
    };
    w.onerror = (e) => {
      setBusy("");
      setError(`Расчёт прерван: ${e.message}`);
      w.terminate();
    };
    w.postMessage({ id, task, input: job, objective });
  }
  async function readFile(
    file: File | undefined,
    kind: "lab" | "fact" | "project",
  ) {
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      if (kind === "lab") {
        const rows = importLab(text);
        update("lab", rows);
        setNotice(`Загружено лабораторных строк: ${rows.length}.`);
      } else if (kind === "fact") {
        setObservations(importObservations(text));
      } else {
        const imported = readFoamProject(text, input);
        setS(imported.settings);
        const restored = JSON.parse(text);
        setObservations(
          Array.isArray(restored.observations)
            ? importObservations(JSON.stringify(restored.observations))
            : [],
        );
        setOffset(Number.isFinite(restored.offset) ? restored.offset : 0);
        setNotice(
          "Параметры загружены. Конструкция и буровой раствор взяты из текущего проекта. Запустите новый расчёт.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const numeric = (key: keyof FoamSettings, label: string) => (
    <Field
      key={key}
      label={label}
      value={s[key] as number}
      onChange={(v) => update(key, v as never)}
    />
  );
  const frame =
    result?.frames[Math.min(frameIndex, (result?.frames.length ?? 1) - 1)];
  return (
    <div className="space-y-5 pb-8" data-foam-version={FOAM_MODEL_VERSION}>
      <div className="rounded-xl bg-card border p-5 space-y-3">
        <h2 className="text-2xl font-bold">
          Пеноцементирование · инженерная программа
        </h2>
        <p className="text-sm text-muted-foreground">
          Сжимаемая смесь, программа азота, размещение, давления и проверка
          ограничений. Модель совместного движения фаз; устойчивость и качество
          цементного камня требуют испытаний.
        </p>
        <p className="text-sm">
          Конструкция из проекта: MD {wellData.casingDepthMD} м · OD{" "}
          {wellData.casingOD} мм · ствол {wellData.holeDiameter} мм · предыдущая
          колонна до {wellData.prevCasingDepth} м. Учтены интервалы
          кавернозности и толщины стенки.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => run("size")}
            disabled={!!busy}
          >
            Подобрать объём до кровли
          </Button>
          <Button onClick={() => run()} disabled={!!busy}>
            {busy === "simulate" ? "Считаем…" : "Рассчитать программу"}
          </Button>
          {busy && (
            <Button
              variant="outline"
              onClick={() => {
                request.current++;
                worker.current?.terminate();
                setBusy("");
              }}
            >
              Остановить
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() =>
              download(
                "foam-project.json",
                JSON.stringify(
                  {
                    modelVersion: FOAM_MODEL_VERSION,
                    input,
                    observations,
                    offset,
                  },
                  null,
                  2,
                ),
                "application/json",
              )
            }
          >
            Сохранить проект JSON
          </Button>
          <label className="border rounded-md p-2 text-sm cursor-pointer">
            Загрузить проект
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                void readFile(e.target.files?.[0], "project");
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {notice && (
          <p role="status" className="text-sm text-blue-600">
            {notice}
          </p>
        )}
        {error && (
          <p role="alert" className="whitespace-pre-line text-red-600">
            {error}
          </p>
        )}
        {errors.length > 0 && (
          <p className="whitespace-pre-line text-amber-700 text-sm">
            {errors.join("\n")}
          </p>
        )}
        {stale && (
          <p className="bg-amber-100 text-amber-900 p-3 rounded">
            Исходные данные изменились. Ниже показан предыдущий расчёт; обновите
            программу.
          </p>
        )}
      </div>
      <Panel title="1. Раствор, газосодержание и температурный режим" open>
        <label className="text-sm block">
          Рецептура (примеры, не подтверждённые протоколы)
          <select
            className={inputClass}
            value={s.recipeId}
            onChange={(e) => {
              const r = FOAM_CEMENT_RECIPES.find(
                (r) => r.id === e.target.value,
              );
              setS((prev) =>
                r
                  ? {
                      ...prev,
                      recipeId: r.id,
                      baseDensity: r.baseDensity,
                      waterCementRatio: r.waterCementRatio,
                      yieldM3PerTon: r.yieldM3PerTon,
                      liquidPV: r.pvCp,
                      liquidYP: r.ypPa,
                      foamerPctBWOC: r.foamStabilizerConc,
                    }
                  : { ...prev, recipeId: "custom" },
              );
            }}
          >
            <option value="custom">Своя рецептура</option>
            {FOAM_CEMENT_RECIPES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nameRu}
              </option>
            ))}
          </select>
        </label>
        <div className="grid sm:grid-cols-3 gap-3">
          {numeric("baseDensity", "Плотность базы, г/см³")}
          {numeric("liquidPV", "PV базы, сП")}
          {numeric("liquidYP", "YP базы, Па")}
          {numeric("waterCementRatio", "В/Ц, т/т")}
          {numeric("yieldM3PerTon", "Выход базы, м³/т цемента")}
          {numeric("foamerPctBWOC", "Пенообразователь, % BWOC")}
          {numeric("cementTopMD", "Плановая кровля, м MD")}
          {numeric("foamVolumeMultiplier", "Множитель объёма базы, 0,2-5")}
          {numeric("pumpRateLps", "Расход жидкой фазы, л/с")}
          {numeric("backPressure", "Противодавление, МПа изб.")}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm">
            Управление программой
            <select
              className={inputClass}
              value={s.controlMode}
              onChange={(e) =>
                update(
                  "controlMode",
                  e.target.value as FoamSettings["controlMode"],
                )
              }
            >
              <option value="reference-quality">FQ в опорной точке</option>
              <option value="constant-density">
                Постоянная проектная плотность по глубине
              </option>
            </select>
          </label>
          {s.controlMode === "reference-quality"
            ? numeric("targetFoamQuality", "Целевое FQ, % объёма газа")
            : numeric("targetDensity", "Плотность пены, г/см³")}
          <label className="text-sm">
            Опорная точка FQ
            <select
              className={inputClass}
              value={s.referenceMode}
              onChange={(e) =>
                update(
                  "referenceMode",
                  e.target.value as FoamSettings["referenceMode"],
                )
              }
            >
              <option value="depth">На глубине при расчётных P/T</option>
              <option value="generator">На генераторе при заданных P/T</option>
            </select>
          </label>
          {s.referenceMode === "depth" ? (
            numeric("referenceMD", "Опорная глубина FQ, м MD")
          ) : (
            <>
              {numeric("referencePressureMPa", "Давление генератора, МПа изб.")}
              {numeric("referenceTemperatureC", "Температура генератора, °C")}
            </>
          )}
          <label className="text-sm">
            Стандартные условия азота
            <select
              className={inputClass}
              value={s.standardTemperatureC}
              onChange={(e) => update("standardTemperatureC", +e.target.value)}
            >
              <option value="20">20 °C, 0,101325 МПа абс.</option>
              <option value="0">0 °C, 0,101325 МПа абс.</option>
            </select>
          </label>
        </div>
        <p className="text-sm text-muted-foreground">
          FQ в генераторе и в скважине различается. Расход N₂ указан в
          стандартных м³/мин; расход жидкой фазы не включает газ. Модель
          реологии без протокола эмпирическая.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          {numeric("surfaceTemperature", "Температура устья, °C")}
          {numeric("bottomTemperature", "Забойная температура профиля, °C")}
          <label className="text-sm">
            Температурный профиль
            <select
              className={inputClass}
              value={s.temperatureMode}
              onChange={(e) =>
                update(
                  "temperatureMode",
                  e.target.value as FoamSettings["temperatureMode"],
                )
              }
            >
              <option value="static">Заданный постоянный</option>
              <option value="circulating">Переход BHST к заданной BHCT</option>
            </select>
          </label>
          {s.temperatureMode === "circulating" &&
            numeric("thermalResponseMin", "Время температурного отклика, мин")}
          {numeric("pauseAfterFoamMin", "Пауза после пены, мин")}
          {numeric("finalHoldMin", "Остановка после продавки, мин")}
        </div>
      </Panel>
      <Panel title="2. Буферы и зоны газосодержания">
        <p className="text-sm">
          Буферы закачиваются в порядке таблицы. Зоны относятся к конечному
          статическому проекту; первая порция пены предназначена для верхней
          зоны.
        </p>
        {s.buffers.map((b, i) => (
          <div key={i} className="grid sm:grid-cols-6 gap-2 items-end">
            <label className="text-sm">
              Название
              <input
                className={inputClass}
                value={b.name}
                onChange={(e) =>
                  update(
                    "buffers",
                    s.buffers.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            {(["volumeM3", "density", "pvCp", "ypPa"] as const).map((k, j) => (
              <Field
                key={k}
                label={["Объём, м³", "ρ, г/см³", "PV, сП", "YP, Па"][j]}
                value={b[k]}
                onChange={(v) =>
                  update(
                    "buffers",
                    s.buffers.map((x, j) => (j === i ? { ...x, [k]: v } : x)),
                  )
                }
              />
            ))}
            <Button
              variant="outline"
              onClick={() =>
                update(
                  "buffers",
                  s.buffers.filter((_, j) => j !== i),
                )
              }
            >
              Удалить
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          onClick={() =>
            update("buffers", [
              ...s.buffers,
              {
                name: `Буфер ${s.buffers.length + 1}`,
                volumeM3: 3,
                density: 1.1,
                pvCp: 10,
                ypPa: 2,
              },
            ])
          }
        >
          Добавить буфер
        </Button>
        {buffers?.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Буферы общего проекта не переносятся автоматически: задайте состав и
            реологию для этой программы.
          </p>
        )}
        {s.zones.map((z, i) => (
          <div key={i} className="grid sm:grid-cols-4 gap-2">
            {(["topMD", "bottomMD", "targetFQ"] as const).map((k, j) => (
              <Field
                key={k}
                label={["Верх, м MD", "Низ, м MD", "FQ в опорной точке, %"][j]}
                value={z[k]}
                onChange={(v) =>
                  update(
                    "zones",
                    s.zones.map((x, j) => (j === i ? { ...x, [k]: v } : x)),
                  )
                }
              />
            ))}
            <Button
              variant="outline"
              onClick={() =>
                update(
                  "zones",
                  s.zones.filter((_, j) => j !== i),
                )
              }
            >
              Удалить зону
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          disabled={s.controlMode === "constant-density"}
          onClick={() =>
            update("zones", [
              ...s.zones,
              {
                topMD: s.cementTopMD,
                bottomMD: wellData.casingDepthMD,
                targetFQ: s.targetFoamQuality,
              },
            ])
          }
        >
          Добавить зону FQ
        </Button>
        {s.controlMode === "constant-density" && (
          <p className="text-sm">
            В режиме постоянной плотности зоны FQ не используются.
          </p>
        )}
      </Panel>
      <Panel title="3. Окно давлений, оборудование и точность">
        <label className="text-sm block">
          Источник границ и ограничений
          <input
            className={inputClass}
            value={s.limitsSource}
            onChange={(e) => update("limitsSource", e.target.value)}
          />
        </label>
        <div className="grid sm:grid-cols-3 gap-3">
          {numeric("fractureGradient", "Градиент ГРП, кПа/м TVD")}
          <label className="text-sm">
            Пластовый градиент, кПа/м (необязательно)
            <input
              className={inputClass}
              type="number"
              value={s.poreGradient ?? ""}
              onChange={(e) =>
                update(
                  "poreGradient",
                  e.target.value === "" ? null : +e.target.value,
                )
              }
            />
          </label>
          {numeric("maxPumpPressureMPa", "Предел давления насоса, МПа")}
          {numeric("maxN2RateStdM3Min", "Предел расхода N₂, м³ст/мин")}
          {numeric("maxN2PressureMPa", "Предел давления N₂, МПа")}
          {numeric("maxSlurryRateLps", "Предел расхода жидкости, л/с")}
          {numeric("n2AvailableStdM3", "Запас N₂, м³ст")}
          {numeric("mudPV", "PV бурового / продавки, сП")}
          {numeric("mudYP", "YP бурового / продавки, Па")}
          {numeric("frictionMultiplier", "Множитель потерь на трение")}
          {numeric("roughnessMm", "Шероховатость, мм")}
          {numeric("spatialCells", "Ячеек на ветвь, 16-120")}
          {numeric("timeStepMin", "Шаг времени, мин (0,1-2)")}
        </div>
        {s.formations.map((f, i) => (
          <div key={i} className="grid sm:grid-cols-4 gap-2">
            <Field
              label="Контрольный пласт, м MD"
              value={f.md}
              onChange={(v) =>
                update(
                  "formations",
                  s.formations.map((x, j) => (j === i ? { ...x, md: v } : x)),
                )
              }
            />
            {(["poreMPa", "fractureMPa"] as const).map((k) => (
              <label key={k} className="text-sm">
                {k === "poreMPa" ? "Пластовое" : "ГРП"}, МПа изб.
                <input
                  className={inputClass}
                  type="number"
                  value={f[k] ?? ""}
                  onChange={(e) =>
                    update(
                      "formations",
                      s.formations.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              [k]:
                                e.target.value === ""
                                  ? undefined
                                  : +e.target.value,
                            }
                          : x,
                      ),
                    )
                  }
                />
              </label>
            ))}
            <Button
              variant="outline"
              onClick={() =>
                update(
                  "formations",
                  s.formations.filter((_, j) => i !== j),
                )
              }
            >
              Удалить пласт
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          onClick={() =>
            update("formations", [
              ...s.formations,
              {
                name: `Контроль ${s.formations.length + 1}`,
                md: wellData.casingDepthMD,
              },
            ])
          }
        >
          Добавить контрольный пласт
        </Button>
        <p className="text-sm text-muted-foreground">
          Проверка ГРП выполняется по всему открытому стволу, включая начальное
          состояние. Запас давления подачи N₂ принят 1 МПа сверх давления насоса
          и требует сверки с обвязкой.
        </p>
      </Panel>
      <Panel title={`4. Лаборатория · ${s.lab.length} протоколов`}>
        <p className="text-sm">
          CSV или JSON. Давление только абсолютное, МПа. preparation:
          pressurized / atmospheric / unknown. Реология подставляется из
          ближайшего протокола под давлением в пределах ±10 °C, ±5 п.п. FQ и
          ±max(1 МПа, 20% P). Испытание стабильности не экстраполируется.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              download("foam-lab-template.csv", LAB_HEADERS + "\n")
            }
          >
            Шаблон CSV
          </Button>
          <label className="border rounded p-2 cursor-pointer text-sm">
            Загрузить протоколы
            <input
              type="file"
              accept=".csv,.json"
              className="hidden"
              onChange={(e) => {
                void readFile(e.target.files?.[0], "lab");
                e.target.value = "";
              }}
            />
          </label>
          <Button
            variant="outline"
            onClick={() =>
              download("foam-lab.json", JSON.stringify(s.lab, null, 2))
            }
          >
            Скачать базу
          </Button>
          <Button variant="outline" onClick={() => update("lab", [])}>
            Очистить протоколы
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {[
                  "Источник",
                  "Подготовка",
                  "Pабс, МПа",
                  "T, °C",
                  "FQ, %",
                  "PV, сП",
                  "YP, Па",
                  "Стабильность, мин",
                ].map((h) => (
                  <th key={h} className="p-2 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.lab.map((r, i) => (
                <tr key={i} className="border-t">
                  {[
                    r.source,
                    r.preparation,
                    r.pressureMPaAbs,
                    r.temperatureC,
                    r.qualityPct,
                    r.pvCp,
                    r.ypPa,
                    r.stabilityMin ?? "Нет данных",
                  ].map((v, j) => (
                    <td key={j} className="p-2">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!s.lab.length && (
          <p className="text-amber-700">
            Лабораторных данных нет. Программа считает по доступным исходным
            данным, но устойчивость, прочность и газопроницаемость не
            подтверждены.
          </p>
        )}
      </Panel>
      <Panel title="5. Подбор режима и чувствительность">
        <p className="text-sm">
          Перебор до 9 вариантов: расходы 70/100/130% исходного и
          противодавление +0/+1/+2 МПа. Это поиск среди заданных вариантов, не
          глобальный оптимум. Кандидаты считаются на укрупнённой сетке;
          выбранный режим пересчитывается на исходной.
        </p>
        <div className="flex flex-wrap gap-2">
          <select
            className="border rounded bg-background p-2"
            value={objective}
            onChange={(e) => setObjective(e.target.value as typeof objective)}
          >
            <option value="nitrogen">Минимум азота</option>
            <option value="time">Минимум времени</option>
          </select>
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => run("optimise")}
          >
            Подобрать режим
          </Button>
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => run("sensitivity")}
          >
            Чувствительность T ±10 °C, PV ±20%
          </Button>
        </div>
        {busy && <p role="status">Расчёт выполняется в отдельном потоке…</p>}
        {candidates.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {[
                    "Q, л/с",
                    "Pу, МПа",
                    "N₂, м³ст",
                    "Время, мин",
                    "Проверки",
                    "",
                  ].map((h, i) => (
                    <th key={i} className="p-2 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, i) => (
                  <tr className="border-t" key={i}>
                    <td className="p-2">{fmt(c.input.settings.pumpRateLps)}</td>
                    <td>{fmt(c.input.settings.backPressure)}</td>
                    <td>{fmt(c.n2StdM3, 0)}</td>
                    <td>{fmt(c.durationMin, 1)}</td>
                    <td
                      className={
                        c.feasible ? "text-emerald-700" : "text-amber-700"
                      }
                    >
                      {c.feasible
                        ? "В пределах заданных ограничений"
                        : c.reasons.join("; ")}
                    </td>
                    <td>
                      <Button
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => {
                          const settings = {
                            ...s,
                            pumpRateLps: c.input.settings.pumpRateLps,
                            backPressure: c.input.settings.backPressure,
                          };
                          setS(settings);
                          run("simulate", { ...input, settings });
                        }}
                      >
                        Пересчитать
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sensitivity.length > 0 && (
          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr>
                  {[
                    "Сценарий",
                    "N₂, м³ст",
                    "Pмакс, МПа",
                    "ECDмакс, г/см³",
                    "Кровля, MD",
                  ].map((h) => (
                    <th key={h} className="p-2 text-left">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sensitivity.map((r) => (
                  <tr className="border-t" key={r.label}>
                    {[
                      r.label,
                      fmt(r.n2, 0),
                      fmt(r.pressure),
                      fmt(r.ecd, 3),
                      fmt(r.toc, 0),
                    ].map((v, i) => (
                      <td className="p-2" key={i}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              Варианты относительно параметров на момент запуска. Сетка до 32
              ячеек на ветвь, шаг не менее 0,8 мин. Это детерминированные
              сценарии, не вероятность успеха.
            </p>
          </div>
        )}
      </Panel>
      {result && frame && (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ["База, м³", fmt(result.design.baseSlurryM3)],
              ["Азот, м³ст", fmt(result.design.n2StdM3, 0)],
              [
                "Максимум давления, МПа",
                fmt(result.summary.maxPumpPressureMPa),
              ],
              ["Конечная кровля, м MD", fmt(result.summary.finalTOCMD, 0)],
              ["Цемент, т", fmt(result.design.cementTonnes)],
              ["Вода, м³", fmt(result.design.waterM3)],
              ["Пенообразователь, кг", fmt(result.design.foamerKg)],
              ["Время операции, мин", fmt(result.summary.durationMin, 1)],
            ].map(([label, value]) => (
              <div className="border bg-card rounded-xl p-4" key={label}>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <Panel title="Результаты проверки ограничений" open>
            {result.constraints.some((c) => !c.pass) && (
              <p
                role="alert"
                className="rounded-lg bg-red-100 text-red-900 p-3 font-semibold"
              >
                Есть нарушения ограничений или выход за область модели.
                Программу нельзя считать подтверждённой по этому расчёту;
                проверьте перечисленные причины.
              </p>
            )}
            <p className="text-sm">
              FQ в опорной точке: {fmt(result.design.reference.qualityPct, 1)}%
              · Pабс {fmt(result.design.reference.pressureMPaAbs)} МПа · T{" "}
              {fmt(result.design.reference.temperatureC, 1)} °C. Плановая кровля{" "}
              {result.input.settings.cementTopMD} м MD; динамическая конечная{" "}
              {fmt(result.summary.finalTOCMD, 1)} м MD.
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              {result.constraints.map((c) => (
                <div
                  className={`rounded p-3 text-sm ${c.pass ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}
                  key={c.label}
                >
                  {c.pass ? "В пределах" : "НАРУШЕНО"}: {c.label} ·{" "}
                  {fmt(c.actual)} / {fmt(c.limit)} {c.unit}
                </div>
              ))}
            </div>
            <p className="text-sm">
              Невязка базы:{" "}
              {result.summary.maxBaseBalanceErrorPct.toExponential(2)}%; азота:{" "}
              {result.summary.maxGasBalanceErrorPct.toExponential(2)}%.
              Несошедшихся кадров: {result.summary.nonConvergedFrames}; кадров
              вне модели полного заполнения: {result.summary.freeFallFrames}.
            </p>
            <p className="text-sm text-amber-700">
              Выполнение заданных ограничений не подтверждает устойчивость пены
              и пригодность рецептуры. Источник границ:{" "}
              {result.input.settings.limitsSource}.
            </p>
          </Panel>
          <Panel title="Программа закачки и выгрузка" open>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={() =>
                  download(
                    "foam-stages.csv",
                    csv(
                      result.design.stages.map((x) => ({
                        ...x,
                        n2RateStdM3Min:
                          x.gasStdPerBase * x.liquidRateLps * 0.06,
                      })),
                    ),
                  )
                }
              >
                Стадии CSV
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  download(
                    "foam-history.csv",
                    csv(
                      result.frames.map(
                        ({ cells, formationMargins, ...f }) => ({
                          ...f,
                          margins: JSON.stringify(formationMargins),
                        }),
                      ),
                    ),
                  )
                }
              >
                История CSV
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  download(
                    "foam-result.json",
                    JSON.stringify({
                      modelVersion: FOAM_MODEL_VERSION,
                      input: result.input,
                      simulation: result,
                      offset,
                      observations,
                      planFact: fact,
                    }),
                  )
                }
              >
                Полный результат JSON
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const { exportFoamReport } =
                      await import("@/lib/foam-cement-report");
                    await exportFoamReport({
                      simulation: result,
                      observations,
                      planFact: fact,
                    });
                  } catch (e) {
                    setError(`Отчёт не создан: ${String(e)}`);
                  }
                }}
              >
                Программа DOCX
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="text-sm w-full">
                <thead>
                  <tr>
                    {[
                      "Стадия",
                      "Жидкость, м³",
                      "Qж, л/с",
                      "N₂, м³ст/мин",
                      "Время, мин",
                    ].map((h) => (
                      <th className="p-2 text-left" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.design.stages.map((x) => (
                    <tr className="border-t" key={x.id}>
                      {[
                        x.name,
                        fmt(x.liquidVolumeM3),
                        fmt(x.liquidRateLps),
                        fmt(x.gasStdPerBase * x.liquidRateLps * 0.06),
                        fmt(x.durationMin),
                      ].map((v, i) => (
                        <td className="p-2" key={i}>
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted-foreground">
              Продавка до башмака без цементного стакана. Объём пены зависит от
              P/T и не равен объёму базы. Расхождение массового состава
              рецептуры: {fmt(result.design.recipeMassMismatchPct, 1)}%.
            </p>
          </Panel>
          <div className="rounded-xl border p-4 bg-card space-y-4">
            <h3 className="text-xl font-semibold">Единая шкала времени</h3>
            <div className="flex gap-3 items-center">
              <Button
                variant="outline"
                onClick={() => {
                  if (frameIndex === result.frames.length - 1) setFrameIndex(0);
                  setPlaying(!playing);
                }}
              >
                {playing ? "Пауза" : "Воспроизвести"}
              </Button>
              <span>
                {fmt(frame.time, 1)} / {fmt(result.summary.durationMin, 1)} мин
              </span>
            </div>
            <input
              aria-label="Время операции"
              type="range"
              className="w-full"
              min="0"
              max={result.frames.length - 1}
              value={frameIndex}
              onChange={(e) => {
                setPlaying(false);
                setFrameIndex(+e.target.value);
              }}
            />
            <p>
              {frame.stage} · Qж {fmt(frame.liquidRateLps)} л/с · N₂{" "}
              {fmt(frame.n2RateStdM3Min)} м³ст/мин
            </p>
            <div className="grid lg:grid-cols-2 gap-5">
              <FoamCement3D frame={frame} wellData={result.input.wellData} />
              <div className="space-y-5">
                <Plot
                  label="Профиль давления выбранного кадра: MD, м / МПа абсолютного"
                  data={frame.cells
                    .filter((c) => c.leg === "annulus")
                    .sort((a, b) => a.md - b.md)
                    .map((c) => ({ md: c.md, pressure: c.pressureMPaAbs }))}
                  x="md"
                  series={[{ key: "pressure", name: "Pабс", color: "#2563eb" }]}
                />
                <Plot
                  label="FQ выбранного кадра: MD, м / % газа"
                  data={frame.cells
                    .filter((c) => c.leg === "annulus")
                    .map((c) => ({ md: c.md, fq: c.qualityPct }))
                    .sort((a, b) => a.md - b.md)}
                  x="md"
                  series={[{ key: "fq", name: "FQ, %", color: "#d97706" }]}
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-2 text-sm">
              <p>Пена в затрубье: {fmt(frame.foamInAnnulusM3)} м³</p>
              <p>Удержано N₂: {fmt(frame.retainedN2StdM3)} м³ст</p>
              <p>Возвращено N₂: {fmt(frame.returnedN2StdM3)} м³ст</p>
            </div>
          </div>
          <div className="grid lg:grid-cols-2 gap-6 rounded-xl border bg-card p-4">
            <Plot
              label="Давления по времени: мин / МПа избыточного"
              data={result.frames as unknown as Record<string, unknown>[]}
              series={[
                { key: "pumpPressureMPa", name: "Насос", color: "#2563eb" },
                {
                  key: "annulusBHPMPa",
                  name: "Забой динамика",
                  color: "#dc2626",
                },
                {
                  key: "staticBHPMPa",
                  name: "Забой гидростатика",
                  color: "#16a34a",
                },
              ]}
            />
            <Plot
              label="Эквивалентная плотность: мин / г/см³"
              data={result.frames as unknown as Record<string, unknown>[]}
              series={[
                {
                  key: "dynamicECD",
                  name: "ECD динамическая",
                  color: "#dc2626",
                },
                { key: "staticECD", name: "Статическая", color: "#16a34a" },
              ]}
            />
            <Plot
              label="Азот: мин / м³ст/мин"
              data={result.frames as unknown as Record<string, unknown>[]}
              series={[
                { key: "n2RateStdM3Min", name: "Подача N₂", color: "#7c3aed" },
              ]}
            />
            <Plot
              label="Материальный баланс: мин / м³ст N₂"
              data={result.frames as unknown as Record<string, unknown>[]}
              series={[
                {
                  key: "cumulativeN2StdM3",
                  name: "Закачано",
                  color: "#2563eb",
                },
                {
                  key: "retainedN2StdM3",
                  name: "В скважине",
                  color: "#d97706",
                },
                { key: "returnedN2StdM3", name: "Возврат", color: "#16a34a" },
              ]}
            />
          </div>
          <Panel title="План-факт и калибровка">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  download("foam-fact-template.csv", FACT_HEADERS + "\n")
                }
              >
                Шаблон факта CSV
              </Button>
              <label className="border rounded p-2 text-sm cursor-pointer">
                Загрузить факт
                <input
                  type="file"
                  className="hidden"
                  accept=".csv,.json"
                  onChange={(e) => {
                    void readFile(e.target.files?.[0], "fact");
                    e.target.value = "";
                  }}
                />
              </label>
              <Button variant="outline" onClick={() => setObservations([])}>
                Очистить факт
              </Button>
            </div>
            <p className="text-sm">
              Единицы: timeMin - мин; pumpPressureMPa - МПа изб.; slurryRateLps
              - л/с; n2RateStdM3Min - м³ст/мин при стандартных условиях проекта;
              density - г/см³.
            </p>
            <Field
              label="Начало операции по часам факта, мин"
              value={offset}
              onChange={setOffset}
            />
            {fact && (
              <>
                <p>
                  Измерений в пределах операции: {fact.samples.length}. RMSE
                  давления {fmt(fact.pressureRMSE, 3)} МПа, смещение{" "}
                  {fmt(fact.pressureBias, 3)} МПа. Покрытие расхода N₂{" "}
                  {fmt(fact.coveragePct, 1)}% времени; факт{" "}
                  {fmt(fact.measuredN2StdM3)} / план{" "}
                  {fmt(fact.plannedN2SamePeriodStdM3)} м³ст на том же интервале.
                </p>
                <Plot
                  label="План-факт давления: мин / МПа изб."
                  data={fact.samples as unknown as Record<string, unknown>[]}
                  x="timeMin"
                  series={[
                    { key: "observedPressure", name: "Факт", color: "#dc2626" },
                    { key: "plannedPressure", name: "План", color: "#2563eb" },
                  ]}
                />
                {fact.suggestedFrictionMultiplier !== null && (
                  <div className="space-y-2">
                    <p>
                      Подобран множитель трения{" "}
                      {fmt(fact.suggestedFrictionMultiplier, 3)}; RMSE линейной
                      оценки {fmt(fact.fittedRMSE, 3)} МПа.
                    </p>
                    <Button
                      variant="outline"
                      disabled={!!busy}
                      onClick={() => {
                        const settings = {
                          ...s,
                          frictionMultiplier: fact.suggestedFrictionMultiplier!,
                        };
                        setS(settings);
                        run("simulate", { ...input, settings });
                      }}
                    >
                      Применить трение и пересчитать
                    </Button>
                  </div>
                )}
                {fact.warnings.map((x) => (
                  <p className="text-sm text-amber-700" key={x}>
                    {x}
                  </p>
                ))}
              </>
            )}
          </Panel>
          <Panel title="Область применимости и допущения" open>
            {result.warnings.map((x) => (
              <p className="text-sm text-amber-800 dark:text-amber-300" key={x}>
                {x}
              </p>
            ))}
            <p className="text-sm">
              Версия {result.modelVersion}. Расчёт{" "}
              {new Date(result.createdAt).toLocaleString("ru-RU")}. Промысловая
              верификация, миграция газа после схватывания, гидратация и
              механика цементного камня этим расчётом не подтверждаются.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}
