/**
 * Ядро расчётов ГНКТ: силы (модель эффективной силы с изгибом колонны), гидравлика, прочность по API RP 5C7.
 *
 * СИЛЫ — «мягкая нить» Йохансика в 3D (кривизна по зениту и азимуту) в эффективных силах:
 *   F_eff = F_true + p_o·A_o − p_i·A_i;  на забое F_eff = −нагрузка на забой (закрытый конец, обратный клапан).
 *   Вес в жидкости: w = m·g + ρ_i·g·A_i − ρ_o·g·A_o.
 *   При сжатии выше критических сил — дополнительная контактная сила от изгиба колонны в стволе:
 *     синусоидальный (Досон–Паслей / Лубинский для вертикали): w_c ≈ r·F²/(8EI);
 *     спиральный (Чен–Чиатем, ×√2):                            w_c = r·F²/(4EI) (Митчелл).
 *   Индикатор веса: WI = F_eff(устье) − P_устья·A_o ∓ трение в уплотнителе (СПО вниз / вверх).
 *   Запирание: при спуске сжатие нарастает лавинообразно (рост прижатия от спирального изгиба) и сила
 *   с устья перестаёт передаваться вниз; ограничение по инжектору — требуемое проталкивание больше его усилия.
 *
 * ГИДРАВЛИКА — степенная модель (n, K; бингамовская жидкость пересчитывается по Fann 600/300),
 *   число Рейнольдса Метцнера–Рида, трение Додж–Метцнер; навитая часть ГНКТ на барабане — поправки на кривизну
 *   (ламинар — по числу Дина, турбулентный — Ито); снижатель трения; затрубье — по участкам (НКТ / колонна).
 *
 * ПРОЧНОСТЬ — API RP 5C7: разрыв по Барлоу с минимальной толщиной стенки; смятие по Тимошенко с овальностью,
 *   снижение предела текучести при растяжении (API 5C3), температура; эквивалентные напряжения Мизеса по Ламе.
 */
import type { CTSection, CTStringData, FluidData, TrajectoryPoint, WellGeometry } from "./coiled-tubing-calculations";

const G = 9.81;
const STEEL = 7850;
const E_STEEL = 207e9;
const NU = 0.3;

export const CT_GRADE_YIELD: Record<string, number> = { "CT-70": 483, "CT-80": 552, "CT-90": 621, "CT-110": 758 };

/** Наземное оборудование и дополнительные условия */
export interface CTSurfaceOptions {
  /** Трение в уплотнителе (стриппере), кН; 0/не задано — авто: 2 кН + 15% силы давления устья */
  stripperFrictionKN?: number;
  /** Натяжение трубы со стороны барабана, кН (учитывается в требуемом тяговом усилии инжектора) */
  reelBackTensionKN?: number;
  /** Тяговое усилие инжектора на подъём, кН */
  injectorPullKN?: number;
  /** Усилие проталкивания (снаббинга) инжектора, кН */
  injectorSnubKN?: number;
  /** Глубина башмака НКТ по стволу, м (0/не задано — НКТ на всю глубину, если НКТ есть) */
  tubingShoeMD?: number;
  /** Снижение турбулентного трения жидкости снижателем трения, % */
  frictionReducerPct?: number;
  /** Длина наземных линий от насоса до барабана, м */
  surfaceLineM?: number;
  /** Износ / минусовой допуск толщины стенки, % */
  wallLossPct?: number;
  /** Диаметр сердечника барабана, м (для гидравлики навитой части) */
  reelCoreD?: number;
}

export const CT_SURFACE_DEFAULTS: Required<Omit<CTSurfaceOptions, "stripperFrictionKN" | "tubingShoeMD">> = {
  reelBackTensionKN: 4.5,
  injectorPullKN: 270,
  injectorSnubKN: 130,
  frictionReducerPct: 0,
  surfaceLineM: 30,
  wallLossPct: 0,
  reelCoreD: 1.83,
};

// ════════════════════════ Геометрия ════════════════════════

export interface PipeGeom { od: number; wall: number; id: number; ao: number; ai: number; as: number; ei: number; wAir: number }

export function pipeGeom(odMm: number, wallMm: number): PipeGeom {
  const od = odMm / 1000, id = Math.max(0, odMm - 2 * wallMm) / 1000;
  const ao = (Math.PI / 4) * od * od, ai = (Math.PI / 4) * id * id, as = ao - ai;
  const I = (Math.PI / 64) * (od ** 4 - id ** 4);
  return { od, wall: wallMm / 1000, id, ao, ai, as, ei: E_STEEL * I, wAir: as * STEEL * G };
}

/** Труба на расстоянии x от нижнего конца (sections[0] — нижняя секция). */
export function pipeFromBottom(ct: CTStringData, sections: CTSection[] | undefined, x: number): PipeGeom {
  if (!sections || sections.length === 0) return pipeGeom(ct.od, ct.wall);
  let cum = 0;
  for (const s of sections) { cum += s.length; if (x <= cum) return pipeGeom(s.od, s.wall); }
  const last = sections[sections.length - 1];
  return pipeGeom(last.od, last.wall);
}

