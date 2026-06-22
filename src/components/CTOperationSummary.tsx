import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, XCircle, ClipboardList, Target, Wrench, Activity, FileText } from "lucide-react";
import { CT_OPERATIONS, type CTOperationType } from "@/lib/ct-operations";
import type {
  CTStringData, WellGeometry, FluidData, PumpData,
  ForceResult, FatigueResult,
} from "@/lib/coiled-tubing-calculations";
import type { RiskItem } from "@/lib/coiled-tubing-calculations";

interface Props {
  operationType?: string;
  ct: CTStringData;
  well: WellGeometry;
  fluid: FluidData;
  pump: PumpData;
  forces: ForceResult | null;
  fatigue: FatigueResult | null;
  risks: RiskItem[];
}

/** Шаги программы по типу операции — общие best-practice сценарии. */
const PROGRAM_STEPS: Partial<Record<CTOperationType, string[]>> = {
  wellbore_cleanout: [
    "Сборка КНБК (промывочная насадка + обратный клапан) и опрессовка устьевого оборудования.",
    "Спуск ГНКТ с циркуляцией рабочей жидкости 30–50% от расчётного Q.",
    "При входе в зону пробки — снизить RIH до 10–15 м/мин, поднять Q до проектного.",
    "Поинтервальная промывка с шагом 5–10 м, контроль возврата (концентрация песка).",
    "Дойти до забоя, циркулировать ≥1.5 объёма скважины до чистого выноса.",
    "Подъём ГНКТ с продолжением циркуляции (избежать прихвата).",
  ],
  acid_stimulation: [
    "Опрессовка ГНКТ, проверка совместимости стали с кислотой (ингибитор!).",
    "Спуск до верхнего интервала обработки, проверка пакера/клапана.",
    "Закачка предкислотной пачки (растворитель/взаимный).",
    "Кислотная обработка по интервалам (5–10 м): закачка → выдержка 15–30 мин → подъём 5 м.",
    "Послекислотная промывка — нейтрализация (NH₄Cl 3–5%) и очистка ствола.",
    "Освоение скважины (свабирование или N₂-kickoff).",
  ],
  nitrogen_kickoff: [
    "Подготовка азотной установки и линии нагнетания N₂.",
    "Спуск ГНКТ на расчётную глубину (≥60% TVD).",
    "Ступенчатый ввод N₂: начать с 50% расчётного Q, нарастить до проектного за 10–15 мин.",
    "Контроль устьевого давления и Pзаб; при достижении депрессии — стабилизация.",
    "Удержание режима до получения устойчивого притока (≥2 ч).",
    "Плавное сокращение N₂, подъём ГНКТ под контролем устьевого давления.",
  ],
  scale_removal: [
    "Идентификация типа отложений (карбонат/сульфат/железо).",
    "Подбор растворителя: HCl 7.5–15% для карбоната; EDTA/NTA для сульфата.",
    "Спуск ГНКТ, поинтервальная закачка с выдержкой 20–60 мин.",
    "Промывка ствола и контроль возврата pH.",
  ],
  paraffin_removal: [
    "Подогрев скважины горячей нефтью/дизелем или подача растворителя (ксилол/толуол).",
    "Спуск ГНКТ с циркуляцией нагретого флюида (60–80 °C на устье).",
    "Механический rezание/jetting в местах отложений.",
    "Контроль возврата, отбор проб.",
  ],
  cement_squeeze: [
    "Расчёт объёма цемента и буферной жидкости.",
    "Спуск ГНКТ через цементировочную головку.",
    "Закачка буфер → цемент → продавочная жидкость.",
    "Выдержка ОЗЦ, разбуривание стакана.",
  ],
  plug_setting: [
    "Сборка с инструментом установки моста (Bridge Plug/Cement Retainer).",
    "Спуск до проектной глубины, активация инструмента давлением/тягой.",
    "Опрессовка моста сверху, отсоединение.",
  ],
  fishing: [
    "Анализ оставленного предмета (рыбы) и подбор ловильного инструмента.",
    "Спуск с легким контактом, циркуляция при подходе.",
    "Захват и подъём с контролем нагрузки на ГНКТ.",
  ],
  milling: [
    "Сборка фрезы с подходящим типом резцов.",
    "Контроль WOB, RPM (если ротация), Q промывки.",
    "Поинтервальное фрезерование с подъёмом шлама.",
  ],
};

function statusOf(risks: RiskItem[]): "ok" | "warn" | "danger" {
  if (risks.some(r => r.level === "critical")) return "danger";
  if (risks.some(r => r.level === "warning")) return "warn";
  return "ok";
}

