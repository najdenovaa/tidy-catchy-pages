// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {qualityInput,withQualityProof,qualitySettings} from './fixtures/optimizer-cleaning-fixture';
import {buildHighQualityScenario} from '../optimizer-cleaning';
import {qualityCentralizerPlan,evaluateProgram} from '../cement-optimizer';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import {normalizeCementingSnapshot} from '../cementing-normalizers';
import {exportToDocx} from '../export-docx';
import {defaultReportSelection} from '../cementing-report-options';
import {fluidLabWorkbook} from '../fluid-lab-workbook';
import {equipmentMaterialInventory} from '../materials-equipment-inventory';
it('persists laboratory evidence and the prepared schedule, prints them as a historical design and exports measured removal',async()=>{
 const p=withQualityProof(qualityInput()),plan=qualityCentralizerPlan(p,qualitySettings);
 const r=await buildHighQualityScenario(p,qualitySettings,[plan],(pp,v,cp,full,onPressure)=>evaluateProgram(pp,v,qualitySettings,undefined,cp.profile,{preserveSteps:true,fast:!full,onPressure}));
 expect(r.ready).toBe(true);
 const s=normalizeCementingSnapshot(JSON.parse(JSON.stringify({...r.program,wellData:{...r.program!.wellData,optimizerCleaning:r.design}})));
 const v=calculateVolumes(s.wellData,s.slurries,s.displacementFluids[0].compressionCoeff);
 const pressure=calculatePressureProfile(s.wellData,s.slurries,s.buffers,s.drillingFluid,s.displacementFluids,s.fractureGradient,v.displacementVolumeWithCompression,0,0,{fast:true});
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.schedule=true;selection.fluidLab=true;
 const blob=await exportToDocx(s.wellData,s.drillingFluid,s.slurries,s.buffers,s.displacementFluids,s.fractureGradient,undefined,undefined,{volumes:v,pressureResult:pressure},{returnBlob:true,selection});
 const zip=await JSZip.loadAsync(await (blob as Blob).arrayBuffer()),xml=await zip.file('word/document.xml')!.async('text');
 expect(xml).toContain('Высокое качество');expect(xml).toContain('на момент применения');expect(xml).toContain('86%');expect(xml).toContain('Испытание образца');
 expect(xml).toContain('10 л/с');expect(xml).toContain('не прогноз очистки всей скважины');
 const w=fluidLabWorkbook(s);expect(JSON.stringify(w.Sheets['Протоколы вымывания'])).toContain('Смытие в испытании');expect(JSON.stringify(w.Sheets['Протоколы вымывания'])).toContain('86');
 const items=equipmentMaterialInventory(s.wellData);expect(items.filter(x=>x.name.startsWith('Турбулизатор')).reduce((n,x)=>n+x.amount,0)).toBe(s.wellData.turbulatorDesign!.points.length);
},60000);
