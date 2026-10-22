/**
 * Двумерная (осреднённая по зазору) модель вытеснения в эксцентричном затрубье.
 *
 * Затрубье «разворачивается» в лист: z — глубина по стволу (вниз), s — дуга по окружности
 * от широкой стороны (θ = 0, верхняя сторона ствола) до узкой (θ = π, нижняя сторона, куда
 * ложится колонна). Без вращения по симметрии считается половина окружности, с вращением —
 * вся окружность (вращение ломает симметрию). Зазор h(θ) = H·(1 + e·cos θ), e = 1 − standoff.
 *
 * Течение вязкопластичной жидкости (Бингам) в узкой щели — расход на единицу ширины
 * (формула Букингема для щели):
 *   q = −C(|G|)·G,  C = h³/(12μ)·(1 − 3/2·χ + 1/2·χ³),  χ = 2τ₀/(h|G|) (χ ≥ 1 → течения нет),
 *   G = ∇p − ρ·g — модифицированный градиент давления (g по оси: g·cos β; по окружности:
 *   g·sin β·sin θ, к нижней стороне).
 * Вращение колонны (окружная скорость стенки U = ω·r): течение Куэтта добавляет окружной
 * расход h·U/2, а сдвиг от вращения разрушает структуру по всему зазору — для осевого течения
 * жидкость ведёт себя как вязкая с кажущейся вязкостью μ + τ₀·h/U (без порога течения).
 * Выдержка после продавки (расход 0): структура жидкостей растёт со временем (СНС), тяжёлое
 * стекает к нижней стенке, пока структура не остановит перетоки.
 * Несжимаемость ∇·q = 0 даёт эллиптическое уравнение для давления; нелинейность по |G|
 * снимается итерациями Пикара с регуляризацией (застойные зоны — C → ε·C₀).
 * Подход Bittleston, Ferguson, Frigaard (2002), Pelipenko, Frigaard (2004); вращение — в
 * духе работ той же группы по вращающейся колонне (упрощённо).
 *
 * Перенос жидкостей: объёмные доли c_k, ∂(h c_k)/∂t + ∇·(q c_k) = 0; по оси — явная схема
 * MUSCL с ограничителем minmod, по окружности — неявная противопоточная. Свойства смеси — по долям.
 *
 * Ограничения: ламинарный режим (турбулентное вытеснение считается консервативно), без
 * расхаживания колонны, рост СНС — типовые кривые (не лабораторные).
 */

export interface D2Fluid {
  name: string;
  /** кг/м³ */
  density: number;
  /** Пластическая вязкость, Па·с */
  pv: number;
  /** Предельное напряжение сдвига (ДНС), Па */
  yp: number;
  kind: "mud" | "spacer" | "cement" | "other";
}

/** Порция, входящая в затрубье у башмака (в порядке выхода). */
export interface D2Stage {
  fluid: number;
  volumeM3: number;
  /** Расход, м³/с (0 — выдержка длительностью holdS) */
  rateM3s: number;
  /** Длительность выдержки без закачки, с (для rateM3s = 0) */
  holdS?: number;
}

export interface D2Geometry {
  /** Радиус ствола (или предыдущей колонны), м */
  rHole: number;
  /** Наружный радиус колонны, м */
  rCasing: number;
  /** Отступ от стенки 0…1 (1 — по центру) */
  standoff: number;
  /** Зенитный угол, ° */
  inclDeg: number;
}

export interface D2Input {
  /** Верх расчётной области (MD), м */
  zTop: number;
  /** Низ — башмак (MD), м */
  zBot: number;
  geom: (md: number) => D2Geometry;
  /** fluids[0] — жидкость, которой заполнено затрубье в начале (буровой раствор) */
  fluids: D2Fluid[];
  stages: D2Stage[];
  /** Ячеек на половину окружности */
  nTheta?: number;
  nZ?: number;
  maxSnapshots?: number;
  /** Вращение колонны при закачке, об/мин (0 — без вращения) */
  rotationRpm?: number;
  /** Выдержка после продавки, мин (0 — не считать) */
  settleMin?: number;
  onProgress?: (frac: number) => void;
  // ── Режим «лист» (канал за колонной, РИР): произвольная геометрия, источник, выходы ──
  /** Раскрытие (гидравлический зазор), м, по глубине и углу (θ: 0 — верх ствола) */
  customGap?: (md: number, theta: number) => number;
  /** Ёмкостная толщина (объём на единицу площади), м; по умолчанию = раскрытие */
  storageGap?: (md: number, theta: number) => number;
  /** Длина окружности листа, м (для customGap) */
  arcLength?: number;
  /** Считать всю окружность без вращения */
  fullCircle?: boolean;
  /** Источник вместо притока снизу: интервал глубин и сектор углов (рад, может переходить через 0) */
  source?: { mdTop: number; mdBot: number; thetaFrom: number; thetaTo: number };
  /** Выходы с заданным давлением: верх (по умолчанию) и/или низ */
  outlets?: { top: boolean; bottom: boolean };
  /** Изменение свойств во времени: множители вязкости и ДНС по времени с первого входа жидкости, с */
  fluidTime?: (fluid: number, tSinceIn: number) => { mu: number; ty: number };
  /** Кольматация: подвижность ячейки exp(−k·S), S — прошедший через ячейку объём жидкости fluid / объём ячейки */
  plugging?: { fluid: number; k: number };
}

export interface D2Snapshot {
  t: number;
  /** Доли жидкостей, квантованные 0…255: [fluid][cell], cell = j·nTheta + i */
  frac: Uint8Array;
  /** Какая порция входит в затрубье (−1 — выдержка) */
  stage: number;
}

