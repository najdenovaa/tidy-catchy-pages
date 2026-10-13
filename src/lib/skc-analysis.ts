/**
 * Сравнение записи СКЦ с расчётом закачки, поиск отклонений и калибровка модели по факту.
 *
 * Сопоставление идёт по накопленному объёму (не по времени): состав жидкостей в трубе и затрубье
 * определяется объёмом, а паузы и смены расхода на объём не влияют.
 * Расчётное давление пересчитывается на фактический расход: P = P_статика(V) + k·P_трения(V)·(Q_факт/Q_план)^α.
 * Множитель трения k калибруется по участку до выхода цемента из башмака (затрубье ещё заполнено
 * буровым раствором, т. е. гидростатика известна надёжно) — затем модель с k проверяет остальную операцию.
 */
import type { PressureProfileResult, SlurryInput, DisplacementFluid, VolumeResults, BufferFluid, DrillingFluid } from "./cementing-calculations";
import type { SkcPoint } from "./skc-import";

export interface SkcAnalysisInput {
  series: SkcPoint[];
  plan: PressureProfileResult;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  displacementFluids: DisplacementFluid[];
  drillingFluid: DrillingFluid;
  volumes: VolumeResults;
  /** Давление среза пробки / ожидаемый скачок «СТОП», МПа */
  plugBumpMPa: number;
  /** Смещение объёма записи относительно расчёта, м³ (null — автоопределение) */
  volumeOffsetM3: number | null;
  /** Показатель степени зависимости трения от расхода */
  alpha?: number;
}

export type EventLevel = "critical" | "warning" | "info" | "ok";
export interface SkcEvent { level: EventLevel; title: string; detail: string; fromV?: number; toV?: number }

export interface AlignedPoint {
  /** объём по расчётной шкале, м³ */
  v: number;
  t: number;
  pFact: number;
  pPlan: number;
  pModel: number;
  qFact: number;
  qPlan: number;
  rhoFact: number;
  rhoPlan: number;
  stage: string;
  cementInAnnulus: boolean;
}

export interface SkcAnalysis {
  offsetM3: number;
  offsetSource: "плотность цемента" | "начало закачки" | "задано";
  aligned: AlignedPoint[];
  calibration: { kFriction: number; points: number; rmsBefore: number; rmsAfter: number; window: string; reliable: boolean };
  events: SkcEvent[];
  cement: { name: string; planDensity: number; meanDensity: number; outOfSpecM3: number; volumeFactM3: number; volumePlanM3: number }[];
  plug: { detected: boolean; displacementFactM3: number | null; displacementPlanM3: number; deviationPct: number | null; bumpPressureMPa: number | null };
  tocEstimate: { residualMPa: number; shiftM: number; plannedTopMD: number; estimatedTopMD: number; cavernFactor: number | null } | null;
  rmsResidualMPa: number;
}

const interp = (xs: number[], ys: number[], x: number) => {
  if (!xs.length) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const k = (x - xs[lo]) / Math.max(1e-9, xs[hi] - xs[lo]);
  return ys[lo] + k * (ys[hi] - ys[lo]);
};
const rms = (a: number[]) => a.length ? Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length) : 0;

