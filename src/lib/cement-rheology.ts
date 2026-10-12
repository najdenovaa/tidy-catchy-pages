/**
 * Реология по показаниям ротационного вискозиметра (Fann 35, R1B1F1).
 * Подбор трёх моделей — Бингам, степенная, Гершель–Балкли — методом наименьших квадратов
 * по всем введённым показаниям; трение по Гершелю–Балкли по API RP 13D (2010).
 */

export const FANN_RPMS = [600, 300, 200, 100, 6, 3] as const;
export type FannRpm = (typeof FANN_RPMS)[number];

/** Показания шкалы (градусы) на скоростях 600/300/200/100/6/3 об/мин. 0 или пусто — не измерено. */
export interface FannReadings {
  r600?: number; r300?: number; r200?: number; r100?: number; r6?: number; r3?: number;
}

/** Гершель–Балкли в СИ: τ = τ0 + K·γ^n; τ0 — Па, K — Па·с^n. */
export interface HBParams { tau0: number; K: number; n: number }

export interface RheologyFit {
  points: { rpm: number; gamma: number; tau: number }[];
  bingham: { pv: number; ypPa: number; r2: number };
  powerLaw: { K: number; n: number; r2: number };
  hb: HBParams & { r2: number };
  /** Модель с наилучшим совпадением с замерами */
  best: "bingham" | "powerLaw" | "hb";
  /** Классические PV/YP по 600/300 (как в паспорте раствора) */
  pv600300: number;
  yp600300Pa: number;
  /** Отклонение Бингама от замера на 3 об/мин, % (насколько Бингам завышает напряжение при низких скоростях) */
  binghamLowShearErrorPct: number;
}

/** 1 об/мин ротора Fann (R1B1) = 1.7023 с⁻¹; 1 деление шкалы = 0.511 Па (1.0678 lbf/100ft²). */
export const RPM_TO_SHEAR = 1.7023;
export const DIAL_TO_PA = 0.511;

const key = (rpm: FannRpm) => `r${rpm}` as keyof FannReadings;

export function fannPoints(f: FannReadings | undefined): { rpm: number; gamma: number; tau: number }[] {
  if (!f) return [];
  return FANN_RPMS
    .map((rpm) => ({ rpm, dial: Number(f[key(rpm)]) }))
    .filter((p) => Number.isFinite(p.dial) && p.dial > 0)
    .map((p) => ({ rpm: p.rpm, gamma: p.rpm * RPM_TO_SHEAR, tau: p.dial * DIAL_TO_PA }));
}

/** Достаточно ли показаний для подбора: нужны 600 и 300 и ещё хотя бы одно. */
export function hasFann(f: FannReadings | undefined): boolean {
  const pts = fannPoints(f);
  return pts.length >= 3 && pts.some((p) => p.rpm === 600) && pts.some((p) => p.rpm === 300);
}

function r2Of(obs: number[], pred: number[]): number {
  const mean = obs.reduce((a, b) => a + b, 0) / obs.length;
  const sst = obs.reduce((a, o) => a + (o - mean) ** 2, 0);
  const sse = obs.reduce((a, o, i) => a + (o - pred[i]) ** 2, 0);
  return sst > 0 ? 1 - sse / sst : 1;
}

