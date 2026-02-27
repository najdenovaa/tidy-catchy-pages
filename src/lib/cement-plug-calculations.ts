/**
 * Cement Plug (Bridge Plug) balanced placement calculations.
 */

import { interpolateTVD, calculateTVDFromSurvey, type TrajectoryPoint, type Rheology } from "./cementing-calculations";
import { calculatePlugStability, type StabilityResult } from "./cement-plug-stability";

/* ───── Interfaces ───── */

export interface PipeSection {
  fromMD: number;
  toMD: number;
  od: number; // mm
  id: number; // mm
  name?: string;
}

export interface PlugWellData {
  wellDepthMD: number;
  holeDiameter: number;
  casingShoe: number;
  casingID: number;
  pipeOD: number;
  pipeID: number;
  cavernCoeff: number;
  trajectory: TrajectoryPoint[];
  pipeSections?: PipeSection[];
}

export interface PlugFluid {
  name: string;
  density: number;
  rheology: Rheology;
  /** Static gel strength at 10 seconds, Pa */
  gel10sec?: number;
  /** Static gel strength at 10 minutes, Pa */
  gel10min?: number;
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

/** Compute annular + pipe volumes in a depth interval considering pipe sections */
function volumeInInterval(topMD: number, bottomMD: number, boreDiamMm: number, sections: PipeSection[]): { annVol: number; pipeVol: number } {
  if (topMD >= bottomMD) return { annVol: 0, pipeVol: 0 };
  let annVol = 0, pipeVol = 0, coveredLen = 0;
  for (const s of sections) {
    const t = Math.max(topMD, s.fromMD);
    const b = Math.min(bottomMD, s.toMD);
    if (t >= b) continue;
    const len = b - t;
    annVol += annularArea(boreDiamMm, s.od) * len;
    pipeVol += area(s.id) * len;
    coveredLen += len;
  }
  const uncovered = (bottomMD - topMD) - coveredLen;
  if (uncovered > 0.001) {
    annVol += area(boreDiamMm) * uncovered; // full bore, no pipe
  }
  return { annVol, pipeVol };
}

/** Binary-search for placement height so total available volume = target */
function findPlacementHeight(targetVolM3: number, pipeEndMD: number, boreDiamMm: number, sections: PipeSection[]): number {
  if (targetVolM3 <= 0) return 0;
  let lo = 0, hi = pipeEndMD * 1.5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const vols = volumeInInterval(pipeEndMD - mid, pipeEndMD, boreDiamMm, sections);
    if (vols.annVol + vols.pipeVol < targetVolM3) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Get representative pipe areas at a specific depth */
function getAreasAtDepth(md: number, boreDiamMm: number, sections: PipeSection[]): { annA: number; pipeA: number } {
  for (const s of sections) {
    if (md >= s.fromMD && md < s.toMD) {
      return { annA: annularArea(boreDiamMm, s.od), pipeA: area(s.id) };
    }
  }
  return { annA: area(boreDiamMm), pipeA: 0 };
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
  safeTimeMin: number;
  pumpTimeCementMin: number;
  pumpTimeSpacerBelowMin: number;
  pumpTimeSpacerAboveMin: number;
  pumpTimeDisplacementMin: number;
  tripTimeMin: number;
  washTimeMin: number;
  totalOperationTimeMin: number;
  isTimeSafe: boolean;

  // Stability analysis
  stability: StabilityResult;
  pipeSectionsUsed: PipeSection[];
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
  const boreDiam = isOpenHole ? well.holeDiameter * Math.sqrt(cavernCoeff) : well.casingID;

  const pipeEndMD = plug.bottomMD;

  // Build effective pipe sections
  const effectiveSections: PipeSection[] = (well.pipeSections && well.pipeSections.length > 0)
    ? well.pipeSections
        .filter(s => s.fromMD < s.toMD && s.od > 0 && s.id > 0)
        .map(s => ({ ...s, toMD: Math.min(s.toMD, pipeEndMD) }))
        .filter(s => s.fromMD < s.toMD)
    : [{ fromMD: 0, toMD: pipeEndMD, od: well.pipeOD, id: well.pipeID }];

  // Representative areas at plug center (for display and simple height calcs)
  const plugCenterMD = Math.min((plug.topMD + plug.bottomMD) / 2, pipeEndMD - 0.01);
  const repAreas = getAreasAtDepth(Math.max(0, plugCenterMD), boreDiam, effectiveSections);
  const annA = repAreas.annA;
  const pipeA = repAreas.pipeA;

  const plugLenMD = Math.max(0, plug.bottomMD - plug.topMD);

  const traj = well.trajectory.length > 1 ? well.trajectory : [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: well.wellDepthMD, azimuth: 0, zenith: 0, tvd: well.wellDepthMD }];
  const plugTopTVD = interpolateTVD(plug.topMD, traj);
  const plugBottomTVD = interpolateTVD(plug.bottomMD, traj);
  const plugLenTVD = plugBottomTVD - plugTopTVD;

  const boreArea = area(boreDiam);

  // Spacer heights
  const spacerBelowHeightAnn = boreArea > 0 ? spacerVolumeBelowM3 / boreArea : 0;
  const spacerAboveHeightAnn = annA > 0 ? spacerVolumeAboveM3 / annA : 0;

  // Cement: target final volume = boreArea × plugLenMD (after pipe removal)
  const cementVolTotal = boreArea * plugLenMD;

  // Placement height via binary search (accounts for varying pipe sections)
  const placementHeight = findPlacementHeight(cementVolTotal, pipeEndMD, boreDiam, effectiveSections);
  const extraHeight = placementHeight - plugLenMD;
  const cementHeightAnnMD = placementHeight;
  const cementHeightPipeMD = placementHeight;

  // Exact cement volumes in annulus and pipe during placement
  const placementVols = volumeInInterval(pipeEndMD - placementHeight, pipeEndMD, boreDiam, effectiveSections);
  const cementVolAnn = placementVols.annVol;
  const cementVolPipe = placementVols.pipeVol;

  // Average steel area for explanation
  const avgSteelArea = placementHeight > 0
    ? Math.max(0, boreArea - (cementVolAnn + cementVolPipe) / placementHeight)
    : 0;

  const heightDifferenceExplanation = `Высота цемента при установке: ${placementHeight.toFixed(2)} м (на ${extraHeight.toFixed(2)} м выше интервала моста ${plugLenMD} м). ` +
    `Причина: стенки инструмента (Sстали ≈ ${(avgSteelArea * 1e4).toFixed(1)} см²) вытесняют цемент вверх. ` +
    `После извлечения труб мост осядет до проектных ${plugLenMD} м. ` +
    `Sзатр = ${(annA * 1e4).toFixed(1)} см², Sтруб = ${(pipeA * 1e4).toFixed(1)} см².`;

  // Spacer in pipe: same HEIGHT as annulus for balance
  const spacerBelowPipeHeight = spacerBelowHeightAnn;
  const spacerAbovePipeHeight = spacerAboveHeightAnn;

  // Cement top during placement
  const cementTopMD = pipeEndMD - placementHeight;
  const cementTopInPipeMD = cementTopMD;
  const spacerAboveTopPipeMD = cementTopMD - spacerAboveHeightAnn;

  // Displacement volume: pipe internal volume from surface to spacer above top
  const dispVols = volumeInInterval(0, Math.max(0, spacerAboveTopPipeMD), boreDiam, effectiveSections);
  const displacementVolume = dispVols.pipeVol;

  // Spacer above pipe volume (for pumping stage total)
  const spacerAbovePipeVol = volumeInInterval(
    Math.max(0, spacerAboveTopPipeMD),
    Math.max(0, cementTopMD),
    boreDiam, effectiveSections
  ).pipeVol;

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

  // Pull-out and wash (with pipe-section-aware volumes)
  const pullOutDepthMD = Math.max(0, plug.topMD - pullOutAbovePlugM);
  const tripDistanceM = plug.bottomMD - pullOutDepthMD;
  const effectiveTripSpeed = tripSpeedMs > 0 ? tripSpeedMs : 0.3;
  const tripTimeSec = tripDistanceM / effectiveTripSpeed;

  const washSections = effectiveSections
    .map(s => ({ ...s, toMD: Math.min(s.toMD, pullOutDepthMD) }))
    .filter(s => s.fromMD < s.toMD);
  const washVols = volumeInInterval(0, pullOutDepthMD, boreDiam, washSections);
  let washOneCycleVolume: number;
  if (washType === 'direct') {
    washOneCycleVolume = washVols.annVol;
  } else {
    washOneCycleVolume = washVols.pipeVol;
  }
  const washVolumeM3 = washOneCycleVolume * washCycles;

  // ─── Timing calculations ───
  const volToMin = (volM3: number, qLs: number) => qLs > 0 ? (volM3 * 1000 / qLs) / 60 : 0;

  const pumpTimeSpacerBelowMin = volToMin(spacerVolumeBelowM3, pumpRateSpacerLs);
  const pumpTimeCementMin = volToMin(cementVolTotal, pumpRateCementLs);
  const pumpTimeSpacerAboveMin = volToMin(spacerVolumeAboveM3 + spacerAbovePipeVol, pumpRateSpacerLs);
  const pumpTimeDisplacementMin = volToMin(displacementVolume, pumpRateDisplacementLs);
  const tripTimeMin = tripTimeSec / 60;
  const washTimeMin = volToMin(washVolumeM3, pumpRateWashLs);

  const safeTimeMin = 0.75 * thickeningTimeMin;
  const totalOperationTimeMin = pumpTimeCementMin + pumpTimeSpacerAboveMin + pumpTimeDisplacementMin + tripTimeMin + washTimeMin;
  const isTimeSafe = totalOperationTimeMin <= safeTimeMin;

  // Pumping stages
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
      volumeM3: spacerVolumeAboveM3 + spacerAbovePipeVol,
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

  // Pipe sections info for process description
  const pipeSectionsInfo = effectiveSections.length > 1
    ? `\nКомпоновка инструмента:\n` + effectiveSections.map((s, i) =>
        `  ${s.name || `Секция ${i + 1}`}: ${s.fromMD}–${s.toMD} м, ∅${s.od}/${s.id} мм`
      ).join('\n')
    : '';

  const processDescription = [
    `1. Спуск бурильного инструмента (∅${well.pipeOD} мм) до забоя моста ${plug.bottomMD} м MD.${pipeSectionsInfo}`,
    spacerVolumeBelowM3 > 0 ? `2. Закачка нижнего буфера (${spacerVolumeBelowM3.toFixed(2)} м³, интервал ${spacerBelowHeightAnn.toFixed(1)} м). Q=${pumpRateSpacerLs} л/с, t=${pumpTimeSpacerBelowMin.toFixed(1)} мин.` : null,
    `3. Закачка тампонажного раствора (${cementVolTotal.toFixed(3)} м³, ρ=${cement.density} г/см³). Q=${pumpRateCementLs} л/с, t=${pumpTimeCementMin.toFixed(1)} мин.`,
    `   Высота цемента в затрубье: ${cementHeightAnnMD.toFixed(1)} м, в трубах: ${cementHeightPipeMD.toFixed(1)} м.`,
    `   ${heightDifferenceExplanation}`,
    spacerVolumeAboveM3 > 0 ? `4. Закачка верхнего буфера (${spacerVolumeAboveM3.toFixed(2)} м³, интервал ${spacerAboveHeightAnn.toFixed(1)} м). Q=${pumpRateSpacerLs} л/с, t=${pumpTimeSpacerAboveMin.toFixed(1)} мин.` : null,
    `5. Продавка жидкостью скважины (${displacementVolume.toFixed(3)} м³). Q=${pumpRateDisplacementLs} л/с, t=${pumpTimeDisplacementMin.toFixed(1)} мин.`,
    `6. Подъём инструмента без вращения на ${pullOutAbovePlugM} м выше кровли (до ${pullOutDepthMD} м MD).`,
    `   Скорость подъёма: ${effectiveTripSpeed.toFixed(2)} м/с. Время подъёма: ${tripTimeMin.toFixed(1)} мин.`,
    `7. ${washTypeText.charAt(0).toUpperCase() + washTypeText.slice(1)} промывка: ${washCycles} цикл(а/ов), объём ${washVolumeM3.toFixed(2)} м³. Q=${pumpRateWashLs} л/с, t=${washTimeMin.toFixed(1)} мин.`,
    `   1 цикл = ${washOneCycleVolume.toFixed(2)} м³.`,
    `8. Подъём инструмента.`,
    ``,
    `Статическое давление на забое моста:`,
    `  Затрубье: ${pAnn.toFixed(2)} МПа | Трубы: ${pPipe.toFixed(2)} МПа | ΔP: ${Math.abs(pAnn - pPipe).toFixed(2)} МПа`,
    isOpenHole ? `\nОткрытый ствол: каверн. коэфф. = ${cavernCoeff.toFixed(2)}, эфф. диаметр = ${boreDiam.toFixed(1)} мм` : '',
  ].filter(Boolean).join('\n');

  // ─── Stability analysis ───
  const stability = calculatePlugStability({
    plugLengthTVD: plugLenTVD,
    spacerBelowLengthTVD: spacerBelowTVD,
    boreDiameterM: boreDiam / 1000,
    pipeODm: well.pipeOD / 1000,
    cementDensityKgM3: cement.density * 1000,
    spacerDensityKgM3: spacer.density * 1000,
    wellFluidDensityKgM3: wellFluid.density * 1000,
    cementGel10Sec: cement.gel10sec || 0,
    spacerGel10Sec: spacer.gel10sec || 0,
    wellFluidGel10Sec: wellFluid.gel10sec || 0,
    cementGel10Min: cement.gel10min || 0,
    spacerGel10Min: spacer.gel10min || 0,
    wellFluidGel10Min: wellFluid.gel10min || 0,
    cementYP: cement.rheology.yp,
    spacerYP: spacer.rheology.yp,
    wellFluidYP: wellFluid.rheology.yp,
    isDeviated: plugLenTVD < plugLenMD * 0.99,
  });

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
    stability,
    pipeSectionsUsed: effectiveSections,
  };
}
