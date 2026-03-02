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
import type { PlugInputs, PlugResults, PipeSection, InterfaceContamination } from "./cement-plug-calculations";
import type { StabilityResult } from "./cement-plug-stability";
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

function textP(text: string, opts?: { bold?: boolean; color?: string }): Paragraph {
  return new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text, size: 20, font: "Calibri", bold: opts?.bold, color: opts?.color })] });
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
  viscousPadAdditives?: { name: string; percent: number }[];
  trajPoints: TrajectoryPoint[];
  wocTimeHours: number;
  visualizationImage?: string;
  pressureChartImage?: string;
}

export async function exportCementPlugToDocx(data: CementPlugExportData) {
  const { inputs, results, fracGradient, wcRatio, slurryYield, additives, spacerAdditives, viscousPadAdditives, trajPoints } = data;
  const { well, plug, cement, spacer, wellFluid } = inputs;
  const padFluid = inputs.viscousPadFluid || spacer;
  const stability = results.stability;

  const children: (Paragraph | Table)[] = [];

  // ─── Title ───
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
    children: [new TextRun({ text: "ПРОГРАММА УСТАНОВКИ ЦЕМЕНТНОГО МОСТА", bold: true, size: 32, font: "Calibri" })],
  }));

  // ─── 1. Well Data ───
  children.push(heading("1. Данные скважины"));
  const wellRows = [
    new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
    kvRow("Глубина скважины (MD)", `${fmt(well.wellDepthMD, 1)} м`),
    kvRow("Диаметр ствола", `${fmt(well.holeDiameter, 1)} мм`),
    kvRow("Башмак обсадной колонны (MD)", `${fmt(well.casingShoe, 1)} м`),
    kvRow("Вн. диаметр обсадной колонны", `${fmt(well.casingID, 1)} мм`),
    kvRow("Нар. диаметр бурильных труб", `${fmt(well.pipeOD, 1)} мм`),
    kvRow("Вн. диаметр бурильных труб", `${fmt(well.pipeID, 1)} мм`),
    kvRow("Коэфф. кавернозности", fmt(well.cavernCoeff, 2)),
    kvRow("Градиент ГРП", `${fmt(fracGradient, 4)} МПа/м`),
  ];
  if (results.isOpenHole) {
    wellRows.push(kvRow("Эфф. диаметр (Kкав)", `${fmt(results.boreDiamUsed, 1)} мм`));
  }
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: wellRows }));

  // ─── 2. Pipe Sections ───
  if (results.pipeSectionsUsed && results.pipeSectionsUsed.length > 1) {
    children.push(heading("2. Компоновка инструмента"));
    const psRows = [new TableRow({ children: [hCell("Название"), hCell("От, м MD"), hCell("До, м MD"), hCell("Нар. ∅, мм"), hCell("Вн. ∅, мм")] })];
    for (const s of results.pipeSectionsUsed) {
      psRows.push(new TableRow({
        children: [
          c(s.name || "—", { bold: true }),
          c(fmt(s.fromMD, 0), { align: AlignmentType.CENTER }),
          c(fmt(s.toMD, 0), { align: AlignmentType.CENTER }),
          c(fmt(s.od, 1), { align: AlignmentType.CENTER }),
          c(fmt(s.id, 1), { align: AlignmentType.CENTER }),
        ],
      }));
    }
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: psRows }));
  }

  // ─── 3. Trajectory ───
  children.push(heading("3. Инклинометрия"));
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
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: trajRows }));

  // ─── 4. Plug Interval ───
  children.push(heading("4. Интервал моста"));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
      kvRow("Верх моста (MD)", `${fmt(plug.topMD, 1)} м`),
      kvRow("Низ моста (MD)", `${fmt(plug.bottomMD, 1)} м`),
      kvRow("Длина моста (MD)", `${fmt(results.plugLengthMD, 1)} м`),
      kvRow("Длина моста (TVD)", `${fmt(results.plugLengthTVD, 1)} м`),
      kvRow("Верх моста (TVD)", `${fmt(results.plugTopTVD, 1)} м`),
      kvRow("Низ моста (TVD)", `${fmt(results.plugBottomTVD, 1)} м`),
      kvRow("Зенитный угол в интервале моста", `${fmt(results.plugZenithDeg, 1)}°`),
    ],
  }));

  // ─── 5. Fluids (with gel strengths) ───
  children.push(heading("5. Растворы и жидкости"));
  const fluidHeaderRow = new TableRow({ children: [
    hCell("Жидкость"), hCell("ρ, г/см³"), hCell("PV, сПз"), hCell("YP, Па"),
    hCell("СНС 10с, Па"), hCell("СНС 10мин, Па"),
  ]});

  const fluidRow = (f: typeof cement, nameOverride?: string) => new TableRow({
    children: [
      c(nameOverride || f.name, { bold: true }),
      c(fmt(f.density, 2), { align: AlignmentType.CENTER }),
      c(fmt(f.rheology.pv, 0), { align: AlignmentType.CENTER }),
      c(fmt(f.rheology.yp, 0), { align: AlignmentType.CENTER }),
      c(fmt(f.gel10sec || 0, 0), { align: AlignmentType.CENTER }),
      c(fmt(f.gel10min || 0, 0), { align: AlignmentType.CENTER }),
    ],
  });

  const fluidRows = [fluidHeaderRow, fluidRow(cement), fluidRow(spacer)];
  if (inputs.useViscousPad) {
    fluidRows.push(fluidRow(padFluid, padFluid.name + " (вязк. пачка)"));
  }
  fluidRows.push(fluidRow(wellFluid));
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: fluidRows }));

  // ─── 6. Recipe ───
  children.push(heading("6. Рецептура цементного раствора"));
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
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: recipeRows }));

  // Spacer materials
  const spacerVolAbove = results.spacerVolumeAbove;
  const spacerMassKg = spacerVolAbove * spacer.density * 1000;
  const spacerRows = [
    new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
    kvRow("Объём верхнего буфера", `${fmt(spacerVolAbove, 3)} м³`),
    kvRow("Масса буфера", `${fmt(spacerMassKg, 0)} кг`),
  ];
  for (const add of spacerAdditives.filter(a => a.percent > 0)) {
    spacerRows.push(kvRow(add.name, `${fmt(spacerMassKg * add.percent / 100, 1)} кг (${add.percent}%)`));
  }
  children.push(textP("Материалы буферной жидкости:", { bold: true }));
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: spacerRows }));

  // Viscous pad materials
  if (inputs.useViscousPad && results.spacerVolumeBelow > 0) {
    const padVol = results.spacerVolumeBelow;
    const padMassKg = padVol * padFluid.density * 1000;
    const padRows = [
      new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
      kvRow("Объём вязкой пачки", `${fmt(padVol, 3)} м³`),
      kvRow("Масса вязкой пачки", `${fmt(padMassKg, 0)} кг`),
    ];
    for (const add of (viscousPadAdditives || []).filter(a => a.percent > 0)) {
      padRows.push(kvRow(add.name, `${fmt(padMassKg * add.percent / 100, 1)} кг (${add.percent}%)`));
    }
    children.push(textP("Материалы вязкой пачки:", { bold: true }));
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: padRows }));
  }

  // ─── 7. Volumes ───
  children.push(heading("7. Результаты расчёта объёмов"));
  const volRows = [
    new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
    kvRow("S затрубья", `${fmt(results.annArea * 1e4, 1)} см²`),
    kvRow("S трубы", `${fmt(results.pipeArea * 1e4, 1)} см²`),
  ];
  if (results.isOpenHole) {
    volRows.push(kvRow("Эфф. диаметр (Kкав)", `${fmt(results.boreDiamUsed, 1)} мм (${fmt(results.cavernCoeff, 2)})`));
  }
  volRows.push(
    kvRow("Цемент (затрубье)", `${fmt(results.cementVolumeAnn, 3)} м³`),
    kvRow("Цемент (трубы)", `${fmt(results.cementVolumePipe, 3)} м³`),
    kvRow("Цемент ИТОГО", `${fmt(results.cementVolumeTotal, 3)} м³`),
    kvRow("Высота цем. (затрубье)", `${fmt(results.cementHeightAnnMD, 1)} м`),
    kvRow("Высота цем. (трубы)", `${fmt(results.cementHeightPipeMD, 1)} м`),
    kvRow("Буфер сверху", `${fmt(results.spacerVolumeAbove, 3)} м³`),
    kvRow("↕ Интервал буфера сверху", `${fmt(results.spacerAboveHeightAnnMD, 1)} м`),
  );
  if (results.useViscousPad && results.spacerVolumeBelow > 0) {
    const padAnnA = results.annArea;
    const padPipeA = results.pipeArea;
    const padHeight = results.spacerBelowHeightAnnMD;
    const padVolAnn = padAnnA * padHeight;
    const padVolPipe = padPipeA * padHeight;
    volRows.push(
      kvRow("Вязкая пачка ИТОГО", `${fmt(results.spacerVolumeBelow, 3)} м³`),
      kvRow("  — в затрубье", `${fmt(padVolAnn, 3)} м³`),
      kvRow("  — в трубах", `${fmt(padVolPipe, 3)} м³`),
      kvRow("↕ Высота пачки (равновесие)", `${fmt(padHeight, 1)} м`),
    );
  }
  volRows.push(kvRow("Объём продавки", `${fmt(results.displacementVolume, 3)} м³`));
  if (results.useViscousPad && results.reverseFlushVolume) {
    volRows.push(kvRow("Объём обратной промывки (пачка)", `${fmt(results.reverseFlushVolume, 3)} м³`));
  }
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: volRows }));
  children.push(textP(results.heightDifferenceExplanation));

  // ─── 8. Pressures ───
  children.push(heading("8. Статические давления"));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
      kvRow("P статич. затрубье", `${fmt(results.pressureAnnulus, 2)} МПа`),
      kvRow("P статич. трубы", `${fmt(results.pressurePipe, 2)} МПа`),
      kvRow("ΔP", `${fmt(Math.abs(results.pressureAnnulus - results.pressurePipe), 2)} МПа`),
      kvRow("Баланс", results.isBalanced ? "✓ Сбалансировано" : "⚠ Дисбаланс"),
    ],
  }));

  // ─── 9. Stability Analysis ───
  if (stability) {
    children.push(heading("9. Устойчивость моста"));

    if (stability.isConfined) {
      children.push(textP("Замкнутая система — мост стабилен.", { bold: true }));
    }

    const stabRows = [
      new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
    ];

    if (stability.isConfined) {
      stabRows.push(
        kvRow("Анализ", "Критерий Рэлея-Тейлора (RT)"),
        kvRow("Dгидр (кольцевое)", `${((stability.hydraulicDiameterM ?? 0) * 1000).toFixed(0)} мм`),
        kvRow("SF интерфейса", (stability.interfaceSF ?? 0).toFixed(2)),
        kvRow("Риск загрязнения", stability.interfaceRisk === 'low' ? 'Низкий' : stability.interfaceRisk === 'medium' ? 'Умеренный' : 'Высокий'),
      );
      if ((stability.contaminationDepthM ?? 0) > 0) {
        stabRows.push(kvRow("Глубина смешения", `~${(stability.contaminationDepthM ?? 0).toFixed(1)} м`));
      }
    } else {
      stabRows.push(
        kvRow("Сценарий 1: мост → через буфер", ""),
        kvRow("  Движущее давление", `${stability.drivingPressure1.toFixed(1)} Па`),
        kvRow("  Удерживающее давление", `${stability.resistingPressure1.toFixed(1)} Па`),
        kvRow("  SF₁ (СНС 10мин)", stability.stabilityFactor1.toFixed(2)),
        kvRow("Сценарий 2: мост+буфер → скв. жидкость", ""),
        kvRow("  Движущее давление", `${stability.drivingPressure2.toFixed(1)} Па`),
        kvRow("  Удерживающее давление", `${stability.resistingPressure2.toFixed(1)} Па`),
        kvRow("  SF₂ (СНС 10мин)", stability.stabilityFactor2.toFixed(2)),
      );
    }

    if ((stability.requiredSpacerGel ?? 0) > 0 && stability.interfaceRisk !== 'low') {
      stabRows.push(kvRow("Рекомендуемый СНС 10 мин буфера", `≥ ${(stability.requiredSpacerGel ?? 0).toFixed(1)} Па`));
    }
    if (!stability.usedGelStrength) {
      stabRows.push(kvRow("Примечание", "СНС не задан — оценка Gel ≈ 3×YP"));
    }

    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: stabRows }));

    // Warnings
    if (stability.warnings.length > 0) {
      children.push(textP("Предупреждения:", { bold: true }));
      for (const w of stability.warnings) {
        children.push(textP(w));
      }
    }

    // Recommendation
    children.push(textP("Рекомендация:", { bold: true }));
    const recLines = stability.recommendation.split('\n');
    for (const line of recLines) {
      children.push(textP(line));
    }
  }

  // ─── 10. Interface Contamination ───
  if (results.interfaceContaminations && results.interfaceContaminations.length > 0) {
    children.push(heading("10. Загрязнение интерфейсов (пальцевание)"));
    const icRows = [new TableRow({ children: [hCell("Интерфейс, м MD"), hCell("SF"), hCell("Глубина смешения, м"), hCell("Направление")] })];
    for (const ic of results.interfaceContaminations) {
      icRows.push(new TableRow({
        children: [
          c(fmt(ic.interfaceMD, 1), { align: AlignmentType.CENTER }),
          c(fmt(ic.sfInterface, 2), { align: AlignmentType.CENTER }),
          c(fmt(ic.depthM, 2), { align: AlignmentType.CENTER }),
          c(ic.direction === 'down' ? 'Вниз ↓' : 'Вверх ↑', { align: AlignmentType.CENTER }),
        ],
      }));
    }
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: icRows }));
  }

  // ─── 11. Pumping Schedule ───
  children.push(heading("11. Порядок работ"));
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
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: stageRows }));

  // ─── 12. Timing ───
  children.push(heading("12. Хронометраж операции"));
  const timingRows = [
    new TableRow({ children: [hCell("Этап", 60), hCell("Время, мин", 40)] }),
    kvRow("Закачка цемента", fmt(results.pumpTimeCementMin, 1)),
  ];
  if (results.pumpTimeSpacerBelowMin > 0) timingRows.push(kvRow("Закачка вязкой пачки", fmt(results.pumpTimeSpacerBelowMin, 1)));
  if (results.pumpTimeSpacerAboveMin > 0) timingRows.push(kvRow("Закачка верх. буфера", fmt(results.pumpTimeSpacerAboveMin, 1)));
  timingRows.push(
    kvRow("Продавка", fmt(results.pumpTimeDisplacementMin, 1)),
    kvRow("Подъём инструмента", fmt(results.tripTimeMin, 1)),
    kvRow("Промывка", fmt(results.washTimeMin, 1)),
    kvRow("ИТОГО", fmt(results.totalOperationTimeMin, 1)),
    kvRow("Загустевание (50Bc)", fmt(results.thickeningTimeMin, 0)),
    kvRow("Безопасное время (0.75×50Bc)", fmt(results.safeTimeMin, 0)),
  );
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: timingRows }));
  children.push(textP(
    results.isTimeSafe
      ? `✅ Запас времени: ${fmt(results.safeTimeMin - results.totalOperationTimeMin, 1)} мин`
      : `⛔ Превышение безопасного времени на ${fmt(results.totalOperationTimeMin - results.safeTimeMin, 1)} мин!`,
    { bold: true }
  ));
  children.push(textP(`Время ОЗЦ: ${data.wocTimeHours} ч`, { bold: true }));

  // ─── 13. Process Parameters ───
  children.push(heading("13. Параметры процесса"));
  const processParamsRows = [
    new TableRow({ children: [hCell("Параметр", 60), hCell("Значение", 40)] }),
    kvRow("Q цемент", `${fmt(inputs.pumpRateCementLs, 1)} л/с`),
    kvRow("Q буфер", `${fmt(inputs.pumpRateSpacerLs, 1)} л/с`),
    kvRow("Q продавка", `${fmt(inputs.pumpRateDisplacementLs, 1)} л/с`),
    kvRow("Q промывка", `${fmt(inputs.pumpRateWashLs, 1)} л/с`),
    kvRow("Подъём над кровлей моста", `${fmt(inputs.pullOutAbovePlugM, 0)} м`),
  ];
  if (inputs.useViscousPad) {
    processParamsRows.push(
      kvRow("Подъём над пачкой", `${fmt(inputs.padPullUpAboveM ?? 5, 0)} м`),
    );
    if (results.padPullUpMD !== undefined) {
      processParamsRows.push(kvRow("Глубина подъёма над пачкой", `${fmt(results.padPullUpMD, 0)} м MD`));
    }
  }
  processParamsRows.push(
    kvRow("Кол-во циклов промывки", String(inputs.washCycles)),
    kvRow("Скорость подъёма", `${fmt(inputs.tripSpeedMs, 2)} м/с`),
    kvRow("Тип промывки", inputs.washType === 'direct' ? 'Прямая' : 'Обратная'),
    kvRow("Подъём на промывку до", `${fmt(results.pullOutDepthMD, 0)} м MD`),
    kvRow("Промывка", `${fmt(results.washVolumeM3, 3)} м³ (${results.washCycles} цикл.)`),
  ];
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: processParamsRows }));

  // ─── 14. Process Description ───
  children.push(heading("14. Описание процесса"));
  const descLines = results.processDescription.split('\n').filter(l => l.trim());
  for (const line of descLines) {
    children.push(textP(line));
  }

  // ─── 15. Pressure Chart ───
  if (data.pressureChartImage) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(heading("15. Совмещённый график давлений"));
    children.push(imageFromDataUrl(data.pressureChartImage, 580, 350));
  }

  // ─── 16. Visualization ───
  if (data.visualizationImage) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(heading("16. Продольное сечение"));
    children.push(imageFromDataUrl(data.visualizationImage, 450, 600));
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
