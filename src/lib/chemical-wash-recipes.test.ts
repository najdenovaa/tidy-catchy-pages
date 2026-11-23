import {it,expect} from 'vitest';
import {WASH_RECIPES,recipeBatch,applyChemicalRecipe,confirmChemicalProperties,chemicalRecipeIssue,chemicalPropertySignature} from './chemical-wash-recipes';
import {qualityInput,withQualityProof,qualitySettings} from './__tests__/fixtures/optimizer-cleaning-fixture';
import {normalizeCementingSnapshot,normalizeBufferFluid} from './cementing-normalizers';
import {labFluids,removalIssue} from './fluid-interaction-lab';
import {emptyFluidLibrary,fluidProperties,saveFluidRevision,applyFluidRevision,parseFluidLibrary} from './fluid-library';
import {qualityCentralizerPlan,evaluateProgram} from './cement-optimizer';
import {buildHighQualityScenario} from './optimizer-cleaning';
const recipe=WASH_RECIPES.find(x=>x.id==='obm-mes-solvent')!;
function measured(){
 const p=qualityInput(),mud={...p.drillingFluid,base:'oil' as const};
 let b=applyChemicalRecipe(p.buffers[0],recipe,{},mud);
 b={...b,rheology:{pv:20,yp:5,model:'pvyp',testTemperatureC:40,testPressureMPaAbs:5},chemicalRecipe:{...b.chemicalRecipe!,waterSource:'Вода лабораторная, минерализация измерена 0,2 г/л'}};
 return {p,mud,b:confirmChemicalProperties(b,'Плотность и Fann, протокол P1')};
}
it('uses product mass percentages with an exact batch balance, not percent active matter or a predicted washing efficiency',()=>{
 const x=recipeBatch(recipe,{},1000);
 expect(x.rows.map(r=>r.massKg)).toEqual([.5,5,20]);
 expect(x.baseMassKg).toBe(974.5);
 expect(x.rows.reduce((n,r)=>n+r.massKg,x.baseMassKg)).toBe(1000);
 expect(()=>recipeBatch(recipe,{'wash-mes':99,'wash-dpm':2},1000)).toThrow('Сумма');
 expect(()=>recipeBatch(recipe,{},0)).toThrow('Масса');
});
it('does not infer a mud base or carry measurements from the old recipe',()=>{
 const p=qualityInput();expect(()=>applyChemicalRecipe(p.buffers[0],recipe,{},p.drillingFluid)).toThrow('основу');
 expect(()=>applyChemicalRecipe(p.buffers[0],recipe,{}, {...p.drillingFluid,base:'water'})).toThrow('основу');
 const b=applyChemicalRecipe(p.buffers[0],recipe,{}, {...p.drillingFluid,base:'oil'});
 expect(b.rheology.pv).toBe(20);expect(b.rheology.testTemperatureC).toBe(40);
 expect(b.chemicalRecipe?.propertySignature).toBeUndefined();expect(b.additives.every(x=>x.percentageType==='bwob')).toBe(true);
 expect(()=>confirmChemicalProperties(b,'')).toThrow('протокол');
});
it('binds physical measurements to the exact recipe and water, survives persistence, and rejects changes in doses, temperature or base',()=>{
 const {p,mud,b}=measured();
 expect(chemicalRecipeIssue(b,mud)).toBeNull();
 const restored=normalizeCementingSnapshot(JSON.parse(JSON.stringify({...p,drillingFluid:mud,buffers:[b,p.buffers[1]]})));
 expect(restored.drillingFluid.base).toBe('oil');
 expect(chemicalRecipeIssue(restored.buffers[0],restored.drillingFluid)).toBeNull();
 expect(chemicalRecipeIssue(b,{...mud,base:'water'})).toContain('другой');
 expect(chemicalRecipeIssue({...b,rheology:{...b.rheology,testTemperatureC:50}},mud)).toContain('Подтвердите');
 expect(chemicalRecipeIssue({...b,additives:b.additives.map((a,i)=>i? a:{...a,percentage:.1})},mud)).toContain('Подтвердите');
 expect(chemicalRecipeIssue({...b,chemicalRecipe:{...b.chemicalRecipe!,waterSource:'Другой рассол'}},mud)).toContain('Подтвердите');
 const lib=saveFluidRevision(emptyFluidLibrary(),'buffer',fluidProperties('buffer',b),{source:'Лаборатория',basis:'laboratory',temperatureC:40,pressureMPa:5,notes:'Отдельное испытание смытия обязательно'});
 const parsed=parseFluidLibrary(JSON.stringify(lib)),applied=applyFluidRevision('buffer',p.buffers[0],parsed.entries[0],1);
 // The library reference is provenance, not part of the physical measurement signature.
 expect(chemicalRecipeIssue(applied,mud)).toBeNull();
 expect(chemicalPropertySignature(applied)).toBe(chemicalPropertySignature(b));
});
it('invalidates mud/removal evidence when the water or mud base changes; literature never creates a measured 85% row',()=>{
 const {p,mud,b}=measured(),input={...p,drillingFluid:mud,buffers:[b,p.buffers[1]]},f=labFluids(input);
 expect(input.wellData.fluidInteractionLab).toBeUndefined();
 expect(f[0].key).not.toBe(labFluids({...input,drillingFluid:{...mud,base:'synthetic'}})[0].key);
 expect(f[1].key).not.toBe(labFluids({...input,buffers:[{...b,chemicalRecipe:{...b.chemicalRecipe!,waterSource:'Рассол 100 г/л'}},p.buffers[1]]})[1].key);
 const test={id:'R',source:'Фактический тест',temperatureC:40,pressureMPaAbs:5,cleanerId:'buffer:0',cleanerKey:f[1].key,mudKey:f[0].key,fromMD:0,toMD:600,criticalPa:.01,exposureS:60,removalPct:90,notes:''};
 const lab={version:1 as const,temperatureC:40,pressureMPaAbs:5,useMixtures:false,mixtures:[],removal:[test]};
 expect(removalIssue(test,lab,f)).toBeNull();
 expect(removalIssue(test,lab,labFluids({...input,drillingFluid:{...mud,base:'water'}}))).toContain('изменён');
});
it('selects the highest measured removal within constraints and falls back if the full hydraulic check rejects the higher result',async()=>{
 const p=withQualityProof(qualityInput()),base=p.wellData.fluidInteractionLab!.removal[0],higher={...p.buffers[0],name:'Химия 94'};
 p.buffers=[p.buffers[0],higher,p.buffers[1]];
 const fluids=labFluids(p);
 p.wellData.fluidInteractionLab!.removal.push({...base,id:'R94',source:'Синтетический контроль алгоритма 94%',cleanerId:'buffer:1',cleanerKey:fluids[2].key,removalPct:94,exposureS:90});
 const run=(reject:boolean)=>buildHighQualityScenario(p,qualitySettings,[qualityCentralizerPlan(p,qualitySettings)],(pp,v,cp,full,onPressure)=>{
  const e=evaluateProgram(pp,v,qualitySettings,undefined,cp.profile,{preserveSteps:true,fast:!full,onPressure});
  // Simulate an additional constraint detected by the full solver for one recipe.
  return reject&&full&&pp.buffers[0].name==='Химия 94'?{...e,feasible:false,violations:['ГРП/поглощение']}:e;
 });
 const r=await run(false);expect(r.ready).toBe(true);expect(r.design?.proof?.id).toBe('R94');
 const fallback=await run(true);expect(fallback.ready).toBe(true);expect(fallback.design?.proof?.id).toBe('R85');
},60000);
it('calculates an unmeasured recipe with planning properties without inventing a removal test',async()=>{
 const p=qualityInput(),mud={...p.drillingFluid,base:'oil' as const},b=applyChemicalRecipe(p.buffers[0],recipe,{},mud),next={...p,drillingFluid:mud,buffers:[b,p.buffers[1]]};
 const r=await buildHighQualityScenario(next,qualitySettings,[qualityCentralizerPlan(next,qualitySettings)],(pp,v,cp,full,onPressure)=>evaluateProgram(pp,v,qualitySettings,undefined,cp.profile,{preserveSteps:true,fast:!full,onPressure}));
 expect(r.ready).toBe(true);expect(r.design?.proof).toBeUndefined();expect(r.warnings.join(' ')).toContain('фактический процент неизвестен');
 expect(normalizeBufferFluid(b).chemicalRecipe?.id).toBe(recipe.id);
},60000);
