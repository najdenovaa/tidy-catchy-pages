// Batch DOCX exporter: собирает ZIP с отдельными DOCX-отчётами по скважине.
// Источники данных:
//   1) shared-well-store (общие данные скважины)
//   2) sessionStorage["cementing_session_v1"] — сессия модуля цементирования
//   3) (опционально) другие модули, если есть сохранённые сессии

import JSZip from "jszip";
import { saveAs } from "file-saver";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, TableLayoutType,
} from "docx";
import { getSharedWell, type SharedWellData } from "./shared-well-store";
import { normalizeCementingSnapshot } from "./cementing-normalizers";
import { exportToDocx } from "./export-docx";
import { exportCementPlugToDocx, type CementPlugExportData } from "./export-cement-plug-docx";
import { exportCTDocx } from "./export-ct-docx";

const BORDER = {
  top: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  left: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
  right: { style: BorderStyle.SINGLE, size: 1, color: "999999" },
};

function tcell(text: string, bold = false, align: typeof AlignmentType[keyof typeof AlignmentType] = AlignmentType.LEFT) {
  return new TableCell({
    borders: BORDER,
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text, bold, size: 20, font: "Calibri" })],
    })],
  });
}

function kvRow(k: string, v: string) {
  return new TableRow({ children: [tcell(k), tcell(v, true, AlignmentType.RIGHT)] });
}

const FIELD_LABEL: Partial<Record<keyof SharedWellData, string>> = {
  wellName: "Скважина",
  padName: "Куст",
  fieldName: "Месторождение",
  wellDepthMD: "Глубина MD, м",
  wellDepthTVD: "Глубина TVD, м",
  holeDiameter: "Ø ствола, мм",
  casingShoe: "Башмак ОК, м",
  casingID: "ID ОК, мм",
  casingOD: "OD ОК, мм",
  reservoirTopMD: "Кровля пласта, м MD",
  reservoirBottomMD: "Подошва пласта, м MD",
  reservoirPressureMPa: "P пл, МПа",
  reservoirTempC: "T пл, °C",
  mudDensity: "ρ ПЖ, кг/м³",
};

async function buildSummaryDocx(shared: SharedWellData, modules: string[], skipped: string[] = []): Promise<Blob> {
  const now = new Date();
  const rows: TableRow[] = [];
  for (const [key, label] of Object.entries(FIELD_LABEL)) {
    const v = (shared as Record<string, unknown>)[key];
    if (v === undefined || v === null || v === "") continue;
    rows.push(kvRow(label!, String(v)));
  }
  const wellTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: rows.length ? rows : [kvRow("—", "нет данных")],
  });

  const modList = modules.length
    ? modules.map(m => new Paragraph({ children: [new TextRun({ text: `• ${m}`, size: 22, font: "Calibri" })] }))
    : [new Paragraph({ children: [new TextRun({ text: "Сессии модулей не обнаружены — экспортирована только сводка.", italics: true, color: "888888", size: 22, font: "Calibri" })] })];

  const doc = new Document({
    creator: "DeAllsoft",
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          heading: HeadingLevel.TITLE,
          children: [new TextRun({ text: "Сводный отчёт по скважине", bold: true, size: 40, color: "1A3A5C", font: "Calibri" })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: shared.wellName ? `${shared.wellName}${shared.fieldName ? " · " + shared.fieldName : ""}` : "Скважина не идентифицирована", size: 26, color: "555555", font: "Calibri" })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `Сформировано: ${now.toLocaleString("ru-RU")}`, size: 18, color: "888888", italics: true, font: "Calibri" })],
        }),
        new Paragraph({ children: [new TextRun({ text: "" })] }),
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: "Общие параметры скважины", bold: true, size: 28, color: "1A3A5C", font: "Calibri" })],
        }),
        wellTable,
        new Paragraph({ children: [new TextRun({ text: "" })] }),
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: "Состав пакета отчётов", bold: true, size: 28, color: "1A3A5C", font: "Calibri" })],
        }),
        ...modList,
        ...(skipped.length ? [
          new Paragraph({ children: [new TextRun({ text: "" })] }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: "Пропущенные модули", bold: true, size: 26, color: "8A4A1A", font: "Calibri" })],
          }),
          ...skipped.map(s => new Paragraph({ children: [new TextRun({ text: `• ${s}`, size: 22, color: "8A4A1A", font: "Calibri" })] })),
        ] : []),
        new Paragraph({ children: [new TextRun({ text: "" })] }),
        new Paragraph({
          children: [new TextRun({
            text: "Все расчёты носят информационный характер. Окончательные технические решения принимаются ответственными специалистами на основании действующих нормативов.",
            italics: true, color: "888888", size: 18, font: "Calibri",
          })],
        }),
      ],
    }],
  });
  return await Packer.toBlob(doc);
}

