/**
 * Per-module DOCX exporters for CT sub-tools:
 *   - Cleanout
 *   - N₂ Kickoff
 *   - Acid Stimulation
 *
 * Compact reports: cover, inputs, KPIs, schedules, recommendations.
 */
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, AlignmentType, WidthType, BorderStyle, PageBreak, ShadingType,
} from "docx";
import { saveAs } from "file-saver";
import type { CleanoutInput, CleanoutResult, FluidSlug, ScheduleResult } from "./ct-cleanout";
import type { N2KickoffInputs, N2KickoffResult } from "./ct-nitrogen-kickoff";
import type { AcidStimInputs, AcidStimResult } from "./ct-acid-stim";
import { CT_OPERATIONS } from "./ct-operations";

// ───── Palette / helpers (lean version of export-ct-docx) ─────
const NAVY = "0F2B46", BLUE = "1A5276", LIGHT_BLUE = "2980B9";
const HEADER_BG = NAVY, HEADER_FG = "FFFFFF", ROW_ALT = "EBF5FB", ROW_WARN = "FDEDEC";
const BORDER_CLR = "AED6F1", GRAY = "7F8C8D", RED = "C0392B", GREEN = "1E8449";
const ACCENT_GOLD = "D4AC0D";

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

const THIN_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
  left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
  right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
};

function hCell(text: string, width?: number): TableCell {
  return new TableCell({
    borders: THIN_BORDER,
    shading: { type: ShadingType.CLEAR, color: "auto", fill: HEADER_BG },
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 50, bottom: 50, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, size: 17, color: HEADER_FG, font: "Calibri" })],
    })],
  });
}

function dCell(text: string, opts?: {
  bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  color?: string; shading?: string; warn?: boolean;
}): TableCell {
  const fill = opts?.warn ? ROW_WARN : opts?.shading || undefined;
  return new TableCell({
    borders: THIN_BORDER,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    margins: { top: 40, bottom: 40, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: opts?.align ?? AlignmentType.LEFT,
      children: [new TextRun({
        text, size: 17, font: "Calibri",
        bold: opts?.bold, color: opts?.warn ? RED : opts?.color,
      })],
    })],
  });
}

function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 320, after: 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: LIGHT_BLUE, space: 4 } },
    children: [new TextRun({ text, bold: true, size: 24, font: "Calibri", color: BLUE })],
  });
}

function paramTable(rows: [string, string, boolean?][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
      ...rows.map(([k, v, w], i) => new TableRow({ children: [
        dCell(k, { shading: i % 2 === 0 ? ROW_ALT : undefined }),
        dCell(v, { align: AlignmentType.CENTER, warn: !!w, shading: !w && i % 2 === 0 ? ROW_ALT : undefined }),
      ] })),
    ],
  });
}

function dataTable(headers: string[], rows: string[][]): Table {
  const w = Math.floor(100 / headers.length);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map(h => hCell(h, w)) }),
      ...rows.map((r, i) => new TableRow({ children: r.map(v => dCell(v, {
        align: AlignmentType.CENTER, shading: i % 2 === 0 ? ROW_ALT : undefined,
      })) })),
    ],
  });
}

function bullet(text: string, color?: string): Paragraph {
  return new Paragraph({
    spacing: { after: 50 },
    indent: { left: 200 },
    children: [new TextRun({ text: "• " + text, size: 18, font: "Calibri", color })],
  });
}

