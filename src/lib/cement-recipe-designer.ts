/**
 * Подбор рецептуры тампонажного раствора под условия скважины и прогноз его свойств.
 *
 * ВАЖНО: все свойства — расчётный прогноз по инженерным корреляциям (абсолютные объёмы, практика API RP 10B-2,
 * типовые кривые для портландцемента класса G). Точность прогноза: плотность и выход — точно (баланс масс и объёмов);
 * время загустевания ±25%; водоотдача, реология, прочность — ориентировочно (±30–40%). Дозировки химии зависят
 * от конкретной партии цемента и марки реагента, поэтому протокол рассчитан на подтверждение испытанием.
 */
import type { Additive, SlurryInput } from "./cementing-calculations";
import type { SlurryLabProgram } from "./cement-program";

export interface DesignConditions {
  densityGcm3: number;
  /** BHCT, °C */
  bhctC: number;
  /** Статическая температура на кровле и подошве интервала раствора, °C */
  tTopC: number;
  tBottomC: number;
  /** BHST на забое, °C */
  bhstC: number;
  /** Максимальное давление на забое за операцию, МПа */
  maxPressureMPa: number;
  /** Требуемое время загустевания до 30 Вс, мин */
  requiredThickeningMin: number;
  /** Раствор перекрывает продуктивные пласты (хвостовая пачка) */
  coversPay: boolean;
  /** Есть газовые пласты в интервале или ниже кровли раствора */
  gas: boolean;
  /** Макс. зенитный угол в интервале, ° */
  maxZenithDeg: number;
  /** Мин. запас до ГРП/поглощения по программе, МПа (null — нет данных) */
  lossMarginMPa: number | null;
  isTail: boolean;
}

export type AdditiveRole =
  | "base" | "extender" | "lightweight" | "weighting" | "retarder" | "accelerator" | "fluidLoss" | "dispersant"
  | "defoamer" | "stabilizer" | "silica" | "gasBlock" | "expanding" | "fiber";

export interface DesignedComponent {
  role: AdditiveRole;
  name: string;
  /** Назначение (для протокола) */
  purpose: string;
  /** % от массы цемента (bwoc) */
  pctBwoc: number;
  sg: number;
}

export interface PredictedRheology { pv: number; ypPa: number; fann: Record<"r600" | "r300" | "r200" | "r100" | "r6" | "r3", number> }

export interface SlurryDesign {
  baseCement: string;
  cementSG: number;
  components: DesignedComponent[];
  /** Вода, % от массы цемента */
  waterPctBwoc: number;
  /** В/С к массе сухой смеси (как в программе) */
  waterToBlend: number;
  densityGcm3: number;
  yieldM3PerT: number;
  /** Объёмная доля твёрдой фазы */
  solidsFraction: number;
  predicted: {
    thickening30BcMin: number;
    thickening50BcMin: number;
    thickening100BcMin: number;
    fluidLossMl: number;
    fluidLossTargetMl: number;
    freeWaterPct: number;
    sedimentationGcm3: number;
    rheo27: PredictedRheology;
    rheoBhct: PredictedRheology;
    spreadCm: number;
    strength24TopMPa: number;
    strength48TopMPa: number;
    strength24BottomMPa: number;
    strength48BottomMPa: number;
    wocTo35MPaHours: number;
    sgsTransitionMin: number | null;
    expansionPct: number | null;
  };
  warnings: string[];
  rationale: string[];
}

const round = (x: number, step: number) => Math.round(x / step) * step;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Масса воды (кг на 1 т цемента) для заданной плотности при заданной сухой части. */
function waterForDensity(rho: number, massDry: number, volDry: number): number {
  return rho > 1 ? (massDry - rho * volDry) / (rho - 1) : 0;
}

function dryOf(comps: DesignedComponent[], cementSG: number) {
  const mass = 1000 + comps.reduce((s, c) => s + c.pctBwoc * 10, 0);
  const vol = 1000 / cementSG + comps.reduce((s, c) => s + (c.pctBwoc * 10) / c.sg, 0);
  return { mass, vol };
}

/** Время загустевания чистого ПЦТ G при В/Ц 0.44 по BHCT, мин (типовые кривые: 52 °C → 120 мин, 90 °C → 55 мин). */
export function neatThickeningMin(bhctC: number): number {
  return 120 * Math.exp(-0.0205 * (bhctC - 52));
}