export function analyzeSkc(inp: SkcAnalysisInput): SkcAnalysis {
  const alpha = inp.alpha ?? 0.8;
  const plan = inp.plan.points.filter((p) => p.pumpRateLps > 0);
  // Плановая шкала по объёму (берём последнюю точку для повторяющихся объёмов)
  const pv: number[] = [], pS: number[] = [], pF: number[] = [], pQ: number[] = [], pR: number[] = [], pC: number[] = [];
  const stages: string[] = [];
  for (const p of plan) {
    if (pv.length && p.cumulativeVolume <= pv[pv.length - 1] + 1e-9) { pv.pop(); pS.pop(); pF.pop(); pQ.pop(); pR.pop(); pC.pop(); stages.pop(); }
    const st = p.surfaceStaticMPa ?? p.surfacePressure;
    pv.push(p.cumulativeVolume); pS.push(st); pF.push(Math.max(0, p.surfacePressure - st)); pQ.push(p.pumpRateLps);
    pR.push(p.densityGcm3); pC.push(p.annCementHeightM); stages.push(p.stage);
  }
  const stageAt = (v: number) => {
    let i = pv.findIndex((x) => x >= v);
    if (i < 0) i = pv.length - 1;
    return { stage: stages[i] ?? "—", cem: (pC[i] ?? 0) > 1 };
  };

  // ── Совмещение по объёму ──
  const s = inp.series.filter((x) => Number.isFinite(x.v));
  const cementStartPlanV = (() => {
    const t = inp.plan.cementStartTime;
    const p = inp.plan.points.find((x) => x.time >= t - 1e-6 && x.densityGcm3 >= Math.min(...inp.slurries.map((sl) => sl.density)) - 0.01);
    return p ? Math.max(0, p.cumulativeVolume - 0.05) : null;
  })();
  let offset = 0;
  let offsetSource: SkcAnalysis["offsetSource"] = "начало закачки";
  if (inp.volumeOffsetM3 !== null) { offset = inp.volumeOffsetM3; offsetSource = "задано"; }
  else {
    const leadRho = inp.slurries[0]?.density ?? 1.8;
    const hasRho = s.filter((x) => Number.isFinite(x.rho)).length > s.length * 0.5;
    let found = false;
    if (hasRho && cementStartPlanV !== null) {
      for (let i = 0; i + 4 < s.length; i++) {
        if ([0, 1, 2, 3, 4].every((k) => s[i + k].rho >= leadRho - 0.06)) { offset = s[i].v - cementStartPlanV; offsetSource = "плотность цемента"; found = true; break; }
      }
    }
    if (!found) {
      const i0 = s.findIndex((x, i) => x.q > 0.5 && (s[i + 1]?.q ?? 0) > 0.5 && (s[i + 2]?.q ?? 0) > 0.5);
      offset = i0 >= 0 ? s[i0].v : 0;
    }
  }

  // ── Выравненный ряд ──
  const aligned: AlignedPoint[] = s.map((x) => {
    const v = x.v - offset;
    const st = stageAt(v);
    const qPlan = interp(pv, pQ, v);
    const fr = interp(pv, pF, v);
    const ratio = qPlan > 0.1 && Number.isFinite(x.q) ? Math.pow(Math.max(0, x.q) / qPlan, alpha) : 0;
    return {
      v, t: x.t, pFact: x.p, pPlan: interp(pv, pS, v) + fr, pModel: interp(pv, pS, v) + fr * ratio,
      qFact: x.q, qPlan, rhoFact: x.rho, rhoPlan: interp(pv, pR, v), stage: st.stage, cementInAnnulus: st.cem,
    };
  });
  const vMaxPlan = pv[pv.length - 1] ?? 0;
  const pumping = aligned.filter((a) => a.qFact > 1 && a.v >= 0 && a.v <= vMaxPlan && Number.isFinite(a.pFact));

  // ── Калибровка трения: до выхода цемента из башмака ──
  const pipeVol = inp.volumes.totalPipeVolume;
  const calWindowEnd = (cementStartPlanV ?? 0) + pipeVol;
  let win = pumping.filter((a) => a.v <= calWindowEnd && !a.cementInAnnulus);
  let windowLabel = `0–${calWindowEnd.toFixed(1)} м³ (до выхода цемента в затрубье)`;
  if (win.length < 15) { win = pumping; windowLabel = "вся операция (мало точек до выхода цемента)"; }
  let num = 0, den = 0;
  const pairs = win.map((a) => {
    const fr = interp(pv, pF, a.v) * (a.qPlan > 0.1 ? Math.pow(a.qFact / a.qPlan, alpha) : 0);
    const stat = interp(pv, pS, a.v);
    return { fr, y: a.pFact - stat };
  });
  pairs.forEach(({ fr, y }) => { num += fr * y; den += fr * fr; });
  const kRaw = den > 1e-6 ? num / den : 1;
  const k = Math.min(3, Math.max(0.3, kRaw));
  const rmsBefore = rms(win.map((a) => a.pFact - a.pModel));
  aligned.forEach((a) => {
    const fr = interp(pv, pF, a.v) * (a.qPlan > 0.1 && Number.isFinite(a.qFact) ? Math.pow(Math.max(0, a.qFact) / a.qPlan, alpha) : 0);
    a.pModel = interp(pv, pS, a.v) + k * fr;
  });
  const rmsAfter = rms(win.map((a) => a.pFact - a.pModel));
  const events: SkcEvent[] = [];
  const reliable = win.length >= 15 && den > 0.5 && Math.abs(kRaw - k) < 1e-9;
  events.push({
    level: Math.abs(k - 1) > 0.35 ? "warning" : "info",
    title: `Калибровка трения: k = ${k.toFixed(2)}`,
    detail: `Фактическое трение ${k >= 1 ? "выше" : "ниже"} расчётного в ${(k >= 1 ? k : 1 / k).toFixed(2)} раза (участок ${windowLabel}; СКО до ${rmsBefore.toFixed(2)} → после ${rmsAfter.toFixed(2)} МПа).${Math.abs(k - 1) > 0.35 ? " Существенное отличие — проверить реологию растворов (замер Fann при температуре) и кавернозность." : ""}`,
  });

  // ── Отклонения давления ──
  const runs = (pred: (a: AlignedPoint) => boolean, minLenM3: number) => {
    const out: { from: number; to: number; pts: AlignedPoint[] }[] = [];
    let cur: AlignedPoint[] = [];
    for (const a of pumping) {
      if (pred(a)) cur.push(a);
      else { if (cur.length && cur[cur.length - 1].v - cur[0].v >= minLenM3) out.push({ from: cur[0].v, to: cur[cur.length - 1].v, pts: cur }); cur = []; }
    }
    if (cur.length && cur[cur.length - 1].v - cur[0].v >= minLenM3) out.push({ from: cur[0].v, to: cur[cur.length - 1].v, pts: cur });
    return out;
  };
  const worstZone = [...inp.plan.zoneChecks].sort((a, b) => a.marginMPa - b.marginMPa)[0];
  runs((a) => a.v > calWindowEnd && a.pFact - a.pModel < -Math.max(1, 0.15 * a.pModel), 1.5).forEach((r) => {
    const d = r.pts.reduce((t, a) => t + (a.pFact - a.pModel), 0) / r.pts.length;
    events.push({
      level: "critical", title: "Давление ниже расчётного — возможное поглощение",
      detail: `${r.from.toFixed(1)}–${r.to.toFixed(1)} м³: в среднем на ${Math.abs(d).toFixed(1)} МПа ниже модели при фактическом расходе.${worstZone ? ` Наиболее вероятное место — «${worstZone.name}» (минимальный расчётный запас ${worstZone.marginMPa.toFixed(2)} МПа).` : ""} Проверить выход раствора на устье, уровень в ёмкостях.`,
      fromV: r.from, toV: r.to,
    });
  });
  runs((a) => a.v > calWindowEnd && a.pFact - a.pModel > Math.max(1.5, 0.2 * a.pModel), 1).forEach((r) => {
    const d = r.pts.reduce((t, a) => t + (a.pFact - a.pModel), 0) / r.pts.length;
    events.push({
      level: "warning", title: "Давление выше расчётного",
      detail: `${r.from.toFixed(1)}–${r.to.toFixed(1)} м³: в среднем на ${d.toFixed(1)} МПа выше модели. Возможные причины: начало загустевания, сальник/сужение ствола, неверная реология цемента.`,
      fromV: r.from, toV: r.to,
    });
  });

  // ── Расход ──
  const qMaxFact = Math.max(0, ...pumping.map((a) => a.qFact));
  const qMaxPlan = Math.max(0, ...pQ);
  if (qMaxFact > qMaxPlan * 1.1) events.push({ level: "warning", title: "Расход выше запланированного", detail: `Максимум ${qMaxFact.toFixed(1)} л/с при плане ${qMaxPlan.toFixed(1)} л/с — запас до ГРП/поглощения был меньше расчётного.` });

  // ── Цемент: плотность и объём ──
  const cement: SkcAnalysis["cement"] = [];
  const hasRho = aligned.some((a) => Number.isFinite(a.rhoFact));
  inp.slurries.forEach((sl, i) => {
    const ranges: [number, number][] = [];
    for (let j = 0; j < pv.length; j++) {
      if (Math.abs(pR[j] - sl.density) < 1e-6 && stages[j] === sl.name) {
        const a = j > 0 ? pv[j - 1] : 0;
        if (ranges.length && Math.abs(ranges[ranges.length - 1][1] - a) < 1e-6) ranges[ranges.length - 1][1] = pv[j]; else ranges.push([a, pv[j]]);
      }
    }
    const inR = (v: number) => ranges.some(([a, b]) => v >= a && v <= b);
    const pts = aligned.filter((a) => inR(a.v) && Number.isFinite(a.rhoFact));
    let off = 0;
    for (let k2 = 1; k2 < pts.length; k2++) if (Math.abs(pts[k2].rhoFact - sl.density) > 0.02) off += Math.max(0, pts[k2].v - pts[k2 - 1].v);
    const planVol = ranges.reduce((t, [a, b]) => t + (b - a), 0);
    const factVol = hasRho
      ? (() => { let v = 0; for (let k2 = 1; k2 < aligned.length; k2++) { const a = aligned[k2]; if (Number.isFinite(a.rhoFact) && Math.abs(a.rhoFact - sl.density) <= 0.06 && a.qFact > 0.5) v += Math.max(0, a.v - aligned[k2 - 1].v); } return v; })()
      : planVol;
    const mean = pts.length ? pts.reduce((t, a) => t + a.rhoFact, 0) / pts.length : NaN;
    cement.push({ name: sl.name, planDensity: sl.density, meanDensity: mean, outOfSpecM3: off, volumeFactM3: factVol, volumePlanM3: planVol });
    if (hasRho && pts.length) {
      if (Math.abs(mean - sl.density) > 0.02) events.push({ level: "critical", title: `Плотность «${sl.name}» вне допуска`, detail: `Средняя ${mean.toFixed(3)} г/см³ при проекте ${sl.density.toFixed(2)} ± 0,02.` });
      else if (off > Math.max(0.5, planVol * 0.1)) events.push({ level: "warning", title: `«${sl.name}»: ${off.toFixed(1)} м³ вне допуска по плотности`, detail: `Средняя плотность ${mean.toFixed(3)} г/см³ в норме, но ${((off / Math.max(0.1, planVol)) * 100).toFixed(0)}% объёма — с отклонением более 0,02 г/см³ (неравномерное затворение).` });
      else events.push({ level: "ok", title: `«${sl.name}»: плотность в допуске`, detail: `Средняя ${mean.toFixed(3)} г/см³, вне допуска ${off.toFixed(1)} м³.` });
    }
    void i;
  });
  if (!hasRho) events.push({ level: "info", title: "Плотность в записи отсутствует", detail: "Контроль плотности цемента и совмещение по началу цемента недоступны; совмещено по началу закачки." });

  // ── Посадка пробки ──
  const dispStartPlan = (() => {
    const lastCem = Math.max(...stages.map((st, j) => (inp.slurries.some((sl) => sl.name === st) ? pv[j] : -1)));
    return lastCem > 0 ? lastCem : null;
  })();
  const dispPlan = inp.volumes.displacementVolumeWithCompression;
  let plug: SkcAnalysis["plug"] = { detected: false, displacementFactM3: null, displacementPlanM3: dispPlan, deviationPct: null, bumpPressureMPa: null };
  const tail = aligned.filter((a) => Number.isFinite(a.pFact) && a.v > (dispStartPlan ?? 0) + dispPlan * 0.8);
  const jump = Math.max(2, inp.plugBumpMPa * 0.8);
  for (let i = 1; i < tail.length; i++) {
    const base = tail.slice(Math.max(0, i - 6), i).map((a) => a.pFact);
    const baseline = base.length ? Math.min(...base) : tail[i - 1].pFact;
    if (tail[i].pFact - baseline >= jump && tail[i].v - tail[Math.max(0, i - 6)].v <= 0.6) {
      const dispFact = dispStartPlan !== null ? tail[i].v - dispStartPlan : null;
      plug = {
        detected: true, displacementFactM3: dispFact, displacementPlanM3: dispPlan,
        deviationPct: dispFact !== null ? ((dispFact - dispPlan) / dispPlan) * 100 : null, bumpPressureMPa: tail[i].pFact,
      };
      break;
    }
  }
  if (plug.detected && plug.deviationPct !== null) {
    const dv = plug.deviationPct;
    events.push({
      level: Math.abs(dv) > 3 ? "critical" : Math.abs(dv) > 1.5 ? "warning" : "ok",
      title: `Посадка пробки «СТОП» на ${plug.displacementFactM3!.toFixed(2)} м³ продавки`,
      detail: `Расчётный объём продавки ${dispPlan.toFixed(2)} м³, отклонение ${dv >= 0 ? "+" : ""}${dv.toFixed(1)}%.${dv < -1.5 ? " Пробка села раньше расчёта: возможна неточность внутреннего диаметра/объёма колонны или остаток цемента выше ЦКОД." : dv > 1.5 ? " Пробка села позже расчёта: сжатие продавочной жидкости, негерметичность пробки или ошибка учёта объёма." : ""}`,
    });
  } else if (!plug.detected) {
    const lastV = Math.max(...aligned.map((a) => a.v));
    const pumpedDisp = dispStartPlan !== null ? lastV - dispStartPlan : null;
    events.push({
      level: "warning", title: "Посадка пробки «СТОП» не обнаружена",
      detail: `В записи нет скачка давления ≥ ${jump.toFixed(1)} МПа в конце продавки.${pumpedDisp !== null ? ` Закачано продавки ≈ ${pumpedDisp.toFixed(2)} м³ при расчётных ${dispPlan.toFixed(2)} м³.` : ""} Проверить запись до конца операции.`,
    });
  }

  // ── Оценка верха цемента по «подъёмному» давлению в конце продавки ──
  let tocEstimate: SkcAnalysis["tocEstimate"] = null;
  const endEnd = plug.detected && plug.displacementFactM3 !== null && dispStartPlan !== null ? dispStartPlan + plug.displacementFactM3 - 0.3 : Math.max(...pumping.map((a) => a.v));
  const endWin = pumping.filter((a) => a.v > endEnd - 2 && a.v <= endEnd && a.cementInAnnulus);
  if (endWin.length >= 5) {
    const res = endWin.reduce((t, a) => t + (a.pFact - a.pModel), 0) / endWin.length;
    const rhoCem = inp.slurries.reduce((t, sl) => t + sl.density, 0) / Math.max(1, inp.slurries.length);
    const drho = rhoCem - inp.drillingFluid.density / 1000;
    if (drho > 0.05) {
      const shift = -res / (drho * 0.00981); // м по вертикали; >0 — верх цемента ниже плана
      const top = Math.min(...inp.slurries.map((sl) => sl.topDepthMD));
      const shoe = inp.plan.points.length ? inp.volumes.slurryVolumes.reduce((t, x) => t + x.heightM, 0) : 0;
      const hPlan = shoe;
      const cav = hPlan > 0 && hPlan - shift > 50 ? hPlan / (hPlan - shift) : null;
      tocEstimate = { residualMPa: res, shiftM: shift, plannedTopMD: top, estimatedTopMD: top + shift, cavernFactor: cav };
      if (Math.abs(res) > 0.7) {
        events.push({
          level: shift > 150 ? "critical" : "warning", title: shift > 0 ? "Верх цемента, вероятно, ниже проекта" : "Верх цемента, вероятно, выше проекта",
          detail: `«Подъёмное» давление в конце продавки ${res >= 0 ? "выше" : "ниже"} расчётного на ${Math.abs(res).toFixed(1)} МПа → смещение верха цемента ≈ ${Math.abs(shift).toFixed(0)} м по вертикали${cav ? `; фактическая кавернозность выше расчётной в ≈ ${cav.toFixed(2)} раза` : ""}. Подтвердить АКЦ / термометрией.`,
        });
      } else {
        events.push({ level: "ok", title: "Подъём цемента соответствует расчёту", detail: `Отклонение «подъёмного» давления ${res.toFixed(2)} МПа — в пределах точности.` });
      }
    }
  }

  const rmsResidualMPa = rms(pumping.map((a) => a.pFact - a.pModel));
  return {
    offsetM3: offset, offsetSource, aligned,
    calibration: { kFriction: k, points: win.length, rmsBefore, rmsAfter, window: windowLabel, reliable },
    events, cement, plug, tocEstimate, rmsResidualMPa,
  };
}

