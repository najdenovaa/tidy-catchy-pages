import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { BufferFluid, SlurryInput } from "@/lib/cementing-calculations";

interface Props {
  buffers: BufferFluid[];
  slurries: SlurryInput[];
  annularVPM: number;
  displacementVolume: number;
  flowRate: number;
}

const fmt = (v: number, dec: number = 1) => v.toFixed(dec);

export default function PumpingSchedule({ buffers, slurries, annularVPM, displacementVolume, flowRate }: Props) {
  const stages: { name: string; fluid: string; rate: number; volume: number }[] = [];

  stages.push({ name: "Заполнение линий", fluid: "Техническая вода", rate: flowRate, volume: 1.0 });

  buffers.forEach((b) => {
    stages.push({ name: `Буфер: ${b.name}`, fluid: b.name, rate: flowRate, volume: b.volume });
  });

  slurries.forEach((s) => {
    const vol = annularVPM * s.height;
    if (vol > 0) {
      stages.push({ name: `Цемент: ${s.name}`, fluid: `${s.name} (ρ=${s.density})`, rate: flowRate, volume: vol });
    }
  });

  stages.push({ name: "Промывка линий", fluid: "Техническая вода", rate: flowRate, volume: 5.0 });
  stages.push({ name: "Продавка", fluid: "Техническая вода", rate: flowRate * 1.5, volume: displacementVolume * 0.72 });
  stages.push({ name: "Продавка (замедление)", fluid: "Техническая вода", rate: flowRate, volume: displacementVolume * 0.26 });
  stages.push({ name: "Посадка пробки", fluid: "Техническая вода", rate: flowRate * 0.5, volume: displacementVolume * 0.027 });

  let cumulative = 0;
  const stagesWithCum = stages.map((s) => {
    cumulative += s.volume;
    const time = s.rate > 0 ? s.volume / s.rate : 0;
    return { ...s, cumulative, time };
  });

  const totalTime = stagesWithCum.reduce((s, r) => s + r.time, 0);

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Таблица закачки жидкостей</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Стадия</TableHead>
                <TableHead className="text-xs">Жидкость</TableHead>
                <TableHead className="text-xs text-right">Расход, м³/мин</TableHead>
                <TableHead className="text-xs text-right">Объём, м³</TableHead>
                <TableHead className="text-xs text-right">Время, мин</TableHead>
                <TableHead className="text-xs text-right">Накопленный V, м³</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stagesWithCum.map((s, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm">{s.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.fluid}</TableCell>
                  <TableCell className="text-sm text-right">{fmt(s.rate)}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{fmt(s.volume)}</TableCell>
                  <TableCell className="text-sm text-right">{fmt(s.time)}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{fmt(s.cumulative)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell colSpan={4} className="text-sm">ИТОГО</TableCell>
                <TableCell className="text-sm text-right">{fmt(totalTime)}</TableCell>
                <TableCell className="text-sm text-right">{fmt(cumulative)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
