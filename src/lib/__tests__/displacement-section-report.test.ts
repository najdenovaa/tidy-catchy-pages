// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCementingExample} from '../cementing-example';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import {calculateDisplacementSpaces} from '../displacement-spaces';
import {sectionState} from '../displacement-section';
import {buildCementingReportSvgs} from '../cementing-report-figures';
import {exportToDocx} from '../export-docx';
import {defaultReportSelection} from '../cementing-report-options';
import type {DisplacementReportData,ReportFigure} from '../cementing-report-data';
it('prints the actual common section and numbers in both views, rejects stale frames and respects the checkbox',async()=>{
 const ex=getCementingExample(),wellData={...ex.wellData,wellDepthMD:260,wellDepthTVD:200,casingDepthMD:250,ckodDepth:235,prevCasingDepth:60,casingSections:[],annularStandoffPct:40,standoffProfile:[]},slurries=ex.slurries.slice(0,1).map(s=>({...s,topDepthMD:70,flowRateSteps:[{rateLps:8,volumeM3:1.5}]})),buffers=ex.buffers.map(f=>({...f,volume:.5,flowRateSteps:[{rateLps:8,volumeM3:.5}]})),volumes=calculateVolumes(wellData,slurries),input={...ex,wellData,slurries,buffers,volumes},settings={fine:false,rotationRpm:0,settleMin:0};
 const run=calculateDisplacementSpaces(input,settings),d:DisplacementReportData={...run,inputKey:'section-report-qa',settings,selectedDepthMD:230,selectedGlobalFrame:run.timeline.length-1};
 const section=sectionState(d,d.selectedDepthMD,d.selectedGlobalFrame);if('error' in section)throw Error(section.error);
 const oldWall=d.meta.sectionWell!.casingWall;wellData.casingWall=10;expect(d.meta.sectionWell!.casingWall).toBe(oldWall);wellData.casingWall=oldWall;
 const pressure=calculatePressureProfile(wellData,slurries,buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,volumes.displacementVolumeWithCompression);
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.displacementSection=true;
 const plots=buildCementingReportSvgs(wellData,{displacement:d},'cementing',selection);expect(plots).toHaveLength(2);expect(plots.every(f=>f.sourceKey===section.sourceKey)).toBe(true);
 const dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`displacement-section-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`displacement-section-${i}.png`)).toString('base64')}));}
 const build=async(sel=selection)=>{const blob=await exportToDocx(wellData,ex.drillingFluid,slurries,buffers,ex.displacementFluids,ex.fractureGradient,undefined,undefined,{volumes,pressureResult:pressure},{returnBlob:true,selection:sel,extras:{displacement:d,figures}}) as Blob,bytes=Buffer.from(await blob.arrayBuffer()),z=await JSZip.loadAsync(bytes);return{bytes,xml:await z.file('word/document.xml')!.async('text'),images:Object.keys(z.files).filter(p=>/^word\/media\/.+\.png$/.test(p)).length};};
 const report=await build();for(const term of ['Сечение трубы и затрубного пространства','Смещение осей, мм','Зазор min / max, мм','объёмные веса ячеек модели'])expect(report.xml).toContain(term);
 for(const f of section.pipeFractions)if(f!==null)expect(report.xml).toContain((f*100).toFixed(3));
 expect(report.xml).not.toContain('ПАСПОРТ');if(dir)writeFileSync(join(dir,'displacement-section.docx'),report.bytes);
 if(process.env.REPORT_QA_RASTER){expect(report.images).toBe(2);d.selectedGlobalFrame=0;expect((await build()).images).toBe(0);d.selectedGlobalFrame=run.timeline.length-1;d.selectedDepthMD=20;expect((await build()).images).toBe(0);d.selectedDepthMD=230;}
 const none=await build({...selection,displacementSection:false});expect(none.images).toBe(0);expect(none.xml).not.toContain('Сечение трубы и затрубного пространства');
},60000);
