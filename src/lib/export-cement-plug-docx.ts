/**
 * Export cement plug calculation to Word (DOCX).
 */
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType,
  BorderStyle, ShadingType, ImageRun, PageBreak,
} from "docx";
import { saveAs } from "file-saver";
import { dataUrlToArrayBuffer } from "./capture-image";
import type { PlugInputs, PlugResults } from "./cement-plug-calculations";
import type { TrajectoryPoint } from "./cementing-calculations";

const fmt = (v: number, dec = 2) => v.toFixed(dec);

const BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  left: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  right: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
};

function hCell(text: string, width?: number): TableCell {
  return new TableCell({
    borders: BORDER,
    shading: { type: ShadingType.SOLID, color: "2B3A4A" },
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, size: 18, color: "FFFFFF", font: "Calibri" })],
    })],
  });
}

function c(text: string, opts?: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }): TableCell {
  return new TableCell({
    borders: BORDER,
    children: [new Paragraph({
      alignment: opts?.align ?? AlignmentType.LEFT,
      children: [new TextRun({ text, size: 18, bold: opts?.bold, font: "Calibri" })],
    })],
  });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_2): Paragraph {
  return new Paragraph({ heading: level, spacing: { before: 200, after: 100 }, children: [new TextRun({ text, font: "Calibri", bold: true })] });
}

function textP(text: string, opts?: { bold?: boolean }): Paragraph {
  return new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text, size: 20, font: "Calibri", bold: opts?.bold })] });
}

function kvRow(label: string, value: string): TableRow {
  return new TableRow({ children: [c(label), c(value, { bold: true, align: AlignmentType.CENTER })] });
}

function imageFromDataUrl(dataUrl: string, w: number, h: number): Paragraph {
  const buf = dataUrlToArrayBuffer(dataUrl);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new ImageRun({ data: buf, transformation: { width: w, height: h } })],
  });
}

export interface CementPlugExportData {
  inputs: PlugInputs;
  results: PlugResults;
  fracGradient: number;
  wcRatio: number;
  slurryYield: number;
  additives: { name: string; percent: number }[];
  spacerAdditives: { name: string; percent: number }[];
  trajPoints: TrajectoryPoint[];
  visualizationImage?: string; // data URL
  pressureChartImage?: string; // data URL
}

