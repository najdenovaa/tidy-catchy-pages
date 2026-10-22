/**
 * Сборка входных данных 2D-модели вытеснения из программы цементирования:
 * геометрия по глубине (ствол / предыдущая колонна, каверны, центрирование, зенит),
 * жидкости и порции, выходящие из-под башмака в затрубье (с учётом объёма колонны).
 */
import {
  effectiveRheology, getCavernCoeffAtDepth, getEffectiveTrajectory, buildDisplacementSchedule,
  type WellData, type SlurryInput, type BufferFluid, type DrillingFluid, type DisplacementFluid, type VolumeResults, type FlowRateStep,
} from "./cementing-calculations";
import type { D2Fluid, D2Input, D2Stage } from "./displacement-2d";

export const D2_COLORS = {
  mud: ["#3f7d55"],
  spacer: ["#e0a63a", "#9c6bb1", "#d27d4c", "#5aa3c6"],
  cement: ["#8e9aa6", "#c9cfd6", "#6b7785"],
  other: ["#4a90d9"],
};

export interface D2Meta {
  colors: string[];
  /** Время от начала закачки, когда первая порция выходит в затрубье, с */
  annulusStartS: number;
  /** Верх цемента по проекту (MD) */
  designCementTopMD: number;
  shoeMD: number;
  notes: string[];
}

const rateOf = (steps: FlowRateStep[] | undefined, fallbackLps: number) => {
  const st = (steps ?? []).filter((s) => s.rateLps > 0);
  if (!st.length) return fallbackLps;
  const v = st.reduce((a, s) => a + (s.volumeM3 > 0 ? s.volumeM3 : 1), 0);
  return st.reduce((a, s) => a + s.rateLps * (s.volumeM3 > 0 ? s.volumeM3 : 1), 0) / v;
};

function interp(points: { md: number; v: number }[], md: number, def: number) {
  if (!points.length) return def;
  if (md <= points[0].md) return points[0].v;
  for (let i = 1; i < points.length; i++) if (md <= points[i].md) {
    const a = points[i - 1], b = points[i];
    return a.v + ((b.v - a.v) * (md - a.md)) / Math.max(1e-9, b.md - a.md);
  }
  return points[points.length - 1].v;
}

