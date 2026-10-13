/**
 * Полная программа РИР для Word: исходные данные, обоснование технологии, окно давлений,
 * расчёт НКТ, рецептура, моделирование, регламент закачки, оборудование и материалы,
 * ход работ, действия при осложнениях, критерии приёмки, требования безопасности.
 */
import type { LabProtocol, ProtocolImage, ProtocolSection } from "./lab-protocol";
import { COMPOSITION_LABEL, LEAK_KIND_LABEL, TOOL_LABEL, type RirInputs, type RirResult, type WorkStep } from "./rir-calculations";
import type { RirCompositionResult } from "./rir-compositions";
import type { TubingMechResult } from "./rir-tubing";
import type { SqueezeSimResult } from "./rir-squeeze-sim";
import { recipeSection } from "./rir-protocol";

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace(".", ",") : "—");

export interface RirProgramImages {
  schematic?: ProtocolImage;
  window?: ProtocolImage;
  injectivity?: ProtocolImage;
  sim?: ProtocolImage;
  tubing?: ProtocolImage;
}

/** Регламент закачки по этапам моделирования: объём, расход, давление. */
export function stageRegime(sim: SqueezeSimResult) {
  return sim.stages.map((s) => {
    const pts = sim.points.filter((p) => p.t > s.t0 - 1e-9 && p.t <= s.t1 + 1e-9);
    const first = sim.points.filter((p) => p.t <= s.t0 + 1e-9).pop() ?? pts[0];
    const last = pts[pts.length - 1] ?? first;
    const vol = last && first ? last.vPumped - first.vPumped : 0;
    const qs = pts.filter((p) => p.qLs > 0).map((p) => p.qLs);
    return {
      name: s.name, kind: s.kind, t0: s.t0, t1: s.t1, volM3: Math.max(0, vol),
      qAvg: qs.length ? qs.reduce((a, b) => a + b, 0) / qs.length : 0,
      pMax: pts.length ? Math.max(...pts.map((p) => p.surfaceMPa)) : 0,
      pEnd: last?.surfaceMPa ?? 0,
      allow: pts.length ? Math.min(...pts.map((p) => p.allowSurfaceMPa)) : 0,
    };
  });
}

function ozcHours(comp: RirCompositionResult | null): { hours: number; text: string } {
  const d = comp?.secondary ?? comp?.primary;
  if (!d) return { hours: 24, text: "ОЗЦ не менее 24 ч (тампонажный цемент; уточнить по лабораторной кривой прочности)." };
  const need = d.kind === "resin" ? 10 : 3.5;
  const pt = d.strengthCurve.find((p) => p.y >= need);
  const base = pt ? pt.x : 24;
  const h = Math.max(d.kind === "resin" ? 12 : 24, Math.ceil(base * 1.5));
  return { hours: h, text: `ОЗЦ / отверждение не менее ${h} ч: прочность ${need} МПа по прогнозу через ~${f(base, 0)} ч при BHST, коэффициент 1,5.` };
}

