/**
 * РИР, этап 4: пошаговое моделирование закачки и ступенчатого задавливания.
 *
 * Система «НКТ → под ретейнером → канал негерметичности» заполнена жидкостью и несжимаема в
 * первом приближении: всё, что закачано, уходит в канал (сначала скважинная жидкость из-под
 * ретейнера, затем буфер и состав). Приёмистость канала:
 *   Q = J_eff·(P_заб − P_0),  J_eff = J_воды / (1 + (μ_сост/μ_воды − 1)·φ) · e^(−V_кан/V_ёмк) · k(t),
 * где φ = V_кан/V_ёмк — заполнение канала составом (сопротивление последовательных зон),
 * e^(…) — кольматация суспензией (у смолы нет), V_ёмк — ёмкость канала (оценка объёма
 * задавливания), k(t) — падение подвижности по мере загустевания (микроцемент: Вс, смола: гель). Насос работает с заданным расходом, но
 * не выше допустимого давления; на выдержках давление падает по упругоёмкости системы:
 *   dP/dt = −Q_утечки / C,  C = V_системы·(c_жидк + c_труб).
 * Критерий «задавлено»: на выдержке падение ≤ 10% при давлении ≥ 70% допустимого.
 */
import type { RirInputs, RirResult } from "./rir-calculations";
import type { CompositionDesign } from "./rir-compositions";
import { pipeFrictionMPa } from "./cementing-calculations";

export interface SqueezePoint {
  t: number;
  stage: string;
  qLs: number;
  surfaceMPa: number;
  bhpMPa: number;
  vPumped: number;
  vChannel: number;
  vCompChannel: number;
  /** Доля НКТ, занятая составом (сверху вниз): начало и конец «пачки» состава, 0…1 по длине */
  compTop: number;
  compBottom: number;
  /** Доля объёма под инструментом, занятая составом */
  belowComp: number;
  /** Заполнение канала составом относительно ёмкости, 0…1+ */
  channelFill: number;
  /** Подвижность канала относительно воды */
  mobility: number;
  /** Допустимое давление на устье в этот момент (по забою и устью), МПа */
  allowSurfaceMPa: number;
}

export interface SqueezeSimResult {
  points: SqueezePoint[];
  stages: { name: string; t0: number; t1: number; kind: "pump" | "hold" | "squeeze" }[];
  holds: { stage: number; pStart: number; pEnd: number; decayPct: number }[];
  outcome: "sealed" | "partial" | "no_squeeze";
  outcomeText: string;
  finalSurfaceMPa: number;
  compInChannelM3: number;
  totalTimeMin: number;
  workLifeUsedPct: number;
  warnings: string[];
}

