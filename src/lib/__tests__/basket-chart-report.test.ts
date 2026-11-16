// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCementingExample} from '../cementing-example';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import {defaultReportSelection} from '../cementing-report-options';
import {basketStopCharts} from '../basket-chart-data';
import {DEFAULT_DEPTH_CHART} from '../depth-chart-settings';
import {exportToDocx} from '../export-docx';
import type {ReportFigure} from '../cementing-report-data';
it('Word preserves basket coordinate/units and scenario provenance while keeping passport bodies and other report scopes out',async()=>{
 const ex=getCementingExample(),well={...ex.wellData,depthChartSettings:{...DEFAULT_DEPTH_CHART,coordinate:'TVD' as const,depthUnit:'ft' as const,pressureUnit:'psi' as const},equipment:[{id:'b',kind:'basket' as const,model:'Корзина QA',manufacturer:'Аврора',quantity:1,depthMD:1200,basketBridgeMin:5,basketSupportPct:40,basketCapacityKN:30,passport:'SECRET-PASSPORT-BODY',sourceUrl:'https://example.org/product'}]};
 const volumes=calculateVolumes(well,ex.slurries),pressure=calculatePressureProfile(well,ex.slurries,ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,volumes.displacementVolumeWithCompression);
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.chartData=true;selection.basket=true;
 const plots=basketStopCharts(pressure.basketStop,well.depthChartSettings),dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`basket-coverage-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`basket-coverage-${i}.png`)).toString('base64')}));}
 const b=await exportToDocx(well,ex.drillingFluid,ex.slurries,ex.buffers,ex.displacementFluids,ex.fractureGradient,undefined,undefined,{volumes,pressureResult:pressure},{returnBlob:true,selection,extras:{figures}}) as Blob;
 const bytes=Buffer.from(await b.arrayBuffer()),z=await JSZip.loadAsync(bytes),xml=await z.file('word/document.xml')!.async('text');
 for(const s of ['Глубина TVD, ft','Давление, psi','Корзина QA','Плотность носителя','не подтверждает','MD / TVD'])expect(xml.includes(s)).toBe(true);
 expect(xml).not.toContain('SECRET-PASSPORT');expect(xml).not.toContain('Дохождение колонны:');if(dir)writeFileSync(join(dir,'basket-coverage.docx'),bytes);
},45000);