export interface D2Row {
  md: number;
  /** Доля бурового раствора в сечении (по объёму) */
  mud: number;
  /** Доля буферов */
  spacer: number;
  /** Доля цемента */
  cement: number;
  /** Доля окружности, где цемента > 70 % */
  coverage: number;
  /** Канал: на узкой стороне цемента < 50 % при хорошем заполнении широкой */
  channel: boolean;
  /** Раствор на узкой стороне не сдвигается (ДНС не преодолено) */
  staticNarrow: boolean;
  standoff: number;
  inclDeg: number;
}

export interface D2Stats {
  /** Средняя доля цемента в интервале цементирования, % */
  cementFillPct: number;
  /** Средняя доля бурового раствора (невытесненный), % */
  mudLeftPct: number;
  /** Метров интервала с каналом на узкой стороне */
  channelM: number;
  /** Метров интервала с неподвижным раствором на узкой стороне */
  staticM: number;
  worst: { topMD: number; bottomMD: number; minCoverage: number }[];
}

export interface D2Result {
  /** Число ячеек по окружности в расчёте (на половину или на всю окружность) */
  nTheta: number;
  /** true — считалась вся окружность (с вращением) */
  full: boolean;
  nZ: number;
  zCenters: Float64Array;
  /** θ центров ячеек, рад (0 — широкая сторона) */
  thetaCenters: Float64Array;
  /** Ширина зазора, м [cell] */
  gap: Float32Array;
  fluids: D2Fluid[];
  snapshots: D2Snapshot[];
  /** Номер снимка, на котором закончилась продавка */
  pumpEndSnap: number;
  rows: D2Row[];
  /** Профиль по глубине на конец продавки (до выдержки) */
  rowsPumpEnd: D2Row[];
  /** Итоговые доли (не квантованные) [fluid][cell] */
  finalFrac: Float32Array[];
  /** Интервал, где по проекту должен быть цемент */
  cementTopMD: number;
  /** Смещение «центра тяжести» кровли цемента за выдержку, м (+ — вниз) */
  settleTopShiftM: number;
  summary: D2Stats & {
    totalTimeS: number;
    pumpTimeS: number;
    settleS: number;
    rotationRpm: number;
    steps: number;
    pumpEnd: D2Stats;
    /** Баланс объёмов: (вошло − вышло − прирост) / вошло, % */
    massBalanceErrPct: number;
    computeMs: number;
    pcgIters: number;
  };
  warnings: string[];
}

const G = 9.81;

/** Доля «разрушенной» вращением структуры: 1/(1 + Bn/4), Bn = τ₀h/(μU). */
export function rotEff(h: number, mu: number, ty: number, U: number): number {
  if (U <= 1e-6) return 0;
  const bn = (ty * h) / (Math.max(1e-4, mu) * U);
  return 1 / (1 + bn / 4);
}

function buckingham(h: number, mu: number, ty: number, gAbs: number, eps: number, U: number): number {
  const base = (h * h * h) / (12 * Math.max(1e-4, mu));
  // вращение разрушает структуру по всему зазору: кажущаяся вязкость μ + τ₀·h/U
  // В эксцентричном зазоре окружной противоток образует ядра (плаги) при большом числе
  // Бингама вращения Bn = τ₀h/(μU) — эффект ослабляется (консервативная поправка)
  const rot = U > 1e-6 ? ((h * h * h) / (12 * (Math.max(1e-4, mu) + (ty * h) / U))) * rotEff(h, mu, ty, U) : 0;
  if (ty <= 0) return base;
  let cb: number;
  if (gAbs <= 0) cb = base * eps;
  else {
    const chi = (2 * ty) / (h * gAbs);
    cb = chi >= 1 ? base * eps : base * Math.max(eps, 1 - 1.5 * chi + 0.5 * chi * chi * chi);
  }
  return Math.max(cb, rot);
}

/** Рост СНС при остановке: множитель к ДНС через tS секунд покоя (типовые кривые). */
export function gelMultiplier(kind: D2Fluid["kind"], tS: number): number {
  if (tS <= 0) return 1;
  if (kind === "cement") return 1 + 2.0 * (1 - Math.exp(-tS / 1200)); // ~2,6× к 30 мин
  if (kind === "mud") return 1 + 0.6 * (1 - Math.exp(-tS / 300));   // СНС 10 мин ≈ 1,5× ДНС
  return 1 + 0.4 * (1 - Math.exp(-tS / 600));
}

/** Трёхдиагональная система (a — под диагональю, c — над), при cyclic — с замыканием a[0]↔x[n−1], c[n−1]↔x[0]. */
function makeTriSolver(n: number) {
  const bb = new Float64Array(n), cp = new Float64Array(n), dp = new Float64Array(n), u = new Float64Array(n), zz = new Float64Array(n), rr = new Float64Array(n);
  const thomas = (a: Float64Array, b: Float64Array, c: Float64Array, r: Float64Array, x: Float64Array) => {
    cp[0] = c[0] / b[0]; dp[0] = r[0] / b[0];
    for (let i = 1; i < n; i++) { const m = b[i] - a[i] * cp[i - 1]; cp[i] = c[i] / m; dp[i] = (r[i] - a[i] * dp[i - 1]) / m; }
    x[n - 1] = dp[n - 1];
    for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  };
  return (a: Float64Array, b: Float64Array, c: Float64Array, r: Float64Array, x: Float64Array, cyclic: boolean) => {
    if (!cyclic) {
      const a0 = a[0], cn = c[n - 1]; a[0] = 0; c[n - 1] = 0;
      thomas(a, b, c, r, x); a[0] = a0; c[n - 1] = cn; return;
    }
    // Шерман–Моррисон
    const alpha = c[n - 1], beta = a[0], gamma = -b[0];
    bb.set(b); bb[0] = b[0] - gamma; bb[n - 1] = b[n - 1] - (alpha * beta) / gamma;
    const a0 = a[0], cn = c[n - 1]; a[0] = 0; c[n - 1] = 0;
    rr.set(r); thomas(a, bb, c, rr, x);
    u.fill(0); u[0] = gamma; u[n - 1] = alpha; thomas(a, bb, c, u, zz);
    a[0] = a0; c[n - 1] = cn;
    const fact = (x[0] + (beta * x[n - 1]) / gamma) / (1 + zz[0] + (beta * zz[n - 1]) / gamma);
    for (let i = 0; i < n; i++) x[i] -= fact * zz[i];
  };
}