/** Синтетическая запись СКЦ по расчёту — для демонстрации и проверки (с шумом, повышенным трением, поглощением). */
export function syntheticSkcCsv(plan: PressureProfileResult, opts: { frictionK?: number; lossFromV?: number; lossMPa?: number; densityNoise?: number; seed?: number; bumpExtraM3?: number; bumpMPa?: number } = {}): string {
  let a = opts.seed ?? 7;
  const rnd = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const k = opts.frictionK ?? 1.25;
  const pts = plan.points.filter((p) => p.pumpRateLps > 0);
  const lines = ["Время;Давление, МПа;Расход, л/с;Плотность, г/см3"];
  const pre = 3; // минут промывки линий до начала
  let t = 0;
  for (let i = 0; i < pre * 6; i++) { lines.push(`${fmtT(t)};${(0.2 + rnd() * 0.1).toFixed(2)};0.0;1.00`); t += 10 / 60; }
  let v = 0;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1], p1 = pts[i];
    const dv = p1.cumulativeVolume - p0.cumulativeVolume;
    if (dv <= 0) continue;
    const q = p1.pumpRateLps;
    const dtMin = (dv * 1000) / q / 60;
    const n = Math.max(1, Math.round(dtMin * 6));
    for (let j = 1; j <= n; j++) {
      const f = j / n;
      v = p0.cumulativeVolume + dv * f;
      const st = (p0.surfaceStaticMPa ?? 0) + ((p1.surfaceStaticMPa ?? 0) - (p0.surfaceStaticMPa ?? 0)) * f;
      const fr = Math.max(0, p1.surfacePressure - (p1.surfaceStaticMPa ?? p1.surfacePressure));
      let p = st + k * fr + (rnd() - 0.5) * 0.3;
      if (opts.lossFromV !== undefined && v >= opts.lossFromV) p -= opts.lossMPa ?? 2.5;
      const rho = p1.densityGcm3 + (rnd() - 0.5) * 2 * (opts.densityNoise ?? 0.012);
      t += dtMin / n;
      lines.push(`${fmtT(t)};${Math.max(0, p).toFixed(2)};${(q * (1 + (rnd() - 0.5) * 0.04)).toFixed(2)};${rho.toFixed(3)}`);
    }
  }
  // посадка пробки
  const last = pts[pts.length - 1];
  const lastP = last ? Math.max(0, (last.surfaceStaticMPa ?? 0) + k * Math.max(0, last.surfacePressure - (last.surfaceStaticMPa ?? 0))) : 5;
  const extraSteps = Math.max(0, Math.round(((opts.bumpExtraM3 ?? 0) * 1000) / Math.max(1, last?.pumpRateLps ?? 4) / 10));
  for (let j = 0; j < extraSteps; j++) { t += 10 / 60; lines.push(`${fmtT(t)};${lastP.toFixed(2)};${(last?.pumpRateLps ?? 4).toFixed(2)};${(last?.densityGcm3 ?? 1).toFixed(3)}`); }
  for (let j = 1; j <= 4; j++) { t += 5 / 60; lines.push(`${fmtT(t)};${(lastP + (opts.bumpMPa ?? 4) * j / 4).toFixed(2)};${(last?.pumpRateLps ?? 4).toFixed(2)};${(last?.densityGcm3 ?? 1).toFixed(3)}`); }
  for (let j = 0; j < 6; j++) { t += 10 / 60; lines.push(`${fmtT(t)};${(lastP + (opts.bumpMPa ?? 4)).toFixed(2)};0.0;${(last?.densityGcm3 ?? 1).toFixed(3)}`); }
  return lines.join("\n");
}

function fmtT(min: number): string {
  const total = Math.round(min * 60) + 9 * 3600; // начало записи 09:00:00
  const h = Math.floor(total / 3600) % 24, m = Math.floor((total % 3600) / 60), s2 = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}`;
}