/** Прочность на сжатие чистого ПЦТ G (В/Ц 0.44) через 24 ч при температуре T, МПа. */
function neatStrength24(tC: number): number {
  return 22 * (1 - Math.exp(-Math.max(0, tC - 4) / 30));
}

function rheologyAt(phi: number, bent: number, dFla: number, dDisp: number, latex: number, tC: number): PredictedRheology {
  let pv = 3 * Math.pow(Math.max(0.05, 1 - phi / 0.66), -2.5) + 1.5 * bent;
  let yp = 10 * Math.pow(phi / 0.42, 3) + 0.9 * bent;
  pv *= (1 + 0.8 * dFla) * (1 + 0.01 * latex);
  yp *= Math.exp(-3 * dDisp) * (1 + 0.3 * dFla);
  pv *= 1 - 0.004 * (tC - 27);
  yp *= 1 + 0.005 * (tC - 27);
  pv = Math.max(5, pv); yp = Math.max(0.5, yp);
  // Показания Fann: Гершель–Балкли с τ0 ≈ 0.45·YP, n по PV/YP, K по точке 511 с⁻¹
  const ypLbf = yp / 0.4788;
  const n = clamp(3.32 * Math.log10((2 * pv + ypLbf) / (pv + ypLbf)), 0.25, 1);
  const tau0 = 0.45 * yp;
  const tau511 = yp + (pv / 1000) * 511;
  const K = (tau511 - tau0) / Math.pow(511, n);
  const dial = (rpm: number) => Math.round(((tau0 + K * Math.pow(rpm * 1.7023, n)) / 0.511) * 2) / 2;
  return { pv, ypPa: yp, fann: { r600: dial(600), r300: dial(300), r200: dial(200), r100: dial(100), r6: dial(6), r3: dial(3) } };
}

