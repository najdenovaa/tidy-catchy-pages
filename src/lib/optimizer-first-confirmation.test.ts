// @vitest-environment node
import {expect,it} from 'vitest';
import {qualityInput,qualitySettings} from './__tests__/fixtures/optimizer-cleaning-fixture';
import {runOptimizer,placeForStandoff} from './cement-optimizer';
import {compatibleHardware,optimizerHardwareCatalog} from './optimizer-hardware';
import {calculateTVDFromSurvey} from './cementing-calculations';
import {calculateCentralization,createCentralizationContext} from './centralization-calculations';
it('reuses dense survey mechanics exactly across products, densities and target trials',()=>{
 const p=qualityInput(),w={...p.wellData,trajectory:calculateTVDFromSurvey(Array.from({length:125},(_,i)=>({md:i*5,zenith:30+15*Math.sin(i/25),azimuth:20+i/3,tvd:0})))};
 const spec=compatibleHardware(w,optimizerHardwareCatalog()).centralizers[0].spec,memo=createCentralizationContext(w,p.drillingFluid.density);
 const trials={context:memo,above:new Map(),minima:new Map()};
 for(const target of [67,75,85]){
  const cached=placeForStandoff(w,spec,12,target,p.drillingFluid.density,250,trials),plain=placeForStandoff(w,spec,12,target,p.drillingFluid.density,250);
  expect(cached).toEqual(plain);
  expect(calculateCentralization(w,cached,p.drillingFluid.density,undefined,undefined,undefined,undefined,memo)).toEqual(calculateCentralization(w,cached,p.drillingFluid.density));
  expect(calculateCentralization(w,cached,1300,undefined,undefined,undefined,undefined,memo)).toEqual(calculateCentralization(w,cached,1300));
 }
});
it('publishes a fully checked complete program before the grid is finished and retains it when time expires',async()=>{
 const input=qualityInput(),before=JSON.stringify(input),events:string[]=[];let stopped=false;
 const result=await runOptimizer(input,{...qualitySettings,minRateLps:30,maxRateLps:30,maxCementRateLps:30},()=>events.push('grid'),optimizerHardwareCatalog(),{
  timeBudgetMs:10000,now:()=>stopped?10000:0,onConfirmed:r=>{
   events.push('confirmed');expect(r.best.length).toBeGreaterThan(0);
   expect(r.best.every(x=>x.complete&&x.ev.feasible&&x.ev.violations.length===0)).toBe(true);stopped=true;
  },
 });
 expect(events[0]).toBe('confirmed');expect(result.best.length,result.blocker).toBeGreaterThan(0);expect(result.blocker).toBeUndefined();expect(JSON.stringify(input)).toBe(before);
},60000);
