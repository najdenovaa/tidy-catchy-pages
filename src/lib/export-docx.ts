import {MOVING_PLUG_FIELDS} from './moving-plug';
import {evaluatePlugBench,plugBenchKey} from './plug-bench';
import {transportInputKey} from "./compressible-transport";
import {buildProcessContract,type ProcessContract} from "./cementing-process";
import {rheologyReportFluids} from "./rheology-report";
import {rheologyDescription,rheologyResolution,rheologyMetrics} from "./cement-rheology";
import { equipmentSignature } from "./equipment-library";
import { equipmentReferenceText } from "./equipment-library-reference";
import { fluidReferenceText } from "./fluid-library";
import { cavernIntervalCoeff, boreDiameterAtDepth } from "./well-geometry";
import { reportIncludes, type ReportSelection } from "./cementing-report-options";
import { equipmentMaterialInventory, centralizerMaterialGeometryKey } from "./materials-equipment-inventory";
import { centralizerInventory } from "./cementing-equipment";
import { FLEET_SCHEMES } from "./cement-fleet-catalog";
import { materialLabel, cementProduct } from "./cement-product-catalog";
import { EQUIPMENT_LABELS, equipmentDetails, equipmentWarnings } from "./cementing-equipment";
import { fixedReportTable, REPORT_TEXT_WIDTH, reportPageProperties } from "./report-layout";
import { buildCementingReportExtras } from "./cementing-report-sections";
import type { CementingReportExtras } from "./cementing-report-data";
import { foamReportChildren } from './foam-cement-report';
import type { FoamReportBundle } from './foam-cement-types';
import { buildLabProgram, buildRecipe } from "./cement-program";
import { checkNorms, inferCasingType, CASING_TYPE_LABEL } from "./cement-norms";
import { planLogistics, normalizeLogisticsSettings, type LogisticsSettings } from "./cement-logistics";
import { runLossRisk, DEFAULT_RISK, type RiskResult } from "./cement-risk";
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType,
  BorderStyle, PageBreak, ShadingType, Header, Footer,
  TableLayoutType, ImageRun,
} from "docx";
import { dataUrlToArrayBuffer } from "./capture-image";
import type { CentralizationResult } from "./centralization-calculations";
import { saveAs } from "file-saver";
import type {
  WellData, SlurryInput, BufferFluid, DrillingFluid, DisplacementFluid,
  VolumeResults, MaterialSummary, PressurePoint, StageBoundary, PressureProfileResult,
} from "./cementing-calculations";
import {
  resolveFlowRateSteps, slurryDesignVolume, calculateVolumes, calculateHydraulics, calculateSafeTime, calculateBHCT,
  calculateMaterials, calculatePressureProfile,
  getSlurryHeight, getCasingID, interpolateTVD, getFlowRateLps, getEffectiveTrajectory,
  annularVolumePerMeter, pipeVolumePerMeter, buildDisplacementSchedule,
} from "./cementing-calculations";

const fmt = (v: number, dec = 2) => v.toFixed(dec);

// ======== Styling helpers ========
const BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  left: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  right: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
};

function headerCell(text: string, width?: number): TableCell {
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

function cell(text: string, opts?: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] }): TableCell {
  return new TableCell({
    borders: BORDER,
    children: [new Paragraph({
      alignment: opts?.align ?? AlignmentType.LEFT,
      children: [new TextRun({ text, size: 18, bold: opts?.bold, font: "Calibri" })],
    })],
  });
}

function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 },
    children: [new TextRun({ text, bold: true, size: 24, font: "Calibri", color: "1A3A5C" })],
  });
}

function kvRow(label: string, value: string): TableRow {
  return new TableRow({
    children: [
      cell(label),
      cell(value, { bold: true, align: AlignmentType.RIGHT }),
    ],
  });
}

function kvTable(rows: { label: string; value: string }[]): Table {
  return fixedReportTable(2, {
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: rows.map(r => kvRow(r.label, r.value)),
  });
}


function gridTable(headers: string[], rows: string[][]): Table {
  return fixedReportTable(headers.length, {
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: headers.map((h) => headerCell(h)) }), ...rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) }))],
  });
}

function noteParagraph(text: string): Paragraph {
  return new Paragraph({ spacing: { before: 60, after: 60 }, children: [new TextRun({ text, size: 18, font: "Calibri", color: "7A4A00" })] });
}

function buildLabPage(wellData: WellData, slurries: SlurryInput[], volumes: VolumeResults, pressureResult: PressureProfileResult): Paragraph[] {
  const lab = buildLabProgram(wellData, slurries, pressureResult, volumes);
  const out: Paragraph[] = [sectionTitle("Температурный режим")];
  out.push(kvTable([
    { label: "BHCT расчётная", value: `${fmt(lab.bhct.bhctC, 0)} °C (${lab.bhct.method})` },
    { label: "BHCT, принятая в программе испытаний", value: `${fmt(lab.bhctUsedC, 0)} °C` },
    { label: "Геотермический градиент", value: `${fmt(lab.bhct.gradientCper100m, 2)} °C/100 м` },
    { label: "Температура поверхности", value: `${fmt(lab.surfaceC, 0)} °C` },
  ]) as any);
  lab.notes.forEach((n) => out.push(noteParagraph(`⚠ ${n}`)));
  const st: Record<string, string> = { ok: "выполнено", fail: "НЕ ПРОХОДИТ", todo: "испытать", info: "" };
  lab.slurries.forEach((p, i) => {
    out.push(sectionTitle(`Программа лабораторных испытаний - ${p.slurryName}`));
    out.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: `Интервал ${fmt(p.topMD, 0)}–${fmt(p.bottomMD, 0)} м; время работы раствора ${fmt(p.jobTimeMin, 0)} мин; выход на BHCT ${fmt(p.rampMin, 0)} мин; давление ${fmt(p.testPressureMPa, 1)} МПа.`, size: 18, font: "Calibri" })] }));
    out.push(gridTable(["Испытание", "Условия", "Критерий", "Статус", "Норматив"], p.tests.map((t) => [t.test, t.conditions, t.criterion, `${st[t.status]}${t.actual ? ` (${t.actual})` : ""}`, t.reference])) as any);
    p.warnings.forEach((w) => out.push(noteParagraph(`⚠ ${w}`)));
    const vol = volumes.slurryVolumes[i]?.slurryVolumeM3 ?? 0;
    const r = buildRecipe(slurries[i], vol);
    out.push(sectionTitle(`Рецептура по абсолютным объёмам - ${p.slurryName}`));
    out.push(gridTable(["Компонент", "Уд. вес, г/см³", "кг на 1 м³", "На операцию"], [
      ["Цемент", fmt(r.cementSG, 2), fmt(r.perM3.cementKg, 0), `${fmt(r.totals.cementT, 2)} т`],
      ...r.perM3.additives.map((a) => [a.name, fmt(a.sg, 2), fmt(a.kgPerM3, 1), `${fmt(a.totalKg, 0)} кг`]),
      ["Вода затворения", "1.00", fmt(r.perM3.waterL, 0), `${fmt(r.totals.waterM3, 2)} м³`],
    ]) as any);
    out.push(kvTable([
      { label: "В/С для проектной плотности", value: fmt(r.wcForDesign, 3) },
      { label: "Выход раствора", value: `${fmt(r.yieldM3perT, 3)} м³/т` },
      { label: "С запасом 5%: сухая смесь / вода", value: `${fmt(r.totals.blendWithReserveT, 2)} т / ${fmt(r.totals.waterWithReserveM3, 2)} м³` },
    ]) as any);
    r.warnings.forEach((w) => out.push(noteParagraph(`⚠ ${w}`)));
  });
  return out;
}

function buildNormsPage(wellData: WellData, slurries: SlurryInput[], buffers: BufferFluid[], drillingFluid: DrillingFluid, volumes: VolumeResults, pressureResult: PressureProfileResult): Paragraph[] {
  const lab = buildLabProgram(wellData, slurries, pressureResult, volumes);
  const casingType = wellData.casingType ?? inferCasingType(wellData);
  const checks = checkNorms({ wellData, slurries, buffers, drillingFluid, pressure: pressureResult, lab, casingType, hasSkc: true });
  const st: Record<string, string> = { ok: "выполнено", fail: "НАРУШЕНИЕ", warn: "на грани", manual: "проверить", na: "н/п" };
  const out: Paragraph[] = [sectionTitle(`Проверка по ПБ НГП и рекомендациям (колонна: ${CASING_TYPE_LABEL[casingType].toLowerCase()})`)];
  out.push(noteParagraph("«Норма ПБ» - ФНП «Правила безопасности в нефтяной и газовой промышленности» (приказ Ростехнадзора № 534), раздел о креплении скважин; «по аналогии» - норма для бурового раствора, применённая к затрубью; «рекомендация» - отраслевая практика / API."));
  out.push(gridTable(["Требование", "Норматив", "По программе", "Статус", "Тип / источник"], checks.map((c) => [c.title, c.requirement, c.actual, st[c.status], `${c.kind}; ${c.reference}`])) as any);
  return out;
}

