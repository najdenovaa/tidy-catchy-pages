/**
 * Устойчивость цементного моста против гравитационного обмена жидкостями
 * (тяжёлый цемент над более лёгкой жидкостью).
 *
 * Главный механизм отказа балансовых мостов — не «поршневое» проседание, а встречное течение:
 * цемент стекает вниз языком (пальцем), лёгкая жидкость поднимается сквозь мост. Закрытый низ
 * скважины этому НЕ мешает — объём сохраняется, жидкости просто меняются местами.
 *
 * Критерий — число текучести Y = τ_y / (Δρ·g·R), R — радиус ствола (после подъёма труб):
 *   • Y_c = 0,61 — теоретический предел (Frigaard & Scherzer 2000, граница «бок о бок», вертикаль):
 *     выше него никакое течение невозможно;
 *   • Y_c,exp ≈ 0,2 (вертикаль) … 0,3 (наклон 45°) — экспериментальный предел отсутствия течения
 *     (Crawshaw & Frigaard 1999; Charabin & Frigaard, JFM 2024, «Exchange flows and plug cementing»).
 * τ_y — статическая прочность структуры (СНС) более прочной из двух жидкостей на границе: течение
 * «бок о бок» требует сдвига обеих, и одной достаточно прочной жидкости хватает, чтобы его остановить.
 *
 * Скорость обмена — оценка порядка величины: фронт лёгкой жидкости ≈ 4% от инерционного масштаба
 * (и снижается до нуля по мере набора структуры: v·(1 − Y(t)/Y_c), инженерное допущение)
 * V_t = √(2·At·g·R) (Charabin & Frigaard 2024, вязкий режим), цемент — примерно вдвое медленнее.
 * Обмен прекращается, когда структура цемента наберёт Y_c,exp.
 */

export type PlugSupport = "fluid" | "bottom" | "mechanical";

export const PLUG_SUPPORT_LABEL: Record<PlugSupport, string> = {
  fluid: "жидкость (буровой раствор / вязкая пачка)",
  bottom: "забой или ранее установленный мост",
  mechanical: "механическая опора (пакер-пробка, цементировочная корзина)",
};

export interface ExchangeFluid {
  name: string;
  /** г/см³ */
  density: number;
  /** СНС 10 с / 10 мин, Па (0 — не задан) */
  gel10s?: number;
  gel10min?: number;
  /** ДНС, Па — для оценки СНС, если он не задан */
  yp: number;
  /** Цемент продолжает набирать структуру после 10 мин; буровые/буферные жидкости — выходят на плато */
  isCement?: boolean;
}

export interface ExchangeInput {
  support: PlugSupport;
  boreDiameterMm: number;
  zenithDeg: number;
  plugLengthM: number;
  cement: ExchangeFluid;
  /** Жидкость сразу под цементом (вязкая пачка или скважинная жидкость) */
  below: ExchangeFluid;
  /** Жидкость под вязкой пачкой (если пачка есть) */
  belowPad?: ExchangeFluid;
  padLengthM?: number;
}

export type ExchangeVerdict = "no-buoyancy" | "guaranteed" | "stable" | "risk" | "unstable" | "supported";

export interface ExchangeInterface {
  upper: string;
  lower: string;
  deltaRhoKgM3: number;
  /** Число текучести в момент остановки */
  Y0: number;
  YcExp: number;
  YcTheory: number;
  /** СНС, при котором течение не возникает: экспериментальный / теоретический предел, Па */
  tauRequiredExpPa: number;
  tauRequiredTheoryPa: number;
  /** Время, за которое структура цемента остановит обмен, мин (Infinity — не остановит до схватывания) */
  arrestMin: number;
  /** Оценочная длина обмена (насколько цемент «провалится»), м */
  exchangeLengthM: number;
  verdict: ExchangeVerdict;
  gelEstimated: boolean;
}

export interface ExchangeResult {
  support: PlugSupport;
  radiusM: number;
  interfaces: ExchangeInterface[];
  verdict: ExchangeVerdict;
  headline: string;
  details: string[];
  recommendations: string[];
}

const G = 9.81;
export const Y_C_THEORY = 0.61;
/** Предел СНС, который реально обеспечить прокачиваемой вязкой пачкой, Па (практика; реактивные/сшитые пачки — выше) */
export const PUMPABLE_PILL_GEL_PA = 60;

/** Экспериментальный предел Y_c по углу: 0,2 (вертикаль) → 0,3 (45°); выше 45° — экстраполяция до 0,35. */
export function yieldNumberCriticalExp(zenithDeg: number): number {
  const z = Math.max(0, Math.min(90, zenithDeg));
  if (z <= 10) return 0.2;
  if (z <= 45) return 0.2 + (0.1 * (z - 10)) / 35;
  return 0.3 + (0.05 * (z - 45)) / 45;
}

