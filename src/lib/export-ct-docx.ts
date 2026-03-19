import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType,
  BorderStyle, PageBreak, ShadingType, Header, Footer,
  ImageRun,
} from "docx";
import { saveAs } from "file-saver";
import type {
  CTStringData, WellGeometry, FluidData, PumpData, ToolsData,
  ForceResult, LimitResult, HydraulicsResult, FatigueResult, RiskItem,
} from "./coiled-tubing-calculations";
import { ctWeightPerMeter, ctID } from "./coiled-tubing-calculations";

const fmt = (v: number, dec = 2) => v.toFixed(dec);

const BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  left: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  right: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
};

function headerCell(text: string, width?: number): TableCell {
  return new TableCell({
    borders: BORDER,
    shading: { type: ShadingType.CLEAR, color: "auto", fill: "1A365D" },
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, size: 18, color: "FFFFFF", font: "Calibri" })],
    })],
  });
}

function cell(text: string, opts?: { bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; warn?: boolean }): TableCell {
  return new TableCell({
    borders: BORDER,
    shading: opts?.warn ? { type: ShadingType.CLEAR, color: "auto", fill: "FEE2E2" } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({
      alignment: opts?.align ?? AlignmentType.LEFT,
      children: [new TextRun({ text, size: 18, bold: opts?.bold, font: "Calibri", color: opts?.warn ? "DC2626" : undefined })],
    })],
  });
}

function twoColTable(title: string, rows: [string, string, boolean?][]): (Paragraph | Table)[] {
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 150 },
      children: [new TextRun({ text: title, bold: true, size: 24, font: "Calibri", color: "1A365D" })],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [headerCell("Параметр", 60), headerCell("Значение", 40)] }),
        ...rows.map(([label, value, warn]) => new TableRow({
          children: [
            cell(label, { bold: false }),
            cell(value, { align: AlignmentType.CENTER, warn: !!warn }),
          ],
        })),
      ],
    }),
  ];
}

export interface CTDocxInput {
  ct: CTStringData;
  well: WellGeometry;
  fluid: FluidData;
  pump: PumpData;
  tools: ToolsData;
  friction: number;
  reelSize: string;
  prevTrips: number;
  forces: ForceResult;
  limits: LimitResult;
  hydraulics: HydraulicsResult;
  fatigue: FatigueResult;
  risks: RiskItem[];
  chartImages?: { forces?: string; limits?: string; hydraulics?: string; fatigue?: string };
}

function dataUrlToBuffer(dataUrl: string): { buffer: ArrayBuffer; ext: string } {
  const [header, base64] = dataUrl.split(",");
  const ext = header.includes("png") ? "png" : "jpeg";
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return { buffer, ext };
}

