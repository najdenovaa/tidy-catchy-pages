/**
 * Cement plug complications module.
 * Calculates real plug length under lost circulation or kick conditions.
 */

export type ComplicationType = 'loss' | 'kick' | 'both';
export type LossIntensity = 'partial' | 'intense' | 'catastrophic';
export type LossBehavior = 'stable' | 'progressive' | 'regressive';

export interface ComplicationInputs {
  type: ComplicationType;
  /** Lost circulation intensity, m³/h */
  lossRateM3h: number;
  /** Loss behavior over time */
  lossBehavior: LossBehavior;
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
  const { type, lossRateM3h, zoneDepthTVD, formationPressureMPa, formationFluidType, lossBehavior } = inputs;
  const intensity = classifyLossIntensity(lossRateM3h);

  // ═══ LOSS CALCULATIONS ═══
  const annArea = params.annAreaM2;
  const plugLenAnn = params.plugLengthMD;
  const totalOpTimeSec = params.totalOperationTimeMin * 60;
  const totalOpTimeMin = params.totalOperationTimeMin;

  const { cement, spacer, wellFluid, viscousPad } = params;

  // ── Factor 1: Hydrostatic pressure factor ──
  // The user-input loss rate is measured at the CURRENT well fluid density.
  // Cementing ADDS excess pressure: ΔP_extra = (ρ_plug - ρ_wellfluid) × g × h_plug
  // This extra pressure increases losses proportionally.
  // Factor = 1 + k × (ρ_plug - ρ_wf) × h_plug / reference
  // Where reference = 0.8 g/cm³ × 100m (typical excess from heavy cement in long plug)
  const usePadInZone = params.hasViscousPad && params.spacerVolumeBelowM3 > 0;
  const zoneFluid = usePadInZone ? viscousPad : cement;

  // Effective density of the plug interval
  const plugDensity = usePadInZone
    ? (viscousPad.densityGcm3 * 0.7 + cement.densityGcm3 * 0.3)
    : cement.densityGcm3;

  // Excess pressure from replacing well fluid with heavier cement
  const excessDeltaRho = plugDensity - wellFluid.densityGcm3; // g/cm³ (can be negative if cement lighter)
  const excessPressureProduct = excessDeltaRho * plugLenAnn; // g/cm³ × m

  // Reference: standard excess = 0.8 g/cm³ × 100m = 80
  const refExcess = 80;

  let hydrostaticFactor = 1.0;
  if (excessPressureProduct > 0) {
    // Cement heavier than well fluid → adds pressure → increases losses
    // factor = 1 + extra/ref. At reference conditions (1.9 cement, 1.1 wf, 100m) → factor = 2.0
    hydrostaticFactor = 1.0 + excessPressureProduct / refExcess;
    hydrostaticFactor = Math.min(hydrostaticFactor, 5.0);
  } else if (excessPressureProduct < 0) {
    // Cement lighter than well fluid → reduces pressure → fewer losses
    // At most can reduce to 30% of base rate
    hydrostaticFactor = Math.max(0.3, 1.0 + excessPressureProduct / refExcess);
  }
  // When excessDeltaRho ≈ 0 (same density), factor stays 1.0 = base loss rate unchanged

  // ── Factor 2: Rheology resistance (all fluids weighted) ──
  const refPV = 80;
  const refYP = 8;
  const zonePV = zoneFluid.pvMPas > 0 ? zoneFluid.pvMPas : refPV;
  const zoneYP = zoneFluid.ypPa > 0 ? zoneFluid.ypPa : refYP;
  let effectivePV = zonePV;
  let effectiveYP = zoneYP;

  if (usePadInZone) {
    const padPV = viscousPad.pvMPas > 0 ? viscousPad.pvMPas : refPV;
    const padYP = viscousPad.ypPa > 0 ? viscousPad.ypPa : refYP;
    effectivePV = Math.max(padPV, zonePV);
    effectiveYP = Math.max(padYP, zoneYP);
  }

  const rheologyMetric = effectivePV + 5 * effectiveYP;
  const refRheologyMetric = refPV + 5 * refYP;
  const rheologyFactor = refRheologyMetric / Math.max(rheologyMetric, 1);

  // ── Factor 3: Gel strength (SNS) resistance ──
  const cementGel = cement.gel10minPa > 0 ? cement.gel10minPa : cement.ypPa * 3;
  const spacerGel = spacer.gel10minPa > 0 ? spacer.gel10minPa : spacer.ypPa * 3;
  const wellFluidGel = wellFluid.gel10minPa > 0 ? wellFluid.gel10minPa : wellFluid.ypPa * 3;
  const padGel = viscousPad.gel10minPa > 0 ? viscousPad.gel10minPa : viscousPad.ypPa * 3;

