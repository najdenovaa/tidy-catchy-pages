// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {labFixture} from './fixtures/fluid-lab-fixture';
import {labFluids} from '../fluid-interaction-lab';
import {calculateDisplacementSpaces} from '../displacement-spaces';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import {fluidLabReport} from '../fluid-lab-report';
import {buildCementingReportSvgs} from '../cementing-report-figures';
import {defaultReportSelection} from '../cementing-report-options';
import {exportToDocx} from '../export-docx';
import type {DisplacementReportData,ReportFigure} from '../cementing-report-data';
it('exports measured mixture curves and the required shear profile, removes stale figures and respects its own checkbox',async()=>{
 const {ex,lab}=labFixture();ex.wellData={...ex.wellData,wellDepthMD:120,wellDepthTVD:110,casingDepthMD:115,ckodDepth:105,prevCasingDepth:20,casingSections:[]};ex.slurries=ex.slurries.slice(0,1).map(s=>({...s,topDepthMD:30,flowRateSteps:[{rateLps:8,volumeM3:1}]}));ex.buffers=ex.buffers.map(b=>({...b,volume:.3,flowRateSteps:[{rateLps:8,volumeM3:.3}]}));
 const fluids=labFluids(ex);lab.removal=[{id:'W1',source:'Washer test protocol 12',temperatureC:50,pressureMPaAbs:5,cleanerId:fluids[1].id,cleanerKey:fluids[1].key,mudKey:fluids[0].key,fromMD:0,toMD:115,criticalPa:10,exposureS:60,notes:'Steel deposit sample'}];
 const volumes=calculateVolumes(ex.wellData,ex.slurries),input={...ex,volumes},settings={fine:false,rotationRpm:0,settleMin:0},run=calculateDisplacementSpaces(input,settings),d:DisplacementReportData={...run,inputKey:'lab-report',settings};
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.fluidLab=true;selection.chartData=true;
 const plots=buildCementingReportSvgs(ex.wellData,{displacement:d},'cementing',selection);expect(plots).toHaveLength(3);const current=fluidLabReport(ex,d);expect(plots.every(f=>f.sourceKey===current.sourceKey)).toBe(true);
 const pressure=calculatePressureProfile(ex.wellData,ex.slurries,ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,volumes.displacementVolumeWithCompression),dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`fluid-lab-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`fluid-lab-${i}.png`)).toString('base64')}));}
 const build=async(sel=selection)=>{const blob=await exportToDocx(ex.wellData,ex.drillingFluid,ex.slurries,ex.buffers,ex.displacementFluids,ex.fractureGradient,undefined,undefined,{volumes,pressureResult:pressure},{returnBlob:true,selection:sel,extras:{displacement:d,figures}}) as Blob,bytes=Buffer.from(await blob.arrayBuffer()),z=await JSZip.loadAsync(bytes);return {bytes,xml:await z.file('word/document.xml')!.async('text'),images:Object.keys(z.files).filter(p=>/^word\/media\/.+\.png$/.test(p)).length};};
 const report=await build();for(const term of ['Совместимость смесей и вымываемость','Лабораторная модель','Washer test protocol 12','PV, сПз','чистой промывке','Температура / абсолютное давление'])expect(report.xml.includes(term),term).toBe(true);
 expect(report.xml).toContain('80.0000%');expect(report.xml).toContain('Аномалий не отмечено');expect(report.xml).not.toContain('0.19999999999999996');
 if(dir)writeFileSync(join(dir,'fluid-lab.docx'),report.bytes);if(process.env.REPORT_QA_RASTER){expect(report.images).toBe(3);lab.removal[0].criticalPa=20;expect((await build()).images).toBe(0);lab.removal[0].criticalPa=10;}
 const none=await build({...selection,fluidLab:false});expect(none.images).toBe(0);expect(none.xml).not.toContain('Совместимость смесей и вымываемость');
},60000);
