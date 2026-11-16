import {foamCharts} from './foam-chart-data';
import {rasterizeReportSvgs} from './cementing-report-figures';
import type {ReportFigure} from './cementing-report-data';
import { reportDataTable, reportPageProperties } from "./report-layout";
import {
  Document,ImageRun,AlignmentType,
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
export function foamReportChildren(bundle: FoamReportBundle,figures:ReportFigure[] = []) {
  const { simulation: r, planFact: fact } = bundle,
    s = r.input.settings;
  const children = [
    new Paragraph({
      text: "Программа пеноцементирования",
      heading: HeadingLevel.TITLE,
    }),
    p('Отдельный сценарий пеноцементирования. Его ряды не подменяют результаты основной несжимаемой программы.'),
    p(`Расчёт ${r.createdAt}; модель ${r.modelVersion}.`),
    table([['График','Координата / шкала','Строк'],...foamCharts(bundle).map(x=>[x.title,x.data.xLabel+'; '+x.data.leftLabel,x.data.xValues.length])]),
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
    table([['Параметр','Значение'],['Коэффициент объёма / рецепт',s.foamVolumeMultiplier+' / '+s.recipeId],['PV/YP базы, мПа·с / Па',s.liquidPV+' / '+s.liquidYP],['PV/YP БР, мПа·с / Па',s.mudPV+' / '+s.mudYP],['Градиент ГРП / пластовый, кПа/м',s.fractureGradient+' / '+(s.poreGradient??'не задан')],['Плотность БР, г/см³',r.input.mudDensity],['Плотность базы, г/см³',s.baseDensity],['В/Ц',s.waterCementRatio],['Выход, м³/т',s.yieldM3PerTon],['Пенообразователь, % BWOC',s.foamerPctBWOC],['Расход жидкости, л/с',s.pumpRateLps],['Плотность по заданию, г/см³',s.targetDensity],['Противодавление, МПа изб.',s.backPressure],['Температура устья / забоя, °C',s.surfaceTemperature+' / '+s.bottomTemperature],['Температурный режим',s.temperatureMode==='static'?'Статический':'Циркуляционный'],['Тепловое время, мин',s.thermalResponseMin],['Пауза / выдержка, мин',s.pauseAfterFoamMin+' / '+s.finalHoldMin],['Множитель трения / шероховатость, мм',s.frictionMultiplier+' / '+s.roughnessMm],['Число пространственных ячеек / шаг, мин',s.spatialCells+' / '+s.timeStepMin],['Макс. давление / расход N₂ / давление N₂',s.maxPumpPressureMPa+' МПа / '+s.maxN2RateStdM3Min+' м³ст/мин / '+s.maxN2PressureMPa+' МПа'],['Макс. расход жидкости / доступный N₂',s.maxSlurryRateLps+' л/с / '+s.n2AvailableStdM3+' м³ст']]),
    table([['MD, м','TVD, м','Зенит, °','Азимут, °'],...r.input.wellData.trajectory.map(x=>[x.md,x.tvd,x.zenith,x.azimuth])]),
    ...(r.input.wellData.casingSections?.length?[table([['Секция от MD, м','До MD, м','Стенка, мм'],...r.input.wellData.casingSections.map(x=>[x.fromMD,x.toMD,x.wallThickness])])]:[]),
    ...(r.input.wellData.cavernIntervals?.length?[table([['Интервал от MD, м','До MD, м','Кавернозность','Измеренный диаметр, мм'],...r.input.wellData.cavernIntervals.map(x=>[x.fromMD,x.toMD,x.coeff,x.diameterMm??'не задан'])])]:[]),
    p('Полные сохранённые временные ряды, ячейки обоих пространств и числовые данные рисунков доступны в XLSX. Параметры проекта для повторного ввода сохраняются отдельным JSON. Паспортные документы в отчёт не включены.'),
    ...figures.flatMap(f=>{const scale=Math.min(620/f.width,600/f.height,1);return [new Paragraph({text:f.title,heading:HeadingLevel.HEADING_2,keepNext:true}),new Paragraph({alignment:AlignmentType.CENTER,children:[new ImageRun({data:Uint8Array.from(atob(f.dataUrl.split(',')[1]),c=>c.charCodeAt(0)),transformation:{width:Math.round(f.width*scale),height:Math.round(f.height*scale)}})]})];}),
  ];
  return children;
}
export async function exportFoamReport(bundle:FoamReportBundle,options?:{returnBlob?:boolean;figures?:ReportFigure[]}){
 const figures=options?.figures??await rasterizeReportSvgs(foamCharts(bundle));
 const blob=await Packer.toBlob(new Document({sections:[{properties:reportPageProperties(),children:foamReportChildren(bundle,figures)}]}));
 if(options?.returnBlob)return blob;saveAs(blob,'foam-cement-program.docx');
}