function buildLogisticsPage(pressureResult: PressureProfileResult, materials: MaterialSummary, slurries: SlurryInput[], settings?: LogisticsSettings): Paragraph[] {
  const config=normalizeLogisticsSettings(settings);
  const r = planLogistics(pressureResult, materials, slurries, config);
  const hm = (m: number) => `${Math.floor(m / 60)} ч ${String(Math.round(m % 60)).padStart(2, "0")} мин`;
  const out: Paragraph[] = [sectionTitle("Техника, персонал и график работ")];
  out.push(gridTable(['Параметр комплекса','Принято в расчёте'],[
    ['Схема',FLEET_SCHEMES[r.scheme]],['Модель / производитель',`${config.manufacturer??''} ${config.unitName}`],
    ['Гидравлическая мощность / макс. подача всей машины',`${config.unitPowerKW} кВт / ${config.unitMaxRateLps} л/с`],['Предел давления машины',`${config.unitMaxPressureMPa} МПа`],
    ['Паспортная проверка',config.passportConfirmed?'Отмечена пользователем':'Не подтверждена; расчётный шаблон'],
    [r.scheme==='classic'?'Затворение одним ЦА через воронку':'Смешивание одной системы',`${config.mixRatePerPairLps} л/с`],
    ['Рабочие машины: на скважину / затворение',`${r.dischargeUnits} / ${r.mixingCA}`],
    ...(r.scheme!=='classic'?[['ЦТ-25: объём / груз / насыпная плотность',`${config.bulkVolumeM3} м³ / ${config.bulkPayloadT} т / ${config.bulkDensityTm3} т/м³`],['Пневмоподача / входы на смеситель',`${config.bulkUnloadTmin} т/мин / ${config.maxBulkConnections}`],['Закрытая подача',config.closedMixing?'Выбрана':'Не подтверждена']]:[]),
  ]) as any);
  if(config.pumpCurve?.length)out.push(gridTable(['Давление рабочей точки, МПа','Подача всей машины, л/с'],config.pumpCurve.map(x=>[fmt(x.pressureMPa),fmt(x.rateLps)])) as any);
  out.push(gridTable(["Техника", "Кол-во", "Обоснование"], r.equipment.map((e) => [e.name, String(e.count), e.note])) as any);
  out.push(new Paragraph({ children: [] }));
  out.push(gridTable(["Персонал", "Кол-во, чел."], [...r.personnel.map((p) => [p.role, String(p.count)]), ["Итого", String(r.personnel.reduce((t, p) => t + p.count, 0))]]) as any);
  out.push(new Paragraph({ children: [] }));
  out.push(gridTable(["Этап", "Начало", "Длительность"], r.timeline.map((t) => [t.step, hm(t.startMin), hm(t.durationMin)])) as any);
  out.push(noteParagraph(`Схема: ${FLEET_SCHEMES[r.scheme]}; рабочих машин ${r.unitsWorking}; насосов ${r.workingPumps}; смесительных систем ${r.mixingSystems}; выполнимость ${r.feasible?'по введённым характеристикам':'НЕ ОБЕСПЕЧЕНА'}.`));
  out.push(noteParagraph(`Отказ одного нагнетательного насоса: ${r.onePumpOutRateLps.toFixed(1)} л/с в пиковой точке; ${r.onePumpOutMeetsPeak?'пиковая подача сохраняется':'пиковая подача не обеспечена'}.`));
  r.notes.forEach((n) => out.push(noteParagraph(`⚠ ${n}`)));
  return out;
}

function buildRiskPage(r: RiskResult): Paragraph[] {
  const pc = (v: number) => `${(v * 100).toFixed(1)}%`;
  const out: Paragraph[] = [sectionTitle(`Вероятностная оценка риска (Монте-Карло, ${r.iterations} реализаций)`)];
  out.push(kvTable([
    { label: "Вероятность поглощения", value: pc(r.pLoss) },
    { label: "Вероятность снижения давления ниже пластового", value: pc(r.pUnderbalance) },
    { label: "Мин. запас до ГРП/поглощения P10 / P50 / P90, МПа", value: `${fmt(r.margin.p10, 2)} / ${fmt(r.margin.p50, 2)} / ${fmt(r.margin.p90, 2)}` },
    { label: "Запас по расчёту без разброса, МПа", value: fmt(r.deterministicMargin, 2) },
    { label: "Верх цемента P10 / P50 / P90, м", value: `${fmt(r.toc.p10, 0)} / ${fmt(r.toc.p50, 0)} / ${fmt(r.toc.p90, 0)} (план ${fmt(r.toc.planned, 0)})` },
    ...(r.toc.pBelowRequired !== null ? [{ label: "Вероятность подъёма ниже нормы (кровля пласта − 150 м)", value: pc(r.toc.pBelowRequired) }] : []),
  ]) as any);
  out.push(new Paragraph({ children: [] }));
  out.push(gridTable(["Фактор неопределённости", "Влияние на запас (корреляция)"], r.sensitivity.map((x) => [x.factor, x.corr.toFixed(2)])) as any);
  out.push(noteParagraph("Разброс: градиент ГРП/поглощения σ 4%, пластовое давление σ 3%, кавернозность σ 5%, реология σ 15%, плотность цемента σ 0,015 г/см³, отступ колонны σ 8 п.п., расход σ 5%."));
  return out;
}

// ======== Page builders ========

