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
  /** Cement volume lost to formation, m³ */
  cementLostM3: number;
  /** Lower viscous pad volume lost to formation, m³ */
  padLostM3: number;
  /** Downward settlement of cement after lower losses, m */
  settlementM: number;
  /** Real cement volume remaining, m³ */
  realCementVolumeM3: number;
  /** Real plug length, m */
  realPlugLengthM: number;
  /** Designed plug length, m */
  designedPlugLengthM: number;
  /** Designed plug top MD, m */
  designedPlugTopMD: number;
  /** Designed plug bottom MD, m */
  designedPlugBottomMD: number;
  /** Real plug top MD (after losses / kick invasion), m */
  realPlugTopMD: number;
  /** Real plug bottom MD (after losses / kick invasion), m */
  realPlugBottomMD: number;
  /** Clean (uncontaminated) plug top MD, m */
  cleanPlugTopMD: number;
  /** Clean (uncontaminated) plug bottom MD, m */
  cleanPlugBottomMD: number;
  /** Has viscous pad below? */
  hasViscousPadBelow: boolean;
  /** Designed pad height in annulus, m */
  padHeightMD: number;
  /** Designed lower viscous pad top MD */
  designedPadTopMD: number;
  /** Designed lower viscous pad bottom MD */
  designedPadBottomMD: number;
  /** Real pad top MD (after kick invasion), m */
  realPadTopMD: number;
  /** Real pad bottom MD (after kick invasion), m */
  realPadBottomMD: number;
  /** Real cement bottom MD (above the pad), m */
  realCementBottomMD: number;
  /** Pad invasion height (kick eats pad first), m */
  padInvasionM: number;
  /** Cement invasion height (kick reaches cement after pad), m */
  cementInvasionM: number;
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

  const finalBoreArea = plugLenAnn > 0 && params.cementVolumeTotalM3 > 0
    ? params.cementVolumeTotalM3 / plugLenAnn
    : Math.max(annArea + params.pipeAreaM2, annArea, 1e-6);
  const totalArea = finalBoreArea;
  const padHeightMD = usePadInZone && totalArea > 0
    ? params.spacerVolumeBelowM3 / totalArea
    : 0;
  const designedPlugTopMD = params.plugTopMD;
  const designedPlugBottomMD = params.plugBottomMD;
  const designedPadTopMD = designedPlugBottomMD;
  const designedPadBottomMD = designedPlugBottomMD + padHeightMD;

  // ── Factor 7: Geometric position of complication zone vs plug ──
  // КЛЮЧЕВАЯ ЛОГИКА: потери возникают ТОЛЬКО там, где цемент контактирует с зоной.
  //  • Зона ВНУТРИ моста   → прямой контакт, полные потери (фактор = 1.0)
  //  • Зона НИЖЕ подошвы   → цемент не доходит; уход возможен только через жидкость/пачку под мостом
  //  • Зона ВЫШЕ кровли    → цемент проходит мимо при закачке, после посадки изолирована
  const zoneMD = inputs.zoneDepthMD;
  const zoneThk = Math.max(0, inputs.zoneThicknessM);
  const zoneTopMD = zoneMD - zoneThk / 2;
  const zoneBotMD = zoneMD + zoneThk / 2;
  const plugTop = params.plugTopMD;
  const plugBot = params.plugBottomMD;

  let zonePositionFactor = 1.0;
  let zonePosition: 'insideCement' | 'insidePad' | 'belowPad' | 'above' | 'unknown' = 'unknown';
  let distanceToZoneM = 0;

  if (zoneMD > 0) {
    if (zoneBotMD >= plugTop && zoneTopMD <= plugBot) {
      zonePosition = 'insideCement';
      zonePositionFactor = 1.0;
    } else if (usePadInZone && padHeightMD > 0 && zoneBotMD >= designedPadTopMD && zoneTopMD <= designedPadBottomMD) {
      zonePosition = 'insidePad';
      zonePositionFactor = Math.max(0.04, 0.18 - Math.min(params.spacerVolumeBelowM3, 2) * 0.04 - Math.min(effectiveGel, 80) / 1000);
    } else if (zoneTopMD > plugBot) {
      zonePosition = 'belowPad';
      distanceToZoneM = usePadInZone && padHeightMD > 0 ? Math.max(0, zoneTopMD - designedPadBottomMD) : zoneTopMD - plugBot;
      // Ниже пачки/моста: потери передаются через столб жидкости; геометрию гасим расстоянием, но не прячем потери пачки.
      const padProtection = usePadInZone
        ? Math.max(0.20, 0.55 - Math.min(params.spacerVolumeBelowM3, 2) * 0.10 - Math.min(effectiveGel, 60) / 300)
        : 0.30;
      const distAttenuation = Math.max(0.35, 1 - distanceToZoneM / 120);
      zonePositionFactor = padProtection * distAttenuation;
    } else if (zoneBotMD < plugTop) {
      zonePosition = 'above';
      distanceToZoneM = plugTop - zoneBotMD;
      zonePositionFactor = 0.20;
    }
  }

  // ── Combined effective loss rate ──
  const effectiveLossRateM3h = lossRateM3h * hydrostaticFactor * rheologyFactor * gelFactor * thickeningFactor * padBarrierFactor * behaviorFactor * zonePositionFactor;

  // Volume lost during placement. Важно: ниже моста сначала уходит НИЖНЯЯ вязкая пачка,
  // а цемент не может «подпрыгнуть» вверх. Потери снизу дают осадку колонны вниз.
  const lossRateM3s = effectiveLossRateM3h / 3600;
  const volumeLostM3 = lossRateM3s * totalOpTimeSec;
  const zoneIntersectsPad = usePadInZone && padHeightMD > 0 && zoneBotMD >= designedPadTopMD && zoneTopMD <= designedPadBottomMD;
  const zoneBelowCement = zoneTopMD >= designedPlugBottomMD;
  const zoneIntersectsCement = zoneBotMD >= designedPlugTopMD && zoneTopMD <= designedPlugBottomMD;

  let padLostM3 = 0;
  let cementLostM3 = 0;
  if (type === 'loss' || type === 'both') {
    if (usePadInZone && (zoneIntersectsPad || zoneBelowCement)) {
      padLostM3 = Math.min(volumeLostM3, params.spacerVolumeBelowM3);
      cementLostM3 = Math.max(0, volumeLostM3 - padLostM3);
    } else if (zoneIntersectsCement || !usePadInZone) {
      cementLostM3 = volumeLostM3;
    }
  }

  const padLostHeightM = totalArea > 0 ? padLostM3 / totalArea : 0;
  const settlementM = Math.min(padHeightMD, padLostHeightM);
  const realCementVol = Math.max(0, params.cementVolumeTotalM3 - cementLostM3);
  const realPlugLength = totalArea > 0 ? realCementVol / totalArea : 0;
  const lossPercent = params.cementVolumeTotalM3 > 0
    ? (cementLostM3 / params.cementVolumeTotalM3) * 100
    : 0;

  // Contamination depth at bottom. Если потери приняла нижняя пачка — цемент чистый, только просел.
  let contaminationDepth = cementLostM3 > 0 ? Math.min(
    (cementLostM3 / totalArea) * 0.5,
    plugLenAnn * 0.3
  ) : 0;

  // ═══ KICK CALCULATIONS ═══
  const plugBottomTVD = params.plugBottomTVD;
  const cementHydro = cement.densityGcm3 * 1000 * G * plugLenAnn / 1e6;
  const cementHydroAtZone = cement.densityGcm3 * 1000 * G * plugBottomTVD / 1e6;

  const pressureDiff = formationPressureMPa - cementHydroAtZone;
  const kickBreakThrough = type !== 'loss' && pressureDiff > 0;

  const requiredDensity = plugBottomTVD > 0
    ? (formationPressureMPa * 1e6) / (1000 * G * plugBottomTVD) / 1000
    : cement.densityGcm3;

  // ═══ REAL PLUG INTERVALS (с учётом нижней вязкой пачки) ═══
  // Нижняя пачка находится ПОД подошвой цементного моста: plugBottom → plugBottom + height.
  // При поглощении ниже башмака/подошвы уходит пачка, а цементная колонна оседает вниз.
  // Прорыв пластового флюида сначала «съедает» вязкую пачку, и только затем цемент.
  let kickInvasionM = 0;
  let padInvasionM = 0;
  let cementInvasionM = 0;
  if (kickBreakThrough && pressureDiff > 0) {
    // Базовая оценка глубины внедрения: ~5 м на 1 МПа дисбаланса, до 30% длины моста.
    kickInvasionM = Math.min(pressureDiff * 5, plugLenAnn * 0.3);
    // Вязкая пачка «съедается» первой (но с её СНС/реологией она прорезается медленнее).
    // Эффективное проникновение в пачку = kickInvasion / (1 + СНС-фактор).
    const padResistance = usePadInZone ? Math.max(1, effectiveGel / 5) : 1;
    padInvasionM = Math.min(padHeightMD, kickInvasionM / padResistance);
    // Остаток внедрения (если пачка пробита насквозь) идёт в цемент.
    const remaining = Math.max(0, kickInvasionM - padInvasionM * padResistance);
    cementInvasionM = remaining;
    contaminationDepth = Math.max(contaminationDepth, cementInvasionM);
  }

  const realPadTopMD = usePadInZone ? designedPadTopMD + settlementM + padInvasionM : designedPadTopMD;
  const remainingPadHeightM = Math.max(0, padHeightMD - settlementM - padInvasionM);
  const realPadBottomMD = usePadInZone ? realPadTopMD + remainingPadHeightM : designedPadBottomMD;
  const realCementBottomMD = designedPlugBottomMD + settlementM - cementInvasionM;
  const realPlugTopMD = realCementBottomMD - realPlugLength;
  const realPlugBottomMD = realCementBottomMD;
  const cleanPlugBottomMD = realCementBottomMD - contaminationDepth;
  const cleanPlugTopMD = realPlugTopMD;



  // ═══ CORRECTED VOLUMES ═══
  const compensationFactor = 1.3; // 30% extra
  const correctedCement = params.cementVolumeTotalM3 + cementLostM3 * compensationFactor;
  const minSpacerByIntensity = intensity === 'catastrophic'
    ? Math.max(params.spacerVolumeBelowM3, 0.5)
    : intensity === 'intense'
      ? Math.max(params.spacerVolumeBelowM3, 0.3)
      : params.spacerVolumeBelowM3;
  const correctedSpacerBelow = usePadInZone
    ? Math.max(minSpacerByIntensity, params.spacerVolumeBelowM3 + padLostM3 * compensationFactor)
    : minSpacerByIntensity;

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

  // ═══ ПОЗИЦИОННАЯ ДИАГНОСТИКА: правильно ли установлен мост относительно зоны ═══
  if (zoneMD > 0 && zonePosition !== 'unknown') {
    const zoneLabel = type === 'kick' || type === 'both' ? 'зона проявления' : 'зона поглощения';
    if (zonePosition === 'insideCement') {
      recs.push(`📍 ${zoneLabel[0].toUpperCase() + zoneLabel.slice(1)} (${zoneMD.toFixed(0)} м) находится В ТЕЛЕ цементного моста (${plugTop.toFixed(0)}–${plugBot.toFixed(0)} м) — прямой контакт цемента с пластом. Для поглощения это риск ухода цемента; для проявления — нужна низкопроницаемая рецептура.`);
    } else if (zonePosition === 'insidePad') {
      recs.push(`📍 ${zoneLabel[0].toUpperCase() + zoneLabel.slice(1)} (${zoneMD.toFixed(0)} м) попадает в НИЖНЮЮ вязкую пачку (${designedPadTopMD.toFixed(0)}–${designedPadBottomMD.toFixed(0)} м). При поглощении должна уходить пачка, цементный мост оседает вниз, но не поднимается вверх.`);
    } else if (zonePosition === 'belowPad') {
      if (type === 'loss' || type === 'both') {
        if (usePadInZone && params.spacerVolumeBelowM3 >= 0.3) {
          recs.push(`✅ Схема допустима: ${zoneLabel} (${zoneMD.toFixed(0)} м) ниже вязкой пачки на ${distanceToZoneM.toFixed(0)} м. При поглощении сначала теряется нижняя пачка (${padLostM3.toFixed(2)} м³), цемент должен ПРОСЕСТЬ вниз примерно на ${settlementM.toFixed(1)} м; потери цемента: ${cementLostM3.toFixed(2)} м³.`);
        } else {
          recs.push(`⚠ ${zoneLabel[0].toUpperCase()+zoneLabel.slice(1)} (${zoneMD.toFixed(0)} м) на ${distanceToZoneM.toFixed(0)} м НИЖЕ подошвы моста. Без вязкой пачки снизу столб жидкости под мостом может «провалиться» в пласт — РЕКОМЕНДУЕТСЯ установить вязкую пачку ≥0.5 м³ (СНС ≥30 Па) между подошвой моста и кровлей зоны.`);
        }
      } else if (type === 'kick') {
        recs.push(`⚠ ${zoneLabel[0].toUpperCase()+zoneLabel.slice(1)} (${zoneMD.toFixed(0)} м) НИЖЕ подошвы моста на ${distanceToZoneM.toFixed(0)} м. Для герметичной изоляции от притока подошва моста ДОЛЖНА перекрывать кровлю зоны минимум на 30–50 м. Опустите низ моста до ≥${(zoneTopMD).toFixed(0)} м (минимум) или ≥${(zoneTopMD + 30).toFixed(0)} м (с запасом).`);
      }
    } else if (zonePosition === 'above') {
      recs.push(`⚠ ${zoneLabel[0].toUpperCase()+zoneLabel.slice(1)} (${zoneMD.toFixed(0)} м) ВЫШЕ кровли моста на ${distanceToZoneM.toFixed(0)} м — мост её НЕ изолирует. Поднимите кровлю моста выше зоны (рекомендуется кровля ≤${(zoneTopMD - 30).toFixed(0)} м, с перекрытием 30–50 м над кровлей зоны).`);
    }

    // Рекомендации по идеальной схеме
    if ((zonePosition === 'belowPad' || zonePosition === 'insidePad') && (type === 'loss' || type === 'both')) {
      recs.push(`💡 Лучшая практика при поглощении под башмаком: низ цемента держать выше зоны, а нижнюю вязко-кольматирующую пачку ставить от подошвы цемента до кровли зоны/чуть ниже неё. Пачка должна быть жертвенным и кольматирующим барьером, цемент — садиться на неё после возможной осадки.`);
    }
    if (zonePosition === 'insideCement' && (type === 'kick' || type === 'both')) {
      recs.push(`💡 Идеальная схема для изоляции проявления: подошва моста на ≥30–50 м НИЖЕ подошвы зоны, кровля моста на ≥50–100 м ВЫШЕ кровли зоны. Перекрытие гарантирует изоляцию даже при частичной контаминации.`);
    }
  } else if (zoneMD <= 0 && (type !== 'loss' || lossRateM3h > 0)) {
    recs.push(`ℹ Глубина зоны осложнения не указана — позиционный анализ невозможен. Укажите глубину зоны для проверки корректности установки моста.`);
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
      recs.push(`Частичное поглощение (${lossRateM3h.toFixed(1)} м³/ч${factorsNote}). Уход в пласт: всего ~${volumeLostM3.toFixed(2)} м³; цемент ${cementLostM3.toFixed(2)} м³, нижняя пачка ${padLostM3.toFixed(2)} м³.`);
      recs.push(`Снизьте плотность промывочной жидкости до минимально допустимой перед закачкой моста.`);
      recs.push(cementLostM3 > 0 ? `Увеличьте объём цемента на ${(cementLostM3 * compensationFactor).toFixed(2)} м³ для компенсации потерь.` : `Цемент не должен компенсировать потери пачки: увеличивайте нижнюю вязко-кольматирующую пачку до ≥${correctedSpacerBelow.toFixed(2)} м³ и контролируйте осадку моста вниз.`);
      recs.push(`Снизьте скорость закачки для уменьшения динамических потерь давления.`);
      // Кольматант для частичного поглощения
      recs.push(`🧪 Кольматант в цемент: волокно 6 мм — 0.3–0.5% от массы сухого цемента (закупоривает микротрещины).`);
      if (params.hasViscousPad) {
        recs.push(`🧪 Кольматант в вязкую пачку: волокно 6 мм — 0.5–0.8% + мелкий карбонат кальция (фр. 0.1–0.5 мм) — 3–5% от объёма пачки.`);
      }
    } else if (intensity === 'intense') {
      if (riskLevel !== 'critical') riskLevel = 'high';
      recs.push(`Интенсивное поглощение (${lossRateM3h.toFixed(1)} м³/ч${factorsNote}). Уход в пласт: всего ~${volumeLostM3.toFixed(2)} м³; цемент ${cementLostM3.toFixed(2)} м³, нижняя пачка ${padLostM3.toFixed(2)} м³.`);
      recs.push(`Фактический цемент: ${realPlugLength.toFixed(1)} м вместо ${plugLenAnn.toFixed(0)} м; осадка вниз ${settlementM.toFixed(1)} м, потеря цемента ${lossPercent.toFixed(0)}%.`);
      recs.push(`ОБЯЗАТЕЛЬНО: закачайте ВИР/кольматант перед установкой моста.`);
      recs.push(cementLostM3 > 0 ? `Увеличьте объём цемента на ${(cementLostM3 * compensationFactor).toFixed(2)} м³.` : `Цемент пока защищён пачкой — увеличьте жертвенную нижнюю пачку до ≥${correctedSpacerBelow.toFixed(2)} м³, а цементный интервал задавайте с учётом осадки вниз.`);
      recs.push(`Используйте вязкую пачку (≥${correctedSpacerBelow.toFixed(1)} м³) снизу для создания «пробки» перед зоной поглощения.`);
      recs.push(`Снизьте скорость закачки до минимума (1.5–2 л/с).`);
      // Кольматант для интенсивного поглощения
      recs.push(`🧪 Кольматант в цемент: волокно 12 мм — 0.5–1.0% + волокно 6 мм — 0.3–0.5% от массы сухого цемента.`);
      recs.push(`🧪 Кольматант в вязкую пачку: волокно 12 мм — 1.0–1.5% + карбонат кальция (фр. 0.5–2 мм) — 5–8% + ореховая скорлупа (фр. 1–3 мм) — 3–5% от объёма пачки.`);
      recs.push(`💡 Рекомендуется предварительная закачка кольматирующей пачки (ВИР): целлюлоза + карбонат + волокно в объёме 1.5–3 м³.`);
    } else {
      riskLevel = 'critical';
      recs.push(`⛔ Катастрофическое поглощение (${lossRateM3h.toFixed(1)} м³/ч${factorsNote})! Уход в пласт: всего ~${volumeLostM3.toFixed(2)} м³; цемент ${cementLostM3.toFixed(2)} м³, нижняя пачка ${padLostM3.toFixed(2)} м³.`);
      recs.push(`Фактический цемент: ${realPlugLength.toFixed(1)} м, осадка вниз ${settlementM.toFixed(1)} м, потеря цемента ${lossPercent.toFixed(0)}%.`);
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
      recs.push(`Ускорьте закачку для минимизации времени контакта притока с цементом.`);

      // ═══ ФЛЮИД-СПЕЦИФИЧНЫЕ РЕЦЕПТУРЫ ═══
      if (formationFluidType === 'gas') {
        recs.push(`🛢 ГАЗОВОЕ ПРОЯВЛЕНИЕ — критично: газ мигрирует через цементный гель в период «нулевой прочности» (transition time). Требуется непроницаемая газоблокирующая система.`);
        recs.push(`🧪 Газоблокаторы (gas migration control): латексная добавка (стирол-бутадиеновый латекс) — 5–15% от массы воды затворения, формирует непроницаемую полимерную плёнку в поровом пространстве.`);
        recs.push(`🧪 Альтернатива: микрокремнезём (Microsilica/SiO₂ <0.5 мкм) — 5–10% от массы цемента, заполняет поры между зёрнами цемента, снижает проницаемость до <0.001 мД.`);
        recs.push(`🧪 Микроцемент (D90 <10 мкм) — 20–40% замены портландцемента, существенно снижает water permeability и block gas channeling.`);
        recs.push(`🧪 Структурообразователи (right-angle set): хлорид кальция CaCl₂ — 2–4% или силикат натрия Na₂SiO₃ — 1–3%, минимизируют transition time (быстрый переход гель → камень).`);
        recs.push(`🧪 Газоблок-комплекс рекомендуется: латекс 8% + микрокремнезём 6% + CaCl₂ 2% + стабилизатор латекса 0.5%.`);
        recs.push(`📐 Буфер снизу с высоким СНС (≥40 Па за 10 мин) — для удержания газа в момент закачки.`);
      } else if (formationFluidType === 'oil') {
        recs.push(`🛢 НЕФТЕПРОЯВЛЕНИЕ: нефть может образовать каналы при прохождении через гелеобразный цемент, нарушая адгезию к стенке скважины.`);
        recs.push(`🧪 Маслосовместимые ПАВ (oil-wetting reversal): неионогенные ПАВ — 0.3–0.7% от объёма воды, очищают стенку и обеспечивают гидрофильность для адгезии цемента.`);
        recs.push(`🧪 Микрокремнезём — 5–8% от массы цемента: повышает плотность матрицы, снижает проницаемость для углеводородов.`);
        recs.push(`🧪 Микроцемент — 15–25% замены: уменьшает размер пор, блокирует фильтрацию нефти.`);
        recs.push(`🧪 Структурообразователи: CaCl₂ — 1.5–3% для ускорения схватывания и минимизации окна проницаемости.`);
        recs.push(`🧪 Понизитель фильтрации (АМПС/полимер) — 0.5–1.2%: API filtrate <50 мл/30 мин для предотвращения дегидратации цемента нефтью.`);
      } else {
        recs.push(`🛢 ВОДОПРОЯВЛЕНИЕ: пластовая вода может разжижать цементный раствор, снижая его плотность и прочность.`);
        recs.push(`🧪 Понизитель фильтрации (полимер АМПС или CMC-HV) — 0.7–1.5% от массы цемента: API <30 мл/30 мин, предотвращает разбавление пластовой водой.`);
        recs.push(`🧪 Микрокремнезём — 5–8% от массы цемента: увеличивает плотность матрицы, блокирует водопроводящие каналы.`);
        recs.push(`🧪 Микроцемент — 15–25%: тонкомолотый клинкер заполняет микропоры, снижает water permeability.`);
        recs.push(`🧪 Структурообразователи: силикат натрия Na₂SiO₃ — 1.5–3% или CaCl₂ — 2–4%, для right-angle set (быстрый набор прочности, минимальный период проницаемости).`);
        recs.push(`🧪 Расширяющая добавка (MgO или CaO) — 0.5–2%: компенсирует контракцию, обеспечивает контакт цемент-порода.`);
      }
      recs.push(`📐 Буфер снизу — утяжелённый, плотность ≥${(formationPressureMPa / (G * plugBottomTVD * 1e-3) + 0.05).toFixed(2)} г/см³, СНС ≥40 Па за 10 мин для сопротивления притоку.`);
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
    cementLostM3: Math.round(cementLostM3 * 1000) / 1000,
    padLostM3: Math.round(padLostM3 * 1000) / 1000,
    settlementM: Math.round(settlementM * 10) / 10,
    realCementVolumeM3: Math.round(realCementVol * 1000) / 1000,
    realPlugLengthM: Math.round(realPlugLength * 10) / 10,
    designedPlugLengthM: plugLenAnn,
    designedPlugTopMD: Math.round(designedPlugTopMD * 10) / 10,
    designedPlugBottomMD: Math.round(designedPlugBottomMD * 10) / 10,
    realPlugTopMD: Math.round(realPlugTopMD * 10) / 10,
    realPlugBottomMD: Math.round(realPlugBottomMD * 10) / 10,
    cleanPlugTopMD: Math.round(cleanPlugTopMD * 10) / 10,
    cleanPlugBottomMD: Math.round(cleanPlugBottomMD * 10) / 10,
    hasViscousPadBelow: usePadInZone,
    padHeightMD: Math.round(padHeightMD * 10) / 10,
    designedPadTopMD: Math.round(designedPadTopMD * 10) / 10,
    designedPadBottomMD: Math.round(designedPadBottomMD * 10) / 10,
    realPadTopMD: Math.round(realPadTopMD * 10) / 10,
    realPadBottomMD: Math.round(realPadBottomMD * 10) / 10,
    realCementBottomMD: Math.round(realCementBottomMD * 10) / 10,
    padInvasionM: Math.round(padInvasionM * 10) / 10,
    cementInvasionM: Math.round(cementInvasionM * 10) / 10,
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
