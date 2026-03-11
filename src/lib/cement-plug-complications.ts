/**
 * Cement plug complications module.
 * Calculates real plug length under lost circulation or kick conditions.
 */

export type ComplicationType = 'loss' | 'kick' | 'both';
export type LossIntensity = 'partial' | 'intense' | 'catastrophic';

export interface ComplicationInputs {
  type: ComplicationType;
  /** Lost circulation intensity, m³/h */
  lossRateM3h: number;
  /** Depth of the loss/kick zone, m MD */
  zoneDepthMD: number;
  /** TVD of the loss/kick zone, m */
  zoneDepthTVD: number;
  /** Thickness of the problem zone, m */
  zoneThicknessM: number;
  /** Formation pressure at zone (for kicks), MPa */
  formationPressureMPa: number;
  /** Formation fluid type (for kicks) */
  formationFluidType: 'gas' | 'oil' | 'water';
}

export interface FluidProps {
  densityGcm3: number;
  pvMPas: number;
  ypPa: number;
  gel10minPa: number;
}

export interface ComplicationCalcParams {
  /** Annular area at plug, m² */
  annAreaM2: number;
  /** Pipe area, m² */
  pipeAreaM2: number;
  /** Bore diameter, mm */
  boreDiamMm: number;
  /** Pipe OD, mm */
  pipeODMm: number;
  /** Designed plug length MD, m */
  plugLengthMD: number;
  /** Plug top MD */
  plugTopMD: number;
  /** Plug bottom MD */
  plugBottomMD: number;
  /** Cement volume total, m³ */
  cementVolumeTotalM3: number;
  /** Total operation time (all stages), min */
  totalOperationTimeMin: number;
  /** Spacer volume below (viscous pad), m³ */
  spacerVolumeBelowM3: number;
  /** Plug bottom TVD, m */
  plugBottomTVD: number;
  /** Thickening time (50Bc), min */
  thickeningTimeMin: number;
  /** Setting time start (static), min */
  settingTimeStartMin: number;
  /** Setting time end (static), min */
  settingTimeEndMin: number;
  /** Is viscous pad used? */
  hasViscousPad: boolean;

  // Fluid properties
  cement: FluidProps;
  spacer: FluidProps;
  wellFluid: FluidProps;
  viscousPad: FluidProps;
}

export interface ComplicationResult {
  type: ComplicationType;
  lossIntensity: LossIntensity;

  // Loss calculations
  /** Time to fill plug in annulus, min */
  fillTimeMin: number;
  /** Volume lost to formation during placement, m³ */
  volumeLostM3: number;
  /** Real cement volume remaining, m³ */
  realCementVolumeM3: number;
  /** Real plug length, m */
  realPlugLengthM: number;
  /** Designed plug length, m */
  designedPlugLengthM: number;
  /** Percentage of plug lost */
  lossPercentage: number;
  /** Contamination depth at bottom, m */
  contaminationDepthM: number;

  // Kick calculations (when type = 'kick' or 'both')
  /** Hydrostatic pressure of cement column at zone, MPa */
  cementHydrostaticMPa: number;
  /** Net pressure difference (formation - hydrostatic), MPa */
  pressureDifferenceMPa: number;
  /** Can formation fluid break through the plug? */
  kickCanBreakThrough: boolean;
  /** Required cement density to hold formation pressure, g/cm³ */
  requiredCementDensityGcm3: number;

  // Corrected volumes
  /** Recommended cement volume with compensation, m³ */
  correctedCementVolumeM3: number;
  /** Recommended extra spacer below, m³ */
  correctedSpacerBelowM3: number;

  // Time analysis
  /** Total operation time, min */
  totalOperationTimeMin: number;
  /** Safe time (0.75 × thickening), min */
  safeTimeMin: number;
  /** Thickening time, min */
  thickeningTimeMin: number;
  /** Setting time start, min */
  settingTimeStartMin: number;
  /** Setting time end, min */
  settingTimeEndMin: number;
  /** Is operation within safe thickening time? */
  isTimeWithinThickening: boolean;
  /** Is operation within setting time window? */
  operationOverlapsSetting: boolean;
  /** Time margin before thickening, min */
  timeMarginMin: number;

