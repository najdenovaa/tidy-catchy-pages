import { reportDataTable, reportPageProperties } from "./report-layout";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  HeadingLevel,
} from "docx";
import { saveAs } from "file-saver";
import type { FoamReportBundle } from "./foam-cement-types";
const p = (s: string) => new Paragraph({ text: s, spacing: { after: 100 } });
const table = (rows: (string | number)[][]) => reportDataTable(rows[0].map(String), rows.slice(1));
export function foamReportChildren(bundle: FoamReportBundle) {
  const { simulation: r, planFact: fact } = bundle,
    s = r.input.settings;
  const children = [
    new Paragraph({
      text: "Программа пеноцементирования",
      heading: HeadingLevel.TITLE,
    }),
    p(`Расчёт ${r.createdAt}; модель ${r.modelVersion}.`),
    p(
      "Инженерная оценка. Промысловая валидация и подтверждение устойчивости пены не выполнены автоматически.",
    ),
    p(
      `Конструкция: MD ${r.input.wellData.casingDepthMD} м; OD ${r.input.wellData.casingOD} мм; ствол ${r.input.wellData.holeDiameter} мм; кровля по заданию ${s.cementTopMD} м.`,
    ),
    p(
      `FQ ${s.targetFoamQuality}% относится к ${s.referenceMode === "depth" ? `MD ${s.referenceMD} м` : `генератору при ${s.referencePressureMPa} МПа изб.`}; режим ${s.controlMode}. Стандартные условия N₂: ${s.standardTemperatureC} °C, 0,101325 МПа абс.`,
    ),
    table([
      ["Показатель", "Значение"],
      ["База, м³", r.design.baseSlurryM3.toFixed(3)],
      ["N₂, м³ст", r.design.n2StdM3.toFixed(2)],
      ["Цемент, т", r.design.cementTonnes.toFixed(3)],
      ["Вода, м³", r.design.waterM3.toFixed(3)],
      ["Пенообразователь, кг", r.design.foamerKg.toFixed(2)],
      ["Длительность, мин", r.summary.durationMin.toFixed(2)],
      ["Максимум давления, МПа", r.summary.maxPumpPressureMPa.toFixed(3)],
      [
        "Конечная кровля, м MD",
        r.summary.finalTOCMD?.toFixed(1) ?? "Пены в затрубье нет",
      ],
      [
        "Невязка базы / N₂, %",
        `${r.summary.maxBaseBalanceErrorPct.toExponential(2)} / ${r.summary.maxGasBalanceErrorPct.toExponential(2)}`,
      ],
    ]),
    new Paragraph({
      text: "Программа закачки",
      heading: HeadingLevel.HEADING_1,
    }),
    table([
      ["Стадия", "Жидкость, м³", "Q, л/с", "N₂, м³ст/мин", "Время, мин"],
      ...r.design.stages.map((x) => [
        x.name,
        x.liquidVolumeM3.toFixed(3),
        x.liquidRateLps.toFixed(2),
        (x.gasStdPerBase * x.liquidRateLps * 0.06).toFixed(2),
        x.durationMin.toFixed(2),
      ]),
    ]),
    new Paragraph({ text: "Ограничения", heading: HeadingLevel.HEADING_1 }),
    p(`Источник границ: ${s.limitsSource}`),
    ...r.constraints.map((x) =>
      p(
        `${x.pass ? "В пределах" : "НАРУШЕНО"}: ${x.label}: ${x.actual.toFixed(3)}; граница ${x.limit} ${x.unit}`,
      ),
    ),
    new Paragraph({ text: "Протоколы", heading: HeadingLevel.HEADING_1 }),
    ...s.lab.map((x) =>
      p(
        `${x.source}; ${x.preparation}; Pабс ${x.pressureMPaAbs} МПа; T ${x.temperatureC} °C; FQ ${x.qualityPct}%; PV ${x.pvCp} сП; YP ${x.ypPa} Па.`,
      ),
    ),
    ...(s.lab.length
      ? []
      : [p("Протоколы отсутствуют. Реология пены оценочная.")]),
    ...(fact
      ? [
          p(
            `План-факт: ${fact.samples.length} точек; RMSE ${fact.pressureRMSE?.toFixed(3) ?? "нет"} МПа; интеграл N₂ по покрытому периоду ${fact.measuredN2StdM3.toFixed(2)} против плана ${fact.plannedN2SamePeriodStdM3.toFixed(2)} м³ст.`,
          ),
        ]
      : []),
    new Paragraph({
      text: "Допущения и ограничения модели",
      heading: HeadingLevel.HEADING_1,
    }),
    ...r.warnings.map(p),
    new Paragraph({
      text: "Исходные параметры для воспроизведения",
      heading: HeadingLevel.HEADING_1,
    }),
    p(JSON.stringify(r.input)),
  ];
  return children;
}
export async function exportFoamReport(bundle: FoamReportBundle) {
  saveAs(
    await Packer.toBlob(
      new Document({ sections: [{ properties: reportPageProperties(), children: foamReportChildren(bundle) }] }),
    ),
    "foam-cement-program.docx",
  );
}
