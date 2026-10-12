/**
 * КРС — операционные расчёты:
 *   • промывка песчаных пробок (скорость осаждения, вынос, расход, время)
 *   • прочность обсадной колонны: разрыв и смятие по API 5C3, опрессовка, снижение уровня
 *   • освоение снижением уровня / свабированием
 *   • блокирующая пачка (объём, продавка)
 *   • подбор ловильного инструмента (ориентировочно) и отворот (закрутка колонны)
 *   • рецептура рассолов по справочным таблицам + температура кристаллизации
 */
import {
  annulusFrictionMPa, tubingFrictionMPa, tvdAtMD, calculateDrag,
  type WorkoverWellData, type KillSalt,
} from "./workover-calculations";

const G = 9.81;
const SAND_DENSITY = 2650; // кг/м³ (кварц)
const SHEAR_MODULUS_GPa = 80.8; // сталь, E/(2(1+ν))

const area = (d_mm: number) => (Math.PI / 4) * (d_mm / 1000) ** 2;

// ═══════════════════════════════════════════════════════════════════
// 1. Промывка песчаной пробки
// ═══════════════════════════════════════════════════════════════════

export type WashMethod = "direct" | "reverse";

export interface CleanoutInput {
  plugTopMD: number;
  plugBottomMD: number;
  method: WashMethod;
  rateLs: number;
  /** Диаметр зёрен песка, мм */
  grainDiameter_mm: number;
  /** Скорость подачи (размыва) пробки, м/ч */
  feedRate_mh: number;
  /** Пористость пробки, доля */
  plugPorosity: number;
}

export interface CleanoutResult {
  settlingVelocityMs: number;
  settlingRegime: "Стокс" | "переходный" | "Ньютон";
  upflowVelocityMs: number;
  upflowArea: "затрубье" | "НКТ";
  transportRatio: number;
  minRateLs: number;
  liftTimeMin: number;
  sandMassKg: number;
  sandVolumeM3: number;
  /** Объёмная концентрация песка в восходящем потоке при заданной подаче, % */
  sandConcentrationPct: number;
  washTimeH: number;
  pumpPressureMPa: number;
  /** Дополнительное давление на забой от трения в восходящем канале, МПа */
  bottomholeExtraMPa: number;
  avgZenithDeg: number;
  ok: boolean;
  warnings: string[];
}

/** Скорость осаждения частицы: Стокс → переходный (Аллен) → Ньютон, по числу Рейнольдса частицы. */
export function settlingVelocity(d_mm: number, rhoFluid_gcm3: number, mu_cP: number, rhoSolid = SAND_DENSITY) {
  const d = d_mm / 1000, rf = rhoFluid_gcm3 * 1000, mu = Math.max(1e-4, mu_cP / 1000);
  const dr = Math.max(0, rhoSolid - rf);
  const stokes = (G * d * d * dr) / (18 * mu);
  const re = (v: number) => (rf * v * d) / mu;
  if (re(stokes) <= 1) return { v: stokes, regime: "Стокс" as const };
  const allen = (0.153 * Math.pow(G, 0.71) * Math.pow(d, 1.14) * Math.pow(dr, 0.71)) / (Math.pow(rf, 0.29) * Math.pow(mu, 0.43));
  if (re(allen) <= 500) return { v: allen, regime: "переходный" as const };
  return { v: 1.74 * Math.sqrt((G * d * dr) / rf), regime: "Ньютон" as const };
}

