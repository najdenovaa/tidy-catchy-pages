import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import { checkNorms, normsSummary, inferCasingType, CASING_TYPE_LABEL, type CasingType, type NormStatus } from "@/lib/cement-norms";
import { buildLabProgram } from "@/lib/cement-program";
import { runLossRisk, DEFAULT_RISK, type RiskResult } from "@/lib/cement-risk";
import type { WellData, SlurryInput, BufferFluid, DrillingFluid, DisplacementFluid, PressureProfileResult, VolumeResults } from "@/lib/cementing-calculations";
import { useMeasuredWidth } from "@/hooks/use-measured-width";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  displacementFluids: DisplacementFluid[];
  fractureGradient: number;
  flushTimeMin: number;
  flushVolumeM3: number;
  pressure: PressureProfileResult | null;
  volumes: VolumeResults | null;
  onCasingTypeChange: (t: CasingType) => void;
}

const ST: Record<NormStatus, { icon: string; label: string; cls: string }> = {
  ok: { icon: "✓", label: "выполнено", cls: "text-green-600" },
  fail: { icon: "✗", label: "нарушение", cls: "text-red-600 font-semibold" },
  warn: { icon: "⚠", label: "на грани", cls: "text-amber-600 font-medium" },
  manual: { icon: "○", label: "проверить", cls: "text-muted-foreground" },
  na: { icon: "—", label: "н/п", cls: "text-muted-foreground" },
};
const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const pctS = (v: number) => `${(v * 100).toFixed(v < 0.1 && v > 0 ? 1 : 0)}%`;

