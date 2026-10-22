import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Layers, ArrowRightLeft } from "lucide-react";
import { PILL_TYPE_LABEL, type PillDesign } from "@/lib/cement-plug-pill";

export interface PillSettings { needGelPa?: number; densityGcm3?: number; volumeM3?: number; mode?: "practice" | "strict" }

interface Props {
  design: PillDesign;
  autoNeedPa: number;
  strictPa: number;
  practicePa: number;
  allowFallM: number;
  autoDensity: number;
  autoVolume: number;
  bhctC: number;
  settings: PillSettings;
  onSettings: (s: PillSettings) => void;
  onApply: (d: PillDesign) => void;
}

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

function Num({ label, unit, value, placeholder, onCommit }: { label: string; unit: string; value?: number; placeholder: string; onCommit: (v?: number) => void }) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  return (
    <label className="flex items-center justify-between gap-2">
      <span>{label}, {unit}</span>
      <input
        inputMode="decimal" value={draft} placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { const v = parseFloat(draft.replace(",", ".")); onCommit(Number.isFinite(v) && v > 0 ? v : undefined); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className={`h-8 w-24 rounded border px-2 text-right bg-background ${value !== undefined ? "border-primary font-semibold" : "border-border"}`}
      />
    </label>
  );
}

/** Рецептура нижней (вязкой) пачки под мост. */
export default function PlugPillCard({ design: d, autoNeedPa, strictPa, practicePa, allowFallM, autoDensity, autoVolume, bhctC, settings, onSettings, onApply }: Props) {
  const [msg, setMsg] = useState<string | null>(null);
  const reserve = 1.05;
  return (
    <Card className="border-primary/30" data-testid="plug-pill">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Layers className="w-4 h-4" /> Рецептура нижней пачки (опора моста)
          <Badge variant={d.meets ? "default" : "destructive"} className="text-[10px]">{d.type === "none" ? "пачкой не обеспечить" : d.meets ? "СНС обеспечен (прогноз)" : "СНС не обеспечен"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 text-xs">
        <p className="text-muted-foreground">
          Пачка должна держать цемент. «По практике» — минимальный СНС, при котором ожидаемая осадка кровли не больше 5% длины моста (с учётом калибровки по отбивкам); «без обмена» — СНС по лабораторному критерию с запасом 20%, обмена не будет совсем.
          Плотность по умолчанию — как у раствора под пачкой, чтобы ниже не появилась новая граница «тяжёлое над лёгким». BHCT {f(bhctC, 0)} °C.
        </p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-1.5">
            <label className="flex items-center justify-between gap-2">
              <span>Требование к пачке</span>
              <select value={settings.mode ?? "practice"} onChange={(e) => onSettings({ ...settings, mode: e.target.value as PillSettings["mode"], needGelPa: undefined })} className="h-8 min-w-0 max-w-[60%] rounded border border-border bg-background px-2 text-xs" data-testid="pill-mode">
                <option value="practice">по практике: осадка ≤ {allowFallM.toFixed(1)} м (СНС ≥ {practicePa} Па)</option>
                <option value="strict">без обмена: лаб. критерий (СНС ≥ {strictPa} Па)</option>
              </select>
            </label>
            <Num key={`need-${settings.mode ?? "practice"}`} label="Нужный СНС 10 с" unit="Па" value={settings.needGelPa} placeholder={f(autoNeedPa, 0)} onCommit={(v) => onSettings({ ...settings, needGelPa: v })} />
            <Num label="Плотность пачки" unit="г/см³" value={settings.densityGcm3} placeholder={f(autoDensity, 2)} onCommit={(v) => onSettings({ ...settings, densityGcm3: v })} />
            <Num label="Объём пачки" unit="м³" value={settings.volumeM3} placeholder={f(autoVolume, 2)} onCommit={(v) => onSettings({ ...settings, volumeM3: v })} />
            <div className="rounded-md bg-muted/40 p-2 space-y-0.5">
              <p className="font-semibold">{PILL_TYPE_LABEL[d.type]}</p>
              {d.type !== "none" && (
                <p className="text-muted-foreground">
                  Прогноз: ρ {f(d.densityGcm3, 2)} г/см³ · ПВ {f(d.predicted.pv, 0)} мПа·с · ДНС {f(d.predicted.yp, 1)} Па · СНС 10 с / 10 мин {f(d.predicted.gel10s, 0)} / {f(d.predicted.gel10min, 0)} Па
                  {d.predicted.gelTimeMin ? ` · гелеобразование ≈ ${d.predicted.gelTimeMin} мин` : ""}
                </p>
              )}
            </div>
          </div>
          {d.type !== "none" && (
            <div className="space-y-2">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/50"><tr><th className="p-1 text-left">Компонент</th><th className="p-1 text-left">Назначение</th><th className="p-1 text-right">кг/м³</th><th className="p-1 text-right">На пачку (+5%)</th></tr></thead>
                <tbody>
                  <tr className="border-t border-border/40"><td className="p-1">Вода техническая пресная</td><td className="p-1">Основа</td><td className="p-1 text-right">{d.waterLPerM3} л</td><td className="p-1 text-right">{f((d.waterLPerM3 * d.volumeM3 * reserve) / 1000, 2)} м³</td></tr>
                  {d.components.map((c) => (
                    <tr key={c.name} className="border-t border-border/40">
                      <td className="p-1">{c.name}</td><td className="p-1 text-muted-foreground">{c.purpose}</td>
                      <td className="p-1 text-right">{f(c.kgPerM3, c.kgPerM3 < 10 ? 1 : 0)}</td>
                      <td className="p-1 text-right">{f(c.kgPerM3 * d.volumeM3 * reserve, 0)} кг</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ol className="list-decimal pl-4 space-y-0.5">{d.procedure.map((p) => <li key={p}>{p}</li>)}</ol>
            </div>
          )}
        </div>
        {d.notes.map((n) => <p key={n} className="text-muted-foreground">ℹ {n}</p>)}
        {d.warnings.map((w) => <p key={w} className="text-amber-600">⚠ {w}</p>)}
        {d.type !== "none" && (
          <Button size="sm" onClick={() => { onApply(d); setMsg("Пачка записана в «Растворы и жидкости → Вязкая пачка» и включена. Нажмите «Расчёт» для пересчёта."); }} data-testid="apply-pill">
            <ArrowRightLeft className="w-4 h-4 mr-1" />Записать в вязкую пачку
          </Button>
        )}
        {msg && <p className="text-green-600">{msg}</p>}
        <p className="text-[10px] text-muted-foreground">Свойства — ориентировочные корреляции (пресная вода, бентонит ПБМА/ПБМБ, ксантан); СНС 10 с / 10 мин обязательно подтвердить замером на фактических реагентах при BHCT. Рецептура пачки входит в протокол раствора для моста.</p>
      </CardContent>
    </Card>
  );
}
