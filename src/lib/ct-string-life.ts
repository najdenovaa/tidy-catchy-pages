/**
 * Ресурс ГНКТ по длине трубы (малоцикловая усталость) с журналом работ.
 *
 * За каждый рейс участок трубы от КНБК до глубины спуска проходит:
 *   барабан: размотка (изгиб → прямо) и намотка (прямо → изгиб)          — 1 полный цикл при ε_б = OD / D_слоя;
 *   направляющая дуга (гусак): при спуске и при подъёме изгиб + выпрямление — 2 полных цикла при ε_г = OD / (2·R_гусака).
 * Деформация на барабане зависит от слоя намотки: ближе к сердечнику (верхний конец трубы) — больше.
 *
 * Число циклов до разрушения (Коффин–Мэнсон, пластическая составляющая) с учётом внутреннего давления:
 *   N = ½·(ε_a / ε_f)^(1/c) · k_марки · (1 − P/P_разр)^m,  ε_a = ε/2, ε_f = 0.5, c = −0.6, m = 3.
 * Калибровка: 1.5″ на дуге R = 72″ без давления ≈ 1000 циклов; при P ≈ 0.43·P_разр ресурс ниже в ~6 раз
 * (порядок величин по испытаниям Ньюмана/Типтона). Повреждения суммируются по правилу Майнера.
 * Сварные швы и агрессивная среда увеличивают повреждение (коэффициенты).
 *
 * Результат — оценка; для отбраковки используйте паспорт производителя и учёт по системе мониторинга.
 */
import { CT_GRADE_YIELD } from "./ct-engine";

export type JournalKind = "trip" | "recip" | "cut";
export type JournalEnv = "normal" | "acid" | "h2s";

export interface JournalEntry {
  id: string;
  date?: string;
  /** скважина / описание */
  label?: string;
  kind: JournalKind;
  /** рейс: глубина спуска, м; расхаживание: нижняя граница интервала; обрезка: не используется */
  depthM: number;
  /** расхаживание: верхняя граница интервала, м */
  fromM?: number;
  /** число одинаковых рейсов / циклов расхаживания */
  count: number;
  /** давление в трубе во время работы, МПа */
  pressureMPa: number;
  env?: JournalEnv;
  /** обрезка нижнего конца, м */
  cutM?: number;
}

export interface StringWeld { id: string; /** расстояние от конца у барабана (не меняется при обрезке), м */ sFromCoreM: number; type: "butt" | "factory" }

export interface CTStringPassport {
  name: string;
  serial: string;
  /** длина при поставке, м */
  initialLengthM: number;
  /** диаметр сердечника барабана, м */
  reelCoreD: number;
  /** ширина барабана между ребордами, м */
  reelWidthM: number;
  /** радиус направляющей дуги (гусака), м */
  gooseneckRadiusM: number;
  /** порог отбраковки, % израсходованного ресурса */
  retireAtPct: number;
  welds: StringWeld[];
  journal: JournalEntry[];
}

export const ENV_FACTOR: Record<JournalEnv, number> = { normal: 1, acid: 1.3, h2s: 2 };
export const ENV_LABEL: Record<JournalEnv, string> = { normal: "обычная", acid: "кислота", h2s: "H₂S" };
export const WELD_FACTOR: Record<StringWeld["type"], number> = { butt: 2.5, factory: 1.1 };
export const WELD_LABEL: Record<StringWeld["type"], string> = { butt: "стыковой (полевой)", factory: "заводской косой" };

const EPS_F = 0.5, C_EXP = -0.6, P_EXP = 3;

export function defaultPassport(lengthM: number, reelCoreD = 2.13): CTStringPassport {
  return { name: "", serial: "", initialLengthM: lengthM, reelCoreD, reelWidthM: 1.7, gooseneckRadiusM: 1.83, retireAtPct: 80, welds: [], journal: [] };
}

/** Циклов до разрушения при полном цикле изгиба с деформацией eps (доли) и давлении P. */
export function cyclesToFailure(eps: number, pMPa: number, burstMPa: number, yieldMPa: number): number {
  if (eps <= 0) return Infinity;
  const base = 0.5 * Math.pow(eps / 2 / EPS_F, 1 / C_EXP);
  const grade = Math.pow(yieldMPa / 552, 0.8);
  const pr = Math.min(0.95, Math.max(0, pMPa / Math.max(1, burstMPa)));
  return base * grade * Math.pow(1 - pr, P_EXP);
}

/** Диаметр слоя намотки для материала на расстоянии s от сердечника, м */
export function reelLayerD(s: number, odM: number, coreD: number, widthM: number): number {
  const perLayer = Math.max(1, Math.floor(widthM / odM));
  let k = 0, rem = s;
  for (; k < 200; k++) {
    const len = Math.PI * (coreD + odM * (2 * k + 1)) * perLayer;
    if (rem <= len) break;
    rem -= len;
  }
  return coreD + odM * (2 * k + 1);
}

