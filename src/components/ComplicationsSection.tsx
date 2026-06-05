import { useState, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { BlurInput } from "@/components/BlurInput";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, ShieldAlert, ShieldCheck, TrendingDown, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  calculateComplications,
  classifyLossIntensity,
  type ComplicationInputs,
  type ComplicationCalcParams,
  type ComplicationResult,
  type ComplicationType,
  type LossBehavior,
} from "@/lib/cement-plug-complications";
import type { PlugResults } from "@/lib/cement-plug-calculations";

function num(v: string): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

interface FluidData {
  density: number;
  pv: number;
  yp: number;
  gel10min: number;
}

interface Props {
  results: PlugResults | null;
  cement: FluidData;
  spacer: FluidData;
  wellFluid: FluidData;
  viscousPad: FluidData;
  hasViscousPad: boolean;
  spacerVolumeBelow: number;
  thickeningTimeMin: number;
  settingTimeStartMin: number;
  settingTimeEndMin: number;
}

export default function ComplicationsSection({
  results, cement, spacer, wellFluid, viscousPad, hasViscousPad,
  spacerVolumeBelow, thickeningTimeMin, settingTimeStartMin, settingTimeEndMin,
}: Props) {
  const [type, setType] = useState<ComplicationType>('loss');
  const [lossRate, setLossRate] = useState(10);
  const [zoneDepthMD, setZoneDepthMD] = useState(0);
  const [zoneDepthTVD, setZoneDepthTVD] = useState(0);
  const [zoneThickness, setZoneThickness] = useState(10);
  const [formationPressure, setFormationPressure] = useState(0);
  const [fluidType, setFluidType] = useState<'gas' | 'oil' | 'water'>('water');
  const [lossBehavior, setLossBehavior] = useState<LossBehavior>('stable');

  const toFluidProps = (f: FluidData) => ({
    densityGcm3: f.density,
    pvMPas: f.pv,
    ypPa: f.yp,
    gel10minPa: f.gel10min > 0 ? f.gel10min : f.yp * 3,
  });

  const cementProps = toFluidProps(cement);
  const spacerProps = toFluidProps(spacer);
  const wellFluidProps = toFluidProps(wellFluid);
  const viscousPadProps = toFluidProps(viscousPad);

  const complicationResult = useMemo<ComplicationResult | null>(() => {
    if (!results) return null;
    if (type === 'loss' && lossRate <= 0) return null;
    if (type === 'kick' && formationPressure <= 0) return null;

    const inputs: ComplicationInputs = {
      type,
      lossRateM3h: lossRate,
      lossBehavior,
      zoneDepthMD,
      zoneDepthTVD: zoneDepthTVD || zoneDepthMD,
      zoneThicknessM: zoneThickness,
      formationPressureMPa: formationPressure,
      formationFluidType: fluidType,
    };

    const params: ComplicationCalcParams = {
      annAreaM2: results.annArea,
      pipeAreaM2: results.pipeArea,
      boreDiamMm: results.boreDiamUsed,
      pipeODMm: results.pipeSectionsUsed?.[0]?.od ?? 89,
      plugLengthMD: results.plugLengthMD,
      plugTopMD: results.plugTopTVD,
      plugBottomMD: results.plugBottomTVD,
      cementVolumeTotalM3: results.cementVolumeTotal,
      totalOperationTimeMin: results.totalOperationTimeMin,
      spacerVolumeBelowM3: spacerVolumeBelow,
      plugBottomTVD: results.plugBottomTVD,
      thickeningTimeMin,
      settingTimeStartMin,
      settingTimeEndMin,
      hasViscousPad,
      cement: cementProps,
      spacer: spacerProps,
      wellFluid: wellFluidProps,
      viscousPad: viscousPadProps,
    };

    return calculateComplications(inputs, params);
  }, [results, type, lossRate, lossBehavior, zoneDepthMD, zoneDepthTVD, zoneThickness, formationPressure, fluidType,
      cement.density, cement.pv, cement.yp, cement.gel10min,
      spacer.density, spacer.pv, spacer.yp, spacer.gel10min,
      wellFluid.density, wellFluid.pv, wellFluid.yp, wellFluid.gel10min,
      viscousPad.density, viscousPad.pv, viscousPad.yp, viscousPad.gel10min,
      hasViscousPad, spacerVolumeBelow, thickeningTimeMin, settingTimeStartMin, settingTimeEndMin]);

  const Field = ({ label, value, onChange, unit }: { label: string; value: number; onChange: (v: string) => void; unit?: string }) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}{unit ? ` (${unit})` : ""}</Label>
      <BlurInput type="number" step="any" value={value || ""} onValueCommit={onChange} className="h-8 text-xs" />
    </div>
  );

  const riskColor = (level: string) => {
    switch (level) {
      case 'low': return 'text-green-500';
      case 'medium': return 'text-amber-400';
      case 'high': return 'text-orange-500';
      case 'critical': return 'text-destructive';
      default: return 'text-muted-foreground';
    }
  };

  const riskBg = (level: string) => {
    switch (level) {
      case 'low': return 'bg-green-500/10 border-green-500/30';
      case 'medium': return 'bg-amber-500/10 border-amber-500/30';
      case 'high': return 'bg-orange-500/10 border-orange-500/30';
      case 'critical': return 'bg-destructive/10 border-destructive/30';
      default: return 'bg-muted';
    }
  };

  const riskLabel = (level: string) => {
    switch (level) {
      case 'low': return 'Низкий';
      case 'medium': return 'Умеренный';
      case 'high': return 'Высокий';
      case 'critical': return 'Критический';
      default: return '';
    }
  };

  const intensityLabel = classifyLossIntensity(lossRate);
  const intensityText = intensityLabel === 'partial' ? 'Частичное (≤5 м³/ч)' : intensityLabel === 'intense' ? 'Интенсивное (5–15 м³/ч)' : 'Катастрофическое (>15 м³/ч)';

  return (
    <div className="space-y-3">
      {/* Inputs */}
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            Параметры осложнения
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Тип осложнения</Label>
            <RadioGroup value={type} onValueChange={v => setType(v as ComplicationType)} className="flex flex-wrap gap-4">
              <div className="flex items-center space-x-1.5">
                <RadioGroupItem value="loss" id="comp-loss" />
                <Label htmlFor="comp-loss" className="text-xs cursor-pointer flex items-center gap-1">
                  <TrendingDown className="w-3.5 h-3.5" /> Поглощение
                </Label>
              </div>
              <div className="flex items-center space-x-1.5">
                <RadioGroupItem value="kick" id="comp-kick" />
                <Label htmlFor="comp-kick" className="text-xs cursor-pointer flex items-center gap-1">
                  <Droplets className="w-3.5 h-3.5" /> Проявление
                </Label>
              </div>
              <div className="flex items-center space-x-1.5">
                <RadioGroupItem value="both" id="comp-both" />
                <Label htmlFor="comp-both" className="text-xs cursor-pointer flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5" /> Оба
                </Label>
              </div>
            </RadioGroup>
          </div>

          <Separator />

          {(type === 'loss' || type === 'both') && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground">Поглощение</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Field label="Интенсивность" value={lossRate} onChange={v => setLossRate(num(v))} unit="м³/ч" />
                <div className="space-y-1">
                  <Label className="text-xs">Категория</Label>
                  <div className={`h-8 flex items-center text-xs font-semibold ${
                    intensityLabel === 'partial' ? 'text-amber-400' : intensityLabel === 'intense' ? 'text-orange-500' : 'text-destructive'
                  }`}>{intensityText}</div>
                </div>
                <div className="space-y-1 col-span-2 sm:col-span-2">
                  <Label className="text-xs">Характер поглощения</Label>
                  <RadioGroup value={lossBehavior} onValueChange={v => setLossBehavior(v as LossBehavior)} className="flex flex-wrap gap-3 h-8 items-center">
                    <div className="flex items-center space-x-1">
                      <RadioGroupItem value="stable" id="loss-stable" />
                      <Label htmlFor="loss-stable" className="text-[11px] cursor-pointer">Стабильное</Label>
                    </div>
                    <div className="flex items-center space-x-1">
                      <RadioGroupItem value="progressive" id="loss-progressive" />
                      <Label htmlFor="loss-progressive" className="text-[11px] cursor-pointer">Прогрессирующее</Label>
                    </div>
                    <div className="flex items-center space-x-1">
                      <RadioGroupItem value="regressive" id="loss-regressive" />
                      <Label htmlFor="loss-regressive" className="text-[11px] cursor-pointer">Регрессирующее</Label>
                    </div>
                  </RadioGroup>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground">Зона осложнения</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Field label="Глубина зоны" value={zoneDepthMD} onChange={v => setZoneDepthMD(num(v))} unit="м MD" />
              <Field label="Глубина зоны" value={zoneDepthTVD} onChange={v => setZoneDepthTVD(num(v))} unit="м TVD" />
              <Field label="Мощность пласта" value={zoneThickness} onChange={v => setZoneThickness(num(v))} unit="м" />
            </div>
          </div>

          {(type === 'kick' || type === 'both') && (
            <div className="space-y-2">
              <Separator />
              <p className="text-[10px] font-semibold text-muted-foreground">Проявление</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Field label="Пластовое давление" value={formationPressure} onChange={v => setFormationPressure(num(v))} unit="МПа" />
                <div className="space-y-1">
                  <Label className="text-xs">Тип флюида</Label>
                  <RadioGroup value={fluidType} onValueChange={v => setFluidType(v as 'gas' | 'oil' | 'water')} className="flex gap-3 mt-1">
                    <div className="flex items-center space-x-1">
                      <RadioGroupItem value="gas" id="fl-gas" />
                      <Label htmlFor="fl-gas" className="text-[10px] cursor-pointer">Газ</Label>
                    </div>
                    <div className="flex items-center space-x-1">
                      <RadioGroupItem value="oil" id="fl-oil" />
                      <Label htmlFor="fl-oil" className="text-[10px] cursor-pointer">Нефть</Label>
                    </div>
                    <div className="flex items-center space-x-1">
                      <RadioGroupItem value="water" id="fl-water" />
                      <Label htmlFor="fl-water" className="text-[10px] cursor-pointer">Вода</Label>
                    </div>
                  </RadioGroup>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Плотность промывки (из данных): {wellFluid.density.toFixed(2)} г/см³ →
                давление на забое: {(wellFluid.density * 1000 * 9.81 * (zoneDepthTVD || zoneDepthMD) / 1e6).toFixed(2)} МПа
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {complicationResult && (
        <Card className={`border-2 ${
          complicationResult.riskLevel === 'low' ? 'border-green-500/40' :
          complicationResult.riskLevel === 'medium' ? 'border-amber-500/40' :
          complicationResult.riskLevel === 'high' ? 'border-orange-500/40' :
          'border-destructive/60'
        }`}>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              {complicationResult.riskLevel === 'critical' || complicationResult.riskLevel === 'high'
                ? <ShieldAlert className="w-4 h-4 text-destructive" />
                : <ShieldCheck className="w-4 h-4 text-amber-400" />
              }
              Анализ осложнений
              <Badge
                variant={complicationResult.riskLevel === 'low' ? 'default' : complicationResult.riskLevel === 'critical' ? 'destructive' : 'secondary'}
                className="text-[10px]"
              >
                Риск: {riskLabel(complicationResult.riskLevel)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {/* Time analysis */}
            {(complicationResult.thickeningTimeMin > 0 || complicationResult.settingTimeStartMin > 0) && (
              <div className={`rounded-lg border p-3 space-y-2 ${
                complicationResult.operationOverlapsSetting || !complicationResult.isTimeWithinThickening
                  ? 'border-destructive/50 bg-destructive/5'
                  : complicationResult.timeMarginMin < 15
                    ? 'border-amber-500/50 bg-amber-500/5'
                    : 'border-border'
              }`}>
                <p className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                  ⏱ Анализ времени операции
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                  <span className="text-muted-foreground">Время операции:</span>
                  <span className="font-semibold">{complicationResult.totalOperationTimeMin.toFixed(1)} мин</span>
                  {complicationResult.thickeningTimeMin > 0 && (
                    <>
                      <span className="text-muted-foreground">Загустевание (50Bc):</span>
                      <span>{complicationResult.thickeningTimeMin.toFixed(0)} мин</span>
                      <span className="text-muted-foreground">Безопасное время (0.75×):</span>
                      <span>{complicationResult.safeTimeMin.toFixed(0)} мин</span>
                      <span className="text-muted-foreground font-semibold">Запас времени:</span>
                      <span className={`font-bold ${complicationResult.timeMarginMin < 0 ? 'text-destructive' : complicationResult.timeMarginMin < 15 ? 'text-amber-400' : 'text-green-500'}`}>
                        {complicationResult.timeMarginMin.toFixed(0)} мин
                      </span>
                    </>
                  )}
                  {complicationResult.settingTimeStartMin > 0 && (
                    <>
                      <Separator className="col-span-2 my-1" />
                      <span className="text-muted-foreground">Начало схватывания (в статике):</span>
                      <span>{complicationResult.settingTimeStartMin.toFixed(0)} мин</span>
                      {complicationResult.settingTimeEndMin > 0 && (
                        <>
                          <span className="text-muted-foreground">Конец схватывания (в статике):</span>
                          <span>{complicationResult.settingTimeEndMin.toFixed(0)} мин</span>
                        </>
                      )}
                      <span className="text-muted-foreground">От замеса до начала схватывания:</span>
                      <span className="font-semibold">
                        {(complicationResult.totalOperationTimeMin + complicationResult.settingTimeStartMin).toFixed(0)} мин
                      </span>
                      {complicationResult.settingTimeStartMin < 30 && (
                        <>
                          <span className="text-muted-foreground font-semibold">⚠ Запас в статике:</span>
                          <span className="font-bold text-amber-400">
                            {complicationResult.settingTimeStartMin.toFixed(0)} мин — мало!
                          </span>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
            {/* Loss analysis */}
            {(type === 'loss' || type === 'both') && (
              <div className="rounded-lg border border-border p-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                  <TrendingDown className="w-3.5 h-3.5" /> Потери цемента при поглощении
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                  <span className="text-muted-foreground">Время заполнения затрубья:</span>
                  <span>{complicationResult.fillTimeMin.toFixed(1)} мин</span>
                  <span className="text-muted-foreground">Потери в пласт:</span>
                  <span className="text-amber-400 font-semibold">{complicationResult.volumeLostM3.toFixed(3)} м³</span>
                  <span className="text-muted-foreground">Реальный объём цемента:</span>
                  <span>{complicationResult.realCementVolumeM3.toFixed(3)} м³</span>

                  <Separator className="col-span-2 my-1" />

                  <span className="text-muted-foreground font-semibold">Проектный интервал моста:</span>
                  <span>{complicationResult.designedPlugTopMD.toFixed(1)} — {complicationResult.designedPlugBottomMD.toFixed(1)} м ({complicationResult.designedPlugLengthM.toFixed(1)} м)</span>
                  {complicationResult.hasViscousPadBelow && complicationResult.padHeightMD > 0 && (
                    <>
                      <span className="text-muted-foreground">  • вязкая пачка снизу:</span>
                      <span className="text-blue-400">{(complicationResult.designedPlugBottomMD - complicationResult.padHeightMD).toFixed(1)} — {complicationResult.designedPlugBottomMD.toFixed(1)} м ({complicationResult.padHeightMD.toFixed(1)} м)</span>
                    </>
                  )}
                  <span className="text-muted-foreground font-semibold">Реальный интервал моста:</span>
                  <span className={`font-bold ${complicationResult.lossPercentage > 30 ? 'text-destructive' : complicationResult.lossPercentage > 15 ? 'text-amber-400' : 'text-green-500'}`}>
                    {complicationResult.realPlugTopMD.toFixed(1)} — {complicationResult.realPlugBottomMD.toFixed(1)} м ({complicationResult.realPlugLengthM.toFixed(1)} м)
                  </span>
                  {complicationResult.hasViscousPadBelow && (
                    <>
                      <span className="text-muted-foreground">  • цемент (реальный):</span>
                      <span>{complicationResult.realPlugTopMD.toFixed(1)} — {complicationResult.realCementBottomMD.toFixed(1)} м</span>
                      <span className="text-muted-foreground">  • пачка (реальная):</span>
                      <span className="text-blue-400">{complicationResult.realPadTopMD.toFixed(1)} — {complicationResult.realPadBottomMD.toFixed(1)} м</span>
                    </>
                  )}
                  <span className="text-muted-foreground">Потеряно:</span>
                  <span className={`font-semibold ${complicationResult.lossPercentage > 30 ? 'text-destructive' : 'text-amber-400'}`}>
                    {complicationResult.lossPercentage.toFixed(1)}%
                  </span>

                  {complicationResult.contaminationDepthM > 0 && (
                    <>
                      <span className="text-muted-foreground">Загрязнение низа цемента:</span>
                      <span className="text-amber-400">~{complicationResult.contaminationDepthM.toFixed(1)} м</span>
                      <span className="text-muted-foreground font-semibold">Чистый цемент (рабочий мост):</span>
                      <span className="text-green-500 font-semibold">
                        {complicationResult.cleanPlugTopMD.toFixed(1)} — {complicationResult.cleanPlugBottomMD.toFixed(1)} м
                      </span>
                    </>
                  )}
                </div>

                {/* Visual bar */}
                <div className="mt-2">
                  <p className="text-[10px] text-muted-foreground mb-1">Проектный vs реальный мост:</p>
                  <div className="flex gap-1 items-center">
                    <div className="flex-1 h-5 bg-muted rounded overflow-hidden relative">
                      <div
                        className="h-full bg-primary/60 rounded"
                        style={{ width: '100%' }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-primary-foreground">
                        Проектный: {complicationResult.designedPlugLengthM.toFixed(0)} м
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 items-center mt-0.5">
                    <div className="flex-1 h-5 bg-muted rounded overflow-hidden relative">
                      <div
                        className={`h-full rounded ${complicationResult.lossPercentage > 30 ? 'bg-destructive/60' : 'bg-amber-500/60'}`}
                        style={{ width: `${Math.max(5, 100 - complicationResult.lossPercentage)}%` }}
                      />
                      <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-foreground">
                        Реальный: {complicationResult.realPlugLengthM.toFixed(0)} м (−{complicationResult.lossPercentage.toFixed(0)}%)
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Kick analysis */}
            {(type === 'kick' || type === 'both') && (
              <div className="rounded-lg border border-border p-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                  <Droplets className="w-3.5 h-3.5" /> Анализ проявления
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                  <span className="text-muted-foreground">Гидростатика цемента на забое:</span>
                  <span>{complicationResult.cementHydrostaticMPa.toFixed(2)} МПа</span>
                  <span className="text-muted-foreground">Пластовое давление:</span>
                  <span>{formationPressure.toFixed(2)} МПа</span>
                  <span className="text-muted-foreground font-semibold">ΔP (пласт − гидростатика):</span>
                  <span className={`font-bold ${complicationResult.kickCanBreakThrough ? 'text-destructive' : 'text-green-500'}`}>
                    {complicationResult.pressureDifferenceMPa.toFixed(2)} МПа
                  </span>
                  <span className="text-muted-foreground">Прорыв притока:</span>
                  <span className={`font-semibold ${complicationResult.kickCanBreakThrough ? 'text-destructive' : 'text-green-500'}`}>
                    {complicationResult.kickCanBreakThrough ? 'ДА ⛔' : 'НЕТ ✅'}
                  </span>
                  {complicationResult.kickCanBreakThrough && (
                    <>
                      <span className="text-muted-foreground">Требуемая плотность цемента:</span>
                      <span className="text-amber-400 font-semibold">≥{complicationResult.requiredCementDensityGcm3.toFixed(2)} г/см³</span>
                      <Separator className="col-span-2 my-1" />
                      <span className="text-muted-foreground font-semibold">Проектный интервал моста:</span>
                      <span>{complicationResult.designedPlugTopMD.toFixed(1)} — {complicationResult.designedPlugBottomMD.toFixed(1)} м</span>
                      <span className="text-muted-foreground font-semibold">Реальный интервал (после прорыва):</span>
                      <span className="text-destructive font-bold">
                        {complicationResult.realPlugTopMD.toFixed(1)} — {complicationResult.realPlugBottomMD.toFixed(1)} м
                      </span>
                      <span className="text-muted-foreground">Внедрение пластового флюида:</span>
                      <span className="text-destructive">~{(complicationResult.designedPlugBottomMD - complicationResult.realPlugBottomMD).toFixed(1)} м</span>
                      <span className="text-muted-foreground font-semibold">Чистый цемент (рабочий мост):</span>
                      <span className="text-green-500 font-semibold">
                        {complicationResult.cleanPlugTopMD.toFixed(1)} — {complicationResult.cleanPlugBottomMD.toFixed(1)} м
                      </span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Corrected volumes */}
            {(type === 'loss' || type === 'both') && (
              <div className="rounded-lg border border-primary/30 p-3 space-y-1">
                <p className="text-[10px] font-semibold text-primary">📐 Скорректированные объёмы</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                  <span className="text-muted-foreground">Исходный объём цемента:</span>
                  <span>{results?.cementVolumeTotal.toFixed(3)} м³</span>
                  <span className="text-muted-foreground font-semibold">Рекомендуемый объём:</span>
                  <span className="text-primary font-bold">{complicationResult.correctedCementVolumeM3.toFixed(3)} м³</span>
                  <span className="text-muted-foreground">Доп. цемент (компенсация):</span>
                  <span className="text-amber-400">{(complicationResult.correctedCementVolumeM3 - (results?.cementVolumeTotal ?? 0)).toFixed(3)} м³</span>
                  {complicationResult.correctedSpacerBelowM3 > spacerVolumeBelow && (
                    <>
                      <span className="text-muted-foreground">Рекомендуемая вязкая пачка:</span>
                      <span className="text-primary font-bold">≥{complicationResult.correctedSpacerBelowM3.toFixed(3)} м³</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Recommendations */}
            <div className={`rounded-lg border p-3 space-y-1.5 ${riskBg(complicationResult.riskLevel)}`}>
              <p className={`text-xs font-semibold ${riskColor(complicationResult.riskLevel)}`}>
                📋 Рекомендации
              </p>
              {complicationResult.recommendations.map((rec, i) => (
                <p key={i} className="text-[10px] text-foreground/90">{rec}</p>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!results && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            Сначала выполните основной расчёт (кнопка <strong>РАСЧЁТ</strong>), затем задайте параметры осложнения
          </CardContent>
        </Card>
      )}
    </div>
  );
}
