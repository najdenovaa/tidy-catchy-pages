import { useMemo, useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Info, Lightbulb, Dices, Loader2 } from "lucide-react";
import { runMonteCarloCQI, type MonteCarloResult } from "@/lib/cement-monte-carlo";
import type { CQIInput } from "@/lib/cement-quality-index";
import type { PressurePoint, WellData, SlurryInput, BufferFluid, DrillingFluid } from "@/lib/cementing-calculations";
import type { CentralizationResult } from "@/lib/centralization-calculations";
import {
  calculateCementQuality,
  efficiencyAtAngle,
  gradeColor,
  cqiColor,
  getBondGrade,
  type CementQualityPoint,
} from "@/lib/cement-quality-index";

interface Props {
  pressureData: PressurePoint[];
  casingDepthMD: number;
  annVPM: number;
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  centralizationResults?: CentralizationResult[];
  prevCasingDepth: number;
}

export default function CementQualitySection(props: Props) {
  const { pressureData, casingDepthMD, annVPM, wellData,
    slurries, buffers, drillingFluid, centralizationResults, prevCasingDepth } = props;

  // Compute contact-time by depth from pressure data (lightweight)
  const contactTimeByDepth = useMemo(() => {
    if (pressureData.length < 2 || casingDepthMD <= 0) return [];
    const fronts = pressureData.map(pt => ({
      timeMin: pt.time,
      cementTopMD: pt.annCementHeightM > 0 ? casingDepthMD - pt.annCementHeightM : casingDepthMD,
      bufferTopMD: pt.annBufferHeightM > 0 ? casingDepthMD - pt.annCementHeightM - pt.annBufferHeightM : casingDepthMD,
    }));
    const step = Math.max(10, casingDepthMD / 80);
    const out: { depthMD: number; bufferContactMin: number }[] = [];
    for (let d = 0; d <= casingDepthMD; d += step) {
      let start = -1, end = -1;
      for (const f of fronts) {
        if (f.bufferTopMD <= d && f.cementTopMD >= d) {
          if (start < 0) start = f.timeMin;
          end = f.timeMin;
        }
      }
      out.push({ depthMD: d, bufferContactMin: start >= 0 && end >= 0 ? end - start : 0 });
    }
    return out;
  }, [pressureData, casingDepthMD]);

  // CQI with centralizers
  const withCent = useMemo(() => calculateCementQuality({
    wellData, slurries, buffers, drillingFluid,
    centralization: centralizationResults,
    pressureData, casingDepthMD, annVPM, prevCasingDepth, contactTimeByDepth,
  }), [wellData, slurries, buffers, drillingFluid, centralizationResults,
        pressureData, casingDepthMD, annVPM, prevCasingDepth, contactTimeByDepth]);

  // CQI without centralizers (standoff ~ 35–50, all ecc=0.7)
  const withoutCent = useMemo(() => {
    if (!centralizationResults || centralizationResults.length === 0) return null;
    const fake = centralizationResults.map(c => ({
      ...c, hasCentralizer: false, hasTurbulizer: false,
      standoff: 40, eccentricity: 0.7,
    }));
    return calculateCementQuality({
      wellData, slurries, buffers, drillingFluid,
      centralization: fake,
      pressureData, casingDepthMD, annVPM, prevCasingDepth, contactTimeByDepth,
    });
  }, [wellData, slurries, buffers, drillingFluid, centralizationResults,
        pressureData, casingDepthMD, annVPM, prevCasingDepth, contactTimeByDepth]);

  const points = withCent.points;
  const summary = withCent.summary;
  const recs = withCent.recommendations;

  // Slider state
  const [sliderIdx, setSliderIdx] = useState(0);
  useEffect(() => {
    if (sliderIdx >= points.length) setSliderIdx(Math.max(0, points.length - 1));
  }, [points.length, sliderIdx]);
  const currentPoint = points[sliderIdx];

  if (points.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Нет данных. Нажмите «РАССЧИТАТЬ».
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* === Summary Card === */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded" style={{ background: gradeColor(summary.avgGrade) }} />
            Индекс качества цементирования (CQI)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <BigStat label="Средний CQI" value={`${summary.avgCQI.toFixed(0)}%`} grade={summary.avgGrade} />
            <BigStat label="Мин CQI" value={`${summary.minCQI.toFixed(0)}%`} grade={getBondGrade(summary.minCQI)} />
            <BigStat label="Макс CQI" value={`${summary.maxCQI.toFixed(0)}%`} grade={getBondGrade(summary.maxCQI)} />
            <SmallStat label="Зоны D/F" value={`${summary.badZonesCount} (${summary.badZonesLength.toFixed(0)} м)`} />
            <SmallStat label="Ср. standoff" value={`${summary.avgStandoff.toFixed(0)}%`} />
            <SmallStat label="Контакт буф." value={`${summary.avgContact.toFixed(1)} мин`} />
            <SmallStat label="Режим потока"
              value={summary.avgFlowRegime === 'turbulent' ? 'Турбул.' :
                     summary.avgFlowRegime === 'transitional' ? 'Переход.' : 'Ламин.'} />
            <SmallStat label="ρ-иерархия"
              value={summary.densityHierarchyOK ? '✓ ОК' : '✗ Нарушена'}
              ok={summary.densityHierarchyOK} />
          </div>
          {summary.criticalZones.length > 0 && (
            <div className="mt-3 p-2 rounded border border-destructive/30 bg-destructive/5">
              <div className="text-xs font-medium flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="w-3.5 h-3.5" />
                {summary.criticalZones.length} критических зон(ы):
              </div>
              <ul className="text-xs mt-1 space-y-0.5">
                {summary.criticalZones.slice(0, 5).map((z, i) => (
                  <li key={i} className="font-mono">
                    • {z.fromMD.toFixed(0)}–{z.toMD.toFixed(0)} м: CQI={z.cqi.toFixed(0)}% — {z.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* === Polar Diagram + Slider === */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Поперечное сечение по глубине</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <PolarSection point={currentPoint} />
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">Глубина MD</span>
                  <span className="font-mono font-semibold">{currentPoint.depthMD.toFixed(0)} м</span>
                </div>
                <Slider
                  value={[sliderIdx]}
                  min={0}
                  max={points.length - 1}
                  step={1}
                  onValueChange={(v) => setSliderIdx(v[0])}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>0 м</span>
                  <span>{casingDepthMD.toFixed(0)} м</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <KV k="CQI" v={`${currentPoint.cementQualityIndex.toFixed(0)}%`} color={cqiColor(currentPoint.cementQualityIndex)} />
                <KV k="Грейд" v={currentPoint.bondGrade} color={gradeColor(currentPoint.bondGrade)} />
                <KV k="Standoff" v={`${currentPoint.standoff.toFixed(0)}%`} />
                <KV k="Эксцентр." v={currentPoint.eccentricity.toFixed(2)} />
                <KV k="Зенит" v={`${currentPoint.zenith.toFixed(1)}°`} />
                <KV k="Каверна k" v={currentPoint.cavernCoeff.toFixed(2)} />
                <KV k="Замещение" v={`${currentPoint.displacementEfficiency.toFixed(0)}%`} />
                <KV k="Re" v={currentPoint.reynolds.toFixed(0)} />
                <KV k="V кольц." v={`${currentPoint.annularVelocity.toFixed(2)} м/с`} />
                <KV k="Контакт буф." v={`${currentPoint.contactTimeMin.toFixed(1)} мин`} />
                <KV k="Среда" v={currentPoint.isOpenHole ? 'Открыт. ствол' : 'В обсадной'} />
                <KV k="Турбулизатор" v={currentPoint.hasTurbulizer ? 'есть' : 'нет'} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === Unwrapped Heatmap === */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Развёртка кольцевого пространства (CQI по углу × глубина)</CardTitle>
        </CardHeader>
        <CardContent>
          <UnwrappedHeatmap points={points} />
          <Legend />
        </CardContent>
      </Card>

      {/* === Risk Strip === */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Карта рисков по глубине</CardTitle>
        </CardHeader>
        <CardContent>
          <RiskStrip points={points} casingDepthMD={casingDepthMD} />
        </CardContent>
      </Card>

      {/* === Comparison: with vs without centralizers === */}
      {withoutCent && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Сравнение: с центраторами vs без</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-medium mb-1 text-center">С центраторами</div>
                <MiniBar value={withCent.summary.avgCQI} />
                <div className="text-center text-xs mt-1 font-mono">
                  CQI {withCent.summary.avgCQI.toFixed(0)}% ({withCent.summary.avgGrade})
                </div>
              </div>
              <div>
                <div className="text-xs font-medium mb-1 text-center">Без центраторов</div>
                <MiniBar value={withoutCent.summary.avgCQI} />
                <div className="text-center text-xs mt-1 font-mono">
                  CQI {withoutCent.summary.avgCQI.toFixed(0)}% ({withoutCent.summary.avgGrade})
                </div>
              </div>
            </div>
            <div className="mt-2 text-xs text-center text-muted-foreground">
              Эффект центрирования: <span className="font-semibold text-foreground">
                +{(withCent.summary.avgCQI - withoutCent.summary.avgCQI).toFixed(0)}%
              </span> CQI
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Recommendations === */}
      {recs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="w-4 h-4" />
              Рекомендации
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {recs.map((r, i) => (
                <li key={i} className="text-xs flex items-start gap-2">
                  <span className="text-primary mt-0.5">→</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <MonteCarloCard
        cqiInput={{
          wellData, slurries, buffers, drillingFluid,
          centralization: centralizationResults,
          pressureData, casingDepthMD, annVPM, prevCasingDepth, contactTimeByDepth,
        }}
      />
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────

function BigStat({ label, value, grade }: { label: string; value: string; grade: 'A' | 'B' | 'C' | 'D' | 'F' }) {
  return (
    <div className="rounded-lg border p-2" style={{ borderColor: gradeColor(grade) + '80' }}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-base font-bold font-mono" style={{ color: gradeColor(grade) }}>{value}</div>
      <div className="text-[10px] mt-0.5">Грейд <span className="font-bold">{grade}</span></div>
    </div>
  );
}

function SmallStat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-xs font-bold font-mono ${ok === false ? 'text-destructive' : ok === true ? 'text-green-600' : ''}`}>{value}</div>
    </div>
  );
}

function KV({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="flex justify-between border-b border-border/40 py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono font-semibold" style={color ? { color } : undefined}>{v}</span>
    </div>
  );
}

function PolarSection({ point }: { point: CementQualityPoint }) {
  const cx = 150, cy = 150;
  const rOuter = 130;
  const rInner = 90;
  const casingR = 55;
  // Эксцентриситет смещает колонну вниз
  const offsetMax = rInner - casingR - 5;
  const ccx = cx;
  const ccy = cy + point.eccentricity * offsetMax;

  // 36 секторов в затрубье, цвет = эффективность на этом угле
  const sectors = Array.from({ length: 72 }, (_, i) => {
    const a0 = (i * 5 - 90) * Math.PI / 180;
    const a1 = ((i + 1) * 5 - 90) * Math.PI / 180;
    const angleForEff = (i * 5) * Math.PI / 180; // 0 = верх
    const eff = efficiencyAtAngle(point.eccentricity, point.standoff, angleForEff);
    const color = cqiColor(eff);
    const x0 = cx + rInner * Math.cos(a0);
    const y0 = cy + rInner * Math.sin(a0);
    const x1 = cx + rOuter * Math.cos(a0);
    const y1 = cy + rOuter * Math.sin(a0);
    const x2 = cx + rOuter * Math.cos(a1);
    const y2 = cy + rOuter * Math.sin(a1);
    const x3 = cx + rInner * Math.cos(a1);
    const y3 = cy + rInner * Math.sin(a1);
    return (
      <path
        key={i}
        d={`M${x0},${y0} L${x1},${y1} A${rOuter},${rOuter} 0 0,1 ${x2},${y2} L${x3},${y3} A${rInner},${rInner} 0 0,0 ${x0},${y0} Z`}
        fill={color}
        opacity={0.85}
      />
    );
  });

  return (
    <svg viewBox="0 0 300 300" className="w-full max-w-[300px] mx-auto">
      <defs>
        <radialGradient id="steel" cx="40%" cy="40%">
          <stop offset="0%" stopColor="hsl(0,0%,75%)" />
          <stop offset="100%" stopColor="hsl(0,0%,40%)" />
        </radialGradient>
        <pattern id="rock" patternUnits="userSpaceOnUse" width="8" height="8">
          <rect width="8" height="8" fill="hsl(30,15%,30%)" />
          <circle cx="2" cy="3" r="0.8" fill="hsl(30,15%,20%)" />
          <circle cx="6" cy="6" r="1" fill="hsl(30,15%,22%)" />
        </pattern>
      </defs>
      {/* Порода */}
      <circle cx={cx} cy={cy} r={rOuter + 8} fill="url(#rock)" />
      {/* Затрубье — секторы */}
      {sectors}
      {/* Колонна (смещённая по эксцентриситету) */}
      <circle cx={ccx} cy={ccy} r={casingR} fill="url(#steel)" stroke="hsl(0,0%,30%)" strokeWidth={1.5} />
      <circle cx={ccx} cy={ccy} r={casingR - 8} fill="hsl(220,30%,15%)" />
      {/* Метки */}
      <text x={cx} y={12} textAnchor="middle" fontSize="9" fill="currentColor" opacity={0.7}>верх (high side)</text>
      <text x={cx} y={297} textAnchor="middle" fontSize="9" fill="currentColor" opacity={0.7}>низ (low side) ↓ гравитация</text>
      <text x={ccx} y={ccy + 4} textAnchor="middle" fontSize="9" fill="hsl(0,0%,85%)">ОК</text>
    </svg>
  );
}

function UnwrappedHeatmap({ points }: { points: CementQualityPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || points.length === 0) return;
    const W = 720, H = Math.max(120, Math.min(400, points.length * 4));
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const cellH = H / points.length;
    const cellW = W / 72;
    for (let di = 0; di < points.length; di++) {
      const p = points[di];
      for (let ai = 0; ai < 72; ai++) {
        const angleRad = (ai * 5) * Math.PI / 180;
        const eff = efficiencyAtAngle(p.eccentricity, p.standoff, angleRad);
        ctx.fillStyle = cqiColor(eff);
        ctx.fillRect(ai * cellW, di * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }
  }, [points]);

  return (
    <div className="space-y-1">
      <div className="flex text-[10px] text-muted-foreground">
        <div className="w-12">Глуб.</div>
        <div className="flex-1 flex justify-between px-1">
          <span>0°</span><span>90°</span><span>180° (низ)</span><span>270°</span><span>360°</span>
        </div>
      </div>
      <div className="flex gap-1">
        <div className="w-12 flex flex-col justify-between text-[10px] text-muted-foreground font-mono">
          <span>{points[0]?.depthMD.toFixed(0)}</span>
          <span>{points[Math.floor(points.length / 2)]?.depthMD.toFixed(0)}</span>
          <span>{points[points.length - 1]?.depthMD.toFixed(0)}</span>
        </div>
        <canvas ref={canvasRef} className="flex-1 border border-border rounded" style={{ imageRendering: 'pixelated', height: 'auto', maxHeight: 400, width: '100%' }} />
      </div>
    </div>
  );
}

function RiskStrip({ points, casingDepthMD }: { points: CementQualityPoint[]; casingDepthMD: number }) {
  // Группируем последовательные точки одинакового грейда
  type Zone = { fromMD: number; toMD: number; avgCQI: number; grade: 'A' | 'B' | 'C' | 'D' | 'F'; risk: string };
  const zones: Zone[] = [];
  if (points.length === 0) return null;
  let cur: Zone = { fromMD: points[0].depthMD, toMD: points[0].depthMD, avgCQI: points[0].cementQualityIndex, grade: points[0].bondGrade, risk: points[0].mudChannelRisk };
  let sum = points[0].cementQualityIndex, cnt = 1;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.bondGrade === cur.grade) {
      cur.toMD = p.depthMD;
      sum += p.cementQualityIndex;
      cnt++;
      cur.avgCQI = sum / cnt;
    } else {
      zones.push(cur);
      cur = { fromMD: p.depthMD, toMD: p.depthMD, avgCQI: p.cementQualityIndex, grade: p.bondGrade, risk: p.mudChannelRisk };
      sum = p.cementQualityIndex; cnt = 1;
    }
  }
  zones.push(cur);

  const riskEmoji = (r: string) =>
    r === 'low' ? '🟢' : r === 'medium' ? '🟡' : r === 'high' ? '🟠' : '🔴';
  const riskLabel = (r: string) =>
    r === 'low' ? 'Низкий' : r === 'medium' ? 'Средний' : r === 'high' ? 'Высокий' : 'Критич.';

  return (
    <div className="flex gap-3">
      {/* Visual strip */}
      <div className="relative w-12 border border-border rounded overflow-hidden" style={{ height: 400 }}>
        {zones.map((z, i) => {
          const top = (z.fromMD / casingDepthMD) * 100;
          const h = ((z.toMD - z.fromMD) / casingDepthMD) * 100;
          return (
            <div key={i} className="absolute w-full flex items-center justify-center text-[9px] font-bold text-white"
              style={{ top: `${top}%`, height: `${Math.max(0.5, h)}%`, background: gradeColor(z.grade) }}>
              {h > 4 ? z.grade : ''}
            </div>
          );
        })}
      </div>
      {/* Table */}
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: 400 }}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border">
              <th className="text-left py-1 px-2">Глубина</th>
              <th className="text-right py-1 px-2">CQI</th>
              <th className="text-center py-1 px-2">Грейд</th>
              <th className="text-left py-1 px-2">Риск</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z, i) => (
              <tr key={i} className="border-b border-border/40">
                <td className="py-1 px-2 font-mono">{z.fromMD.toFixed(0)}–{z.toMD.toFixed(0)} м</td>
                <td className="py-1 px-2 text-right font-mono font-semibold" style={{ color: gradeColor(z.grade) }}>
                  {z.avgCQI.toFixed(0)}%
                </td>
                <td className="py-1 px-2 text-center">
                  <Badge variant="outline" style={{ borderColor: gradeColor(z.grade), color: gradeColor(z.grade) }}>
                    {z.grade}
                  </Badge>
                </td>
                <td className="py-1 px-2">{riskEmoji(z.risk)} {riskLabel(z.risk)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MiniBar({ value }: { value: number }) {
  return (
    <div className="h-8 rounded border border-border overflow-hidden flex">
      <div style={{ width: `${value}%`, background: cqiColor(value) }} className="transition-all" />
      <div style={{ width: `${100 - value}%`, background: 'hsl(var(--muted))' }} />
    </div>
  );
}

function Legend() {
  const grades: ('A' | 'B' | 'C' | 'D' | 'F')[] = ['A', 'B', 'C', 'D', 'F'];
  const labels = ['Отл. ≥85', 'Хор. 70-84', 'Удовл. 55-69', 'Слабо 40-54', 'Провал <40'];
  return (
    <div className="flex flex-wrap gap-2 mt-2 text-[10px]">
      {grades.map((g, i) => (
        <div key={g} className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded" style={{ background: gradeColor(g) }} />
          <span><b>{g}</b> {labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Monte Carlo card ────────────────────────────────────────────

function MonteCarloCard({ cqiInput }: { cqiInput: CQIInput }) {
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [running, setRunning] = useState(false);
  const [iterations, setIterations] = useState(200);

  const run = () => {
    if (cqiInput.pressureData.length < 2) return;
    setRunning(true);
    // Defer to next tick so UI shows loader
    setTimeout(() => {
      try {
        const r = runMonteCarloCQI(cqiInput, { iterations });
        setResult(r);
      } finally {
        setRunning(false);
      }
    }, 30);
  };

  const successPct = result ? (result.successProbability * 100).toFixed(0) : "—";
  const successColor = result
    ? result.successProbability >= 0.8
      ? "text-emerald-600 dark:text-emerald-400"
      : result.successProbability >= 0.5
      ? "text-amber-600 dark:text-amber-400"
      : "text-red-600 dark:text-red-400"
    : "text-muted-foreground";

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Dices className="h-4 w-4" />
          Анализ неопределённости (Monte Carlo)
        </CardTitle>
        <div className="flex items-center gap-2">
          <Slider
            value={[iterations]}
            onValueChange={(v) => setIterations(v[0])}
            min={50}
            max={1000}
            step={50}
            className="w-32"
          />
          <span className="text-[10px] text-muted-foreground font-mono w-16">{iterations} итер.</span>
          <Button size="sm" onClick={run} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : "Запуск"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">
          Случайно варьируются: кавернозность ±15%, реология (ПВ, ДНС) ±20%, эксцентриситет ±0.10.
          Получаем распределение средней CQI по N сценариям — P10/P50/P90 и вероятность успеха (CQI ≥ 70, грейд B+).
        </p>

        {!result && !running && (
          <div className="text-xs text-muted-foreground text-center py-6 border border-dashed rounded-lg">
            Нажмите «Запуск», чтобы оценить устойчивость качества цементирования к неопределённости входных данных.
          </div>
        )}

        {running && (
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            Идёт расчёт {iterations} сценариев…
          </div>
        )}

        {result && !running && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <MCStat label="P10 (пессим.)" value={result.p10.toFixed(0)} sub="низ. 10%" />
              <MCStat label="P50 (медиана)" value={result.p50.toFixed(0)} sub="центр" highlight />
              <MCStat label="P90 (оптим.)" value={result.p90.toFixed(0)} sub="верх. 10%" />
              <MCStat label="Среднее" value={result.mean.toFixed(0)} sub={`σ ${result.stdev.toFixed(1)}`} />
              <div className="rounded-lg border p-2">
                <div className="text-[10px] text-muted-foreground">Вероятность успеха</div>
                <div className={`text-base font-bold font-mono ${successColor}`}>{successPct}%</div>
                <div className="text-[10px] text-muted-foreground">CQI ≥ 70</div>
              </div>
            </div>

            <div>
              <div className="text-[11px] text-muted-foreground mb-1.5">Распределение грейдов</div>
              <div className="flex h-6 rounded-md overflow-hidden border">
                {(["A", "B", "C", "D", "F"] as const).map((g) => {
                  const frac = result.gradeDistribution[g] ?? 0;
                  if (frac < 0.001) return null;
                  return (
                    <div
                      key={g}
                      className="flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ width: `${frac * 100}%`, background: gradeColor(g) }}
                      title={`${g}: ${(frac * 100).toFixed(1)}%`}
                    >
                      {frac >= 0.07 ? `${g} ${(frac * 100).toFixed(0)}%` : ""}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground">
              Выполнено сценариев: {result.iterations}. Чем уже разброс P10–P90, тем устойчивее проект к неопределённости.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MCStat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-2 ${highlight ? "border-primary/50 bg-primary/5" : ""}`}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-base font-bold font-mono">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
