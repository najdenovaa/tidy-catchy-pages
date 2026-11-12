import {describe,it,expect} from 'vitest';
import {FluidInventory} from './fluid-inventory';
const mud={fluidId:'mud',fluidType:'mud' as const,densityGcm3:1.1};
const cement={fluidId:'cement',fluidType:'cement' as const,densityGcm3:1.85};
const water={fluidId:'water',fluidType:'displacement' as const,densityGcm3:1};
describe('conservative fixed-density transport',()=>{
 it('matches hand-calculated breakthrough and return mass, without confusing same-name fluids',()=>{
  const x=new FluidInventory(10,5,mud);x.pump(cement,12);
  const a=x.summary();expect(a.fluids.find(f=>f.fluidId==='cement')).toMatchObject({pipeM3:10,annulusM3:2,returnedM3:0});
  expect(a.fluids.find(f=>f.fluidId==='mud')).toMatchObject({pipeM3:0,annulusM3:3,returnedM3:12});expect(a.returnedMassKg).toBeCloseTo(13200,6);
  x.pump(water,5);const b=x.summary();expect(b.fluids.find(f=>f.fluidId==='cement')).toMatchObject({pipeM3:5,annulusM3:5,returnedM3:2});expect(b.fluids.find(f=>f.fluidId==='water').pipeM3).toBe(5);expect(b.maxResidualKg).toBeLessThan(1e-7);
 });
 it('drains existing liquid and refills a void before producing further returns',()=>{
  const x=new FluidInventory(10,5,mud);x.pump(cement,4);x.freefall(3);const a=x.summary();expect(a.injectedM3).toBe(4);expect(a.returnedM3).toBe(7);expect(a.pipeVoidM3).toBe(3);
  expect(x.pump(water,2).returnedM3).toBe(0);expect(x.pipeVoidM3).toBe(1);expect(x.pump(water,2).returnedM3).toBe(1);expect(x.pipeVoidM3).toBe(0);expect(x.summary().maxResidualM3).toBeLessThan(1e-10);
 });
 it('is independent of step partition, including a partial catch-up step',()=>{
  const a=new FluidInventory(10,5,mud),b=a.clone();a.pump(cement,12);a.freefall(3);a.pump(water,7);
  for(let i=0;i<120;i++)b.pump(cement,.1);for(let i=0;i<30;i++)b.freefall(.1);for(let i=0;i<70;i++)b.pump(water,.1);
  const x=a.summary(),y=b.summary();expect(y.returnedM3).toBeCloseTo(x.returnedM3,9);expect(y.returnedMassKg).toBeCloseTo(x.returnedMassKg,6);
  for(const f of x.fluids){const g=y.fluids.find(g=>g.fluidId===f.fluidId);for(const key of ['pipeM3','annulusM3','returnedM3'] as const)expect(g[key]).toBeCloseTo(f[key],9);}
 });
 it('keeps equilibrium trials isolated and never drains more liquid than exists',()=>{
  const x=new FluidInventory(10,5,mud),trial=x.clone();trial.freefall(100);expect(trial.pipeVoidM3).toBe(10);expect(x.summary().returnedM3).toBe(0);expect(x.pipeVoidM3).toBe(0);expect(trial.summary().maxResidualKg).toBe(0);
 });
 it('rejects invalid capacities, volume, density and ID property changes',()=>{
  expect(()=>new FluidInventory(0,5,mud)).toThrow();const x=new FluidInventory(10,5,mud);expect(()=>x.freefall(-1)).toThrow();expect(()=>x.pump(cement,NaN)).toThrow();expect(()=>x.pump({...cement,densityGcm3:0},1)).toThrow();expect(()=>x.pump({...mud,densityGcm3:2},1)).toThrow();expect(x.summary().injectedM3).toBe(0);
 });
});
