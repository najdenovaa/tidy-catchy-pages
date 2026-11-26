import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, ComposedChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Input } from "@/components/ui/input";
import type { CementingSnapshot } from "@/lib/cementing-normalizers";
import { displacementPlanStages, displacementStageLimit, type DisplacementLimitPoint } from "@/lib/displacement-plan-chart";

const labels = {
  plan: "Заданный расход",
  formation: "Расчётный предел по ГРП и поглощению",
  reserve: "Предел с коэффициентом запаса",
  equipment: "Лимит агрегатов",
  above: "Расход выше показанного предела",
};

const format = (value: number, precision = 2) => value.toLocaleString("ru-RU", { maximumFractionDigits: precision });
const colors = { plan: "#6689db", formation: "#0d7766", reserve: "#278e7d", equipment: "#b57119", above: "#c33e4e" };
type Reply = { curve: DisplacementLimitPoint[]; error?: never } | { error: string; curve?: never };

export default function DisplacementPlanChart({ input, volumeM3 }: { input: CementingSnapshot; volumeM3: number }) {
  const [reserve, setReserve] = useState("");
  const [equipment, setEquipment] = useState("");
  const [result, setResult] = useState<{ input: CementingSnapshot; volumeM3: number; reply: Reply }>();
  const stages = useMemo(() => displacementPlanStages(input.displacementFluids, volumeM3), [input.displacementFluids, volumeM3]);
  const well = input.wellData;
  const ready = stages.length > 0 && stages.every(stage => Number.isFinite(stage.rateLps) && stage.rateLps > 0)
    && input.drillingFluid.density > 0 && input.fractureGradient > 0
    && well.ckodDepth > 0 && well.ckodDepth <= well.casingDepthMD && well.casingOD > 2 * well.casingWall
    && well.casingWall > 0 && well.holeDiameter > 0;

  useEffect(() => {
    if (!ready) return;
    let worker: Worker | undefined;
    let cancelled = false;
    const finish = (reply: Reply) => {
      worker?.terminate();
      if (!cancelled) setResult({ input, volumeM3, reply });
    };
    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(new URL("../workers/displacementPlan.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<Reply>) => finish(event.data);
        worker.onerror = () => finish({ error: "Не удалось рассчитать предел расхода." });
        worker.postMessage({ input, volumeM3 });
      } catch {
        finish({ error: "Не удалось запустить расчёт предела расхода." });
      }
    }, 500);
    return () => { cancelled = true; window.clearTimeout(timer); worker?.terminate(); };
  }, [input, volumeM3, ready]);

  const current = ready && result?.input === input && result.volumeM3 === volumeM3 ? result.reply : undefined;
  const curve = current?.curve ?? [];
  const factor = Number(reserve);
  const cap = Number(equipment);
  const showReserve = factor > 0 && factor <= 1;
  const capLps = Number.isFinite(cap) && cap > 0 ? cap : undefined;
  const plotted = stages.map(stage => {
    const limit = displacementStageLimit(stage, curve, showReserve ? factor : 1, capLps);
    return { ...stage, limit, exceeds: limit !== null && stage.rateLps > limit + 1e-8 };
  });
  const chartData = curve.length
    ? curve.map(point => ({ ...point, withReserve: showReserve ? point.rateLps * factor : undefined }))
    : stages.flatMap(stage => [{ volumeM3: stage.fromM3 }, { volumeM3: stage.toM3 }]);
  const modelEnd = curve.at(-1)?.volumeM3;
  const endMin = stages.at(-1)?.endMin;
  const maxRate = Math.max(1, capLps ?? 0, ...stages.map(stage => stage.rateLps), ...curve.map(point => point.rateLps));
  const exceeded = plotted.filter(stage => stage.exceeds).length;

  return (
    <section aria-label="План безопасной продавки" className="rounded-lg border border-border bg-card p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-sm">План безопасной продавки</h3>
        {endMin != null && <span className="text-xs tabular-nums text-muted-foreground">{format(volumeM3)} м³ · {format(endMin, 1)} мин по плану</span>}
      </div>
      {stages.length === 0 ? (
        <p className="text-xs text-muted-foreground">Задайте геометрию до ЦКОД и добавьте порцию продавочной жидкости.</p>
      ) : (
        <>
          <div className="grid gap-2 sm:max-w-lg sm:grid-cols-2">
            <label className="text-xs text-muted-foreground">Коэффициент запаса по расходу
              <Input type="number" step="0.01" min="0.01" max="1" value={reserve} placeholder="Не задан" aria-invalid={reserve !== "" && !showReserve} onChange={event => setReserve(event.target.value)} className="mt-1 h-8" />
            </label>
            <label className="text-xs text-muted-foreground">Лимит агрегатов, л/с
              <Input type="number" step="0.1" min="0.1" value={equipment} placeholder="Не задан" aria-invalid={equipment !== "" && capLps === undefined} onChange={event => setEquipment(event.target.value)} className="mt-1 h-8" />
            </label>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span><b style={{ color: colors.plan }}>■</b> {labels.plan}</span>
            {curve.length > 0 && <span><b style={{ color: colors.formation }}>━</b> {labels.formation}</span>}
            {curve.length > 0 && showReserve && <span><b style={{ color: colors.reserve }}>┄</b> {labels.reserve}</span>}
            {capLps !== undefined && <span><b style={{ color: colors.equipment }}>┄</b> {labels.equipment}</span>}
            {exceeded > 0 && <span><b style={{ color: colors.above }}>■</b> {labels.above}</span>}
          </div>
          <div className="h-[240px] min-w-0 sm:h-[285px]" data-testid="displacement-plan-plot">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 4" className="stroke-border" />
                <XAxis type="number" dataKey="volumeM3" domain={[0, volumeM3]} allowDataOverflow tickFormatter={value => format(value, 1)} tick={{ fontSize: 10 }} label={{ value: "Объём продавки, м³", position: "insideBottom", offset: -12, fontSize: 11 }} />
                <YAxis type="number" domain={[0, Math.ceil(maxRate * 1.1)]} width={44} tick={{ fontSize: 10 }} label={{ value: "л/с", angle: -90, position: "insideLeft", fontSize: 11 }} />
                {plotted.map(stage => <ReferenceArea key={stage.key} x1={stage.fromM3} x2={stage.toM3} y1={0} y2={Math.max(0, stage.rateLps)} fill={stage.exceeds ? colors.above : colors.plan} stroke={stage.exceeds ? colors.above : colors.plan} fillOpacity={0.19} strokeOpacity={0.75}
                  label={stage.endMin != null && stage.rateLps > maxRate * .13 && stage.toM3 - stage.fromM3 >= volumeM3 * .19
                    ? { value: `${format(stage.endMin, 1)} мин`, position: "insideTop", offset: 7, fontSize: 10, fill: "hsl(var(--foreground))" }
                    : undefined} />)}
                {capLps !== undefined && <ReferenceLine y={capLps} stroke={colors.equipment} strokeDasharray="5 4" strokeWidth={2} />}
                {modelEnd !== undefined && modelEnd < volumeM3 - 0.01 && <ReferenceLine x={modelEnd} className="stroke-muted-foreground" strokeDasharray="3 4" />}
                <Line dataKey="rateLps" type="linear" name={labels.formation} stroke={colors.formation} dot={curve.length === 1} strokeWidth={2.5} isAnimationActive={false} />
                {showReserve && <Line dataKey="withReserve" type="linear" name={labels.reserve} stroke={colors.reserve} strokeDasharray="6 4" dot={curve.length === 1} strokeWidth={2} isAnimationActive={false} />}
                <Tooltip filterNull={false} labelFormatter={value => `${format(Number(value))} м³ продавки`}
                  formatter={(value: number | undefined, name: string) => value == null ? ["—", name] : [`${format(value)} л/с`, name]}
                  contentStyle={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))", fontSize: 12 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p role="status" className="text-xs text-muted-foreground">
            {current?.error ?? (current?.curve?.length
              ? "Предел по пласту рассчитан в диапазоне до 50 л/с. Лимит агрегатов берётся из введённого значения."
              : ready ? "Обновляем расчётный предел…" : "Для расчёта предела задайте геометрию, плотность бурового раствора, градиент ГРП и расходы.") }
          </p>
          {modelEnd !== undefined && modelEnd < volumeM3 - 0.01 && <p className="text-xs text-muted-foreground">Гидравлика рассчитана до {format(modelEnd)} м³. Дальше показан только заданный план.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums whitespace-nowrap">
              <thead className="text-left text-muted-foreground"><tr><th className="pr-3 py-1.5">Режим</th><th className="pr-3">Объём, м³</th><th className="pr-3">Расход, л/с</th><th className="pr-3">К концу, мин</th><th>Мин. предел*, л/с</th></tr></thead>
              <tbody>
                {plotted.map((stage, index) => <tr key={stage.key} className="border-t border-border/70">
                  <td className="pr-3 py-1.5">{index + 1}. {stage.name || "Продавка"}</td>
                  <td className="pr-3">{format(stage.fromM3)}–{format(stage.toM3)}</td>
                  <td className={`pr-3 ${stage.exceeds ? "text-destructive font-semibold" : ""}`}>{stage.rateLps > 0 ? format(stage.rateLps) : "Не задан"}{stage.exceeds && <span className="sr-only"> {labels.above}</span>}</td>
                  <td className="pr-3">{stage.endMin === null ? "—" : format(stage.endMin, 1)}</td>
                  <td>{stage.limit === null ? "—" : format(stage.limit)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">* По доступным точкам модели и заданным ограничениям. Время накоплено от начала продавки.</p>
        </>
      )}
    </section>
  );
}
