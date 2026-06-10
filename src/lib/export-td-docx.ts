/**
 * Torque & Drag DOCX report — focused on inputs, T&D modes, Surge/Swab and Stuck-zone analysis.
 * Mirrors the styling pattern of export-ct-docx.ts but kept compact and self-contained.
 */
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, AlignmentType, WidthType, BorderStyle, ShadingType, Header, Footer, PageNumber,
} from "docx";
import { saveAs } from "file-saver";
import type {
  TDInput, TDSummary, TDResult, SurgeSwabResult, StuckZone,
} from "./torque-drag-calculations";
import type { WellData } from "./cementing-calculations";

const NAVY = "0F2B46";
const HEADER_BG = NAVY;
const HEADER_FG = "FFFFFF";
const ROW_ALT = "EBF5FB";
const BORDER_CLR = "AED6F1";
const GRAY = "7F8C8D";
const RED = "C0392B";
const AMBER = "D68910";
const GREEN = "1E8449";

const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");

const BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
  left: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
  right: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
};

function hCell(text: string): TableCell {
  return new TableCell({
    borders: BORDER,
    shading: { type: ShadingType.CLEAR, color: "auto", fill: HEADER_BG },
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, size: 16, color: HEADER_FG, font: "Calibri" })],
    })],
  });
}

function dCell(text: string, opts?: { color?: string; bold?: boolean; alt?: boolean; align?: typeof AlignmentType[keyof typeof AlignmentType] }): TableCell {
  return new TableCell({
    borders: BORDER,
    shading: opts?.alt ? { type: ShadingType.CLEAR, color: "auto", fill: ROW_ALT } : undefined,
    margins: { top: 35, bottom: 35, left: 80, right: 80 },
    children: [new Paragraph({
      alignment: opts?.align ?? AlignmentType.LEFT,
      children: [new TextRun({ text, size: 16, font: "Calibri", bold: opts?.bold, color: opts?.color })],
    })],
  });
}

function title(text: string, size = 28, color = NAVY): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, bold: true, size, color, font: "Calibri" })],
  });
}

function p(text: string, opts?: { italic?: boolean; color?: string }): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text, size: 18, color: opts?.color ?? "2C3E50", italics: opts?.italic, font: "Calibri" })],
  });
}

function kvTable(rows: Array<[string, string]>): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(([k, v], i) => new TableRow({ children: [dCell(k, { bold: true, alt: i % 2 === 0 }), dCell(v, { alt: i % 2 === 0, align: AlignmentType.RIGHT })] })),
  });
}

function modeRow(r: TDResult, alt: boolean): TableRow {
  return new TableRow({ children: [
    dCell(r.modeLabel, { bold: true, alt }),
    dCell(fmt(r.maxHookLoad, 0), { alt, align: AlignmentType.RIGHT }),
    dCell(fmt(r.minHookLoad, 0), { alt, align: AlignmentType.RIGHT, color: r.minHookLoad < 0 ? RED : undefined }),
    dCell(fmt(r.maxTorque, 1), { alt, align: AlignmentType.RIGHT }),
    dCell(fmt(r.maxSideForce, 2), { alt, align: AlignmentType.RIGHT }),
    dCell(fmt(r.maxVonMises ?? 0, 0), { alt, align: AlignmentType.RIGHT }),
  ]});
}

function pointsSampleRow(md: number, hlIn: number, hlOut: number, torque: number, clearance: number, vm: number, alt: boolean): TableRow {
  return new TableRow({ children: [
    dCell(fmt(md, 0), { alt, align: AlignmentType.RIGHT }),
    dCell(fmt(hlIn, 0), { alt, align: AlignmentType.RIGHT }),
    dCell(fmt(hlOut, 0), { alt, align: AlignmentType.RIGHT }),
    dCell(fmt(torque, 2), { alt, align: AlignmentType.RIGHT }),
    dCell(fmt(clearance, 0), { alt, align: AlignmentType.RIGHT, color: clearance < 5 ? RED : clearance < 10 ? AMBER : undefined }),
    dCell(fmt(vm, 0), { alt, align: AlignmentType.RIGHT }),
  ]});
}

const REASON_LABEL: Record<StuckZone["reason"], string> = {
  buckling: "Buckling",
  clearance: "Малый зазор",
  hook_load: "HL > рига",
  dls: "DLS > 5°/30м",
  surge_frac: "Surge > P_ГРП",
  swab_kick: "Swab < P_пласт",
  yield: "σ > предел текучести",
};

