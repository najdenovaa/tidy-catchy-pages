/**
 * РИР: двумерная картина распределения изолирующего состава в канале за колонной.
 *
 * Канал (микрозазор «колонна — цементный камень», канал в камне, межколонный зазор)
 * разворачивается в лист «глубина × окружность колонны». Раскрытие по листу неоднородно
 * (логнормальный разброс вокруг оценки по приёмистости), вне канала — плотный камень.
 * Расход в канал по времени и момент подхода состава берутся из одномерного моделирования
 * задавливания (rir-squeeze-sim), так что объёмы согласованы. Двумерная модель показывает,
 * куда идёт состав: обход узких мест, «языки» по раскрытым зонам, стекание тяжёлого состава,
 * остановку при загустевании и закупорке (микроцемент).
 */
import { simulateDisplacement2D, type D2Fluid, type D2Input, type D2Result, type D2Stage } from "./displacement-2d";
import type { RirInputs, RirResult } from "./rir-calculations";
import type { CompositionDesign } from "./rir-compositions";
import type { SqueezeSimResult } from "./rir-squeeze-sim";

export interface RirChannelMeta {
  colors: string[];
  /** Время 1D-модели (мин), соответствующее t = 0 листа */
  tStartMin: number;
  leak: { mdTop: number; mdBot: number; thetaFrom: number; thetaTo: number };
  /** 1 — камень (вне канала), по ячейкам */
  solidMask: Uint8Array;
  channelLabel: string;
  outletsText: string;
  /** Итоги */
  stats: {
    /** Доля площади канала, заполненная составом (> 50 %), % */
    filledPct: number;
    /** Состава в канале, л (полная окружность) */
    compInSheetL: number;
    /** Ушло за пределы листа (в пласт / по каналу дальше), л */
    compOutL: number;
    /** Площадь канала, м² */
    channelAreaM2: number;
    /** Незаполненные участки канала у нарушения (±5 м), % */
    nearLeakUnfilledPct: number;
  };
  notes: string[];
}

/** Детерминированный «шум» для неоднородности раскрытия: сумма гармоник со случайными фазами. */
function makeField(seed: number) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const waves = Array.from({ length: 10 }, () => ({ kz: 0.05 + rnd() * 0.5, kt: Math.floor(rnd() * 4), ph: rnd() * 2 * Math.PI, ph2: rnd() * 2 * Math.PI, a: 0.5 + rnd() }));
  const norm = Math.sqrt(waves.reduce((t, w) => t + (w.a * w.a) / 2, 0));
  return (z: number, th: number) => waves.reduce((t, w) => t + w.a * Math.sin(w.kz * z + w.ph) * Math.cos(w.kt * th + w.ph2), 0) / norm;
}

const interpCurve = (pts: { x: number; y: number }[], x: number) => {
  if (!pts.length) return 1;
  if (x <= pts[0].x) return pts[0].y;
  for (let i = 1; i < pts.length; i++) if (x <= pts[i].x) { const a = pts[i - 1], b = pts[i]; return a.y + ((b.y - a.y) * (x - a.x)) / Math.max(1e-9, b.x - a.x); }
  return pts[pts.length - 1].y;
};

