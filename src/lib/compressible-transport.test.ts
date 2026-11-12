import {it,expect} from 'vitest';
import {simulateCompressibleTransport,transportInputKey} from './compressible-transport';
import {flowFixture} from '@/test/fixtures/compressible-flow';
it('runs a coupled closed mass budget across the assigned circulation schedule',()=>{
 const p=flowFixture(),r=simulateCompressibleTransport(p);expect(r.status,r.reason).toBe('complete');expect(r.frames.length).toBeGreaterThan(2);expect(r.maxStepRelativeResidual).toBeLessThan(1e-7);expect(r.profile).toHaveLength(4);
 for(const c of r.components)expect(Math.abs(c.residualKg)).toBeLessThan(.001);expect(r.components.find(c=>c.id==='cement:0').injectedKg).toBeCloseTo(11,8);
 expect(r.frames.at(-1).returnedReferenceM3).toBeGreaterThan(0);expect(r.frames.at(-1).pumpedReferenceM3).toBeGreaterThan(.01);expect(r.profile.some(c=>c.fractions.some(f=>f.massFraction>0&&f.massFraction<1))).toBe(true);
});
it('keeps service wash out of injected mass and preserves every accepted state on a stopped run',()=>{
 const p=flowFixture(),r=simulateCompressibleTransport({...p,flushTimeMin:.1,flushVolumeM3:5}),base=simulateCompressibleTransport(p);expect(r.status,r.reason).toBe('complete');expect(r.components.reduce((n,c)=>n+c.injectedKg,0)).toBeCloseTo(base.components.reduce((n,c)=>n+c.injectedKg,0),7);
 const invalid=flowFixture();invalid.wellData.stopStorage.bulkModuliMPa={};const stopped=simulateCompressibleTransport(invalid);expect(stopped.status).toBe('stopped');expect(stopped.reason).toContain('K');expect(stopped.frames).toEqual([]);
});
it('keys all relevant source inputs and settings without a short hash',()=>{
 const p=flowFixture(),key=transportInputKey(p);expect(transportInputKey({...p,wellData:{...p.wellData,stopStorage:{...p.wellData.stopStorage,flowStepSeconds:2}}})).not.toBe(key);
 expect(transportInputKey({...p,drillingFluid:{...p.drillingFluid,density:1200}})).not.toBe(key);
});
