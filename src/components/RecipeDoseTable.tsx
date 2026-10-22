import { RotateCcw, X } from "lucide-react";
import { DOSE_ROLES, type AdditiveRole, type DoseOverrides, type SlurryDesign } from "@/lib/cement-recipe-designer";

type Role = Exclude<AdditiveRole, "base">;
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

/**
 * Состав раствора с редактируемыми дозировками добавок.
 * Изменение дозировки → пересчёт рецептуры (вода по плотности, загустевание, водоотдача, реология, прочность).
 * Пустое поле — вернуть автоподбор, × — исключить добавку.
 */
export default function RecipeDoseTable({ d, doses, onChange, textSize = "text-[11px]" }: {
  d: SlurryDesign; doses: DoseOverrides | undefined; onChange: (next: DoseOverrides | undefined) => void; textSize?: string;
}) {
  const cur = doses ?? {};
  const setDose = (r: Role, v: number | undefined) => {
    const n: DoseOverrides = { ...cur };
    if (v === undefined) delete n[r]; else n[r] = v;
    onChange(Object.keys(n).length ? n : undefined);
  };
  const present = new Set(d.components.map((c) => c.role));
  const excluded = (Object.keys(cur) as Role[]).filter((r) => cur[r] === 0 && !present.has(r));
  const addable = (Object.keys(DOSE_ROLES) as Role[]).filter((r) => !present.has(r) && cur[r] !== 0);
  const manual = Object.keys(cur).length > 0;

  return (
    <div className="space-y-1" data-testid="recipe-doses">
      <table className={`w-full table-fixed ${textSize}`}>
        <colgroup><col /><col className="w-[92px]" /></colgroup>
        <thead className="bg-muted/50"><tr><th className="p-1 text-left">Компонент</th><th className="p-1 text-right">% bwoc</th></tr></thead>
        <tbody>
          <tr className="border-t border-border/40"><td className="p-1 break-words">{d.baseCement}</td><td className="p-1 text-right">100</td></tr>
          {d.components.map((c) => {
            const r = c.role as Role;
            const isMan = cur[r] !== undefined;
            return (
              <tr key={c.role + c.name} className={`border-t border-border/40 ${isMan ? "bg-primary/5" : ""}`}>
                <td className="p-1 break-words">{c.name}{isMan && <span className="ml-1 text-[9px] text-primary">(вручную)</span>}</td>
                <td className="p-1">
                  <div className="flex items-center justify-end gap-0.5">
                    <input
                      inputMode="decimal"
                      key={`${r}-${c.pctBwoc}`}
                      defaultValue={f(c.pctBwoc)}
                      aria-label={`Дозировка: ${DOSE_ROLES[r]?.label ?? c.name}`}
                      data-testid={`dose-${r}`}
                      onBlur={(e) => {
                        const s = e.target.value.trim().replace(",", ".");
                        if (s === "") { setDose(r, undefined); return; }
                        const v = parseFloat(s);
                        if (Number.isFinite(v) && v >= 0 && Math.abs(v - c.pctBwoc) > 1e-9) setDose(r, v);
                        else e.target.value = f(c.pctBwoc);
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      className={`h-6 w-14 rounded border px-1 text-right bg-background ${isMan ? "border-primary font-semibold" : "border-border"}`}
                    />
                    {isMan
                      ? <button type="button" title="Вернуть автоподбор" aria-label="Вернуть автоподбор" onClick={() => setDose(r, undefined)} className="p-0.5 text-muted-foreground hover:text-foreground"><RotateCcw className="w-3 h-3" /></button>
                      : <button type="button" title="Исключить добавку" aria-label="Исключить добавку" onClick={() => setDose(r, 0)} className="p-0.5 text-muted-foreground hover:text-destructive"><X className="w-3 h-3" /></button>}
                  </div>
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-border/40"><td className="p-1">Вода затворения <span className="text-[9px] text-muted-foreground">(по плотности)</span></td><td className="p-1 text-right pr-5">{f(d.waterPctBwoc, 1)}</td></tr>
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        {addable.length > 0 && (
          <select value="" onChange={(e) => { const r = e.target.value as Role; if (r) setDose(r, DOSE_ROLES[r].step * Math.max(1, Math.round(DOSE_ROLES[r].max / 4 / DOSE_ROLES[r].step))); }}
            className="h-6 rounded border border-border bg-background px-1 text-[10px]" data-testid="dose-add">
            <option value="">+ добавить добавку</option>
            {addable.map((r) => <option key={r} value={r}>{DOSE_ROLES[r].label}</option>)}
          </select>
        )}
        {excluded.map((r) => (
          <button key={r} type="button" onClick={() => setDose(r, undefined)} className="rounded border border-dashed border-border px-1.5 py-0.5 text-muted-foreground line-through hover:no-underline" title="Вернуть в рецептуру">
            {DOSE_ROLES[r].label}
          </button>
        ))}
        {manual && <button type="button" onClick={() => onChange(undefined)} className="ml-auto text-primary underline-offset-2 hover:underline">сбросить все дозировки</button>}
      </div>
      <p className="text-[10px] text-muted-foreground">Дозировки можно править: свойства раствора и камня пересчитываются сразу. Пустое поле — автоподбор, × — исключить.</p>
    </div>
  );
}
