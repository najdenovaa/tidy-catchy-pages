/**
 * Comprehensive Coiled Tubing (ГНКТ) DOCX Report
 * Professional styling with cover page, all input/output data, tabular profiles, charts.
 */
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, AlignmentType, WidthType,
  BorderStyle, PageBreak, ShadingType, Header, Footer,
  ImageRun, PageNumber,
} from "docx";
import { saveAs } from "file-saver";
import type {
  CTStringData, WellGeometry, FluidData, PumpData, ToolsData,
  ForceResult, LimitResult, HydraulicsResult, FatigueResult, RiskItem,
  TrajectoryPoint, TemperingResult, HookLoadPoint, DepthForcePoint,
  TempProfilePoint, HydraulicsChartPoint, FatigueChartPoint,
} from "./coiled-tubing-calculations";
import type { CTSection } from "./coiled-tubing-calculations";
import { ctWeightPerMeter, ctID } from "./coiled-tubing-calculations";

// ═══════════ PALETTE ═══════════
const NAVY = "0F2B46";
const BLUE = "1A5276";
const LIGHT_BLUE = "2980B9";
const ACCENT_GOLD = "D4AC0D";
const HEADER_BG = NAVY;
const HEADER_FG = "FFFFFF";
const ROW_ALT = "EBF5FB";
const ROW_WARN = "FDEDEC";
const BORDER_CLR = "AED6F1";
const GRAY = "7F8C8D";
const RED = "C0392B";
const GREEN = "1E8449";
const AMBER = "D68910";

const fmt = (v: number, dec = 2) => v.toFixed(dec);

// ═══════════ BORDER HELPERS ═══════════
const THIN_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
  left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
  right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
};

// ═══════════ TABLE HELPERS ═══════════
function hCell(text: string, width?: number): TableCell {
  return new TableCell({
    borders: THIN_BORDER,
    shading: { type: ShadingType.CLEAR, color: "auto", fill: HEADER_BG },
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 50, bottom: 50, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, size: 17, color: HEADER_FG, font: "Calibri" })],
    })],
  });
}

function dCell(text: string, opts?: {
  bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  color?: string; shading?: string; warn?: boolean;
}): TableCell {
  const fill = opts?.warn ? ROW_WARN : opts?.shading || undefined;
  return new TableCell({
    borders: THIN_BORDER,
    shading: fill ? { type: ShadingType.CLEAR, color: "auto", fill } : undefined,
    margins: { top: 40, bottom: 40, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: opts?.align ?? AlignmentType.LEFT,
      children: [new TextRun({
        text, size: 17, font: "Calibri",
        bold: opts?.bold,
        color: opts?.warn ? RED : opts?.color,
      })],
    })],
  });
}

function sectionTitle(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 320, after: 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: LIGHT_BLUE, space: 4 } },
    children: [new TextRun({ text, bold: true, size: 24, font: "Calibri", color: BLUE })],
  });
}

function subTitle(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 20, font: "Calibri", color: LIGHT_BLUE })],
  });
}

function infoLine(text: string, opts?: { color?: string; italic?: boolean; bold?: boolean; size?: number }): Paragraph {
  return new Paragraph({
    spacing: { after: 50 },
    children: [new TextRun({
      text, size: opts?.size ?? 18, font: "Calibri",
      bold: opts?.bold, color: opts?.color, italics: opts?.italic,
    })],
  });
}

/** Two-column param/value table */
function paramTable(rows: [string, string, boolean?][], colWidths: [number, number] = [58, 42]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [hCell("Параметр", colWidths[0]), hCell("Значение", colWidths[1])] }),
      ...rows.map(([label, value, warn], ri) => new TableRow({
        children: [
          dCell(label, { bold: false, shading: ri % 2 === 0 ? ROW_ALT : undefined }),
          dCell(value, { align: AlignmentType.CENTER, warn: !!warn, shading: !warn && ri % 2 === 0 ? ROW_ALT : undefined }),
        ],
      })),
    ],
  });
}

/** Multi-column data table */
function dataTable(headers: string[], rows: string[][], opts?: { warn?: (ri: number, ci: number) => boolean }): Table {
  const colW = Math.floor(100 / headers.length);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: headers.map(h => hCell(h, colW)) }),
      ...rows.map((row, ri) => new TableRow({
        children: row.map((v, ci) => dCell(v, {
          align: AlignmentType.CENTER,
          shading: ri % 2 === 0 ? ROW_ALT : undefined,
          warn: opts?.warn?.(ri, ci),
        })),
      })),
    ],
  });
}

function chartImage(dataUrl: string, w: number, h: number, alt: string): Paragraph {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 160 },
    children: [new ImageRun({ data: buffer.buffer, transformation: { width: w, height: h }, altText: { title: alt, description: alt, name: alt } })],
  });
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] });
}

