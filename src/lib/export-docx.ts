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
  calculateVolumes, calculateHydraulics, calculateSafeTime, calculateBHCT,
  calculateMaterials, calculatePressureProfile,
  getSlurryHeight, getCasingID, interpolateTVD, getFlowRateLps, getEffectiveTrajectory,
  annularVolumePerMeter, pipeVolumePerMeter,
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
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: rows.map(r => kvRow(r.label, r.value)),
  });
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
    result.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, rows: csRows }) as any);
  }

  // Cavern intervals
  if (wellData.cavernIntervals && wellData.cavernIntervals.length > 0) {
    result.push(new Paragraph({ spacing: { before: 150, after: 80 }, children: [new TextRun({ text: "Интервалы кавернозности (открытый ствол):", bold: true, size: 20, font: "Calibri" })] }));
    const ciHeaders = ["От (MD), м", "До (MD), м", "Коэфф. каверн."];
    const ciRows = [
      new TableRow({ children: ciHeaders.map(h => headerCell(h)) }),
      ...wellData.cavernIntervals.map(iv => new TableRow({
        children: [
          cell(fmt(iv.fromMD, 0), { align: AlignmentType.CENTER }),
          cell(fmt(iv.toMD, 0), { align: AlignmentType.CENTER }),
          cell(fmt(iv.coeff, 2), { align: AlignmentType.CENTER }),
        ],
      })),
    ];
    result.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, rows: ciRows }) as any);
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
          cell(p.tvd ? fmt(p.tvd, 2) : "—", { align: AlignmentType.RIGHT }),
        ],
      })),
    ];
    result.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, rows: trajRows }) as any);
  }

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
    result.push(kvTable(bRows) as any);
    // Flow rate steps
    if (b.flowRateSteps && b.flowRateSteps.length > 0) {
      b.flowRateSteps.forEach((step, si) => {
        result.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `  Режим ${si + 1}: ${fmt(step.rateLps, 1)} л/с × ${fmt(step.volumeM3, 2)} м³`, size: 18, font: "Calibri" })] }));
      });
    }
    // Additives
    if (b.additives && b.additives.length > 0) {
      const bufferMassKg = b.volume * b.density;
      b.additives.forEach(a => {
        if (a.name) {
          const computedMass = a.percentage > 0 ? (a.percentage / 100) * bufferMassKg : a.massKg;
          result.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `  ${a.name}: ${a.percentage}% = ${computedMass > 0 ? computedMass.toFixed(1) : "—"} кг`, size: 18, font: "Calibri" })] }));
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
      { label: "В/Ц отношение", value: `${s.waterRatio}` },
      { label: "Выход, м³/т", value: `${s.yieldPerTon ?? 0}` },
      { label: "PV / YP", value: `${s.rheology.pv} сПз / ${s.rheology.yp} Па` },
      { label: "Загустевание 30 Вс", value: `${s.thickeningTime30Bc || "—"} мин` },
      { label: "Загустевание 50 Вс", value: `${s.thickeningTime50Bc || "—"} мин` },
    ];
    result.push(kvTable(sRows) as any);
    // Flow rate steps
    if (s.flowRateSteps && s.flowRateSteps.length > 0) {
      s.flowRateSteps.forEach((step, si) => {
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
    result.push(kvTable(dfRows) as any);
    if (df.flowRateSteps && df.flowRateSteps.length > 0) {
      df.flowRateSteps.forEach((step, si) => {
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

function buildHydraulicsPage(wellData: WellData, slurries: SlurryInput[], volumes: VolumeResults, displacementFluids: DisplacementFluid[], drillingFluid: DrillingFluid, fractureGradient: number, workTimeWithCement: number, pressureResult?: PressureProfileResult): Paragraph[] {
  const dispFluid = displacementFluids[0];
  const pumpRate = dispFluid ? getFlowRateLps(dispFluid.flowRateSteps) : 0;
  const results = calculateHydraulics(wellData, slurries, (dispFluid?.density ?? 1000) / 1000, fractureGradient, drillingFluid.rheology, dispFluid?.rheology, pumpRate,
    drillingFluid ? drillingFluid.density / 1000 : undefined
  );
  const traj = getEffectiveTrajectory(wellData);
  const bottomTVD = interpolateTVD(wellData.casingDepthMD, traj);
  const bhct = calculateBHCT(wellData.bottomTempStatic, 20, bottomTVD);
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
    { label: "Эквивалентный диаметр (с каверн.)", value: `${fmt(volumes.equivalentDiameter, 1)} мм` },
    { label: "Межтрубное пр-во", value: `${fmt(volumes.annularVolumePerMeterPrevCasing, 4)} м³/м` },
    { label: "Затрубное пр-во", value: `${fmt(volumes.annularVolumePerMeter, 4)} м³/м` },
    { label: "Внутр. объём колонны", value: `${fmt(volumes.pipeVolumePerMeter, 4)} м³/м` },
    { label: "Расчётный объём продавки", value: `${fmt(volumes.displacementVolume, 1)} м³` },
    { label: "С учётом коэф. сжатия (5%)", value: `${fmt(volumes.displacementVolumeWithCompression, 1)} м³` },
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
    { label: "Скачок давления посадки пробки", value: `2.75 МПа` },
    { label: "Расчётное давление «СТОП»", value: `${fmt(dynamicStopP ?? results.stopPressure)} МПа` },
    { label: "BHCT", value: `${fmt(bhct, 1)} °C` },
  ];

  const safetyOk = dynamicSafetyCoeff < 1;

  const safeRows = [
    { label: "Расчётное время работы с цементом", value: `${fmt(safeTime.workTimeWithCement, 0)} мин` },
    { label: "Безопасное время (75% от загуст.)", value: `${safeTime.safeTime75} мин` },
    { label: "Загустевание до 30 Вс (лаб.)", value: maxThickening30 ? `${maxThickening30} мин` : "—" },
    { label: "Загустевание до 50 Вс (лаб.)", value: maxThickening50 ? `${maxThickening50} мин` : "—" },
  ];

  const content: Paragraph[] = [
    sectionTitle("5. Данные для расчёта (объёмы)"),
  ];
  content.push(kvTable(volRows) as any);
  content.push(sectionTitle("6. Гидравлический расчёт"));
  content.push(kvTable(pressRows) as any);
  content.push(new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({
      text: safetyOk
        ? "✓ Коэффициент безопасности в норме (< 1.0)"
        : "⚠ Коэффициент безопасности превышает 1.0 — риск гидроразрыва!",
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
          : `⚠ Загустевание (${maxThickening30} мин) < безопасное время (${safeTime.safeTime75} мин) — ОПАСНО!`,
        size: 18, font: "Calibri", bold: true,
        color: safeTime.isSafe ? "228B22" : "CC0000",
      })],
    }));
  }

  return content;
}

function buildSchedulePage(buffers: BufferFluid[], slurries: SlurryInput[], annularVPM: number, displacementVolume: number, displacementFluids: DisplacementFluid[], casingDepthMD: number): Paragraph[] {
  const lpsToM3min = (lps: number) => lps * 0.06;
  const defaultRate = displacementFluids.length > 0 && displacementFluids[0].flowRateSteps.length > 0
    ? displacementFluids[0].flowRateSteps[0].rateLps : 8;

  const stages: { name: string; fluid: string; rateLps: number; volume: number }[] = [];
  stages.push({ name: "Заполнение ЛВД", fluid: "Тех. вода", rateLps: defaultRate * 0.5, volume: 1.0 });
  stages.push({ name: "Опрессовка ЛВД (25 МПа)", fluid: "—", rateLps: 0, volume: 0 });

  buffers.forEach(b => {
    if (b.flowRateSteps.length > 1) {
      b.flowRateSteps.forEach((step, si) => {
        if (step.volumeM3 > 0) stages.push({ name: `${b.name} (режим ${si + 1})`, fluid: `${b.name} (${b.density} кг/м³)`, rateLps: step.rateLps, volume: step.volumeM3 });
      });
    } else {
      const rate = b.flowRateSteps.length > 0 ? b.flowRateSteps[0].rateLps : 5;
      stages.push({ name: `Буфер: ${b.name}`, fluid: `${b.name} (${b.density} кг/м³)`, rateLps: rate, volume: b.volume });
    }
  });

  slurries.forEach((s, origIdx) => {
    const height = getSlurryHeight(slurries, origIdx, casingDepthMD);
    const vol = annularVPM * height;
    if (vol > 0) {
      if (s.flowRateSteps.length > 1) {
        s.flowRateSteps.forEach((step, si) => {
          if (step.volumeM3 > 0) stages.push({ name: `${s.name} (режим ${si + 1})`, fluid: `${s.name} (${s.density} г/см³)`, rateLps: step.rateLps, volume: step.volumeM3 });
        });
      } else {
        const rate = s.flowRateSteps.length > 0 ? s.flowRateSteps[0].rateLps : 5;
        stages.push({ name: `ЦР: ${s.name}`, fluid: `${s.name} (${s.density} г/см³)`, rateLps: rate, volume: vol });
      }
    }
  });

  stages.push({ name: "Промывка ЛВД, сброс пробки", fluid: "Тех. вода", rateLps: defaultRate * 0.5, volume: 1.5 });

  displacementFluids.forEach((df, dfIdx) => {
    const label = displacementFluids.length > 1 ? `${df.name} (порция ${dfIdx + 1})` : df.name;
    if (df.flowRateSteps.length > 0) {
      const totalStepVol = df.flowRateSteps.reduce((s, st) => s + st.volumeM3, 0);
      if (totalStepVol > 0) {
        df.flowRateSteps.forEach((step, si) => {
          if (step.volumeM3 > 0) stages.push({ name: `Продавка: ${label} (режим ${si + 1})`, fluid: `${df.name} (${df.density} кг/м³)`, rateLps: step.rateLps, volume: step.volumeM3 });
        });
      } else {
        df.flowRateSteps.forEach((step, si) => {
          stages.push({ name: `Продавка: ${label} (режим ${si + 1})`, fluid: `${df.name} (${df.density} кг/м³)`, rateLps: step.rateLps, volume: 0 });
        });
      }
    }
  });

  stages.push({ name: "Фиксация «СТОП», проверка ЦКОД", fluid: "—", rateLps: 0, volume: 0 });
  stages.push({ name: "Промывка ЛВД, демонтаж ГЦУ", fluid: "Тех. вода", rateLps: 0, volume: 0 });

  let cumulative = 0, cumTime = 0;
  const stagesData = stages.map(s => {
    cumulative += s.volume;
    const rateM3min = lpsToM3min(s.rateLps);
    const time = rateM3min > 0 ? s.volume / rateM3min : (s.name.includes("Опрессовка") ? 10 : s.name.includes("СТОП") ? 15 : s.name.includes("демонтаж") ? 45 : 0);
    cumTime += time;
    return { ...s, cumulative, time, cumTime };
  });

  const headers = ["Этап", "Жидкость", "л/с", "V, м³", "Время, мин", "∑ мин", "∑ V, м³"];

  const tableRows = [
    new TableRow({
      children: headers.map(h => headerCell(h)),
    }),
    ...stagesData.map(s => new TableRow({
      children: [
        cell(s.name),
        cell(s.fluid),
        cell(s.rateLps > 0 ? fmt(s.rateLps, 1) : "—", { align: AlignmentType.CENTER }),
        cell(s.volume > 0 ? fmt(s.volume, 1) : "—", { align: AlignmentType.RIGHT }),
        cell(fmt(s.time, 1), { align: AlignmentType.RIGHT }),
        cell(fmt(s.cumTime, 1), { align: AlignmentType.RIGHT }),
        cell(s.volume > 0 ? fmt(s.cumulative, 1) : "—", { align: AlignmentType.RIGHT }),
      ],
    })),
    new TableRow({
      children: [
        cell("ИТОГО", { bold: true }),
        cell(""),
        cell(""),
        cell(""),
        cell(""),
        cell(fmt(cumTime, 1), { bold: true, align: AlignmentType.RIGHT }),
        cell(fmt(cumulative, 1), { bold: true, align: AlignmentType.RIGHT }),
      ],
    }),
  ];

  return [
    sectionTitle("8. Порядок закачки технологических жидкостей"),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: tableRows,
    }) as any,
  ];
}

