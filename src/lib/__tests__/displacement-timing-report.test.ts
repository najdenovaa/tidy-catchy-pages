// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCementingExample} from '../cementing-example';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import {simulateDisplacement2D} from '../displacement-2d';
import {displacementHistoryWorkbook} from '../displacement-history-workbook';
import {buildCementingReportSvgs} from '../cementing-report-figures';
import {exportToDocx} from '../export-docx';
import {defaultReportSelection} from '../cementing-report-options';
import type {DisplacementReportData,ReportFigure} from '../cementing-report-data';
it('reports requested and actual timing from the real solver and exports the same metadata to XLSX',async()=>{
 const ex=getCementingExample(),volumes=calculateVolumes(ex.wellData,ex.slurries),pressure=calculatePressureProfile(ex.wellData,ex.slurries,ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,volumes.displacementVolumeWithCompression);
 const settings={fine:false,rotationRpm:0,settleMin:.1,maxTimeStepS:2,frameIntervalS:7},stages=[{fluid:1,volumeM3:.08,rateM3s:.001}],result=simulateDisplacement2D({zTop:0,zBot:30,nZ:20,nTheta:6,geom:()=>({rHole:.108,rCasing:.073,standoff:1,inclDeg:0}),fluids:[{name:'Буровой раствор',kind:'mud',density:1100,pv:.02,yp:2},{name:'Цемент G',kind:'cement',density:1100,pv:.02,yp:2}],stages,...settings});
 const d:DisplacementReportData={inputKey:'qa-timing',result,stages,settings,meta:{colors:['#387d55','#64748b'],annulusStartS:20,designCementTopMD:0,shoeMD:30,notes:[]},selectedDepthMD:15,selectedFrame:result.snapshots.length-1};
 const wb=displacementHistoryWorkbook(result,15,d.selectedFrame!,20),rows=XLSX.utils.sheet_to_json(wb.Sheets['Условия'],{header:1}) as unknown[][];
 expect(rows.find(row=>row[0]==='Максимальный шаг решателя, с')?.[1]).toBe(2);expect(rows.find(row=>row[0]==='Фактический максимум шага, с')?.[1]).toBe(result.summary.timing!.maxStepS);expect(rows.find(row=>row[0]==='Расчёт завершён')?.[1]).toBe('Да');
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.displacementHistory=true;
 const plots=buildCementingReportSvgs(ex.wellData,{displacement:d},'cementing',selection);expect(plots).toHaveLength(1);
 const dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`displacement-timing-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`displacement-timing-${i}.png`)).toString('base64')}));}
 const blob=await exportToDocx(ex.wellData,ex.drillingFluid,ex.slurries,ex.buffers,ex.displacementFluids,ex.fractureGradient,undefined,undefined,{volumes,pressureResult:pressure},{returnBlob:true,selection,extras:{displacement:d,figures}}) as Blob,bytes=Buffer.from(await blob.arrayBuffer()),z=await JSZip.loadAsync(bytes),xml=await z.file('word/document.xml')!.async('text');
 for(const term of ['Временные настройки вытеснения','Максимальный шаг решателя, с','Фактический минимум шага, с','Фактический максимум шага, с','Средний шаг, с','Расчёт завершён'])expect(xml).toContain(term);
 expect(xml).toContain('Сохранение кадров не меняет шаг решателя');if(dir)writeFileSync(join(dir,'displacement-timing.docx'),bytes);
 if(process.env.REPORT_QA_RASTER)expect(Object.keys(z.files).filter(p=>/^word\/media\/.+\.png$/.test(p))).toHaveLength(1);
},45000);
