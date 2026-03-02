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
  useViscousPad?: boolean;
  /** Separate fluid for viscous pad (if not set, spacer is used) */
  viscousPadFluid?: PlugFluid;
  /** Distance to pull up above pad top before reverse flush, meters */
  padPullUpAboveM?: number;
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
  /** Average zenith angle at plug interval, degrees */
  plugZenithDeg: number;
  useViscousPad: boolean;
  padPullUpMD?: number;
  reverseFlushVolume?: number;
  /** Per-interface contamination data for visualization */
  interfaceContaminations: InterfaceContamination[];
}

export interface InterfaceContamination {
  /** MD where the interface is (boundary between upper and lower fluid) */
  interfaceMD: number;
  /** Contamination depth in meters (how far fingers extend below interface) */
  depthM: number;
  /** Direction: 'down' = heavy fluid fingers going down, 'up' = light fluid rising */
  direction: 'down' | 'up';
  /** Color of the fingering fluid (the denser one) */
  fingerColor: string;
  /** RT stability factor at this interface */
  sfInterface: number;
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
  // Viscous pad uses its own fluid or falls back to spacer
  const padFluid: PlugFluid = input.viscousPadFluid && input.useViscousPad ? input.viscousPadFluid : spacer;

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

  // Average zenith angle at plug interval (interpolate from trajectory)
  const plugMidMD = (plug.topMD + plug.bottomMD) / 2;
  let plugZenithDeg = 0;
  if (traj.length >= 2) {
    // Find bracketing points
    let lower = traj[0], upper = traj[traj.length - 1];
    for (let i = 0; i < traj.length - 1; i++) {
      if (traj[i].md <= plugMidMD && traj[i + 1].md >= plugMidMD) {
        lower = traj[i];
        upper = traj[i + 1];
        break;
      }
    }
    const frac = upper.md > lower.md ? (plugMidMD - lower.md) / (upper.md - lower.md) : 0;
    plugZenithDeg = lower.zenith + frac * (upper.zenith - lower.zenith);
  }

  const boreArea = area(boreDiam);

  // Spacer heights — distributed between annulus and pipe at same height for balance
  const padTotalArea = annA + pipeA;
  const effectiveSpacerBelowVol = (input.useViscousPad ?? false) ? spacerVolumeBelowM3 : 0;
  const spacerBelowHeightAnn = padTotalArea > 0 ? effectiveSpacerBelowVol / padTotalArea : 0;
  const spacerBelowVolAnn = annA * spacerBelowHeightAnn;   // annular portion of pad
  const spacerBelowVolPipe = pipeA * spacerBelowHeightAnn;  // pipe portion of pad
  // Upper spacer: total input volume is split between annulus and pipe at same height
  const spacerAboveTotalArea = annA + pipeA; // both annulus and pipe share same height
  const spacerAboveHeightAnn = spacerAboveTotalArea > 0 ? spacerVolumeAboveM3 / spacerAboveTotalArea : 0;
  const spacerAboveVolAnn = annA * spacerAboveHeightAnn;  // annular portion
  const spacerAboveVolPipe = pipeA * spacerAboveHeightAnn; // pipe portion

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

  // Spacer above pipe volume: use pre-calculated split (not volumeInInterval)
  const spacerAbovePipeVol = spacerAboveVolPipe;

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
      label: padFluid.name + " (низ)", topMD: plug.bottomMD, bottomMD: spacerBelowBottomMD,
      topTVD: plugBottomTVD, bottomTVD: spacerBelowBottomTVD,
      densityGcm3: padFluid.density, color: "#AB47BC", location: 'annulus',
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
  if (spacerBelowHeightAnn > 0 && (input.useViscousPad ?? false)) {
    fluidColumns.push({
      label: padFluid.name + " (труб. низ)", topMD: plug.bottomMD, bottomMD: spacerBelowBottomMD,
      topTVD: plugBottomTVD, bottomTVD: spacerBelowBottomTVD,
      densityGcm3: padFluid.density, color: "#AB47BC", location: 'pipe',
    });
  }

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
  const useViscousPad = input.useViscousPad ?? false;

