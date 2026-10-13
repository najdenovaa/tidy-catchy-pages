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
  /** Множитель скорости обмена (калибровка по отбивкам); по умолчанию DEFAULT_FIELD_VELOCITY_FACTOR */
  velocityFactor?: number;
  /**
   * Кинетика загустевания цемента в интервале моста: возраст раствора к моменту остановки
   * (от начала закачки до выхода труб), время до 30 / 50 Вс при статической температуре моста.
   * Чем глубже и горячее интервал и дольше операция — тем быстрее цемент набирает структуру.
   */
  cementKinetics?: { ageAtStopMin: number; t30Min: number; t50Min: number };
}

export type ExchangeVerdict = "no-buoyancy" | "guaranteed" | "stable" | "settle" | "risk" | "unstable" | "supported";

/**
 * Промысловый множитель скорости обмена относительно лабораторной (Charabin & Frigaard 2024:
 * труба Ø19 мм, лёгкая жидкость — вода). В скважине обмену мешают структура бурового раствора,
 * загущение смеси цемент/раствор на границе, неровность стенок — реальная осадка мостов
 * существенно меньше лабораторной оценки. По умолчанию 0,1 (по опыту установки мостов на растворе
 * с вязкой пачкой); уточняется по отбивкам кровли (калибровка план/факт).
 */
export const DEFAULT_FIELD_VELOCITY_FACTOR = 0.1;

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
  /** Ожидаемое опускание кровли моста, м (= topDropM; для совместимости) */
  exchangeLengthM: number;
  /** Опускание кровли: начинается, только когда лёгкая жидкость пройдёт всю длину моста */
  topDropM: number;
  /** Проникновение «языков» цемента ниже подошвы (размыв подошвы), м */
  bottomSmearM: number;
  /** Насколько поднимется лёгкая жидкость внутри моста, м */
  lightPenetrationM: number;
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
  /** Использованный промысловый множитель скорости обмена */
  velocityFactor: number;
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

function analyseInterface(upper: ExchangeFluid, lower: ExchangeFluid, R: number, zenithDeg: number, columnLengthM: number, kField: number, kin?: ExchangeInput["cementKinetics"]): ExchangeInterface {
  const dRho = (upper.density - lower.density) * 1000;
  const YcExp = yieldNumberCriticalExp(zenithDeg);
  const base = { upper: upper.name, lower: lower.name, deltaRhoKgM3: dRho, YcExp, YcTheory: Y_C_THEORY };
  const gelEstimated = gelOf(upper).estimated || gelOf(lower).estimated;
  const none = { topDropM: 0, bottomSmearM: 0, lightPenetrationM: 0, exchangeLengthM: 0 };
  if (dRho <= 5) {
    return { ...base, ...none, Y0: Infinity, tauRequiredExpPa: 0, tauRequiredTheoryPa: 0, arrestMin: 0, verdict: "no-buoyancy", gelEstimated };
  }
  const buoy = dRho * G * R; // Па
  // Структура цемента: СНС 10 с → 10 мин, далее рост по мере загустевания (Вс) при температуре моста
  const cementGel = (f: ExchangeFluid, t: number) => {
    if (!kin || !(kin.t30Min > 0)) return gelAt(f, t);
    const { g10 } = gelOf(f);
    const early = gelAt({ ...f, isCement: false }, t);
    const bc = consistencyAt(kin.ageAtStopMin + t, kin.t30Min, Math.max(kin.t50Min, kin.t30Min * 1.05));
    return Math.max(early, g10 * Math.pow(Math.max(bc, 5) / 30, 2.5));
  };
  const gelOfFluid = (f: ExchangeFluid, t: number) => (f.isCement ? cementGel(f, t) : gelAt(f, t));
  const tau = (t: number) => Math.max(gelOfFluid(upper, t), gelOfFluid(lower, t));
  const Y0 = tau(0) / buoy;
  const tauReqExp = YcExp * buoy, tauReqTh = Y_C_THEORY * buoy;
  let arrestMin = 0;
  if (Y0 < YcExp) {
    arrestMin = Infinity;
    for (let t = 0.5; t <= 720; t += 0.5) if (tau(t) >= tauReqExp) { arrestMin = t; break; }
  }
  const At = dRho / ((upper.density + lower.density) * 1000);
  const vLight = 0.04 * Math.sqrt(2 * At * G * R) * kField; // м/с: фронт лёгкой жидкости (Charabin & Frigaard 2024) × промысловый множитель
  const vHeavy = 0.5 * vLight;
  // Интегрируем до остановки: v(t) = v·(1 − Y(t)/Y_c).
  // Лёгкая жидкость поднимается внутри моста; кровля начинает опускаться, только когда
  // она пройдёт всю длину столба; до этого обмен лишь размывает подошву.
  let light = 0, heavy = 0, top = 0;
  if (Y0 < YcExp) {
    const tEnd = Number.isFinite(arrestMin) ? arrestMin : 720;
    for (let t = 0; t < tEnd; t += 0.5) {
      const f = Math.max(0, 1 - tau(t + 0.25) / buoy / YcExp) * 30;
      light += vLight * f;
      heavy += vHeavy * f;
      if (light > columnLengthM) top += vHeavy * f;
    }
  }
  const topDropM = Math.min(columnLengthM * 3, top);
  const bottomSmearM = Math.min(columnLengthM * 3, heavy);
  let verdict: ExchangeVerdict;
  if (Y0 >= Y_C_THEORY) verdict = "guaranteed";
  else if (Y0 >= YcExp) verdict = "stable";
  else if (topDropM < 0.1 * columnLengthM && bottomSmearM < 0.3 * columnLengthM) verdict = "settle";
  else if (topDropM < 0.3 * columnLengthM) verdict = "risk";
  else verdict = "unstable";
  return { ...base, Y0, tauRequiredExpPa: tauReqExp, tauRequiredTheoryPa: tauReqTh, arrestMin, exchangeLengthM: topDropM, topDropM, bottomSmearM, lightPenetrationM: Math.min(light, columnLengthM), verdict, gelEstimated };
}

