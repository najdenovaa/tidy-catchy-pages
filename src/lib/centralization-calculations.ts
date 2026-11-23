import { calculateTurbulatorFlow, swirlRatioAt, type TurbulatorFluid, type TurbulatorDesign } from './turbulator-flow';
import {mechanicalSurvey,surveyCurvature,freeAxialWeight,normalLineLoad} from './casing-survey-mechanics';
import { buildMixedSupportProfile } from './centralizer-mixed-response';
import { createAnnularGeometry, boreDiameterAtDepth } from "./well-geometry";
import { centralizerDeflection, centralizerModelNotes } from "./centralizer-response";
// Centralization / eccentricity calculation engine
import type { WellData, TrajectoryPoint } from "./cementing-calculations";
import { getCasingID } from "./cementing-calculations";

// ─── Types ───────────────────────────────────────────────────────
export type CentralizerType = "rigid" | "spring" | "solid";

export interface CentralizerSpec {
  libraryReference?: import("./equipment-library-reference").EquipmentLibraryReference;
  passport?: import("./centralizer-passports").CentralizerPassport;
  type: CentralizerType;
  bladesCount: number;     // количество планок
  bladeHeight: number;     // высота (вылет) планки, мм
  restoringForce: number;  // восстанавливающая сила, кН
  maxAxialLoad: number;    // макс. осевая нагрузка, кН
}

export interface CentralizerInterval {
  id: string;
  fromMD: number;           // начало интервала, м
  toMD: number;             // конец интервала, м
  centralizersPerJoint: number; // кол-во центраторов на трубу
  jointLength: number;      // длина трубы, м (обычно 10-12 м)
  spec: CentralizerSpec;
  pattern?: import('./centralizer-layout').CentralizerPattern;
  specB?: CentralizerSpec;
}

export interface TurbulatorInterval {
  id: string;
  fromMD: number;
  toMD: number;
  turbulizersPerJoint: number;
  jointLength: number;
  bladesCount: number;      // кол-во лопастей
  bladeAngle: number;       // угол лопастей, ° (обычно 30-60)
  bladeHeight: number;      // высота лопасти, мм
  turbulenceMultiplier: number; // множитель турбулизации (1.5–3.0)
}

/** Single turbulizer point placed manually at exact MD */
export interface TurbulatorPoint {
  catalog?:import('./optimizer-hardware').HardwareIdentity;
  lengthMm?: number;
  bladeWidthMm?: number;
  sleeveThicknessMm?: number;
  id: string;
  md: number;              // глубина установки, м
  bladesCount: number;
  bladeAngle: number;      // угол лопастей, °
  bladeHeight: number;     // высота лопасти, мм
}

/** Auto-placement result for turbulizers */
export interface AutoTurbulatorResult {
  fromMD: number;
  toMD: number;
  count: number;
  spacingM: number;
  avgReOriginal: number;
  avgReWithTurb: number;
  turbMultiplier: number;
  flowRegime: string;
}

/**
 * Calculate turbulence multiplier from blade geometry and annular gap.
 * Physics: constriction increases velocity, blade angle adds swirl (tangential component).
 * Effective Re_turb = Re_base * multiplier
 */
export function calcTurbulenceMultiplier(
  bladesCount: number,
  bladeAngle_deg: number,
  bladeHeight_mm: number,
  annularGap_mm: number,
): number {
  if (annularGap_mm <= 0) return 1;
  // Blockage ratio: fraction of annular gap blocked by blades
  const blockagePerBlade = Math.min(bladeHeight_mm / annularGap_mm, 0.9);
  // Total circumferential blockage (blades cover part of circumference)
  // Each blade subtends ~15° of arc; total blocked fraction
  const circumBlockage = Math.min(bladesCount * 0.08, 0.7); // empirical: 4 blades ≈ 32%
  // Effective flow area reduction → velocity increase
  const areaRatio = Math.max(0.1, 1 - blockagePerBlade * circumBlockage);
  const velocityRatio = 1 / areaRatio;
  // Swirl factor: blade deflects flow at angle → adds tangential velocity
  const angleRad = Math.min(bladeAngle_deg, 75) * Math.PI / 180;
  const swirlFactor = 1 + Math.sin(angleRad) * 0.5; // tangential component
  // Combined: velocity increase * swirl → effective Re multiplier
  const multiplier = velocityRatio * swirlFactor;
  return Math.round(multiplier * 100) / 100;
}

