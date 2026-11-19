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
it('exports independent per-fluid annular balances and numerical changes without the placement section',async()=>{
 const ex=getCementingExample(),wellData={...ex.wellData,wellDepthMD:260,wellDepthTVD:200,casingDepthMD:250,ckodDepth:235,prevCasingDepth:60,casingSections:[],annularStandoffPct:40,standoffProfile:[]},slurries=ex.slurries.slice(0,1).map(s=>({...s,topDepthMD:70,flowRateSteps:[{rateLps:8,volumeM3:1.5}]})),buffers=ex.buffers.map(f=>({...f,volume:.5,flowRateSteps:[{rateLps:8,volumeM3:.5}]})),volumes=calculateVolumes(wellData,slurries),input={...ex,wellData,slurries,buffers,volumes},settings={fine:false,rotationRpm:0,settleMin:0};
 const run=calculateDisplacementSpaces(input,settings),d:DisplacementReportData={...run,inputKey:'section-report-qa',settings,selectedDepthMD:230,selectedGlobalFrame:run.timeline.length-1};
 const section=displacementPlacement(d);if('error' in section)throw Error(section.error);
 const oldWall=d.meta.sectionWell!.casingWall;wellData.casingWall=10;expect(d.meta.sectionWell!.casingWall).toBe(oldWall);wellData.casingWall=oldWall;
 const pressure=calculatePressureProfile(wellData,slurries,buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,volumes.displacementVolumeWithCompression);
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.displacementSummary=true;
 const plots=buildCementingReportSvgs(wellData,{displacement:d},'cementing',selection);expect(plots).toHaveLength(0);
 const dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`annular-balance-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`annular-balance-${i}.png`)).toString('base64')}));}
 const build=async(sel=selection)=>{const blob=await exportToDocx(wellData,ex.drillingFluid,slurries,buffers,ex.displacementFluids,ex.fractureGradient,undefined,undefined,{volumes,pressureResult:pressure},{returnBlob:true,selection:sel,extras:{displacement:d,figures}}) as Blob,bytes=Buffer.from(await blob.arrayBuffer()),z=await JSZip.loadAsync(bytes);return{bytes,xml:await z.file('word/document.xml')!.async('text'),images:Object.keys(z.files).filter(p=>/^word\/media\/.+\.png$/.test(p)).length};};
 const report=await build();for(const term of ['Покомпонентный баланс затрубья','Обратный приток','Необъяснено','Округление 3D','численные изменения'])expect(report.xml).toContain(term);
 const balance=d.result!.snapshots.at(-1)!.balance!;for(const x of balance.insideM3)expect(report.xml).toContain(x.toFixed(7));
 expect(report.xml).not.toContain('Конечное размещение жидкостей в общей скважине');if(dir)writeFileSync(join(dir,'annular-balance.docx'),report.bytes);
 const none=await build({...selection,displacementSummary:false});expect(none.xml).not.toContain('Покомпонентный баланс затрубья');
},60000);
