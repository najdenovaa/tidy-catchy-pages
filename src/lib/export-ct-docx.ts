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
  TrajectoryPoint,
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

function chartImage(dataUrl: string, w: number, h: number, alt: string): Paragraph {
  const [header, base64] = dataUrl.split(",");
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 200 },
    children: [new ImageRun({ data: buffer, transformation: { width: w, height: h }, altText: { title: alt, description: alt, name: alt } })],
  });
}

function trajectoryTable(points: TrajectoryPoint[]): (Paragraph | Table)[] {
  if (!points || points.length <= 1) return [];
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 150 },
      children: [new TextRun({ text: "📐 Инклинометрия", bold: true, size: 24, font: "Calibri", color: "1A365D" })],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [headerCell("MD, м"), headerCell("Азимут, °"), headerCell("Зенит, °"), headerCell("TVD, м")] }),
        ...points.map(p => new TableRow({
          children: [
            cell(fmt(p.md, 1), { align: AlignmentType.CENTER }),
            cell(fmt(p.azimuth, 1), { align: AlignmentType.CENTER }),
            cell(fmt(p.zenith, 1), { align: AlignmentType.CENTER }),
            cell(fmt(p.tvd, 1), { align: AlignmentType.CENTER }),
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
  trajPoints?: TrajectoryPoint[];
  chartImages?: { forces?: string; limits?: string; hydraulics?: string; fatigue?: string };
}

export async function exportCTDocx(input: CTDocxInput) {
  const { ct, well, fluid, pump, tools, friction, forces, limits, hydraulics, fatigue, risks, trajPoints, chartImages } = input;

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

  // ─── CT Parameters ───
  children.push(...twoColTable("🔧 Параметры ГНКТ", [
    ["Наружный диаметр", `${ct.od} мм`],
    ["Толщина стенки", `${ct.wall} мм`],
    ["Внутренний диаметр", `${ctID(ct.od, ct.wall).toFixed(1)} мм`],
    ["Марка стали", ct.grade],
    ["Длина", `${ct.length} м`],
    ["Овальность", `${ct.ovality}%`],
    ["Линейный вес", `${ctWeightPerMeter(ct.od, ct.wall).toFixed(3)} кг/м`],
    ["Размер барабана", input.reelSize === "small" ? "Малый (1.37 м)" : input.reelSize === "large" ? "Большой (2.44 м)" : "Средний (1.83 м)"],
    ["Предыдущих рейсов", `${input.prevTrips}`],
  ]));

  // ─── Well ───
  children.push(...twoColTable("🛢 Скважина", [
    ["Глубина (MD)", `${well.md} м`],
    ["Глубина (TVD)", `${well.tvd} м`],
    ["ID обсадной колонны", `${well.casingID} мм`],
    ["ID НКТ", well.tubingID > 0 ? `${well.tubingID} мм` : "—"],
    ["Устьевое давление", `${well.wellheadPressure} МПа`],
    ["Коэффициент трения", `${friction}`],
  ]));

  // ─── Temperatures ───
  children.push(...twoColTable("🌡 Температуры", [
    ["BHST (стат. t°)", `${well.bhst} °C`],
    ["BHCT (цирк. t°)", `${well.bhct} °C`],
    ["T° на устье", `${well.whTemp} °C`],
    ["Градиент ГРП", `${well.fracGradient} МПа/м`],
    ["Давление ГРП на TVD", well.fracGradient && well.tvd ? `${fmt(well.fracGradient * well.tvd, 1)} МПа` : "—"],
  ]));

  // ─── Trajectory ───
  const traj = trajPoints && trajPoints.length > 1 ? trajPoints : well.trajectory;
  children.push(...trajectoryTable(traj));

  // ─── Fluid ───
  children.push(...twoColTable("💧 Жидкость", [
    ["Тип", fluid.name],
    ["Плотность", `${fluid.density} г/см³`],
    ["PV", `${fluid.pv} сП`],
    ["YP", `${fluid.yp} Па`],
    ["n (индекс потока)", `${fluid.nIndex}`],
    ["K (конс. индекс)", `${fluid.kIndex} Па·сⁿ`],
  ]));

  // ─── Pump ───
  children.push(...twoColTable("⛽ Насос", [
    ["Расход", `${pump.flowRate} л/с`],
    ["Давление на поверхности", pump.surfacePressure > 0 ? `${pump.surfacePressure} МПа` : "— (расчётное)"],
  ]));

  // ─── Tools (BHA) ───
  children.push(...twoColTable("🔩 КНБК (BHA)", [
    ["Вес КНБК", `${tools.bhaWeight} кг`],
    ["Длина КНБК", `${tools.bhaLength} м`],
    ["OD КНБК", `${tools.bhaOD} мм`],
    ["Диаметр насадок", `${tools.nozzleDiam} мм`],
    ["Кол-во насадок", `${tools.nozzleCount}`],
  ]));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ═══════════════ RESULTS ═══════════════

  // Forces
  children.push(...twoColTable("⚡ Силы на ГНКТ", [
    ["Вес в воздухе", `${fmt(forces.weightInAir, 1)} кН`],
    ["Коэффициент плавучести", `${fmt(forces.buoyancyFactor, 3)}`],
    ["Вес в жидкости", `${fmt(forces.weightInFluid, 1)} кН`],
    ["Сила трения (СПО ↓)", `${fmt(forces.dragForceRIH, 1)} кН`],
    ["Сила трения (СПО ↑)", `${fmt(forces.dragForcePOOH, 1)} кН`],
    ["Нагрузка на устье (СПО ↓)", `${fmt(forces.surfaceLoadRIH, 1)} кН`, forces.surfaceLoadRIH < 0],
    ["Нагрузка на устье (СПО ↑)", `${fmt(forces.surfaceLoadPOOH, 1)} кН`],
    ["Синус. потеря устойчивости", `${fmt(forces.sinusoidalBucklingLoad, 1)} кН`],
    ["Спиральный изгиб", `${fmt(forces.helicalBucklingLoad, 1)} кН`],
    ["Глубина lock-up", forces.lockUpDepth > 0 ? `${forces.lockUpDepth.toFixed(0)} м` : "—", forces.lockUpDepth > 0],
  ]));

  if (chartImages?.forces) children.push(chartImage(chartImages.forces, 550, 320, "forces-chart"));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Limits
  children.push(...twoColTable("🛡 Пределы давления и нагрузок", [
    ["Давление разрыва (Barlow)", `${fmt(limits.burstPressure, 1)} МПа`],
    ["Макс. рабочее давление (80%)", `${fmt(limits.maxWorkingPressure, 1)} МПа`],
    ["Давление смятия", `${fmt(limits.collapsePressure, 1)} МПа`],
    ["Смятие с овальностью", `${fmt(limits.collapseWithOvality, 1)} МПа`, limits.collapseWithOvality < well.wellheadPressure],
    ["Предел текучести (растяж.)", `${fmt(limits.yieldTension, 1)} кН`],
    ["Макс. раб. натяжение (80%)", `${fmt(limits.maxWorkingTension, 1)} кН`],
    ["Коэфф. Мизеса (σ_vm / σ_y)", `${fmt(limits.vonMisesRatio, 3)}`, limits.vonMisesRatio >= 0.8],
  ]));

  if (chartImages?.limits) children.push(chartImage(chartImages.limits, 550, 350, "limits-chart"));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Hydraulics
  children.push(...twoColTable("💧 Гидравлика циркуляции", [
    ["Скорость в ГНКТ", `${fmt(hydraulics.velocityInCT)} м/с`],
    ["Скорость в затрубье", `${fmt(hydraulics.velocityAnnulus)} м/с`],
    ["Мин. скорость транспорта", `${fmt(hydraulics.minTransportVelocity)} м/с`],
    ["Транспорт шлама", hydraulics.transportOk ? "✅ Достаточно" : "⚠ Недостаточно", !hydraulics.transportOk],
    ["Re в ГНКТ", `${hydraulics.reynoldsInCT}`],
    ["Режим в ГНКТ", hydraulics.flowRegimeCT],
    ["Re в затрубье", `${hydraulics.reynoldsAnnulus}`],
    ["Режим в затрубье", hydraulics.flowRegimeAnnulus],
    ["ΔP внутри ГНКТ", `${fmt(hydraulics.dpInsideCT)} МПа`],
    ["ΔP в затрубье", `${fmt(hydraulics.dpAnnulus)} МПа`],
    ["ΔP на насадках", `${fmt(hydraulics.dpNozzle)} МПа`],
    ["Общее ΔP", `${fmt(hydraulics.dpTotal)} МПа`, hydraulics.dpTotal > limits.maxWorkingPressure],
    ["ECD на забое (TVD)", `${fmt(hydraulics.ecdAtTD, 3)} г/см³`],
    ["BHP (цирк., TVD)", `${fmt(hydraulics.bhCircPressure)} МПа`],
    ["Давление ГРП (TVD)", `${fmt(hydraulics.fracPressureAtTD)} МПа`],
    ["BHP / P_грп", `${fmt(hydraulics.fracSafetyFactor)}`, hydraulics.fracSafetyFactor >= 0.85],
  ]));

  if (chartImages?.hydraulics) children.push(chartImage(chartImages.hydraulics, 550, 300, "hydraulics-chart"));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  // Fatigue
  children.push(...twoColTable("🔄 CoilLIFE — Ресурс усталости", [
    ["Деформация на барабане", `${fmt(fatigue.bendingStrainReel, 3)}%`],
    ["Деформация на направл. арке", `${fmt(fatigue.bendingStrainGuideArch, 3)}%`],
    ["Суммарная деформация за рейс", `${fmt(fatigue.totalStrainPerTrip, 3)}%`],
    ["Расчётный ресурс", `${fatigue.estimatedCycles} рейсов`],
    ["Безопасный ресурс (SF=2)", `${fatigue.maxSafeTrips} рейсов`],
    ["Использовано ресурса", `${fmt(fatigue.fatigueLifeUsed, 1)}%`, fatigue.fatigueLifeUsed > 60],
    ["Снижение давления разрыва", `${fmt(fatigue.pressureDerate, 1)}%`, fatigue.pressureDerate > 15],
  ]));

  if (chartImages?.fatigue) children.push(chartImage(chartImages.fatigue, 550, 300, "fatigue-chart"));

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
