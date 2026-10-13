/**
 * Рецептура тампонажного раствора для цементного моста: тот же подбор, что в программе
 * цементирования (designToTargets), но условия и требования — от моста: BHCT на подошве,
 * время работы раствора до выхода труб из цемента, прочность по назначению моста.
 */
import type { PlugInputs, PlugResults } from "./cement-plug-calculations";
import { designToTargets, type DesignConditions, type LabTargets, type TargetDesignResult } from "./cement-recipe-designer";
import { getPlugRequirements, PLUG_PURPOSE_LABEL, type PlugPurpose } from "./cement-plug-types";
import type { LabProtocol, ProtocolSection } from "./lab-protocol";

const f = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace(".", ",") : "—");

/** Время работы раствора: закачка цемента, буфера и продавка + подъём труб из цемента, мин. */
export function plugJobTimeMin(r: PlugResults): number {
  return r.pumpTimeCementMin + r.pumpTimeSpacerAboveMin + r.pumpTimeDisplacementMin + r.tripTimeMin;
}

/** Требуемое время загустевания: работа раствора ≤ 75% (ПБ НГП) и не менее +30 мин запаса. */
export function plugRequiredThickeningMin(r: PlugResults): number {
  const job = plugJobTimeMin(r);
  return Math.ceil(Math.max(job / 0.75, job + 30));
}

export function plugDesignConditions(inp: PlugInputs, r: PlugResults, purpose: PlugPurpose): DesignConditions {
  const t = r.temperatures;
  return {
    densityGcm3: inp.cement.density,
    bhctC: t.bhctC, tTopC: t.tTopStaticC, tBottomC: t.tBottomStaticC, bhstC: t.tBottomStaticC,
    maxPressureMPa: Math.max(r.pressureAnnulus, r.pressurePipe),
    requiredThickeningMin: plugRequiredThickeningMin(r),
    coversPay: purpose === "abandonment" || purpose === "zonal_isolation",
    gas: false,
    maxZenithDeg: r.plugZenithDeg,
    lossMarginMPa: null,
    isTail: true,
  };
}

/** Требования по назначению моста: прочность к планируемому ОЗЦ, волокно при поглощении. */
export function plugDefaultTargets(purpose: PlugPurpose, wocHours: number, r: PlugResults): LabTargets {
  const ucs = getPlugRequirements(purpose, 0).minCompressiveStrengthMPa;
  return {
    thickeningMinMin: plugRequiredThickeningMin(r),
    strength24MinMPa: wocHours <= 30 ? ucs : Math.min(ucs, 3.5),
    strength48MinMPa: ucs,
    ...(purpose === "lost_circulation" ? { fiber: true } : {}),
  };
}

export function designPlugSlurry(inp: PlugInputs, r: PlugResults, purpose: PlugPurpose, wocHours: number, user?: LabTargets): TargetDesignResult {
  return designToTargets(plugDesignConditions(inp, r, purpose), { ...plugDefaultTargets(purpose, wocHours, r), ...(user ?? {}) });
}

