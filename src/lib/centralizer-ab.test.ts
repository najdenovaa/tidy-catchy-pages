// @vitest-environment node
import {describe,it,expect} from 'vitest';
import JSZip from 'jszip';
import {getCementingExample} from './cementing-example';
import {buildCentralizerJointSchedule,centralizerLayoutErrors,CENTRALIZER_PATTERNS} from './centralizer-layout';
import {buildMixedSupportProfile} from './centralizer-mixed-response';
import {calculateCentralization,type CentralizerInterval,type CentralizerSpec} from './centralization-calculations';
import {normalizeCentralizerDesign} from './equipment-library-reference';
import {centralizerInventory} from './cementing-equipment';
import {calculateCasingRunning,normalizeRunningSettings} from './casing-running-analysis';
import {resolveCentralizationReport} from './cementing-report-data';
import {centralizerReportSamples} from './cementing-report-sections';
import {buildCementingReportSvgs} from './cementing-report-figures';
import {exportCasingDesignDocx} from './export-casing-design-docx';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const spec=(model:string,force:number,running=100):CentralizerSpec=>({type:'spring',bladesCount:6,bladeHeight:30,restoringForce:force,maxAxialLoad:0,passport:{model,manufacturer:'Изготовитель '+model,outerDiameter:240,ringOD:185,length:600,springLength:500,bladeWidth:30,restoringForceKgf:force/.00980665,restoringStandoff:67,runningForceKgf:running}});
const A=spec('Изделие Альфа',8),B=spec('Изделие Бета',2,500);
const iv=(patch:Partial<CentralizerInterval>={}):CentralizerInterval=>({id:'c',fromMD:0,toMD:120,jointLength:12,centralizersPerJoint:1,spec:A,specB:B,pattern:'AB',...patch});
const well={...getCementingExample().wellData,casingDepthMD:120,wellDepthMD:120,wellDepthTVD:90,casingOD:168.3,casingWall:8.9,holeDiameter:215.9,prevCasingDepth:0,prevCasingID:244.5,cavernCoeff:1,cavernIntervals:[],casingSections:[],trajectory:[{md:0,tvd:0,zenith:40,azimuth:0},{md:120,tvd:120*Math.cos(40*Math.PI/180),zenith:40,azimuth:0}]};
describe('F34 actual A/B installation contract',()=>{
  it.each(CENTRALIZER_PATTERNS)('%s repeats per device, not joint; two devices per joint and a partial last joint',pattern=>{
    const rows=buildCentralizerJointSchedule(25,[iv({toMD:25,centralizersPerJoint:2,pattern})]),p=rows.flatMap(r=>r.placements);
    expect(p.map(x=>x.role).join('')).toBe(pattern.repeat(6).slice(0,6));expect(p).toHaveLength(6);
    expect(p[0].md).toBe(4);expect(p[1].md).toBe(8);expect(p[4].md).toBeCloseTo(24+1/3,10);
    for(const x of p)expect(x.spec).toBe(x.role==='A'?A:B);
  });
  it('splits at exact interval boundaries and restarts pattern and sparse-joint count',()=>{
    const p=buildCentralizerJointSchedule(61,[iv({fromMD:5,toMD:29,centralizersPerJoint:.5}),iv({id:'d',fromMD:29,toMD:61,centralizersPerJoint:.5})]).flatMap(r=>r.placements);
    expect(p.map(x=>[x.md,x.role])).toEqual([[11,'A'],[35,'A'],[57,'B']]);expect(p.every(x=>x.md>=5&&x.md<=61)).toBe(true);
  });
  it('preserves legacy installation positions and refuses missing B / overlapping / fractional multiple counts',()=>{
    const old=iv({toMD:25,pattern:undefined,specB:undefined});expect(buildCentralizerJointSchedule(25,[old]).flatMap(r=>r.centralizerDepths)).toEqual([6,18,25]);
    for(const xs of [[iv({specB:undefined})],[iv(),iv({id:'d',fromMD:10})],[iv({centralizersPerJoint:1.5})],[iv({centralizersPerJoint:0})]]){
      expect(centralizerLayoutErrors(120,xs).length).toBeGreaterThan(0);expect(()=>calculateCentralization(well,xs,1100)).toThrow();
      expect(calculateCasingRunning({well,intervals:xs,mudDensity:1100,pv:0,yp:0,settings:normalizeRunningSettings({})}).valid).toBe(false);
    }
  });
  it('saves the second product and sequence, including independent library provenance; incomplete B remains editable',()=>{
    const ref={entryId:'beta',revision:2,source:'Паспорт Б',basis:'passport' as const,notes:'',appliedAt:'2026-11-13T00:00:00Z',signature:'beta-snapshot'};
    const d={mode:'manual',targetStandoff:75,jointLength:12,autoSpec:A,intervals:[iv({specB:{...B,libraryReference:ref}})]};
    const saved=normalizeCentralizerDesign(JSON.parse(JSON.stringify(d)))!;expect(saved.intervals[0].specB!.libraryReference).toEqual(ref);expect(saved.intervals[0].pattern).toBe('AB');
    expect(normalizeCentralizerDesign({...d,intervals:[iv({specB:undefined})]})!.intervals[0].pattern).toBe('AB');
    expect(normalizeCentralizerDesign({...d,intervals:[iv({pattern:'BAD' as any})]})).toBeUndefined();
  });
  it('counts A and B separately in materials, with exact combined count and maker',()=>{
    const inv=centralizerInventory(120,[iv({pattern:'AAB'})]);expect(inv.map(x=>[x.model,x.quantity])).toEqual([['Изделие Альфа',7],['Изделие Бета',3]]);expect(inv[1].manufacturer).toBe('Изготовитель Изделие Бета');
  });
  it('checks the beam against qL4 formula, reaction equilibrium and the actual B force curve',()=>{
    const EI=1e7,q=100,layout=[iv()];
    const m=buildMixedSupportProfile(120,layout,168.3,EI,()=>215.9,()=>q);
    const left=m.at(54)!,right=m.at(66)!,mid=m.at(60)!;
    expect(left.loadKN).toBeCloseTo(q*12/1000,10);expect(right.loadKN).toBeCloseTo(q*12/1000,10);
    expect(mid.sagMM).toBeCloseTo(5*q*12**4/(384*EI)*1000,9);
    expect(mid.eccentricity).toBeCloseTo((left.supportEccentricity+right.supportEccentricity)/2+mid.sagMM/((215.9-168.3)/2),8);
    expect(m.at(0)).toBeNull();expect(m.at(120)).toBeNull();
    const nodes=buildCentralizerJointSchedule(120,layout).flatMap(r=>r.placements);
    expect(nodes.reduce((n,p)=>n+m.at(p.md)!.loadKN,0)).toBeCloseTo(q*120/1000,9);
    const b=m.at(66)!;expect(b.placement!.role).toBe('B');expect(b.supportEccentricity).toBeGreaterThan(left.supportEccentricity);
  });
  it('changing only B changes calculated support deformation and the running fan, using B running force and OD',()=>{
    const a=calculateCentralization(well,[iv()],1100),stiff=calculateCentralization(well,[iv({specB:A})],1100);
    expect(a.find(r=>r.md===18)!.supportEccentricity).toBeGreaterThan(stiff.find(r=>r.md===18)!.supportEccentricity!);
    expect(a.find(r=>r.md===18)!.centralizerRole).toBe('B');expect(a.some(r=>r.md%5!==0)).toBe(true);
    const input={well,intervals:[iv()],mudDensity:1100,pv:0,yp:0,settings:normalizeRunningSettings({})};
    const r=calculateCasingRunning(input),low=calculateCasingRunning({...input,intervals:[iv({specB:A})]});
    expect(r.centralizerCount).toBe(10);expect(r.unknownRunningCount).toBe(0);expect(r.final!.pullOut).toBeGreaterThan(low.final!.pullOut);
    const rigid={...B,type:'rigid' as const,passport:{...B.passport!,outerDiameter:230}};
    expect(calculateCasingRunning({...input,intervals:[iv({specB:rigid})]}).firstPassageConflictMD).not.toBeNull();
  });
  it('Word, installation list and 3D samples preserve both actual products and no passports',async()=>{
    const data=resolveCentralizationReport({mode:'manual',calculated:true,results:[],turbPoints:[],intervals:[iv()],running:{mudDensity:1100,pv:0,yp:0,frictionCased:.2,frictionOpenhole:.3}},well,1100)!;
    const samples=centralizerReportSamples(well,data);expect(samples.some(x=>x.spec.passport?.model===A.passport!.model)).toBe(true);expect(samples.some(x=>x.spec.passport?.model===B.passport!.model)).toBe(true);
    for(const x of samples)expect(x.result.md).toBe(x.result.centralizerMD);
    const svg=buildCementingReportSvgs(well,{centralization:data},'centralization');expect(svg.every(x=>!/NaN|Infinity/.test(x.svg))).toBe(true);
    const dir=process.env.REPORT_QA_DIR;let figures=[];
    if(dir){mkdirSync(dir,{recursive:true});svg.forEach((f,i)=>writeFileSync(join(dir,`ab-${i}.svg`),f.svg));if(process.env.REPORT_QA_RASTER)figures=svg.map((f,i)=>({...f,dataUrl:'data:image/png;base64,'+readFileSync(join(dir,`ab-${i}.png`)).toString('base64')}));}
    const blob=(await exportCasingDesignDocx(well,data,1100,'centralization',undefined,{returnBlob:true,figures}))!;
    const bytes=Buffer.from(await blob.arrayBuffer()),z=await JSZip.loadAsync(bytes),xml=await z.file('word/document.xml')!.async('text');
    for(const text of ['Изделие Альфа','Изделие Бета','А:','Б:','АБ','реакци'])expect(xml).toContain(text);
    expect(xml).not.toContain('ПРОГРАММА ЦЕМЕНТИРОВАНИЯ');expect(xml).not.toContain('SECRET-PASSPORT');
    if(dir)writeFileSync(join(dir,'ab-centralization.docx'),bytes);
  },45000);
});
