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
  const useFill = input.fillLevel !== undefined && input.fillLevel < 100;
  const fillFluid = input.fillFluidDensity ?? input.mudDensity;
  const pipeOD = input.pipeOD_mm ?? input.casingOD;
  const bf = useFill
    ? buoyancyFactorFilled(input.mudDensity, fillFluid, input.fillLevel ?? 100, pipeOD, input.casingID)
    : buoyancyFactor(input.mudDensity);
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
  const tripSpeed = input.tripSpeedMps ?? 0.5; // м/с default — pipeOD already declared above

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
  const useFill = input.fillLevel !== undefined && input.fillLevel < 100;
  const fillFluid = input.fillFluidDensity ?? input.mudDensity;
  const pipeOD = input.pipeOD_mm ?? input.casingOD;
  const bf = useFill
    ? buoyancyFactorFilled(input.mudDensity, fillFluid, input.fillLevel ?? 100, pipeOD, input.casingID)
    : buoyancyFactor(input.mudDensity);
  const freeWeight = input.pipeWeightKgPerM * 9.81 / 1000 * bf * input.casingDepthMD + input.blockWeight;
  return { tripIn, tripOut, rotate, freeWeight, buoyancyFactor: bf };
}

/* ───── Surge & Swab (Burkhardt simplified, Bingham plastic annulus) ───── */

export interface SurgeSwabPoint {
  md: number;
  tvd: number;
  hydrostaticMPa: number;       // статика бурового
  surgePressureMPa: number;     // приращение при спуске
  swabPressureMPa: number;      // разрежение при подъёме
  totalBHPsurgeMPa: number;
  totalBHPswabMPa: number;
  fracPressureMPa: number;
  porePressureMPa: number;
  ecdSurge: number;             // г/см³
  ecdSwab: number;
  isSafeSurge: boolean;
  isSafeSwab: boolean;
}

export interface SurgeSwabResult {
  points: SurgeSwabPoint[];
  maxSurgeMPa: number;
  maxSwabMPa: number;
  worstSurgeMargin: number;     // P_frac − BHP_surge на самой опасной глубине, МПа
  worstSwabMargin: number;      // BHP_swab − P_pore (если <0 → приток)
}

/**
 * Calculate Surge/Swab pressures vs depth.
 * Burkhardt closed-end approximation: v_eff = v_pipe × Kp × (Dc² / (Dh² − Dc²))
 * where Kp ≈ 1.5 (closed end) or 0.5 (open end).
 * Shear stress on pipe (Bingham): τ = YP + PV·v_eff/gap
 * ΔP_per_meter = 4 · τ · Dc / (Dh² − Dc²)
 */