export function stringLength(ct: CTStringData, sections?: CTSection[]): number {
  return sections && sections.length ? sections.reduce((s, x) => s + x.length, 0) : ct.length;
}

export interface Station { md: number; tvd: number; inc: number; az: number }

/** Синтетическая J-образная траектория, если инклинометрия не задана, но MD > TVD. */
function syntheticTrajectory(md: number, tvd: number): TrajectoryPoint[] {
  if (md <= 0 || tvd <= 0 || tvd >= md - 0.5) return [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: Math.max(md, 1), tvd: Math.max(md, 1), zenith: 0, azimuth: 0 }];
  // вертикаль до KOP, затем набор с постоянной интенсивностью до угла, обеспечивающего TVD
  let lo = 0.01, hi = Math.PI / 2;
  const kopFrac = 0.3;
  const kop = md * kopFrac;
  const f = (a: number) => kop + ((md - kop) * Math.sin(a)) / Math.max(a, 1e-6) - tvd; // набор до конца: TVD = KOP + L·sin(a)/a
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  const a = (lo + hi) / 2;
  const pts: TrajectoryPoint[] = [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: kop, tvd: kop, zenith: 0, azimuth: 0 }];
  const n = 12;
  for (let i = 1; i <= n; i++) {
    const s = ((md - kop) * i) / n, ai = (a * i) / n;
    pts.push({ md: kop + s, tvd: kop + (s * Math.sin(ai)) / Math.max(ai, 1e-6), zenith: (ai * 180) / Math.PI, azimuth: 0 });
  }
  return pts;
}

/** Станции с шагом ds по стволу до глубины md (зенит/азимут — линейная интерполяция замеров). */
export function stationsFor(well: WellGeometry, mdMax: number, ds: number): Station[] {
  const raw = well.trajectory && well.trajectory.length > 1 ? well.trajectory : syntheticTrajectory(well.md, well.tvd);
  const t = raw.slice().sort((a, b) => a.md - b.md);
  const out: Station[] = [];
  const n = Math.max(2, Math.ceil(mdMax / ds));
  let j = 0;
  let tvd = 0, prevInc = (t[0]?.zenith ?? 0) * (Math.PI / 180), prevMd = 0;
  for (let i = 0; i <= n; i++) {
    const md = (mdMax * i) / n;
    while (j < t.length - 2 && t[j + 1].md < md) j++;
    const a = t[j], b = t[Math.min(t.length - 1, j + 1)];
    const fr = b.md > a.md ? Math.min(1, Math.max(0, (md - a.md) / (b.md - a.md))) : md > b.md ? 1 : 0;
    const inc = ((a.zenith + (b.zenith - a.zenith) * fr) * Math.PI) / 180;
    let dAz = b.azimuth - a.azimuth; if (dAz > 180) dAz -= 360; if (dAz < -180) dAz += 360;
    const az = ((a.azimuth + dAz * fr) * Math.PI) / 180;
    if (i > 0) tvd += (md - prevMd) * Math.cos((inc + prevInc) / 2);
    out.push({ md, tvd, inc, az });
    prevInc = inc; prevMd = md;
  }
  return out;
}

/** Внутренний диаметр ствола (НКТ / колонна) на глубине, м */
function holeIdAt(well: WellGeometry, opts: CTSurfaceOptions, md: number): number {
  const shoe = opts.tubingShoeMD && opts.tubingShoeMD > 0 ? opts.tubingShoeMD : Infinity;
  return (well.tubingID > 0 && md <= shoe ? well.tubingID : well.casingID) / 1000;
}

// ════════════════════════ Силы ════════════════════════

export type BuckleState = 0 | 1 | 2; // 0 — нет, 1 — синусоидальный, 2 — спиральный

export interface BucklingLimits { fSin: number; fHel: number }

/** Критические силы потери устойчивости, Н (положительные величины сжатия) */
export function bucklingLimits(ei: number, w: number, inc: number, r: number): BucklingLimits {
  if (r <= 1e-4 || w <= 0) return { fSin: Infinity, fHel: Infinity };
  const s = Math.sin(Math.max(inc, 0));
  const dawson = 2 * Math.sqrt((ei * w * s) / r);
  const vertSin = 2.55 * Math.cbrt(ei * w * w);
  const vertHel = 5.55 * Math.cbrt(ei * w * w);
  return { fSin: Math.max(dawson, vertSin), fHel: Math.max(dawson * Math.SQRT2, vertHel) };
}

export interface MarchResult {
  /** эффективная сила по станциям (0 — устье), Н */
  F: number[];
  buckle: BuckleState[];
  fSin: number[];
  fHel: number[];
  /** суммарная сила трения, Н */
  drag: number;
  diverged: boolean;
  /** глубина (MD), на которой расчёт «ушёл» (запирание), м */
  divergedAt: number;
}

interface ForceCtx {
  ct: CTStringData; sections?: CTSection[]; well: WellGeometry; opts: CTSurfaceOptions;
  rhoIn: number; rhoOut: number; mu: number; bhaN: number; st: Station[];
  pipes: PipeGeom[]; w: number[]; r: number[]; fail: number;
}

