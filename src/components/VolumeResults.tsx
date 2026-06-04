import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
        { label: "С учётом коэф. сжатия", value: fmt(results.displacementVolumeWithCompression, 1), unit: "м³" },
      ],
    },
  ];

  return (
    <div className="space-y-6">
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

      {/* Объёмы цементных растворов */}
      {results.slurryVolumes.length > 0 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">08. Объёмы цементных растворов</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Раствор</TableHead>
                    <TableHead className="text-xs text-right">Плотность, г/см³</TableHead>
                    <TableHead className="text-xs text-right">Интервал, м</TableHead>
                    <TableHead className="text-xs text-right">Высота, м</TableHead>
                    <TableHead className="text-xs text-right">Объём р-ра, м³</TableHead>
                    <TableHead className="text-xs text-right">Сухой цемент, т</TableHead>
                    <TableHead className="text-xs text-right">В/Ц</TableHead>
                    <TableHead className="text-xs text-right">Выход, м³/т</TableHead>
                    <TableHead className="text-xs text-right">Вода, м³</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.slurryVolumes.map((sv, i) => (
                    <TableRow key={i} className="bg-primary/5">
                      <TableCell className="text-sm font-medium">{sv.name}</TableCell>
                      <TableCell className="text-sm text-right">{sv.densityGcm3.toFixed(2)}</TableCell>
                      <TableCell className="text-sm text-right">{sv.topMD.toFixed(0)} — {sv.bottomMD.toFixed(0)}</TableCell>
                      <TableCell className="text-sm text-right">{sv.heightM.toFixed(0)}</TableCell>
                      <TableCell className="text-sm text-right font-semibold">{sv.slurryVolumeM3.toFixed(2)}</TableCell>
                      <TableCell className="text-sm text-right font-semibold">{sv.dryMassTons.toFixed(2)}</TableCell>
                      <TableCell className="text-sm text-right">{sv.waterCementRatio.toFixed(3)}</TableCell>
                      <TableCell className="text-sm text-right">{sv.yieldPerTon.toFixed(3)}</TableCell>
                      <TableCell className="text-sm text-right">{sv.waterVolumeM3.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  {results.slurryVolumes.length > 1 && (
                    <TableRow className="font-semibold border-t-2 border-border">
                      <TableCell className="text-sm">ИТОГО</TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-sm text-right">{results.totalSlurryVolume.toFixed(2)}</TableCell>
                      <TableCell className="text-sm text-right">{results.slurryVolumes.reduce((s, v) => s + v.dryMassTons, 0).toFixed(2)}</TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-sm text-right">{results.slurryVolumes.reduce((s, v) => s + v.waterVolumeM3, 0).toFixed(2)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}