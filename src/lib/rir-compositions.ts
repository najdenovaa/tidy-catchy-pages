/**
 * РИР, этап 3: составы для задавливания — микроцемент и двухкомпонентные эпоксидные смолы.
 *
 * Микроцемент: тонкодисперсный портландцемент (d50 ≈ 3–5 мкм, d95 ≤ 12–15 мкм, удельная
 * поверхность ≥ 8000 см²/г). Большая поверхность → больше воды и пластификатора, быстрее
 * гидратация. Рецептура по абсолютным объёмам; время загустевания — от типовой кривой
 * класса G с поправкой на дисперсность, В/Ц и замедлитель.
 *
 * Смола: эпоксидная диановая (ЭД-20 / DGEBA, ЭЭМ ≈ 190 г/экв, ~15 Па·с при 25 °C) +
 * отвердитель, выбранный по температуре; активный разбавитель (глицидиловый эфир) для
 * вязкости; стехиометрия: м.ч. отвердителя = AHEW·100/ЭЭМ. Время гелеобразования —
 * по Аррениусу от времени жизни при 25 °C (Ea ≈ 55–75 кДж/моль).
 *
 * Все свойства — ориентировочный прогноз по открытым данным; рецептура подтверждается
 * лабораторно на фактических материалах при BHCT (время жизни / загустевания, плотность,
 * вязкость, прочность). Работа со смолами — по паспортам безопасности (амины — едкие,
 * экзотермия больших объёмов).
 */
import { D95_UM } from "./rir-calculations";

export interface CompositionConditions {
  bhctC: number;
  bhstC: number;
  /** Требуемое время жизни / загустевания, мин */
  requiredWorkLifeMin: number;
  /** Объём состава на операцию, м³ */
  volumeM3: number;
  /** Целевая плотность, г/см³ (0 — типовая) */
  targetDensity: number;
  /** Нужна газонепроницаемость (межколонное давление газа) */
  gasTight?: boolean;
}

export interface CompComponent { name: string; role: string; purpose: string; /** % от массы цемента или м.ч. на 100 м.ч. смолы */ dose: number; doseUnit: string; kgPerM3: number; sg: number }

export interface CurvePoint { x: number; y: number }