function gelOf(f: ExchangeFluid): { g0: number; g10: number; estimated: boolean } {
  const est = !(f.gel10min && f.gel10min > 0);
  const g0 = f.gel10s && f.gel10s > 0 ? f.gel10s : Math.max(0, f.yp);
  const g10 = !est ? f.gel10min! : Math.max(g0, f.yp * (f.isCement ? 3 : 2));
  return { g0, g10: Math.max(g0, g10), estimated: est };
}

/** Статическая прочность структуры через t мин покоя, Па. */
export function gelAt(f: ExchangeFluid, tMin: number): number {
  const { g0, g10 } = gelOf(f);
  const rate = (g10 - g0) / (10 - 1 / 6); // Па/мин между 10 с и 10 мин
  if (tMin <= 10) return g0 + rate * Math.max(0, tMin - 1 / 6);
  return f.isCement ? g10 + rate * (tMin - 10) : g10;
}

function analyseInterface(upper: ExchangeFluid, lower: ExchangeFluid, R: number, zenithDeg: number, plugLengthM: number): ExchangeInterface {
  const dRho = (upper.density - lower.density) * 1000;
  const YcExp = yieldNumberCriticalExp(zenithDeg);
  const base = { upper: upper.name, lower: lower.name, deltaRhoKgM3: dRho, YcExp, YcTheory: Y_C_THEORY };
  const gelEstimated = gelOf(upper).estimated || gelOf(lower).estimated;
  if (dRho <= 5) {
    return { ...base, Y0: Infinity, tauRequiredExpPa: 0, tauRequiredTheoryPa: 0, arrestMin: 0, exchangeLengthM: 0, verdict: "no-buoyancy", gelEstimated };
  }
  const buoy = dRho * G * R; // Па
  const tau = (t: number) => Math.max(gelAt(upper, t), gelAt(lower, t));
  const Y0 = tau(0) / buoy;
  const tauReqExp = YcExp * buoy, tauReqTh = Y_C_THEORY * buoy;
  let arrestMin = 0;
  if (Y0 < YcExp) {
    arrestMin = Infinity;
    for (let t = 0.5; t <= 600; t += 0.5) if (tau(t) >= tauReqExp) { arrestMin = t; break; }
  }
  const At = dRho / ((upper.density + lower.density) * 1000);
  const vLight = 0.04 * Math.sqrt(2 * At * G * R); // м/с, вязкий режим (Charabin & Frigaard 2024)
  const vHeavy = 0.5 * vLight;
  // Скорость падает до нуля по мере приближения Y к пределу (структура тормозит обмен):
  // v(t) = v_H·(1 − Y(t)/Y_c), интегрируем до остановки
  let exchangeLengthM = 0;
  if (Y0 < YcExp) {
    const tEnd = Number.isFinite(arrestMin) ? arrestMin : 600;
    for (let t = 0; t < tEnd; t += 0.5) exchangeLengthM += vHeavy * Math.max(0, 1 - tau(t + 0.25) / buoy / YcExp) * 30;
    exchangeLengthM = Math.min(plugLengthM * 3, exchangeLengthM);
  }
  let verdict: ExchangeVerdict;
  if (Y0 >= Y_C_THEORY) verdict = "guaranteed";
  else if (Y0 >= YcExp) verdict = "stable";
  else if (exchangeLengthM < 0.1 * plugLengthM) verdict = "risk";
  else verdict = "unstable";
  return { ...base, Y0, tauRequiredExpPa: tauReqExp, tauRequiredTheoryPa: tauReqTh, arrestMin, exchangeLengthM, verdict, gelEstimated };
}

const RANK: Record<ExchangeVerdict, number> = { supported: 0, "no-buoyancy": 0, guaranteed: 1, stable: 2, risk: 3, unstable: 4 };

