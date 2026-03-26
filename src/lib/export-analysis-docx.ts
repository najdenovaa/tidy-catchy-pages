/**
 * Export analysis report to beautifully formatted Word (DOCX).
 * Reproduces the on-screen report word-for-word with professional styling.
 */
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, HeadingLevel, AlignmentType, WidthType,
  BorderStyle, ShadingType, PageBreak,
} from "docx";
import { saveAs } from "file-saver";

/* ───── Palette ───── */
const ACCENT   = "1B4F72";   // deep petrol-blue
const ACCENT2  = "2E86C1";   // lighter accent
const HEADER_BG = "1B4F72";
const HEADER_FG = "FFFFFF";
const LIGHT_BG  = "EBF5FB";
const BORDER_CLR = "AED6F1";
const GRAY      = "666666";
const RED       = "C0392B";
const GREEN     = "1E8449";
const AMBER     = "D68910";

/* ───── Helpers ───── */
const BORDER = {
  top:    { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
  left:   { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
  right:  { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR },
};

const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

function hCell(text: string, width?: number): TableCell {
  return new TableCell({
    borders: BORDER,
    shading: { type: ShadingType.CLEAR, color: "auto", fill: HEADER_BG },
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, size: 18, color: HEADER_FG, font: "Calibri" })],
    })],
  });
}

function cell(text: string, opts?: {
  bold?: boolean;
  align?: (typeof AlignmentType)[keyof typeof AlignmentType];
  color?: string;
  shading?: string;
}): TableCell {
  return new TableCell({
    borders: BORDER,
    shading: opts?.shading ? { type: ShadingType.CLEAR, color: "auto", fill: opts.shading } : undefined,
    margins: { top: 40, bottom: 40, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: opts?.align ?? AlignmentType.LEFT,
      children: [new TextRun({ text, size: 18, bold: opts?.bold, font: "Calibri", color: opts?.color })],
    })],
  });
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 300, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: ACCENT2, space: 4 } },
    children: [new TextRun({ text, bold: true, size: 24, font: "Calibri", color: ACCENT })],
  });
}

function subHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 20, font: "Calibri", color: ACCENT2 })],
  });
}

function textP(text: string, opts?: { bold?: boolean; color?: string; size?: number; indent?: number }): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    indent: opts?.indent ? { left: opts.indent } : undefined,
    children: [new TextRun({
      text,
      size: opts?.size ?? 20,
      font: "Calibri",
      bold: opts?.bold,
      color: opts?.color,
    })],
  });
}

function bulletP(text: string, opts?: { color?: string; bold?: boolean }): Paragraph {
  return new Paragraph({
    spacing: { after: 40 },
    indent: { left: 360, hanging: 180 },
    children: [
      new TextRun({ text: "• ", size: 20, font: "Calibri", color: ACCENT2 }),
      new TextRun({ text, size: 20, font: "Calibri", bold: opts?.bold, color: opts?.color }),
    ],
  });
}