export function designSlurry(c: DesignConditions): SlurryDesign {
  const cementSG = 3.15;
  const rho = c.densityGcm3;
  const warnings: string[] = [];
  const rationale: string[] = [];
  const comps: DesignedComponent[] = [];
  const add = (x: DesignedComponent) => { if (x.pctBwoc > 0) comps.push({ ...x, pctBwoc: Math.round(x.pctBwoc * 100) / 100 }); };

  // ── Высокотемпературная стабилизация ──
  const silica = c.bhstC > 110 ? 35 : 0;
  if (silica) {
    add({ role: "silica", name: "Кварцевая мука (SiO₂ ≥ 96%)", purpose: "Предотвращение снижения прочности (ретрогрессии) цементного камня при T > 110 °C", pctBwoc: silica, sg: 2.65 });
    rationale.push(`BHST ${c.bhstC.toFixed(0)} °C > 110 °C — 35% кварцевой муки против ретрогрессии прочности.`);
  }

  // ── Плотность: облегчение / утяжеление ──
  const WC_MIN = 0.35, WC_NEAT_MAX = 0.46;
  const wcMax = (bent: number) => WC_NEAT_MAX + 0.053 * bent + (0.4 * silica) / 100;
  let bent = 0, micro = 0, heavy = 0;
  let microName = "", microSG = 0.7;
  let heavyName = "Гематит (утяжелитель)", heavySG = 5.0;

  const solve = () => { const d = dryOf(comps.concat(extra()), cementSG); return waterForDensity(rho, d.mass, d.vol) / 1000; };
  const extra = (): DesignedComponent[] => {
    const e: DesignedComponent[] = [];
    if (bent > 0) e.push({ role: "extender", name: "Бентонит (глинопорошок), сухое смешение", purpose: "Облегчение и удержание воды затворения, стабилизация от водоотделения", pctBwoc: bent, sg: 2.65 });
    if (micro > 0) e.push({ role: "lightweight", name: microName, purpose: "Облегчение раствора без избытка воды (сохранение прочности)", pctBwoc: micro, sg: microSG });
    if (heavy > 0) e.push({ role: "weighting", name: heavyName, purpose: "Утяжеление раствора", pctBwoc: heavy, sg: heavySG });
    return e;
  };

  let wc = solve();
  if (wc > WC_NEAT_MAX + (0.4 * silica) / 100) {
    // облегчённый: бентонит до 14%, далее микросферы
    for (bent = 0.5; bent <= 14; bent += 0.5) { wc = solve(); if (wc <= wcMax(bent)) break; }
    if (bent > 14) {
      bent = 4;
      if (c.maxPressureMPa < 18) { microName = "Алюмосиликатные полые микросферы (АСПМ)"; microSG = 0.7; }
      else if (c.maxPressureMPa < 50) { microName = "Стеклянные полые микросферы, прочность ≥ 55 МПа"; microSG = 0.46; }
      else { microName = "Стеклянные полые микросферы, прочность ≥ 70 МПа"; microSG = 0.6; }
      const wAllowed = wcMax(bent);
      for (micro = 1; micro <= 90; micro++) {
        const d = dryOf(comps.concat(extra()), cementSG);
        const dens = (d.mass + wAllowed * 1000) / (d.vol + wAllowed * 1000);
        if (dens <= rho) break;
      }
      wc = solve();
      if (micro > 90) warnings.push(`Плотность ${rho.toFixed(2)} г/см³ не достигается микросферами в разумной дозировке — рассмотреть пеноцемент (модуль «Пена»).`);
      rationale.push(`Плотность ${rho.toFixed(2)} г/см³ ниже предела бентонитового облегчения — ${microName.toLowerCase()} ${micro}% и 4% бентонита для стабильности.`);
      if (c.maxPressureMPa > 0) rationale.push(`Тип микросфер выбран по давлению на забое ${c.maxPressureMPa.toFixed(1)} МПа (разрушение сфер повышает плотность в скважине).`);
    } else {
      rationale.push(`Облегчение бентонитом ${bent}%: при В/Ц ${wc.toFixed(2)} вода удерживается (предел ${wcMax(bent).toFixed(2)} по правилу 5.3% воды на 1% бентонита).`);
    }
  } else if (wc < WC_MIN) {
    if (c.maxPressureMPa >= 0 && rho > 2.2) { heavyName = "Гематит (утяжелитель)"; heavySG = 5.0; } else { heavyName = "Барит (утяжелитель)"; heavySG = 4.2; }
    for (heavy = 2; heavy <= 120; heavy += 2) {
      const d = dryOf(comps.concat(extra()), cementSG);
      const dens = (d.mass + 0.37 * 1000) / (d.vol + 0.37 * 1000);
      if (dens >= rho) break;
    }
    wc = solve();
    rationale.push(`Плотность ${rho.toFixed(2)} г/см³ выше предела чистого цемента — ${heavyName.toLowerCase()} ${heavy}% и пластификатор.`);
  } else {
    rationale.push(`Плотность ${rho.toFixed(2)} г/см³ достигается без облегчающих и утяжеляющих добавок; итоговое В/Ц рассчитано по абсолютным объёмам с учётом всех компонентов.`);
  }
  extra().forEach((e) => comps.push(e));
  const isLight = bent > 0 || micro > 0;

  // ── Водоотдача ──
  const flTarget = c.gas ? 50 : c.coversPay ? 100 : 250;
  const fl0 = 1200 / (1 + 0.15 * bent);
  const tempK = 1 + 0.006 * Math.max(0, c.bhctC - 50);
  let dFla = flTarget < fl0 ? 0.12 * Math.sqrt(fl0 / (flTarget * 0.85) - 1) * tempK : 0;
  dFla = clamp(round(dFla, 0.05), 0, 1.2);
  const latex = c.gas && c.isTail ? 8 : 0;
  if (dFla > 0) {
    add({ role: "fluidLoss", name: c.bhctC > 90 ? "Понизитель водоотдачи (синтетический полимер AMPS, термостойкий)" : "Понизитель водоотдачи (синтетический полимер / гидроксиэтилцеллюлоза)", purpose: `Водоотдача ≤ ${flTarget} мл/30 мин`, pctBwoc: dFla, sg: 1.3 });
    rationale.push(`Понизитель водоотдачи ${dFla.toFixed(2)}%: цель ≤ ${flTarget} мл/30 мин (${c.gas ? "газовые пласты" : c.coversPay ? "продуктивные пласты" : "кондуктор / непродуктивный интервал"}).`);
  }
  const flPred = Math.max(20, (fl0 / (1 + Math.pow(dFla / tempK / 0.12, 2))) * (latex ? 0.7 : 1));

  // ── Газоблокировка, расширение, волокно ──
  if (latex) {
    add({ role: "gasBlock", name: "Газоблокирующая добавка (латекс SBR) со стабилизатором", purpose: "Сокращение переходного периода, перекрытие пор камня от миграции газа", pctBwoc: latex, sg: 1.02 });
    rationale.push("Газовые пласты в интервале — латексная газоблокирующая добавка 8%.");
  }
  if (c.isTail && c.coversPay) {
    add({ role: "expanding", name: "Расширяющая добавка (MgO / CaO-основа)", purpose: "Компенсация усадки, плотный контакт с колонной и породой", pctBwoc: 3, sg: 3.3 });
  }
  if (c.lossMarginMPa !== null && c.lossMarginMPa < 1.5) {
    add({ role: "fiber", name: "Армирующее волокно (полипропилен / минеральное)", purpose: "Снижение поглощения в слабых пластах, повышение трещиностойкости камня", pctBwoc: 0.25, sg: 1.3 });
    rationale.push(`Запас до поглощения ${c.lossMarginMPa.toFixed(2)} МПа — добавлено волокно 0.25% против поглощения.`);
  }

  // ── Пластификатор ──
  let dDisp = 0;
  if (!isLight) {
    dDisp = 0.15 + 0.4 * Math.max(0, (0.44 - wc) / 0.09) + (dFla > 0.4 ? 0.15 : 0);
    dDisp = clamp(round(dDisp, 0.05), 0, 0.8);
  } else if (dFla > 0.5) dDisp = 0.1;
  if (dDisp > 0) add({ role: "dispersant", name: "Пластификатор (полинафталинсульфонат, тип С-3)", purpose: "Снижение вязкости и ДНС, прокачиваемость", pctBwoc: dDisp, sg: 1.35 });

  // ── Стабилизация от водоотделения ──
  const needStab = (c.maxZenithDeg > 30 || c.gas) && bent < 2;
  if (needStab) add({ role: "stabilizer", name: "Стабилизатор (биополимер, тип велановой камеди)", purpose: "Нулевое водоотделение и отсутствие седиментации в наклонном стволе", pctBwoc: 0.05, sg: 1.5 });

  // ── Время загустевания: замедлитель / ускоритель ──
  const req = Math.max(60, c.requiredThickeningMin);
  const ttBase = neatThickeningMin(c.bhctC) * (1 + 0.3 * dFla) * (1 + 0.2 * dDisp) * Math.pow(Math.max(0.3, wc) / 0.44, 0.8) * (latex ? 1.15 : 1);
  const ttTarget = req * 1.2;
  let dRet = 0, cacl = 0;
  const aRet = c.bhctC > 90 ? 6 : 8;
  if (ttBase < ttTarget && round((ttTarget / ttBase - 1) / aRet, 0.01) > 0) {
    dRet = clamp(round((ttTarget / ttBase - 1) / aRet, 0.01), 0, 1.5);
    add({ role: "retarder", name: c.bhctC > 90 ? "Замедлитель высокотемпературный (синтетический)" : "Замедлитель схватывания (лигносульфонатный)", purpose: `Время загустевания ≥ ${req.toFixed(0)} мин при BHCT ${c.bhctC.toFixed(0)} °C`, pctBwoc: dRet, sg: 1.3 });
    rationale.push(`Без замедлителя время загустевания ≈ ${ttBase.toFixed(0)} мин < требуемых ${req.toFixed(0)} — замедлитель ${dRet.toFixed(2)}% (цель ${ttTarget.toFixed(0)} мин с запасом 20%).`);
    if (dRet >= 1.5) warnings.push("Требуемая дозировка замедлителя на пределе — время загустевания подтвердить испытанием обязательно; рассмотреть сокращение времени операции.");
  } else if (ttBase > req * 2.5 && c.tTopC < 25) {
    cacl = clamp(round(((ttBase / (req * 1.5)) - 1) / 0.35, 0.5), 0, 3);
    if (cacl > 0) {
      add({ role: "accelerator", name: "Хлорид кальция (ускоритель)", purpose: `Ускорение схватывания и набора прочности при ${c.tTopC.toFixed(0)} °C на кровле`, pctBwoc: cacl, sg: 1.96 });
      rationale.push(`Холодная кровля (${c.tTopC.toFixed(0)} °C) и большой запас по времени — ускоритель CaCl₂ ${cacl}%.`);
    }
  } else {
    rationale.push(`Время загустевания без замедлителя ≈ ${ttBase.toFixed(0)} мин при требуемых ${req.toFixed(0)} — замедлитель не нужен.`);
  }
  const tt = (ttBase * (1 + aRet * dRet)) / (1 + 0.35 * cacl);

  // ── Пеногаситель (всегда при полимерах) ──
  add({ role: "defoamer", name: "Пеногаситель (полигликолевый / силиконовый)", purpose: "Исключение вовлечения воздуха при затворении (точность плотности)", pctBwoc: 0.2, sg: 1.0 });

  // ── Окончательный водобаланс ──
  const dry = dryOf(comps, cementSG);
  const waterKg = waterForDensity(rho, dry.mass, dry.vol);
  const wcFinal = waterKg / 1000;
  const vTot = dry.vol + waterKg;
  const solidsFraction = dry.vol / vTot;
  // Для реологии: жидкие добавки (латекс, пеногаситель) — часть жидкости; сферы микросфер вязкость повышают слабо
  const liquidVol = comps.filter((x) => x.role === "gasBlock" || x.role === "defoamer").reduce((t, x) => t + (x.pctBwoc * 10) / x.sg, 0);
  const microVol = comps.filter((x) => x.role === "lightweight").reduce((t, x) => t + (x.pctBwoc * 10) / x.sg, 0);
  const phiRheo = (dry.vol - liquidVol - 0.5 * microVol) / vTot;
  const yieldM3PerT = vTot / dry.mass;
  if (wcFinal > wcMax(bent) + 0.02 && micro === 0) warnings.push(`В/Ц ${wcFinal.toFixed(2)} выше водоудерживающей способности смеси — риск водоотделения.`);

  // ── Свободная вода и седиментация ──
  const excess = Math.max(0, wcFinal - wcMax(bent));
  let freeWater = needStab || bent >= 2 ? 0 : clamp(0.3 + 8 * excess, 0, 5);
  if (c.maxZenithDeg > 30 && freeWater > 0) freeWater *= 1.5;
  freeWater = Math.round(freeWater * 10) / 10;
  const sedim = needStab || bent >= 2 ? 0.02 : 0.04 + excess * 0.2;

  // ── Реология ──
  const rheo27 = rheologyAt(phiRheo, bent, dFla, dDisp, latex, 27);
  const rheoBhct = rheologyAt(phiRheo, bent, dFla, dDisp, latex, c.bhctC);
  const spread = clamp(27 - 0.45 * rheo27.ypPa, 14, 26);
  if (rheo27.ypPa > 25) warnings.push("Высокая ДНС раствора — проверить прокачиваемость, возможно увеличение пластификатора.");

  // ── Прочность ──
  const wEff = waterKg / (1000 + (silica ? 0 : 0));
  const strFactor = Math.pow(0.44 / Math.max(0.3, wEff), 1.8) * (1 - 0.004 * micro) * Math.max(0.35, 1 - 0.5 * dRet) * (1 + 0.12 * cacl) * (heavy > 0 ? 0.95 : 1);
  const s24 = (t: number) => neatStrength24(t) * strFactor * (c.bhstC > 110 && !silica ? 0.6 : 1);
  const s24Top = s24(c.tTopC), s24Bot = s24(c.tBottomC);
  const s48 = (v: number, t: number) => Math.min(v * 1.35, neatStrength24(t) * strFactor * 1.6);
  // ОЗЦ до 3.5 МПа: S(t) = S∞·(1 − exp(−(t − t0)/τ)), t0 — начало схватывания при статической T кровли
  const ttTopH = ((ttBase * (1 + aRet * dRet)) / (1 + 0.35 * cacl)) * Math.exp(0.0205 * (c.bhctC - c.tTopC)) / 60;
  const t0 = Math.min(20, ttTopH * 1.2), tau = 12;
  const sInf = s24Top / Math.max(0.05, 1 - Math.exp(-(24 - t0) / tau));
  const woc = sInf > 3.5 ? t0 - tau * Math.log(1 - 3.5 / sInf) : Infinity;
  if (c.tTopC < 5) warnings.push(`Кровля раствора в зоне ${c.tTopC.toFixed(0)} °C (ММП / холодный интервал): обычный ПЦТ почти не твердеет — нужен цемент для низких температур (ГОСТ 1581, тип для «холодных» скважин) или подогрев.`);
  if (!Number.isFinite(woc) || woc > 48) warnings.push(`На кровле (${c.tTopC.toFixed(0)} °C) прочность 3.5 МПа набирается дольше 48 ч — нужен ускоритель или более тёплый интервал под ОЗЦ.`);
  if (s24Top < 0.7) warnings.push(`Прогноз прочности на кровле через 24 ч — ${s24Top.toFixed(1)} МПа. Время ОЗЦ определять по лабораторному испытанию при ${c.tTopC.toFixed(0)} °C.`);

  const sgs = c.gas ? (latex ? 35 : 75) : null;
  if (c.gas && sgs !== null && sgs > 45) warnings.push("Переходный период СНС больше 45 мин — риск миграции газа.");

  const extenderNote = micro > 0 && microSG < 0.7 ? " Микросферы частично разрушаются под давлением — плотность в скважине может вырасти на 0.02–0.05 г/см³." : "";
  if (extenderNote) warnings.push(extenderNote.trim());

  return {
    baseCement: c.tTopC < 15 && !c.isTail ? "ПЦТ I-G-CC-1 (ГОСТ 1581-2019); допускается ПЦТ I-50 для холодного интервала" : "ПЦТ I-G-CC-1 (ГОСТ 1581-2019), тампонажный портландцемент класса G",
    cementSG, components: comps,
    waterPctBwoc: wcFinal * 100,
    waterToBlend: waterKg / dry.mass,
    densityGcm3: (dry.mass + waterKg) / vTot,
    yieldM3PerT, solidsFraction,
    predicted: {
      thickening30BcMin: tt,
      thickening50BcMin: tt * 1.08,
      thickening100BcMin: tt * 1.18,
      fluidLossMl: flPred,
      fluidLossTargetMl: flTarget,
      freeWaterPct: freeWater,
      sedimentationGcm3: sedim,
      rheo27, rheoBhct, spreadCm: spread,
      strength24TopMPa: s24Top, strength48TopMPa: s48(s24Top, c.tTopC),
      strength24BottomMPa: s24Bot, strength48BottomMPa: s48(s24Bot, c.tBottomC),
      wocTo35MPaHours: woc,
      sgsTransitionMin: sgs,
      expansionPct: c.isTail && c.coversPay ? 0.8 : null,
    },
    warnings, rationale,
  };
}