export function simulateSqueeze(inp: RirInputs, res: RirResult, design: CompositionDesign | null): SqueezeSimResult {
  const warnings: string[] = [];
  const dt = 0.25; // мин
  const qSet = Math.max(0.2, inp.pumpRateLs) / 1000; // м³/с
  const J0 = res.fit ? res.fit.J / 3600 / 1e6 : (0.3 / 3600) / 1e6; // м³/(с·Па)
  const P0 = (res.fit ? res.fit.openingBhpMPa : 1.0 * 9.81 * res.leakTVD / 1000) * 1e6;
  // Ограничения: по забою (ГРП, колонна, пакер) и по устью (НКТ / колонна у устья)
  const bhpCap = Math.min(...res.constraints.filter((c) => c.atDepthMD > 0).map((c) => c.limitBhpMPa)) * 1e6;
  const surfCaps = res.constraints.filter((c) => c.atDepthMD === 0).map((c) => c.limitSurfaceMPa);
  const surfCap = (surfCaps.length ? Math.min(...surfCaps) : Infinity) * 1e6;
  const maxSurf = Math.max(0.5e6, Math.min(surfCap, res.maxSurfaceMPa * 1e6 * 10)); // для итоговых критериев
  const allowSurf = (hyd: number, fr: number) => Math.max(0, Math.min(surfCap, bhpCap - hyd + fr));
  const tubV = Math.max(0.01, res.volumes.tubingM3), belowV = Math.max(0.01, res.volumes.belowToolM3);
  const bufV = 0.5, compV = res.volumes.totalM3, dispV = res.volumes.displacementM3;
  const Vcap = Math.max(0.05, res.volumes.squeezeM3 * 1.2);
  const rhoW = inp.wellFluidDensity * 1000, rhoC = (design?.densityGcm3 ?? res.compositionDensity) * 1000, rhoD = 1000;
  const tvdLeak = res.leakTVD, tvdTool = res.toolTVD || 0;
  const C = (tubV + belowV) * (4.6e-10 + 1.5e-10); // м³/Па
  const tubingID = res.tubingID;
  // Вязкость состава при BHCT (мПа·с) и её рост
  const isResin = design?.kind === "resin";
  // эффективная вязкость в канале: смола — по рецептуре при BHCT, микроцемент — ПВ суспензии
  const pvMc = design && !isResin ? parseFloat((design.props.find((p) => p.label.startsWith("ПВ"))?.value ?? "15").split("/")[0]) : 15;
  const muComp0 = isResin ? (design!.thickeningCurve[0]?.y ?? 300) : Math.max(5, pvMc);
  const workLife = design?.workLifeAtBhctMin ?? 240;
  const mobilityAge = (ageMin: number) => {
    if (!design) return 1;
    const x = ageMin / Math.max(1, workLife);
    return isResin ? Math.exp(-4.6 * x ** 3) : Math.pow(Math.max(0.05, 1 - 0.85 * Math.min(1, x) ** 2), 2);
  };

  // Пачки: НКТ (сверху вниз) и объём под инструментом (сверху вниз)
  type Slug = { kind: "well" | "buf" | "comp" | "disp"; v: number };
  let tub: Slug[] = [{ kind: "well", v: tubV }];
  let below: Slug[] = [{ kind: "well", v: belowV }];
  let vPumped = 0, vChannel = 0, vCompCh = 0, compAge = -1, t = 0;
  const points: SqueezePoint[] = [];
  const stagesOut: SqueezeSimResult["stages"] = [];
  const holds: SqueezeSimResult["holds"] = [];
  const merge = (a: Slug[]) => a.reduce<Slug[]>((m, x) => { if (x.v <= 1e-12) return m; const l = m[m.length - 1]; if (l && l.kind === x.kind) l.v += x.v; else m.push({ ...x }); return m; }, []);
  const takeBottom = (a: Slug[], v: number): Slug[] => {
    const out: Slug[] = []; let left = v;
    while (left > 1e-12 && a.length) { const l = a[a.length - 1]; const d = Math.min(left, l.v); out.unshift({ kind: l.kind, v: d }); l.v -= d; left -= d; if (l.v <= 1e-12) a.pop(); }
    return out;
  };
  /** stungIn=false: выход из НКТ в затрубье (циркуляция); true: НКТ → под инструмент → канал */
  const pushIn = (kind: Slug["kind"], v: number, stungIn: boolean, viaBelow = false) => {
    tub.unshift({ kind, v });
    const out = takeBottom(tub, v);
    if (viaBelow) { below = [...out, ...below]; takeBottom(below, v); }
    else if (stungIn) {
      below = [...out, ...below];
      const ch = takeBottom(below, v);
      ch.forEach((x) => { vChannel += x.v; if (x.kind === "comp") vCompCh += x.v; });
    }
    tub = merge(tub); below = merge(below);
  };
  const atChannel = () => below[below.length - 1]?.kind ?? "well";
  const rhoOf = (k: Slug["kind"]) => (k === "comp" ? rhoC : k === "well" ? rhoW : rhoD);
  const colP = (a: Slug[], vTot: number, tv0: number, tv1: number) => {
    let z = 0, p = 0;
    for (const x of a) { const z1 = z + x.v; p += rhoOf(x.kind) * 9.81 * ((z1 - z) / vTot) * (tv1 - tv0); z = z1; }
    return p;
  };
  const hydroTub = () => colP(tub, tubV, 0, tvdTool);
  const hydro = () => hydroTub() + colP(below, belowV, tvdTool, tvdLeak);
  const Jeff = () => {
    if (atChannel() !== "comp") return J0;
    const age = compAge >= 0 ? t - compAge : 0;
    // Фронт состава в канале: сопротивление растёт по мере заполнения (последовательные зоны
    // «состав / вода»), у суспензии дополнительно — кольматация (фильтрационная корка).
    const fill = Math.min(1, vCompCh / Vcap);
    const visc = 1 / (1 + (Math.max(1, muComp0) - 1) * Math.max(0.02, fill));
    // кольматация: цемент обезвоживается быстрее (крупные частицы, высокая водоотдача)
    const plug = isResin ? 1 : Math.exp(-(design ? 3.5 : 5) * vCompCh / Vcap);
    return J0 * visc * plug * mobilityAge(age);
  };
  const compPos = () => {
    let z = 0, top = -1, bot = -1;
    for (const x of tub) { if (x.kind === "comp") { if (top < 0) top = z; bot = z + x.v; } z += x.v; }
    const bc = below.filter((x) => x.kind === "comp").reduce((tt, x) => tt + x.v, 0);
    return { top, bot, belowFrac: bc / belowV };
  };
  const record = (stage: string, q: number, Pbh: number, Psurf: number, allow?: number) => {
    const { top, bot, belowFrac } = compPos();
    points.push({
      t: Math.round(t * 100) / 100, stage, qLs: q * 1000, surfaceMPa: Math.max(0, Psurf / 1e6), bhpMPa: Pbh / 1e6,
      vPumped, vChannel, vCompChannel: vCompCh,
      compTop: top < 0 ? -1 : top / tubV, compBottom: bot < 0 ? -1 : bot / tubV,
      belowComp: belowFrac, channelFill: vCompCh / Vcap, mobility: Jeff() / J0,
      allowSurfaceMPa: (allow ?? allowSurf(hydro(), friction(q))) / 1e6,
    });
  };
  const friction = (q: number) => (q > 0 && tvdTool > 0 ? pipeFrictionMPa(q * 1000, inp.tool.setDepthMD, tubingID, isResin ? muComp0 : 20, isResin ? 0 : 5, rhoC).pressureMPa * 1e6 * 0.7 : 0);

  // ── Фаза А: закачка с циркуляцией (стингер над ретейнером) до подхода состава к инструменту ──
  record("Начало", 0, hydro(), 0);
  // Извлекаемый пакер: состав доводится до нарушения при открытом пакере (циркуляция через
  // низ НКТ в затрубье), затем пакер сажают. Ретейнер: жидкость из-под него уходит в канал.
  const spot = inp.tool.kind === "packer";
  const circ = (name: string, kind: Slug["kind"], vol: number) => {
    const t0 = t; let left = vol;
    while (left > 1e-9) {
      const q = Math.min(qSet, left / (dt * 60));
      const dv = q * dt * 60;
      pushIn(kind, dv, false, spot); left -= dv; vPumped += dv;
      if (kind === "comp" && compAge < 0) compAge = t;
      t += dt;
      const Ps = friction(q) + Math.max(0, spot ? rhoW * 9.81 * tvdLeak - hydro() : rhoW * 9.81 * tvdTool - hydroTub());
      record(name, q, hydro(), Ps);
    }
    stagesOut.push({ name, t0, t1: t, kind: "pump" });
  };
  const hasTool = inp.tool.kind !== "bradenhead";
  circ("Буфер", "buf", bufV);
  const pathV = spot ? tubV + belowV : tubV;
  const compInPhaseA = Math.min(compV, pathV);
  circ("Состав", "comp", compInPhaseA);
  if (compV <= pathV) circ(spot ? "Доводка состава до нарушения" : "Продавка до инструмента", "disp", Math.max(0, pathV - compV));
  if (spot) { stagesOut.push({ name: "Посадка пакера", t0: t, t1: t + 5, kind: "hold" }); t += 5; record("Посадка пакера", 0, hydro(), 0); }

  // ── Фаза Б: стыковка и задавливание (под инструментом жидкость → канал, затем состав) ──
  let Pbh = Math.max(hydro(), P0);
  const inject = (name: string, kind: Slug["kind"], vol: number, qMaxSet: number, frac: number, maxMin: number) => {
    const t0 = t; let left = vol; let stuck = 0;
    while (left > 1e-9) {
      const J = Jeff(), hyd = hydro();
      let q = Math.min(qMaxSet, left / (dt * 60));
      let PbhReq = P0 + q / J;
      let Ps = PbhReq - hyd + friction(q);
      const pLim = allowSurf(hyd, friction(q)) * frac;
      if (Ps > pLim) { const PbhMax = pLim + hyd - friction(q); q = Math.max(0, J * (PbhMax - P0)); PbhReq = P0 + q / J; Ps = pLim; }
      if (q < 0.0002 / 1000) { stuck += dt; t += dt; Pbh = PbhReq; record(`${name} — давление на пределе`, 0, PbhReq, Ps, pLim / frac); if (stuck > 10) break; continue; }
      const dv = q * dt * 60;
      pushIn(kind, dv, true); left -= dv; vPumped += dv;
      if (kind === "comp" && compAge < 0) compAge = t;
      Pbh = PbhReq; t += dt; record(name, q, Pbh, Ps, pLim / frac);
      if (t - t0 > maxMin) break;
    }
    stagesOut.push({ name, t0, t1: t, kind: "squeeze" });
    return left <= 1e-9;
  };
  if (compV > pathV) inject("Состав (после стыковки)", "comp", compV - pathV, qSet, 1, 120);
  // вытеснение жидкости из-под инструмента в канал (состав подходит к нарушению)
  const toFront = spot ? 0 : Math.max(0, belowV - Math.max(0, compV - tubV));
  if (toFront > 0) inject(hasTool ? "Вытеснение из-под ретейнера" : "Подход состава к нарушению", "disp", toFront, qSet, 1, 120);

  const nSt = Math.max(1, inp.hesitationStages);
  const perStage = res.volumes.squeezeM3 / nSt;
  let outcome: SqueezeSimResult["outcome"] = "partial";
  for (let i = 1; i <= nSt; i++) {
    inject(`Ступень ${i}`, "disp", perStage, qSet * 0.5, 0.95, 60);
    const h0 = t, pS0 = Math.max(0, Pbh - hydro());
    const holdEnd = t + inp.hesitationHoldMin;
    while (t < holdEnd - 1e-9) {
      const J = Jeff();
      const qLeak = Math.max(0, J * (Pbh - P0));
      Pbh = Math.max(P0, Pbh - (qLeak * dt * 60) / C);
      const dv = qLeak * dt * 60;
      vChannel += dv; if (atChannel() === "comp") vCompCh += dv;
      t += dt; record(`Выдержка ${i}`, 0, Pbh, Pbh - hydro());
    }
    const pS1 = Math.max(0, Pbh - hydro());
    const decay = pS0 > 0 ? ((pS0 - pS1) / pS0) * 100 : 100;
    holds.push({ stage: i, pStart: pS0 / 1e6, pEnd: pS1 / 1e6, decayPct: decay });
    stagesOut.push({ name: `Выдержка ${i}`, t0: h0, t1: t, kind: "hold" });
    const allowNow = allowSurf(hydro(), 0);
    if (decay <= 10 && pS0 >= 0.7 * allowNow && atChannel() === "comp" && vCompCh >= 0.3 * res.volumes.squeezeM3) { outcome = "sealed"; break; }
  }
  const lastHold = holds[holds.length - 1];
  const notAccepted = outcome !== "sealed" && atChannel() === "comp" && vCompCh < 0.3 * res.volumes.squeezeM3 && (lastHold?.decayPct ?? 100) <= 10;
  if (atChannel() !== "comp") outcome = "no_squeeze";
  const leftover = (compV - vCompCh - compPos().belowFrac * belowV);
  if (leftover > 0.01) warnings.push(`После задавливания в НКТ над инструментом остаётся ~${leftover.toFixed(2)} м³ состава — вымыть обратной промывкой сразу после расстыковки.`);
  const last = points[points.length - 1];
  const workLifeUsedPct = compAge >= 0 ? ((t - compAge) / Math.max(1, workLife)) * 100 : 0;
  if (workLifeUsedPct > 75) warnings.push(`Работа с составом заняла ${workLifeUsedPct.toFixed(0)}% его времени жизни — больше 75%: сократите ступени / выдержки или увеличьте время жизни состава.`);
  const outcomeText = outcome === "sealed"
    ? `Задавлено на ступени ${holds.length}: давление ${holds[holds.length - 1].pEnd.toFixed(1)} МПа на устье держится (падение ${holds[holds.length - 1].decayPct.toFixed(0)}% за ${inp.hesitationHoldMin} мин). В канал ушло ${(vCompCh * 1000).toFixed(0)} л состава${vCompCh < 0.3 * Vcap ? " — изоляция в основном за счёт кольматации входа в канал; для заполнения канала по объёму нужен состав меньшей вязкости" : ""}.`
    : outcome === "no_squeeze"
      ? `Состав не дошёл до нарушения: при допустимом давлении жидкость из-под ${hasTool ? "ретейнера" : "инструмента"} (${belowV.toFixed(2)} м³) не успевает уйти в канал. Установите инструмент ближе к нарушению, примените извлекаемый пакер с доводкой состава до нарушения при открытом пакере или увеличьте допустимое давление.`
      : notAccepted
        ? `Состав у нарушения, но канал его почти не принимает (ушло ${(vCompCh * 1000).toFixed(0)} л из ${(res.volumes.squeezeM3 * 1000).toFixed(0)} л): давление держится за счёт вязкости, а не изоляции. Нужен состав меньшей вязкости (разбавитель) или большее допустимое давление; иначе изоляция только входа в канал.`
        : `Полного задавливания по расчёту нет: после ${holds.length} ступеней давление на выдержке падает на ${holds[holds.length - 1]?.decayPct.toFixed(0) ?? "—"}%. Добавьте ступени / объём или увеличьте выдержку (состав набирает структуру).`;
  return {
    points, stages: stagesOut, holds, outcome, outcomeText,
    finalSurfaceMPa: last?.surfaceMPa ?? 0, compInChannelM3: vCompCh, totalTimeMin: t, workLifeUsedPct, warnings,
  };
}
