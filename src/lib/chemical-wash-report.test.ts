// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {qualityInput} from './__tests__/fixtures/optimizer-cleaning-fixture';
import {applyChemicalRecipe,confirmChemicalProperties,WASH_RECIPES} from './chemical-wash-recipes';
import {calculateVolumes,calculatePressureProfile} from './cementing-calculations';
import {defaultReportSelection} from './cementing-report-options';
import {exportToDocx} from './export-docx';
it('exports the actual chemical recipe, measured-property source and screening status to Word',async()=>{
 const p=qualityInput();p.drillingFluid.base='oil';
 const b=applyChemicalRecipe(p.buffers[0],WASH_RECIPES.find(x=>x.id==='obm-mes-solvent')!,{},p.drillingFluid);
 b.rheology={pv:20,yp:5,testTemperatureC:40,testPressureMPaAbs:5};
 b.chemicalRecipe!.waterSource='Контрольная вода 0,2 г/л';
 p.buffers[0]=confirmChemicalProperties(b,'Протокол свойств X-2026');
 const volumes=calculateVolumes(p.wellData,p.slurries,p.displacementFluids[0].compressionCoeff);
 const pressureResult=calculatePressureProfile(p.wellData,p.slurries,p.buffers,p.drillingFluid,p.displacementFluids,p.fractureGradient,volumes.displacementVolumeWithCompression,0,0,{fast:true});
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,k==='inputs']));
 const blob=await exportToDocx(p.wellData,p.drillingFluid,p.slurries,p.buffers,p.displacementFluids,p.fractureGradient,undefined,undefined,{volumes,pressureResult},{returnBlob:true,selection});
 const zip=await JSZip.loadAsync(await (blob as Blob).arrayBuffer()),xml=await zip.file('word/document.xml')!.async('string');
 for(const text of ['MES + ПАВ + DPM','Контрольная вода 0,2 г/л','Протокол свойств X-2026','не гарантия 85%','0.05% от массы буфера = 2.2 кг','2% от массы буфера = 88.0 кг'])expect(xml).toContain(text);
});
