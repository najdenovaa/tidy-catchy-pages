/**
 * Cement Plug (Bridge Plug) balanced placement calculations.
 *
 * The key idea: when the drill pipe is pulled out of the plug,
 * the cement must stay in place. This requires equal hydrostatic
 * pressure inside the pipe and in the annulus at the bottom of the plug.
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
  trajectory: TrajectoryPoint[];
}

export interface PlugFluid {
  name: string;
  density: number;  // г/см³
  rheology: Rheology;
}

export interface PlugInterval {
  topMD: number;
  bottomMD: number;
}

export interface PlugInputs {
  well: PlugWellData;
  plug: PlugInterval;
  cement: PlugFluid;
  spacer: PlugFluid;
  wellFluid: PlugFluid;            // жидкость заполнения скважины (любая)
  spacerVolumeAboveM3: number;     // объём буфера сверху моста
  spacerVolumeBelowM3: number;     // объём буфера снизу моста
  safetyMarginM: number;
  thickeningTimeMin: number;       // время загустевания цемента, мин
  pullOutAbovePlugM: number;       // интервал подъёма над кровлей моста для промывки, м
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

  cementHeightPipeMD: number;
  pipeEndDepthMD: number;
  displacementVolume: number;

  pressureAnnulus: number;
  pressurePipe: number;
  isBalanced: boolean;

  fluidColumns: FluidColumn[];
  pumpingStages: PumpingStage[];
  processDescription: string;
  thickeningTimeMin: number;
  pullOutDepthMD: number;       // глубина после подъёма на промывку
  washVolumeM3: number;         // объём промывки (1.5 цикла)
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
  const { well, plug, cement, spacer, wellFluid, spacerVolumeAboveM3, spacerVolumeBelowM3, thickeningTimeMin, pullOutAbovePlugM } = input;

  const isOpenHole = plug.bottomMD > well.casingShoe;
  const boreDiam = isOpenHole ? well.holeDiameter : well.casingID;

  const annA = annularArea(boreDiam, well.pipeOD);
  const pipeA = area(well.pipeID);

  const plugLenMD = Math.max(0, plug.bottomMD - plug.topMD);

  const traj = well.trajectory.length > 1 ? well.trajectory : [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: well.wellDepthMD, azimuth: 0, zenith: 0, tvd: well.wellDepthMD }];
  const plugTopTVD = interpolateTVD(plug.topMD, traj);
  const plugBottomTVD = interpolateTVD(plug.bottomMD, traj);
  const plugLenTVD = plugBottomTVD - plugTopTVD;

  const pipeEndMD = plug.bottomMD;

  // Spacer heights in annulus
  const spacerBelowHeightAnn = spacerVolumeBelowM3 / annA;
  const spacerAboveHeightAnn = spacerVolumeAboveM3 / annA;

  // Cement in annulus
  const cementVolAnn = annA * plugLenMD;

  // Balanced plug: cement same MD height in pipe
  const cementHeightPipeMD = plugLenMD;
  const cementVolPipe = pipeA * cementHeightPipeMD;
  const cementVolTotal = cementVolAnn + cementVolPipe;

  // Spacer below cement in pipe (same height as annulus for balance)
  const spacerBelowPipeHeight = spacerBelowHeightAnn;

  // Pipe positions
  const cementTopInPipeMD = pipeEndMD - spacerBelowPipeHeight - cementHeightPipeMD;
  const spacerAbovePipeHeight = spacerAboveHeightAnn;
  const spacerAboveTopPipeMD = cementTopInPipeMD - spacerAbovePipeHeight;
  const displacementVolume = pipeA * Math.max(0, spacerAboveTopPipeMD);

  // Pressure at plug bottom
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
  // Wash 1.5 cycles: annular volume from pullOutDepth to plug.topMD * 1.5
  const washIntervalMD = plug.topMD - pullOutDepthMD;
  const washVolumeM3 = annA * washIntervalMD * 1.5;

  // Pumping stages
  const pumpingStages: PumpingStage[] = [];

  // 1. Нижний буфер
  if (spacerVolumeBelowM3 > 0) {
    pumpingStages.push({
      name: "Нижний буфер",
      fluid: `${spacer.name} (${spacer.density} г/см³)`,
      volumeM3: spacerVolumeBelowM3 + (pipeA * spacerBelowPipeHeight),
      description: "Закачка буферной жидкости ниже цемента для разделения с жидкостью скважины",
    });
  }

  // 2. Цемент
  pumpingStages.push({
    name: "Цементный раствор",
    fluid: `${cement.name} (${cement.density} г/см³)`,
    volumeM3: cementVolTotal,
    description: "Закачка тампонажного раствора в объёме, обеспечивающем заполнение интервала моста в затрубье и трубах",
  });

  // 3. Верхний буфер
  if (spacerVolumeAboveM3 > 0) {
    pumpingStages.push({
      name: "Верхний буфер",
      fluid: `${spacer.name} (${spacer.density} г/см³)`,
      volumeM3: spacerVolumeAboveM3 + (pipeA * spacerAbovePipeHeight),
      description: "Закачка буферной жидкости сверху цемента для предотвращения смешивания с продавочной жидкостью",
    });
  }

  // 4. Продавка
  pumpingStages.push({
    name: "Продавка",
    fluid: `${wellFluid.name} (${wellFluid.density} г/см³)`,
    volumeM3: displacementVolume,
    description: "Продавка жидкостью заполнения до установки равновесия столбов жидкости",
  });

  // Process description
  const processDescription = [
    `1. Спуск бурильного инструмента (НКТ/БТ ∅${well.pipeOD} мм) до забоя моста ${plug.bottomMD} м MD.`,
    `2. Закачка нижнего буфера (${spacerVolumeBelowM3.toFixed(2)} м³) для разделения цемента и жидкости скважины снизу.`,
    `3. Закачка тампонажного раствора (${cementVolTotal.toFixed(3)} м³, ρ=${cement.density} г/см³).`,
    `4. Закачка верхнего буфера (${spacerVolumeAboveM3.toFixed(2)} м³) для разделения сверху.`,
    `5. Продавка жидкостью скважины (${displacementVolume.toFixed(3)} м³) до установки гидростатического равновесия.`,
    `6. Медленный подъём инструмента на ${pullOutAbovePlugM} м выше кровли моста (до ${pullOutDepthMD} м MD) без вращения.`,
    `7. Промывка 1,5 цикла (${washVolumeM3.toFixed(2)} м³) для очистки затрубного пространства от остатков цемента.`,
    `8. Подъём инструмента. Ожидание ОЗЦ (время загустевания: ${thickeningTimeMin} мин).`,
  ].join('\n');

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
    cementHeightPipeMD: Math.round(cementHeightPipeMD * 100) / 100,
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
  };
}
