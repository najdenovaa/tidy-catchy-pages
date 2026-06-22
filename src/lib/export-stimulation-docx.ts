/**
 * Экспорт план-программы ОПЗ (модуль интенсификации) в DOCX.
 */
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType,
  BorderStyle, ShadingType,
} from "docx";
import { saveAs } from "file-saver";
import type { StimulationMethod } from "./stimulation-methods";
import { METHOD_CATEGORY_LABEL, COLLECTOR_LABEL } from "./stimulation-methods";
import type { ReservoirData, RankedMethod } from "./stimulation-ranking";
import type { AcidReactionKinetics, AcidTreatmentStages } from "./stimulation-acid";
import type { DamageAssessment, ForecastPoint } from "./foam-treatment-diagnostics";


const fmt = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d);

const BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  left:   { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  right:  { style: BorderStyle.SINGLE, size: 1, color: "999999" },
};

function hCell(text: string): TableCell {
  return new TableCell({
    borders: BORDER,
    shading: { type: ShadingType.CLEAR, fill: "2B3A4A", color: "auto" },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, size: 18, color: "FFFFFF", font: "Calibri" })],
    })],
  });
}
function c(text: string, opts?: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }): TableCell {
  return new TableCell({
    borders: BORDER,
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: opts?.align ?? AlignmentType.LEFT,
      children: [new TextRun({ text, size: 18, bold: opts?.bold, font: "Calibri" })],
    })],
  });
}
function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2): Paragraph {
  return new Paragraph({
    heading: level, spacing: { before: 220, after: 110 },
    children: [new TextRun({ text, font: "Calibri", bold: true })],
  });
}
function textP(text: string, opts?: { bold?: boolean; color?: string }): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 20, font: "Calibri", bold: opts?.bold, color: opts?.color })],
  });
}
function kv(rows: Array<[string, string]>): Table {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [5460, 3900],
    rows: [
      new TableRow({ children: [hCell("Параметр"), hCell("Значение")] }),
      ...rows.map(([k, v]) => new TableRow({ children: [c(k), c(v, { bold: true, align: AlignmentType.CENTER })] })),
    ],
  });
}

export interface StimulationExportBundle {
  reservoir: ReservoirData;
  method: StimulationMethod;
  ranked?: RankedMethod;
  acidVolM3: number;
  damage: DamageAssessment[];
  kinetics: AcidReactionKinetics | null;
  stages: AcidTreatmentStages | null;
  forecast: ForecastPoint[] | null;
  wellName?: string;
}