function buildInputPage(wellData: WellData, drillingFluid: DrillingFluid, slurries: SlurryInput[], buffers: BufferFluid[], displacementFluids: DisplacementFluid[], fractureGradient?: number, flushTimeMin?: number, flushVolumeM3?: number): Paragraph[] {
  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);
  const wellRows = [
    { label: "Глубина скважины (по стволу)", value: `${wellData.wellDepthMD} м` },
    { label: "Глубина скважины (по вертикали)", value: `${wellData.wellDepthTVD} м` },
    { label: "Глубина спуска ОК (по стволу)", value: `${wellData.casingDepthMD} м` },
    { label: "Номинальный диаметр ствола", value: `${wellData.holeDiameter} мм` },
    { label: "Наружный диаметр ОК", value: `${wellData.casingOD} мм` },
    { label: "Толщина стенки ОК", value: `${wellData.casingWall} мм` },
    { label: "Внутренний диаметр ОК (расчёт)", value: `${fmt(casingID, 1)} мм` },
    { label: "Глубина пред. колонны (по стволу)", value: `${wellData.prevCasingDepth} м` },
    { label: "Наружный диам. пред. колонны", value: `${wellData.prevCasingOD} мм` },
    { label: "Внутр. диам. пред. колонны", value: `${wellData.prevCasingID} мм` },
    { label: "Глубина ЦКОД (по стволу)", value: `${wellData.ckodDepth} м` },
    { label: "Высота подъёма цемента", value: `${wellData.cementRiseHeight ?? 0} м` },
    { label: "Коэффициент кавернозности", value: `${wellData.cavernCoeff}` },
    { label: "BHST (статическая t°)", value: `${wellData.bottomTempStatic} °C` },
    { label: "BHCT (циркуляционная t°)", value: `${wellData.bottomTempCirc ?? 0} °C` },
  ];

  const result: Paragraph[] = [
    sectionTitle("1. Данные о скважине"),
  ];
  result.push(kvTable(wellRows) as any);

  // Casing sections
  if (wellData.casingSections && wellData.casingSections.length > 0) {
    result.push(new Paragraph({ spacing: { before: 150, after: 80 }, children: [new TextRun({ text: "Секции ОК (разная толщина стенки):", bold: true, size: 20, font: "Calibri" })] }));
    const csHeaders = ["От (MD), м", "До (MD), м", "Стенка, мм"];
    const csRows = [
      new TableRow({ children: csHeaders.map(h => headerCell(h)) }),
      ...wellData.casingSections.map(sec => new TableRow({
        children: [
          cell(fmt(sec.fromMD, 0), { align: AlignmentType.CENTER }),
          cell(fmt(sec.toMD, 0), { align: AlignmentType.CENTER }),
          cell(fmt(sec.wallThickness, 1), { align: AlignmentType.CENTER }),
        ],
      })),
    ];
    result.push(fixedReportTable(3, { width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, rows: csRows }) as any);
  }

  if(wellData.caliperLog){const c=wellData.caliperLog;result.push(kvTable([
    {label:"Источник кавернометрии LAS",value:c.fileName+"; кривая "+c.curve},
    {label:"Исходные отсчёты",value:String(c.samples.length)+"; единицы файла "+c.depthUnit+" / "+c.diameterUnit},
    {label:"Обработка профиля",value:"Шаг "+c.intervalStepM+" м; допустимый разрыв "+c.maxGapM+" м; измеренный диаметр независим от номинального"},
    {label:"Правки интервалов после импорта",value:c.intervalsEdited?"Есть; исходные отсчёты сохранены в проекте":"Нет"},
  ]) as any);}
  // Cavern intervals
  if (wellData.cavernIntervals && wellData.cavernIntervals.length > 0) {
    result.push(new Paragraph({ spacing: { before: 150, after: 80 }, children: [new TextRun({ text: "Интервалы кавернозности (открытый ствол):", bold: true, size: 20, font: "Calibri" })] }));
    const measured=wellData.cavernIntervals.some(iv=>iv.diameterMm!==undefined);
    const ciHeaders = ["От (MD), м", "До (MD), м", "Коэфф. каверн.",...(measured?["Изм. экв. Ø, мм"]:[])];
    const ciRows = [
      new TableRow({ children: ciHeaders.map(h => headerCell(h)) }),
      ...wellData.cavernIntervals.map(iv => new TableRow({
        children: [
          cell(fmt(iv.fromMD, 0), { align: AlignmentType.CENTER }),
          cell(fmt(iv.toMD, 0), { align: AlignmentType.CENTER }),
          cell(fmt(cavernIntervalCoeff(iv,wellData.holeDiameter), 2), { align: AlignmentType.CENTER }),
          ...(measured?[cell(iv.diameterMm!==undefined?fmt(iv.diameterMm,1):"-",{align:AlignmentType.CENTER})]:[]),
        ],
      })),
    ];
    result.push(fixedReportTable(measured?4:3, { width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, rows: ciRows }) as any);
  }

  // Trajectory
  if (wellData.trajectory && wellData.trajectory.length > 1) {
    result.push(new Paragraph({ spacing: { before: 150, after: 80 }, children: [new TextRun({ text: "Профиль скважины (инклинометрия):", bold: true, size: 20, font: "Calibri" })] }));
    const trajHeaders = ["MD, м", "Азимут, °", "Зенит, °", "TVD, м"];
    const sorted = [...wellData.trajectory].sort((a, b) => a.md - b.md);
    const trajRows = [
      new TableRow({ children: trajHeaders.map(h => headerCell(h)) }),
      ...sorted.map(p => new TableRow({
        children: [
          cell(fmt(p.md, 1), { align: AlignmentType.RIGHT }),
          cell(fmt(p.azimuth, 1), { align: AlignmentType.RIGHT }),
          cell(fmt(p.zenith, 1), { align: AlignmentType.RIGHT }),
          cell(p.tvd ? fmt(p.tvd, 2) : "-", { align: AlignmentType.RIGHT }),
        ],
      })),
    ];
    result.push(fixedReportTable(4, { width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, rows: trajRows }) as any);
  }

  for(const e of wellData.equipment??[])if(e.libraryReference)result.push(kvTable([{label:"Источник оснастки: "+e.model,value:equipmentReferenceText(e.libraryReference,equipmentSignature(e))}]) as any);

  // Drilling fluid
  result.push(sectionTitle("2. Буровой раствор"));
  const fluidRows = [
    { label: "Тип бурового раствора", value: drillingFluid.name },
    { label: "Плотность", value: `${drillingFluid.density} кг/м³` },
    { label: "Водоотдача", value: `${drillingFluid.fluidLoss ?? 0} мл/30мин` },
    { label: "PV (поверхность)", value: `${drillingFluid.rheology.pv} сПз` },
    { label: "YP (поверхность)", value: `${drillingFluid.rheology.yp} Па` },
  ];
  if (drillingFluid.rheologyBottomhole && (drillingFluid.rheologyBottomhole.pv > 0 || drillingFluid.rheologyBottomhole.yp > 0)) {
    fluidRows.push(
      { label: "PV (забой)", value: `${drillingFluid.rheologyBottomhole.pv} сПз` },
      { label: "YP (забой)", value: `${drillingFluid.rheologyBottomhole.yp} Па` },
    );
  }
  if (drillingFluid.libraryReference) fluidRows.push({ label: "Источник свойств / библиотека", value: fluidReferenceText("mud", drillingFluid) });
  result.push(kvTable(fluidRows) as any);

  // Buffers
  result.push(sectionTitle("3. Буферные жидкости"));
  buffers.forEach(b => {
    const bRows = [
      { label: "Наименование", value: b.name },
      { label: "Плотность", value: `${b.density} кг/м³` },
      { label: "Объём", value: `${b.volume} м³` },
      { label: "PV / YP", value: `${b.rheology.pv} сПз / ${b.rheology.yp} Па` },
    ];
    if (b.libraryReference) bRows.push({ label: "Источник свойств / библиотека", value: fluidReferenceText("buffer", b) });
    result.push(kvTable(bRows) as any);
    // Flow rate steps
    if (b.flowRateSteps && b.flowRateSteps.length > 0) {
      resolveFlowRateSteps(b.flowRateSteps, b.volume).forEach((step, si) => {
        result.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `  Режим ${si + 1}: ${fmt(step.rateLps, 1)} л/с × ${fmt(step.volumeM3, 2)} м³`, size: 18, font: "Calibri" })] }));
      });
    }
    // Additives
    if (b.additives && b.additives.length > 0) {
      const bufferMassKg = b.volume * b.density;
      b.additives.forEach(a => {
        if (a.name) {
          const computedMass = a.percentage > 0 ? (a.percentage / 100) * bufferMassKg : a.massKg;
          result.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `  ${a.name}: ${a.percentage > 0 ? a.percentage + "% от массы буфера" : "доза в кг"} = ${computedMass > 0 ? computedMass.toFixed(1) : "-"} кг`, size: 18, font: "Calibri" })] }));
        }
      });
    }
    result.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
  });

  // Slurries
  result.push(sectionTitle("4. Тампонажные растворы (цемент)"));
  slurries.forEach((s, i) => {
    const height = getSlurryHeight(slurries, i, wellData.casingDepthMD);
    const sRows = [
      { label: "Наименование", value: s.name },
      { label: "Плотность", value: `${s.density} г/см³` },
      { label: "Верх цемента от устья", value: `${s.topDepthMD} м` },
      { label: "Высота столба (расчёт)", value: `${fmt(height, 0)} м` },
      ...(i === 0 && s.washVolume && s.washVolume > 0 ? [{ label: "Объём на вымыв", value: `${fmt(s.washVolume, 2)} м³` }] : []),
      { label: "В/Ц отношение", value: `${s.waterRatio}` },
      { label: "Выход, м³/т", value: `${s.yieldPerTon ?? 0}` },
      { label: "PV / YP", value: `${s.rheology.pv} сПз / ${s.rheology.yp} Па` },
      { label: "Загустевание 30 Вс", value: `${s.thickeningTime30Bc || "-"} мин` },
      { label: "Загустевание 50 Вс", value: `${s.thickeningTime50Bc || "-"} мин` },
    ];
    if (s.libraryReference) sRows.push({ label: "Источник свойств / библиотека", value: fluidReferenceText("slurry", s) });
    result.push(kvTable(sRows) as any);
    // Flow rate steps
    if (s.flowRateSteps && s.flowRateSteps.length > 0) {
      resolveFlowRateSteps(s.flowRateSteps, slurryDesignVolume(wellData, slurries, i)).forEach((step, si) => {
        result.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `  Режим ${si + 1}: ${fmt(step.rateLps, 1)} л/с × ${fmt(step.volumeM3, 2)} м³`, size: 18, font: "Calibri" })] }));
      });
    }
    // Additives
    if (s.additives && s.additives.length > 0) {
      s.additives.forEach(a => {
        if (a.name) {
          const pctType = a.percentageType || 'bwoc';
          result.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `  ${a.name}: ${a.percentage}% ${pctType}`, size: 18, font: "Calibri" })] }));
        }
      });
    }
    result.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
  });

  // Displacement fluids
  result.push(sectionTitle("5. Продавочная жидкость"));
  displacementFluids.forEach((df, idx) => {
    const label = displacementFluids.length > 1 ? `${df.name} (порция ${idx + 1})` : df.name;
    const dfRows = [
      { label: "Наименование", value: label },
      { label: "Плотность", value: `${df.density} кг/м³` },
      { label: "PV / YP", value: `${df.rheology.pv} сПз / ${df.rheology.yp} Па` },
      { label: "Коэфф. сжатия", value: `${df.compressionCoeff ?? 1.0}` },
    ];
    if (df.libraryReference) dfRows.push({ label: "Источник свойств / библиотека", value: fluidReferenceText("displacement", df) });
    result.push(kvTable(dfRows) as any);
    if (df.flowRateSteps && df.flowRateSteps.length > 0) {
      buildDisplacementSchedule(displacementFluids, calculateVolumes(wellData, slurries, displacementFluids[0]?.compressionCoeff ?? 1).displacementVolumeWithCompression).filter(it => it.fluidIndex === idx).forEach((step, si) => {
        result.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `  Режим ${si + 1}: ${fmt(step.rateLps, 1)} л/с × ${fmt(step.volumeM3, 2)} м³`, size: 18, font: "Calibri" })] }));
      });
    }
    result.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
  });

  // Fracture gradient
  if (fractureGradient && fractureGradient > 0) {
    result.push(sectionTitle("6. Параметры гидроразрыва"));
    result.push(kvTable([{ label: "Градиент гидроразрыва", value: `${fractureGradient} кПа/м` }]) as any);
  }

  // Flush parameters
  if ((flushTimeMin && flushTimeMin > 0) || (flushVolumeM3 && flushVolumeM3 > 0)) {
    result.push(sectionTitle("7. Промывка линии перед продавкой"));
    const flushRows = [];
    if (flushTimeMin) flushRows.push({ label: "Время промывки", value: `${flushTimeMin} мин` });
    if (flushVolumeM3) flushRows.push({ label: "Объём промывки", value: `${flushVolumeM3} м³` });
    result.push(kvTable(flushRows) as any);
  }

  return result;
}

