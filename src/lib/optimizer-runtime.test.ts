// @vitest-environment node
import {expect,it} from 'vitest';
import {runOptimizer} from './cement-optimizer';
import {qualityInput,qualitySettings} from './__tests__/fixtures/optimizer-cleaning-fixture';
import {longOptimizerFixture} from './__tests__/fixtures/optimizer-long-fixture';
import {optimizerHardwareCatalog} from './optimizer-hardware';
it('does not return unconfirmed preliminary candidates after a zero runtime budget',async()=>{
 const r=await runOptimizer(qualityInput(),qualitySettings,undefined,optimizerHardwareCatalog(),{timeBudgetMs:0,now:()=>0});
 expect(r.best).toEqual([]);expect(r.blocker).toContain('лимит времени');
});
it('returns only completed native confirmations when the search budget expires at 85%',async()=>{
 let expired=false;
 const r=await runOptimizer(qualityInput(),{...qualitySettings,minRateLps:30,maxRateLps:30,maxCementRateLps:30},(done,total)=>{if(done/total>=.85)expired=true;},optimizerHardwareCatalog(),{timeBudgetMs:10000,now:()=>expired?10000:0});
 expect(r.best.length,r.blocker).toBeGreaterThan(0);
 expect(r.best.every(x=>x.complete&&x.ev.feasible&&x.ev.violations.length===0)).toBe(true);
 expect(r.planningNotes.join(' ')).toContain('ограничен по времени');
},60000);
it('confirms complete programs on a 6000 m string without report-only hydraulic work',async()=>{
 const {input,settings}=longOptimizerFixture(),started=performance.now();
 const r=await runOptimizer(input,settings,undefined,optimizerHardwareCatalog(),{timeBudgetMs:60000});
 console.log('LONG_OPTIMIZER',JSON.stringify({depth:input.wellData.casingDepthMD,ms:Math.round(performance.now()-started),best:r.best.length,tools:r.best.map(x=>x.complete?.program.wellData.turbulatorDesign.points.length)}));
 expect(r.best.length,r.blocker).toBeGreaterThan(0);
 expect(r.best.every(x=>x.complete&&x.ev.feasible)).toBe(true);
},120000);
