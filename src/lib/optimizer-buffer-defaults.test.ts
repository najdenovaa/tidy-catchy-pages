import {it,expect} from 'vitest';
import {qualityInput,qualitySettings} from './__tests__/fixtures/optimizer-cleaning-fixture';
import {runOptimizer,applyVariant} from './cement-optimizer';
import {applyChemicalRecipe,WASH_RECIPES,bufferPlanningDefaults} from './chemical-wash-recipes';
import {cleaningInputKey,prepareCleaningProgram} from './optimizer-cleaning';
const settings={...qualitySettings,minRateLps:30,maxRateLps:30,maxCementRateLps:30,optimizeCentralizers:false};
it('unchecked buffer selection bypasses chemistry/laboratory requirements and quality preparation',async()=>{
 const p=qualityInput();p.drillingFluid.base='oil';
 p.buffers[0]=applyChemicalRecipe(p.buffers[0],WASH_RECIPES.find(x=>x.id==='obm-mes-solvent')!,{},p.drillingFluid);
 // A project saved by the previous release: missing water/protocol and deliberately zeroed PV/YP.
 p.buffers[0].rheology={pv:0,yp:0,model:'pvyp'};
 const before=JSON.stringify(p),r=await runOptimizer(p,{...settings,optimizeBuffer:false});
 expect(r.highQuality).toBeUndefined();expect(r.best.length).toBeGreaterThan(0);
 expect(r.bufferOptions).toHaveLength(1);expect(r.best[0].ev.variant.bufferDensity).toBeNull();
 expect(r.planningNotes?.join(' ')).toContain('стартовыми');
 const applied=applyVariant(p.buffers,p.slurries,p.displacementFluids,r.best[0].ev.variant);
 expect(applied.buffers[0].rheology.pv).toBe(20);expect(applied.buffers[0].chemicalRecipe?.propertySignature).toBeUndefined();
 expect(JSON.stringify(p)).toBe(before);
});
it('calculates with no buffers when their selection is disabled, without demanding a cleaning interval',async()=>{
 const p=qualityInput();p.buffers=[];p.wellData.reservoirLayers=[];
 const r=await runOptimizer(p,{...settings,optimizeBuffer:false});
 expect(r.highQuality).toBeUndefined();expect(r.evaluations).toHaveLength(1);expect(p.buffers).toEqual([]);
});
it('automatically builds and applies a computable planning scenario without chemical properties or removal tests',async()=>{
 const p=qualityInput();p.buffers=[];const before=JSON.stringify(p);
 const r=await runOptimizer(p,{...settings,optimizeBuffer:true});
 expect(r.highQuality?.ready).toBe(true);expect(r.highQuality?.design?.proof).toBeUndefined();
 expect(r.highQuality?.sourceKey).toBe(cleaningInputKey(p));
 expect(r.highQuality?.program?.buffers.map(b=>b.bufferType)).toEqual(['chemical_wash','weighted']);
 expect(r.highQuality?.program?.buffers[0].additives[0].percentage).toBe(.5);
 expect(r.highQuality?.program?.buffers[0].rheology.pv).toBe(20);
 expect(r.highQuality?.warnings.join(' ')).toContain('водная основа');
 expect(JSON.stringify(p)).toBe(before);
},60000);
it('preserves user-edited properties and uses the selected mud base for automatic chemistry',()=>{
 const p=qualityInput(),b={...p.buffers[0],density:1150,rheology:{pv:33,yp:7,model:'pvyp' as const}};
 expect(bufferPlanningDefaults(b)).toBe(b);p.buffers=[b,p.buffers[1]];
 expect(prepareCleaningProgram(p).program.buffers[0]).toBe(b);
 p.drillingFluid.base='oil';p.buffers=[];
 expect(prepareCleaningProgram(p).program.buffers[0].chemicalRecipe?.id).toBe('obm-mes-solvent');
});
