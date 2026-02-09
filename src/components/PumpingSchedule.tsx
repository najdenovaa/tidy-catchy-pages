import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSlurryHeight } from "@/lib/cementing-calculations";
import type { BufferFluid, SlurryInput, DisplacementFluid } from "@/lib/cementing-calculations";

interface Props {
  buffers: BufferFluid[];
  slurries: SlurryInput[];
  annularVPM: number;
  displacementVolume: number;
  displacement: DisplacementFluid;
  casingDepthMD: number;
}

const fmt = (v: number, dec: number = 1) => v.toFixed(dec);
const lpsToM3min = (lps: number) => lps * 0.06;

export default function PumpingSchedule({ buffers, slurries, annularVPM, displacementVolume, displacement, casingDepthMD }: Props) {
  const stages: { name: string; fluid: string; rateLps: number; volume: number }[] = [];

  const defaultRate = displacement.flowRateSteps.length > 0 ? displacement.flowRateSteps[0].rateLps : 8;

  // 1. Заполнение ЛВД
  stages.push({ name: "Заполнение ЛВД", fluid: "Тех. вода", rateLps: defaultRate * 0.5, volume: 1.0 });
  stages.push({ name: "Опрессовка ЛВД (25 МПа)", fluid: "—", rateLps: 0, volume: 0 });

  // 2. Буферы — по шагам
  buffers.forEach((b) => {
    if (b.flowRateSteps.length > 1) {
      b.flowRateSteps.forEach((step, si) => {
        if (step.volumeM3 > 0) {
          stages.push({ name: `${b.name} (режим ${si + 1})`, fluid: `${b.name} (${b.density} кг/м³)`, rateLps: step.rateLps, volume: step.volumeM3 });
        }
      });
    } else {
      const rate = b.flowRateSteps.length > 0 ? b.flowRateSteps[0].rateLps : 5;
      stages.push({ name: `Буфер: ${b.name}`, fluid: `${b.name} (${b.density} кг/м³)`, rateLps: rate, volume: b.volume });
    }
  });

  // 3. Цементные растворы — по шагам
  slurries.forEach((s, idx) => {
    const height = getSlurryHeight(slurries, idx, casingDepthMD);
    const vol = annularVPM * height;
    if (vol > 0) {
      if (s.flowRateSteps.length > 1) {
        s.flowRateSteps.forEach((step, si) => {
          if (step.volumeM3 > 0) {
            stages.push({ name: `${s.name} (режим ${si + 1})`, fluid: `${s.name} (${s.density} г/см³)`, rateLps: step.rateLps, volume: step.volumeM3 });
          }
        });
      } else {
        const rate = s.flowRateSteps.length > 0 ? s.flowRateSteps[0].rateLps : 5;
        stages.push({ name: `ЦР: ${s.name}`, fluid: `${s.name} (${s.density} г/см³)`, rateLps: rate, volume: vol });
      }
    }
  });

  // 4. Промывка ЛВД
  stages.push({ name: "Промывка ЛВД, сброс пробки", fluid: "Тех. вода", rateLps: defaultRate * 0.5, volume: 1.5 });

  // 5. Продавка — по шагам
  if (displacement.flowRateSteps.length > 0) {
    const totalStepVol = displacement.flowRateSteps.reduce((s, st) => s + st.volumeM3, 0);
    if (totalStepVol > 0) {
      // Используем указанные объёмы
      displacement.flowRateSteps.forEach((step, si) => {
        if (step.volumeM3 > 0) {
          stages.push({ name: `Продавка (режим ${si + 1})`, fluid: displacement.name, rateLps: step.rateLps, volume: step.volumeM3 });
        }
      });
    } else {
      // Объёмы не указаны — распределяем равномерно
      const perStep = displacementVolume / displacement.flowRateSteps.length;
      displacement.flowRateSteps.forEach((step, si) => {
        stages.push({ name: `Продавка (режим ${si + 1})`, fluid: displacement.name, rateLps: step.rateLps, volume: perStep });
      });
    }
  } else {
    stages.push({ name: "Продавка", fluid: displacement.name, rateLps: defaultRate, volume: displacementVolume });
  }

  // 6. СТОП
  stages.push({ name: "Фиксация «СТОП», проверка ЦКОД", fluid: "—", rateLps: 0, volume: 0 });
  stages.push({ name: "Промывка ЛВД, демонтаж ГЦУ", fluid: "Тех. вода", rateLps: 0, volume: 0 });

  let cumulative = 0;
  let cumTime = 0;
  const stagesWithCum = stages.map((s) => {
    cumulative += s.volume;
    const rateM3min = lpsToM3min(s.rateLps);
    const time = rateM3min > 0 ? s.volume / rateM3min : (s.name.includes("Опрессовка") ? 10 : s.name.includes("СТОП") ? 15 : s.name.includes("демонтаж") ? 45 : 0);
    cumTime += time;
    return { ...s, cumulative, time, cumTime };
  });

  const totalTime = cumTime;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Порядок закачки технологических жидкостей</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Наименование этапа</TableHead>
                <TableHead className="text-xs">Жидкость</TableHead>
                <TableHead className="text-xs text-right">Произв-ть, л/с</TableHead>
                <TableHead className="text-xs text-right">Объём, м³</TableHead>
                <TableHead className="text-xs text-right">Время стадии, мин</TableHead>
                <TableHead className="text-xs text-right">Общее время, мин</TableHead>
                <TableHead className="text-xs text-right">Накопит. V, м³</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stagesWithCum.map((s, i) => (
                <TableRow key={i} className={s.name.startsWith("ЦР:") || s.name.startsWith("ЦР (") ? "bg-primary/5" : ""}>
                  <TableCell className="text-sm">{s.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.fluid}</TableCell>
                  <TableCell className="text-sm text-right">{s.rateLps > 0 ? fmt(s.rateLps, 1) : "—"}</TableCell>
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
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
