import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { calculateHydraulics, calculateSafeTime, calculateBHCT } from "@/lib/cementing-calculations";
import type { WellData, SlurryInput, VolumeResults } from "@/lib/cementing-calculations";

interface Props {
  wellData: WellData;
  slurries: SlurryInput[];
  fractureGradient: number;
  displacementDensity: number;
  workTimeWithCement: number;
  volumes: VolumeResults;
}

const fmt = (v: number, dec: number = 2) => v.toFixed(dec);

export default function HydraulicsSection({ wellData, slurries, fractureGradient, displacementDensity, workTimeWithCement, volumes }: Props) {
  const results = calculateHydraulics(wellData, slurries, displacementDensity / 1000, fractureGradient);
  const bhct = calculateBHCT(wellData.bottomTempStatic, 20, wellData.wellDepthTVD);

  const maxThickening30 = Math.max(...slurries.map(s => s.thickeningTime30Bc || 0));
  const maxThickening50 = Math.max(...slurries.map(s => s.thickeningTime50Bc || 0));
  const safeTime = calculateSafeTime(workTimeWithCement, maxThickening30, maxThickening50);

  const volumeRows = [
    { label: "Внутренний диаметр ОК", value: fmt(volumes.casingID, 1), unit: "мм" },
    { label: "Эквивалентный диаметр (с каверн.)", value: fmt(volumes.equivalentDiameter, 1), unit: "мм" },
    { label: `Межтрубное пр-во`, value: fmt(volumes.annularVolumePerMeterPrevCasing, 4), unit: "м³/м" },
    { label: `Затрубное пр-во`, value: fmt(volumes.annularVolumePerMeter, 4), unit: "м³/м" },
    { label: `Внутр. объём колонны`, value: fmt(volumes.pipeVolumePerMeter, 4), unit: "м³/м" },
    { label: "Расчётный объём продавки", value: fmt(volumes.displacementVolume, 1), unit: "м³" },
    { label: "С учётом коэф. сжатия (5%)", value: fmt(volumes.displacementVolumeWithCompression, 1), unit: "м³" },
  ];

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
      {/* Объёмы */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Данные для расчёта (объёмы)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {volumeRows.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="text-sm text-muted-foreground">{r.label}</span>
                <span className="text-sm font-semibold">{r.value} <span className="text-muted-foreground font-normal">{r.unit}</span></span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Гидравлика */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Гидравлический расчёт</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            {pressureRows.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="text-sm text-muted-foreground">{r.label}</span>
                <span className="text-sm font-semibold">{r.value} <span className="text-muted-foreground font-normal">{r.unit}</span></span>
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
            <Row label="Расчётное время работы с цементом" value={`${fmt(safeTime.workTimeWithCement, 0)} мин`} />
            <Row label="Безопасное время (75% от загуст.)" value={`${safeTime.safeTime75} мин`} />
            <Row label="Загустевание до 30 Вс (лаб.)" value={safeTime.thickeningTime30Bc ? `${safeTime.thickeningTime30Bc} мин` : "—"} />
            <Row label="Загустевание до 50 Вс (лаб.)" value={safeTime.thickeningTime50Bc ? `${safeTime.thickeningTime50Bc} мин` : "—"} />
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}
