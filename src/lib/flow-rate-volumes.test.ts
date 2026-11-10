import { describe, it, expect } from 'vitest';
import { resolveFlowRateSteps, slurryDesignVolume, calculateVolumes, calculateMaterials, buildDisplacementSchedule } from './cementing-calculations';
import { getCementingExample } from './cementing-example';
import { normalizeCementingSnapshot } from './cementing-normalizers';

describe('Automatic pumping volumes', () => {
  it('tracks volume and splits only the remaining part without mutating manual modes', () => {
    const steps = [{rateLps: 5, volumeM3: 2, volumeMode: 'manual' as const}, {rateLps: 8, volumeM3: 0}];
    expect(resolveFlowRateSteps(steps, 10).map(s => s.volumeM3)).toEqual([2, 8]);
    expect(resolveFlowRateSteps(steps, 15).map(s => s.volumeM3)).toEqual([2, 13]);
    expect(steps[1].volumeM3).toBe(0);
    expect(resolveFlowRateSteps([{rateLps:5, volumeM3:0, volumeMode:'manual'}], 10)[0].volumeM3).toBe(0);
  });
  it('keeps manual shortages and excesses for the red balance, including legacy positive values', () => {
    expect(resolveFlowRateSteps([{rateLps:5,volumeM3:12}], 10)[0].volumeM3).toBe(12);
    expect(resolveFlowRateSteps([{rateLps:5,volumeM3:2}], 10)[0].volumeM3).toBe(2);
    expect(resolveFlowRateSteps([{rateLps:5,volumeM3:99,volumeMode:'auto'}], 10)[0].volumeM3).toBe(10);
  });
  it('recalculates the upper slurry when the lower interval changes, with wash, shoe track and rathole', () => {
    const s = getCementingExample();
    s.wellData.wellDepthMD = s.wellData.casingDepthMD + 20;
    s.slurries.forEach(v => v.flowRateSteps = [{rateLps:5,volumeM3:0,volumeMode:'auto'}]);
    s.slurries[0].washVolume = 3;
    const check = () => {
      const v = calculateVolumes(s.wellData, s.slurries);
      s.slurries.forEach((_, i) => expect(slurryDesignVolume(s.wellData,s.slurries,i)).toBeCloseTo(v.slurryVolumes[i].slurryVolumeM3, 8));
      expect(v.warnings.filter(w => w.message.includes('Дефицит'))).toEqual([]);
      return v.totalSlurryVolume;
    };
    check();
    const before = slurryDesignVolume(s.wellData,s.slurries,0);
    s.slurries[1].topDepthMD -= 100;
    check();
    expect(slurryDesignVolume(s.wellData,s.slurries,0)).toBeLessThan(before);
    const mats = calculateMaterials(s.slurries,s.buffers,s.wellData);
    expect(mats.cementItems.filter(x => x.unit === 'т').reduce((n,x) => n+x.amount,0)).toBeCloseTo(calculateVolumes(s.wellData,s.slurries).slurryVolumes.reduce((n,x)=>n+x.dryMassTons,0),8);
  });
  it('persists auto/manual through saving and loading', () => {
    const s = getCementingExample();
    s.slurries[0].flowRateSteps = [{rateLps:5,volumeM3:0,volumeMode:'auto'}, {rateLps:2,volumeM3:0,volumeMode:'manual'}];
    expect(normalizeCementingSnapshot(JSON.parse(JSON.stringify(s))).slurries[0].flowRateSteps).toEqual(s.slurries[0].flowRateSteps);
  });
  it('distributes displacement remainder globally across portions, preserving the entered portion', () => {
    const df = getCementingExample().displacementFluids[0];
    const portions = [{...df,flowRateSteps:[{rateLps:5,volumeM3:3,volumeMode:'manual' as const}]}, {...df,flowRateSteps:[{rateLps:2,volumeM3:0,volumeMode:'auto' as const}]}];
    expect(buildDisplacementSchedule(portions, 10).map(x=>x.volumeM3)).toEqual([3,7]);
    expect(buildDisplacementSchedule(portions, 20).map(x=>x.volumeM3)).toEqual([3,17]);
    expect(portions[0].flowRateSteps[0].volumeM3).toBe(3);
  });
});
