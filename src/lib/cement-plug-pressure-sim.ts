/**
 * Пошаговый расчёт давлений при установке цементного моста (график давление/объём).
 *
 * Геометрия по глубине: затрубье выше башмака — по ВД обсадной колонны, ниже — по стволу
 * с кавернозностью; трубы — по секциям компоновки. Жидкости отслеживаются объёмными пачками,
 * трение — тем же расчётом, что в программе цементирования (Бингам или Гершель–Балкли по Fann).
 */

import { interpolateTVD, effectiveRheology, hbOf, annularFrictionMPa, pipeFrictionMPa, type Rheology } from "./cementing-calculations";
import type { PlugFluid } from "./cement-plug-calculations";
import type { PlugInputs, PlugResults } from "./cement-plug-calculations";

/* ───── Output ───── */

export interface PressureTimePoint {
  timeMin: number;
  stage: string;
  pumpRateLs: number;
  volumePumpedM3: number;
  volSpacerM3: number;    // cumulative spacer volume
  volCementM3: number;    // cumulative cement volume
  volDisplM3: number;     // cumulative displacement volume
  volWashM3: number;      // cumulative wash volume
  bhpMPa: number;
  shoePressMPa: number;   // pressure at casing shoe depth (annulus side)
  surfaceMPa: number;
  fracMPa: number;
  hydroStaticAnnMPa: number;
  hydroStaticPipeMPa: number;
  frictionMPa: number;
}

/* ───── Геометрия ───── */

const areaM2 = (dMm: number) => (Math.PI / 4) * (dMm / 1000) ** 2;
const hydroMPa = (densGcm3: number, tvdM: number) => (densGcm3 * 9.81 * tvdM) / 1000;

type FluidKey = "mud" | "spacer" | "pad" | "cement";
interface Packet { fluid: FluidKey; vol: number }
interface Cell { top: number; bot: number; len: number; dTvd: number; pipeId: number; pipeOd: number; bore: number; pipeVol: number; annVol: number }

