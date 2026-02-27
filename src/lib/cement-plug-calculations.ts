/**
 * Cement Plug (Bridge Plug) balanced placement calculations.
 */

import { interpolateTVD, calculateTVDFromSurvey, type TrajectoryPoint, type Rheology } from "./cementing-calculations";

/* ───── Interfaces ───── */

export interface PlugWellData {
  wellDepthMD: number;
  holeDiameter: number;
  casingShoe: number;
  casingID: number;
  pipeOD: number;
  pipeID: number;
  cavernCoeff: number; // коэффициент кавернозности (only for open hole)
  trajectory: TrajectoryPoint[];
}

export interface PlugFluid {
  name: string;
  density: number;
  rheology: Rheology;
}

export interface PlugInterval {
  topMD: number;
  bottomMD: number;
}

export type WashType = 'direct' | 'reverse';

export interface PlugInputs {
  well: PlugWellData;
  plug: PlugInterval;
  cement: PlugFluid;
  spacer: PlugFluid;
  wellFluid: PlugFluid;
  spacerVolumeAboveM3: number;
  spacerVolumeBelowM3: number;
  safetyMarginM: number;
  thickeningTimeMin: number;
  pullOutAbovePlugM: number;
  washType: WashType;
  washCycles: number;
  tripSpeedMs: number;
  pumpRateCementLs: number;
  pumpRateSpacerLs: number;
  pumpRateDisplacementLs: number;
  pumpRateWashLs: number;
}

/* ───── Geometry helpers ───── */

function area(diameterMm: number): number {
  const d = diameterMm / 1000;
  return (Math.PI / 4) * d * d;
}

function annularArea(outerMm: number, innerMm: number): number {
  return area(outerMm) - area(innerMm);
}

function hydroP(densityGcm3: number, tvdM: number): number {
  return densityGcm3 * 9.81 * tvdM / 1000;
}

/* ───── Results ───── */

export interface PumpingStage {
  name: string;
  fluid: string;
  volumeM3: number;
  timeMin: number;
  description: string;
}

export interface PlugResults {
  annArea: number;
  pipeArea: number;
  plugLengthMD: number;
  plugTopTVD: number;
  plugBottomTVD: number;
  plugLengthTVD: number;

  cementVolumeAnn: number;
  cementVolumePipe: number;
  cementVolumeTotal: number;
  spacerVolumeBelow: number;
  spacerVolumeAbove: number;

  spacerBelowHeightAnnMD: number;
  spacerAboveHeightAnnMD: number;

  cementHeightPipeMD: number;
  cementHeightAnnMD: number;
  heightDifferenceExplanation: string;

  pipeEndDepthMD: number;
  displacementVolume: number;

  pressureAnnulus: number;
  pressurePipe: number;
  isBalanced: boolean;

  fluidColumns: FluidColumn[];
  pumpingStages: PumpingStage[];
  processDescription: string;
  thickeningTimeMin: number;
  pullOutDepthMD: number;
  washVolumeM3: number;
  washType: WashType;
  washCycles: number;
  tripSpeedMs: number;
  tripTimeSec: number;

  isOpenHole: boolean;
  cavernCoeff: number;
  boreDiamUsed: number;

  // Timing
  safeTimeMin: number;         // 0.75 × thickeningTimeMin
  pumpTimeCementMin: number;
  pumpTimeSpacerBelowMin: number;
  pumpTimeSpacerAboveMin: number;
  pumpTimeDisplacementMin: number;
  tripTimeMin: number;
  washTimeMin: number;
  totalOperationTimeMin: number; // from cement pump start → wash complete
  isTimeSafe: boolean;
}

export interface FluidColumn {
  label: string;
  topMD: number;
  bottomMD: number;
  topTVD: number;
  bottomTVD: number;
  densityGcm3: number;
  color: string;
  location: 'annulus' | 'pipe';
}

/* ───── Main calculation ───── */

