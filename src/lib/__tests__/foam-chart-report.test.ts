// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCementingExample} from '../cementing-example';
import {simulateFoamJob,defaultFoamSettings} from '../foam-cement-engine';
import {foamCharts} from '../foam-chart-data';
import {exportFoamReport} from '../foam-cement-report';
import {exportToDocx} from '../export-docx';
import {defaultReportSelection} from '../cementing-report-options';
import {DEFAULT_DEPTH_CHART} from '../depth-chart-settings';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import type {ReportFigure} from '../cementing-report-data';
it('standalone and selected main Word export the same foam diagrams and reject stale figures/physics without exposing passport bodies',async()=>{
 const ex=getCementingExample(),well={...ex.wellData,equipment:[{id:'secret',kind:'basket' as const,manufacturer:'Производитель',model:'Изделие',quantity:1,passport:'SECRET-PASSPORT-CONTENT'}]};
 const simulation=simulateFoamJob({wellData:well,mudDensity:ex.drillingFluid.density/1000,settings:{...defaultFoamSettings({wellData:well}),spatialCells:16,timeStepMin:2}}),bundle={simulation,observations:[],frameIndex:1,chartSettings:{...DEFAULT_DEPTH_CHART,coordinate:'TVD' as const,depthUnit:'ft' as const,pressureUnit:'psi' as const}};
 const plots=foamCharts(bundle),dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`foam-coverage-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`foam-coverage-${i}.png`)).toString('base64')}));}
 const bytes=Buffer.from(await (await exportFoamReport(bundle,{returnBlob:true,figures}) as Blob).arrayBuffer()),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml')!.async('text');
 expect(xml.includes('Исходные параметры для воспроизведения')).toBe(true);expect(xml).not.toContain('SECRET-PASSPORT');expect(xml.includes('Давление абсолютное, psi')).toBe(true);
 if(dir)writeFileSync(join(dir,'foam-coverage.docx'),bytes);
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.foam=true;selection.chartData=true;
 const vol=calculateVolumes(well,ex.slurries),pressure=calculatePressureProfile(well,ex.slurries,ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,vol.displacementVolumeWithCompression);
 const main=async(w=well,foam=bundle,sel=selection,figs=figures)=>{const b=await exportToDocx(w,ex.drillingFluid,ex.slurries,ex.buffers,ex.displacementFluids,ex.fractureGradient,undefined,undefined,{volumes:vol,pressureResult:pressure},{returnBlob:true,selection:sel,foam,extras:{figures:figs}}) as Blob;const bytes=Buffer.from(await b.arrayBuffer()),z=await JSZip.loadAsync(bytes);return {bytes,xml:await z.file('word/document.xml')!.async('text'),images:Object.keys(z.files).filter(x=>x.startsWith('word/media/')&&!x.endsWith('/')).length};};
 const ok=await main();expect(ok.xml).not.toContain('SECRET-PASSPORT');expect(ok.xml.includes('Программа пеноцементирования')).toBe(true);if(dir)writeFileSync(join(dir,'foam-main-coverage.docx'),ok.bytes);
 const stale=await main({...well,holeDiameter:well.holeDiameter+1});expect(stale.xml.includes('Нет актуального расчёта пеноцементирования')).toBe(true);expect(stale.images).toBe(0);
 const no=await main(well,bundle,{...selection,foam:false});expect(no.images).toBe(0);expect(no.xml.includes('Программа пеноцементирования')).toBe(false);
 if(process.env.REPORT_QA_RASTER){expect(ok.images).toBe(7);const wrong=await main(well,{...bundle,frameIndex:2});expect(wrong.images).toBe(0);}
},60000);