export function assessPlugExchange(inp: ExchangeInput): ExchangeResult {
  const R = inp.boreDiameterMm / 2000;
  const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "∞");
  if (inp.support !== "fluid") {
    return {
      support: inp.support, radiusM: R, interfaces: [], verdict: "supported",
      headline: inp.support === "bottom" ? "Мост опирается на забой / ранее установленный мост — более лёгкой жидкости под цементом нет, обмена не будет." : "Мост на механической опоре — обмен с жидкостью ниже опоры исключён.",
      details: ["Остаётся риск смешения на верхней границе с буфером — см. раздел о границах жидкостей."],
      recommendations: inp.support === "bottom" ? ["Убедитесь, что опорный мост / забой проверены разгрузкой; осадок на забое снижает качество подошвы моста."] : [],
    };
  }
  const ifs: ExchangeInterface[] = [analyseInterface({ ...inp.cement, isCement: true }, inp.below, R, inp.zenithDeg, inp.plugLengthM)];
  if (inp.belowPad) ifs.push(analyseInterface(inp.below, inp.belowPad, R, inp.zenithDeg, inp.padLengthM ?? inp.plugLengthM));
  const worst = ifs.reduce((w, x) => (RANK[x.verdict] > RANK[w.verdict] ? x : w), ifs[0]);
  const main = ifs[0];
  const details: string[] = [];
  const rec: string[] = [];
  ifs.forEach((x) => {
    if (x.verdict === "no-buoyancy") { details.push(`«${x.upper}» над «${x.lower}»: верхняя жидкость не тяжелее нижней — гравитационного обмена нет.`); return; }
    details.push(
      `«${x.upper}» над «${x.lower}»: Δρ = ${fmt(x.deltaRhoKgM3)} кг/м³, Y = ${x.Y0.toFixed(3)} при пределе ${x.YcExp.toFixed(2)} (эксперимент) / ${x.YcTheory.toFixed(2)} (теория). ` +
      `Нужен СНС ≥ ${fmt(x.tauRequiredExpPa)} Па (гарантированно ≥ ${fmt(x.tauRequiredTheoryPa)} Па).` +
      (x.Y0 < x.YcExp ? ` Обмен остановится ${Number.isFinite(x.arrestMin) ? `через ≈${fmt(x.arrestMin)} мин` : "только при схватывании"}; оценочно цемент «провалится» на ~${fmt(x.exchangeLengthM)} м.` : "") +
      (x.gelEstimated ? " (СНС не задан — оценка по ДНС.)" : ""),
    );
  });

  const headlines: Record<ExchangeVerdict, string> = {
    supported: "",
    "no-buoyancy": "Под цементом жидкость не легче цемента — гравитационного обмена нет, мост устойчив.",
    guaranteed: "Мост устойчив: прочность структуры выше теоретического предела — обмен жидкостями невозможен.",
    stable: "Мост устойчив по экспериментальному критерию, но ниже теоретического предела — запас небольшой.",
    risk: "Риск обмена: цемент начнёт стекать вниз, но структура остановит его быстро — ожидается загрязнение подошвы на несколько метров.",
    unstable: "Мост НЕУСТОЙЧИВ: тяжёлый цемент поменяется местами с более лёгкой жидкостью ниже — мост «уйдёт» вниз или окажется размытым.",
  };

  if (RANK[worst.verdict] >= 3) {
    const need = main.tauRequiredExpPa;
    const what = inp.belowPad ? "Поднять СНС 10 мин вязкой пачки" : "Установить под мостом вязкую пачку с СНС 10 мин";
    if (need <= PUMPABLE_PILL_GEL_PA) rec.push(`${what} ≥ ${fmt(need)} Па (для гарантии ≥ ${fmt(main.tauRequiredTheoryPa)} Па), длина пачки 30–50 м.`);
    else rec.push(`Нужный СНС пачки ≥ ${fmt(need)} Па — обычной вязкой пачкой не обеспечить (практический предел ~${PUMPABLE_PILL_GEL_PA} Па). Нужна реактивная/сшитая пачка, пачка плотнее цемента или механическая опора.`);
    rec.push(`Пачка плотнее цемента (≥ ${(inp.cement.density + 0.02).toFixed(2)} г/см³) снимает обмен на подошве моста, но сама должна опираться на забой или быть устойчивой над раствором ниже — проверьте вторую границу.`);
    rec.push("Механическая опора: пакер-пробка, цементировочная корзина, ранее установленный мост — самый надёжный вариант для ответственных мостов (зарезка, ликвидация).");
    if (inp.cement.density - inp.below.density > 0.3) rec.push(`Снизить разницу плотностей: сейчас ${(inp.cement.density - inp.below.density).toFixed(2)} г/см³ — облегчённый цемент или более тяжёлая жидкость под мостом уменьшают движущую силу.`);
    rec.push("Тиксотропный цемент (быстрый набор СНС) сокращает время обмена и глубину «провала».");
  } else if (worst.verdict === "stable") {
    rec.push(`Для гарантии поднимите СНС пачки/цемента до ≥ ${fmt(main.tauRequiredTheoryPa)} Па или используйте пачку плотнее цемента.`);
  }
  if (inp.zenithDeg > 30 && RANK[worst.verdict] >= 2) rec.push(`Наклон ${inp.zenithDeg.toFixed(0)}°: цемент стекает по нижней стенке (оползень) — в наклонных стволах предпочтительна механическая опора.`);

  return { support: inp.support, radiusM: R, interfaces: ifs, verdict: worst.verdict, headline: headlines[worst.verdict], details, recommendations: rec };
}