/** Auto-place turbulizers where flow is laminar to achieve turbulence */
export function autoPlaceTurbulators(
  wellData: WellData,
  mudDensity: number,
  fluidPV: number,
  fluidYP: number,
  flowRateLps: number,
  bladesCount: number = 4,
  bladeAngle: number = 45,
  bladeHeight: number = 15,
  spacingM: number = 6,
): { points: TurbulatorPoint[]; summary: AutoTurbulatorResult[] } {
  if(!(spacingM>0&&flowRateLps>=0))return {points:[],summary:[]};
  const points:TurbulatorPoint[]=[],reValues:number[]=[];
  const settings={points:[],fluidId:'mud',rateLps:flowRateLps,threshold:.01,turningEfficiency:.5};
  const fluid={id:'mud',name:'Буровой раствор',density:mudDensity,rheology:{pv:fluidPV,yp:fluidYP}};
  for(let md=spacingM/2;md<=wellData.casingDepthMD&&points.length<2000;md+=spacingM){
    const p={id:'auto-turb-'+md,md,bladesCount,bladeAngle,bladeHeight};
    const r=calculateTurbulatorFlow(wellData,p,flowRateLps,fluid,settings);
    if(r.valid&&r.regime<1&&r.ratio>settings.threshold){points.push(p);reValues.push(r.reynolds);}
  }
  const re=reValues.length?reValues.reduce((a,b)=>a+b,0)/reValues.length:0;
  return {points,summary:points.length?[{fromMD:points[0].md,toMD:points.at(-1)!.md,count:points.length,spacingM,avgReOriginal:re,avgReWithTurb:re,turbMultiplier:1,flowRegime:'Закрутка оценена отдельно от режима течения'}]:[]};
}

export interface CentralizationResult {
  md: number;
  tvd: number;
  zenith: number;
  centralizerRole?: 'A'|'B';
  centralizerMD?: number;
  calculationAssumptions?: string[];
  supportEccentricity?: number;
  lateralLoadKN?: number;
  spanSagMM?: number;
  supportSpanM?: number;
  supportOverloaded?: boolean;
  eccentricity: number;        // 0..1 (0 = идеально, 1 = касание стенки)
  standoff: number;            // % (100 = идеально, 0 = касается)
  hasCentralizer: boolean;
  hasTurbulizer: boolean;
  turbulenceMultiplier: number;
  swirlRatio?: number;
  intervalId: string | null;
}

// ─── Physics helpers ─────────────────────────────────────────────

const STEEL_E = 210e9; // Модуль Юнга стали, Па
const STEEL_DENSITY = 7850; // кг/м³

/** Moment of inertia for hollow cylinder, m⁴ */
function casingMomentOfInertia(casingOD_mm: number, casingWall_mm: number): number {
  const od = casingOD_mm / 1000;
  const id = (casingOD_mm - 2 * casingWall_mm) / 1000;
  return (Math.PI / 64) * (Math.pow(od, 4) - Math.pow(id, 4));
}

/** Weight per meter of casing in air, N/m */
function casingWeightPerMeter(casingOD_mm: number, casingWall_mm: number): number {
  const od = casingOD_mm / 1000;
  const id = (casingOD_mm - 2 * casingWall_mm) / 1000;
  const area = Math.PI / 4 * (od * od - id * id);
  return area * STEEL_DENSITY * 9.80665; // N/m
}

/** Buoyant weight factor (simplified, mud density in kg/m³) */
function buoyancyFactor(mudDensity: number): number {
  return 1 - mudDensity / STEEL_DENSITY;
}

/** Radial clearance in mm */
function radialClearance(holeDia_mm: number, casingOD_mm: number): number {
  return (holeDia_mm - casingOD_mm) / 2;
}

/** Lateral force per meter due to gravity and inclination, N/m */
function lateralForcePerMeter(
  weightPerMeter_N: number,
  buoyancy: number,
  zenithDeg: number
): number {
  return weightPerMeter_N * buoyancy * Math.sin(zenithDeg * Math.PI / 180);
}

/** Shared survey interpolation: terminal angles continue below the last station. */
export function interpolateTrajectory(trajectory:TrajectoryPoint[],md:number):{tvd:number;zenith:number}{return mechanicalSurvey(trajectory,md);}

// ─── Main calculation ────────────────────────────────────────────

