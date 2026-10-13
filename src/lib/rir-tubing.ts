/**
 * РИР, этап 2: НКТ и пакер/ретейнер при задавливании — расчёт Лубинского.
 *
 * Изменение длины НКТ (и усилие на пакере, если НКТ закреплены) от перехода
 * «посадка → конец задавливания»:
 *   1) поршневой эффект:   F1 = (Ap − Ai)·ΔPi − (Ap − Ao)·ΔPo,   ΔL1 = −L·F1/(E·As)
 *   2) продольный изгиб:   Ff = Ap·(Pi − Po),  ΔL2 = −r²·Ff²/(8·E·I·w)  (спираль, n = Ff/w ≤ L)
 *   3) раздутие (баллонинг): ΔL3 = −ν/E·(Δρi − R²Δρo)/(R² − 1)·L² − 2ν/E·(ΔPis − R²ΔPos)/(R² − 1)·L
 *   4) температура:        ΔL4 = β·L·ΔT
 * Ap — площадь уплотнения пакера/стингера, Ai/Ao — внутр./наружн. площадь НКТ, As — металл,
 * R = OD/ID, r — радиальный зазор НКТ–колонна, w — вес 1 м НКТ в жидкости (с учётом жидкостей).
 * Lubinski, Althouse, Logan, «Helical Buckling of Tubing Sealed in Packers», JPT 1962;
 * Hammerlindl, JPT 1977. Прочность — по Мизесу (трёхосное напряжение, Ламе).
 */
import { STEEL_GRADES } from "./rir-calculations";

const E = 2.07e11, NU = 0.3, BETA = 1.24e-5, G = 9.81, STEEL = 7850;

export type PackerMode = "free" | "anchored";
export const PACKER_MODE_LABEL: Record<PackerMode, string> = {
  free: "Свободное перемещение (стингер в ретейнере / уплотнение в полированной втулке)",
  anchored: "НКТ закреплены в пакере (якорь, защёлка)",
};

export interface TubingMechInputs {
  mode: PackerMode;
  /** Разгрузка веса НКТ на пакер/ретейнер при посадке, кН */
  setDownKN: number;
  /** Диаметр уплотнения пакера / стингера, мм */
  sealBoreMm: number;
  /** Допустимый ход стингера вверх до выхода уплотнений, мм */
  sealTravelMm: number;
  /** Температура закачиваемой жидкости на устье, °C */
  injectionTempC: number;
  /** Плотность жидкости продавки в НКТ, г/см³ */
  displacementDensity: number;
  /** Номинальная страгивающая нагрузка резьбы НКТ, кН (0 — по телу трубы × 0,8) */
  jointStrengthKN: number;
  /** Допустимое усилие на пакер (растяжение/сжатие), кН */
  packerLoadRatingKN: number;
  /** Коэффициент запаса по Мизесу */
  sfVme: number;
}

export const DEFAULT_TUBING_MECH: TubingMechInputs = {
  mode: "free", setDownKN: 40, sealBoreMm: 68.3, sealTravelMm: 600, injectionTempC: 15, displacementDensity: 1.0,
  jointStrengthKN: 0, packerLoadRatingKN: 450, sfVme: 1.25,
};

export interface MechState { label: string; surfaceMPa: number; annulusMPa: number; tubingFluid: number; annulusFluid: number; avgTempC: number }

export interface EffectRow { key: string; name: string; dLmm: number; forceKN: number; note: string }

export interface ForcePoint { md: number; initialKN: number; squeezeKN: number }