export function calculateBalancedPlug(input: PlugInputs): PlugResults {
  const { well, plug, cement, spacer, wellFluid, spacerVolumeAboveM3, spacerVolumeBelowM3, thickeningTimeMin, pullOutAbovePlugM, washType, washCycles, tripSpeedMs, pumpRateCementLs, pumpRateSpacerLs, pumpRateDisplacementLs, pumpRateWashLs } = input;

  const isOpenHole = plug.bottomMD > well.casingShoe;
  const cavernCoeff = isOpenHole ? Math.max(1, well.cavernCoeff || 1) : 1;
  // Effective bore diameter for open hole with cavern coefficient
  const boreDiam = isOpenHole ? well.holeDiameter * Math.sqrt(cavernCoeff) : well.casingID;

  const annA = annularArea(boreDiam, well.pipeOD);
  const pipeA = area(well.pipeID);

  const plugLenMD = Math.max(0, plug.bottomMD - plug.topMD);

  const traj = well.trajectory.length > 1 ? well.trajectory : [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: well.wellDepthMD, azimuth: 0, zenith: 0, tvd: well.wellDepthMD }];
  const plugTopTVD = interpolateTVD(plug.topMD, traj);
  const plugBottomTVD = interpolateTVD(plug.bottomMD, traj);
  const plugLenTVD = plugBottomTVD - plugTopTVD;

  const pipeEndMD = plug.bottomMD;

  // Areas
  const boreArea = area(boreDiam);
  const steelArea = area(well.pipeOD) - area(well.pipeID);

  // Spacer heights
  // Below plug: no pipe present below pipe end → full bore area
  const spacerBelowHeightAnn = boreArea > 0 ? spacerVolumeBelowM3 / boreArea : 0;
  // Above plug: pipe present → annular area
  const spacerAboveHeightAnn = annA > 0 ? spacerVolumeAboveM3 / annA : 0;

  // Cement: account for steel wall volume displacement
  // Target: final plug (after pipe removal) = plugLenMD height → V = boreArea * plugLenMD
  // During placement (pipe in hole): available area = annA + pipeA = boreArea - steelArea
  // So placement height = V / (annA + pipeA) > plugLenMD
  const cementVolTotal = boreArea * plugLenMD;
  const availableArea = annA + pipeA; // boreArea - steelArea
  const placementHeight = availableArea > 0 ? cementVolTotal / availableArea : plugLenMD;
  const extraHeight = placementHeight - plugLenMD;
  const cementHeightAnnMD = placementHeight;
  const cementHeightPipeMD = placementHeight; // equal heights for balance
  const cementVolAnn = annA * placementHeight;
  const cementVolPipe = pipeA * placementHeight;

  // Height difference explanation (steel wall volume effect)
  const heightDifferenceExplanation = `Высота цемента при установке: ${placementHeight.toFixed(2)} м (на ${extraHeight.toFixed(2)} м выше интервала моста ${plugLenMD} м). ` +
    `Причина: стенки инструмента (Sстали = ${(steelArea * 1e4).toFixed(1)} см², объём ${(steelArea * plugLenMD * 1000).toFixed(1)} л) вытесняют цемент вверх. ` +
    `После извлечения труб мост осядет до проектных ${plugLenMD} м. ` +
    `Sзатр = ${(annA * 1e4).toFixed(1)} см², Sтруб = ${(pipeA * 1e4).toFixed(1)} см².`;

  // Spacer in pipe: same HEIGHT as annulus for balance
  const spacerBelowPipeHeight = spacerBelowHeightAnn;
  const spacerAbovePipeHeight = spacerAboveHeightAnn;

  // Cement top during placement (extends above plug.topMD due to steel volume)
  const cementTopMD = plug.bottomMD - placementHeight; // above plug.topMD by extraHeight
  const cementTopInPipeMD = cementTopMD; // same for pipe (balanced)
  const spacerAboveTopPipeMD = cementTopMD - spacerAboveHeightAnn;
  const displacementVolume = pipeA * Math.max(0, spacerAboveTopPipeMD);

  // Static pressures at plug bottom (pipe end level)
  const spacerAboveTopMD = cementTopMD - spacerAboveHeightAnn;
  const spacerBelowBottomMD = plug.bottomMD + spacerBelowHeightAnn;
  const cementTopTVD = interpolateTVD(Math.max(0, cementTopMD), traj);
  const spacerAboveTopTVD = interpolateTVD(Math.max(0, spacerAboveTopMD), traj);
  const spacerBelowBottomTVD = interpolateTVD(Math.min(well.wellDepthMD, spacerBelowBottomMD), traj);

  const mudTVD_ann = Math.max(0, spacerAboveTopTVD);
  const spacerAboveTVD = Math.max(0, cementTopTVD - spacerAboveTopTVD);
  const spacerBelowTVD = Math.max(0, spacerBelowBottomTVD - plugBottomTVD);
  const cementTVD = Math.max(0, plugBottomTVD - cementTopTVD);

  // Balanced plug: identical fluid columns → equal pressures
  const pAnn = hydroP(wellFluid.density, mudTVD_ann)
    + hydroP(spacer.density, spacerAboveTVD)
    + hydroP(cement.density, cementTVD);

  const pPipe = hydroP(wellFluid.density, mudTVD_ann)
    + hydroP(spacer.density, spacerAboveTVD)
    + hydroP(cement.density, cementTVD);

  const isBalanced = Math.abs(pAnn - pPipe) < 0.5;

  // Fluid columns
  const fluidColumns: FluidColumn[] = [];
  const mudColor = "#8B7355";
  const spacerColor = "#4FC3F7";
  const cementColor = "#B0BEC5";

  // Annulus
  fluidColumns.push({
    label: wellFluid.name, topMD: 0, bottomMD: Math.max(0, spacerAboveTopMD),
    topTVD: 0, bottomTVD: spacerAboveTopTVD,
    densityGcm3: wellFluid.density, color: mudColor, location: 'annulus',
  });
  if (spacerAboveHeightAnn > 0) {
    fluidColumns.push({
      label: spacer.name + " (верх)", topMD: Math.max(0, spacerAboveTopMD), bottomMD: cementTopMD,
      topTVD: spacerAboveTopTVD, bottomTVD: cementTopTVD,
      densityGcm3: spacer.density, color: spacerColor, location: 'annulus',
    });
  }
  fluidColumns.push({
    label: cement.name, topMD: cementTopMD, bottomMD: plug.bottomMD,
    topTVD: cementTopTVD, bottomTVD: plugBottomTVD,
    densityGcm3: cement.density, color: cementColor, location: 'annulus',
  });
  if (spacerBelowHeightAnn > 0) {
    fluidColumns.push({
      label: spacer.name + " (низ)", topMD: plug.bottomMD, bottomMD: spacerBelowBottomMD,
      topTVD: plugBottomTVD, bottomTVD: spacerBelowBottomTVD,
      densityGcm3: spacer.density, color: spacerColor, location: 'annulus',
    });
  }
  fluidColumns.push({
    label: wellFluid.name, topMD: spacerBelowBottomMD, bottomMD: well.wellDepthMD,
    topTVD: spacerBelowBottomTVD, bottomTVD: interpolateTVD(well.wellDepthMD, traj),
    densityGcm3: wellFluid.density, color: mudColor, location: 'annulus',
  });

  // Pipe (balanced: same depths as annulus)
  fluidColumns.push({
    label: wellFluid.name + " (труб.)", topMD: 0, bottomMD: Math.max(0, spacerAboveTopPipeMD),
    topTVD: 0, bottomTVD: spacerAboveTopTVD,
    densityGcm3: wellFluid.density, color: mudColor, location: 'pipe',
  });
  if (spacerAbovePipeHeight > 0) {
    fluidColumns.push({
      label: spacer.name + " (труб. верх)", topMD: Math.max(0, spacerAboveTopPipeMD), bottomMD: cementTopMD,
      topTVD: spacerAboveTopTVD, bottomTVD: cementTopTVD,
      densityGcm3: spacer.density, color: spacerColor, location: 'pipe',
    });
  }
  fluidColumns.push({
    label: cement.name + " (труб.)", topMD: cementTopMD, bottomMD: plug.bottomMD,
    topTVD: cementTopTVD, bottomTVD: plugBottomTVD,
    densityGcm3: cement.density, color: cementColor, location: 'pipe',
  });

  // Pull-out and wash
  const pullOutDepthMD = Math.max(0, plug.topMD - pullOutAbovePlugM);
  const tripDistanceM = plug.bottomMD - pullOutDepthMD;
  const effectiveTripSpeed = tripSpeedMs > 0 ? tripSpeedMs : 0.3;
  const tripTimeSec = tripDistanceM / effectiveTripSpeed;

  let washOneCycleVolume: number;
  if (washType === 'direct') {
    washOneCycleVolume = annA * pullOutDepthMD;
  } else {
    washOneCycleVolume = pipeA * pullOutDepthMD;
  }
  const washVolumeM3 = washOneCycleVolume * washCycles;

  // ─── Timing calculations ───
  const volToMin = (volM3: number, qLs: number) => qLs > 0 ? (volM3 * 1000 / qLs) / 60 : 0;

  const pumpTimeSpacerBelowMin = volToMin(spacerVolumeBelowM3, pumpRateSpacerLs);
  const pumpTimeCementMin = volToMin(cementVolTotal, pumpRateCementLs);
  const pumpTimeSpacerAboveMin = volToMin(spacerVolumeAboveM3 + pipeA * spacerAboveHeightAnn, pumpRateSpacerLs);
  const pumpTimeDisplacementMin = volToMin(displacementVolume, pumpRateDisplacementLs);
  const tripTimeMin = tripTimeSec / 60;
  const washTimeMin = volToMin(washVolumeM3, pumpRateWashLs);

  const safeTimeMin = 0.75 * thickeningTimeMin;
  const totalOperationTimeMin = pumpTimeCementMin + pumpTimeSpacerAboveMin + pumpTimeDisplacementMin + tripTimeMin + washTimeMin;
  const isTimeSafe = totalOperationTimeMin <= safeTimeMin;

  // Pumping stages (including pull-out and wash)
  const pumpingStages: PumpingStage[] = [];

  if (spacerVolumeBelowM3 > 0) {
    pumpingStages.push({
      name: "Нижний буфер",
      fluid: `${spacer.name} (${spacer.density} г/см³)`,
      volumeM3: spacerVolumeBelowM3,
      timeMin: pumpTimeSpacerBelowMin,
      description: `Буферная жидкость ниже моста. Высота: ${spacerBelowHeightAnn.toFixed(1)} м`,
    });
  }

  pumpingStages.push({
    name: "Цементный раствор",
    fluid: `${cement.name} (${cement.density} г/см³)`,
    volumeM3: cementVolTotal,
    timeMin: pumpTimeCementMin,
    description: `Интервал моста. Затрубье: ${cementHeightAnnMD.toFixed(1)} м, трубы: ${cementHeightPipeMD.toFixed(1)} м`,
  });

  if (spacerVolumeAboveM3 > 0) {
    pumpingStages.push({
      name: "Верхний буфер",
      fluid: `${spacer.name} (${spacer.density} г/см³)`,
      volumeM3: spacerVolumeAboveM3 + (pipeA * spacerAboveHeightAnn),
      timeMin: pumpTimeSpacerAboveMin,
      description: `Буфер сверху цемента. Высота: ${spacerAboveHeightAnn.toFixed(1)} м`,
    });
  }

  pumpingStages.push({
    name: "Продавка",
    fluid: `${wellFluid.name} (${wellFluid.density} г/см³)`,
    volumeM3: displacementVolume,
    timeMin: pumpTimeDisplacementMin,
    description: "Продавка до установки равновесия",
  });

  pumpingStages.push({
    name: "Подъём инструмента",
    fluid: "—",
    volumeM3: 0,
    timeMin: tripTimeMin,
    description: `До ${pullOutDepthMD} м. V=${effectiveTripSpeed.toFixed(2)} м/с`,
  });

  const washTypeText = washType === 'direct' ? 'прямая' : 'обратная';
  pumpingStages.push({
    name: `Промывка (${washTypeText})`,
    fluid: `${wellFluid.name}`,
    volumeM3: washVolumeM3,
    timeMin: washTimeMin,
    description: `${washCycles} ц., 1 ц.= ${washOneCycleVolume.toFixed(2)} м³`,
  });

  const processDescription = [
    `1. Спуск бурильного инструмента (∅${well.pipeOD} мм) до забоя моста ${plug.bottomMD} м MD.`,
    spacerVolumeBelowM3 > 0 ? `2. Закачка нижнего буфера (${spacerVolumeBelowM3.toFixed(2)} м³, интервал ${spacerBelowHeightAnn.toFixed(1)} м).` : null,
    `3. Закачка тампонажного раствора (${cementVolTotal.toFixed(3)} м³, ρ=${cement.density} г/см³).`,
    `   Высота цемента в затрубье: ${cementHeightAnnMD.toFixed(1)} м, в трубах: ${cementHeightPipeMD.toFixed(1)} м.`,
    `   ${heightDifferenceExplanation}`,
    spacerVolumeAboveM3 > 0 ? `4. Закачка верхнего буфера (${spacerVolumeAboveM3.toFixed(2)} м³, интервал ${spacerAboveHeightAnn.toFixed(1)} м).` : null,
    `5. Продавка жидкостью скважины (${displacementVolume.toFixed(3)} м³) до установки равновесия.`,
    `6. Подъём инструмента без вращения на ${pullOutAbovePlugM} м выше кровли (до ${pullOutDepthMD} м MD).`,
    `   Скорость подъёма: ${effectiveTripSpeed.toFixed(2)} м/с. Время подъёма: ${(tripTimeSec / 60).toFixed(1)} мин.`,
    `7. ${washTypeText.charAt(0).toUpperCase() + washTypeText.slice(1)} промывка: ${washCycles} цикл(а/ов), объём ${washVolumeM3.toFixed(2)} м³.`,
    `   1 цикл = ${washOneCycleVolume.toFixed(2)} м³.`,
    `8. Подъём инструмента.`,
    ``,
    `Статическое давление на забое моста:`,
    `  Затрубье: ${pAnn.toFixed(2)} МПа | Трубы: ${pPipe.toFixed(2)} МПа | ΔP: ${Math.abs(pAnn - pPipe).toFixed(2)} МПа`,
    isOpenHole ? `\nОткрытый ствол: каверн. коэфф. = ${cavernCoeff.toFixed(2)}, эфф. диаметр = ${boreDiam.toFixed(1)} мм` : '',
  ].filter(Boolean).join('\n');

  return {
    annArea: annA,
    pipeArea: pipeA,
    plugLengthMD: plugLenMD,
    plugTopTVD,
    plugBottomTVD,
    plugLengthTVD: plugLenTVD,
    cementVolumeAnn: Math.round(cementVolAnn * 1000) / 1000,
    cementVolumePipe: Math.round(cementVolPipe * 1000) / 1000,
    cementVolumeTotal: Math.round(cementVolTotal * 1000) / 1000,
    spacerVolumeBelow: Math.round(spacerVolumeBelowM3 * 1000) / 1000,
    spacerVolumeAbove: Math.round(spacerVolumeAboveM3 * 1000) / 1000,
    spacerBelowHeightAnnMD: Math.round(spacerBelowHeightAnn * 100) / 100,
    spacerAboveHeightAnnMD: Math.round(spacerAboveHeightAnn * 100) / 100,
    cementHeightPipeMD: Math.round(cementHeightPipeMD * 100) / 100,
    cementHeightAnnMD: Math.round(cementHeightAnnMD * 100) / 100,
    heightDifferenceExplanation,
    pipeEndDepthMD: pipeEndMD,
    displacementVolume: Math.round(displacementVolume * 1000) / 1000,
    pressureAnnulus: Math.round(pAnn * 100) / 100,
    pressurePipe: Math.round(pPipe * 100) / 100,
    isBalanced,
    fluidColumns,
    pumpingStages,
    processDescription,
    thickeningTimeMin,
    pullOutDepthMD,
    washVolumeM3: Math.round(washVolumeM3 * 1000) / 1000,
    washType,
    washCycles,
    tripSpeedMs: effectiveTripSpeed,
    tripTimeSec,
    isOpenHole,
    cavernCoeff,
    boreDiamUsed: boreDiam,
    safeTimeMin: Math.round(safeTimeMin * 10) / 10,
    pumpTimeCementMin: Math.round(pumpTimeCementMin * 10) / 10,
    pumpTimeSpacerBelowMin: Math.round(pumpTimeSpacerBelowMin * 10) / 10,
    pumpTimeSpacerAboveMin: Math.round(pumpTimeSpacerAboveMin * 10) / 10,
    pumpTimeDisplacementMin: Math.round(pumpTimeDisplacementMin * 10) / 10,
    tripTimeMin: Math.round(tripTimeMin * 10) / 10,
    washTimeMin: Math.round(washTimeMin * 10) / 10,
    totalOperationTimeMin: Math.round(totalOperationTimeMin * 10) / 10,
    isTimeSafe,
  };
}
