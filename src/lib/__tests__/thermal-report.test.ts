// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {thermalFixture} from './fixtures/thermal-fixture';
import {simulateThermal} from '../cement-thermal';
import {thermalFigures,thermalWorkbook} from '../cement-thermal-report';
import {defaultReportSelection} from '../cementing-report-options';
import {exportToDocx} from '../export-docx';
import type {ReportFigure} from '../cementing-report-data';
it('prints the same thermal histories, numerical energy ledger and selected figures, rejects stale pictures and exports all depth fields',async()=>{
 const s=thermalFixture();s.wellData.bottomTempStatic=80;const r=simulateThermal(s),plots=thermalFigures(r,s.wellData);expect(plots).toHaveLength(11);
 const book=await thermalWorkbook(r);expect(XLSX.utils.sheet_to_json(book.Sheets['Метки порций'])).toHaveLength(r.frames.length*3);expect(XLSX.utils.sheet_to_json(book.Sheets['Тепловые профили'])).toHaveLength(r.frames.length*r.md.length);
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.thermal=true;
 const dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`thermal-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`thermal-${i}.png`)).toString('base64')}));}
 const build=async(sel=selection)=>{const b=await exportToDocx(s.wellData,s.drillingFluid,s.slurries,s.buffers,s.displacementFluids,s.fractureGradient,undefined,undefined,{flushTimeMin:s.flushTimeMin,flushVolumeM3:s.flushVolumeM3},{returnBlob:true,selection:sel,extras:{thermal:r,figures}})as Blob;const bytes=Buffer.from(await b.arrayBuffer()),z=await JSZip.loadAsync(bytes);return {bytes,xml:await z.file('word/document.xml')!.async('text'),images:Object.keys(z.files).filter(x=>/^word\/media\/.+\.png$/.test(x)).length};};
 const doc=await build();for(const term of ['Температура: циркуляция','Итоговые порции','Первая','Баланс энергии','Дальняя граница','Теплопроводность породы'])expect(doc.xml.includes(term),term).toBe(true);
 if(dir)writeFileSync(join(dir,'thermal.docx'),doc.bytes);if(process.env.REPORT_QA_RASTER){expect(doc.images).toBe(11);s.wellData.thermal!.rockK+=.1;expect((await build()).images).toBe(0);s.wellData.thermal!.rockK-=.1;s.wellData.depthChartSettings={coordinate:'TVD',depthUnit:'ft',pressureUnit:'MPa',densityUnit:'gcm3'};expect((await build()).images).toBe(0);delete s.wellData.depthChartSettings;}
 const none=await build({...selection,thermal:false});expect(none.images).toBe(0);expect(none.xml).not.toContain('Итоговые порции');
},60000);