export default function NormsRiskSection(props: Props) {
  const { wellData, slurries, buffers, drillingFluid, pressure, volumes } = props;
  const casingType = wellData.casingType ?? inferCasingType(wellData);
  const lab = useMemo(() => buildLabProgram(wellData, slurries, pressure, volumes), [wellData, slurries, pressure, volumes]);
  const checks = useMemo(
    () => checkNorms({ wellData, slurries, buffers, drillingFluid, pressure, lab, casingType, hasSkc: true }),
    [wellData, slurries, buffers, drillingFluid, pressure, lab, casingType],
  );
  const sum = normsSummary(checks);

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold">Проверка программы по ПБ НГП и рекомендациям</h3>
            <p className="text-xs text-muted-foreground max-w-3xl">
              «Норма ПБ» — требование Правил безопасности в нефтяной и газовой промышленности (ФНП № 534, раздел о креплении скважин;
              формулировки совпадают с РД 08-200-98 п. 2.6). «По аналогии» — норма для бурового раствора, применённая к затрубью при цементировании.
              «Рекомендация» — отраслевая практика и API. Номера пунктов действующей редакции сверяйте по своему экземпляру Правил.
            </p>
          </div>
          <label className="text-xs space-y-1">
            <div className="text-muted-foreground">Тип колонны</div>
            <select value={casingType} onChange={(e) => props.onCasingTypeChange(e.target.value as CasingType)} className="h-8 rounded border border-border bg-background px-2 text-sm">
              {Object.entries(CASING_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>
        <div className="flex gap-2 flex-wrap text-xs">
          <Badge variant={sum.fail ? "destructive" : "outline"}>✗ нарушений: {sum.fail}</Badge>
          <Badge variant="outline" className="text-amber-700 border-amber-300">⚠ на грани: {sum.warn}</Badge>
          <Badge variant="outline" className="text-green-700 border-green-300">✓ выполнено: {sum.ok}</Badge>
          <Badge variant="outline">○ проверить вручную: {sum.manual}</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-1.5 text-left">Требование</th>
                <th className="p-1.5 text-left">Норматив</th>
                <th className="p-1.5 text-left">По программе</th>
                <th className="p-1.5 text-left">Статус</th>
                <th className="p-1.5 text-left">Тип / источник</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.id} className="border-t border-border/40 align-top">
                  <td className="p-1.5 font-medium">{c.title}</td>
                  <td className="p-1.5">{c.requirement}</td>
                  <td className="p-1.5">{c.actual}</td>
                  <td className={`p-1.5 whitespace-nowrap ${ST[c.status].cls}`}>{ST[c.status].icon} {ST[c.status].label}</td>
                  <td className="p-1.5 text-muted-foreground"><span className="font-medium text-foreground">{c.kind}</span><br />{c.reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <RiskCard {...props} />
    </div>
  );
}

function RiskCard(props: Props) {
  const [iter, setIter] = useState(DEFAULT_RISK.iterations);
  const [fracSigma, setFracSigma] = useState(DEFAULT_RISK.fracSigma * 100);
  const [cavSigma, setCavSigma] = useState(DEFAULT_RISK.cavernSigma * 100);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [res, setRes] = useState<RiskResult | null>(null);
  const sync = (fn: () => void) => { try { flushSync(fn); } catch { fn(); } };

  const run = async () => {
    sync(() => { setRunning(true); setProgress(0); });
    let last = -1;
    try {
      const r = await runLossRisk(
        {
          wellData: props.wellData, drillingFluid: props.drillingFluid, buffers: props.buffers, slurries: props.slurries,
          displacementFluids: props.displacementFluids, fractureGradient: props.fractureGradient, flushTimeMin: props.flushTimeMin, flushVolumeM3: props.flushVolumeM3,
        },
        { ...DEFAULT_RISK, iterations: Math.max(20, Math.min(1000, iter)), fracSigma: fracSigma / 100, cavernSigma: cavSigma / 100 },
        (d, t) => { const p = Math.round((d / t) * 100); if (p !== last) { last = p; sync(() => setProgress(p)); } },
      );
      sync(() => setRes(r));
    } finally { sync(() => setRunning(false)); }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold">Вероятность поглощения (Монте-Карло)</h3>
          <p className="text-xs text-muted-foreground max-w-3xl">
            Расчёт повторяется сотни раз с разбросом исходных данных: градиенты ГРП/поглощения и пластового давления, кавернозность,
            реология, плотность цемента, центрирование, расход. Каждая реализация — полная симуляция закачки. Ответ: вероятность
            поглощения, распределение запаса и что сильнее всего влияет. Результат воспроизводим (фиксированное зерно генератора).
          </p>
        </div>
        <Button onClick={run} disabled={running}>{running ? `Считаю… ${progress}%` : "Рассчитать риск"}</Button>
      </div>
      <div className="grid grid-cols-3 gap-3 max-w-xl text-xs">
        <label className="space-y-1"><div className="text-muted-foreground">Реализаций</div><input type="number" className="h-8 w-full rounded border border-border bg-background px-2 text-sm" value={iter} onChange={(e) => setIter(parseInt(e.target.value) || 200)} /></label>
        <label className="space-y-1"><div className="text-muted-foreground">σ градиента ГРП, %</div><input type="number" step="0.5" className="h-8 w-full rounded border border-border bg-background px-2 text-sm" value={fracSigma} onChange={(e) => setFracSigma(parseFloat(e.target.value) || 0)} /></label>
        <label className="space-y-1"><div className="text-muted-foreground">σ кавернозности, %</div><input type="number" step="0.5" className="h-8 w-full rounded border border-border bg-background px-2 text-sm" value={cavSigma} onChange={(e) => setCavSigma(parseFloat(e.target.value) || 0)} /></label>
      </div>
      {running && <Progress value={progress} className="h-2" />}
      {res && <RiskResultView r={res} />}
    </Card>
  );
}

function RiskResultView({ r }: { r: RiskResult }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const bins = useMemo(() => {
    const xs = r.marginSamples;
    const lo = Math.floor(Math.min(...xs, 0) * 2) / 2, hi = Math.ceil(Math.max(...xs, 0.5) * 2) / 2;
    const step = Math.max(0.25, Math.ceil(((hi - lo) / 16) * 4) / 4);
    const out: { x: string; mid: number; n: number }[] = [];
    for (let a = lo; a < hi - 1e-9; a += step) out.push({ x: `${a.toFixed(2)}…${(a + step).toFixed(2)}`, mid: a + step / 2, n: xs.filter((v) => v >= a && v < a + step).length });
    return out;
  }, [r]);
  const level = r.pLoss >= 0.2 ? { t: "Высокий риск", c: "text-red-600" } : r.pLoss >= 0.05 ? { t: "Умеренный риск", c: "text-amber-600" } : { t: "Низкий риск", c: "text-green-600" };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Tile label="Вероятность поглощения" value={pctS(r.pLoss)} sub={level.t} subCls={level.c} />
        <Tile label="Запас до ГРП: P10 / P50 / P90" value={`${f(r.margin.p10, 2)} / ${f(r.margin.p50, 2)} / ${f(r.margin.p90, 2)} МПа`} sub={`расчёт без разброса: ${f(r.deterministicMargin, 2)} МПа`} />
        <Tile label="Вероятность проявления" value={pctS(r.pUnderbalance)} sub="давление ниже пластового" />
        <Tile label="Верх цемента: P10 / P50 / P90" value={`${f(r.toc.p10, 0)} / ${f(r.toc.p50, 0)} / ${f(r.toc.p90, 0)} м`}
          sub={r.toc.pBelowRequired !== null ? `ниже нормы (кровля − 150 м = ${f(r.toc.requiredMax ?? 0, 0)} м): ${pctS(r.toc.pBelowRequired)}` : `план ${f(r.toc.planned, 0)} м`} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-medium mb-1">Распределение минимального запаса до ГРП/поглощения, МПа</div>
          <div ref={ref} className="h-56">
            <BarChart width={width || 480} height={224} data={bins} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} vertical={false} />
              <XAxis dataKey="x" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip formatter={(v: number) => [`${v} реализаций`, "Число"]} contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
              <Bar dataKey="n" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {bins.map((b) => <Cell key={b.x} fill={b.mid < 0 ? "hsl(var(--destructive))" : "hsl(var(--primary))"} />)}
              </Bar>
            </BarChart>
          </div>
          <div className="text-[11px] text-muted-foreground">Красное — реализации с поглощением (запас &lt; 0).</div>
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-xs font-medium mb-1">Что сильнее всего влияет на запас</div>
            {r.sensitivity.map((s) => (
              <div key={s.factor} className="flex items-center gap-2 text-xs py-0.5">
                <div className="w-44 shrink-0">{s.factor}</div>
                <div className="flex-1 h-2.5 bg-muted rounded overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.abs(s.corr) * 100)}%` }} /></div>
                <div className="w-20 text-right tabular-nums">{s.corr >= 0 ? "+" : "−"}{Math.abs(s.corr).toFixed(2)}</div>
              </div>
            ))}
            <div className="text-[11px] text-muted-foreground mt-1">Коэффициент корреляции фактора с запасом: чем длиннее полоса, тем важнее уточнить этот параметр (например, замером ГРП или кавернометрией).</div>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-muted/50"><tr><th className="p-1 text-left">Точка</th><th className="p-1 text-right">P(поглощ.)</th><th className="p-1 text-right">P10 запаса</th><th className="p-1 text-right">P50</th></tr></thead>
            <tbody>{r.zones.map((z) => (
              <tr key={z.name} className="border-t border-border/40"><td className="p-1">{z.name}</td><td className={`p-1 text-right ${z.pLoss > 0.05 ? "text-red-600 font-medium" : ""}`}>{pctS(z.pLoss)}</td><td className="p-1 text-right">{f(z.p10, 2)}</td><td className="p-1 text-right">{f(z.p50, 2)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, subCls }: { label: string; value: string; sub?: string; subCls?: string }) {
  return (
    <div className="rounded-md border border-border/60 p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
      {sub && <div className={`text-[10px] ${subCls ?? "text-muted-foreground"}`}>{sub}</div>}
    </div>
  );
}