function makeCtx(ct: CTStringData, sections: CTSection[] | undefined, well: WellGeometry, fluid: FluidData, bhaKg: number, mu: number, opts: CTSurfaceOptions, deployMd: number, ds: number): ForceCtx {
  const st = stationsFor(well, deployMd, ds);
  const rho = fluid.density * 1000;
  const pipes = st.map((s) => pipeFromBottom(ct, sections, deployMd - s.md));
  const w = pipes.map((p) => p.wAir + rho * G * p.ai - rho * G * p.ao);
  const r = st.map((s, i) => Math.max(1e-4, (holeIdAt(well, opts, s.md) - pipes[i].od) / 2));
  const yieldMPa = CT_GRADE_YIELD[ct.grade] ?? 552;
  const fail = 4 * yieldMPa * 1e6 * Math.max(...pipes.map((p) => p.as));
  const bf = 1 - rho / STEEL;
  return { ct, sections, well, opts, rhoIn: rho, rhoOut: rho, mu, bhaN: bhaKg * G * bf, st, pipes, w, r, fail };
}

/**
 * Интегрирование эффективной силы от забоя (станция n) к устью (станция 0).
 * dir: +1 — подъём (трение добавляет натяжение вверху), −1 — спуск, 0 — без движения.
 */
function march(cx: ForceCtx, n: number, fBot: number, dir: -1 | 0 | 1): MarchResult {
  const F = new Array<number>(n + 1).fill(0), buckle = new Array<BuckleState>(n + 1).fill(0);
  const fSin = new Array<number>(n + 1).fill(0), fHel = new Array<number>(n + 1).fill(0);
  // КНБК под ГНКТ: её вес в жидкости (осевая составляющая) натягивает нижний конец трубы; fBot — сила на забое (−нагрузка на забой)
  F[n] = fBot + cx.bhaN * Math.cos(cx.st[n]?.inc ?? 0);
  let drag = 0, diverged = false, divergedAt = 0;
  const deriv = (Fb: number, k: number): { dF: number; fr: number; state: BuckleState } => {
    // сегмент между станциями k (верх) и k+1 (низ)
    const a = cx.st[k], b = cx.st[k + 1];
    const L = b.md - a.md;
    const incM = (a.inc + b.inc) / 2;
    const dInc = a.inc - b.inc;
    let dAz = b.az - a.az; if (dAz > Math.PI) dAz -= 2 * Math.PI; if (dAz < -Math.PI) dAz += 2 * Math.PI;
    const w = (cx.w[k] + cx.w[k + 1]) / 2;
    const W = w * L;
    const nSoft = Math.sqrt((Fb * dAz * Math.sin(incM)) ** 2 + (Fb * dInc + W * Math.sin(incM)) ** 2);
    const pipe = cx.pipes[k + 1], r = (cx.r[k] + cx.r[k + 1]) / 2;
    const lim = bucklingLimits(pipe.ei, w, incM, r);
    let nBuck = 0, state: BuckleState = 0;
    const comp = -Fb;
    if (comp > lim.fHel) { nBuck = (r * comp * comp) / (4 * pipe.ei) * L; state = 2; }
    else if (comp > lim.fSin) { nBuck = (r * comp * comp) / (8 * pipe.ei) * L; state = 1; }
    const fr = cx.mu * (nSoft + nBuck);
    return { dF: W * Math.cos(incM) + dir * fr, fr: dir === 0 ? 0 : fr, state };
  };
  for (let k = n - 1; k >= 0; k--) {
    const Fb = F[k + 1];
    const d1 = deriv(Fb, k);
    const Fp = Fb + d1.dF;
    const d2 = deriv(Fp, k);
    // Хойн: среднее производных (устойчиво для квадратичного роста прижатия при спиральном изгибе)
    const Ft = Fb + 0.5 * (d1.dF + d2.dF);
    drag += 0.5 * (d1.fr + d2.fr);
    F[k] = Ft;
    const pipe = cx.pipes[k + 1];
    const lim = bucklingLimits(pipe.ei, (cx.w[k] + cx.w[k + 1]) / 2, (cx.st[k].inc + cx.st[k + 1].inc) / 2, (cx.r[k] + cx.r[k + 1]) / 2);
    fSin[k + 1] = lim.fSin; fHel[k + 1] = lim.fHel;
    buckle[k + 1] = d1.state;
    if (!Number.isFinite(Ft) || Ft < -cx.fail) {
      diverged = true; divergedAt = cx.st[k + 1].md;
      for (let m = k; m >= 0; m--) F[m] = -cx.fail;
      break;
    }
  }
  if (n > 0) { fSin[0] = fSin[1]; fHel[0] = fHel[1]; buckle[0] = buckle[1]; }
  return { F, buckle, fSin, fHel, drag, diverged, divergedAt };
}

