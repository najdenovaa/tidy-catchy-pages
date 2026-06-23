import { useMemo } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PressureProfileResult, VolumeResults } from "@/lib/cementing-calculations";
import type { CentralizationResult } from "@/lib/centralization-calculations";

type Status = "ok" | "warning" | "danger" | "info" | "muted";

interface Props {
  pressureResult: PressureProfileResult | null;
  volumes: VolumeResults | null;
  centralizationResults: CentralizationResult[] | null;
  thickeningTimeMin?: number;
  /** Компактный вертикальный режим — для встраивания справа от навигации */
  compact?: boolean;
}

interface Indicator {
  label: string;
  value: string;
  status: Status;
  hint?: string;
}

const STATUS_STYLES: Record<Status, { bg: string; border: string; text: string; icon: React.ComponentType<{ className?: string }> }> = {
  ok: { bg: "bg-emerald-500/10", border: "border-emerald-500/40", text: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle2 },
  warning: { bg: "bg-amber-500/10", border: "border-amber-500/40", text: "text-amber-600 dark:text-amber-400", icon: AlertTriangle },
  danger: { bg: "bg-red-500/10", border: "border-red-500/40", text: "text-red-600 dark:text-red-400", icon: XCircle },
  info: { bg: "bg-sky-500/10", border: "border-sky-500/40", text: "text-sky-600 dark:text-sky-400", icon: Info },
  muted: { bg: "bg-muted", border: "border-border", text: "text-muted-foreground", icon: Info },
};

export default function SafetyTrafficLight({ pressureResult, volumes, centralizationResults, thickeningTimeMin }: Props) {
  const indicators: Indicator[] = useMemo(() => {
    const out: Indicator[] = [];

    // 1) ЭЦП vs давление ГРП
    if (pressureResult && pressureResult.points.length > 0) {
      const maxBHP = Math.max(...pressureResult.points.map((p) => p.bottomholePressure));
      const fracP = pressureResult.points[0]?.fracturePressure ?? 0;
      const ratio = fracP > 0 ? maxBHP / fracP : 0;
      const status: Status = ratio === 0 ? "muted" : ratio >= 0.95 ? "danger" : ratio >= 0.85 ? "warning" : "ok";
      out.push({
        label: "ЭЦП vs ГРП",
        value: `${maxBHP.toFixed(1)} / ${fracP.toFixed(1)} МПа`,
        status,
        hint: ratio > 0 ? `${(ratio * 100).toFixed(0)}% от ГРП` : undefined,
      });
    } else {
      out.push({ label: "ЭЦП vs ГРП", value: "—", status: "muted" });
    }

    // 2) Время загустевания vs безопасное время работы
    if (pressureResult && thickeningTimeMin && thickeningTimeMin > 0) {
      const safe = pressureResult.safeWorkingTimeMin;
      const margin = thickeningTimeMin - safe;
      const ratio = safe / thickeningTimeMin;
      const status: Status = ratio >= 0.9 ? "danger" : ratio >= 0.75 ? "warning" : "ok";
      out.push({
        label: "Время загуст.",
        value: `${safe.toFixed(0)} / ${thickeningTimeMin.toFixed(0)} мин`,
        status,
        hint: `запас ${margin.toFixed(0)} мин`,
      });
    } else if (pressureResult) {
      out.push({
        label: "Безоп. время",
        value: `${pressureResult.safeWorkingTimeMin.toFixed(0)} мин`,
        status: "info",
      });
    }

    // 3) Объём цементного раствора
    if (volumes) {
      out.push({
        label: "Объём цемента",
        value: `${volumes.totalSlurryVolume.toFixed(1)} м³`,
        status: "info",
      });
    }

    // 4) Среднее центрирование (standoff)
    if (centralizationResults && centralizationResults.length > 0) {
      const avg = centralizationResults.reduce((s, r) => s + r.standoff, 0) / centralizationResults.length;
      const min = Math.min(...centralizationResults.map((r) => r.standoff));
      const status: Status = min < 60 ? "danger" : min < 67 || avg < 75 ? "warning" : "ok";
      out.push({
        label: "Центрирование",
        value: `ср. ${avg.toFixed(0)}% / мин ${min.toFixed(0)}%`,
        status,
        hint: status === "ok" ? "API 10D ≥ 67%" : "ниже API 10D",
      });
    } else {
      out.push({ label: "Центрирование", value: "—", status: "muted" });
    }

    return out;
  }, [pressureResult, volumes, centralizationResults, thickeningTimeMin]);

  // Общий статус — худший из критичных
  const overall: Status = useMemo(() => {
    if (indicators.some((i) => i.status === "danger")) return "danger";
    if (indicators.some((i) => i.status === "warning")) return "warning";
    if (indicators.every((i) => i.status === "muted")) return "muted";
    return "ok";
  }, [indicators]);

  const overallLabel =
    overall === "ok"
      ? "Все ключевые параметры в норме"
      : overall === "warning"
      ? "Есть параметры на грани"
      : overall === "danger"
      ? "Критические риски — проверьте детали"
      : "Нет данных — нажмите «РАСЧЁТ»";

  const OverallIcon = STATUS_STYLES[overall].icon;

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 pt-2">
      <div className={cn("rounded-xl border p-2.5 flex flex-col gap-2", STATUS_STYLES[overall].bg, STATUS_STYLES[overall].border)}>
        <div className={cn("flex items-center gap-2 text-xs font-medium", STATUS_STYLES[overall].text)}>
          <OverallIcon className="h-4 w-4" />
          <span className="uppercase tracking-wide">Светофор безопасности:</span>
          <span className="normal-case font-normal">{overallLabel}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {indicators.map((ind, i) => {
            const s = STATUS_STYLES[ind.status];
            const Icon = s.icon;
            return (
              <div key={i} className={cn("rounded-lg border bg-card px-2.5 py-1.5 flex items-start gap-2", s.border)}>
                <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", s.text)} />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-muted-foreground leading-tight">{ind.label}</div>
                  <div className="text-xs font-mono font-bold leading-tight truncate">{ind.value}</div>
                  {ind.hint && <div className={cn("text-[9px] mt-0.5", s.text)}>{ind.hint}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
