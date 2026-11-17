import type { D2Result } from './displacement-2d';
import { reportSeriesPlot } from './report-series-plot';

export type HistoryResult = Pick<D2Result, 'nZ'|'nTheta'|'zCenters'|'gap'|'fluids'|'snapshots'>;
export const HISTORY_NOTE = 'Затрубье, объёмные доли с весом по ширине зазора. Доли сохранены с шагом 1/255 и нормированы внутри каждой ячейки, как цвета 3D. Точки соответствуют сохранённым кадрам; линии лишь соединяют отсчёты. Ноль времени - начало вытеснения в затрубье. Трубное пространство этим расчётом не определяется.';

/** Same quantized cell composition as makeBlender; no temporal or spatial interpolation. */
export function displacementDepthHistory(r: HistoryResult, requestedMD: number) {
  if (!r.nZ || !r.nTheta || !Number.isFinite(requestedMD)) return null;
  const z = r.zCenters;
  const dz = r.nZ > 1 ? z[1] - z[0] : 0;
  const top = z[0] - dz / 2, bottom = z[r.nZ - 1] + dz / 2;
  if (requestedMD < top || requestedMD > bottom) return null;
  // At an internal boundary choose the deeper cell, consistently for all outputs.
  const cell = r.nZ > 1 ? Math.min(r.nZ - 1, Math.floor((requestedMD - top) / dz)) : 0;
  const N = r.nZ * r.nTheta;
  const rows = r.snapshots.map((snapshot, frame) => {
    const fractions = r.fluids.map(() => 0);
    let totalWeight = 0, valid = true;
    for (let i = 0; i < r.nTheta; i++) {
      const k = cell * r.nTheta + i, weight = r.gap[k];
      if (!Number.isFinite(weight) || weight <= 0) { valid = false; break; }
      let sum = 0;
      for (let f = 0; f < fractions.length; f++) sum += snapshot.frac[f * N + k];
      if (!sum || !Number.isFinite(sum)) { valid = false; break; }
      for (let f = 0; f < fractions.length; f++) fractions[f] += weight * snapshot.frac[f * N + k] / sum;
      totalWeight += weight;
    }
    return { frame, timeS: snapshot.t, stage: snapshot.stage,
      fractions: fractions.map(x => valid && totalWeight > 0 ? x / totalWeight : null) };
  });
  return { requestedMD, cell, md: z[cell], topMD: z[cell] - dz / 2, bottomMD: z[cell] + dz / 2, rows };
}

export function displacementHistoryPlots(r: HistoryResult, colors: string[], md: number) {
  const history = displacementDepthHistory(r, md);
  if (!history) return [];
  // Keep legends and Word figures readable with many fluids.
  const plots = [];
  for (let start = 0; start < r.fluids.length; start += 5) {
    const plot = reportSeriesPlot(`Доли жидкостей в затрубье: MD ${history.md.toFixed(1)} м, жидкости ${start + 1}-${Math.min(start + 5, r.fluids.length)}`,
      'displacementHistory', history.rows.map(row => row.timeS / 60), 'Время вытеснения в затрубье, мин', 'Объёмная доля, %',
      r.fluids.slice(start, start + 5).map((fluid, offset) => ({ name: `${start + offset + 1}. ${fluid.name}`, color: colors[start + offset] ?? '#64748b',
        values: history.rows.map(row => row.fractions[start + offset] === null ? null : row.fractions[start + offset]! * 100) })),
      { plotId: `displacement-history-${start}`, note: HISTORY_NOTE });
    plots.push({...plot, sourceKey: JSON.stringify([history.md, history.rows, r.fluids.map(f=>f.name), colors, start])});
  }
  return plots;
}