/** Сила трения в уплотнителе, Н */
export function stripperFrictionN(well: WellGeometry, opts: CTSurfaceOptions, ao: number): number {
  if (opts.stripperFrictionKN && opts.stripperFrictionKN > 0) return opts.stripperFrictionKN * 1000;
  return 2000 + 0.15 * Math.max(0, well.wellheadPressure) * 1e6 * ao;
}

export interface WIResult {
  /** индикатор веса, Н */
  wi: number;
  march: MarchResult;
}

export interface DepthSnapshot {
  md: number; tvd: number;
  /** индикатор веса при спуске / подъёме / без движения, кН */
  wiRIH: number; wiPOOH: number; wiStatic: number;
  /** спуск невозможен: спиральное запирание */
  helicalLock: boolean;
  /** требуемое проталкивание больше усилия инжектора */
  injectorLimited: boolean;
  /** требуемое тяговое усилие на подъём (с натяжением барабана), кН */
  pullRequired: number;
  /** доступная нагрузка на забой при полном усилии проталкивания, кН */
  wobMax: number;
  /** нагрузка на забой без проталкивания (разгрузка веса до нуля на индикаторе), кН */
  wobNoSnub: number;
}

export interface ForceModel {
  cx: (deployMd: number) => ForceCtx;
  snapshot: (deployMd: number, withWob?: boolean) => DepthSnapshot;
  profile: (deployMd: number) => { st: Station[]; rih: MarchResult; pooh: MarchResult; stat: MarchResult; pipes: PipeGeom[]; w: number[] };
  pressureForceN: number;
  stripperN: number;
}

export function forceModel(ct: CTStringData, sections: CTSection[] | undefined, well: WellGeometry, fluid: FluidData, bhaKg: number, mu: number, optsIn: CTSurfaceOptions = {}): ForceModel {
  const opts = { ...CT_SURFACE_DEFAULTS, ...optsIn };
  const top = pipeFromBottom(ct, sections, stringLength(ct, sections));
  const pressureForceN = Math.max(0, well.wellheadPressure) * 1e6 * top.ao;
  const stripperN = stripperFrictionN(well, opts, top.ao);
  const snubN = opts.injectorSnubKN * 1000;
  const cache = new Map<number, ForceCtx>();
  const cx = (d: number) => {
    const key = Math.round(d * 10);
    let c = cache.get(key);
    if (!c) { c = makeCtx(ct, sections, well, fluid, bhaKg, mu, opts, Math.max(1, d), Math.min(10, Math.max(2, d / 60))); cache.set(key, c); }
    return c;
  };
  const wiOf = (c: ForceCtx, fBot: number, dir: -1 | 0 | 1) => {
    const n = c.st.length - 1;
    const m = march(c, n, fBot, dir);
    const wi = m.F[0] - pressureForceN + (dir === -1 ? -stripperN : dir === 1 ? stripperN : 0);
    return { wi, m };
  };
  const snapshot = (d: number, withWob = true): DepthSnapshot => {
    const c = cx(d);
    const rih = wiOf(c, 0, -1), pooh = wiOf(c, 0, 1), stat = wiOf(c, 0, 0);
    const helicalLock = rih.m.diverged;
    const injectorLimited = !helicalLock && rih.wi < -snubN;
    // доступная нагрузка на забой: F_bot < 0 (сжатие) такое, что WI спуска = −проталкивание (или 0)
    const wobFor = (wiTarget: number) => {
      if (helicalLock || rih.wi < wiTarget) return 0;
      let lo = 0, hi = Math.max(1000, c.fail / 4);
      const at = (fb: number) => { const r = wiOf(c, -fb, -1); return r.m.diverged ? -Infinity : r.wi; };
      if (at(hi) >= wiTarget) return hi / 1000;
      for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; if (at(m) >= wiTarget) lo = m; else hi = m; }
      return lo / 1000;
    };
    return {
      md: d, tvd: c.st[c.st.length - 1].tvd,
      wiRIH: rih.m.diverged ? -Infinity : rih.wi / 1000, wiPOOH: pooh.wi / 1000, wiStatic: stat.wi / 1000,
      helicalLock, injectorLimited,
      pullRequired: (pooh.wi + opts.reelBackTensionKN * 1000) / 1000,
      wobMax: withWob ? wobFor(-snubN) : 0,
      wobNoSnub: withWob ? wobFor(0) : 0,
    };
  };
  const profile = (d: number) => {
    const c = cx(d);
    const n = c.st.length - 1;
    return { st: c.st, rih: march(c, n, 0, -1), pooh: march(c, n, 0, 1), stat: march(c, n, 0, 0), pipes: c.pipes, w: c.w };
  };
  return { cx, snapshot, profile, pressureForceN, stripperN };
}

export interface ReachScan {
  depths: DepthSnapshot[];
  /** первая глубина, где спуск невозможен (спиральное запирание или нехватка проталкивания), 0 — доходит */
  lockUpDepth: number;
  lockUpReason: "helical" | "injector" | null;
  helicalLockDepth: number;
  injectorLimitDepth: number;
  /** глубина равновесия: выше неё при спуске трубу нужно проталкивать (давление устья > вес), 0 — не требуется */
  pipeLightDepth: number;
  /** интервалы глубины КНБК, где при спуске требуется проталкивание инжектором */
  snubIntervals: [number, number][];
  maxSnubRequired: number;
  maxPullRequired: number;
}