export function buildRirChannelInput(inp: RirInputs, res: RirResult, sim: SqueezeSimResult, design: CompositionDesign | null):
  { input: Omit<D2Input, "onProgress">; meta: Omit<RirChannelMeta, "stats" | "solidMask"> & { mask: (md: number, th: number) => boolean } } {
  const notes: string[] = [];
  const rc = inp.casing.odMm / 2000;
  const arc = 2 * Math.PI * rc;
  const kind = inp.leak.kind;
  const top = inp.leak.topMD, bot = Math.max(inp.leak.bottomMD, top + 0.5);
  const ap = Math.max(20, res.apertureUm ?? 100) * 1e-6;
  const field = makeField(Math.round(top * 7 + bot * 3 + inp.casing.odMm));
  const sigma = 0.55;
  // Геометрия канала и выходов по типу нарушения
  let zTop = top - 25, zBot = bot + 25;
  let outlets = { top: true, bottom: true };
  let leak = { mdTop: top, mdBot: bot, thetaFrom: 0.35 * Math.PI, thetaTo: 0.65 * Math.PI }; // сбоку — к наблюдателю в 3D
  let inChannel = (_md: number, _th: number) => true;
  let channelLabel = "Микрозазор «колонна — цементный камень» вокруг нарушения";
  let outletsText = "Канал сообщается с пластом выше и ниже нарушения (открытые верх и низ листа).";
  if (kind === "coupling") {
    leak = { mdTop: top, mdBot: Math.min(bot, top + 0.5), thetaFrom: 0, thetaTo: 2 * Math.PI };
    channelLabel = "Микрозазор за муфтой: утечка по всей окружности муфты";
  } else if (kind === "perforation") {
    leak = { mdTop: top, mdBot: bot, thetaFrom: 0, thetaTo: 2 * Math.PI };
    channelLabel = "Интервал перфорации: каналы перфорации по окружности, микрозазор и пласт";
  } else if (kind === "behind_casing") {
    zTop = top - 60; zBot = bot + 10;
    outlets = { top: true, bottom: false };
    // канал в камне — по нижней стороне ствола (там тоньше камень при прижатой колонне)
    inChannel = (_md, th) => Math.abs(th - 0.5 * Math.PI) < 0.3 * Math.PI;
    leak = { mdTop: top, mdBot: bot, thetaFrom: 0.38 * Math.PI, thetaTo: 0.62 * Math.PI };
    channelLabel = "Канал в цементном камне (сектор ~110° по окружности), ведёт вверх к зоне перетока";
    outletsText = "Канал выходит вверх к зоне перетока (открыт верх листа); вне канала — плотный камень.";
  } else if (kind === "intercasing") {
    zTop = top - 80; zBot = bot + 10;
    outlets = { top: true, bottom: false };
    channelLabel = "Межколонный зазор: газ / жидкость поднимается к устью";
    outletsText = "Зазор сообщается вверх с межколонным пространством (открыт верх листа).";
  }
  zTop = Math.max(1, zTop);
  const mask = (md: number, th: number) => inChannel(md, th);
  const gap = (md: number, th: number) => {
    const f = Math.exp(sigma * field(md, th) - (sigma * sigma) / 2);
    return inChannel(md, th) ? ap * f : ap * 0.01; // вне канала — почти непроницаемый камень
  };

  // Порции в канал — из одномерного моделирования
  const pts = sim.points;
  const stages: D2Stage[] = [];
  let tStartMin = -1;
  const FW = 0, FIN = 1, FC = 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dV = Math.max(0, b.vChannel - a.vChannel), dVc = Math.max(0, b.vCompChannel - a.vCompChannel);
    const dtS = (b.t - a.t) * 60;
    if (dtS <= 0) continue;
    if (tStartMin < 0) { if (dV <= 1e-9) continue; tStartMin = a.t; }
    const fluid = dVc > 0.5 * dV && dV > 0 ? FC : b.vCompChannel > 1e-6 ? FC : FIN;
    const rate = dV / dtS;
    const last = stages[stages.length - 1];
    if (rate <= 1e-9) {
      if (last && last.rateM3s === 0) last.holdS = (last.holdS ?? 0) + dtS;
      else stages.push({ fluid, volumeM3: 0, rateM3s: 0, holdS: dtS });
      continue;
    }
    if (last && last.rateM3s > 0 && last.fluid === fluid && Math.abs(last.rateM3s - rate) / Math.max(rate, last.rateM3s) < 0.25) {
      const v = last.volumeM3 + dV, tt = last.volumeM3 / last.rateM3s + dtS;
      last.volumeM3 = v; last.rateM3s = v / tt;
    } else stages.push({ fluid, volumeM3: dV, rateM3s: rate });
  }
  if (tStartMin < 0) tStartMin = 0;
  const intoChannel = stages.reduce((t, s) => t + s.volumeM3, 0);
  const compInto = stages.filter((s) => s.fluid === FC).reduce((t, s) => t + s.volumeM3, 0);
  // Ёмкость: канал вмещает ~1,4 объёма, ушедшего в него (остальное — уход в пласт через выходы)
  const nZtmp = 80, nTtmp = 36, dzt = (zBot - zTop) / nZtmp;
  let sumWA = 0;
  for (let j = 0; j < nZtmp; j++) for (let i = 0; i < nTtmp; i++) {
    const md = zTop + (j + 0.5) * dzt, th = ((i + 0.5) * 2 * Math.PI) / nTtmp;
    if (inChannel(md, th)) sumWA += gap(md, th) * (arc / nTtmp) * dzt;
  }
  // Ёмкость канала у нарушения: ~2,5 объёма состава (жидкость впереди состава уходит дальше — в пласт / по каналу)
  const capM3 = Math.max(compInto * 2.5, 0.01);
  const storeK = sumWA > 0 ? Math.max(1, capM3 / sumWA) : 1;
  const storage = (md: number, th: number) => gap(md, th) * (inChannel(md, th) ? storeK : 1);
  // Жидкость впереди состава лишь промывает канал: её объём ограничиваем 3 ёмкостями (длительность сохраняем)
  const waterV = stages.filter((s) => s.fluid !== FC).reduce((t, s) => t + s.volumeM3, 0);
  if (waterV > 3 * capM3) {
    const kf = (3 * capM3) / waterV;
    for (const st of stages) if (st.fluid !== FC && st.rateM3s > 0) { st.volumeM3 *= kf; st.rateM3s *= kf; }
  }
  notes.push(`В канал ушло ${(intoChannel * 1000).toFixed(0)} л, из них состава ${(compInto * 1000).toFixed(0)} л. Ёмкость канала в расчётной зоне принята ${(capM3 * 1000).toFixed(0)} л (≈2,5 объёма состава): микрозазор ~${(ap * 1e6).toFixed(0)} мкм по приёмистости плюс пустоты в камне; жидкость впереди состава уходит за пределы зоны.`);

  // Жидкости
  const wellRho = inp.wellFluidDensity * 1000;
  const isResin = design?.kind === "resin";
  const pvMc = design && !isResin ? parseFloat((design.props.find((p) => p.label.startsWith("ПВ"))?.value ?? "15").split("/")[0]) : 15;
  const ypMc = design && !isResin ? parseFloat(((design.props.find((p) => p.label.startsWith("ПВ"))?.value ?? "15 / 5").split("/")[1] ?? "5").replace(",", ".")) : 5;
  const muC = isResin ? (design!.thickeningCurve[0]?.y ?? 150) : res.composition === "cement" ? 40 : Math.max(5, pvMc);
  const tyC = isResin ? 0 : res.composition === "cement" ? 10 : Math.max(0.5, ypMc);
  const rhoC = (design?.densityGcm3 ?? res.compositionDensity) * 1000;
  const fluids: D2Fluid[] = [
    { name: "Жидкость в канале (пластовая вода)", density: 1050, pv: 0.001, yp: 0, kind: "mud" },
    { name: "Жидкость из скважины (до состава)", density: wellRho, pv: 0.0015, yp: 0, kind: "spacer" },
    { name: design?.title ?? "Изолирующий состав", density: rhoC, pv: muC / 1000, yp: tyC, kind: "cement" },
  ];
  const colors = ["#3b82f6", "#93c5fd", isResin ? "#f59e0b" : res.composition === "cement" ? "#9ca3af" : "#d0a457"];
  // Рост вязкости / структуры состава от затворения (время 1D-модели)
  const compStartMin = (() => { const p = pts.find((x) => x.stage.startsWith("Состав")); return p ? p.t : tStartMin; })();
  const curve = design?.thickeningCurve ?? [];
  const y0 = curve.length ? Math.max(1e-6, curve[0].y) : 1;
  const fluidTime = (f: number, tIn: number) => {
    if (f !== FC || !curve.length) return { mu: 1, ty: 1 };
    const tMin = tStartMin + tIn / 60 - compStartMin + 0; // возраст состава, мин
    const y = interpCurve(curve, Math.max(0, tMin));
    const ratio = Math.min(isResin ? 1e4 : 50, Math.max(1, y / y0));
    return isResin ? { mu: ratio, ty: 1 } : { mu: Math.sqrt(ratio), ty: ratio };
  };
  const g = (md: number) => ({ rHole: rc + 0.01, rCasing: rc, standoff: 1, inclDeg: 0 * md });
  const input: Omit<D2Input, "onProgress"> = {
    zTop, zBot, geom: g, fluids, stages, nTheta: 18, nZ: 80,
    customGap: gap, storageGap: storage, arcLength: arc, fullCircle: true,
    source: leak, outlets, fluidTime,
    plugging: !isResin && res.composition !== "resin" ? { fluid: FC, k: res.composition === "cement" ? 0.08 : 0.04 } : undefined,
    maxSnapshots: 120,
  };
  if (compInto <= 1e-6) notes.push("По моделированию задавливания состав в канал не попал — показано движение жидкости из-под инструмента.");
  return { input, meta: { colors, tStartMin, leak, channelLabel, outletsText, notes, mask } };
}