/** Расчётный протокол подбора рецептуры для моста (формат общий с программой цементирования). */
export function buildPlugLabProtocol(inp: PlugInputs, r: PlugResults, res: TargetDesignResult, purpose: PlugPurpose, wocHours: number): LabProtocol {
  const d = res.design, p = d.predicted, t = r.temperatures;
  const now = new Date();
  const date = now.toLocaleDateString("ru-RU");
  const cementKgM3 = 1e6 / (d.yieldM3PerT * (1 + d.components.reduce((s, c) => s + c.pctBwoc / 100, 0)) * 1000);
  const vol = r.cementVolumeTotal, reserve = 1.05;
  const fann = (x: typeof p.rheo27) => `${x.fann.r600}/${x.fann.r300}/${x.fann.r200}/${x.fann.r100}/${x.fann.r6}/${x.fann.r3}`;
  const job = plugJobTimeMin(r);
  const sections: ProtocolSection[] = [
    {
      id: "well", title: "1. Исходные данные",
      tables: [{
        id: "well-kv", headers: ["Параметр", "Значение"], widths: [60, 40],
        rows: [
          ["Назначение моста", PLUG_PURPOSE_LABEL[purpose]],
          ["Интервал моста по стволу, м", `${f(r.plugTopMD, 0)}–${f(r.plugBottomMD, 0)} (по вертикали ${f(r.plugTopTVD, 0)}–${f(r.plugBottomTVD, 0)})`],
          ["Ствол в интервале моста", r.isOpenHole ? `открытый, эфф. ∅ ${f(r.boreDiamUsed, 1)} мм (Kкав ${f(r.cavernCoeff, 2)})` : `в колонне, ВД ${f(r.boreDiamUsed, 1)} мм`],
          ["Средний зенитный угол в интервале, °", f(r.plugZenithDeg, 1)],
          ["Объём тампонажного раствора, м³", `${f(vol, 2)} (в т.ч. запас ${f(r.cementExcessM3 ?? 0, 2)})`],
          ["Статическая температура кровли / подошвы, °C", `${f(t.tTopStaticC, 0)} / ${f(t.tBottomStaticC, 0)}${t.estimated ? " (оценка по градиенту)" : ""}`],
          ["Температура испытания на загустевание (BHCT), °C", `${f(t.bhctC, 0)} (${t.method})`],
          ["Давление испытания, МПа", f(Math.max(r.pressureAnnulus, r.pressurePipe), 1)],
          ["Время работы раствора (закачка, продавка, подъём из цемента), мин", f(job, 0)],
          ["Планируемое ОЗЦ, ч", f(wocHours, 0)],
        ],
      }],
    },
  ];
  const comps = d.components;
  sections.push({
    id: "recipe-0", title: `2. Рекомендуемая рецептура (плотность ${f(inp.cement.density, 2)} г/см³)`,
    paragraphs: [`Вяжущее: ${d.baseCement}. Дозировки — % от массы цемента (bwoc).`],
    tables: [
      {
        id: "recipe-t-0", headers: ["№", "Компонент", "Назначение", "% bwoc", "кг на 1 м³", "На мост (+5%)"], widths: [5, 28, 33, 9, 10, 15],
        rows: [
          ["1", d.baseCement, "Вяжущее", "100", f(cementKgM3, 0), f((cementKgM3 * vol * reserve) / 1000, 2) + " т"],
          ...comps.map((c, j) => [String(j + 2), c.name, c.purpose, f(c.pctBwoc, 2), f((cementKgM3 * c.pctBwoc) / 100, 1), f((cementKgM3 * c.pctBwoc * vol * reserve) / 100, 0) + " кг"]),
          [String(comps.length + 2), "Вода затворения (техническая, пресная)", "Затворение", f(d.waterPctBwoc, 1), f((cementKgM3 * d.waterPctBwoc) / 100, 0), f((cementKgM3 * d.waterPctBwoc * vol * reserve) / 100 / 1000, 2) + " м³"],
        ],
      },
      { id: "recipe-kv-0", headers: ["Показатель смеси", "Значение"], widths: [60, 40], rows: [
        ["Плотность расчётная, г/см³", f(d.densityGcm3, 3)],
        ["В/С (к сухой смеси)", f(d.waterToBlend, 3)],
        ["Выход раствора, м³/т сухой смеси", f(d.yieldM3PerT, 3)],
      ] },
    ],
    bullets: d.rationale,
  });
  const verdict = (ok: boolean | null) => (ok === null ? "—" : ok ? "соответствует (прогноз)" : "НЕ соответствует (прогноз)");
  sections.push({
    id: "props-0", title: "3. Свойства раствора и камня (прогноз и факт)",
    tables: [{
      id: "props-t-0", headers: ["Показатель", "Требование", "Прогноз системы", "Факт", "Заключение"], widths: [34, 16, 16, 12, 22],
      rows: [
        ...res.compliance.map((c) => [c.label, c.target, c.predicted, "", verdict(c.ok)]),
        ["Показания Fann 600/300/200/100/6/3 при 27 °C, дел.", "—", fann(p.rheo27), "", "—"],
        [`Показания Fann при ${f(t.bhctC, 0)} °C, дел.`, "—", fann(p.rheoBhct), "", "—"],
        ["Время загустевания до 50 / 100 Вс, мин", "—", `${f(p.thickening50BcMin, 0)} / ${f(p.thickening100BcMin, 0)}`, "", "—"],
        ["Время ОЗЦ до 3,5 МПа на кровле, ч", `≤ ${f(wocHours, 0)}`, Number.isFinite(p.wocTo35MPaHours) ? f(p.wocTo35MPaHours, 0) : "> 48", "", verdict(Number.isFinite(p.wocTo35MPaHours) && p.wocTo35MPaHours <= wocHours)],
        ["СНС 10 с / 10 мин, Па (для устойчивости моста)", "по расчёту устойчивости", "замерить", "", "—"],
      ],
    }],
    bullets: d.warnings.map((w) => `⚠ ${w}`),
  });
  sections.push({
    id: "concl", title: "4. Заключение",
    paragraphs: [
      res.allOk ? "По расчётному прогнозу рецептура удовлетворяет требованиям к раствору для моста данного назначения." : "По расчётному прогнозу часть требований не выполняется — см. строки «НЕ соответствует»; рецептура требует корректировки.",
      "Перед применением подтвердить испытанием на фактической партии цемента и реагентов: плотность, время загустевания при BHCT и давлении, прочность при температуре кровли к сроку ОЗЦ, СНС 10 с / 10 мин (входит в расчёт устойчивости моста).",
    ],
    bullets: t.note ? [`⚠ ${t.note}`] : [],
  });
  return {
    version: 1, createdAt: now.toISOString(),
    title: `РАСЧЁТНЫЙ ПРОТОКОЛ № РП-М-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`,
    subtitle: "подбора рецептуры тампонажного раствора для установки цементного моста",
    meta: [
      { label: "Дата", value: date },
      { label: "Месторождение", value: "" },
      { label: "Куст / скважина", value: "" },
      { label: "Назначение моста", value: PLUG_PURPOSE_LABEL[purpose] },
      { label: "Основание", value: `Расчёт цементного моста DeAllsoft от ${date}` },
    ],
    status: "Документ сформирован расчётом. «Прогноз системы» — расчётные значения (абсолютные объёмы, корреляции API RP 10B-2, типовые кривые ПЦТ класса G), не результаты испытаний. Колонка «Факт» заполняется по результатам испытаний.",
    sections,
    signatures: [
      { role: "Составил (инженер-технолог)", name: "" },
      { role: "Проверил", name: "" },
      { role: "Утвердил (главный инженер)", name: "" },
    ],
    slurryNames: [inp.cement.name],
  };
}
