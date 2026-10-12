import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ZoneCheck } from "@/lib/cementing-calculations";

interface Props {
  zoneChecks: ZoneCheck[];
  standoffSource: "profile" | "default";
  avgStandoffPct: number;
}

/** Проверка давления в затрубье на каждом пласте и на забое за всю операцию цементирования. */
export default function ZoneChecksCard({ zoneChecks, standoffSource, avgStandoffPct }: Props) {
  if (!zoneChecks || zoneChecks.length === 0) return null;
  const worst = [...zoneChecks].sort((a, b) => a.marginMPa - b.marginMPa)[0];
  const hasLayers = zoneChecks.length > 1;
  return (
    <Card className="p-4 space-y-3 mt-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold">Давление в затрубье по пластам за всю операцию</h3>
        <Badge variant={worst.marginMPa < 0 ? "destructive" : worst.marginMPa < 1 ? "default" : "outline"}>
          {worst.marginMPa < 0 ? `🔴 Превышение: ${worst.name}` : worst.marginMPa < 1 ? `⚠ Мало запаса: ${worst.name}` : "🟢 Во всех точках ниже допустимого"}
        </Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="p-1.5 text-left">Точка</th>
              <th className="p-1.5 text-right">MD / TVD, м</th>
              <th className="p-1.5 text-right">Допустимо, МПа</th>
              <th className="p-1.5 text-right">Макс. в затрубье, МПа</th>
              <th className="p-1.5 text-right">Запас, МПа</th>
              <th className="p-1.5 text-left">Когда</th>
              <th className="p-1.5 text-right">Мин. статич. / Pпл, МПа</th>
            </tr>
          </thead>
          <tbody>
            {zoneChecks.map((z) => (
              <tr key={z.name + z.depthMD} className="border-t border-border/40">
                <td className="p-1.5">{z.name}</td>
                <td className="p-1.5 text-right">{z.depthMD.toFixed(0)} / {z.depthTVD.toFixed(0)}</td>
                <td className="p-1.5 text-right">{z.limitMPa.toFixed(2)} <span className="text-muted-foreground">({z.limitKind})</span></td>
                <td className="p-1.5 text-right">{z.maxPressureMPa.toFixed(2)}</td>
                <td className={`p-1.5 text-right font-medium ${z.marginMPa < 0 ? "text-red-600" : z.marginMPa < 1 ? "text-amber-600" : "text-green-600"}`}>{z.marginMPa.toFixed(2)}</td>
                <td className="p-1.5">{z.maxAtStage} ({z.maxAtTimeMin.toFixed(0)} мин)</td>
                <td className={`p-1.5 text-right ${z.porePressureMPa > 0 && z.minPressureMPa < z.porePressureMPa ? "text-red-600 font-medium" : ""}`}>
                  {z.minPressureMPa.toFixed(2)}{z.porePressureMPa > 0 ? ` / ${z.porePressureMPa.toFixed(2)}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-muted-foreground space-y-0.5">
        <div>Давление = гидростатика фактического заполнения затрубья выше точки + трение выше точки при текущем расходе. Трение — послойно (раствор, буферы, порции цемента), с поправкой на эксцентриситет колонны.</div>
        <div>
          Эксцентриситет: {standoffSource === "profile"
            ? `по расчёту центрирования (средний отступ ${avgStandoffPct.toFixed(0)}%)`
            : `расчёт центрирования не выполнен — принят отступ 67% (минимум API RP 10D-2). Выполните расчёт на вкладке «Центрирование» для точного результата.`}
        </div>
        {!hasLayers && <div>Пласты с градиентами ГРП и поглощения не заданы — проверка только на забое. Добавьте пласты в исходных данных.</div>}
        {zoneChecks.some((z) => z.porePressureMPa > 0 && z.minPressureMPa < z.porePressureMPa) && (
          <div className="text-red-600">🔴 Статическое давление в затрубье опускается ниже пластового — риск проявления. Проверить плотность буферов и облегчённого цемента.</div>
        )}
      </div>
    </Card>
  );
}
