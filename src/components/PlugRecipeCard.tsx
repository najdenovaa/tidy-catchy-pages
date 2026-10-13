import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, ArrowRightLeft, Printer, Download } from "lucide-react";
import type { PlugInputs, PlugResults } from "@/lib/cement-plug-calculations";
import type { LabTargets, SlurryDesign } from "@/lib/cement-recipe-designer";
import { PLUG_PURPOSE_LABEL, type PlugPurpose } from "@/lib/cement-plug-types";
import { designPlugSlurry, buildPlugLabProtocol, plugJobTimeMin, plugRequiredThickeningMin } from "@/lib/cement-plug-recipe";
import { protocolToHtml } from "@/lib/lab-protocol";
import { exportLabProtocolDocx } from "@/lib/export-lab-protocol-docx";

interface Props {
  inputs: PlugInputs;
  results: PlugResults;
  wocHours: number;
  purpose: PlugPurpose;
  onPurposeChange: (p: PlugPurpose) => void;
  onApply: (d: SlurryDesign) => void;
}

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

type NumKey = "thickeningMinMin" | "fluidLossMaxMl" | "yieldPointMaxPa" | "strength24MinMPa" | "strength48MinMPa";
const FIELDS: { key: NumKey; label: string; unit: string; dec: number }[] = [
  { key: "thickeningMinMin", label: "Загустевание 30 Вс, не менее", unit: "мин", dec: 0 },
  { key: "fluidLossMaxMl", label: "Водоотдача, не более", unit: "мл/30 мин", dec: 0 },
  { key: "yieldPointMaxPa", label: "ДНС при 27 °C, не более", unit: "Па", dec: 0 },
  { key: "strength24MinMPa", label: "Прочность 24 ч на кровле, не менее", unit: "МПа", dec: 1 },
  { key: "strength48MinMPa", label: "Прочность 48 ч на кровле, не менее", unit: "МПа", dec: 1 },
];

