/**
 * Torque & Drag calculation engine — Soft-string (Johancsik) model.
 * Extended: BHA modes, motor drilling, back-reaming, fatigue, friction calibration, pick-up/slack-off.
 * V2: Fluid rheology effects (viscous drag), centralizer drag, cement-with-rotation mode.
 */

import { interpolateTVD, type TrajectoryPoint } from "./cementing-calculations";

/* ───── Types ───── */

export interface FluidSegment {
  name: string;
  density: number;       // кг/м³
  pv: number;            // сПз (пластическая вязкость)
  yp: number;            // Па (динамическое напряжение сдвига)
  topMD: number;         // м — верхняя граница в затрубье
  bottomMD: number;      // м — нижняя граница
}

export interface CentralizerDragItem {
  fromMD: number;
  toMD: number;
  centralizersPerJoint: number;
  jointLength: number;
  dragForcePerUnit: number;  // кН — сила трения на 1 центратор
}

export interface TDInput {
  trajectory: TrajectoryPoint[];
  wellDepthMD: number;
  casingDepthMD: number;
  casingShoe: number;
  holeDiameter: number;        // мм
  casingOD: number;            // мм
  casingID: number;            // мм
  pipeWeightKgPerM: number;
  mudDensity: number;          // г/см³
  frictionCased: number;
  frictionOpenhole: number;
  wob: number;                 // кН
  rpm: number;
  blockWeight: number;         // кН
  // Extended params
  yieldStrength?: number;      // предел текучести трубы, МПа
  pipeOD_mm?: number;          // OD трубы (если отличается от casingOD)
  dcLength?: number;           // длина УБТ, м
  dcOD?: number;               // мм
  dcWeight?: number;           // кг/м
  motorBendAngle?: number;     // угол перекоса ГЗД, °
  backReamSpeed?: number;      // скорость обратной проработки, м/мин
  // V2: Fluid rheology
  fluidSegments?: FluidSegment[];     // annular fluids for viscous drag
  tripSpeedMps?: number;              // скорость спуска/подъёма, м/с (default 0.5)
  // V2: Centralizer drag
  centralizerDrag?: CentralizerDragItem[];
  // V3: Fill level (недолив колонны)
  fillLevel?: number;          // % заполнения колонны жидкостью (0-100, default 100)
  fillFluidDensity?: number;   // плотность жидкости внутри, г/см³ (default = mudDensity)
  // V3: Surge/Swab & stuck-zone limits
  isOpenEnded?: boolean;       // открытый конец колонны (default false = с БКМ/обратным клапаном)
  fracGradient_kPaPerM?: number;   // градиент ГРП, кПа/м (для surge/swab)
  porePressureGrad_kPaPerM?: number; // градиент пластового давления, кПа/м
  maxHookLoad_kN?: number;     // грузоподъёмность буровой, кН (для StuckZones)
  jointLength?: number;        // длина свечи/трубы, м (default 12)
}

export type TDMode = 'trip_in' | 'trip_out' | 'rotate' | 'drill_rotary' | 'drill_motor' | 'back_ream' | 'pickup' | 'slackoff' | 'cement_rotate';

export interface TDPoint {
  md: number;
  tvd: number;
  zenith: number;
  azimuth: number;
  effectiveTension: number;    // кН
  dragForce: number;           // кН
  torque: number;              // кН·м
  sideForce: number;           // кН/м
  hookLoad: number;            // кН
  clearance: number;           // мм
  fatigueDamage?: number;
  vonMises?: number;           // МПа
  viscousDrag?: number;        // кН — accumulated viscous drag
  centralizerDragForce?: number; // кН — centralizer drag at this point
}

export interface TDResult {
  mode: TDMode;
  modeLabel: string;
  points: TDPoint[];
  maxHookLoad: number;
  minHookLoad: number;
  maxTorque: number;
  maxSideForce: number;
  freeRotatingWeight: number;
  maxFatigueDamage?: number;
  maxVonMises?: number;
  totalViscousDrag?: number;
  totalCentralizerDrag?: number;
}

