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
  /** Cement density, g/cm³ */
  cementDensityGcm3: number;
  /** Spacer density, g/cm³ */
  spacerDensityGcm3: number;
  /** Well fluid density (= flush density), g/cm³ */
  wellFluidDensityGcm3: number;
  /** Cement volume total, m³ */
  cementVolumeTotalM3: number;
  /** Total operation time (all stages), min */
  totalOperationTimeMin: number;
  /** Cement gel 10min, Pa */
  cementGel10minPa: number;
  /** Spacer gel 10min, Pa */
  spacerGel10minPa: number;
  /** Spacer volume below (viscous pad), m³ */
  spacerVolumeBelowM3: number;
  /** Plug bottom TVD, m */
  plugBottomTVD: number;
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
  const pumpRateM3s = params.pumpRateCementLs / 1000;
  const plugLenAnn = params.plugLengthMD;
  const cementVolInAnn = annArea * plugLenAnn;

  // Time to fill cement in annulus
  const fillTimeSec = pumpRateM3s > 0 ? cementVolInAnn / pumpRateM3s : 0;
  const fillTimeMin = fillTimeSec / 60;

  // Volume lost during placement
  const lossRateM3s = lossRateM3h / 3600;
  const volumeLostM3 = lossRateM3s * fillTimeSec;

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

  // ═══ RECOMMENDATIONS ═══
  const recs: string[] = [];
  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

  if (type === 'loss' || type === 'both') {
    if (intensity === 'partial') {
      riskLevel = 'medium';
      recs.push(`Частичное поглощение (${lossRateM3h.toFixed(1)} м³/ч). Потери цемента: ~${volumeLostM3.toFixed(2)} м³ (${lossPercent.toFixed(0)}%).`);
      recs.push(`Снизьте плотность промывочной жидкости до минимально допустимой перед закачкой моста.`);
      recs.push(`Увеличьте объём цемента на ${(volumeLostM3 * compensationFactor).toFixed(2)} м³ для компенсации потерь.`);
      recs.push(`Снизьте скорость закачки для уменьшения динамических потерь давления.`);
    } else if (intensity === 'intense') {
      riskLevel = 'high';
      recs.push(`Интенсивное поглощение (${lossRateM3h.toFixed(1)} м³/ч). Потери цемента: ~${volumeLostM3.toFixed(2)} м³ (${lossPercent.toFixed(0)}%).`);
      recs.push(`Реальная длина моста: ${realPlugLength.toFixed(1)} м вместо ${plugLenAnn.toFixed(0)} м — потеряно ${lossPercent.toFixed(0)}%.`);
      recs.push(`ОБЯЗАТЕЛЬНО: закачайте ВИР/кольматант перед установкой моста.`);
      recs.push(`Увеличьте объём цемента на ${(volumeLostM3 * compensationFactor).toFixed(2)} м³.`);
      recs.push(`Используйте вязкую пачку (≥${correctedSpacerBelow.toFixed(1)} м³) снизу для создания «пробки» перед зоной поглощения.`);
      recs.push(`Снизьте скорость закачки до минимума (1.5–2 л/с).`);
    } else {
      riskLevel = 'critical';
      recs.push(`⛔ Катастрофическое поглощение (${lossRateM3h.toFixed(1)} м³/ч)! Потери: ~${volumeLostM3.toFixed(2)} м³ (${lossPercent.toFixed(0)}%).`);
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
      riskLevel = Math.max(riskLevel === 'low' ? 0 : riskLevel === 'medium' ? 1 : 2, 0) === 0 ? 'low' : riskLevel;
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
    fillTimeMin: Math.round(fillTimeMin * 10) / 10,
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
    recommendations: recs,
    riskLevel,
  };
}