/* ───── Markdown → DOCX conversion ───── */
function parseMarkdownToDocx(markdown: string): (Paragraph | Table)[] {
  const lines = markdown.split("\n");
  const elements: (Paragraph | Table)[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ─── Table detection ───
    if (line.includes("|") && i + 1 < lines.length && lines[i + 1]?.match(/^\|[\s\-:|]+\|/)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|")) {
        tableLines.push(lines[i]);
        i++;
      }

      const rows = tableLines
        .filter(l => !l.match(/^\|[\s\-:|]+\|$/))
        .map(l => l.split("|").map(c => c.trim()).filter(Boolean));

      if (rows.length > 0) {
        const headers = rows[0];
        const dataRows = rows.slice(1);
        const colCount = headers.length;
        const colWidth = Math.floor(100 / colCount);

        const headerRow = new TableRow({
          children: headers.map(h => hCell(cleanBold(h), colWidth)),
        });

        const bodyRows = dataRows.map((row, ri) =>
          new TableRow({
            children: row.map((cellText, ci) => {
              const cleaned = cleanBold(cellText);
              const isFirstCol = ci === 0;
              const hasWarning = cleaned.includes("⚠") || cleaned.includes("⛔") || cleaned.toLowerCase().includes("не соответст");
              const hasOk = cleaned.includes("✅") || cleaned.includes("✓") || cleaned.toLowerCase().includes("соответств");

              return cell(cleaned, {
                bold: isFirstCol,
                align: isFirstCol ? AlignmentType.LEFT : AlignmentType.CENTER,
                color: hasWarning ? RED : hasOk ? GREEN : undefined,
                shading: ri % 2 === 0 ? LIGHT_BG : undefined,
              });
            }),
          })
        );

        elements.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [headerRow, ...bodyRows],
        }));
      }
      continue;
    }

    // ─── Headers ───
    if (line.startsWith("### ")) {
      elements.push(subHeading(cleanBold(line.slice(4))));
    } else if (line.startsWith("## ")) {
      elements.push(sectionHeading(cleanBold(line.slice(3))));
    } else if (line.startsWith("# ")) {
      // Main title - already handled separately, but just in case
      elements.push(new Paragraph({
        spacing: { before: 200, after: 200 },
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: cleanBold(line.slice(2)), bold: true, size: 32, font: "Calibri", color: ACCENT })],
      }));
    }
    // ─── Bullet ───
    else if (line.startsWith("- ") || line.startsWith("* ")) {
      const bulletText = cleanBold(line.slice(2));
      const hasWarning = bulletText.includes("⚠") || bulletText.includes("⛔");
      const hasOk = bulletText.includes("✅") || bulletText.includes("✓");
      elements.push(bulletP(bulletText, {
        color: hasWarning ? RED : hasOk ? GREEN : undefined,
        bold: hasWarning,
      }));
    }
    // ─── Numbered list ───
    else if (line.match(/^\d+\.\s/)) {
      const num = line.match(/^(\d+)\.\s/)?.[1] || "";
      const rest = cleanBold(line.replace(/^\d+\.\s/, ""));
      elements.push(new Paragraph({
        spacing: { after: 40 },
        indent: { left: 360, hanging: 280 },
        children: [
          new TextRun({ text: `${num}. `, size: 20, font: "Calibri", bold: true, color: ACCENT }),
          new TextRun({ text: rest, size: 20, font: "Calibri" }),
        ],
      }));
    }
    // ─── Empty line ───
    else if (line.trim() === "") {
      elements.push(new Paragraph({ spacing: { after: 80 } }));
    }
    // ─── Regular text ───
    else {
      const cleaned = cleanBold(line);
      // Detect status/warning lines
      const hasWarning = cleaned.includes("⚠") || cleaned.includes("⛔") || cleaned.includes("ВНИМАНИЕ");
      const hasOk = cleaned.includes("✅") || cleaned.includes("✓");

      // Detect bold segments
      const runs = parseBoldRuns(line);
      if (runs.length > 1) {
        elements.push(new Paragraph({
          spacing: { after: 60 },
          children: runs.map(r => new TextRun({
            text: r.text,
            size: 20,
            font: "Calibri",
            bold: r.bold,
            color: hasWarning ? RED : hasOk ? GREEN : r.bold ? ACCENT : undefined,
          })),
        }));
      } else {
        elements.push(textP(cleaned, {
          bold: hasWarning,
          color: hasWarning ? RED : hasOk ? GREEN : undefined,
        }));
      }
    }
    i++;
  }

  return elements;
}

/** Strip markdown bold markers */
function cleanBold(text: string): string {
  return text.replace(/\*\*/g, "");
}

/** Parse bold segments from markdown */
function parseBoldRuns(text: string): { text: string; bold: boolean }[] {
  const runs: { text: string; bold: boolean }[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push({ text: text.slice(lastIndex, match.index), bold: false });
    }
    runs.push({ text: match[1], bold: true });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    runs.push({ text: text.slice(lastIndex), bold: false });
  }
  return runs.length === 0 ? [{ text, bold: false }] : runs;
}

/* ───── Main export ───── */
export async function exportAnalysisToDocx(reportMarkdown: string) {
  const children: (Paragraph | Table)[] = [];

  // ═══ Cover / Title ═══
  children.push(new Paragraph({ spacing: { before: 600 } }));

  // Decorative top line
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: ACCENT, space: 6 } },
    spacing: { after: 200 },
    children: [],
  }));

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: "ОТЧЁТ", bold: true, size: 40, font: "Calibri", color: ACCENT })],
  }));

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: "Подробный анализ качества цементирования", bold: true, size: 28, font: "Calibri", color: ACCENT2 })],
  }));

  // Decorative bottom line
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    border: { top: { style: BorderStyle.SINGLE, size: 3, color: ACCENT, space: 6 } },
    spacing: { after: 200 },
    children: [],
  }));

  // Attribution
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 40 },
    children: [new TextRun({ text: "Подготовлено системой DeAllsoft", size: 20, font: "Calibri", color: GRAY, italics: true })],
  }));

  const now = new Date();
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [new TextRun({
      text: `Дата формирования: ${now.toLocaleDateString("ru-RU")} ${now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`,
      size: 18,
      font: "Calibri",
      color: GRAY,
    })],
  }));

  // Page break after cover
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ═══ Report body ═══
  const bodyElements = parseMarkdownToDocx(reportMarkdown);
  children.push(...bodyElements);

  // ═══ Footer disclaimer ═══
  children.push(new Paragraph({ spacing: { before: 400 } }));
  children.push(new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 1, color: BORDER_CLR, space: 6 } },
    spacing: { after: 60 },
    children: [new TextRun({
      text: "Данный отчёт сформирован автоматически системой DeAllsoft и носит рекомендательный характер.",
      size: 16,
      font: "Calibri",
      color: GRAY,
      italics: true,
    })],
  }));
  children.push(new Paragraph({
    children: [new TextRun({
      text: "Окончательные решения должны приниматься квалифицированными специалистами с учётом всех факторов.",
      size: 16,
      font: "Calibri",
      color: GRAY,
      italics: true,
    })],
  }));

  // ═══ Build document ═══
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 20 },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 720, bottom: 720, left: 900, right: 900 },
        },
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  const fileName = `Анализ_цементирования_${now.toISOString().slice(0, 10)}.docx`;
  saveAs(blob, fileName);
}