export interface TubingMechResult {
  lengthM: number;
  areas: { Ai: number; Ao: number; As: number; Ap: number };
  weightAirNpm: number;
  effects: EffectRow[];
  totalDLmm: number;
  /** Свободный режим: ход стингера вверх, мм (>0 — укорочение / подъём) и выход уплотнений */
  stingerUpMm: number;
  stingerUnseats: boolean;
  /** Усилие, необходимое чтобы удержать НКТ (эквивалент укорочения), кН */
  restrainForceKN: number;
  /** Закреплённый режим: усилие на пакер (+ растяжение / − сжатие), кН */
  packerForceKN: number;
  hookLoad: { initialKN: number; squeezeKN: number };
  buckling: { fictitiousKN: number; neutralPointM: number; buckled: boolean };
  vme: { atSurface: number; atPacker: number; minSF: number; allowSF: number };
  tensionAtSurfaceKN: number;
  tensionLimitKN: number;
  /** Противодавление в затрубье, при котором стингер не выходит / пакер в пределах нагрузки, МПа (null — не требуется) */
  backPressureNeededMPa: number | null;
  /** Разгрузка, при которой стингер остаётся в уплотнении, кН */
  setDownNeededKN: number | null;
  forceProfile: ForcePoint[];
  states: MechState[];
  warnings: string[];
  verdict: "ok" | "warn" | "bad";
  conclusions: string[];
}

export interface MechLoadCase {
  toolMD: number;
  toolTVD: number;
  tubingOdMm: number;
  tubingWallMm: number;
  tubingGrade: string;
  casingIdMm: number;
  wellFluidDensity: number;
  surfaceTempC: number;
  /** Статическая температура на глубине пакера, °C */
  toolStaticC: number;
  /** Циркуляционная на глубине пакера при закачке, °C */
  toolCircC: number;
  /** Давление на устье при задавливании (конец), МПа */
  squeezeSurfaceMPa: number;
  annulusBackPressureMPa: number;
}

function analyse(lc: MechLoadCase, m: TubingMechInputs, Pa: number) {
  const L = Math.max(1, lc.toolMD);
  const od = lc.tubingOdMm / 1000, id = (lc.tubingOdMm - 2 * lc.tubingWallMm) / 1000;
  const Ai = (Math.PI / 4) * id * id, Ao = (Math.PI / 4) * od * od, As = Ao - Ai;
  const Ap = (Math.PI / 4) * (m.sealBoreMm / 1000) ** 2;
  const R = od / id, R2 = R * R;
  const I = (Math.PI / 64) * (od ** 4 - id ** 4);
  const r = Math.max(0.002, (lc.casingIdMm / 1000 - od) / 2);
  const ws = STEEL * G * As * 1.05; // Н/м, с муфтами
  const rhoW = lc.wellFluidDensity * 1000, rhoD = m.displacementDensity * 1000;

  // Начальное состояние (посадка): обе полости — раствор скважины
  const Pi0 = rhoW * G * lc.toolTVD, Po0 = Pi0;
  // Конец задавливания: в НКТ продавка + давление на устье; в затрубье раствор + противодавление
  const Ps = lc.squeezeSurfaceMPa * 1e6, PaPa = Pa * 1e6;
  const Pi = Ps + rhoD * G * lc.toolTVD, Po = PaPa + rhoW * G * lc.toolTVD;
  const dPi = Pi - Pi0, dPo = Po - Po0;
  const dRhoI = (rhoD - rhoW) * G, dRhoO = 0; // Па/м

  // 1) Поршень
  const F1 = (Ap - Ai) * dPi - (Ap - Ao) * dPo;
  const dL1 = (-L * F1) / (E * As);
  // 3) Раздутие
  const dL3 = (-(NU / E) * (dRhoI - R2 * dRhoO) / (R2 - 1)) * L * L - ((2 * NU) / E) * ((Ps - R2 * PaPa) / (R2 - 1)) * L;
  const F3 = 2 * NU * ((Ps + dRhoI * L / 2) * Ai - (PaPa) * Ao); // эквивалентное усилие (для закреплённых НКТ)
  // 4) Температура: средняя температура НКТ до и при закачке
  const tAvg0 = (lc.surfaceTempC + lc.toolStaticC) / 2;
  const tAvg1 = (m.injectionTempC + lc.toolCircC) / 2;
  const dT = tAvg1 - tAvg0;
  const dL4 = BETA * L * dT;
  const F4 = -E * As * BETA * dT; // охлаждение → растяжение закреплённых НКТ (+)
  // вес в жидкости
  const w = ws + rhoD * G * Ai - rhoW * G * Ao;
  // 2) Изгиб (фиктивная сила)
  const Ff = Ap * (Pi - Po);
  const n = Ff > 0 && w > 0 ? Ff / w : 0;
  let dL2 = 0;
  if (Ff > 0 && w > 0) {
    const base = (r * r * Ff * Ff) / (8 * E * I * w);
    dL2 = n <= L ? -base : -base * (L / n) * (2 - L / n);
  }
  const totalDL = dL1 + dL2 + dL3 + dL4;
  return { L, Ai, Ao, As, Ap, R2, I, r, ws, w, Pi, Po, Pi0, Po0, F1, F3, F4, Ff, n, dL1, dL2, dL3, dL4, dT, totalDL };
}