  // Recommendations
  recommendations: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

const G = 9.81;

export function classifyLossIntensity(rateM3h: number): LossIntensity {
  if (rateM3h <= 5) return 'partial';
  if (rateM3h <= 15) return 'intense';
  return 'catastrophic';
}

export function calculateComplications(
  inputs: ComplicationInputs,
  params: ComplicationCalcParams
): ComplicationResult {
  const { type, lossRateM3h, zoneDepthTVD, formationPressureMPa, formationFluidType } = inputs;
  const intensity = classifyLossIntensity(lossRateM3h);

  // ═══ LOSS CALCULATIONS ═══
  const annArea = params.annAreaM2;
  const plugLenAnn = params.plugLengthMD;

  // Total time of the entire operation (all stages: spacer, cement, displacement, trip, wash)
  const totalOpTimeSec = params.totalOperationTimeMin * 60;

  // ── Factor 1: Density ratio ──
  // Heavier cement → higher hydrostatic → more losses
  const wellFluidDensity = params.wellFluidDensityGcm3;
  const cementDensity = params.cementDensityGcm3;
  const densityRatio = wellFluidDensity > 0 ? cementDensity / wellFluidDensity : 1;

  // ── Factor 2: Rheology resistance ──
  // Higher PV and YP → cement is more viscous → harder to flow into formation → fewer losses
  // Reference: typical cement PV=80, YP=8 → factor=1.0
  const refPV = 80;
  const refYP = 8;
  const pvVal = params.cementPV > 0 ? params.cementPV : refPV;
  const ypVal = params.cementYP > 0 ? params.cementYP : refYP;
  // Rheology factor: higher rheology = lower losses (inverse)
  // Combined rheology metric = PV + 5*YP (YP has stronger effect on flow resistance)
  const rheologyMetric = pvVal + 5 * ypVal;
  const refRheologyMetric = refPV + 5 * refYP;
  const rheologyFactor = refRheologyMetric / Math.max(rheologyMetric, 1); // <1 if cement is thicker

  // ── Factor 3: Gel strength (SNS) resistance ──
  // High gel strength builds "plug" resistance over time, reducing effective loss rate
  // Gel builds progressively: at time t, resistance ≈ gel10min × (t/10min)
  // Average gel resistance factor over operation time
  const gel10min = params.cementGel10minPa;
  const spacerGel10min = params.spacerGel10minPa;
  const avgGel = (gel10min + spacerGel10min) / 2;
  // Gel resistance reduces losses: higher gel → lower factor
  // Reference gel = 15 Pa (typical). Factor = ref / max(actual, ref)
  const refGel = 15;
  const gelFactor = avgGel > refGel ? refGel / avgGel : 1.0;

  // ── Factor 4: Thickening time ──
  // As cement approaches thickening, viscosity increases exponentially
  // This reduces loss rate over time. We model this as an average reduction.
  const thickTime = params.thickeningTimeMin;
  const totalOpTimeMin = params.totalOperationTimeMin;
  let thickeningFactor = 1.0;
  if (thickTime > 0 && totalOpTimeMin > 0) {
    // Ratio of operation time to thickening time
    // As operation approaches thickening, cement gets thicker → fewer losses
    // At t/Tt=0 → factor=1.0 (fully fluid); at t/Tt=0.75 → factor≈0.6; at t/Tt=1.0 → factor≈0.3
    const ratio = Math.min(totalOpTimeMin / thickTime, 1.0);
    // Average viscosity multiplier over operation: integral of (1 / (1 + 2*(t/Tt)^2)) from 0 to ratio
    // Simplified: average factor ≈ 1 - 0.7 * ratio²
    thickeningFactor = Math.max(0.3, 1 - 0.7 * ratio * ratio);
  }

  // ── Combined effective loss rate ──
  const effectiveLossRateM3h = lossRateM3h * densityRatio * rheologyFactor * gelFactor * thickeningFactor;

  // Volume lost during placement
  const lossRateM3s = effectiveLossRateM3h / 3600;
  const volumeLostM3 = lossRateM3s * totalOpTimeSec;

  // Real cement volume
  const realCementVol = Math.max(0, params.cementVolumeTotalM3 - volumeLostM3);
  const totalArea = annArea + params.pipeAreaM2;
  const realPlugLength = totalArea > 0 ? realCementVol / totalArea : 0;
  const lossPercent = params.cementVolumeTotalM3 > 0
    ? (volumeLostM3 / params.cementVolumeTotalM3) * 100
    : 0;

  // Contamination depth at bottom: cement diluted by formation water
  const contaminationDepth = Math.min(
    volumeLostM3 > 0 ? (volumeLostM3 / annArea) * 0.5 : 0,
    plugLenAnn * 0.3
  );

  // ═══ KICK CALCULATIONS ═══
  const plugBottomTVD = params.plugBottomTVD;
  const cementHydro = params.cementDensityGcm3 * 1000 * G * plugLenAnn / 1e6; // Simplified
  const cementHydroAtZone = params.cementDensityGcm3 * 1000 * G * plugBottomTVD / 1e6;

  // Net: formation pressure vs hydrostatic at zone
  const pressureDiff = formationPressureMPa - cementHydroAtZone;
  const kickBreakThrough = type !== 'loss' && pressureDiff > 0;

  // Required density to hold formation pressure
  const requiredDensity = plugBottomTVD > 0
    ? (formationPressureMPa * 1e6) / (1000 * G * plugBottomTVD) / 1000
    : params.cementDensityGcm3;

  // ═══ CORRECTED VOLUMES ═══
  const compensationFactor = 1.3; // 30% extra
  const correctedCement = params.cementVolumeTotalM3 + volumeLostM3 * compensationFactor;
  const correctedSpacerBelow = intensity === 'catastrophic'
    ? Math.max(params.spacerVolumeBelowM3, 0.5)
    : intensity === 'intense'
      ? Math.max(params.spacerVolumeBelowM3, 0.3)
      : params.spacerVolumeBelowM3;

  // ═══ TIME ANALYSIS ═══
  const totalOpTime = totalOpTimeMin;
  // thickTime and safeTime reuse values from loss section
  const safeTime = thickTime * 0.75;
  // Setting time is measured from STATIC (after operation stops), not from mixing
  const settingStartStatic = params.settingTimeStartMin; // minutes after cement stops moving
  const settingEndStatic = params.settingTimeEndMin;
  // Absolute timeline: setting starts at totalOpTime + settingStartStatic
  const settingStartAbsolute = settingStartStatic > 0 ? totalOpTime + settingStartStatic : 0;
  const settingEndAbsolute = settingEndStatic > 0 ? totalOpTime + settingEndStatic : 0;
  const timeMargin = safeTime - totalOpTime;
  const isTimeWithinThickening = totalOpTime <= safeTime;
  // Check if thickening happens before cement even starts to set (dangerous - cement thickens but doesn't set)
  const thickeningBeforeSetting = thickTime > 0 && settingStartStatic > 0 && thickTime < settingStartAbsolute;
  // Check if operation time is so long that cement may start setting in static zones while still pumping
  // This is NOT an issue since setting = static time, operation = dynamic time
  const operationOverlapsSetting = false; // Setting only starts AFTER operation ends, so no overlap possible

  // ═══ RECOMMENDATIONS ═══
  const recs: string[] = [];
  let riskLevel = 'low' as 'low' | 'medium' | 'high' | 'critical';

  // Time-based recommendations
  if (thickTime > 0) {
    if (!isTimeWithinThickening) {
      riskLevel = 'critical';
      recs.push(`⛔ ВРЕМЯ ОПЕРАЦИИ (${totalOpTime.toFixed(0)} мин) ПРЕВЫШАЕТ безопасное время загустевания (${safeTime.toFixed(0)} мин, 0.75×${thickTime.toFixed(0)})!`);
      recs.push(`Цемент начнёт загустевать ДО завершения операции. Необходимо ускорить процесс или использовать замедлитель.`);
    } else if (timeMargin < 15) {
      riskLevel = 'high';
      recs.push(`⚠ Запас времени до загустевания КРИТИЧЕСКИ МАЛ: ${timeMargin.toFixed(0)} мин (операция: ${totalOpTime.toFixed(0)} мин, безопасное: ${safeTime.toFixed(0)} мин).`);
    }
  }

  if (settingStartStatic > 0) {
    if (thickeningBeforeSetting) {
      // Thickening happens before setting even starts — cement may not properly harden
      riskLevel = 'critical';
      recs.push(`⛔ Загустевание (${thickTime.toFixed(0)} мин от замеса) наступит РАНЬШЕ начала схватывания (${settingStartAbsolute.toFixed(0)} мин от замеса = операция ${totalOpTime.toFixed(0)} + статика ${settingStartStatic.toFixed(0)} мин).`);
      recs.push(`Цемент потеряет подвижность, но не начнёт набирать прочность. Проверьте рецептуру!`);
    } else if (settingStartStatic < 30) {
      // Very short static time before setting — risky if need to re-do something
      if (riskLevel !== 'critical') riskLevel = 'medium';
      recs.push(`⚠ Начало схватывания через ${settingStartStatic.toFixed(0)} мин после остановки — мало времени на корректировку.`);
    }
    // Info about setting window
    recs.push(`🕐 Схватывание: начало через ${settingStartStatic.toFixed(0)} мин в статике (${settingStartAbsolute.toFixed(0)} мин от замеса)${settingEndStatic > 0 ? `, конец через ${settingEndStatic.toFixed(0)} мин (${settingEndAbsolute.toFixed(0)} мин от замеса)` : ''}.`);
  }

  if (type === 'loss' || type === 'both') {
    // Build factors note
    const factors: string[] = [];
    if (Math.abs(densityRatio - 1) > 0.05) factors.push(`ρ×${densityRatio.toFixed(2)}`);
    if (Math.abs(rheologyFactor - 1) > 0.05) factors.push(`реол.×${rheologyFactor.toFixed(2)}`);
    if (Math.abs(gelFactor - 1) > 0.05) factors.push(`СНС×${gelFactor.toFixed(2)}`);
    if (Math.abs(thickeningFactor - 1) > 0.05) factors.push(`загуст.×${thickeningFactor.toFixed(2)}`);
    const factorsNote = factors.length > 0 ? ` (эфф. ${effectiveLossRateM3h.toFixed(1)} м³/ч: ${factors.join(', ')})` : '';
    if (intensity === 'partial') {
      if (riskLevel === 'low') riskLevel = 'medium';
      recs.push(`Частичное поглощение (${lossRateM3h.toFixed(1)} м³/ч${factorsNote}). Потери цемента: ~${volumeLostM3.toFixed(2)} м³ (${lossPercent.toFixed(0)}%).`);
      recs.push(`Снизьте плотность промывочной жидкости до минимально допустимой перед закачкой моста.`);
      recs.push(`Увеличьте объём цемента на ${(volumeLostM3 * compensationFactor).toFixed(2)} м³ для компенсации потерь.`);
      recs.push(`Снизьте скорость закачки для уменьшения динамических потерь давления.`);
    } else if (intensity === 'intense') {
      if (riskLevel !== 'critical') riskLevel = 'high';
      recs.push(`Интенсивное поглощение (${lossRateM3h.toFixed(1)} м³/ч${factorsNote}). Потери цемента: ~${volumeLostM3.toFixed(2)} м³ (${lossPercent.toFixed(0)}%).`);
      recs.push(`Реальная длина моста: ${realPlugLength.toFixed(1)} м вместо ${plugLenAnn.toFixed(0)} м — потеряно ${lossPercent.toFixed(0)}%.`);
      recs.push(`ОБЯЗАТЕЛЬНО: закачайте ВИР/кольматант перед установкой моста.`);
      recs.push(`Увеличьте объём цемента на ${(volumeLostM3 * compensationFactor).toFixed(2)} м³.`);
      recs.push(`Используйте вязкую пачку (≥${correctedSpacerBelow.toFixed(1)} м³) снизу для создания «пробки» перед зоной поглощения.`);
      recs.push(`Снизьте скорость закачки до минимума (1.5–2 л/с).`);
    } else {
      riskLevel = 'critical';
      recs.push(`⛔ Катастрофическое поглощение (${lossRateM3h.toFixed(1)} м³/ч${factorsNote})! Потери: ~${volumeLostM3.toFixed(2)} м³ (${lossPercent.toFixed(0)}%).`);
      recs.push(`Реальная длина моста: ${realPlugLength.toFixed(1)} м — потеряно ${lossPercent.toFixed(0)}% цемента.`);
      recs.push(`Установка моста без предварительных мероприятий НЕВОЗМОЖНА.`);
      recs.push(`1. Закачайте ВИР/кольматант для ликвидации поглощения.`);
      recs.push(`2. Рассмотрите установку пакера/кольца ниже моста.`);
      recs.push(`3. При невозможности ликвидации — установите мост в 2 ступени.`);
      recs.push(`4. Используйте вязкую пачку ≥${correctedSpacerBelow.toFixed(1)} м³ с высоким СНС.`);
    }
  }

  if (type === 'kick' || type === 'both') {
    if (kickBreakThrough) {
      riskLevel = riskLevel === 'critical' ? 'critical' : 'high';
      recs.push(`⚠ ПРОЯВЛЕНИЕ: пластовое давление (${formationPressureMPa.toFixed(2)} МПа) > гидростатика цемента (${cementHydroAtZone.toFixed(2)} МПа).`);
      recs.push(`Приток ${formationFluidType === 'gas' ? 'газа' : formationFluidType === 'oil' ? 'нефти' : 'воды'} может размыть нижнюю границу моста.`);
      recs.push(`Необходимая плотность цемента: ≥${requiredDensity.toFixed(2)} г/см³.`);
      recs.push(`Используйте утяжелённый буфер снизу с высоким СНС для сопротивления притоку.`);
      recs.push(`Ускорьте закачку для минимизации времени контакта притока с цементом.`);
      if (formationFluidType === 'gas') {
        recs.push(`Газовое проявление — особо опасно: газ мигрирует через незатвердевший цемент. Рекомендуется добавка-блокатор газа.`);
      }
    } else if (type === 'kick') {
      recs.push(`Гидростатика цемента (${cementHydroAtZone.toFixed(2)} МПа) > пластовое давление (${formationPressureMPa.toFixed(2)} МПа). Мост удержит приток.`);
      recs.push(`Запас по давлению: ${Math.abs(pressureDiff).toFixed(2)} МПа.`);
    }
  }

  if (recs.length === 0) {
    recs.push('Осложнения не указаны.');
  }

  return {
    type,
    lossIntensity: intensity,
    fillTimeMin: Math.round(totalOpTime * 10) / 10,
    volumeLostM3: Math.round(volumeLostM3 * 1000) / 1000,
    realCementVolumeM3: Math.round(realCementVol * 1000) / 1000,
    realPlugLengthM: Math.round(realPlugLength * 10) / 10,
    designedPlugLengthM: plugLenAnn,
    lossPercentage: Math.round(lossPercent * 10) / 10,
    contaminationDepthM: Math.round(contaminationDepth * 10) / 10,
    cementHydrostaticMPa: Math.round(cementHydroAtZone * 100) / 100,
    pressureDifferenceMPa: Math.round(pressureDiff * 100) / 100,
    kickCanBreakThrough: kickBreakThrough,
    requiredCementDensityGcm3: Math.round(requiredDensity * 100) / 100,
    correctedCementVolumeM3: Math.round(correctedCement * 1000) / 1000,
    correctedSpacerBelowM3: Math.round(correctedSpacerBelow * 1000) / 1000,
    totalOperationTimeMin: Math.round(totalOpTime * 10) / 10,
    safeTimeMin: Math.round(safeTime * 10) / 10,
    thickeningTimeMin: thickTime,
    settingTimeStartMin: settingStartStatic,
    settingTimeEndMin: settingEndStatic,
    isTimeWithinThickening,
    operationOverlapsSetting,
    timeMarginMin: Math.round(timeMargin * 10) / 10,
    recommendations: recs,
    riskLevel,
  };
}
