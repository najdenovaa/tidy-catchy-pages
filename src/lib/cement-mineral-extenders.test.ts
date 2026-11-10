import {it,expect} from 'vitest';
import {MINERAL_EXTENDERS} from './cement-mineral-extenders';
import {designSlurry,designToTargets,applyDesignToSlurry,type DesignConditions} from './cement-recipe-designer';
import {buildRecipe,additiveSG} from './cement-program';
import {getCementingExample} from './cementing-example';
import {normalizeSlurryInput,normalizeBufferFluid} from './cementing-normalizers';
import {CEMENT_PRODUCTS,productAdditive,cementProduct} from './cement-product-catalog';
import {calculateMaterials} from './cementing-calculations';
const c:DesignConditions={densityGcm3:1.45,bhctC:58,bhstC:75,tTopC:24,tBottomC:75,maxPressureMPa:25,requiredThickeningMin:180,coversPay:false,gas:false,maxZenithDeg:20,lossMarginMPa:5,isTail:false};
const ex=getCementingExample();
for(const m of MINERAL_EXTENDERS)it(`${m.name}: conserves mass, true particle volume and percentages through save/apply/materials`,()=>{
 const d=designSlurry(c,{extender:m.id,extenderSG:2.35,doses:{mineralExtender:25}});
 expect(d.components.find(x=>x.role==='mineralExtender')).toMatchObject({name:m.name,pctBwoc:25,sg:2.35,sgAssumed:false});
 expect(d.components.some(x=>x.role==='lightweight')).toBe(false);
 const mass=1000+d.components.reduce((n,x)=>n+10*x.pctBwoc,0),vol=1000/d.cementSG+d.components.reduce((n,x)=>n+10*x.pctBwoc/x.sg,0),water=10*d.waterPctBwoc;
 expect((mass+water)/(vol+water)).toBeCloseTo(c.densityGcm3,9);
 const s=normalizeSlurryInput(applyDesignToSlurry({...ex.slurries[0],density:1.45,labTargets:{extender:m.id,extenderSG:2.35,doses:{mineralExtender:25}}},d));
 expect(s.labTargets?.extender).toBe(m.id);expect(s.labTargets?.extenderSG).toBe(2.35);
 const r=buildRecipe(s,4),a=r.perM3.additives.find(x=>x.name===m.name)!;
 expect(a.kgPerM3/r.perM3.cementKg).toBeCloseTo(.25,7);
 expect(a.sg).toBe(2.35);expect(r.yieldM3perT).toBeCloseTo(d.yieldM3PerT,6);
 expect(calculateMaterials([s],[],ex.wellData).cementItems.some(x=>x.name.includes(m.name))).toBe(true);
 const modeled=designToTargets(c,{extender:m.id});expect(modeled.allOk).toBe(false);
 expect(modeled.design.components.find(x=>x.role==='mineralExtender')?.sg).toBe(m.sg);
});
it('does not replace high-temperature quartz flour with microsilica or use loose bulk density',()=>{
 const d=designSlurry({...c,bhstC:140},{extender:'mk85'});
 expect(d.components.some(x=>x.role==='silica'&&x.pctBwoc===35)).toBe(true);
 expect(d.components.find(x=>x.role==='mineralExtender')?.sg).toBe(2.2);
 expect(additiveSG({name:'Опока молотая',productId:'mineral-opoka',percentage:20,percentageType:'bwoc',massKg:0})).toMatchObject({sg:2.2,source:'default'});
});
it('uses ordinary mass percentages for every IG product without a hidden fixed-kilogram default',()=>{
 for(const p of CEMENT_PRODUCTS){const a=productAdditive(p);expect(a.percentage).toBeGreaterThan(0);expect(a.massKg).toBe(0);}
 const a={...productAdditive(cementProduct('ig-flex')!),percentage:.3};
 const r=buildRecipe({...ex.slurries[0],additives:[a]},3);
 expect(r.perM3.additives[0].kgPerM3/r.perM3.cementKg).toBeCloseTo(.003,9);
 const b=normalizeBufferFluid({...ex.buffers[0],density:1100,volume:10,additives:[{...productAdditive(cementProduct('ig-clean-l')!),percentage:1}]});
 const mats=calculateMaterials([], [b], ex.wellData);
 expect(mats.bufferItems.find(x=>x.name.includes('IG Clean'))?.amount).toBe(110);
});
it('offers hydrated lime as a manual activator without assigning CaO/MgO expansion credit',()=>{
 const d=designSlurry(c,{doses:{lime:3,expanding:0}});
 expect(d.components.find(x=>x.role==='lime')).toMatchObject({name:'Известь гашёная Ca(OH)₂',pctBwoc:3,sg:2.24});
 expect(d.predicted.expansionPct).toBeNull();
 expect(d.warnings.join(' ')).toContain('не засчитывается как расширяющий агент');
 expect(designSlurry(c).components.some(x=>x.role==='lime')).toBe(false);
 const base={percentage:3,percentageType:'bwoc' as const,massKg:0};
 expect(additiveSG({...base,name:'Известь гашеная'}).sg).toBe(2.24);
 expect(additiveSG({...base,name:'Известь негашеная'}).sg).toBe(3.34);
});
