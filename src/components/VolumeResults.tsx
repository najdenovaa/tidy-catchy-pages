import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VolumeResults as VR, WellData } from "@/lib/cementing-calculations";
import { getCasingID } from "@/lib/cementing-calculations";

interface Props {
  results: VR;
  wellData: WellData;
}

const fmt = (v: number, dec: number = 4) => v.toFixed(dec);

export default function VolumeResults({ results, wellData }: Props) {
  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);
  const openHoleInterval = wellData.casingDepthMD - wellData.prevCasingDepth;

  const sections = [
    {
      title: "Геометрия",
      rows: [
        { label: "Внутренний диаметр ОК", value: fmt(results.casingID, 1), unit: "мм" },
        { label: "Эквивалентный диаметр (с каверн.)", value: fmt(results.equivalentDiameter, 1), unit: "мм" },
      ],
    },
    {
      title: "Погонные объёмы",
      rows: [
        { label: `Межтрубное пр-во (0 — ${wellData.prevCasingDepth} м)`, value: fmt(results.annularVolumePerMeterPrevCasing), unit: "м³/м" },
        { label: `Затрубное пр-во (${wellData.prevCasingDepth} — ${wellData.casingDepthMD} м)`, value: fmt(results.annularVolumePerMeter), unit: "м³/м" },
        { label: `Внутр. объём колонны (0 — ${wellData.casingDepthMD} м)`, value: fmt(results.pipeVolumePerMeter), unit: "м³/м" },
        { label: `Открытый ствол (${wellData.casingDepthMD} — ${wellData.wellDepthMD} м)`, value: fmt(results.openHoleVolumePerMeter), unit: "м³/м" },
      ],
    },
    {
      title: "Итоговые объёмы",
      rows: [
        { label: "Общий V затрубного пр-ва", value: fmt(results.totalAnnularVolume, 2), unit: "м³" },
        { label: "Общий V трубного пр-ва", value: fmt(results.totalPipeVolume, 2), unit: "м³" },
        { label: "Расчётный объём продавки", value: fmt(results.displacementVolume, 1), unit: "м³" },
        { label: "С учётом коэф. сжатия (5%)", value: fmt(results.displacementVolumeWithCompression, 1), unit: "м³" },
      ],
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">07. Данные для расчёта</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {sections.map((section, si) => (
          <div key={si}>
            <h3 className="text-sm font-medium text-foreground mb-2">{section.title}</h3>
            <div className="space-y-1">
              {section.rows.map((r, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <span className="text-sm text-muted-foreground">{r.label}</span>
                  <span className="text-sm font-semibold">
                    {r.value} <span className="text-muted-foreground font-normal">{r.unit}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