export function buildDisplacementInput(p: {
  wellData: WellData;
  slurries: SlurryInput[];
  buffers: BufferFluid[];
  drillingFluid: DrillingFluid;
  displacementFluids: DisplacementFluid[];
  volumes: VolumeResults;
}): { input: Omit<D2Input, "onProgress">; meta: D2Meta } {
  const { wellData: w, slurries, buffers, drillingFluid: mudIn, displacementFluids, volumes } = p;
  const notes: string[] = [];
  const shoe = w.casingDepthMD;
  const traj = getEffectiveTrajectory(w).slice().sort((a, b) => a.md - b.md);
  const zen = traj.map((t) => ({ md: t.md, v: t.zenith || 0 }));
  const so = (w.standoffProfile ?? []).slice().sort((a, b) => a.md - b.md).map((x) => ({ md: x.md, v: x.standoffPct / 100 }));
  if (!so.length) notes.push(`Профиль центрирования не рассчитан — принят отступ ${w.annularStandoffPct ?? 67}% по всей длине. Рассчитайте вкладку «Центрация» для точной карты.`);
  const soDef = (w.annularStandoffPct ?? 67) / 100;
  const rC = w.casingOD / 2000;
  const geom = (md: number) => {
    const inPrev = w.prevCasingDepth > 0 && md < w.prevCasingDepth && w.prevCasingID > 0;
    const rH = inPrev ? w.prevCasingID / 2000 : (w.holeDiameter * Math.sqrt(getCavernCoeffAtDepth(md, w.cavernCoeff || 1, w.cavernIntervals))) / 2000;
    return { rHole: rH, rCasing: rC, standoff: Math.min(1, Math.max(0.05, interp(so, md, soDef))), inclDeg: interp(zen, md, 0) };
  };

  // Жидкости
  const colors: string[] = [];
  const mudR = effectiveRheology(mudIn.rheologyBottomhole && (mudIn.rheologyBottomhole.pv > 0 || mudIn.rheologyBottomhole.yp > 0) ? mudIn.rheologyBottomhole : mudIn.rheology, "mud");
  const fluids: D2Fluid[] = [{ name: mudIn.name || "Буровой раствор", density: mudIn.density, pv: mudR.pv / 1000, yp: mudR.yp, kind: "mud" }];
  colors.push(D2_COLORS.mud[0]);
  const bufIdx = buffers.map((b, i) => {
    const r = effectiveRheology(b.rheology, "buffer");
    fluids.push({ name: b.name || `Буфер ${i + 1}`, density: b.density, pv: r.pv / 1000, yp: r.yp, kind: "spacer" });
    colors.push(D2_COLORS.spacer[i % D2_COLORS.spacer.length]);
    return fluids.length - 1;
  });
  const slIdx = slurries.map((s, i) => {
    const rho = s.density < 10 ? s.density * 1000 : s.density;
    const r = effectiveRheology(s.rheology, rho >= 1650 ? "heavy_cement" : "light_cement");
    fluids.push({ name: s.name || `Цемент ${i + 1}`, density: rho, pv: r.pv / 1000, yp: r.yp, kind: "cement" });
    colors.push(D2_COLORS.cement[i % D2_COLORS.cement.length]);
    return fluids.length - 1;
  });

  // Закачка у устья: буферы → растворы → продавка
  type Pump = { fluid: number | null; vol: number; rate: number };
  const pumps: Pump[] = [];
  buffers.forEach((b, i) => pumps.push({ fluid: bufIdx[i], vol: Math.max(0, b.volume), rate: rateOf(b.flowRateSteps, 8) / 1000 }));
  slurries.forEach((s, i) => {
    const v = volumes.slurryVolumes[i]?.slurryVolumeM3 ?? 0;
    pumps.push({ fluid: slIdx[i], vol: Math.max(0, v), rate: rateOf(s.flowRateSteps, 8) / 1000 });
  });
  const disp = buildDisplacementSchedule(displacementFluids, volumes.displacementVolumeWithCompression);
  disp.forEach((d) => pumps.push({ fluid: null, vol: d.volumeM3, rate: (d.rateLps || 8) / 1000 }));
  // Выход в затрубье: всё, что закачано сверх объёма колонны, выходит из-под башмака в том же порядке
  const Vc = volumes.totalPipeVolume;
  const exitSeq = pumps.filter((x) => x.fluid !== null) as { fluid: number; vol: number; rate: number }[];
  const stages: D2Stage[] = [];
  let pumped = 0, exitPtr = 0, exitLeft = exitSeq[0]?.vol ?? 0, tStart = 0, tNow = 0, started = false;
  for (const pu of pumps) {
    let left = pu.vol;
    while (left > 1e-9) {
      // объём до момента начала выхода порций
      let chunk = left;
      if (!started) chunk = Math.min(left, Math.max(0, Vc - pumped));
      if (!started && chunk <= 1e-9) { started = true; tStart = tNow; continue; }
      if (started) {
        if (exitPtr >= exitSeq.length) { left = 0; break; }
        chunk = Math.min(left, exitLeft);
        const f = exitSeq[exitPtr].fluid;
        const last = stages[stages.length - 1];
        if (last && last.fluid === f && Math.abs(last.rateM3s - pu.rate) < 1e-9) last.volumeM3 += chunk;
        else stages.push({ fluid: f, volumeM3: chunk, rateM3s: pu.rate });
        exitLeft -= chunk;
        if (exitLeft <= 1e-9) { exitPtr++; exitLeft = exitSeq[exitPtr]?.vol ?? 0; }
      }
      left -= chunk; pumped += chunk; tNow += chunk / Math.max(1e-6, pu.rate);
      if (!started && pumped >= Vc - 1e-9) { started = true; tStart = tNow; }
    }
  }
  const inAnn = stages.reduce((a, s) => a + s.volumeM3, 0);
  const cemOut = stages.filter((s) => fluids[s.fluid].kind === "cement").reduce((a, s) => a + s.volumeM3, 0);
  const cemTotal = slIdx.reduce((a, _, i) => a + (volumes.slurryVolumes[i]?.slurryVolumeM3 ?? 0), 0);
  if (cemTotal - cemOut > 0.05) notes.push(`В колонне ниже ЦКОД остаётся ${(cemTotal - cemOut).toFixed(2)} м³ цемента — в затрубье выходит ${cemOut.toFixed(2)} м³.`);

  // Расчётная область: от верхней границы вышедших порций (+10 % запаса) до башмака
  const annPerM = (md: number) => { const g = geom(md); return Math.PI * (g.rHole ** 2 - g.rCasing ** 2); };
  let acc = 0, top = shoe;
  for (let md = shoe; md > 0; md -= 1) { acc += annPerM(md); top = md; if (acc >= inAnn * 1.1 + 0.5) break; }
  const designTop = slurries.length ? Math.min(...slurries.map((s) => s.topDepthMD)) : top;
  const zTop = Math.max(0, Math.min(top, designTop - 30));
  return {
    input: { zTop, zBot: shoe, geom, fluids, stages, nTheta: 16 },
    meta: { colors, annulusStartS: tStart, designCementTopMD: designTop, shoeMD: shoe, notes },
  };
}