export interface TDSummary {
  tripIn: TDResult;
  tripOut: TDResult;
  rotate: TDResult;
  freeWeight: number;
  buoyancyFactor: number;
}

/* ───── Helpers ───── */

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function buoyancyFactor(mudDensityGcm3: number, steelDensityGcm3: number = 7.85): number {
  return 1 - mudDensityGcm3 / steelDensityGcm3;
}

/**
 * Buoyancy factor for a tubular with partial internal fill.
 * Closed-bottom approximation: net upward force per unit length =
 *   ρ_mud × A_o − ρ_internal_eff × A_i
 * where ρ_internal_eff = ρ_fill × (fillLevel/100).
 * fillLevel=100 & ρ_fill=ρ_mud → standard BF; fillLevel=0 → BF = 1 − ρ_mud×A_o/(ρ_steel×A_w)
 */
function buoyancyFactorFilled(
  mudGcm3: number,
  fillFluidGcm3: number,
  fillLevelPct: number,
  pipeOD_mm: number,
  pipeID_mm: number,
  steelGcm3 = 7.85,
): number {
  const Ao = (Math.PI / 4) * (pipeOD_mm / 1000) ** 2;
  const Ai = (Math.PI / 4) * (pipeID_mm / 1000) ** 2;
  const Aw = Math.max(1e-9, Ao - Ai);
  const rhoFillEff = fillFluidGcm3 * Math.max(0, Math.min(100, fillLevelPct)) / 100;
  return 1 - (mudGcm3 * Ao - rhoFillEff * Ai) / (steelGcm3 * Aw);
}

/** Dogleg severity between two survey points, °/30m */
function calcDLS(zen1: number, azi1: number, zen2: number, azi2: number, dMD: number): number {
  if (dMD <= 0) return 0;
  const i1 = toRad(zen1), i2 = toRad(zen2);
  const a1 = toRad(azi1), a2 = toRad(azi2);
  const cosD = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
  const dl = Math.acos(Math.min(1, Math.max(-1, cosD)));
  return (dl * 180 / Math.PI) * (30 / dMD);
}

function fatigueDamagePerCycle(bendingStress: number, yieldStrength: number): number {
  if (bendingStress <= 0 || yieldStrength <= 0) return 0;
  const ratio = yieldStrength / bendingStress;
  if (ratio > 10) return 0;
  const nCycles = Math.pow(ratio, 4) * 1e6;
  return 1 / nCycles;
}

/* ───── Viscous drag calculation (Bingham plastic annular flow) ───── */

/**
 * Calculate viscous drag force per meter due to fluid movement in annulus.
 * Uses Bingham plastic model for annular flow around moving pipe.
 * Returns force in кН/м.
 */
function viscousDragPerMeter(
  pipeOD_mm: number,
  holeID_mm: number,
  fluidPV_cP: number,
  fluidYP_Pa: number,
  pipeSpeed_mps: number,
): number {
  if (fluidPV_cP <= 0 && fluidYP_Pa <= 0) return 0;
  if (pipeSpeed_mps <= 0) return 0;

  const ro = holeID_mm / 2000; // m
  const ri = pipeOD_mm / 2000; // m
  const gap = ro - ri;
  if (gap <= 0) return 0;

  // Shear stress on pipe surface (Couette flow approximation)
  // τ = YP + PV * V / gap
  const pvPas = fluidPV_cP * 0.001; // cP → Pa·s
  const shearStress = fluidYP_Pa + pvPas * pipeSpeed_mps / gap; // Pa

  // Force per meter = τ * circumference of pipe
  const circumference = Math.PI * pipeOD_mm / 1000; // m
  const forcePerMeter = shearStress * circumference; // N/m

  return forcePerMeter / 1000; // кН/м
}

/**
 * Find fluid at given MD from fluid segments.
 */
