/**
 * Client-side document parser — extracts text from PDF, DOCX, TXT, XLSX
 * + Image analysis with OCR
 * without any AI or external API calls.
 */

import * as XLSX from "xlsx";
import { analyzeImage, imageAnalysisToMarkdown } from "./image-analysis-engine";
import { performOCR, ocrToMarkdown } from "./ocr-engine";

export interface ParsedDocument {
  name: string;
  type: string;
  text: string;
  pages?: number;
  tables?: string[][][];
  error?: string;
  imageAnalysis?: import("./image-analysis-engine").ImageAnalysisResult;
  ocrResult?: import("./ocr-engine").OcrResult;
}

function getVisibleSheetNames(workbook: XLSX.WorkBook): string[] {
  const workbookSheets = workbook.Workbook?.Sheets ?? [];

  return workbook.SheetNames.filter((sheetName, index) => {
    const meta = workbookSheets[index];
    return !meta || meta.Hidden === 0 || meta.Hidden == null;
  });
}

function getVisibleColumnIndexes(sheet: XLSX.WorkSheet): number[] {
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  const hiddenCols = sheet["!cols"] ?? [];
  const indexes: number[] = [];

  for (let col = range.s.c; col <= range.e.c; col++) {
    if (!hiddenCols[col]?.hidden) indexes.push(col);
  }

  return indexes;
}

function getVisibleRows(sheet: XLSX.WorkSheet): string[][] {
  const ref = sheet["!ref"];
  if (!ref) return [];

  const range = XLSX.utils.decode_range(ref);
  const hiddenRows = sheet["!rows"] ?? [];
  const visibleCols = getVisibleColumnIndexes(sheet);
  const rows: string[][] = [];

  for (let row = range.s.r; row <= range.e.r; row++) {
    if (hiddenRows[row]?.hidden) continue;

    const values = visibleCols.map((col) => {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[cellAddress];
      return cell == null ? "" : String(cell.w ?? cell.v ?? "").trim();
    });

    if (values.some((value) => value.length > 0)) {
      rows.push(values);
    }
  }

  return rows;
}

// ─── PDF Parsing ─────────────────────────────────────────────────

async function parsePDF(file: File): Promise<ParsedDocument> {
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const textParts: string[] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(" ");
      if (pageText.trim()) {
        textParts.push(`--- Страница ${i} ---\n${pageText}`);
      }
    }

    return { name: file.name, type: "pdf", text: textParts.join("\n\n"), pages: numPages };
  } catch (e: any) {
    return { name: file.name, type: "pdf", text: "", error: `Ошибка чтения PDF: ${e.message}` };
  }
}

// ─── DOCX Parsing ────────────────────────────────────────────────

async function parseDOCX(file: File): Promise<ParsedDocument> {
  try {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { name: file.name, type: "docx", text: result.value };
  } catch (e: any) {
    return { name: file.name, type: "docx", text: "", error: `Ошибка чтения DOCX: ${e.message}` };
  }
}

// ─── Excel Parsing ───────────────────────────────────────────────

function parseExcel(file: File): Promise<ParsedDocument> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const textParts: string[] = [];
        const tables: string[][][] = [];
        const visibleSheetNames = getVisibleSheetNames(workbook);

        for (const sheetName of visibleSheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const visibleRows = getVisibleRows(sheet);

          if (visibleRows.length > 0) {
            textParts.push(`--- Лист: ${sheetName} ---`);
            const tableRows: string[][] = [];
            for (const row of visibleRows) {
              tableRows.push(row);
              textParts.push(row.join(" | "));
            }
            if (tableRows.length > 0) tables.push(tableRows);
          }
        }

        resolve({ name: file.name, type: "excel", text: textParts.join("\n"), tables });
      } catch (err: any) {
        resolve({ name: file.name, type: "excel", text: "", error: `Ошибка чтения Excel: ${err.message}` });
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ─── Plain Text ──────────────────────────────────────────────────

function parseTXT(file: File): Promise<ParsedDocument> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      resolve({ name: file.name, type: "text", text: (e.target?.result as string) || "" });
    };
    reader.onerror = () => {
      resolve({ name: file.name, type: "text", text: "", error: "Не удалось прочитать текстовый файл" });
    };
    reader.readAsText(file);
  });
}

// ─── Image Parsing (Visual + OCR) ────────────────────────────────

async function parseImage(file: File): Promise<ParsedDocument> {
  try {
    // Run visual analysis and OCR in parallel
    const [analysis, ocrResult] = await Promise.all([
      analyzeImage(file),
      performOCR(file),
    ]);

    let text = imageAnalysisToMarkdown(analysis);
    text += "\n" + ocrToMarkdown(ocrResult, file.name);

    return {
      name: file.name,
      type: "image",
      text,
      imageAnalysis: analysis,
      ocrResult,
    };
  } catch (e: any) {
    return { name: file.name, type: "image", text: "", error: `Ошибка анализа изображения: ${e.message}` };
  }
}

// ─── Main entry point ────────────────────────────────────────────

export async function parseDocument(file: File): Promise<ParsedDocument> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const mime = file.type.toLowerCase();

  if (ext === "pdf" || mime === "application/pdf") return parsePDF(file);
  if (ext === "docx" || mime.includes("wordprocessingml")) return parseDOCX(file);
  if (ext === "doc" || mime === "application/msword") {
    return parseDOCX(file).then(r =>
      !r.text && !r.error ? { ...r, error: "Формат .doc не полностью поддерживается. Рекомендуется .docx или .pdf." } : r
    );
  }
  if (["xlsx", "xls"].includes(ext) || mime.includes("spreadsheet") || mime.includes("excel")) return parseExcel(file);
  if (["txt", "csv", "log"].includes(ext) || mime.startsWith("text/")) return parseTXT(file);
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "bmp", "tiff", "tif", "webp"].includes(ext)) return parseImage(file);

  return { name: file.name, type: "unknown", text: "", error: `Неподдерживаемый формат: .${ext}` };
}

/** Parse multiple documents */
export async function parseDocuments(files: File[]): Promise<ParsedDocument[]> {
  return Promise.all(files.map(f => parseDocument(f)));
}

/** Combine parsed documents into a single text for analysis */
export function combineParsedTexts(docs: ParsedDocument[]): string {
  return docs
    .filter(d => d.text.trim().length > 0)
    .map(d => `=== Документ: ${d.name} ===\n${d.text}`)
    .join("\n\n");
}
