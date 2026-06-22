import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, SkipBack, SkipForward, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";

interface HookPt {
  depth: number;
  hookRIH_kgf: number;
  hookPOOH_kgf: number;
  yieldLimit80_kgf: number;
}

interface ForcePt {
  depth: number;
  axialRIH: number;
  axialPOOH: number;
  bucklingLimit: number;
}

interface Props {
  hookLoadData: HookPt[];
  forceProfile: ForcePt[];
  totalDepthMD: number;
  lockUpDepth: number;
  helicalBucklingLoad: number;
  injectorPullCapacity?: number; // кН
}

type Direction = "in" | "out";
type Status = "ok" | "warning" | "critical";

const STYLES: Record<Status, { bg: string; ring: string; text: string; label: string; Icon: typeof AlertCircle }> = {
  ok:       { bg: "bg-emerald-500/15", ring: "ring-emerald-500/50", text: "text-emerald-400", label: "Норма",    Icon: CheckCircle2 },
  warning:  { bg: "bg-amber-500/15",   ring: "ring-amber-500/50",   text: "text-amber-400",   label: "Внимание", Icon: AlertTriangle },
  critical: { bg: "bg-red-500/15",     ring: "ring-red-500/50",     text: "text-red-400",     label: "Критично", Icon: AlertCircle },
};

