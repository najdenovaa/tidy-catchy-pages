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

  // 1. Заполнение ЛВД
  stages.push({ name: "Заполнение ЛВД", fluid: "Тех. вода", rate: flowRate * 0.5, volume: 1.0 });
  // 2. Опрессовка ЛВД
  stages.push({ name: "Опрессовка ЛВД (25 МПа)", fluid: "—", rate: 0, volume: 0 });

  // 3. Буферы
  buffers.forEach((b) => {
    stages.push({ name: `Буфер: ${b.name}`, fluid: `${b.name} (${b.density} кг/м³)`, rate: flowRate, volume: b.volume });
  });

  // 4. Цементные растворы
  slurries.forEach((s) => {
    const vol = annularVPM * s.height;
    if (vol > 0) {
      stages.push({ name: `ЦР: ${s.name}`, fluid: `${s.name} (${s.density} г/см³)`, rate: flowRate, volume: vol });
    }
  });

  // 5. Промывка ЛВД и сброс пробки
  stages.push({ name: "Промывка ЛВД, сброс пробки", fluid: "Тех. вода", rate: flowRate * 0.5, volume: 1.5 });

  // 6. Продавка (3 этапа по PDF)
  const dvMain = displacementVolume * 0.50;
  const dvMid = displacementVolume * 0.30;
  const dvSlow = displacementVolume * 0.20;
  stages.push({ name: "Продавка (макс. расход)", fluid: "Тех. вода", rate: flowRate * 1.5, volume: dvMain });
  stages.push({ name: "Продавка (средний расход)", fluid: "Тех. вода", rate: flowRate, volume: dvMid });
  stages.push({ name: "Продавка (замедление, посадка)", fluid: "Тех. вода", rate: flowRate * 0.5, volume: dvSlow });

  // 7. СТОП
  stages.push({ name: "Фиксация «СТОП», проверка ЦКОД", fluid: "—", rate: 0, volume: 0 });
  stages.push({ name: "Промывка ЛВД, демонтаж ГЦУ", fluid: "Тех. вода", rate: 0, volume: 0 });

  let cumulative = 0;
  let cumTime = 0;
  const stagesWithCum = stages.map((s) => {
    cumulative += s.volume;
    const time = s.rate > 0 ? s.volume / s.rate : (s.name.includes("Опрессовка") ? 10 : s.name.includes("СТОП") ? 15 : s.name.includes("демонтаж") ? 45 : 0);
    cumTime += time;
    return { ...s, cumulative, time, cumTime };
  });

  const totalTime = cumTime;

  // Определить время работы с цементом (от начала первого ЦР до конца посадки пробки)
  const cementStartIdx = stagesWithCum.findIndex(s => s.name.startsWith("ЦР:"));
  const cementEndIdx = stagesWithCum.findIndex(s => s.name.includes("посадка"));
  let workTimeWithCement = 0;
  if (cementStartIdx >= 0 && cementEndIdx >= 0) {
    workTimeWithCement = stagesWithCum[cementEndIdx].cumTime - (cementStartIdx > 0 ? stagesWithCum[cementStartIdx - 1].cumTime : 0);
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">06. Порядок закачки технологических жидкостей</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Наименование этапа</TableHead>
                <TableHead className="text-xs">Жидкость</TableHead>
                <TableHead className="text-xs text-right">Произв-ть, м³/мин</TableHead>
                <TableHead className="text-xs text-right">Объём, м³</TableHead>
                <TableHead className="text-xs text-right">Время стадии, мин</TableHead>
                <TableHead className="text-xs text-right">Общее время, мин</TableHead>
                <TableHead className="text-xs text-right">Накопит. V, м³</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stagesWithCum.map((s, i) => (
                <TableRow key={i} className={s.name.startsWith("ЦР:") ? "bg-primary/5" : ""}>
                  <TableCell className="text-sm">{s.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.fluid}</TableCell>
                  <TableCell className="text-sm text-right">{s.rate > 0 ? fmt(s.rate, 2) : "—"}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{s.volume > 0 ? fmt(s.volume) : "—"}</TableCell>
                  <TableCell className="text-sm text-right">{fmt(s.time)}</TableCell>
                  <TableCell className="text-sm text-right">{fmt(s.cumTime)}</TableCell>
                  <TableCell className="text-sm text-right font-medium">{s.volume > 0 ? fmt(s.cumulative) : "—"}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold border-t-2 border-border">
                <TableCell colSpan={5} className="text-sm">ИТОГО: общее время работы</TableCell>
                <TableCell className="text-sm text-right">{fmt(totalTime)}</TableCell>
                <TableCell className="text-sm text-right">{fmt(cumulative)}</TableCell>
              </TableRow>
              {workTimeWithCement > 0 && (
                <TableRow className="font-semibold">
                  <TableCell colSpan={5} className="text-sm text-primary">ИТОГО: время работы с цементом</TableCell>
                  <TableCell className="text-sm text-right text-primary">{fmt(workTimeWithCement)}</TableCell>
                  <TableCell></TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// Экспортируем функцию для вычисления рабочего времени с цементом
export function getWorkTimeWithCement(
  buffers: BufferFluid[], slurries: SlurryInput[], annularVPM: number, displacementVolume: number, flowRate: number
): number {
  let time = 0;
  slurries.forEach(s => {
    const vol = annularVPM * s.height;
    if (vol > 0 && flowRate > 0) time += vol / flowRate;
  });
  // Промывка
  if (flowRate > 0) time += 1.5 / (flowRate * 0.5);
  // Продавка
  const dvMain = displacementVolume * 0.50;
  const dvMid = displacementVolume * 0.30;
  const dvSlow = displacementVolume * 0.20;
  if (flowRate > 0) {
    time += dvMain / (flowRate * 1.5);
    time += dvMid / flowRate;
    time += dvSlow / (flowRate * 0.5);
  }
  return time;
}
