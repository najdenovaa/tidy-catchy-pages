/**
 * Двумерная (осреднённая по зазору) модель вытеснения в эксцентричном затрубье.
 *
 * Затрубье «разворачивается» в лист: z — глубина по стволу (вниз), s — дуга по окружности
 * от широкой стороны (θ = 0, верхняя сторона ствола) до узкой (θ = π, нижняя сторона, куда
 * ложится колонна). По симметрии считается половина окружности. Зазор h(θ) = H·(1 + e·cos θ),
 * e = 1 − standoff.
 *
 * Течение вязкопластичной жидкости (Бингам) в узкой щели — расход на единицу ширины
 * (формула Букингема для щели):
 *   q = −C(|G|)·G,  C = h³/(12μ)·(1 − 3/2·χ + 1/2·χ³),  χ = 2τ₀/(h|G|) (χ ≥ 1 → течения нет),
 *   G = ∇p − ρ·g — модифицированный градиент давления (g по оси: g·cos β; по окружности:
 *   g·sin β·sin θ, к нижней стороне).
 * Несжимаемость ∇·q = 0 даёт эллиптическое уравнение для давления; нелинейность по |G|
 * снимается итерациями Пикара с регуляризацией (застойные зоны — C → ε·C₀).
 * Это подход Bittleston, Ferguson, Frigaard (2002) и Pelipenko, Frigaard (2004), на котором,
 * насколько известно, построены промышленные симуляторы вытеснения.
 *
 * Перенос жидкостей: объёмные доли c_k, ∂(h c_k)/∂t + ∇·(q c_k) = 0; по оси — явная схема
 * MUSCL с ограничителем minmod, по окружности — неявная противопоточная (устойчива при
 * крупном шаге по времени). Свойства смеси — по долям.
 *
 * Ограничения: ламинарный режим (турбулентное вытеснение считается консервативно), без
 * вращения и расхаживания колонны, без смешения на молекулярном уровне.
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
  /** Расход, м³/с */
  rateM3s: number;
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
  nTheta?: number;
  nZ?: number;
  maxSnapshots?: number;
  onProgress?: (frac: number) => void;
}

