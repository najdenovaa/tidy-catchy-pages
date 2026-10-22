import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, ArrowRightLeft, RotateCcw } from "lucide-react";
import { conditionsAll, type ProtocolInput } from "@/lib/lab-protocol";
import { designToTargets, defaultTargets, applyDesignToSlurry, BASE_CEMENTS, type LabTargets, type TargetDesignResult } from "@/lib/cement-recipe-designer";
import type { SlurryInput } from "@/lib/cementing-calculations";

interface Props {
  input: ProtocolInput;
  targets: (LabTargets | undefined)[];
  onTargetsChange: (idx: number, t: LabTargets | undefined) => void;
  onApplySlurries?: (slurries: SlurryInput[]) => void;
}

type NumKey = "thickeningMinMin" | "thickeningMaxMin" | "fluidLossMaxMl" | "freeWaterMaxPct" | "yieldPointMaxPa" | "spreadMinCm" | "strength24MinMPa" | "strength48MinMPa" | "sgsMaxMin";
const NUM_FIELDS: { key: NumKey; label: string; unit: string; dec: number }[] = [
  { key: "thickeningMinMin", label: "Время загустевания 30 Вс, не менее", unit: "мин", dec: 0 },
  { key: "thickeningMaxMin", label: "Время загустевания 30 Вс, не более", unit: "мин", dec: 0 },
  { key: "fluidLossMaxMl", label: "Водоотдача, не более", unit: "мл/30 мин", dec: 0 },
  { key: "freeWaterMaxPct", label: "Свободная вода, не более", unit: "%", dec: 1 },
  { key: "yieldPointMaxPa", label: "ДНС при 27 °C, не более", unit: "Па", dec: 0 },
  { key: "spreadMinCm", label: "Растекаемость, не менее", unit: "см", dec: 0 },
  { key: "strength24MinMPa", label: "Прочность 24 ч на кровле, не менее", unit: "МПа", dec: 2 },
  { key: "strength48MinMPa", label: "Прочность 48 ч на кровле, не менее", unit: "МПа", dec: 2 },
  { key: "sgsMaxMin", label: "Переходный период СНС, не более", unit: "мин", dec: 0 },
];

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

function NumField({ value, placeholder, onCommit }: { value: number | undefined; placeholder: string; onCommit: (v: number | undefined) => void }) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  useEffect(() => { setDraft(value === undefined ? "" : String(value)); }, [value]);
  const commit = () => {
    const t = draft.trim().replace(",", ".");
    if (t === "") { if (value !== undefined) onCommit(undefined); return; }
    const v = parseFloat(t);
    if (Number.isFinite(v) && v >= 0) { if (v !== value) onCommit(v); } else setDraft(value === undefined ? "" : String(value));
  };
  return (
    <input
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={`h-8 w-24 rounded border px-2 text-right text-xs bg-background ${value !== undefined ? "border-primary font-semibold" : "border-border"} placeholder:text-muted-foreground/70`}
    />
  );
}

