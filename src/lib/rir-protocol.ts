/** Расчётный протокол РИР: условия, окно давлений, рецептура состава, свойства (прогноз / факт), ход работ. */
import type { LabProtocol, ProtocolSection } from "./lab-protocol";
import { COMPOSITION_LABEL, LEAK_KIND_LABEL, TOOL_LABEL, type RirInputs, type RirResult } from "./rir-calculations";
import type { CompositionDesign, RirCompositionResult } from "./rir-compositions";
import type { TubingMechResult } from "./rir-tubing";
import type { WorkStep } from "./rir-calculations";

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace(".", ",") : "—");

function recipeSection(id: string, title: string, d: CompositionDesign, vol: number): ProtocolSection {
  return {
    id, title,
    paragraphs: [`${d.system}. Объём ${f(vol, 2)} м³ (+5% запас).`],
    tables: [
      { id: `${id}-t`, headers: ["Компонент", "Назначение", "Дозировка", "кг/м³", "На операцию"], widths: [28, 34, 12, 10, 16], rows: [
        ...d.components.map((c) => [c.name, c.purpose, `${f(c.dose, c.dose < 10 ? 2 : 0)} ${c.doseUnit}`, f(c.kgPerM3, c.kgPerM3 < 10 ? 1 : 0), `${f(c.kgPerM3 * vol * 1.05, 0)} кг`]),
        ...(d.waterLPerM3 > 0 ? [["Вода затворения (пресная)", "Затворение", "—", `${d.waterLPerM3} л`, `${f((d.waterLPerM3 * vol * 1.05) / 1000, 2)} м³`]] : []),
      ] },
      { id: `${id}-p`, headers: ["Показатель", "Требование", "Прогноз системы", "Факт", "Заключение"], widths: [36, 16, 16, 12, 20], rows:
        d.props.map((p) => [p.label, p.target ?? "—", p.value, "", p.ok === undefined ? "—" : p.ok ? "соответствует (прогноз)" : "НЕ соответствует (прогноз)"]) },
    ],
    bullets: [...d.procedure.map((p, i) => `${i + 1}. ${p}`), ...d.warnings.map((w) => `⚠ ${w}`)],
  };
}

