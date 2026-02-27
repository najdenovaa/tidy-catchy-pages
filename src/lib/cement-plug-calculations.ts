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
  wellDepthMD: number;      // общая глубина скважины по стволу, м
  holeDiameter: number;     // диаметр открытого ствола, мм
  casingShoe: number;       // глубина башмака предыдущей колонны, м (MD)
  casingID: number;         // внутр. диаметр предыдущей колонны, мм
  pipeOD: number;           // наружный диаметр бурильных труб, мм
  pipeID: number;           // внутренний диаметр бурильных труб, мм
  trajectory: TrajectoryPoint[];
}

export interface PlugFluid {
  name: string;
  density: number;  // г/см³
  rheology: Rheology;
}

export interface PlugInterval {
  topMD: number;    // верх моста, м (MD)
  bottomMD: number; // низ моста, м (MD)
}

export interface PlugInputs {
  well: PlugWellData;
  plug: PlugInterval;
  cement: PlugFluid;          // цементный раствор
  spacer: PlugFluid;          // буферная жидкость (разделитель)
  drillingFluid: PlugFluid;   // буровой раствор
  spacerVolumeM3: number;     // объём буфера (ниже и выше цемента)
  safetyMarginM: number;      // запас высоты для пробки, м (обычно 20-50)
}

/* ───── Geometry helpers ───── */

/** Cross-section area, m² */
function area(diameterMm: number): number {
  const d = diameterMm / 1000;
  return (Math.PI / 4) * d * d;
}

/** Annular area between two diameters, m² */
function annularArea(outerMm: number, innerMm: number): number {
  return area(outerMm) - area(innerMm);
}

/** Hydrostatic pressure, МПа = ρ(г/см³) × 9.81 × TVD(м) / 1000 */
function hydroP(densityGcm3: number, tvdM: number): number {
  return densityGcm3 * 9.81 * tvdM / 1000;
}

/* ───── Main calculation ───── */

export interface PlugResults {
  // Geometry
  annArea: number;        // м²  — затрубье (ствол − трубы)
  pipeArea: number;       // м²  — внутр. трубы
  plugLengthMD: number;   // м   — длина моста по стволу
  plugTopTVD: number;
  plugBottomTVD: number;
  plugLengthTVD: number;

  // Volumes
  cementVolumeAnn: number;  // м³ — цемент в затрубье
  cementVolumePipe: number; // м³ — цемент в трубах
  cementVolumeTotal: number;
  spacerVolumeBelow: number; // м³ — буфер ниже цемента
  spacerVolumeAbove: number; // м³ — буфер выше цемента

  // Balanced placement
  cementHeightPipeMD: number;  // м — высота цемента в трубах (MD)
  pipeEndDepthMD: number;      // м — глубина конца труб (до дна моста или ниже)
  displacementVolume: number;  // м³ — объём продавки

  // Pressures at plug bottom
  pressureAnnulus: number;   // МПа
  pressurePipe: number;      // МПа
  isBalanced: boolean;

  // Fluid positions for visualization (from surface)
  fluidColumns: FluidColumn[];
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

export function calculateBalancedPlug(input: PlugInputs): PlugResults {
  const { well, plug, cement, spacer, drillingFluid, spacerVolumeM3 } = input;

  // Determine bore diameter at plug depth
  const isOpenHole = plug.bottomMD > well.casingShoe;
  const boreDiam = isOpenHole ? well.holeDiameter : well.casingID;

  const annA = annularArea(boreDiam, well.pipeOD);
  const pipeA = area(well.pipeID);

  const plugLenMD = Math.max(0, plug.bottomMD - plug.topMD);

  // TVD
  const traj = well.trajectory.length > 1 ? well.trajectory : [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: well.wellDepthMD, azimuth: 0, zenith: 0, tvd: well.wellDepthMD }];
  const plugTopTVD = interpolateTVD(plug.topMD, traj);
  const plugBottomTVD = interpolateTVD(plug.bottomMD, traj);
  const plugLenTVD = plugBottomTVD - plugTopTVD;

  // Pipe is lowered to plug bottom
  const pipeEndMD = plug.bottomMD;

  // Spacer volumes: split equally below and above cement
  const halfSpacer = spacerVolumeM3 / 2;

  // Spacer height below cement in annulus
  const spacerBelowHeightAnn = halfSpacer / annA; // м (MD approx)

  // Cement in annulus
  const cementVolAnn = annA * plugLenMD;

