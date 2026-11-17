import {timingRows,type DisplacementTimingStats} from './displacement-timing';
import * as XLSX from 'xlsx';
import { displacementDepthHistory, HISTORY_NOTE, type HistoryResult } from './displacement-depth-history';
export function displacementHistoryWorkbook(r: HistoryResult & {summary?:{timing?:DisplacementTimingStats}}, md: number, selectedFrame: number, annulusStartS: number) {
  const h = displacementDepthHistory(r, md);
  if (!h) throw new Error('Глубина вне расчётного затрубного интервала');
  const w = XLSX.utils.book_new();
  const rows = [['Кадр (с 0)', 'Время вытеснения, с', 'Время от начала закачки, с', 'MD центра ячейки, м', ...r.fluids.map((f,i) => `${i+1}. ${f.name}, %`)],
    ...h.rows.map(row => [row.frame, row.timeS, annulusStartS + row.timeS, h.md, ...row.fractions.map(v => v === null ? null : v * 100)])];
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet(rows), 'Доли во времени');
  XLSX.utils.book_append_sheet(w, XLSX.utils.aoa_to_sheet([
    ['Параметр', 'Значение'], ['Запрошенная MD, м', md], ['Граница ячейки сверху, м', h.topMD], ['Граница ячейки снизу, м', h.bottomMD],
    ['Выбранный кадр (с 0)', selectedFrame], ['Смещение начала вытеснения, с', annulusStartS], ['Метод', HISTORY_NOTE],
    ...timingRows({maxTimeStepS:r.summary?.timing?.requestedMaxStepS??undefined,frameIntervalS:r.summary?.timing?.requestedFrameIntervalS??undefined},r.summary?.timing),
    ['Пустые значения', 'Недопустимая или отсутствующая запись состава; не заменяется нулём.'],
  ]), 'Условия');
  return w;
}
