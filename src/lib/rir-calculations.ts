/**
 * Ремонтно-изоляционные работы (РИР): ликвидация негерметичности колонны и заколонных /
 * межколонных перетоков задавливанием состава через пакер-ретейнер (или пакер / с устья).
 *
 * Этап 1: диагностика по приёмистости → выбор типа состава, объёмы, окно допустимых давлений
 * (ГРП, прочность колонны и НКТ по API 5C3, перепад пакера), время работы, ход работ.
 */
import { interpolateTVD, pipeFrictionMPa, type TrajectoryPoint } from "./cementing-calculations";
import { bhctKutasovTarghi } from "./cement-program";

const G = 9.81;

// ═══════════════ Трубы: группы прочности и API 5C3 ═══════════════

/** Предел текучести, МПа (ГОСТ 632 / API 5CT). */
export const STEEL_GRADES: Record<string, number> = {
  "Д (J55/K55)": 379, "К": 490, "Е (N80/L80)": 552, "Л (C95)": 655, "М (P110)": 758, "Р (Q125)": 862,
};

const PSI = 0.00689476; // МПа в 1 psi

/** Внутреннее давление разрыва (Барлоу, API: 0,875 — допуск на стенку), МПа. */
export function burstMPa(odMm: number, wallMm: number, yieldMPa: number): number {
  return 0.875 * (2 * yieldMPa * wallMm) / odMm;
}

/** Сминающее давление по API 5C3 (текучесть / пластичность / переход / упругость), МПа. */
export function collapseMPa(odMm: number, wallMm: number, yieldMPa: number): { pMPa: number; regime: string } {
  const Yp = yieldMPa / PSI; // psi
  const A = 2.8762 + 0.10679e-5 * Yp + 0.21301e-10 * Yp ** 2 - 0.53132e-16 * Yp ** 3;
  const B = 0.026233 + 0.50609e-6 * Yp;
  const C = -465.93 + 0.030867 * Yp - 0.10483e-7 * Yp ** 2 + 0.36989e-13 * Yp ** 3;
  const ba = B / A;
  const t = (3 * ba) / (2 + ba);
  const F = (46.95e6 * Math.pow(t, 3)) / (Yp * (t - ba) * Math.pow(1 - t, 2));
  const Gc = (F * B) / A;
  const dt = odMm / wallMm;
  const dtYp = (Math.sqrt((A - 2) ** 2 + 8 * (B + C / Yp)) + (A - 2)) / (2 * (B + C / Yp));
  const dtPt = (Yp * (A - F)) / (C + Yp * (B - Gc));
  const dtTe = (2 + ba) / (3 * ba);
  let p: number, regime: string;
  if (dt <= dtYp) { p = 2 * Yp * ((dt - 1) / (dt * dt)); regime = "текучесть"; }
  else if (dt <= dtPt) { p = Yp * (A / dt - B) - C; regime = "пластичность"; }
  else if (dt <= dtTe) { p = Yp * (F / dt - Gc); regime = "переходная"; }
  else { p = 46.95e6 / (dt * (dt - 1) ** 2); regime = "упругость"; }
  return { pMPa: p * PSI, regime };
}

// ═══════════════ Входные данные ═══════════════

export type LeakKind = "casing_body" | "coupling" | "perforation" | "behind_casing" | "intercasing";
export const LEAK_KIND_LABEL: Record<LeakKind, string> = {
  casing_body: "Нарушение тела колонны (трещина, коррозия)",
  coupling: "Негерметичность муфтового соединения",
  perforation: "Интервал перфорации (отключение)",
  behind_casing: "Заколонный переток (канал в цементном камне)",
  intercasing: "Межколонное давление / переток",
};

export type ToolKind = "retainer" | "packer" | "bradenhead";
export const TOOL_LABEL: Record<ToolKind, string> = {
  retainer: "Пакер-ретейнер (разбуриваемый, с обратным клапаном)",
  packer: "Извлекаемый пакер",
  bradenhead: "Без пакера — задавливание с устья",
};

export type CompositionKind = "cement" | "microcement" | "resin" | "resin_micro";
export const COMPOSITION_LABEL: Record<CompositionKind, string> = {
  cement: "Тампонажный портландцемент (ПЦТ класса G)",
  microcement: "Микроцемент (тонкодисперсный, d95 ≤ 15 мкм)",
  resin: "Двухкомпонентная смола (без твёрдой фазы)",
  resin_micro: "Комбинация: смола в «голову» + микроцемент",
};

