import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wand2, Loader2 } from "lucide-react";
import type { PlugInputs } from "@/lib/cement-plug-calculations";
import { autoDesignPlug, SUPPORT_OPTION_LABEL, type AutoDesignResult, type PlugCandidate } from "@/lib/cement-plug-autodesign";
import { PLUG_PURPOSE_LABEL, type PlugPurpose } from "@/lib/cement-plug-types";
import type { PlugComplicationParams } from "@/lib/cement-plug-complication-eval";
import { PILL_TYPE_LABEL } from "@/lib/cement-plug-pill";

interface Props {
  inputs: PlugInputs;
  purpose: PlugPurpose;
  wocHours: number;
  fracGradient: number;
  onApply: (c: PlugCandidate) => void;
  complications?: PlugComplicationParams | null;
}

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const VERDICT: Record<string, string> = { supported: "на опоре", "no-buoyancy": "устойчив", guaranteed: "устойчив (гарант.)", stable: "устойчив", settle: "устоит, малая осадка", risk: "риск осадки", unstable: "может уйти" };

/** Автоподбор конструкции моста: плотность, длина, опора/пачка, недопродавка, запас. */
export default function PlugAutoDesignCard({ inputs, purpose, wocHours, fracGradient, onApply, complications }: Props) {
  const [res, setRes] = useState<AutoDesignResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true);
    setTimeout(() => { setRes(autoDesignPlug(inputs, purpose, wocHours, fracGradient, { complications })); setBusy(false); }, 30);
  };
  const support = (c: PlugCandidate) => `${SUPPORT_OPTION_LABEL[c.support]}${c.pillGelPa > 0 ? `, СНС ≥ ${c.pillGelPa} Па, ${f(c.pillVolumeM3, 2)} м³` : ""}`;
  const b = res?.best;
  return (
    <Card className="border-primary/30" data-testid="plug-autodesign">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Wand2 className="w-4 h-4" /> Автоподбор конструкции моста
          <Badge variant="outline" className="text-[10px]">{PLUG_PURPOSE_LABEL[purpose]}</Badge>
          {complications && <Badge variant="secondary" className="text-[10px]">с учётом осложнений</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 text-xs">
        <p className="text-muted-foreground">
          Перебирает плотность цемента, длину моста и опору (без опоры, вязкая или реактивная пачка, механическая опора) и проверяет каждый вариант:
          устойчивость против обмена жидкостями, рецептуру под назначение (прочность к ОЗЦ {f(wocHours, 0)} ч, загустевание), давление на забое против ГРП, безопасное время.
          Выбирает самый простой в исполнении допустимый вариант.
        </p>
        <Button size="sm" onClick={run} disabled={busy} data-testid="run-autodesign">
          {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Wand2 className="w-4 h-4 mr-1" />}Подобрать
        </Button>
        {res && (
          <div className="space-y-3">
            {b ? (
              <div className="rounded-md border border-green-500/40 bg-green-500/5 p-3 space-y-1.5">
                <p className="font-semibold">Рекомендуемый вариант</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                  <span>Интервал: {f(b.topMD, 0)}–{f(b.topMD + b.lengthM, 0)} м ({b.lengthM} м)</span>
                  <span>Плотность цемента: {f(b.densityGcm3, 2)} г/см³</span>
                  <span>Опора: {support(b)}</span>
                  <span>Недопродавка: {f(b.underDisplacementM3, 2)} м³</span>
                  <span>Запас на загрязнение: {b.excessPct}%</span>
                  <span>Обмен жидкостями: {VERDICT[b.exchangeVerdict] ?? b.exchangeVerdict}</span>
                  <span className={b.expectedTopDropM > 0.1 * b.lengthM ? "text-amber-600" : ""}>Ожидаемая кровля: {b.expectedTopDropM > 0.5 ? `ниже плана на ${f(b.expectedTopDropM, 1)} м` : "на месте"}{complications ? " (с осложнениями)" : ""}</span>
                  <span>P забой макс / ГРП: {b.maxBhpMPa !== null ? f(b.maxBhpMPa, 1) : "—"} / {f(b.fracMPa, 1)} МПа</span>
                </div>
                {b.recipeSummary && <p className="text-[11px]"><b>Цемент:</b> {b.recipeSummary}</p>}
                {b.pillDesign && b.pillDesign.type !== "none" && (
                  <p className="text-[11px]"><b>Пачка:</b> {PILL_TYPE_LABEL[b.pillDesign.type]} — {b.pillDesign.components.filter((c) => c.kgPerM3 > 0).map((c) => `${c.name.split(" (")[0].split(",")[0]} ${c.kgPerM3 < 10 ? c.kgPerM3.toFixed(1) : c.kgPerM3.toFixed(0)} кг/м³`).join(", ")}; СНС 10 с ≈ {f(b.pillDesign.predicted.gel10s, 0)} Па</p>
                )}
                <Button size="sm" onClick={() => onApply(b)} data-testid="apply-autodesign">Применить и пересчитать</Button>
              </div>
            ) : null}
            {res.notes.map((n) => <p key={n} className="text-amber-600">⚠ {n}</p>)}
            {res.alternatives.length > 0 && (
              <div className="overflow-x-auto">
                <p className="font-semibold mb-1">Другие варианты</p>
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/50">
                    <tr><th className="p-1 text-left">Опора</th><th className="p-1 text-right">ρ, г/см³</th><th className="p-1 text-right">Длина, м</th><th className="p-1 text-left">Итог</th><th /></tr>
                  </thead>
                  <tbody>
                    {res.alternatives.map((c, i) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="p-1">{support(c)}</td>
                        <td className="p-1 text-right">{f(c.densityGcm3, 2)}</td>
                        <td className="p-1 text-right">{c.lengthM}</td>
                        <td className={`p-1 ${c.feasible ? "text-green-600" : "text-muted-foreground"}`}>{c.feasible ? "допустим" : c.reasons.join("; ")}</td>
                        <td className="p-1 text-right">{c.feasible && <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => onApply(c)}>Применить</Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">Рассмотрено вариантов: {res.evaluated}. Пачка: плотность как у раствора скважины (без новой неустойчивой границы), длина ≈ 40 м; СНС указан с запасом 20% к экспериментальному пределу. Механическая опора — когда нужный СНС больше ~250 Па.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
