import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getSlurryHeight, annularVolumeForInterval } from "@/lib/cementing-calculations";
import type { BufferFluid, SlurryInput, DisplacementFluid, WellData } from "@/lib/cementing-calculations";

interface Props {
  buffers: BufferFluid[];
  slurries: SlurryInput[];
  annularVPM: number;
  displacementVolume: number;
  displacementFluids: DisplacementFluid[];
  casingDepthMD: number;
  wellData?: WellData;
}

const fmt = (v: number, dec: number = 1) => v.toFixed(dec);
const lpsToM3min = (lps: number) => lps * 0.06;

export default function PumpingSchedule({ buffers, slurries, annularVPM, displacementVolume, displacementFluids, casingDepthMD, wellData }: Props) {
  const compressionCoeff = Math.max(displacementFluids?.[0]?.compressionCoeff ?? 1.0, 1.0);
  const showRaw = compressionCoeff > 1.001;
  const rawDisplacementVolume = displacementVolume / compressionCoeff;

  type Stage = { name: string; fluid: string; rateLps: number; volume: number; rawVolume?: number };
  const stages: Stage[] = [];

  const defaultRate = displacementFluids.length > 0 && displacementFluids[0].flowRateSteps.length > 0
    ? displacementFluids[0].flowRateSteps[0].rateLps : 8;

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

  // 3. Цементные растворы — в порядке списка (первый по списку качается первым)
  slurries.forEach((s, origIdx) => {
    const height = getSlurryHeight(slurries, origIdx, casingDepthMD);
    const lastIdx = slurries.length - 1;
    const mdBot = origIdx === lastIdx ? casingDepthMD : slurries[origIdx + 1].topDepthMD;
    let vol = wellData
      ? annularVolumeForInterval(s.topDepthMD, mdBot, wellData.holeDiameter, wellData.casingOD, wellData.prevCasingID, wellData.prevCasingDepth, wellData.cavernCoeff, wellData.cavernIntervals)
      : annularVPM * height;
    if (origIdx === 0 && s.washVolume && s.washVolume > 0) vol += s.washVolume;
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

  // 5. Продавка — по порциям (с коэф. сжатия и без)
  const totalConfiguredDispVolume = displacementFluids.reduce(
    (sum, df) => sum + df.flowRateSteps.reduce((stepSum, step) => stepSum + step.volumeM3, 0),
    0
  );
  const totalDispStages = displacementFluids.reduce((sum, df) => sum + Math.max(df.flowRateSteps.length, 1), 0) || 1;
  const configuredDispScale = totalConfiguredDispVolume > 0 ? displacementVolume / totalConfiguredDispVolume : 1;
  const rawDispScale = totalConfiguredDispVolume > 0 ? rawDisplacementVolume / totalConfiguredDispVolume : 1;
  const fallbackDispStageVolume = totalConfiguredDispVolume > 0 ? 0 : displacementVolume / totalDispStages;
  const fallbackRawStageVolume = totalConfiguredDispVolume > 0 ? 0 : rawDisplacementVolume / totalDispStages;

  displacementFluids.forEach((df, dfIdx) => {
    const label = displacementFluids.length > 1 ? `${df.name} (порция ${dfIdx + 1})` : df.name;
    if (df.flowRateSteps.length > 0) {
      const totalStepVol = df.flowRateSteps.reduce((s, st) => s + st.volumeM3, 0);
      if (totalStepVol > 0) {
        df.flowRateSteps.forEach((step, si) => {
          if (step.volumeM3 > 0) {
            stages.push({ name: `Продавка: ${label} (режим ${si + 1})`, fluid: `${df.name} (${df.density} кг/м³)`, rateLps: step.rateLps, volume: step.volumeM3 * configuredDispScale, rawVolume: step.volumeM3 * rawDispScale });
          }
        });
      } else {
        df.flowRateSteps.forEach((step, si) => {
          stages.push({ name: `Продавка: ${label} (режим ${si + 1})`, fluid: `${df.name} (${df.density} кг/м³)`, rateLps: step.rateLps, volume: fallbackDispStageVolume, rawVolume: fallbackRawStageVolume });
        });
      }
    } else {
      stages.push({ name: `Продавка: ${label}`, fluid: `${df.name} (${df.density} кг/м³)`, rateLps: defaultRate, volume: fallbackDispStageVolume, rawVolume: fallbackRawStageVolume });
    }
  });

  // 6. СТОП
  stages.push({ name: "Фиксация «СТОП», проверка ЦКОД", fluid: "—", rateLps: 0, volume: 0 });
  stages.push({ name: "Промывка ЛВД, демонтаж ГЦУ", fluid: "Тех. вода", rateLps: 0, volume: 0 });

  // Накопление: основное (с коэф. сжатия) и параллельное "raw" (без коэф.) — стартует с момента продавки и тянется до конца
  let cumulative = 0;
  let cumTime = 0;
  let rawCumulative = 0;
  let rawCumTime = 0;
  let rawStarted = false;
  const stagesWithCum = stages.map((s) => {
    cumulative += s.volume;
    const rateM3min = lpsToM3min(s.rateLps);
    const time = rateM3min > 0 ? s.volume / rateM3min : (s.name.includes("Опрессовка") ? 10 : s.name.includes("СТОП") ? 15 : s.name.includes("демонтаж") ? 45 : 0);
    cumTime += time;

    const isDisp = s.rawVolume !== undefined;
    if (isDisp && !rawStarted) {
      rawStarted = true;
      // до продавки — все стадии одинаковые
      rawCumulative = cumulative - s.volume;
      rawCumTime = cumTime - time;
    }
    let rawVol: number | undefined;
    let rawTime: number | undefined;
    if (rawStarted && showRaw) {
      rawVol = isDisp ? s.rawVolume : s.volume;
      rawCumulative += rawVol!;
      rawTime = rateM3min > 0 ? rawVol! / rateM3min : time;
      rawCumTime += rawTime;
    }
    return {
      ...s,
      cumulative,
      time,
      cumTime,
      rawVol: rawStarted && showRaw ? rawVol : undefined,
      rawTime: rawStarted && showRaw ? rawTime : undefined,
      rawCumulative: rawStarted && showRaw ? rawCumulative : undefined,
      rawCumTime: rawStarted && showRaw ? rawCumTime : undefined,
    };
  });

  const totalTime = cumTime;
  const totalRawTime = showRaw ? rawCumTime : undefined;
  const totalRawCum = showRaw ? rawCumulative : undefined;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-lg">Порядок закачки технологических жидкостей</CardTitle>
      </CardHeader>
      <CardContent>
        {showRaw && (
          <div className="mb-3 text-xs text-muted-foreground">
            Коэф. сжатия = {compressionCoeff.toFixed(3)}. В скобках указаны значения <span className="font-medium">без учёта коэф. сжатия</span>.
          </div>
        )}
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
              {stagesWithCum.map((s, i) => {
                const hasRaw = s.rawVol !== undefined;
                const hasRawCum = s.rawCumulative !== undefined;
                return (
                  <TableRow key={i} className={s.name.startsWith("ЦР:") || s.name.startsWith("ЦР (") ? "bg-primary/5" : ""}>
                    <TableCell className="text-sm">{s.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.fluid}</TableCell>
                    <TableCell className="text-sm text-right">{s.rateLps > 0 ? fmt(s.rateLps, 1) : "—"}</TableCell>
                    <TableCell className="text-sm text-right font-medium">
                      {s.volume > 0 ? fmt(s.volume) : "—"}
                      {hasRaw && s.volume > 0 && (
                        <span className="text-muted-foreground font-normal"> ({fmt(s.rawVol!)})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-right">
                      {fmt(s.time)}
                      {hasRaw && s.time > 0 && (
                        <span className="text-muted-foreground"> ({fmt(s.rawTime!)})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-right">
                      {fmt(s.cumTime)}
                      {hasRawCum && (
                        <span className="text-muted-foreground"> ({fmt(s.rawCumTime!)})</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-right font-medium">
                      {s.volume > 0 ? fmt(s.cumulative) : "—"}
                      {hasRawCum && s.volume > 0 && (
                        <span className="text-muted-foreground font-normal"> ({fmt(s.rawCumulative!)})</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="font-semibold border-t-2 border-border">
                <TableCell colSpan={5} className="text-sm">ИТОГО: общее время работы</TableCell>
                <TableCell className="text-sm text-right">
                  {fmt(totalTime)}
                  {totalRawTime !== undefined && (
                    <span className="text-muted-foreground font-normal"> ({fmt(totalRawTime)})</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-right">
                  {fmt(cumulative)}
                  {totalRawCum !== undefined && (
                    <span className="text-muted-foreground font-normal"> ({fmt(totalRawCum)})</span>
                  )}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
