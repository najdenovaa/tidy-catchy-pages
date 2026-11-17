// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {getCementingExample} from '../cementing-example';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import {buildPipeTransport,pipeHistoryPlots} from '../displacement-pipe';
import {buildCementingReportSvgs} from '../cementing-report-figures';
import {exportToDocx} from '../export-docx';
import {defaultReportSelection} from '../cementing-report-options';
import type {DisplacementReportData,ReportFigure} from '../cementing-report-data';
it('prints pipe-only curves and independent ledger without fabricating an annular result',async()=>{
 const ex=getCementingExample(),volumes=calculateVolumes(ex.wellData,ex.slurries),pressure=calculatePressureProfile(ex.wellData,ex.slurries,ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,volumes.displacementVolumeWithCompression);
 const pipe=buildPipeTransport([{name:'Буровой раствор',kind:'mud',density:1100,pv:.02,yp:3},{name:'Цемент G',kind:'cement',density:1800,pv:.04,yp:5},{name:'Продавочная вода',kind:'other',density:1000,pv:.001,yp:0}],[{topMD:0,bottomMD:10,startM3:0,endM3:2},{topMD:10,bottomMD:20,startM3:2,endM3:3}],[{fluid:1,volumeM3:4,rateM3s:.1},{fluid:1,volumeM3:0,rateM3s:0,holdS:20},{fluid:2,volumeM3:5,rateM3s:.2}]);
 const timeline=[0,25,40,50,60,85].map(timeS=>({timeS,annulusFrame:0}));
 const d:DisplacementReportData={inputKey:'qa',result:null,pipe,timeline,meta:{colors:['#387d55','#64748b','#0ea5e9'],annulusStartS:30,designCementTopMD:0,shoeMD:20,notes:[]},selectedDepthMD:15,selectedGlobalFrame:5,stages:[],settings:{fine:false,settleMin:0,rotationRpm:0,pipeEnabled:true,annulusEnabled:false}};
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.pipeHistory=true;selection.displacement3D=true;
 const plots=buildCementingReportSvgs(ex.wellData,{displacement:d},'cementing',selection);expect(plots).toHaveLength(1);expect(plots[0].reportItem).toBe('pipeHistory');
 expect(plots[0].svg).toBe(pipeHistoryPlots(pipe,d.meta.colors,15,timeline)[0].svg);
 const dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
 if(dir){mkdirSync(dir,{recursive:true});plots.forEach((p,i)=>writeFileSync(join(dir,`pipe-spaces-${i}.svg`),p.svg));if(process.env.REPORT_QA_RASTER)figures=plots.map((p,i)=>({...p,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`pipe-spaces-${i}.png`)).toString('base64')}));}
 figures.push({title:'Замещение: 3D-кадр t=0 мин - устаревший',reportItem:'displacement3D',width:1,height:1,dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='});
 const build=async(sel=selection)=>{const blob=await exportToDocx(ex.wellData,ex.drillingFluid,ex.slurries,ex.buffers,ex.displacementFluids,ex.fractureGradient,undefined,undefined,{volumes,pressureResult:pressure},{returnBlob:true,selection:sel,extras:{displacement:d,figures}}) as Blob,bytes=Buffer.from(await blob.arrayBuffer()),z=await JSZip.loadAsync(bytes);return{bytes,xml:await z.file('word/document.xml')!.async('text'),images:Object.keys(z.files).filter(p=>/^word\/media\/.+\.png$/.test(p)).length};};
 const report=await build();expect(report.xml).toContain('Трубное пространство: концентрации и баланс');expect(report.xml).toContain('Затрубное вытеснение: расчёт отключён');expect(report.xml).toContain('0.000000');expect(report.xml).toContain('Продавочная вода');expect(report.xml).toContain('поршневой перенос');expect(report.xml).not.toContain('3D-кадр');
 if(dir)writeFileSync(join(dir,'pipe-spaces.docx'),report.bytes);
 if(process.env.REPORT_QA_RASTER){expect(report.images).toBe(1);d.selectedDepthMD=5;expect((await build()).images).toBe(0);d.selectedDepthMD=15;}
 const none=await build({...selection,pipeHistory:false});expect(none.images).toBe(0);expect(none.xml).not.toContain('Трубное пространство: концентрации и баланс');
},45000);
