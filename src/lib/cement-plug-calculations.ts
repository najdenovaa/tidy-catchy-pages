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
}

/* ───── Geometry helpers ───── */

function area(diameterMm: number): number {
  const d = diameterMm / 1000;
  return (Math.PI / 4) * d * d;
}

function annularArea(outerMm: number, innerMm: number): number {
  return area(outerMm) - area(innerMm);
}

/** Hydrostatic pressure, МПа */
function hydroP(densityGcm3: number, tvdM: number): number {
  return densityGcm3 * 9.81 * tvdM / 1000;
}

/** Bingham friction pressure drop for a fluid in a pipe/annulus, МПа
 *  Simplified Bingham model: ΔP = (12 * PV * V * L) / (D_h^2) + (4 * YP * L) / (D_h * 1000)
 *  where D_h is hydraulic diameter. For static state ΔP_friction = 0, we compute gel-strength-like contribution.
 *  For STATIC pressures we only include hydrostatic — friction is 0 at rest.
 */

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

  // Spacer intervals (heights in MD)
  spacerBelowHeightAnnMD: number;
  spacerAboveHeightAnnMD: number;

  cementHeightPipeMD: number;
  pipeEndDepthMD: number;
  displacementVolume: number;

  // Static pressures (hydrostatic only, no friction)
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
  const { well, plug, cement, spacer, wellFluid, spacerVolumeAboveM3, spacerVolumeBelowM3, thickeningTimeMin, pullOutAbovePlugM, washType, washCycles } = input;

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

  // Spacer heights in annulus (convert volume → height)
  const spacerBelowHeightAnn = annA > 0 ? spacerVolumeBelowM3 / annA : 0;
  const spacerAboveHeightAnn = annA > 0 ? spacerVolumeAboveM3 / annA : 0;

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

  // STATIC pressure at plug bottom (hydrostatic only, no friction at rest)
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

  // Wash volume: 1 cycle = full annular volume from pipe shoe to surface (direct)
  // or full pipe volume from surface to pipe shoe (reverse)
  // Direct: fluid pumped down pipe, returns up annulus — 1 cycle lifts bottoms-up
  // Reverse: fluid pumped down annulus, returns up pipe
  let washOneCycleMD: number;
  let washOneCycleVolume: number;
  if (washType === 'direct') {
    // 1 cycle = annular volume from pullOutDepth to surface
    washOneCycleVolume = annA * pullOutDepthMD;
  } else {
    // reverse: 1 cycle = pipe volume from surface to pullOutDepth  
    washOneCycleVolume = pipeA * pullOutDepthMD;
  }
  const washVolumeM3 = washOneCycleVolume * washCycles;

  // Pumping stages
  const pumpingStages: PumpingStage[] = [];

  if (spacerVolumeBelowM3 > 0) {
    pumpingStages.push({
      name: "Нижний буфер",
      fluid: `${spacer.name} (${spacer.density} г/см³)`,
      volumeM3: spacerVolumeBelowM3 + (pipeA * spacerBelowPipeHeight),
      description: "Закачка буферной жидкости ниже цемента для разделения с жидкостью скважины",
    });
  }

  pumpingStages.push({
    name: "Цементный раствор",
    fluid: `${cement.name} (${cement.density} г/см³)`,
    volumeM3: cementVolTotal,
    description: "Закачка тампонажного раствора в объёме, обеспечивающем заполнение интервала моста в затрубье и трубах",
  });

  if (spacerVolumeAboveM3 > 0) {
    pumpingStages.push({
      name: "Верхний буфер",
      fluid: `${spacer.name} (${spacer.density} г/см³)`,
      volumeM3: spacerVolumeAboveM3 + (pipeA * spacerAbovePipeHeight),
      description: "Закачка буферной жидкости сверху цемента для предотвращения смешивания с продавочной жидкостью",
    });
  }

  pumpingStages.push({
    name: "Продавка",
    fluid: `${wellFluid.name} (${wellFluid.density} г/см³)`,
    volumeM3: displacementVolume,
    description: "Продавка жидкостью заполнения до установки равновесия столбов жидкости",
  });

  const washTypeText = washType === 'direct' ? 'прямая' : 'обратная';
  const processDescription = [
    `1. Спуск бурильного инструмента (НКТ/БТ ∅${well.pipeOD} мм) до забоя моста ${plug.bottomMD} м MD.`,
    `2. Закачка нижнего буфера (${spacerVolumeBelowM3.toFixed(2)} м³, интервал ${spacerBelowHeightAnn.toFixed(1)} м) для разделения цемента и жидкости скважины снизу.`,
    `3. Закачка тампонажного раствора (${cementVolTotal.toFixed(3)} м³, ρ=${cement.density} г/см³).`,
    `4. Закачка верхнего буфера (${spacerVolumeAboveM3.toFixed(2)} м³, интервал ${spacerAboveHeightAnn.toFixed(1)} м) для разделения сверху.`,
    `5. Продавка жидкостью скважины (${displacementVolume.toFixed(3)} м³) до установки гидростатического равновесия.`,
    `6. Медленный подъём инструмента на ${pullOutAbovePlugM} м выше кровли моста (до ${pullOutDepthMD} м MD) без вращения.`,
    `7. ${washTypeText.charAt(0).toUpperCase() + washTypeText.slice(1)} промывка: ${washCycles} цикл(а/ов), объём ${washVolumeM3.toFixed(2)} м³.`,
    `   1 цикл = подъём забойной пачки на поверхность (V=${washOneCycleVolume.toFixed(2)} м³).`,
    `8. Подъём инструмента. Ожидание ОЗЦ (время загустевания: ${thickeningTimeMin} мин).`,
    ``,
    `Статическое давление на забое моста:`,
    `  Затрубье: ${pAnn.toFixed(2)} МПа | Трубы: ${pPipe.toFixed(2)} МПа | ΔP: ${Math.abs(pAnn - pPipe).toFixed(2)} МПа`,
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
    spacerBelowHeightAnnMD: Math.round(spacerBelowHeightAnn * 100) / 100,
    spacerAboveHeightAnnMD: Math.round(spacerAboveHeightAnn * 100) / 100,
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
    washType,
    washCycles,
  };
}