/** Подбор рецептуры для моста под требования технолога + расчётный протокол. */
export default function PlugRecipeCard({ inputs, results, wocHours, purpose, onPurposeChange: setPurpose, onApply }: Props) {
  const [user, setUser] = useState<LabTargets>({});
  const [msg, setMsg] = useState<string | null>(null);
  const res = useMemo(() => designPlugSlurry(inputs, results, purpose, wocHours, user), [inputs, results, purpose, wocHours, user]);
  const d = res.design;
  const t = results.temperatures;
  const set = (k: keyof LabTargets, v: unknown) => setUser((u) => { const n = { ...u, [k]: v } as LabTargets; if (v === undefined) delete (n as Record<string, unknown>)[k]; return n; });

  const protocol = () => buildPlugLabProtocol(inputs, results, res, purpose, wocHours);
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) { setMsg("Браузер заблокировал окно печати — разрешите всплывающие окна."); return; }
    w.document.write(protocolToHtml(protocol())); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  };

  return (
    <Card className="border-primary/30" data-testid="plug-recipe">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <FlaskConical className="w-4 h-4" /> Рецептура раствора для моста
          <Badge variant={res.allOk ? "default" : "destructive"} className="text-[10px]">{res.allOk ? "требования выполнены (прогноз)" : `не выполнено: ${res.compliance.filter((c) => c.ok === false).length}`}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 text-xs">
        <p className="text-muted-foreground">
          Условия: BHCT {f(t.bhctC, 0)} °C, кровля/подошва {f(t.tTopStaticC, 0)}/{f(t.tBottomStaticC, 0)} °C{t.estimated ? " (t° забоя не задана — оценка)" : ""}; работа раствора {f(plugJobTimeMin(results), 0)} мин (закачка, продавка, подъём из цемента) → нужно загустевание ≥ {plugRequiredThickeningMin(results)} мин.
        </p>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="space-y-1.5">
            <label className="flex items-center justify-between gap-2">
              <span>Назначение моста</span>
              <select value={purpose} onChange={(e) => setPurpose(e.target.value as PlugPurpose)} className="h-8 rounded border border-border bg-background px-2 text-xs">
                {(Object.keys(PLUG_PURPOSE_LABEL) as PlugPurpose[]).map((k) => <option key={k} value={k}>{PLUG_PURPOSE_LABEL[k]}</option>)}
              </select>
            </label>
            {FIELDS.map((fd) => (
              <label key={fd.key} className="flex items-center justify-between gap-2">
                <span>{fd.label}, {fd.unit}</span>
                <input
                  inputMode="decimal"
                  key={`${fd.key}-${user[fd.key] ?? "d"}`}
                  defaultValue={user[fd.key] ?? ""}
                  placeholder={res.targets[fd.key] === undefined ? "нет" : f(res.targets[fd.key] as number, fd.dec)}
                  onBlur={(e) => { const v = parseFloat(e.target.value.replace(",", ".")); set(fd.key, Number.isFinite(v) ? v : undefined); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  className={`h-8 w-24 rounded border px-2 text-right bg-background ${user[fd.key] !== undefined ? "border-primary font-semibold" : "border-border"}`}
                />
              </label>
            ))}
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
              {([["expansion", "Расширяющийся камень"], ["fiber", "Армирующее волокно"]] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={!!res.targets[k]} onChange={(e) => set(k, e.target.checked)} />{label}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50"><tr><th className="p-1 text-left">Компонент</th><th className="p-1 text-right">% bwoc</th></tr></thead>
              <tbody>
                <tr className="border-t border-border/40"><td className="p-1">{d.baseCement}</td><td className="p-1 text-right">100</td></tr>
                {d.components.map((c) => <tr key={c.role + c.name} className="border-t border-border/40"><td className="p-1">{c.name}</td><td className="p-1 text-right">{f(c.pctBwoc, 2)}</td></tr>)}
                <tr className="border-t border-border/40"><td className="p-1">Вода затворения</td><td className="p-1 text-right">{f(d.waterPctBwoc, 1)}</td></tr>
              </tbody>
            </table>
            <p className="text-[10px] text-muted-foreground">Плотность {f(d.densityGcm3, 3)} г/см³ · В/С {f(d.waterToBlend, 3)} · выход {f(d.yieldM3PerT, 3)} м³/т</p>
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50"><tr><th className="p-1 text-left">Показатель</th><th className="p-1 text-right">Требование</th><th className="p-1 text-right">Прогноз</th><th className="w-5" /></tr></thead>
              <tbody>
                {res.compliance.map((c) => (
                  <tr key={c.key} className="border-t border-border/40">
                    <td className="p-1">{c.label}</td><td className="p-1 text-right">{c.target}</td>
                    <td className={`p-1 text-right ${c.ok === false ? "text-destructive font-semibold" : ""}`}>{c.predicted}</td>
                    <td className="p-1 text-center">{c.ok === null ? "" : c.ok ? "✓" : "✗"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {res.actions.length > 0 && <p className="text-muted-foreground">Корректировка: {res.actions.join("; ")}.</p>}
        {d.warnings.map((w) => <p key={w} className="text-amber-600">⚠ {w}</p>)}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { onApply(d); setMsg("Рецептура записана в раствор моста: добавки, В/С, выход, реология, время загустевания. Нажмите «Расчёт» для пересчёта."); }}>
            <ArrowRightLeft className="w-4 h-4 mr-1" />Записать в раствор моста
          </Button>
          <Button size="sm" variant="outline" onClick={print}><Printer className="w-4 h-4 mr-1" />Протокол — печать</Button>
          <Button size="sm" variant="outline" onClick={() => exportLabProtocolDocx(protocol(), "Протокол_рецептуры_моста.docx")}><Download className="w-4 h-4 mr-1" />Протокол — Word</Button>
        </div>
        {msg && <p className="text-green-600">{msg}</p>}
        <p className="text-[10px] text-muted-foreground">Прогноз по корреляциям (ПЦТ класса G, абсолютные объёмы, API RP 10B-2): время загустевания ±25%, прочность ±30–40%. СНС раствора замерить — он входит в расчёт устойчивости моста.</p>
      </CardContent>
    </Card>
  );
}
