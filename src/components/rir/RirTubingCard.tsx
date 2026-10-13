import { useEffect, useState } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, LineChart, Line, Legend, ReferenceArea, LabelList } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ruler } from "lucide-react";
import { useMeasuredWidth } from "@/hooks/use-measured-width";
import { PACKER_MODE_LABEL, type PackerMode, type TubingMechInputs, type TubingMechResult } from "@/lib/rir-tubing";

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const tipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 };
const axisTick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

function Num({ label, unit, value, onChange }: { label: string; unit?: string; value: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return (
    <label className="flex flex-col gap-0.5 text-[11px]">
      <span className="text-muted-foreground">{label}{unit ? `, ${unit}` : ""}</span>
      <input inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { const v = parseFloat(draft.replace(",", ".")); if (Number.isFinite(v)) onChange(v); else setDraft(String(value)); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="h-8 rounded border border-border bg-background px-2 text-xs" />
    </label>
  );
}

/** Вклад эффектов Лубинского в изменение длины НКТ. */
function EffectsChart({ r }: { r: TubingMechResult }) {
  const [ref, w] = useMeasuredWidth<HTMLDivElement>();
  const data = [...r.effects.map((e) => ({ name: e.name.split(" (")[0], v: Math.round(e.dLmm) })), { name: "ИТОГО", v: Math.round(r.totalDLmm) }];
  return (
    <div ref={ref} className="h-56">
      <BarChart layout="vertical" width={w || 480} height={224} data={data} margin={{ top: 6, right: 40, bottom: 18, left: 8 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} horizontal={false} />
        <XAxis type="number" tick={axisTick} label={{ value: "ΔL, мм  (− укорочение / + удлинение)", position: "insideBottom", offset: -8, fontSize: 11 }} />
        <YAxis type="category" dataKey="name" width={118} tick={axisTick} />
        <Tooltip contentStyle={tipStyle} formatter={(v: number) => `${v} мм`} />
        <ReferenceLine x={0} stroke="hsl(var(--foreground))" />
        <Bar dataKey="v" isAnimationActive={false} radius={3}>
          {data.map((d, i) => <Cell key={i} fill={d.name === "ИТОГО" ? "hsl(var(--primary))" : d.v < 0 ? "hsl(0 72% 55%)" : "hsl(142 60% 45%)"} />)}
          <LabelList dataKey="v" position="right" style={{ fontSize: 10, fill: "hsl(var(--foreground))" }} />
        </Bar>
      </BarChart>
    </div>
  );
}

/** Осевая сила по глубине: посадка и конец задавливания, зона спирального изгиба. */
function ForceChart({ r }: { r: TubingMechResult }) {
  const [ref, w] = useMeasuredWidth<HTMLDivElement>();
  const L = r.lengthM;
  return (
    <div ref={ref} className="h-64">
      <LineChart layout="vertical" width={w || 480} height={256} data={r.forceProfile} margin={{ top: 6, right: 16, bottom: 18, left: 8 }}>
        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} />
        <XAxis type="number" tick={axisTick} label={{ value: "Осевая сила, кН (+ растяжение)", position: "insideBottom", offset: -8, fontSize: 11 }} />
        <YAxis type="number" dataKey="md" tick={axisTick} domain={[0, L]} label={{ value: "Глубина, м", angle: -90, position: "insideLeft", fontSize: 11 }} />
        <Tooltip contentStyle={tipStyle} formatter={(v: number) => `${v} кН`} labelFormatter={(m) => `${m} м`} />
        <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine x={0} stroke="hsl(var(--foreground))" strokeDasharray="3 3" />
        {r.buckling.buckled && <ReferenceArea y1={Math.max(0, L - r.buckling.neutralPointM)} y2={L} fill="hsl(30 90% 50%)" fillOpacity={0.15} label={{ value: "спиральный изгиб", fontSize: 10, position: "insideTopLeft" }} />}
        <Line dataKey="initialKN" name="После посадки" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 3" dot={false} isAnimationActive={false} />
        <Line dataKey="squeezeKN" name="Конец задавливания" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </div>
  );
}

/** Картинка: стингер в ретейнере / НКТ в пакере, силы и ход стингера. */
function StingerPicture({ r, m }: { r: TubingMechResult; m: TubingMechInputs }) {
  const W = 300, H = 230;
  const travel = Math.max(1, m.sealTravelMm);
  const used = m.mode === "free" ? Math.min(1.2, r.stingerUpMm / travel) : 0;
  const shift = Math.min(60, used * 50);
  const bad = r.stingerUnseats || r.verdict === "bad";
  const arrow = (x: number, y1: number, y2: number, cls: string, label: string, side: "l" | "r") => (
    <g>
      <line x1={x} x2={x} y1={y1} y2={y2} className={cls} strokeWidth={3} markerEnd="url(#mech-arr)" />
      <text x={side === "l" ? x - 6 : x + 6} y={(y1 + y2) / 2} textAnchor={side === "l" ? "end" : "start"} fontSize={10} className="fill-foreground">{label}</text>
    </g>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[320px] h-auto" role="img" aria-label="Стингер в ретейнере">
      <defs><marker id="mech-arr" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" className="fill-foreground" /></marker></defs>
      {/* колонна */}
      <rect x={95} y={10} width={110} height={200} className="fill-sky-100/50 dark:fill-sky-950/40" />
      <line x1={95} x2={95} y1={10} y2={210} className="stroke-slate-700 dark:stroke-slate-300" strokeWidth={3} />
      <line x1={205} x2={205} y1={10} y2={210} className="stroke-slate-700 dark:stroke-slate-300" strokeWidth={3} />
      {/* ретейнер / пакер */}
      <rect x={98} y={150} width={104} height={26} className="fill-slate-800 dark:fill-slate-200" rx={2} />
      <rect x={135} y={142} width={30} height={42} className="fill-slate-500" />
      {/* зона уплотнения (допустимый ход) */}
      <rect x={135} y={142} width={30} height={42} fill="none" className="stroke-green-500" strokeWidth={1.5} strokeDasharray="3 2" />
      {/* НКТ + стингер (смещается вверх на ход) */}
      <g transform={`translate(0, ${-shift})`}>
        <rect x={138} y={10} width={24} height={150} className={bad ? "fill-red-400/70" : "fill-slate-400"} />
        <rect x={140} y={150} width={20} height={30} className={bad ? "fill-red-500" : "fill-amber-500"} />
      </g>
      {m.mode === "anchored" && <g><line x1={132} x2={168} y1={150} y2={150} className="stroke-amber-400" strokeWidth={3} /><text x={170} y={148} fontSize={9} className="fill-amber-600">якорь</text></g>}
      {arrow(122, 120, 80, "stroke-red-500", "поршень, раздутие", "l")}
      {r.effects.find((e) => e.key === "temp")!.dLmm < 0 && arrow(178, 120, 80, "stroke-sky-500", "охлаждение", "r")}
      {m.setDownKN > 0 && arrow(150, 30, 60, "stroke-green-600", `разгрузка ${m.setDownKN} кН`, "r")}
      <text x={W / 2} y={H - 4} textAnchor="middle" fontSize={10.5} fontWeight={600} className={bad ? "fill-red-600" : "fill-green-600"}>
        {m.mode === "free" ? (r.stingerUnseats ? `стингер выходит: ${f(r.stingerUpMm, 0)} мм > ${travel} мм` : `ход стингера ${f(r.stingerUpMm, 0)} из ${travel} мм`) : `на пакер ${f(r.packerForceKN, 0)} кН`}
      </text>
    </svg>
  );
}

export default function RirTubingCard({ r, m, onChange }: { r: TubingMechResult; m: TubingMechInputs; onChange: (p: Partial<TubingMechInputs>) => void }) {
  return (
    <Card className={r.verdict === "bad" ? "border-2 border-destructive/60" : r.verdict === "warn" ? "border-2 border-amber-500/50" : ""} data-testid="rir-tubing">
      <CardHeader className="py-2.5 px-4">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Ruler className="w-4 h-4" /> НКТ и пакер при задавливании (Лубинский)
          <Badge variant={r.verdict === "bad" ? "destructive" : r.verdict === "warn" ? "secondary" : "default"} className="text-[10px]">
            {r.verdict === "bad" ? "не проходит" : r.verdict === "warn" ? "с замечаниями" : "проходит"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3 text-xs">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <label className="flex flex-col gap-0.5 text-[11px] col-span-2">
            <span className="text-muted-foreground">Крепление НКТ</span>
            <select value={m.mode} onChange={(e) => onChange({ mode: e.target.value as PackerMode })} className="h-8 rounded border border-border bg-background px-2 text-xs">
              {Object.entries(PACKER_MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <Num label="Разгрузка на ретейнер" unit="кН" value={m.setDownKN} onChange={(v) => onChange({ setDownKN: v })} />
          <Num label="∅ уплотнения стингера" unit="мм" value={m.sealBoreMm} onChange={(v) => onChange({ sealBoreMm: v })} />
          <Num label="Допустимый ход стингера" unit="мм" value={m.sealTravelMm} onChange={(v) => onChange({ sealTravelMm: v })} />
          <Num label="t° закачки на устье" unit="°C" value={m.injectionTempC} onChange={(v) => onChange({ injectionTempC: v })} />
          <Num label="Продавка в НКТ" unit="г/см³" value={m.displacementDensity} onChange={(v) => onChange({ displacementDensity: v })} />
          <Num label="Допустимо на пакер" unit="кН" value={m.packerLoadRatingKN} onChange={(v) => onChange({ packerLoadRatingKN: v })} />
          <Num label="Страгивающая резьбы" unit="кН (0 — 0,8 тела)" value={m.jointStrengthKN} onChange={(v) => onChange({ jointStrengthKN: v })} />
          <Num label="Кз по Мизесу" value={m.sfVme} onChange={(v) => onChange({ sfVme: v })} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {[
            ["ΔL НКТ", `${f(r.totalDLmm, 0)} мм`, r.totalDLmm < 0 ? "укорочение" : "удлинение"],
            [m.mode === "free" ? "Ход стингера вверх" : "Усилие на пакер", m.mode === "free" ? `${f(r.stingerUpMm, 0)} мм` : `${f(r.packerForceKN, 0)} кН`, m.mode === "free" ? `допустимо ${m.sealTravelMm} мм` : `допустимо ${m.packerLoadRatingKN} кН`],
            ["Вес на крюке", `${f(r.hookLoad.initialKN, 0)} → ${f(r.hookLoad.squeezeKN, 0)} кН`, `предел резьбы ${f(r.tensionLimitKN, 0)} кН`],
            ["Запас по Мизесу", f(r.vme.minSF, 2), `требуется ≥ ${r.vme.allowSF}`],
            ["Спиральный изгиб", r.buckling.buckled ? `${f(r.buckling.neutralPointM, 0)} м` : "нет", r.buckling.buckled ? `Fф ${f(r.buckling.fictitiousKN, 0)} кН` : ""],
          ].map(([a, b, c]) => (
            <div key={a} className="rounded-lg border border-border p-2"><div className="text-[11px] text-muted-foreground">{a}</div><div className="text-base font-semibold leading-tight">{b}</div><div className="text-[10px] text-muted-foreground">{c}</div></div>
          ))}
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1fr)] items-start">
          <div className="flex justify-center"><StingerPicture r={r} m={m} /></div>
          <div><p className="font-semibold mb-1">Вклад эффектов в длину НКТ</p><EffectsChart r={r} /></div>
          <div><p className="font-semibold mb-1">Осевая сила по глубине</p><ForceChart r={r} /></div>
        </div>
        <table className="w-full text-[11px]">
          <thead className="bg-muted/50"><tr><th className="p-1 text-left">Эффект</th><th className="p-1 text-right">ΔL, мм</th><th className="p-1 text-right">Сила, кН</th><th className="p-1 text-left">Пояснение</th></tr></thead>
          <tbody>{r.effects.map((e) => <tr key={e.key} className="border-t border-border/40"><td className="p-1">{e.name}</td><td className="p-1 text-right">{f(e.dLmm, 0)}</td><td className="p-1 text-right">{f(e.forceKN, 1)}</td><td className="p-1 text-muted-foreground">{e.note}</td></tr>)}</tbody>
        </table>
        <div className="rounded-md bg-muted/40 p-2 space-y-1">
          {r.conclusions.map((c) => <p key={c}>• {c}</p>)}
          {r.setDownNeededKN !== null && <p className="font-semibold">→ Нужная разгрузка на ретейнер: ≥ {r.setDownNeededKN} кН.</p>}
          {r.backPressureNeededMPa !== null && <p className="font-semibold">→ Или противодавление в затрубье при задавливании: {f(r.backPressureNeededMPa, 1)} МПа.</p>}
        </div>
        {r.warnings.map((w) => <p key={w} className="text-amber-700 dark:text-amber-500">⚠ {w}</p>)}
        <p className="text-[10px] text-muted-foreground">Расчёт на конец задавливания при допустимом давлении на устье (худший случай). Lubinski et al., JPT 1962; Hammerlindl, JPT 1977; прочность — трёхосное напряжение по Мизесу (Ламе). Трение НКТ о колонну и изгиб в наклонном стволе не учитываются.</p>
      </CardContent>
    </Card>
  );
}