export function simulatePlugPressures(
  input: PlugInputs,
  results: PlugResults,
  fracGradientMPaPerM: number,
): PressureTimePoint[] {
  const { well, plug, cement, spacer, wellFluid } = input;
  const traj = well.trajectory.length > 1 ? well.trajectory
    : [{ md: 0, azimuth: 0, zenith: 0, tvd: 0 }, { md: well.wellDepthMD, azimuth: 0, zenith: 0, tvd: well.wellDepthMD }];
  const tvd = (md: number) => interpolateTVD(Math.max(0, Math.min(well.wellDepthMD, md)), traj);
  const pipeEndMD = plug.bottomMD;
  const padFluid: PlugFluid = input.useViscousPad && input.viscousPadFluid ? input.viscousPadFluid : spacer;

  const sections = results.pipeSectionsUsed?.length ? results.pipeSectionsUsed : [{ fromMD: 0, toMD: pipeEndMD, od: well.pipeOD, id: well.pipeID }];
  const pipeAt = (md: number) => sections.find((x) => md >= x.fromMD && md < x.toMD) ?? sections[sections.length - 1];
  const openBore = results.boreDiamUsed;
  const boreAt = (md: number) => (results.isOpenHole && md > well.casingShoe ? openBore : well.casingID);

  // Ячейки по глубине (границы — башмак и концы секций попадают точно)
  const breaks = new Set<number>([0, pipeEndMD]);
  if (results.isOpenHole && well.casingShoe > 0 && well.casingShoe < pipeEndMD) breaks.add(well.casingShoe);
  sections.forEach((x) => { if (x.fromMD > 0 && x.fromMD < pipeEndMD) breaks.add(x.fromMD); if (x.toMD > 0 && x.toMD < pipeEndMD) breaks.add(x.toMD); });
  const bp = [...breaks].sort((a, b) => a - b);
  const step = Math.max(2, pipeEndMD / 600);
  const cells: Cell[] = [];
  for (let k = 0; k < bp.length - 1; k++) {
    const n = Math.max(1, Math.ceil((bp[k + 1] - bp[k]) / step));
    for (let j = 0; j < n; j++) {
      const top = bp[k] + ((bp[k + 1] - bp[k]) * j) / n, bot = bp[k] + ((bp[k + 1] - bp[k]) * (j + 1)) / n;
      const mid = (top + bot) / 2, ps = pipeAt(mid), bore = boreAt(mid), len = bot - top;
      cells.push({ top, bot, len, dTvd: tvd(bot) - tvd(top), pipeId: ps.id, pipeOd: ps.od, bore, pipeVol: areaM2(ps.id) * len, annVol: Math.max(1e-6, areaM2(bore) - areaM2(ps.od)) * len });
    }
  }
  const pipeTotal = cells.reduce((t, c) => t + c.pipeVol, 0);
  const annTotal = cells.reduce((t, c) => t + c.annVol, 0);

  const props = (f: FluidKey) => {
    const src = f === "cement" ? cement : f === "spacer" ? spacer : f === "pad" ? padFluid : wellFluid;
    const cat = f === "cement" ? (cement.density >= 1.65 ? "heavy_cement" : "light_cement") : f === "mud" ? "mud" : "buffer";
    const r: Rheology = effectiveRheology(src.rheology, cat as never);
    return { density: src.density, pv: r.pv, yp: r.yp, hb: hbOf(src.rheology) };
  };
  const P: Record<FluidKey, ReturnType<typeof props>> = { mud: props("mud"), spacer: props("spacer"), pad: props("pad"), cement: props("cement") };

  // Содержимое: трубы — от устья вниз, затрубье — от конца труб вверх
  let pipe: Packet[] = [{ fluid: "mud", vol: pipeTotal }];
  let ann: Packet[] = [{ fluid: "mud", vol: annTotal }];

  const merge = (a: Packet[]) => a.reduce<Packet[]>((m, x) => { if (x.vol <= 1e-12) return m; const l = m[m.length - 1]; if (l && l.fluid === x.fluid) l.vol += x.vol; else m.push({ ...x }); return m; }, []);
  const takeFromEnd = (a: Packet[], v: number): Packet[] => {
    const out: Packet[] = [];
    while (v > 1e-12 && a.length) {
      const l = a[a.length - 1];
      const d = Math.min(v, l.vol);
      out.unshift({ fluid: l.fluid, vol: d }); l.vol -= d; v -= d;
      if (l.vol <= 1e-12) a.pop();
    }
    return out;
  };
  function pump(fluid: FluidKey, v: number) {
    pipe.unshift({ fluid, vol: v });
    const out = takeFromEnd(pipe, v); // выходит из конца труб (нижние пачки)
    // в затрубье поступает снизу: первой вышла самая нижняя пачка и её поднимает выше —
    // поэтому порядок «снизу вверх» в затрубье совпадает с порядком «сверху вниз» в трубах
    ann = [...out, ...ann];
    takeFromEnd(ann, v); // уходит на устье
    pipe = merge(pipe); ann = merge(ann);
  }

  /** Обход ячеек с распределением пачек: callback(cell, fluid, доля ячейки). */
  function walk(packets: Packet[], order: Cell[], volOf: (c: Cell) => number, cb: (c: Cell, f: FluidKey, frac: number) => void) {
    let pi = 0, left = packets[0]?.vol ?? 0;
    for (const c of order) {
      let need = volOf(c);
      const total = need;
      while (need > 1e-12 && pi < packets.length) {
        const d = Math.min(need, left);
        cb(c, packets[pi].fluid, d / total);
        need -= d; left -= d;
        if (left <= 1e-12) { pi++; left = packets[pi]?.vol ?? 0; }
      }
      if (need > 1e-12) cb(c, "mud", need / total);
    }
  }

  const bottomTVD = tvd(pipeEndMD);
  const fracMPa = fracGradientMPaPerM * bottomTVD;
  const cellsUp = [...cells].reverse();
  const points: PressureTimePoint[] = [];
  let timeMin = 0, cum = 0, cumSpacer = 0, cumCement = 0, cumDispl = 0, cumWash = 0;

  function computePoint(stage: string, rateLs: number): PressureTimePoint {
    let hPipe = 0, fPipe = 0, hAnn = 0, fAnn = 0, hBelowShoe = 0, fBelowShoe = 0;
    walk(pipe, cells, (c) => c.pipeVol, (c, f, fr) => {
      const p = P[f];
      hPipe += hydroMPa(p.density, c.dTvd * fr);
      if (rateLs > 0) fPipe += pipeFrictionMPa(rateLs, c.len * fr, c.pipeId, p.pv, p.yp, p.density * 1000, p.hb).pressureMPa;
    });
    walk(ann, cellsUp, (c) => c.annVol, (c, f, fr) => {
      const p = P[f];
      const h = hydroMPa(p.density, c.dTvd * fr);
      const fr2 = rateLs > 0 ? annularFrictionMPa(rateLs, c.len * fr, c.bore, c.pipeOd, p.pv, p.yp, p.density * 1000, 100, p.hb).pressureMPa : 0;
      hAnn += h; fAnn += fr2;
      if (results.isOpenHole && c.top >= well.casingShoe - 1e-6) { hBelowShoe += h; fBelowShoe += fr2; }
    });
    const bhp = hAnn + fAnn;
    return {
      timeMin, stage, pumpRateLs: rateLs, volumePumpedM3: cum,
      volSpacerM3: cumSpacer, volCementM3: cumCement, volDisplM3: cumDispl, volWashM3: cumWash,
      bhpMPa: bhp,
      shoePressMPa: Math.max(0, bhp - hBelowShoe - fBelowShoe),
      surfaceMPa: Math.max(0, hAnn + fAnn - hPipe + fPipe),
      fracMPa, hydroStaticAnnMPa: hAnn, hydroStaticPipeMPa: hPipe, frictionMPa: fPipe + fAnn,
    };
  }

  const stages: { name: string; fluid: FluidKey; volumeM3: number; rateLs: number }[] = [];
  if (input.useViscousPad && input.spacerVolumeBelowM3 > 0) stages.push({ name: "Вязкая пачка", fluid: "pad", volumeM3: input.spacerVolumeBelowM3, rateLs: input.pumpRateSpacerLs });
  // Верхний буфер делится как в программе: затрубная часть — перед цементом, трубная — после
  const spAnn = results.annArea * results.spacerAboveHeightAnnMD, spPipe = Math.max(0, input.spacerVolumeAboveM3 - spAnn);
  if (spAnn > 0) stages.push({ name: "Буфер (затрубье)", fluid: "spacer", volumeM3: spAnn, rateLs: input.pumpRateSpacerLs });
  stages.push({ name: "Цемент", fluid: "cement", volumeM3: results.cementVolumeTotal, rateLs: input.pumpRateCementLs });
  if (spPipe > 0) stages.push({ name: "Буфер (трубы)", fluid: "spacer", volumeM3: spPipe, rateLs: input.pumpRateSpacerLs });
  stages.push({ name: "Продавка", fluid: "mud", volumeM3: results.displacementVolume, rateLs: input.pumpRateDisplacementLs });

  const dt = 0.5;
  points.push(computePoint("Статика", 0));
  for (const st of stages) {
    if (st.volumeM3 <= 0 || st.rateLs <= 0) continue;
    const tStage = (st.volumeM3 * 1000) / st.rateLs / 60;
    const n = Math.max(1, Math.ceil(tStage / dt));
    for (let k = 0; k < n; k++) {
      const dv = st.volumeM3 / n;
      pump(st.fluid, dv);
      timeMin += tStage / n; cum += dv;
      if (st.fluid === "cement") cumCement += dv; else if (st.fluid === "mud") cumDispl += dv; else cumSpacer += dv;
      points.push(computePoint(st.name, st.rateLs));
    }
  }
  // После продавки трубы поднимают из цемента: статика моста (затрубье на подошве), на устье 0
  const afterPlace = computePoint("Подъём", 0);
  const staticBhp = afterPlace.hydroStaticAnnMPa;
  const staticShoe = afterPlace.shoePressMPa;
  if (results.tripTimeMin > 0) {
    const n = Math.max(1, Math.ceil(results.tripTimeMin / dt));
    for (let k = 0; k < n; k++) {
      timeMin += results.tripTimeMin / n;
      points.push({ ...afterPlace, timeMin, surfaceMPa: 0, bhpMPa: staticBhp, frictionMPa: 0 });
    }
  }
  // Промывка над мостом: циркуляция раствора выше конца труб; цемент ниже — в статике
  if (results.washTimeMin > 0 && input.pumpRateWashLs > 0) {
    const q = input.pumpRateWashLs, pm = P.mud, zEnd = results.pullOutDepthMD;
    let fp = 0, fa = 0, faBelowShoe = 0;
    cells.forEach((c) => {
      if (c.top >= zEnd) return;
      const len = Math.min(c.bot, zEnd) - c.top;
      fp += pipeFrictionMPa(q, len, c.pipeId, pm.pv, pm.yp, pm.density * 1000, pm.hb).pressureMPa;
      const fr = annularFrictionMPa(q, len, c.bore, c.pipeOd, pm.pv, pm.yp, pm.density * 1000, 100, pm.hb).pressureMPa;
      fa += fr;
      if (results.isOpenHole && c.top >= well.casingShoe - 1e-6) faBelowShoe += fr;
    });
    const n = Math.max(1, Math.ceil(results.washTimeMin / dt));
    for (let k = 0; k < n; k++) {
      timeMin += results.washTimeMin / n;
      const dv = results.washVolumeM3 / n; cum += dv; cumWash += dv;
      points.push({
        ...afterPlace, timeMin, stage: "Промывка", pumpRateLs: q, volumePumpedM3: cum, volWashM3: cumWash,
        bhpMPa: staticBhp + fa, shoePressMPa: staticShoe + (fa - faBelowShoe), surfaceMPa: fp + fa, frictionMPa: fp + fa,
      });
    }
  }
  return points;
}
