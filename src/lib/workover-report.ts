/** Печатный отчёт по расчётам КРС: HTML в новом окне → «Печать» → «Сохранить как PDF». */

export interface ReportSection {
  title: string;
  rows: [string, string][];
  warnings?: string[];
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildWorkoverReportHtml(title: string, sections: ReportSection[]): string {
  const date = new Date().toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const body = sections.map((s) => `
    <section>
      <h2>${esc(s.title)}</h2>
      <table>${s.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
      ${s.warnings && s.warnings.length ? `<ul>${s.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}
    </section>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;margin:24px;font-size:12px}
  h1{font-size:18px;margin:0 0 4px} .meta{color:#666;margin-bottom:16px}
  h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
  table{width:100%;border-collapse:collapse} td{padding:3px 6px;border-bottom:1px solid #eee;vertical-align:top}
  td:first-child{width:45%;color:#333} td:last-child{text-align:right;font-weight:600}
  ul{margin:6px 0 0 16px;padding:0;color:#7a4a00} li{margin:2px 0}
  section{break-inside:avoid}
  .foot{margin-top:24px;color:#888;font-size:10px}
  @media print{body{margin:12mm}}
</style></head><body>
<h1>${esc(title)}</h1>
<div class="meta">DeAllsoft · Инженерные расчёты · КРС · ${esc(date)}</div>
${body}
<div class="foot">Результаты носят информационный характер и должны проверяться ответственным инженером по паспортам оборудования и действующим нормативам.</div>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`;
}

export function openWorkoverReport(title: string, sections: ReportSection[]): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(buildWorkoverReportHtml(title, sections));
  w.document.close();
  return true;
}