/** Per-design immutable survey cache, shared only while evaluating one well and mud density. */
export interface CentralizationContext {
  well:WellData; mudDensity:number; geometry:ReturnType<typeof createAnnularGeometry>;
  tension:Map<number,number>; curvature:Map<number,ReturnType<typeof surveyCurvature>>;
}
export function createCentralizationContext(well:WellData,mudDensity:number):CentralizationContext {
  return {well,mudDensity,geometry:createAnnularGeometry(well,well.casingDepthMD),tension:new Map(),curvature:new Map()};
}
export function calculateCentralization(
  wellData: WellData,
  intervals: CentralizerInterval[],
  mudDensity: number,
  turbulators?: TurbulatorInterval[],
  turbulatorPoints?: TurbulatorPoint[],
  /** Считать только точки в диапазоне MD (для проверки отдельных участков) */
  range?: { fromMD: number; toMD: number },
  flow?: { fluid: TurbulatorFluid; rateLps: number; settings: TurbulatorDesign },
  prepared?:CentralizationContext,
): CentralizationResult[] {
  const results: CentralizationResult[] = [];
  const step = 5;
  const wpm = casingWeightPerMeter(wellData.casingOD, wellData.casingWall);
  const bf = buoyancyFactor(mudDensity);
  const context=prepared?.well===wellData&&prepared.mudDensity===mudDensity?prepared:undefined;
  const geometry=context?.geometry??createAnnularGeometry(wellData,wellData.casingDepthMD);
  const tensionAt=(md:number)=>{let value=context?.tension.get(md);if(value===undefined){value=freeAxialWeight(wellData.trajectory,md,wellData.casingDepthMD,wpm*bf);context?.tension.set(md,value);}return value;};
  const curvatureAt=(md:number)=>{let value=context?.curvature.get(md);if(value===undefined){value=surveyCurvature(wellData.trajectory,md,wellData.casingDepthMD);context?.curvature.set(md,value);}return value;};
  const EI = STEEL_E * casingMomentOfInertia(wellData.casingOD, wellData.casingWall);

  // Pre-sort turbulator points for fast lookup
  const turbPoints = turbulatorPoints?.slice().sort((a, b) => a.md - b.md) ?? [];
  const swirl=flow?turbPoints.map(p=>calculateTurbulatorFlow(wellData,p,flow.rateLps,flow.fluid,flow.settings)):[];

  const prevCasingDepth = wellData.prevCasingDepth || 0;
  const prevCasingID = wellData.prevCasingID || wellData.holeDiameter;

  const mdStart = range ? Math.max(0, Math.ceil(range.fromMD / step) * step) : 0;
  const mdEnd = range ? Math.min(wellData.casingDepthMD, range.toMD) : wellData.casingDepthMD;
  const mixed = intervals.some(x=>x.pattern) ? buildMixedSupportProfile(wellData.casingDepthMD, intervals, wellData.casingOD, EI,
    md => boreDiameterAtDepth(wellData,md), md => {
      const {zenith}=interpolateTrajectory(wellData.trajectory,md);
      const tension=tensionAt(md);
      return normalLineLoad(wpm*bf,zenith,tension,curvatureAt(md));
    }) : null;
  const depths=new Set<number>();
  for(let md=mdStart;md<=mdEnd;md+=step)depths.add(md);
  if(mixed){
    for(const md of mixed.depths)if(md>=(range?.fromMD??0)&&md<=mdEnd)depths.add(md);
    if(range&&range.fromMD===range.toMD)depths.add(range.fromMD);
  }
  for (const md of [...depths].sort((a,b)=>a-b)) {
    const { tvd, zenith } = interpolateTrajectory(wellData.trajectory, md);

    const boreDia_mm = geometry.at(md)?.diameterMm ?? boreDiameterAtDepth(wellData,md);
    const rc_mm_local = (boreDia_mm - wellData.casingOD) / 2;
    const rc_m_local = rc_mm_local / 1000;
    const annularGap_mm = rc_mm_local;

    if (rc_mm_local <= 0) continue;

    const interval = intervals.find(iv => md >= iv.fromMD && md <= iv.toMD);

    // Check turbulizer — interval-based (legacy) or point-based
    // A point acts only above its MD. Swirl is distinct from Reynolds number.
    const ratio = Math.max(0,...swirl.map(r=>swirlRatioAt(r,md)));
    const hasTurbulizer = ratio > 0;
    const turbMult = 1; // No artificial Re or displacement-efficiency boost.


    let spanLength: number;
    let hasCentralizer = false;
    let centralizerMaxForce_N = 0;

    if (interval && interval.centralizersPerJoint > 0 && interval.jointLength > 0) {
      spanLength = interval.jointLength / interval.centralizersPerJoint;
      centralizerMaxForce_N = interval.spec.restoringForce * 1000;
      hasCentralizer = true;
    } else {
      spanLength = 12;
    }

    // Frictionless axial reference and signed 3D curvature; not a hard-string contact solve.
    const tensionN=tensionAt(md);
    const lateralF=normalLineLoad(wpm*bf,zenith,tensionN,curvatureAt(md));

    let eccentricity: number;
    const support = hasCentralizer && interval?.spec.type === 'spring' && interval.spec.passport?.outerDiameter
      ? centralizerDeflection(interval.spec, wellData.casingOD, boreDia_mm, lateralF, spanLength, EI) : null;

    if (support && zenith >= 0.5) {
      eccentricity = Math.min(1, (support.supportMM + support.sagMM) / rc_mm_local);
    } else if (zenith < 0.5) {
      // Вертикальный участок: основной источник эксцентриситета — допуски трубы (~0.5% овальности).
      const toleranceEcc = rc_mm_local > 0 ? (wellData.casingOD * 0.005) / rc_mm_local : 0.05;
      eccentricity = hasCentralizer
        ? Math.max(0.01, toleranceEcc * 0.5)
        : Math.max(0.05, toleranceEcc);
    } else if (hasCentralizer && EI > 0) {
      const L = spanLength;
      const sag_free_m = (5 * lateralF * Math.pow(L, 4)) / (384 * EI);
      const referenceCompression = interval?.spec.passport?.restoringStandoff;
      const testFraction = referenceCompression ? Math.max(0.01, 1 - referenceCompression / 100) : 1;
      const k_spring = centralizerMaxForce_N / (rc_m_local * testFraction);
      const springFactor = (k_spring * Math.pow(L, 3)) / (48 * EI);
      const sag_with_spring_m = sag_free_m / (1 + springFactor);
      eccentricity = Math.min(1, Math.max(0, sag_with_spring_m / rc_m_local));
      eccentricity = Math.max(eccentricity, 0.03);
    } else {
      if (EI > 0) {
        const L = spanLength;
        const sag_free_m = (5 * lateralF * Math.pow(L, 4)) / (384 * EI);
        eccentricity = Math.min(1, sag_free_m / rc_m_local);
        const inclinationFactor = Math.sin(zenith * Math.PI / 180);
        eccentricity = Math.max(eccentricity, 0.5 * inclinationFactor + 0.2 * inclinationFactor * inclinationFactor);
      } else {
        eccentricity = 1;
      }
    }

    if (hasCentralizer && interval?.spec.passport?.outerDiameter) {
      const od = interval.spec.passport.outerDiameter;
      const geometricStandoff = Math.max(0, Math.min(1, (od - wellData.casingOD) / (boreDia_mm - wellData.casingOD)));
      eccentricity = Math.max(eccentricity, 1 - geometricStandoff);
    }
    const actual=mixed?.at(md);
    if(mixed&&!actual)continue;
    if(actual) { eccentricity=actual.eccentricity; hasCentralizer=!!actual.placement; spanLength=actual.spanM; }
    const standoff = (1 - eccentricity) * 100;

    results.push({
      md,
      tvd,
      zenith,
      eccentricity: Math.round(eccentricity * 1000) / 1000,
      standoff: Math.round(standoff * 10) / 10,
      centralizerRole: actual?.placement?.role,
      centralizerMD: actual?.placement?.md,
      calculationAssumptions: [...(actual?.notes ?? (support && interval ? centralizerModelNotes(interval.spec) : [])), 'Боковая нагрузка: знаковая 3D-кривизна, усреднение по окну 30 м; натяжение от интеграла осевого веса без трения. Направление прогиба и пространственный контакт не решены.'],
      supportEccentricity: actual ? actual.supportEccentricity : support ? support.supportMM / rc_mm_local : undefined,
      lateralLoadKN: actual?.loadKN ?? support?.loadKN,
      spanSagMM: actual?.sagMM ?? support?.sagMM,
      supportSpanM: hasCentralizer ? spanLength : undefined,
      supportOverloaded: actual?.exceeded ?? support?.exceeded,
      hasCentralizer,
      hasTurbulizer,
      swirlRatio: ratio,
      turbulenceMultiplier: turbMult,
      intervalId: actual?.placement?.intervalId ?? interval?.id ?? null,
    });
  }

  return results;
}

