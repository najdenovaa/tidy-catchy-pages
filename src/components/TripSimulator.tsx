import { useMemo, useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Play, Pause, SkipBack, SkipForward, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";
import type { TDResult, SurgeSwabResult, StuckZone } from "@/lib/torque-drag-calculations";

interface Props {
  tripIn: TDResult;
  tripOut: TDResult;
  surgeSwab: SurgeSwabResult | null;
  stuckZones: StuckZone[];
  totalDepthMD: number;
  maxHookLoad?: number;
  fracGradKpa: number;
}

type Direction = "in" | "out";
type Status = "ok" | "warning" | "critical";

interface StepState {
  stand: number;
  md: number;
  hookLoad: number;
  torque: number;
  clearance: number;
  vonMises: number;
  bhpMPa: number;
  fracMPa: number;
  poreMPa: number;
  status: Status;
  triggered: StuckZone[];
}

const STATUS_STYLES: Record<Status, { bg: string; ring: string; text: string; label: string; Icon: typeof AlertCircle }> = {
  ok:       { bg: "bg-emerald-500/15", ring: "ring-emerald-500/50", text: "text-emerald-400", label: "Норма",     Icon: CheckCircle2 },
  warning:  { bg: "bg-amber-500/15",   ring: "ring-amber-500/50",   text: "text-amber-400",   label: "Внимание",  Icon: AlertTriangle },
  critical: { bg: "bg-red-500/15",     ring: "ring-red-500/50",     text: "text-red-400",     label: "Критично",  Icon: AlertCircle },
};

const REASON_LABEL: Record<StuckZone["reason"], string> = {
  buckling: "Buckling — продольный изгиб",
  clearance: "Малый зазор",
  hook_load: "Превышение HL на рига",
  dls: "Высокий DLS",
  surge_frac: "Surge > P_ГРП",
  swab_kick: "Swab < P_пласт (kick)",
  yield: "σ > предел текучести",
};

export default function TripSimulator({ tripIn, tripOut, surgeSwab, stuckZones, totalDepthMD, maxHookLoad, fracGradKpa }: Props) {
  const [standLength, setStandLength] = useState(28);
  const [direction, setDirection] = useState<Direction>("in");
  const [stand, setStand] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(600);
  const timerRef = useRef<number | null>(null);

  const totalStands = Math.max(1, Math.ceil(totalDepthMD / standLength));

  // Build per-stand state snapshots
  const steps = useMemo<StepState[]>(() => {
    const src = direction === "in" ? tripIn : tripOut;
    const pts = src.points;
    if (!pts.length) return [];

    const findPt = (md: number) => {
      let best = pts[0];
      let bestDiff = Math.abs(pts[0].md - md);
      for (const p of pts) {
        const d = Math.abs(p.md - md);
        if (d < bestDiff) { bestDiff = d; best = p; }
      }
      return best;
    };

    const findSurge = (md: number) => {
      if (!surgeSwab) return null;
      let best = surgeSwab.points[0];
      let bestDiff = Math.abs(surgeSwab.points[0]?.md - md);
      for (const p of surgeSwab.points) {
        const d = Math.abs(p.md - md);
        if (d < bestDiff) { bestDiff = d; best = p; }
      }
      return best;
    };

    const out: StepState[] = [];
    for (let s = 0; s <= totalStands; s++) {
      const md = Math.min(totalDepthMD, s * standLength);
      const pt = findPt(md);
      const sg = findSurge(md);
      const triggered = stuckZones.filter(z => md >= z.topMD - 0.5 && md <= z.bottomMD + 0.5);
      let status: Status = "ok";
      if (triggered.some(z => z.severity === "critical")) status = "critical";
      else if (triggered.length > 0) status = "warning";

      const bhpMPa = direction === "in" ? (sg?.totalBHPsurgeMPa ?? sg?.hydrostaticMPa ?? 0) : (sg?.totalBHPswabMPa ?? sg?.hydrostaticMPa ?? 0);

      out.push({
        stand: s,
        md,
        hookLoad: pt.hookLoad,
        torque: pt.torque,
        clearance: pt.clearance,
        vonMises: pt.vonMises ?? 0,
        bhpMPa,
        fracMPa: sg?.fracPressureMPa ?? 0,
        poreMPa: sg?.porePressureMPa ?? 0,
        status,
        triggered,
      });
    }
    return out;
  }, [direction, tripIn, tripOut, surgeSwab, stuckZones, standLength, totalDepthMD, totalStands]);

  // Clamp stand index when length/depth changes
  useEffect(() => {
    if (stand > totalStands) setStand(totalStands);
  }, [totalStands, stand]);

  // Auto-play
  useEffect(() => {
    if (!playing) return;
    timerRef.current = window.setInterval(() => {
      setStand(prev => {
        if (prev >= totalStands) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, speedMs);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [playing, speedMs, totalStands]);

  const current = steps[stand] ?? steps[steps.length - 1];
  const style = current ? STATUS_STYLES[current.status] : STATUS_STYLES.ok;
  const Icon = style.Icon;

  // Mini-map of risks on the depth bar
  const riskBands = useMemo(() => stuckZones.map(z => ({
    top: (z.topMD / totalDepthMD) * 100,
    height: Math.max(0.4, ((z.bottomMD - z.topMD) / totalDepthMD) * 100),
    severity: z.severity,
  })), [stuckZones, totalDepthMD]);

  if (!current) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center justify-between flex-wrap gap-2">
          <span>🎬 Пошаговый симулятор СПО (свечами)</span>
          <div className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
            <span>Свеча: </span>
            <input
              type="number"
              min={9}
              max={50}
              value={standLength}
              onChange={e => setStandLength(Math.max(9, Math.min(50, +e.target.value || 28)))}
              className="w-16 px-2 py-1 rounded bg-background border border-border text-foreground"
            />
            <span>м · v ={" "}</span>
            <select
              value={speedMs}
              onChange={e => setSpeedMs(+e.target.value)}
              className="px-2 py-1 rounded bg-background border border-border text-foreground"
            >
              <option value={1500}>0.5×</option>
              <option value={900}>1×</option>
              <option value={600}>1.5×</option>
              <option value={300}>3×</option>
              <option value={120}>7×</option>
            </select>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Direction toggle + transport controls */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="inline-flex rounded-md overflow-hidden border border-border">
            <button
              onClick={() => { setDirection("in"); setStand(0); setPlaying(false); }}
              className={`px-3 py-1.5 text-xs ${direction === "in" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}
            >
              ⬇ Спуск
            </button>
            <button
              onClick={() => { setDirection("out"); setStand(0); setPlaying(false); }}
              className={`px-3 py-1.5 text-xs ${direction === "out" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground"}`}
            >
              ⬆ Подъём
            </button>
          </div>

          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" onClick={() => { setStand(0); setPlaying(false); }}>
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStand(s => Math.max(0, s - 1))}>−</Button>
            <Button size="sm" onClick={() => setPlaying(p => !p)}>
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStand(s => Math.min(totalStands, s + 1))}>+</Button>
            <Button size="sm" variant="outline" onClick={() => { setStand(totalStands); setPlaying(false); }}>
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>

          <div className={`ml-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-md ring-1 ${style.bg} ${style.ring}`}>
            <Icon className={`w-4 h-4 ${style.text}`} />
            <span className={`text-xs font-medium ${style.text}`}>{style.label}</span>
          </div>
        </div>

        {/* Slider over stands */}
        <div className="mb-4">
          <Slider
            min={0}
            max={totalStands}
            step={1}
            value={[stand]}
            onValueChange={v => setStand(v[0])}
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-1">
            <span>Свеча {stand} / {totalStands}</span>
            <span>MD = {current.md.toFixed(0)} м</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-4">
          {/* Depth bar with risk map */}
          <div className="relative h-[280px] w-full md:w-[120px] rounded-md border border-border bg-muted/20 overflow-hidden">
            <div className="absolute inset-x-0 top-1 text-center text-[10px] text-muted-foreground">0 м</div>
            <div className="absolute inset-x-0 bottom-1 text-center text-[10px] text-muted-foreground">{totalDepthMD.toFixed(0)} м</div>
            {riskBands.map((b, i) => (
              <div
                key={i}
                className={`absolute left-2 right-2 ${b.severity === "critical" ? "bg-red-500/40" : "bg-amber-500/35"}`}
                style={{ top: `${b.top}%`, height: `${b.height}%` }}
              />
            ))}
            {/* Bit position marker */}
            <div
              className="absolute left-0 right-0 h-[2px] bg-primary shadow-[0_0_8px_hsl(var(--primary))]"
              style={{ top: `${Math.min(100, (current.md / totalDepthMD) * 100)}%` }}
            />
            <div
              className="absolute -translate-y-1/2 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center font-bold ring-2 ring-background"
              style={{ top: `${Math.min(100, (current.md / totalDepthMD) * 100)}%` }}
              title={`MD ${current.md.toFixed(0)} м`}
            >
              {direction === "in" ? "↓" : "↑"}
            </div>
          </div>

          {/* Live readouts */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Metric label="Глубина MD"  value={`${current.md.toFixed(0)} м`} />
            <Metric label="Hook Load"   value={`${current.hookLoad.toFixed(0)} кН`}
                    warn={maxHookLoad ? current.hookLoad > maxHookLoad : false}
                    danger={current.hookLoad < 0} />
            <Metric label="Крутящий момент" value={`${current.torque.toFixed(1)} кН·м`} />
            <Metric label="Зазор" value={`${current.clearance.toFixed(0)} мм`}
                    warn={current.clearance < 10} danger={current.clearance < 5} />
            <Metric label="σ Von Mises" value={`${current.vonMises.toFixed(0)} МПа`} />
            <Metric label={direction === "in" ? "BHP+surge" : "BHP−swab"}
                    value={`${current.bhpMPa.toFixed(1)} МПа`}
                    danger={direction === "in" ? current.bhpMPa > current.fracMPa : current.bhpMPa < current.poreMPa} />
            <Metric label="P_ГРП" value={`${current.fracMPa.toFixed(1)} МПа`} muted />
            <Metric label="P_пласт" value={`${current.poreMPa.toFixed(1)} МПа`} muted />
            <Metric label="Активные риски" value={`${current.triggered.length}`}
                    warn={current.triggered.length > 0}
                    danger={current.triggered.some(t => t.severity === "critical")} />
          </div>
        </div>

        {/* Triggered alerts with popover details */}
        {current.triggered.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className={`text-xs font-medium ${style.text}`}>На текущей глубине активно {current.triggered.length} предупреждение(й):</div>
            <div className="flex flex-wrap gap-2">
              {current.triggered.map((z, i) => {
                const st = STATUS_STYLES[z.severity === "critical" ? "critical" : "warning"];
                return (
                  <Popover key={i}>
                    <PopoverTrigger asChild>
                      <button className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md ring-1 text-xs ${st.bg} ${st.ring} ${st.text} hover:brightness-125 transition`}>
                        <st.Icon className="w-3.5 h-3.5" />
                        {REASON_LABEL[z.reason]}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 text-xs">
                      <div className="space-y-2">
                        <div className="font-semibold">{REASON_LABEL[z.reason]}</div>
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>Интервал</span>
                          <span className="font-mono">{z.topMD.toFixed(0)} – {z.bottomMD.toFixed(0)} м</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Метрика</span>
                          <span className="font-mono">{z.metric}</span>
                        </div>
                        <div className={`px-2 py-1 rounded ${st.bg} ${st.text}`}>{z.recommendation}</div>
                      </div>
                    </PopoverContent>
                  </Popover>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-border text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500/40" /> норма</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500/40" /> внимание (DLS / клиренс / swab)</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500/40" /> критично (buckling / ГРП / σ &gt; предел)</span>
          <span className="ml-auto">P_ГРП grad ≈ {(fracGradKpa).toFixed(1)} кПа/м</span>
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
