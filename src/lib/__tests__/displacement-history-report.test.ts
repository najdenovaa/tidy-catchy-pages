// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCementingExample} from '../cementing-example';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import {exportToDocx} from '../export-docx';
import {defaultReportSelection} from '../cementing-report-options';
import {displacementHistoryPlots} from '../displacement-depth-history';
import type {DisplacementReportData,ReportFigure} from '../cementing-report-data';
it('exports every saved observation and the same graph, and respects the report checkbox',async()=>{
 const ex=getCementingExample(),volumes=calculateVolumes(ex.wellData,ex.slurries),pressure=calculatePressureProfile(ex.wellData,ex.slurries,ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,volumes.displacementVolumeWithCompression);
 const result={nZ:2,nTheta:2,zCenters:new Float64Array([105,115]),gap:new Float32Array([3,1,1,1]),fluids:[{name:'Раствор',kind:'mud'},{name:'Цемент G',kind:'cement'}],snapshots:[{t:0,stage:0,frac:new Uint8Array([255,255,255,255,0,0,0,0])},{t:60,stage:1,frac:new Uint8Array([255,0,127,0,0,255,127,255])}]} as DisplacementReportData['result'];
 const d={inputKey:'qa',result,meta:{colors:['#387d55','#64748b'],annulusStartS:120},selectedDepthMD:105,selectedFrame:1} as DisplacementReportData;
 const plots=displacementHistoryPlots(result,d.meta.colors,105),dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`displacement-history-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`displacement-history-${i}.png`)).toString('base64')}));}
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.displacementHistory=true;
 const build=async(sel=selection)=>{const blob=await exportToDocx(ex.wellData,ex.drillingFluid,ex.slurries,ex.buffers,ex.displacementFluids,ex.fractureGradient,undefined,undefined,{volumes,pressureResult:pressure},{returnBlob:true,selection:sel,extras:{displacement:d,figures}}) as Blob,bytes=Buffer.from(await blob.arrayBuffer()),z=await JSZip.loadAsync(bytes);return{bytes,xml:await z.file('word/document.xml')!.async('text'),images:Object.keys(z.files).filter(p=>/^word\/media\/.+\.png$/.test(p)).length};};
 const report=await build();expect(report.xml).toContain('Доли жидкостей во времени на выбранной глубине');expect(report.xml).toContain('75.00');expect(report.xml).toContain('25.00');expect(report.xml).toContain('Цемент G');expect(report.xml).toContain('1/255');expect(report.xml).toContain('Трубное пространство этим расчётом не определяется');
 if(dir)writeFileSync(join(dir,'displacement-history.docx'),report.bytes);
 if(process.env.REPORT_QA_RASTER){expect(report.images).toBe(1);d.selectedDepthMD=115;const stale=await build();expect(stale.images).toBe(0);d.selectedDepthMD=105;}
 const none=await build({...selection,displacementHistory:false});expect(none.xml).not.toContain('Доли жидкостей во времени на выбранной глубине');expect(none.images).toBe(0);
},45000);
