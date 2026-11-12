/**
 * Реология по показаниям ротационного вискозиметра (Fann 35, R1B1F1).
 * Подбор трёх моделей — Бингам, степенная, Гершель–Балкли — методом наименьших квадратов
 * по всем введённым показаниям; трение по Гершелю–Балкли по API RP 13D (2010).
 */

export const FANN_RPMS = [600, 300, 200, 100, 6, 3] as const;
export type FannRpm = (typeof FANN_RPMS)[number];

/** Показания шкалы (градусы) на скоростях 600/300/200/100/6/3 об/мин. Пусто — не измерено; нулевой момент исключается из логарифмического подбора. */
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

/** Достаточно ли положительных показаний для подбора: минимум три разные скорости. */
export function hasFann(f: FannReadings | undefined): boolean {
  const pts = fannPoints(f);
  return pts.length >= 3;
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

  if(Math.max(...t)-Math.min(...t)<1e-9)return null;

  // Бингам (МНК по всем точкам)
  const bl = linReg(g, t);
  const candidates=[{mu:Math.max(0,bl.b),yield:Math.max(0,bl.a)},
    {mu:g.reduce((v,x,i)=>v+x*t[i],0)/g.reduce((v,x)=>v+x*x,0),yield:0},
    {mu:0,yield:t.reduce((a,b)=>a+b,0)/t.length}];
  candidates.sort((a,b)=>t.reduce((v,x,i)=>v+(a.yield+a.mu*g[i]-x)**2,0)-t.reduce((v,x,i)=>v+(b.yield+b.mu*g[i]-x)**2,0));
  const bPv=candidates[0].mu,bYp=candidates[0].yield;
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

  const r600 = Number(f!.r600)||0, r300 = Number(f!.r300)||0;
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

  if(![bingham.pv,bingham.ypPa,bingham.r2,powerLaw.K,powerLaw.n,powerLaw.r2,bestHb.tau0,bestHb.K,bestHb.n,bestHb.r2].every(Number.isFinite))return null;
  return { points: pts, bingham, powerLaw, hb: bestHb, best, pv600300, yp600300Pa, binghamLowShearErrorPct };
}

/** Параметры ГБ для гидравлики: из показаний Fann, если они есть. */
export function hbFromFann(f: FannReadings | undefined): HBParams | undefined {
  if(!(f?.r600>0&&f?.r300>0))return undefined;
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


export type RheologyModel = 'pvyp'|'bingham'|'powerLaw'|'hb';
export const RHEOLOGY_MODELS:Record<RheologyModel,string>={pvyp:'Бингам: заданные PV/YP',bingham:'Бингам: МНК по Fann',powerLaw:'Степенная по Fann',hb:'Гершель–Балкли по Fann'};
export interface RheologyInput {pv:number;yp:number;fann?:FannReadings;model?:RheologyModel}
export function rheologyResolution(r:RheologyInput){
 r=r??{pv:0,yp:0};
 const fit=fitRheology(r.fann),selection=r.model;
 // No selection is the historical mode: HB with bounded n or PV/YP defaults.
 if(selection===undefined){const params=hbFromFann(r.fann);return {valid:true,label:'Прежний автоматический режим: '+(params?'Гершель–Балкли':'PV/YP'),params,fit,error:''};}
 const fail=(error:string)=>({valid:false,label:RHEOLOGY_MODELS[selection]??'Неизвестная модель',params:undefined as HBParams|undefined,fit,error});
 if(!Object.prototype.hasOwnProperty.call(RHEOLOGY_MODELS,selection))return fail('Неизвестная модель реологии. Выберите поддерживаемую модель.');
 if(selection==='pvyp')return Number.isFinite(r.pv)&&r.pv>0&&Number.isFinite(r.yp)&&r.yp>=0?{valid:true,label:RHEOLOGY_MODELS[selection],params:undefined as HBParams|undefined,fit,error:''}:fail('Для заданной реологии PV должен быть больше 0, YP не меньше 0.');
 if(r.fann&&Object.values(r.fann).some(v=>v!==undefined&&(!Number.isFinite(v)||v<0)))return fail('Исправьте отрицательные или неконечные показания Fann.');
 if(!fit)return fail('Для выбранной модели нужны минимум три положительных показания на разных скоростях и изменяющееся напряжение.');
 const params:HBParams=selection==='bingham'?{tau0:fit.bingham.ypPa,K:fit.bingham.pv/1000,n:1}:selection==='powerLaw'?{tau0:0,K:fit.powerLaw.K,n:fit.powerLaw.n}:{tau0:fit.hb.tau0,K:fit.hb.K,n:fit.hb.n};
 if(![params.tau0,params.K,params.n].every(Number.isFinite)||params.K<=0||params.tau0<0||params.n<0.1||params.n>1.2)return fail('Параметры вне диапазона текущей гидравлической корреляции: K > 0, τ₀ ≥ 0, 0,1 ≤ n ≤ 1,2. Коэффициенты не обрезаются.');
 return {valid:true,label:RHEOLOGY_MODELS[selection],params,fit,error:''};
}
export function selectedRheology(r:RheologyInput):HBParams|undefined{const out=rheologyResolution(r);if(!out.valid)throw new Error(out.error);return out.params;}
export function rheologyMetrics(fit:RheologyFit,model:Exclude<RheologyModel,'pvyp'>){
 const pred=(g:number)=>model==='bingham'?fit.bingham.ypPa+fit.bingham.pv*g/1000:model==='powerLaw'?fit.powerLaw.K*g**fit.powerLaw.n:fit.hb.tau0+fit.hb.K*g**fit.hb.n;
 const errors=fit.points.map(p=>pred(p.gamma)-p.tau);
 return {rmse:Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length),mae:errors.reduce((s,e)=>s+Math.abs(e),0)/errors.length,maxError:Math.max(...errors.map(Math.abs)),r2:fit[model].r2,pred};
}
export function rheologyDescription(r:RheologyInput){const o=rheologyResolution(r),p=o.params;return `${o.label}; ${o.valid?(p?`τ₀ ${p.tau0.toFixed(4)} Па; K ${p.K.toPrecision(6)} Па·с^n; n ${p.n.toFixed(5)}`:`PV ${r.pv} сПз; YP ${r.yp} Па`):o.error}${o.fit?`; диапазон измерений ${Math.min(...o.fit.points.map(p=>p.gamma)).toFixed(2)}–${Math.max(...o.fit.points.map(p=>p.gamma)).toFixed(2)} с⁻¹`:''}`;}
/** Only explicitly selected invalid models block calculation; historical projects keep their behavior. */
export function rheologyInputErrors(input:{drillingFluid:{name:string;rheology:RheologyInput;rheologyBottomhole?:RheologyInput};slurries:{name:string;rheology:RheologyInput}[];buffers:{name:string;rheology:RheologyInput}[];displacementFluids:{name:string;rheology:RheologyInput}[]}){
 const fluids=[input.drillingFluid,...input.slurries,...input.buffers,...input.displacementFluids,...(input.drillingFluid.rheologyBottomhole?[{name:input.drillingFluid.name+' (забой)',rheology:input.drillingFluid.rheologyBottomhole}]:[])];
 return fluids.flatMap(f=>{const r=rheologyResolution(f.rheology);return r.valid?[]:[`${f.name||'Жидкость'}: ${r.error}`];});
}