function buildHydraulicsPage(wellData: WellData, slurries: SlurryInput[], volumes: VolumeResults, displacementFluids: DisplacementFluid[], drillingFluid: DrillingFluid, fractureGradient: number, workTimeWithCement: number, pressureResult?: PressureProfileResult, buffers?: BufferFluid[]): Paragraph[] {
  const dispFluid = displacementFluids[0];
  const pumpRate = dispFluid ? getFlowRateLps(dispFluid.flowRateSteps) : 0;
  const results = calculateHydraulics(wellData, slurries, (dispFluid?.density ?? 1000) / 1000, fractureGradient, drillingFluid.rheology, dispFluid?.rheology, pumpRate,
    drillingFluid ? drillingFluid.density / 1000 : undefined,
    buffers,
    displacementFluids,
    volumes.displacementVolume
  );
  const traj = getEffectiveTrajectory(wellData);
  const bottomTVD = interpolateTVD(wellData.casingDepthMD, traj);
  const bhct = calculateBHCT(wellData.bottomTempStatic, wellData.surfaceTemp ?? 15, bottomTVD);
  const maxThickening30 = Math.max(...slurries.map(s => s.thickeningTime30Bc || 0));
  const maxThickening50 = Math.max(...slurries.map(s => s.thickeningTime50Bc || 0));
  const safeTime = calculateSafeTime(workTimeWithCement, maxThickening30, maxThickening50);

  // Dynamic values from pressure simulation (exactly as UI shows)
  const dynamicMaxBHP = pressureResult ? Math.max(...pressureResult.points.map(p => p.bottomholePressure)) : undefined;
  const dynamicFracP = pressureResult ? pressureResult.points[0]?.fracturePressure : undefined;
  const dynamicStopP = pressureResult ? pressureResult.points.find(p => p.stage.includes('СТОП'))?.surfacePressure : undefined;
  const dynamicPreStopP = pressureResult ? (() => { const pts = pressureResult.points; const stopIdx = pts.findIndex(p => p.stage.includes('СТОП')); return stopIdx > 0 ? pts[stopIdx - 1].surfacePressure : undefined; })() : undefined;

  const effectiveMaxBHP = Math.max(results.maxBHP, dynamicMaxBHP ?? 0);
  const effectiveFracP = (dynamicFracP && dynamicFracP > 0) ? dynamicFracP : results.fracturePressure;
  const dynamicSafetyCoeff = effectiveFracP > 0 ? effectiveMaxBHP / effectiveFracP : 0;

  const volRows = [
    { label: "Внутренний диаметр ОК", value: `${fmt(volumes.casingID, 1)} мм` },
    { label: "Средний экв. диаметр открытого ствола", value: `${fmt(volumes.equivalentDiameter, 1)} мм` },
    { label: "Межтрубное пр-во", value: `${fmt(volumes.annularVolumePerMeterPrevCasing, 4)} м³/м` },
    { label: "Затрубье: среднее по открытому стволу", value: `${fmt(volumes.annularVolumePerMeter, 4)} м³/м` },
    { label: "Внутр. объём колонны", value: `${fmt(volumes.pipeVolumePerMeter, 4)} м³/м` },
    { label: "Расчётный объём продавки", value: `${fmt(volumes.displacementVolume, 1)} м³` },
    { label: "С учётом коэф. сжатия", value: `${fmt(volumes.displacementVolumeWithCompression, 1)} м³` },
  ];

  const pressRows = [
    { label: "Гидростатическое давление ЦР (затрубное)", value: `${fmt(results.hydrostaticPressureAnnulus)} МПа` },
    { label: "Гидростатическое давление продавочной жидкости", value: `${fmt(results.hydrostaticPressurePipe)} МПа` },
    { label: "Потери на трение в трубе", value: `${fmt(results.frictionPipe)} МПа` },
    { label: "Потери на трение в затрубье", value: `${fmt(results.frictionAnn)} МПа` },
    { label: "Макс. забойное давление (гидростатика + трение)", value: `${fmt(effectiveMaxBHP)} МПа` },
    { label: "Разница давлений на ЦКОД", value: `${fmt(results.differentialPressure)} МПа` },
    { label: "Давление ГРП", value: `${fmt(results.fracturePressure)} МПа` },
    { label: "Коэффициент безопасности (макс. ЗД / ГРП)", value: `${fmt(dynamicSafetyCoeff, 3)}` },
    { label: "Давление на насосе перед посадкой пробки", value: `${fmt(dynamicPreStopP ?? 0)} МПа` },
    { label: "Скачок давления посадки пробки (срез ЦКОД)", value: `${fmt(wellData.ckodShearPressureMPa ?? 1.5)} МПа` },
    { label: "Расчётное давление «СТОП»", value: `${fmt(dynamicStopP ?? results.stopPressure)} МПа` },
    { label: "BHCT", value: `${fmt(bhct, 1)} °C` },
  ];

  const safetyOk = dynamicSafetyCoeff < 1;

  const safeRows = [
    { label: "Расчётное время работы с цементом", value: `${fmt(safeTime.workTimeWithCement, 0)} мин` },
    { label: "Безопасное время (75% от загуст.)", value: `${safeTime.safeTime75} мин` },
    { label: "Загустевание до 30 Вс (лаб.)", value: maxThickening30 ? `${maxThickening30} мин` : "-" },
    { label: "Загустевание до 50 Вс (лаб.)", value: maxThickening50 ? `${maxThickening50} мин` : "-" },
  ];

  const content: Paragraph[] = [
    sectionTitle("5. Данные для расчёта (объёмы)"),
  ];
  content.push(kvTable(volRows) as any);
  content.push(sectionTitle("6. Гидравлический расчёт"));
  content.push(kvTable(pressRows) as any);
  if (pressureResult?.zoneChecks && pressureResult.zoneChecks.length > 0) {
    content.push(sectionTitle("6a. Давление в затрубье по пластам (за всю операцию)"));
    content.push(kvTable(pressureResult.zoneChecks.map((z) => ({
      label: `${z.name} (MD ${fmt(z.depthMD, 0)} м)`,
      value: `макс. ${fmt(z.maxPressureMPa)} / допустимо ${fmt(z.limitMPa)} МПа (${z.limitKind}), запас ${fmt(z.marginMPa)} МПа${z.marginMPa < 0 ? " - ПРЕВЫШЕНИЕ" : ""}`,
  }))) as any);
  }
  content.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({
      text: safetyOk
        ? "✓ Коэффициент безопасности в норме (< 1.0)"
        : "⚠ Коэффициент безопасности превышает 1.0 - риск гидроразрыва!",
      size: 18, font: "Calibri", bold: true,
      color: safetyOk ? "228B22" : "CC0000",
    })],
  }));
  content.push(sectionTitle("7. Безопасное время работы с цементом"));
  content.push(kvTable(safeRows) as any);
  if (maxThickening30 > 0) {
    content.push(new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({
        text: safeTime.isSafe
          ? `✓ Загустевание (${maxThickening30} мин) > безопасное время (${safeTime.safeTime75} мин)`
          : `⚠ Загустевание (${maxThickening30} мин) < безопасное время (${safeTime.safeTime75} мин) - ОПАСНО!`,
        size: 18, font: "Calibri", bold: true,
        color: safeTime.isSafe ? "228B22" : "CC0000",
      })],
    }));
  }

  return content;
}

function buildSchedulePage(c:ProcessContract):Paragraph[]{
 const rows=c.stages.map(s=>[s.name+' (режим '+(s.stepIndex+1)+')',s.destination==='well'?'В скважину':'ЛВД, мимо скважины',fmt(s.rateLps,2),fmt(s.volumeM3,3),s.startMin===null?'-':fmt(s.startMin,2),s.endMin===null?'-':fmt(s.endMin,2)]);
 return [sectionTitle('8. Программа закачки'),noteParagraph('Общее расписание режимов и паузы ЛВД. Баланс проверяется до округления чисел. Подготовка, опрессовки и демонтаж назначаются отдельным планом работ; их незаданные объёмы и длительности в расчёт не добавлены.'),
  gridTable(['Этап','Назначение','л/с','м³','Начало, мин','Конец, мин'],rows) as any,
  kvTable([{label:'Назначено в скважину',value:fmt(c.wellVolumeM3,3)+' м³; '+(c.canRun?fmt(c.wellMassKg/1000,3)+' т':'масса не подтверждена')},{label:'Промывка ЛВД отдельно',value:fmt(c.surfaceVolumeM3,3)+' м³'},{label:'Плановое время до Стоп',value:c.totalTimeMin===null?'Не определено':fmt(c.totalTimeMin,2)+' мин'},{label:'Проверка интеграла Q × dt',value:fmt(c.volumeResidualM3,9)+' м³; '+fmt(c.massResidualKg,6)+' кг'}]) as any,
  noteParagraph('Это баланс назначенных порций при фиксированной плотности, а не баланс конечного содержимого скважины. В динамике свободное падение, сжатие и досрочная посадка пробки могут изменить объём и время до Стоп.'),...c.issues.map(x=>noteParagraph(x.message))];
}

function buildMaterialsPage(materials: MaterialSummary, wellData: WellData): Paragraph[] {
  const matHeaders = ["Наименование", "Количество", "Ед. изм."];
  const makeMatTable = (items: { name: string; amount: number; unit: string }[]) => {
    return fixedReportTable(3, {
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({ tableHeader: true, children: matHeaders.map(h => headerCell(h)) }),
        ...items.map(item => new TableRow({
          children: [
            cell(item.name),
            cell(fmt(item.amount, item.unit === "т" ? 2 : 1), { align: AlignmentType.RIGHT }),
            cell(item.unit, { align: AlignmentType.CENTER }),
          ],
        })),
      ],
    }) as any;
  };

  const waterRows = [
    { label: "Буферной жидкости", value: `${fmt(materials.waterForBuffers)} м³` },
    { label: "Затворения цемента", value: `${fmt(materials.waterForCement)} м³` },
    { label: "Запас (10%)", value: `${fmt(materials.waterReserve)} м³` },
    { label: "Всего воды", value: `${fmt(materials.waterTotal)} м³` },
  ];

  return [
    sectionTitle("9. Цементные материалы"),
    makeMatTable(materials.cementItems.map(x=>({...x,name:x.name.split(" / ")[0].trim()}))),
    new Paragraph({ spacing: { after: 150 }, children: [] }),
    sectionTitle("10. Буферные материалы"),
    makeMatTable(materials.bufferItems.map(x=>({...x,name:x.name.split(" / ")[0].trim()}))),
    new Paragraph({ spacing: { after: 150 }, children: [] }),
    sectionTitle("11. Технологическая оснастка"),
    makeMatTable(materials.equipmentItems.map(e=>({name:e.name,amount:e.amount,unit:'шт.'}))),
    new Paragraph({ spacing: { after: 150 }, children: [] }),
    sectionTitle("12. Вода для приготовления"),
    kvTable(waterRows) as any,
  ];
}

// ======== Pressure Profile / Plan Prodavki ========

function buildPressureProfilePage(pressureResult: PressureProfileResult): Paragraph[] {
  const points = pressureResult.points;
  const sampled = points.filter((p, i) => i === 0 || i === points.length - 1 || Math.abs(p.time - Math.round(p.time)) < 0.05);

  const headers = ["Время, мин", "Pнасос, МПа", "Pзабой, МПа", "Pгрп, МПа", "Q, л/с", "Qвых, л/с", "Qмакс, л/с", "Этап"];

  const tableRows = [
    new TableRow({ children: headers.map(h => headerCell(h)) }),
    ...sampled.map(p => new TableRow({
      children: [
        cell(fmt(p.time, 1), { align: AlignmentType.CENTER }),
        cell(fmt(p.surfacePressure, 2), { align: AlignmentType.RIGHT }),
        cell(fmt(p.bottomholePressure, 2), { align: AlignmentType.RIGHT }),
        cell(fmt(p.fracturePressure, 2), { align: AlignmentType.RIGHT }),
        cell(fmt(p.pumpRateLps, 1), { align: AlignmentType.RIGHT }),
        cell(fmt(p.annularReturnRate, 1), { align: AlignmentType.RIGHT }),
        cell(p.maxSafeRateLps > 0 ? fmt(p.maxSafeRateLps, 1) : "-", { align: AlignmentType.RIGHT, bold: true }),
        cell(p.stage),
      ],
    })),
  ];

  const safeRows = [
    { label: "Начало закачки цемента", value: `${fmt(pressureResult.cementStartTime, 1)} мин` },
    { label: "Момент «СТОП»", value: `${fmt(pressureResult.stopTime, 1)} мин` },
    { label: "Время работы с цементом", value: `${fmt(pressureResult.stopTime - pressureResult.cementStartTime, 1)} мин` },
    { label: "Безопасное время (75%)", value: `${fmt(pressureResult.safeWorkingTimeMin, 1)} мин` },
    { label: "Время равновесия U-tube", value: pressureResult.equilibriumTimeMin > 0 ? `~${fmt(pressureResult.equilibriumTimeMin, 0)} мин` : "-" },
  ];

  const boundaryRows = pressureResult.stageBoundaries.map(b => ({
    label: b.label,
    value: `${fmt(b.time, 1)} мин`,
  }));

  const content: Paragraph[] = [
    sectionTitle("13. План продавки - давления, производительность и ограничения"),
    new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({
        text: "Qмакс - максимальная производительность, при которой забойное давление не превышает давление ГРП. Оператор должен придерживаться этого ограничения.",
        size: 18, font: "Calibri", italics: true, color: "CC0000",
      })],
    }),
  ];

  if (boundaryRows.length > 0) {
    content.push(new Paragraph({
      spacing: { before: 150, after: 80 },
      children: [new TextRun({ text: "Границы этапов:", bold: true, size: 20, font: "Calibri" })],
    }));
    content.push(kvTable(boundaryRows) as any);
    content.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
  }

  content.push(new Paragraph({
    spacing: { before: 150, after: 80 },
    children: [new TextRun({ text: "Безопасное время:", bold: true, size: 20, font: "Calibri" })],
  }));
  content.push(kvTable(safeRows) as any);
  content.push(new Paragraph({ spacing: { after: 150 }, children: [] }));

  content.push(new Paragraph({
    spacing: { before: 100, after: 80 },
    children: [new TextRun({ text: "Профиль давлений и ограничений по времени:", bold: true, size: 20, font: "Calibri" })],
  }));
  content.push(fixedReportTable(headers.length, {
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: tableRows,
  }) as any);

  return content;
}