function vmeSF(sigmaA: number, pIn: number, pOut: number, od: number, id: number, yieldPa: number): number {
  const ri = id / 2, ro = od / 2;
  const a = (pIn * ri * ri - pOut * ro * ro) / (ro * ro - ri * ri);
  const b = ((pIn - pOut) * ri * ri * ro * ro) / (ro * ro - ri * ri);
  const sr = a - b / (ri * ri), sh = a + b / (ri * ri); // на внутренней стенке
  const vm = Math.sqrt(0.5 * ((sigmaA - sh) ** 2 + (sh - sr) ** 2 + (sr - sigmaA) ** 2));
  return vm > 0 ? yieldPa / vm : 99;
}

export function analyseTubing(lc: MechLoadCase, m: TubingMechInputs): TubingMechResult {
  const warnings: string[] = [];
  const a = analyse(lc, m, lc.annulusBackPressureMPa);
  const yieldPa = (STEEL_GRADES[lc.tubingGrade] ?? 552) * 1e6;
  const od = lc.tubingOdMm / 1000, id = (lc.tubingOdMm - 2 * lc.tubingWallMm) / 1000;
  const bodyYieldKN = (yieldPa * a.As) / 1000;
  const tensionLimitKN = m.jointStrengthKN > 0 ? m.jointStrengthKN : bodyYieldKN * 0.8;

  const k = (E * a.As) / a.L; // жёсткость, Н/м
  const restrainForce = -a.totalDL * k; // + : чтобы удержать укорочение, нужна сила вниз (разгрузка) или якорь
  const effects: EffectRow[] = [
    { key: "piston", name: "Поршневой эффект", dLmm: a.dL1 * 1000, forceKN: a.F1 / 1000, note: `Ap ${(a.Ap * 1e4).toFixed(1)} см², Ai ${(a.Ai * 1e4).toFixed(1)}, Ao ${(a.Ao * 1e4).toFixed(1)}` },
    { key: "buckling", name: "Продольный изгиб (спираль)", dLmm: a.dL2 * 1000, forceKN: a.Ff / 1000, note: a.Ff > 0 ? `нейтральная точка ${Math.min(a.n, a.L).toFixed(0)} м выше пакера` : "изгиба нет" },
    { key: "balloon", name: "Раздутие (баллонинг)", dLmm: a.dL3 * 1000, forceKN: -a.dL3 * k / 1000, note: "давление внутри НКТ «укорачивает» трубу" },
    { key: "temp", name: "Температура", dLmm: a.dL4 * 1000, forceKN: a.F4 / 1000, note: `ΔT средн. ${a.dT.toFixed(1)} °C (закачка ${m.injectionTempC} °C)` },
  ];

  // Начальные нагрузки: вес в растворе, разгрузка на пакер
  const wInit = a.ws - lc.wellFluidDensity * 1000 * G * (a.Ao - a.Ai);
  const hookInit = (wInit * a.L) / 1000 - m.setDownKN;
  let packerForce = -m.setDownKN; // − сжатие на пакер
  let stingerUp = 0, unseats = false;
  if (m.mode === "anchored") {
    packerForce = -m.setDownKN + restrainForce / 1000; // укорочение → растяжение пакера
  } else {
    // свободный: разгрузка удерживает стингер, пока сила укорочения меньше разгрузки
    const shortening = -a.totalDL; // м, >0 — тянет вверх
    const preComp = (m.setDownKN * 1000) / k; // упругий запас длины от разгрузки
    stingerUp = Math.max(0, shortening - preComp) * 1000;
    unseats = stingerUp > m.sealTravelMm;
  }
  const dW = ((a.w - wInit) * a.L) / 1000; // смена жидкости в НКТ меняет вес в растворе
  const hookSqueeze = m.mode === "anchored"
    ? hookInit + dW + restrainForce / 1000
    : hookInit + dW + Math.min(m.setDownKN, Math.max(0, (-a.totalDL * k) / 1000));
  const tensionSurfaceKN = hookSqueeze;
  // Мизес у устья: растяжение = вес/площадь; Pi = Ps, Po = Pa
  const sigmaSurf = (Math.max(0, hookSqueeze) * 1000) / a.As;
  const sfSurf = vmeSF(sigmaSurf, lc.squeezeSurfaceMPa * 1e6, lc.annulusBackPressureMPa * 1e6, od, id, yieldPa);
  // у пакера: осевое напряжение = усилие на пакер (+ эффект давления на торец)
  const axialPacker = m.mode === "anchored" ? packerForce * 1000 : -Math.max(0, m.setDownKN * 1000 - Math.max(0, -a.totalDL) * k);
  const sfPack = vmeSF(axialPacker / a.As, a.Pi, a.Po, od, id, yieldPa);
  const minSF = Math.min(sfSurf, sfPack);

  // Профиль осевой силы по глубине (упрощённо: линейный от устья к пакеру)
  const forceProfile: ForcePoint[] = Array.from({ length: 21 }, (_, i) => {
    const md = (a.L * i) / 20;
    const below = a.L - md;
    const fInit = (wInit * below) / 1000 - m.setDownKN;
    const extra = m.mode === "anchored" ? restrainForce / 1000 : 0;
    return { md: Math.round(md), initialKN: Math.round(fInit * 10) / 10, squeezeKN: Math.round((fInit + extra + (a.w - wInit) * below / 1000) * 10) / 10 };
  });

  // Противодавление, при котором стингер не выходит / пакер в норме
  let backNeeded: number | null = null;
  const problem = (Pa: number) => {
    const x = analyse(lc, m, Pa);
    const kx = (E * x.As) / x.L;
    if (m.mode === "anchored") return Math.abs(-m.setDownKN + (-x.totalDL * kx) / 1000) > m.packerLoadRatingKN;
    const up = Math.max(0, -x.totalDL - (m.setDownKN * 1000) / kx) * 1000;
    return up > m.sealTravelMm * 0.5;
  };
  if (problem(lc.annulusBackPressureMPa)) {
    for (let p = lc.annulusBackPressureMPa; p <= lc.annulusBackPressureMPa + 25; p += 0.5) if (!problem(p)) { backNeeded = p; break; }
  }
  // Разгрузка, при которой стингер не выходит (свободный режим)
  let setDownNeeded: number | null = null;
  if (m.mode === "free") {
    const need = (Math.max(0, -a.totalDL) * k) / 1000;
    if (need > m.setDownKN) setDownNeeded = Math.ceil(need / 5) * 5;
  }

  const buckled = a.Ff > 0;
  if (unseats) warnings.push(`Стингер выйдет из ретейнера: подъём ${stingerUp.toFixed(0)} мм > допустимого хода ${m.sealTravelMm} мм — состав пойдёт в затрубье.`);
  if (m.mode === "anchored" && Math.abs(packerForce) > m.packerLoadRatingKN) warnings.push(`Усилие на пакер ${packerForce.toFixed(0)} кН больше допустимого ${m.packerLoadRatingKN} кН.`);
  if (hookSqueeze > tensionLimitKN) warnings.push(`Растяжение НКТ у устья ${hookSqueeze.toFixed(0)} кН больше страгивающей нагрузки резьбы ${tensionLimitKN.toFixed(0)} кН.`);
  if (minSF < m.sfVme) warnings.push(`Запас прочности НКТ по Мизесу ${minSF.toFixed(2)} меньше требуемого ${m.sfVme}.`);
  if (buckled && a.n > 0) warnings.push(`НКТ теряют устойчивость (спиральный изгиб) на ${Math.min(a.n, a.L).toFixed(0)} м над пакером — возможен износ и заклинивание; противодавление в затрубье уменьшает изгиб.`);

  const conclusions: string[] = [];
  const dir = a.totalDL < 0 ? "укоротятся" : "удлинятся";
  conclusions.push(`При задавливании НКТ ${dir} на ${Math.abs(a.totalDL * 1000).toFixed(0)} мм (основной вклад — ${effects.slice().sort((x, y) => Math.abs(y.dLmm) - Math.abs(x.dLmm))[0].name.toLowerCase()}).`);
  if (m.mode === "free") conclusions.push(unseats ? `Разгрузки ${m.setDownKN} кН недостаточно — нужно ${setDownNeeded ?? "больше"} кН${backNeeded !== null ? ` или противодавление в затрубье ${backNeeded.toFixed(1)} МПа` : ""}, либо стингер с защёлкой.` : `Стингер остаётся в уплотнении: разгрузки ${m.setDownKN} кН хватает${stingerUp > 0 ? `, подъём ${stingerUp.toFixed(0)} мм в пределах хода ${m.sealTravelMm} мм` : ""}.`);
  else conclusions.push(`Усилие на пакер в конце задавливания ${packerForce > 0 ? "растяжение" : "сжатие"} ${Math.abs(packerForce).toFixed(0)} кН (допустимо ${m.packerLoadRatingKN} кН).`);
  conclusions.push(`Минимальный запас по Мизесу ${minSF.toFixed(2)} (у устья ${sfSurf.toFixed(2)}, у пакера ${sfPack.toFixed(2)}).`);
  const verdict: TubingMechResult["verdict"] = unseats || (m.mode === "anchored" && Math.abs(packerForce) > m.packerLoadRatingKN) || minSF < 1 || hookSqueeze > tensionLimitKN ? "bad" : warnings.length ? "warn" : "ok";

  return {
    lengthM: a.L, areas: { Ai: a.Ai, Ao: a.Ao, As: a.As, Ap: a.Ap }, weightAirNpm: a.ws,
    effects, totalDLmm: a.totalDL * 1000, stingerUpMm: stingerUp, stingerUnseats: unseats, restrainForceKN: restrainForce / 1000,
    packerForceKN: packerForce, hookLoad: { initialKN: hookInit, squeezeKN: hookSqueeze },
    buckling: { fictitiousKN: a.Ff / 1000, neutralPointM: Math.min(a.n, a.L), buckled },
    vme: { atSurface: sfSurf, atPacker: sfPack, minSF, allowSF: m.sfVme },
    tensionAtSurfaceKN: tensionSurfaceKN, tensionLimitKN,
    backPressureNeededMPa: backNeeded, setDownNeededKN: setDownNeeded, forceProfile,
    states: [
      { label: "Посадка", surfaceMPa: 0, annulusMPa: 0, tubingFluid: lc.wellFluidDensity, annulusFluid: lc.wellFluidDensity, avgTempC: (lc.surfaceTempC + lc.toolStaticC) / 2 },
      { label: "Конец задавливания", surfaceMPa: lc.squeezeSurfaceMPa, annulusMPa: lc.annulusBackPressureMPa, tubingFluid: m.displacementDensity, annulusFluid: lc.wellFluidDensity, avgTempC: (m.injectionTempC + lc.toolCircC) / 2 },
    ],
    warnings, verdict, conclusions,
  };
}
