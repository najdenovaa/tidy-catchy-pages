// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCementingExample} from '../cementing-example';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import {rheologyHierarchyFigures} from '../rheology-hierarchy';
import {exportToDocx} from '../export-docx';
import {defaultReportSelection} from '../cementing-report-options';
import type {ReportFigure} from '../cementing-report-data';
it('prints hierarchy curves and conditions, rejects old T/P images and obeys selection',async()=>{
 const ex=getCementingExample(),r={pv:20,yp:8,model:'pvyp' as const,testTemperatureC:50,testPressureMPaAbs:20,testSource:'Протокол И-17'},data={...ex,drillingFluid:{...ex.drillingFluid,rheology:r},buffers:ex.buffers.map(f=>({...f,rheology:{...r,pv:80,yp:2}})),slurries:ex.slurries.map(f=>({...f,rheology:{...r,pv:100,yp:9}})),displacementFluids:ex.displacementFluids.map(f=>({...f,rheology:{...r,pv:1,yp:0}}))};
 const volumes=calculateVolumes(data.wellData,data.slurries),pressure=calculatePressureProfile(data.wellData,data.slurries,data.buffers,data.drillingFluid,data.displacementFluids,data.fractureGradient,volumes.displacementVolumeWithCompression);
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.rheology=true;selection.chartData=true;
 const plots=rheologyHierarchyFigures(data),dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];expect(plots).toHaveLength(3);
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`hierarchy-coverage-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`hierarchy-coverage-${i}.png`)).toString('base64')}));}
 const build=async(buffers=data.buffers,sel=selection)=>{const b=await exportToDocx(data.wellData,data.drillingFluid,data.slurries,buffers,data.displacementFluids,data.fractureGradient,undefined,undefined,{volumes,pressureResult:pressure},{returnBlob:true,selection:sel,extras:{figures}}) as Blob,bytes=Buffer.from(await b.arrayBuffer()),z=await JSZip.loadAsync(bytes);return {bytes,xml:await z.file('word/document.xml')!.async('text'),images:Object.keys(z.files).filter(p=>/^word\/media\/.+\.png$/.test(p)).length};};
 const report=await build();expect(report.xml).toContain('Реологическая иерархия закачиваемых жидкостей');expect(report.xml).toContain('Протокол И-17');expect(report.xml).toContain('МПа абс.');expect(report.xml).toContain('Заданные условия T/P совпадают');expect(report.xml).not.toContain('Расчёт дохождения');if(dir)writeFileSync(join(dir,'hierarchy-coverage.docx'),report.bytes);
 if(process.env.REPORT_QA_RASTER){expect(report.images).toBe(3);const stale=await build(data.buffers.map(f=>({...f,rheology:{...f.rheology,testTemperatureC:60}})));expect(stale.images).toBe(0);expect(stale.xml).toContain('Условия T/P различаются');}
 const none=await build(data.buffers,{...selection,rheology:false});expect(none.images).toBe(0);expect(none.xml).not.toContain('Реологическая иерархия:');expect(none.xml).not.toContain('Реологическая иерархия закачиваемых жидкостей');
},45000);
