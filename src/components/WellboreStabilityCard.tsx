import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DebouncedInput } from "./DebouncedInput";
import { ShieldAlert, ShieldCheck, AlertTriangle } from "lucide-react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { WellData } from "@/lib/cementing-calculations";
import {
  buildStabilityProfile,
  generateStabilityRecommendations,
  ROCK_PRESETS,
  type RockMechProps,
} from "@/lib/wellbore-stability";

interface Props {
  wellData: WellData;
}

const tooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export default function WellboreStabilityCard({ wellData }: Props) {
  const [preset, setPreset] = useState<keyof typeof ROCK_PRESETS>("shale");
  const [rock, setRock] = useState<RockMechProps>(ROCK_PRESETS.shale);
  const [mudDensity, setMudDensity] = useState<number>(1.18);

  const layers = wellData.reservoirLayers ?? [];

  const results = useMemo(
    () => buildStabilityProfile(layers, wellData.trajectory, rock),
    [layers, wellData.trajectory, rock]
  );

  const chartData = useMemo(
    () =>
      results
        .slice()
        .sort((a, b) => a.tvd - b.tvd)
        .map((r) => ({
          tvd: Number(r.tvd.toFixed(0)),
          kick: Number(r.mwKickGcm3.toFixed(3)),
          collapse: Number(r.mwCollapseGcm3.toFixed(3)),
          loss: Number(r.mwLossGcm3.toFixed(3)),
          frac: Number(r.mwFracGcm3.toFixed(3)),
          lower: Number(r.mwLowerGcm3.toFixed(3)),
          upper: Number(r.mwUpperGcm3.toFixed(3)),
          band: Number((r.mwUpperGcm3 - r.mwLowerGcm3).toFixed(3)),
        })),
    [results]
  );

  const recs = useMemo(() => generateStabilityRecommendations(results, mudDensity), [results, mudDensity]);

  const handlePreset = (val: string) => {
    const p = val as keyof typeof ROCK_PRESETS;
    setPreset(p);
    setRock(ROCK_PRESETS[p]);
  };

  const updateRock = (key: keyof RockMechProps, value: number) => {
    setRock((prev) => ({ ...prev, [key]: value }));
  };

  if (layers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="w-5 h-5" />
            Устойчивость ствола (Wellbore Stability)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">
            Добавьте пласты (раздел «Месторождение / Пласты»), чтобы рассчитать окно безопасной плотности раствора.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="w-5 h-5" />
          Устойчивость ствола — окно плотности (Mohr-Coulomb / Kirsch)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Свойства породы */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="col-span-2 md:col-span-2">
            <label className="text-xs text-muted-foreground">Литотип (преcет)</label>
            <Select value={preset} onValueChange={handlePreset}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shale">Глина / Аргиллит</SelectItem>
                <SelectItem value="sandstone">Песчаник</SelectItem>
                <SelectItem value="limestone">Известняк</SelectItem>
                <SelectItem value="salt">Соль</SelectItem>
                <SelectItem value="coal">Уголь</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">UCS, МПа</label>
            <DebouncedInput
              type="number"
              value={rock.ucsMPa}
              onChange={(e) => updateRock("ucsMPa", Number(e.target.value) || 0)}
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">φ, °</label>
            <DebouncedInput
              type="number"
              value={rock.frictionAngleDeg}
              onChange={(e) => updateRock("frictionAngleDeg", Number(e.target.value) || 0)}
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">T₀, МПа</label>
            <DebouncedInput
              type="number"
              value={rock.tensileStrengthMPa}
              onChange={(e) => updateRock("tensileStrengthMPa", Number(e.target.value) || 0)}
              className="h-9 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">ρ р-ра, г/см³</label>
            <DebouncedInput
              type="number"
              step="0.01"
              value={mudDensity}
              onChange={(e) => setMudDensity(Number(e.target.value) || 0)}
              className="h-9 text-sm"
            />
          </div>
        </div>

        {/* График окна плотности */}
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="tvd"
                label={{ value: "TVD, м", position: "insideBottom", offset: -10, style: { fontSize: 11 } }}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                label={{ value: "Плотность, г/см³", angle: -90, position: "insideLeft", style: { fontSize: 11 } }}
                tick={{ fontSize: 10 }}
                domain={["auto", "auto"]}
              />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => v.toFixed(3)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="kick" name="Min (ГНВП)" stroke="hsl(0,70%,55%)" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="collapse" name="Min (вывал)" stroke="hsl(25,80%,50%)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              <Line type="monotone" dataKey="loss" name="Max (поглощение)" stroke="hsl(200,70%,50%)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              <Line type="monotone" dataKey="frac" name="Max (ГРП)" stroke="hsl(260,60%,55%)" strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="lower" name="Нижняя граница" stroke="hsl(0,80%,40%)" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="upper" name="Верхняя граница" stroke="hsl(220,80%,40%)" strokeWidth={2.5} dot={{ r: 3 }} />
              <ReferenceLine
                y={mudDensity}
                stroke="hsl(140,70%,40%)"
                strokeWidth={2}
                label={{ value: `Текущая ρ = ${mudDensity}`, position: "right", style: { fontSize: 10, fill: "hsl(140,70%,40%)" } }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Таблица результатов */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2">Пласт</th>
                <th className="text-right py-2 px-2">TVD, м</th>
                <th className="text-right py-2 px-2">σV, МПа</th>
                <th className="text-right py-2 px-2">σH, МПа</th>
                <th className="text-right py-2 px-2">ρ min</th>
                <th className="text-right py-2 px-2">ρ max</th>
                <th className="text-right py-2 px-2">Окно</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2 px-2">{layers[i]?.name ?? `Пласт ${i + 1}`}</td>
                  <td className="text-right py-2 px-2">{r.tvd.toFixed(0)}</td>
                  <td className="text-right py-2 px-2">{r.sigmaV_MPa.toFixed(1)}</td>
                  <td className="text-right py-2 px-2">{r.sigmaH_MPa.toFixed(1)}</td>
                  <td className="text-right py-2 px-2 font-mono">{r.mwLowerGcm3.toFixed(2)}</td>
                  <td className="text-right py-2 px-2 font-mono">{r.mwUpperGcm3.toFixed(2)}</td>
                  <td
                    className={`text-right py-2 px-2 font-mono ${
                      r.critical ? "text-destructive font-semibold" : ""
                    }`}
                  >
                    {r.windowWidthGcm3.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Рекомендации */}
        <div className="space-y-2">
          {recs.map((r, i) => {
            const Icon =
              r.severity === "critical" ? ShieldAlert : r.severity === "warn" ? AlertTriangle : ShieldCheck;
            const color =
              r.severity === "critical"
                ? "text-destructive bg-destructive/10 border-destructive/30"
                : r.severity === "warn"
                ? "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-800"
                : "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-800";
            return (
              <div key={i} className={`flex items-start gap-2 text-xs p-2 rounded border ${color}`}>
                <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{r.text}</span>
              </div>
            );
          })}
        </div>

        <div className="text-[10px] text-muted-foreground">
          Модель: уравнения Кирша для тангенциального напряжения на стенке вертикальной скважины + критерий Мора-Кулона
          (сдвиг) и Гриффита (растяжение). K₀ = ν/(1−ν). Эффективное напряжение по Био (α). Допущения: изотропное
          горизонтальное поле σH = σh, упругое поведение, отсутствие термо- и физико-химических эффектов.
        </div>
      </CardContent>
    </Card>
  );
}
