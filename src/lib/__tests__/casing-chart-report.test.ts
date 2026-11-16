// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {well,data} from './fixtures/casing-chart-fixture';
import {exportCasingDesignDocx} from '../export-casing-design-docx';
import {buildCementingReportSvgs} from '../cementing-report-figures';
import {defaultReportSelection} from '../cementing-report-options';
import type {ReportFigure} from '../cementing-report-data';
const read=async(blob:Blob)=>{const bytes=Buffer.from(await blob.arrayBuffer()),z=await JSZip.loadAsync(bytes);return {bytes,xml:await z.file('word/document.xml')!.async('text'),images:Object.keys(z.files).filter(p=>/^word\/media\/.+\.png$/.test(p)).length};};
it('prints scope-specific chart maps and actual current figures; rejects old coordinates and unchecked graph sections',async()=>{
 for(const scope of ['centralization','running'] as const){
  const selection=Object.fromEntries(Object.keys(defaultReportSelection(scope)).map(k=>[k,false]));selection.chartData=true;selection.inputs=true;
  for(const k of scope==='centralization'?['standoff','loads']:['broom','forceProfile','torque'])selection[k]=true;
  const svgs=buildCementingReportSvgs(well,{centralization:data},scope,selection),dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
  if(dir){mkdirSync(dir,{recursive:true});svgs.forEach((f,i)=>writeFileSync(join(dir,`casing-${scope}-${i}.svg`),f.svg));if(process.env.REPORT_QA_RASTER)figures=svgs.map((f,i)=>({...f,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`casing-${scope}-${i}.png`)).toString('base64')}));}
  const doc=await read((await exportCasingDesignDocx(well,data,1100,scope,selection,{returnBlob:true,figures}))!);
  expect(doc.xml).toContain('Карта графиков и числовые выгрузки');expect(doc.xml).toContain('TVD, ft');expect(doc.xml).not.toContain('SECRET-PASSPORT');expect(doc.xml.includes('веник по глубине')).toBe(scope==='running');expect(doc.xml.includes('Профиль Standoff')).toBe(scope==='centralization');
  if(dir)writeFileSync(join(dir,`casing-${scope}-coverage.docx`),doc.bytes);
  if(process.env.REPORT_QA_RASTER){expect(doc.images).toBe(scope==='centralization'?3:4);const stale=await read((await exportCasingDesignDocx(well,{...data,chartSettings:{...data.chartSettings!,coordinate:'MD'}},1100,scope,selection,{returnBlob:true,figures}))!);expect(stale.images).toBe(0);}
  const no={...selection,chartData:false,standoff:false,loads:false,broom:false,forceProfile:false,torque:false};
  const hidden=await read((await exportCasingDesignDocx(well,data,1100,scope,no,{returnBlob:true,figures}))!);expect(hidden.images).toBe(0);expect(hidden.xml).not.toContain('Карта графиков и числовые выгрузки');
 }
},60000);