export default function CTTripSimulator({
  hookLoadData,
  forceProfile,
  totalDepthMD,
  lockUpDepth,
  helicalBucklingLoad,
  injectorPullCapacity = 220,
}: Props) {
  const [stepM, setStepM] = useState(50);
  const [direction, setDirection] = useState<Direction>("in");
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(400);
  const timerRef = useRef<number | null>(null);

  const totalSteps = Math.max(1, Math.ceil(totalDepthMD / stepM));

  const findNearest = <T extends { depth: number }>(arr: T[], d: number): T | null => {
    if (!arr.length) return null;
    let best = arr[0];
    let bd = Math.abs(arr[0].depth - d);
    for (const p of arr) {
      const x = Math.abs(p.depth - d);
      if (x < bd) { bd = x; best = p; }
    }
    return best;
  };

  const current = useMemo(() => {
    const md = Math.min(totalDepthMD, idx * stepM);
    const h = findNearest(hookLoadData, md);
    const f = findNearest(forceProfile, md);
    const hook = direction === "in" ? (h?.hookRIH_kgf ?? 0) : (h?.hookPOOH_kgf ?? 0);
    const axial = direction === "in" ? (f?.axialRIH ?? 0) : (f?.axialPOOH ?? 0);
    const buck = f?.bucklingLimit ?? helicalBucklingLoad;
    const yieldLimit = h?.yieldLimit80_kgf ?? 0;
    const hookKN = hook * 0.00980665; // kgf → kN
    const yieldKN = yieldLimit * 0.00980665;

    let status: Status = "ok";
    const reasons: string[] = [];

    // Lock-up
    if (lockUpDepth > 0 && md >= lockUpDepth - 0.5) {
      status = "critical";
      reasons.push(`🔒 Lock-up: запирание на ${lockUpDepth.toFixed(0)} м — ГНКТ не идёт глубже.`);
    }
    // Buckling on RIH (compression > limit)
    if (direction === "in" && axial < 0 && Math.abs(axial) > Math.abs(buck)) {
      status = "critical";
      reasons.push(`Спиральный изгиб: |Fa|=${Math.abs(axial).toFixed(0)} кН > предел ${Math.abs(buck).toFixed(0)} кН.`);
    } else if (direction === "in" && axial < 0 && Math.abs(axial) > 0.7 * Math.abs(buck)) {
      if (status === "ok") status = "warning";
      reasons.push(`Близко к синусоидальному изгибу (|Fa|>70% от предела).`);
    }
    // Yield on POOH
    if (direction === "out" && yieldKN > 0 && hookKN > yieldKN) {
      status = "critical";
      reasons.push(`Hook Load ${hookKN.toFixed(0)} кН > 80% предела текучести (${yieldKN.toFixed(0)} кН).`);
    } else if (direction === "out" && injectorPullCapacity && hookKN > 0.9 * injectorPullCapacity) {
      if (status === "ok") status = "warning";
      reasons.push(`Hook Load ${hookKN.toFixed(0)} кН > 90% тяги инжектора (${injectorPullCapacity} кН).`);
    }
    // Negative hookload on RIH = potential pipe-light
    if (direction === "in" && hookKN < 0) {
      if (status === "ok") status = "warning";
      reasons.push(`Отрицательный вес на крюке — выталкивание трубы.`);
    }

    return { md, hookKN, axial, buck, yieldKN, status, reasons };
  }, [idx, stepM, totalDepthMD, hookLoadData, forceProfile, direction, lockUpDepth, helicalBucklingLoad, injectorPullCapacity]);

  useEffect(() => { if (idx > totalSteps) setIdx(totalSteps); }, [totalSteps, idx]);

  useEffect(() => {
    if (!playing) return;
    timerRef.current = window.setInterval(() => {
      setIdx(prev => {
        if (prev >= totalSteps) { setPlaying(false); return prev; }
        return prev + 1;
      });
    }, speed);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [playing, speed, totalSteps]);

  const style = STYLES[current.status];
  const Icon = style.Icon;
  const lockBand = lockUpDepth > 0 ? (lockUpDepth / totalDepthMD) * 100 : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between flex-wrap gap-2">
          <span>🎬 Симулятор СПО ГНКТ</span>
          <div className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <span>Шаг:</span>
            <input
              type="number" min={10} max={200} value={stepM}
              onChange={e => setStepM(Math.max(10, Math.min(200, +e.target.value || 50)))}
              className="w-16 px-2 py-1 rounded bg-background border border-border text-foreground"
            />
            <span>м · v =</span>
            <select value={speed} onChange={e => setSpeed(+e.target.value)} className="px-2 py-1 rounded bg-background border border-border text-foreground">
              <option value={1000}>0.5×</option>
              <option value={600}>1×</option>
              <option value={400}>1.5×</option>
              <option value={200}>3×</option>
              <option value={80}>7×</option>
            </select>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="inline-flex rounded-md overflow-hidden border border-border">
            <button onClick={() => { setDirection("in"); setIdx(0); setPlaying(false); }}
              className={`px-3 py-1.5 text-xs ${direction === "in" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}>
              ⬇ Спуск (RIH)
            </button>
            <button onClick={() => { setDirection("out"); setIdx(totalSteps); setPlaying(false); }}
              className={`px-3 py-1.5 text-xs ${direction === "out" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}>
              ⬆ Подъём (POOH)
            </button>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => { setIdx(direction === "in" ? 0 : totalSteps); setPlaying(false); }}>
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIdx(s => Math.max(0, s - 1))}>−</Button>
            <Button size="sm" onClick={() => setPlaying(p => !p)}>
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIdx(s => Math.min(totalSteps, s + 1))}>+</Button>
            <Button size="sm" variant="outline" onClick={() => { setIdx(direction === "in" ? totalSteps : 0); setPlaying(false); }}>
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>
          <div className={`ml-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 ${style.bg} ${style.ring}`}>
            <Icon className={`w-4 h-4 ${style.text}`} />
            <span className={`text-xs font-medium ${style.text}`}>{style.label}</span>
          </div>
        </div>

        <div className="mb-4">
          <Slider min={0} max={totalSteps} step={1} value={[idx]} onValueChange={v => setIdx(v[0])} />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-1">
            <span>Шаг {idx} / {totalSteps}</span>
            <span>MD = {current.md.toFixed(0)} м</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-4">
          {/* Depth bar */}
          <div className="relative h-[260px] w-full md:w-[120px] rounded-md border border-border bg-muted/20 overflow-hidden">
            <div className="absolute inset-x-0 top-1 text-center text-[10px] text-muted-foreground">0 м</div>
            <div className="absolute inset-x-0 bottom-1 text-center text-[10px] text-muted-foreground">{totalDepthMD.toFixed(0)} м</div>
            {lockBand !== null && (
              <div className="absolute left-2 right-2 bg-red-500/35 border-t border-b border-red-500/60"
                   style={{ top: `${lockBand}%`, height: `${100 - lockBand}%` }}
                   title={`Lock-up: ${lockUpDepth.toFixed(0)} м`} />
            )}
            <div className="absolute left-0 right-0 h-[2px] bg-primary shadow-[0_0_8px_hsl(var(--primary))]"
                 style={{ top: `${Math.min(100, (current.md / totalDepthMD) * 100)}%` }} />
            <div className="absolute -translate-y-1/2 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold ring-2 ring-background"
                 style={{ top: `${Math.min(100, (current.md / totalDepthMD) * 100)}%` }}>
              {direction === "in" ? "↓" : "↑"}
            </div>
          </div>

          {/* Live readouts */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Metric label="Глубина MD" value={`${current.md.toFixed(0)} м`} />
            <Metric label="Hook Load" value={`${current.hookKN.toFixed(1)} кН`}
                    warn={current.hookKN < 0 || (injectorPullCapacity ? current.hookKN > 0.9 * injectorPullCapacity : false)}
                    danger={current.yieldKN > 0 && direction === "out" && current.hookKN > current.yieldKN} />
            <Metric label="Осевая в КНБК" value={`${current.axial.toFixed(1)} кН`}
                    warn={direction === "in" && current.axial < 0 && Math.abs(current.axial) > 0.7 * Math.abs(current.buck)}
                    danger={direction === "in" && current.axial < 0 && Math.abs(current.axial) > Math.abs(current.buck)} />
            <Metric label="Предел изгиба" value={`${current.buck.toFixed(1)} кН`} muted />
            <Metric label="80% σ_y" value={current.yieldKN > 0 ? `${current.yieldKN.toFixed(1)} кН` : "—"} muted />
            <Metric label="Тяга инжектора" value={`${injectorPullCapacity} кН`} muted />
          </div>
        </div>

        {current.reasons.length > 0 && (
          <div className="mt-4 space-y-1">
            <div className={`text-xs font-medium ${style.text}`}>Активные предупреждения:</div>
            {current.reasons.map((r, i) => (
              <div key={i} className={`text-xs px-2.5 py-1.5 rounded-md ring-1 ${style.bg} ${style.ring} ${style.text}`}>{r}</div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-border text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500/40" /> норма</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500/40" /> внимание</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500/40" /> критично (lock-up · buckling · σ&gt;σ_y)</span>
          <span className="ml-auto">L = {totalDepthMD.toFixed(0)} м · lock-up: {lockUpDepth > 0 ? `${lockUpDepth.toFixed(0)} м` : "нет"}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, warn, danger, muted }: { label: string; value: string; warn?: boolean; danger?: boolean; muted?: boolean }) {
  const color = danger ? "text-red-400" : warn ? "text-amber-400" : muted ? "text-muted-foreground" : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-muted/10 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${color}`}>{value}</div>
    </div>
  );
}