// ═══════════ INPUT INTERFACE ═══════════

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
  tempering?: TemperingResult | null;
  risks: RiskItem[];
  trajPoints?: TrajectoryPoint[];
  ctSections?: CTSection[];
  hookLoadData?: HookLoadPoint[];
  forceProfile?: DepthForcePoint[];
  tempProfile?: TempProfilePoint[];
  hydraulicsCurve?: HydraulicsChartPoint[];
  fatigueCurve?: FatigueChartPoint[];
  chartImages?: {
    forces?: string; hookLoad?: string; limits?: string;
    hydraulics?: string; fatigue?: string;
    tempering?: string; temperingDegradation?: string;
    tempProfile?: string;
  };
}

// ═══════════ MAIN EXPORT ═══════════

export async function exportCTDocx(input: CTDocxInput) {
  const {
    ct, well, fluid, pump, tools, friction, forces, limits, hydraulics, fatigue, tempering,
    risks, trajPoints, ctSections, hookLoadData, forceProfile, tempProfile,
    hydraulicsCurve, fatigueCurve, chartImages,
  } = input;

  const children: (Paragraph | Table)[] = [];
  const now = new Date();
  const dateStr = now.toLocaleDateString("ru-RU");
  const timeStr = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  // ══════════════════════════════════════
  // ═══ COVER PAGE ═══
  // ══════════════════════════════════════
  children.push(new Paragraph({ spacing: { before: 1200 } }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT_GOLD, space: 8 } },
    spacing: { after: 300 },
    children: [],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: "РАСЧЁТ ГНКТ", bold: true, size: 48, font: "Calibri", color: NAVY })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: "COILED TUBING ENGINEERING REPORT", bold: true, size: 22, font: "Calibri", color: LIGHT_BLUE })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: ACCENT_GOLD, space: 8 } },
    spacing: { after: 400 },
    children: [],
  }));

  // Summary info on cover
  const coverInfo: [string, string][] = [
    ["Труба ГНКТ", `${ct.od} × ${ct.wall} мм, ${ct.grade}, L = ${ct.length} м`],
    ["Скважина", `MD = ${well.md} м, TVD = ${well.tvd} м`],
    ["Жидкость", `${fluid.name}, ρ = ${fluid.density} г/см³`],
    ["Расход", `${pump.flowRate} л/с`],
    ["КНБК", `${tools.bhaWeight} кг, L = ${tools.bhaLength} м`],
  ];
  children.push(new Table({
    width: { size: 70, type: WidthType.PERCENTAGE },
    rows: coverInfo.map(([k, v]) => new TableRow({
      children: [
        dCell(k, { bold: true, color: BLUE }),
        dCell(v, { align: AlignmentType.LEFT }),
      ],
    })),
  }));

  children.push(new Paragraph({ spacing: { before: 400 } }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Подготовлено системой DeAllsoft", size: 18, font: "Calibri", color: GRAY, italics: true })],
  }));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: `Дата: ${dateStr}  ${timeStr}`, size: 18, font: "Calibri", color: GRAY })],
  }));
  children.push(pageBreak());

  // ══════════════════════════════════════
  // ═══ 1. INPUT DATA ═══
  // ══════════════════════════════════════
  children.push(new Paragraph({
    spacing: { after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: NAVY, space: 4 } },
    children: [new TextRun({ text: "РАЗДЕЛ 1 — ИСХОДНЫЕ ДАННЫЕ", bold: true, size: 28, font: "Calibri", color: NAVY })],
  }));

  // 1.1 CT String
  children.push(sectionTitle("1.1  Параметры колонны ГНКТ"));
  children.push(paramTable([
    ["Наружный диаметр (OD)", `${ct.od} мм`],
    ["Толщина стенки", `${ct.wall} мм`],
    ["Внутренний диаметр (ID)", `${ctID(ct.od, ct.wall).toFixed(1)} мм`],
    ["Марка стали", ct.grade],
    ["Длина колонны", `${ct.length} м`],
    ["Овальность", `${ct.ovality}%`],
    ["Линейный вес", `${ctWeightPerMeter(ct.od, ct.wall).toFixed(3)} кг/м`],
    ["Размер барабана", input.reelSize === "small" ? "Малый (Ø1.37 м)" : input.reelSize === "large" ? "Большой (Ø2.44 м)" : "Средний (Ø1.83 м)"],
    ["Предыдущих рейсов", `${input.prevTrips}`],
  ]));

  // 1.1.1 Sections
  if (ctSections && ctSections.length > 0) {
    children.push(subTitle("Секции колонны ГНКТ"));
    children.push(dataTable(
      ["№", "OD, мм", "Стенка, мм", "ID, мм", "Длина, м", "Вес, кг/м"],
      ctSections.map((s, i) => [
        `${i + 1}`,
        fmt(s.od, 1),
        fmt(s.wall, 2),
        fmt(ctID(s.od, s.wall), 1),
        fmt(s.length, 0),
        ctWeightPerMeter(s.od, s.wall).toFixed(3),
      ]),
    ));
    const totalLen = ctSections.reduce((a, s) => a + s.length, 0);
    children.push(infoLine(`Общая длина секций: ${fmt(totalLen, 0)} м`, { bold: true, color: BLUE }));
  }

  // 1.2 Well
  children.push(sectionTitle("1.2  Скважина"));
  children.push(paramTable([
    ["Глубина по стволу (MD)", `${well.md} м`],
    ["Вертикальная глубина (TVD)", `${well.tvd} м`],
    ["ID обсадной колонны", `${well.casingID} мм`],
    ["ID НКТ", well.tubingID > 0 ? `${well.tubingID} мм` : "— (нет)"],
    ["Устьевое давление", `${well.wellheadPressure} МПа`],
    ["Коэффициент трения μ", `${friction}`],
    ["BHST (стат. температура)", `${well.bhst} °C`],
    ["BHCT (цирк. температура)", `${well.bhct} °C`],
    ["Температура на устье", `${well.whTemp} °C`],
    ["Градиент ГРП", `${well.fracGradient} МПа/м`],
    ["Давление ГРП на TVD", well.fracGradient && well.tvd ? `${fmt(well.fracGradient * well.tvd, 1)} МПа` : "—"],
  ]));

  // 1.2.1 Trajectory
  const traj = trajPoints && trajPoints.length > 1 ? trajPoints : well.trajectory;
  if (traj && traj.length > 1) {
    children.push(subTitle("Инклинометрия скважины"));
    children.push(dataTable(
      ["MD, м", "Азимут, °", "Зенит, °", "TVD, м"],
      traj.map(p => [fmt(p.md, 1), fmt(p.azimuth, 1), fmt(p.zenith, 1), fmt(p.tvd, 1)]),
    ));
  }

  // 1.3 Fluid
  children.push(sectionTitle("1.3  Рабочая жидкость"));
  children.push(paramTable([
    ["Тип", fluid.name],
    ["Плотность", `${fluid.density} г/см³`],
    ["Пластическая вязкость (PV)", `${fluid.pv} сП`],
    ["Динамическое напряж. сдвига (YP)", `${fluid.yp} Па`],
    ["Индекс потока (n)", `${fluid.nIndex}`],
    ["Индекс консистенции (K)", `${fluid.kIndex} Па·сⁿ`],
  ]));

  // 1.4 Pump & Tools
  children.push(sectionTitle("1.4  Насос и КНБК"));
  children.push(paramTable([
    ["Расход", `${pump.flowRate} л/с`],
    ["Давление на поверхности", pump.surfacePressure > 0 ? `${pump.surfacePressure} МПа` : "— (расчётное)"],
    ["Вес КНБК", `${tools.bhaWeight} кг`],
    ["Длина КНБК", `${tools.bhaLength} м`],
    ["OD КНБК", `${tools.bhaOD} мм`],
    ["Ø насадки", `${tools.nozzleDiam} мм`],
    ["Кол-во насадок", `${tools.nozzleCount} шт`],
  ]));

  children.push(pageBreak());

  // ══════════════════════════════════════
  // ═══ 2. RESULTS ═══
  // ══════════════════════════════════════
  children.push(new Paragraph({
    spacing: { after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: NAVY, space: 4 } },
    children: [new TextRun({ text: "РАЗДЕЛ 2 — РЕЗУЛЬТАТЫ РАСЧЁТА", bold: true, size: 28, font: "Calibri", color: NAVY })],
  }));

  // 2.1 Forces
  children.push(sectionTitle("2.1  Силы на ГНКТ (Tubing Forces)"));
  children.push(paramTable([
    ["Вес в воздухе", `${fmt(forces.weightInAir, 1)} кН`],
    ["Коэффициент плавучести", `${fmt(forces.buoyancyFactor, 3)}`],
    ["Вес в жидкости", `${fmt(forces.weightInFluid, 1)} кН`],
    ["Сила трения (СПО ↓ RIH)", `${fmt(forces.dragForceRIH, 1)} кН`],
    ["Сила трения (СПО ↑ POOH)", `${fmt(forces.dragForcePOOH, 1)} кН`],
    ["Нагрузка на устье (СПО ↓)", `${fmt(forces.surfaceLoadRIH, 1)} кН`, forces.surfaceLoadRIH < 0],
    ["Нагрузка на устье (СПО ↑)", `${fmt(forces.surfaceLoadPOOH, 1)} кН`],
    ["Синус. потеря устойчивости", `${fmt(forces.sinusoidalBucklingLoad, 1)} кН`],
    ["Спиральный изгиб", `${fmt(forces.helicalBucklingLoad, 1)} кН`],
    ["Глубина lock-up", forces.lockUpDepth > 0 ? `${forces.lockUpDepth.toFixed(0)} м` : "— (нет)", forces.lockUpDepth > 0],
  ]));

  // Hook Load chart
  if (chartImages?.hookLoad) children.push(chartImage(chartImages.hookLoad, 540, 320, "hook-load"));
  if (chartImages?.forces) children.push(chartImage(chartImages.forces, 540, 280, "axial-load"));

  children.push(pageBreak());

  // ══════════════════════════════════════
  // ═══ 2.1A — АНАЛИЗ ПРОХОЖДЕНИЯ ГНКТ ═══
  // ══════════════════════════════════════
  children.push(new Paragraph({
    spacing: { after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: NAVY, space: 4 } },
    children: [new TextRun({ text: "АНАЛИЗ ПРОХОЖДЕНИЯ ГНКТ", bold: true, size: 28, font: "Calibri", color: NAVY })],
  }));

  children.push(infoLine(
    `Профиль дохождения колонны ГНКТ ${ct.od}×${ct.wall} мм (${ct.grade}) в скважине MD = ${well.md} м, TVD = ${well.tvd} м.`,
    { size: 18 },
  ));
  children.push(infoLine(
    `Коэффициент трения μ = ${friction}. Жидкость: ${fluid.name} (ρ = ${fluid.density} г/см³). КНБК: ${tools.bhaWeight} кг.`,
    { size: 18 },
  ));

  // Summary verdict
  if (forces.lockUpDepth > 0) {
    children.push(new Paragraph({
      spacing: { before: 120, after: 120 },
      shading: { type: ShadingType.CLEAR, color: "auto", fill: "FDEDEC" },
      indent: { left: 200, right: 200 },
      children: [
        new TextRun({ text: "🔒 ВЫВОД: ", bold: true, size: 20, font: "Calibri", color: RED }),
        new TextRun({ text: `Запирание ГНКТ прогнозируется на глубине ${forces.lockUpDepth} м. Дальнейшее продвижение невозможно без изменения условий.`, size: 20, font: "Calibri", color: RED }),
      ],
    }));
  } else {
    children.push(new Paragraph({
      spacing: { before: 120, after: 120 },
      shading: { type: ShadingType.CLEAR, color: "auto", fill: "EAFAF1" },
      indent: { left: 200, right: 200 },
      children: [
        new TextRun({ text: "✅ ВЫВОД: ", bold: true, size: 20, font: "Calibri", color: GREEN }),
        new TextRun({ text: `Прохождение ГНКТ до забоя (${well.md} м) — успешно. Запирание не прогнозируется.`, size: 20, font: "Calibri", color: GREEN }),
      ],
    }));
  }

  // Key metrics summary mini-table
  children.push(subTitle("Сводка по нагрузкам"));
  children.push(paramTable([
    ["Вес на крюке при спуске (на забое)", `${fmt(forces.surfaceLoadRIH, 1)} кН (${fmt(forces.surfaceLoadRIH * 1000 / 9.81, 0)} кгс)`, forces.surfaceLoadRIH < 0],
    ["Вес на крюке при подъёме (с забоя)", `${fmt(forces.surfaceLoadPOOH, 1)} кН (${fmt(forces.surfaceLoadPOOH * 1000 / 9.81, 0)} кгс)`],
    ["Разница (подъём − спуск)", `${fmt(forces.surfaceLoadPOOH - forces.surfaceLoadRIH, 1)} кН`],
    ["Предел текучести 80%", `${fmt(limits.maxWorkingTension, 1)} кН (${fmt(limits.maxWorkingTension * 1000 / 9.81, 0)} кгс)`],
    ["Запас по растяжению (подъём)", `${fmt((1 - forces.surfaceLoadPOOH / limits.yieldTension) * 100, 1)}%`, forces.surfaceLoadPOOH > limits.maxWorkingTension],
    ["Глубина lock-up", forces.lockUpDepth > 0 ? `${forces.lockUpDepth} м` : "— (нет)", forces.lockUpDepth > 0],
    ["Сила трения (СПО ↓)", `${fmt(forces.dragForceRIH, 1)} кН`],
    ["Сила трения (СПО ↑)", `${fmt(forces.dragForcePOOH, 1)} кН`],
  ]));

  // ─── 100m interval table (the main deliverable) ───
  if (hookLoadData && hookLoadData.length > 0) {
    children.push(subTitle("Профиль дохождения с интервалом 100 м"));
    children.push(infoLine(
      "Вес на крюке в кгс при спуске (RIH) и подъёме (POOH) на каждые 100 м глубины КНБК.",
      { italic: true, color: GRAY, size: 16 },
    ));

    // Build 100m-interval rows from hookLoadData
    const maxDepth = hookLoadData[hookLoadData.length - 1]?.depth || 0;
    const interval = 100;
    const intervalRows: string[][] = [];

    for (let d = 0; d <= maxDepth; d += interval) {
      // Find closest point
      let best = hookLoadData[0];
      let bestDist = Math.abs(best.depth - d);
      for (const p of hookLoadData) {
        const dist = Math.abs(p.depth - d);
        if (dist < bestDist) { best = p; bestDist = dist; }
      }
      // Status indicator
      let status = "✅";
      if (best.hookRIH_kgf <= 0) status = "🔒 Запирание";
      else if (best.hookRIH_kgf < best.yieldLimit80_kgf * 0.1) status = "⚠ Малый вес";
      if (best.hookPOOH_kgf > best.yieldLimit80_kgf) status = "⛔ Перегрузка";

      intervalRows.push([
        `${best.depth}`,
        fmt(best.tvd, 0),
        `${best.hookRIH_kgf}`,
        fmt(best.hookRIH_kN, 1),
        `${best.hookPOOH_kgf}`,
        fmt(best.hookPOOH_kN, 1),
        `${best.hookPOOH_kgf - best.hookRIH_kgf}`,
        status,
      ]);
    }
    // Always add last point if not on interval
    const last = hookLoadData[hookLoadData.length - 1];
    if (last.depth % interval !== 0) {
      let status = "✅";
      if (last.hookRIH_kgf <= 0) status = "🔒 Запирание";
      if (last.hookPOOH_kgf > last.yieldLimit80_kgf) status = "⛔ Перегрузка";
      intervalRows.push([
        `${last.depth}`,
        fmt(last.tvd, 0),
        `${last.hookRIH_kgf}`,
        fmt(last.hookRIH_kN, 1),
        `${last.hookPOOH_kgf}`,
        fmt(last.hookPOOH_kN, 1),
        `${last.hookPOOH_kgf - last.hookRIH_kgf}`,
        status,
      ]);
    }

    children.push(dataTable(
      ["MD, м", "TVD, м", "Спуск, кгс", "Спуск, кН", "Подъём, кгс", "Подъём, кН", "Δ (кгс)", "Статус"],
      intervalRows,
      { warn: (ri) => {
        const row = intervalRows[ri];
        return row[7].includes("🔒") || row[7].includes("⛔");
      }},
    ));

    // Textual analysis per zone
    children.push(subTitle("Анализ по интервалам"));
    const zones: { from: number; to: number; comment: string; level: string }[] = [];
    for (let i = 1; i < intervalRows.length; i++) {
      const depthFrom = parseInt(intervalRows[i - 1][0]);
      const depthTo = parseInt(intervalRows[i][0]);
      const rihFrom = parseInt(intervalRows[i - 1][2]);
      const rihTo = parseInt(intervalRows[i][2]);
      const drop = rihFrom - rihTo;
      const dropPct = rihFrom > 0 ? (drop / rihFrom) * 100 : 0;

      if (intervalRows[i][7].includes("🔒")) {
        zones.push({ from: depthFrom, to: depthTo, comment: `Запирание! Вес на спуск падает до 0 кгс. Требуется снижение трения или изменение технологии.`, level: "critical" });
      } else if (dropPct > 30) {
        zones.push({ from: depthFrom, to: depthTo, comment: `Резкое снижение веса на спуск (−${fmt(dropPct, 0)}%). Зона повышенного трения — возможен набор кривизны.`, level: "warning" });
      } else if (dropPct > 15) {
        zones.push({ from: depthFrom, to: depthTo, comment: `Умеренное снижение веса на спуск (−${fmt(dropPct, 0)}%). Контроль скорости спуска.`, level: "info" });
      }
    }

    if (zones.length === 0) {
      children.push(infoLine("✅ Равномерное снижение веса по всему стволу — без аномальных зон трения.", { color: GREEN, bold: true }));
    } else {
      for (const z of zones) {
        const color = z.level === "critical" ? RED : z.level === "warning" ? AMBER : GRAY;
        const bg = z.level === "critical" ? "FDEDEC" : z.level === "warning" ? "FEF9E7" : undefined;
        children.push(new Paragraph({
          spacing: { before: 40, after: 40 },
          shading: bg ? { type: ShadingType.CLEAR, color: "auto", fill: bg } : undefined,
          indent: { left: 200 },
          children: [
            new TextRun({ text: `${z.from}–${z.to} м: `, bold: true, size: 18, font: "Calibri", color }),
            new TextRun({ text: z.comment, size: 18, font: "Calibri", color }),
          ],
        }));
      }
    }
  }

  // 2.1.1 Full Hook Load Table (detailed)
  if (hookLoadData && hookLoadData.length > 0) {
    children.push(pageBreak());
    children.push(subTitle("Полная таблица дохождения — Вес на крюке"));
    const step = Math.max(1, Math.floor(hookLoadData.length / 30));
    const sampled = hookLoadData.filter((_, i) => i === 0 || i === hookLoadData.length - 1 || i % step === 0);
    children.push(dataTable(
      ["Глубина, м", "TVD, м", "Спуск, кгс", "Подъём, кгс", "Спуск, кН", "Подъём, кН", "80% σ_y, кгс"],
      sampled.map(p => [
        `${p.depth}`, fmt(p.tvd, 1),
        `${p.hookRIH_kgf}`, `${p.hookPOOH_kgf}`,
        fmt(p.hookRIH_kN, 1), fmt(p.hookPOOH_kN, 1),
        `${p.yieldLimit80_kgf}`,
      ]),
      { warn: (ri) => sampled[ri].hookRIH_kgf <= 0 },
    ));
  }

  // 2.1.2 Axial Load Distribution Table
  if (forceProfile && forceProfile.length > 0) {
    children.push(subTitle("Распределение осевой нагрузки по глубине"));
    const step = Math.max(1, Math.floor(forceProfile.length / 25));
    const sampled = forceProfile.filter((_, i) => i === 0 || i === forceProfile.length - 1 || i % step === 0);
    children.push(dataTable(
      ["Глубина, м", "TVD, м", "Спуск, кН", "Подъём, кН", "Синус. изгиб, кН", "Спир. изгиб, кН"],
      sampled.map(p => [
        `${p.depth}`, fmt(p.tvd, 1),
        fmt(p.axialRIH, 1), fmt(p.axialPOOH, 1),
        fmt(p.bucklingLimit, 1), fmt(p.helicalLimit, 1),
      ]),
    ));
  }

  children.push(pageBreak());

  // 2.2 Limits
  children.push(sectionTitle("2.2  Пределы давления и нагрузок (CoilLIMIT)"));
  children.push(paramTable([
    ["Давление разрыва (Barlow)", `${fmt(limits.burstPressure, 1)} МПа`],
    ["Макс. рабочее давление (80%)", `${fmt(limits.maxWorkingPressure, 1)} МПа`],
    ["Давление смятия", `${fmt(limits.collapsePressure, 1)} МПа`],
    ["Смятие с учётом овальности", `${fmt(limits.collapseWithOvality, 1)} МПа`, limits.collapseWithOvality < well.wellheadPressure],
    ["Предел текучести (растяжение)", `${fmt(limits.yieldTension, 1)} кН`],
    ["Макс. рабочее натяжение (80%)", `${fmt(limits.maxWorkingTension, 1)} кН`],
    ["Коэфф. фон Мизеса (σ_vm / σ_y)", `${fmt(limits.vonMisesRatio, 3)}`, limits.vonMisesRatio >= 0.8],
  ]));

  if (chartImages?.limits) children.push(chartImage(chartImages.limits, 540, 340, "limits-envelope"));

  children.push(pageBreak());

  // 2.3 Hydraulics
  children.push(sectionTitle("2.3  Гидравлика циркуляции"));
  children.push(paramTable([
    ["Скорость в ГНКТ", `${fmt(hydraulics.velocityInCT)} м/с`],
    ["Скорость в затрубье", `${fmt(hydraulics.velocityAnnulus)} м/с`],
    ["Мин. скорость транспорта шлама", `${fmt(hydraulics.minTransportVelocity)} м/с`],
    ["Транспорт шлама", hydraulics.transportOk ? "✅ Достаточно" : "⚠ Недостаточно", !hydraulics.transportOk],
    ["Re в ГНКТ", `${hydraulics.reynoldsInCT}`],
    ["Режим течения в ГНКТ", hydraulics.flowRegimeCT],
    ["Re в затрубье", `${hydraulics.reynoldsAnnulus}`],
    ["Режим течения в затрубье", hydraulics.flowRegimeAnnulus],
    ["ΔP внутри ГНКТ", `${fmt(hydraulics.dpInsideCT)} МПа`],
    ["ΔP в затрубье", `${fmt(hydraulics.dpAnnulus)} МПа`],
    ["ΔP на насадках", `${fmt(hydraulics.dpNozzle)} МПа`],
    ["Общее ΔP системы", `${fmt(hydraulics.dpTotal)} МПа`, hydraulics.dpTotal > limits.maxWorkingPressure],
    ["Гидростатика внутри (TVD)", `${fmt(hydraulics.hydrostaticInside)} МПа`],
    ["Гидростатика в затрубье (TVD)", `${fmt(hydraulics.hydrostaticAnnulus)} МПа`],
    ["ECD на забое (TVD)", `${fmt(hydraulics.ecdAtTD, 3)} г/см³`],
    ["BHP при циркуляции (TVD)", `${fmt(hydraulics.bhCircPressure)} МПа`],
    ["Давление ГРП (TVD)", `${fmt(hydraulics.fracPressureAtTD)} МПа`],
    ["BHP / P_грп", `${fmt(hydraulics.fracSafetyFactor)}`, hydraulics.fracSafetyFactor >= 0.85],
  ]));

  if (chartImages?.hydraulics) children.push(chartImage(chartImages.hydraulics, 540, 300, "hydraulics-chart"));

  // 2.3.1 Hydraulics Curve Table
  if (hydraulicsCurve && hydraulicsCurve.length > 0) {
    children.push(subTitle("Кривая потерь давления vs Расход"));
    const step = Math.max(1, Math.floor(hydraulicsCurve.length / 15));
    const sampled = hydraulicsCurve.filter((_, i) => i === 0 || i === hydraulicsCurve.length - 1 || i % step === 0);
    children.push(dataTable(
      ["Q, л/с", "ΔP ГНКТ, МПа", "ΔP Затрубье, МПа", "ΔP Насадки, МПа", "Общее ΔP, МПа"],
      sampled.map(p => [
        fmt(p.flowRate, 2), fmt(p.dpCT, 2), fmt(p.dpAnn, 2), fmt(p.dpNozzle, 2), fmt(p.dpTotal, 2),
      ]),
      { warn: (ri) => sampled[ri].dpTotal > limits.maxWorkingPressure },
    ));
  }

  children.push(pageBreak());

  // 2.4 Tempering
  if (tempering) {
    children.push(sectionTitle("2.4  Темперирование — Температурная деградация"));
    children.push(paramTable([
      ["Номинальный предел текучести", `${tempering.nominalYield} МПа`],
      ["Номинальное P разрыва", `${fmt(tempering.nominalBurst, 1)} МПа`],
      ["Номинальное P смятия", `${fmt(tempering.nominalCollapse, 1)} МПа`],
      ["Макс. температура трубы", `${tempering.maxPipeTemp} °C на ${tempering.maxPipeTempDepth} м`],
      ["Мин. коэфф. деградации", `${fmt(tempering.minDeratingFactor, 3)}`, tempering.minDeratingFactor < 0.85],
      ["Снижение прочности", `${fmt((1 - tempering.minDeratingFactor) * 100, 1)}%`, (1 - tempering.minDeratingFactor) > 0.1],
      ["Эфф. σ_y на забое", `${fmt(tempering.effectiveYieldAtBH, 0)} МПа`, tempering.effectiveYieldAtBH < tempering.nominalYield * 0.85],
      ["P разрыва на забое", `${fmt(tempering.burstAtBH, 1)} МПа`, tempering.burstAtBH < tempering.nominalBurst * 0.85],
      ["P смятия на забое", `${fmt(tempering.collapseAtBH, 1)} МПа`],
    ]));

    if (chartImages?.tempering) children.push(chartImage(chartImages.tempering, 540, 280, "tempering-chart"));
    if (chartImages?.temperingDegradation) children.push(chartImage(chartImages.temperingDegradation, 540, 260, "degradation-chart"));

    // Tempering profile table
    if (tempering.profile && tempering.profile.length > 0) {
      children.push(subTitle("Профиль температуры и деградации по глубине"));
      const step = Math.max(1, Math.floor(tempering.profile.length / 20));
      const sampled = tempering.profile.filter((_, i) => i === 0 || i === tempering.profile.length - 1 || i % step === 0);
      children.push(dataTable(
        ["MD, м", "TVD, м", "T° пласта", "T° жидкости", "T° трубы", "Коэфф.", "σ_y эфф, МПа"],
        sampled.map(p => [
          `${p.depth}`, fmt(p.tvd, 1),
          `${p.formationTemp}°C`, `${p.fluidInsideTemp}°C`, `${p.pipeTemp}°C`,
          fmt(p.yieldDerating, 3), fmt(p.effectiveYield, 0),
        ]),
        { warn: (ri) => sampled[ri].yieldDerating < 0.85 },
      ));
    }

    children.push(pageBreak());
  }

  // 2.5 Temperature Profile
  if (tempProfile && tempProfile.length > 0) {
    children.push(sectionTitle(tempering ? "2.5  Температурный профиль" : "2.4  Температурный профиль"));
    const step = Math.max(1, Math.floor(tempProfile.length / 15));
    const sampled = tempProfile.filter((_, i) => i === 0 || i === tempProfile.length - 1 || i % step === 0);
    children.push(dataTable(
      ["MD, м", "TVD, м", "BHST (стат.), °C", "BHCT (цирк.), °C"],
      sampled.map(p => [`${p.depth}`, fmt(p.tvd, 1), fmt(p.tempStatic, 1), fmt(p.tempCirculating, 1)]),
    ));
  }

  // 2.6 Fatigue
  const fatigueNum = tempering ? "2.6" : "2.5";
  children.push(sectionTitle(`${fatigueNum}  CoilLIFE — Ресурс усталости`));
  children.push(paramTable([
    ["Деформация на барабане", `${fmt(fatigue.bendingStrainReel, 3)}%`],
    ["Деформация на направл. арке", `${fmt(fatigue.bendingStrainGuideArch, 3)}%`],
    ["Суммарная деформация за рейс", `${fmt(fatigue.totalStrainPerTrip, 3)}%`],
    ["Расчётный ресурс", `${fatigue.estimatedCycles} рейсов`],
    ["Безопасный ресурс (SF=2)", `${fatigue.maxSafeTrips} рейсов`],
    ["Использовано ресурса", `${fmt(fatigue.fatigueLifeUsed, 1)}%`, fatigue.fatigueLifeUsed > 60],
    ["Снижение давления разрыва", `${fmt(fatigue.pressureDerate, 1)}%`, fatigue.pressureDerate > 15],
  ]));

  if (chartImages?.fatigue) children.push(chartImage(chartImages.fatigue, 540, 280, "fatigue-chart"));

  // 2.6.1 Fatigue Curve Table
  if (fatigueCurve && fatigueCurve.length > 0) {
    children.push(subTitle("Кривая ресурса усталости"));
    const step = Math.max(1, Math.floor(fatigueCurve.length / 15));
    const sampled = fatigueCurve.filter((_, i) => i === 0 || i === fatigueCurve.length - 1 || i % step === 0);
    children.push(dataTable(
      ["Рейсы", "Ресурс, %", "Снижение P разрыва, %", "Эфф. P разрыва, МПа"],
      sampled.map(p => [
        `${p.trips}`, fmt(p.lifeUsed, 1), fmt(p.burstDerate, 1), fmt(p.effectiveBurst, 1),
      ]),
      { warn: (ri) => sampled[ri].lifeUsed > 80 },
    ));
  }

  children.push(pageBreak());

  // ══════════════════════════════════════
  // ═══ 3. RISK ASSESSMENT ═══
  // ══════════════════════════════════════
  children.push(new Paragraph({
    spacing: { after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: NAVY, space: 4 } },
    children: [new TextRun({ text: "РАЗДЕЛ 3 — ОЦЕНКА РИСКОВ", bold: true, size: 28, font: "Calibri", color: NAVY })],
  }));

  if (risks.length > 0) {
    for (const r of risks) {
      const color = r.level === "critical" ? RED : r.level === "warning" ? AMBER : GREEN;
      const bg = r.level === "critical" ? "FDEDEC" : r.level === "warning" ? "FEF9E7" : "EAFAF1";
      children.push(new Paragraph({
        spacing: { before: 60, after: 60 },
        shading: { type: ShadingType.CLEAR, color: "auto", fill: bg },
        indent: { left: 200, right: 200 },
        children: [
          new TextRun({ text: `${r.emoji} `, size: 20, font: "Calibri" }),
          new TextRun({
            text: r.level === "critical" ? "КРИТИЧНО: " : r.level === "warning" ? "ВНИМАНИЕ: " : "",
            bold: true, size: 18, font: "Calibri", color,
          }),
          new TextRun({ text: r.message, size: 18, font: "Calibri", color }),
        ],
      }));
    }
  } else {
    children.push(infoLine("✅ Все параметры в допустимых пределах.", { color: GREEN, bold: true }));
  }

  // ══════════════════════════════════════
  // ═══ FOOTER DISCLAIMER ═══
  // ══════════════════════════════════════
  children.push(new Paragraph({ spacing: { before: 500 } }));
  children.push(new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR, space: 6 } },
    spacing: { after: 60 },
    children: [new TextRun({
      text: "Данный отчёт сформирован автоматически системой DeAllsoft и носит рекомендательный характер.",
      size: 15, font: "Calibri", color: GRAY, italics: true,
    })],
  }));
  children.push(new Paragraph({
    children: [new TextRun({
      text: "Окончательные решения должны приниматься квалифицированными специалистами с учётом всех факторов.",
      size: 15, font: "Calibri", color: GRAY, italics: true,
    })],
  }));

  // ══════════════════════════════════════
  // ═══ BUILD DOCUMENT ═══
  // ══════════════════════════════════════
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 20 } },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: 720, bottom: 720, left: 800, right: 800 } },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: ACCENT_GOLD, space: 3 } },
            children: [
              new TextRun({ text: "ГНКТ — DeAllsoft Engineering  |  ", size: 14, color: GRAY, font: "Calibri" }),
              new TextRun({ text: dateStr, size: 14, color: GRAY, font: "Calibri" }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR, space: 3 } },
            children: [
              new TextRun({ text: "Страница ", size: 14, color: GRAY, font: "Calibri" }),
              new TextRun({ children: [PageNumber.CURRENT], size: 14, color: GRAY, font: "Calibri" }),
              new TextRun({ text: "  •  DeAllsoft © 2025", size: 14, color: GRAY, font: "Calibri" }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `ГНКТ_Отчёт_${now.toISOString().slice(0, 10)}.docx`);
}
