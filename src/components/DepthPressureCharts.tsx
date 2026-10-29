import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from "recharts";
import type { DepthEnvelopePoint, ReservoirLayer } from "@/lib/cementing-calculations";
import CopyImageButton from "./CopyImageButton";

type Unit = "MPa" | "kgf";
const UNIT: Record<Unit, { k: number; label: string; dec: number }> = { MPa: { k: 1, label: "МПа", dec: 1 }, kgf: { k: 10.197, label: "кгс/см²", dec: 0 } };
const C = { max: "#dc2626", min: "#16a34a", hydro: "#2563eb", pore: "#fde68a", poreLine: "#ca8a04", fracBand: "#cbd5e1", frac: "#94a3b8" };

interface Props {
  envelope: DepthEnvelopePoint[];
  prevShoeMD: number;
  casingDepthMD: number;
  layers?: ReservoirLayer[];
  /** коэффициент безопасности к давлению ГРП (допустимое = k·P_ГРП) */
  safety?: number;
}

const tooltipStyle = { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" };

/** Давление и ЭЦП в затрубье по глубине за всю операцию — огибающие, пластовое давление и ГРП (как в зарубежных программах). */
export default function DepthPressureCharts({ envelope, prevShoeMD, casingDepthMD, layers = [], safety = 0.95 }: Props) {
  const [unit, setUnit] = useState<Unit>("MPa");
  const refP = useRef<HTMLDivElement>(null), refE = useRef<HTMLDivElement>(null);
  const u = UNIT[unit];

  const pData = useMemo(() => {
    const xMaxRaw = Math.max(...envelope.map((e) => Math.max(e.maxPressureMPa, e.fracPressureMPa ?? 0))) * u.k;
    const step = unit === "MPa" ? 5 : 50;
    const xMax = Math.ceil((xMaxRaw * 1.08) / step) * step;
    return {
      xMax,
      rows: envelope.map((e) => {
        const fr = e.fracPressureMPa !== null ? e.fracPressureMPa * u.k : null;
        return {
          md: Math.round(e.md), tvd: Math.round(e.tvd),
          max: e.maxPressureMPa * u.k, min: e.minPressureMPa * u.k, hydro: e.minHydrostaticMPa * u.k, woc: e.wocHydrostaticMPa * u.k,
          pore: e.porePressureMPa !== null ? e.porePressureMPa * u.k : null,
          fBase: fr !== null ? fr * safety : null, fBand: fr !== null ? fr * (1 - safety) : null, fZone: fr !== null ? Math.max(0, xMax - fr) : null,
          frac: fr, stage: e.maxAtStage,
        };
      }),
    };
  }, [envelope, u.k, unit, safety]);

  const eData = useMemo(() => {
    const ecd = (p: number | null, tvd: number) => (p !== null && tvd > 50 ? p / (0.00981 * tvd) : null);
    const rows = envelope.filter((e) => e.tvd > 50).map((e) => {
      const fr = ecd(e.fracPressureMPa, e.tvd);
      return { md: Math.round(e.md), tvd: Math.round(e.tvd), max: ecd(e.maxPressureMPa, e.tvd), min: ecd(e.minPressureMPa, e.tvd), hydro: ecd(e.minHydrostaticMPa, e.tvd), woc: ecd(e.wocHydrostaticMPa, e.tvd), pore: ecd(e.porePressureMPa, e.tvd), fr, stage: e.maxAtStage };
    });
    const vals = rows.flatMap((r) => [r.max, r.min, r.hydro, r.woc, r.pore, r.fr].filter((x): x is number => x !== null));
    const xMin = Math.floor((Math.min(...vals) - 0.04) * 10) / 10;
    const xMax = Math.ceil((Math.max(...vals) + 0.1) * 10) / 10;
    return { xMin, xMax, rows: rows.map((r) => ({ ...r, poreArea: r.pore, fBase: r.fr !== null ? r.fr * safety : null, fBand: r.fr !== null ? r.fr * (1 - safety) : null, fZone: r.fr !== null ? Math.max(0, xMax - r.fr) : null })) };
  }, [envelope, safety]);

  // проверки по огибающим
  const checks = useMemo(() => {
    let fracMargin = Infinity, fracAt = 0, poreMargin = Infinity, poreAt = 0, poreMarginDyn = Infinity;
    for (const e of envelope) {
      if (e.fracPressureMPa !== null) { const m = e.fracPressureMPa * safety - e.maxPressureMPa; if (m < fracMargin) { fracMargin = m; fracAt = e.md; } }
      if (e.porePressureMPa !== null && e.poreFromLayer) {
        const m = e.wocHydrostaticMPa - e.porePressureMPa; if (m < poreMargin) { poreMargin = m; poreAt = e.md; }
        poreMarginDyn = Math.min(poreMarginDyn, e.minHydrostaticMPa - e.porePressureMPa);
      }
    }
    return { fracMargin, fracAt, poreMargin, poreAt, poreMarginDyn };
  }, [envelope, safety]);

  const layerRefs = layers.filter((l) => l.topMD > 0 && l.topMD <= casingDepthMD);
  const yTicks = useMemo(() => { const st = casingDepthMD > 3000 ? 500 : casingDepthMD > 1500 ? 250 : 100; const t: number[] = []; for (let d = 0; d <= casingDepthMD; d += st) t.push(d); return t; }, [casingDepthMD]);
  const fmt = (v: number, d = u.dec) => (Number.isFinite(v) ? v.toFixed(d) : "—");

  const common = (xDomain: [number, number], xLabel: string) => (
    <>
      <CartesianGrid strokeDasharray="3 3" className="stroke-border" opacity={0.6} />
      <YAxis dataKey="md" type="number" domain={[0, casingDepthMD]} ticks={yTicks} tick={{ fontSize: 11 }} width={52}
        label={{ value: "Глубина по стволу, м", angle: -90, position: "insideLeft", offset: 4, fontSize: 12 }} />
      <XAxis type="number" orientation="top" domain={xDomain} allowDataOverflow tick={{ fontSize: 11 }}
        label={{ value: xLabel, position: "insideTop", offset: -22, fontSize: 12 }} />
      {prevShoeMD > 0 && <ReferenceLine y={prevShoeMD} stroke="#64748b" strokeDasharray="6 3" label={{ value: `башмак пред. колонны ${prevShoeMD} м`, position: "insideBottomLeft", fontSize: 10, fill: "#64748b" }} />}
      {layerRefs.map((l) => <ReferenceLine key={l.name + l.topMD} y={l.topMD} stroke={C.poreLine} strokeDasharray="2 3" label={{ value: l.name || "пласт", position: "insideTopLeft", fontSize: 10, fill: C.poreLine }} />)}
    </>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">Давление и ЭЦП в затрубье по глубине — за всю операцию</CardTitle>
          <div className="flex items-center gap-1 text-xs">
            {(Object.keys(UNIT) as Unit[]).map((k) => <button key={k} onClick={() => setUnit(k)} className={`rounded px-2 py-1 border ${unit === k ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>{UNIT[k].label}</button>)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Для каждой глубины — огибающие за весь процесс (закачка буфера и цемента, продавка, остановки, СТОП): максимальное давление в затрубье, минимальное давление при циркуляции
          и минимальное гидростатическое давление (без трения). Пунктир — гидростатика после продавки при потере гидростатики цементом в ОЗЦ (цемент как столб воды затворения).
          Пластовое давление — по пластам, вне пластов в открытом стволе — нормальное (10 кПа/м); ГРП/поглощение — в открытом стволе ниже башмака предыдущей колонны.
          Безопасно, когда красная линия левее светло-серой зоны (ГРП × {safety}), а синяя — правее жёлтой.
        </p>
        <div className="grid gap-2 sm:grid-cols-3 text-xs">
          <div className={`rounded-md border p-2 ${checks.fracMargin < 0 ? "border-destructive/60 bg-destructive/5" : "border-border/60"}`}>
            <p className="text-muted-foreground">Мин. запас до ГРП × {safety}</p>
            <p className="text-base font-semibold">{Number.isFinite(checks.fracMargin) ? `${fmt(checks.fracMargin * u.k)} ${u.label}` : "ГРП не задан"}</p>
            {Number.isFinite(checks.fracMargin) && <p className="text-muted-foreground">на {Math.round(checks.fracAt)} м</p>}
          </div>
          <div className={`rounded-md border p-2 ${checks.poreMarginDyn < 0 ? "border-destructive/60 bg-destructive/5" : "border-border/60"}`}>
            <p className="text-muted-foreground">Мин. превышение гидростатики над пластовым (пласты)</p>
            <p className="text-base font-semibold">{Number.isFinite(checks.poreMarginDyn) ? `${fmt(checks.poreMarginDyn * u.k)} ${u.label}` : "Pпл не задано"}</p>
          </div>
          <div className={`rounded-md border p-2 ${checks.poreMargin < 0 ? "border-amber-500/60 bg-amber-500/5" : "border-border/60"}`}>
            <p className="text-muted-foreground">То же при потере гидростатики цементом (ОЗЦ)</p>
            <p className="text-base font-semibold">{Number.isFinite(checks.poreMargin) ? `${fmt(checks.poreMargin * u.k)} ${u.label}` : "—"}</p>
            {Number.isFinite(checks.poreMargin) && <p className="text-muted-foreground">{checks.poreMargin < 0 ? `риск притока / миграции газа на ${Math.round(checks.poreAt)} м — газоблок, расширение, противодавление` : `на ${Math.round(checks.poreAt)} м`}</p>}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <div className="flex items-center justify-between mb-1"><p className="text-sm font-semibold">Давление в кольцевом пространстве</p><CopyImageButton targetRef={refP} /></div>
            <div className="overflow-x-auto"><div ref={refP} className="h-[560px] min-w-[520px] bg-card">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart layout="vertical" data={pData.rows} margin={{ top: 34, right: 16, left: 8, bottom: 8 }}>
                  {common([0, pData.xMax], `Давление, ${u.label}`)}
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(md) => `Глубина ${md} м`}
                    formatter={(v: number, n: string) => (["fBase", "fBand", "fZone"].includes(String(n)) ? null : [`${Number(v).toFixed(u.dec)} ${u.label}`, n]) as never} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} verticalAlign="bottom" />
                  <Area dataKey="pore" name="Пластовое давление" type="linear" stroke={C.poreLine} strokeWidth={1} fill={C.pore} fillOpacity={0.6} connectNulls={false} isAnimationActive={false} />
                  <Area dataKey="fBase" stackId="f" stroke="none" fill="transparent" legendType="none" name="fBase" isAnimationActive={false} />
                  <Area dataKey="fBand" stackId="f" stroke="none" fill={C.fracBand} fillOpacity={0.7} name={`ГРП × ${safety} (допустимое)`} isAnimationActive={false} />
                  <Area dataKey="fZone" stackId="f" stroke="none" fill={C.frac} fillOpacity={0.55} name="Давление ГРП / поглощения" isAnimationActive={false} />
                  <Line dataKey="frac" name="ГРП" legendType="none" type="linear" stroke="#64748b" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  <Line dataKey="woc" name="Гидростатика при ОЗЦ" type="linear" stroke="#7c3aed" strokeWidth={1.4} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                  <Line dataKey="hydro" name="Мин. гидростатическое давление" type="linear" stroke={C.hydro} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="min" name="Мин. давление при циркуляции" type="linear" stroke={C.min} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="max" name="Максимальное давление" type="linear" stroke={C.max} strokeWidth={2.2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div></div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1"><p className="text-sm font-semibold">ЭЦП при цементировании</p><CopyImageButton targetRef={refE} /></div>
            <div className="overflow-x-auto"><div ref={refE} className="h-[560px] min-w-[520px] bg-card">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart layout="vertical" data={eData.rows} margin={{ top: 34, right: 16, left: 8, bottom: 8 }}>
                  {common([eData.xMin, eData.xMax], "ЭЦП, г/см³")}
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(md) => `Глубина ${md} м`}
                    formatter={(v: number, n: string) => (["fBase", "fBand", "fZone", "poreArea"].includes(String(n)) ? null : [`${Number(v).toFixed(3)} г/см³`, n]) as never} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} verticalAlign="bottom" />
                  <Area dataKey="poreArea" name="Экв. градиент пластового давления" type="linear" stroke={C.poreLine} strokeWidth={1} fill={C.pore} fillOpacity={0.6} isAnimationActive={false} baseValue={eData.xMin} />
                  <Area dataKey="fBase" stackId="f" stroke="none" fill="transparent" legendType="none" name="fBase" isAnimationActive={false} />
                  <Area dataKey="fBand" stackId="f" stroke="none" fill={C.fracBand} fillOpacity={0.7} name={`ГРП × ${safety}`} isAnimationActive={false} />
                  <Area dataKey="fZone" stackId="f" stroke="none" fill={C.frac} fillOpacity={0.55} name="Экв. градиент ГРП" isAnimationActive={false} />
                  <Line dataKey="fr" name="ГРП" legendType="none" type="linear" stroke="#64748b" strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  <Line dataKey="woc" name="ЭЦП при ОЗЦ" type="linear" stroke="#7c3aed" strokeWidth={1.4} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                  <Line dataKey="hydro" name="Мин. ЭЦП (гидростатика)" type="linear" stroke={C.hydro} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="min" name="Мин. ЭЦП" type="linear" stroke={C.min} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="max" name="Макс. ЭЦП" type="linear" stroke={C.max} strokeWidth={2.2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div></div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
