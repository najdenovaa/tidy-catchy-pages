import { AlignmentType, BorderStyle, Document, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType, ShadingType } from "docx";
import { saveAs } from "file-saver";
import type { SkcAnalysis } from "./skc-analysis";

const FONT = "Times New Roman";
const W = 11906 - 1000 - 700;
const B = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const run = (t: string, o: { bold?: boolean; size?: number; italics?: boolean } = {}) => new TextRun({ text: t, font: FONT, size: o.size ?? 20, bold: o.bold, italics: o.italics });
const table = (headers: string[], rows: string[][], pct: number[]) => {
  const sum = pct.reduce((a, b) => a + b, 0);
  const cw = pct.map((p) => Math.round((p / sum) * W));
  const cell = (t: string, i: number, h = false) => new TableCell({
    borders: { top: B, bottom: B, left: B, right: B }, width: { size: cw[i], type: WidthType.DXA },
    shading: h ? { type: ShadingType.CLEAR, color: "auto", fill: "E7E6E6" } : undefined,
    margins: { top: 30, bottom: 30, left: 60, right: 60 },
    children: [new Paragraph({ children: [run(t, { bold: h, size: 18 })] })],
  });
  return new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: cw, layout: TableLayoutType.FIXED,
    rows: [new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, i, true)) }), ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, i)) }))],
  });
};
const LEVEL: Record<string, string> = { critical: "КРИТИЧНО", warning: "Внимание", info: "Инфо", ok: "Норма" };
const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d).replace(".", ","));

export async function exportSkcReportDocx(a: SkcAnalysis, meta: { well: string; fileName: string }, returnBlob = false): Promise<Blob | void> {
  const ch: (Paragraph | Table)[] = [];
  ch.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [run("ОТЧЁТ ПО КОНТРОЛЮ ЦЕМЕНТИРОВАНИЯ", { bold: true, size: 28 })] }));
  ch.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [run("сравнение записи станции контроля с расчётом программы", { size: 22 })] }));
  ch.push(table(["Параметр", "Значение"], [
    ["Скважина / колонна", meta.well || "—"],
    ["Файл записи СКЦ", meta.fileName || "—"],
    ["Дата отчёта", new Date().toLocaleDateString("ru-RU")],
    ["Совмещение записи с расчётом", `${a.offsetSource}, смещение ${f(a.offsetM3)} м³`],
    ["Калибровочный множитель трения k", `${f(a.calibration.kFriction)} (${a.calibration.window}; СКО ${f(a.calibration.rmsBefore)} → ${f(a.calibration.rmsAfter)} МПа)`],
    ["СКО давления по всей операции после калибровки, МПа", f(a.rmsResidualMPa)],
    ["Посадка пробки «СТОП»", a.plug.detected ? `${f(a.plug.displacementFactM3)} м³ продавки при расчётных ${f(a.plug.displacementPlanM3)} (${f(a.plug.deviationPct, 1)}%)` : "не обнаружена"],
    ["Оценка верха цемента", a.tocEstimate ? `${f(a.tocEstimate.estimatedTopMD, 0)} м (проект ${f(a.tocEstimate.plannedTopMD, 0)} м; по «подъёмному» давлению)` : "—"],
  ], [45, 55]));
  ch.push(new Paragraph({ spacing: { before: 200, after: 80 }, children: [run("Выявленные события", { bold: true, size: 22 })] }));
  ch.push(table(["Уровень", "Событие", "Подробности"], a.events.map((e) => [LEVEL[e.level], e.title, e.detail]), [12, 30, 58]));
  ch.push(new Paragraph({ spacing: { before: 200, after: 80 }, children: [run("Тампонажные растворы", { bold: true, size: 22 })] }));
  ch.push(table(["Раствор", "Плотность проект / факт, г/см³", "Вне допуска ±0,02, м³", "Объём план / факт, м³"],
    a.cement.map((c) => [c.name, `${f(c.planDensity)} / ${f(c.meanDensity, 3)}`, f(c.outOfSpecM3, 1), `${f(c.volumePlanM3, 1)} / ${f(c.volumeFactM3, 1)}`]), [25, 30, 20, 25]));
  ch.push(new Paragraph({ spacing: { before: 160 }, children: [run("Оценки верха цемента и мест поглощения получены расчётом по давлению на устье и требуют подтверждения геофизикой (АКЦ, термометрия).", { italics: true, size: 18 })] }));
  const doc = new Document({ styles: { default: { document: { run: { font: FONT, size: 20 } } } }, sections: [{ properties: { page: { margin: { top: 850, bottom: 850, left: 1000, right: 700 } } }, children: ch }] });
  const blob = await Packer.toBlob(doc);
  if (returnBlob) return blob;
  saveAs(blob, "Отчёт_контроль_цементирования.docx");
}
