import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calculateHydraulics, calculateSafeTime, calculateBHCT } from "@/lib/cementing-calculations";
import type { WellData, SlurryInput } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  fractureGradient: number;
  onFractureGradientChange: (v: number) => void;
  displacementDensity: number;
  workTimeWithCement: number;
}

const fmt = (v: number, dec: number = 2) => v.toFixed(dec);

export default function HydraulicsSection({ wellData, slurries, fractureGradient, onFractureGradientChange, displacementDensity, workTimeWithCement }: Props) {
  const results = calculateHydraulics(wellData, slurries, displacementDensity / 1000, fractureGradient);
  const bhct = calculateBHCT(wellData.bottomTempStatic, 20, wellData.wellDepthTVD);

  // Безопасное время
  const maxThickening30 = Math.max(...slurries.map(s => s.thickeningTime30Bc || 0));
  const maxThickening50 = Math.max(...slurries.map(s => s.thickeningTime50Bc || 0));
  const safeTime = calculateSafeTime(workTimeWithCement, maxThickening30, maxThickening50);

  const pressureRows = [
    { label: "Гидростатическое давление ЦР (затрубное)", value: fmt(results.hydrostaticPressureAnnulus), unit: "МПа" },
    { label: "Гидростатическое давление продавочной жидкости", value: fmt(results.hydrostaticPressurePipe), unit: "МПа" },
    { label: "Разница давлений на ЦКОД", value: fmt(results.differentialPressure), unit: "МПа" },
    { label: "Давление ГРП", value: fmt(results.fracturePressure), unit: "МПа" },
    { label: "Коэффициент безопасности", value: fmt(results.safetyCoefficient, 3), unit: "" },
    { label: "Расчётное давление «СТОП»", value: fmt(results.stopPressure), unit: "МПа" },
    { label: "BHCT", value: fmt(bhct, 1), unit: "°C" },
  ];

  const safetyOk = results.safetyCoefficient < 1;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">08. Гидравлический расчёт</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1 max-w-xs">
            <Label className="text-xs text-muted-foreground">Градиент гидроразрыва, кПа/м</Label>
            <Input type="number" step="0.1" value={fractureGradient || ""} onChange={(e) => onFractureGradientChange(parseFloat(e.target.value) || 0)} className="h-9 text-sm" />
          </div>

          <div className="space-y-1">
            {pressureRows.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="text-sm text-muted-foreground">{r.label}</span>
                <span className="text-sm font-semibold">
                  {r.value} <span className="text-muted-foreground font-normal">{r.unit}</span>
                </span>
              </div>
            ))}
          </div>

          <div className={`p-3 rounded-lg text-sm font-medium ${safetyOk ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"}`}>
            {safetyOk ? "✓ Коэффициент безопасности в норме (< 1.0)" : "⚠ Коэффициент безопасности превышает 1.0 — риск гидроразрыва!"}
          </div>
        </CardContent>
      </Card>

      {/* Безопасное время */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Безопасное время работы с цементом</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Расчётное время работы с цементом</span>
              <span className="text-sm font-semibold">{fmt(safeTime.workTimeWithCement, 0)} мин</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Безопасное время (75% от загуст.)</span>
              <span className="text-sm font-semibold">{safeTime.safeTime75} мин</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Загустевание до 30 Вс (лаб.)</span>
              <span className="text-sm font-semibold">{safeTime.thickeningTime30Bc || "—"} мин</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Загустевание до 50 Вс (лаб.)</span>
              <span className="text-sm font-semibold">{safeTime.thickeningTime50Bc || "—"} мин</span>
            </div>
          </div>
          {maxThickening30 > 0 && (
            <div className={`mt-3 p-3 rounded-lg text-sm font-medium ${safeTime.isSafe ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"}`}>
              {safeTime.isSafe
                ? `✓ Загустевание (${maxThickening30} мин) > безопасное время (${safeTime.safeTime75} мин)`
                : `⚠ Загустевание (${maxThickening30} мин) < безопасное время (${safeTime.safeTime75} мин) — ОПАСНО!`}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