export function calculateCleanout(input: CleanoutInput, well: WorkoverWellData): CleanoutResult {
  const top = Math.max(1, Math.min(input.plugTopMD, well.wellDepthMD));
  const bottom = Math.max(top, Math.min(input.plugBottomMD, well.wellDepthMD));
  const st = settlingVelocity(input.grainDiameter_mm, well.fluidDensity_gcm3, well.fluidPV_cP);

  const annA = area(well.casingID_mm) - area(well.pipeOD_mm);
  const tubA = area(well.pipeID_mm);
  const upA = input.method === "direct" ? annA : tubA;
  const Q = input.rateLs / 1000;
  const vUp = Q / Math.max(1e-6, upA);
  const transport = vUp > 0 ? (vUp - st.v) / vUp : 0;
  const minRate = 2 * st.v * upA * 1000; // правило: восходящая скорость ≥ 2× скорости осаждения
  const netV = vUp - st.v;
  const liftTime = netV > 0 ? top / netV / 60 : Infinity;

  const casingA = area(well.casingID_mm);
  const plugLen = bottom - top;
  const sandVol = casingA * plugLen * (1 - input.plugPorosity);
  const sandMass = sandVol * SAND_DENSITY;
  const sandRate = (casingA * (input.feedRate_mh / 3600)) * (1 - input.plugPorosity); // м³/с твёрдого
  const conc = Q > 0 ? (sandRate / (Q + sandRate)) * 100 : 0;
  const washTime = input.feedRate_mh > 0 ? plugLen / input.feedRate_mh : 0;

  // Трение: прямая промывка — вниз по НКТ, вверх по затрубью; обратная — наоборот. Длина — до кровли пробки.
  const rho = well.fluidDensity_gcm3;
  const tub = tubingFrictionMPa(top, well.pipeID_mm, rho, well.fluidPV_cP, well.fluidYP_Pa, input.rateLs);
  const ann = annulusFrictionMPa(top, well.casingID_mm, well.pipeOD_mm, rho, well.fluidPV_cP, well.fluidYP_Pa, input.rateLs);
  const pump = tub.lossMPa + ann.lossMPa;
  const bhExtra = input.method === "direct" ? ann.lossMPa : tub.lossMPa;

  // средний зенит в интервале подъёма
  let zsum = 0, n = 0;
  for (let md = 0; md <= top; md += 25) {
    const traj = well.trajectory;
    let z = traj.length ? traj[traj.length - 1].zenith : 0;
    for (let i = 1; i < traj.length; i++) if (md <= traj[i].md) {
      const a = traj[i - 1], b = traj[i];
      z = a.zenith + ((md - a.md) / Math.max(1e-6, b.md - a.md)) * (b.zenith - a.zenith);
      break;
    }
    zsum += z; n++;
  }
  const avgZen = n ? zsum / n : 0;

  const warnings: string[] = [];
  if (vUp < 2 * st.v)
    warnings.push(`🔴 Восходящая скорость ${vUp.toFixed(2)} м/с < 2× скорости осаждения (${(2 * st.v).toFixed(2)} м/с). Песок не выносится — увеличить расход до ≥ ${minRate.toFixed(1)} л/с${input.method === "direct" ? " или перейти на обратную промывку" : ""}.`);
  if (conc > 5)
    warnings.push(`⚠ Концентрация песка ${conc.toFixed(1)}% об. > 5% — риск прихвата песком при остановке. Снизить скорость подачи или увеличить расход.`);
  if (avgZen > 35)
    warnings.push(`⚠ Средний зенит ${avgZen.toFixed(0)}° — в наклонном стволе песок образует дюну на нижней стенке. Нужен запас по скорости, расхаживание и вязкие пачки.`);
  if (input.method === "reverse")
    warnings.push("Обратная промывка: высокая скорость в НКТ хорошо выносит песок, но давление на забой выше (трение в НКТ) — контролировать поглощение.");

  return {
    settlingVelocityMs: st.v,
    settlingRegime: st.regime,
    upflowVelocityMs: vUp,
    upflowArea: input.method === "direct" ? "затрубье" : "НКТ",
    transportRatio: transport,
    minRateLs: minRate,
    liftTimeMin: liftTime,
    sandMassKg: sandMass,
    sandVolumeM3: sandVol,
    sandConcentrationPct: conc,
    washTimeH: washTime,
    pumpPressureMPa: pump,
    bottomholeExtraMPa: bhExtra,
    avgZenithDeg: avgZen,
    ok: !warnings.some((w) => w.startsWith("🔴")),
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 2. Прочность колонны по API 5C3 (TR 5C3)
// ═══════════════════════════════════════════════════════════════════

const PSI_PER_MPA = 145.0377;

/** Внутреннее давление текучести (разрыв), МПа: P = 0.875·2·Yp·t/D (допуск по стенке −12.5%). */
export function apiBurstMPa(od_mm: number, wall_mm: number, yieldMPa: number): number {
  return (0.875 * 2 * yieldMPa * wall_mm) / od_mm;
}

export type CollapseRegime = "текучесть" | "пластический" | "переходный" | "упругий";

/** Сминающее давление по API 5C3 (четыре режима по D/t), МПа. */
export function apiCollapse(od_mm: number, wall_mm: number, yieldMPa: number): { mpa: number; regime: CollapseRegime; dt: number } {
  const Yp = yieldMPa * PSI_PER_MPA;
  const dt = od_mm / wall_mm;
  const A = 2.8762 + 0.10679e-5 * Yp + 0.21301e-10 * Yp ** 2 - 0.53132e-16 * Yp ** 3;
  const B = 0.026233 + 0.50609e-6 * Yp;
  const C = -465.93 + 0.030867 * Yp - 0.10483e-7 * Yp ** 2 + 0.36989e-13 * Yp ** 3;
  const ba = B / A;
  const k = (3 * ba) / (2 + ba);
  const F = (46.95e6 * k ** 3) / (Yp * (k - ba) * (1 - k) ** 2);
  const Gc = (F * B) / A;

  const dtYP = (Math.sqrt((A - 2) ** 2 + 8 * (B + C / Yp)) + (A - 2)) / (2 * (B + C / Yp));
  const dtPT = (Yp * (A - F)) / (C + Yp * (B - Gc));
  const dtTE = (2 + ba) / (3 * ba);

  let psi: number;
  let regime: CollapseRegime;
  if (dt <= dtYP) { psi = 2 * Yp * ((dt - 1) / (dt * dt)); regime = "текучесть"; }
  else if (dt <= dtPT) { psi = Yp * (A / dt - B) - C; regime = "пластический"; }
  else if (dt <= dtTE) { psi = Yp * (F / dt - Gc); regime = "переходный"; }
  else { psi = 46.95e6 / (dt * (dt - 1) ** 2); regime = "упругий"; }
  return { mpa: psi / PSI_PER_MPA, regime, dt };
}

export interface CasingCheckInput {
  casingOD_mm: number;
  casingWall_mm: number;
  casingYieldMPa: number;
  /** Износ стенки, % */
  wearPct: number;
  /** Глубина проверяемого интервала (низ), MD — башмак, пакер или забой */
  bottomMD: number;
  /** Опрессовка: давление на устье, МПа */
  testPressureMPa: number;
  insideDensity: number;
  /** Плотность за колонной (опорное давление): пластовая вода/цемент/раствор */
  outsideDensity: number;
  /** Глубина снижения уровня в колонне (MD) */
  levelMD: number;
  sfBurst: number;
  sfCollapse: number;
}

export interface CasingProfilePoint {
  md: number;
  burstLoad: number;
  collapseLoad: number;
}

export interface CasingCheckResult {
  burstRatingMPa: number;
  collapseRatingMPa: number;
  collapseRegime: CollapseRegime;
  dt: number;
  maxBurstLoadMPa: number;
  maxBurstAtMD: number;
  maxCollapseLoadMPa: number;
  maxCollapseAtMD: number;
  burstAllowableMPa: number;
  collapseAllowableMPa: number;
  /** Максимально допустимое давление опрессовки на устье, МПа */
  maxTestPressureMPa: number;
  /** Максимально допустимая глубина снижения уровня (MD) */
  maxLevelMD: number;
  burstOk: boolean;
  collapseOk: boolean;
  profile: CasingProfilePoint[];
  warnings: string[];
}

export function checkCasing(input: CasingCheckInput, well: WorkoverWellData): CasingCheckResult {
  const t = input.casingWall_mm * (1 - Math.min(90, Math.max(0, input.wearPct)) / 100);
  const burst = apiBurstMPa(input.casingOD_mm, t, input.casingYieldMPa);
  const col = apiCollapse(input.casingOD_mm, t, input.casingYieldMPa);
  const bAllow = burst / Math.max(1, input.sfBurst);
  const cAllow = col.mpa / Math.max(1, input.sfCollapse);
  const bottom = Math.max(10, input.bottomMD);
  const levelTVD = tvdAtMD(Math.min(input.levelMD, bottom), well.trajectory);
  const hyd = (rho: number, tvd: number) => (rho * 1000 * G * tvd) / 1e6;

  const profile: CasingProfilePoint[] = [];
  let maxB = -Infinity, maxBmd = 0, maxC = -Infinity, maxCmd = 0;
  const step = Math.max(10, bottom / 100);
  for (let md = 0; md <= bottom + 1e-6; md += step) {
    const tvd = tvdAtMD(md, well.trajectory);
    const out = hyd(input.outsideDensity, tvd);
    const burstLoad = input.testPressureMPa + hyd(input.insideDensity, tvd) - out;
    const inside = md <= input.levelMD ? 0 : hyd(input.insideDensity, tvd - levelTVD);
    const collapseLoad = out - inside;
    profile.push({ md, burstLoad, collapseLoad });
    if (burstLoad > maxB) { maxB = burstLoad; maxBmd = md; }
    if (collapseLoad > maxC) { maxC = collapseLoad; maxCmd = md; }
  }

  // Допустимое давление опрессовки: минимум по глубине (bAllow − (ρin−ρout)·g·h)
  const bottomTVD = tvdAtMD(bottom, well.trajectory);
  const dRho = input.insideDensity - input.outsideDensity;
  const maxTest = Math.max(0, bAllow - Math.max(0, hyd(dRho, bottomTVD)));
  // Допустимое снижение уровня h: худшая нагрузка на смятие = max(Pза(h), Pза(низ) − ρвн·g·(Hниз − h))
  const worstCollapse = (levelMD: number) => {
    const ht = tvdAtMD(Math.min(levelMD, bottom), well.trajectory);
    return Math.max(hyd(input.outsideDensity, ht), hyd(input.outsideDensity, bottomTVD) - hyd(input.insideDensity, bottomTVD - ht));
  };
  let maxLevel = bottom;
  for (let md = 0; md <= bottom; md += 5) {
    if (worstCollapse(md) > cAllow) { maxLevel = Math.max(0, md - 5); break; }
  }

  const warnings: string[] = [];
  if (maxB > bAllow)
    warnings.push(`🔴 Опрессовка: нагрузка ${maxB.toFixed(1)} МПа на ${maxBmd.toFixed(0)} м > допустимой ${bAllow.toFixed(1)} МПа. Снизить давление до ${maxTest.toFixed(1)} МПа.`);
  if (maxC > cAllow)
    warnings.push(`🔴 Снижение уровня до ${input.levelMD.toFixed(0)} м: нагрузка на смятие ${maxC.toFixed(1)} МПа > допустимой ${cAllow.toFixed(1)} МПа. Не опускать уровень ниже ≈ ${maxLevel.toFixed(0)} м.`);
  if (input.wearPct > 0)
    warnings.push(`Учтён износ стенки ${input.wearPct}%: расчётная толщина ${t.toFixed(2)} мм.`);
  warnings.push("Нагрузки — для одноразмерной колонны без учёта цементного кольца и осевой нагрузки (двухосное напряжённое состояние не учтено).");

  return {
    burstRatingMPa: burst,
    collapseRatingMPa: col.mpa,
    collapseRegime: col.regime,
    dt: col.dt,
    maxBurstLoadMPa: maxB,
    maxBurstAtMD: maxBmd,
    maxCollapseLoadMPa: maxC,
    maxCollapseAtMD: maxCmd,
    burstAllowableMPa: bAllow,
    collapseAllowableMPa: cAllow,
    maxTestPressureMPa: maxTest,
    maxLevelMD: maxLevel,
    burstOk: maxB <= bAllow,
    collapseOk: maxC <= cAllow,
    profile,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. Освоение снижением уровня / свабированием
// ═══════════════════════════════════════════════════════════════════

export interface SwabInput {
  reservoirMD: number;
  reservoirPressureMPa: number;
  /** Требуемая депрессия на пласт, МПа */
  targetDrawdownMPa: number;
  /** Плотность жидкости в скважине при освоении */
  fluidDensity: number;
  /** Пакер: снижается только уровень в НКТ */
  packerInstalled: boolean;
  /** Погружение сваба под уровень, м */
  swabSubmergenceM: number;
  /** Коэффициент подачи сваба (утечки), доля */
  swabEfficiency: number;
  /** Скорость спуска-подъёма сваба, м/с */
  swabSpeedMs: number;
}

export interface SwabResult {
  staticLevelMD: number;
  staticLevelTVD: number;
  requiredLevelTVD: number;
  requiredLevelMD: number;
  feasible: boolean;
  volumeToRemoveM3: number;
  volumePerRunM3: number;
  runs: number;
  timeH: number;
  warnings: string[];
}

/** MD по TVD (обратная интерполяция). */
export function mdAtTVD(tvd: number, well: WorkoverWellData): number {
  let lo = 0, hi = well.wellDepthMD;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (tvdAtMD(mid, well.trajectory) < tvd) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

export function calculateSwab(input: SwabInput, well: WorkoverWellData): SwabResult {
  const resTVD = tvdAtMD(input.reservoirMD, well.trajectory);
  const grad = input.fluidDensity * 1000 * G / 1e6; // МПа/м
  // Статический уровень: столб жидкости уравновешивает Pпл
  const columnH = input.reservoirPressureMPa / Math.max(1e-6, grad);
  const staticTVD = Math.max(0, resTVD - columnH);
  const targetBHP = input.reservoirPressureMPa - input.targetDrawdownMPa;
  const reqTVD = resTVD - Math.max(0, targetBHP) / Math.max(1e-6, grad);
  const feasible = reqTVD < resTVD - 1 && input.targetDrawdownMPa < input.reservoirPressureMPa;
  const staticMD = mdAtTVD(staticTVD, well);
  const reqMD = mdAtTVD(Math.min(reqTVD, resTVD), well);

  const tubCap = area(well.pipeID_mm);
  const annCap = area(well.casingID_mm) - area(well.pipeOD_mm);
  const cap = tubCap + (input.packerInstalled ? 0 : annCap);
  const vol = Math.max(0, reqMD - staticMD) * cap;
  const perRun = tubCap * input.swabSubmergenceM * input.swabEfficiency;
  const runs = perRun > 0 ? Math.ceil(vol / perRun) : 0;
  // время: каждый рейс — спуск и подъём на текущую глубину уровня + погружение; берём среднюю глубину
  const avgDepth = (staticMD + reqMD) / 2 + input.swabSubmergenceM;
  const timeH = runs * ((2 * avgDepth) / Math.max(0.1, input.swabSpeedMs)) / 3600;

  const warnings: string[] = [];
  if (!feasible) warnings.push("🔴 Требуемая депрессия недостижима снижением уровня: уровень должен опуститься ниже пласта.");
  if (staticTVD <= 0) warnings.push("Пластовое давление выше гидростатики столба — скважина переливает; освоение не требует снижения уровня.");
  if (input.swabSubmergenceM > 300) warnings.push("⚠ Погружение сваба > 300 м — высокая нагрузка на канат и манжеты.");
  if (!input.packerInstalled) warnings.push("Без пакера уровень снижается и в НКТ, и в затрубье — объём откачки больше в несколько раз.");

  return {
    staticLevelMD: staticMD,
    staticLevelTVD: staticTVD,
    requiredLevelTVD: reqTVD,
    requiredLevelMD: reqMD,
    feasible,
    volumeToRemoveM3: vol,
    volumePerRunM3: perRun,
    runs,
    timeH,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 4. Блокирующая пачка
// ═══════════════════════════════════════════════════════════════════

export interface BlockingPillInput {
  perfTopMD: number;
  perfBottomMD: number;
  /** Пористость, % */
  porosityPct: number;
  /** Радиус проникновения в пласт, м */
  penetrationRadiusM: number;
  /** Перекрытие над кровлей перфорации, м */
  coverAboveM: number;
  /** Запас объёма, % */
  excessPct: number;
  /** Глубина башмака НКТ, MD */
  tubingShoeMD: number;
}

export interface BlockingPillResult {
  wellboreVolumeM3: number;
  formationVolumeM3: number;
  pillVolumeM3: number;
  displacementVolumeM3: number;
  pillTopMD: number;
  warnings: string[];
}

export function calculateBlockingPill(input: BlockingPillInput, well: WorkoverWellData): BlockingPillResult {
  const top = Math.min(input.perfTopMD, input.perfBottomMD);
  const bottom = Math.max(input.perfTopMD, input.perfBottomMD);
  const h = bottom - top;
  const pillTop = Math.max(0, top - input.coverAboveM);
  const casingA = area(well.casingID_mm);
  const rw = well.holeDiameter_mm / 2000;
  const rp = Math.max(rw, rw + input.penetrationRadiusM);
  const wellbore = casingA * (bottom - pillTop);
  const formation = Math.PI * (rp * rp - rw * rw) * h * (input.porosityPct / 100);
  const pill = (wellbore + formation) * (1 + input.excessPct / 100);
  // Продавка: от устья до кровли пачки — по НКТ до башмака, ниже башмака — по колонне
  const shoe = Math.min(input.tubingShoeMD, pillTop);
  const displacement = area(well.pipeID_mm) * shoe + casingA * Math.max(0, pillTop - shoe);

  const warnings: string[] = [];
  if (input.tubingShoeMD > pillTop)
    warnings.push("Башмак НКТ ниже кровли пачки — после закачки приподнять НКТ над пачкой до начала продавки.");
  if (input.penetrationRadiusM > 1.5)
    warnings.push("⚠ Радиус проникновения > 1.5 м — большой объём и риск ухудшения притока после освоения.");
  warnings.push("Плотность пачки — не ниже плотности глушения; реологию и время структурирования — по паспорту состава.");

  return {
    wellboreVolumeM3: wellbore,
    formationVolumeM3: formation,
    pillVolumeM3: pill,
    displacementVolumeM3: displacement,
    pillTopMD: pillTop,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 5. Ловильный инструмент (ориентировочно) и отворот
// ═══════════════════════════════════════════════════════════════════

export interface FishingToolInput {
  fishOD_mm: number;
  /** Внутренний диаметр головы рыбы, мм (0 — нет проходного канала) */
  fishID_mm: number;
  headDamaged: boolean;
  /** Минимальный диаметральный зазор инструмента с колонной, мм */
  minClearance_mm: number;
  /** Толщина стенки корпуса наружного захвата (на сторону), мм */
  externalBodyWall_mm: number;
}

export interface FishingToolOption {
  tool: string;
  feasible: boolean;
  note: string;
}

export function selectFishingTools(input: FishingToolInput, well: WorkoverWellData): {
  maxToolOD_mm: number;
  externalToolOD_mm: number;
  options: FishingToolOption[];
} {
  const maxOD = well.casingID_mm - input.minClearance_mm;
  const extOD = input.fishOD_mm + 2 * input.externalBodyWall_mm;
  const external = extOD <= maxOD;
  const internal = input.fishID_mm >= 20;
  const options: FishingToolOption[] = [];
  if (input.headDamaged)
    options.push({ tool: "Печать (оттиск)", feasible: true, note: "Сначала — обследовать голову рыбы печатью, затем выбирать захват." });
  options.push({
    tool: input.headDamaged ? "Колокол ловильный" : "Овершот (наружный захват)",
    feasible: external,
    note: external
      ? `Наружный диаметр инструмента ≈ ${extOD.toFixed(0)} мм ≤ допустимого ${maxOD.toFixed(0)} мм.`
      : `Не проходит: нужен ≈ ${extOD.toFixed(0)} мм, допустимо ${maxOD.toFixed(0)} мм.`,
  });
  options.push({
    tool: input.headDamaged ? "Метчик ловильный" : "Труболовка внутренняя",
    feasible: internal,
    note: internal ? `Захват за внутренний диаметр ${input.fishID_mm} мм.` : "Нет проходного канала достаточного диаметра.",
  });
  options.push({
    tool: "Фрезер / райбер",
    feasible: true,
    note: `Диаметр — до ${maxOD.toFixed(0)} мм. Применять, если захват невозможен или голова смята.`,
  });
  return { maxToolOD_mm: maxOD, externalToolOD_mm: extOD, options };
}

export interface BackOffInput {
  /** Глубина отворота, MD */
  backOffMD: number;
  /** Момент, необходимый для отворота резьбы (момент свинчивания × коэффициент), кН·м */
  breakoutTorqueKNm: number;
  frictionCoeff: number;
}

export interface BackOffResult {
  frictionTorqueKNm: number;
  surfaceTorqueKNm: number;
  turns: number;
  torsionalYieldKNm: number;
  ok: boolean;
  warnings: string[];
}

/** Закрутка колонны при передаче момента на глубину: θ = Σ M(z)·dz / (G·Jp). */
export function calculateBackOff(input: BackOffInput, well: WorkoverWellData): BackOffResult {
  const L = Math.max(10, Math.min(input.backOffMD, well.wellDepthMD));
  const segWell = { ...well, wellDepthMD: L };
  const rot = calculateDrag({ operation: "rotate", frictionCoeff: input.frictionCoeff }, segWell);
  const do_ = well.pipeOD_mm / 1000, di = well.pipeID_mm / 1000;
  const J = (Math.PI / 32) * (do_ ** 4 - di ** 4);
  const Gs = SHEAR_MODULUS_GPa * 1e9;
  let theta = 0;
  const pts = rot.points;
  for (let i = 0; i < pts.length; i++) {
    const seg = i + 1 < pts.length ? pts[i + 1].md - pts[i].md : L - pts[i].md;
    const M = (input.breakoutTorqueKNm + pts[i].torqueKNm) * 1000;
    theta += (M * seg) / (Gs * J);
  }
  const surface = input.breakoutTorqueKNm + rot.surfaceTorqueKNm;
  const yieldT = (0.577 * well.pipeYieldMPa * 1e6 * J) / (do_ / 2) / 1000;
  const warnings: string[] = [];
  if (surface > yieldT / 1.25)
    warnings.push(`🔴 Момент на устье ${surface.toFixed(2)} кН·м > допустимого по телу трубы ${(yieldT / 1.25).toFixed(2)} кН·м.`);
  warnings.push("Отворот левым вращением: выше точки отворота резьбы не должны развинчиваться — до отворота докрепить колонну правым вращением (момент свинчивания по паспорту).");
  return {
    frictionTorqueKNm: rot.surfaceTorqueKNm,
    surfaceTorqueKNm: surface,
    turns: theta / (2 * Math.PI),
    torsionalYieldKNm: yieldT,
    ok: !warnings.some((w) => w.startsWith("🔴")),
    warnings,
  };
}

