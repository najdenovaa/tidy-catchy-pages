import {
  AlignmentType, BorderStyle, Document, ImageRun, Packer, Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from "docx";
import { dataUrlToArrayBuffer } from "./capture-image";
import { saveAs } from "file-saver";
import type { LabProtocol, ProtocolTable } from "./lab-protocol";

const FONT = "Times New Roman";
/** Ширина набора A4 при полях 1000/700 twip */
const TEXT_W = 11906 - 1000 - 700;
const colWidths = (n: number, pct?: number[]) => {
  const p = pct && pct.length === n ? pct : Array(n).fill(100 / n);
  const sum = p.reduce((a, b) => a + b, 0);
  return p.map((x) => Math.round((x / sum) * TEXT_W));
};
const B = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const BORDERS = { top: B, bottom: B, left: B, right: B };
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

const run = (text: string, o: { bold?: boolean; size?: number; italics?: boolean } = {}) =>
  new TextRun({ text, font: FONT, size: o.size ?? 20, bold: o.bold, italics: o.italics });

const cell = (text: string, o: { bold?: boolean; header?: boolean; width?: number; size?: number } = {}) =>
  new TableCell({
    borders: BORDERS,
    width: o.width ? { size: o.width, type: WidthType.DXA } : undefined,
    shading: o.header ? { type: ShadingType.CLEAR, color: "auto", fill: "E7E6E6" } : undefined,
    margins: { top: 30, bottom: 30, left: 60, right: 60 },
    children: String(text).split("\n").map((line) => new Paragraph({ children: [run(line, { bold: o.bold || o.header, size: o.size ?? 18 })] })),
  });

function table(t: ProtocolTable): Table {
  const cw = colWidths(t.headers.length, t.widths);
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA },
    columnWidths: cw,
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ tableHeader: true, children: t.headers.map((h, i) => cell(h, { header: true, width: cw[i] })) }),
      ...t.rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, { width: cw[i] })) })),
    ],
  });
}

export async function exportLabProtocolDocx(p: LabProtocol, filename = "lab-protocol.docx", returnBlob = false): Promise<Blob | void> {
  const children: (Paragraph | Table)[] = [];
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run(p.title, { bold: true, size: 28 })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [run(p.subtitle, { size: 22 })] }));
  const mw = colWidths(2, [30, 70]);
  children.push(new Table({
    width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: mw, layout: TableLayoutType.FIXED,
    rows: p.meta.map((m) => new TableRow({ children: [cell(m.label, { bold: true, width: mw[0], size: 20 }), cell(m.value || " ", { width: mw[1], size: 20 })] })),
  }));
  children.push(new Paragraph({
    spacing: { before: 120, after: 120 },
    border: { top: B, bottom: B, left: B, right: B },
    children: [run(p.status, { italics: true, size: 18 })],
  }));
  for (const s of p.sections) {
    children.push(new Paragraph({ spacing: { before: 200, after: 80 }, keepNext: true, children: [run(s.title, { bold: true, size: 22 })] }));
    for (const para of s.paragraphs ?? []) children.push(new Paragraph({ spacing: { after: 60 }, children: [run(para)] }));
    for (const im of s.images ?? []) {
      const w = Math.min(620, im.widthPx), h = Math.round((im.heightPx / im.widthPx) * w);
      try {
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, children: [new ImageRun({ data: dataUrlToArrayBuffer(im.dataUrl), transformation: { width: w, height: h } })] }));
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [run(im.caption, { italics: true, size: 18 })] }));
      } catch { /* изображение не встроилось — пропускаем */ }
    }
    for (const t of s.tables ?? []) { children.push(table(t)); children.push(new Paragraph({ children: [] })); }
    for (const b of s.bullets ?? []) children.push(new Paragraph({ bullet: { level: 0 }, children: [run(b, { size: 18 })] }));
  }
  children.push(new Paragraph({ spacing: { before: 300 }, children: [] }));
  const sw = colWidths(3, [38, 37, 25]);
  children.push(new Table({
    width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: sw, layout: TableLayoutType.FIXED,
    rows: p.signatures.map((sg) => new TableRow({
      children: [sg.role, `____________________ ${sg.name}`, "«___» ________ 20__ г."].map((t, i) => new TableCell({
        borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
        width: { size: sw[i], type: WidthType.DXA },
        margins: { top: 120, bottom: 120 },
        children: [new Paragraph({ children: [run(t)] })],
      })),
    })),
  }));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{ properties: { page: { margin: { top: 850, bottom: 850, left: 1000, right: 700 } } }, children }],
  });
  const blob = await Packer.toBlob(doc);
  if (returnBlob) return blob;
  saveAs(blob, filename);
}