/** Профиль индикатора веса по глубине КНБК + поиск запирания. */
export function scanReach(model: ForceModel, maxD: number, steps = 60, withWob = true, injectorSnubKN = CT_SURFACE_DEFAULTS.injectorSnubKN): ReachScan {
  const depths: DepthSnapshot[] = [];
  let helicalLockDepth = 0, injectorLimitDepth = 0, pipeLightDepth = 0, maxSnub = 0, maxPull = 0;
  let prev: DepthSnapshot | null = null;
  const surfaceWi = -(model.pressureForceN + model.stripperN) / 1000;
  const snubIntervals: [number, number][] = surfaceWi < 0 ? [[0, 0]] : [];
  for (let i = 1; i <= steps; i++) {
    const d = (maxD * i) / steps;
    const s = model.snapshot(d, withWob);
    depths.push(s);
    // интервалы, где при спуске нужно проталкивание (индикатор веса < 0)
    const neg = Number.isFinite(s.wiRIH) && s.wiRIH < 0;
    const prevWi = prev ? prev.wiRIH : surfaceWi;
    const prevMd = prev ? prev.md : 0;
    const prevNeg = Number.isFinite(prevWi) && prevWi < 0;
    const cross = () => (Number.isFinite(prevWi) && Number.isFinite(s.wiRIH) && prevWi !== s.wiRIH ? prevMd + ((d - prevMd) * prevWi) / (prevWi - s.wiRIH) : d);
    if (neg && !prevNeg) snubIntervals.push([Math.round(cross()), Math.round(d)]);
    if (neg && prevNeg && snubIntervals.length) snubIntervals[snubIntervals.length - 1][1] = Math.round(d);
    if (!neg && prevNeg && Number.isFinite(s.wiRIH)) {
      const x = Math.round(cross());
      if (snubIntervals.length) snubIntervals[snubIntervals.length - 1][1] = x; else snubIntervals.push([0, x]);
      if (!pipeLightDepth && snubIntervals.length === 1 && snubIntervals[0][0] === 0) pipeLightDepth = x;
    }
    if (s.helicalLock && !helicalLockDepth) {
      // уточнение бисекцией между prev и d
      let lo = prev ? prev.md : 0, hi = d;
      for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; if (model.snapshot(m, false).helicalLock) hi = m; else lo = m; }
      helicalLockDepth = Math.round(lo);
    }
    if (s.injectorLimited && !injectorLimitDepth) {
      let lo = prev ? prev.md : 0, hi = d;
      for (let k = 0; k < 14; k++) { const m = (lo + hi) / 2; const x = model.snapshot(m, false); if (x.injectorLimited || x.helicalLock) hi = m; else lo = m; }
      injectorLimitDepth = Math.round(lo);
    }
    if (Number.isFinite(s.wiRIH)) maxSnub = Math.max(maxSnub, -s.wiRIH);
    maxPull = Math.max(maxPull, s.pullRequired);
    prev = s;
  }
  const cands = [helicalLockDepth, injectorLimitDepth].filter((x) => x > 0);
  const lockUpDepth = cands.length ? Math.min(...cands) : 0;
  const lockUpReason = !lockUpDepth ? null : lockUpDepth === helicalLockDepth ? "helical" : "injector";
  void injectorSnubKN;
  return { depths, lockUpDepth, lockUpReason, helicalLockDepth, injectorLimitDepth, pipeLightDepth: Math.round(pipeLightDepth), snubIntervals: snubIntervals.filter((x) => x[1] > x[0]), maxSnubRequired: Math.max(0, maxSnub, -surfaceWi), maxPullRequired: maxPull };
}

// ════════════════════════ Гидравлика ════════════════════════

export interface Rheo { n: number; K: number; model: string }

/** Реология в степенной модели: заданные n, K; бингамовская — через показания Fann 600/300; ньютоновская — μ = PV. */
export function rheologyOf(fluid: FluidData): Rheo {
  if (fluid.nIndex > 0 && fluid.nIndex < 0.98 && fluid.kIndex > 0) return { n: fluid.nIndex, K: fluid.kIndex, model: `степенная: n = ${fluid.nIndex.toFixed(2)}, K = ${fluid.kIndex.toFixed(3)} Па·сⁿ` };
  const pv = Math.max(0.01, fluid.pv || 1);
  if ((fluid.yp ?? 0) > 0.05) {
    const yp = fluid.yp / 0.4788; // Па → lbf/100ft²
    const t300 = pv + yp, t600 = 2 * pv + yp;
    const n = Math.min(1, Math.max(0.15, 3.32 * Math.log10(t600 / t300)));
    const K = (0.511 * t300) / Math.pow(511, n);
    return { n, K, model: `бингамовская (PV ${pv}, ДНС ${fluid.yp} Па) → степенная: n = ${n.toFixed(2)}, K = ${K.toFixed(3)} Па·сⁿ` };
  }
  return { n: 1, K: pv / 1000, model: `ньютоновская, μ = ${pv} мПа·с` };
}