function cover(title: string, subtitle: string, summary: [string, string][]): (Paragraph | Table)[] {
  const now = new Date();
  const dateStr = now.toLocaleDateString("ru-RU");
  const timeStr = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return [
    new Paragraph({ spacing: { before: 1200 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT_GOLD, space: 8 } },
      spacing: { after: 300 },
      children: [],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: title, bold: true, size: 44, font: "Calibri", color: NAVY })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: subtitle, bold: true, size: 20, font: "Calibri", color: LIGHT_BLUE })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: ACCENT_GOLD, space: 8 } },
      spacing: { after: 400 }, children: [],
    }),
    new Table({
      width: { size: 70, type: WidthType.PERCENTAGE },
      rows: summary.map(([k, v]) => new TableRow({ children: [
        dCell(k, { bold: true, color: BLUE }),
        dCell(v, { align: AlignmentType.LEFT }),
      ] })),
    }),
    new Paragraph({ spacing: { before: 400 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Подготовлено системой DeAllsoft", size: 18, font: "Calibri", color: GRAY, italics: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: `Дата: ${dateStr}  ${timeStr}`, size: 18, font: "Calibri", color: GRAY })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 200 },
      children: [new TextRun({
        text: "Информационный расчёт. Не заменяет проектную документацию.",
        size: 15, font: "Calibri", color: GRAY, italics: true,
      })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

async function packAndSave(filename: string, children: (Paragraph | Table)[]) {
  const doc = new Document({
    creator: "DeAllsoft", title: filename,
    styles: { default: { document: { run: { font: "Calibri", size: 18 } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
      children,
    }],
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}

function operationBlock(operationType?: string): (Paragraph | Table)[] {
  if (!operationType) return [];
  const op = CT_OPERATIONS.find(o => o.type === operationType);
  if (!op || op.type === "custom") return [];
  const out: (Paragraph | Table)[] = [];
  out.push(sectionTitle(`Выбранная операция ГНКТ: ${op.icon} ${op.nameRu}`));
  out.push(paramTable([
    ["Категория", op.category],
    ["Описание", op.description],
    ["Рекомендуемая жидкость", op.recommendedFluid],
    ["Плотность жидкости (типовая)", `${op.recommendedFluidDensity} г/см³`],
    ["Диапазон расхода", `${op.recommendedFlowRateLpm[0]}–${op.recommendedFlowRateLpm[1]} л/мин`],
    ["Диапазон устьевого давления", `${op.recommendedSurfacePressureMPa[0]}–${op.recommendedSurfacePressureMPa[1]} МПа`],
    ["Требуется вращение", op.requiresRotation ? "Да" : "Нет"],
    ["Требуется азот", op.requiresNitrogen ? "Да" : "Нет"],
  ]));
  if (op.typicalBHA.length) {
    out.push(new Paragraph({ spacing: { before: 120, after: 60 },
      children: [new TextRun({ text: "Типичная КНБК:", bold: true, size: 19, font: "Calibri", color: BLUE })] }));
    op.typicalBHA.forEach(b => out.push(bullet(b)));
  }
  if (op.risks.length) {
    out.push(new Paragraph({ spacing: { before: 120, after: 60 },
      children: [new TextRun({ text: "Типовые риски:", bold: true, size: 19, font: "Calibri", color: RED })] }));
    op.risks.forEach(r => out.push(bullet(r, RED)));
  }
  return out;
}

// ═══════════════════════════════════════════════════
// 1. CLEANOUT REPORT
// ═══════════════════════════════════════════════════
export async function exportCleanoutDocx(args: {
  input: CleanoutInput;
  result: CleanoutResult;
  schedule?: ScheduleResult;
  slugs?: FluidSlug[];
  operationType?: string;
}) {
  const { input, result, schedule, slugs, operationType } = args;
  const children: (Paragraph | Table)[] = [];

  children.push(...cover(
    "ПРОМЫВКА СКВАЖИНЫ",
    "WELLBORE CLEANOUT — отчёт по транспорту песка",
    [
      ["Пробка", `MD ${input.sandDepthMD_m} м, h = ${input.sandHeightM} м`],
      ["Затруб", `ID ${input.casingID_mm} / OD ${input.ctOD_mm} мм`],
      ["Жидкость", `ρ ${input.fluidDensityGcc} г/см³, μ ${input.fluidViscosityCp} сП`],
      ["Расход", `${input.flowRateLpm} л/мин`],
      ["Транспорт", `TR = ${fmt(result.transportRatio, 2)} ${result.safe ? "✅" : "⚠"}`],
    ],
  ));

  children.push(...operationBlock(operationType));

  // 1. Inputs
  children.push(sectionTitle("1. Исходные данные"));
  children.push(paramTable([
    ["ID обсадной/НКТ", `${input.casingID_mm} мм`],
    ["OD ГНКТ", `${input.ctOD_mm} мм`],
    ["Глубина пробки (MD)", `${input.sandDepthMD_m} м`],
    ["Высота пробки", `${input.sandHeightM} м`],
    ["Зенитный угол", `${input.wellInclinationDeg ?? 0}°`],
    ["Размер частиц", `${input.particleSizeMm} мм`],
    ["Плотность частиц", `${input.particleDensityGcc} г/см³`],
    ["Концентрация выноса", `${input.sandConcentrationKgM3 ?? 400} кг/м³`],
    ["Плотность жидкости", `${input.fluidDensityGcc} г/см³`],
    ["Вязкость жидкости", `${input.fluidViscosityCp} сП`],
    ["Текущий расход", `${input.flowRateLpm} л/мин`],
    ["Мин. transport ratio", `${input.minTransportRatio ?? 0.5}`],
  ]));

  // 2. Результаты
  children.push(sectionTitle("2. Результаты — транспорт"));
  children.push(paramTable([
    ["Площадь затруба", `${fmt(result.annulusAreaM2 * 10000, 2)} см²`],
    ["Скорость в затрубе vₐ", `${fmt(result.annularVelocityMps, 3)} м/с`],
    ["Скорость осаждения vₛ", `${fmt(result.slipVelocityMps, 3)} м/с`],
    ["Reₚ (частицы)", `${fmt(result.reParticle, 1)}`],
    ["Режим", result.flowRegime],
    ["Коэф. инклинации", `${fmt(result.inclinationCorrection, 2)}`],
    ["Transport ratio (TR)", `${fmt(result.transportRatio, 2)}`, !result.safe],
    ["Чистая скорость подъёма", `${fmt(result.netRiseVelocityMps, 3)} м/с`],
    ["Мин. требуемый расход", `${fmt(result.minRequiredFlowLpm, 0)} л/мин`],
    ["Рекомендуемый расход (+30%)", `${fmt(result.recommendedFlowLpm, 0)} л/мин`],
    ["Запас по расходу", `${fmt((input.flowRateLpm / Math.max(1, result.minRequiredFlowLpm) - 1) * 100, 0)} %`,
      input.flowRateLpm < result.minRequiredFlowLpm],
  ]));

  // 3. Время и объёмы
  children.push(sectionTitle("3. Время и объёмы промывки"));
  children.push(paramTable([
    ["Объём пробки в затрубе", `${fmt(result.sandVolumeM3, 2)} м³`],
    ["Время полной промывки", `${fmt(result.cleanoutTimeMin, 1)} мин`],
    ["Объём прокачанной жидкости", `${fmt(result.totalFluidVolumeM3, 1)} м³`],
    ["Скорость выноса песка", `${fmt(result.sandReturnRateKgMin, 1)} кг/мин`],
  ]));

  // 4. Schedule
  if (slugs && slugs.length && schedule) {
    children.push(sectionTitle("4. План закачки (multi-fluid)"));
    children.push(dataTable(
      ["#", "Жидкость", "ρ, г/см³", "μ, сП", "V, м³", "Время, мин", "ΣV, м³", "Σt, мин"],
      schedule.items.map((it, i) => [
        `${i + 1}`, it.name, fmt(it.densityGcc, 2), fmt(it.viscosityCp, 1),
        fmt(it.volumeM3, 2), fmt(it.pumpTimeMin, 1),
        fmt(it.cumVolumeM3, 2), fmt(it.cumTimeMin, 1),
      ]),
    ));
    children.push(new Paragraph({ spacing: { before: 80 },
      children: [new TextRun({
        text: `Итого: ${fmt(schedule.totalVolumeM3, 2)} м³ за ${fmt(schedule.totalTimeMin, 1)} мин. ` +
              `Средневзв. ρ = ${fmt(schedule.avgDensityGcc, 3)} г/см³, μ = ${fmt(schedule.avgViscosityCp, 1)} сП.`,
        size: 18, font: "Calibri", bold: true, color: BLUE,
      })] }));
  }

  // 5. Warnings
  if (result.warnings.length) {
    children.push(sectionTitle("5. Предупреждения"));
    result.warnings.forEach(w => children.push(bullet(w, RED)));
  }

  await packAndSave(`Cleanout_${new Date().toISOString().slice(0, 10)}.docx`, children);
}

// ═══════════════════════════════════════════════════
// 2. N₂ KICKOFF REPORT
// ═══════════════════════════════════════════════════
export async function exportN2KickoffDocx(args: {
  input: N2KickoffInputs;
  result: N2KickoffResult;
  operationType?: string;
}) {
  const { input, result, operationType } = args;
  const children: (Paragraph | Table)[] = [];

  children.push(...cover(
    "ОСВОЕНИЕ АЗОТОМ",
    "N₂ KICKOFF — вызов притока через ГНКТ",
    [
      ["Скважина", `TVD ${input.tvd} м, MD ${input.md} м`],
      ["Пласт. давление", `${input.reservoirPressure} МПа`],
      ["Целевая депрессия", `${input.drawdownTarget} МПа`],
      ["Расход N₂", `${input.n2RateSm3min} ст.м³/мин`],
      ["Результат", `Δp = ${fmt(result.drawdown, 2)} МПа ${result.feasible ? "✅" : "⚠"}`],
    ],
  ));

  children.push(...operationBlock(operationType));

  children.push(sectionTitle("1. Исходные данные"));
  children.push(paramTable([
    ["TVD / MD", `${input.tvd} / ${input.md} м`],
    ["Пластовое давление", `${input.reservoirPressure} МПа`],
    ["Устьевое давление", `${input.wellheadPressure} МПа`],
    ["Плотность жидкости", `${input.fluidDensity} г/см³`],
    ["BHCT / T° устье", `${input.bhct} / ${input.whTemp} °C`],
    ["ID обсадной / OD ГНКТ", `${input.csgID} / ${input.ctOD} мм`],
    ["ID ГНКТ", `${input.ctID} мм`],
    ["Расход N₂", `${input.n2RateSm3min} ст.м³/мин`],
    ["Расход жидкости через ГНКТ", `${input.liquidRateLpm} л/мин`],
    ["Глубина спуска ГНКТ", `${input.ctRunDepth} м`],
    ["Целевая депрессия", `${input.drawdownTarget} МПа`],
  ]));

  children.push(sectionTitle("2. Результаты"));
  children.push(paramTable([
    ["Забойное давление (Pзаб)", `${fmt(result.bottomholePressure, 2)} МПа`],
    ["Достигнутая депрессия", `${fmt(result.drawdown, 2)} МПа`, !result.feasible],
    ["Устьевое давление закачки", `${fmt(result.surfacePressure, 2)} МПа`, result.surfacePressure > 35],
    ["Общий объём N₂", `${fmt(result.n2VolumeTotal, 0)} нм³`],
    ["Вытеснено жидкости", `${fmt(result.liquidUnloaded, 2)} м³`],
    ["Ср. плотность смеси", `${fmt(result.avgMixDensity, 0)} кг/м³`],
    ["Достижимость", result.feasible ? "ДА — депрессия достигнута" : "НЕТ — увеличить расход N₂", !result.feasible],
  ]));

  // Sensitivity
  if (result.sensitivity?.length) {
    children.push(sectionTitle("3. Чувствительность по расходу N₂"));
    children.push(dataTable(
      ["Расход N₂, ст.м³/мин", "Pзаб, МПа", "Депрессия, МПа"],
      result.sensitivity.map(s => [fmt(s.rate, 1), fmt(s.bhp, 2), fmt(s.drawdown, 2)]),
    ));
  }

  // Depth profile (every 3rd step)
  if (result.steps?.length) {
    children.push(sectionTitle("4. Профиль по глубине"));
    const slice = result.steps.filter((_, i) => i % 3 === 0 || i === result.steps.length - 1);
    children.push(dataTable(
      ["Глубина, м", "P, МПа", "T, °C", "αг", "ρсм, кг/м³"],
      slice.map(s => [fmt(s.depth, 0), fmt(s.pressure, 2), fmt(s.temperature, 1),
        fmt(s.gasFraction, 3), fmt(s.mixtureDensity, 0)]),
    ));
  }

  if (result.recommendations?.length) {
    children.push(sectionTitle("5. Рекомендации"));
    result.recommendations.forEach(r => children.push(bullet(r)));
  }

  await packAndSave(`N2_Kickoff_${new Date().toISOString().slice(0, 10)}.docx`, children);
}

// ═══════════════════════════════════════════════════
// 3. ACID STIM REPORT
// ═══════════════════════════════════════════════════
export async function exportAcidStimDocx(args: {
  input: AcidStimInputs;
  result: AcidStimResult;
  operationType?: string;
}) {
  const { input, result, operationType } = args;
  const children: (Paragraph | Table)[] = [];

  const formationName = { carbonate: "Карбонат", sandstone: "Песчаник", dolomite: "Доломит" }[input.formation];

  children.push(...cover(
    "КИСЛОТНАЯ ОБРАБОТКА",
    "ACID STIMULATION — matrix acidizing через ГНКТ",
    [
      ["Пласт", `${formationName}, h перф. = ${input.perforationLength} м`],
      ["Система", input.acidSystem],
      ["Объём", `${fmt(result.acidVolumeUsed, 2)} м³ (реком. ${fmt(result.acidVolumeRecommended, 2)})`],
      ["Расход", `${input.pumpRate} л/мин`],
      ["BHTP / Pгрп", `${fmt(result.bhpAtMaxRate, 2)} / ${fmt(result.fracPressure, 2)} МПа ${result.withinPressureLimit ? "✅" : "⚠"}`],
    ],
  ));

  children.push(...operationBlock(operationType));

  children.push(sectionTitle("1. Исходные данные"));
  children.push(paramTable([
    ["TVD / MD", `${input.tvd} / ${input.md} м`],
    ["Длина перфорации", `${input.perforationLength} м`],
    ["Тип породы", formationName],
    ["Кислотная система", input.acidSystem],
    ["Объём на 1 м перфорации", `${input.volumePerMeter} м³/м`],
    ["Объём преднасоса (preflush)", `${input.preflushVolume} м³`],
    ["Объём продавки (overflush)", `${input.overflushVolume} м³`],
    ["Пластовое давление", `${input.reservoirPressure} МПа`],
    ["Градиент ГРП", `${input.fracGradient} МПа/м`],
    ["BHCT / T° устье", `${input.bhct} / ${input.whTemp} °C`],
    ["ID ГНКТ", `${input.ctID} мм`],
    ["Расход закачки", `${input.pumpRate} л/мин`],
    ["Макс. давление насоса", `${input.surfacePressure} МПа`],
  ]));

  children.push(sectionTitle("2. Результаты — давления"));
  children.push(paramTable([
    ["Давление ГРП на TVD", `${fmt(result.fracPressure, 2)} МПа`],
    ["Гидростатика на перфорации", `${fmt(result.hydrostaticAtPerf, 2)} МПа`],
    ["Потери на трение в ГНКТ", `${fmt(result.frictionLoss, 2)} МПа`],
    ["BHTP при текущем расходе", `${fmt(result.bhpAtMaxRate, 2)} МПа`, !result.withinPressureLimit],
    ["Макс. допустимый расход", `${fmt(result.maxAllowableRate, 0)} л/мин`],
    ["Устьевое давление (потреб.)", `${fmt(result.surfacePressureNeeded, 2)} МПа`,
      result.surfacePressureNeeded > input.surfacePressure],
    ["В пределах давления", result.withinPressureLimit ? "ДА" : "НЕТ — превышен ГРП", !result.withinPressureLimit],
  ]));

  children.push(sectionTitle("3. Химия"));
  children.push(paramTable([
    ["Объём кислоты (реком.)", `${fmt(result.acidVolumeRecommended, 2)} м³`],
    ["Объём кислоты (применён)", `${fmt(result.acidVolumeUsed, 2)} м³`],
    ["Общий объём жидкости", `${fmt(result.totalLiquidVolume, 2)} м³`],
    ["Растворённой породы", `${fmt(result.dissolvedRock, 0)} кг`],
    ["Выделится CO₂", `${fmt(result.co2Generated, 1)} нм³`],
    ["Общее время закачки", `${fmt(result.totalPumpTime, 1)} мин`],
  ]));

  if (result.stages?.length) {
    children.push(sectionTitle("4. Программа закачки по стадиям"));
    children.push(dataTable(
      ["#", "Стадия", "Жидкость", "V, м³", "Q, л/мин", "Время, мин", "ΣV", "Σt"],
      result.stages.map((s, i) => [
        `${i + 1}`, s.name, s.fluid, fmt(s.volume, 2), fmt(s.rate, 0),
        fmt(s.duration, 1), fmt(s.cumVolume, 2), fmt(s.cumTime, 1),
      ]),
    ));
  }

  if (result.sensitivity?.length) {
    children.push(sectionTitle("5. Чувствительность по расходу"));
    children.push(dataTable(
      ["Q, л/мин", "BHP, МПа", "P уст., МПа", "Статус"],
      result.sensitivity.map(s => [
        fmt(s.rate, 0), fmt(s.bhp, 2), fmt(s.surfaceP, 2),
        s.status === "ok" ? "OK" : s.status === "frac" ? "ГРП ⚠" : "Насос ⚠",
      ]),
    ));
  }

  if (result.recommendations?.length) {
    children.push(sectionTitle("6. Рекомендации"));
    result.recommendations.forEach(r => children.push(bullet(r)));
  }

  await packAndSave(`Acid_Stim_${new Date().toISOString().slice(0, 10)}.docx`, children);
}
