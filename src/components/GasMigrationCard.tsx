import { useMemo, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wind, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import CopyImageButton from "@/components/CopyImageButton";
import type { WellData, SlurryInput, DrillingFluid } from "@/lib/cementing-calculations";
import { interpolateTVD } from "@/lib/coiled-tubing-calculations";
import { calculateGMS, type GMSResult } from "@/lib/gas-migration-severity";

interface Props {
  wellData: WellData;
  drillingFluid: DrillingFluid;
  slurries: SlurryInput[];
  annVPM: number; // м³/м кольцевого
}

const riskColor = (cat: GMSResult["riskCategory"]) =>
  cat === "low" ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/30"
  : cat === "moderate" ? "text-amber-600 bg-amber-500/10 border-amber-500/30"
  : cat === "high" ? "text-orange-600 bg-orange-500/10 border-orange-500/30"
  : "text-red-700 bg-red-500/10 border-red-500/30";

const riskLabel = (cat: GMSResult["riskCategory"]) =>
  ({ low: "Низкий", moderate: "Средний", high: "Высокий", severe: "Критический" }[cat]);

export default function GasMigrationCard({ wellData, drillingFluid, slurries, annVPM }: Props) {
  // Auto-pick gas zone: первый reservoirLayer с fluidType == газ, иначе самый верхний из reservoirLayers
  const gasLayers = (wellData.reservoirLayers ?? []).filter(r => /газ|gas/i.test(r.fluidType));
  const defaultLayer = gasLayers[0] ?? (wellData.reservoirLayers ?? [])[0];

  const [gasZoneTvd, setGasZoneTvd] = useState(
    defaultLayer ? interpolateTVD(wellData.trajectory, defaultLayer.topMD) : Math.round(wellData.wellDepthTVD * 0.85),
  );
  const [porePressureMPa, setPorePressureMPa] = useState(
    defaultLayer ? +(defaultLayer.porePressureGrad * gasZoneTvd / 1000).toFixed(2) : +(1.05 * 9.81 * gasZoneTvd / 1000).toFixed(2),
  );
  const [fluidLossApi, setFluidLossApi] = useState(80);
  const [sgs10, setSgs10] = useState(200);
  const [thickeningMin, setThickeningMin] = useState(180);

  const chartRef = useRef<HTMLDivElement>(null);

  const tailSlurry = slurries[slurries.length - 1];
  const leadSlurry = slurries.length > 1 ? slurries[0] : undefined;

  // Hydraulic radius = annular area / wetted perimeter
  const hydrR = useMemo(() => {
    const odM = wellData.casingOD / 1000;
    const idM = wellData.holeDiameter / 1000;
    const area = Math.PI / 4 * (idM * idM - odM * odM);
    const perim = Math.PI * (idM + odM);
    return perim > 0 ? area / perim : 0.02;
  }, [wellData]);

  const result = useMemo<GMSResult | null>(() => {
    if (!tailSlurry || !wellData.casingDepthMD) return null;
    const tailDens = tailSlurry.density > 100 ? tailSlurry.density : tailSlurry.density * 1000;
    const leadDens = leadSlurry ? (leadSlurry.density > 100 ? leadSlurry.density : leadSlurry.density * 1000) : undefined;
    const minTopMD = Math.min(...slurries.map(s => s.topDepthMD));
    const tocTvd = interpolateTVD(wellData.trajectory, minTopMD);
    const shoeTvd = interpolateTVD(wellData.trajectory, wellData.casingDepthMD);
    const leadInterfaceTvd = leadSlurry && slurries.length > 1
      ? interpolateTVD(wellData.trajectory, slurries[1].topDepthMD)
      : undefined;

    return calculateGMS({
      tvdGasZone: gasZoneTvd,
      porePressureMPa,
      tocTvd,
      shoeTvd,
      mudAboveTOCDensity: drillingFluid.density,
      tailSlurryDensity: tailDens,
      leadSlurryDensity: leadDens,
      leadToTailInterfaceTvd: leadInterfaceTvd,
      fluidLossApi,
      sgs10minPa: sgs10,
      thickeningTimeMin: thickeningMin,
      hydraulicRadiusM: hydrR,
      gelColumnHeightM: Math.max(0, gasZoneTvd - tocTvd),
    });
  }, [tailSlurry, leadSlurry, slurries, wellData, gasZoneTvd, porePressureMPa, fluidLossApi, sgs10, thickeningMin, hydrR, drillingFluid.density]);

  if (!result) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Задайте цементные растворы и параметры скважины для расчёта GMS.
        </CardContent>
      </Card>
    );
  }

  const scoreData = [
    { name: "Дефицит P", value: +(result.scores.hydrostaticDeficit * 100).toFixed(0), color: "hsl(0, 75%, 55%)" },
    { name: "Fluid loss", value: +(result.scores.fluidLoss * 100).toFixed(0), color: "hsl(200, 70%, 50%)" },
    { name: "Transition", value: +(result.scores.gelTransition * 100).toFixed(0), color: "hsl(35, 80%, 50%)" },
    { name: "Геометрия", value: +(result.scores.columnGeometry * 100).toFixed(0), color: "hsl(280, 60%, 55%)" },
    { name: "TT ratio", value: +(result.scores.thickeningRatio * 100).toFixed(0), color: "hsl(140, 50%, 45%)" },
  ];

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <Wind className="h-5 w-5 text-orange-600" />
          GMS · Риск газовых перетоков (Sutton–Faul · Rocha–Azar)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Inputs */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">TVD газового горизонта, м</label>
            <input type="number" step="10" value={gasZoneTvd} onChange={e => setGasZoneTvd(+e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">P пластовое, МПа</label>
            <input type="number" step="0.5" value={porePressureMPa} onChange={e => setPorePressureMPa(+e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">API fluid loss, мл/30мин</label>
            <input type="number" step="10" value={fluidLossApi} onChange={e => setFluidLossApi(+e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">SGS @ 10 мин, Па</label>
            <input type="number" step="20" value={sgs10} onChange={e => setSgs10(+e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Время загуст., мин</label>
            <input type="number" step="10" value={thickeningMin} onChange={e => setThickeningMin(+e.target.value)}
              className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background" />
          </div>
        </div>

        {/* Headline */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className={`border rounded-lg p-3 ${riskColor(result.riskCategory)}`}>
            <div className="text-xs opacity-80 mb-1 flex items-center gap-1">
              <ShieldAlert className="h-3.5 w-3.5" /> GMS index
            </div>
            <div className="text-3xl font-bold">{result.gmsIndex}/100</div>
            <div className="text-xs mt-0.5">риск: <b>{riskLabel(result.riskCategory)}</b></div>
          </div>
          <div className="border border-border rounded-lg p-3 bg-card">
            <div className="text-xs text-muted-foreground mb-1">Давление у газового горизонта</div>
            <div className="text-base font-semibold">
              нач.: <span className="text-cyan-600">{result.hydrostaticAtGasMPa.toFixed(2)}</span> МПа
            </div>
            <div className="text-base font-semibold">
              мин.: <span className={result.minPressureDuringGelMPa < porePressureMPa ? "text-red-600" : "text-emerald-600"}>{result.minPressureDuringGelMPa.toFixed(2)}</span> МПа
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              P_пласт = {porePressureMPa.toFixed(2)} МПа · запас: {result.initialOverbalanceMPa.toFixed(2)} МПа
            </div>
          </div>
          <div className="border border-border rounded-lg p-3 bg-card">
            <div className="text-xs text-muted-foreground mb-1">Transition time / GFP</div>
            <div className="text-xl font-bold text-amber-600">{result.transitionTimeMin.toFixed(0)} мин</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Sutton GFP: <b>{result.gasFlowPotential.toFixed(2)}</b> МПа·(30/мин)
            </div>
          </div>
        </div>

        {/* Sub-scores chart */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Компоненты риска (0–100%)</div>
            <CopyImageButton targetRef={chartRef} />
          </div>
          <div ref={chartRef} className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scoreData} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} label={{ value: "%", angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
                <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: "12px" }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {scoreData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Primary driver */}
        <div className="border border-border rounded-lg p-3 bg-muted/30">
          <div className="text-xs text-muted-foreground mb-1">Доминирующий фактор риска</div>
          <div className="text-sm font-semibold">{result.primaryDriver}</div>
        </div>

        {/* Recommendations */}
        <div className="space-y-1.5">
          {result.recommendations.map((r, i) => {
            const ok = r.startsWith("GMS=") && result.riskCategory === "low";
            return (
              <div key={i} className={`text-xs flex items-start gap-2 p-2 rounded border ${ok ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300"}`}>
                {ok ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                <span>{r}</span>
              </div>
            );
          })}
        </div>

        <div className="text-[11px] text-muted-foreground border-t border-border pt-2">
          Модель: Rocha-Azar Δp = 4·SGS·L/d_h для оценки падения давления в гелирующемся цементном столбе; Sutton GFP = overbalance / (TT/30). Шкала API 65-2: low&lt;30, moderate&lt;55, high&lt;75, severe≥75.
        </div>
      </CardContent>
    </Card>
  );
}
