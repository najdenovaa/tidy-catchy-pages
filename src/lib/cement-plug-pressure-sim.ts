/**
 * Time-step pressure simulation for balanced cement plug placement.
 * Generates data points for the combined pressure/volume chart.
 */

import { interpolateTVD, type TrajectoryPoint, type Rheology } from "./cementing-calculations";
import type { PlugInputs, PlugResults } from "./cement-plug-calculations";

/* ───── Output ───── */

export interface PressureTimePoint {
  timeMin: number;
  stage: string;
  pumpRateLs: number;
  volumePumpedM3: number;
  volSpacerM3: number;    // cumulative spacer volume
  volCementM3: number;    // cumulative cement volume
  volDisplM3: number;     // cumulative displacement volume
  volWashM3: number;      // cumulative wash volume
  bhpMPa: number;
  shoePressMPa: number;   // pressure at casing shoe depth (annulus side)
  surfaceMPa: number;
  fracMPa: number;
  hydroStaticAnnMPa: number;
  hydroStaticPipeMPa: number;
  frictionMPa: number;
}

/* ───── Helpers ───── */

function areaM2(diamMm: number): number {
  const d = diamMm / 1000;
  return (Math.PI / 4) * d * d;
}

function annAreaM2(outerMm: number, innerMm: number): number {
  return areaM2(outerMm) - areaM2(innerMm);
}

/** Bingham friction loss, MPa */
function frictionBingham(qLs: number, lengthM: number, dHydMm: number, flowAreaM2: number, pv: number, yp: number, densKgM3: number): number {
  const dHyd = dHydMm / 1000;
  if (dHyd <= 0 || qLs <= 0 || lengthM <= 0) return 0;
  const area = flowAreaM2 > 0 ? flowAreaM2 : (Math.PI / 4) * dHyd * dHyd;
  const v = (qLs / 1000) / area; // m/s
  const pvPas = pv / 1000;
  const muEff = pvPas + yp * dHyd / (6 * v);
  const Re = densKgM3 * v * dHyd / muEff;

  const frLam = (32 * pvPas * v * lengthM) / (dHyd * dHyd) / 1e6;
  const yieldTerm = (16 * yp * lengthM) / (3 * dHyd) / 1e6;
  const laminar = frLam + yieldTerm;
  const f = 0.0791 / Math.pow(Math.max(Re, 100), 0.25);
  const turbulent = (2 * f * densKgM3 * v * v * lengthM) / dHyd / 1e6;

  if (Re < 2100) return laminar;
  if (Re > 4000) return turbulent;
  const blend = (Re - 2100) / 1900;
  return laminar * (1 - blend) + turbulent * blend;
}

function hydroMPa(densGcm3: number, tvdM: number): number {
  return densGcm3 * 9.81 * tvdM / 1000;
}

/* ───── Simulation ───── */

interface FluidSegment {
  fluid: 'mud' | 'spacer' | 'cement';
  lengthM: number; // length in MD
}

