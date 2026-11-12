// @vitest-environment node
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {studyFixture} from '@/test/fixtures/compressible-flow';
import {buildProcessContract} from '../cementing-process';
import {transportRefinementInputs,summarizeTransportRefinement} from '../transport-refinement';
import {simulateCompressibleTransport} from '../compressible-transport';
import {exportToDocx} from '../export-docx';
import {calculateVolumes,calculatePressureProfile} from '../cementing-calculations';
import {buildCementingReportSvgs} from '../cementing-report-figures';
import {defaultReportSelection} from '../cementing-report-options';
it('exports the accepted mass budget and figures, excludes deselected data and rejects stale results',async()=>{
 const p=studyFixture();p.wellData.ckodDepth=60;p.wellData.stopStorage={...p.wellData.stopStorage,flowCheckValve:true,flowClosureEnabled:true,flowClosureTimeMin:buildProcessContract(p).totalTimeMin-1/60};const runs=transportRefinementInputs(p).map(x=>simulateCompressibleTransport(x.input)),result=runs[0];result.study=summarizeTransportRefinement(p,runs);expect(result.status,result.reason).toBe('complete');
 const volumes=calculateVolumes(p.wellData,p.slurries),pressureResult=calculatePressureProfile(p.wellData,p.slurries,p.buffers,p.drillingFluid,p.displacementFluids,p.fractureGradient,volumes.displacementVolumeWithCompression);
 const svgs=buildCementingReportSvgs(p.wellData,{compressibleTransport:result});expect(svgs.filter(f=>f.reportItem==='compressibleTransport')).toHaveLength(2);
 const dir=process.env.REPORT_QA_DIR;let figures:any[]=[];
 if(dir){mkdirSync(dir,{recursive:true});svgs.forEach((f,i)=>writeFileSync(join(dir,`transport-${i}.svg`),f.svg));if(process.env.REPORT_QA_RASTER)figures=svgs.map((f,i)=>({...f,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`transport-${i}.png`)).toString('base64')}));}
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));selection.compressibleTransport=true;
 async function make(w=p.wellData,pick=selection){const blob=await exportToDocx(w,p.drillingFluid,p.slurries,p.buffers,p.displacementFluids,p.fractureGradient,undefined,[],{volumes,pressureResult,flushTimeMin:0,flushVolumeM3:0},{returnBlob:true,selection:pick,extras:{compressibleTransport:result,figures}});if(!blob)throw new Error("DOCX was not generated");const bytes=Buffer.from(await blob.arrayBuffer());return {bytes,xml:await (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('text')};}
 const complete=await make();expect(complete.xml).toContain('Назначенное расписание рассчитано');expect(complete.xml).toContain('разность массы через ЦКОД');expect(complete.xml).toContain('После перекрытия');expect(complete.xml).toContain('Герметичное перекрытие задано пользователем');expect(complete.xml).toContain('накопленная невязка');expect(complete.xml).toContain('Чувствительность к сетке и шагу');expect(complete.xml).toContain('L1 состава (0-2)');expect(complete.xml).toContain('без твёрдых пробок');
 if(dir)writeFileSync(join(dir,'transport-report.docx'),complete.bytes);
 const stale=await make({...p.wellData,stopStorage:{...p.wellData.stopStorage,surfaceBackpressureMPa:2}});expect(stale.xml).toContain('Результат устарел');expect(stale.xml).not.toContain('накопленная невязка');expect(stale.xml).not.toContain('1D-перенос: давление');
 const off=await make(p.wellData,{...selection,compressibleTransport:false});expect(off.xml).not.toContain('накопленная невязка');expect(off.xml).not.toContain('Чувствительность к сетке и шагу');
},45000);

it('exports actual prescribed-boundary events and invalidates them after a setting change',async()=>{const p=studyFixture();p.wellData.stopStorage={...p.wellData.stopStorage,flowClosureEnabled:true,flowClosureTimeMin:buildProcessContract(p).totalTimeMin-1/60,flowStepSeconds:.5};const result=simulateCompressibleTransport(p);expect(result.status,result.reason).toBe('complete');const volumes=calculateVolumes(p.wellData,p.slurries),pressureResult=calculatePressureProfile(p.wellData,p.slurries,p.buffers,p.drillingFluid,p.displacementFluids,p.fractureGradient,volumes.displacementVolumeWithCompression);const selection=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,k==='compressibleTransport']));const blob=await exportToDocx(p.wellData,p.drillingFluid,p.slurries,p.buffers,p.displacementFluids,p.fractureGradient,undefined,[],{volumes,pressureResult,flushTimeMin:0,flushVolumeM3:0},{returnBlob:true,selection,extras:{compressibleTransport:result}});if(!blob)throw new Error('No DOCX');const xml=await (await JSZip.loadAsync(await blob.arrayBuffer())).file('word/document.xml').async('text');expect(xml).toContain('Герметичное перекрытие задано пользователем');expect(xml).toContain('не прогноз посадки');},45000);