/** Условия для подбора по программе испытаний и данным скважины. */
export function conditionsFor(
  s: SlurryInput, idx: number, total: number, lab: SlurryLabProgram, bhstC: number,
  layers: { topMD: number; bottomMD: number; fluidType: string }[], maxZenithDeg: number, lossMarginMPa: number | null,
): DesignConditions {
  const coversPay = layers.some((l) => l.bottomMD >= lab.topMD && l.topMD <= lab.bottomMD);
  // Газонепроницаемость нужна раствору, который стоит против газового пласта и до 150 м выше него
  const gas = layers.some((l) => /газ/i.test(l.fluidType || "") && l.bottomMD >= lab.topMD && l.topMD - 150 <= lab.bottomMD);
  return {
    densityGcm3: s.density, bhctC: lab.bhctC, tTopC: lab.tTopStaticC, tBottomC: lab.tBottomStaticC, bhstC,
    maxPressureMPa: lab.testPressureMPa, requiredThickeningMin: lab.requiredThickeningMin,
    coversPay, gas, maxZenithDeg, lossMarginMPa, isTail: idx === total - 1,
  };
}

/** Перенос подобранной рецептуры в раствор программы (добавки, В/С, выход, реология, время загустевания). */
export function applyDesignToSlurry(s: SlurryInput, d: SlurryDesign, keepMeasured = true): SlurryInput {
  const additives: Additive[] = d.components.map((c) => ({
    name: c.name, percentage: Math.round(c.pctBwoc * 100) / 100, percentageType: "bwoc", massKg: 0, specificGravity: c.sg,
  }));
  const r = d.predicted.rheo27;
  return {
    ...s,
    additives,
    cementSG: d.cementSG,
    waterRatio: Math.round(d.waterToBlend * 1000) / 1000,
    yieldPerTon: Math.round(d.yieldM3PerT * 1000) / 1000,
    rheology: { pv: Math.round(r.pv), yp: Math.round(r.ypPa * 10) / 10, fann: { ...r.fann } },
    thickeningTime30Bc: keepMeasured && s.thickeningTime30Bc > 0 ? s.thickeningTime30Bc : Math.round(d.predicted.thickening30BcMin),
    thickeningTime50Bc: keepMeasured && s.thickeningTime50Bc > 0 ? s.thickeningTime50Bc : Math.round(d.predicted.thickening50BcMin),
  };
}