export function buildRirProtocol(inp: RirInputs, res: RirResult, comp: RirCompositionResult | null, mech: TubingMechResult | null, work: WorkStep[]): LabProtocol {
  const now = new Date(), date = now.toLocaleDateString("ru-RU");
  const sections: ProtocolSection[] = [];
  sections.push({
    id: "well", title: "1. Исходные данные и диагностика",
    tables: [{ id: "well-kv", headers: ["Параметр", "Значение"], widths: [55, 45], rows: [
      ["Эксплуатационная колонна", `${inp.casing.odMm}×${inp.casing.wallMm} мм, ${inp.casing.grade}; цемент за колонной от ${f(inp.casing.cementTopMD, 0)} м`],
      ["НКТ", `${inp.tubing.odMm}×${inp.tubing.wallMm} мм, ${inp.tubing.grade}`],
      ["Нарушение", `${LEAK_KIND_LABEL[inp.leak.kind]}; ${f(inp.leak.topMD, 0)}–${f(inp.leak.bottomMD, 0)} м${inp.leak.annulusPressureMPa > 0 ? `; межколонное давление ${f(inp.leak.annulusPressureMPa, 1)} МПа` : ""}`],
      ["Способ задавливания", `${TOOL_LABEL[inp.tool.kind]}${inp.tool.kind !== "bradenhead" ? `, ${f(inp.tool.setDepthMD, 0)} м, перепад ${inp.tool.ratingMPa} МПа` : ""}`],
      ["Температура статическая / BHCT на глубине нарушения, °C", `${f(res.temps.bhstC, 0)} / ${f(res.temps.bhctC, 0)}`],
      ["Приёмистость", res.fit ? `J = ${f(res.fit.J, 2)} м³/(ч·МПа), давление начала на глубине ${f(res.fit.openingBhpMPa, 1)} МПа` : "не определена"],
      ["Оценка раскрытия канала", res.apertureUm !== null ? `~${f(res.apertureUm, 0)} мкм` : "—"],
      ["Выбранный состав", `${COMPOSITION_LABEL[res.composition]}; ${res.compositionReason.join(" ")}`],
    ] }],
  });
  sections.push({
    id: "window", title: "2. Окно давлений",
    tables: [{ id: "window-t", headers: ["Ограничение", "На глубине нарушения, МПа", "На устье, МПа"], widths: [56, 22, 22],
      rows: res.constraints.map((c) => [`${c.name}${c.name === res.governing ? " — определяющее" : ""}`, f(c.limitBhpMPa, 1), f(Math.max(0, c.limitSurfaceMPa), 1)]) }],
    paragraphs: [`Допустимое давление задавливания: ${f(res.maxSurfaceMPa, 1)} МПа на устье (${f(res.maxBhpMPa, 1)} МПа на глубине нарушения).`,
      ...(mech ? [`НКТ при задавливании: ΔL ${f(mech.totalDLmm, 0)} мм; ${mech.conclusions.join(" ")}`] : [])],
  });
  sections.push({
    id: "vol", title: "3. Объёмы и время",
    tables: [{ id: "vol-t", headers: ["Показатель", "Значение"], widths: [60, 40], rows: [
      ["Состав под инструментом / задавливание / запас, м³", `${f(res.volumes.belowToolM3, 2)} / ${f(res.volumes.squeezeM3, 2)} / ${f(res.volumes.reserveM3, 2)}`],
      ["Итого состава, м³", f(res.volumes.totalM3, 2)],
      ["Продавка / обратная промывка, м³", `${f(res.volumes.displacementM3, 2)} / ${f(res.volumes.reverseOutM3, 2)}`],
      ["Время операции, мин", f(res.timing.jobMin, 0)],
      ["Требуемое время жизни / загустевания состава, мин", `≥ ${res.timing.requiredWorkLifeMin}`],
    ] }],
  });
  let n = 4;
  if (comp) {
    sections.push(recipeSection("recipe-0", `${n++}. ${comp.primary.title} — рецептура и свойства`, comp.primary, comp.split ? comp.split.primaryM3 : res.volumes.totalM3));
    if (comp.secondary && comp.split) sections.push(recipeSection("recipe-1", `${n++}. ${comp.secondary.title} — рецептура и свойства`, comp.secondary, comp.split.secondaryM3));
  }
  sections.push({ id: "work", title: `${n++}. Ход работ`, bullets: work.map((s, i) => `${i + 1}. ${s.title}. ${s.text}`) });
  sections.push({
    id: "concl", title: `${n}. Заключение`,
    paragraphs: [
      "Протокол сформирован расчётом. Перед работами подтвердить в лаборатории на фактических материалах при BHCT: время жизни / загустевания, плотность, вязкость (для смол), водоотдачу (для микроцемента), прочность к сроку ОЗЦ.",
      "Колонна признаётся герметичной, если при опрессовке за 30 мин давление снизилось не более чем на 0,5 МПа.",
    ],
    bullets: res.warnings.map((w) => `⚠ ${w}`),
  });
  return {
    version: 1, createdAt: now.toISOString(),
    title: `ПРОГРАММА РИР И РАСЧЁТНЫЙ ПРОТОКОЛ № РИР-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`,
    subtitle: "ликвидация негерметичности колонны / перетоков задавливанием изолирующего состава",
    meta: [
      { label: "Дата", value: date }, { label: "Месторождение", value: "" }, { label: "Куст / скважина", value: "" },
      { label: "Основание", value: `Расчёт РИР DeAllsoft от ${date}` },
    ],
    status: "Значения «Прогноз системы» — расчётные (открытые данные, корреляции), не результаты испытаний. Колонка «Факт» заполняется по лабораторным испытаниям.",
    sections,
    signatures: [{ role: "Составил (инженер-технолог)", name: "" }, { role: "Проверил", name: "" }, { role: "Утвердил (главный инженер)", name: "" }],
    slurryNames: comp ? [comp.primary.title, ...(comp.secondary ? [comp.secondary.title] : [])] : [],
  };
}
