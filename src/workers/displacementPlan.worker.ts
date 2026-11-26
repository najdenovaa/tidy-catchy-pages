import { calculatePressureProfile } from '../lib/cementing-calculations';
import { normalizeCementingSnapshot, type CementingSnapshot } from '../lib/cementing-normalizers';
import { buildProcessContract } from '../lib/cementing-process';
import { bufferPlanningDefaults } from '../lib/chemical-wash-recipes';
import { displacementLimitCurve } from '../lib/displacement-plan-chart';

self.onmessage = ({ data }: MessageEvent<{ input: CementingSnapshot; volumeM3: number }>) => {
  try {
    const input = normalizeCementingSnapshot(data.input);
    const well = { ...input.wellData, pressureObservation: undefined };
    const buffers = input.buffers.map(bufferPlanningDefaults);
    const process = buildProcessContract({ ...input, wellData: well, buffers }, data.volumeM3);
    const error = process.issues.find(issue => issue.severity === 'error');
    if (error) throw new Error(error.message);
    const pressure = calculatePressureProfile(well, input.slurries, buffers, input.drillingFluid,
      input.displacementFluids, input.fractureGradient, data.volumeM3, input.flushTimeMin, input.flushVolumeM3);
    const curve = displacementLimitCurve(pressure.points);
    if (!curve.length) throw new Error('В текущем сценарии нет расчётных точек продавки.');
    self.postMessage({ curve });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Не удалось рассчитать предел расхода.' });
  }
};
