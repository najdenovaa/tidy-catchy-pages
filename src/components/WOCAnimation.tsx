import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, RotateCcw } from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceArea,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

interface Props {
  /** BHCT, °C — забойная циркуляционная температура (старт ОЗЦ) */
  bhct: number;
  /** Геостатическая (статическая) температура пласта, °C */
  bhst?: number;
  /** Плотность тампонажного раствора, кг/м³ */
  slurryDensity: number;
  /** Глубина (TVD), м — для гидростатики */
  tvd: number;
  /** Класс цемента: 'G' (стандарт) или 'H' */
  cementClass?: "G" | "H";
  /** Длительность анимации, ч (макс время ОЗЦ) */
  totalHours?: number;
}

/* ────── Физика-модели (инженерные апроксимации) ────── */

/**
 * UCS(t), SGS(t) для тампонажного цемента классов G/H.
 * Модель прочности — CEB-FIP MC90 (модифицированная под нефтяной цемент):
 *   UCS(t_eq) = UCS_28d · exp( s · (1 − √(t_ref / t_eq)) ),  t_ref = 28 сут = 672 ч
 *   s = 0.25 (Class G, нормальная кинетика), 0.30 (Class H, чуть быстрее)
 * Поправка по температуре — эквивалентный возраст (правило Аррениуса):
 *   t_eq = t · exp( Ea/R · (1/Tref − 1/T) ),  Tref = 50 °C
 * SGS набирается быстрее UCS — выходит на плато ~24–36 ч и потом ползёт логарифмически.
 */
function strengthModel(t_h: number, bhct: number, cls: "G" | "H") {
  const Ea = 38_000; // Дж/моль (энергия активации гидратации C3S)
  const R = 8.314;
  const Tref = 273.15 + 50;
  const T = 273.15 + Math.max(5, bhct);
  const matFactor = Math.exp((Ea / R) * (1 / Tref - 1 / T));
  const t_eq = Math.max(0.05, t_h * matFactor); // ч, эквивалентный возраст

  // CEB-FIP MC90 для UCS
  const t_ref = 672; // 28 сут в часах
  const s = cls === "H" ? 0.30 : 0.25;
  const UCS_28 = cls === "H" ? 32 : 28; // МПа (28 сут предел, типично для нефт. цемента)
  const ageFactor = Math.exp(s * (1 - Math.sqrt(t_ref / t_eq)));
  const ucs_mpa = Math.max(0, UCS_28 * ageFactor);

  // SGS: быстрый старт (handling 500 lbf/100ft² за 8–12 ч), потом медленный рост log-типа
  // t50 — время достижения 50% от плато
  const t50 = cls === "H" ? 5 : 7; // ч (в скорректированном возрасте)
  const SGS_plateau = 800; // lbf/100ft² — практический предел измерения
  const sgs_fast = SGS_plateau * (t_eq / (t_eq + t50));
  // долгий рост: дополнительные ~10% за неделю-месяц
  const sgs_slow = 80 * Math.log10(1 + t_eq / 24);
  const sgs_lbf100 = sgs_fast + sgs_slow;

  // степень гидратации — для информационных целей
  const hydration = Math.min(1, ageFactor);

  return { ucs_mpa, sgs_lbf100, hydration, k: matFactor, t_eq };
}


/**
 * Гидростатика → геостатика.
 * До набора SGS ≈ 100 lbf/100ft² (~50 psi gel) столб ведёт себя как жидкость (P=ρgh).
 * При SGS 100→500 (handling strength) — окно gas-migration: давление падает до Pgeostat.
 */
function transitionState(t_h: number, sgs: number) {
  if (sgs < 100) return { mode: "liquid" as const, factor: 1 };
  if (sgs < 500) {
    const f = 1 - (sgs - 100) / 400; // 1→0
    return { mode: "transition" as const, factor: Math.max(0, f) };
  }
  return { mode: "solid" as const, factor: 0 };
}

/**
 * Температура T(t) — экзотерма гидратации.
 * Старт = BHCT, пик через 6–12 ч, плато → BHST.
 */
function temperatureModel(t_h: number, bhct: number, bhst: number, cls: "G" | "H") {
  const peakDelta = cls === "H" ? 28 : 22; // °C peak above BHCT
  const tPeak = 8; // ч
  const sigma = 4;
  const peak = peakDelta * Math.exp(-Math.pow((t_h - tPeak) / sigma, 2));
  // плато к BHST за ~48 ч
  const drift = (bhst - bhct) * (1 - Math.exp(-t_h / 14));
  return bhct + peak + drift;
}

/**
 * Усадка цементного камня (м³/м³).
 * Химическая контракция ~4–6% к 28 сут, основная часть в первые 24 ч.
 */
function shrinkageModel(t_h: number, cls: "G" | "H") {
  const total = cls === "H" ? 0.052 : 0.045; // 5.2% или 4.5%
  return total * (1 - Math.exp(-t_h / 10));  // % объёма
}

/* ────── Компонент ────── */

