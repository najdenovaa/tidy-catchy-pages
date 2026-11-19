// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCementingExample} from '../cementing-example';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import {calculateDisplacementSpaces} from '../displacement-spaces';
import {displacementPlacement} from '../displacement-placement';
import {buildCementingReportSvgs} from '../cementing-report-figures';
import {exportToDocx} from '../export-docx';
import {defaultReportSelection} from '../cementing-report-options';
import type {DisplacementReportData,ReportFigure} from '../cementing-report-data';
it('prints final placement from the real solver, rejects stale fields and keeps report scopes separate',async()=>{
 const ex=getCementingExample(),wellData={...ex.wellData,wellDepthMD:260,wellDepthTVD:200,casingDepthMD:250,ckodDepth:235,prevCasingDepth:60,casingSections:[],annularStandoffPct:40,standoffProfile:[]},slurries=ex.slurries.slice(0,1).map(s=>({...s,topDepthMD:70,flowRateSteps:[{rateLps:8,volumeM3:1.5}]})),buffers=ex.buffers.map(f=>({...f,volume:.5,flowRateSteps:[{rateLps:8,volumeM3:.5}]})),volumes=calculateVolumes(wellData,slurries),input={...ex,wellData,slurries,buffers,volumes},settings={fine:false,rotationRpm:0,settleMin:0};
 const run=calculateDisplacementSpaces(input,settings),d:DisplacementReportData={...run,inputKey:'section-report-qa',settings,selectedDepthMD:230,selectedGlobalFrame:run.timeline.length-1};
 const section=displacementPlacement(d);if('error' in section)throw Error(section.error);
 const oldWall=d.meta.sectionWell!.casingWall;wellData.casingWall=10;expect(d.meta.sectionWell!.casingWall).toBe(oldWall);wellData.casingWall=oldWall;
 const pressure=calculatePressureProfile(wellData,slurries,buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,volumes.displacementVolumeWithCompression);
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.displacementPlacement=true;
 const plots=buildCementingReportSvgs(wellData,{displacement:d},'cementing',selection);expect(plots).toHaveLength(1);expect(plots.every(f=>f.sourceKey===section.sourceKey)).toBe(true);
 const dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`displacement-placement-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`displacement-placement-${i}.png`)).toString('base64')}));}
 const build=async(sel=selection)=>{const blob=await exportToDocx(wellData,ex.drillingFluid,slurries,buffers,ex.displacementFluids,ex.fractureGradient,undefined,undefined,{volumes,pressureResult:pressure},{returnBlob:true,selection:sel,extras:{displacement:d,figures}}) as Blob,bytes=Buffer.from(await blob.arrayBuffer()),z=await JSZip.loadAsync(bytes);return{bytes,xml:await z.file('word/document.xml')!.async('text'),images:Object.keys(z.files).filter(p=>/^word\/media\/.+\.png$/.test(p)).length};};
 const report=await build();for(const term of ['Конечное размещение жидкостей в общей скважине','Интервалов:','Невязка профиля трубы','инвентарь сохранённого поля'])expect(report.xml).toContain(term);
 for(const v of section.pipeInventory??[])expect(report.xml).toContain(v.toFixed(5));
 expect(report.xml).not.toContain('ПАСПОРТ');if(dir)writeFileSync(join(dir,'displacement-placement.docx'),report.bytes);
 if(process.env.REPORT_QA_RASTER){expect(report.images).toBe(1);const last=d.result!.snapshots.at(-1)!;const old=last.frac[0];last.frac[0]=old===255?0:255;expect((await build()).images).toBe(0);last.frac[0]=old;}
 const none=await build({...selection,displacementPlacement:false});expect(none.images).toBe(0);expect(none.xml).not.toContain('Конечное размещение жидкостей в общей скважине');
},60000);