export async function exportStimulationDocx(b: StimulationExportBundle): Promise<void> {
  const { reservoir, method, ranked, acidVolM3, damage, kinetics, stages, forecast, wellName } = b;

  const children: (Paragraph | Table)[] = [];

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: "ПЛАН-ПРОГРАММА ОБРАБОТКИ ПРИЗАБОЙНОЙ ЗОНЫ", bold: true, size: 32, font: "Calibri" })],
  }));
  if (wellName) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 200 },
      children: [new TextRun({ text: `Скважина: ${wellName}`, size: 22, font: "Calibri" })],
    }));
  }

  // 1. Reservoir
  children.push(heading("1. Данные коллектора"));
  children.push(kv([
    ["Тип коллектора", COLLECTOR_LABEL[reservoir.collectorType]],
    ["Температура пласта, °C", fmt(reservoir.temperatureC, 1)],
    ["Проницаемость, мД", fmt(reservoir.permeability_mD, 2)],
    ["Пористость, д.ед.", fmt(reservoir.porosity, 3)],
    ["Эффективная толщина, м", fmt(reservoir.payZoneM, 1)],
    ["Пластовое давление, МПа", fmt(reservoir.reservoirPressureMPa, 1)],
  ]));

  // 2. Damage
  if (damage.length > 0) {
    children.push(heading("2. Диагностированные механизмы повреждения"));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [3200, 1400, 1400, 3360],
      rows: [
        new TableRow({ children: [hCell("Механизм"), hCell("Вероятность"), hCell("Тяжесть"), hCell("Признаки")] }),
        ...damage.map((d) => new TableRow({ children: [
          c(d.nameRu), c(`${(d.probability * 100).toFixed(0)}%`, { align: AlignmentType.CENTER }),
          c(d.severity, { align: AlignmentType.CENTER }), c(d.evidence),
        ]})),
      ],
    }));
  }

  // 3. Method
  children.push(heading("3. Выбранный метод"));
  children.push(textP(`${method.icon} ${method.nameRu}`, { bold: true }));
  children.push(textP(method.description));
  children.push(kv([
    ["Категория", METHOD_CATEGORY_LABEL[method.category]],
    ["Совместимость (score)", ranked ? `${ranked.score} / 100` : "—"],
    ["Основной реагент", `${method.mainReagent.name} (${method.mainReagent.concentration}%)`],
    ["Объём реагента", `${fmt(acidVolM3, 1)} м³`],
    ["Расход", `${method.recommendedRate[0]}–${method.recommendedRate[1]} л/мин`],
    ["Выдержка", `${method.soakTimeMin[0]}–${method.soakTimeMin[1]} мин`],
    ["Кол-во циклов", String(method.numberOfCycles)],
    ["Ожидаемое ΔS", `-${method.skinReductionRange[0]} … -${method.skinReductionRange[1]}`],
    ["Длительность эффекта", `${method.effectDurationMonths[0]}–${method.effectDurationMonths[1]} мес`],
    ["Успешность", `${method.successRate}%`],
    ["Стоимость реагентов", `${(costEstimate / 1000).toFixed(0)} тыс. руб`],
  ]));

  // 4. Additives
  if (method.additives.length > 0) {
    children.push(heading("4. Рецептура (добавки)"));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [3000, 3500, 1500, 1360],
      rows: [
        new TableRow({ children: [hCell("Добавка"), hCell("Назначение"), hCell("Концентрация"), hCell("Обязат.")] }),
        ...method.additives.map((a) => new TableRow({ children: [
          c(a.name), c(a.purpose), c(`${a.concentration} ${a.unit}`, { align: AlignmentType.CENTER }),
          c(a.required ? "да" : "нет", { align: AlignmentType.CENTER }),
        ]})),
      ],
    }));
  }

  // 5. Stages
  if (stages) {
    children.push(heading("5. Многоступенчатая обработка"));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [2400, 3000, 1560, 2400],
      rows: [
        new TableRow({ children: [hCell("Стадия"), hCell("Реагент"), hCell("Объём, м³"), hCell("Назначение")] }),
        new TableRow({ children: [c("1. Preflush"), c(stages.preflush.fluid), c(fmt(stages.preflush.volumeM3, 2), { align: AlignmentType.CENTER }), c(stages.preflush.purpose)] }),
        new TableRow({ children: [c("2. Основная кислота"), c(stages.mainAcid.fluid), c(fmt(stages.mainAcid.volumeM3, 2), { align: AlignmentType.CENTER }), c(stages.mainAcid.purpose)] }),
        new TableRow({ children: [c("3. Afterflush"), c(stages.afterflush.fluid), c(fmt(stages.afterflush.volumeM3, 2), { align: AlignmentType.CENTER }), c(stages.afterflush.purpose)] }),
        new TableRow({ children: [c("4. Продавка"), c(stages.displacement.fluid), c(fmt(stages.displacement.volumeM3, 2), { align: AlignmentType.CENTER }), c("Доставка в пласт")] }),
        new TableRow({ children: [c("ИТОГО", { bold: true }), c(""), c(fmt(stages.totalVolumeM3, 2), { bold: true, align: AlignmentType.CENTER }), c("")] }),
      ],
    }));
  }

  // 6. Kinetics
  if (kinetics) {
    children.push(heading("6. Кинетика и проникновение"));
    children.push(kv([
      ["Скорость реакции, моль/(м²·с)", kinetics.reactionRate.toExponential(2)],
      ["Радиус проникновения, м", fmt(kinetics.penetrationRadius, 2)],
      ["Длина wormhole, м", fmt(kinetics.wormholeLength, 2)],
      ["Объём растворённой породы, м³", fmt(kinetics.dissolutionVolume, 2)],
      ["Отработано кислоты, м³", fmt(kinetics.spentAcidVolume, 2)],
      ["Остаточная концентрация, %", fmt(kinetics.residualAcidConcentration, 1)],
    ]));
  }

  // 7. Operation steps
  children.push(heading("7. Последовательность операций"));
  const steps = [
    "Подготовка устья, опрессовка линий на 1.5×Pзак",
    "Закачка preflush (если применимо)",
    `Закачка основного реагента на ${method.recommendedRate[0]}–${method.recommendedRate[1]} л/мин`,
    ...(method.requiresN2 ? [`Поддержание FQ = ${method.targetFoamQuality}% по линии N₂`] : []),
    "Продавка скважинной жидкостью",
    `Выдержка ${method.soakTimeMin[0]}–${method.soakTimeMin[1]} мин`,
    ...(method.numberOfCycles > 1 ? [`Повтор циклов ×${method.numberOfCycles}`] : []),
    "Вызов притока, освоение, контроль дебита",
  ];
  steps.forEach((s, i) => children.push(textP(`${i + 1}. ${s}`)));

  // 8. Risks
  if (method.risks.length || method.contraindications.length) {
    children.push(heading("8. Риски и противопоказания"));
    method.risks.forEach((r) => children.push(textP(`• ${r}`)));
    method.contraindications.forEach((c) => children.push(textP(`✗ Противопоказано: ${c}`, { color: "C0392B" })));
  }

  // 9. Forecast
  if (forecast && forecast.length > 0) {
    children.push(heading("9. Прогноз дебита (36 мес)"));
    const sample = forecast.filter((_, i) => i % 3 === 0);
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [1800, 2400, 2400, 2760],
      rows: [
        new TableRow({ children: [hCell("Мес"), hCell("Baseline, м³/сут"), hCell("Treated, м³/сут"), hCell("Накоп. ΔQ, м³")] }),
        ...sample.map((p) => new TableRow({ children: [
          c(String(p.month), { align: AlignmentType.CENTER }),
          c(fmt(p.qBaseline, 1), { align: AlignmentType.CENTER }),
          c(fmt(p.qTreated, 1), { align: AlignmentType.CENTER }),
          c(fmt(p.cumulativeDeltaM3, 0), { align: AlignmentType.CENTER }),
        ]})),
      ],
    }));
  }

  // 10. Economics
  if (economics) {
    children.push(heading("10. Экономика"));
    children.push(kv([
      ["Полная стоимость, руб", fmt(economics.totalCost, 0)],
      ["Прирост добычи, м³", fmt(economics.incrementalOilM3, 0)],
      ["Доход, руб", fmt(economics.incrementalRevenue, 0)],
      ["Чистая прибыль, руб", fmt(economics.netProfit, 0)],
      ["ROI, %", fmt(economics.roi, 1)],
      ["NPV, руб", fmt(economics.npv, 0)],
      ["Срок окупаемости, мес", economics.paybackMonths === null ? "не окупается" : String(economics.paybackMonths)],
    ]));
  }

  children.push(new Paragraph({
    spacing: { before: 300 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Расчёты носят информационный характер. DeAllsoft — виртуальный инженерный помощник.", size: 16, italics: true, color: "666666", font: "Calibri" })],
  }));

  const doc = new Document({
    creator: "DeAllsoft",
    title: "План-программа ОПЗ",
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `Stimulation_${(wellName || "well").replace(/[^\w]/g, "_")}_${new Date().toISOString().slice(0, 10)}.docx`);
}
