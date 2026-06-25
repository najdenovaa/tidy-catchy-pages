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
    const padToZoneTopM3 = Math.max(0, (zoneTopMD - designedPlugBottomMD + 10) * totalArea);
    const padToZoneBottomM3 = Math.max(0, (zoneBotMD - designedPlugBottomMD + 5) * totalArea);
    if (zonePosition === 'insideCement') {
      recs.push(`📍 ${zoneLabel[0].toUpperCase() + zoneLabel.slice(1)} (${zoneMD.toFixed(0)} м) находится В ТЕЛЕ цементного моста (${plugTop.toFixed(0)}–${plugBot.toFixed(0)} м) — прямой контакт цемента с пластом. Для поглощения это риск ухода цемента; для проявления — нужна низкопроницаемая рецептура.`);
      if (type === 'loss' || type === 'both') {
        recs.push(`⚠ Для борьбы с поглощением лучше не заводить обычный цемент прямо в принимающий пласт без предварительной кольматации: сначала ВИР/вязко-кольматирующая пачка по зоне, затем цементный мост сверху с расчётной осадкой.`);
      }
    } else if (zonePosition === 'insidePad') {
      recs.push(`📍 ${zoneLabel[0].toUpperCase() + zoneLabel.slice(1)} (${zoneMD.toFixed(0)} м) попадает в НИЖНЮЮ вязкую пачку (${designedPadTopMD.toFixed(0)}–${designedPadBottomMD.toFixed(0)} м). При поглощении должна уходить пачка, цементный мост оседает вниз, но не поднимается вверх.`);
      if ((type === 'loss' || type === 'both') && designedPadBottomMD < zoneBotMD) {
        recs.push(`⚠ Пачка перекрывает кровлю, но не всю мощность зоны (${zoneTopMD.toFixed(0)}–${zoneBotMD.toFixed(0)} м). Для интенсивного поглощения целевой объём нижней пачки ≈${padToZoneBottomM3.toFixed(2)} м³, чтобы дойти до подошвы зоны с запасом 5 м.`);
      }
    } else if (zonePosition === 'belowPad') {
      if (type === 'loss' || type === 'both') {
        if (usePadInZone && params.spacerVolumeBelowM3 >= 0.3) {
          recs.push(`✅ Схема допустима: ${zoneLabel} (${zoneMD.toFixed(0)} м) ниже вязкой пачки на ${distanceToZoneM.toFixed(0)} м. При поглощении сначала теряется нижняя пачка (${padLostM3.toFixed(2)} м³), цемент должен ПРОСЕСТЬ вниз примерно на ${settlementM.toFixed(1)} м; потери цемента: ${cementLostM3.toFixed(2)} м³.`);
          recs.push(`⚠ Но пачка НЕ доходит до кровли зоны (${zoneTopMD.toFixed(0)} м). Увеличьте нижнюю пачку минимум до ≈${padToZoneTopM3.toFixed(2)} м³, чтобы перекрыть кровлю зоны с запасом 10 м; для перекрытия всей зоны — ≈${padToZoneBottomM3.toFixed(2)} м³.`);
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

// ═══════════════════════════════════════════════════════════════════════
// MASTER-PROMPT: ПОЛНАЯ ФИЗИКА ОСЛОЖНЕНИЙ ЦЕМЕНТНОГО МОСТА
// (Динамическое проседание по принципу U-tube + серия мостов через ОЗЦ)
// ═══════════════════════════════════════════════════════════════════════

// ───── БЛОК 1: РАСШИРЕННЫЕ ТИПЫ ─────
export type LossZoneType = 'pore' | 'fracture' | 'vug_cavern' | 'fault';

export interface LossZoneFull {
  topMD: number;
  thicknessM: number;
  zoneType: LossZoneType;
  porosity: number;                 // 0..1
  initialLossRateM3h: number;
  drainageRadiusM: number;          // 5..50 м
}

export interface FullRheologyFluid {
  densityGcm3: number;
  pvMPas: number;                   // PV, сПз
  ypPa: number;                     // YP, Па
  gel10sPa: number;                 // СНС 10 с
  gel10minPa: number;               // СНС 10 мин
  thickeningTime30Bc: number;       // мин (только цемент)
  thickeningTime50Bc: number;       // мин (только цемент)
}

export interface ProfilePoint { md: number; zenithDeg: number; tvd: number; }

// ───── БЛОК 2: КОНСИСТЕНЦИЯ Bc(t) И ЭВОЛЮЦИЯ РЕОЛОГИИ ─────
export function consistencyAtTime(t: number, t30Bc: number, t50Bc: number): number {
  if (t30Bc <= 0 || t50Bc <= 0 || t50Bc <= t30Bc) return 5;
  if (t <= 0) return 5;
  if (t <= t30Bc) return 5 + 25 * (t / t30Bc);
  if (t <= t50Bc) return 30 + 20 * ((t - t30Bc) / (t50Bc - t30Bc));
  const t100 = (t50Bc - t30Bc) * 1.5;
  return Math.min(100, 50 + 50 * (1 - Math.exp(-3 * (t - t50Bc) / t100)));
}

export function gelFromConsistency(bc: number, baseGel: number): number {
  return baseGel * Math.pow(Math.max(bc, 5) / 30, 2.5);
}
export function ypFromConsistency(bc: number, baseYP: number): number {
  return baseYP * Math.pow(Math.max(bc, 5) / 30, 1.8);
}
export function pvFromConsistency(bc: number, basePV: number): number {
  return basePV * Math.pow(Math.max(bc, 5) / 30, 1.2);
}

export interface TransitionWindow {
  startTimeMin: number;
  endTimeMin: number;
  durationMin: number;
  gasMigrationRisk: 'low' | 'medium' | 'high';
}
export function transitionWindow(t30: number, t50: number, hasGasZone: boolean): TransitionWindow {
  const t100 = t50 + (t50 - t30) * 1.5;
  const durationMin = Math.max(0, t100 - t30);
  const risk: TransitionWindow['gasMigrationRisk'] = !hasGasZone
    ? 'low' : durationMin < 30 ? 'low' : durationMin < 60 ? 'medium' : 'high';
  return { startTimeMin: t30, endTimeMin: t100, durationMin, gasMigrationRisk: risk };
}

// ───── БЛОК 3: ЁМКОСТЬ ЗОНЫ ПОГЛОЩЕНИЯ ─────
// FIX: пористость пользователя ВЛИЯЕТ во всех типах зон.
// Типовой множитель отражает физику: трещина — мало порового объёма, но раскрытие,
// каверна/разлом — больше эффективной ёмкости. Базой всегда служит введённая пористость.
export function lossZoneCapacity(zone: LossZoneFull, boreDiamM: number): number {
  const rWell = boreDiamM / 2;
  const typeMul =
    zone.zoneType === 'vug_cavern' ? 1.5 :
    zone.zoneType === 'fault'      ? 0.9 :
    zone.zoneType === 'fracture'   ? 0.35 :
    1.0; // pore
  const effPorosity = Math.max(0.005, zone.porosity) * typeMul;
  const rD = Math.max(zone.drainageRadiusM, rWell + 0.1);
  return Math.PI * (rD * rD - rWell * rWell) * Math.max(0.1, zone.thicknessM) * effPorosity;
}
export function lossSelfArrests(zone: LossZoneFull): boolean {
  // Поровая и каверно-трещинная самоизолируются за счёт конечной ёмкости/кольматации;
  // трещина и разлом — нет (бесконечный сток).
  return zone.zoneType === 'pore' || zone.zoneType === 'vug_cavern';
}

// ───── БЛОК 4: ПРОФИЛЬ СКВАЖИНЫ ВДОЛЬ МОСТА ─────
function interpolateZenith(md: number, traj: ProfilePoint[]): number {
  if (!traj.length) return 0;
  if (md <= traj[0].md) return traj[0].zenithDeg;
  if (md >= traj[traj.length - 1].md) return traj[traj.length - 1].zenithDeg;
  for (let i = 1; i < traj.length; i++) {
    if (md <= traj[i].md) {
      const a = traj[i - 1], b = traj[i];
      const f = (md - a.md) / Math.max(1e-6, b.md - a.md);
      return a.zenithDeg + (b.zenithDeg - a.zenithDeg) * f;
    }
  }
  return traj[traj.length - 1].zenithDeg;
}

function interpolateTVD(md: number, traj: ProfilePoint[]): number {
  if (!traj.length) return md;
  if (md <= traj[0].md) return traj[0].tvd;
  if (md >= traj[traj.length - 1].md) {
    const last = traj[traj.length - 1];
    return last.tvd + (md - last.md) * Math.cos((last.zenithDeg * Math.PI) / 180);
  }
  for (let i = 1; i < traj.length; i++) {
    if (md <= traj[i].md) {
      const a = traj[i - 1], b = traj[i];
      const f = (md - a.md) / Math.max(1e-6, b.md - a.md);
      return a.tvd + (b.tvd - a.tvd) * f;
    }
  }
  return traj[traj.length - 1].tvd;
}

export interface PlugProfileSegment {
  topMD: number; bottomMD: number; zenith: number;
  drive: number; normal: number; friction: number;
}
export interface PlugProfileResult {
  segments: PlugProfileSegment[];
  totalDrive: number;     // Н
  totalFriction: number;  // Н (механическое + реологическое)
  totalNormal: number;    // Н
  avgZenith: number;
}

export function analyzePlugProfile(
  plugTopMD: number, plugBottomMD: number,
  trajectory: ProfilePoint[], cement: FullRheologyFluid,
  annAreaM2: number, boreDiamM: number,
  wellFluidDensity: number, frictionCoeff: number,
): PlugProfileResult {
  const step = 5;
  let totalDrive = 0, totalFriction = 0, totalNormal = 0, zenSum = 0, nSeg = 0;
  const segments: PlugProfileSegment[] = [];
  for (let md = plugTopMD; md < plugBottomMD; md += step) {
    const segLen = Math.min(step, plugBottomMD - md);
    const zenith = interpolateZenith(md + segLen / 2, trajectory);
    const zr = zenith * Math.PI / 180;
    const segWeight = (cement.densityGcm3 - wellFluidDensity) * 1000 * 9.81 * segLen * annAreaM2;
    const drive = segWeight * Math.cos(zr);
    const normal = segWeight * Math.sin(zr);
    const mechFriction = frictionCoeff * Math.abs(normal);
    const rheoFriction = Math.max(0, cement.ypPa) * Math.PI * boreDiamM * segLen;
    const friction = mechFriction + rheoFriction;
    segments.push({ topMD: md, bottomMD: md + segLen, zenith, drive, normal, friction });
    totalDrive += drive; totalFriction += friction; totalNormal += Math.abs(normal);
    zenSum += zenith; nSeg++;
  }
  return { segments, totalDrive, totalFriction, totalNormal, avgZenith: nSeg ? zenSum / nSeg : 0 };
}

// ───── БЛОК 5: ДИНАМИЧЕСКОЕ ПРОСЕДАНИЕ (U-tube) ─────
export type ArrestMechanism =
  | 'gelation' | 'friction' | 'reached_zone' | 'fluid_limited' | 'stable' | 'self_arrest_capacity' | 'rheology_balance';

export interface SettlementResult {
  willSettle: boolean;
  settlementM: number;
  settleVelocityMs: number;
  finalHeadMD: number;
  finalBottomMD: number;
  reachesLossZone: boolean;
  arrestMechanism: ArrestMechanism;
  consistencyAtArrest: number;
  forceBalance: { driveKN: number; gelKN: number; frictionKN: number; padKN: number; wellFluidKN: number; netKN: number };
  zoneCapacityM3: number;
  zoneCanSelfArrest: boolean;
  layerBreakdown: { fluidLostM3: number; padLostM3: number; cementLostM3: number };
  volumeLostM3: number;
  limitedBy: 'capacity' | 'gelation' | 'geometry';
  warnings: string[];
}

export function calculatePlugSettlement(
  plugTopMD: number, plugBottomMD: number,
  lossZone: LossZoneFull,
  cement: FullRheologyFluid, wellFluid: FullRheologyFluid, viscousPad: FullRheologyFluid | null,
  padVolumeM3: number,
  trajectory: ProfilePoint[],
  annAreaM2: number, boreDiamM: number,
  frictionCoeff: number,
  totalOpTimeMin: number,
  lcmReductionFactor: number,
  userBcAtStop: number = 0,
  bhTempC: number = 60,
): SettlementResult {
  const plugLen = plugBottomMD - plugTopMD;
  const wallPerim = Math.PI * boreDiamM;
  const warnings: string[] = [];
  const emptyLayer = { fluidLostM3: 0, padLostM3: 0, cementLostM3: 0 };

  // Зона выше/внутри моста — отдельная ветка
  if (lossZone.topMD <= plugBottomMD) {
    return {
      willSettle: false, settlementM: 0, settleVelocityMs: 0,
      finalHeadMD: plugTopMD, finalBottomMD: plugBottomMD,
      reachesLossZone: false, arrestMechanism: 'stable', consistencyAtArrest: 5,
      forceBalance: { driveKN: 0, gelKN: 0, frictionKN: 0, padKN: 0, wellFluidKN: 0, netKN: 0 },
      zoneCapacityM3: lossZoneCapacity(lossZone, boreDiamM),
      zoneCanSelfArrest: lossSelfArrests(lossZone),
      layerBreakdown: emptyLayer, volumeLostM3: 0, limitedBy: 'geometry',
      warnings: ['Зона осложнения внутри/выше моста — ветка объёмных потерь.'],
    };
  }

  const gapToZone = lossZone.topMD - plugBottomMD;

  // ── ШАГ 1: БАЛАНС СИЛ ──
  const profile = analyzePlugProfile(plugTopMD, plugBottomMD, trajectory, cement, annAreaM2, boreDiamM, wellFluid.densityGcm3, frictionCoeff);
  const drive = profile.totalDrive;

  const baseGel = cement.gel10minPa > 0 ? cement.gel10minPa : 15;
  const gel0 = gelFromConsistency(5, baseGel);
  const gelHold0 = gel0 * wallPerim * plugLen;
  const wfGel = wellFluid.gel10minPa > 0 ? wellFluid.gel10minPa : Math.max(1, wellFluid.ypPa * 2);
  const wellFluidSupport = wfGel * wallPerim * gapToZone;
  const padHeightM = padVolumeM3 / Math.max(annAreaM2, 1e-6);
  let padResist = 0;
  if (viscousPad && padVolumeM3 > 0) {
    const padYP = viscousPad.ypPa > 0 ? viscousPad.ypPa : 10;
    const padGel = viscousPad.gel10minPa > 0 ? viscousPad.gel10minPa : padYP * 3;
    padResist = (padYP + padGel) * wallPerim * padHeightM;
  }
  const totalResist0 = gelHold0 + profile.totalFriction + padResist + wellFluidSupport;

  if (totalResist0 >= drive) {
    warnings.push(`✓ Удерживающие силы (${(totalResist0/1000).toFixed(0)} кН: гель+трение+пачка+жидкость) ≥ вес ${(drive/1000).toFixed(0)} кН — мост стабилен.`);
    return {
      willSettle: false, settlementM: 0, settleVelocityMs: 0,
      finalHeadMD: plugTopMD, finalBottomMD: plugBottomMD,
      reachesLossZone: false, arrestMechanism: 'stable', consistencyAtArrest: 5,
      forceBalance: { driveKN: drive/1000, gelKN: gelHold0/1000, frictionKN: profile.totalFriction/1000,
        padKN: padResist/1000, wellFluidKN: wellFluidSupport/1000, netKN: (drive-totalResist0)/1000 },
      zoneCapacityM3: lossZoneCapacity(lossZone, boreDiamM),
      zoneCanSelfArrest: lossSelfArrests(lossZone),
      layerBreakdown: emptyLayer, volumeLostM3: 0, limitedBy: 'geometry',
      warnings,
    };
  }

  // ── ШАГ 2: Время до гель-стопа (70 Вс) с поправкой Аррениуса по T забоя ──
  // Высокая температура ускоряет гелирование → меньше осадка (по правилу удвоения скорости
  // реакции на каждые ~10 °C). t30/t50 масштабируются как t' = t × 2^((20−T)/10), референс T=20 °C.
  const tempAccel = Math.pow(2, (bhTempC - 20) / 10); // T=60 → ×16 быстрее; T=20 → ×1
  const t30Eff = cement.thickeningTime30Bc > 0 ? cement.thickeningTime30Bc / tempAccel : 0;
  const t50Eff = cement.thickeningTime50Bc > 0 ? cement.thickeningTime50Bc / tempAccel : 0;
  let timeToGelStopMin = totalOpTimeMin;
  for (let t = 0; t <= totalOpTimeMin; t += 1) {
    if (consistencyAtTime(t, t30Eff, t50Eff) >= 70) {
      timeToGelStopMin = t; break;
    }
  }

  // ── ШАГ 3: Ограничители ПОЛНОГО объёма ухода ──
  const capacity = lossZoneCapacity(lossZone, boreDiamM);
  const canSelfArrest = lossSelfArrests(lossZone);
  // LCM-фактор клампим в [0.02..1]; влияние сильное и непрерывное.
  const lcm = Math.max(0.02, Math.min(1, lcmReductionFactor));
  const effLossRateM3h = lossZone.initialLossRateM3h * lcm;

  const volByTime = effLossRateM3h * (timeToGelStopMin / 60);
  const volByCapacity = canSelfArrest ? capacity : Infinity;
  const volAvailableM3 = Math.min(volByTime, volByCapacity);

  let limitedBy: 'capacity' | 'gelation' | 'geometry';
  limitedBy = volAvailableM3 === volByCapacity ? 'capacity' : 'gelation';

  // ── ШАГ 4: подвижность ──
  const fluidGapM = Math.max(0, gapToZone - padHeightM);
  const fluidVolM3 = fluidGapM * annAreaM2;
  const bcAtStop = userBcAtStop > 0
    ? userBcAtStop
    : consistencyAtTime(timeToGelStopMin / 2, t30Eff, t50Eff);
  const gelMid = gelFromConsistency(Math.max(bcAtStop, 5), cement.gel10minPa > 0 ? cement.gel10minPa : 15);
  const ypMid = ypFromConsistency(Math.max(bcAtStop, 5), cement.ypPa > 0 ? cement.ypPa : 8);
  const padDensity = viscousPad ? viscousPad.densityGcm3 : wellFluid.densityGcm3;
  const belowAvgDensity = (padHeightM + fluidGapM) > 0
    ? (padDensity * padHeightM + wellFluid.densityGcm3 * fluidGapM) / (padHeightM + fluidGapM)
    : wellFluid.densityGcm3;
  const avgZenRad = (profile.avgZenith ?? 0) * Math.PI / 180;
  const driveP = (cement.densityGcm3 - belowAvgDensity) * 1000 * G * plugLen * Math.cos(avgZenRad);
  // Стеновое трение: реологическое (YP+gel) + механическое (μ×нормаль/площадь)
  const wallFricRheo = (gelMid + ypMid) * wallPerim * plugLen / Math.max(annAreaM2, 1e-6);
  const wallFricMech = Math.max(0, frictionCoeff) * (profile.totalNormal / Math.max(annAreaM2, 1e-6));
  const wallFricP = wallFricRheo + wallFricMech;
  let padResistP = 0;
  if (viscousPad && padVolumeM3 > 0) {
    const padYP = viscousPad.ypPa > 0 ? viscousPad.ypPa : 10;
    const padGel = viscousPad.gel10minPa > 0 ? viscousPad.gel10minPa : padYP * 3;
    padResistP = (padYP + padGel) * wallPerim * Math.max(padHeightM, 0.5) / Math.max(annAreaM2, 1e-6);
  }
  const resistP = wallFricP + padResistP;
  const mobility = driveP <= 0 ? 0 : Math.max(0, Math.min(1, (driveP - resistP) / driveP));

  // ── ШАГ 5: ПОСЛОЙНЫЙ уход (жидкость → пачка → ЦЕМЕНТ) ──
  const volLostM3 = volAvailableM3 * mobility;
  let rem = volLostM3;
  const fluidLost = Math.min(rem, fluidVolM3); rem -= fluidLost;
  const padLost = Math.min(rem, padVolumeM3); rem -= padLost;
  const cementAvailableM3 = plugLen * annAreaM2;
  const cementLost = Math.min(Math.max(0, rem), cementAvailableM3);

  // ── ОСАДКА: материальный баланс. Всё, что ушло в пласт = снижение головы моста.
  //    Из жидкости/пачки осадка ≤ gapToZone (мост садится на зону), а уход цемента
  //    ДОБАВЛЯЕТ осадку за счёт укорочения колонны сверху (плавно, без скачка к gap).
  const settleFromBelow = Math.min((fluidLost + padLost) / Math.max(annAreaM2, 1e-6), gapToZone);
  const cementShrinkM = cementLost / Math.max(annAreaM2, 1e-6);
  const cementReachedZone = cementLost > 0.05;
  const cumSettle = Math.min(settleFromBelow + cementShrinkM, gapToZone + plugLen);
  const actualVolLost = fluidLost + padLost + cementLost;

  let arrest: ArrestMechanism;
  if (cementReachedZone) arrest = 'reached_zone';
  else if (limitedBy === 'capacity') arrest = 'self_arrest_capacity';
  else if (mobility < 0.98) arrest = 'rheology_balance';
  else arrest = 'gelation';

  if (cementReachedZone) {
    warnings.push(`🔴 КАТАСТРОФА: цемент достиг зоны (ушло ${cementLost.toFixed(1)} м³ цемента в пласт). Изоляция НЕ обеспечена. Мост осел на ${cumSettle.toFixed(1)} м.`);
  } else if (padLost > 0.05) {
    warnings.push(`🟡 Мост осел на ${cumSettle.toFixed(1)} м. В пласт ушло: ${fluidLost.toFixed(2)} м³ жидкости + ${padLost.toFixed(2)} м³ пачки. ${padLost >= padVolumeM3 - 0.05 ? 'Пачка израсходована ПОЛНОСТЬЮ — следующей уйдёт цемент!' : 'Цемент ЦЕЛ — пачка приняла удар.'}`);
  } else if (cumSettle > 1) {
    warnings.push(`🟢 Мост осел на ${cumSettle.toFixed(1)} м, ушла только скважинная жидкость (${fluidLost.toFixed(2)} м³). Цемент и пачка целы.`);
  } else {
    warnings.push(`✓ Проседание незначительное (${cumSettle.toFixed(1)} м).`);
  }
  warnings.push(`Подвижность U-tube ${Math.round(mobility * 100)}%: drive ${driveP.toFixed(0)} Па vs сопротивление ${resistP.toFixed(0)} Па.`);
  if (limitedBy === 'capacity')
    warnings.push(`Зона "${lossZone.zoneType}" насытилась (ёмкость ${capacity.toFixed(1)} м³) — поглощение остановилось само.`);
  if (limitedBy === 'gelation')
    warnings.push(`Цемент загустел (70 Вс за ${timeToGelStopMin.toFixed(0)} мин) — уход прекратился. Быстрее загустевание → меньше осадка.`);
  if (padVolumeM3 > 0 && padLost >= padVolumeM3 - 0.05 && !cementReachedZone)
    warnings.push(`⚠ Пачка (${padVolumeM3.toFixed(1)} м³) на грани полного расхода. Увеличить объём пачки ИЛИ применить кольматант.`);
  if (cementReachedZone)
    warnings.push(`РЕШЕНИЕ: 1) кольматант/squeeze в зону ДО моста; 2) серия мостов через ОЗЦ; 3) больше пачки под мостом (нужно ≥ ${Math.max(0, actualVolLost - fluidVolM3).toFixed(1)} м³).`);

  return {
    willSettle: cumSettle > 0.5,
    settlementM: cumSettle,
    settleVelocityMs: timeToGelStopMin > 0 ? cumSettle / (timeToGelStopMin * 60) : 0,
    finalHeadMD: plugTopMD + cumSettle,
    finalBottomMD: plugBottomMD + cumSettle,
    reachesLossZone: cementReachedZone,
    arrestMechanism: arrest,
    consistencyAtArrest: bcAtStop,
    forceBalance: {
      driveKN: drive / 1000, gelKN: gelHold0 / 1000, frictionKN: profile.totalFriction / 1000,
      padKN: padResist / 1000, wellFluidKN: wellFluidSupport / 1000, netKN: (drive - totalResist0) / 1000,
    },
    zoneCapacityM3: capacity,
    zoneCanSelfArrest: canSelfArrest,
    layerBreakdown: { fluidLostM3: fluidLost, padLostM3: padLost, cementLostM3: cementLost },
    volumeLostM3: actualVolLost,
    limitedBy,
    warnings,
  };
}

// ───── БЛОК 6: ПАРАДОКС ОБЪЁМА ─────
export interface VolumeEffectRow {
  plugLengthM: number;
  cementVolumeM3: number;
  hydrostaticMPa: number;
  settlementM: number;
  finalHeadMD: number;
  isStable: boolean;
}
export interface VolumeEffectResult {
  tested: VolumeEffectRow[];
  increasingVolumeHelps: boolean;
  recommendation: string;
}
export function analyzeVolumeEffect(
  baseBottomMD: number,
  lossZone: LossZoneFull, cement: FullRheologyFluid, wellFluid: FullRheologyFluid,
  trajectory: ProfilePoint[], annAreaM2: number, boreDiamM: number,
  frictionCoeff: number, totalOpTimeMin: number,
): VolumeEffectResult {
  const lengths = [50, 100, 150, 200, 300];
  const tested = lengths.map(L => {
    const top = baseBottomMD - L;
    const s = calculatePlugSettlement(
      top, baseBottomMD, lossZone, cement, wellFluid, null, 0,
      trajectory, annAreaM2, boreDiamM, frictionCoeff, totalOpTimeMin, 1,
    );
    const hydrostatic = cement.densityGcm3 * 1000 * 9.81 * L / 1e6;
    return {
      plugLengthM: L, cementVolumeM3: L * annAreaM2, hydrostaticMPa: hydrostatic,
      settlementM: s.settlementM, finalHeadMD: s.finalHeadMD, isStable: !s.reachesLossZone,
    };
  });
  const helps = tested[tested.length - 1].settlementM < tested[0].settlementM;
  return {
    tested,
    increasingVolumeHelps: helps,
    recommendation: helps
      ? 'Увеличение объёма снижает проседание — допустимо нарастить колонну.'
      : '⚠ Увеличение объёма УСУГУБЛЯЕТ проседание (мост тяжелее, выше гидростатика). Решение — серия мостов через ОЗЦ.',
  };
}

// ───── БЛОК 7: СЕРИЯ МОСТОВ + ОЗЦ ─────
export function compressiveStrength(hours: number, bhTempC: number, ucsMax = 24, kRef = 0.045, alpha = 0.03): number {
  const k = kRef * Math.exp(alpha * (bhTempC - 20));
  return ucsMax * (1 - Math.exp(-k * Math.max(hours, 0)));
}
export function waitOnCementTime(targetUCS: number, bhTempC: number, ucsMax = 24, kRef = 0.045, alpha = 0.03): number {
  const k = kRef * Math.exp(alpha * (bhTempC - 20));
  const ratio = Math.min(0.99, Math.max(0.01, targetUCS / ucsMax));
  return -Math.log(1 - ratio) / Math.max(k, 1e-6);
}

export interface PlugDesign {
  sequence: number;
  purpose: 'support' | 'main';
  topMD: number;
  bottomMD: number;
  cementVolumeM3: number;
  wocHours: number;
  requiredUCSMPa: number;
  landsOn: 'bridge' | 'previous_plug';
}
export interface MultiPlugProgram {
  required: boolean;
  plugs: PlugDesign[];
  totalWOCHours: number;
  totalCementM3: number;
  supportAdequate: boolean;
  safetyFactor: number;
  rationale: string;
}

export function designMultiPlugProgram(
  targetHeadMD: number, lossZone: LossZoneFull, settlement: SettlementResult,
  annAreaM2: number, boreDiamM: number, cement: FullRheologyFluid,
  wellFluidDensity: number, bhTempC: number,
): MultiPlugProgram {
  if (!settlement.willSettle || settlement.settlementM < 5) {
    return { required: false, plugs: [], totalWOCHours: 0, totalCementM3: 0,
      supportAdequate: true, safetyFactor: 0,
      rationale: 'Одиночный мост удержится в проектном интервале.' };
  }
  const REQUIRED_UCS = 3.5; // МПа (API Spec 10A для опоры)
  const wocHours = waitOnCementTime(REQUIRED_UCS, bhTempC);

  const supportBot = lossZone.topMD;
  const supportTop = Math.max(lossZone.topMD - 30, targetHeadMD + 10);
  const supportVol = Math.max(0, supportBot - supportTop) * annAreaM2;

  const mainTop = targetHeadMD;
  const mainBot = supportTop;
  const mainLen = Math.max(0, mainBot - mainTop);
  const mainVol = mainLen * annAreaM2;
  const mainWeightKN = (cement.densityGcm3 - wellFluidDensity) * 1000 * 9.81 * mainLen * annAreaM2 / 1000;

  const supportCapacityKN = REQUIRED_UCS * 1000 * (Math.PI / 4 * boreDiamM * boreDiamM);
  const safetyFactor = mainWeightKN > 0 ? supportCapacityKN / mainWeightKN : 999;

  return {
    required: true,
    plugs: [
      { sequence: 1, purpose: 'support', topMD: supportTop, bottomMD: supportBot,
        cementVolumeM3: supportVol, wocHours, requiredUCSMPa: REQUIRED_UCS, landsOn: 'bridge' },
      { sequence: 2, purpose: 'main', topMD: mainTop, bottomMD: mainBot,
        cementVolumeM3: mainVol, wocHours, requiredUCSMPa: REQUIRED_UCS, landsOn: 'previous_plug' },
    ],
    totalWOCHours: wocHours * 2,
    totalCementM3: supportVol + mainVol,
    supportAdequate: safetyFactor > 1.5,
    safetyFactor,
    rationale: `Поглощение ${lossZone.initialLossRateM3h} м³/ч на ${lossZone.topMD.toFixed(0)} м вызывает проседание одиночного моста на ${settlement.settlementM.toFixed(0)} м. Решение: опорный мост ${supportTop.toFixed(0)}–${supportBot.toFixed(0)} м + ОЗЦ ${wocHours.toFixed(0)} ч (UCS ${REQUIRED_UCS} МПа), затем основной мост ${mainTop.toFixed(0)}–${mainBot.toFixed(0)} м на твёрдую опору. Несущая опоры ${supportCapacityKN.toFixed(0)} кН ${safetyFactor >= 1.5 ? '>' : '<'} веса основного ${mainWeightKN.toFixed(0)} кН (запас ${safetyFactor.toFixed(1)}×).`,
  };
}

// ───── БЛОК 8: ПРОРЫВ ГАЗА — БАЛАНС ДАВЛЕНИЙ ─────
export function kickInvasion(
  formationPressureMPa: number, cementHydrostaticMPa: number,
  cementGelPa: number, boreDiamM: number, plugLenM: number,
): number {
  const excess = formationPressureMPa - cementHydrostaticMPa;
  if (excess <= 0) return 0;
  const gelResistPerM = cementGelPa * Math.PI * boreDiamM / 1e6;
  return gelResistPerM > 0 ? Math.min(excess / gelResistPerM, plugLenM) : plugLenM;
}

// ───── БЛОК 9: ПОДЪЁМ МОСТА ПРИ ПРОЯВЛЕНИИ (обратный U-tube) + ЗОНЫ СМЕШЕНИЯ ─────
// Когда Pпл > Pгидро на подошве, пластовый флюид «толкает» весь столб вверх:
// сначала поднимается нижняя вязкая пачка, затем цементный мост, выше — скв. жидкость.
// Сопротивление подъёму: статическая прочность геля цемента/пачки на стенке + трение по
// профилю. По мере подъёма Δh внизу освобождается канал, заполняемый ЛЁГКИМ пластовым
// флюидом (ρ_kick), что снижает гидростатику и поддерживает движение до равновесия:
//   (Pпл − Pгидро_новая) · A = Resist
// Длина зоны смешения по интерфейсам — корреляция Brice–Holmes / Lockyear–Hibbert:
//   L_mix ≈ K · √(D · v · t) ;  K=1.5 ламинар, K=3 турбулент.
// Загрязнение низа цемента линейно с длиной смешения пачка↔цемент; снижение UCS:
//   ΔUCS% ≈ min(90, 5 · contamination%)  (эмпирика API/SPE по образцам).
export type KickFluidType = 'gas' | 'oil' | 'water';
const KICK_DENSITY_GCM3: Record<KickFluidType, number> = { gas: 0.20, oil: 0.75, water: 1.05 };

export interface KickLiftResult {
  willLift: boolean;
  formationFluidType: KickFluidType;
  formationFluidDensityGcm3: number;
  netDriveKN: number;          // Pпл − Pгидро на подошве (стартовый дисбаланс) × A
  resistTotalKN: number;       // суммарное сопротивление подъёму
  resistBreakdown: { gelCementKN: number; gelPadKN: number; frictionKN: number };
  liftHeightM: number;         // Δh подъёма всей пачки+моста
  finalPlugTopMD: number;
  finalPlugBottomMD: number;
  finalPadTopMD: number;
  finalPadBottomMD: number;
  // Зоны смешения
  mixingPadKickM: number;      // пачка ↔ пласт. флюид (снизу)
  mixingCementPadM: number;    // цемент ↔ пачка (на подошве моста)
  mixingCementWellM: number;   // цемент ↔ скв. жидкость (на кровле моста)
  contaminatedCementLengthM: number;
  contaminationPct: number;    // от длины моста
  ucsLossPct: number;
  cleanCementTopMD: number;
  cleanCementBottomMD: number;
  arrestMechanism: 'no_lift' | 'pressure_balance' | 'gel_yield' | 'reached_surface';
  warnings: string[];
}

export function calculateKickLift(
  plugTopMD: number, plugBottomMD: number, plugBottomTVD: number,
  formationPressureMPa: number, formationFluidType: KickFluidType,
  cement: FullRheologyFluid, wellFluid: FullRheologyFluid,
  viscousPad: FullRheologyFluid | null, padHeightM: number,
  annAreaM2: number, boreDiamM: number,
  trajectory: ProfilePoint[], frictionCoeff: number,
  totalOpTimeMin: number,
): KickLiftResult {
  const warnings: string[] = [];
  const plugLen = Math.max(1, plugBottomMD - plugTopMD);
  const wallPerim = Math.PI * boreDiamM;
  const rhoKick = KICK_DENSITY_GCM3[formationFluidType];

  // 1) Стартовый дисбаланс на подошве моста (по TVD — гидростатика зависит от вертикали, не от MD)
  const wfDensity = wellFluid.densityGcm3;
  const cDensity = cement.densityGcm3;
  const padDensity = viscousPad?.densityGcm3 ?? wfDensity;
  const plugTopTVD = interpolateTVD(plugTopMD, trajectory);
  const plugBottomTVD_real = Number.isFinite(plugBottomTVD) && plugBottomTVD > 0
    ? plugBottomTVD : interpolateTVD(plugBottomMD, trajectory);
  const padBottomTVD = interpolateTVD(plugBottomMD + Math.max(0, padHeightM), trajectory);
  const Phydro0 = (
    wfDensity * plugTopTVD +
    cDensity * Math.max(0, plugBottomTVD_real - plugTopTVD) +
    padDensity * Math.max(0, padBottomTVD - plugBottomTVD_real)
  ) * 1000 * 9.81 / 1e6;
  const excessMPa = formationPressureMPa - Phydro0;
  const drive0Pa = Math.max(0, excessMPa * 1e6);
  const drive0KN = drive0Pa * annAreaM2 / 1000;

  // 2) Сопротивление подъёму (статика геля + трение по профилю)
  const cementGel = cement.gel10minPa > 0 ? cement.gel10minPa : cement.ypPa * 3;
  const padGel = viscousPad ? (viscousPad.gel10minPa > 0 ? viscousPad.gel10minPa : viscousPad.ypPa * 3) : 0;
  const gelCementF = cementGel * wallPerim * plugLen;          // Н
  const gelPadF = padGel * wallPerim * Math.max(0, padHeightM); // Н
  const profile = analyzePlugProfile(
    plugTopMD, plugBottomMD, trajectory, cement,
    annAreaM2, boreDiamM, wfDensity, frictionCoeff,
  );
  const frictionF = profile.totalFriction; // Н (зависит от DLS/трения по стволу)
  const resistTotalF = gelCementF + gelPadF + frictionF;
  const resistKN = resistTotalF / 1000;

  // 3) Подъём произойдёт только если стартовый дисбаланс > статика
  if (drive0KN <= resistKN || drive0KN <= 0) {
    return {
      willLift: false, formationFluidType, formationFluidDensityGcm3: rhoKick,
      netDriveKN: drive0KN, resistTotalKN: resistKN,
      resistBreakdown: { gelCementKN: gelCementF / 1000, gelPadKN: gelPadF / 1000, frictionKN: frictionF / 1000 },
      liftHeightM: 0, finalPlugTopMD: plugTopMD, finalPlugBottomMD: plugBottomMD,
      finalPadTopMD: plugBottomMD, finalPadBottomMD: plugBottomMD + padHeightM,
      mixingPadKickM: 0, mixingCementPadM: 0, mixingCementWellM: 0,
      contaminatedCementLengthM: 0, contaminationPct: 0, ucsLossPct: 0,
      cleanCementTopMD: plugTopMD, cleanCementBottomMD: plugBottomMD,
      arrestMechanism: drive0KN <= 0 ? 'no_lift' : 'gel_yield',
      warnings: drive0KN <= 0
        ? [`✅ Гидростатика моста ${Phydro0.toFixed(1)} МПа ≥ пластового ${formationPressureMPa.toFixed(1)} МПа (по TVD зоны) — подъём невозможен, мост держит проявление.`]
        : [`✅ Статический гель (${(resistKN).toFixed(0)} кН) удерживает столб от подъёма (избыток ${excessMPa.toFixed(1)} МПа, драйв ${drive0KN.toFixed(0)} кН).`],
    };
  }

  // 4) Равновесная высота подъёма: после Δh внизу столб lift-флюида толкает вверх.
  // Δ(гидростатики) = (ρ_cement_effective − ρ_kick) · g · Δh, где ρ_cement_effective =
  // средняя плотность поднимающегося столба (пачка+цемент) с учётом размеров.
  const liftCol = (cDensity * plugLen + padDensity * Math.max(0, padHeightM)) /
    Math.max(0.01, plugLen + Math.max(0, padHeightM));
  const ΔρKgM3 = Math.max(50, (liftCol - rhoKick) * 1000); // кг/м³
  // (Drive0 − Resist) = Δρ·g·A·Δh  ⇒  Δh = (Drive0 − Resist) / (Δρ·g·A)
  const liftEq = (drive0Pa * annAreaM2 - resistTotalF) / (ΔρKgM3 * 9.81 * annAreaM2);
  // Геометрический предел: до устья (≈ plugTopMD = глубина головы) минус 5 м запас
  const liftMax = Math.max(0, plugTopMD - 5);
  const liftH = Math.min(liftEq, liftMax);
  let arrest: KickLiftResult['arrestMechanism'] = 'pressure_balance';
  if (liftEq > liftMax) arrest = 'reached_surface';

  // 5) Зоны смешения (Brice–Holmes / Lockyear–Hibbert)
  // Скорость подъёма усреднённая: v = Δh / время загустевания (или операции, что короче).
  const tArrestMin = Math.max(1, Math.min(totalOpTimeMin, cement.thickeningTime30Bc > 0 ? cement.thickeningTime30Bc : totalOpTimeMin));
  const vAvgMs = (liftH / 60) / Math.max(1, tArrestMin); // м/с (грубо)
  const tSec = tArrestMin * 60;
  // Режим: оценим Re по средним свойствам цемента: Re = ρvD/μ, μ≈PV в Па·с (PV в мПа·с / 1000)
  const μ = Math.max(1e-4, (cement.pvMPas > 0 ? cement.pvMPas : 50) / 1000);
  const Re = (cDensity * 1000) * Math.max(vAvgMs, 1e-4) * boreDiamM / μ;
  const Kmix = Re > 2100 ? 3.0 : 1.5;
  const lMix = (intf: 'cementPad' | 'padKick' | 'cementWell') => {
    if (liftH < 0.1) return 0;
    const base = Kmix * Math.sqrt(boreDiamM * Math.max(vAvgMs, 1e-4) * tSec);
    // Сильнее всего смешивается интерфейс с большим контрастом плотности
    const k = intf === 'padKick' ? 1.0
             : intf === 'cementPad' ? (viscousPad ? 0.6 : 0.0)
             : 0.4;
    return Math.min(base * k, plugLen * 0.6);
  };
  const mixPadKick = lMix('padKick');
  const mixCementPad = lMix('cementPad');
  const mixCementWell = lMix('cementWell');

  const contaminatedLen = mixCementPad + mixCementWell;
  const contaminationPct = (contaminatedLen / plugLen) * 100;
  const ucsLossPct = Math.min(90, 5 * contaminationPct);

  const finalPlugTop = plugTopMD - liftH;
  const finalPlugBot = plugBottomMD - liftH;
  const finalPadTop = finalPlugBot;
  const finalPadBot = finalPadTop + padHeightM;
  // Чистый цемент = поднятый интервал за вычетом смешений с обеих сторон
  const cleanTop = finalPlugTop + mixCementWell;
  const cleanBot = finalPlugBot - mixCementPad;

  if (arrest === 'reached_surface')
    warnings.push(`⛔ КАТАСТРОФА: мост поднят до устья (Δh=${liftH.toFixed(0)} м) — изоляция полностью нарушена, флюид на поверхности.`);
  else
    warnings.push(`⚠ Мост поднят на ${liftH.toFixed(0)} м: голова ${plugTopMD.toFixed(0)}→${finalPlugTop.toFixed(0)} м, подошва ${plugBottomMD.toFixed(0)}→${finalPlugBot.toFixed(0)} м.`);
  if (contaminationPct > 30)
    warnings.push(`⛔ Зоны смешения дают контаминацию ${contaminationPct.toFixed(0)}% длины моста (UCS↓${ucsLossPct.toFixed(0)}%). Мост непригоден.`);
  else if (contaminationPct > 10)
    warnings.push(`⚠ Контаминация ${contaminationPct.toFixed(0)}% длины (UCS↓${ucsLossPct.toFixed(0)}%). Рабочая зона: ${cleanTop.toFixed(0)}–${cleanBot.toFixed(0)} м.`);
  if (finalPlugTop < 30)
    warnings.push(`⚠ Голова поднята почти до устья — реальная угроза выброса.`);

  return {
    willLift: true, formationFluidType, formationFluidDensityGcm3: rhoKick,
    netDriveKN: drive0KN, resistTotalKN: resistKN,
    resistBreakdown: { gelCementKN: gelCementF / 1000, gelPadKN: gelPadF / 1000, frictionKN: frictionF / 1000 },
    liftHeightM: liftH,
    finalPlugTopMD: finalPlugTop, finalPlugBottomMD: finalPlugBot,
    finalPadTopMD: finalPadTop, finalPadBottomMD: finalPadBot,
    mixingPadKickM: mixPadKick, mixingCementPadM: mixCementPad, mixingCementWellM: mixCementWell,
    contaminatedCementLengthM: contaminatedLen, contaminationPct, ucsLossPct,
    cleanCementTopMD: cleanTop, cleanCementBottomMD: cleanBot,
    arrestMechanism: arrest, warnings,
  };
}

// ───── БЛОК 10: ORCHESTRATOR ─────
export interface FullComplicationAnalysis {
  scenario: 'zone_below' | 'zone_inside' | 'zone_above' | 'kick' | 'none';
  settlement: SettlementResult | null;
  volumeEffect: VolumeEffectResult | null;
  multiPlug: MultiPlugProgram | null;
  transitionWindow: TransitionWindow | null;
  kickInvasionM: number;
  kickLift: KickLiftResult | null;
  kick: KickResult | null;
}


export function analyzePlugComplicationFull(
  plugTopMD: number, plugBottomMD: number,
  lossZone: LossZoneFull | null,
  cement: FullRheologyFluid, wellFluid: FullRheologyFluid,
  viscousPad: FullRheologyFluid | null, padHeightM: number,
  trajectory: ProfilePoint[],
  annAreaM2: number, boreDiamM: number,
  frictionCoeff: number,
  totalOpTimeMin: number,
  lcmReductionFactor: number,
  bhTempC: number,
  kickFormationPressureMPa: number,
  hasGasZone: boolean,
  formationFluidType: KickFluidType = 'water',
  plugBottomTVD: number = plugBottomMD,
  userBcAtStop: number = 0,
): FullComplicationAnalysis {
  const tw = (cement.thickeningTime30Bc > 0 && cement.thickeningTime50Bc > 0)
    ? transitionWindow(cement.thickeningTime30Bc, cement.thickeningTime50Bc, hasGasZone) : null;

  let kickInv = 0;
  let kickLift: KickLiftResult | null = null;
  let kick: KickResult | null = null;
  if (kickFormationPressureMPa > 0) {
    const hydro = cement.densityGcm3 * 1000 * 9.81 * (plugBottomMD) / 1e6;
    const gel = cement.gel10minPa > 0 ? cement.gel10minPa : cement.ypPa * 3;
    kickInv = kickInvasion(kickFormationPressureMPa, hydro, gel, boreDiamM, plugBottomMD - plugTopMD);
    kickLift = calculateKickLift(
      plugTopMD, plugBottomMD, plugBottomTVD,
      kickFormationPressureMPa, formationFluidType,
      cement, wellFluid, viscousPad, padHeightM,
      annAreaM2, boreDiamM, trajectory, frictionCoeff, totalOpTimeMin,
    );
    kick = calculateKick(
      plugTopMD, plugBottomMD, plugBottomTVD,
      kickFormationPressureMPa, plugBottomMD,
      cement, wellFluid, viscousPad, padHeightM,
      trajectory, annAreaM2, boreDiamM, totalOpTimeMin, formationFluidType,
    );
  }

  if (!lossZone || lossZone.initialLossRateM3h <= 0) {
    return { scenario: kickInv > 0 || kickLift ? 'kick' : 'none', settlement: null,
      volumeEffect: null, multiPlug: null, transitionWindow: tw, kickInvasionM: kickInv, kickLift, kick };
  }

  if (lossZone.topMD > plugBottomMD) {
    const settlement = calculatePlugSettlement(
      plugTopMD, plugBottomMD, lossZone, cement, wellFluid, viscousPad,
      padHeightM * annAreaM2, trajectory, annAreaM2, boreDiamM, frictionCoeff,
      totalOpTimeMin, lcmReductionFactor, userBcAtStop, bhTempC,
    );
    let volumeEffect: VolumeEffectResult | null = null;
    let multiPlug: MultiPlugProgram | null = null;
    if (settlement.willSettle) {
      volumeEffect = analyzeVolumeEffect(
        plugBottomMD, lossZone, cement, wellFluid, trajectory,
        annAreaM2, boreDiamM, frictionCoeff, totalOpTimeMin,
      );
      multiPlug = designMultiPlugProgram(
        plugTopMD, lossZone, settlement, annAreaM2, boreDiamM,
        cement, wellFluid.densityGcm3, bhTempC,
      );
    }
    return { scenario: 'zone_below', settlement, volumeEffect, multiPlug, transitionWindow: tw, kickInvasionM: kickInv, kickLift, kick };
  }

  const inside = lossZone.topMD + lossZone.thicknessM / 2 >= plugTopMD
              && lossZone.topMD - lossZone.thicknessM / 2 <= plugBottomMD;
  return {
    scenario: inside ? 'zone_inside' : 'zone_above',
    settlement: null, volumeEffect: null, multiPlug: null,
    transitionWindow: tw, kickInvasionM: kickInv, kickLift, kick,
  };
}

// ───── БЛОК 11: ПРОЯВЛЕНИЕ — ВНЕДРЕНИЕ ФЛЮИДА В МОСТ СНИЗУ ─────
export interface KickResult {
  breakthrough: boolean;
  invasionDepthM: number;
  excessPressureMPa: number;
  finalCementHeightM: number;
  contaminatedZoneM: number;
  gasMigrationTimeMin: number;
  pressureBalance: {
    formationMPa: number;
    cementHydrostaticMPa: number;
    gelResistanceMPa: number;
    padResistanceMPa: number;
    netMPa: number;
  };
  arrestMechanism: 'hydrostatic_hold' | 'gel_arrest' | 'pad_arrest' | 'full_breakthrough' | 'gelation_time';
  isolationSecure: boolean;
  formationFluidType: KickFluidType;
  warnings: string[];
}

export function calculateKick(
  plugTopMD: number, plugBottomMD: number,
  plugBottomTVD: number,
  formationPressureMPa: number,
  zoneMD: number,
  cement: FullRheologyFluid, wellFluid: FullRheologyFluid, viscousPad: FullRheologyFluid | null,
  padHeightM: number,
  trajectory: ProfilePoint[],
  annAreaM2: number, boreDiamM: number,
  totalOpTimeMin: number,
  formationFluidType: KickFluidType,
): KickResult {
  const G = 9.81;
  const plugLen = Math.max(1, plugBottomMD - plugTopMD);
  const wallPerim = Math.PI * boreDiamM;
  const warnings: string[] = [];
  void trajectory; void zoneMD;

  // Гидростатика моста на уровне подошвы (TVD)
  const cementHydro = cement.densityGcm3 * 1000 * G * plugBottomTVD / 1e6;
  const excess = formationPressureMPa - cementHydro;

  // Сопротивление геля цемента на полную длину моста (в эквиваленте МПа)
  const bc = consistencyAtTime(totalOpTimeMin, cement.thickeningTime30Bc, cement.thickeningTime50Bc);
  const gel = gelFromConsistency(Math.max(bc, 5), cement.gel10minPa > 0 ? cement.gel10minPa : 15);
  const gelResistMPa = (gel * wallPerim * plugLen) / (annAreaM2 * 1e6);

  // Сопротивление вязкой пачки (первый барьер снизу)
  let padResistMPa = 0;
  if (viscousPad && padHeightM > 0) {
    const padGel = viscousPad.gel10minPa > 0 ? viscousPad.gel10minPa : viscousPad.ypPa * 3;
    padResistMPa = (padGel * wallPerim * padHeightM) / (annAreaM2 * 1e6);
  }

  const totalResist = gelResistMPa + padResistMPa;
  const net = excess - totalResist;
  const breakthrough = net > 0;

  // Глубина внедрения
  const gelResistPerM = gel * wallPerim / (annAreaM2 * 1e6);
  let invasionDepth = 0;
  if (breakthrough && gelResistPerM > 0) {
    const padInvasion = padHeightM > 0 ? Math.min(padHeightM, net / (gelResistPerM * 0.5)) : 0;
    const remainingExcess = Math.max(0, net - padResistMPa);
    const cementInvasion = Math.min(plugLen, remainingExcess / gelResistPerM);
    invasionDepth = padInvasion + cementInvasion;
  }

  // Время миграции газа
  let gasMigrationTime = Infinity;
  if (formationFluidType === 'gas' && breakthrough) {
    const migrationVelocity = Math.max(0.001, net / (gel / 100 + 1));
    gasMigrationTime = invasionDepth / migrationVelocity;
  }

  const finalCementHeight = Math.max(0, plugLen - Math.max(0, invasionDepth - padHeightM));
  const contaminatedZone = Math.min(plugLen, Math.max(0, invasionDepth - padHeightM));

  let arrest: KickResult['arrestMechanism'];
  if (!breakthrough && cementHydro >= formationPressureMPa) arrest = 'hydrostatic_hold';
  else if (!breakthrough) arrest = padResistMPa > gelResistMPa ? 'pad_arrest' : 'gel_arrest';
  else if (invasionDepth >= plugLen) arrest = 'full_breakthrough';
  else arrest = 'gel_arrest';

  if (!breakthrough) {
    warnings.push(`✓ Мост держит проявление: гидростатика ${cementHydro.toFixed(1)} МПа + сопротивление ${totalResist.toFixed(1)} МПа > пластового ${formationPressureMPa.toFixed(1)} МПа.`);
  } else if (invasionDepth >= plugLen) {
    warnings.push(`🔴 ПОЛНЫЙ ПРОРЫВ: флюид прошёл мост насквозь (избыток ${excess.toFixed(1)} МПа). Изоляция НЕ обеспечена. Увеличить плотность цемента или длину моста.`);
  } else {
    warnings.push(`🟡 Частичное внедрение ${formationFluidType === 'gas' ? 'газа' : 'флюида'} на ${invasionDepth.toFixed(0)} м снизу. Чистого цемента: ${finalCementHeight.toFixed(0)} м.`);
  }
  if (formationFluidType === 'gas' && breakthrough && gasMigrationTime < totalOpTimeMin) {
    warnings.push(`⚠ Газ мигрирует через мост за ~${gasMigrationTime.toFixed(0)} мин (до загустевания). Риск МКД. Применить газоблокирующий цемент или короткое переходное время.`);
  }
  if (breakthrough) {
    const reqDensity = formationPressureMPa * 1e6 / (G * plugBottomTVD) / 1000 * 1.05;
    warnings.push(`Рекомендуемая плотность цемента для удержания: ≥ ${reqDensity.toFixed(2)} г/см³ (текущая ${cement.densityGcm3.toFixed(2)}).`);
  }

  return {
    breakthrough,
    invasionDepthM: invasionDepth,
    excessPressureMPa: excess,
    finalCementHeightM: finalCementHeight,
    contaminatedZoneM: contaminatedZone,
    gasMigrationTimeMin: isFinite(gasMigrationTime) ? gasMigrationTime : 0,
    pressureBalance: {
      formationMPa: formationPressureMPa,
      cementHydrostaticMPa: cementHydro,
      gelResistanceMPa: gelResistMPa,
      padResistanceMPa: padResistMPa,
      netMPa: net,
    },
    arrestMechanism: arrest,
    isolationSecure: !breakthrough || invasionDepth < plugLen * 0.5,
    formationFluidType,
    warnings,
  };
}


