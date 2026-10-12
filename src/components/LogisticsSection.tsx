import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { planLogistics, DEFAULT_LOGISTICS, type LogisticsSettings } from "@/lib/cement-logistics";
import type { PressureProfileResult, MaterialSummary, SlurryInput } from "@/lib/cementing-calculations";
import { useMeasuredWidth } from "@/hooks/use-measured-width";

interface Props {
  pressure: PressureProfileResult;
  materials: MaterialSummary;
  slurries: SlurryInput[];
}

const KEY = "deallsoft:cement-logistics-settings:v1";
const loadSettings = (): LogisticsSettings => {
  try { const r = localStorage.getItem(KEY); return r ? { ...DEFAULT_LOGISTICS, ...JSON.parse(r) } : DEFAULT_LOGISTICS; } catch { return DEFAULT_LOGISTICS; }
};

const f = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const hm = (min: number) => `${Math.floor(min / 60)} ч ${String(Math.round(min % 60)).padStart(2, "0")} мин`;

export default function LogisticsSection({ pressure, materials, slurries }: Props) {
  const [s, setS] = useState<LogisticsSettings>(loadSettings);
  const set = (k: keyof LogisticsSettings, v: string) => {
    const next = { ...s, [k]: typeof s[k] === "number" ? parseFloat(v) || 0 : v };
    setS(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* недоступно */ }
  };
  const r = useMemo(() => planLogistics(pressure, materials, slurries, s), [pressure, materials, slurries, s]);
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();

  const field = (k: keyof LogisticsSettings, label: string, step = "1") => (
    <label className="space-y-1 text-xs">
      <div className="text-muted-foreground">{label}</div>
      <input type={typeof s[k] === "number" ? "number" : "text"} step={step} value={String(s[k])} onChange={(e) => set(k, e.target.value)}
        className="h-8 w-full rounded border border-border bg-background px-2 text-sm" />
    </label>
  );

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Техника и логистика</h3>
        <p className="text-xs text-muted-foreground max-w-3xl">
          Число агрегатов считается по расчёту закачки: в каждый момент нужная подача делится на подачу одного агрегата при текущем
          давлении на устье (ограничение гидравлической мощности насоса). Смесительные машины — по массе сухой смеси и темпу затворения,
          автоцистерны — по объёму воды. Параметры техники можно изменить под свой парк.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {field("unitName", "Агрегат")}
          {field("unitPowerKW", "Гидр. мощность, кВт")}
          {field("unitMaxPressureMPa", "Макс. давление, МПа")}
          {field("unitMaxRateLps", "Макс. подача, л/с")}
          {field("mixerName", "Смесительная машина")}
          {field("mixerCapacityT", "Бункер, т")}
          {field("mixRatePerPairLps", "Затворение на пару, л/с")}
          {field("tankerM3", "Автоцистерна, м³")}
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <h3 className="font-semibold text-sm">Состав техники</h3>
          <table className="w-full text-xs">
            <thead className="bg-muted/50"><tr><th className="p-1.5 text-left">Техника</th><th className="p-1.5 text-right">Кол-во</th><th className="p-1.5 text-left">Обоснование</th></tr></thead>
            <tbody>{r.equipment.map((e) => (
              <tr key={e.name} className="border-t border-border/40 align-top"><td className="p-1.5 font-medium">{e.name}</td><td className="p-1.5 text-right text-base font-semibold">{e.count}</td><td className="p-1.5 text-muted-foreground">{e.note}</td></tr>
            ))}</tbody>
          </table>
          <div className="text-xs text-muted-foreground">
            Пиковая гидравлическая мощность {f(r.peakHydPowerKW)} кВт; макс. давление на устье {f(r.maxSurfaceMPa, 1)} МПа; испытание линий на {r.lineTestMPa} МПа.
          </div>
        </Card>
        <Card className="p-4 space-y-2">
          <h3 className="font-semibold text-sm">Состав бригады</h3>
          <table className="w-full text-xs">
            <tbody>{r.personnel.map((p) => (
              <tr key={p.role} className="border-t border-border/40"><td className="p-1.5">{p.role}</td><td className="p-1.5 text-right font-semibold">{p.count} чел.</td></tr>
            ))}
              <tr className="border-t border-border font-semibold"><td className="p-1.5">Итого</td><td className="p-1.5 text-right">{r.personnel.reduce((t, p) => t + p.count, 0)} чел.</td></tr>
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="p-4 space-y-2">
        <h3 className="font-semibold text-sm">Сколько агрегатов нужно в каждый момент операции</h3>
        <div ref={ref} className="h-52">
          <LineChart width={width || 900} height={208} data={r.unitsProfile} margin={{ top: 6, right: 16, bottom: 14, left: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
            <XAxis dataKey="time" type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v)}`} label={{ value: "Время, мин", position: "insideBottom", offset: -6, fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Tooltip labelFormatter={(t) => `${Math.round(Number(t))} мин`} formatter={(v: number, _n, item) => [`${v} шт. (${(item.payload as { stage: string }).stage})`, "Агрегатов"]} contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
            <Line type="stepAfter" dataKey="units" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </div>
        <div className="text-xs text-muted-foreground">
          Пик — {r.peakUnitsHydraulic} шт.: «{r.peakAt.stage}», {f(r.peakAt.time)} мин, {f(r.peakAt.rateLps)} л/с при {f(r.peakAt.pressureMPa, 1)} МПа
          (один {s.unitName} при этом давлении даёт {f(r.unitRateAt(r.peakAt.pressureMPa), 1)} л/с). Для затворения цемента нужно {r.unitsForMixing} пар «{s.mixerName} + {s.unitName}».
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <h3 className="font-semibold text-sm">График работ</h3>
        <table className="w-full text-xs">
          <thead className="bg-muted/50"><tr><th className="p-1.5 text-left">Этап</th><th className="p-1.5 text-right">Начало</th><th className="p-1.5 text-right">Длительность</th></tr></thead>
          <tbody>{r.timeline.map((t) => (
            <tr key={t.step} className="border-t border-border/40"><td className="p-1.5">{t.step}</td><td className="p-1.5 text-right">{hm(t.startMin)}</td><td className="p-1.5 text-right">{hm(t.durationMin)}</td></tr>
          ))}
            <tr className="border-t border-border font-semibold"><td className="p-1.5">Итого на скважине</td><td /><td className="p-1.5 text-right">{hm(r.timeline.reduce((a, t) => a + t.durationMin, 0))}</td></tr>
          </tbody>
        </table>
        {r.notes.map((n) => <div key={n} className="text-xs text-amber-700 dark:text-amber-500">⚠ {n}</div>)}
      </Card>
    </div>
  );
}