// ─── Auto-placement: solve for centralizersPerJoint given target standoff ───

export type PlacementZone =
  | "wellhead"   // приустьевая (всегда крепим)
  | "pump"       // зона ГНО (всегда крепим)
  | "vertical"   // прямой вертикальный участок (только "для вида")
  | "build"      // набор кривизны / высокий DLS
  | "tangent"    // стабильный наклонный участок
  | "horizontal";// горизонтальный участок (>70°)

export const placementZoneLabels: Record<PlacementZone, string> = {
  wellhead: "Устьевая зона",
  pump: "Зона ГНО",
  vertical: "Вертикаль (стабиль.)",
  build: "Набор / угол (DLS)",
  tangent: "Тангенциальный (стабиль.)",
  horizontal: "Горизонталь",
};

export interface AutoPlacementInterval {
  fromMD: number;
  toMD: number;
  avgZenith: number;
  maxDLS: number;             // максимальный DLS в интервале, °/30м
  zone: PlacementZone;
  centralizersPerJoint: number;
  standoffAchieved: number;
  totalCentralizers: number;
}

export interface AutoPlacementOptions {
  context?:CentralizationContext;
  pumpZoneTop?: number;       // верх зоны ГНО, MD
  pumpZoneBottom?: number;    // низ зоны ГНО, MD
  wellheadDepth?: number;     // глубина устьевой зоны (по умолч. 50 м)
  dlsThresholdDegPer30m?: number; // порог "набора" (по умолч. 1.5°/30м)
  verticalSparseJoints?: number;  // 1 центратор на N трубок в вертикали (по умолч. 15)
}

