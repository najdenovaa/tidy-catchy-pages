// @vitest-environment node
import { it, expect } from 'vitest';
import { qualityInput, qualitySettings } from './__tests__/fixtures/optimizer-cleaning-fixture';
import { runOptimizer } from './cement-optimizer';
import { optimizerHardwareCatalog } from './optimizer-hardware';
import { buildProcessContract } from './cementing-process';
import { turbulatorGeometryErrors } from './turbulator-flow';
it('finds a safe complete program with catalogue tools and a mixing limit below displacement rate',async()=>{
 const input=qualityInput(),before=JSON.stringify(input);
 const result=await runOptimizer(input,{...qualitySettings,maxCementRateLps:20},undefined,optimizerHardwareCatalog());
 expect(result.best.length,result.blocker).toBeGreaterThan(0);
 expect(result.blocker).toBeUndefined();
 for(const item of result.best){
  const plan=item.complete!;
  expect(item.ev.feasible).toBe(true);
  expect(item.ev.violations).toEqual([]);
  const contract=buildProcessContract(plan.program);
  expect(contract.canRun).toBe(true);
  expect(contract.stages.filter(s=>s.kind==='buffer'||s.kind==='cement').every(s=>s.rateLps<=20)).toBe(true);
  expect(plan.program.wellData.turbulatorDesign.points.length).toBeGreaterThan(0);
  expect(plan.program.wellData.turbulatorDesign.points.every(t=>turbulatorGeometryErrors(plan.program.wellData,t).length===0)).toBe(true);
 }
 expect(JSON.stringify(input)).toBe(before);
},120000);
it('retains a safe quality program when the optional turbulent buffer boost cannot be achieved',async()=>{
 const input=qualityInput();input.buffers[1].rheology={pv:100,yp:40};
 const result=await runOptimizer(input,{...qualitySettings,minRateLps:10,maxRateLps:10,maxCementRateLps:10},undefined,optimizerHardwareCatalog());
 expect(result.best.length,result.blocker).toBeGreaterThan(0);
 expect(result.best.every(x=>x.ev.feasible&&!x.complete!.record.bufferBoost)).toBe(true);
 expect(result.planningNotes.join(' ')).toContain('не подтверждено');
},120000);
it('explains missing compatible tools without rejecting safe centralization and hydraulics',async()=>{
 const catalog=optimizerHardwareCatalog();catalog.turbulators=[];
 const result=await runOptimizer(qualityInput(),{...qualitySettings,minRateLps:30,maxRateLps:30},undefined,catalog);
 expect(result.best.length,result.blocker).toBeGreaterThan(0);
 expect(result.best.every(x=>x.ev.feasible&&x.complete!.record.hardware.every(h=>h.kind==='centralizer'))).toBe(true);
 expect(result.planningNotes.join(' ')).toContain('нет подходящего турбулизатора');
},120000);