  // spacerBelow is ONLY used with viscous pad
  const effectiveSpacerBelowM3 = useViscousPad ? spacerVolumeBelowM3 : 0;
  const pumpTimeSpacerBelowMin = volToMin(effectiveSpacerBelowM3, pumpRateSpacerLs);
  const pumpTimeCementMin = volToMin(cementVolTotal, pumpRateCementLs);
  const pumpTimeSpacerAboveMin = volToMin(spacerVolumeAboveM3, pumpRateSpacerLs); // total = ann + pipe
  const pumpTimeDisplacementMin = volToMin(displacementVolume, pumpRateDisplacementLs);
  const tripTimeMin = tripTimeSec / 60;
  const washTimeMin = volToMin(washVolumeM3, pumpRateWashLs);

  // ─── Viscous pad calculations ───
  const padBottomMD = useViscousPad ? plug.bottomMD + spacerBelowHeightAnn : plug.bottomMD;
  // Pad displacement: pipe volume from surface to top of pad in pipe (plug.bottomMD)
  const padTopInPipeMD = plug.bottomMD; // pad top in pipe = plug bottom (balance)
  const padDisplacementVol = useViscousPad ? volumeInInterval(0, padTopInPipeMD, boreDiam, effectiveSections).pipeVol : 0;
  const padDisplacementTimeMin = useViscousPad ? volToMin(padDisplacementVol, pumpRateDisplacementLs) : 0;
  const padPullUpDistance = useViscousPad ? Math.max(input.padPullUpAboveM ?? 5, 1) : 0;
  const padPullUpMD = useViscousPad ? Math.max(0, plug.bottomMD - padPullUpDistance) : plug.bottomMD;
  const reverseFlushVol = useViscousPad ? volumeInInterval(0, padPullUpMD, boreDiam, effectiveSections).pipeVol : 0;
  const padTripUpTimeMin = useViscousPad ? padPullUpDistance / effectiveTripSpeed / 60 : 0;
  const reverseFlushTimeMin = useViscousPad ? volToMin(reverseFlushVol, pumpRateWashLs) : 0;
  const padTripDownTimeMin = padTripUpTimeMin;

  const safeTimeMin = 0.75 * thickeningTimeMin;
  const totalOperationTimeMin = useViscousPad
    ? (pumpTimeSpacerBelowMin + padDisplacementTimeMin + padTripUpTimeMin + reverseFlushTimeMin + padTripDownTimeMin + pumpTimeSpacerAboveMin + pumpTimeCementMin + pumpTimeDisplacementMin + tripTimeMin + washTimeMin)
    : (pumpTimeCementMin + pumpTimeSpacerAboveMin + pumpTimeDisplacementMin + tripTimeMin + washTimeMin);
  const isTimeSafe = totalOperationTimeMin <= safeTimeMin;

  // Pumping stages
  const pumpingStages: PumpingStage[] = [];
  const washTypeText = washType === 'direct' ? 'прямая' : 'обратная';