export function buildRirProgram(inp: RirInputs, res: RirResult, comp: RirCompositionResult | null, mech: TubingMechResult | null,
  work: WorkStep[], sim: SqueezeSimResult, requiredWorkLifeMin: number, images: RirProgramImages = {}): LabProtocol {
  const now = new Date(), date = now.toLocaleDateString("ru-RU");
  const S: ProtocolSection[] = [];
  let n = 1;
  const hasTool = inp.tool.kind !== "bradenhead";
  const toolName = inp.tool.kind === "retainer" ? "пакер-ретейнер" : inp.tool.kind === "packer" ? "извлекаемый пакер" : "—";

  S.push({
    id: "goal", title: `${n++}. Цель работ и основание`,
    paragraphs: [
      `Цель: ликвидация негерметичности — ${LEAK_KIND_LABEL[inp.leak.kind].toLowerCase()} в интервале ${f(inp.leak.topMD, 0)}–${f(inp.leak.bottomMD, 0)} м задавливанием изолирующего состава (${COMPOSITION_LABEL[res.composition]}) ${hasTool ? `через ${toolName} на глубине ${f(inp.tool.setDepthMD, 0)} м` : "с устья"}.`,
      `Ожидаемый результат по расчёту: ${sim.outcomeText}`,
    ],
  });
  S.push({
    id: "well", title: `${n++}. Исходные данные`,
    tables: [{ id: "well-t", headers: ["Параметр", "Значение"], widths: [50, 50], rows: [
      ["Глубина скважины (по стволу), м", f(inp.wellDepthMD, 0)],
      ["Эксплуатационная колонна", `${inp.casing.odMm}×${inp.casing.wallMm} мм, гр. прочности ${inp.casing.grade}; ВПЦ ${f(inp.casing.cementTopMD, 0)} м`],
      ...(inp.outerCasing ? [["Предыдущая колонна", `${inp.outerCasing.odMm}×${inp.outerCasing.wallMm} мм, башмак ${f(inp.outerCasing.shoeMD, 0)} м`]] : []),
      ["НКТ", `${inp.tubing.odMm}×${inp.tubing.wallMm} мм, ${inp.tubing.grade}`],
      ["Нарушение", `${LEAK_KIND_LABEL[inp.leak.kind]}, ${f(inp.leak.topMD, 0)}–${f(inp.leak.bottomMD, 0)} м (TVD ${f(res.leakTVD, 0)} м)${inp.leak.annulusPressureMPa > 0 ? `; межколонное давление ${f(inp.leak.annulusPressureMPa, 1)} МПа` : ""}`],
      ["Жидкость в скважине, г/см³", f(inp.wellFluidDensity, 2)],
      ["Температура статическая / циркуляционная в интервале, °C", `${f(res.temps.bhstC, 0)} / ${f(res.temps.bhctC, 0)}`],
      ["Градиент ГРП, МПа/м", f(inp.fracGradientMPaM, 4)],
      ["Прочность колонны: разрыв / смятие (API 5C3), МПа", `${f(res.casingBurstMPa, 1)} / ${f(res.casingCollapse.pMPa, 1)}`],
      ["Прочность НКТ: разрыв / смятие, МПа", `${f(res.tubingBurstMPa, 1)} / ${f(res.tubingCollapse.pMPa, 1)}`],
    ] }],
    images: images.schematic ? [images.schematic] : undefined,
  });
  S.push({
    id: "diag", title: `${n++}. Диагностика и выбор состава`,
    paragraphs: [
      res.fit ? `Приёмистость: J = ${f(res.fit.J, 2)} м³/(ч·МПа), давление начала приёмистости на глубине нарушения ${f(res.fit.openingBhpMPa, 1)} МПа.` : "Приёмистость не определена — определить перед работами.",
      res.apertureUm !== null ? `Эквивалентное раскрытие канала (кубический закон течения в щели): ~${f(res.apertureUm, 0)} мкм. Правило проходимости: раскрытие ≥ 3·d95 частиц состава.` : "",
      `Выбран состав: ${COMPOSITION_LABEL[res.composition]}. ${res.compositionReason.join(" ")}`,
    ].filter(Boolean),
    tables: res.fit ? [{ id: "inj", headers: ["Режим", "Расход, м³/ч", "Давление на устье, МПа", "Давление на глубине нарушения, МПа"], widths: [16, 24, 30, 30],
      rows: res.fit.points.map((p, i) => [String(i + 1), f(p.rateM3h, 2), f(p.surfaceMPa, 1), f(p.bhpMPa, 1)]) }] : undefined,
    images: images.injectivity ? [images.injectivity] : undefined,
  });
  S.push({
    id: "window", title: `${n++}. Окно давлений`,
    tables: [{ id: "win", headers: ["Ограничение", "На глубине нарушения, МПа", "На устье, МПа"], widths: [56, 22, 22],
      rows: res.constraints.map((c) => [`${c.name}${c.name === res.governing ? " — определяющее" : ""}`, f(c.limitBhpMPa, 1), f(Math.max(0, c.limitSurfaceMPa), 1)]) }],
    paragraphs: [`Допустимое давление задавливания: ${f(res.maxSurfaceMPa, 1)} МПа на устье при НКТ, заполненных составом (${f(res.maxBhpMPa, 1)} МПа на глубине нарушения). При продавке водой допустимое давление на устье выше на разность гидростатик — контролировать по графику моделирования.`],
    images: images.window ? [images.window] : undefined,
  });
  if (mech) S.push({
    id: "tubing", title: `${n++}. Расчёт НКТ при задавливании (метод Лубинского)`,
    tables: [{ id: "mech", headers: ["Показатель", "Значение"], widths: [60, 40], rows: [
      ["Изменение длины НКТ (поршневой эффект, изгиб, баллонинг, температура), мм", f(mech.totalDLmm, 0)],
      ["Вес на крюке: до / при задавливании, кН", `${f(mech.hookLoad.initialKN, 0)} / ${f(mech.hookLoad.squeezeKN, 0)}`],
      ["Спиральный изгиб", mech.buckling.buckled ? `да, нейтральная точка ${f(mech.buckling.neutralPointM, 0)} м над пакером` : "нет"],
      ["Минимальный запас по Мизесу (допустимый)", `${f(mech.vme.minSF, 2)} (${f(mech.vme.allowSF, 2)})`],
      ["Необходимая разгрузка на ретейнер, кН", mech.setDownNeededKN !== null ? f(mech.setDownNeededKN, 0) : "не требуется"],
      ["Противодавление в затрубье, МПа", mech.backPressureNeededMPa !== null ? f(mech.backPressureNeededMPa, 1) : "не требуется"],
      ["Усилие на пакер, кН", f(mech.packerForceKN, 0)],
    ] }],
    bullets: [...mech.conclusions, ...mech.warnings.map((w) => `⚠ ${w}`)],
    images: images.tubing ? [images.tubing] : undefined,
  });
  S.push({
    id: "vol", title: `${n++}. Объёмы и время`,
    tables: [{ id: "vol-t", headers: ["Показатель", "Значение"], widths: [60, 40], rows: [
      ["Объём НКТ до инструмента, м³", f(res.volumes.tubingM3, 2)],
      ["Состав под инструментом / задавливание / запас, м³", `${f(res.volumes.belowToolM3, 2)} / ${f(res.volumes.squeezeM3, 2)} / ${f(res.volumes.reserveM3, 2)}`],
      ["Итого состава, м³", f(res.volumes.totalM3, 2)],
      ["Продавка / обратная промывка, м³", `${f(res.volumes.displacementM3, 2)} / ${f(res.volumes.reverseOutM3, 2)}`],
      ["Время работы с составом по моделированию, мин", f(sim.totalTimeMin, 0)],
      ["Требуемое время жизни / загустевания состава при BHCT, мин", `≥ ${requiredWorkLifeMin}`],
    ] }],
  });
  if (comp) {
    S.push(recipeSection("recipe-0", `${n++}. ${comp.primary.title} — рецептура и свойства`, comp.primary, comp.split ? comp.split.primaryM3 : res.volumes.totalM3));
    if (comp.secondary && comp.split) S.push(recipeSection("recipe-1", `${n++}. ${comp.secondary.title} — рецептура и свойства`, comp.secondary, comp.split.secondaryM3));
  } else {
    S.push({ id: "recipe-c", title: `${n++}. Тампонажный раствор`, paragraphs: [`Портландцемент тампонажный ПЦТ-I-G (ГОСТ 1581), плотность ${f(res.compositionDensity, 2)} г/см³, водоцементное отношение 0,44–0,50; водоотдача ≤ 100 мл/30 мин (API) для задавливания; время загустевания при ${f(res.temps.bhctC, 0)} °C ≥ ${requiredWorkLifeMin} мин. Рецептура подбирается в модуле «Цементные мосты» по тем же условиям и подтверждается лабораторией.`] });
  }
  const reg = stageRegime(sim);
  S.push({
    id: "regime", title: `${n++}. Технологический регламент закачки и задавливания (по моделированию)`,
    paragraphs: [`Итог моделирования: ${sim.outcomeText} Использовано ${f(sim.workLifeUsedPct, 0)}% времени жизни состава.`],
    tables: [
      { id: "reg", headers: ["Этап", "Время, мин", "Объём, м³", "Расход ср., л/с", "P макс. на устье, МПа", "Допустимо, МПа"], widths: [30, 14, 12, 14, 15, 15],
        rows: reg.map((r) => [r.name, `${f(r.t0, 0)}–${f(r.t1, 0)}`, r.kind === "hold" ? "—" : f(r.volM3, 3), r.kind === "hold" ? "—" : f(r.qAvg, 2), f(r.pMax, 1), f(r.allow, 1)]) },
      { id: "holds", headers: ["Ступень", "P в начале выдержки, МПа", "P в конце, МПа", "Падение, %", "Решение"], widths: [14, 24, 20, 16, 26],
        rows: sim.holds.map((h) => [String(h.stage), f(h.pStart, 1), f(h.pEnd, 1), f(h.decayPct, 0), h.decayPct <= 10 ? "давление держится" : "следующая ступень"]) },
    ],
    bullets: sim.warnings.map((w) => `⚠ ${w}`),
    images: images.sim ? [images.sim] : undefined,
  });

  // Оборудование и материалы
  const materials: string[][] = [];
  const addDesign = (d: RirCompositionResult["primary"], vol: number) => {
    for (const c of d.components) materials.push([c.name, c.kgPerM3 * vol * 1.05 >= 1000 ? `${f((c.kgPerM3 * vol * 1.05) / 1000, 2)} т` : `${f(c.kgPerM3 * vol * 1.05, 0)} кг`, d.title]);
    if (d.waterLPerM3 > 0) materials.push(["Вода пресная (затворение)", `${f((d.waterLPerM3 * vol * 1.05) / 1000, 2)} м³`, d.title]);
  };
  if (comp) {
    addDesign(comp.primary, comp.split ? comp.split.primaryM3 : res.volumes.totalM3);
    if (comp.secondary && comp.split) addDesign(comp.secondary, comp.split.secondaryM3);
  } else materials.push(["Цемент ПЦТ-I-G", `${f(res.volumes.totalM3 * 1.24 * 1.05, 2)} т`, "Тампонажный раствор"]);
  materials.push(["Техническая вода (буфер, продавка, приёмистость, промывка)", `${f(0.5 + res.volumes.displacementM3 + res.volumes.reverseOutM3 + 3, 1)} м³`, "—"]);
  materials.push([`Жидкость глушения ${f(inp.wellFluidDensity, 2)} г/см³`, "по плану глушения", "—"]);
  const resin = comp?.primary.kind === "resin";
  S.push({
    id: "equip", title: `${n++}. Оборудование и материалы`,
    tables: [
      { id: "eq", headers: ["Оборудование", "Кол-во", "Назначение"], widths: [44, 12, 44], rows: [
        ["Цементировочный агрегат (ЦА-320 / аналог), давление ≥ " + f(Math.max(res.maxSurfaceMPa * 1.5, 20), 0) + " МПа", "2", "Закачка, продавка, задавливание; второй — резерв"],
        [resin ? "Ёмкость с мешалкой 1–2 м³ (смешение смолы и отвердителя)" : "Осреднительная ёмкость с перемешиванием", "1", "Приготовление и осреднение состава"],
        ["Блок манифольдов, обратный клапан, кран высокого давления", "1", "Обвязка устья, опрессовка линий на 1,5×Pраб"],
        ["Станция контроля (давление, расход, плотность) с записью", "1", "Регистрация кривой задавливания для сравнения с моделированием"],
        ...(hasTool ? [[`${TOOL_LABEL[inp.tool.kind]}, перепад ≥ ${inp.tool.ratingMPa} МПа`, "1", inp.tool.kind === "retainer" ? "Стыковочный узел (стингер) в комплекте" : "Механической / гидравлической посадки"]] : []),
        [`НКТ ${inp.tubing.odMm}×${inp.tubing.wallMm} мм, ${inp.tubing.grade}`, `${f(hasTool ? inp.tool.setDepthMD : inp.leak.topMD, 0)} м`, "Колонна для закачки"],
        ["Шаблон, скрепер под колонну " + inp.casing.odMm + " мм", "1", "Подготовка ствола"],
        ...(inp.tool.kind === "retainer" ? [["Долото / фреза под колонну " + inp.casing.odMm + " мм, забойный двигатель или ротор", "1", "Разбуривание ретейнера и состава"]] : []),
        ["Лабораторное оборудование (консистометр / вискозиметр, весы плотности)", "1", "Контроль состава на площадке"],
      ] },
      { id: "mat", headers: ["Материал", "Количество (+5%)", "Состав"], widths: [50, 20, 30], rows: materials },
    ],
  });
  S.push({ id: "work", title: `${n++}. Ход работ`, bullets: work.map((s, i) => `${i + 1}. ${s.title}${s.timeMin ? ` (~${f(s.timeMin, 0)} мин)` : ""}. ${s.text}`) });

  const lifeLeft = (frac: number) => Math.max(0, Math.round(requiredWorkLifeMin * frac - sim.totalTimeMin * 0.5));
  S.push({
    id: "contingency", title: `${n++}. Действия при осложнениях`,
    tables: [{ id: "cont", headers: ["Ситуация", "Признак", "Действия"], widths: [22, 28, 50], rows: [
      ["Нет приёмистости состава", `Давление на допустимом (${f(res.maxSurfaceMPa, 1)} МПа), расход < 0,05 л/с до подхода состава к нарушению`, "Остановить закачку, выдержка 5 мин. Если давление не снижается — расстыковка / срыв пакера и обратная промывка состава из НКТ. Кислотная обработка канала (HCl 10–12 %), повторное определение приёмистости; рассмотреть смолу меньшей вязкости."],
      ["Поглощение, давление не растёт", "После закачки 100% объёма задавливания давление на выдержке падает > 50%", "Снизить расход вдвое, увеличить выдержки до 15–20 мин. При исчерпании состава — продавить остаток, ОЗЦ и повторное задавливание. Рассмотреть кольматант / состав с наполнителем."],
      ["Резкий рост давления", "Скачок давления > 3 МПа за 1 мин, расход падает до нуля", "Не превышать допустимое давление. Перейти на выдержку; при сохранении — считать задавленным, расстыковка и промывка."],
      ["Негерметичность пакера / НКТ", "Рост давления в затрубье НКТ, выход жидкости из затрубья", "Остановить закачку, стравить давление. Ретейнер: проверить разгрузку (≥ " + f(mech?.setDownNeededKN ?? 40, 0) + " кН) и посадку стингера. Пакер: переустановить на 5–10 м выше. Противодавление в затрубье" + (mech?.backPressureNeededMPa ? ` ${f(mech.backPressureNeededMPa, 1)} МПа` : "") + "."],
      ["Отказ насоса", "Остановка закачки", `Переход на резервный агрегат. Если закачка не восстановлена в течение ~${lifeLeft(0.75)} мин — обратная промывка состава из НКТ.`],
      ["Исчерпание времени жизни", "Работа с составом > 75% времени жизни / рост консистенции", "Прекратить задавливание, немедленная расстыковка и обратная промывка; не допускать загустевания состава в НКТ."],
      ["Прихват инструмента", "Посадка / затяжка при подъёме", `Расхаживание в пределах допустимой нагрузки на НКТ${mech ? ` (${f(mech.tensionLimitKN, 0)} кН)` : ""}, промывка; ловильные работы по отдельному плану.`],
      ["ГНВП", "Перелив, рост давления в затрубье при остановке", "Закрыть превентор, действовать по плану ликвидации аварий (ПЛА)."],
    ] }],
  });
  const ozc = ozcHours(comp);
  S.push({
    id: "accept", title: `${n++}. ОЗЦ, контроль качества и приёмка`,
    bullets: [
      ozc.text,
      `Опрессовка колонны в интервале работ: давлением не ниже давления последней опрессовки колонны и не выше допустимого по колонне (${f(res.casingBurstMPa / inp.sfBurst, 1)} МПа на устье). Колонна герметична, если за 30 мин падение давления не превышает 0,5 МПа.`,
      inp.leak.kind === "intercasing" ? "Межколонное пространство: стравить давление и наблюдать восстановление 72 ч; работы успешны при отсутствии роста давления." : "При необходимости — снижение уровня (испытание на приток) и геофизический контроль (термометрия, АКЦ, шумометрия).",
      "Фактическую кривую задавливания (давление, расход, объём по времени) приложить к акту и сравнить с моделированием.",
    ],
  });
  S.push({
    id: "hse", title: `${n++}. Требования безопасности и охраны окружающей среды`,
    bullets: [
      "Работы выполняются по утверждённому плану с соблюдением ФНП «Правила безопасности в нефтяной и газовой промышленности»; на устье — ПВО, опрессованное на давление опрессовки колонны.",
      `Нагнетательные линии опрессовать на 1,5 кратное ожидаемое рабочее давление (не менее ${f(Math.max(res.maxSurfaceMPa * 1.5, 15), 0)} МПа). Предохранительный клапан на агрегате настроить на ${f(res.maxSurfaceMPa, 1)} МПа + 5%.`,
      "Опасная зона вокруг линий высокого давления — не менее 10 м, нахождение людей при закачке запрещено.",
      ...(comp?.primary.kind === "resin" || comp?.secondary?.kind === "resin" ? ["Смолы и аминные отвердители — раздражающие и сенсибилизирующие вещества: защитные очки, нитриловые перчатки, спецодежда, работа на открытом воздухе / с вентиляцией; паспорта безопасности (SDS) на площадке.", "Смешение смолы с отвердителем — непосредственно перед закачкой; реакция экзотермическая — не оставлять смешанный состав в ёмкости, остатки отверждать в тонком слое."] : []),
      "Отходы состава и промывочные жидкости собрать в ёмкости и вывезти на утилизацию; не допускать разлива на грунт.",
    ],
  });
  return {
    version: 1, createdAt: now.toISOString(),
    title: `ПЛАН РАБОТ НА РЕМОНТНО-ИЗОЛЯЦИОННЫЕ РАБОТЫ № РИР-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`,
    subtitle: `${LEAK_KIND_LABEL[inp.leak.kind]}, ${f(inp.leak.topMD, 0)}–${f(inp.leak.bottomMD, 0)} м · ${COMPOSITION_LABEL[res.composition].split(" (")[0]} · ${hasTool ? TOOL_LABEL[inp.tool.kind].split(" (")[0] : "с устья"}`,
    meta: [
      { label: "Дата", value: date }, { label: "Месторождение", value: "" }, { label: "Куст / скважина", value: "" }, { label: "Подрядчик", value: "" },
      { label: "Основание", value: `Расчёт РИР DeAllsoft от ${date}` },
    ],
    status: "Расчётные значения (окно давлений, рецептура, моделирование) — прогноз по открытым данным и корреляциям. Рецептура подтверждается лабораторией на фактических материалах при BHCT до начала работ.",
    sections: S,
    signatures: [{ role: "Составил (инженер-технолог)", name: "" }, { role: "Согласовал (геолог)", name: "" }, { role: "Согласовал (подрядчик по РИР)", name: "" }, { role: "Утвердил (главный инженер)", name: "" }],
    slurryNames: comp ? [comp.primary.title, ...(comp.secondary ? [comp.secondary.title] : [])] : [],
  };
}