/** Эффективная вязкость состава в канале относительно воды (для расчёта расхода задавливания). */
export const MU_REL: Record<CompositionKind, number> = { cement: 40, microcement: 15, resin: 100, resin_micro: 100 };

/** Крупность частиц d95, мкм (для правила проходимости). */
export const D95_UM: Record<CompositionKind, number> = { cement: 90, microcement: 15, resin: 0, resin_micro: 15 };

export interface InjectivityPoint { rateM3h: number; surfacePressureMPa: number }

export interface RirInputs {
  wellDepthMD: number;
  trajectory: TrajectoryPoint[];
  surfaceTempC: number;
  bottomTempStaticC: number;
  /** Эксплуатационная колонна в интервале работ */
  casing: { odMm: number; wallMm: number; grade: string; cementTopMD: number };
  /** Внешняя (предыдущая) колонна — для межколонного пространства */
  outerCasing?: { odMm: number; wallMm: number; shoeMD: number };
  tubing: { odMm: number; wallMm: number; grade: string };
  leak: { topMD: number; bottomMD: number; kind: LeakKind; annulusPressureMPa: number };
  /** Пластовое давление / давление в зоне за колонной на глубине нарушения, МПа (0 — гидростатика воды) */
  zonePressureMPa: number;
  /** Градиент давления ГРП / поглощения, МПа/м */
  fracGradientMPaM: number;
  wellFluidDensity: number;
  injectivity: InjectivityPoint[];
  tool: { kind: ToolKind; setDepthMD: number; ratingMPa: number };
  composition: CompositionKind | "auto";
  /** Плотность состава, г/см³ (0 — типовая для выбранного состава) */
  compositionDensity: number;
  pumpRateLs: number;
  /** Противодавление в затрубье НКТ над пакером при задавливании, МПа */
  annulusBackPressureMPa: number;
  /** Коэффициенты запаса прочности (РФ: на внутреннее давление 1,15; смятие 1,0–1,3) */
  sfBurst: number;
  sfCollapse: number;
  /** Число ступеней задавливания и выдержка, мин */
  hesitationStages: number;
  hesitationHoldMin: number;
}

export const DEFAULT_RIR: RirInputs = {
  wellDepthMD: 2800, trajectory: [], surfaceTempC: 5, bottomTempStaticC: 85,
  casing: { odMm: 146.1, wallMm: 7.7, grade: "Е (N80/L80)", cementTopMD: 1200 },
  outerCasing: { odMm: 244.5, wallMm: 8.9, shoeMD: 600 },
  tubing: { odMm: 73, wallMm: 5.5, grade: "Е (N80/L80)" },
  leak: { topMD: 1850, bottomMD: 1855, kind: "casing_body", annulusPressureMPa: 0 },
  zonePressureMPa: 0, fracGradientMPaM: 0.019, wellFluidDensity: 1.1,
  injectivity: [{ rateM3h: 0.3, surfacePressureMPa: 6 }, { rateM3h: 0.6, surfacePressureMPa: 9 }, { rateM3h: 1.0, surfacePressureMPa: 12 }],
  tool: { kind: "retainer", setDepthMD: 1820, ratingMPa: 50 },
  composition: "auto", compositionDensity: 0, pumpRateLs: 2,
  annulusBackPressureMPa: 0, sfBurst: 1.15, sfCollapse: 1.0, hesitationStages: 5, hesitationHoldMin: 10,
};

// ═══════════════ Результаты ═══════════════

export interface InjectivityFit {
  /** Индекс приёмистости, м³/(ч·МПа) */
  J: number;
  /** Давление начала приёмистости на глубине нарушения, МПа */
  openingBhpMPa: number;
  points: { rateM3h: number; bhpMPa: number; surfaceMPa: number }[];
  r2: number;
}

export interface Constraint { name: string; atDepthMD: number; limitBhpMPa: number; limitSurfaceMPa: number; note: string }

export interface PressureProfilePoint { md: number; tvd: number; hydroMPa: number; fracMPa: number; burstLimitMPa: number; squeezeMaxMPa: number }

export interface WorkStep { title: string; text: string; volumeM3?: number; timeMin?: number }

export interface HesitationPoint { timeMin: number; volumeM3: number; surfaceMPa: number; stage: string }

