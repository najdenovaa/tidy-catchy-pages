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
  tripSpeedMs: number; // скорость подъёма, м/с
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
  const { well, plug, cement, spacer, wellFluid, spacerVolumeAboveM3, spacerVolumeBelowM3, thickeningTimeMin, pullOutAbovePlugM, washType, washCycles, tripSpeedMs } = input;

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

  // Spacer heights in annulus
  const spacerBelowHeightAnn = annA > 0 ? spacerVolumeBelowM3 / annA : 0;
  const spacerAboveHeightAnn = annA > 0 ? spacerVolumeAboveM3 / annA : 0;

  // Cement in annulus
  const cementVolAnn = annA * plugLenMD;
  const cementHeightAnnMD = plugLenMD;

  // Balanced plug: same volume in pipe → different height due to different cross-section
  const cementVolPipe = cementVolAnn; // for balance, same volume
  const cementHeightPipeMD = pipeA > 0 ? cementVolPipe / pipeA : 0;
  const cementVolTotal = cementVolAnn + cementVolPipe;

  // Height difference explanation
  const heightDiff = cementHeightPipeMD - cementHeightAnnMD;
  const heightDifferenceExplanation = `Sзатр = ${(annA * 1e4).toFixed(1)} см² vs Sтруб = ${(pipeA * 1e4).toFixed(1)} см². ` +
    `При равных объёмах (${cementVolAnn.toFixed(3)} м³) высота в трубах ${heightDiff > 0 ? 'больше' : 'меньше'} на ${Math.abs(heightDiff).toFixed(2)} м ` +
    `из-за ${pipeA < annA ? 'меньшего' : 'большего'} сечения труб.`;

  // Spacer in pipe (same volume for balance)
  const spacerBelowPipeHeight = pipeA > 0 ? spacerVolumeBelowM3 / pipeA : 0;
  const spacerAbovePipeHeight = pipeA > 0 ? spacerVolumeAboveM3 / pipeA : 0;

  // Pipe positions
  const cementTopInPipeMD = pipeEndMD - spacerBelowPipeHeight - cementHeightPipeMD;
  const spacerAboveTopPipeMD = cementTopInPipeMD - spacerAbovePipeHeight;
  const displacementVolume = pipeA * Math.max(0, spacerAboveTopPipeMD);

  // Static pressures at plug bottom
  const spacerAboveTopMD = plug.topMD - spacerAboveHeightAnn;
  const spacerBelowBottomMD = plug.bottomMD + spacerBelowHeightAnn;
  const spacerAboveTopTVD = interpolateTVD(Math.max(0, spacerAboveTopMD), traj);
  const spacerBelowBottomTVD = interpolateTVD(Math.min(well.wellDepthMD, spacerBelowBottomMD), traj);

  const mudTVD_ann = Math.max(0, spacerAboveTopTVD);
  const spacerAboveTVD = Math.max(0, plugTopTVD - spacerAboveTopTVD);
  const spacerBelowTVD = Math.max(0, spacerBelowBottomTVD - plugBottomTVD);

  const pAnn = hydroP(wellFluid.density, mudTVD_ann)
    + hydroP(spacer.density, spacerAboveTVD)
    + hydroP(cement.density, plugLenTVD)
    + hydroP(spacer.density, spacerBelowTVD);

  const mudTVD_pipe = Math.max(0, interpolateTVD(Math.max(0, spacerAboveTopPipeMD), traj));
  const spacerAbovePipeTVD = Math.max(0, interpolateTVD(Math.max(0, cementTopInPipeMD), traj) - mudTVD_pipe);
  const cementTopPipeTVD = interpolateTVD(Math.max(0, cementTopInPipeMD), traj);
  const cementPipeTVD = Math.max(0, plugBottomTVD - spacerBelowTVD - cementTopPipeTVD);

  const pPipe = hydroP(wellFluid.density, mudTVD_pipe)
    + hydroP(spacer.density, spacerAbovePipeTVD)
    + hydroP(cement.density, Math.min(plugLenTVD, cementPipeTVD))
    + hydroP(spacer.density, spacerBelowTVD);

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
      label: spacer.name + " (верх)", topMD: Math.max(0, spacerAboveTopMD), bottomMD: plug.topMD,
      topTVD: spacerAboveTopTVD, bottomTVD: plugTopTVD,
      densityGcm3: spacer.density, color: spacerColor, location: 'annulus',
    });
  }
  fluidColumns.push({
    label: cement.name, topMD: plug.topMD, bottomMD: plug.bottomMD,
    topTVD: plugTopTVD, bottomTVD: plugBottomTVD,
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

  // Pipe
  fluidColumns.push({
    label: wellFluid.name + " (труб.)", topMD: 0, bottomMD: Math.max(0, spacerAboveTopPipeMD),
    topTVD: 0, bottomTVD: Math.max(0, mudTVD_pipe),
    densityGcm3: wellFluid.density, color: mudColor, location: 'pipe',
  });
  if (spacerAbovePipeHeight > 0) {
    fluidColumns.push({
      label: spacer.name + " (труб. верх)", topMD: Math.max(0, spacerAboveTopPipeMD), bottomMD: Math.max(0, cementTopInPipeMD),
      topTVD: mudTVD_pipe, bottomTVD: cementTopPipeTVD,
      densityGcm3: spacer.density, color: spacerColor, location: 'pipe',
    });
  }
  fluidColumns.push({
    label: cement.name + " (труб.)", topMD: Math.max(0, cementTopInPipeMD), bottomMD: Math.max(0, cementTopInPipeMD + cementHeightPipeMD),
    topTVD: cementTopPipeTVD, bottomTVD: cementTopPipeTVD + plugLenTVD,
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

  // Pumping stages (including pull-out and wash)
  const pumpingStages: PumpingStage[] = [];

  if (spacerVolumeBelowM3 > 0) {
    pumpingStages.push({
      name: "Нижний буфер",
      fluid: `${spacer.name} (${spacer.density} г/см³)`,
      volumeM3: spacerVolumeBelowM3 + (pipeA * spacerBelowPipeHeight),
      description: `Буферная жидкость ниже цемента. Высота в затрубье: ${spacerBelowHeightAnn.toFixed(1)} м`,
    });
  }

  pumpingStages.push({
    name: "Цементный раствор",
    fluid: `${cement.name} (${cement.density} г/см³)`,
    volumeM3: cementVolTotal,
    description: `Заполнение интервала моста. Затрубье: ${cementHeightAnnMD.toFixed(1)} м, трубы: ${cementHeightPipeMD.toFixed(1)} м`,
  });

  if (spacerVolumeAboveM3 > 0) {
    pumpingStages.push({
      name: "Верхний буфер",
      fluid: `${spacer.name} (${spacer.density} г/см³)`,
      volumeM3: spacerVolumeAboveM3 + (pipeA * spacerAbovePipeHeight),
      description: `Буферная жидкость сверху цемента. Высота в затрубье: ${spacerAboveHeightAnn.toFixed(1)} м`,
    });
  }

  pumpingStages.push({
    name: "Продавка",
    fluid: `${wellFluid.name} (${wellFluid.density} г/см³)`,
    volumeM3: displacementVolume,
    description: "Продавка до установки гидростатического равновесия",
  });

  pumpingStages.push({
    name: "Подъём инструмента",
    fluid: "—",
    volumeM3: 0,
    description: `Подъём на ${pullOutAbovePlugM} м выше кровли (до ${pullOutDepthMD} м). Скорость: ${effectiveTripSpeed.toFixed(2)} м/с, время: ${(tripTimeSec / 60).toFixed(1)} мин`,
  });

  const washTypeText = washType === 'direct' ? 'прямая' : 'обратная';
  pumpingStages.push({
    name: `Промывка (${washTypeText})`,
    fluid: `${wellFluid.name}`,
    volumeM3: washVolumeM3,
    description: `${washCycles} цикл(а/ов), 1 цикл = ${washOneCycleVolume.toFixed(2)} м³ (подъём забойной пачки на поверхность)`,
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
    `8. Подъём инструмента. ОЗЦ (время загустевания: ${thickeningTimeMin} мин).`,
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
  };
}