/** Коэффициент Фаннинга для турбулентного течения степенной жидкости (Додж–Метцнер). */
function dodgeMetzner(Re: number, n: number): number {
  let f = 0.0791 / Math.pow(Math.max(Re, 1), 0.25);
  for (let i = 0; i < 30; i++) {
    const rhs = (4 / Math.pow(n, 0.75)) * Math.log10(Re * Math.pow(f, 1 - n / 2)) - 0.4 / Math.pow(n, 1.2);
    const fn = 1 / Math.max(rhs, 1e-3) ** 2;
    if (Math.abs(fn - f) < 1e-9) { f = fn; break; }
    f = 0.5 * f + 0.5 * fn;
  }
  return f;
}

export interface FlowSeg { gradPaM: number; Re: number; regime: "Ламинарный" | "Переходный" | "Турбулентный"; f: number; v: number }

/** Течение в трубе; coilD — диаметр навивки (барабан), drPct — снижение трения, %. */
export function pipeFlow(q: number, d: number, rho: number, rh: Rheo, coilD = 0, drPct = 0): FlowSeg {
  if (q <= 0 || d <= 0) return { gradPaM: 0, Re: 0, regime: "Ламинарный", f: 0, v: 0 };
  const A = (Math.PI / 4) * d * d, v = q / A, n = rh.n;
  const Kp = rh.K * Math.pow((3 * n + 1) / (4 * n), n);
  const Re = (rho * Math.pow(v, 2 - n) * Math.pow(d, n)) / (Kp * Math.pow(8, n - 1));
  const reL = 3470 - 1370 * n, reT = 4270 - 1370 * n;
  let fl = 16 / Math.max(Re, 1e-6);
  let ft = dodgeMetzner(Math.max(Re, reT), n);
  if (coilD > 0) {
    const de = Re * Math.sqrt(d / coilD);
    if (de > 11.6) fl *= 1 + 0.033 * Math.pow(Math.log10(de), 4);
    const x = Math.max(Re, reT) * (d / coilD) ** 2;
    if (x > 6) {
      const ito = Math.sqrt(d / coilD) * (0.00725 + 0.076 * Math.pow(x, -0.25));
      const straightNewt = 0.079 / Math.pow(Math.max(Re, reT), 0.25);
      ft *= Math.max(1, ito / straightNewt);
    }
  }
  const dr = Math.min(0.8, Math.max(0, drPct / 100)) * (coilD > 0 ? 0.7 : 1);
  ft = Math.max(ft * (1 - dr), 16 / Math.max(Re, reT));
  let f: number, regime: FlowSeg["regime"];
  if (Re <= reL) { f = fl; regime = "Ламинарный"; }
  else if (Re >= reT) { f = ft; regime = "Турбулентный"; }
  else { const t = (Re - reL) / (reT - reL); f = fl * (1 - t) + ft * t; regime = "Переходный"; }
  return { gradPaM: (2 * f * rho * v * v) / d, Re, regime, f, v };
}

/** Течение в кольцевом зазоре (щелевая аппроксимация). */
export function annulusFlow(q: number, dOut: number, dIn: number, rho: number, rh: Rheo): FlowSeg {
  const A = (Math.PI / 4) * (dOut * dOut - dIn * dIn), dh = dOut - dIn;
  if (q <= 0 || A <= 0 || dh <= 0) return { gradPaM: 0, Re: 0, regime: "Ламинарный", f: 0, v: 0 };
  const v = q / A, n = rh.n;
  const Kp = rh.K * Math.pow((2 * n + 1) / (3 * n), n);
  const Re = (rho * Math.pow(v, 2 - n) * Math.pow(dh, n)) / (Kp * Math.pow(12, n - 1));
  const reL = 3470 - 1370 * n, reT = 4270 - 1370 * n;
  const fl = 24 / Math.max(Re, 1e-6);
  const ft = Math.max(dodgeMetzner(Math.max(Re, reT), n), 24 / Math.max(Re, reT));
  let f: number, regime: FlowSeg["regime"];
  if (Re <= reL) { f = fl; regime = "Ламинарный"; }
  else if (Re >= reT) { f = ft; regime = "Турбулентный"; }
  else { const t = (Re - reL) / (reT - reL); f = fl * (1 - t) + ft * t; regime = "Переходный"; }
  return { gradPaM: (2 * f * rho * v * v) / dh, Re, regime, f, v };
}

export interface CTHydraulicsDetail {
  rheo: Rheo;
  deployedM: number; reelM: number;
  dpDeployed: number; dpReel: number; dpLines: number; dpAnn: number; dpNozzle: number;
  /** давление насоса (на входе в барабан), МПа */
  pumpPressure: number;
  bhp: number; hydro: number; ecd: number;
  ctFlow: FlowSeg; reelFlow: FlowSeg;
  /** течение в затрубье по участкам */
  annSegs: { from: number; to: number; holeIdMm: number; flow: FlowSeg }[];
  /** минимальная скорость в затрубье (самый широкий участок), м/с */
  minAnnVel: number;
  warnings: string[];
}