export interface D2Snapshot {
  t: number;
  /** Доли жидкостей, квантованные 0…255: [fluid][cell], cell = j·nTheta + i */
  frac: Uint8Array;
  /** Какая порция входит в затрубье */
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

export interface D2Result {
  nTheta: number;
  nZ: number;
  zCenters: Float64Array;
  /** θ центров ячеек, рад (0 — широкая сторона) */
  thetaCenters: Float64Array;
  /** Ширина зазора, м [cell] */
  gap: Float32Array;
  fluids: D2Fluid[];
  snapshots: D2Snapshot[];
  rows: D2Row[];
  /** Итоговые доли (не квантованные) [fluid][cell] */
  finalFrac: Float32Array[];
  /** Интервал, где по проекту должен быть цемент */
  cementTopMD: number;
  summary: {
    totalTimeS: number;
    steps: number;
    /** Средняя доля цемента в интервале цементирования, % */
    cementFillPct: number;
    /** Средняя доля бурового раствора (невытесненный), % */
    mudLeftPct: number;
    /** Метров интервала с каналом на узкой стороне */
    channelM: number;
    /** Метров интервала с неподвижным раствором на узкой стороне */
    staticM: number;
    worst: { topMD: number; bottomMD: number; minCoverage: number }[];
    /** Баланс объёмов: (вошло − вышло − прирост) / вошло, % */
    massBalanceErrPct: number;
    computeMs: number;
    pcgIters: number;
  };
  warnings: string[];
}

const G = 9.81;

function buckingham(h: number, mu: number, ty: number, gAbs: number, eps: number): number {
  const base = (h * h * h) / (12 * Math.max(1e-4, mu));
  if (ty <= 0) return base;
  if (gAbs <= 0) return base * eps;
  const chi = (2 * ty) / (h * gAbs);
  if (chi >= 1) return base * eps;
  return base * Math.max(eps, 1 - 1.5 * chi + 0.5 * chi * chi * chi);
}

export function simulateDisplacement2D(inp: D2Input): D2Result {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const warnings: string[] = [];
  const nT = Math.max(6, Math.round(inp.nTheta ?? 16));
  const L = Math.max(10, inp.zBot - inp.zTop);
  const nZ = Math.max(20, Math.round(inp.nZ ?? Math.min(240, Math.max(60, L / 5))));
  const dz = L / nZ;
  const N = nT * nZ;
  const nF = inp.fluids.length;
  const EPS = 1e-4;

  // ── Геометрия ──
  const zC = new Float64Array(nZ), thC = new Float64Array(nT);
  const ds = new Float64Array(nZ), cosB = new Float64Array(nZ), sinB = new Float64Array(nZ);
  const sOff = new Float64Array(nZ), incl = new Float64Array(nZ);
  const h = new Float32Array(N), V = new Float64Array(N);
  for (let i = 0; i < nT; i++) thC[i] = ((i + 0.5) * Math.PI) / nT;
  for (let j = 0; j < nZ; j++) {
    const md = inp.zTop + (j + 0.5) * dz;
    zC[j] = md;
    const g = inp.geom(md);
    const rO = Math.max(g.rHole, g.rCasing + 0.003), rI = g.rCasing;
    const Hm = rO - rI, e = Math.min(0.95, Math.max(0, 1 - g.standoff));
    sOff[j] = 1 - e; incl[j] = g.inclDeg;
    ds[j] = ((rO + rI) / 2) * Math.PI / nT;
    const b = (g.inclDeg * Math.PI) / 180;
    cosB[j] = Math.cos(b); sinB[j] = Math.sin(b);
    for (let i = 0; i < nT; i++) {
      const k = j * nT + i;
      h[k] = Hm * (1 + e * Math.cos(thC[i]));
      V[k] = h[k] * ds[j] * dz;
    }
  }

  // ── Доли жидкостей ──
  const c: Float64Array[] = Array.from({ length: nF }, (_, f) => { const a = new Float64Array(N); if (f === 0) a.fill(1); return a; });
  const rho = new Float64Array(N), mu = new Float64Array(N), ty = new Float64Array(N);
  const mixProps = () => {
    for (let k = 0; k < N; k++) {
      let r = 0, m = 0, y = 0;
      for (let f = 0; f < nF; f++) { const w = c[f][k]; if (w <= 0) continue; const fl = inp.fluids[f]; r += w * fl.density; m += w * Math.log(Math.max(1e-4, fl.pv)); y += w * fl.yp; }
      rho[k] = r; mu[k] = Math.exp(m); ty[k] = y;
    }
  };

  // ── Давление: коэффициенты граней ──
  // θ-грань между (i, j) и (i+1, j): индекс j*(nT-1)+i ; z-грань между (i, j) и (i, j+1): индекс j*nT+i
  const nFT = (nT - 1) * nZ, nFZ = nT * (nZ - 1);
  const Tt = new Float64Array(nFT), Bt = new Float64Array(nFT);
  const Tz = new Float64Array(nFZ), Bz = new Float64Array(nFZ);
  const Ttop = new Float64Array(nT), Btop = new Float64Array(nT);
  const p = new Float64Array(N), gAbs = new Float64Array(N);
  const Ft = new Float64Array(nFT), Fz = new Float64Array(nFZ), Ftop = new Float64Array(nT);
  const Qin = new Float64Array(nT);
  const diag = new Float64Array(N), rhs = new Float64Array(N);
  // рабочие массивы PCG
  const r = new Float64Array(N), zv = new Float64Array(N), d = new Float64Array(N), Ad = new Float64Array(N);
  const tri = { a: new Float64Array(nT), b: new Float64Array(nT), cc: new Float64Array(nT), x: new Float64Array(nT), rr: new Float64Array(nT) };
  let gInit = false;
  let pcgIters = 0;

  const faceGap = (k1: number, k2: number) => Math.sqrt(h[k1] * h[k2]);

  const assemble = (Qtot: number) => {
    // Проводимости по текущему |G|
    for (let j = 0; j < nZ; j++) {
      for (let i = 0; i < nT - 1; i++) {
        const k = j * nT + i, k2 = k + 1, fi = j * (nT - 1) + i;
        const hf = faceGap(k, k2), muf = Math.sqrt(mu[k] * mu[k2]), tyf = 0.5 * (ty[k] + ty[k2]), gf = 0.5 * (gAbs[k] + gAbs[k2]);
        const C = buckingham(hf, muf, tyf, gf, EPS);
        const T = (C * dz) / ds[j];
        const thF = ((i + 1) * Math.PI) / nT;
        Tt[fi] = T; Bt[fi] = T * 0.5 * (rho[k] + rho[k2]) * G * sinB[j] * Math.sin(thF) * ds[j];
      }
    }
    for (let j = 0; j < nZ - 1; j++) {
      const dsf = 0.5 * (ds[j] + ds[j + 1]), cb = 0.5 * (cosB[j] + cosB[j + 1]);
      for (let i = 0; i < nT; i++) {
        const k = j * nT + i, k2 = k + nT, fi = k;
        const hf = faceGap(k, k2), muf = Math.sqrt(mu[k] * mu[k2]), tyf = 0.5 * (ty[k] + ty[k2]), gf = 0.5 * (gAbs[k] + gAbs[k2]);
        const C = buckingham(hf, muf, tyf, gf, EPS);
        const T = (C * dsf) / dz;
        Tz[fi] = T; Bz[fi] = T * 0.5 * (rho[k] + rho[k2]) * G * cb * dz;
      }
    }
    for (let i = 0; i < nT; i++) {
      const k = i;
      const C = buckingham(h[k], mu[k], ty[k], gAbs[k], EPS);
      const T = (C * ds[0]) / (dz / 2);
      Ttop[i] = T; Btop[i] = T * rho[k] * G * -cosB[0] * (dz / 2);
    }
    // Приток у башмака — по проводимости нижних ячеек
    let sumC = 0;
    const jb = nZ - 1;
    for (let i = 0; i < nT; i++) { const k = jb * nT + i; Qin[i] = buckingham(h[k], mu[k], ty[k], gAbs[k] || 1e3, EPS) * ds[jb]; sumC += Qin[i]; }
    for (let i = 0; i < nT; i++) Qin[i] = sumC > 0 ? (Qtot * Qin[i]) / sumC : Qtot / nT;
    // Матрица
    diag.fill(0); rhs.fill(0);
    for (let j = 0; j < nZ; j++) for (let i = 0; i < nT - 1; i++) {
      const fi = j * (nT - 1) + i, a = j * nT + i, b = a + 1;
      diag[a] += Tt[fi]; diag[b] += Tt[fi];
      rhs[a] -= Bt[fi]; rhs[b] += Bt[fi];
    }
    for (let fi = 0; fi < nFZ; fi++) {
      const a = fi, b = fi + nT;
      diag[a] += Tz[fi]; diag[b] += Tz[fi];
      rhs[a] -= Bz[fi]; rhs[b] += Bz[fi];
    }
    for (let i = 0; i < nT; i++) { diag[i] += Ttop[i]; rhs[i] -= Btop[i]; }
    for (let i = 0; i < nT; i++) rhs[(nZ - 1) * nT + i] += Qin[i];
  };

  const matvec = (x: Float64Array, y: Float64Array) => {
    for (let k = 0; k < N; k++) y[k] = diag[k] * x[k];
    for (let j = 0; j < nZ; j++) for (let i = 0; i < nT - 1; i++) {
      const fi = j * (nT - 1) + i, a = j * nT + i, b = a + 1, T = Tt[fi];
      y[a] -= T * x[b]; y[b] -= T * x[a];
    }
    for (let fi = 0; fi < nFZ; fi++) { const a = fi, b = fi + nT, T = Tz[fi]; y[a] -= T * x[b]; y[b] -= T * x[a]; }
  };
  // Предобусловливатель: точное решение по окружности (трёхдиагональная система в каждом ряду)
  const precond = (x: Float64Array, y: Float64Array) => {
    for (let j = 0; j < nZ; j++) {
      const o = j * nT;
      for (let i = 0; i < nT; i++) {
        tri.b[i] = diag[o + i];
        tri.a[i] = i > 0 ? -Tt[j * (nT - 1) + i - 1] : 0;
        tri.cc[i] = i < nT - 1 ? -Tt[j * (nT - 1) + i] : 0;
        tri.rr[i] = x[o + i];
      }
      // Томас
      for (let i = 1; i < nT; i++) { const m = tri.a[i] / tri.b[i - 1]; tri.b[i] -= m * tri.cc[i - 1]; tri.rr[i] -= m * tri.rr[i - 1]; }
      tri.x[nT - 1] = tri.rr[nT - 1] / tri.b[nT - 1];
      for (let i = nT - 2; i >= 0; i--) tri.x[i] = (tri.rr[i] - tri.cc[i] * tri.x[i + 1]) / tri.b[i];
      for (let i = 0; i < nT; i++) y[o + i] = tri.x[i];
    }
  };
  // Двухуровневый: грубая поправка по глубине (ряды осреднены по окружности) + точные решения по окружности
  const cA = new Float64Array(nZ), cB = new Float64Array(nZ), cC = new Float64Array(nZ), cR = new Float64Array(nZ), cX = new Float64Array(nZ);
  const y1 = new Float64Array(N), rt = new Float64Array(N), Ay = new Float64Array(N), yl = new Float64Array(N);
  const coarseSetup = () => {
    // Галеркин с кусочно-постоянной интерполяцией по ряду: диагональ = сумма связей наружу ряда
    for (let j = 0; j < nZ; j++) {
      let up = 0, dn = 0;
      for (let i = 0; i < nT; i++) { if (j > 0) up += Tz[(j - 1) * nT + i]; if (j < nZ - 1) dn += Tz[j * nT + i]; }
      let top = 0; if (j === 0) for (let i = 0; i < nT; i++) top += Ttop[i];
      cA[j] = -up; cC[j] = -dn; cB[j] = up + dn + top;
    }
  };
  const coarse = (x: Float64Array, y: Float64Array) => {
    for (let j = 0; j < nZ; j++) { let sm = 0; for (let i = 0; i < nT; i++) sm += x[j * nT + i]; cR[j] = sm; }
    const b2 = Float64Array.from(cB), r2 = Float64Array.from(cR);
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
      if (!(dAd > 0)) break;
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
    for (let j = 0; j < nZ; j++) for (let i = 0; i < nT - 1; i++) {
      const fi = j * (nT - 1) + i, a = j * nT + i, b = a + 1;
      Ft[fi] = -Tt[fi] * (p[b] - p[a]) + Bt[fi];
    }
    for (let fi = 0; fi < nFZ; fi++) { const a = fi, b = fi + nT; Fz[fi] = -Tz[fi] * (p[b] - p[a]) + Bz[fi]; }
    for (let i = 0; i < nT; i++) Ftop[i] = -Ttop[i] * (0 - p[i]) + Btop[i]; // наружу через верх (вверх)
    // |G| в ячейках: средние нормальные градиенты граней (по расходу: G = −F/(C·L))
    for (let j = 0; j < nZ; j++) for (let i = 0; i < nT; i++) {
      const k = j * nT + i;
      // осевой градиент: из давлений соседей
      const pu = j > 0 ? p[k - nT] : 0, pd = j < nZ - 1 ? p[k + nT] : p[k];
      const du = j > 0 ? dz : dz / 2, dd = j < nZ - 1 ? dz : 1e9;
      const gz = (j < nZ - 1 ? (pd - pu) / (du + dd) : (p[k] - pu) / du) - rho[k] * G * cosB[j];
      const pl = i > 0 ? p[k - 1] : p[k], pr = i < nT - 1 ? p[k + 1] : p[k];
      const nsp = (i > 0 ? 1 : 0) + (i < nT - 1 ? 1 : 0);
      const gt = (pr - pl) / (Math.max(1, nsp) * ds[j]) - rho[k] * G * sinB[j] * Math.sin(thC[i]);
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
      // явные осевые потоки
      axNet.fill(0);
      for (let fi = 0; fi < nFZ; fi++) {
        const a = fi, b = fi + nT, F = Fz[fi];
        let val: number;
        if (F >= 0) { // из a (выше) в b (ниже)
          const up = a - nT >= 0 ? cf[a - nT] : cf[a];
          val = cf[a] + 0.5 * minmod(cf[a] - up, cf[b] - cf[a]);
        } else {
          const dn = b + nT < N ? cf[b + nT] : (f === inFluid ? 1 : 0);
          val = cf[b] + 0.5 * minmod(cf[b] - dn, cf[a] - cf[b]);
        }
        const fl = F * dt * val;
        axNet[a] -= fl; axNet[b] += fl;
      }
      for (let i = 0; i < nT; i++) {
        const F = Ftop[i]; // >0 — наружу
        axNet[i] -= (F >= 0 ? F * cf[i] : F * (f === 0 ? 1 : 0)) * dt;
        axNet[(nZ - 1) * nT + i] += Qin[i] * dt * (f === inFluid ? 1 : 0);
      }
      // неявно по окружности (противопоточно), ряд за рядом
      for (let j = 0; j < nZ; j++) {
        const o = j * nT;
        for (let i = 0; i < nT; i++) {
          const k = o + i;
          let dg = V[k], lo = 0, upc = 0;
          if (i > 0) { const F = Ft[j * (nT - 1) + i - 1]; if (F < 0) dg += -F * dt; else lo = -F * dt; } // F>0: из i-1 в i
          if (i < nT - 1) { const F = Ft[j * (nT - 1) + i]; if (F > 0) dg += F * dt; else upc = F * dt; } // F<0: из i+1 в i
          tri.b[i] = dg; tri.a[i] = lo; tri.cc[i] = upc;
          tri.rr[i] = V[k] * cf[k] + axNet[k];
        }
        for (let i = 1; i < nT; i++) { const m = tri.a[i] / tri.b[i - 1]; tri.b[i] -= m * tri.cc[i - 1]; tri.rr[i] -= m * tri.rr[i - 1]; }
        tri.x[nT - 1] = tri.rr[nT - 1] / tri.b[nT - 1];
        for (let i = nT - 2; i >= 0; i--) tri.x[i] = (tri.rr[i] - tri.cc[i] * tri.x[i + 1]) / tri.b[i];
        for (let i = 0; i < nT; i++) out[o + i] = Math.min(1, Math.max(0, tri.x[i]));
      }
    }
    for (let k = 0; k < N; k++) {
      let s = 0; for (let f = 0; f < nF; f++) s += newC[f][k];
      const inv = s > 1e-9 ? 1 / s : 0;
      for (let f = 0; f < nF; f++) c[f][k] = s > 1e-9 ? newC[f][k] * inv : f === 0 ? 1 : 0;
    }
  };

  // ── Время ──
  const stages = inp.stages.filter((s) => s.volumeM3 > 1e-6 && s.rateM3s > 1e-7);
  const totalT = stages.reduce((t, s) => t + s.volumeM3 / s.rateM3s, 0);
  const maxSnap = inp.maxSnapshots ?? 120;
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
  for (let si = 0; si < stages.length; si++) {
    const st = stages[si];
    let left = st.volumeM3;
    while (left > 1e-9) {
      solvePressure(st.rateM3s / 2, gInit ? 1 : 6); // считаем половину окружности
      gInit = true;
      // шаг по осевому CFL (по окружности — неявно, ограничиваем ×8)
      let dtA = Infinity, dtT = Infinity;
      for (let k = 0; k < N; k++) {
        const j = Math.floor(k / nT), i = k - j * nT;
        let outA = 0, outT = 0;
        if (j > 0) { const F = Fz[k - nT]; if (F < 0) outA += -F; } else { const F = Ftop[i]; if (F > 0) outA += F; }
        if (j < nZ - 1) { const F = Fz[k]; if (F > 0) outA += F; }
        if (i > 0) { const F = Ft[j * (nT - 1) + i - 1]; if (F < 0) outT += -F; }
        if (i < nT - 1) { const F = Ft[j * (nT - 1) + i]; if (F > 0) outT += F; }
        if (outA > 0) dtA = Math.min(dtA, (0.45 * V[k]) / outA);
        if (outT > 0) dtT = Math.min(dtT, (0.45 * V[k]) / outT);
      }
      let dt = Math.min(dtA, dtT * 8, 30, left / st.rateM3s);
      if (!Number.isFinite(dt) || dt <= 0) dt = Math.min(5, left / st.rateM3s);
      transport(dt, st.fluid);
      mixProps();
      t += dt; steps++; left -= st.rateM3s * dt; inVol += (st.rateM3s / 2) * dt;
      let o = 0; for (let i = 0; i < nT; i++) o += Ftop[i]; outVol += o * dt;
      if (t >= nextSnap - 1e-9) { snap(t, si); nextSnap += snapDt; }
      if (steps % 20 === 0) inp.onProgress?.(Math.min(1, t / totalT));
      if (steps > 200000) { warnings.push("Превышено число шагов расчёта — результат обрезан."); break; }
    }
  }
  if (!snapshots.length || snapshots[snapshots.length - 1].t < t - 1e-6) snap(t, stages.length - 1);

  // ── Итоги по глубине ──
  const isCem = inp.fluids.map((f) => f.kind === "cement"), isSp = inp.fluids.map((f) => f.kind === "spacer");
  // финальная статика узкой стороны: проводимость на узкой стороне относительно «без ДНС»
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
    const kN = j * nT + nT - 1, kW = j * nT;
    let cN = 0, cW = 0; for (let f = 0; f < nF; f++) if (isCem[f]) { cN += c[f][kN]; cW += c[f][kW]; }
    const base = (h[kN] ** 3) / (12 * Math.max(1e-4, mu[kN]));
    const Cn = buckingham(h[kN], mu[kN], ty[kN], gAbs[kN], EPS);
    rows.push({
      md: zC[j], mud: m / hs, spacer: sp / hs, cement: ce / hs, coverage: cov / nT,
      channel: cW > 0.7 && cN < 0.5, staticNarrow: c[0][kN] > 0.5 && Cn / base < 0.01,
      standoff: sOff[j], inclDeg: incl[j],
    });
  }
  // интервал цемента: от верхней границы, где цемент реально есть по проекту объёма
  const cemVol = stages.filter((s) => isCem[s.fluid]).reduce((a, s) => a + s.volumeM3, 0) / 2; // половина окружности
  let acc = 0, cementTopMD = inp.zBot;
  for (let j = nZ - 1; j >= 0; j--) { let v = 0; for (let i = 0; i < nT; i++) v += V[j * nT + i]; acc += v; cementTopMD = zC[j] - dz / 2; if (acc >= cemVol) break; }
  const inCem = rows.filter((rw) => rw.md >= cementTopMD);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const worst: D2Result["summary"]["worst"] = [];
  let run: { topMD: number; bottomMD: number; minCoverage: number } | null = null;
  for (const rw of inCem) {
    if (rw.coverage < 0.75) {
      if (!run) run = { topMD: rw.md - dz / 2, bottomMD: rw.md + dz / 2, minCoverage: rw.coverage };
      else { run.bottomMD = rw.md + dz / 2; run.minCoverage = Math.min(run.minCoverage, rw.coverage); }
    } else if (run) { worst.push(run); run = null; }
  }
  if (run) worst.push(run);
  worst.sort((a, b) => (b.bottomMD - b.topMD) * (1 - b.minCoverage) - (a.bottomMD - a.topMD) * (1 - a.minCoverage));
  const volNow = V.reduce((a, b) => a + b, 0);
  const mbe = inVol > 0 ? ((inVol - outVol - (volNow - vol0)) / inVol) * 100 : 0;
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    nTheta: nT, nZ, zCenters: zC, thetaCenters: thC, gap: h, fluids: inp.fluids, snapshots, rows,
    finalFrac: c.map((a) => Float32Array.from(a)), cementTopMD,
    summary: {
      totalTimeS: t, steps,
      cementFillPct: avg(inCem.map((rw) => rw.cement)) * 100,
      mudLeftPct: avg(inCem.map((rw) => rw.mud)) * 100,
      channelM: inCem.filter((rw) => rw.channel).length * dz,
      staticM: inCem.filter((rw) => rw.staticNarrow).length * dz,
      worst: worst.slice(0, 5), massBalanceErrPct: mbe, computeMs: t1 - t0, pcgIters,
    },
    warnings,
  };
}
