// @vitest-environment node
import { it,expect } from 'vitest';
import JSZip from 'jszip';
import { mkdirSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { getCementingExample } from '../cementing-example';
import { fleetTemplate } from '../cement-fleet-catalog';
import { DEFAULT_LOGISTICS } from '../cement-logistics';
import { calculatePressureProfile,calculateVolumes } from '../cementing-calculations';
import { buildBasketStopReportSvgs } from '../cementing-report-figures';
import { exportToDocx } from '../export-docx';
it('exports the selected modern fleet and basket comparison using current saved inputs',async()=>{
 const ex=getCementingExample();
 const well={...ex.wellData,logistics:{...fleetTemplate('twin',DEFAULT_LOGISTICS),manufacturer:'SERVA',unitName:'Паспорт QA-26'},equipment:[{id:'b',kind:'basket' as const,model:'AVRORA 500S QA',manufacturer:'Аврора',quantity:1,depthMD:1200,basketSupportPct:40,basketBridgeMin:5,basketCapacityKN:30}]};
 const v=calculateVolumes(well,ex.slurries),p=calculatePressureProfile(well,ex.slurries,ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,v.displacementVolumeWithCompression,0,0);
 const svgs=buildBasketStopReportSvgs(p.basketStop);
 expect(svgs).toHaveLength(1);expect(svgs[0].svg).not.toMatch(/NaN|Infinity/);
 const png=process.env.FLEET_QA_DIR+'/basket.png';
 const extras=existsSync(png)?{figures:[{title:svgs[0].title,dataUrl:'data:image/png;base64,'+readFileSync(png).toString('base64'),width:720,height:520}]}:undefined;
 const blob=await exportToDocx(well,ex.drillingFluid,ex.slurries,ex.buffers,ex.displacementFluids,ex.fractureGradient,undefined,undefined,{volumes:v,pressureResult:p},{returnBlob:true,extras});
 const bytes=Buffer.from(await (blob as Blob).arrayBuffer()),zip=await JSZip.loadAsync(bytes),xml=await zip.file('word/document.xml')!.async('text');
 for(const text of ['SERVA','Паспорт QA-26','Цементовоз ЦТ-25','Седельный тягач','Корзины: давление после Стоп','AVRORA 500S QA','несущая способность','пластового давления'])expect(xml).toContain(text);
 if(process.env.FLEET_QA_DIR){mkdirSync(process.env.FLEET_QA_DIR,{recursive:true});writeFileSync(process.env.FLEET_QA_DIR+'/fleet-basket.docx',bytes);writeFileSync(process.env.FLEET_QA_DIR+'/basket.svg',svgs[0].svg);}
},45000);