export interface RirResult {
  leakTVD: number;
  toolTVD: number;
  casingID: number;
  tubingID: number;
  temps: { bhstC: number; bhctC: number };
  fit: InjectivityFit | null;
  /** Эквивалентное раскрытие канала, мкм (оценка) */
  apertureUm: number | null;
  apertureNote: string;
  composition: CompositionKind;
  compositionDensity: number;
  compositionReason: string[];
  penetration: { kind: CompositionKind; d95: number; passes: boolean }[];
  casingBurstMPa: number;
  casingCollapse: { pMPa: number; regime: string };
  tubingBurstMPa: number;
  tubingCollapse: { pMPa: number; regime: string };
  constraints: Constraint[];
  /** Допустимое давление задавливания на глубине нарушения и на устье, МПа */
  maxBhpMPa: number;
  maxSurfaceMPa: number;
  /** Допустимое на устье при НКТ, заполненных водой (приёмистость, продавка), МПа */
  maxSurfaceWaterMPa: number;
  governing: string;
  /** Расход задавливания при допустимом давлении, м³/ч */
  squeezeRateAtMaxM3h: number;
  /** Расход задавливания составом при допустимом давлении, м³/ч */
  compositionRateAtMaxM3h: number;
  volumes: { tubingM3: number; belowToolM3: number; squeezeM3: number; reserveM3: number; totalM3: number; displacementM3: number; reverseOutM3: number };
  timing: { pumpMin: number; displaceMin: number; hesitationMin: number; reverseMin: number; jobMin: number; requiredWorkLifeMin: number };
  profile: PressureProfilePoint[];
  hesitation: HesitationPoint[];
  workProgram: WorkStep[];
  warnings: string[];
}

const area = (dMm: number) => (Math.PI / 4) * (dMm / 1000) ** 2;