export default function WOCAnimation({
  bhct, bhst = bhct + 15, slurryDensity, tvd, cementClass = "G", totalHours = 48,
}: Props) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2); // ч/сек реального времени
  const last = useRef<number | null>(null);

  // rAF loop
  useEffect(() => {
    if (!playing) { last.current = null; return; }
    let raf = 0;
    const tick = (now: number) => {
      if (last.current == null) last.current = now;
      const dt = (now - last.current) / 1000;
      last.current = now;
      setT(prev => {
        const next = prev + dt * speed;
        if (next >= totalHours) { setPlaying(false); return totalHours; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, totalHours]);

  // Серии данных
  const series = useMemo(() => {
    const N = 96;
    const out: {
      t: number;
      ucs: number; sgs: number;
      pCol: number; pGeo: number; pHydro: number;
      tempC: number;
      shrink: number;
      mode: string;
    }[] = [];
    // Авто-нормализация плотности: если пришло в г/см³ (<100) — переведём в кг/м³.
    const rhoKgM3 = slurryDensity < 100 ? slurryDensity * 1000 : slurryDensity;
    const pHydro = (rhoKgM3 * 9.81 * tvd) / 1e6; // МПа
    const pGeo = pHydro * 0.55; // упрощённая оценка остаточного на породу
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * totalHours;
      const s = strengthModel(th, bhct, cementClass);
      const tr = transitionState(th, s.sgs_lbf100);
      const pCol = pGeo + (pHydro - pGeo) * tr.factor;
      out.push({
        t: th,
        ucs: s.ucs_mpa,
        sgs: s.sgs_lbf100,
        pCol, pGeo, pHydro,
        tempC: temperatureModel(th, bhct, bhst, cementClass),
        shrink: shrinkageModel(th, cementClass) * 100,
        mode: tr.mode,
      });
    }
    return out;
  }, [bhct, bhst, slurryDensity, tvd, cementClass, totalHours]);

  // Текущая точка
  const cur = useMemo(() => {
    const idx = Math.min(series.length - 1, Math.max(0, Math.round((t / totalHours) * (series.length - 1))));
    return series[idx];
  }, [t, totalHours, series]);

  const trCurrent = transitionState(t, cur.sgs);
  const transitionWindow = useMemo(() => {
    let start: number | null = null, end: number | null = null;
    for (const s of series) {
      if (start === null && s.sgs >= 100) start = s.t;
      if (start !== null && end === null && s.sgs >= 500) { end = s.t; break; }
    }
    return { start, end };
  }, [series]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">⏳ Анимация ОЗЦ (waiting on cement)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Управление */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={() => setPlaying(p => !p)}>
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setT(0); setPlaying(false); }}>
            <RotateCcw className="w-4 h-4" />
          </Button>
          <select
            className="px-2 py-1 rounded bg-background border border-border text-sm"
            value={speed}
            onChange={e => setSpeed(+e.target.value)}
          >
            <option value={1}>1 ч/с</option>
            <option value={2}>2 ч/с</option>
            <option value={4}>4 ч/с</option>
            <option value={8}>8 ч/с</option>
          </select>
          <div className="flex-1 min-w-[200px]">
            <Slider min={0} max={totalHours} step={0.1} value={[t]} onValueChange={v => setT(v[0])} />
          </div>
          <span className="font-mono text-sm tabular-nums w-24 text-right">
            t = {t.toFixed(1)} ч
          </span>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
          <KPI label="UCS" value={`${cur.ucs.toFixed(2)} МПа`} hint="прочность на сжатие" tone={cur.ucs >= 3.5 ? "ok" : "warn"} />
          <KPI label="SGS" value={`${cur.sgs.toFixed(0)} lbf/100ft²`} hint="статический гель" tone={cur.sgs >= 500 ? "ok" : cur.sgs >= 100 ? "warn" : "muted"} />
          <KPI label="P столба" value={`${cur.pCol.toFixed(1)} МПа`} hint={`Pгидро=${cur.pHydro.toFixed(1)} · Pгео=${cur.pGeo.toFixed(1)}`} tone={trCurrent.mode === "transition" ? "danger" : "ok"} />
          <KPI label="T забоя" value={`${cur.tempC.toFixed(1)} °C`} hint={`BHCT=${bhct} · BHST=${bhst}`} tone="ok" />
          <KPI label="Усадка" value={`${cur.shrink.toFixed(2)} %`} hint="химическая контракция" tone={cur.shrink > 4 ? "warn" : "muted"} />
        </div>

        {/* 4 графика */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard title="UCS / SGS — набор прочности">
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={series}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="t" tickFormatter={v => `${v}ч`} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="L" tick={{ fontSize: 11 }} label={{ value: "UCS, МПа", angle: -90, position: "insideLeft", fontSize: 11 }} />
                <YAxis yAxisId="R" orientation="right" tick={{ fontSize: 11 }} label={{ value: "SGS, lbf/100ft²", angle: 90, position: "insideRight", fontSize: 11 }} />
                <Tooltip />
                <ReferenceLine yAxisId="R" y={100} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "50 psi gel", fontSize: 10, fill: "#f59e0b" }} />
                <ReferenceLine yAxisId="R" y={500} stroke="#10b981" strokeDasharray="4 4" label={{ value: "500 lbf — handling", fontSize: 10, fill: "#10b981" }} />
                <ReferenceLine yAxisId="L" y={3.5} stroke="#3b82f6" strokeDasharray="2 2" label={{ value: "WOC end · 500 psi", fontSize: 10, fill: "#3b82f6" }} />
                <Line yAxisId="L" type="monotone" dataKey="ucs" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line yAxisId="R" type="monotone" dataKey="sgs" stroke="#f59e0b" strokeWidth={2} dot={false} />
                <ReferenceLine yAxisId="L" x={t} stroke="hsl(var(--foreground))" strokeWidth={1} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Гидростатика → геостатика (gas migration окно)">
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={series}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="t" tickFormatter={v => `${v}ч`} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} label={{ value: "P, МПа", angle: -90, position: "insideLeft", fontSize: 11 }} />
                <Tooltip />
                {transitionWindow.start !== null && transitionWindow.end !== null && (
                  <ReferenceArea x1={transitionWindow.start} x2={transitionWindow.end} fill="#ef4444" fillOpacity={0.15} label={{ value: "Окно gas-migration", fontSize: 10, fill: "#ef4444", position: "insideTop" }} />
                )}
                <ReferenceLine y={series[0].pHydro} stroke="#3b82f6" strokeDasharray="3 3" label={{ value: `Pгидро ${series[0].pHydro.toFixed(1)}`, fontSize: 10, fill: "#3b82f6" }} />
                <ReferenceLine y={series[0].pGeo} stroke="#a78bfa" strokeDasharray="3 3" label={{ value: `Pгео ${series[0].pGeo.toFixed(1)}`, fontSize: 10, fill: "#a78bfa" }} />
                <Line type="monotone" dataKey="pCol" stroke="#ef4444" strokeWidth={2.5} dot={false} name="P столба" />
                <ReferenceLine x={t} stroke="hsl(var(--foreground))" strokeWidth={1} />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Температура: экзотерма гидратации">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={series}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="t" tickFormatter={v => `${v}ч`} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} label={{ value: "T, °C", angle: -90, position: "insideLeft", fontSize: 11 }} />
                <Tooltip />
                <ReferenceLine y={bhct} stroke="#3b82f6" strokeDasharray="3 3" label={{ value: `BHCT ${bhct}°`, fontSize: 10, fill: "#3b82f6" }} />
                <ReferenceLine y={bhst} stroke="#10b981" strokeDasharray="3 3" label={{ value: `BHST ${bhst}°`, fontSize: 10, fill: "#10b981" }} />
                <Area type="monotone" dataKey="tempC" stroke="#f97316" fill="#f97316" fillOpacity={0.25} strokeWidth={2} />
                <ReferenceLine x={t} stroke="hsl(var(--foreground))" strokeWidth={1} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Усадка / контракция объёма (риск микрозазора)">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="t" tickFormatter={v => `${v}ч`} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 6]} label={{ value: "ΔV, %", angle: -90, position: "insideLeft", fontSize: 11 }} />
                <Tooltip />
                <ReferenceLine y={4} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: "порог микрозазора 4%", fontSize: 10, fill: "#f59e0b" }} />
                <Line type="monotone" dataKey="shrink" stroke="#a78bfa" strokeWidth={2} dot={false} />
                <ReferenceLine x={t} stroke="hsl(var(--foreground))" strokeWidth={1} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Подсказки */}
        <div className="rounded-md border border-border bg-muted/10 p-3 text-xs space-y-1.5 text-muted-foreground">
          <div><b className="text-foreground">Окно gas-migration:</b> SGS 100 → 500 lbf/100ft² (gel transition time, GTT). Чем короче — тем меньше риск миграции газа через схватывающийся столб.</div>
          <div><b className="text-foreground">WOC end:</b> по API Spec 10A обычно UCS ≥ 3.5 МПа (500 psi) → можно бурить ниже башмака.</div>
          <div><b className="text-foreground">Усадка:</b> &gt; 4% по объёму при недостаточном внешнем давлении → микрозазор на границе цемент/обсадная.</div>
        </div>
      </CardContent>
    </Card>
  );
}

function KPI({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone: "ok" | "warn" | "danger" | "muted" }) {
  const toneCls = {
    ok: "border-emerald-500/30 bg-emerald-500/5",
    warn: "border-amber-500/40 bg-amber-500/5",
    danger: "border-red-500/40 bg-red-500/10",
    muted: "border-border bg-muted/10",
  }[tone];
  return (
    <div className={`rounded-md border p-2 ${toneCls}`}>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-base font-semibold font-mono tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-sm font-medium mb-2">{title}</div>
      {children}
    </div>
  );
}
