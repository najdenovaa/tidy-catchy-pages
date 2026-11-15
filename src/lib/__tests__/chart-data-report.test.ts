// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCementingExample} from '../cementing-example';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import {defaultReportSelection} from '../cementing-report-options';
import {depthReportCharts} from '../cementing-report-charts';
import {DEFAULT_DEPTH_CHART} from '../depth-chart-settings';
import {exportToDocx} from '../export-docx';
import type {ReportFigure} from '../cementing-report-data';
it('Word uses the selected depth coordinate and units, includes the numeric coverage map, and keeps its control sample clearly labeled',async()=>{
 const ex=getCementingExample(),well={...ex.wellData,depthChartSettings:{...DEFAULT_DEPTH_CHART,coordinate:'TVD' as const,depthUnit:'ft' as const,pressureUnit:'psi' as const,densityUnit:'ppg' as const}};
 const volumes=calculateVolumes(well,ex.slurries),pressure=calculatePressureProfile(well,ex.slurries,ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,volumes.displacementVolumeWithCompression);
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.chartData=true;selection.depthPressure=true;selection.depthEcd=true;
 const plots=depthReportCharts(pressure.envelope,selection,well.depthChartSettings),dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`chart-units-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`chart-units-${i}.png`)).toString('base64')}));}
 const blob=(await exportToDocx(well,ex.drillingFluid,ex.slurries,ex.buffers,ex.displacementFluids,ex.fractureGradient,undefined,undefined,{volumes,pressureResult:pressure},{returnBlob:true,selection,extras:{figures}})) as Blob;
 const bytes=Buffer.from(await blob.arrayBuffer()),z=await JSZip.loadAsync(bytes),xml=await z.file('word/document.xml')!.async('text');
 expect(xml).toContain('Карта выбранных основных гидравлических графиков');expect(xml).toContain('Глубина TVD, ft');expect(xml).toContain('Давление, psi');expect(xml).toContain('ppg (US)');expect(xml).toContain('контрольной выборкой');expect(xml).not.toContain('Дохождение колонны:');
 if(dir)writeFileSync(join(dir,'chart-units.docx'),bytes);
},45000);