async function tryBuildCementingDocx(): Promise<Blob | null> {
  try {
    const raw = sessionStorage.getItem("cementing_session_v1");
    if (!raw) return null;
    const snap = normalizeCementingSnapshot(JSON.parse(raw));
    const blob = await exportToDocx(
      snap.wellData,
      snap.drillingFluid,
      snap.slurries,
      snap.buffers,
      snap.displacementFluids,
      snap.fractureGradient,
      undefined,
      undefined,
      { flushTimeMin: snap.flushTimeMin, flushVolumeM3: snap.flushVolumeM3 },
      { returnBlob: true, filename: "cementing-program.docx" },
    ) as Blob | undefined;
    return blob ?? null;
  } catch (e) {
    console.error("Cementing DOCX export failed:", e);
    return null;
  }
}

async function tryBuildCementPlugDocx(): Promise<Blob | null> {
  try {
    const raw = sessionStorage.getItem("cement_plug_export_bundle_v1");
    if (!raw) return null;
    const data = JSON.parse(raw) as CementPlugExportData;
    const blob = await exportCementPlugToDocx(data, { returnBlob: true }) as Blob | undefined;
    return blob ?? null;
  } catch (e) { console.error("CementPlug DOCX failed:", e); return null; }
}

async function tryBuildCTDocx(): Promise<Blob | null> {
  try {
    const raw = sessionStorage.getItem("ct_export_bundle_v1");
    if (!raw) return null;
    const data = JSON.parse(raw);
    const blob = await exportCTDocx(data, { returnBlob: true }) as Blob | undefined;
    return blob ?? null;
  } catch (e) { console.error("CT DOCX failed:", e); return null; }
}

/** Сборка ZIP-пакета DOCX по скважине */
export async function exportWellBatchZip() {
  const shared = getSharedWell();
  const zip = new JSZip();
  const included: string[] = [];
  const skipped: string[] = [];

  // 1) Цементирование — программа
  const cementBlob = await tryBuildCementingDocx();
  if (cementBlob) {
    zip.file("01_Цементирование_программа.docx", cementBlob);
    included.push("Цементирование — программа (с блоком ОЗЦ)");
  } else {
    skipped.push("Цементирование — сессия не найдена");
  }

  // 2) Цементный мост
  const plugBlob = await tryBuildCementPlugDocx();
  if (plugBlob) {
    zip.file("02_Цементный_мост.docx", plugBlob);
    included.push("Цементный мост");
  } else {
    skipped.push("Цементный мост — откройте модуль и выгрузите DOCX хотя бы раз");
  }

  // 3) ГНКТ
  const ctBlob = await tryBuildCTDocx();
  if (ctBlob) {
    zip.file("03_ГНКТ.docx", ctBlob);
    included.push("ГНКТ — отчёт");
  } else {
    skipped.push("ГНКТ — откройте модуль и выгрузите DOCX хотя бы раз");
  }

  // 0) Сводка по скважине (всегда)
  const summary = await buildSummaryDocx(shared, included, skipped);
  zip.file("00_Сводка_по_скважине.docx", summary);

  // Имя архива
  const wn = (shared.wellName || "скважина").replace(/[^\wа-яА-Я\-_.]+/giu, "_");
  const ts = new Date().toISOString().slice(0, 10);
  const fname = `Пакет_${wn}_${ts}.zip`;

  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, fname);

  return { filename: fname, modules: included, skipped };
}