/** Требования технолога к раствору → автоматический подбор химии и рецептуры. */
export default function LabTargetsPanel({ input, targets, onTargetsChange, onApplySlurries }: Props) {
  const { conditions } = useMemo(() => conditionsAll(input), [input]);
  const results: TargetDesignResult[] = useMemo(
    () => conditions.map((c, i) => designToTargets(c, targets[i])),
    [conditions, targets],
  );
  const [msg, setMsg] = useState<string | null>(null);

  const apply = (only?: number) => {
    if (!onApplySlurries) return;
    const next = input.slurries.map((s, i) =>
      only === undefined || only === i
        ? applyDesignToSlurry({ ...s, labTargets: targets[i] }, results[i].design, false)
        : { ...s, labTargets: targets[i] },
    );
    onApplySlurries(next);
    setMsg(only === undefined ? "Рецептуры всех растворов записаны в программу: добавки, В/С, выход, реология и время загустевания." : `Рецептура раствора «${input.slurries[only].name}» записана в программу.`);
  };

  if (input.slurries.length === 0) return null;

  return (
    <Card className="p-4 space-y-4" data-testid="lab-targets">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><FlaskConical className="h-4 w-4" />Требования к раствору → подбор химии и рецептуры</h3>
          <p className="text-xs text-muted-foreground max-w-3xl">
            Задайте нужные свойства — система подберёт реагенты и дозировки, пересчитает плотность по абсолютным объёмам и покажет, выполняется ли каждое требование.
            Пустое поле — значение по программе испытаний (серым). Протокол ниже формируется по этим же требованиям.
          </p>
        </div>
        {onApplySlurries && (
          <Button size="sm" onClick={() => apply()} data-testid="apply-all-targets"><ArrowRightLeft className="h-4 w-4 mr-1" />Записать все рецептуры в программу</Button>
        )}
      </div>
      {msg && <div className="text-xs text-green-700 dark:text-green-500">{msg}</div>}

      {input.slurries.map((s, i) => {
        const r = results[i];
        if (!r) return null;
        const t = targets[i] ?? {};
        const def = defaultTargets(conditions[i]);
        const set = (patch: Partial<LabTargets>) => {
          const nx: LabTargets = { ...t, ...patch };
          (Object.keys(nx) as (keyof LabTargets)[]).forEach((k) => { if (nx[k] === undefined) delete nx[k]; });
          onTargetsChange(i, Object.keys(nx).length ? nx : undefined);
        };
        const d = r.design;
        const failed = r.compliance.filter((x) => x.ok === false).length;
        return (
          <div key={`${s.name}-${i}`} className="rounded-lg border border-border/70 p-3 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="font-medium text-sm">
                Раствор {i + 1} «{s.name}» · {f(s.density, 2)} г/см³ · BHCT {f(conditions[i].bhctC, 0)} °C · кровля {f(conditions[i].tTopC, 0)} °C
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={r.allOk ? "outline" : "destructive"} className={r.allOk ? "border-green-600 text-green-700" : ""}>
                  {r.allOk ? "все требования выполнены (прогноз)" : `не выполнено: ${failed}`}
                </Badge>
                {Object.keys(t).length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => onTargetsChange(i, undefined)} title="Вернуть требования программы испытаний"><RotateCcw className="h-3.5 w-3.5 mr-1" />Сбросить</Button>
                )}
                {onApplySlurries && <Button size="sm" variant="outline" onClick={() => apply(i)}>Записать в программу</Button>}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Требования технолога</div>
                <div className="space-y-1">
                  {NUM_FIELDS.map((fd) => {
                    const dv = def[fd.key];
                    return (
                      <label key={fd.key} className="flex items-center justify-between gap-2 text-xs">
                        <span>{fd.label}, {fd.unit}</span>
                        <NumField value={t[fd.key]} placeholder={dv === undefined ? "нет" : f(dv, fd.dec)} onCommit={(v) => set({ [fd.key]: v } as Partial<LabTargets>)} />
                      </label>
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs">
                  {([["gasTight", "Газонепроницаемый (газоблок)"], ["expansion", "Расширяющийся камень"], ["fiber", "Армирующее волокно"]] as const).map(([k, label]) => (
                    <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={r.targets[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<LabTargets>)} />
                      <span className={t[k] !== undefined ? "font-semibold" : ""}>{label}</span>
                    </label>
                  ))}
                </div>
                <label className="flex items-center justify-between gap-2 text-xs">
                  <span>Тампонажный цемент</span>
                  <select value={t.baseCement ?? "auto"} onChange={(e) => set({ baseCement: e.target.value === "auto" ? undefined : (e.target.value as LabTargets["baseCement"]) })} className="h-8 max-w-[60%] rounded border border-border bg-background px-2 text-xs">
                    <option value="auto">Авто (ПЦТ I-G)</option>
                    {(Object.keys(BASE_CEMENTS) as (keyof typeof BASE_CEMENTS)[]).map((k) => <option key={k} value={k}>{BASE_CEMENTS[k].short} — {BASE_CEMENTS[k].note}</option>)}
                  </select>
                </label>
                <label className="flex items-center justify-between gap-2 text-xs">
                  <span>Облегчающая добавка</span>
                  <select
                    value={t.extender ?? "auto"}
                    onChange={(e) => set({ extender: e.target.value === "auto" ? undefined : (e.target.value as LabTargets["extender"]) })}
                    className="h-8 rounded border border-border bg-background px-2 text-xs"
                  >
                    <option value="auto">автовыбор</option>
                    <option value="bentonite">бентонит</option>
                    <option value="microspheres">микросферы</option>
                  </select>
                </label>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Подобранная рецептура</div>
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50"><tr><th className="p-1 text-left">Компонент</th><th className="p-1 text-right">% bwoc</th></tr></thead>
                    <tbody>
                      <tr className="border-t border-border/40"><td className="p-1">{d.baseCement}</td><td className="p-1 text-right">100</td></tr>
                      {d.components.map((c) => (
                        <tr key={c.role + c.name} className="border-t border-border/40"><td className="p-1">{c.name}</td><td className="p-1 text-right">{f(c.pctBwoc, 2)}</td></tr>
                      ))}
                      <tr className="border-t border-border/40"><td className="p-1">Вода затворения</td><td className="p-1 text-right">{f(d.waterPctBwoc, 1)}</td></tr>
                    </tbody>
                  </table>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    Плотность {f(d.densityGcm3, 3)} г/см³ · В/С {f(d.waterToBlend, 3)} · выход {f(d.yieldM3PerT, 3)} м³/т
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Выполнение требований</div>
                  <table className="w-full text-xs" data-testid={`compliance-${i}`}>
                    <thead className="bg-muted/50"><tr><th className="p-1 text-left">Показатель</th><th className="p-1 text-right">Требование</th><th className="p-1 text-right">Прогноз</th><th className="p-1 w-6" /></tr></thead>
                    <tbody>
                      {r.compliance.map((c) => (
                        <tr key={c.key} className="border-t border-border/40">
                          <td className="p-1">{c.label}</td>
                          <td className="p-1 text-right whitespace-nowrap">{c.target}</td>
                          <td className={`p-1 text-right ${c.ok === false ? "text-red-600 font-semibold" : ""}`}>{c.predicted}</td>
                          <td className="p-1 text-center">{c.ok === null ? "" : c.ok ? <span className="text-green-600">✓</span> : <span className="text-red-600">✗</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            {r.actions.length > 0 && <div className="text-xs text-muted-foreground">Корректировка под требования: {r.actions.join("; ")}.</div>}
            {!r.allOk && (
              <div className="text-xs text-amber-700 dark:text-amber-500">
                Часть требований недостижима одновременно в рамках корреляций (например, высокая ранняя прочность облегчённого раствора на холодной кровле). Ослабьте требование или смените тип облегчения / плотность.
              </div>
            )}
            {d.warnings.map((w) => <div key={w} className="text-xs text-amber-700 dark:text-amber-500">⚠ {w}</div>)}
          </div>
        );
      })}
      <div className="text-[11px] text-muted-foreground">
        Прогноз по инженерным корреляциям (ПЦТ класса G, абсолютные объёмы, API RP 10B-2): плотность и выход — точно, время загустевания ±25%, водоотдача, реология и прочность ±30–40%. Рецептура подтверждается испытанием на фактической партии.
      </div>
    </Card>
  );
}