  if (useViscousPad && spacerVolumeBelowM3 > 0) {
    // ── Viscous pad workflow ──
    pumpingStages.push({
      name: "Закачка вязкой пачки",
      fluid: `${padFluid.name} (${padFluid.density} г/см³)`,
      volumeM3: spacerVolumeBelowM3,
      timeMin: pumpTimeSpacerBelowMin,
      description: `Вязкая пачка на равновесии. Высота: ${spacerBelowHeightAnn.toFixed(1)} м. Затрубье: ${spacerBelowVolAnn.toFixed(3)} м³, трубы: ${spacerBelowVolPipe.toFixed(3)} м³`,
    });
    pumpingStages.push({
      name: "Продавка вязкой пачки",
      fluid: `${wellFluid.name} (${wellFluid.density} г/см³)`,
      volumeM3: padDisplacementVol,
      timeMin: padDisplacementTimeMin,
      description: `Продавка до равновесия пачки (${padDisplacementVol.toFixed(3)} м³). Пачка остаётся в затрубье и трубах на одной высоте. Q=${pumpRateDisplacementLs} л/с`,
    });
    pumpingStages.push({
      name: "Подъём над пачкой",
      fluid: "—",
      volumeM3: 0,
      timeMin: padTripUpTimeMin,
      description: `До ${padPullUpMD.toFixed(0)} м MD (+${padPullUpDistance.toFixed(0)} м). V=${effectiveTripSpeed.toFixed(2)} м/с`,
    });
    pumpingStages.push({
      name: "Обратная промывка (очистка)",
      fluid: wellFluid.name,
      volumeM3: reverseFlushVol,
      timeMin: reverseFlushTimeMin,
      description: `1 цикл обратной промывки трубного. V=${reverseFlushVol.toFixed(3)} м³`,
    });
    pumpingStages.push({
      name: "Спуск на кровлю пачки",
      fluid: "—",
      volumeM3: 0,
      timeMin: padTripDownTimeMin,
      description: `До ${plug.bottomMD} м MD (подошва моста). V=${effectiveTripSpeed.toFixed(2)} м/с`,
    });
    if (spacerAboveVolAnn > 0) {
      pumpingStages.push({
        name: "Верхний буфер (затрубье)",
        fluid: `${spacer.name} (${spacer.density} г/см³)`,
        volumeM3: spacerAboveVolAnn,
        timeMin: volToMin(spacerAboveVolAnn, pumpRateSpacerLs),
        description: `Буфер над цементом в затрубье (${spacerAboveVolAnn.toFixed(3)} из ${spacerVolumeAboveM3.toFixed(3)} м³). Высота: ${spacerAboveHeightAnn.toFixed(1)} м`,
      });
    }
    pumpingStages.push({
      name: "Цементный раствор",
      fluid: `${cement.name} (${cement.density} г/см³)`,
      volumeM3: cementVolTotal,
      timeMin: pumpTimeCementMin,
      description: `Интервал моста. Затрубье: ${cementHeightAnnMD.toFixed(1)} м, трубы: ${cementHeightPipeMD.toFixed(1)} м`,
    });
    if (spacerAbovePipeVol > 0) {
      pumpingStages.push({
        name: "Верхний буфер (трубное)",
        fluid: `${spacer.name} (${spacer.density} г/см³)`,
        volumeM3: spacerAbovePipeVol,
        timeMin: volToMin(spacerAbovePipeVol, pumpRateSpacerLs),
        description: `Буфер над цементом в трубном пространстве`,
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
    pumpingStages.push({
      name: `Промывка (${washTypeText})`,
      fluid: wellFluid.name,
      volumeM3: washVolumeM3,
      timeMin: washTimeMin,
      description: `${washCycles} ц., 1 ц.= ${washOneCycleVolume.toFixed(2)} м³`,
    });
  } else {
    // ── Standard workflow (no lower buffer) ──
    // Sequence: upper spacer (annular) → cement → upper spacer (pipe) → displacement
    if (spacerAboveVolAnn > 0) {
      pumpingStages.push({
        name: "Верхний буфер (затрубье)",
        fluid: `${spacer.name} (${spacer.density} г/см³)`,
        volumeM3: spacerAboveVolAnn,
        timeMin: volToMin(spacerAboveVolAnn, pumpRateSpacerLs),
        description: `Буфер над цементом в затрубье (${spacerAboveVolAnn.toFixed(3)} из ${spacerVolumeAboveM3.toFixed(3)} м³). Высота: ${spacerAboveHeightAnn.toFixed(1)} м`,
      });
    }
    pumpingStages.push({
      name: "Цементный раствор",
      fluid: `${cement.name} (${cement.density} г/см³)`,
      volumeM3: cementVolTotal,
      timeMin: pumpTimeCementMin,
      description: `Интервал моста. Затрубье: ${cementHeightAnnMD.toFixed(1)} м, трубы: ${cementHeightPipeMD.toFixed(1)} м`,
    });
    if (spacerAbovePipeVol > 0) {
      pumpingStages.push({
        name: "Верхний буфер (трубное)",
        fluid: `${spacer.name} (${spacer.density} г/см³)`,
        volumeM3: spacerAbovePipeVol,
        timeMin: volToMin(spacerAbovePipeVol, pumpRateSpacerLs),
        description: `Буфер над цементом в трубном пространстве`,
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
    pumpingStages.push({
      name: `Промывка (${washTypeText})`,
      fluid: wellFluid.name,
      volumeM3: washVolumeM3,
      timeMin: washTimeMin,
      description: `${washCycles} ц., 1 ц.= ${washOneCycleVolume.toFixed(2)} м³`,
    });
  }

  // Pipe sections info for process description
  const pipeSectionsInfo = effectiveSections.length > 1
    ? `\nКомпоновка инструмента:\n` + effectiveSections.map((s, i) =>
        `  ${s.name || `Секция ${i + 1}`}: ${s.fromMD}–${s.toMD} м, ∅${s.od}/${s.id} мм`
      ).join('\n')
    : '';

  let processDescription: string;
  if (useViscousPad && spacerVolumeBelowM3 > 0) {
    const padBottomMDDesc = plug.bottomMD + spacerBelowHeightAnn;
    processDescription = [
      `1. Спуск бурильного инструмента (∅${well.pipeOD} мм) до забоя вязкой пачки ${padBottomMDDesc.toFixed(1)} м MD (подошва моста ${plug.bottomMD} м + высота пачки ${spacerBelowHeightAnn.toFixed(1)} м).${pipeSectionsInfo}`,
      `2. Закачка вязкой пачки на равновесие: ${padFluid.name} (${spacerVolumeBelowM3.toFixed(2)} м³, ρ=${padFluid.density} г/см³).`,
      `   Распределение: затрубье ${spacerBelowVolAnn.toFixed(3)} м³ + трубы ${spacerBelowVolPipe.toFixed(3)} м³. Высота столба: ${spacerBelowHeightAnn.toFixed(1)} м.`,
      `   Интервал: ${padBottomMDDesc.toFixed(1)}–${plug.bottomMD} м MD. Q=${pumpRateSpacerLs} л/с, t=${pumpTimeSpacerBelowMin.toFixed(1)} мин.`,
      `3. Продавка вязкой пачки скважинной жидкостью (${padDisplacementVol.toFixed(3)} м³) до установки на равновесие. Пачка в затрубье и трубах на одной высоте. Q=${pumpRateDisplacementLs} л/с, t=${padDisplacementTimeMin.toFixed(1)} мин.`,
      `4. Подъём инструмента над пачкой до ${padPullUpMD.toFixed(0)} м MD (+${padPullUpDistance.toFixed(0)} м выше кровли пачки). V=${effectiveTripSpeed.toFixed(2)} м/с, t=${padTripUpTimeMin.toFixed(1)} мин.`,
      `5. Обратная промывка для вымыва остатков вязкой пачки из труб (${reverseFlushVol.toFixed(3)} м³). Q=${pumpRateWashLs} л/с, t=${reverseFlushTimeMin.toFixed(1)} мин.`,
      `6. Спуск инструмента на кровлю вязкой пачки / подошву моста (${plug.bottomMD} м MD). V=${effectiveTripSpeed.toFixed(2)} м/с, t=${padTripDownTimeMin.toFixed(1)} мин.`,
      spacerAboveVolAnn > 0 ? `7. Закачка верхнего буфера в затрубье (${spacerAboveVolAnn.toFixed(3)} м³ из ${spacerVolumeAboveM3.toFixed(3)} м³, высота ${spacerAboveHeightAnn.toFixed(1)} м). Q=${pumpRateSpacerLs} л/с, t=${volToMin(spacerAboveVolAnn, pumpRateSpacerLs).toFixed(1)} мин.` : null,
      `8. Закачка тампонажного раствора (${cementVolTotal.toFixed(3)} м³, ρ=${cement.density} г/см³). Q=${pumpRateCementLs} л/с, t=${pumpTimeCementMin.toFixed(1)} мин.`,
      `   Высота цемента в затрубье: ${cementHeightAnnMD.toFixed(1)} м, в трубах: ${cementHeightPipeMD.toFixed(1)} м.`,
      `   ${heightDifferenceExplanation}`,
      spacerAboveVolPipe > 0 ? `9. Закачка верхнего буфера в трубное пространство (${spacerAboveVolPipe.toFixed(3)} м³). Q=${pumpRateSpacerLs} л/с, t=${volToMin(spacerAboveVolPipe, pumpRateSpacerLs).toFixed(1)} мин.` : null,
      `10. Продавка жидкостью скважины (${displacementVolume.toFixed(3)} м³). Q=${pumpRateDisplacementLs} л/с, t=${pumpTimeDisplacementMin.toFixed(1)} мин.`,
      `11. Подъём инструмента без вращения на ${pullOutAbovePlugM} м выше кровли (до ${pullOutDepthMD} м MD).`,
      `    Скорость подъёма: ${effectiveTripSpeed.toFixed(2)} м/с. Время подъёма: ${tripTimeMin.toFixed(1)} мин.`,
      `12. ${washTypeText.charAt(0).toUpperCase() + washTypeText.slice(1)} промывка: ${washCycles} цикл(а/ов), объём ${washVolumeM3.toFixed(2)} м³. Q=${pumpRateWashLs} л/с, t=${washTimeMin.toFixed(1)} мин.`,
      `    1 цикл = ${washOneCycleVolume.toFixed(2)} м³.`,
      `13. Подъём инструмента.`,
      ``,
      `Статическое давление на забое моста:`,
      `  Затрубье: ${pAnn.toFixed(2)} МПа | Трубы: ${pPipe.toFixed(2)} МПа | ΔP: ${Math.abs(pAnn - pPipe).toFixed(2)} МПа`,
      isOpenHole ? `\nОткрытый ствол: каверн. коэфф. = ${cavernCoeff.toFixed(2)}, эфф. диаметр = ${boreDiam.toFixed(1)} мм` : '',
    ].filter(Boolean).join('\n');
  } else {
    processDescription = [
      `1. Спуск бурильного инструмента (∅${well.pipeOD} мм) до забоя моста ${plug.bottomMD} м MD.${pipeSectionsInfo}`,
      spacerAboveVolAnn > 0 ? `2. Закачка верхнего буфера в затрубье (${spacerAboveVolAnn.toFixed(3)} м³ из ${spacerVolumeAboveM3.toFixed(3)} м³, высота ${spacerAboveHeightAnn.toFixed(1)} м). Q=${pumpRateSpacerLs} л/с, t=${volToMin(spacerAboveVolAnn, pumpRateSpacerLs).toFixed(1)} мин.` : null,
      `3. Закачка тампонажного раствора (${cementVolTotal.toFixed(3)} м³, ρ=${cement.density} г/см³). Q=${pumpRateCementLs} л/с, t=${pumpTimeCementMin.toFixed(1)} мин.`,
      `   Высота цемента в затрубье: ${cementHeightAnnMD.toFixed(1)} м, в трубах: ${cementHeightPipeMD.toFixed(1)} м.`,
      `   ${heightDifferenceExplanation}`,
      spacerAboveVolPipe > 0 ? `4. Закачка верхнего буфера в трубное пространство (${spacerAboveVolPipe.toFixed(3)} м³). Q=${pumpRateSpacerLs} л/с, t=${volToMin(spacerAboveVolPipe, pumpRateSpacerLs).toFixed(1)} мин.` : null,
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
  }

  // ─── Stability analysis ───
  const stability = calculatePlugStability({
    plugLengthTVD: plugLenTVD,
    spacerBelowLengthTVD: spacerBelowTVD,
    boreDiameterM: boreDiam / 1000,
    pipeODm: well.pipeOD / 1000,
    cementDensityKgM3: cement.density * 1000,
    spacerDensityKgM3: (useViscousPad ? padFluid.density : spacer.density) * 1000,
    wellFluidDensityKgM3: wellFluid.density * 1000,
    cementGel10Sec: cement.gel10sec || 0,
    spacerGel10Sec: (useViscousPad ? padFluid.gel10sec : spacer.gel10sec) || 0,
    wellFluidGel10Sec: wellFluid.gel10sec || 0,
    cementGel10Min: cement.gel10min || 0,
    spacerGel10Min: (useViscousPad ? padFluid.gel10min : spacer.gel10min) || 0,
    wellFluidGel10Min: wellFluid.gel10min || 0,
    cementYP: cement.rheology.yp,
    spacerYP: (useViscousPad ? padFluid.rheology.yp : spacer.rheology.yp),
    wellFluidYP: wellFluid.rheology.yp,
    isDeviated: plugLenTVD < plugLenMD * 0.99,
    zenithDeg: plugZenithDeg,
  });

  // ═══ Per-interface contamination (RT fingering) ═══
  const RT_C = 4 * Math.PI;
  const zenithRad = (plugZenithDeg * Math.PI) / 180;
  const cosZ = Math.cos(zenithRad);
  const sinZ = Math.sin(zenithRad);
  const Dh = well.pipeOD > 0 ? Math.max(boreDiam - well.pipeOD, 10) / 1000 : boreDiam / 1000;

  // Helper: get gel strengths for a fluid by matching color/density
  function getGelForFluid(densityGcm3: number, color: string): { gel10min: number; yp: number } {
    if (color === cementColor) return { gel10min: cement.gel10min || 0, yp: cement.rheology.yp };
    if (color === spacerColor) return { gel10min: spacer.gel10min || 0, yp: spacer.rheology.yp };
    if (color === "#AB47BC") return { gel10min: padFluid.gel10min || 0, yp: padFluid.rheology.yp };
    return { gel10min: wellFluid.gel10min || 0, yp: wellFluid.rheology.yp };
  }

  const annularCols = fluidColumns.filter(c => c.location === 'annulus').sort((a, b) => a.topMD - b.topMD);
  const interfaceContaminations: InterfaceContamination[] = [];

  for (let i = 0; i < annularCols.length - 1; i++) {
    const upper = annularCols[i];
    const lower = annularCols[i + 1];
    const deltaRho = (upper.densityGcm3 - lower.densityGcm3) * 1000; // kg/m³
    if (deltaRho <= 10) continue; // negligible density difference

    const gUpper = getGelForFluid(upper.densityGcm3, upper.color);
    const gLower = getGelForFluid(lower.densityGcm3, lower.color);
    const GEL_FROM_YP = 3.0;
    const tauUpper = gUpper.gel10min > 0 ? gUpper.gel10min : gUpper.yp * GEL_FROM_YP;
    const tauLower = gLower.gel10min > 0 ? gLower.gel10min : gLower.yp * GEL_FROM_YP;
    const tauEff = tauUpper + tauLower;

    const rtDriving = deltaRho * 9.81 * cosZ * Dh / RT_C;
    const sf = rtDriving > 0.01 ? tauEff / rtDriving : 999;

    let contDepth = 0;
    if (sf < 1.0 && deltaRho > 0) {
      contDepth = Math.min(3.5 * Dh * (1 / Math.max(sf, 0.1) - 1), 
        lower.bottomMD - lower.topMD);
    }
    // Lateral spreading in deviated wells
    if (plugZenithDeg > 5 && deltaRho > 0 && Dh > 0) {
      const lateralDrive = deltaRho * 9.81 * sinZ * Dh;
      const lateralResist = tauEff > 0 ? tauEff : 1;
      const lateralPen = 1.5 * Dh * (lateralDrive / lateralResist);
      contDepth = Math.max(contDepth, Math.min(lateralPen, lower.bottomMD - lower.topMD));
    }

    if (contDepth > 0.01) {
      interfaceContaminations.push({
        interfaceMD: upper.bottomMD,
        depthM: Math.round(contDepth * 100) / 100,
        direction: 'down',
        fingerColor: upper.color,
        sfInterface: Math.round(sf * 100) / 100,
      });
    }
  }

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
    spacerVolumeBelow: Math.round(effectiveSpacerBelowVol * 1000) / 1000,
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
    plugZenithDeg: Math.round(plugZenithDeg * 10) / 10,
    useViscousPad,
    padPullUpMD: useViscousPad ? Math.round(padPullUpMD * 10) / 10 : undefined,
    reverseFlushVolume: useViscousPad ? Math.round(reverseFlushVol * 1000) / 1000 : undefined,
    interfaceContaminations,
  };
}