// ======== Charts data tables ========

function buildImageParagraph(dataUrl: string, title: string, widthPx = 1400, heightPx = 700): Paragraph[] {
  try {
    const buf = dataUrlToArrayBuffer(dataUrl);
    return [
      new Paragraph({
        spacing: { before: 200, after: 100 },
        children: [new TextRun({ text: title, bold: true, size: 20, font: "Calibri" })],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            data: buf,
            transformation: { width: Math.round(widthPx * Math.min(620 / widthPx, 650 / heightPx)), height: Math.round(heightPx * Math.min(620 / widthPx, 650 / heightPx)) },
          }),
        ],
      }),
    ];
  } catch {
    return [
      new Paragraph({
        spacing: { before: 100 },
        children: [new TextRun({ text: `[Не удалось вставить изображение: ${title}]`, italics: true, size: 18, font: "Calibri", color: "CC0000" })],
      }),
    ];
  }
}

function buildChartsDataPage(pressureResult: PressureProfileResult, chartImages?: Record<string, string>): Paragraph[] {
  const content: Paragraph[] = [
    sectionTitle("14. Графики - диаграммы и данные"),
  ];

  // Insert chart images if available
  if (chartImages) {
    if (chartImages.combined) content.push(...buildImageParagraph(chartImages.combined, "Совмещённый график цементирования", 1400, 550));
    if (chartImages.bhpVsFrac) content.push(...buildImageParagraph(chartImages.bhpVsFrac, "Давление на забое vs Давление ГРП", 1400, 400));
    if (chartImages.volVsPressure) content.push(...buildImageParagraph(chartImages.volVsPressure, "Объём vs Давление", 1400, 400));
    if (chartImages.pumpPlan) content.push(...buildImageParagraph(chartImages.pumpPlan, "План продавки: давления и макс. производительность", 1400, 500));
    if (chartImages.flowRegime) content.push(...buildImageParagraph(chartImages.flowRegime, "Режим потока в затрубном пространстве", 1400, 300));
  }

  // Tabular data as fallback / supplement
  const points = pressureResult.points;
  const sampled = points.filter((p, i) => i === 0 || i === points.length - 1 || Math.abs(p.time - Math.round(p.time)) < 0.05);

  const bhpHeaders = ["Время, мин", "Pзабой, МПа", "Pгрп, МПа", "Запас, МПа", "Qмакс, л/с"];
  const bhpRows = [
    new TableRow({ tableHeader: true, children: bhpHeaders.map(h => headerCell(h)) }),
    ...sampled.map(p => {
      const margin = p.fracturePressure - p.bottomholePressure;
      return new TableRow({
        children: [
          cell(fmt(p.time, 1), { align: AlignmentType.CENTER }),
          cell(fmt(p.bottomholePressure, 2), { align: AlignmentType.RIGHT }),
          cell(fmt(p.fracturePressure, 2), { align: AlignmentType.RIGHT }),
          cell(fmt(margin, 2), { align: AlignmentType.RIGHT, bold: margin < 1 }),
          cell(p.maxSafeRateLps > 0 ? fmt(p.maxSafeRateLps, 1) : "-", { align: AlignmentType.RIGHT, bold: true }),
        ],
      });
    }),
  ];

  content.push(new Paragraph({ spacing: { before: 300, after: 80 }, children: [new TextRun({ text: "Давление на забое vs Давление ГРП (табличные данные):", bold: true, size: 20, font: "Calibri" })] }));
  content.push(fixedReportTable(5, { width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, rows: bhpRows }) as any);

  return content;
}

// ======== Trajectory / Visualization ========

function buildTrajectoryPage(wellData: WellData, visualImages?: Record<string, string>): Paragraph[] {
  const traj = wellData.trajectory;
  const content: Paragraph[] = [
    sectionTitle("15. Визуализация скважины"),
  ];

  // Insert visual images if available
  if (visualImages) {
    if (visualImages.well3d) content.push(...buildImageParagraph(visualImages.well3d, "3D профиль ствола скважины", 1400, 550));
    if (visualImages.crossSection) content.push(...buildImageParagraph(visualImages.crossSection, "Продольный разрез скважины", 800, 1000));
    if (visualImages.displacementEfficiency) content.push(...buildImageParagraph(visualImages.displacementEfficiency, "Карта эффективности замещения", 800, 800));
  }

  if (!traj || traj.length < 2) return content;

  const headers = ["MD, м", "Азимут, °", "Зенит, °", "TVD, м"];
  const sorted = [...traj].sort((a, b) => a.md - b.md);

  const tableRows = [
    new TableRow({ children: headers.map(h => headerCell(h)) }),
    ...sorted.map(p => new TableRow({
      children: [
        cell(fmt(p.md, 1), { align: AlignmentType.RIGHT }),
        cell(fmt(p.azimuth, 1), { align: AlignmentType.RIGHT }),
        cell(fmt(p.zenith, 1), { align: AlignmentType.RIGHT }),
        cell(fmt(p.tvd, 1), { align: AlignmentType.RIGHT }),
      ],
    })),
  ];

  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);

  content.push(
    new Paragraph({
      spacing: { before: 200, after: 100 },
      children: [new TextRun({ text: "Таблица инклинометрии (траектория скважины):", bold: true, size: 20, font: "Calibri" })],
    }),
    fixedReportTable(headers.length, {
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: tableRows,
    }) as any,
    new Paragraph({ spacing: { after: 200 }, children: [] }),
    new Paragraph({
      spacing: { before: 150, after: 80 },
      children: [new TextRun({ text: "Конструкция скважины (поперечный разрез):", bold: true, size: 20, font: "Calibri" })],
    }),
    kvTable([
      { label: "Проход у башмака по профилю", value: `${fmt(boreDiameterAtDepth(wellData,wellData.casingDepthMD), 1)} мм` },
      { label: "Наружный диаметр ОК", value: `${wellData.casingOD} мм` },
      { label: "Внутренний диаметр ОК", value: `${fmt(casingID, 1)} мм` },
      { label: "Толщина стенки ОК", value: `${wellData.casingWall} мм` },
      { label: "Радиальный зазор у башмака", value: `${fmt((boreDiameterAtDepth(wellData,wellData.casingDepthMD) - wellData.casingOD) / 2, 1)} мм` },
      { label: "Предыдущая колонна (OD/ID)", value: `${wellData.prevCasingOD} / ${wellData.prevCasingID} мм` },
      { label: "Глубина предыдущей колонны", value: `${wellData.prevCasingDepth} м` },
    ]) as any,
  );

  return content;
}

// ======== WOC (ОЗЦ) section ========

function wocStrength(t_h: number, bhct: number, cls: "G" | "H" = "G") {
  const Ea = 38_000, R = 8.314, Tref = 273.15 + 50, T = 273.15 + bhct;
  const k0 = cls === "H" ? 0.18 : 0.14;
  const k = k0 * Math.exp((Ea / R) * (1 / Tref - 1 / T));
  const x = 1 - Math.exp(-k * t_h);
  const UCS_max = cls === "H" ? 28 : 22;
  const SGS_max = 800;
  return { ucs: UCS_max * Math.pow(x, 1.4), sgs: SGS_max * Math.pow(x, 0.85), x };
}

function wocTimeToUCS(target: number, bhct: number, cls: "G" | "H" = "G"): number | null {
  for (let t = 0.1; t <= 72; t += 0.1) {
    if (wocStrength(t, bhct, cls).ucs >= target) return t;
  }
  return null;
}
function wocTimeToSGS(target: number, bhct: number, cls: "G" | "H" = "G"): number | null {
  for (let t = 0.1; t <= 72; t += 0.1) {
    if (wocStrength(t, bhct, cls).sgs >= target) return t;
  }
  return null;
}

function buildWOCPage(wellData: WellData, slurries: SlurryInput[]): Paragraph[] {
  const content: Paragraph[] = [sectionTitle("17. Ожидание затвердевания цемента (ОЗЦ)")];
  const bhct = wellData.bottomTempCirc ?? 60;
  const bhst = wellData.bottomTempStatic ?? bhct + 20;
  const tail = slurries[slurries.length - 1] ?? slurries[0];
  const cls: "G" | "H" = "G";

  content.push(kvTable([
    { label: "Класс цемента", value: cls },
    { label: "BHCT (циркуляц. температура забоя)", value: `${fmt(bhct, 1)} °C` },
    { label: "BHST (статич. температура забоя)", value: `${fmt(bhst, 1)} °C` },
    { label: "Плотность тампонажного раствора", value: `${tail?.density ?? "-"} кг/м³` },
    { label: "TVD", value: `${wellData.wellDepthTVD} м` },
  ]) as any);

  const tHandling = wocTimeToUCS(1.4, bhct, cls);
  const tPerf = wocTimeToUCS(3.5, bhct, cls);
  const tGasOff = wocTimeToSGS(500, bhct, cls);

  content.push(new Paragraph({ spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: "Ключевые рубежи набора прочности:", bold: true, size: 20, font: "Calibri" })] }));
  content.push(kvTable([
    { label: "Выход из окна газопроявлений (SGS ≥ 500 lbf/100ft²)", value: tGasOff ? `${fmt(tGasOff, 1)} ч` : "не достигнут за 72 ч" },
    { label: "Handling strength (UCS ≥ 1.4 МПа)", value: tHandling ? `${fmt(tHandling, 1)} ч` : "не достигнут" },
    { label: "Разрешение перфорации (UCS ≥ 3.5 МПа)", value: tPerf ? `${fmt(tPerf, 1)} ч` : "не достигнут" },
    { label: "Рекомендуемое ОЗЦ (с запасом 1.3×)", value: tPerf ? `${fmt(tPerf * 1.3, 1)} ч` : "≥ 24 ч" },
  ]) as any);

  // Таблица значений
  const hours = [2, 4, 6, 8, 12, 16, 24, 36, 48];
  const headers = ["t, ч", "UCS, МПа", "SGS, lbf/100ft²", "Степень гидр., %"];
  const tableRows = [
    new TableRow({ children: headers.map(h => headerCell(h)) }),
    ...hours.map(t => {
      const s = wocStrength(t, bhct, cls);
      return new TableRow({ children: [
        cell(String(t), { align: AlignmentType.RIGHT }),
        cell(fmt(s.ucs, 2), { align: AlignmentType.RIGHT }),
        cell(fmt(s.sgs, 0), { align: AlignmentType.RIGHT }),
        cell(fmt(s.x * 100, 1), { align: AlignmentType.RIGHT }),
      ]});
    }),
  ];
  content.push(new Paragraph({ spacing: { before: 200, after: 80 },
    children: [new TextRun({ text: "Динамика набора прочности (модель Аррениуса):", bold: true, size: 20, font: "Calibri" })] }));
  content.push(fixedReportTable(headers.length, {
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: tableRows,
  }) as any);

  content.push(new Paragraph({ spacing: { before: 200 },
    children: [new TextRun({
      text: "Примечание: Значения получены упрощённой кинетической моделью гидратации (правило Аррениуса). Для критических операций требуется лабораторное подтверждение УГН-2 / Чандлера на реальной рецептуре.",
      italics: true, size: 18, color: "666666", font: "Calibri",
    })],
  }));

  return content;
}