export function simulateRirChannel(inp: RirInputs, res: RirResult, sim: SqueezeSimResult, design: CompositionDesign | null, onProgress?: (f: number) => void): { result: D2Result; meta: RirChannelMeta } {
  const { input, meta } = buildRirChannelInput(inp, res, sim, design);
  const result = simulateDisplacement2D({ ...input, onProgress });
  const { nTheta: nT, nZ } = result;
  const N = nT * nZ;
  const solidMask = new Uint8Array(N);
  const dz = (input.zBot - input.zTop) / nZ;
  const ds = (input.arcLength ?? 1) / nT;
  let area = 0, filled = 0, nearA = 0, nearUn = 0, compVol = 0;
  const comp = result.finalFrac[2];
  for (let j = 0; j < nZ; j++) for (let i = 0; i < nT; i++) {
    const k = j * nT + i, md = result.zCenters[j], th = result.thetaCenters[i];
    const inCh = meta.mask(md, th);
    solidMask[k] = inCh ? 0 : 1;
    const vol = (input.storageGap ? input.storageGap(md, th) : result.gap[k]) * ds * dz;
    compVol += comp[k] * vol;
    if (!inCh) continue;
    area += ds * dz;
    if (comp[k] > 0.5) filled += ds * dz;
    if (md >= meta.leak.mdTop - 5 && md <= meta.leak.mdBot + 5) { nearA += ds * dz; if (comp[k] <= 0.5) nearUn += ds * dz; }
  }
  const compIn = input.stages.filter((s) => s.fluid === 2).reduce((t, s) => t + s.volumeM3, 0);
  const { mask: _m, ...rest } = meta;
  void _m;
  return {
    result,
    meta: {
      ...rest, solidMask,
      stats: {
        filledPct: area > 0 ? (filled / area) * 100 : 0,
        compInSheetL: compVol * 1000,
        compOutL: Math.max(0, compIn - compVol) * 1000,
        channelAreaM2: area,
        nearLeakUnfilledPct: nearA > 0 ? (nearUn / nearA) * 100 : 0,
      },
    },
  };
}
