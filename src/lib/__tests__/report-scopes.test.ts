// @vitest-environment node
import{it,expect}from'vitest';
import JSZip from'jszip';
import{mkdirSync,writeFileSync,readFileSync,existsSync}from'node:fs';
import{join}from'node:path';
import{getCementingExample}from'../cementing-example';
import{resolveCentralizationReport,type ReportFigure}from'../cementing-report-data';
import{buildCementingReportSvgs,buildWellReportSvgs}from'../cementing-report-figures';
import{hydraulicReportCharts,depthReportCharts}from'../cementing-report-charts';
import{exportCasingDesignDocx}from'../export-casing-design-docx';
import{exportToDocx}from'../export-docx';
import{allowedReportFigure,defaultReportSelection,type ReportScope}from'../cementing-report-options';
import{calculateVolumes,calculatePressureProfile}from'../cementing-calculations';
import{cementFleetLayout}from'../cement-fleet-layout';
import{fleetTemplate}from'../cement-fleet-catalog';
import{planLogistics,DEFAULT_LOGISTICS}from'../cement-logistics';
const ex=getCementingExample();
const well={...ex.wellData,casingDepthMD:250,wellDepthMD:260,prevCasingDepth:50,ckodDepth:235,pumpZoneTop:0,pumpZoneBottom:0,trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:260,tvd:230,zenith:40,azimuth:110}]};
const data=resolveCentralizationReport({mode:'manual',calculated:true,results:[],turbPoints:[],running:{mudDensity:ex.drillingFluid.density,pv:25,yp:5,frictionCased:.25,frictionOpenhole:.35},intervals:[{id:'c',fromMD:0,toMD:250,jointLength:12,centralizersPerJoint:1,spec:{type:'spring',bladesCount:6,bladeHeight:40,restoringForce:5,maxAxialLoad:0,passport:{model:'Центратор QA',manufacturer:'Изготовитель QA',outerDiameter:254,length:620,springLength:500,bladeWidth:40,restoringStandoff:67,note:'SECRET-PASSPORT-NOTE'}}}]},well,ex.drillingFluid.density)!;
const xml=async(blob:Blob)=>{const bytes=Buffer.from(await blob.arrayBuffer()),z=await JSZip.loadAsync(bytes);return{bytes,xml:await z.file('word/document.xml')!.async('text')};};
it('keeps all three report scopes separate and excludes passport attachments, even when given all source data',async()=>{
 for(const scope of ['centralization','running'] as const){
  const svgs=[...buildCementingReportSvgs(well,{centralization:data},scope),...buildWellReportSvgs(well,[]).filter(x=>allowedReportFigure(scope,undefined,x))];
  expect(svgs.length).toBeGreaterThan(2);for(const f of svgs)expect(f.svg).not.toMatch(/NaN|Infinity/);
  if(scope==='centralization'){expect(svgs.some(x=>x.title.startsWith('Центратор на'))).toBe(true);expect(svgs.some(x=>x.title.includes('веник'))).toBe(false);}
  else {expect(svgs.some(x=>x.title.includes('веник'))).toBe(true);expect(svgs.some(x=>x.title.startsWith('Центратор на'))).toBe(false);}
  const dir=process.env.REPORT_QA_DIR;let figures:ReportFigure[]=[];
  if(dir){mkdirSync(dir,{recursive:true});svgs.forEach((f,i)=>writeFileSync(join(dir,`scope-${scope}-${i}.svg`),f.svg));if(process.env.REPORT_QA_RASTER)figures=svgs.map((f,i)=>({...f,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`scope-${scope}-${i}.png`)).toString('base64')}));}
  const result=await xml((await exportCasingDesignDocx(well,data,ex.drillingFluid.density,scope,undefined,{returnBlob:true,figures}))!);
  expect(result.xml.includes('Потрубная ведомость')).toBe(scope==='centralization');expect(result.xml.includes('Дохождение колонны: веник')).toBe(scope==='running');
  expect(result.xml).not.toContain('ПРОГРАММА ЦЕМЕНТИРОВАНИЯ');expect(result.xml).not.toContain('SECRET-PASSPORT-NOTE');expect(result.xml).not.toContain('Паспортные поля');
  expect(result.xml).toContain('Центратор QA');if(dir)writeFileSync(join(dir,`${scope}-report.docx`),result.bytes);
 }
},45000);
it('honors unchecked sections and figures rather than merely hiding the export controls',async()=>{
 const selection=Object.fromEntries(Object.keys(defaultReportSelection('running')).map(k=>[k,false]));selection.runningLoads=true;
 const r=await xml((await exportCasingDesignDocx(well,data,ex.drillingFluid.density,'running',selection,{returnBlob:true,figures:[]}))!);
 expect(r.xml).toContain('Дохождение колонны: веник');expect(r.xml).not.toContain('Параметры спуска колонны');expect(r.xml).not.toContain('Ведомость оснастки');expect(r.xml).not.toContain('Фактические замеры');
 const vols=calculateVolumes(well,ex.slurries),pressure=calculatePressureProfile(well,ex.slurries,ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,vols.displacementVolumeWithCompression);
 const pick=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));pick.materials=true;
 const main=await xml((await exportToDocx(well,ex.drillingFluid,ex.slurries,ex.buffers,ex.displacementFluids,ex.fractureGradient,undefined,data.results,{volumes:vols,pressureResult:pressure},{returnBlob:true,selection:pick,extras:{centralization:data}})) as Blob);
 expect(main.xml).toContain('Технологическая оснастка');expect(main.xml).toContain('Центратор / Центратор QA');expect(main.xml).not.toContain('Параметры спуска');expect(main.xml).not.toContain('Программа закачки');expect(main.xml).not.toContain('Техника, персонал и график работ');
},45000);
it('includes all actual pressure/ECD graphs and the selected-fleet top view without non-finite coordinates',()=>{
 const v=calculateVolumes(well,ex.slurries),p=calculatePressureProfile(well,ex.slurries,ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,v.displacementVolumeWithCompression);
 const charts=[...hydraulicReportCharts(p.points),...depthReportCharts(p.envelope)];
 for(const key of ['combined','pressures','rate','ecdTime','depthPressure','depthEcd','volumePressure','safeRate','flowRegime','annularFill'])expect(charts.some(c=>c.reportItem===key)).toBe(true);
 for(const c of charts)expect(c.svg).not.toMatch(/NaN|Infinity/);
 expect(hydraulicReportCharts(p.points,{combined:false}).some(c=>c.reportItem==='combined')).toBe(false);
 const settings={...fleetTemplate('single',DEFAULT_LOGISTICS),equipmentQuantities:{main:2,'reserve-ca':2,bulk:5},personnelQuantities:{engineer:2}};
 const fleet=planLogistics(p,{cementItems:[{name:'цемент',amount:40,unit:'т'}],waterTotal:20} as any,ex.slurries,settings),svg=cementFleetLayout(fleet,settings);
 expect(svg).toContain('Вода с буровой');expect(svg).toContain('Тягач + полуприцеп');expect(svg).toContain('2 ед.');expect(svg).toContain('5 ед.');expect(svg).not.toMatch(/NaN|Infinity/);
 if(process.env.REPORT_QA_DIR)writeFileSync(join(process.env.REPORT_QA_DIR,'fleet-layout.svg'),svg);
});