// ======== Main export function ========

export interface DocxImages {
  chartImages?: Record<string, string>;  // data URLs
  visualImages?: Record<string, string>; // data URLs
  centralizationImages?: Record<string, string>; // data URLs
}

export async function exportToDocx(
  wellData: WellData,
  drillingFluid: DrillingFluid,
  slurries: SlurryInput[],
  buffers: BufferFluid[],
  displacementFluids: DisplacementFluid[],
  fractureGradient: number,
  images?: DocxImages,
  centralizationResults?: CentralizationResult[],
  preComputed?: {
    volumes?: VolumeResults;
    pressureResult?: PressureProfileResult;
    materials?: MaterialSummary;
    flushTimeMin?: number;
    flushVolumeM3?: number;
  },
  options?: { returnBlob?: boolean; filename?: string; foam?: FoamReportBundle; extras?: CementingReportExtras; selection?:ReportSelection },
): Promise<Blob | void> {
  const selection=options?.selection;
  const center=options?.extras?.centralization;
  if(center?.calculated)wellData={...wellData,centralizerMaterials:{geometryKey:centralizerMaterialGeometryKey(wellData),items:centralizerInventory(wellData.casingDepthMD,center.intervals)}};
  const volumes = preComputed?.volumes ?? calculateVolumes(wellData, slurries, displacementFluids?.[0]?.compressionCoeff ?? 1.0);
  const pressureResult = preComputed?.pressureResult ?? calculatePressureProfile(wellData, slurries, buffers, drillingFluid, displacementFluids, fractureGradient, volumes.displacementVolumeWithCompression, preComputed?.flushTimeMin, preComputed?.flushVolumeM3);
  const materials = { ...(preComputed?.materials ?? calculateMaterials(slurries, buffers, wellData)), equipmentItems:equipmentMaterialInventory(wellData) };
  const workTimeWithCement = pressureResult.stopTime - pressureResult.cementStartTime;

  const approvalBlock = fixedReportTable(2, {
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: ["СОГЛАСОВАНО", "УТВЕРЖДАЮ"].map((h) => new TableCell({
        borders: { top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } },
        width: { size: REPORT_TEXT_WIDTH / 2, type: WidthType.DXA },
        children: [
          new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 22, font: "Calibri" })] }),
          new Paragraph({ children: [new TextRun({ text: h === "УТВЕРЖДАЮ" ? "Главный инженер" : "Представитель заказчика", size: 20, font: "Calibri" })] }),
          new Paragraph({ children: [new TextRun({ text: "______________________________", size: 20, font: "Calibri" })] }),
          new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: "______________ / ______________ /", size: 20, font: "Calibri" })] }),
          new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: "«___» ____________ 20__ г.", size: 20, font: "Calibri" })] }),
        ],
      })),
    })],
  });
  const titlePage: Paragraph[] = [
    approvalBlock as any,
    new Paragraph({ spacing: { before: 1400 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new TextRun({ text: "ПРОГРАММА ЦЕМЕНТИРОВАНИЯ", bold: true, size: 36, font: "Calibri", color: "1A3A5C" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: "ОБСАДНОЙ КОЛОННЫ", bold: true, size: 28, font: "Calibri", color: "1A3A5C" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: `∅${wellData.casingOD} мм × ${wellData.casingWall} мм`, size: 24, font: "Calibri" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: `Глубина спуска: ${wellData.casingDepthMD} м (по стволу)`, size: 22, font: "Calibri" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: `Диаметр ствола: ${wellData.holeDiameter} мм`, size: 22, font: "Calibri" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 600 },
      children: [new TextRun({ text: new Date().toLocaleDateString("ru-RU"), size: 20, font: "Calibri", color: "666666" })],
    }),
  ];

  const inputContent = buildInputPage(wellData, drillingFluid, slurries, buffers, displacementFluids, fractureGradient, preComputed?.flushTimeMin, preComputed?.flushVolumeM3);
  const hydraulicsContent = buildHydraulicsPage(wellData, slurries, volumes, displacementFluids, drillingFluid, fractureGradient, workTimeWithCement, pressureResult, buffers);
  const scheduleContent = buildSchedulePage(pressureResult.processContract??buildProcessContract({wellData,drillingFluid,slurries,buffers,displacementFluids,fractureGradient,flushTimeMin:preComputed?.flushTimeMin??10,flushVolumeM3:preComputed?.flushVolumeM3??0},volumes.displacementVolumeWithCompression));
  if(pressureResult.processAudit){const a=pressureResult.processAudit;scheduleContent.push(kvTable([{label:'Моделирование: закачано до Стоп',value:fmt(a.pumpedVolumeM3,3)+' м³'},{label:'Разница с планом порций',value:fmt(a.differenceM3,3)+' м³'},{label:'Время Стоп в модели',value:fmt(pressureResult.stopTime,2)+' мин'}]) as any,noteParagraph(a.reason));}

  if(pressureResult.inventory){
    const a=pressureResult.inventory,names=new Map(pressureResult.processContract?.fluids.map(f=>[f.id,f.name])??[]);names.set('mud:initial','Исходный буровой раствор');
    scheduleContent.push(noteParagraph('Баланс жидкостей в скважине'),kvTable([
      {label:'Закачано / расчётный возврат',value:fmt(a.injectedM3,3)+' / '+fmt(a.returnedM3,3)+' м³'},
      {label:'Незаполненный объём трубы на Стоп',value:fmt(a.pipeVoidM3,3)+' м³'},
      {label:'Максимальная пошаговая невязка',value:a.maxStepResidualM3.toExponential(2)+' м³; '+a.maxStepResidualKg.toExponential(2)+' кг'},
      {label:'Масса в скважине / на возврате',value:fmt(a.retainedMassKg/1000,3)+' / '+fmt(a.returnedMassKg/1000,3)+' т'}
    ]) as any,gridTable(['Жидкость','Исходно, м³','Вход, м³','Труба, м³','Затрубье, м³','Возврат, м³'],a.fluids.map(f=>[names.get(f.fluidId)??f.fluidId,fmt(f.initialM3,3),fmt(f.injectedM3,3),fmt(f.pipeM3,3),fmt(f.annulusM3,3),fmt(f.returnedM3,3)])) as any,...a.limitations.map(noteParagraph));
  }
  const materialsContent = buildMaterialsPage(materials, wellData);
  const labContent = buildLabPage(wellData, slurries, volumes, pressureResult);
  const normsContent = buildNormsPage(wellData, slurries, buffers, drillingFluid, volumes, pressureResult);
  const logisticsContent = buildLogisticsPage(pressureResult, materials, slurries, wellData.logistics);
  const basketContent: any[] = [];
  const basket=pressureResult.basketStop;
  if(basket&&reportIncludes(selection,"basket")){
    basketContent.push(sectionTitle('Корзины: давление после Стоп'),noteParagraph(`Сценарий через ${basket.elapsedMin} мин. Основная гидравлика сохраняет полный столб без разгрузки.`));
    const depths=new Set([wellData.casingDepthMD,...basket.baskets.map(b=>b.md),...(wellData.reservoirLayers??[]).flatMap(l=>[l.topMD,l.bottomMD])]);
    basketContent.push(gridTable(['MD, м','Полный столб, МПа','Сценарий, МПа','Снижение, МПа','Пластовое, МПа','ГРП / потери, МПа'],basket.rows.filter(r=>depths.has(r.md)).map(r=>[fmt(r.md,1),fmt(r.withoutMPa),fmt(r.scenarioMPa),fmt(r.reductionMPa),r.poreMPa===null?'Не задано':fmt(r.poreMPa),r.limitMPa===null?'Не задано':fmt(r.limitMPa)])) as any);
    for(const b of basket.baskets){basketContent.push(noteParagraph(`${b.model}: MD ${b.md} м; передача ${fmt(b.transferPct,0)}%; ΔP ${fmt(b.transferredMPa)} МПа; реакция ${fmt(b.reactionKN)} кН; несущая способность ${b.capacityKN===undefined?'не задана':fmt(b.capacityKN)+' кН'}.`));b.notes.forEach(n=>basketContent.push(noteParagraph(n)));}
    basket.notes.forEach(n=>basketContent.push(noteParagraph(n)));
  }

  let riskContent: Paragraph[] = [];
  try {
    if(!reportIncludes(selection,"risks"))throw new Error("not selected");
    const risk = await runLossRisk({ wellData, drillingFluid, buffers, slurries, displacementFluids, fractureGradient, flushTimeMin: preComputed?.flushTimeMin ?? 10, flushVolumeM3: preComputed?.flushVolumeM3 ?? 0 }, { ...DEFAULT_RISK, iterations: 100 });
    riskContent = buildRiskPage(risk);
  } catch { riskContent = [noteParagraph("Оценка риска не выполнена; расчёт этого раздела недоступен.")]; }
  const pressureProfileContent = buildPressureProfilePage(pressureResult);
  const chartsDataContent = buildChartsDataPage(pressureResult, images?.chartImages);
  const trajectoryContent = buildTrajectoryPage(wellData, images?.visualImages);
  const sections: {properties:ReturnType<typeof reportPageProperties>;headers?:{default:Header};children:any[]}[]=[{properties:reportPageProperties(),children:titlePage}];
  const add=(key:Parameters<typeof reportIncludes>[1],title:string,children:any[])=>{if(reportIncludes(selection,key)&&children.length)sections.push({properties:reportPageProperties(),headers:{default:new Header({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:title,size:16,color:"999999",font:"Calibri"})]})]})},children});};
  add('inputs','Исходные данные',inputContent);
  const rheologyContent:any[]=[sectionTitle('Реология жидкостей'),noteParagraph('Конфигурация Fann R1-B1-F1. МНК Бингама - по напряжению; степенная и Гершель-Балкли - регрессия в логарифмах, для ГБ перебор предела текучести. Метрики рассчитаны в Па. Графики ограничены диапазоном измерений; вне него - экстраполяция. Подбор не подтверждает стабильность или совместимость.')];
  for(const f of rheologyReportFluids({drillingFluid,buffers,slurries,displacementFluids})){
    const res=rheologyResolution(f.r);rheologyContent.push(noteParagraph(f.name+': '+rheologyDescription(f.appliedR)+(f.appliedR!==f.r?'; использованы модельные PV/YP по типу жидкости (не измерения)':'')));
    if(res.fit){const fit=res.fit;rheologyContent.push(gridTable(['Модель','R²','RMSE, Па','Макс. ошибка, Па'],(['bingham','powerLaw','hb'] as const).map(m=>{const a=rheologyMetrics(fit,m);return [m,fmt(a.r2,5),fmt(a.rmse,4),fmt(a.maxError,4)];})) as any,gridTable(['об/мин','γ, с⁻¹','τ, Па'],fit.points.map(p=>[String(p.rpm),fmt(p.gamma,3),fmt(p.tau,4)])) as any);}
  }
  add('rheology','Модели и измерения реологии',rheologyContent);
  add('hydraulics','Объёмы и гидравлика',hydraulicsContent);
  add('schedule','Программа закачки',scheduleContent);
  if(wellData.stopStorage?.plugBenchEnabled&&reportIncludes(selection,'plugBenchmark')){
    const config=wellData.stopStorage.plugBenchCase,content:any[]=[sectionTitle('Проверочный стенд движения поршня (не скважина)')];
    if(!config)content.push(noteParagraph('Не задан самостоятельный эталонный сценарий стенда.'));
    else{const bench=evaluatePlugBench(wellData.stopStorage)!,last=bench.samples.at(-1),first=bench.samples[0];content.push(noteParagraph(bench.reason),kvTable(MOVING_PLUG_FIELDS.map(([key,label])=>({label,value:String(bench.input[key])}))) as any,
      kvTable([{label:'Достижение заданного упора',value:bench.landingTimeSec===null?'Не достигнут':fmt(bench.landingTimeSec,6)+' с'},{label:'Максимальная пошаговая невязка массы',value:bench.maxMassResidualKg.toExponential(3)+' кг'}]) as any,...bench.limitations.map(noteParagraph));
      if(first&&last)content.push(gridTable(['Камера','Исходно, кг','Подача, кг','Возврат, кг','Осталось, кг'],[['Сзади',fmt(first.backMassKg,6),fmt(last.injectedKg,6),'0',fmt(last.backMassKg,6)],['Впереди',fmt(first.aheadMassKg,6),'0',fmt(last.returnedKg,6),fmt(last.aheadMassKg,6)]]) as any);
      if(bench.spatial){const sp=bench.spatial;content.push(sectionTitle('Перенос пассивной метки на движущейся сетке'),noteParagraph(sp.reason),noteParagraph('Траектория и давления заданы двухкамерной моделью; метка имеет те же плотность и K, что жидкость сзади, и не влияет на движение. Это не распределённый расчёт гидравлики скважины. Фронт численно размывается апвиндом первого порядка.'),kvTable([{label:'Ячеек на камеру / подача метки с',value:String(sp.cellsPerChamber)+' / '+fmt(sp.switchSec,3)+' с'},{label:'Принятые шаги / кадры просмотра',value:String(sp.acceptedSteps)+' / '+String(sp.frames.length)},{label:'Максимальная компонентная невязка',value:sp.frames.length?sp.maxComponentResidualKg.toExponential(3)+' кг':'Не определена'},{label:'Максимальная геометрическая невязка',value:sp.frames.length?sp.maxGeometricResidualM3.toExponential(3)+' м³':'Не определена'}]) as any);
        if(sp.frames.length)content.push(gridTable(['Компонент','Исходно, кг','Подача, кг','Возврат, кг','Осталось, кг'],['Исходная сзади','Метка подачи','Жидкость впереди'].map((name,j)=>[name,fmt(sp.initialKg[j],6),fmt(sp.injectedKg[j],6),fmt(sp.returnedKg[j],6),fmt(sp.retainedKg[j],6)])) as any);}
      if(bench.hydraulics){const h=bench.hydraulics,hf=h.frames.at(-1);content.push(sectionTitle('Локальные давления на заданной траектории'),noteParagraph(h.reason),noteParagraph('Независимые EOS, баланс массы и ламинарное сопротивление Пуазейля. Обе камеры ньютоновские, с одинаковой вязкостью. Движение задано двухкамерным решением и не пересчитывается по локальным давлениям. Инерция, турбулентность, тепло и реология цемента не включены; Re не выше 2000. Баланс отличается от переноса метки на однородных камерных массах.'),kvTable([{label:'Вязкость / ячеек в каждой камере',value:String(h.viscosityMpas)+' мПа·с / '+String(h.cellsPerChamber)},{label:'Момент подачи метки',value:fmt(h.switchSec,3)+' с'},{label:'Принятые шаги / кадры',value:String(h.acceptedSteps)+' / '+String(h.frames.length)},{label:'Максимальная невязка непрерывности',value:hf?h.maxMassResidualKg.toExponential(3)+' кг':'Не определена'},{label:'Максимальная компонентная невязка',value:hf?h.maxComponentResidualKg.toExponential(3)+' кг':'Не определена'},{label:'Максимальный Re',value:hf?fmt(h.maxReynolds,2):'Не определён'}]) as any);
        if(hf)content.push(kvTable([{label:'Последнее принятое время',value:fmt(hf.timeSec,6)+' с'},{label:'Давление на входе',value:fmt(hf.inletMPa,6)+' МПа'},{label:'На поршне сзади / впереди',value:fmt(hf.backWallMPa,6)+' / '+fmt(hf.aheadWallMPa,6)+' МПа'},{label:'Несогласованность силового баланса',value:hf.movingForceMismatchMPa===null?'Не применяется при покое или на упоре':hf.movingForceMismatchMPa.toExponential(3)+' МПа (заданная траектория)'}]) as any,gridTable(['Компонент','Исходно, кг','Подача, кг','Возврат, кг','Осталось, кг'],['Исходная сзади','Метка подачи','Жидкость впереди'].map((name,j)=>[name,fmt(h.initialKg[j],6),fmt(h.injectedKg[j],6),fmt(h.returnedKg[j],6),fmt(h.retainedKg[j],6)])) as any);
      }
      if(bench.coupled){const c=bench.coupled,cf=c.frames.at(-1);content.push(sectionTitle('Связанный расчёт движения и давления'),noteParagraph(c.reason),noteParagraph('Координата поршня и ячеечные давления определяются совместно: вложенное решение непрерывности, EOS и силового баланса на поверхностях поршня. Камерная траектория не используется. Движение только вперёд, после посадки поршень остаётся на упоре; реакция упора учитывается отдельно. Горизонтальная жёсткая труба, ньютоновские жидкости с общей вязкостью, Re не выше 2000. Нет инерции, гидроудара, реологии цемента, тепла или производственной геометрии скважины.'),kvTable([{label:'Вязкость / ячеек на камеру',value:String(c.viscosityMpas)+' мПа·с / '+String(c.cellsPerChamber)},{label:'Посадка в связанном расчёте',value:c.landingTimeSec===null?'Не достигнута':fmt(c.landingTimeSec,6)+' с'},{label:'Принятые шаги / отклонённые попытки',value:String(c.acceptedSteps)+' / '+String(c.rejectedSteps)},{label:'Максимальная силовая невязка',value:cf?c.maxForceResidualMPa.toExponential(3)+' МПа':'Не определена'},{label:'Максимальная невязка непрерывности',value:cf?c.maxMassResidualKg.toExponential(3)+' кг':'Не определена'},{label:'Максимальная компонентная невязка',value:cf?c.maxComponentResidualKg.toExponential(3)+' кг':'Не определена'},{label:'Максимальный Re',value:cf?fmt(c.maxReynolds,2):'Не определён'}]) as any);
        if(cf)content.push(kvTable([{label:'Последнее принятое время / положение',value:fmt(cf.timeSec,6)+' с / '+fmt(cf.xM,6)+' м'},{label:'Давление на входе',value:fmt(cf.inletMPa,6)+' МПа'},{label:'На поршне сзади / впереди',value:fmt(cf.backWallMPa,6)+' / '+fmt(cf.aheadWallMPa,6)+' МПа'},{label:'Режим / реакция упора на единицу площади',value:({stuck:'Покой',moving:'Движение',seated:'На упоре'}[cf.mode])+' / '+fmt(cf.seatReactionMPa,6)+' МПа'}]) as any,gridTable(['Компонент','Исходно, кг','Подача, кг','Возврат, кг','Осталось, кг'],['Исходная сзади','Метка подачи','Жидкость впереди'].map((name,j)=>[name,fmt(c.initialKg[j],6),fmt(c.injectedKg[j],6),fmt(c.returnedKg[j],6),fmt(c.retainedKg[j],6)])) as any);
      }
      if(options?.extras?.figures?.some(f=>f.reportItem==='plugBenchmark'&&f.sourceKey!==plugBenchKey(wellData.stopStorage)))content.push(noteParagraph('Устаревшие иллюстрации стенда исключены: параметры изменились.'));
    }add('plugBenchmark','Проверочный стенд движения поршня',content);
  }

  const suppliedTransport=options?.extras?.compressibleTransport;
  const freshTransport=suppliedTransport?.inputKey===transportInputKey({wellData,drillingFluid,slurries,buffers,displacementFluids,fractureGradient,flushTimeMin:preComputed?.flushTimeMin??10,flushVolumeM3:preComputed?.flushVolumeM3??0})?suppliedTransport:undefined;
  if(suppliedTransport){
    const content:any[]=[sectionTitle('Исследовательский сжимаемый 1D-перенос')];
    if(!freshTransport)content.push(noteParagraph('Результат устарел: исходные данные изменились. Пересчитайте исследовательскую ветку.'));
    else{const r=freshTransport;content.push(noteParagraph((r.status==='complete'?'Назначенное расписание рассчитано. ':'Расчёт остановлен; представлен только принятый участок. ')+r.reason),
      kvTable([{label:'Сетка и шаг',value:r.cellCount+' ячеек; назначено '+fmt(r.cellLengthM,1)+' м; максимум '+fmt(r.stepSeconds,2)+' с'},{label:'Принятые шаги',value:String(r.acceptedSteps)},{label:'Максимальная относительная невязка шага',value:r.maxStepRelativeResidual.toExponential(3)}]) as any,
      gridTable(['Жидкость','K, МПа','Исходно, кг','Подача, кг','Возврат, кг','В контуре, кг'],r.components.map(f=>[f.name,fmt(f.bulkMPa,1),fmt(f.initialKg,3),fmt(f.injectedKg,3),fmt(f.returnedKg,3),fmt(f.retainedKg,3)])) as any,
      ...r.components.map(f=>noteParagraph(f.name+': накопленная невязка '+f.residualKg.toExponential(3)+' кг.')),
      ...r.limitations.map(noteParagraph),...(r.boundaryEvents??[]).map(e=>noteParagraph('t = '+fmt(e.timeMin,3)+' мин; ЦКОД '+fmt(e.depthMD,1)+' м. '+e.note)));
      if(r.study?.inputKey===r.inputKey){const study=r.study;content.push(sectionTitle('Чувствительность к сетке и шагу'),noteParagraph(study.note),noteParagraph('Полных прогонов: '+study.rows.filter(x=>x.status==='complete').length+' из '+study.rows.length+'.'),
        gridTable(['Прогон','Ячеек','Длина min-max, м','Макс. шаг, с','Шагов','Баланс, кг'],study.rows.map(x=>[x.label,String(x.cellCount),x.minCellLengthM.toPrecision(4)+' - '+x.maxCellLengthM.toPrecision(4),fmt(x.stepSeconds,2),String(x.acceptedSteps),x.maxMassResidualKg.toExponential(2)])) as any,
        ...study.rows.filter(x=>x.status!=='complete').map(x=>noteParagraph(x.label+': остановлен. '+x.reason)),
        gridTable(['Сравнение','Разность подачи, МПа','Разность возврата, м³','L1 состава (0-2)'],study.comparisons.map(x=>[x.label,x.maxInletDifferenceMPa.toExponential(3),x.returnDifferenceM3.toExponential(3),x.compositionL1.toExponential(3)])) as any,
        ...study.comparisons.filter(x=>x.barrierTransferredDifferenceKg!==undefined).map(x=>noteParagraph(x.label+': разность массы через ЦКОД '+x.barrierTransferredDifferenceKg!.toExponential(3)+' кг. До перекрытия: '+(x.beforeClosureMPa===undefined?'нет общей выборки':x.beforeClosureMPa.toExponential(3)+' МПа')+'. После перекрытия: '+(x.afterClosureMPa===undefined?'нет общей выборки или перекрытие не задано':x.afterClosureMPa.toExponential(3)+' МПа; общая выборка с '+fmt(x.afterComparisonStartMin!,3)+' мин')+'.')));}

    }
    add('compressibleTransport','Исследовательский сжимаемый перенос',content);
  }
  if(pressureResult.pvtHydrostatics){
    const r=pressureResult.pvtHydrostatics,e=r.curve.at(-1),content:any[]=[sectionTitle('PVT-гидростатика при фиксированных границах'),noteParagraph('Сравнительные равновесные состояния по кадрам основной закачки. Эти значения не подменяют динамические давления и не являются балансом массы закачки.'),
      kvTable([{label:'Опорное давление / противодавление',value:fmt(r.referencePressureMPa,3)+' / '+fmt(r.surfaceBackpressureMPa,3)+' МПа изб.'},{label:'Источник свойств',value:r.source.trim()||'Не указан; требуется подтверждение.'}]) as any,...r.issues.map(noteParagraph)];
    if(e)content.push(gridTable(['Жидкость','ρ при опорном давлении, кг/м³','K, МПа'],r.properties.map(p=>[p.name,fmt(p.densityKgM3,2),fmt(p.bulkModulusMPa,2)])) as any,kvTable([{label:'PVT-гидростатика затрубья на Стоп',value:fmt(e.annularBottomMPa,3)+' МПа'},{label:'Максимальное отличие от постоянной плотности',value:fmt(r.maxPressureDifferenceMPa,3)+' МПа'},{label:'Максимальное изменение плотности',value:fmt(r.maxDensityChangePct,3)+'%'},{label:'Масса равновесных столбов: труба / затрубье',value:fmt(e.pipeMassKg/1000,3)+' / '+fmt(e.annularMassKg/1000,3)+' т'},{label:'Эквивалентный объём при опорном давлении: труба / затрубье',value:fmt(e.pipeReferenceVolumeM3,3)+' / '+fmt(e.annularReferenceVolumeM3,3)+' м³'}]) as any,
      gridTable(['Столб','MD, м','Жидкость','P верх/низ, МПа','ρ верх/низ, кг/м³'],[...r.finalPipe.map(c=>({...c,leg:'Труба'})),...r.finalAnnulus.map(c=>({...c,leg:'Затрубье'}))].slice(0,100).map(c=>[c.leg,fmt(c.topMD,1)+'-'+fmt(c.bottomMD,1),c.fluidName,fmt(c.topPressureMPa,3)+' / '+fmt(c.bottomPressureMPa,3),fmt(c.topDensityKgM3,1)+' / '+fmt(c.bottomDensityKgM3,1)])) as any);
    if(r.finalPipe.length+r.finalAnnulus.length>100)content.push(noteParagraph('В отчёте показаны первые 100 сегментов конечного профиля.'));
    content.push(...r.limitations.map(noteParagraph));add('pvtHydrostatics','PVT-гидростатика',content);
  }
  if(pressureResult.stopStorage){
    const r=pressureResult.stopStorage,e=r.curve.at(-1),p=r.settings;
    const content:any[]=[sectionTitle('Сжатие и упругость после посадки пробки'),noteParagraph('Это дополнительная подача после геометрического Стоп; замещение и баланс до Стоп не увеличиваются. Прирост давления не является допустимым или абсолютным устьевым давлением.'),
      kvTable([{label:'Прирост давления / расход',value:fmt(p.pressureRiseMPa,3)+' МПа / '+fmt(p.rateLps,3)+' л/с'},{label:'Упругость стали E / ν',value:fmt(p.youngModulusMPa,0)+' МПа / '+fmt(p.poissonRatio,3)},{label:'Закрепление',value:p.restraint==='fixedLength'?'Длина закреплена':'Закрытые торцы, свободное удлинение'},{label:'Источник',value:p.source.trim()||'Не указан; требуется подтверждение.'}]) as any,
      ...r.issues.map(noteParagraph)];
    if(e)content.push(kvTable([{label:'Вместимость над пробкой',value:fmt(r.baselineCapacityM3,3)+' м³'},{label:'Дополнительная подача',value:fmt(e.injectedReferenceM3*1000,2)+' л'},{label:'Сжатие жидкостей / расширение колонны',value:fmt(e.fluidCompressionReferenceM3*1000,2)+' / '+fmt(e.steelExpansionReferenceM3*1000,2)+' л'},{label:'Длительность дополнительной подачи',value:fmt(e.timeMin,3)+' мин'},{label:'Расчётный обратимый объём при снятии прироста давления',value:fmt(e.injectedReferenceM3*1000,2)+' л'},{label:'Максимальные невязки',value:Math.max(...r.curve.map(p=>Math.abs(p.residualM3))).toExponential(2)+' м³; '+Math.max(...r.curve.map(p=>Math.abs(p.residualKg))).toExponential(2)+' кг'}]) as any,
      gridTable(['Жидкость','Над пробкой, м³','K, МПа','ρ исходная, кг/м³'],r.fluids.map(f=>[f.name,fmt(f.volumeM3,3),fmt(f.bulkModulusMPa,2),fmt(f.densityKgM3,1)])) as any,
      gridTable(['ΔP, МПа','Подача, л','Сжатие, л','Колонна, л','Время, мин'],r.curve.filter((_,i)=>i%4===0).map(p=>[fmt(p.pressureRiseMPa,3),fmt(p.injectedReferenceM3*1000,2),fmt(p.fluidCompressionReferenceM3*1000,2),fmt(p.steelExpansionReferenceM3*1000,2),fmt(p.timeMin,3)])) as any);
    content.push(...r.limitations.map(noteParagraph));add('stopStorage','Сжатие после посадки',content);
  }

  add('materials','Ведомость материалов',materialsContent);
  add('lab','Рецептура и лабораторные требования',labContent);
  add('norms','Проверки ограничений',normsContent);
  add('logistics','Техника, персонал и график работ',logisticsContent);
  add('basket','Корзины: давление после Стоп',basketContent);
  add('risks','Оценка рисков',riskContent);
  add('pressureTable','План продавки',pressureProfileContent);
  add('chartData','Числовые данные графиков',chartsDataContent);
  add('woc','ОЗЦ',buildWOCPage(wellData,slurries));
  const reportExtras=options?.extras?{...options.extras,figures:options.extras.figures?.filter(f=>(f.reportItem!=='compressibleTransport'||!!freshTransport)&&(f.reportItem!=='plugBenchmark'||wellData.stopStorage?.plugBenchEnabled&&f.sourceKey===plugBenchKey(wellData.stopStorage)))}:undefined;
  const extraContent=buildCementingReportExtras(wellData,reportExtras,'cementing',selection);
  if(extraContent.length)sections.push({properties:reportPageProperties(),children:extraContent});
  const doc=new Document({styles:{default:{document:{run:{font:"Calibri",size:20}}}},sections});

  const blob = await Packer.toBlob(doc);
  if (options?.returnBlob) return blob;
  saveAs(blob, options?.filename ?? "cementing-program.docx");
}
