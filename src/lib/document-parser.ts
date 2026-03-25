/**
 * Client-side document parser — extracts text from PDF, DOCX, TXT, XLSX
 * without any AI or external API calls.
 */

import * as XLSX from "xlsx";

export interface ParsedDocument {
  name: string;
  type: string;
  text: string;
  pages?: number;
  tables?: string[][][]; // array of tables, each table = rows of cells
  error?: string;
}

// ─── PDF Parsing ─────────────────────────────────────────────────

async function parsePDF(file: File): Promise<ParsedDocument> {
  try {
    const pdfjsLib = await import("pdfjs-dist");
    
    // Set worker source
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const textParts: string[] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => item.str)
        .join(" ");
      if (pageText.trim()) {
        textParts.push(`--- Страница ${i} ---\n${pageText}`);
      }
    }

    return {
      name: file.name,
      type: "pdf",
      text: textParts.join("\n\n"),
      pages: numPages,
    };
  } catch (e: any) {
    return {
      name: file.name,
      type: "pdf",
      text: "",
      error: `Ошибка чтения PDF: ${e.message}`,
    };
  }
}

// ─── DOCX Parsing ────────────────────────────────────────────────

async function parseDOCX(file: File): Promise<ParsedDocument> {
  try {
    const mammoth = await import("mammoth");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    
    return {
      name: file.name,
      type: "docx",
      text: result.value,
    };
  } catch (e: any) {
    return {
      name: file.name,
      type: "docx",
      text: "",
      error: `Ошибка чтения DOCX: ${e.message}`,
    };
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

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
          
          if (jsonData.length > 0) {
            textParts.push(`--- Лист: ${sheetName} ---`);
            const tableRows: string[][] = [];
            
            for (const row of jsonData) {
              if (Array.isArray(row) && row.some(cell => cell !== undefined && cell !== null && String(cell).trim())) {
                const textRow = row.map(cell => String(cell ?? ""));
                tableRows.push(textRow);
                textParts.push(textRow.join(" | "));
              }
            }
            
            if (tableRows.length > 0) tables.push(tableRows);
          }
        }

        resolve({
          name: file.name,
          type: "excel",
          text: textParts.join("\n"),
          tables,
        });
      } catch (err: any) {
        resolve({
          name: file.name,
          type: "excel",
          text: "",
          error: `Ошибка чтения Excel: ${err.message}`,
        });
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
      resolve({
        name: file.name,
        type: "text",
        text: (e.target?.result as string) || "",
      });
    };
    reader.onerror = () => {
      resolve({
        name: file.name,
        type: "text",
        text: "",
        error: "Не удалось прочитать текстовый файл",
      });
    };
    reader.readAsText(file);
  });
}

// ─── Main entry point ────────────────────────────────────────────

export async function parseDocument(file: File): Promise<ParsedDocument> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const mime = file.type.toLowerCase();

  if (ext === "pdf" || mime === "application/pdf") {
    return parsePDF(file);
  }

  if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return parseDOCX(file);
  }

  if (ext === "doc" || mime === "application/msword") {
    // .doc (legacy) — try as text extraction
    return parseDOCX(file).then(result => {
      if (!result.text && !result.error) {
        return { ...result, error: "Формат .doc не полностью поддерживается. Рекомендуется конвертировать в .docx или .pdf." };
      }
      return result;
    });
  }

  if (["xlsx", "xls"].includes(ext) || mime.includes("spreadsheet") || mime.includes("excel")) {
    return parseExcel(file);
  }

  if (["txt", "csv", "log"].includes(ext) || mime.startsWith("text/")) {
    return parseTXT(file);
  }

  if (mime.startsWith("image/")) {
    return {
      name: file.name,
      type: "image",
      text: "",
      error: "Извлечение текста из изображений требует AI. Используйте AI-анализ для изображений АКЦ/СГДТ.",
    };
  }

  return {
    name: file.name,
    type: "unknown",
    text: "",
    error: `Неподдерживаемый формат: .${ext}`,
  };
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
