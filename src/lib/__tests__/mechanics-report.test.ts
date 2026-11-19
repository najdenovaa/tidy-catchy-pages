// @vitest-environment node
import {it,expect} from 'vitest';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import JSZip from 'jszip';
import * as X from 'xlsx';
import {mechanicsFixture} from './fixtures/mechanics-fixture';
import {calculateMechanics} from '../cement-mechanics';
import {mechanicsFigures,mechanicsWorkbook} from '../cement-mechanics-report';
import {defaultReportSelection} from '../cementing-report-options';
import {exportToDocx} from '../export-docx';
import type {ReportFigure} from '../cementing-report-data';
it('exports both independent mechanical sections and matching profiles, and rejects stale data/units or unchecked sections',async()=>{
 const s=mechanicsFixture(),r=calculateMechanics(s),plots=mechanicsFigures(r,s.wellData);expect(plots).toHaveLength(8);expect(plots[0].data.ranges.left.max).toBeLessThan(.01);const b=await mechanicsWorkbook(r);expect(X.utils.sheet_to_json(b.Sheets['Напряжения цемента'])).toHaveLength(123);expect(X.utils.sheet_to_json(b.Sheets['Осевая история'])).toHaveLength(r.frames.length);
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.axialHistory=selection.sheathHistory=true;const dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`mechanics-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`mechanics-${i}.png`)).toString('base64')}));}
 const build=async(sel=selection)=>{const b=await exportToDocx(s.wellData,s.drillingFluid,s.slurries,s.buffers,s.displacementFluids,s.fractureGradient,undefined,undefined,{flushTimeMin:s.flushTimeMin,flushVolumeM3:s.flushVolumeM3},{returnBlob:true,selection:sel,extras:{mechanics:r,figures}})as Blob,bytes=Buffer.from(await b.arrayBuffer()),z=await JSZip.loadAsync(bytes);return {bytes,xml:await z.file('word/document.xml')!.async('text'),images:Object.keys(z.files).filter(p=>/^word\/media\/.+\.png$/.test(p)).length};};
 const doc=await build();for(const term of ['Удлинение колонны','Напряжения цементного камня','Control setting protocol','Сценарии освоения','Проверка непрерывности','Мор-Кулон'])expect(doc.xml.includes(term),term).toBe(true);
 if(dir)writeFileSync(join(dir,'mechanics.docx'),doc.bytes);
 if(process.env.REPORT_QA_RASTER){expect(doc.images).toBe(8);s.wellData.mechanics!.steel.E+=1;expect((await build()).images).toBe(0);s.wellData.mechanics!.steel.E-=1;s.wellData.depthChartSettings={coordinate:'TVD',depthUnit:'ft',pressureUnit:'MPa',densityUnit:'gcm3'};expect((await build()).images).toBe(0);delete s.wellData.depthChartSettings;expect((await build({...selection,axialHistory:false})).images).toBe(4);expect((await build({...selection,sheathHistory:false})).images).toBe(4);}
 const none=await build({...selection,axialHistory:false,sheathHistory:false});expect(none.images).toBe(0);expect(none.xml).not.toContain('Control setting protocol');
},60000);
