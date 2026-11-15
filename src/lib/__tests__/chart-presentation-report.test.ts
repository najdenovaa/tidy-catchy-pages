// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCementingExample} from '../cementing-example';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import {defaultReportSelection} from '../cementing-report-options';
import {hydraulicReportCharts,depthReportCharts} from '../cementing-report-charts';
import {exportToDocx} from '../export-docx';
import type {ReportFigure} from '../cementing-report-data';
it('Word preserves custom titles and styles in selected figures and numeric catalog without adding other modules',async()=>{
 const ex=getCementingExample(),well={...ex.wellData,chartPresentations:{combined:{title:'Совмещённый график контрольной программы с ручным масштабом и увеличенным шрифтом',fontFamily:'monospace' as const,fontSize:20,basis:{x:'Время, мин',left:'Давление, МПа',right:'Расход, л/с'},x:{min:5,max:50},left:{min:0,max:30},right:{min:0,max:15}},depthPressure:{title:'Давление по глубине с увеличенными подписями',fontFamily:'serif' as const,fontSize:20}}};
 const volumes=calculateVolumes(well,ex.slurries),pressure=calculatePressureProfile(well,ex.slurries,ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,volumes.displacementVolumeWithCompression);
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.chartData=true;selection.combined=true;selection.depthPressure=true;
 const plots=[...hydraulicReportCharts(pressure.points,selection,pressure.stageBoundaries,pressure.observation,well.chartPresentations),...depthReportCharts(pressure.envelope,selection,well.depthChartSettings,well.chartPresentations)],dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
 expect(plots.map(p=>p.title)).toContain(well.chartPresentations.combined.title);expect(plots[0].data.outsideCount).toBeGreaterThan(0);
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`chart-presentation-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`chart-presentation-${i}.png`)).toString('base64')}));}
 const blob=(await exportToDocx(well,ex.drillingFluid,ex.slurries,ex.buffers,ex.displacementFluids,ex.fractureGradient,undefined,undefined,{volumes,pressureResult:pressure},{returnBlob:true,selection,extras:{figures}})) as Blob;
 const bytes=Buffer.from(await blob.arrayBuffer()),z=await JSZip.loadAsync(bytes),xml=await z.file('word/document.xml')!.async('text');
 expect(xml).toContain(well.chartPresentations.combined.title);expect(xml).toContain(well.chartPresentations.depthPressure.title);expect(xml).toContain('Карта выбранных');expect(xml).not.toContain('Дохождение колонны:');
 if(process.env.REPORT_QA_RASTER)expect(Object.keys(z.files).filter(p=>p.startsWith('word/media/')&&!p.endsWith('/')).length).toBeGreaterThanOrEqual(3);
 if(dir)writeFileSync(join(dir,'chart-presentation.docx'),bytes);
},45000);