  // Spacer above cement in annulus
  const spacerAboveHeightAnn = halfSpacer / annA;

  // ── Balanced plug: cement height in pipe ──
  // At equilibrium (bottom of plug), pressure inside pipe = pressure in annulus.
  // Annulus column (from surface to plug bottom):
  //   mud from surface to (plugTop - spacerAboveHeight), then spacer, then cement, then spacer below
  // Pipe column:
  //   mud from surface to top of cement in pipe, then cement, then spacer below
  //
  // For balance: ρ_mud * TVD_mud_ann + ρ_spacer * TVD_spacer_above + ρ_cem * TVD_plug + ρ_spacer * TVD_spacer_below
  //            = ρ_mud * TVD_mud_pipe + ρ_cem * TVD_cem_pipe + ρ_spacer * TVD_spacer_below_pipe
  //
  // Simplified: the cement height in pipe satisfies:
  //   h_cem_pipe_TVD = plugLenTVD + (ρ_spacer - ρ_mud)/(ρ_cem - ρ_mud) * (spacerAboveTVD + spacerBelowTVD_diff)

  // For a simpler balanced approach (industry standard):
  // V_cement_total = V_ann_plug + V_pipe_cement
  // h_cem_pipe = (annA / pipeA) * plugLenMD  (geometric balance)
  // Then adjust for density difference

  // Standard balanced plug formula:
  // h_pipe = (annA * plugLen) / pipeA  -- this gives geometric balance
  // But true balance considers density:
  // ρ_cem * h_cem_ann_TVD = ρ_cem * h_cem_pipe_TVD + (ρ_mud) * (h_cem_ann_TVD - h_cem_pipe_TVD)
  // => h_cem_pipe_TVD = h_cem_ann_TVD (for balanced plug, cement occupies same TVD height in pipe)
  // BUT volumes differ because areas differ

  // Industry formula for balanced plug:
  const cementHeightPipeMD = plugLenMD; // same MD height for true hydrostatic balance
  const cementVolPipe = pipeA * cementHeightPipeMD;
  const cementVolTotal = cementVolAnn + cementVolPipe;

  // Spacer below cement in pipe
  const spacerBelowPipeHeight = spacerBelowHeightAnn; // same height
  const spacerBelowVolPipe = pipeA * spacerBelowPipeHeight;

  // Displacement volume = everything above cement in pipe
  // Pipe from surface to (pipeEnd - cementHeightPipe - spacerBelowPipeHeight)
  const cementTopInPipeMD = pipeEndMD - spacerBelowPipeHeight - cementHeightPipeMD;
  const spacerAbovePipeHeight = spacerAboveHeightAnn;
  const spacerAboveTopPipeMD = cementTopInPipeMD - spacerAbovePipeHeight;
  const displacementVolume = pipeA * Math.max(0, spacerAboveTopPipeMD);

  // Pressure check at plug bottom
  const surfaceTVD = 0;
  const pipeBottomTVD = plugBottomTVD;

  // Annulus: mud + spacer_above + cement + spacer_below
  const spacerAboveTopMD = plug.topMD - spacerAboveHeightAnn;
  const spacerBelowBottomMD = plug.bottomMD + spacerBelowHeightAnn;
  const spacerAboveTopTVD = interpolateTVD(Math.max(0, spacerAboveTopMD), traj);
  const spacerBelowBottomTVD = interpolateTVD(Math.min(well.wellDepthMD, spacerBelowBottomMD), traj);

  const mudTVD_ann = Math.max(0, spacerAboveTopTVD - surfaceTVD);
  const spacerAboveTVD = Math.max(0, plugTopTVD - spacerAboveTopTVD);
  const spacerBelowTVD = Math.max(0, spacerBelowBottomTVD - plugBottomTVD);

  const pAnn = hydroP(drillingFluid.density, mudTVD_ann)
    + hydroP(spacer.density, spacerAboveTVD)
    + hydroP(cement.density, plugLenTVD)
    + hydroP(spacer.density, spacerBelowTVD);

  // Pipe: mud + spacer_above + cement + spacer_below
  const mudTVD_pipe = Math.max(0, interpolateTVD(Math.max(0, spacerAboveTopPipeMD), traj));
  const spacerAbovePipeTVD = Math.max(0, interpolateTVD(Math.max(0, cementTopInPipeMD), traj) - mudTVD_pipe);
  const cementTopPipeTVD = interpolateTVD(Math.max(0, cementTopInPipeMD), traj);
  const cementPipeTVD = Math.max(0, pipeBottomTVD - spacerBelowTVD - cementTopPipeTVD);