export function simulateDisplacement2D(inp: D2Input): D2Result {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const warnings: string[] = [];
  const rpm = Math.max(0, inp.rotationRpm ?? 0);
  const sheet = !!inp.customGap;
  const full = rpm > 0 || !!inp.fullCircle;
  const nHalf = Math.max(6, Math.round(inp.nTheta ?? 16));
  const nT = full ? 2 * nHalf : nHalf;
  const span = full ? 2 * Math.PI : Math.PI;
  const share = full ? 1 : 0.5; // доля окружности в расчёте
  const outTop = inp.outlets ? inp.outlets.top : true, outBot = inp.outlets ? inp.outlets.bottom : false;
  const L = Math.max(10, inp.zBot - inp.zTop);
  const nZ = Math.max(20, Math.round(inp.nZ ?? Math.min(240, Math.max(60, L / 5))));
  const dz = L / nZ;
  const N = nT * nZ;
  const nF = inp.fluids.length;
  const EPS = 1e-4;
  const nTF = full ? nT : nT - 1; // θ-граней в ряду
  const nb = (i: number) => (i + 1) % nT;

  // ── Геометрия ──
  const zC = new Float64Array(nZ), thC = new Float64Array(nT);
  const ds = new Float64Array(nZ), cosB = new Float64Array(nZ), sinB = new Float64Array(nZ);
  const sOff = new Float64Array(nZ), incl = new Float64Array(nZ), Uw = new Float64Array(nZ);
  const h = new Float32Array(N), V = new Float64Array(N);
  for (let i = 0; i < nT; i++) thC[i] = ((i + 0.5) * span) / nT;
  const omega = (rpm * 2 * Math.PI) / 60;
  for (let j = 0; j < nZ; j++) {
    const md = inp.zTop + (j + 0.5) * dz;
    zC[j] = md;
    const g = inp.geom(md);
    const rO = Math.max(g.rHole, g.rCasing + 0.003), rI = g.rCasing;
    const Hm = rO - rI, e = Math.min(0.95, Math.max(0, 1 - g.standoff));
    sOff[j] = 1 - e; incl[j] = g.inclDeg;
    ds[j] = sheet ? ((inp.arcLength ?? 2 * Math.PI * rI) * (span / (2 * Math.PI))) / nT : (((rO + rI) / 2) * span) / nT;
    Uw[j] = omega * rI;
    const b = (g.inclDeg * Math.PI) / 180;
    cosB[j] = Math.cos(b); sinB[j] = Math.sin(b);
    for (let i = 0; i < nT; i++) {
      const k = j * nT + i;
      h[k] = sheet ? Math.max(1e-7, inp.customGap!(md, thC[i])) : Hm * (1 + e * Math.cos(thC[i]));
      V[k] = (sheet && inp.storageGap ? Math.max(1e-7, inp.storageGap(md, thC[i])) : h[k]) * ds[j] * dz;
    }
  }

  // ── Доли жидкостей ──
  const c: Float64Array[] = Array.from({ length: nF }, (_, f) => { const a = new Float64Array(N); if (f === 0) a.fill(1); return a; });
  const rho = new Float64Array(N), mu = new Float64Array(N), ty = new Float64Array(N);
  const gelMul = new Float64Array(nF).fill(1), muMul = new Float64Array(nF).fill(1), tyMul = new Float64Array(nF).fill(1);
  const firstIn = new Float64Array(nF).fill(-1);
  const mob = new Float64Array(N).fill(1), S = new Float64Array(N);
  const mixProps = () => {
    for (let k = 0; k < N; k++) {
      let r = 0, m = 0, y = 0;
      for (let f = 0; f < nF; f++) { const w = c[f][k]; if (w <= 0) continue; const fl = inp.fluids[f]; r += w * fl.density; m += w * Math.log(Math.max(1e-4, fl.pv * muMul[f])); y += w * fl.yp * gelMul[f] * tyMul[f]; }
      rho[k] = r; mu[k] = Math.exp(m); ty[k] = y;
    }
  };

  // ── Давление: коэффициенты граней ──
  // θ-грань между (i, j) и (i+1 mod nT, j): j*nTF+i ; z-грань между (i, j) и (i, j+1): j*nT+i
  const nFT = nTF * nZ, nFZ = nT * (nZ - 1);
  const Tt = new Float64Array(nFT), Bt = new Float64Array(nFT);
  const Tz = new Float64Array(nFZ), Bz = new Float64Array(nFZ);
  const Ttop = new Float64Array(nT), Btop = new Float64Array(nT);
  const p = new Float64Array(N), gAbs = new Float64Array(N);
  const Ft = new Float64Array(nFT), Fz = new Float64Array(nFZ), Ftop = new Float64Array(nT);
  const Qin = new Float64Array(N);
  const Tbot = new Float64Array(nT), Bbot = new Float64Array(nT), Fbot = new Float64Array(nT);
  // давление на нижнем выходе — гидростатика исходной жидкости
  let pBot = 0; for (let j = 0; j < nZ; j++) pBot += inp.fluids[0].density * G * cosB[j] * dz;
  // ячейки источника
  const srcCells: number[] = [];
  if (inp.source) {
    const sc = inp.source;
    const inSector = (th: number) => { const a = ((th - sc.thetaFrom) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); const w = ((sc.thetaTo - sc.thetaFrom) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI; return a <= w; };
    for (let j = 0; j < nZ; j++) if (zC[j] + dz / 2 >= sc.mdTop && zC[j] - dz / 2 <= sc.mdBot) for (let i = 0; i < nT; i++) if (inSector(thC[i])) srcCells.push(j * nT + i);
    if (!srcCells.length) { const j = Math.min(nZ - 1, Math.max(0, Math.floor((sc.mdTop - inp.zTop) / dz))); srcCells.push(j * nT); }
  } else for (let i = 0; i < nT; i++) srcCells.push((nZ - 1) * nT + i);
  const diag = new Float64Array(N), rhs = new Float64Array(N);
  const r = new Float64Array(N), zv = new Float64Array(N), d = new Float64Array(N), Ad = new Float64Array(N);
  const ta = new Float64Array(nT), tb = new Float64Array(nT), tc = new Float64Array(nT), tr = new Float64Array(nT), tx = new Float64Array(nT);
  const tri = makeTriSolver(nT);
  let gInit = false, pcgIters = 0;
  let U = 0; // множитель вращения (1 — при закачке, 0 — на выдержке)

  const faceGap = (k1: number, k2: number) => Math.sqrt(h[k1] * h[k2]);

  const assemble = (Qtot: number) => {
    for (let j = 0; j < nZ; j++) {
      const Uj = Uw[j] * U;
      for (let i = 0; i < nTF; i++) {
        const k = j * nT + i, k2 = j * nT + nb(i), fi = j * nTF + i;
        const hf = faceGap(k, k2), muf = Math.sqrt(mu[k] * mu[k2]), tyf = 0.5 * (ty[k] + ty[k2]), gf = 0.5 * (gAbs[k] + gAbs[k2]);
        const C = buckingham(hf, muf, tyf, gf, EPS, Uj) * Math.sqrt(mob[k] * mob[k2]);
        const T = (C * dz) / ds[j];
        const thF = ((i + 1) * span) / nT;
        Tt[fi] = T;
        Bt[fi] = T * 0.5 * (rho[k] + rho[k2]) * G * sinB[j] * Math.sin(thF) * ds[j] + (Uj > 0 ? 0.5 * hf * Uj * dz * rotEff(hf, muf, tyf, Uj) : 0);
      }
    }
    for (let j = 0; j < nZ - 1; j++) {
      const dsf = 0.5 * (ds[j] + ds[j + 1]), cb = 0.5 * (cosB[j] + cosB[j + 1]), Uj = 0.5 * (Uw[j] + Uw[j + 1]) * U;
      for (let i = 0; i < nT; i++) {
        const k = j * nT + i, k2 = k + nT, fi = k;
        const hf = faceGap(k, k2), muf = Math.sqrt(mu[k] * mu[k2]), tyf = 0.5 * (ty[k] + ty[k2]), gf = 0.5 * (gAbs[k] + gAbs[k2]);
        const C = buckingham(hf, muf, tyf, gf, EPS, Uj) * Math.sqrt(mob[k] * mob[k2]);
        const T = (C * dsf) / dz;
        Tz[fi] = T; Bz[fi] = T * 0.5 * (rho[k] + rho[k2]) * G * cb * dz;
      }
    }
    for (let i = 0; i < nT; i++) {
      if (!outTop) { Ttop[i] = 0; Btop[i] = 0; continue; }
      const C = buckingham(h[i], mu[i], ty[i], gAbs[i], EPS, Uw[0] * U) * mob[i];
      const T = (C * ds[0]) / (dz / 2);
      Ttop[i] = T; Btop[i] = T * rho[i] * G * -cosB[0] * (dz / 2);
    }
    const jb = nZ - 1;
    for (let i = 0; i < nT; i++) {
      const k = jb * nT + i;
      if (!outBot) { Tbot[i] = 0; Bbot[i] = 0; continue; }
      const C = buckingham(h[k], mu[k], ty[k], gAbs[k], EPS, Uw[jb] * U) * mob[k];
      const T = (C * ds[jb]) / (dz / 2);
      Tbot[i] = T; Bbot[i] = T * rho[k] * G * cosB[jb] * (dz / 2);
    }
    let sumC = 0;
    Qin.fill(0);
    for (const k of srcCells) { const j = Math.floor(k / nT); Qin[k] = buckingham(h[k], mu[k], ty[k], gAbs[k] || 1e3, EPS, Uw[j] * U) * ds[j] * mob[k]; sumC += Qin[k]; }
    for (const k of srcCells) Qin[k] = sumC > 0 ? (Qtot * Qin[k]) / sumC : Qtot / srcCells.length;
    diag.fill(0); rhs.fill(0);
    for (let j = 0; j < nZ; j++) for (let i = 0; i < nTF; i++) {
      const fi = j * nTF + i, a = j * nT + i, b = j * nT + nb(i);
      diag[a] += Tt[fi]; diag[b] += Tt[fi];
      rhs[a] -= Bt[fi]; rhs[b] += Bt[fi];
    }
    for (let fi = 0; fi < nFZ; fi++) {
      const a = fi, b = fi + nT;
      diag[a] += Tz[fi]; diag[b] += Tz[fi];
      rhs[a] -= Bz[fi]; rhs[b] += Bz[fi];
    }
    for (let i = 0; i < nT; i++) { diag[i] += Ttop[i]; rhs[i] -= Btop[i]; }
    for (let i = 0; i < nT; i++) { const k = (nZ - 1) * nT + i; diag[k] += Tbot[i]; rhs[k] += Tbot[i] * pBot - Bbot[i]; }
    for (const k of srcCells) rhs[k] += Qin[k];
  };

  const matvec = (x: Float64Array, y: Float64Array) => {
    for (let k = 0; k < N; k++) y[k] = diag[k] * x[k];
    for (let j = 0; j < nZ; j++) for (let i = 0; i < nTF; i++) {
      const fi = j * nTF + i, a = j * nT + i, b = j * nT + nb(i), T = Tt[fi];
      y[a] -= T * x[b]; y[b] -= T * x[a];
    }
    for (let fi = 0; fi < nFZ; fi++) { const a = fi, b = fi + nT, T = Tz[fi]; y[a] -= T * x[b]; y[b] -= T * x[a]; }
  };
  // Точное решение по окружности в каждом ряду (трёхдиагональная / циклическая система)
  const precond = (x: Float64Array, y: Float64Array) => {
    for (let j = 0; j < nZ; j++) {
      const o = j * nT;
      for (let i = 0; i < nT; i++) {
        tb[i] = diag[o + i];
        ta[i] = i > 0 ? -Tt[j * nTF + i - 1] : full ? -Tt[j * nTF + nT - 1] : 0;
        tc[i] = i < nT - 1 ? -Tt[j * nTF + i] : full ? -Tt[j * nTF + nT - 1] : 0;
        tr[i] = x[o + i];
      }
      tri(ta, tb, tc, tr, tx, full);
      for (let i = 0; i < nT; i++) y[o + i] = tx[i];
    }
  };
  // Двухуровневый: грубая поправка по глубине (ряды осреднены по окружности) + точные решения по окружности
  const cA = new Float64Array(nZ), cB = new Float64Array(nZ), cC = new Float64Array(nZ), cR = new Float64Array(nZ), cX = new Float64Array(nZ), b2 = new Float64Array(nZ), r2 = new Float64Array(nZ);
  const y1 = new Float64Array(N), rt = new Float64Array(N), Ay = new Float64Array(N), yl = new Float64Array(N);
  const coarseSetup = () => {
    for (let j = 0; j < nZ; j++) {
      let up = 0, dn = 0;
      for (let i = 0; i < nT; i++) { if (j > 0) up += Tz[(j - 1) * nT + i]; if (j < nZ - 1) dn += Tz[j * nT + i]; }
      let top = 0; if (j === 0) for (let i = 0; i < nT; i++) top += Ttop[i];
      if (j === nZ - 1) for (let i = 0; i < nT; i++) top += Tbot[i];
      cA[j] = -up; cC[j] = -dn; cB[j] = up + dn + top + 1e-30;
    }
  };
  const coarse = (x: Float64Array, y: Float64Array) => {
    for (let j = 0; j < nZ; j++) { let sm = 0; for (let i = 0; i < nT; i++) sm += x[j * nT + i]; cR[j] = sm; }
    b2.set(cB); r2.set(cR);
    for (let j = 1; j < nZ; j++) { const m = cA[j] / b2[j - 1]; b2[j] -= m * cC[j - 1]; r2[j] -= m * r2[j - 1]; }
    cX[nZ - 1] = r2[nZ - 1] / b2[nZ - 1];
    for (let j = nZ - 2; j >= 0; j--) cX[j] = (r2[j] - cC[j] * cX[j + 1]) / b2[j];
    for (let j = 0; j < nZ; j++) for (let i = 0; i < nT; i++) y[j * nT + i] = cX[j];
  };
  const precond2 = (x: Float64Array, y: Float64Array) => {
    coarse(x, y1);
    matvec(y1, Ay); for (let k = 0; k < N; k++) rt[k] = x[k] - Ay[k];
    precond(rt, yl); for (let k = 0; k < N; k++) y1[k] += yl[k];
    matvec(y1, Ay); for (let k = 0; k < N; k++) rt[k] = x[k] - Ay[k];
    coarse(rt, yl); for (let k = 0; k < N; k++) y[k] = y1[k] + yl[k];
  };
  const pcg = (maxIt: number, tol: number) => {
    coarseSetup();
    matvec(p, Ad);
    let bn = 0; for (let k = 0; k < N; k++) { r[k] = rhs[k] - Ad[k]; bn += rhs[k] * rhs[k]; }
    bn = Math.sqrt(bn) || 1;
    precond2(r, zv); d.set(zv);
    let rz = 0; for (let k = 0; k < N; k++) rz += r[k] * zv[k];
    for (let it = 0; it < maxIt; it++) {
      matvec(d, Ad);
      let dAd = 0; for (let k = 0; k < N; k++) dAd += d[k] * Ad[k];
      if (!(dAd > 0)) return it;
      const al = rz / dAd;
      let rn = 0;
      for (let k = 0; k < N; k++) { p[k] += al * d[k]; r[k] -= al * Ad[k]; rn += r[k] * r[k]; }
      if (Math.sqrt(rn) / bn < tol) return it + 1;
      precond2(r, zv);
      let rz2 = 0; for (let k = 0; k < N; k++) rz2 += r[k] * zv[k];
      const be = rz2 / rz; rz = rz2;
      for (let k = 0; k < N; k++) d[k] = zv[k] + be * d[k];
    }
    return maxIt;
  };
  const fluxesAndG = () => {
    for (let j = 0; j < nZ; j++) for (let i = 0; i < nTF; i++) {
      const fi = j * nTF + i, a = j * nT + i, b = j * nT + nb(i);
      Ft[fi] = -Tt[fi] * (p[b] - p[a]) + Bt[fi];
    }
    for (let fi = 0; fi < nFZ; fi++) { const a = fi, b = fi + nT; Fz[fi] = -Tz[fi] * (p[b] - p[a]) + Bz[fi]; }
    for (let i = 0; i < nT; i++) Ftop[i] = -Ttop[i] * (0 - p[i]) + Btop[i]; // наружу через верх
    for (let i = 0; i < nT; i++) { const k = (nZ - 1) * nT + i; Fbot[i] = -Tbot[i] * (pBot - p[k]) + Bbot[i]; } // наружу через низ
    for (let j = 0; j < nZ; j++) for (let i = 0; i < nT; i++) {
      const k = j * nT + i;
      const pu = j > 0 ? p[k - nT] : 0, pd = j < nZ - 1 ? p[k + nT] : p[k];
      const du = j > 0 ? dz : dz / 2, dd = j < nZ - 1 ? dz : 1e9;
      const gz = (j < nZ - 1 ? (pd - pu) / (du + dd) : (p[k] - pu) / du) - rho[k] * G * cosB[j];
      const il = i > 0 ? i - 1 : full ? nT - 1 : i, ir = i < nT - 1 ? i + 1 : full ? 0 : i;
      const nsp = (il !== i ? 1 : 0) + (ir !== i ? 1 : 0);
      const gt = (p[j * nT + ir] - p[j * nT + il]) / (Math.max(1, nsp) * ds[j]) - rho[k] * G * sinB[j] * Math.sin(thC[i]);
      gAbs[k] = Math.sqrt(gz * gz + gt * gt);
    }
  };
  const solvePressure = (Qtot: number, picard: number) => {
    for (let it = 0; it < picard; it++) {
      assemble(Qtot);
      pcgIters += pcg(it === picard - 1 ? 200 : 60, 1e-6);
      fluxesAndG();
    }
  };

  // ── Перенос ──
  const minmod = (a: number, b: number) => (a * b <= 0 ? 0 : Math.abs(a) < Math.abs(b) ? a : b);
  const newC: Float64Array[] = Array.from({ length: nF }, () => new Float64Array(N));
  const axNet = new Float64Array(N);
  const transport = (dt: number, inFluid: number) => {
    for (let f = 0; f < nF; f++) {
      const cf = c[f], out = newC[f];
      axNet.fill(0);
      for (let fi = 0; fi < nFZ; fi++) {
        const a = fi, b = fi + nT, F = Fz[fi];
        let val: number;
        if (F >= 0) {
          const up = a - nT >= 0 ? cf[a - nT] : cf[a];
          val = cf[a] + 0.5 * minmod(cf[a] - up, cf[b] - cf[a]);
        } else {
          const dn = b + nT < N ? cf[b + nT] : (sheet ? cf[b] : (f === inFluid ? 1 : 0));
          val = cf[b] + 0.5 * minmod(cf[b] - dn, cf[a] - cf[b]);
        }
        const fl = F * dt * val;
        axNet[a] -= fl; axNet[b] += fl;
      }
      for (let i = 0; i < nT; i++) {
        const F = Ftop[i];
        axNet[i] -= (F >= 0 ? F * cf[i] : F * (f === 0 ? 1 : 0)) * dt;
        const kb = (nZ - 1) * nT + i, Fb = Fbot[i];
        if (Fb !== 0) axNet[kb] -= (Fb >= 0 ? Fb * cf[kb] : Fb * (f === 0 ? 1 : 0)) * dt;
      }
      if (inFluid >= 0 && f === inFluid) for (const k of srcCells) axNet[k] += Qin[k] * dt;
      // неявно по окружности (противопоточно), ряд за рядом
      for (let j = 0; j < nZ; j++) {
        const o = j * nT;
        for (let i = 0; i < nT; i++) {
          const k = o + i;
          let dg = V[k], lo = 0, upc = 0;
          const fL = i > 0 ? j * nTF + i - 1 : full ? j * nTF + nT - 1 : -1; // грань слева (из i−1 в i)
          const fR = i < nT - 1 || full ? j * nTF + i : -1;                 // грань справа (из i в i+1)
          if (fL >= 0) { const F = Ft[fL]; if (F < 0) dg += -F * dt; else lo = -F * dt; }
          if (fR >= 0) { const F = Ft[fR]; if (F > 0) dg += F * dt; else upc = F * dt; }
          tb[i] = dg; ta[i] = lo; tc[i] = upc;
          tr[i] = V[k] * cf[k] + axNet[k];
        }
        tri(ta, tb, tc, tr, tx, full);
        for (let i = 0; i < nT; i++) out[o + i] = Math.min(1, Math.max(0, tx[i]));
      }
    }
    for (let k = 0; k < N; k++) {
      let s = 0; for (let f = 0; f < nF; f++) s += newC[f][k];
      const inv = s > 1e-9 ? 1 / s : 0;
      for (let f = 0; f < nF; f++) c[f][k] = s > 1e-9 ? newC[f][k] * inv : f === 0 ? 1 : 0;
    }
  };
  const stepDt = (cap: number) => {
    let dtA = Infinity, dtT = Infinity;
    for (let k = 0; k < N; k++) {
      const j = Math.floor(k / nT), i = k - j * nT;
      let outA = 0, outT = 0;
      if (j > 0) { const F = Fz[k - nT]; if (F < 0) outA += -F; } else { const F = Ftop[i]; if (F > 0) outA += F; }
      if (j < nZ - 1) { const F = Fz[k]; if (F > 0) outA += F; } else { const F = Fbot[i]; if (F > 0) outA += F; }
      if (Qin[k] > 0) outA += Qin[k];
      const fL = i > 0 ? j * nTF + i - 1 : full ? j * nTF + nT - 1 : -1;
      const fR = i < nT - 1 || full ? j * nTF + i : -1;
      if (fL >= 0) { const F = Ft[fL]; if (F < 0) outT += -F; }
      if (fR >= 0) { const F = Ft[fR]; if (F > 0) outT += F; }
      if (outA > 0) dtA = Math.min(dtA, (0.45 * V[k]) / outA);
      if (outT > 0) dtT = Math.min(dtT, (0.45 * V[k]) / outT);
    }
    const dt = Math.min(dtA, dtT * (full ? 20 : 8), cap);
    return Number.isFinite(dt) && dt > 0 ? dt : Math.min(5, cap);
  };

  // ── Итоги по глубине ──
  const isCem = inp.fluids.map((f) => f.kind === "cement"), isSp = inp.fluids.map((f) => f.kind === "spacer");
  const stages = inp.stages.filter((s) => (s.volumeM3 > 1e-9 && s.rateM3s > 1e-9) || (s.rateM3s <= 1e-9 && (s.holdS ?? 0) > 0));
  const stageDur = (s: D2Stage) => (s.rateM3s > 1e-9 ? s.volumeM3 / s.rateM3s : s.holdS ?? 0);
  const cemVol = (stages.filter((s) => isCem[s.fluid]).reduce((a, s) => a + s.volumeM3, 0)) * share;
  let acc = 0, cementTopMD = inp.zBot;
  for (let j = nZ - 1; j >= 0; j--) { let v = 0; for (let i = 0; i < nT; i++) v += V[j * nT + i]; acc += v; cementTopMD = zC[j] - dz / 2; if (acc >= cemVol) break; }
  // ячейки узкой (θ ≈ π) и широкой (θ ≈ 0) стороны
  const iN = full ? [nT / 2 - 1, nT / 2] : [nT - 1];
  const iW = full ? [0, nT - 1] : [0];
  const stats = (): { rows: D2Row[]; s: D2Stats } => {
    const rows: D2Row[] = [];
    for (let j = 0; j < nZ; j++) {
      let hs = 0, m = 0, sp = 0, ce = 0, cov = 0;
      for (let i = 0; i < nT; i++) {
        const k = j * nT + i;
        hs += h[k]; m += c[0][k] * h[k];
        let cc = 0, ss = 0; for (let f = 0; f < nF; f++) { if (isCem[f]) cc += c[f][k]; if (isSp[f]) ss += c[f][k]; }
        ce += cc * h[k]; sp += ss * h[k];
        if (cc > 0.7) cov++;
      }
      const cemAt = (ii: number[]) => ii.reduce((a, i) => { let s = 0; for (let f = 0; f < nF; f++) if (isCem[f]) s += c[f][j * nT + i]; return a + s; }, 0) / ii.length;
      const kN = j * nT + iN[0];
      const base = (h[kN] ** 3) / (12 * Math.max(1e-4, mu[kN]));
      const Cn = buckingham(h[kN], mu[kN], ty[kN], gAbs[kN], EPS, 0);
      rows.push({
        md: zC[j], mud: m / hs, spacer: sp / hs, cement: ce / hs, coverage: cov / nT,
        channel: cemAt(iW) > 0.7 && cemAt(iN) < 0.5, staticNarrow: c[0][kN] > 0.5 && Cn / base < 0.01,
        standoff: sOff[j], inclDeg: incl[j],
      });
    }
    const inCem = rows.filter((rw) => rw.md >= cementTopMD + dz); // без переходной ячейки у кровли
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const worst: D2Stats["worst"] = [];
    let run: { topMD: number; bottomMD: number; minCoverage: number } | null = null;
    for (const rw of inCem) {
      if (rw.coverage < 0.75) {
        if (!run) run = { topMD: rw.md - dz / 2, bottomMD: rw.md + dz / 2, minCoverage: rw.coverage };
        else { run.bottomMD = rw.md + dz / 2; run.minCoverage = Math.min(run.minCoverage, rw.coverage); }
      } else if (run) { worst.push(run); run = null; }
    }
    if (run) worst.push(run);
    worst.sort((a, b) => (b.bottomMD - b.topMD) * (1 - b.minCoverage) - (a.bottomMD - a.topMD) * (1 - a.minCoverage));
    return {
      rows,
      s: {
        cementFillPct: avg(inCem.map((rw) => rw.cement)) * 100,
        mudLeftPct: avg(inCem.map((rw) => rw.mud)) * 100,
        channelM: inCem.filter((rw) => rw.channel).length * dz,
        staticM: inCem.filter((rw) => rw.staticNarrow).length * dz,
        worst: worst.slice(0, 5),
      },
    };
  };
  /** «Центр тяжести» цемента по глубине — для оценки оседания за выдержку */
  const cementCentroid = () => {
    let w = 0, zz = 0;
    for (let j = 0; j < nZ; j++) for (let i = 0; i < nT; i++) {
      const k = j * nT + i; let cc = 0; for (let f = 0; f < nF; f++) if (isCem[f]) cc += c[f][k];
      w += cc * V[k]; zz += cc * V[k] * zC[j];
    }
    return w > 0 ? zz / w : 0;
  };

  // ── Время ──
  const pumpT = stages.reduce((t, s) => t + stageDur(s), 0);
  const settleS = Math.max(0, inp.settleMin ?? 0) * 60;
  const totalT = pumpT + settleS;
  const maxSnap = inp.maxSnapshots ?? 140;
  const snapDt = totalT / Math.max(1, maxSnap - 1);
  const snapshots: D2Snapshot[] = [];
  const snap = (t: number, st: number) => {
    const fr = new Uint8Array(nF * N);
    for (let f = 0; f < nF; f++) for (let k = 0; k < N; k++) fr[f * N + k] = Math.round(c[f][k] * 255);
    snapshots.push({ t, frac: fr, stage: st });
  };
  mixProps();
  let t = 0, steps = 0, nextSnap = 0, inVol = 0, outVol = 0;
  const vol0 = V.reduce((a, b) => a + b, 0);
  snap(0, 0); nextSnap = snapDt;
  U = 1;
  let aborted = false;
  const timeProps = () => {
    if (!inp.fluidTime) return;
    for (let f = 0; f < nF; f++) { if (firstIn[f] < 0) continue; const m = inp.fluidTime(f, t - firstIn[f]); muMul[f] = m.mu; tyMul[f] = m.ty; }
  };
  const plugK = inp.plugging?.k ?? 0, plugF = inp.plugging?.fluid ?? -1;
  const accumulatePlug = (dt: number) => {
    if (plugK <= 0 || plugF < 0) return;
    const cf = c[plugF];
    for (let k = 0; k < N; k++) {
      const j = Math.floor(k / nT), i = k - j * nT;
      let thr = 0; // объёмный поток через ячейку (по выходящим граням)
      if (j > 0) { const F = Fz[k - nT]; if (F < 0) thr += -F; } else if (Ftop[i] > 0) thr += Ftop[i];
      if (j < nZ - 1) { const F = Fz[k]; if (F > 0) thr += F; } else if (Fbot[i] > 0) thr += Fbot[i];
      const fL = i > 0 ? j * nTF + i - 1 : full ? j * nTF + nT - 1 : -1, fR = i < nT - 1 || full ? j * nTF + i : -1;
      if (fL >= 0 && Ft[fL] < 0) thr += -Ft[fL];
      if (fR >= 0 && Ft[fR] > 0) thr += Ft[fR];
      if (thr <= 0 || cf[k] <= 0.05) continue;
      S[k] += (thr * cf[k] * dt) / V[k];
      mob[k] = Math.exp(-plugK * S[k]);
    }
  };
  const outflow = () => { let o = 0; for (let i = 0; i < nT; i++) o += Ftop[i] + Fbot[i]; return o; };
  for (let si = 0; si < stages.length && !aborted; si++) {
    const st = stages[si];
    const hold = st.rateM3s <= 1e-9;
    let left = hold ? st.holdS ?? 0 : st.volumeM3; // при выдержке — оставшееся время
    if (!hold && firstIn[st.fluid] < 0) firstIn[st.fluid] = t;
    while (left > 1e-9) {
      timeProps(); mixProps();
      solvePressure(hold ? 0 : st.rateM3s * share, gInit ? (hold ? 2 : 1) : 6);
      gInit = true;
      const dt = stepDt(Math.min(hold ? 60 : 30, hold ? left : left / st.rateM3s));
      transport(dt, hold ? -1 : st.fluid);
      accumulatePlug(dt);
      mixProps();
      t += dt; steps++;
      if (hold) left -= dt; else { left -= st.rateM3s * dt; inVol += st.rateM3s * share * dt; }
      outVol += outflow() * dt;
      if (t >= nextSnap - 1e-9) { snap(t, si); nextSnap += snapDt; }
      if (steps % 20 === 0) inp.onProgress?.(Math.min(1, t / totalT));
      if (steps > 200000) { warnings.push("Превышено число шагов расчёта — результат обрезан."); aborted = true; break; }
    }
  }
  if (!snapshots.length || snapshots[snapshots.length - 1].t < t - 1e-6) snap(t, Math.max(0, stages.length - 1));
  const pumpEndSnap = snapshots.length - 1;
  const atPumpEnd = stats();
  const pumpTimeS = t;
  const cent0 = cementCentroid();

  // ── Выдержка: расход 0, вращение остановлено, структура растёт ──
  if (settleS > 0) {
    U = 0;
    let tS = 0;
    while (tS < settleS - 1e-6) {
      for (let f = 0; f < nF; f++) gelMul[f] = gelMultiplier(inp.fluids[f].kind, tS);
      mixProps();
      solvePressure(0, 2);
      const dt = stepDt(Math.min(60, settleS - tS));
      transport(dt, -1);
      t += dt; tS += dt; steps++;
      outVol += outflow() * dt;
      if (t >= nextSnap - 1e-9) { snap(t, -1); nextSnap += snapDt; }
      if (steps % 20 === 0) inp.onProgress?.(Math.min(1, t / totalT));
      if (steps > 260000) { warnings.push("Выдержка обрезана по числу шагов."); break; }
    }
    if (snapshots[snapshots.length - 1].t < t - 1e-6) snap(t, -1);
  }
  const fin = stats();
  const settleTopShiftM = settleS > 0 ? cementCentroid() - cent0 : 0;

  const volNow = V.reduce((a, b) => a + b, 0);
  const mbe = inVol > 0 ? ((inVol - outVol - (volNow - vol0)) / inVol) * 100 : 0;
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    nTheta: nT, full, nZ, zCenters: zC, thetaCenters: thC, gap: h, fluids: inp.fluids, snapshots, pumpEndSnap,
    rows: fin.rows, rowsPumpEnd: atPumpEnd.rows,
    finalFrac: c.map((a) => Float32Array.from(a)), cementTopMD, settleTopShiftM,
    summary: {
      ...fin.s, totalTimeS: t, pumpTimeS, settleS, rotationRpm: rpm, steps, pumpEnd: atPumpEnd.s,
      massBalanceErrPct: mbe, computeMs: t1 - t0, pcgIters,
    },
    warnings,
  };
}
