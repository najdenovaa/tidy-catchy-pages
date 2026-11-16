// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCementingExample} from '../cementing-example';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import {defaultReportSelection} from '../cementing-report-options';
import {rheologyReportFigures} from '../rheology-report';
import {exportToDocx} from '../export-docx';
import type {ReportFigure} from '../cementing-report-data';
it('Word includes each available rheology panel, missing-measurement status and the same graph map, with scope isolation',async()=>{
 const ex=getCementingExample(),data={...ex,drillingFluid:{...ex.drillingFluid,name:'БР контрольный',rheology:{pv:35,yp:6,model:'hb' as const,fann:{r600:70,r300:44,r200:33,r100:23,r6:9,r3:8}}}};
 data.buffers[0].rheology={pv:0,yp:0};
 const volumes=calculateVolumes(data.wellData,data.slurries),pressure=calculatePressureProfile(data.wellData,data.slurries,data.buffers,data.drillingFluid,data.displacementFluids,data.fractureGradient,volumes.displacementVolumeWithCompression);
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.chartData=true;selection.rheology=true;
 const plots=rheologyReportFigures(data),dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`rheology-coverage-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`rheology-coverage-${i}.png`)).toString('base64')}));}
 const build=async(sel=selection)=>{const b=await exportToDocx(data.wellData,data.drillingFluid,data.slurries,data.buffers,data.displacementFluids,data.fractureGradient,undefined,undefined,{volumes,pressureResult:pressure},{returnBlob:true,selection:sel,extras:{figures}}) as Blob;const bytes=Buffer.from(await b.arrayBuffer()),z=await JSZip.loadAsync(bytes);return {bytes,xml:await z.file('word/document.xml')!.async('text'),z};};
 const out=await build();for(const p of plots)expect(out.xml.includes(p.title)).toBe(true);expect(out.xml).toContain('Кривые не построены');expect(out.xml.includes('не измерения')).toBe(true);expect(out.xml).not.toContain('Дохождение колонны:');
 if(process.env.REPORT_QA_RASTER)expect(Object.keys(out.z.files).filter(p=>p.startsWith('word/media/')&&!p.endsWith('/')).length).toBeGreaterThanOrEqual(2);
 const excluded=await build({...selection,rheology:false});expect(excluded.xml).not.toContain('Кривые течения: БР контрольный');expect(excluded.xml).not.toContain('Модели и измерения реологии');
 if(dir)writeFileSync(join(dir,'rheology-coverage.docx'),out.bytes);
},45000);
