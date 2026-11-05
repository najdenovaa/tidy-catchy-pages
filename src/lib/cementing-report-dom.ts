import type { ReportSupplement } from "./cementing-report-data";
/** Supplementary calculated tables/text, not screenshots of mobile controls. Core report data has dedicated builders. */
const TITLES: Record<string, string> = {
  contact: "Время контакта технологических жидкостей", quality: "Качество замещения, газомиграция и целостность камня",
  torquedrag: "Спуск колонны: Torque & Drag", drillhydr: "Буровая гидравлика", rotation: "Вращение колонны",
  woc: "ОЗЦ: параметры активного расчёта", norms: "Проверки ограничений и норм", logistics: "Оснащение и логистика",
  skc: "Контроль процесса цементирования", optimizer: "Варианты оптимизации", lab: "Лабораторный подбор текущей программы",
};
const text = (node: Element) => {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll("button,svg,canvas,script,style,nav,[data-noexport]").forEach(x => x.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
};
export function collectCementingReportSupplements(root: ParentNode = document): ReportSupplement[] {
  const out: ReportSupplement[] = [];
  for (const [key, title] of Object.entries(TITLES)) {
    const el = root.querySelector('[data-tab-content="' + key + '"]');
    if (!el) continue;
    const paragraphs = [...new Set(Array.from(el.querySelectorAll("h2,h3,h4,p,li,label")).map(x => {
      const fields = Array.from(x.querySelectorAll("input,select")).map(f => (f as HTMLInputElement).value).filter(Boolean);
      return text(x) + (fields.length ? ": " + fields.join("; ") : "");
    }).filter(x => x.length > 3 && !/Нажмите.*(РАССЧ|рассч)|Загрузка|Рассчитать|Не рассчитан/i.test(x)))];
    if (paragraphs.some(x => /устарел|данные изменились|требует пересч|пересчитайте/i.test(x))) {
      out.push({ title, paragraphs: ["Результаты требуют пересчёта. Устаревшие числовые таблицы не включены."], tables: [] }); continue;
    }
    const tables = Array.from(el.querySelectorAll("table")).map(table => {
      const rows = Array.from(table.querySelectorAll("tr")).map(row => Array.from(row.querySelectorAll("th,td")).map(text));
      const columns = Math.max(0, ...rows.map(r => r.length));
      return { headers: (rows.shift() ?? []).concat(Array(columns).fill("")).slice(0, columns),
        rows: rows.map(row => row.concat(Array(columns).fill("")).slice(0, columns)) };
    }).filter(t => t.headers.length > 0 && t.rows.length > 0);
    if (paragraphs.length || tables.length) out.push({ title, paragraphs, tables });
  }
  return out;
}