  let effectiveGel: number;
  if (usePadInZone) {
    effectiveGel = padGel * 0.5 + cementGel * 0.3 + spacerGel * 0.1 + wellFluidGel * 0.1;
  } else {
    effectiveGel = cementGel * 0.5 + spacerGel * 0.25 + wellFluidGel * 0.25;
  }

  const refGel = 15;
  const gelFactor = effectiveGel > refGel ? refGel / effectiveGel : 1.0;

  // ── Factor 4: Thickening time ──
  const thickTime = params.thickeningTimeMin;
  let thickeningFactor = 1.0;
  if (thickTime > 0 && totalOpTimeMin > 0) {
    const ratio = Math.min(totalOpTimeMin / thickTime, 1.0);
    thickeningFactor = Math.max(0.3, 1 - 0.7 * ratio * ratio);
  }

  // ── Factor 5: Viscous pad barrier ──
  let padBarrierFactor = 1.0;
  if (usePadInZone) {
    const padVolume = params.spacerVolumeBelowM3;
    padBarrierFactor = Math.max(0.3, 1 - 0.35 * Math.min(padVolume / 1.0, 1.5));
  }

  // ── Factor 6: Loss behavior over time ──
  // Stable: constant rate (factor = 1.0)
  // Progressive: losses increase over time (fracture widens) — average factor > 1
  // Regressive: losses decrease over time (natural bridging/plugging) — average factor < 1
  let behaviorFactor = 1.0;
  switch (lossBehavior) {
    case 'progressive':
      // Losses grow ~linearly: average over operation = 1.3× the initial rate
      behaviorFactor = 1.3;
      break;
    case 'regressive':
      // Losses decay: natural bridging/cuttings plug the zone
      // Average over operation ≈ 0.5× initial rate
      behaviorFactor = 0.5;
      break;
    case 'stable':
    default:
      behaviorFactor = 1.0;
      break;
  }

  // ── Combined effective loss rate ──
  const effectiveLossRateM3h = lossRateM3h * hydrostaticFactor * rheologyFactor * gelFactor * thickeningFactor * padBarrierFactor * behaviorFactor;

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

  // Contamination depth at bottom
  const contaminationDepth = Math.min(
    volumeLostM3 > 0 ? (volumeLostM3 / annArea) * 0.5 : 0,
    plugLenAnn * 0.3
  );

  // ═══ KICK CALCULATIONS ═══
  const plugBottomTVD = params.plugBottomTVD;
  const cementHydro = cement.densityGcm3 * 1000 * G * plugLenAnn / 1e6;
  const cementHydroAtZone = cement.densityGcm3 * 1000 * G * plugBottomTVD / 1e6;

  const pressureDiff = formationPressureMPa - cementHydroAtZone;
  const kickBreakThrough = type !== 'loss' && pressureDiff > 0;

