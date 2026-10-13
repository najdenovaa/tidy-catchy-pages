import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { buildLabProgram, buildRecipe, type LabStatus } from "@/lib/cement-program";
import { fitRheology } from "@/lib/cement-rheology";
import LabProtocolPanel from "@/components/LabProtocolPanel";
import LabTargetsPanel from "@/components/LabTargetsPanel";
import type { LabTargets } from "@/lib/cement-recipe-designer";
import type { WellData, SlurryInput, BufferFluid, DrillingFluid, DisplacementFluid, PressureProfileResult, VolumeResults, Rheology } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  displacementFluids: DisplacementFluid[];
  pressure: PressureProfileResult | null;
  volumes: VolumeResults | null;
  onApplySlurries?: (slurries: SlurryInput[]) => void;
}

const STATUS: Record<LabStatus, { label: string; cls: string }> = {
  ok: { label: "✓ выполнено", cls: "text-green-600" },
  fail: { label: "✗ не проходит", cls: "text-red-600 font-medium" },
  todo: { label: "○ испытать", cls: "text-muted-foreground" },
  info: { label: "i", cls: "text-muted-foreground" },
};

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");

export default function CementLabSection({ wellData, slurries, buffers, drillingFluid, displacementFluids, pressure, volumes, onApplySlurries }: Props) {
  const lab = useMemo(() => buildLabProgram(wellData, slurries, pressure, volumes), [wellData, slurries, pressure, volumes]);
  const recipes = useMemo(
    () => slurries.map((s, i) => buildRecipe(s, volumes?.slurryVolumes.find((v) => v.name === s.name)?.slurryVolumeM3 ?? volumes?.slurryVolumes[i]?.slurryVolumeM3 ?? 0)),
    [slurries, volumes],
  );

  // Требования технолога: правятся здесь, сохраняются в растворы при записи рецептуры в программу
  const [targets, setTargets] = useState<(LabTargets | undefined)[]>(() => slurries.map((s) => s.labTargets));
  const savedKey = slurries.map((s) => JSON.stringify(s.labTargets ?? null)).join("|");
  useEffect(() => { setTargets(slurries.map((s) => s.labTargets)); }, [savedKey, slurries.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const slurriesT = useMemo(() => slurries.map((s, i) => (targets[i] === s.labTargets ? s : { ...s, labTargets: targets[i] })), [slurries, targets]);
  const protoInput = useMemo(() => ({ wellData, slurries: slurriesT, buffers, drillingFluid, pressure, volumes }), [wellData, slurriesT, buffers, drillingFluid, pressure, volumes]);

  return (
    <div className="space-y-4">
      <LabTargetsPanel
        input={protoInput}
        targets={targets}
        onTargetsChange={(i, t) => setTargets((arr) => { const n = slurries.map((_, j) => arr[j]); n[i] = t; return n; })}
        onApplySlurries={onApplySlurries}
      />
      <LabProtocolPanel input={protoInput} onApplySlurries={onApplySlurries} />
      <TemperatureCard lab={lab} />
      {lab.slurries.map((p) => (
        <Card key={p.slurryName} className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold">Программа лабораторных испытаний — {p.slurryName}</h3>
            <span className="text-xs text-muted-foreground">
              {f(p.topMD, 0)}–{f(p.bottomMD, 0)} м · работа раствора {f(p.jobTimeMin, 0)} мин · выход на BHCT {f(p.rampMin, 0)} мин
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-1.5 text-left">Испытание</th>
                  <th className="p-1.5 text-left">Условия</th>
                  <th className="p-1.5 text-left">Критерий</th>
                  <th className="p-1.5 text-left">Статус</th>
                  <th className="p-1.5 text-left">Норматив</th>
                </tr>
              </thead>
              <tbody>
                {p.tests.map((t) => (
                  <tr key={t.test} className="border-t border-border/40 align-top">
                    <td className="p-1.5 font-medium">{t.test}</td>
                    <td className="p-1.5">{t.conditions}</td>
                    <td className="p-1.5">{t.criterion}</td>
                    <td className={`p-1.5 whitespace-nowrap ${STATUS[t.status].cls}`}>{STATUS[t.status].label}{t.actual ? ` (${t.actual})` : ""}</td>
                    <td className="p-1.5 text-muted-foreground">{t.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.warnings.map((w) => <div key={w} className="text-xs text-amber-700 dark:text-amber-500">⚠ {w}</div>)}
        </Card>
      ))}

      {recipes.map((r) => (
        <Card key={r.slurryName} className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold">Рецептура по абсолютным объёмам — {r.slurryName}</h3>
            <Badge variant={Math.abs(r.densityMismatch) > 0.02 ? "destructive" : "outline"}>
              {r.wcEntered > 0 ? `при введённом В/С: ${f(r.densityAtEntered, 3)} г/см³` : "В/С не введено"} · проект {f(r.designDensity, 2)}
            </Badge>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <Kpi label="В/С для проектной плотности" value={f(r.wcForDesign, 3)} />
            <Kpi label="Выход, м³/т сухой смеси" value={f(r.yieldM3perT, 3)} sub={r.yieldEntered > 0 ? `введено ${f(r.yieldEntered, 3)}` : undefined} />
            <Kpi label="Объём раствора, м³" value={f(r.slurryVolumeM3, 2)} />
            <Kpi label="Уд. вес цемента, г/см³" value={f(r.cementSG, 2)} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="p-1.5 text-left">Компонент</th>
                  <th className="p-1.5 text-right">Уд. вес, г/см³</th>
                  <th className="p-1.5 text-right">кг на 1 м³</th>
                  <th className="p-1.5 text-right">Абс. объём, л на 1 м³</th>
                  <th className="p-1.5 text-right">На операцию</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-border/40">
                  <td className="p-1.5">Цемент</td><td className="p-1.5 text-right">{f(r.cementSG, 2)}</td>
                  <td className="p-1.5 text-right">{f(r.perM3.cementKg, 0)}</td><td className="p-1.5 text-right">{f(r.perM3.cementKg / r.cementSG, 0)}</td>
                  <td className="p-1.5 text-right">{f(r.totals.cementT, 2)} т</td>
                </tr>
                {r.perM3.additives.map((a) => (
                  <tr key={a.name} className="border-t border-border/40">
                    <td className="p-1.5">{a.name}</td>
                    <td className={`p-1.5 text-right ${a.sgSource === "default" ? "text-amber-600" : ""}`} title={a.sgSource === "library" ? "по справочнику" : a.sgSource === "default" ? "не определён — принят 1.5" : "задан"}>{f(a.sg, 2)}{a.sgSource === "default" ? "?" : ""}</td>
                    <td className="p-1.5 text-right">{f(a.kgPerM3, 1)}</td><td className="p-1.5 text-right">{f(a.litersPerM3, 1)}</td>
                    <td className="p-1.5 text-right">{f(a.totalKg, 0)} кг</td>
                  </tr>
                ))}
                <tr className="border-t border-border/40">
                  <td className="p-1.5">Вода затворения</td><td className="p-1.5 text-right">1.00</td>
                  <td className="p-1.5 text-right">{f(r.perM3.waterL, 0)}</td><td className="p-1.5 text-right">{f(r.perM3.waterL, 0)}</td>
                  <td className="p-1.5 text-right">{f(r.totals.waterM3, 2)} м³</td>
                </tr>
                <tr className="border-t border-border font-medium">
                  <td className="p-1.5">Итого</td><td />
                  <td className="p-1.5 text-right">{f(r.perM3.cementKg + r.perM3.waterL + r.perM3.additives.reduce((t, a) => t + a.kgPerM3, 0), 0)}</td>
                  <td className="p-1.5 text-right">1000</td>
                  <td className="p-1.5 text-right">смесь {f(r.totals.blendT, 2)} т</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-muted-foreground">
            С запасом 5% на затворение: сухая смесь {f(r.totals.blendWithReserveT, 2)} т, вода {f(r.totals.waterWithReserveM3, 2)} м³. В/С — к массе сухой смеси; масса 1 м³ равна проектной плотности — проверка замыкания баланса.
          </div>
          {r.warnings.map((w) => <div key={w} className="text-xs text-amber-700 dark:text-amber-500">⚠ {w}</div>)}
        </Card>
      ))}

      <FlowCurvesCard fluids={[
        { name: `Раствор: ${drillingFluid.name || "буровой"}`, r: drillingFluid.rheology },
        ...buffers.map((b) => ({ name: `Буфер: ${b.name}`, r: b.rheology })),
        ...slurries.map((s) => ({ name: `Цемент: ${s.name}`, r: s.rheology })),
        ...displacementFluids.map((d) => ({ name: `Продавка: ${d.name}`, r: d.rheology })),
      ]} />
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function TemperatureCard({ lab }: { lab: ReturnType<typeof buildLabProgram> }) {
  return (
    <Card className="p-4 space-y-2">
      <h3 className="font-semibold">Температурный режим</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Kpi label="BHCT расчётная" value={`${f(lab.bhct.bhctC, 0)} °C`} sub={lab.bhct.method} />
        <Kpi label="BHCT введённая" value={lab.bhctEnteredC > 0 ? `${f(lab.bhctEnteredC, 0)} °C` : "—"} sub={lab.bhctEnteredC > 0 ? "используется в программе" : "используется расчётная"} />
        <Kpi label="Геотермический градиент" value={`${f(lab.bhct.gradientCper100m, 2)} °C/100 м`} />
        <Kpi label="t° поверхности" value={`${f(lab.surfaceC, 0)} °C`} sub="задаётся в исходных данных" />
      </div>
      <div className="text-[11px] text-muted-foreground">
        Kutasov–Targhi: регрессия по 79 промысловым замерам (база API RP 10B), ±4.6 °C, диапазон BHST 74–212 °C, градиент 1.5–4.5 °C/100 м.
      </div>
      {lab.notes.map((n) => <div key={n} className="text-xs text-amber-700 dark:text-amber-500">⚠ {n}</div>)}
    </Card>
  );
}

function FlowCurvesCard({ fluids }: { fluids: { name: string; r: Rheology }[] }) {
  const withFann = fluids.map((x) => ({ ...x, fit: fitRheology(x.r.fann) })).filter((x) => x.fit);
  const [sel, setSel] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const upd = () => { if (el.clientWidth > 0) setWidth(el.clientWidth); };
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, [withFann.length]);
  if (withFann.length === 0) {
    return (
      <Card className="p-4 text-xs text-muted-foreground">
        <h3 className="font-semibold text-foreground text-sm mb-1">Кривые течения</h3>
        Показания вискозиметра Fann не введены. Введите их в карточках жидкостей на вкладке «Данные» — появится сравнение моделей Бингама, степенной и Гершеля–Балкли, а гидравлика станет точнее на малых расходах.
      </Card>
    );
  }
  const cur = withFann[Math.min(sel, withFann.length - 1)];
  const fit = cur.fit!;
  const gMax = Math.max(...fit.points.map((p) => p.gamma));
  const curve = Array.from({ length: 41 }, (_, i) => {
    const g = (gMax * i) / 40;
    return {
      gamma: Math.round(g),
      hb: fit.hb.tau0 + fit.hb.K * Math.pow(g, fit.hb.n),
      bingham: fit.yp600300Pa + (fit.pv600300 / 1000) * g,
    };
  });
  const hbAt = (g: number) => fit.hb.tau0 + fit.hb.K * Math.pow(g, fit.hb.n);
  const bAt = (g: number) => fit.yp600300Pa + (fit.pv600300 / 1000) * g;
  const data = [
    ...curve.map((c) => ({ ...c, measured: undefined as number | undefined })),
    ...fit.points.map((p) => ({ gamma: Math.round(p.gamma), hb: hbAt(p.gamma), bingham: bAt(p.gamma), measured: p.tau })),
  ].sort((a, b) => a.gamma - b.gamma);
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold">Кривые течения: замер и модели</h3>
        <select value={sel} onChange={(e) => setSel(Number(e.target.value))} className="h-8 text-xs rounded border border-border bg-background px-2">
          {withFann.map((x, i) => <option key={x.name} value={i}>{x.name}</option>)}
        </select>
      </div>
      <div className="h-64" ref={boxRef}>
        {(
          <ComposedChart width={width > 0 ? width : 900} height={256} data={data} margin={{ top: 4, right: 16, bottom: 16, left: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
            <XAxis dataKey="gamma" type="number" domain={[0, "dataMax"]} tick={{ fontSize: 11 }} label={{ value: "Скорость сдвига, с⁻¹", position: "insideBottom", offset: -8, fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} label={{ value: "τ, Па", angle: -90, position: "insideLeft", fontSize: 11 }} />
            <Tooltip formatter={(v: number) => (typeof v === "number" ? `${v.toFixed(1)} Па` : v)} labelFormatter={(g) => `γ = ${g} с⁻¹`} contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
            <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 11 }} />
            <Line dataKey="hb" name="Гершель–Балкли" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="bingham" name="Бингам (PV/YP по 600/300)" stroke="hsl(var(--muted-foreground))" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Scatter dataKey="measured" name="Замер Fann" fill="hsl(var(--foreground))" isAnimationActive={false} />
          </ComposedChart>
        )}
      </div>
      <div className="text-[11px] text-muted-foreground">
        R²: Гершель–Балкли {fit.hb.r2.toFixed(4)} · Бингам {fit.bingham.r2.toFixed(4)} · степенная {fit.powerLaw.r2.toFixed(4)}. На 3 об/мин Бингам ошибается на {f(fit.binghamLowShearErrorPct, 0)}% — именно эта зона определяет трение при малых расходах и вытеснение из узкой стороны зазора.
      </div>
    </Card>
  );
}
