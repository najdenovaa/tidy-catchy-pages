/**
 * Экспорт результатов пенообработки ПЗП + диагностики в DOCX.
 */
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType,
  BorderStyle, ShadingType,
} from "docx";
import { saveAs } from "file-saver";
import type {
  FoamTreatmentWellData, FoamTreatmentRecipe, FoamTreatmentOptions,
  FoamTreatmentResult,
} from "./foam-treatment-calculations";
import type {
  DamageAssessment, WaterfallStage, StepRateInterpretation,
  SkinDecomposition, IPRResult,
} from "./foam-treatment-diagnostics";

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

function kvRow(label: string, value: string): TableRow {
  return new TableRow({ children: [c(label), c(value, { bold: true, align: AlignmentType.CENTER })] });
}

function kvTable(rows: TableRow[]): Table {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [5460, 3900],
    rows: [
      new TableRow({ children: [hCell("Параметр"), hCell("Значение")] }),
      ...rows,
    ],
  });
}

/* ───────── Bundle типы для экспорта ───────── */

export interface FoamDiagnosticsBundle {
  ipr: IPRResult;
  iprAfterFE: number;     // flow efficiency after
  skinDecomp: SkinDecomposition;
  skinBefore: number;
  skinAfter: number;
  damage: DamageAssessment[];
  arps: { qi: number; di: number; b: number; r2: number; type: string };
  forecast: { incrementalOilM3: number; firstYearBoostPct: number };
  economics?: { totalCost: number; netProfit: number; roi: number; npv: number; paybackMonths: number | null };
  waterfall: WaterfallStage[];
  srt: StepRateInterpretation;
  injectivityBefore: number;
  injectivityAfter: number;
  mrf: number;
  penetrationRadiusM: number | null;
}

export interface FoamTreatmentExportData {
  well: FoamTreatmentWellData;
  recipe: FoamTreatmentRecipe;
  opts: FoamTreatmentOptions;
  result: FoamTreatmentResult;
  diag?: FoamDiagnosticsBundle | null;
}

/* ───────── Генерация документа ───────── */