export function ctHydraulics(ct: CTStringData, sections: CTSection[] | undefined, well: WellGeometry, fluid: FluidData, qLps: number, nozzle: { d: number; n: number }, optsIn: CTSurfaceOptions = {}): CTHydraulicsDetail {
  const opts = { ...CT_SURFACE_DEFAULTS, ...optsIn };
  const q = Math.max(0, qLps) / 1000;
  const rho = fluid.density * 1000;
  const rh = rheologyOf(fluid);
  const total = stringLength(ct, sections);
  const deployed = Math.min(total, well.md);
  const reelM = Math.max(0, total - deployed);
  const warnings: string[] = [];
  if (fluid.density < 0.4) warnings.push("Газ (азот) сжимаем — для расчёта азота используйте вкладку «N₂ Освоение»; здесь — оценка как для жидкости.");
  // внутри ГНКТ: по секциям (нижний конец — sections[0]); навитая часть — верхняя часть трубы
  const step = 25;
  let dpDeployed = 0, dpReel = 0;
  let ctFlow: FlowSeg | null = null, reelFlow: FlowSeg | null = null;
  const coilD = opts.reelCoreD * 1.25; // средний диаметр навивки с учётом слоёв
  for (let x = 0; x < total; x += step) {
    const L = Math.min(step, total - x);
    const p = pipeFromBottom(ct, sections, x + L / 2);
    const onReel = x + L / 2 > deployed;
    const fl = pipeFlow(q, p.id, rho, rh, onReel ? coilD : 0, opts.frictionReducerPct);
    if (onReel) { dpReel += fl.gradPaM * L; reelFlow ??= fl; } else { dpDeployed += fl.gradPaM * L; ctFlow ??= fl; }
  }
  const topPipe = pipeFromBottom(ct, sections, total);
  const lines = pipeFlow(q, Math.max(topPipe.id, 0.05), rho, rh, 0, opts.frictionReducerPct);
  const dpLines = lines.gradPaM * opts.surfaceLineM;
  ctFlow ??= pipeFlow(q, topPipe.id, rho, rh, 0, opts.frictionReducerPct);
  reelFlow ??= pipeFlow(q, topPipe.id, rho, rh, coilD, opts.frictionReducerPct);
  // затрубье: по участкам НКТ / колонна
  const shoe = opts.tubingShoeMD && opts.tubingShoeMD > 0 ? Math.min(opts.tubingShoeMD, deployed) : deployed;
  const segs: { from: number; to: number; holeIdMm: number }[] = [];
  if (well.tubingID > 0) {
    segs.push({ from: 0, to: shoe, holeIdMm: well.tubingID });
    if (shoe < deployed) segs.push({ from: shoe, to: deployed, holeIdMm: well.casingID });
  } else segs.push({ from: 0, to: deployed, holeIdMm: well.casingID });
  let dpAnn = 0;
  const annSegs = segs.filter((s) => s.to > s.from).map((s) => {
    const p = pipeFromBottom(ct, sections, deployed - (s.from + s.to) / 2);
    const fl = annulusFlow(q, s.holeIdMm / 1000, p.od, rho, rh);
    dpAnn += fl.gradPaM * (s.to - s.from);
    return { ...s, flow: fl };
  });
  let dpNozzle = 0;
  if (nozzle.d > 0 && nozzle.n > 0 && q > 0) {
    const a = nozzle.n * (Math.PI / 4) * (nozzle.d / 1000) ** 2;
    dpNozzle = (rho * (q / a) ** 2) / (2 * 0.95 * 0.95);
  }
  const tvd = stationsFor(well, deployed, Math.max(5, deployed / 200)).slice(-1)[0]?.tvd ?? well.tvd;
  const hydro = rho * G * tvd;
  const toMPa = (x: number) => x / 1e6;
  const pumpPressure = well.wellheadPressure + toMPa(dpDeployed + dpReel + dpLines + dpAnn + dpNozzle);
  const bhp = well.wellheadPressure + toMPa(hydro + dpAnn);
  const ecd = tvd > 0 ? (hydro + dpAnn) / (G * tvd) / 1000 : fluid.density;
  const minAnnVel = annSegs.length ? Math.min(...annSegs.map((s) => s.flow.v)) : 0;
  return {
    rheo: rh, deployedM: deployed, reelM,
    dpDeployed: toMPa(dpDeployed), dpReel: toMPa(dpReel), dpLines: toMPa(dpLines), dpAnn: toMPa(dpAnn), dpNozzle: toMPa(dpNozzle),
    pumpPressure, bhp, hydro: toMPa(hydro), ecd, ctFlow, reelFlow, annSegs, minAnnVel, warnings,
  };
}

// ════════════════════════ Прочность (API RP 5C7) ════════════════════════

export interface CTStrength {
  yieldMPa: number; tMin: number; dOverT: number;
  burst: number; collapseYield: number; collapseElastic: number; collapse: number; collapseOval: number;
  yieldTensionKN: number;
}

