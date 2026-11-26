import { describe, expect, it } from 'vitest';
import { calculatePressureProfile, calculateVolumes, type PressurePoint } from './cementing-calculations';
import { getCementingExample } from './cementing-example';
import { displacementLimitCurve, displacementPlanStages, displacementStageLimit } from './displacement-plan-chart';

describe('displacement input chart', () => {
  it('uses the hydraulic schedule rules for automatic volume and cumulative time', () => {
    const [fluid] = getCementingExample().displacementFluids;
    const steps = displacementPlanStages([
      { ...fluid, name: 'First', flowRateSteps: [{ rateLps: 4, volumeM3: 6, volumeMode: 'manual' }] },
      { ...fluid, name: 'Last', flowRateSteps: [{ rateLps: 2, volumeM3: 0, volumeMode: 'auto' }] },
    ], 9);
    expect(steps).toMatchObject([
      { name: 'First', fromM3: 0, toM3: 6, rateLps: 4, endMin: 25 },
      { name: 'Last', fromM3: 6, toM3: 9, rateLps: 2, endMin: 50 },
    ]);
  });

  it('subtracts pre-displacement volume, excludes stop spikes and retains zero limits', () => {
    const frame = (processKind: PressurePoint['processKind'], cumulativeVolume: number, maxSafeRateLps: number) =>
      ({ processKind, cumulativeVolume, maxSafeRateLps, fracturePressure: 20 }) as PressurePoint;
    const line = displacementLimitCurve([
      frame('cement', 20, 10), frame('surfaceFlush', 20, 8),
      frame('displacement', 21, 0), frame('displacement', 23, 12), frame('postStop', 23, 50),
    ]);
    expect(line).toEqual([{ volumeM3: 0, rateLps: 8 }, { volumeM3: 1, rateLps: 0 }, { volumeM3: 3, rateLps: 12 }]);
    const stage = { key: 'first', name: 'First', fromM3: 0, toM3: 3, rateLps: 7, endMin: 8 };
    expect(displacementStageLimit(stage, line, .8, 6)).toBe(0);
    expect(displacementStageLimit({ ...stage, fromM3: 4, toM3: 5 }, line)).toBeNull();
    expect(displacementStageLimit({ ...stage, fromM3: 2, toM3: 3 }, line, .5, 2)).toBe(2);
  });

  it('uses the current solver points through modelled plug landing without extending the curve into volume reserve', () => {
    const example = getCementingExample();
    const fluids = example.displacementFluids.map((f, index) => ({ ...f, compressionCoeff: index ? 1 : 1.07 }));
    const volumes = calculateVolumes(example.wellData, example.slurries, 1.07);
    const pressure = calculatePressureProfile(example.wellData, example.slurries, example.buffers, example.drillingFluid,
      fluids, example.fractureGradient, volumes.displacementVolumeWithCompression, example.flushTimeMin, example.flushVolumeM3);
    const data = displacementLimitCurve(pressure.points);
    expect(data.length).toBeGreaterThan(2);
    expect(data[0].volumeM3).toBeCloseTo(0);
    expect(data.at(-1)?.volumeM3).toBeCloseTo(volumes.displacementVolume);
    expect(data.at(-1)?.volumeM3).toBeLessThan(volumes.displacementVolumeWithCompression);
  });
});