export function calculateRir(inp: RirInputs): RirResult {
  const warnings: string[] = [];
  const traj = inp.trajectory.length > 1 ? inp.trajectory : [{ md: 0, tvd: 0, zenith: 0, azimuth: 0 }, { md: inp.wellDepthMD, tvd: inp.wellDepthMD, zenith: 0, azimuth: 0 }];
  const tvd = (md: number) => interpolateTVD(Math.max(0, Math.min(inp.wellDepthMD, md)), traj);
  const leakMid = (inp.leak.topMD + inp.leak.bottomMD) / 2;
  const leakTVD = tvd(leakMid);
  const toolDepth = inp.tool.kind === "bradenhead" ? 0 : inp.tool.setDepthMD;
  const toolTVD = tvd(toolDepth);
  const casingID = inp.casing.odMm - 2 * inp.casing.wallMm;
  const tubingID = inp.tubing.odMm - 2 * inp.tubing.wallMm;
  const tdTVD = tvd(inp.wellDepthMD);
  const bhst = inp.surfaceTempC + ((inp.bottomTempStaticC - inp.surfaceTempC) * leakTVD) / Math.max(1, tdTVD);
  const bhct = bhctKutasovTarghi(bhst, inp.surfaceTempC, leakTVD).bhctC;
  const rhoW = inp.wellFluidDensity;

  if (inp.tool.kind !== "bradenhead" && inp.tool.setDepthMD >= inp.leak.topMD) warnings.push("Пакер/ретейнер должен стоять выше кровли интервала нарушения (обычно на 10–30 м).");
  if (inp.tool.kind !== "bradenhead" && inp.leak.topMD - inp.tool.setDepthMD > 50) warnings.push(`Пакер на ${(inp.leak.topMD - inp.tool.setDepthMD).toFixed(0)} м выше нарушения — под ним большой объём состава, который придётся разбуривать.`);

  // ── Приёмистость: забойное давление = устьевое + гидростатика − трение в НКТ ──
  let fit: InjectivityFit | null = null;
  const pts = inp.injectivity.filter((p) => p.rateM3h > 0 && p.surfacePressureMPa >= 0);
  const zoneP = inp.zonePressureMPa > 0 ? inp.zonePressureMPa : 1.0 * G * leakTVD / 1000;
  if (pts.length) {
    const conv = pts.map((p) => {
      const fr = toolDepth > 0 ? pipeFrictionMPa(p.rateM3h / 3.6, toolDepth, tubingID, 1, 0, rhoW * 1000).pressureMPa : 0;
      return { rateM3h: p.rateM3h, surfaceMPa: p.surfacePressureMPa, bhpMPa: p.surfacePressureMPa + rhoW * G * leakTVD / 1000 - fr };
    });
    if (conv.length === 1) {
      const dp = Math.max(0.1, conv[0].bhpMPa - zoneP);
      fit = { J: conv[0].rateM3h / dp, openingBhpMPa: zoneP, points: conv, r2: 1 };
    } else {
      const n = conv.length, mx = conv.reduce((t, c) => t + c.bhpMPa, 0) / n, my = conv.reduce((t, c) => t + c.rateM3h, 0) / n;
      const sxy = conv.reduce((t, c) => t + (c.bhpMPa - mx) * (c.rateM3h - my), 0), sxx = conv.reduce((t, c) => t + (c.bhpMPa - mx) ** 2, 0);
      const J = sxx > 0 ? Math.max(1e-4, sxy / sxx) : conv[0].rateM3h / Math.max(0.1, conv[0].bhpMPa - zoneP);
      const p0 = mx - my / J;
      const ssr = conv.reduce((t, c) => t + (c.rateM3h - J * (c.bhpMPa - p0)) ** 2, 0), sst = conv.reduce((t, c) => t + (c.rateM3h - my) ** 2, 0);
      fit = { J, openingBhpMPa: p0, points: conv, r2: sst > 0 ? 1 - ssr / sst : 1 };
    }
  } else warnings.push("Нет данных о приёмистости — выбор состава и объём задавливания по умолчанию; приёмистость обязательно определить перед закачкой.");

  // ── Эквивалентное раскрытие канала (кубический закон, вода 1 мПа·с) ──
  // Q = w³·H·ΔP / (12·μ·Lf): H — ширина канала по фронту, Lf — длина пути через камень/стенку
  let apertureUm: number | null = null;
  let apertureNote = "";
  const Lf = inp.leak.kind === "coupling" || inp.leak.kind === "casing_body" ? 0.3 : 1.0;
  // фронт канала: муфта — по окружности; дефект тела — ~0,1 м (коррозионное отверстие / трещина);
  // канал за колонной — четверть окружности
  const H = inp.leak.kind === "coupling" ? Math.PI * inp.casing.odMm / 1000 : inp.leak.kind === "casing_body" ? 0.1 : Math.PI * inp.casing.odMm / 1000 * 0.25;
  if (fit && inp.leak.kind !== "perforation") {
    const dp = Math.max(0.5, 5); // при перепаде 5 МПа над давлением открытия
    const Q = (fit.J * dp) / 3600; // м³/с
    const w = Math.cbrt((12 * 1e-3 * Lf * Q) / (H * dp * 1e6));
    apertureUm = w * 1e6;
    apertureNote = `Кубический закон фильтрации в щели: фронт канала ${H.toFixed(2)} м, путь ${Lf} м, вода; приёмистость при перепаде 5 МПа ${(fit.J * dp).toFixed(2)} м³/ч.`;
  } else if (inp.leak.kind === "perforation") {
    apertureNote = "Интервал перфорации: состав идёт в пласт через отверстия — выбор по приёмистости, не по раскрытию.";
  }

  // ── Выбор состава ──
  const reason: string[] = [];
  let comp: CompositionKind;
  const qAt5 = fit ? fit.J * 5 : null;
  if (inp.composition !== "auto") { comp = inp.composition; reason.push("Состав выбран технологом."); }
  else if (!fit) { comp = "microcement"; reason.push("Приёмистость не задана — по умолчанию микроцемент (универсален для узких каналов)."); }
  else if (inp.leak.kind === "perforation") {
    comp = qAt5! >= 1.5 ? "cement" : qAt5! >= 0.2 ? "microcement" : "resin";
    reason.push(`Перфорация: приёмистость ${qAt5!.toFixed(2)} м³/ч при перепаде 5 МПа → ${comp === "cement" ? "цемент проходит в перфорационные каналы" : comp === "microcement" ? "низкая приёмистость — нужен микроцемент" : "очень низкая приёмистость — только смола без твёрдой фазы"}.`);
  } else {
    const w = apertureUm!;
    if (w >= 3 * D95_UM.cement) { comp = "cement"; reason.push(`Раскрытие ~${w.toFixed(0)} мкм ≥ 3·d95 цемента (${3 * D95_UM.cement} мкм) — проходит обычный цемент.`); }
    else if (w >= 3 * D95_UM.microcement) { comp = "microcement"; reason.push(`Раскрытие ~${w.toFixed(0)} мкм: цемент не войдёт (нужно ≥ ${3 * D95_UM.cement} мкм), микроцемент проходит (≥ ${3 * D95_UM.microcement} мкм).`); }
    else { comp = "resin"; reason.push(`Раскрытие ~${w.toFixed(0)} мкм меньше ${3 * D95_UM.microcement} мкм — частицы не пройдут, нужна смола без твёрдой фазы.`); }
    if (inp.leak.kind === "intercasing" && inp.leak.annulusPressureMPa > 0 && comp !== "cement") {
      comp = "resin_micro"; reason.push("Межколонное давление: смола в «голову» для герметизации микрозазоров, затем микроцемент для объёма.");
    }
  }
  const penetration = (["cement", "microcement", "resin"] as CompositionKind[]).map((k) => ({ kind: k, d95: D95_UM[k], passes: apertureUm === null ? k !== "cement" || (qAt5 ?? 0) >= 1.5 : k === "resin" || apertureUm >= 3 * D95_UM[k] }));

  // ── Прочность труб ──
  const yc = STEEL_GRADES[inp.casing.grade] ?? 552, yt = STEEL_GRADES[inp.tubing.grade] ?? 552;
  const casingBurst = burstMPa(inp.casing.odMm, inp.casing.wallMm, yc);
  const casingCollapse = collapseMPa(inp.casing.odMm, inp.casing.wallMm, yc);
  const tubingBurst = burstMPa(inp.tubing.odMm, inp.tubing.wallMm, yt);
  const tubingCollapse = collapseMPa(inp.tubing.odMm, inp.tubing.wallMm, yt);

  // ── Окно давлений (на глубине нарушения → на устье при составе в НКТ) ──
  const TYPICAL_RHO: Record<CompositionKind, number> = { cement: 1.85, microcement: 1.55, resin: 1.1, resin_micro: 1.45 };
  const rhoC = inp.compositionDensity > 0 ? inp.compositionDensity : TYPICAL_RHO[comp];
  const hydroComp = rhoC * G * leakTVD / 1000;
  const fracAtLeak = inp.fracGradientMPaM * leakTVD;
  const extAtLeak = Math.max(zoneP, 1.0 * G * leakTVD / 1000); // давление за колонной
  const constraints: Constraint[] = [];
  const toSurf = (bhp: number) => bhp - hydroComp; // без трения (на выдержке)
  constraints.push({ name: "ГРП / поглощение в интервале (95%)", atDepthMD: leakMid, limitBhpMPa: 0.95 * fracAtLeak, limitSurfaceMPa: toSurf(0.95 * fracAtLeak), note: `ГРП ${fracAtLeak.toFixed(1)} МПа` });
  // Колонна под пакером (интервал пакер—нарушение): внутреннее давление ≤ разрыв/Кз + внешнее
  const burstLimitLeak = casingBurst / inp.sfBurst + extAtLeak;
  constraints.push({ name: `Разрыв колонны ${inp.casing.odMm}×${inp.casing.wallMm} (Кз ${inp.sfBurst})`, atDepthMD: leakMid, limitBhpMPa: burstLimitLeak, limitSurfaceMPa: toSurf(burstLimitLeak), note: `Pразр ${casingBurst.toFixed(1)} МПа + внешнее ${extAtLeak.toFixed(1)}` });
  if (inp.tool.kind === "bradenhead") {
    // Вся колонна от устья под давлением: ограничение на устье — по разрыву у устья (внешнее ≈ 0)
    const lim = casingBurst / inp.sfBurst;
    constraints.push({ name: "Разрыв колонны у устья (вся колонна под давлением)", atDepthMD: 0, limitBhpMPa: lim + hydroComp, limitSurfaceMPa: lim, note: "без пакера давление передаётся на всю колонну" });
  } else {
    // Перепад на пакере: под пакером Pбз(на глубине пакера) − над пакером (жидкость + противодавление)
    const above = rhoW * G * toolTVD / 1000 + inp.annulusBackPressureMPa;
    const limPk = inp.tool.ratingMPa + above + rhoC * G * (leakTVD - toolTVD) / 1000;
    constraints.push({ name: `Перепад на ${inp.tool.kind === "retainer" ? "ретейнере" : "пакере"} (${inp.tool.ratingMPa} МПа)`, atDepthMD: inp.tool.setDepthMD, limitBhpMPa: limPk, limitSurfaceMPa: toSurf(limPk), note: `над пакером ${above.toFixed(1)} МПа${inp.annulusBackPressureMPa > 0 ? " (с противодавлением)" : ""}` });
    // НКТ: внутреннее давление у устья ≤ разрыв/Кз (+ противодавление в затрубье)
    const limT = tubingBurst / inp.sfBurst + inp.annulusBackPressureMPa;
    constraints.push({ name: `Разрыв НКТ ${inp.tubing.odMm}×${inp.tubing.wallMm} у устья`, atDepthMD: 0, limitBhpMPa: limT + hydroComp, limitSurfaceMPa: limT, note: `Pразр ${tubingBurst.toFixed(1)} МПа` });
    // Колонна над пакером при противодавлении: разрыв у устья
    if (inp.annulusBackPressureMPa > casingBurst / inp.sfBurst) warnings.push("Противодавление в затрубье превышает допустимое для колонны у устья.");
    // Смятие НКТ противодавлением
    if (inp.annulusBackPressureMPa > tubingCollapse.pMPa / inp.sfCollapse) warnings.push("Противодавление в затрубье опасно по смятию НКТ при сбросе давления в НКТ.");
  }
  const gov = constraints.reduce((m, c) => (c.limitBhpMPa < m.limitBhpMPa ? c : m), constraints[0]);
  const maxBhp = gov.limitBhpMPa;
  const maxSurf = Math.max(0, toSurf(maxBhp));
  if (hydroComp >= maxBhp) warnings.push(`Гидростатика столба состава ${rhoC.toFixed(2)} г/см³ (${hydroComp.toFixed(1)} МПа) уже не меньше допустимого давления на глубине нарушения (${maxBhp.toFixed(1)} МПа) — снизьте плотность состава или закачивайте под пакер с минимальным столбом.`);
  if (fit && maxBhp <= fit.openingBhpMPa) warnings.push(`Допустимое давление (${maxBhp.toFixed(1)} МПа) ниже давления начала приёмистости (${fit.openingBhpMPa.toFixed(1)} МПа) — задавить состав в окне давлений нельзя. Рассмотрите смолу (вязкость близка к воде), снижение плотности состава или противодавление над пакером.`);
  const maxSurfW = Math.max(0, Math.min(maxBhp - 1.0 * G * leakTVD / 1000, ...constraints.filter((c) => c.atDepthMD === 0).map((c) => c.limitSurfaceMPa)));
  const qMax = fit ? Math.max(0, fit.J * (maxBhp - fit.openingBhpMPa)) : 0;
  // Смятие колонны ниже пакера после работ (снижение уровня / освоение): справочно
  const collapseMargin = casingCollapse.pMPa / inp.sfCollapse;
  if (extAtLeak > collapseMargin) warnings.push(`Внешнее давление ${extAtLeak.toFixed(1)} МПа больше допустимого по смятию колонны ${collapseMargin.toFixed(1)} МПа при опорожнении.`);

  // ── Объёмы ──
  const tubingM3 = toolDepth > 0 ? area(tubingID) * toolDepth : 0;
  const belowFrom = inp.tool.kind === "bradenhead" ? Math.max(0, inp.leak.topMD - 50) : inp.tool.setDepthMD;
  const belowToolM3 = area(casingID) * Math.max(0, inp.leak.bottomMD + 5 - belowFrom);
  // Объём задавливания — по расходу САМОГО состава при допустимом давлении (вязкость выше воды в μ раз)
  const caps: Record<CompositionKind, [number, number]> = { cement: [0.2, 3], microcement: [0.05, 2], resin: [0.02, 0.6], resin_micro: [0.05, 1.5] };
  const [vMin, vMax] = caps[comp];
  const qComp = qMax / MU_REL[comp]; // м³/ч
  const squeezeM3 = Math.min(vMax, Math.max(vMin, qComp * 1.0)); // ~1 ч задавливания составом на допустимом давлении
  if (fit && qComp > 0 && vMin / qComp > 2) warnings.push(`Канал плотный для выбранного состава: при допустимом давлении состав пойдёт с расходом ~${(qComp * 1000).toFixed(0)} л/ч — даже минимальный объём ${vMin} м³ займёт ${(vMin / qComp).toFixed(1)} ч. Нужен состав меньшей вязкости (смола ≤ 100 мПа·с) или больше окно давлений.`);
  const reserveM3 = comp === "resin" ? 0.05 : 0.2;
  if ((comp === "resin" || comp === "resin_micro") && belowToolM3 > 0.2) warnings.push(`Под инструментом ${belowToolM3.toFixed(2)} м³ — для смолы дорого: установите ретейнер ближе к нарушению (5–10 м) или заполните колонну ниже нарушения песчаной/вязкой пачкой.`);
  const totalM3 = belowToolM3 + squeezeM3 + reserveM3;
  // Продавка: состав доводится до ретейнера, в НКТ остаётся объём на ступенчатое задавливание
  const displacementM3 = Math.max(0, tubingM3 - squeezeM3);
  const reverseOutM3 = tubingM3 * 1.5;

  // ── Время ──
  const q = Math.max(0.3, inp.pumpRateLs);
  const pumpMin = (totalM3 * 1000) / q / 60;
  const displaceMin = (displacementM3 * 1000) / q / 60;
  const hesitationMin = inp.hesitationStages * (inp.hesitationHoldMin + 3);
  const reverseMin = (reverseOutM3 * 1000) / Math.max(q, 4) / 60;
  const jobMin = pumpMin + displaceMin + hesitationMin + 15; // + стыковка/расстыковка
  const requiredWorkLifeMin = Math.ceil(Math.max(jobMin / 0.75, jobMin + 30));

  // ── Профиль давлений по глубине ──
  const profile: PressureProfilePoint[] = [];
  const zEnd = Math.max(inp.leak.bottomMD + 50, inp.tool.setDepthMD);
  for (let k = 0; k <= 40; k++) {
    const md = (zEnd * k) / 40, t = tvd(md);
    const ext = Math.max(1.0 * G * t / 1000, 0);
    const insideAtMax = md >= belowFrom ? maxBhp - rhoC * G * (leakTVD - t) / 1000 : maxSurf + rhoC * G * t / 1000;
    profile.push({ md, tvd: t, hydroMPa: rhoW * G * t / 1000, fracMPa: inp.fracGradientMPaM * t, burstLimitMPa: casingBurst / inp.sfBurst + ext, squeezeMaxMPa: Math.max(0, insideAtMax) });
  }

  // ── Плановая ступенчатая закачка (схема) ──
  const hes: HesitationPoint[] = [];
  let tNow = 0, vNow = 0;
  const p0s = fit ? Math.max(0, fit.openingBhpMPa - hydroComp) : maxSurf * 0.4;
  hes.push({ timeMin: 0, volumeM3: 0, surfaceMPa: 0, stage: "Начало" });
  const perStage = squeezeM3 / Math.max(1, inp.hesitationStages);
  for (let i = 1; i <= inp.hesitationStages; i++) {
    const pTarget = p0s + (maxSurf * 0.9 - p0s) * Math.pow(i / inp.hesitationStages, 0.8);
    const tInj = (perStage * 1000) / Math.max(0.2, q * 0.5) / 60;
    tNow += tInj; vNow += perStage;
    hes.push({ timeMin: tNow, volumeM3: vNow, surfaceMPa: Math.min(maxSurf, pTarget), stage: `Ступень ${i}` });
    tNow += inp.hesitationHoldMin;
    hes.push({ timeMin: tNow, volumeM3: vNow, surfaceMPa: Math.min(maxSurf, pTarget) * (i === inp.hesitationStages ? 1 : 0.85), stage: `Выдержка ${i}` });
  }

  // ── Ход работ ──
  const f1 = (v: number, d = 1) => v.toFixed(d);
  const toolName = inp.tool.kind === "retainer" ? "пакер-ретейнер" : inp.tool.kind === "packer" ? "пакер" : "";
  const W: WorkStep[] = [];
  W.push({ title: "Подготовка", text: `Глушение скважины раствором ${f1(rhoW, 2)} г/см³. Шаблонирование колонны ${inp.casing.odMm} мм до ${f1(inp.leak.bottomMD + 20, 0)} м, отбивка забоя. Проверка исправности ПВО.` });
  W.push({ title: "Уточнение интервала негерметичности", text: `Поинтервальная опрессовка извлекаемым пакером (или геофизика: термометрия, расходометрия, акустика) — подтвердить интервал ${f1(inp.leak.topMD, 0)}–${f1(inp.leak.bottomMD, 0)} м.` });
  if (inp.tool.kind !== "bradenhead") {
    W.push({ title: `Спуск и установка: ${toolName}`, text: `Спуск ${toolName}а на НКТ ${inp.tubing.odMm}×${inp.tubing.wallMm} мм до ${f1(inp.tool.setDepthMD, 0)} м, посадка по инструкции производителя, опрессовка НКТ на ${f1(Math.min(tubingBurst / inp.sfBurst, Math.max(maxSurf * 1.25, maxSurf + 3)), 1)} МПа (выше планового давления задавливания).` });
  }
  W.push({ title: "Определение приёмистости", text: `Закачка технической воды на 2–3 режимах (расход / давление). ${fit ? `Расчётный индекс приёмистости ${f1(fit.J, 2)} м³/(ч·МПа), давление начала приёмистости на глубине нарушения ${f1(fit.openingBhpMPa, 1)} МПа.` : ""} Допустимое давление на устье при закачке воды — не более ${f1(maxSurfW, 1)} МПа (ограничение: ${gov.name}).` });
  W.push({ title: "Приготовление состава", text: `${COMPOSITION_LABEL[comp]}, плотность ${f1(rhoC, 2)} г/см³, объём ${f1(totalM3, 2)} м³ (под ${toolName || "интервал"} ${f1(belowToolM3, 2)}, задавливание ${f1(squeezeM3, 2)}, запас ${f1(reserveM3, 2)}). Время жизни / загустевания при ${f1(bhct, 0)} °C — не менее ${requiredWorkLifeMin} мин.`, volumeM3: totalM3 });
  if (inp.tool.kind === "packer") W.push({ title: "Закачка и доводка состава до нарушения", text: `Пакер не посажен (циркуляция через низ НКТ в затрубье): буфер (техническая вода 0,5 м³), состав ${f1(totalM3, 2)} м³ при ${f1(q, 1)} л/с, продавка до выхода состава под глубину установки пакера и до подошвы нарушения. Посадить пакер, закрыть затрубье — в НКТ над пакером остаётся состав на ступенчатое задавливание.`, volumeM3: totalM3, timeMin: pumpMin + displaceMin });
  else W.push({ title: "Закачка и продавка", text: `Буфер (техническая вода 0,5 м³), состав ${f1(totalM3, 2)} м³ при ${f1(q, 1)} л/с, продавка ${f1(displacementM3, 2)} м³${inp.tool.kind === "retainer" ? " (стыковочный узел в ретейнере)" : ""} — в НКТ над ${toolName || "интервалом"} остаётся ${f1(squeezeM3, 2)} м³ состава на ступенчатое задавливание.`, volumeM3: displacementM3, timeMin: pumpMin + displaceMin });
  W.push({ title: "Ступенчатое задавливание", text: `${inp.hesitationStages} ступеней по ~${f1(perStage, 2)} м³ с выдержкой ${inp.hesitationHoldMin} мин; давление на устье не выше допустимого по столбу в НКТ: ${f1(maxSurf, 1)} МПа при НКТ, заполненных составом, до ${f1(maxSurfW, 1)} МПа при продавочной воде в НКТ (по забою ${f1(maxBhp, 1)} МПа). Критерий окончания: давление держится на выдержке (падение ≤ 10%).`, timeMin: hesitationMin });
  if (inp.tool.kind === "retainer") W.push({ title: "Расстыковка и обратная промывка", text: `Снять стыковочный узел с ретейнера (обратный клапан закрывается), приподнять на 5–10 м, обратная промывка ${f1(reverseOutM3, 2)} м³ для вымыва излишков состава из НКТ.`, volumeM3: reverseOutM3, timeMin: reverseMin });
  else if (inp.tool.kind === "packer") W.push({ title: "Срыв пакера и промывка", text: `Сорвать пакер, поднять на 20–30 м выше кровли состава, обратная промывка ${f1(reverseOutM3, 2)} м³.`, volumeM3: reverseOutM3 });
  W.push({ title: comp === "resin" ? "Отверждение смолы" : "ОЗЦ", text: comp === "resin" ? `Выдержка на отверждение при ${f1(bhst, 0)} °C по паспорту состава (обычно 12–24 ч).` : `ОЗЦ при ${f1(bhst, 0)} °C — по лабораторной кривой прочности (обычно 24–48 ч).` });
  if (inp.tool.kind === "retainer") W.push({ title: "Разбуривание", text: `Разбуривание ретейнера и состава до ${f1(inp.leak.bottomMD + 5, 0)} м долотом / фрезой с промывкой.` });
  W.push({ title: "Опрессовка и приёмка", text: `Опрессовка колонны в интервале работ давлением по плану испытаний (не выше допустимого по колонне ${f1(casingBurst / inp.sfBurst, 1)} МПа на устье). Колонна герметична, если за 30 мин падение давления не превышает 0,5 МПа. Геофизический контроль (термометрия / АКЦ) при необходимости.` });

  return {
    leakTVD, toolTVD, casingID, tubingID, temps: { bhstC: bhst, bhctC: bhct }, fit, apertureUm, apertureNote, compositionDensity: rhoC,
    composition: comp, compositionReason: reason, penetration,
    casingBurstMPa: casingBurst, casingCollapse, tubingBurstMPa: tubingBurst, tubingCollapse,
    constraints, maxBhpMPa: maxBhp, maxSurfaceMPa: maxSurf, maxSurfaceWaterMPa: maxSurfW, governing: gov.name, squeezeRateAtMaxM3h: qMax, compositionRateAtMaxM3h: qComp,
    volumes: { tubingM3, belowToolM3, squeezeM3, reserveM3, totalM3, displacementM3, reverseOutM3 },
    timing: { pumpMin, displaceMin, hesitationMin, reverseMin, jobMin, requiredWorkLifeMin },
    profile, hesitation: hes, workProgram: W, warnings,
  };
}