export function calculateSurgeSwab(input: TDInput): SurgeSwabResult {
  const traj = buildSegments(input.trajectory, input.wellDepthMD);
  const pipeOD = input.pipeOD_mm ?? input.casingOD;
  const v = input.tripSpeedMps ?? 0.5;
  const Kp = input.isOpenEnded ? 0.5 : 1.5;
  const fracGrad = input.fracGradient_kPaPerM ?? 18; // kPa/m default
  const poreGrad = input.porePressureGrad_kPaPerM ?? 10.5; // gradient of normal pore pressure
  const mud = input.mudDensity; // g/cm³
  const G_KPA_PER_M = 9.81;

  const step = 25;
  const points: SurgeSwabPoint[] = [];
  let cumSurgeMPa = 0;
  let cumSwabMPa = 0;
  let prevTVD = 0;

  for (let md = 0; md <= input.casingDepthMD; md += step) {
    const tvd = interpolateTVD(md, traj);
    const dTVD = Math.max(0, tvd - prevTVD);
    prevTVD = tvd;

    const hole = md > input.casingShoe ? input.holeDiameter : input.casingID;
    const Dc = pipeOD / 1000;
    const Dh = hole / 1000;
    const gap = Math.max(1e-4, (Dh - Dc) / 2);
    const annArea = Math.PI / 4 * (Dh * Dh - Dc * Dc);

    // Fluid rheology at this depth (fall back to mud)
    const fl = input.fluidSegments?.find(s => md >= s.topMD && md <= s.bottomMD);
    const pv = (fl?.pv ?? 30) * 0.001;   // Pa·s
    const yp = fl?.yp ?? 5;              // Pa

    // Effective annular flow velocity (closed-end displaces its area)
    const vEff = v * Kp * (Math.PI / 4 * Dc * Dc) / Math.max(1e-6, annArea);
    const shearStress = yp + pv * vEff / gap; // Pa
    // ΔP per meter MD ≈ τ × perimeter_pipe / annular area
    const dPperM = shearStress * (Math.PI * Dc) / Math.max(1e-6, annArea); // Pa/m

    const dP_MPa = dPperM * step / 1e6;
    cumSurgeMPa += dP_MPa;
    cumSwabMPa += dP_MPa;

    const hydrostaticMPa = mud * G_KPA_PER_M * tvd / 1000;
    const fracPressureMPa = fracGrad * tvd / 1000;
    const porePressureMPa = poreGrad * tvd / 1000;
    const totalSurge = hydrostaticMPa + cumSurgeMPa;
    const totalSwab = Math.max(0, hydrostaticMPa - cumSwabMPa);
    const ecdSurge = tvd > 0 ? totalSurge / (G_KPA_PER_M * tvd / 1000) : mud;
    const ecdSwab = tvd > 0 ? totalSwab / (G_KPA_PER_M * tvd / 1000) : mud;

    void dTVD;
    points.push({
      md, tvd,
      hydrostaticMPa,
      surgePressureMPa: cumSurgeMPa,
      swabPressureMPa: cumSwabMPa,
      totalBHPsurgeMPa: totalSurge,
      totalBHPswabMPa: totalSwab,
      fracPressureMPa, porePressureMPa,
      ecdSurge, ecdSwab,
      isSafeSurge: totalSurge < fracPressureMPa,
      isSafeSwab: totalSwab > porePressureMPa,
    });
  }

  let worstSurge = Number.POSITIVE_INFINITY;
  let worstSwab = Number.POSITIVE_INFINITY;
  let maxSurge = 0, maxSwab = 0;
  for (const p of points) {
    worstSurge = Math.min(worstSurge, p.fracPressureMPa - p.totalBHPsurgeMPa);
    worstSwab = Math.min(worstSwab, p.totalBHPswabMPa - p.porePressureMPa);
    maxSurge = Math.max(maxSurge, p.surgePressureMPa);
    maxSwab = Math.max(maxSwab, p.swabPressureMPa);
  }

  return {
    points,
    maxSurgeMPa: maxSurge,
    maxSwabMPa: maxSwab,
    worstSurgeMargin: Number.isFinite(worstSurge) ? worstSurge : 0,
    worstSwabMargin: Number.isFinite(worstSwab) ? worstSwab : 0,
  };
}

/* ───── Stuck zones (зоны риска посадки/прихвата) ───── */

export interface StuckZone {
  topMD: number;
  bottomMD: number;
  reason: 'buckling' | 'clearance' | 'hook_load' | 'dls' | 'surge_frac' | 'swab_kick' | 'yield';
  severity: 'warning' | 'critical';
  metric: string;       // короткое числовое описание
  recommendation: string;
}

const DLS_LIMIT_DEG_30M = 5.0;       // жёсткий лимит DLS для крупной колонны
const CLEARANCE_WARN_MM = 10;
const CLEARANCE_CRIT_MM = 5;