export async function exportCTDocx(input: CTDocxInput) {
  const { ct, well, fluid, pump, tools, friction, forces, limits, hydraulics, fatigue, risks, chartImages } = input;

  const children: (Paragraph | Table | any)[] = [];

  // Title
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: "Расчёт ГНКТ (Coiled Tubing)", bold: true, size: 36, font: "Calibri", color: "1A365D" })],
  }));

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({ text: `Дата: ${new Date().toLocaleDateString("ru-RU")}`, size: 20, font: "Calibri", color: "666666" })],
  }));

  // Input Data
  children.push(...twoColTable("🔧 Параметры ГНКТ", [
    ["Наружный диаметр", `${ct.od} мм`],
    ["Толщина стенки", `${ct.wall} мм`],
    ["Внутренний диаметр", `${ctID(ct.od, ct.wall).toFixed(1)} мм`],
    ["Марка стали", ct.grade],
    ["Длина", `${ct.length} м`],
    ["Овальность", `${ct.ovality}%`],
    ["Линейный вес", `${ctWeightPerMeter(ct.od, ct.wall).toFixed(3)} кг/м`],
  ]));

  children.push(...twoColTable("🛢 Скважина", [
    ["Глубина (MD)", `${well.md} м`],
    ["Глубина (TVD)", `${well.tvd} м`],
    ["ID обсадной колонны", `${well.casingID} мм`],
    ["ID НКТ", well.tubingID > 0 ? `${well.tubingID} мм` : "—"],
    ["Устьевое давление", `${well.wellheadPressure} МПа`],
    ["Коэффициент трения", `${friction}`],
  ]));

  children.push(...twoColTable("💧 Жидкость", [
    ["Тип", fluid.name],
    ["Плотность", `${fluid.density} г/см³`],
    ["PV", `${fluid.pv} сП`],
    ["YP", `${fluid.yp} Па`],
  ]));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Forces
  children.push(...twoColTable("⚡ Силы на ГНКТ", [
    ["Вес в воздухе", `${fmt(forces.weightInAir, 1)} кН`],
    ["Коэффициент плавучести", `${fmt(forces.buoyancyFactor, 3)}`],
    ["Вес в жидкости", `${fmt(forces.weightInFluid, 1)} кН`],
    ["Сила трения (СПО вниз)", `${fmt(forces.dragForceRIH, 1)} кН`],
    ["Сила трения (СПО вверх)", `${fmt(forces.dragForcePOOH, 1)} кН`],
    ["Нагрузка на устье (СПО вниз)", `${fmt(forces.surfaceLoadRIH, 1)} кН`, forces.surfaceLoadRIH < 0],
    ["Нагрузка на устье (СПО вверх)", `${fmt(forces.surfaceLoadPOOH, 1)} кН`],
    ["Крит. нагрузка синус. изгиба", `${fmt(forces.sinusoidalBucklingLoad, 1)} кН`],
    ["Крит. нагрузка спирального изгиба", `${fmt(forces.helicalBucklingLoad, 1)} кН`],
    ["Глубина запирания", forces.lockUpDepth > 0 ? `${forces.lockUpDepth.toFixed(0)} м` : "—", forces.lockUpDepth > 0],
  ]));

  // Chart: Forces
  if (chartImages?.forces) {
    const { buffer, ext } = dataUrlToBuffer(chartImages.forces);
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
      children: [new ImageRun({ data: buffer, transformation: { width: 550, height: 300 }, altText: { title: "Forces", description: "Axial load vs depth", name: "forces-chart" } })],
    }));
  }

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Limits
  children.push(...twoColTable("🛡 Пределы давления и нагрузок", [
    ["Давление разрыва (Barlow)", `${fmt(limits.burstPressure, 1)} МПа`],
    ["Макс. рабочее давление (80%)", `${fmt(limits.maxWorkingPressure, 1)} МПа`],
    ["Давление смятия", `${fmt(limits.collapsePressure, 1)} МПа`],
    ["Смятие с овальностью", `${fmt(limits.collapseWithOvality, 1)} МПа`, limits.collapseWithOvality < well.wellheadPressure],
    ["Предел текучести (растяж.)", `${fmt(limits.yieldTension, 1)} кН`],
    ["Макс. раб. натяжение (80%)", `${fmt(limits.maxWorkingTension, 1)} кН`],
    ["Коэфф. Мизеса", `${fmt(limits.vonMisesRatio, 3)}`, limits.vonMisesRatio >= 0.8],
  ]));

  if (chartImages?.limits) {
    const { buffer, ext } = dataUrlToBuffer(chartImages.limits);
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
      children: [new ImageRun({ data: buffer, transformation: { width: 550, height: 350 }, altText: { title: "Limits", description: "Pressure-load envelope", name: "limits-chart" } })],
    }));
  }

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Hydraulics
  children.push(...twoColTable("💧 Гидравлика", [
    ["Скорость в ГНКТ", `${fmt(hydraulics.velocityInCT)} м/с`],
    ["Скорость в затрубье", `${fmt(hydraulics.velocityAnnulus)} м/с`],
    ["Re в ГНКТ", `${hydraulics.reynoldsInCT}`],
    ["Режим в ГНКТ", hydraulics.flowRegimeCT],
    ["Re в затрубье", `${hydraulics.reynoldsAnnulus}`],
    ["Режим в затрубье", hydraulics.flowRegimeAnnulus],
    ["ΔP внутри ГНКТ", `${fmt(hydraulics.dpInsideCT)} МПа`],
    ["ΔP в затрубье", `${fmt(hydraulics.dpAnnulus)} МПа`],
    ["ΔP на насадках", `${fmt(hydraulics.dpNozzle)} МПа`],
    ["Общее ΔP", `${fmt(hydraulics.dpTotal)} МПа`, hydraulics.dpTotal > limits.maxWorkingPressure],
    ["ECD на забое", `${fmt(hydraulics.ecdAtTD, 3)} г/см³`],
    ["Забойное давление (цирк.)", `${fmt(hydraulics.bhCircPressure)} МПа`],
    ["Мин. скорость транспорта", `${fmt(hydraulics.minTransportVelocity)} м/с`],
    ["Транспорт шлама", hydraulics.transportOk ? "✅ Достаточно" : "⚠ Недостаточно", !hydraulics.transportOk],
  ]));

  if (chartImages?.hydraulics) {
    const { buffer, ext } = dataUrlToBuffer(chartImages.hydraulics);
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
      children: [new ImageRun({ type: ext as any, data: buffer, transformation: { width: 550, height: 300 }, altText: { title: "Hydraulics", description: "Pressure drop vs flow rate", name: "hydraulics-chart" } })],
    }));
  }

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Fatigue
  children.push(...twoColTable("🔄 Ресурс усталости", [
    ["Деформация на барабане", `${fmt(fatigue.bendingStrainReel, 3)}%`],
    ["Деформация на направл. арке", `${fmt(fatigue.bendingStrainGuideArch, 3)}%`],
    ["Суммарная деформация за рейс", `${fmt(fatigue.totalStrainPerTrip, 3)}%`],
    ["Расчётный ресурс", `${fatigue.estimatedCycles} рейсов`],
    ["Безопасный ресурс (SF=2)", `${fatigue.maxSafeTrips} рейсов`],
    ["Использовано ресурса", `${fmt(fatigue.fatigueLifeUsed, 1)}%`, fatigue.fatigueLifeUsed > 60],
    ["Снижение давления разрыва", `${fmt(fatigue.pressureDerate, 1)}%`, fatigue.pressureDerate > 15],
  ]));

  if (chartImages?.fatigue) {
    const { buffer, ext } = dataUrlToBuffer(chartImages.fatigue);
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
      children: [new ImageRun({ type: ext as any, data: buffer, transformation: { width: 550, height: 300 }, altText: { title: "Fatigue", description: "Fatigue life curve", name: "fatigue-chart" } })],
    }));
  }

  // Risks
  if (risks.length > 0) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 150 },
      children: [new TextRun({ text: "⚠ Оценка рисков", bold: true, size: 24, font: "Calibri", color: "DC2626" })],
    }));
    for (const r of risks) {
      const color = r.level === "critical" ? "DC2626" : r.level === "warning" ? "D97706" : "059669";
      children.push(new Paragraph({
        spacing: { before: 80, after: 80 },
        children: [new TextRun({ text: `${r.emoji} ${r.message}`, size: 20, font: "Calibri", color })],
      }));
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: "ГНКТ — DeAllSoft Engineering", size: 16, color: "999999", font: "Calibri" })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "Сгенерировано DeAllSoft", size: 14, color: "999999", font: "Calibri" })],
          })],
        }),
      },
      children,
    }],
  });

  const buffer = await Packer.toBlob(doc);
  saveAs(buffer, `ГНКТ_Расчет_${new Date().toISOString().slice(0, 10)}.docx`);
}