export function simulatePlugPressures(
  input: PlugInputs,
  results: PlugResults,
  fracGradientMPaPerM: number,
): PressureTimePoint[] {
  const { well, plug, cement, spacer, wellFluid } = input;
  const traj = well.trajectory.length > 1 ? well.trajectory
    : [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: well.wellDepthMD, azimuth: 0, zenith: 0, tvd: well.wellDepthMD }];

  const isOpenHole = plug.bottomMD > well.casingShoe;
  const cavernCoeff = isOpenHole ? Math.max(1, well.cavernCoeff || 1) : 1;
  const boreDiam = isOpenHole ? well.holeDiameter * Math.sqrt(cavernCoeff) : well.casingID;
  const pipeEndMD = plug.bottomMD;

  const annA = annAreaM2(boreDiam, well.pipeOD);
  const pipeA = areaM2(well.pipeID);
  const boreA = areaM2(boreDiam);

  const dHydPipe = well.pipeID; // mm
  const dHydAnn = boreDiam - well.pipeOD; // mm

  // Frac pressure — at plug bottom (bottomTVD)
  const shoeTVD = interpolateTVD(well.casingShoe, traj);
  const bottomTVD = interpolateTVD(pipeEndMD, traj);
  const fracMPa = fracGradientMPaPerM * bottomTVD;
  const shoeMD = well.casingShoe;
  // Distance from bottom of annulus to shoe
  const belowShoeMD = Math.max(0, pipeEndMD - shoeMD);

  const points: PressureTimePoint[] = [];
  const dt = 0.5; // time step, min

  // Define fluid properties lookup
  const fluidProps = (f: 'mud' | 'spacer' | 'cement') => {
    switch (f) {
      case 'cement': return { density: cement.density, pv: cement.rheology.pv, yp: cement.rheology.yp };
      case 'spacer': return { density: spacer.density, pv: spacer.rheology.pv, yp: spacer.rheology.yp };
      default: return { density: wellFluid.density, pv: wellFluid.rheology.pv, yp: wellFluid.rheology.yp };
    }
  };

  // We track what's pumped INTO the pipe from surface. The pipe pushes fluid out the bottom into annulus.
  // Pipe: surface → pipeEndMD (length = pipeEndMD)
  // Annulus: pipeEndMD → surface (length = pipeEndMD, fluid rises from bottom)

  // Pipe contents: array from surface(top) to bottom. Each segment has fluid type and length.
  let pipeContents: FluidSegment[] = [{ fluid: 'mud', lengthM: pipeEndMD }];
  // Annulus contents: array from bottom(pipeEnd) to surface. 
  let annContents: FluidSegment[] = [{ fluid: 'mud', lengthM: pipeEndMD }];

  // Define pumping stages as: [fluid, volumeM3, pumpRateLs]
  const stages: { name: string; fluid: 'spacer' | 'cement' | 'mud'; volumeM3: number; rateLs: number }[] = [];

  if (input.spacerVolumeBelowM3 > 0) {
    stages.push({ name: 'Ниж. буфер', fluid: 'spacer', volumeM3: input.spacerVolumeBelowM3, rateLs: input.pumpRateSpacerLs });
  }
  stages.push({ name: 'Цемент', fluid: 'cement', volumeM3: results.cementVolumeTotal, rateLs: input.pumpRateCementLs });
  if (input.spacerVolumeAboveM3 > 0) {
    const spacerAboveTotal = input.spacerVolumeAboveM3 + pipeA * results.spacerAboveHeightAnnMD;
    stages.push({ name: 'Верх. буфер', fluid: 'spacer', volumeM3: spacerAboveTotal, rateLs: input.pumpRateSpacerLs });
  }
  stages.push({ name: 'Продавка', fluid: 'mud', volumeM3: results.displacementVolume, rateLs: input.pumpRateDisplacementLs });

  let timeMin = 0;
  let cumulativeVolumeM3 = 0;
  // Per-stage volume (resets at each new stage)
  let stgSpacer = 0;
  let stgCement = 0;
  let stgDispl = 0;
  let stgWash = 0;
  let cumWash = 0;

  // Helper: compute hydrostatic from a list of fluid segments over a given total length
  // Segments are ordered from one end; we need TVD-weighted pressures
  function computeHydrostatic(segments: FluidSegment[], totalMD: number, startMD: number, direction: 'down' | 'up'): number {
    let pressure = 0;
    let currentMD = startMD;
    for (const seg of segments) {
      const segLen = Math.min(seg.lengthM, Math.max(0, totalMD));
      if (segLen <= 0) continue;
      const props = fluidProps(seg.fluid);
      let md1: number, md2: number;
      if (direction === 'down') {
        md1 = currentMD;
        md2 = currentMD + segLen;
      } else {
        md1 = currentMD;
        md2 = currentMD - segLen;
      }
      const tvd1 = interpolateTVD(Math.max(0, Math.min(well.wellDepthMD, md1)), traj);
      const tvd2 = interpolateTVD(Math.max(0, Math.min(well.wellDepthMD, md2)), traj);
      const dTVD = Math.abs(tvd2 - tvd1);
      pressure += hydroMPa(props.density, dTVD);
      currentMD = direction === 'down' ? md2 : md2;
    }
    return pressure;
  }

  // Compute friction for pipe contents
  function computePipeFriction(rateLs: number): number {
    if (rateLs <= 0) return 0;
    let totalFriction = 0;
    for (const seg of pipeContents) {
      if (seg.lengthM <= 0) continue;
      const props = fluidProps(seg.fluid);
      totalFriction += frictionBingham(rateLs, seg.lengthM, dHydPipe, pipeA, props.pv, props.yp, props.density * 1000);
    }
    return totalFriction;
  }

  // Compute friction for annulus contents
  function computeAnnFriction(rateLs: number): number {
    if (rateLs <= 0) return 0;
    let totalFriction = 0;
    for (const seg of annContents) {
      if (seg.lengthM <= 0) continue;
      const props = fluidProps(seg.fluid);
      totalFriction += frictionBingham(rateLs, seg.lengthM, dHydAnn, annA, props.pv, props.yp, props.density * 1000);
    }
    return totalFriction * 0.8; // annular friction coefficient
  }

  // Push fluid into pipe from surface (top), fluid exits bottom into annulus
  function pumpVolume(fluid: 'mud' | 'spacer' | 'cement', volumeM3: number) {
    const lengthInPipe = pipeA > 0 ? volumeM3 / pipeA : 0;
    // Add to top of pipe
    pipeContents.unshift({ fluid, lengthM: lengthInPipe });
    // Trim pipe to pipeEndMD - overflow goes to annulus bottom
    let totalPipeLen = pipeContents.reduce((s, seg) => s + seg.lengthM, 0);
    let overflow: FluidSegment[] = [];
    while (totalPipeLen > pipeEndMD && pipeContents.length > 0) {
      const last = pipeContents[pipeContents.length - 1];
      const excess = totalPipeLen - pipeEndMD;
      if (excess >= last.lengthM) {
        overflow.unshift(last);
        pipeContents.pop();
        totalPipeLen -= last.lengthM;
      } else {
        overflow.unshift({ fluid: last.fluid, lengthM: excess });
        last.lengthM -= excess;
        totalPipeLen = pipeEndMD;
      }
    }
    // Overflow enters annulus from bottom - convert pipe volume to annular length
    for (const seg of overflow) {
      const volM3 = seg.lengthM * pipeA;
      const annLen = annA > 0 ? volM3 / annA : 0;
      annContents.unshift({ fluid: seg.fluid, lengthM: annLen });
    }
    // Trim annulus to pipeEndMD
    let totalAnnLen = annContents.reduce((s, seg) => s + seg.lengthM, 0);
    while (totalAnnLen > pipeEndMD && annContents.length > 0) {
      const last = annContents[annContents.length - 1];
      const excess = totalAnnLen - pipeEndMD;
      if (excess >= last.lengthM) {
        annContents.pop();
        totalAnnLen -= last.lengthM;
      } else {
        last.lengthM -= excess;
        totalAnnLen = pipeEndMD;
      }
    }
    // Merge consecutive same-fluid segments
    pipeContents = mergeSegments(pipeContents);
    annContents = mergeSegments(annContents);
  }

  function mergeSegments(segs: FluidSegment[]): FluidSegment[] {
    const merged: FluidSegment[] = [];
    for (const s of segs) {
      if (merged.length > 0 && merged[merged.length - 1].fluid === s.fluid) {
        merged[merged.length - 1].lengthM += s.lengthM;
      } else {
        merged.push({ ...s });
      }
    }
    return merged;
  }

  function computePoint(stage: string, rateLs: number): PressureTimePoint {
    // Hydrostatic: pipe is surface→bottom (down), annulus is bottom→surface (up)
    const hPipe = computeHydrostatic(pipeContents, pipeEndMD, 0, 'down');
    const hAnn = computeHydrostatic(annContents, pipeEndMD, pipeEndMD, 'up');

    const fPipe = computePipeFriction(rateLs);
    const fAnn = computeAnnFriction(rateLs);

    // BHP at plug bottom: P_bottom = hydro_ann + friction_ann (annulus open at surface)
    const bhp = hAnn + fAnn;

    // Pressure at casing shoe from annulus side:
    // P_shoe = BHP - hydro(bottom→shoe) - friction(bottom→shoe)
    // We compute partial hydrostatic & friction for the below-shoe portion of annulus
    let hBelowShoe = 0;
    let fBelowShoe = 0;
    if (belowShoeMD > 0) {
      let remainMD = belowShoeMD;
      for (const seg of annContents) {
        if (remainMD <= 0) break;
        const segLen = Math.min(seg.lengthM, remainMD);
        if (segLen <= 0) continue;
        const props = fluidProps(seg.fluid);
        // Hydrostatic for this segment
        const md1 = pipeEndMD - (belowShoeMD - remainMD);
        const md2 = md1 - segLen;
        const tvd1 = interpolateTVD(Math.max(0, Math.min(well.wellDepthMD, md1)), traj);
        const tvd2 = interpolateTVD(Math.max(0, Math.min(well.wellDepthMD, md2)), traj);
        hBelowShoe += hydroMPa(props.density, Math.abs(tvd1 - tvd2));
        // Friction for this segment
        if (rateLs > 0) {
          fBelowShoe += frictionBingham(rateLs, segLen, dHydAnn, annA, props.pv, props.yp, props.density * 1000) * 0.8;
        }
        remainMD -= segLen;
      }
    }
    const shoePress = Math.max(0, bhp - hBelowShoe - fBelowShoe);

    // Surface pressure balance: P_surface + hPipe - fPipe = BHP
    const surface = Math.max(0, hAnn + fAnn - hPipe + fPipe);

    return {
      timeMin,
      stage,
      pumpRateLs: rateLs,
      volumePumpedM3: cumulativeVolumeM3,
      volSpacerM3: stgSpacer,
      volCementM3: stgCement,
      volDisplM3: stgDispl,
      volWashM3: stgWash,
      bhpMPa: bhp,
      shoePressMPa: shoePress,
      surfaceMPa: surface,
      fracMPa,
      hydroStaticAnnMPa: hAnn,
      hydroStaticPipeMPa: hPipe,
      frictionMPa: fPipe + fAnn,
    };
  }

  // Initial point (static, before pumping)
  points.push(computePoint('Статика', 0));

  // Pumping stages
  for (const stage of stages) {
    const { name, fluid, volumeM3, rateLs } = stage;
    if (volumeM3 <= 0 || rateLs <= 0) continue;

    // Reset all per-stage volumes at start of each stage
    stgSpacer = 0; stgCement = 0; stgDispl = 0; stgWash = 0;

    const totalTimeStageSec = (volumeM3 * 1000 / rateLs);
    const totalTimeStageMin = totalTimeStageSec / 60;
    const steps = Math.max(1, Math.ceil(totalTimeStageMin / dt));
    const actualDt = totalTimeStageMin / steps;
    const dVol = volumeM3 / steps;

    for (let s = 0; s < steps; s++) {
      pumpVolume(fluid, dVol);
      timeMin += actualDt;
      cumulativeVolumeM3 += dVol;
      if (fluid === 'spacer') stgSpacer += dVol;
      else if (fluid === 'cement') stgCement += dVol;
      else stgDispl += dVol;
      points.push(computePoint(name, rateLs));
    }
  }

  // Pull-out phase (no pumping)
  const tripTimeMin = results.tripTimeMin;
  if (tripTimeMin > 0) {
    stgSpacer = 0; stgCement = 0; stgDispl = 0; stgWash = 0;
    const tripSteps = Math.max(1, Math.ceil(tripTimeMin / dt));
    const tripDt = tripTimeMin / tripSteps;
    for (let s = 0; s < tripSteps; s++) {
      timeMin += tripDt;
      points.push(computePoint('Подъём', 0));
    }
  }

  // Wash phase
  const washTimeMin = results.washTimeMin;
  if (washTimeMin > 0 && input.pumpRateWashLs > 0) {
    stgSpacer = 0; stgCement = 0; stgDispl = 0; stgWash = 0;
    const washSteps = Math.max(1, Math.ceil(washTimeMin / dt));
    const washDt = washTimeMin / washSteps;
    for (let s = 0; s < washSteps; s++) {
      timeMin += washDt;
      const dWashVol = results.washVolumeM3 / washSteps;
      cumulativeVolumeM3 += dWashVol;
      stgWash += dWashVol;
      points.push(computePoint('Промывка', input.pumpRateWashLs));
    }
  }

  return points;
}
