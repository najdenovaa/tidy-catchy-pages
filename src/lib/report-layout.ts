import { AlignmentType, BorderStyle, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from "docx";
export const REPORT_PAGE = { width: 11906, height: 16838 };
export const REPORT_MARGINS = { top: 850, bottom: 850, left: 1000, right: 700 };
export const REPORT_TEXT_WIDTH = REPORT_PAGE.width - REPORT_MARGINS.left - REPORT_MARGINS.right;
export const reportPageProperties = () => ({ page: { size: REPORT_PAGE, margin: REPORT_MARGINS } });
export function reportColumns(n: number, weights?: number[]) {
  const w = weights?.length === n && weights.every(x => x > 0) ? weights : Array(n).fill(1);
  const sum = w.reduce((s, x) => s + x, 0);
  const cols = w.map(x => Math.floor(REPORT_TEXT_WIDTH * x / sum));
  cols[n - 1] += REPORT_TEXT_WIDTH - cols.reduce((s, x) => s + x, 0);
  return cols;
}
/** Explicit DXA grid is essential for mobile DOCX readers; percent-only tables can collapse. */
export function fixedReportTable(n: number, options: ConstructorParameters<typeof Table>[0], weights?: number[]) {
  return new Table({ ...options, width: { size: REPORT_TEXT_WIDTH, type: WidthType.DXA },
    columnWidths: reportColumns(n, weights), layout: TableLayoutType.FIXED });
}
const border = { style: BorderStyle.SINGLE, size: 4, color: "B8C2CC" };
export function reportDataTable(headers: string[], rows: (string | number)[][], weights?: number[]) {
  const widths = reportColumns(headers.length, weights);
  return fixedReportTable(headers.length, { rows: [headers, ...rows].map((row, i) => new TableRow({
    tableHeader: i === 0, cantSplit: true,
    children: headers.map((_, j) => new TableCell({ width: { size: widths[j], type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 75, right: 75 },
      borders: { top: border, bottom: border, left: border, right: border },
      children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [
        new TextRun({ text: String(row[j] ?? "").replace(/[—–]/g, "-"), bold: i === 0, font: "Calibri", size: 18 }),
      ] })] })),
  })) }, weights);
}