export function findStuckZones(
  tripIn: TDResult,
  tripOut: TDResult,
  surgeSwab: SurgeSwabResult | null,
  input: TDInput,
): StuckZone[] {
  const zones: StuckZone[] = [];
  const maxHL = input.maxHookLoad_kN;
  const yieldStr = input.yieldStrength ?? 550;
  const pts = tripIn.points;

  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i];
    const next = pts[i + 1];
    const span = next ? next.md - pt.md : 10;

    // 1. Buckling — hookload < 0 (колонна теряет вес)
    if (pt.hookLoad < 0) {
      zones.push({
        topMD: pt.md, bottomMD: pt.md + span,
        reason: 'buckling', severity: 'critical',
        metric: `HL = ${pt.hookLoad.toFixed(0)} кН`,
        recommendation: 'Колонна теряет вес — риск продольного изгиба (buckling). Увеличьте ρ бурового или долейте колонну.',
      });
    }

    // 2. Clearance
    if (pt.clearance < CLEARANCE_CRIT_MM) {
      zones.push({
        topMD: pt.md, bottomMD: pt.md + span,
        reason: 'clearance', severity: 'critical',
        metric: `зазор ${pt.clearance.toFixed(0)} мм`,
        recommendation: `Критически малый зазор (${pt.clearance.toFixed(0)} мм) — муфта/центратор не пройдут. Обязательна предварительная проработка.`,
      });
    } else if (pt.clearance < CLEARANCE_WARN_MM) {
      zones.push({
        topMD: pt.md, bottomMD: pt.md + span,
        reason: 'clearance', severity: 'warning',
        metric: `зазор ${pt.clearance.toFixed(0)} мм`,
        recommendation: `Малый зазор (${pt.clearance.toFixed(0)} мм) — высокий риск посадки при наличии жёстких центраторов.`,
      });
    }

    // 3. Hook load > rig capacity
    if (maxHL && pt.hookLoad > maxHL) {
      zones.push({
        topMD: pt.md, bottomMD: pt.md + span,
        reason: 'hook_load', severity: 'critical',
        metric: `HL ${pt.hookLoad.toFixed(0)} > ${maxHL} кН`,
        recommendation: `Нагрузка на крюке (${pt.hookLoad.toFixed(0)} кН) превышает грузоподъёмность буровой (${maxHL} кН).`,
      });
    }
    if (maxHL && tripOut.points[i] && tripOut.points[i].hookLoad > maxHL) {
      zones.push({
        topMD: pt.md, bottomMD: pt.md + span,
        reason: 'hook_load', severity: 'critical',
        metric: `HL подъём ${tripOut.points[i].hookLoad.toFixed(0)} > ${maxHL} кН`,
        recommendation: `Нагрузка при подъёме превышает грузоподъёмность буровой.`,
      });
    }

    // 4. DLS
    if (next) {
      const dls = (() => {
        const i1 = (pt.zenith * Math.PI) / 180, i2 = (next.zenith * Math.PI) / 180;
        const a1 = (pt.azimuth * Math.PI) / 180, a2 = (next.azimuth * Math.PI) / 180;
        const cosD = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
        const dl = Math.acos(Math.min(1, Math.max(-1, cosD)));
        return span > 0 ? (dl * 180 / Math.PI) * (30 / span) : 0;
      })();
      if (dls > DLS_LIMIT_DEG_30M) {
        zones.push({
          topMD: pt.md, bottomMD: next.md,
          reason: 'dls', severity: 'warning',
          metric: `DLS ${dls.toFixed(1)}°/30м`,
          recommendation: `Высокая интенсивность искривления (${dls.toFixed(1)}°/30м > ${DLS_LIMIT_DEG_30M}°). Жёсткая колонна может застрять — рассмотрите гибкие соединения или промежуточную проработку.`,
        });
      }
    }

    // 5. Von Mises > yield
    if (pt.vonMises && pt.vonMises > yieldStr) {
      zones.push({
        topMD: pt.md, bottomMD: pt.md + span,
        reason: 'yield', severity: 'critical',
        metric: `σ ${pt.vonMises.toFixed(0)} > ${yieldStr} МПа`,
        recommendation: `Напряжение Von Mises (${pt.vonMises.toFixed(0)} МПа) превышает предел текучести материала (${yieldStr} МПа). Риск пластической деформации.`,
      });
    }
  }

  // 6. Surge/Swab zones
  if (surgeSwab) {
    for (const sp of surgeSwab.points) {
      if (!sp.isSafeSurge) {
        zones.push({
          topMD: sp.md, bottomMD: sp.md + 25,
          reason: 'surge_frac', severity: 'critical',
          metric: `BHP+surge ${sp.totalBHPsurgeMPa.toFixed(1)} > P_ГРП ${sp.fracPressureMPa.toFixed(1)} МПа`,
          recommendation: `Гидродинамическое давление при спуске превышает ГРП — снизьте скорость СПО или промежуточно промойте.`,
        });
      }
      if (!sp.isSafeSwab) {
        zones.push({
          topMD: sp.md, bottomMD: sp.md + 25,
          reason: 'swab_kick', severity: 'warning',
          metric: `BHP−swab ${sp.totalBHPswabMPa.toFixed(1)} < P_пласт ${sp.porePressureMPa.toFixed(1)} МПа`,
          recommendation: `Свабирование снижает забойное ниже пластового — риск притока (kick). Снизьте скорость подъёма.`,
        });
      }
    }
  }

  // Compact: merge adjacent zones with same reason+severity
  const merged: StuckZone[] = [];
  for (const z of zones) {
    const last = merged[merged.length - 1];
    if (last && last.reason === z.reason && last.severity === z.severity && Math.abs(z.topMD - last.bottomMD) <= 30) {
      last.bottomMD = Math.max(last.bottomMD, z.bottomMD);
      last.metric = z.metric;
    } else {
      merged.push({ ...z });
    }
  }
  return merged;
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