  const pPipe = hydroP(drillingFluid.density, mudTVD_pipe)
    + hydroP(spacer.density, spacerAbovePipeTVD)
    + hydroP(cement.density, Math.min(plugLenTVD, cementPipeTVD))
    + hydroP(spacer.density, spacerBelowTVD);

  const isBalanced = Math.abs(pAnn - pPipe) < 0.5; // within 0.5 MPa

  // Build fluid columns for visualization
  const fluidColumns: FluidColumn[] = [];
  const mudColor = "#8B7355";
  const spacerColor = "#4FC3F7";
  const cementColor = "#B0BEC5";

  // Annulus columns
  fluidColumns.push({
    label: drillingFluid.name || "Буровой раствор",
    topMD: 0, bottomMD: Math.max(0, spacerAboveTopMD),
    topTVD: 0, bottomTVD: spacerAboveTopTVD,
    densityGcm3: drillingFluid.density, color: mudColor, location: 'annulus',
  });
  if (spacerAboveHeightAnn > 0) {
    fluidColumns.push({
      label: spacer.name || "Буфер", topMD: Math.max(0, spacerAboveTopMD), bottomMD: plug.topMD,
      topTVD: spacerAboveTopTVD, bottomTVD: plugTopTVD,
      densityGcm3: spacer.density, color: spacerColor, location: 'annulus',
    });
  }
  fluidColumns.push({
    label: cement.name || "Цемент", topMD: plug.topMD, bottomMD: plug.bottomMD,
    topTVD: plugTopTVD, bottomTVD: plugBottomTVD,
    densityGcm3: cement.density, color: cementColor, location: 'annulus',
  });
  if (spacerBelowHeightAnn > 0) {
    fluidColumns.push({
      label: spacer.name || "Буфер", topMD: plug.bottomMD, bottomMD: spacerBelowBottomMD,
      topTVD: plugBottomTVD, bottomTVD: spacerBelowBottomTVD,
      densityGcm3: spacer.density, color: spacerColor, location: 'annulus',
    });
  }
  fluidColumns.push({
    label: drillingFluid.name || "Буровой раствор",
    topMD: spacerBelowBottomMD, bottomMD: well.wellDepthMD,
    topTVD: spacerBelowBottomTVD, bottomTVD: interpolateTVD(well.wellDepthMD, traj),
    densityGcm3: drillingFluid.density, color: mudColor, location: 'annulus',
  });

  // Pipe columns
  fluidColumns.push({
    label: drillingFluid.name || "Буровой раствор (в трубах)",
    topMD: 0, bottomMD: Math.max(0, spacerAboveTopPipeMD),
    topTVD: 0, bottomTVD: Math.max(0, mudTVD_pipe),
    densityGcm3: drillingFluid.density, color: mudColor, location: 'pipe',
  });
  if (spacerAbovePipeHeight > 0) {
    fluidColumns.push({
      label: spacer.name || "Буфер (в трубах)", topMD: Math.max(0, spacerAboveTopPipeMD), bottomMD: Math.max(0, cementTopInPipeMD),
      topTVD: mudTVD_pipe, bottomTVD: cementTopPipeTVD,
      densityGcm3: spacer.density, color: spacerColor, location: 'pipe',
    });
  }
  fluidColumns.push({
    label: cement.name || "Цемент (в трубах)", topMD: Math.max(0, cementTopInPipeMD), bottomMD: Math.max(0, cementTopInPipeMD + cementHeightPipeMD),
    topTVD: cementTopPipeTVD, bottomTVD: cementTopPipeTVD + plugLenTVD,
    densityGcm3: cement.density, color: cementColor, location: 'pipe',
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
    spacerVolumeBelow: Math.round(halfSpacer * 1000) / 1000,
    spacerVolumeAbove: Math.round(halfSpacer * 1000) / 1000,
    cementHeightPipeMD: Math.round(cementHeightPipeMD * 100) / 100,
    pipeEndDepthMD: pipeEndMD,
    displacementVolume: Math.round(displacementVolume * 1000) / 1000,
    pressureAnnulus: Math.round(pAnn * 100) / 100,
    pressurePipe: Math.round(pPipe * 100) / 100,
    isBalanced,
    fluidColumns,
  };
}