function findFluidAtMD(md: number, segments?: FluidSegment[]): FluidSegment | null {
  if (!segments || segments.length === 0) return null;
  return segments.find(s => md >= s.topMD && md <= s.bottomMD) ?? null;
}

/**
 * Calculate centralizer drag at given MD.
 * Returns additional drag force in кН for this segment.
 */
function centralizerDragAtMD(md: number, dMD: number, items?: CentralizerDragItem[]): number {
  if (!items || items.length === 0) return 0;
  const item = items.find(c => md >= c.fromMD && md <= c.toMD);
  if (!item || item.centralizersPerJoint <= 0 || item.jointLength <= 0) return 0;

  // Number of centralizers in this dMD segment
  const centralizersPerMeter = item.centralizersPerJoint / item.jointLength;
  const numCentralizers = centralizersPerMeter * dMD;
  return numCentralizers * item.dragForcePerUnit;
}

/* ───── Main Calculation ───── */

function buildSegments(traj: TrajectoryPoint[], wellDepthMD: number): TrajectoryPoint[] {
  if (traj.length >= 2) return traj;
  return [
    { md: 0, azimuth: 0, zenith: 0, tvd: 0 },
    { md: wellDepthMD, azimuth: 0, zenith: 0, tvd: wellDepthMD },
  ];
}