export interface CompositionDesign {
  kind: "microcement" | "resin";
  title: string;
  system: string;
  components: CompComponent[];
  waterLPerM3: number;
  densityGcm3: number;
  props: { label: string; value: string; target?: string; ok?: boolean }[];
  workLifeAtBhctMin: number;
  /** Время жизни / загустевания по температуре (для графика) */
  workLifeCurve: CurvePoint[];
  /** Консистенция (Вс) или вязкость (мПа·с) от времени при BHCT */
  thickeningCurve: CurvePoint[];
  thickeningUnit: string;
  /** Прочность на сжатие от времени при BHST, МПа */
  strengthCurve: CurvePoint[];
  procedure: string[];
  warnings: string[];
  notes: string[];
  penetrationUm: number;
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const round = (x: number, s: number) => Math.round(x / s) * s;

// ═══════════════ Микроцемент ═══════════════

const MC_SG = 3.05;
/** Загустевание до 70 Вс чистого микроцемента при В/Ц w, мин (типовая кривая G × 0,6 на дисперсность). */
function mcNeatTT(bhct: number, wc: number) {
  return 0.6 * 120 * Math.exp(-0.0205 * (bhct - 52)) * Math.pow(Math.max(0.5, wc) / 0.44, 0.6);
}

export function designMicrocement(c: CompositionConditions): CompositionDesign {
  const rho = c.targetDensity > 0 ? c.targetDensity : 1.55;
  const warnings: string[] = [], notes: string[] = [];
  const comps: { name: string; role: string; purpose: string; pct: number; sg: number }[] = [];
  // пластификатор обязателен: удельная поверхность в 2–3 раза выше ПЦТ
  const disp = rho >= 1.6 ? 1.5 : rho >= 1.5 ? 1.2 : 1.0;
  comps.push({ name: "Пластификатор (полинафталинсульфонат / поликарбоксилат)", role: "dispersant", purpose: "Прокачиваемость и проникновение: снижение вязкости суспензии с высокой удельной поверхностью", pct: disp, sg: 1.35 });
  comps.push({ name: "Понизитель водоотдачи (AMPS-сополимер)", role: "fla", purpose: "Водоотдача ≤ 50 мл/30 мин — без обезвоживания и «пробки» на входе в канал", pct: c.bhctC > 90 ? 0.8 : 0.6, sg: 1.3 });
  if (c.gasTight) comps.push({ name: "Микрокремнезём (SiO₂, d50 ≈ 0,15 мкм)", role: "silica", purpose: "Снижение проницаемости камня, газоблокировка", pct: 6, sg: 2.2 });
  if (c.bhstC > 110) comps.push({ name: "Кварцевая мука тонкого помола (≤ 10 мкм)", role: "silica_flour", purpose: "Против ретрогрессии прочности при T > 110 °C (тонкий помол — не снижает проходимость)", pct: 35, sg: 2.65 });
  comps.push({ name: "Пеногаситель", role: "defoamer", purpose: "Точность плотности", pct: 0.2, sg: 1.0 });
  const dry = () => {
    const mass = 1000 + comps.reduce((t, x) => t + x.pct * 10, 0);
    const vol = 1000 / MC_SG + comps.reduce((t, x) => t + (x.pct * 10) / x.sg, 0);
    return { mass, vol };
  };
  let d = dry();
  let water = (d.mass - rho * d.vol) / (rho - 1); // кг на 1 т микроцемента
  let wc = water / 1000;
  if (wc < 0.6) warnings.push(`Плотность ${rho.toFixed(2)} г/см³ даёт В/Ц ${wc.toFixed(2)} — для микроцемента мало воды, высокая вязкость; рекомендуется ≤ 1,65 г/см³.`);
  if (wc > 1.6) warnings.push(`В/Ц ${wc.toFixed(2)} — избыток воды, риск водоотделения и низкой прочности; рекомендуется ≥ 1,40 г/см³.`);

  // Замедлитель под требуемое время загустевания
  const req = Math.max(60, c.requiredWorkLifeMin);
  const target = req * 1.2;
  const tt0 = mcNeatTT(c.bhctC, wc) * (1 + 0.15 * disp);
  let ret = 0;
  if (tt0 < target) {
    ret = clamp(round((target / tt0 - 1) / (c.bhctC > 90 ? 6 : 8), 0.02), 0, 1.5);
    comps.push({ name: c.bhctC > 90 ? "Замедлитель высокотемпературный (синтетический)" : "Замедлитель (лигносульфонат / глюконат)", role: "retarder", purpose: `Время загустевания ≥ ${req.toFixed(0)} мин при ${c.bhctC.toFixed(0)} °C`, pct: ret, sg: 1.3 });
    d = dry(); water = (d.mass - rho * d.vol) / (rho - 1); wc = water / 1000;
  }
  const tt = tt0 * (1 + (c.bhctC > 90 ? 6 : 8) * ret);
  if (ret >= 1.5) warnings.push("Дозировка замедлителя на пределе — время загустевания обязательно подтвердить на консистометре.");

  const vTot = d.vol + water; // л на 1 т
  const cemPerM3 = 1e6 / vTot; // кг/м³
  const components: CompComponent[] = [
    { name: "Микроцемент (d50 3–5 мкм, d95 ≤ 15 мкм, Sуд ≥ 8000 см²/г)", role: "binder", purpose: "Вяжущее, проникающее в каналы ≥ 45 мкм", dose: 100, doseUnit: "%", kgPerM3: cemPerM3, sg: MC_SG },
    ...comps.map((x) => ({ name: x.name, role: x.role, purpose: x.purpose, dose: x.pct, doseUnit: "% bwoc", kgPerM3: (cemPerM3 * x.pct) / 100, sg: x.sg })),
  ];
  const waterL = (cemPerM3 * wc);
  // свойства
  const phi = d.vol / vTot;
  const pv = clamp(6 + 70 * Math.pow(phi, 2) / (1 + disp), 8, 60);
  const yp = clamp(2 + 25 * Math.pow(phi, 2.5) - 2 * disp, 0.5, 15);
  const s24 = (t: number) => 26 * (1 - Math.exp(-Math.max(0, t - 4) / 25)) * Math.pow(0.44 / Math.max(0.4, wc), 1.5) * (1 + 0.05 * (comps.some((x) => x.role === "silica") ? 1 : 0)) * Math.max(0.35, 1 - 0.4 * ret);
  const ucsInf = s24(c.bhstC) / 0.72;
  const strengthCurve = [0, 2, 4, 6, 8, 12, 16, 24, 36, 48, 72].map((h) => ({ x: h, y: Math.round(ucsInf * (1 - Math.exp(-Math.max(0, h - (tt / 60) * 0.8) / 10)) * 10) / 10 }));
  const workLifeCurve = Array.from({ length: 25 }, (_, i) => { const T = 10 + i * 6; return { x: T, y: Math.round(mcNeatTT(T, wc) * (1 + 0.15 * disp) * (1 + (T > 90 ? 6 : 8) * ret)) }; });
  const thickeningCurve = Array.from({ length: 31 }, (_, i) => {
    const t = (tt * 1.3 * i) / 30;
    const bc = t <= tt * 0.85 ? 8 + 22 * (t / (tt * 0.85)) : t <= tt ? 30 + 40 * ((t - tt * 0.85) / (tt * 0.15)) : Math.min(100, 70 + 30 * (1 - Math.exp(-3 * (t - tt) / (tt * 0.3))));
    return { x: Math.round(t), y: Math.round(bc) };
  });
  notes.push(`Проходимость: d95 ≤ ${D95_UM.microcement} мкм → проникает в каналы от ~${3 * D95_UM.microcement} мкм (правило 3·d95).`);
  notes.push("Микроцемент быстро гидратируется: затворять непосредственно перед закачкой, время от затворения до начала закачки — не более 15–20 мин.");
  return {
    kind: "microcement", title: "Микроцементный состав", system: "Тонкодисперсный портландцемент + пластификатор + понизитель водоотдачи" + (ret > 0 ? " + замедлитель" : ""),
    components, waterLPerM3: Math.round(waterL), densityGcm3: rho,
    props: [
      { label: "Плотность, г/см³", value: rho.toFixed(2), target: "по программе ± 0,02" },
      { label: "В/Ц (к микроцементу)", value: wc.toFixed(2) },
      { label: "Выход, м³ на 1 т микроцемента", value: (vTot / 1000).toFixed(3) },
      { label: "ПВ, мПа·с / ДНС, Па (27 °C)", value: `${pv.toFixed(0)} / ${yp.toFixed(1)}`, target: "ДНС ≤ 10 Па", ok: yp <= 10 },
      { label: "Водоотдача, мл/30 мин", value: "40–60", target: "≤ 50", ok: true },
      { label: "Свободная вода, %", value: "0–0,3", target: "≤ 0,5", ok: true },
      { label: `Загустевание до 70 Вс при ${c.bhctC.toFixed(0)} °C, мин`, value: tt.toFixed(0), target: `≥ ${req.toFixed(0)}`, ok: tt >= req },
      { label: `Прочность 24 ч при ${c.bhstC.toFixed(0)} °C, МПа`, value: s24(c.bhstC).toFixed(1), target: "≥ 7", ok: s24(c.bhstC) >= 7 },
      { label: "Крупность d95, мкм", value: `≤ ${D95_UM.microcement}` },
    ],
    workLifeAtBhctMin: tt, workLifeCurve, thickeningCurve, thickeningUnit: "Вс", strengthCurve,
    procedure: [
      "Вода техническая пресная (t 15–25 °C); ввести пеногаситель и жидкие реагенты (замедлитель, пластификатор, если жидкий).",
      "Сухие добавки (понизитель водоотдачи, микрокремнезём) — в сухую смесь с микроцементом или через гидроворонку.",
      "Затворение в осреднительной ёмкости с интенсивным перемешиванием (высокий сдвиг) 5–10 мин; контроль плотности рычажными весами под давлением.",
      "Закачка сразу после затворения; не допускать простоя суспензии без перемешивания.",
      "Перед закачкой — буфер пресной воды 0,3–0,5 м³ (снимает загрязнение канала), после — буфер 0,2 м³.",
    ],
    warnings, notes, penetrationUm: 3 * D95_UM.microcement,
  };
}

// ═══════════════ Смолы ═══════════════

const EEW = 190; // г/экв, ЭД-20 / DGEBA
const RESIN_SG = 1.17;

interface Hardener { key: string; name: string; ahew: number; t25Min: number; EaKJ: number; minCureC: number; maxUseC: number; visc25: number; sg: number; note: string; accelPhr?: number }

const HARDENERS: Hardener[] = [
  { key: "pepa", name: "Полиэтиленполиамин (ПЭПА) — алифатический амин", ahew: 27, t25Min: 45, EaKJ: 55, minCureC: 10, maxUseC: 60, visc25: 120, sg: 1.0, note: "холодное отверждение, короткое время жизни" },
  { key: "d230", name: "Полиэфирамин (тип D-230) — алифатический полиэфирный амин", ahew: 60, t25Min: 320, EaKJ: 55, minCureC: 25, maxUseC: 120, visc25: 9, sg: 0.95, note: "длинное время жизни при умеренных температурах, эластичный полимер" },
  { key: "d400", name: "Полиэфирамин (тип D-400) — алифатический полиэфирный амин", ahew: 115, t25Min: 600, EaKJ: 55, minCureC: 35, maxUseC: 120, visc25: 21, sg: 0.97, note: "очень длинное время жизни, повышенная эластичность камня" },
  { key: "ipda", name: "Изофорондиамин (ИФДА) — циклоалифатический амин", ahew: 42.6, t25Min: 130, EaKJ: 57, minCureC: 20, maxUseC: 110, visc25: 20, sg: 0.92, note: "умеренные температуры, низкая вязкость" },
  { key: "detda", name: "Диэтилтолуолдиамин (ДЭТДА) — ароматический амин", ahew: 44.6, t25Min: 20000, EaKJ: 62, minCureC: 60, maxUseC: 160, visc25: 150, sg: 1.02, note: "горячие скважины, долгое время жизни, высокая термостойкость" },
  { key: "mthpa", name: "Метилтетрагидрофталевый ангидрид (МТГФА) + ускоритель ДМП-30", ahew: 166, t25Min: 80000, EaKJ: 75, minCureC: 90, maxUseC: 180, visc25: 60, sg: 1.21, note: "очень горячие скважины, отверждение только при нагреве", accelPhr: 1 },
];

function gelTime(h: Hardener, T: number, k = 1): number {
  return h.t25Min * Math.exp(((h.EaKJ * 1000) / 8.314) * (1 / (T + 273.15) - 1 / 298.15)) * k;
}

export function designResin(c: CompositionConditions): CompositionDesign {
  const warnings: string[] = [], notes: string[] = [];
  const req = Math.max(40, c.requiredWorkLifeMin);
  // Выбор отвердителя: время жизни при BHCT в окне [req, 4·req] и отверждение при BHST
  const cand = HARDENERS.filter((h) => c.bhstC >= h.minCureC && c.bhctC <= h.maxUseC);
  let h = cand.find((x) => { const t = gelTime(x, c.bhctC); return t >= req && t <= 4 * req; });
  let factor = 1; let modifier = "";
  if (!h) {
    const longer = cand.filter((x) => gelTime(x, c.bhctC) >= req).sort((a, b) => gelTime(a, c.bhctC) - gelTime(b, c.bhctC))[0];
    const shorter = cand.filter((x) => gelTime(x, c.bhctC) < req).sort((a, b) => gelTime(b, c.bhctC) - gelTime(a, c.bhctC))[0];
    if (shorter && req / gelTime(shorter, c.bhctC) <= 3) { h = shorter; factor = clamp((req * 1.2) / gelTime(shorter, c.bhctC), 1, 3); modifier = "retarder"; }
    else if (longer) { h = longer; factor = clamp((req * 1.5) / gelTime(longer, c.bhctC), 1 / 3, 1); modifier = factor < 0.999 ? "accelerator" : ""; }
    else if (shorter) { h = shorter; factor = 3; modifier = "retarder"; warnings.push(`Даже с замедлителем время жизни ≈ ${(gelTime(shorter, c.bhctC) * 3).toFixed(0)} мин < требуемых ${req.toFixed(0)} — сократите время операции (меньше объём, выше расход) или нужен специальный состав.`); }
    else { h = HARDENERS[2]; warnings.push("Ни одна система не обеспечивает время жизни при данной температуре — нужен специальный состав (подтверждение в лаборатории обязательно)."); }
  }
  if (!cand.length) warnings.push(`При BHST ${c.bhstC.toFixed(0)} °C ни одна стандартная система не отверждается — для низких температур нужен специальный состав с ускорителем.`);
  const tGel = gelTime(h, c.bhctC, factor);
  const phr = Math.round((h.ahew * 100) / EEW * 10) / 10;

  // Разбавитель для вязкости ≤ 300 мПа·с при BHCT
  const viscMix = (dil: number, T: number) => {
    const wR = 100 / (100 + phr + dil), wH = phr / (100 + phr + dil), wD = dil / (100 + phr + dil);
    const ln25 = wR * Math.log(15000) + wH * Math.log(h!.visc25) + wD * Math.log(3);
    return Math.exp(ln25) * Math.exp(-0.05 * (T - 25));
  };
  let dil = 5;
  for (; dil <= 30; dil += 1) if (viscMix(dil, c.bhctC) <= 300) break;
  dil = Math.min(30, dil);
  const visc = viscMix(dil, c.bhctC);
  if (visc > 300) warnings.push(`Вязкость при ${c.bhctC.toFixed(0)} °C ≈ ${visc.toFixed(0)} мПа·с — выше 300; проникновение в микрозазоры будет медленным, допускается задавливание при повышенном давлении в окне.`);

  // Плотность: смола + отвердитель + разбавитель ≈ 1,1–1,17; утяжеление баритом с тиксотропом
  const parts = [
    { name: "Смола эпоксидная диановая ЭД-20 (DGEBA, ЭЭМ ≈ 190)", role: "resin", purpose: "Связующее", phr: 100, sg: RESIN_SG },
    { name: h.name, role: "hardener", purpose: `Отвердитель (стехиометрия AHEW ${h.ahew}: ${phr} м.ч.) — ${h.note}`, phr, sg: h.sg },
    { name: "Активный разбавитель (бутилглицидиловый / алкил C12–C14 глицидиловый эфир)", role: "diluent", purpose: `Снижение вязкости до ~${Math.round(visc)} мПа·с при BHCT, встраивается в сетку`, phr: dil, sg: 0.9 },
  ];
  if (h.accelPhr) parts.push({ name: "Ускоритель ДМП-30 (2,4,6-трис(диметиламинометил)фенол)", role: "accel", purpose: "Отверждение ангидридной системы", phr: h.accelPhr * (modifier === "accelerator" ? 1 / factor : 1), sg: 0.97 });
  else if (modifier === "accelerator") parts.push({ name: "Ускоритель ДМП-30", role: "accel", purpose: `Сокращение времени жизни в ${(1 / factor).toFixed(1)} раза`, phr: Math.round((1 / factor - 1) * 2 * 10) / 10, sg: 0.97 });
  if (modifier === "retarder") parts.push({ name: "Пластификатор-разбавитель (дибутилфталат, ДБФ) — замедление", role: "retarder", purpose: `Удлинение времени жизни в ~${factor.toFixed(1)} раза за счёт разбавления реакционной смеси (не применять бензиловый спирт — он ускоряет)`, phr: Math.round((factor - 1) * 8 * 10) / 10, sg: 1.04 });
  const baseMass = parts.reduce((t, p) => t + p.phr, 0);
  const baseVol = parts.reduce((t, p) => t + p.phr / p.sg, 0);
  const rho0 = baseMass / baseVol;
  const rho = c.targetDensity > 0 ? c.targetDensity : rho0;
  let barite = 0, thix = 0;
  if (rho > rho0 + 0.01) {
    thix = 1.5;
    const m0 = baseMass + thix, v0 = baseVol + thix / 2.2;
    barite = (rho * v0 - m0) / (1 - rho / 4.2);
    parts.push({ name: "Пирогенный кремнезём (аэросил) — тиксотроп", role: "thix", purpose: "Удержание утяжелителя от оседания", phr: thix, sg: 2.2 });
    parts.push({ name: "Барит тонкого помола (d95 ≤ 20 мкм)", role: "weight", purpose: `Плотность ${rho.toFixed(2)} г/см³`, phr: Math.round(barite * 10) / 10, sg: 4.2 });
    warnings.push("Утяжелённая смола содержит частицы барита (d95 ≈ 20 мкм) — для микрозазоров < 60 мкм применяйте неутяжелённую смолу.");
  }
  const totMass = parts.reduce((t, p) => t + p.phr, 0), totVol = parts.reduce((t, p) => t + p.phr / p.sg, 0);
  const density = totMass / totVol;
  const kgPerPhr = (1000 / totVol); // кг на 1 м.ч. при 1 м³ (м.ч. в кг на totVol л)
  const components: CompComponent[] = parts.map((p) => ({ name: p.name, role: p.role, purpose: p.purpose, dose: p.phr, doseUnit: "м.ч.", kgPerM3: p.phr * kgPerPhr, sg: p.sg }));

  const ucs = barite > 0 ? 55 : 75;
  const cureH = Math.max(6, (tGel / 60) * 4);
  const strengthCurve = [0, 2, 4, 6, 8, 12, 16, 24, 36, 48, 72].map((t) => ({ x: t, y: Math.round(ucs * (1 - Math.exp(-Math.max(0, t - tGel / 60) / (cureH / 3))) * 10) / 10 }));
  const workLifeCurve = Array.from({ length: 25 }, (_, i) => { const T = 10 + i * 7; return { x: T, y: Math.round(gelTime(h!, T, factor)) }; });
  const thickeningCurve = Array.from({ length: 31 }, (_, i) => {
    const t = (tGel * 1.2 * i) / 30;
    const mu = visc * Math.exp(4.6 * Math.pow(t / tGel, 3)); // к гель-точке вязкость растёт на 2 порядка
    return { x: Math.round(t), y: Math.round(Math.min(mu, 100000)) };
  });
  if (c.bhstC < h.minCureC) warnings.push(`BHST ${c.bhstC.toFixed(0)} °C ниже минимальной температуры отверждения системы (${h.minCureC} °C).`);
  if (c.volumeM3 > 1) warnings.push("Объём смолы > 1 м³: сильная экзотермия при отверждении в ёмкости — смешивать порциями «на лету», не оставлять смесь в ёмкостях.");
  notes.push("Смола без твёрдой фазы (без утяжелителя) проникает в зазоры любой ширины — ограничение только вязкостью и давлением.");
  notes.push("Смола гидрофобна: перед закачкой — буфер с ПАВ / растворителем для удаления плёнки нефти и раствора со стенок канала.");
  return {
    kind: "resin", title: "Двухкомпонентный эпоксидный состав", system: `ЭД-20 + ${h.name.split(" — ")[0]}`,
    components, waterLPerM3: 0, densityGcm3: density,
    props: [
      { label: "Плотность, г/см³", value: density.toFixed(2), target: c.targetDensity > 0 ? `${c.targetDensity.toFixed(2)} ± 0,02` : "—" },
      { label: "Соотношение смола : отвердитель (по массе)", value: `100 : ${phr}` },
      { label: `Вязкость при ${c.bhctC.toFixed(0)} °C, мПа·с`, value: visc.toFixed(0), target: "≤ 300", ok: visc <= 300 },
      { label: "Вязкость при 25 °C, мПа·с", value: viscMix(dil, 25).toFixed(0) },
      { label: `Время жизни (гелеобразование) при ${c.bhctC.toFixed(0)} °C, мин`, value: tGel.toFixed(0), target: `≥ ${req.toFixed(0)}`, ok: tGel >= req },
      { label: `Отверждение при ${c.bhstC.toFixed(0)} °C, ч`, value: cureH.toFixed(0) },
      { label: "Прочность на сжатие после отверждения, МПа", value: `${ucs}`, target: "≥ 20", ok: true },
      { label: "Модуль упругости, ГПа / адгезия к стали, МПа", value: "2,5–3,5 / ≥ 10" },
      { label: "Твёрдая фаза", value: barite > 0 ? "барит d95 ≤ 20 мкм" : "нет — проникает в микрозазоры" },
    ],
    workLifeAtBhctMin: tGel, workLifeCurve, thickeningCurve, thickeningUnit: "мПа·с", strengthCurve,
    procedure: [
      "Подготовка: ёмкости сухие и чистые, без воды и цементных остатков; температура компонентов 15–30 °C.",
      `Смешать смолу (100 м.ч.) с активным разбавителем (${dil} м.ч.)${thix ? `, ввести аэросил и барит (${Math.round(barite)} м.ч.) при перемешивании` : ""}.`,
      `Отвердитель (${phr} м.ч.)${modifier ? " и модификатор" : ""} вводить непосредственно перед закачкой — порционно или на лету; перемешать 3–5 мин.`,
      "Перед смолой — буфер ПАВ / растворителя 0,2–0,3 м³; за смолой — разделительная пробка / буфер, затем продавка.",
      "Остатки смолы в ёмкостях не хранить (экзотермия). Работать в СИЗ: перчатки, очки, респиратор.",
    ],
    warnings, notes, penetrationUm: barite > 0 ? 60 : 0,
  };
}

export interface RirCompositionResult { primary: CompositionDesign; secondary?: CompositionDesign; split?: { primaryM3: number; secondaryM3: number } }

/** Состав(ы) под выбранный тип: для «смола + микроцемент» — смола в «голову» (~30% объёма задавливания) и микроцемент. */
export function designRirComposition(kind: "cement" | "microcement" | "resin" | "resin_micro", c: CompositionConditions, squeezeM3: number): RirCompositionResult | null {
  if (kind === "microcement") return { primary: designMicrocement(c) };
  if (kind === "resin") return { primary: designResin({ ...c, targetDensity: c.targetDensity > 0 && c.targetDensity < 1.3 ? c.targetDensity : 0 }) };
  if (kind === "resin_micro") {
    const head = Math.max(0.1, Math.min(0.5, squeezeM3 * 0.3));
    return {
      primary: designResin({ ...c, targetDensity: 0, volumeM3: head }),
      secondary: designMicrocement({ ...c, volumeM3: Math.max(0, c.volumeM3 - head) }),
      split: { primaryM3: head, secondaryM3: Math.max(0, c.volumeM3 - head) },
    };
  }
  return null; // обычный цемент — рецептура в модуле мостов/цементирования
}
