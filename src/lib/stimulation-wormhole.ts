/**
 * Червоточины в карбонатах по модели Buijse & Glasbergen (SPE 96892, 2005)
 * и скин после обработки по зонам (Хокинс).
 *
 * Скорость роста фронта червоточин:
 *   v_wh = (v_i / PV_bt,opt) · (v_i / v_i,opt)^(−1/3) · B(v_i)²,
 *   B(v_i) = 1 − exp(−4·(v_i / v_i,opt)²),
 * где v_i — межзерновая скорость кислоты на фронте, v_i = q / (2π·r·h·φ).
 * Параметры v_i,opt и PV_bt,opt — из лабораторных тестов на керне (линейное заводнение кислотой).
 */

export interface WormholeInput {
  acidVolumeM3: number;
  rateLpm: number;
  payZoneM: number;
  porosity: number;
  wellboreRadiusM: number;
  /** Оптимальная межзерновая скорость по керну, см/мин */
  viOptCmMin: number;
  /** Поровые объёмы до прорыва при оптимуме по керну */
  pvBtOpt: number;
}

export type DissolutionRegime = "face" | "conical" | "wormhole" | "ramified" | "uniform";

export interface WormholeResult {
  /** Радиус фронта червоточин (от оси скважины), м */
  wormholeRadiusM: number;
  /** Длина червоточин от стенки, м */
  wormholeLengthM: number;
  /** Межзерновая скорость у стенки и на конце закачки, см/мин */
  viWallCmMin: number;
  viFrontCmMin: number;
  /** Отношение v_i/v_i,opt у стенки */
  wallRatio: number;
  regimeAtWall: DissolutionRegime;
  /** Расход, при котором у стенки v_i = v_i,opt, л/мин */
  optimalRateAtWallLpm: number;
  /** Эквивалент числа Дамкёлера для визуализации: 0.29·v_opt/v_i у стенки */
  damkohlerEquivalent: number;
  injectionTimeMin: number;
  profile: { timeMin: number; radiusM: number }[];
}

export function regimeByRatio(ratio: number): DissolutionRegime {
  if (ratio < 0.1) return "face";
  if (ratio < 0.5) return "conical";
  if (ratio <= 3) return "wormhole";
  if (ratio <= 20) return "ramified";
  return "uniform";
}

export const REGIME_LABEL: Record<DissolutionRegime, string> = {
  face: "торцевое растворение (кислота тратится у стенки)",
  conical: "конические каналы",
  wormhole: "доминирующие червоточины (оптимум)",
  ramified: "ветвящиеся червоточины",
  uniform: "равномерное растворение",
};

export function buijseGlasbergenVelocity(vi: number, viOpt: number, pvBtOpt: number): number {
  if (vi <= 0) return 0;
  const r = vi / viOpt;
  const B = 1 - Math.exp(-4 * r * r);
  return (vi / pvBtOpt) * Math.pow(r, -1 / 3) * B * B;
}

export function calculateWormholes(input: WormholeInput): WormholeResult {
  const q = input.rateLpm / 60000; // м³/с
  const h = Math.max(0.5, input.payZoneM);
  const phi = Math.max(0.01, input.porosity);
  const rw = input.wellboreRadiusM;
  const viOpt = input.viOptCmMin / 100 / 60; // м/с
  const T = q > 0 ? input.acidVolumeM3 / q : 0; // с
  const vi = (r: number) => q / (2 * Math.PI * r * h * phi);

  let r = rw;
  const steps = 2000;
  const dt = T / steps;
  const profile: { timeMin: number; radiusM: number }[] = [{ timeMin: 0, radiusM: rw }];
  for (let i = 1; i <= steps; i++) {
    // RK2 по радиусу
    const k1 = buijseGlasbergenVelocity(vi(r), viOpt, input.pvBtOpt);
    const k2 = buijseGlasbergenVelocity(vi(r + 0.5 * dt * k1), viOpt, input.pvBtOpt);
    r += dt * k2;
    if (i % 100 === 0) profile.push({ timeMin: (i * dt) / 60, radiusM: r });
  }
  const viWall = vi(rw);
  const wallRatio = viWall / viOpt;
  return {
    wormholeRadiusM: r,
    wormholeLengthM: r - rw,
    viWallCmMin: viWall * 100 * 60,
    viFrontCmMin: vi(r) * 100 * 60,
    wallRatio,
    regimeAtWall: regimeByRatio(wallRatio),
    optimalRateAtWallLpm: viOpt * 2 * Math.PI * rw * h * phi * 60000,
    damkohlerEquivalent: 0.29 / Math.max(1e-6, wallRatio),
    injectionTimeMin: T / 60,
    profile,
  };
}

/**
 * Скин после обработки по зонам (стационарный радиальный приток):
 *   rw … r_t   — обработанная зона: червоточины (k → ∞) или восстановленная k
 *   r_t … r_d  — оставшееся повреждение с проницаемостью k_d
 *   r_d … re   — пласт с k
 * Червоточины (k → ∞):     S_d = (k/k_d)·ln(r_d/r_t) − ln(r_d/rw),  r_t < r_d
 *                           S_d = −ln(r_t/rw),                        r_t ≥ r_d
 * Восстановление до k:      S_d = (k/k_d − 1)·ln(r_d/r_t),            r_t < r_d;  0 при r_t ≥ r_d
 */
export function treatedDamageSkin(opts: {
  damageSkin: number;
  damageRadiusM: number;
  treatedRadiusM: number;
  wellboreRadiusM: number;
  wormholes: boolean;
}): { skinAfter: number; kOverKd: number } {
  const rw = opts.wellboreRadiusM;
  const rd = Math.max(rw * 1.01, opts.damageRadiusM);
  const rt = Math.max(rw, opts.treatedRadiusM);
  const lnD = Math.log(rd / rw);
  const kOverKd = 1 + Math.max(0, opts.damageSkin) / lnD; // из S_d = (k/k_d − 1)·ln(r_d/rw)
  if (opts.wormholes) {
    if (rt >= rd) return { skinAfter: -Math.log(rt / rw), kOverKd };
    return { skinAfter: kOverKd * Math.log(rd / rt) - Math.log(rd / rw), kOverKd };
  }
  if (rt >= rd) return { skinAfter: 0, kOverKd };
  return { skinAfter: (kOverKd - 1) * Math.log(rd / rt), kOverKd };
}