  const requiredDensity = plugBottomTVD > 0
    ? (formationPressureMPa * 1e6) / (1000 * G * plugBottomTVD) / 1000
    : cement.densityGcm3;

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
    if (Math.abs(hydrostaticFactor - 1) > 0.05) factors.push(`ΔPh×${hydrostaticFactor.toFixed(2)}`);
    if (Math.abs(rheologyFactor - 1) > 0.05) factors.push(`реол.×${rheologyFactor.toFixed(2)}`);
    if (Math.abs(gelFactor - 1) > 0.05) factors.push(`СНС×${gelFactor.toFixed(2)}`);
    if (Math.abs(thickeningFactor - 1) > 0.05) factors.push(`загуст.×${thickeningFactor.toFixed(2)}`);
    if (Math.abs(padBarrierFactor - 1) > 0.05) factors.push(`пачка×${padBarrierFactor.toFixed(2)}`);
    if (Math.abs(behaviorFactor - 1) > 0.05) factors.push(`${lossBehavior === 'progressive' ? 'прогр.' : 'регр.'}×${behaviorFactor.toFixed(2)}`);
    const factorsNote = factors.length > 0 ? ` (эфф. ${effectiveLossRateM3h.toFixed(1)} м³/ч: ${factors.join(', ')})` : '';
    if (intensity === 'partial') {
      if (riskLevel === 'low') riskLevel = 'medium';
      recs.push(`Частичное поглощение (${lossRateM3h.toFixed(1)} м³/ч${factorsNote}). Потери цемента: ~${volumeLostM3.toFixed(2)} м³ (${lossPercent.toFixed(0)}%).`);
      recs.push(`Снизьте плотность промывочной жидкости до минимально допустимой перед закачкой моста.`);
      recs.push(`Увеличьте объём цемента на ${(volumeLostM3 * compensationFactor).toFixed(2)} м³ для компенсации потерь.`);
      recs.push(`Снизьте скорость закачки для уменьшения динамических потерь давления.`);
      // Кольматант для частичного поглощения
      recs.push(`🧪 Кольматант в цемент: волокно 6 мм — 0.3–0.5% от массы сухого цемента (закупоривает микротрещины).`);
      if (params.hasViscousPad) {
        recs.push(`🧪 Кольматант в вязкую пачку: волокно 6 мм — 0.5–0.8% + мелкий карбонат кальция (фр. 0.1–0.5 мм) — 3–5% от объёма пачки.`);
      }
    } else if (intensity === 'intense') {
      if (riskLevel !== 'critical') riskLevel = 'high';
      recs.push(`Интенсивное поглощение (${lossRateM3h.toFixed(1)} м³/ч${factorsNote}). Потери цемента: ~${volumeLostM3.toFixed(2)} м³ (${lossPercent.toFixed(0)}%).`);
      recs.push(`Реальная длина моста: ${realPlugLength.toFixed(1)} м вместо ${plugLenAnn.toFixed(0)} м — потеряно ${lossPercent.toFixed(0)}%.`);
      recs.push(`ОБЯЗАТЕЛЬНО: закачайте ВИР/кольматант перед установкой моста.`);
      recs.push(`Увеличьте объём цемента на ${(volumeLostM3 * compensationFactor).toFixed(2)} м³.`);
      recs.push(`Используйте вязкую пачку (≥${correctedSpacerBelow.toFixed(1)} м³) снизу для создания «пробки» перед зоной поглощения.`);
      recs.push(`Снизьте скорость закачки до минимума (1.5–2 л/с).`);
      // Кольматант для интенсивного поглощения
      recs.push(`🧪 Кольматант в цемент: волокно 12 мм — 0.5–1.0% + волокно 6 мм — 0.3–0.5% от массы сухого цемента.`);
      recs.push(`🧪 Кольматант в вязкую пачку: волокно 12 мм — 1.0–1.5% + карбонат кальция (фр. 0.5–2 мм) — 5–8% + ореховая скорлупа (фр. 1–3 мм) — 3–5% от объёма пачки.`);
      recs.push(`💡 Рекомендуется предварительная закачка кольматирующей пачки (ВИР): целлюлоза + карбонат + волокно в объёме 1.5–3 м³.`);
    } else {
      riskLevel = 'critical';
      recs.push(`⛔ Катастрофическое поглощение (${lossRateM3h.toFixed(1)} м³/ч${factorsNote})! Потери: ~${volumeLostM3.toFixed(2)} м³ (${lossPercent.toFixed(0)}%).`);
      recs.push(`Реальная длина моста: ${realPlugLength.toFixed(1)} м — потеряно ${lossPercent.toFixed(0)}% цемента.`);
      recs.push(`Установка моста без предварительных мероприятий НЕВОЗМОЖНА.`);
      recs.push(`1. Закачайте ВИР/кольматант для ликвидации поглощения.`);
      recs.push(`2. Рассмотрите установку пакера/кольца ниже моста.`);
      recs.push(`3. При невозможности ликвидации — установите мост в 2 ступени.`);
      recs.push(`4. Используйте вязкую пачку ≥${correctedSpacerBelow.toFixed(1)} м³ с высоким СНС.`);
      // Кольматант для катастрофического поглощения
      recs.push(`🧪 Кольматант в цемент: волокно 12 мм — 1.0–1.5% + волокно 6 мм — 0.5–1.0% от массы сухого цемента (максимальная концентрация без потери прокачиваемости).`);
      recs.push(`🧪 Кольматант в вязкую пачку: волокно 12 мм — 2.0–3.0% + крупный карбонат кальция (фр. 1–5 мм) — 8–12% + ореховая скорлупа (фр. 2–5 мм) — 5–8% + целлюлозное волокно — 1–2% от объёма пачки.`);
      recs.push(`💡 ОБЯЗАТЕЛЬНА предварительная закачка ВИР в объёме 3–6 м³: карбонат кальция разных фракций (0.1–5 мм) + целлюлоза + волокно 12 мм.`);
      recs.push(`💡 При раскрытии трещин >5 мм — рассмотреть применение ВУС (вспенивающийся уретановый состав) или гранулированного кольматанта (фр. 5–10 мм).`);
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
