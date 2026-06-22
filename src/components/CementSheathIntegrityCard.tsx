import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DebouncedInput } from "./DebouncedInput";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, ReferenceLine } from "recharts";
import { Shield, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { WellData } from "@/lib/cementing-calculations";
import {
  analyzeSheath,
  defaultLoadCases,
  CEMENT_PRESETS,
  STEEL_DEFAULT,
  ROCK_DEFAULT,
  type CementMechProps,
  type SheathAnalysis,
} from "@/lib/cement-sheath-integrity";

interface Props {
  wellData: WellData;
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

const RISK_COLOR: Record<SheathAnalysis["riskLevel"], string> = {
  low: "hsl(140,70%,40%)",
  moderate: "hsl(45,90%,50%)",
  high: "hsl(25,90%,50%)",
  critical: "hsl(0,80%,50%)",
};

const RISK_LABEL: Record<SheathAnalysis["riskLevel"], string> = {
  low: "Низкий",
  moderate: "Средний",
  high: "Высокий",
  critical: "Критический",
};

export default function CementSheathIntegrityCard({ wellData }: Props) {
  const [preset, setPreset] = useState<keyof typeof CEMENT_PRESETS>("conventional");
  const [cement, setCement] = useState<CementMechProps>(CEMENT_PRESETS.conventional);
  const [pressTest, setPressTest] = useState(25);
  const [prodHeat, setProdHeat] = useState(40);
  const [stimCool, setStimCool] = useState(-50);

  const geo = useMemo(
    () => ({
      casingID_mm: wellData.casingOD - 2 * wellData.casingWall,
      casingOD_mm: wellData.casingOD,
      holeID_mm: wellData.holeDiameter,
    }),
    [wellData.casingOD, wellData.casingWall, wellData.holeDiameter]
  );

  const analyses = useMemo(() => {
    const loads = defaultLoadCases(pressTest, prodHeat, stimCool);
    return loads.map((l) => analyzeSheath(geo, cement, STEEL_DEFAULT, ROCK_DEFAULT, l));
  }, [geo, cement, pressTest, prodHeat, stimCool]);

  const chartData = analyses.map((a) => ({
    name: a.loadCase.name,
    sf: Number(a.worstSafetyFactor.toFixed(2)),
    risk: a.riskLevel,
  }));

  const handlePreset = (val: string) => {
    const p = val as keyof typeof CEMENT_PRESETS;
    setPreset(p);
    setCement(CEMENT_PRESETS[p]);
  };

  const updateCement = (key: keyof CementMechProps, value: number) => {
    setCement((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="w-5 h-5" />
          Долговременная целостность цементного камня (Thiercelin-Bois)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Параметры */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground">Тип цемента</label>
            <Select value={preset} onValueChange={handlePreset}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conventional">Стандартный портланд</SelectItem>
                <SelectItem value="flexible">Эластичный (с латексом)</SelectItem>
                <SelectItem value="highStrength">Высокопрочный</SelectItem>
                <SelectItem value="foamCement">Пеноцемент</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">E, ГПа</label>
            <DebouncedInput
              type="number"
              value={cement.youngGPa}
              onChange={(e) => updateCement("youngGPa", Number(e.target.value) || 0)}
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">σ растяж., МПа</label>
            <DebouncedInput
              type="number"
              value={cement.tensileMPa}
              onChange={(e) => updateCement("tensileMPa", Number(e.target.value) || 0)}
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">UCS, МПа</label>
            <DebouncedInput
              type="number"
              value={cement.compressiveMPa}
              onChange={(e) => updateCement("compressiveMPa", Number(e.target.value) || 0)}
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">ν</label>
            <DebouncedInput
              type="number"
              step="0.01"
              value={cement.poisson}
              onChange={(e) => updateCement("poisson", Number(e.target.value) || 0)}
              className="h-9 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">P опрессовки, МПа</label>
            <DebouncedInput
              type="number"
              value={pressTest}
              onChange={(e) => setPressTest(Number(e.target.value) || 0)}
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">ΔT нагрева, °C</label>
            <DebouncedInput
              type="number"
              value={prodHeat}
              onChange={(e) => setProdHeat(Number(e.target.value) || 0)}
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">ΔT охлажд., °C</label>
            <DebouncedInput
              type="number"
              value={stimCool}
              onChange={(e) => setStimCool(Number(e.target.value) || 0)}
              className="h-9 text-sm"
            />
          </div>
        </div>

        {/* График запасов прочности */}
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" height={60} />
              <YAxis
                label={{ value: "Запас прочности (SF)", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                tick={{ fontSize: 10 }}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <ReferenceLine y={1} stroke="hsl(0,80%,50%)" strokeDasharray="4 3" label={{ value: "SF=1", fontSize: 10, fill: "hsl(0,80%,50%)" }} />
              <ReferenceLine y={1.5} stroke="hsl(45,80%,50%)" strokeDasharray="4 3" label={{ value: "SF=1.5", fontSize: 10, fill: "hsl(45,80%,50%)" }} />
              <Bar dataKey="sf" name="Запас прочности">
                {chartData.map((d, i) => (
                  <Cell key={i} fill={RISK_COLOR[d.risk]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Таблица сценариев */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2">Сценарий</th>
                <th className="text-right py-2 px-2">σr вн, МПа</th>
                <th className="text-right py-2 px-2">σθ вн, МПа</th>
                <th className="text-right py-2 px-2">σr нар, МПа</th>
                <th className="text-right py-2 px-2">SF мин</th>
                <th className="text-left py-2 px-2">Риск</th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((a, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2 px-2">{a.loadCase.name}</td>
                  <td className="text-right py-2 px-2 font-mono">{a.stresses.sigmaR_inner_MPa.toFixed(2)}</td>
                  <td className="text-right py-2 px-2 font-mono">{a.stresses.sigmaT_inner_MPa.toFixed(2)}</td>
                  <td className="text-right py-2 px-2 font-mono">{a.stresses.sigmaR_outer_MPa.toFixed(2)}</td>
                  <td
                    className={`text-right py-2 px-2 font-mono ${
                      a.worstSafetyFactor < 1 ? "text-destructive font-semibold" : ""
                    }`}
                  >
                    {a.worstSafetyFactor > 100 ? "∞" : a.worstSafetyFactor.toFixed(2)}
                  </td>
                  <td className="py-2 px-2" style={{ color: RISK_COLOR[a.riskLevel] }}>
                    <strong>{RISK_LABEL[a.riskLevel]}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Детализация режимов разрушения по худшему сценарию */}
        {(() => {
          const worst = analyses.reduce((a, b) => (a.worstSafetyFactor < b.worstSafetyFactor ? a : b));
          if (worst.failures[0].mode === "ok") return null;
          return (
            <div className="space-y-2">
              <div className="text-xs font-medium">
                Худший сценарий: <span style={{ color: RISK_COLOR[worst.riskLevel] }}>{worst.loadCase.name}</span>
              </div>
              {worst.failures.map((f, i) => {
                const Icon =
                  f.severity === "critical" ? XCircle : f.severity === "warn" ? AlertTriangle : CheckCircle2;
                const color =
                  f.severity === "critical"
                    ? "text-destructive bg-destructive/10 border-destructive/30"
                    : f.severity === "warn"
                    ? "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-800"
                    : "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800";
                return (
                  <div key={i} className={`flex items-start gap-2 text-xs p-2 rounded border ${color}`}>
                    <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                    <div className="flex-1">
                      <div>{f.description}</div>
                      <div className="text-[10px] opacity-70 mt-0.5">SF = {f.safetyFactor.toFixed(2)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        <div className="text-[10px] text-muted-foreground">
          Модель: толстостенный цилиндр Ламе с термоупругой поправкой Тьерселина-Буа (SPE 28100). Учитывается передача
          давления через сталь и реакция породы. Знаки: «+» — растяжение, «−» — сжатие. SF&nbsp;&lt;&nbsp;1 — разрушение;
          1&nbsp;&lt;&nbsp;SF&nbsp;&lt;&nbsp;1.5 — недостаточный запас.
        </div>
      </CardContent>
    </Card>
  );
}