function linReg(x: number[], y: number[]): { a: number; b: number } {
  const n = x.length;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const b = sxx > 0 ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

/** Подбор моделей. Возвращает null, если показаний недостаточно. */
export function fitRheology(f: FannReadings | undefined): RheologyFit | null {
  if (!hasFann(f)) return null;
  const pts = fannPoints(f);
  const g = pts.map((p) => p.gamma), t = pts.map((p) => p.tau);

  // Бингам (МНК по всем точкам)
  const bl = linReg(g, t);
  const bPv = Math.max(0, bl.b), bYp = Math.max(0, bl.a);
  const bingham = { pv: bPv * 1000, ypPa: bYp, r2: r2Of(t, g.map((x) => bYp + bPv * x)) };

  // Степенная (МНК в логарифмах)
  const pl = linReg(g.map(Math.log), t.map(Math.log));
  const plK = Math.exp(pl.a), plN = pl.b;
  const powerLaw = { K: plK, n: plN, r2: r2Of(t, g.map((x) => plK * Math.pow(x, plN))) };

  // Гершель–Балкли: перебор τ0 в [0; 0.999·τmin], на каждом шаге — МНК в логарифмах, критерий — СКО по τ
  const tMin = Math.min(...t);
  let bestHb: HBParams & { r2: number } = { tau0: 0, K: plK, n: plN, r2: powerLaw.r2 };
  let bestSse = t.reduce((a, o, i) => a + (o - plK * Math.pow(g[i], plN)) ** 2, 0);
  const STEPS = 400;
  for (let i = 1; i <= STEPS; i++) {
    const tau0 = (tMin * 0.999 * i) / STEPS;
    const r = linReg(g.map(Math.log), t.map((x) => Math.log(x - tau0)));
    const K = Math.exp(r.a), n = r.b;
    if (!(n > 0) || !Number.isFinite(K)) continue;
    const pred = g.map((x) => tau0 + K * Math.pow(x, n));
    const sse = t.reduce((a, o, j) => a + (o - pred[j]) ** 2, 0);
    if (sse < bestSse) { bestSse = sse; bestHb = { tau0, K, n, r2: r2Of(t, pred) }; }
  }

  const r600 = Number(f!.r600), r300 = Number(f!.r300);
  const pv600300 = Math.max(0, r600 - r300);
  const yp600300Pa = Math.max(0, 2 * r300 - r600) * 0.4788;

  const p3 = pts.find((p) => p.rpm === 3) ?? pts.find((p) => p.rpm === 6);
  const binghamLowShearErrorPct = p3
    ? ((yp600300Pa + (pv600300 / 1000) * p3.gamma - p3.tau) / p3.tau) * 100
    : 0;

  const cands: [RheologyFit["best"], number][] = [["bingham", bingham.r2], ["powerLaw", powerLaw.r2], ["hb", bestHb.r2]];
  // ГБ имеет на 1 параметр больше — выбираем его, только если он заметно лучше
  cands[2][1] -= 0.002;
  const best = cands.sort((a, b) => b[1] - a[1])[0][0];

  return { points: pts, bingham, powerLaw, hb: bestHb, best, pv600300, yp600300Pa, binghamLowShearErrorPct };
}

/** Параметры ГБ для гидравлики: из показаний Fann, если они есть. */
export function hbFromFann(f: FannReadings | undefined): HBParams | undefined {
  const fit = fitRheology(f);
  if (!fit) return undefined;
  return { tau0: fit.hb.tau0, K: fit.hb.K, n: Math.min(1.2, Math.max(0.1, fit.hb.n)) };
}

export interface HBFrictionResult { pressureMPa: number; reynolds: number; regime: number; wallShearPa: number }

/**
 * Потери на трение для жидкости Гершеля–Балкли по API RP 13D (2010), СИ.
 * α = 0 — труба, α = 1 — кольцевой зазор (Dh = Do − Di).
 * γw = 8·G·v/Dh, G = ((3−α)n+1)/((4−α)n)·(1+α/2);
 * τw = ((4−α)/(3−α))^n·τ0 + K·γw^n;  Re_G = 8ρv²/τw;
 * f = (f_lam^12 + f_lt^12)^(1/12), f_lt = (f_tr^−8 + f_turb^−8)^(−1/8);
 * f_lam = 16/Re, f_tr = 16·Re/(3470−1370n)², f_turb = a/Re^b, a = (log n + 3.93)/50, b = (1.75 − log n)/7;
 * Δp = 2fρv²L/Dh.
 * При n = 1 ламинарная часть точно совпадает с формулами Бингама (32μv/D² + 16τ/3D; 48μv/Dh² + 6τ/Dh).
 */
export function hbFriction(
  hb: HBParams, velocityMs: number, dHydM: number, lengthM: number, densityKgM3: number, geometry: "pipe" | "annulus",
): HBFrictionResult {
  if (velocityMs <= 0 || dHydM <= 0 || lengthM <= 0) return { pressureMPa: 0, reynolds: 0, regime: 0, wallShearPa: 0 };
  const alpha = geometry === "annulus" ? 1 : 0;
  const n = Math.max(0.1, hb.n);
  const G = (((3 - alpha) * n + 1) / ((4 - alpha) * n)) * (1 + alpha / 2);
  const gw = (8 * G * velocityMs) / dHydM;
  const tw = Math.pow((4 - alpha) / (3 - alpha), n) * hb.tau0 + hb.K * Math.pow(gw, n);
  const Re = (8 * densityKgM3 * velocityMs * velocityMs) / Math.max(1e-9, tw);
  const reLam = 3470 - 1370 * n, reTurb = 4270 - 1370 * n;
  const fLam = 16 / Re;
  const fTr = (16 * Re) / (reLam * reLam);
  const a = (Math.log10(n) + 3.93) / 50, b = (1.75 - Math.log10(n)) / 7;
  const fTurb = a / Math.pow(Re, b);
  const fLt = Math.pow(Math.pow(fTr, -8) + Math.pow(fTurb, -8), -1 / 8);
  const f = Math.pow(Math.pow(fLam, 12) + Math.pow(fLt, 12), 1 / 12);
  const dp = (2 * f * densityKgM3 * velocityMs * velocityMs * lengthM) / dHydM;
  const regime = Re < reLam ? 0 : Re > reTurb ? 1 : 0.5;
  return { pressureMPa: dp / 1e6, reynolds: Re, regime, wallShearPa: tw };
}

/** Индекс течения n для поправки на эксцентриситет: из ГБ, если есть. */
export function flowIndexN(hb: HBParams | undefined, pv: number, ypPa: number): number {
  if (hb) return Math.min(1, Math.max(0.1, hb.n));
  const ypLbf = ypPa / 0.4788;
  const t300 = Math.max(1e-3, pv + ypLbf);
  const t600 = Math.max(t300 * 1.0001, 2 * pv + ypLbf);
  return Math.min(1, Math.max(0.1, 3.32 * Math.log10(t600 / t300)));
}
