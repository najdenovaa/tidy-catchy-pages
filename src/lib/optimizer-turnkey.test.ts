// @vitest-environment node
import JSZip from 'jszip';
import {exportToDocx} from './export-docx';
import {calculateVolumes,calculatePressureProfile} from './cementing-calculations';
import {defaultReportSelection} from './cementing-report-options';
import {it,expect} from 'vitest';
import {turnkeyFixture} from './__tests__/fixtures/optimizer-turnkey-fixture';
import {qualitySettings} from './__tests__/fixtures/optimizer-cleaning-fixture';
import {runOptimizer} from './cement-optimizer';
import {compatibleHardware,optimizerHardwareCatalog} from './optimizer-hardware';
import {normalizeCementingSnapshot} from './cementing-normalizers';
import {equipmentMaterialInventory} from './materials-equipment-inventory';
import {buildCentralizerJointSchedule} from './centralizer-layout';
import {projectCentralizerPlan} from './optimizer-turnkey';
import {buildProcessContract} from './cementing-process';
const settings={...qualitySettings,minRateLps:30,maxRateLps:30,maxCementRateLps:30,optimizeCentralizers:true};
it('selects compatible catalogue snapshots and never scales a product to a missing size',()=>{
 const {input,catalog}=turnkeyFixture(),available=compatibleHardware(input.wellData,catalog);
 expect(available.centralizers.length).toBeGreaterThan(0);expect(available.turbulators.some(x=>x.identity.model.includes('CI-168'))).toBe(true);
 const limited=structuredClone(catalog);limited.turbulators.forEach(t=>t.maxTemperatureC=1);expect(compatibleHardware(input.wellData,limited).turbulators).toHaveLength(0);
 expect(available.turbulators.every(x=>Math.abs(x.casingOD-168)<=1)).toBe(true);
 expect(compatibleHardware({...input.wellData,casingOD:219},optimizerHardwareCatalog()).turbulators).toHaveLength(0);
 expect(compatibleHardware({...input.wellData,prevCasingDepth:50,prevCasingID:180},catalog).turbulators).toHaveLength(0);
});
it('builds a complete catalogue-backed program with interval buffer rates, hardware and immutable persistence',async()=>{
 const {input}=turnkeyFixture(),catalog=optimizerHardwareCatalog(),before=JSON.stringify(input),r=await runOptimizer(input,settings,undefined,catalog);
 
 expect(r.best.length,r.blocker).toBeGreaterThan(0);
 const signatures=r.best.map(x=>JSON.stringify([x.complete.program.buffers,x.complete.program.slurries,x.complete.program.displacementFluids,x.complete.centralization.intervals,x.complete.program.wellData.turbulatorDesign],(k,v)=>k==='id'||k==='appliedAt'?undefined:v));expect(new Set(signatures).size).toBe(r.best.length);
 for(const item of r.best){const full=item.complete!;expect(full).toBeDefined();expect(full.program.wellData.optimizerProgram.variant).toBe(item.label);
  expect(full.record.transit.every(t=>t.coveredDepths===t.totalDepths&&t.minContactMin>0)).toBe(true);
  expect(full.record.transit[0].minRateLps).toBeCloseTo(10,1);expect(full.record.transit[0].maxRateLps).toBeCloseTo(10,1);
  expect(full.record.hardware.every(h=>h.identity.source&&h.quantity>0)).toBe(true);
  expect(full.program.wellData.centralizerDesign.intervals.every(iv=>iv.spec.libraryReference)).toBe(true);
  expect(full.program.wellData.turbulatorDesign.points.every(p=>!!p.catalog?.model)).toBe(true);
  const centers=buildCentralizerJointSchedule(input.wellData.casingDepthMD,full.centralization.intervals).flatMap(j=>j.placements);
  for(const t of full.program.wellData.turbulatorDesign.points)expect(centers.some(c=>t.md<c.md+c.spec.passport.length/2000&&t.md+t.lengthMm/1000>c.md-c.spec.passport.length/2000)).toBe(false);
  expect(projectCentralizerPlan(full.program,catalog)).toBeDefined();
  const wrongVersion=structuredClone(full.program);wrongVersion.wellData.centralizerDesign.intervals[0].spec.libraryReference.revision=999;expect(projectCentralizerPlan(wrongVersion,catalog)).toBeUndefined();
  const edited=structuredClone(full.program);edited.wellData.centralizerDesign.intervals[0].spec.bladeHeight+=1;expect(projectCentralizerPlan(edited,catalog)).toBeUndefined();
  const restored=normalizeCementingSnapshot(JSON.parse(JSON.stringify(full.program)));
  expect(restored.wellData.optimizerProgram).toEqual(full.record);
  expect(restored.wellData.turbulatorDesign.points[0].catalog).toEqual(full.program.wellData.turbulatorDesign.points[0].catalog);
  const inventory=equipmentMaterialInventory(restored.wellData);expect(inventory.filter(x=>x.name.startsWith('Турбулизатор /')).reduce((n,x)=>n+x.amount,0)).toBe(restored.wellData.turbulatorDesign.points.length);
  expect(buildProcessContract(restored).canRun).toBe(true);
 }
 const p=r.best[0].complete.program,volumes=calculateVolumes(p.wellData,p.slurries,p.displacementFluids[0].compressionCoeff),pressureResult=calculatePressureProfile(p.wellData,p.slurries,p.buffers,p.drillingFluid,p.displacementFluids,p.fractureGradient,volumes.displacementVolumeWithCompression,0,0,{fast:true});
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,k==='inputs'||k==='schedule']));
 const blob=await exportToDocx(p.wellData,p.drillingFluid,p.slurries,p.buffers,p.displacementFluids,p.fractureGradient,undefined,undefined,{volumes,pressureResult},{returnBlob:true,selection});
 const zip=await JSZip.loadAsync(await (blob as Blob).arrayBuffer()),xml=await zip.file('word/document.xml')!.async('string');
 for(const h of r.best[0].complete.record.hardware)expect(xml.includes(h.identity.model),h.identity.model).toBe(true);
 expect(xml).toContain('Лучшее качество');expect(xml.includes('Буфер в целевой зоне')).toBe(true);
 expect(JSON.stringify(input)).toBe(before);
},120000);
it('keeps complete interval scheduling on the specified recipes with buffer selection disabled',async()=>{
 const {input}=turnkeyFixture(),catalog=optimizerHardwareCatalog();
 const r=await runOptimizer(input,{...settings,optimizeBuffer:false},undefined,catalog);
 
 expect(r.best.length,r.blocker).toBeGreaterThan(0);
 for(const x of r.best){expect(x.complete.program.buffers.map(b=>[b.volume,b.density,b.additives])).toEqual(input.buffers.map(b=>[b.volume,b.density,b.additives]));expect(x.complete.record.hardware.length).toBeGreaterThan(1);}
},120000);