function buildMaterialsPage(materials: MaterialSummary): Paragraph[] {
  const matHeaders = ["Наименование", "Количество", "Ед. изм."];
  const makeMatTable = (items: { name: string; amount: number; unit: string }[]) => {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: [
        new TableRow({ children: matHeaders.map(h => headerCell(h)) }),
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
    makeMatTable(materials.cementItems),
    new Paragraph({ spacing: { after: 150 }, children: [] }),
    sectionTitle("10. Буферные материалы"),
    makeMatTable(materials.bufferItems),
    new Paragraph({ spacing: { after: 150 }, children: [] }),
    sectionTitle("11. Технологическая оснастка"),
    makeMatTable(materials.equipmentItems),
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
        cell(p.maxSafeRateLps > 0 ? fmt(p.maxSafeRateLps, 1) : "—", { align: AlignmentType.RIGHT, bold: true }),
        cell(p.stage),
      ],
    })),
  ];

  const safeRows = [
    { label: "Начало закачки цемента", value: `${fmt(pressureResult.cementStartTime, 1)} мин` },
    { label: "Момент «СТОП»", value: `${fmt(pressureResult.stopTime, 1)} мин` },
    { label: "Время работы с цементом", value: `${fmt(pressureResult.stopTime - pressureResult.cementStartTime, 1)} мин` },
    { label: "Безопасное время (75%)", value: `${fmt(pressureResult.safeWorkingTimeMin, 1)} мин` },
    { label: "Время равновесия U-tube", value: pressureResult.equilibriumTimeMin > 0 ? `~${fmt(pressureResult.equilibriumTimeMin, 0)} мин` : "—" },
  ];

  const boundaryRows = pressureResult.stageBoundaries.map(b => ({
    label: b.label,
    value: `${fmt(b.time, 1)} мин`,
  }));

  const content: Paragraph[] = [
    sectionTitle("13. План продавки — давления, производительность и ограничения"),
    new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({
        text: "Qмакс — максимальная производительность, при которой забойное давление не превышает давление ГРП. Оператор должен придерживаться этого ограничения.",
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
  content.push(new Table({
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
            transformation: { width: 580, height: Math.round(580 * heightPx / widthPx) },
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
    sectionTitle("14. Графики — диаграммы и данные"),
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
    new TableRow({ children: bhpHeaders.map(h => headerCell(h)) }),
    ...sampled.map(p => {
      const margin = p.fracturePressure - p.bottomholePressure;
      return new TableRow({
        children: [
          cell(fmt(p.time, 1), { align: AlignmentType.CENTER }),
          cell(fmt(p.bottomholePressure, 2), { align: AlignmentType.RIGHT }),
          cell(fmt(p.fracturePressure, 2), { align: AlignmentType.RIGHT }),
          cell(fmt(margin, 2), { align: AlignmentType.RIGHT, bold: margin < 1 }),
          cell(p.maxSafeRateLps > 0 ? fmt(p.maxSafeRateLps, 1) : "—", { align: AlignmentType.RIGHT, bold: true }),
        ],
      });
    }),
  ];

  content.push(new Paragraph({ spacing: { before: 300, after: 80 }, children: [new TextRun({ text: "Давление на забое vs Давление ГРП (табличные данные):", bold: true, size: 20, font: "Calibri" })] }));
  content.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, layout: TableLayoutType.FIXED, rows: bhpRows }) as any);

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
    new Table({
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
      { label: "Диаметр ствола (с каверн.)", value: `${fmt(wellData.holeDiameter * Math.sqrt(wellData.cavernCoeff), 1)} мм` },
      { label: "Наружный диаметр ОК", value: `${wellData.casingOD} мм` },
      { label: "Внутренний диаметр ОК", value: `${fmt(casingID, 1)} мм` },
      { label: "Толщина стенки ОК", value: `${wellData.casingWall} мм` },
      { label: "Зазор затрубья (одностор.)", value: `${fmt((wellData.holeDiameter - wellData.casingOD) / 2, 1)} мм` },
      { label: "Предыдущая колонна (OD/ID)", value: `${wellData.prevCasingOD} / ${wellData.prevCasingID} мм` },
      { label: "Глубина предыдущей колонны", value: `${wellData.prevCasingDepth} м` },
    ]) as any,
  );

  return content;
}