export interface LifePoint {
  /** положение от нижнего конца (КНБК) сейчас, м */
  pos: number;
  /** от конца у барабана, м */
  s: number;
  damagePct: number;
  /** прогноз после планируемой работы, % */
  afterJobPct: number;
  reelStrainPct: number;
  weld: boolean;
}

export interface PlannedJob { depthM: number; pressureMPa: number; env: JournalEnv }

export interface LifeAnalysis {
  currentLengthM: number;
  removedM: number;
  profile: LifePoint[];
  maxDamagePct: number;
  maxAtPos: number;
  strainGooseneckPct: number;
  strainReelMinPct: number;
  strainReelMaxPct: number;
  /** повреждение за одну планируемую работу в худшей точке, % */
  jobDamagePct: number;
  /** сколько ещё таких работ до порога отбраковки */
  jobsToRetire: number;
  /** то же после переворота трубы (смена концов) */
  jobsToRetireFlipped: number;
  /** рекомендуемая обрезка нижнего конца, м (0 — не нужна) */
  recommendedCutM: number;
  jobsAfterCut: number;
  /** рейсов / работ в журнале */
  tripsCount: number;
  recommendations: string[];
  status: "ok" | "watch" | "critical" | "retire";
}

export function analyzeStringLife(p: CTStringPassport, odMm: number, wallMm: number, grade: string, job: PlannedJob, requiredLengthM: number): LifeAnalysis {
  const od = odMm / 1000;
  const Y = CT_GRADE_YIELD[grade] ?? 552;
  const pb = (2 * Y * wallMm) / odMm;
  const L0 = Math.max(1, p.initialLengthM);
  const n = Math.min(800, Math.max(100, Math.round(L0 / 5)));
  const ds = L0 / n;
  const s = Array.from({ length: n }, (_, i) => (i + 0.5) * ds);
  const epsReel = s.map((x) => od / reelLayerD(x, od, p.reelCoreD, p.reelWidthM));
  const epsGn = od / (2 * Math.max(0.3, p.gooseneckRadiusM));
  const weldK = s.map((x) => p.welds.reduce((k, w) => (Math.abs(w.sFromCoreM - x) <= Math.max(1, ds / 2) ? Math.max(k, WELD_FACTOR[w.type]) : k), 1));
  const isWeld = weldK.map((k) => k > 1);
  const dmg = new Array<number>(n).fill(0);
  const perCycle = (i: number, P: number, env: JournalEnv | undefined) =>
    ENV_FACTOR[env ?? "normal"] * weldK[i] * (1 / cyclesToFailure(epsReel[i], P, pb, Y) + 2 / cyclesToFailure(epsGn, P, pb, Y));
  let L = L0, removed = 0, trips = 0;
  for (const e of p.journal) {
    if (e.kind === "cut") { const c = Math.max(0, e.cutM ?? 0); L -= c; removed += c; continue; }
    const cnt = Math.max(0, e.count || 0);
    if (!cnt) continue;
    const lo = e.kind === "recip" ? Math.min(e.depthM, e.fromM ?? e.depthM) : 0;
    const hi = e.kind === "recip" ? Math.max(e.depthM, e.fromM ?? e.depthM) : e.depthM;
    if (e.kind === "trip") trips += cnt;
    for (let i = 0; i < n; i++) {
      if (s[i] > L) continue;
      const x = L - s[i];
      if (x < lo || x > hi) continue;
      dmg[i] += cnt * perCycle(i, e.pressureMPa, e.env);
    }
  }
  const alive = (i: number) => s[i] <= L;
  // планируемая работа
  const jobD = s.map((x, i) => (alive(i) && L - x <= job.depthM ? perCycle(i, job.pressureMPa, job.env) : 0));
  const retire = p.retireAtPct / 100;
  const jobsTo = (dm: number[], jd: number[], from = 0) => {
    let best = Infinity;
    for (let i = 0; i < n; i++) if (alive(i) && L - s[i] >= from && jd[i] > 0) best = Math.min(best, Math.max(0, (retire - dm[i]) / jd[i]));
    return best;
  };
  const jobsToRetire = jobsTo(dmg, jobD);
  // переворот: материал s ↔ L − s (новый «сердечник» — бывший нижний конец); деформация на барабане — по новому слою
  const flippedJob = s.map((x, i) => {
    if (!alive(i)) return 0;
    const sNew = L - x;
    const xNew = L - sNew; // = x: расстояние от нового нижнего конца = прежнее расстояние от сердечника
    if (xNew > job.depthM) return 0;
    const er = od / reelLayerD(sNew, od, p.reelCoreD, p.reelWidthM);
    return ENV_FACTOR[job.env] * weldK[i] * (1 / cyclesToFailure(er, job.pressureMPa, pb, Y) + 2 / cyclesToFailure(epsGn, job.pressureMPa, pb, Y));
  });
  const jobsToRetireFlipped = jobsTo(dmg, flippedJob);
  // рекомендуемая обрезка: минимальная длина снизу, после которой ресурс ≥ 1.5× текущего и не меньше 5 работ
  let recommendedCutM = 0, jobsAfterCut = jobsToRetire;
  const maxCut = L - requiredLengthM;
  if (maxCut > 0) {
    for (let c = 10; c <= maxCut; c += 10) {
      const Lc = L - c;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        if (s[i] > Lc) continue;
        const x = Lc - s[i];
        if (x > job.depthM) continue;
        const d = perCycle(i, job.pressureMPa, job.env);
        best = Math.min(best, Math.max(0, (retire - dmg[i]) / d));
      }
      if (best >= Math.max(5, jobsToRetire * 1.5)) { recommendedCutM = c; jobsAfterCut = best; break; }
    }
  }
  const profile: LifePoint[] = [];
  let maxD = 0, maxAt = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (!alive(i)) continue;
    const pos = L - s[i];
    if (dmg[i] > maxD) { maxD = dmg[i]; maxAt = pos; }
    profile.push({ pos: Math.round(pos), s: Math.round(s[i]), damagePct: Math.round(dmg[i] * 1000) / 10, afterJobPct: Math.round((dmg[i] + jobD[i]) * 1000) / 10, reelStrainPct: Math.round(epsReel[i] * 10000) / 100, weld: isWeld[i] });
  }
  profile.sort((a, b) => a.pos - b.pos);
  const jobDamagePct = Math.max(0, ...jobD) * 100;
  const maxPct = maxD * 100;
  const rec: string[] = [];
  const status: LifeAnalysis["status"] = maxPct >= p.retireAtPct ? "retire" : maxPct >= p.retireAtPct * 0.75 ? "critical" : maxPct >= p.retireAtPct * 0.5 ? "watch" : "ok";
  const fmt = (x: number) => (Number.isFinite(x) ? Math.floor(x).toString() : "∞");
  if (status === "retire") rec.push(`Израсходовано ${maxPct.toFixed(0)}% ресурса на ${Math.round(maxAt)} м от нижнего конца — выше порога ${p.retireAtPct}%. Участок к отбраковке.`);
  if (L < requiredLengthM) rec.push(`Длина трубы ${Math.round(L)} м меньше требуемой ${Math.round(requiredLengthM)} м (глубина работы + запас).`);
  if (Number.isFinite(jobsToRetire)) rec.push(`До порога ${p.retireAtPct}% осталось ≈ ${fmt(jobsToRetire)} работ на ${Math.round(job.depthM)} м при ${job.pressureMPa.toFixed(1)} МПа (за одну работу расходуется до ${jobDamagePct.toFixed(2)}%).`);
  if (recommendedCutM > 0) rec.push(`Отрезать ${recommendedCutM} м нижнего конца: самый изношенный участок уйдёт, ресурс вырастет до ≈ ${fmt(jobsAfterCut)} работ (остаётся ${Math.round(L - recommendedCutM)} м).`);
  if (Number.isFinite(jobsToRetireFlipped) && jobsToRetireFlipped > jobsToRetire * 1.3 && jobsToRetireFlipped > 3) rec.push(`Переворот трубы (смена концов) даст ≈ ${fmt(jobsToRetireFlipped)} работ — изношенная нижняя часть уйдёт к сердечнику и перестанет работать в каждом рейсе.`);
  const hp = job.pressureMPa / pb;
  if (hp > 0.3) rec.push(`Давление ${job.pressureMPa.toFixed(1)} МПа — ${(hp * 100).toFixed(0)}% от давления разрыва: ресурс за рейс в ${(1 / Math.pow(1 - Math.min(0.95, hp), P_EXP)).toFixed(1)} раза меньше, чем без давления. Снижайте давление при прохождении трубы через гусак (спуск/подъём без закачки, где возможно).`);
  if ((status === "retire" || status === "critical") && recommendedCutM === 0 && !(jobsToRetireFlipped > jobsToRetire * 1.3 && jobsToRetireFlipped > 3)) {
    const hot = profile.filter((x) => x.damagePct >= p.retireAtPct * 0.75);
    if (hot.length) rec.push(`Изношенный участок ${hot[0].pos}–${hot[hot.length - 1].pos} м от нижнего конца обрезкой снизу или переворотом не убрать — вырезать участок со стыковой сваркой (шов снижает ресурс) или заменить трубу. Типичная причина — многократное расхаживание в одном интервале: смещайте точки расхаживания.`);
  }
  if (p.welds.some((w) => w.type === "butt")) rec.push("Полевые стыковые швы — слабые места (ресурс ≈ в 2.5 раза ниже); контролируйте их зону при каждом рейсе.");
  return {
    currentLengthM: L, removedM: removed, profile, maxDamagePct: maxPct, maxAtPos: maxAt,
    strainGooseneckPct: epsGn * 100,
    strainReelMinPct: Math.min(...epsReel) * 100, strainReelMaxPct: Math.max(...epsReel) * 100,
    jobDamagePct, jobsToRetire, jobsToRetireFlipped, recommendedCutM, jobsAfterCut, tripsCount: trips,
    recommendations: rec, status,
  };
}