export default function CTOperationSummary({
  operationType, ct, well, fluid, pump, forces, fatigue, risks,
}: Props) {
  const op = CT_OPERATIONS.find(o => o.type === operationType);
  const status = statusOf(risks);
  const steps = (operationType && PROGRAM_STEPS[operationType as CTOperationType]) ?? [
    "Выберите тип операции в Библиотеке (наверху страницы) — отобразится пошаговая программа.",
  ];

  const reachOk = forces ? (forces.lockUpDepth === 0 || forces.lockUpDepth >= well.md * 0.95) : false;
  const fatiguePct = fatigue ? Math.min(100, fatigue.fatigueLifeUsed ?? 0) : 0;

  return (
    <div className="space-y-3">
      {/* Header */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            Сводка операции ГНКТ
            {op && (
              <Badge variant="secondary" className="text-[10px] ml-2">
                {op.icon} {op.nameRu}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!op && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 flex items-start gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <span>Тип операции не выбран. Выберите в «Библиотеке операций ГНКТ» наверху — расчёты подстроятся, а здесь появится пошаговая программа и сводка.</span>
            </div>
          )}

          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryKPI
              label="Достижение цели"
              value={forces ? (forces.lockUpDepth === 0 ? "Доходит" : `${forces.lockUpDepth.toFixed(0)} м`) : "—"}
              tone={forces ? (reachOk ? "ok" : "danger") : "muted"}
              icon={<Target className="w-3.5 h-3.5" />}
            />
            <SummaryKPI
              label="MD скважины"
              value={`${well.md.toFixed(0)} м`}
              hint={`TVD ${well.tvd.toFixed(0)} м`}
            />
            <SummaryKPI
              label="ГНКТ"
              value={`${ct.od}×${ct.wall} мм`}
              hint={`${ct.grade} · L=${ct.length} м`}
            />
            <SummaryKPI
              label="Рабочий флюид"
              value={fluid.name || "—"}
              hint={`ρ=${fluid.density} г/см³ · Q=${(pump.flowRate * 60).toFixed(0)} л/мин`}
            />
            <SummaryKPI
              label="Остаточный ресурс"
              value={fatigue ? `${(100 - fatiguePct).toFixed(0)} %` : "—"}
              tone={fatiguePct < 60 ? "ok" : fatiguePct < 85 ? "warn" : "danger"}
              icon={<Activity className="w-3.5 h-3.5" />}
            />
            <SummaryKPI
              label="POOH нагрузка"
              value={forces ? `${(forces.surfaceLoadPOOH / 1000).toFixed(1)} тс` : "—"}
            />
            <SummaryKPI
              label="RIH нагрузка"
              value={forces ? `${(forces.surfaceLoadRIH / 1000).toFixed(1)} тс` : "—"}
            />
            <SummaryKPI
              label="Общий статус"
              value={status === "ok" ? "Безопасно" : status === "warn" ? "Внимание" : "Критично"}
              tone={status}
              icon={
                status === "ok" ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                status === "danger" ? <XCircle className="w-3.5 h-3.5" /> :
                <AlertTriangle className="w-3.5 h-3.5" />
              }
            />
          </div>

          {/* Risks */}
          {risks.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Активные риски
              </h4>
              <div className="space-y-1.5">
                {risks.map((r, i) => (
                  <div key={i} className={`text-xs px-3 py-2 rounded-lg border ${
                    r.level === "critical" ? "border-destructive/30 bg-destructive/5" :
                    r.level === "warning" ? "border-amber-500/30 bg-amber-500/5" :
                    "border-emerald-500/30 bg-emerald-500/5"
                  }`}>
                    <span className="mr-1.5">{r.emoji}</span>{r.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Typical BHA & risks for selected op */}
          {op && op.type !== "custom" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Wrench className="w-3 h-3" /> Типовая КНБК
                </div>
                <ul className="space-y-1 text-xs">
                  {op.typicalBHA.map((b, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-primary mt-0.5">▸</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-1.5 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Типовые риски операции
                </div>
                <ul className="space-y-1 text-xs">
                  {op.risks.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-amber-500 mt-0.5">⚠</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Program steps */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="text-[10px] uppercase tracking-wider text-primary mb-2 flex items-center gap-1">
              <FileText className="w-3 h-3" /> Рекомендуемая программа по шагам
            </div>
            <ol className="space-y-1.5 text-xs">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="font-mono font-semibold text-primary shrink-0">{i + 1}.</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>

          <p className="text-[10px] text-muted-foreground italic">
            Сводка собирает ключевые KPI из вкладок «Дохождение», «Усталость», «Гидравлика», блока рисков
            и пошагового сценария для выбранного типа операции. Расчёты носят информационный характер.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryKPI({
  label, value, hint, tone, icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "danger" | "muted";
  icon?: React.ReactNode;
}) {
  const cls =
    tone === "ok" ? "border-emerald-500/30 bg-emerald-500/5" :
    tone === "warn" ? "border-amber-500/30 bg-amber-500/5" :
    tone === "danger" ? "border-destructive/30 bg-destructive/5" :
    "border-border bg-muted/30";
  return (
    <div className={`rounded-lg border p-2.5 ${cls}`}>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wider">
        {icon}{label}
      </div>
      <div className="text-base font-semibold mt-0.5 tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
