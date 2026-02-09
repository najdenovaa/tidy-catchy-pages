import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { calculateHydraulics, calculateBHCT } from "@/lib/cementing-calculations";
import type { WellData, CementSlurry, SlurryInput } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  fractureGradient: number;
  onFractureGradientChange: (v: number) => void;
}

const fmt = (v: number, dec: number = 2) => v.toFixed(dec);

export default function HydraulicsSection({ wellData, slurries, fractureGradient, onFractureGradientChange }: Props) {
  const heavyCement: CementSlurry = slurries.length > 0
    ? { ...slurries[slurries.length - 1], waterRatio: 0 }
    : { name: "", density: 1.9, height: 0, waterRatio: 0 };

  const lightCement: CementSlurry | null = slurries.length > 1
    ? { ...slurries[0], waterRatio: 0 }
    : null;

  const results = calculateHydraulics(wellData, lightCement, heavyCement, fractureGradient);
  const bhct = calculateBHCT(wellData.bottomTemp, 20, wellData.wellDepthTVD);

  const rows = [
    { label: "Гидростатика в трубном у башмака", value: fmt(results.hydrostaticPressurePipe), unit: "МПа" },
    { label: "Гидростатика в затрубном у башмака", value: fmt(results.hydrostaticPressureAnnulus), unit: "МПа" },
    { label: "Давление гидроразрыва", value: fmt(results.fracturePressure), unit: "МПа" },
    { label: "Коэффициент безопасности", value: fmt(results.safetyCoefficient, 3), unit: "" },
    { label: "Макс. рабочее давление", value: fmt(results.maxWorkPressure), unit: "МПа" },
    { label: "Давление «СТОП»", value: fmt(results.stopPressure), unit: "МПа" },
    { label: "BHCT (забойная циркуляц.)", value: fmt(bhct, 1), unit: "°C" },
  ];

  const safetyOk = results.safetyCoefficient < 1;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Гидравлический расчёт</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 max-w-xs">
          <Label className="text-xs text-muted-foreground">Градиент гидроразрыва, кПа/м</Label>
          <Input
            type="number"
            step="0.1"
            value={fractureGradient || ""}
            onChange={(e) => onFractureGradientChange(parseFloat(e.target.value) || 0)}
            className="h-9 text-sm"
          />
        </div>

        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <span className="text-sm text-muted-foreground">{r.label}</span>
              <span className="text-sm font-semibold">
                {r.value} <span className="text-muted-foreground font-normal">{r.unit}</span>
              </span>
            </div>
          ))}
        </div>

        <div className={`p-3 rounded-lg text-sm font-medium ${safetyOk ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"}`}>
          {safetyOk
            ? "✓ Коэффициент безопасности в норме (< 1.0)"
            : "⚠ Коэффициент безопасности превышает 1.0 — риск гидроразрыва!"}
        </div>
      </CardContent>
    </Card>
  );
}