// ======== Centralization section ========

function buildCentralizationPage(wellData: WellData, centralizationImages?: Record<string, string>, centralizationResults?: CentralizationResult[]): Paragraph[] {
  const content: Paragraph[] = [
    sectionTitle("16. Расчёт центрирования обсадной колонны"),
  ];

  const casingID = getCasingID(wellData.casingOD, wellData.casingWall);
  const clearance = (wellData.holeDiameter - wellData.casingOD) / 2;

  content.push(kvTable([
    { label: "Диаметр ствола", value: `${wellData.holeDiameter} мм` },
    { label: "Наружный диаметр ОК", value: `${wellData.casingOD} мм` },
    { label: "Внутренний диаметр ОК", value: `${fmt(casingID, 1)} мм` },
    { label: "Радиальный зазор", value: `${fmt(clearance, 1)} мм` },
  ]) as any);

  if (centralizationImages) {
    if (centralizationImages.crossSection) content.push(...buildImageParagraph(centralizationImages.crossSection, "Поперечное сечение — центрирование колонны", 800, 400));
    if (centralizationImages.standoffProfile) content.push(...buildImageParagraph(centralizationImages.standoffProfile, "Профиль Standoff по стволу", 1400, 400));
  }

  // Build real table from results data
  if (centralizationResults && centralizationResults.length > 0) {
    const avgStandoff = Math.round(centralizationResults.reduce((s, r) => s + r.standoff, 0) / centralizationResults.length * 10) / 10;
    const minStandoff = Math.min(...centralizationResults.map(r => r.standoff));

    content.push(new Paragraph({
      spacing: { before: 200, after: 80 },
      children: [new TextRun({ text: `Средний Standoff: ${avgStandoff}%  |  Мин. Standoff: ${fmt(minStandoff, 1)}%`, bold: true, size: 20, font: "Calibri" })],
    }));

    const headers = ["MD, м", "TVD, м", "Зенит, °", "Эксц.", "Standoff, %", "Центратор"];
    const tableRows = [
      new TableRow({ children: headers.map(h => headerCell(h)) }),
      ...centralizationResults.map(r => new TableRow({
        children: [
          cell(fmt(r.md, 0), { align: AlignmentType.RIGHT }),
          cell(fmt(r.tvd, 1), { align: AlignmentType.RIGHT }),
          cell(fmt(r.zenith, 1), { align: AlignmentType.RIGHT }),
          cell(fmt(r.eccentricity, 3), { align: AlignmentType.RIGHT }),
          cell(fmt(r.standoff, 1), { align: AlignmentType.RIGHT, bold: r.standoff < 50 }),
          cell(r.hasCentralizer ? "●" : "—", { align: AlignmentType.CENTER }),
        ],
      })),
    ];

    content.push(new Paragraph({
      spacing: { before: 150, after: 80 },
      children: [new TextRun({ text: "Таблица результатов центрирования:", bold: true, size: 20, font: "Calibri" })],
    }));
    content.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows: tableRows,
    }) as any);
  }

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
) {
  const volumes = preComputed?.volumes ?? calculateVolumes(wellData);
  const pressureResult = preComputed?.pressureResult ?? calculatePressureProfile(wellData, slurries, buffers, drillingFluid, displacementFluids, fractureGradient, volumes.displacementVolume, preComputed?.flushTimeMin, preComputed?.flushVolumeM3);
  const materials = preComputed?.materials ?? calculateMaterials(slurries, buffers, wellData);
  const workTimeWithCement = pressureResult.stopTime - pressureResult.cementStartTime;

  const titlePage: Paragraph[] = [
    new Paragraph({ spacing: { before: 2000 }, children: [] }),
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
  const hydraulicsContent = buildHydraulicsPage(wellData, slurries, volumes, displacementFluids, drillingFluid, fractureGradient, workTimeWithCement, pressureResult);
  const scheduleContent = buildSchedulePage(buffers, slurries, volumes.annularVolumePerMeter, volumes.displacementVolume, displacementFluids, wellData.casingDepthMD);
  const materialsContent = buildMaterialsPage(materials);
  const pressureProfileContent = buildPressureProfilePage(pressureResult);
  const chartsDataContent = buildChartsDataPage(pressureResult, images?.chartImages);
  const trajectoryContent = buildTrajectoryPage(wellData, images?.visualImages);
  const centralizationContent = buildCentralizationPage(wellData, images?.centralizationImages, centralizationResults);
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: titlePage,
      },
      {
        properties: {},
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "Исходные данные", size: 16, color: "999999", font: "Calibri", italics: true })],
            })],
          }),
        },
        children: inputContent,
      },
      {
        properties: {},
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "Гидравлика", size: 16, color: "999999", font: "Calibri", italics: true })],
            })],
          }),
        },
        children: hydraulicsContent,
      },
      {
        properties: {},
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "Закачка", size: 16, color: "999999", font: "Calibri", italics: true })],
            })],
          }),
        },
        children: scheduleContent,
      },
      {
        properties: {},
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "Материалы", size: 16, color: "999999", font: "Calibri", italics: true })],
            })],
          }),
        },
        children: materialsContent,
      },
      {
        properties: {},
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "План продавки", size: 16, color: "999999", font: "Calibri", italics: true })],
            })],
          }),
        },
        children: pressureProfileContent,
      },
      {
        properties: {},
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "Графики (данные)", size: 16, color: "999999", font: "Calibri", italics: true })],
            })],
          }),
        },
        children: chartsDataContent,
      },
      ...(trajectoryContent.length > 0 ? [{
        properties: {},
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "Визуализация", size: 16, color: "999999", font: "Calibri", italics: true })],
            })],
          }),
        },
        children: trajectoryContent,
      }] : []),
      ...(centralizationContent.length > 1 ? [{
        properties: {},
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: "Центрирование", size: 16, color: "999999", font: "Calibri", italics: true })],
            })],
          }),
        },
        children: centralizationContent,
      }] : []),
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, "cementing-program.docx");
}