/**
 * Профильно-ориентированная авто-расстановка центраторов.
 *
 * Алгоритм:
 *   1. Скан трактории по сегментам (длина = jointLength).
 *   2. Для каждого сегмента считаем avgZenith, maxZenith, локальный 3D-DLS
 *      и классифицируем зону: устье / ГНО / набор (DLS > порога) / тангенс
 *      / горизонталь / вертикаль.
 *   3. Для каждой зоны решаем CPJ:
 *        - vertical (низкий зенит + низкий DLS): редкая расстановка
 *          (~1 центратор на verticalSparseJoints трубок) — «для вида».
 *        - wellhead / pump: бин-поиск, но НЕ ниже 1 центратора/трубу.
 *        - build (высокий DLS): бин-поиск + минимум 1, +20% запас.
 *        - tangent / horizontal: обычный бин-поиск по целевому Standoff.
 *   4. Сливаем соседние сегменты с одинаковыми CPJ и зоной.
 */
export function autoPlaceCentralizers(
  wellData: WellData,
  spec: CentralizerSpec,
  jointLength: number,
  targetStandoff: number,
  mudDensity: number,
  options: AutoPlacementOptions = {},
): AutoPlacementInterval[] {
  const wpm = casingWeightPerMeter(wellData.casingOD, wellData.casingWall);
  const bf = buoyancyFactor(mudDensity);
  const EI = STEEL_E * casingMomentOfInertia(wellData.casingOD, wellData.casingWall);

  if (EI <= 0) return [];

  const MAX_CPJ = 8.0;

  const wellheadDepth = options.wellheadDepth ?? 50;
  const pumpTop = options.pumpZoneTop ?? 0;
  const pumpBot = options.pumpZoneBottom ?? 0;
  const pumpZoneActive = pumpBot > pumpTop && pumpBot > 0;
  const dlsThresh = options.dlsThresholdDegPer30m ?? 1.5;
  const sparseN = Math.max(2, Math.round(options.verticalSparseJoints ?? 15));
  const sparseCPJ = Math.round((1 / sparseN) * 100) / 100;

  const segmentSize = Math.max(jointLength, 10);

  // Same shortest-arc survey as the mechanical load path, including north crossing.
  function localDLS(md1:number,md2:number):number {
    return surveyCurvature(wellData.trajectory,(md1+md2)/2,wellData.casingDepthMD,md2-md1).dlsDegPer30m;
  }

  interface RawSeg {
    fromMD: number; toMD: number;
    maxZenith: number; avgZenith: number;
    dls: number;
  }
  const rawSegments: RawSeg[] = [];
  for (let md = 0; md < wellData.casingDepthMD; md += segmentSize) {
    const endMD = Math.min(md + segmentSize, wellData.casingDepthMD);
    let maxZ = 0, sumZ = 0, cnt = 0;
    for (let m = md; m <= endMD; m += 2) {
      const { zenith } = interpolateTrajectory(wellData.trajectory, m);
      maxZ = Math.max(maxZ, zenith);
      sumZ += zenith;
      cnt++;
    }
    const dls = localDLS(md, endMD);
    rawSegments.push({ fromMD: md, toMD: endMD, maxZenith: maxZ, avgZenith: sumZ / Math.max(1, cnt), dls });
  }

  function classify(seg: RawSeg): PlacementZone {
    const mid = (seg.fromMD + seg.toMD) / 2;
    if (mid <= wellheadDepth) return "wellhead";
    if (pumpZoneActive && mid >= pumpTop && mid <= pumpBot) return "pump";
    if (seg.maxZenith >= 70) return "horizontal";
    if (seg.dls >= dlsThresh) return "build";
    if (seg.maxZenith >= 3) return "tangent";
    return "vertical";
  }

  // Optimise against the same model as the final profile, including curvature, contact and span sag.
  const verifiedStandoff = (seg: RawSeg, cpj: number): number => {
    const prof = calculateCentralization(
      wellData,
      [{ id: "verify", fromMD: seg.fromMD, toMD: seg.toMD, centralizersPerJoint: cpj, jointLength, spec }],
      mudDensity, undefined, undefined, { fromMD: seg.fromMD, toMD: seg.toMD }, undefined, options.context,
    );
    return prof.length ? Math.min(...prof.map((r) => r.standoff)) : 100;
  };

  const computed = rawSegments.map(seg => {
    const zone = classify(seg);
    const floor = zone === 'wellhead' || zone === 'build' || zone === 'pump' ? 1 : sparseCPJ;
    const boost = zone === 'build' ? 1.2 : zone === 'pump' ? 1.15 : 1;
    const required = 100 - (100 - targetStandoff) / boost;
    let lo = floor, hi = MAX_CPJ;
    if (verifiedStandoff(seg, floor) >= required) hi = floor;
    else if (verifiedStandoff(seg, hi) >= required) {
      for (let i=0;i<14;i++) {
        const mid=(lo+hi)/2;
        if (verifiedStandoff(seg,mid)>=required) hi=mid; else lo=mid;
      }
    }
    const cpj = Math.min(MAX_CPJ, Math.ceil(hi*100)/100);
    return { ...seg, zone, cpj, standoff: verifiedStandoff(seg,cpj) };
  });

  const merged: AutoPlacementInterval[] = [];
  for (const seg of computed) {
    const last = merged[merged.length - 1];
    if (last && last.zone === seg.zone && last.centralizersPerJoint === seg.cpj) {
      const oldLen = last.toMD - last.fromMD;
      const newLen = seg.toMD - seg.fromMD;
      last.toMD = seg.toMD;
      last.avgZenith = Math.round(((last.avgZenith * oldLen + seg.avgZenith * newLen) / (oldLen + newLen)) * 10) / 10;
      last.maxDLS = Math.max(last.maxDLS, Math.round(seg.dls * 10) / 10);
      last.standoffAchieved = Math.min(last.standoffAchieved, seg.standoff);
      last.totalCentralizers = Math.ceil((last.toMD - last.fromMD) / jointLength * last.centralizersPerJoint);
      continue;
    }
    const intervalLength = seg.toMD - seg.fromMD;
    merged.push({
      fromMD: seg.fromMD,
      toMD: seg.toMD,
      avgZenith: Math.round(seg.avgZenith * 10) / 10,
      maxDLS: Math.round(seg.dls * 10) / 10,
      zone: seg.zone,
      centralizersPerJoint: seg.cpj,
      standoffAchieved: seg.standoff,
      totalCentralizers: Math.ceil(intervalLength / jointLength * seg.cpj),
    });
  }

  return merged;
}

// ─── Presets ─────────────────────────────────────────────────────

export const centralizerPresets: Record<CentralizerType, Partial<CentralizerSpec>> = {
  rigid: { bladesCount: 6, bladeHeight: 25, restoringForce: 15, maxAxialLoad: 300 },
  spring: { bladesCount: 4, bladeHeight: 20, restoringForce: 5, maxAxialLoad: 150 },
  solid: { bladesCount: 0, bladeHeight: 30, restoringForce: 20, maxAxialLoad: 500 },
};

export const centralizerTypeLabels: Record<CentralizerType, string> = {
  rigid: "Жёсткий",
  spring: "Пружинный",
  solid: "Сплошной",
};