export async function exportCementPlugToDocx(data: CementPlugExportData) {
  const { inputs, results, fracGradient, wcRatio, slurryYield, additives, spacerAdditives, trajPoints } = data;
  const { well, plug, cement, spacer, wellFluid } = inputs;

  const sections: Paragraph[] = [];

  // ─── Title ───
  sections.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    children: [new TextRun({ text: "ПРОГРАММА УСТАНОВКИ ЦЕМЕНТНОГО МОСТА", bold: true, size: 32, font: "Calibri" })],
  }));

  // ─── 1. Well Data ───
  sections.push(heading("1. Данные скважины"));
  sections.push(new Paragraph({
    children: [],
  }));

  const wellTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
      kvRow("Глубина скважины (MD)", `${fmt(well.wellDepthMD, 1)} м`),
      kvRow("Диаметр ствола", `${fmt(well.holeDiameter, 1)} мм`),
      kvRow("Башмак обсадной колонны (MD)", `${fmt(well.casingShoe, 1)} м`),
      kvRow("Вн. диаметр обсадной колонны", `${fmt(well.casingID, 1)} мм`),
      kvRow("Нар. диаметр бурильных труб", `${fmt(well.pipeOD, 1)} мм`),
      kvRow("Вн. диаметр бурильных труб", `${fmt(well.pipeID, 1)} мм`),
      kvRow("Коэфф. кавернозности", fmt(well.cavernCoeff, 2)),
      kvRow("Градиент ГРП", `${fmt(fracGradient, 4)} МПа/м`),
    ],
  });
  sections.push(new Paragraph({ children: [] }));

  // ─── 2. Trajectory ───
  sections.push(heading("2. Инклинометрия"));
  const trajRows = [new TableRow({ children: [hCell("MD, м"), hCell("Азимут, °"), hCell("Зенит, °"), hCell("TVD, м")] })];
  for (const p of trajPoints) {
    trajRows.push(new TableRow({
      children: [
        c(fmt(p.md, 1), { align: AlignmentType.CENTER }),
        c(fmt(p.azimuth, 1), { align: AlignmentType.CENTER }),
        c(fmt(p.zenith, 1), { align: AlignmentType.CENTER }),
        c(fmt(p.tvd, 1), { align: AlignmentType.CENTER }),
      ],
    }));
  }
  const trajTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: trajRows });

  // ─── 3. Plug Interval ───
  sections.push(heading("3. Интервал моста"));
  const plugTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
      kvRow("Верх моста (MD)", `${fmt(plug.topMD, 1)} м`),
      kvRow("Низ моста (MD)", `${fmt(plug.bottomMD, 1)} м`),
      kvRow("Длина моста (MD)", `${fmt(results.plugLengthMD, 1)} м`),
      kvRow("Длина моста (TVD)", `${fmt(results.plugLengthTVD, 1)} м`),
      kvRow("Верх моста (TVD)", `${fmt(results.plugTopTVD, 1)} м`),
      kvRow("Низ моста (TVD)", `${fmt(results.plugBottomTVD, 1)} м`),
    ],
  });

  // ─── 4. Fluids ───
  sections.push(heading("4. Растворы и жидкости"));
  const fluidsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [hCell("Жидкость"), hCell("Плотность, г/см³"), hCell("PV, сПз"), hCell("YP, Па")] }),
      new TableRow({ children: [c(cement.name, { bold: true }), c(fmt(cement.density, 2), { align: AlignmentType.CENTER }), c(fmt(cement.rheology.pv, 0), { align: AlignmentType.CENTER }), c(fmt(cement.rheology.yp, 0), { align: AlignmentType.CENTER })] }),
      new TableRow({ children: [c(spacer.name, { bold: true }), c(fmt(spacer.density, 2), { align: AlignmentType.CENTER }), c(fmt(spacer.rheology.pv, 0), { align: AlignmentType.CENTER }), c(fmt(spacer.rheology.yp, 0), { align: AlignmentType.CENTER })] }),
      new TableRow({ children: [c(wellFluid.name, { bold: true }), c(fmt(wellFluid.density, 2), { align: AlignmentType.CENTER }), c(fmt(wellFluid.rheology.pv, 0), { align: AlignmentType.CENTER }), c(fmt(wellFluid.rheology.yp, 0), { align: AlignmentType.CENTER })] }),
    ],
  });

  // ─── 5. Recipe ───
  sections.push(heading("5. Рецептура цементного раствора"));
  const dryMass = results.cementVolumeTotal / slurryYield;
  const waterMass = dryMass * wcRatio;
  const recipeRows = [
    new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
    kvRow("В/Ц", fmt(wcRatio, 2)),
    kvRow("Выход раствора", `${fmt(slurryYield, 2)} м³/т`),
    kvRow("Сухой цемент", `${fmt(dryMass * 1000, 0)} кг`),
    kvRow("Вода затворения", `${fmt(waterMass * 1000, 0)} кг`),
  ];
  for (const add of additives.filter(a => a.percent > 0)) {
    recipeRows.push(kvRow(add.name, `${fmt(dryMass * 1000 * add.percent / 100, 1)} кг (${add.percent}%)`));
  }
  const recipeTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: recipeRows });

  // Spacer materials
  const spacerTotalVol = results.spacerVolumeAbove + results.spacerVolumeBelow;
  const spacerMassKg = spacerTotalVol * spacer.density * 1000;
  const spacerRows = [
    new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
    kvRow("Объём буфера (всего)", `${fmt(spacerTotalVol, 3)} м³`),
    kvRow("Масса буфера", `${fmt(spacerMassKg, 0)} кг`),
  ];
  for (const add of spacerAdditives.filter(a => a.percent > 0)) {
    spacerRows.push(kvRow(add.name, `${fmt(spacerMassKg * add.percent / 100, 1)} кг (${add.percent}%)`));
  }
  const spacerMatTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: spacerRows });

  // ─── 6. Volumes ───
  sections.push(heading("6. Результаты расчёта объёмов"));
  const volTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
      kvRow("S затрубья", `${fmt(results.annArea * 1e4, 1)} см²`),
      kvRow("S трубы", `${fmt(results.pipeArea * 1e4, 1)} см²`),
      ...(results.isOpenHole ? [kvRow("Эфф. диаметр (Kкав)", `${fmt(results.boreDiamUsed, 1)} мм (${fmt(results.cavernCoeff, 2)})`)] : []),
      kvRow("Цемент (затрубье)", `${fmt(results.cementVolumeAnn, 3)} м³`),
      kvRow("Цемент (трубы)", `${fmt(results.cementVolumePipe, 3)} м³`),
      kvRow("Цемент ИТОГО", `${fmt(results.cementVolumeTotal, 3)} м³`),
      kvRow("Высота цем. (затрубье)", `${fmt(results.cementHeightAnnMD, 1)} м`),
      kvRow("Высота цем. (трубы)", `${fmt(results.cementHeightPipeMD, 1)} м`),
      kvRow("Буфер сверху", `${fmt(results.spacerVolumeAbove, 3)} м³`),
      kvRow("↕ Интервал буфера сверху", `${fmt(results.spacerAboveHeightAnnMD, 1)} м`),
      kvRow("Буфер снизу", `${fmt(results.spacerVolumeBelow, 3)} м³`),
      kvRow("↕ Интервал буфера снизу", `${fmt(results.spacerBelowHeightAnnMD, 1)} м`),
      kvRow("Объём продавки", `${fmt(results.displacementVolume, 3)} м³`),
    ],
  });

  // ─── 7. Pressures ───
  sections.push(heading("7. Статические давления"));
  const pressTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
      kvRow("P статич. затрубье", `${fmt(results.pressureAnnulus, 2)} МПа`),
      kvRow("P статич. трубы", `${fmt(results.pressurePipe, 2)} МПа`),
      kvRow("ΔP", `${fmt(Math.abs(results.pressureAnnulus - results.pressurePipe), 2)} МПа`),
      kvRow("Баланс", results.isBalanced ? "✓ Сбалансировано" : "⚠ Дисбаланс"),
    ],
  });

  // ─── 8. Pumping Schedule ───
  sections.push(heading("8. Порядок работ"));
  const stageRows = [new TableRow({ children: [hCell("№"), hCell("Этап"), hCell("Жидкость"), hCell("Объём, м³"), hCell("Время, мин"), hCell("Описание")] })];
  results.pumpingStages.forEach((s, i) => {
    stageRows.push(new TableRow({
      children: [
        c(String(i + 1), { align: AlignmentType.CENTER }),
        c(s.name, { bold: true }),
        c(s.fluid),
        c(s.volumeM3 > 0 ? fmt(s.volumeM3, 3) : "—", { align: AlignmentType.CENTER }),
        c(s.timeMin > 0 ? fmt(s.timeMin, 1) : "—", { align: AlignmentType.CENTER }),
        c(s.description),
      ],
    }));
  });
  const stageTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: stageRows });

  // ─── 9. Timing ───
  sections.push(heading("9. Хронометраж операции"));
  const timingRows = [
    new TableRow({ children: [hCell("Этап", 60), hCell("Время, мин", 40)] }),
    kvRow("Закачка цемента", fmt(results.pumpTimeCementMin, 1)),
  ];
  if (results.pumpTimeSpacerAboveMin > 0) timingRows.push(kvRow("Закачка верх. буфера", fmt(results.pumpTimeSpacerAboveMin, 1)));
  timingRows.push(
    kvRow("Продавка", fmt(results.pumpTimeDisplacementMin, 1)),
    kvRow("Подъём инструмента", fmt(results.tripTimeMin, 1)),
    kvRow("Промывка", fmt(results.washTimeMin, 1)),
    kvRow("ИТОГО", fmt(results.totalOperationTimeMin, 1)),
    kvRow("Загустевание (50Bc)", fmt(results.thickeningTimeMin, 0)),
    kvRow("Безопасное время (0.75×50Bc)", fmt(results.safeTimeMin, 0)),
  );
  const timingTable = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: timingRows });

  // ─── 10. Process Parameters ───
  sections.push(heading("10. Параметры процесса"));
  const processParamsTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
      kvRow("Q цемент", `${fmt(inputs.pumpRateCementLs, 1)} л/с`),
      kvRow("Q буфер", `${fmt(inputs.pumpRateSpacerLs, 1)} л/с`),
      kvRow("Q продавка", `${fmt(inputs.pumpRateDisplacementLs, 1)} л/с`),
      kvRow("Q промывка", `${fmt(inputs.pumpRateWashLs, 1)} л/с`),
      kvRow("Подъём над кровлей моста", `${fmt(inputs.pullOutAbovePlugM, 0)} м`),
      kvRow("Кол-во циклов промывки", String(inputs.washCycles)),
      kvRow("Скорость подъёма", `${fmt(inputs.tripSpeedMs, 2)} м/с`),
      kvRow("Тип промывки", inputs.washType === 'direct' ? 'Прямая' : 'Обратная'),
    ],
  });

  // ─── 11. Process Description ───
  sections.push(heading("11. Описание процесса"));

  // ─── Build document ───
  const children: (Paragraph | Table)[] = [
    ...sections.slice(0, 1), // title
    sections[1], // heading 1
    wellTable,
    sections[2], // heading 2
    trajTable,
    sections[3], // heading 3
    plugTable,
    sections[4], // heading 4
    fluidsTable,
    sections[5], // heading 5
    recipeTable,
    textP("Материалы буферной жидкости:", { bold: true }),
    spacerMatTable,
    sections[6], // heading 6
    volTable,
    textP(results.heightDifferenceExplanation),
    sections[7], // heading 7
    pressTable,
    sections[8], // heading 8
    stageTable,
    sections[9], // heading 9
    timingTable,
    textP(results.isTimeSafe
      ? `✅ Запас времени: ${fmt(results.safeTimeMin - results.totalOperationTimeMin, 1)} мин`
      : `⛔ Превышение безопасного времени на ${fmt(results.totalOperationTimeMin - results.safeTimeMin, 1)} мин!`, { bold: true }),
    sections[10], // heading 10
    processParamsTable,
    sections[11], // heading 11
  ];

  // Process description paragraphs
  const descLines = results.processDescription.split('\n').filter(l => l.trim());
  for (const line of descLines) {
    children.push(textP(line));
  }

  // Images
  if (data.visualizationImage) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(heading("12. Продольное сечение"));
    children.push(imageFromDataUrl(data.visualizationImage, 450, 600));
  }

  if (data.pressureChartImage) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(heading("13. Совмещённый график давлений"));
    children.push(imageFromDataUrl(data.pressureChartImage, 580, 350));
  }

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, "Цементный_мост_программа.docx");
}