export function calculateTD(input: TDInput, mode: TDMode): TDResult {
  const traj = buildSegments(input.trajectory, input.wellDepthMD);
  const bf = buoyancyFactor(input.mudDensity);
  const unitWeight = input.pipeWeightKgPerM * 9.81 / 1000;
  const buoyantWeight = unitWeight * bf;

  const depthPoints: TrajectoryPoint[] = [];
  const step = 10;
  for (let md = 0; md <= input.casingDepthMD; md += step) {
    const tvd = interpolateTVD(md, traj);
    const zen = interpolateAngle(md, traj, 'zenith');
    const azi = interpolateAngle(md, traj, 'azimuth');
    depthPoints.push({ md, tvd, zenith: zen, azimuth: azi });
  }
  if (depthPoints.length === 0 || depthPoints[depthPoints.length - 1].md < input.casingDepthMD) {
    const md = input.casingDepthMD;
    depthPoints.push({ md, tvd: interpolateTVD(md, traj), zenith: interpolateAngle(md, traj, 'zenith'), azimuth: interpolateAngle(md, traj, 'azimuth') });
  }

  const n = depthPoints.length;
  const results: TDPoint[] = new Array(n);

  // Direction mapping
  const frictionSign = (mode === 'trip_in' || mode === 'drill_rotary' || mode === 'drill_motor' || mode === 'slackoff' || mode === 'cement_rotate') ? -1
    : (mode === 'trip_out' || mode === 'back_ream' || mode === 'pickup') ? 1
    : 0;
  const isRotating = mode === 'rotate' || mode === 'drill_rotary' || mode === 'drill_motor' || mode === 'back_ream' || mode === 'cement_rotate';

  let tension = 0;
  if (mode === 'drill_rotary' || mode === 'drill_motor') {
    tension = -input.wob;
  }

  let cumTorque = 0;
  let cumFatigue = 0;
  let cumViscousDrag = 0;
  let cumCentralizerDrag = 0;
  const yieldStr = input.yieldStrength ?? 550;
  const pipeOD = input.pipeOD_mm ?? input.casingOD;
  const tripSpeed = input.tripSpeedMps ?? 0.5; // м/с default

  // DC section
  const dcTop = input.dcLength ? Math.max(0, input.casingDepthMD - input.dcLength) : input.casingDepthMD;
  const dcWeight = input.dcWeight ? input.dcWeight * 9.81 / 1000 * bf : buoyantWeight;
  const dcOD = input.dcOD ?? pipeOD;

  for (let i = n - 1; i >= 0; i--) {
    const pt = depthPoints[i];
    const mu = pt.md > input.casingShoe ? input.frictionOpenhole : input.frictionCased;
    const boreDiam = pt.md > input.casingShoe ? input.holeDiameter : input.casingID;

    // Use DC or DP weight
    const inDC = pt.md >= dcTop && input.dcLength && input.dcLength > 0;
    const segWeight = inDC ? dcWeight : buoyantWeight;
    const segOD = inDC ? dcOD : pipeOD;
    const clearance = (boreDiam - segOD) / 2;

    if (i < n - 1) {
      const ptNext = depthPoints[i + 1];
      const dMD = ptNext.md - pt.md;

      const incUpper = toRad(pt.zenith);
      const incLower = toRad(ptNext.zenith);
      const aziUpper = toRad(pt.azimuth);
      const aziLower = toRad(ptNext.azimuth);
      const avgInc = (incUpper + incLower) / 2;
      const dInc = incLower - incUpper;
      const dAzi = aziLower - aziUpper;

      const Wb = segWeight * dMD;
      const Fn_inc = tension * dInc + Wb * Math.sin(avgInc);
      const Fn_azi = tension * Math.sin(avgInc) * dAzi;
      const Fn = Math.sqrt(Fn_inc * Fn_inc + Fn_azi * Fn_azi);
      const drag = mu * Fn;

      // Motor drilling — add motor bend side force
      let motorSF = 0;
      if (mode === 'drill_motor' && input.motorBendAngle && input.motorBendAngle > 0) {
        motorSF = input.wob * Math.sin(toRad(input.motorBendAngle)) * 0.1;
      }

      // V2: Viscous drag from fluid rheology
      let viscDrag = 0;
      if (input.fluidSegments && input.fluidSegments.length > 0) {
        const fluid = findFluidAtMD(pt.md, input.fluidSegments);
        if (fluid) {
          const vdPerM = viscousDragPerMeter(segOD, boreDiam, fluid.pv, fluid.yp, tripSpeed);
          viscDrag = vdPerM * dMD;
          // Viscous drag always opposes motion
          cumViscousDrag += viscDrag;
        }
      }

      // V2: Centralizer drag
      let centDrag = 0;
      if (input.centralizerDrag && input.centralizerDrag.length > 0) {
        centDrag = centralizerDragAtMD(pt.md, dMD, input.centralizerDrag);
        cumCentralizerDrag += centDrag;
      }

      if (isRotating) {
        tension += Wb * Math.cos(avgInc);
        cumTorque += mu * (Fn + motorSF) * (segOD / 2000);
        // For cement_rotate, add viscous torque from fluid
        if (mode === 'cement_rotate' && input.fluidSegments) {
          const fluid = findFluidAtMD(pt.md, input.fluidSegments);
          if (fluid && input.rpm > 0) {
            // Viscous torque: τ = (YP + PV*ω*r/gap) * 2πr * r * dL
            const r = segOD / 2000;
            const R = boreDiam / 2000;
            const gap = R - r;
            if (gap > 0) {
              const omega = input.rpm * 2 * Math.PI / 60; // рад/с
              const pvPas = fluid.pv * 0.001;
              const shearTorque = (fluid.yp + pvPas * omega * r / gap) * 2 * Math.PI * r * r * dMD;
              cumTorque += shearTorque / 1000; // Н·м → кН·м
            }
          }
        }
      } else {
        tension += Wb * Math.cos(avgInc) + frictionSign * (drag + viscDrag + centDrag);
      }

      // DLS-based fatigue
      const dls = calcDLS(pt.zenith, pt.azimuth, ptNext.zenith, ptNext.azimuth, dMD);
      const bendingStress = dls > 0 ? (segOD / 2000) * 210e3 * (dls * Math.PI / 180) / (30) : 0;
      const dmg = isRotating && input.rpm > 0 ? fatigueDamagePerCycle(bendingStress, yieldStr) * input.rpm * (dMD / (input.rpm * 0.1 + 1)) : 0;
      cumFatigue += dmg;

      // Von Mises stress
      const wallThick = (input.casingOD - input.casingID) / 2;
      const axialStress = Math.abs(tension) / (Math.PI * ((segOD / 2000) ** 2 - ((segOD - 2 * wallThick) / 2000) ** 2));
      const shearStress = cumTorque > 0 ? cumTorque / (Math.PI / 16 * (segOD / 1000) ** 3) : 0;
      const vonMises = Math.sqrt(axialStress ** 2 + 3 * shearStress ** 2) / 1e3;

      results[i] = {
        md: pt.md, tvd: pt.tvd, zenith: pt.zenith, azimuth: pt.azimuth,
        effectiveTension: tension,
        dragForce: drag,
        torque: cumTorque,
        sideForce: dMD > 0 ? Fn / dMD : 0,
        hookLoad: tension + input.blockWeight,
        clearance,
        fatigueDamage: cumFatigue,
        vonMises: Math.abs(vonMises),
        viscousDrag: cumViscousDrag,
        centralizerDragForce: cumCentralizerDrag,
      };
    } else {
      results[i] = {
        md: pt.md, tvd: pt.tvd, zenith: pt.zenith, azimuth: pt.azimuth,
        effectiveTension: tension,
        dragForce: 0, torque: 0, sideForce: 0,
        hookLoad: tension + input.blockWeight,
        clearance,
        fatigueDamage: 0, vonMises: 0,
        viscousDrag: 0, centralizerDragForce: 0,
      };
    }
  }

  const hookLoads = results.map(p => p.hookLoad);
  const torques = results.map(p => p.torque);
  const sideForces = results.map(p => p.sideForce);

  const modeLabels: Record<TDMode, string> = {
    trip_in: 'Спуск колонны',
    trip_out: 'Подъём колонны',
    rotate: 'Вращение',
    drill_rotary: 'Бурение ротором',
    drill_motor: 'Бурение ГЗД',
    back_ream: 'Обратная проработка',
    pickup: 'Затяжка (Pick-up)',
    slackoff: 'Разгрузка (Slack-off)',
    cement_rotate: 'Цемент. с вращением',
  };

  return {
    mode,
    modeLabel: modeLabels[mode],
    points: results,
    maxHookLoad: Math.max(...hookLoads),
    minHookLoad: Math.min(...hookLoads),
    maxTorque: Math.max(...torques),
    maxSideForce: Math.max(...sideForces),
    freeRotatingWeight: buoyantWeight * input.casingDepthMD + input.blockWeight,
    maxFatigueDamage: Math.max(...results.map(p => p.fatigueDamage ?? 0)),
    maxVonMises: Math.max(...results.map(p => p.vonMises ?? 0)),
    totalViscousDrag: cumViscousDrag,
    totalCentralizerDrag: cumCentralizerDrag,
  };
}

export function calculateTDSummary(input: TDInput): TDSummary {
  const tripIn = calculateTD(input, 'trip_in');
  const tripOut = calculateTD(input, 'trip_out');
  const rotate = calculateTD(input, 'rotate');
  const bf = buoyancyFactor(input.mudDensity);
  const freeWeight = input.pipeWeightKgPerM * 9.81 / 1000 * bf * input.casingDepthMD + input.blockWeight;
  return { tripIn, tripOut, rotate, freeWeight, buoyancyFactor: bf };
}

/* ───── Angle interpolation ───── */

function interpolateAngle(md: number, traj: TrajectoryPoint[], field: 'zenith' | 'azimuth'): number {
  if (traj.length === 0) return 0;
  if (md <= traj[0].md) return traj[0][field];
  if (md >= traj[traj.length - 1].md) return traj[traj.length - 1][field];
  for (let i = 0; i < traj.length - 1; i++) {
    if (md >= traj[i].md && md <= traj[i + 1].md) {
      const frac = (md - traj[i].md) / (traj[i + 1].md - traj[i].md);
      return traj[i][field] + frac * (traj[i + 1][field] - traj[i][field]);
    }
  }
  return traj[traj.length - 1][field];
}