export async function exportFoamTreatmentDocx(data: FoamTreatmentExportData, filename = "Пенообработка_ПЗП.docx") {
  const { well, recipe, opts, result, diag } = data;
  const children: (Paragraph | Table)[] = [];

  // ── Заголовок ──
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: "ПЕНООБРАБОТКА ПРИЗАБОЙНОЙ ЗОНЫ ПЛАСТА (ОПЗ)", bold: true, size: 30, font: "Calibri" })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 240 },
    children: [new TextRun({ text: `Сформировано: ${new Date().toLocaleString("ru-RU")}`, italics: true, size: 18, font: "Calibri", color: "666666" })],
  }));

  // ── 1. Скважина и пласт ──
  children.push(heading("1. Исходные данные по скважине и пласту"));
  children.push(kvTable([
    kvRow("Глубина скважины, м", fmt(well.wellDepthMD, 0)),
    kvRow("ID эксп. колонны, мм", fmt(well.casingID_mm, 0)),
    kvRow("НКТ OD/ID, мм", `${fmt(well.nktOD_mm, 0)} / ${fmt(well.nktID_mm, 0)}`),
    kvRow("Спуск НКТ, м", fmt(well.nktDepthMD, 0)),
    kvRow("Перфорация, м", `${fmt(well.perfIntervalTopMD, 0)} – ${fmt(well.perfIntervalBottomMD, 0)}`),
    kvRow("Эфф. толщина h, м", fmt(well.netPayM, 1)),
    kvRow("Проницаемость k, мД", fmt(well.permeability_mD, 1)),
    kvRow("Пористость φ", fmt(well.porosity, 3)),
    kvRow("Пластовое давление, МПа", fmt(well.reservoirPressureMPa, 1)),
    kvRow("Пластовая температура, °C", fmt(well.reservoirTemperatureC, 0)),
    kvRow("Скин-фактор S", fmt(well.skinFactor, 1)),
    kvRow("Давление разрыва, МПа", fmt(well.fracturePressureMPa, 1)),
  ]));

  // ── 2. Рецептура ──
  children.push(heading("2. Технология и рецептура обработки"));
  children.push(textP(`Рецепт: ${recipe.nameRu}`, { bold: true }));
  children.push(textP(recipe.description));
  children.push(kvTable([
    kvRow("Тип", recipe.type),
    kvRow("Целевое FQ, %", fmt(recipe.targetFoamQuality, 0)),
    kvRow("Макс. температура, °C", fmt(recipe.maxTempC, 0)),
    kvRow("ПАВ, %", fmt(recipe.surfactantConc, 2)),
    kvRow("Базовая жидкость", recipe.baseFluidType),
    kvRow("Циклов закачка/выдержка", fmt(opts.numberOfCycles, 0)),
    kvRow("Время выдержки, мин", fmt(opts.soakTimeMin, 0)),
    kvRow("Темп закачки, л/с", fmt(opts.injectionRateLps, 1)),
  ]));

  if (recipe.additives.length > 0) {
    children.push(textP("Добавки:", { bold: true }));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [4680, 2340, 2340],
      rows: [
        new TableRow({ children: [hCell("Реагент"), hCell("Назначение"), hCell("Концентрация")] }),
        ...recipe.additives.map((a) => new TableRow({
          children: [c(a.name), c(a.purpose), c(`${fmt(a.concentration, 2)} ${a.unit}`, { align: AlignmentType.CENTER })],
        })),
      ],
    }));
  }

  // ── 3. Результаты расчёта ──
  children.push(heading("3. Результаты расчёта операции"));
  children.push(kvTable([
    kvRow("Общий объём раствора, м³", fmt(result.treatmentVolumeM3, 2)),
    kvRow("Объём пены на устье, м³", fmt(result.foamVolumeAtSurfaceM3, 2)),
    kvRow("Объём пены на забое, м³", fmt(result.foamVolumeAtFormationM3, 2)),
    kvRow("Объём N₂ (станд. усл.), м³", fmt(result.n2VolumeStdM3, 0)),
    kvRow("FQ на забое, %", fmt(result.foamQualityAtFormation, 0)),
    kvRow("Плотность пены на забое, кг/м³", fmt(result.foamDensityAtFormation, 0)),
    kvRow("Радиус проникновения, м", fmt(result.penetrationRadiusM, 2)),
    kvRow("Давление закачки, МПа", fmt(result.injectionPressureMPa, 1)),
    kvRow("Запас до P_ГРП, МПа", fmt(result.pressureMarginMPa, 1)),
    kvRow("Время операции, мин", fmt(result.totalTreatmentTimeMin, 0)),
    kvRow("Ожидаемое снижение скина ΔS", fmt(result.expectedSkinReduction, 2)),
    kvRow("Прогноз прироста дебита, %", fmt(result.expectedProductionIncreasePct, 0)),
  ]));

  // ── 4. Диагностика ──
  if (diag) {
    children.push(heading("4. Диагностика и продуктивность"));
    children.push(textP("4.1. Продуктивность (IPR)", { bold: true }));
    children.push(kvTable([
      kvRow("J идеальная, м³/(сут·МПа)", fmt(diag.ipr.J_ideal, 2)),
      kvRow("J фактическая, м³/(сут·МПа)", fmt(diag.ipr.J_actual, 2)),
      kvRow("Flow efficiency, %", fmt(diag.ipr.flowEfficiency * 100, 0)),
      kvRow("AOF (до), м³/сут", fmt(diag.ipr.qMax_vogel, 1)),
      kvRow("Индекс приёмистости до, м³/(сут·МПа)", fmt(diag.injectivityBefore, 2)),
      kvRow("Индекс приёмистости после, м³/(сут·МПа)", fmt(diag.injectivityAfter, 2)),
      kvRow("MRF пены", `×${fmt(diag.mrf, 2)}`),
      kvRow("Радиус проникновения, м", fmt(diag.penetrationRadiusM, 2)),
    ]));

    children.push(textP("4.2. Декомпозиция скина (Hawkins / Cinco-Ley)", { bold: true }));
    children.push(kvTable([
      kvRow("Полный скин S", fmt(diag.skinDecomp.totalSkin, 2)),
      kvRow("Скин повреждения ПЗП", fmt(diag.skinDecomp.skinDamage, 2)),
      kvRow("Механический (перфорация)", fmt(diag.skinDecomp.skinMechanical, 2)),
      kvRow("От наклона ствола", fmt(diag.skinDecomp.skinDeviation, 2)),
      kvRow("Псевдоскин (турбулентность)", fmt(diag.skinDecomp.skinPseudo, 2)),
      kvRow("Радиус зоны повреждения r_d, м", fmt(diag.skinDecomp.damagedZoneRadius, 2)),
      kvRow("Проницаемость в зоне k_d, мД", fmt(diag.skinDecomp.damagedPermeability, 1)),
      kvRow("Отношение k/k_d", fmt(diag.skinDecomp.damageRatio, 2)),
    ]));

    if (diag.damage.length > 0) {
      children.push(textP("4.3. Вероятные механизмы повреждения ПЗП", { bold: true }));
      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [3500, 1300, 1300, 3260],
        rows: [
          new TableRow({ children: [hCell("Механизм"), hCell("Вероятн., %"), hCell("Тяжесть"), hCell("Признаки")] }),
          ...diag.damage.map((d) => new TableRow({
            children: [c(d.nameRu), c(fmt(d.probability * 100, 0), { align: AlignmentType.CENTER }), c(d.severity, { align: AlignmentType.CENTER }), c(d.evidence)],
          })),
        ],
      }));
    }
  }

  // ── 5. Waterfall ──
  if (diag && diag.waterfall.length > 0) {
    children.push(heading("5. Поэтапное снятие скина (Hawkins waterfall)"));
    children.push(textP(`Скин до обработки: ${fmt(diag.skinBefore, 2)} → После: ${fmt(diag.skinAfter, 2)}`, { bold: true }));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [3000, 1500, 1500, 1500, 1860],
      rows: [
        new TableRow({ children: [hCell("Этап"), hCell("ΔS"), hCell("S после"), hCell("k_ПЗП, мД"), hCell("Механизм")] }),
        ...diag.waterfall.map((s) => new TableRow({
          children: [
            c(s.label),
            c(fmt(s.delta, 2), { align: AlignmentType.CENTER }),
            c(fmt(s.skinAfter, 2), { align: AlignmentType.CENTER }),
            c(fmt(s.effectivePermeability, 1), { align: AlignmentType.CENTER }),
            c(s.mechanism),
          ],
        })),
      ],
    }));
  }

  // ── 6. Прогноз и экономика ──
  if (diag) {
    children.push(heading("6. Прогноз добычи и экономика"));
    children.push(textP(`Кривая падения Арпса: тип ${diag.arps.type}, b = ${fmt(diag.arps.b, 2)}, di = ${fmt(diag.arps.di * 12, 3)} 1/год, R² = ${fmt(diag.arps.r2, 2)}.`));
    children.push(kvTable([
      kvRow("Доп. добыча за 36 мес, м³", fmt(diag.forecast.incrementalOilM3, 0)),
      kvRow("Прирост дебита 1-го года, %", fmt(diag.forecast.firstYearBoostPct, 0)),
      kvRow("Затраты, ₽", fmt(diag.economics.totalCost, 0)),
      kvRow("Чистая прибыль, ₽", fmt(diag.economics.netProfit, 0)),
      kvRow("ROI, %", fmt(diag.economics.roi, 0)),
      kvRow("NPV, ₽", fmt(diag.economics.npv, 0)),
      kvRow("Окупаемость, мес", diag.economics.paybackMonths !== null ? String(diag.economics.paybackMonths) : "не достигнута"),
    ]));
  }

  // ── 7. SRT ──
  if (diag && diag.srt.verdict !== "insufficient_data") {
    children.push(heading("7. Step-Rate Test — давление разрыва пласта"));
    children.push(textP(diag.srt.verdictText));
    children.push(kvTable([
      kvRow("Давление разрыва FPP, МПа", fmt(diag.srt.formationPartingPressure, 1)),
      kvRow("Расход при FPP, м³/сут", fmt(diag.srt.fppRate, 0)),
      kvRow("Безопасный максимум, МПа", fmt(diag.srt.safeMaxPressure, 1)),
      kvRow("Безопасный максимум расхода, м³/сут", fmt(diag.srt.safeMaxRate, 0)),
      kvRow("Наклон матричный, МПа/(м³/сут)", fmt(diag.srt.matrixSlope, 3)),
      kvRow("Наклон трещинный", fmt(diag.srt.fractureSlope, 3)),
      kvRow("Индекс приёмистости (матр.)", fmt(diag.srt.matrixInjectivity, 2)),
    ]));
  }

  // ── Footer ──
  children.push(new Paragraph({
    spacing: { before: 400 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Расчёты носят информационный характер. Соответствует требованиям ФЗ-152.", italics: true, size: 16, color: "888888", font: "Calibri" })],
  }));

  const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, filename);
}