/** Консистенция цемента (Вс) от времени: 5 → 30 Вс к t30, 50 Вс к t50, далее к 100. */
function consistencyAt(t: number, t30: number, t50: number): number {
  if (t <= 0) return 5;
  if (t <= t30) return 5 + 25 * (t / t30);
  if (t <= t50) return 30 + 20 * ((t - t30) / (t50 - t30));
  return Math.min(100, 50 + 50 * (1 - Math.exp(-3 * (t - t50) / ((t50 - t30) * 1.5))));
}

const RANK: Record<ExchangeVerdict, number> = { supported: 0, "no-buoyancy": 0, guaranteed: 1, stable: 2, settle: 2.5, risk: 3, unstable: 4 };

export function assessPlugExchange(inp: ExchangeInput): ExchangeResult {
  const R = inp.boreDiameterMm / 2000;
  const fmt = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "∞");
  if (inp.support !== "fluid") {
    return {
      support: inp.support, radiusM: R, interfaces: [], verdict: "supported",
      headline: inp.support === "bottom" ? "Мост опирается на забой / ранее установленный мост — более лёгкой жидкости под цементом нет, обмена не будет." : "Мост на механической опоре — обмен с жидкостью ниже опоры исключён.",
      details: ["Остаётся риск смешения на верхней границе с буфером — см. раздел о границах жидкостей."],
      recommendations: inp.support === "bottom" ? ["Убедитесь, что опорный мост / забой проверены разгрузкой; осадок на забое снижает качество подошвы моста."] : [],
      velocityFactor: inp.velocityFactor ?? DEFAULT_FIELD_VELOCITY_FACTOR,
    };
  }
  const kf = inp.velocityFactor && inp.velocityFactor > 0 ? inp.velocityFactor : DEFAULT_FIELD_VELOCITY_FACTOR;
  const ifs: ExchangeInterface[] = [analyseInterface({ ...inp.cement, isCement: true }, inp.below, R, inp.zenithDeg, inp.plugLengthM, kf, inp.cementKinetics)];
  if (inp.belowPad) ifs.push(analyseInterface(inp.below, inp.belowPad, R, inp.zenithDeg, inp.padLengthM ?? inp.plugLengthM, kf));
  const worst = ifs.reduce((w, x) => (RANK[x.verdict] > RANK[w.verdict] ? x : w), ifs[0]);
  const main = ifs[0];
  const details: string[] = [];
  const rec: string[] = [];
  ifs.forEach((x) => {
    if (x.verdict === "no-buoyancy") { details.push(`«${x.upper}» над «${x.lower}»: верхняя жидкость не тяжелее нижней — гравитационного обмена нет.`); return; }
    details.push(
      `«${x.upper}» над «${x.lower}»: Δρ = ${fmt(x.deltaRhoKgM3)} кг/м³, Y = ${x.Y0.toFixed(3)} при пределе ${x.YcExp.toFixed(2)} (эксперимент) / ${x.YcTheory.toFixed(2)} (теория). ` +
      `Чтобы обмена не было совсем, нужен СНС ≥ ${fmt(x.tauRequiredExpPa)} Па (гарантированно ≥ ${fmt(x.tauRequiredTheoryPa)} Па).` +
      (x.Y0 < x.YcExp ? ` Частичный обмен остановится ${Number.isFinite(x.arrestMin) ? `через ≈${fmt(x.arrestMin)} мин` : "только при схватывании"}: лёгкая жидкость поднимется в мост на ~${fmt(x.lightPenetrationM)} м${x.topDropM > 0.5 ? `, кровля опустится на ~${fmt(x.topDropM, 1)} м` : " (до кровли не дойдёт)"}, подошва размыта на ~${fmt(x.bottomSmearM)} м.` : "") +
      (x.gelEstimated ? " (СНС не задан — оценка по ДНС.)" : ""),
    );
  });

  const headlines: Record<ExchangeVerdict, string> = {
    supported: "",
    "no-buoyancy": "Под цементом жидкость не легче цемента — гравитационного обмена нет, мост устойчив.",
    guaranteed: "Мост устойчив: прочность структуры выше теоретического предела — обмен жидкостями невозможен.",
    stable: "Мост устойчив: обмена жидкостями не будет (по экспериментальному критерию).",
    settle: main.topDropM < 0.5
      ? `Мост устоит: кровля останется на месте; частичный обмен лишь размоет подошву на ~${fmt(main.bottomSmearM)} м — структура цемента остановит его через ~${fmt(main.arrestMin)} мин.`
      : `Мост устоит: ожидаемое опускание кровли ~${fmt(main.topDropM, 1)} м (до 10% длины моста), размыв подошвы ~${fmt(main.bottomSmearM)} м.`,
    risk: `Риск: кровля опустится на ~${fmt(worst.topDropM)} м, подошва размыта на ~${fmt(worst.bottomSmearM)} м — мост останется, но короче и загрязнён.`,
    unstable: `Мост может уйти: кровля опустится на ~${fmt(worst.topDropM)} м — больше 30% длины моста.`,
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

  return { support: inp.support, radiusM: R, interfaces: ifs, verdict: worst.verdict, headline: headlines[worst.verdict], details, recommendations: rec, velocityFactor: kf };
}

/**
 * Калибровка промыслового множителя по отбивкам: для каждого случая подбирается множитель,
 * при котором прогноз опускания кровли совпадает с фактом; итог — среднее геометрическое.
 * Отбивка «на месте» (≤ 0,5 м) даёт верхнюю оценку множителя.
 */
export function calibrateVelocityFactor(cases: { input: ExchangeInput; actualDropM: number }[]): number | undefined {
  const ks: number[] = [];
  for (const c of cases) {
    const drop = (k: number) => assessPlugExchange({ ...c.input, velocityFactor: k }).interfaces[0]?.topDropM ?? 0;
    const target = Math.max(0.5, c.actualDropM);
    let lo = 0.002, hi = 3;
    if (drop(hi) < target) { ks.push(hi); continue; }
    if (drop(lo) >= target) { ks.push(lo); continue; }
    for (let i = 0; i < 30; i++) { const m = Math.sqrt(lo * hi); if (drop(m) < target) lo = m; else hi = m; }
    ks.push(Math.sqrt(lo * hi));
  }
  if (!ks.length) return undefined;
  return Math.exp(ks.reduce((t, k) => t + Math.log(k), 0) / ks.length);
}