export async function exportTorqueDragDocx(opts: {
  well: WellData;
  input: TDInput;
  summary: TDSummary;
  extraModes: { drillRotary: TDResult; drillMotor: TDResult; backReam: TDResult; pickup: TDResult; slackoff: TDResult; cementRotate: TDResult };
  surgeSwab: SurgeSwabResult | null;
  stuckZones: StuckZone[];
  standLengthM?: number;
}): Promise<void> {
  const { well, input, summary, extraModes, surgeSwab, stuckZones } = opts;
  const standLengthM = opts.standLengthM ?? 28;

  // === Inputs section ===
  const inputRows: Array<[string, string]> = [
    ["Глубина скважины (MD)", `${fmt(well.wellDepthMD, 0)} м`],
    ["Глубина спуска (MD)",   `${fmt(well.casingDepthMD, 0)} м`],
    ["Башмак предыдущей", `${fmt(well.prevCasingDepth, 0)} м`],
    ["Диаметр ствола",   `${fmt(well.holeDiameter, 1)} мм`],
    ["OD/ID колонны",    `${fmt(well.casingOD, 1)} / ${fmt(input.casingID, 1)} мм`],
    ["Вес трубы",        `${fmt(input.pipeWeightKgPerM, 1)} кг/м`],
    ["ρ бурового",       `${fmt(input.mudDensity, 3)} г/см³`],
    ["μ в обсадке / в открытом стволе", `${fmt(input.frictionCased, 2)} / ${fmt(input.frictionOpenhole, 2)}`],
    ["WOB / RPM / Block weight", `${fmt(input.wob, 0)} кН · ${fmt(input.rpm, 0)} об/мин · ${fmt(input.blockWeight, 0)} кН`],
    ["Скорость СПО",     `${fmt(input.tripSpeedMps ?? 0.5, 2)} м/с`],
    ["Открытый конец",   input.isOpenEnded ? "Да" : "Нет (с БКМ)"],
    ["Заполнение колонны", `${fmt(input.fillLevel ?? 100, 0)} % · ρ внутр. ${fmt(input.fillFluidDensity ?? input.mudDensity, 3)} г/см³`],
    ["Градиент ГРП / пласт.", `${fmt(input.fracGradient_kPaPerM ?? 18, 1)} / ${fmt(input.porePressureGrad_kPaPerM ?? 10.5, 1)} кПа/м`],
    ["Грузоподъёмность буровой", `${fmt(input.maxHookLoad_kN ?? 0, 0)} кН`],
    ["Предел текучести", `${fmt(input.yieldStrength ?? 550, 0)} МПа`],
  ];

  // === Summary table for all 9 modes ===
  const allModes: TDResult[] = [
    summary.tripIn, summary.tripOut, summary.rotate,
    extraModes.drillRotary, extraModes.drillMotor, extraModes.backReam,
    extraModes.pickup, extraModes.slackoff, extraModes.cementRotate,
  ];
  const modeTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: ["Режим", "HL макс, кН", "HL мин, кН", "Момент, кН·м", "Бок. сила, кН/м", "σ Von Mises, МПа"].map(hCell) }),
      ...allModes.map((m, i) => modeRow(m, i % 2 === 1)),
    ],
  });

  // === Sampled trip-in/out points (every ~250 m) ===
  const samples = summary.tripIn.points.filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 18)) === 0);
  const sampleTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: ["MD, м", "HL спуск, кН", "HL подъём, кН", "Момент, кН·м", "Зазор, мм", "σ, МПа"].map(hCell) }),
      ...samples.map((pt, i) => {
        const idx = summary.tripIn.points.indexOf(pt);
        return pointsSampleRow(
          pt.md,
          pt.hookLoad,
          summary.tripOut.points[idx]?.hookLoad ?? 0,
          summary.rotate.points[idx]?.torque ?? 0,
          pt.clearance,
          pt.vonMises ?? 0,
          i % 2 === 1,
        );
      }),
    ],
  });

  // === Surge/Swab summary ===
  const surgeBlock: Paragraph[] = [];
  let surgeTable: Table | null = null;
  if (surgeSwab) {
    surgeBlock.push(
      p(`Макс. Δsurge: ${fmt(surgeSwab.maxSurgeMPa, 2)} МПа · Макс. Δswab: ${fmt(surgeSwab.maxSwabMPa, 2)} МПа`),
      p(`Запас до ГРП (худшая точка): ${fmt(surgeSwab.worstSurgeMargin, 2)} МПа${surgeSwab.worstSurgeMargin < 0 ? " — превышение!" : ""}`, { color: surgeSwab.worstSurgeMargin < 0 ? RED : undefined }),
      p(`Запас над пластовым (худшая точка): ${fmt(surgeSwab.worstSwabMargin, 2)} МПа${surgeSwab.worstSwabMargin < 0 ? " — риск притока!" : ""}`, { color: surgeSwab.worstSwabMargin < 0 ? RED : undefined }),
    );
    const ssSamples = surgeSwab.points.filter((_, i, arr) => i % Math.max(1, Math.floor(arr.length / 12)) === 0);
    surgeTable = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: ["MD, м", "Гидростат, МПа", "BHP+surge, МПа", "BHP−swab, МПа", "P_ГРП, МПа", "P_пласт, МПа"].map(hCell) }),
        ...ssSamples.map((sp, i) => new TableRow({ children: [
          dCell(fmt(sp.md, 0), { alt: i % 2 === 1, align: AlignmentType.RIGHT }),
          dCell(fmt(sp.hydrostaticMPa, 2), { alt: i % 2 === 1, align: AlignmentType.RIGHT }),
          dCell(fmt(sp.totalBHPsurgeMPa, 2), { alt: i % 2 === 1, align: AlignmentType.RIGHT, color: !sp.isSafeSurge ? RED : undefined }),
          dCell(fmt(sp.totalBHPswabMPa, 2), { alt: i % 2 === 1, align: AlignmentType.RIGHT, color: !sp.isSafeSwab ? AMBER : undefined }),
          dCell(fmt(sp.fracPressureMPa, 2), { alt: i % 2 === 1, align: AlignmentType.RIGHT }),
          dCell(fmt(sp.porePressureMPa, 2), { alt: i % 2 === 1, align: AlignmentType.RIGHT }),
        ]})),
      ],
    });
  } else {
    surgeBlock.push(p("Анализ Surge/Swab недоступен (отсутствуют данные).", { italic: true, color: GRAY }));
  }

  // === Stuck zones ===
  const zonesTable = stuckZones.length === 0
    ? null
    : new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: ["Интервал, м", "Причина", "Уровень", "Значение", "Рекомендация"].map(hCell) }),
        ...stuckZones.map((z, i) => new TableRow({ children: [
          dCell(`${z.topMD.toFixed(0)} – ${z.bottomMD.toFixed(0)}`, { alt: i % 2 === 1, align: AlignmentType.RIGHT }),
          dCell(REASON_LABEL[z.reason], { alt: i % 2 === 1 }),
          dCell(z.severity === "critical" ? "критич." : "внимание", { alt: i % 2 === 1, color: z.severity === "critical" ? RED : AMBER, bold: true }),
          dCell(z.metric, { alt: i % 2 === 1 }),
          dCell(z.recommendation, { alt: i % 2 === 1 }),
        ]})),
      ],
    });

  // === Per-stand simulator timeline (trip in) ===
  const totalDepth = well.casingDepthMD;
  const totalStands = Math.max(1, Math.ceil(totalDepth / standLengthM));
  const standRows: TableRow[] = [];
  const findPt = (md: number) => {
    let best = summary.tripIn.points[0]; let bd = Math.abs(best.md - md);
    for (const x of summary.tripIn.points) { const d = Math.abs(x.md - md); if (d < bd) { bd = d; best = x; } }
    return best;
  };
  const findSp = (md: number) => {
    if (!surgeSwab) return null;
    let best = surgeSwab.points[0]; let bd = Math.abs(best.md - md);
    for (const x of surgeSwab.points) { const d = Math.abs(x.md - md); if (d < bd) { bd = d; best = x; } }
    return best;
  };

  const stepEvery = Math.max(1, Math.floor(totalStands / 25)); // <= ~25 rows
  for (let s = 0; s <= totalStands; s += stepEvery) {
    const md = Math.min(totalDepth, s * standLengthM);
    const pt = findPt(md);
    const sp = findSp(md);
    const triggered = stuckZones.filter(z => md >= z.topMD - 0.5 && md <= z.bottomMD + 0.5);
    const sev: "ok" | "warning" | "critical" =
      triggered.some(z => z.severity === "critical") ? "critical"
      : triggered.length > 0 ? "warning" : "ok";
    const status = sev === "critical" ? "критич." : sev === "warning" ? "внимание" : "норма";
    const color = sev === "critical" ? RED : sev === "warning" ? AMBER : GREEN;
    const alt = (s / stepEvery) % 2 === 1;
    standRows.push(new TableRow({ children: [
      dCell(`${s}`, { alt, align: AlignmentType.RIGHT }),
      dCell(fmt(md, 0), { alt, align: AlignmentType.RIGHT }),
      dCell(fmt(pt.hookLoad, 0), { alt, align: AlignmentType.RIGHT, color: pt.hookLoad < 0 ? RED : undefined }),
      dCell(fmt(pt.torque, 2), { alt, align: AlignmentType.RIGHT }),
      dCell(fmt(pt.clearance, 0), { alt, align: AlignmentType.RIGHT, color: pt.clearance < 5 ? RED : pt.clearance < 10 ? AMBER : undefined }),
      dCell(sp ? fmt(sp.totalBHPsurgeMPa, 2) : "—", { alt, align: AlignmentType.RIGHT }),
      dCell(status, { alt, bold: true, color }),
      dCell(triggered.length ? triggered.map(t => REASON_LABEL[t.reason]).join("; ") : "—", { alt }),
    ]}));
  }
  const simTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: ["#", "MD, м", "HL, кН", "T, кН·м", "Зазор, мм", "BHP+surge, МПа", "Статус", "Активные риски"].map(hCell) }),
      ...standRows,
    ],
  });

  // === Document assembly ===
  const date = new Date();
  const dateStr = date.toLocaleDateString("ru-RU");

  const doc = new Document({
    creator: "DealSoft",
    title: "Отчёт Torque & Drag",
    styles: { default: { document: { run: { font: "Calibri" } } } },
    sections: [{
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: `Отчёт T&D · ${dateStr}`, size: 16, color: GRAY })],
        })]}),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "Стр. ", size: 16, color: GRAY }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GRAY }),
            new TextRun({ text: " из ", size: 16, color: GRAY }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: GRAY }),
            new TextRun({ text: "  ·  Расчёт носит информационный характер.", size: 16, color: GRAY }),
          ],
        })]}),
      },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 240 },
          children: [new TextRun({ text: "Отчёт Torque & Drag", bold: true, size: 40, color: NAVY })],
        }),
        p(`Дата формирования: ${dateStr}`, { italic: true, color: GRAY }),

        title("1. Исходные данные"),
        kvTable(inputRows),

        title("2. Сводка по 9 режимам"),
        modeTable,

        title("3. Профиль по глубине (выборка)"),
        sampleTable,

        title("4. Surge / Swab — гидродинамика СПО"),
        ...surgeBlock,
        ...(surgeTable ? [surgeTable] : []),

        title("5. Зоны риска посадки / прихвата"),
        ...(zonesTable
          ? [p(`Обнаружено ${stuckZones.length} зон.`), zonesTable]
          : [p("✓ Зон риска посадки/прихвата не обнаружено по текущим параметрам.", { color: GREEN })]),

        title("6. Пошаговый профиль СПО (свечами)"),
        p(`Длина свечи: ${standLengthM} м · всего свечей: ${totalStands} · шаг выборки: каждая ${stepEvery}-я.`, { italic: true, color: GRAY }),
        simTable,

        title("7. Заключение"),
        p(
          stuckZones.length === 0
            ? "По текущим параметрам критических зон риска не выявлено. Рекомендуется придерживаться расчётной скорости СПО и поддерживать колонну заполненной."
            : `Выявлено ${stuckZones.filter(z => z.severity === "critical").length} критических и ${stuckZones.filter(z => z.severity === "warning").length} предупреждающих зон. См. раздел 5 для конкретных рекомендаций по каждому интервалу.`,
        ),
        p("Расчёт выполнен по soft-string модели Johancsik с учётом плавучести (с учётом частичного заполнения), вязкого сопротивления Bingham, сопротивления центраторов и приращений давления Surge/Swab. Результаты носят информационный характер и подлежат проверке инженером-технологом.", { italic: true, color: GRAY }),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `Torque_Drag_Report_${date.toISOString().slice(0, 10)}.docx`);
}