export function strengthOf(odMm: number, wallMm: number, grade: string, ovalityPct: number, wallLossPct = 0, derate = 1): CTStrength {
  const Y = (CT_GRADE_YIELD[grade] ?? 552) * derate;
  const t = wallMm * (1 - Math.max(0, wallLossPct) / 100);
  const D = odMm, r = D / t;
  const burst = (2 * Y * t) / D;
  const py = 2 * Y * ((r - 1) / (r * r));
  const pe = ((2 * E_STEEL) / 1e6 / (1 - NU * NU)) / (r * (r - 1) ** 2);
  const timo = (f0: number) => {
    const b = py + (1 + 1.5 * f0 * r) * pe;
    return (b - Math.sqrt(Math.max(0, b * b - 4 * py * pe))) / 2;
  };
  const as = (Math.PI / 4) * ((D / 1000) ** 2 - ((D - 2 * t) / 1000) ** 2);
  return {
    yieldMPa: Y, tMin: t, dOverT: r, burst, collapseYield: py, collapseElastic: pe,
    collapse: timo(0), collapseOval: timo(Math.max(0, ovalityPct) / 100), yieldTensionKN: Y * as * 1000,
  };
}

/** Смятие с учётом осевого напряжения (API 5C3: приведённый предел текучести), МПа */
export function collapseWithAxial(odMm: number, wallMm: number, grade: string, ovalityPct: number, axialKN: number, wallLossPct = 0, derate = 1): number {
  const base = strengthOf(odMm, wallMm, grade, ovalityPct, wallLossPct, derate);
  const sa = (axialKN * 1000) / ((Math.PI / 4) * ((odMm / 1000) ** 2 - ((odMm - 2 * base.tMin) / 1000) ** 2)) / 1e6;
  const x = sa / base.yieldMPa;
  const k = Math.max(0, Math.sqrt(Math.max(0, 1 - 0.75 * x * x)) - 0.5 * x);
  const adj = strengthOf(odMm, wallMm, grade, ovalityPct, wallLossPct, derate * Math.min(1, k));
  return adj.collapseOval;
}

/** Эквивалентное напряжение Мизеса по Ламе (максимум по внутренней и наружной поверхности), МПа */
export function vonMisesLame(odMm: number, tMm: number, pi: number, po: number, axialKN: number): number {
  const ro = odMm / 2000, ri = (odMm - 2 * tMm) / 2000;
  const as = Math.PI * (ro * ro - ri * ri);
  const sa = (axialKN * 1000) / as / 1e6;
  const k = ro * ro - ri * ri;
  const vm = (r: number) => {
    const sh = (pi * ri * ri - po * ro * ro) / k + ((pi - po) * ri * ri * ro * ro) / (k * r * r);
    const sr = (pi * ri * ri - po * ro * ro) / k - ((pi - po) * ri * ri * ro * ro) / (k * r * r);
    return Math.sqrt(0.5 * ((sa - sh) ** 2 + (sh - sr) ** 2 + (sr - sa) ** 2));
  };
  return Math.max(vm(ri), vm(ro));
}

export interface EnvelopeRow { axialLoad: number; burstLimit: number; burstWork: number; collapseLimit: number; collapseWork: number }

/** Диаграмма допустимых нагрузок: ось X — осевая сила (кН, + растяжение), Y — перепад давления (МПа, + внутреннее). */
export function workingEnvelope(odMm: number, wallMm: number, grade: string, ovalityPct: number, wallLossPct = 0, derate = 1, steps = 40): EnvelopeRow[] {
  const s = strengthOf(odMm, wallMm, grade, ovalityPct, wallLossPct, derate);
  const rows: EnvelopeRow[] = [];
  const fy = s.yieldTensionKN;
  const solve = (F: number, inside: boolean, frac: number) => {
    let lo = 0, hi = Math.max(s.burst, s.collapseYield) * 1.6;
    const lim = s.yieldMPa * frac;
    if (vonMisesLame(odMm, s.tMin, 0, 0, F) >= lim) return 0;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      const v = inside ? vonMisesLame(odMm, s.tMin, m, 0, F) : vonMisesLame(odMm, s.tMin, 0, m, F);
      if (v < lim) lo = m; else hi = m;
    }
    return lo;
  };
  for (let i = 0; i <= steps; i++) {
    const F = -fy + (2 * fy * i) / steps;
    const cAx = collapseWithAxial(odMm, wallMm, grade, ovalityPct, Math.max(0, F), wallLossPct, derate);
    rows.push({
      axialLoad: Math.round(F * 10) / 10,
      burstLimit: Math.round(solve(F, true, 1) * 10) / 10,
      burstWork: Math.round(solve(F, true, 0.8) * 10) / 10,
      collapseLimit: -Math.round(Math.min(solve(F, false, 1), cAx) * 10) / 10,
      collapseWork: -Math.round(Math.min(solve(F, false, 0.8), cAx * 0.8) * 10) / 10,
    });
  }
  return rows;
}
