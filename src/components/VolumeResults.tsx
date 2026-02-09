import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VolumeResults as VR } from "@/lib/cementing-calculations";

interface Props {
  results: VR;
}

const fmt = (v: number, dec: number = 4) => v.toFixed(dec);

export default function VolumeResults({ results }: Props) {
  const rows = [
    { label: "V п.м. скважины", value: fmt(results.wellVolumePerMeter), unit: "м³/м" },
    { label: "V п.м. скважины (с каверн.)", value: fmt(results.wellVolumeWithCavern), unit: "м³/м" },
    { label: "V п.м. затрубного простр.", value: fmt(results.annularVolumePerMeter), unit: "м³/м" },
    { label: "V п.м. трубного простр.", value: fmt(results.pipeVolumePerMeter), unit: "м³/м" },
    { label: "Эквивалентный диаметр", value: fmt(results.equivalentDiameter, 2), unit: "мм" },
    { label: "Общий V затрубного простр.", value: fmt(results.totalAnnularVolume, 2), unit: "м³" },
    { label: "Общий V трубного простр.", value: fmt(results.totalPipeVolume, 2), unit: "м³" },
    { label: "Объём продавочной жидкости", value: fmt(results.displacementVolume, 2), unit: "м³" },
  ];

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Расчёт объёмов</CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
