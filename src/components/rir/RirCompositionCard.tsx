import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ReferenceDot } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FlaskConical, Printer, Download } from "lucide-react";
import { useMeasuredWidth } from "@/hooks/use-measured-width";
import type { CompositionDesign, RirCompositionResult } from "@/lib/rir-compositions";
import type { LabProtocol } from "@/lib/lab-protocol";
import { protocolToHtml } from "@/lib/lab-protocol";
import { exportLabProtocolDocx } from "@/lib/export-lab-protocol-docx";

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const tipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 };
const axisTick = { fontSize: 10, fill: "hsl(var(--muted-foreground))" };
const COLORS = ["#64748b", "#3b82f6", "#f59e0b", "#10b981", "#a855f7", "#ef4444", "#14b8a6", "#eab308", "#6366f1"];

function MiniChart({ data, xLabel, yLabel, vx, hy, dot, log, color = "hsl(var(--primary))" }: {
  data: { x: number; y: number }[]; xLabel: string; yLabel: string; vx?: { v: number; label: string }; hy?: { v: number; label: string }; dot?: { x: number; y: number }; log?: boolean; color?: string;
}) {
  const [ref, w] = useMeasuredWidth<HTMLDivElement>();
  return (
    <div ref={ref} className="h-52">
      <LineChart width={w || 300} height={208} data={data} margin={{ top: 8, right: 12, bottom: 18, left: 4 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
        <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tick={axisTick} label={{ value: xLabel, position: "insideBottom", offset: -8, fontSize: 10 }} />
        <YAxis tick={axisTick} scale={log ? "log" : "auto"} domain={log ? ["auto", "auto"] : [0, "auto"]} allowDataOverflow width={44} label={{ value: yLabel, angle: -90, position: "insideLeft", fontSize: 10 }} />
        <Tooltip contentStyle={tipStyle} />
        {vx && <ReferenceLine x={vx.v} stroke="hsl(0 72% 51%)" strokeDasharray="4 3" label={{ value: vx.label, fontSize: 9, position: "top", fill: "hsl(0 72% 51%)" }} />}
        {hy && <ReferenceLine y={hy.v} stroke="hsl(30 90% 50%)" strokeDasharray="4 3" label={{ value: hy.label, fontSize: 9, position: "insideTopRight", fill: "hsl(30 90% 45%)" }} />}
        <Line dataKey="y" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        {dot && <ReferenceDot x={dot.x} y={dot.y} r={5} fill="hsl(0 72% 51%)" stroke="white" />}
      </LineChart>
    </div>
  );
}

function MassBar({ d }: { d: CompositionDesign }) {
  const parts = [...d.components.map((c) => ({ n: c.name.split(" (")[0].split(" — ")[0], kg: c.kgPerM3 })), ...(d.waterLPerM3 > 0 ? [{ n: "Вода", kg: d.waterLPerM3 }] : [])];
  const tot = parts.reduce((t, p) => t + p.kg, 0);
  return (
    <div className="space-y-1">
      <div className="flex h-5 w-full overflow-hidden rounded">
        {parts.map((p, i) => <div key={p.n} title={`${p.n}: ${f(p.kg, 0)} кг/м³`} style={{ width: `${(p.kg / tot) * 100}%`, background: COLORS[i % COLORS.length] }} />)}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
        {parts.map((p, i) => <span key={p.n} className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />{p.n} {f((p.kg / tot) * 100, 1)}%</span>)}
      </div>
    </div>
  );
}

function DesignBlock({ d, volumeM3, bhctC, jobMin, requiredMin }: { d: CompositionDesign; volumeM3: number; bhctC: number; jobMin: number; requiredMin: number }) {
  const reserve = 1.05;
  const ok = d.props.every((p) => p.ok !== false);
  return (
    <div className="space-y-3 rounded-lg border border-border/70 p-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div><p className="font-semibold text-sm">{d.title}</p><p className="text-[11px] text-muted-foreground">{d.system} · объём {f(volumeM3, 2)} м³</p></div>
        <Badge variant={ok ? "default" : "destructive"} className="text-[10px]">{ok ? "требования выполнены (прогноз)" : "есть невыполненные требования"}</Badge>
      </div>
      <MassBar d={d} />
      <div className="grid gap-3 lg:grid-cols-2">
        <table className="w-full text-[11px]">
          <thead className="bg-muted/50"><tr><th className="p-1 text-left">Компонент</th><th className="p-1 text-right">Дозировка</th><th className="p-1 text-right">кг/м³</th><th className="p-1 text-right">На операцию (+5%)</th></tr></thead>
          <tbody>
            {d.components.map((c) => (
              <tr key={c.name} className="border-t border-border/40 align-top">
                <td className="p-1">{c.name}<div className="text-[10px] text-muted-foreground">{c.purpose}</div></td>
                <td className="p-1 text-right whitespace-nowrap">{f(c.dose, c.dose < 10 ? 2 : 0)} {c.doseUnit}</td>
                <td className="p-1 text-right">{f(c.kgPerM3, c.kgPerM3 < 10 ? 1 : 0)}</td>
                <td className="p-1 text-right whitespace-nowrap">{c.kgPerM3 * volumeM3 * reserve >= 1000 ? `${f((c.kgPerM3 * volumeM3 * reserve) / 1000, 2)} т` : `${f(c.kgPerM3 * volumeM3 * reserve, 0)} кг`}</td>
              </tr>
            ))}
            {d.waterLPerM3 > 0 && <tr className="border-t border-border/40"><td className="p-1">Вода затворения (пресная)</td><td /><td className="p-1 text-right">{d.waterLPerM3} л</td><td className="p-1 text-right">{f((d.waterLPerM3 * volumeM3 * reserve) / 1000, 2)} м³</td></tr>}
          </tbody>
        </table>
        <table className="w-full text-[11px]">
          <thead className="bg-muted/50"><tr><th className="p-1 text-left">Показатель</th><th className="p-1 text-right">Прогноз</th><th className="p-1 text-right">Требование</th><th className="w-5" /></tr></thead>
          <tbody>{d.props.map((p) => <tr key={p.label} className="border-t border-border/40"><td className="p-1">{p.label}</td><td className={`p-1 text-right ${p.ok === false ? "text-destructive font-semibold" : ""}`}>{p.value}</td><td className="p-1 text-right text-muted-foreground">{p.target ?? ""}</td><td className="p-1 text-center">{p.ok === undefined ? "" : p.ok ? "✓" : "✗"}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <p className="text-[11px] font-semibold">{d.kind === "resin" ? "Время жизни (гелеобразование)" : "Время загустевания"} от температуры</p>
          <MiniChart data={d.workLifeCurve} xLabel="Температура, °C" yLabel="мин" log vx={{ v: Math.round(bhctC), label: "BHCT" }} hy={{ v: requiredMin, label: `нужно ${requiredMin}` }} dot={{ x: Math.round(bhctC), y: Math.round(d.workLifeAtBhctMin) }} />
        </div>
        <div>
          <p className="text-[11px] font-semibold">{d.kind === "resin" ? "Вязкость при BHCT по времени" : "Консистенция при BHCT по времени"}</p>
          <MiniChart data={d.thickeningCurve} xLabel="Время, мин" yLabel={d.thickeningUnit} log={d.kind === "resin"} vx={{ v: Math.round(jobMin), label: "конец работ" }} hy={d.kind === "resin" ? undefined : { v: 70, label: "70 Вс" }} color="hsl(30 90% 50%)" />
        </div>
        <div>
          <p className="text-[11px] font-semibold">Прочность на сжатие (при BHST)</p>
          <MiniChart data={d.strengthCurve} xLabel="Время, ч" yLabel="МПа" color="hsl(142 70% 40%)" />
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div><p className="text-[11px] font-semibold mb-1">Приготовление и закачка</p><ol className="list-decimal pl-4 space-y-0.5 text-[11px]">{d.procedure.map((p) => <li key={p}>{p}</li>)}</ol></div>
        <div className="space-y-1 text-[11px]">
          {d.notes.map((n) => <p key={n} className="text-muted-foreground">ℹ {n}</p>)}
          {d.warnings.map((w) => <p key={w} className="text-amber-700 dark:text-amber-500">⚠ {w}</p>)}
        </div>
      </div>
    </div>
  );
}

export default function RirCompositionCard({ comp, totalM3, bhctC, jobMin, requiredMin, protocol }: {
  comp: RirCompositionResult | null; totalM3: number; bhctC: number; jobMin: number; requiredMin: number; protocol: () => LabProtocol | null;
}) {
  const print = () => {
    const p = protocol(); if (!p) return;
    const w = window.open("", "_blank"); if (!w) return;
    w.document.write(protocolToHtml(p)); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  };
  return (
    <Card data-testid="rir-composition">
      <CardHeader className="py-2.5 px-4">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <FlaskConical className="w-4 h-4" /> Рецептура состава для задавливания
          {comp && (
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={print}><Printer className="w-3.5 h-3.5 mr-1" />Протокол — печать</Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => { const p = protocol(); if (p) exportLabProtocolDocx(p, "Протокол_РИР.docx"); }}><Download className="w-3.5 h-3.5 mr-1" />Word</Button>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 text-xs">
        {!comp && <p className="text-muted-foreground">Для обычного тампонажного цемента рецептура подбирается в режимах «Открытый ствол / В колонне» (блок «Рецептура раствора для моста») по тем же условиям. Выберите микроцемент или смолу, если канал узкий.</p>}
        {comp && <DesignBlock d={comp.primary} volumeM3={comp.split ? comp.split.primaryM3 : totalM3} bhctC={bhctC} jobMin={jobMin} requiredMin={requiredMin} />}
        {comp?.secondary && comp.split && (
          <>
            <p className="text-[11px] text-muted-foreground">Порядок закачки: смола ({f(comp.split.primaryM3, 2)} м³) → разделительный буфер → микроцемент ({f(comp.split.secondaryM3, 2)} м³). Смола герметизирует микрозазоры, микроцемент заполняет объём канала.</p>
            <DesignBlock d={comp.secondary} volumeM3={comp.split.secondaryM3} bhctC={bhctC} jobMin={jobMin} requiredMin={requiredMin} />
          </>
        )}
        <p className="text-[10px] text-muted-foreground">Составы — ориентировочные по открытым данным (стехиометрия эпоксидных систем, типовые кривые загустевания, абсолютные объёмы). Обязательное лабораторное подтверждение на фактических материалах при BHCT: время жизни/загустевания, плотность, вязкость, прочность. Работа со смолами — по паспортам безопасности.</p>
      </CardContent>
    </Card>
  );
}
