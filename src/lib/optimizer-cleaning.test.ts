import {describe,it,expect} from 'vitest';
import {cleaningTarget,scheduleCleaning,remapCleaningLab,cleaningFlow,buildHighQualityScenario,auditCleaningTransit} from './optimizer-cleaning';
import {qualityCentralizerPlan,evaluateProgram} from './cement-optimizer';
import {normalizeWellData} from './cementing-normalizers';
import {buildProcessContract} from './cementing-process';
import {createAnnularGeometry} from './well-geometry';
import {labFluids,removalIssue,normalizeFluidLab} from './fluid-interaction-lab';
import type {PressureProfileResult} from './cementing-calculations';
import {qualityInput as input,withQualityProof as withProof,qualitySettings as settings} from './__tests__/fixtures/optimizer-cleaning-fixture';
describe('quality cleaning design',()=>{
 it('extends 150 vertical metres, not 150 MD, and uses integrated local geometry',()=>{
  const p=input(),t=cleaningTarget(p.wellData);
  expect(t.topMD).toBeCloseTo(200);expect(t.bottomMD).toBe(550);expect(t.aboveActualM).toBeCloseTo(150);
  expect(t.volumeM3).toBeCloseTo(createAnnularGeometry(p.wellData,600).volume(200,550),10);
  const changed={...p.wellData,cavernIntervals:[{fromMD:300,toMD:400,coeff:1.5}]};
  expect(cleaningTarget(changed).volumeM3).toBeGreaterThan(t.volumeM3);
  expect(()=>cleaningTarget({...p.wellData,reservoirLayers:[]})).toThrow('пластов');
  expect(()=>cleaningTarget({...p.wellData,trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:300,tvd:300,zenith:0,azimuth:0},{md:600,tvd:200,zenith:110,azimuth:0}]})).toThrow('восходящей');
 });
 it('switches the entire surface schedule after chemical tail transit, including cement and displacement, with exact volumes',()=>{
  const p=input(),before=JSON.stringify(p),t=cleaningTarget(p.wellData),x=scheduleCleaning(p,p.buffers[0],p.buffers[1],t,120,30,20,20),contract=buildProcessContract(x.program);
  expect(x.chemical.volume).toBeGreaterThanOrEqual(t.volumeM3);expect(x.heavy.volume).toBeCloseTo(t.volumeM3+5);
  let sum=0;for(const st of contract.stages.filter(s=>s.destination==='well')){
   const mid=sum+st.volumeM3/2;expect(st.rateLps).toBe(mid<x.change?10:mid<x.heavyEnd?30:20);sum+=st.volumeM3;
  }
  expect(contract.canRun).toBe(true);expect(contract.volumeResidualM3).toBeCloseTo(0,9);
  expect(contract.stages.some(s=>s.kind==='cement'&&s.rateLps===10)||contract.stages.some(s=>s.kind==='displacement'&&s.rateLps===10)).toBe(true);
  expect(JSON.stringify(p)).toBe(before);
  const absolute={...p.buffers[0],additives:[{...p.buffers[0].additives[0],percentage:0,massKg:50}]};
  expect(()=>scheduleCleaning(p,absolute,p.buffers[1],t,10000,30,20,20)).toThrow('абсолютной массой');
 });
 it('keeps measured 85% as evidence and remaps only unchanged recipes when buffers move',()=>{
  const p=withProof(input()),next={...p,buffers:[p.buffers[1],p.buffers[0]]},lab=remapCleaningLab(p,next)!;
  expect(lab.removal[0].cleanerId).toBe('buffer:1');expect(removalIssue(lab.removal[0],lab,labFluids(next))).toBeNull();
  const changed={...next,buffers:[next.buffers[0],{...next.buffers[1],density:1200}]},stale=remapCleaningLab(p,changed)!;
  expect(removalIssue(stale.removal[0],stale,labFluids(changed))).toContain('изменён');
  expect(normalizeFluidLab(p.wellData.fluidInteractionLab)?.removal[0].removalPct).toBe(86);
  const bad={...lab.removal[0],removalPct:101};expect(removalIssue(bad,lab,labFluids(next))).toContain('0 до 100');
 });
 it('does not relabel water-like chemistry laminar just because the target says so',async()=>{
  const p=withProof(input());p.buffers[0]={...p.buffers[0],rheology:{pv:1,yp:0}};
  expect(cleaningFlow(p.wellData,p.buffers[0],400,10).regime).toBeGreaterThan(0);
  const plan=qualityCentralizerPlan(p,settings);
  const r=await buildHighQualityScenario(p,settings,[plan],()=>{throw Error('Must not evaluate rejected rheology');});
  expect(r.ready).toBe(false);expect(r.issues.join(' ')).toContain('не ламинарное');
 });
 it('builds and rechecks the actual prepared program in the native hydraulic solver',async()=>{
  const p=withProof(input()),plan=qualityCentralizerPlan(p,settings);
  const r=await buildHighQualityScenario(p,settings,[plan],(pp,v,cp,full,onPressure)=>evaluateProgram(pp,v,settings,undefined,cp.profile,{preserveSteps:true,fast:!full,onPressure}));
  expect(r.ready).toBe(true);
  const shifted={...p,wellData:{...p.wellData,turbulatorDesign:r.program!.wellData.turbulatorDesign,reservoirLayers:p.wellData.reservoirLayers!.map(l=>({...l,bottomMD:500}))}};
  const next=await buildHighQualityScenario(shifted,settings,[qualityCentralizerPlan(shifted,settings)],(pp,v,cp,full,onPressure)=>evaluateProgram(pp,v,settings,undefined,cp.profile,{preserveSteps:true,fast:!full,onPressure}));
  const ids=next.program!.wellData.turbulatorDesign!.points.map(x=>x.id);
  expect(new Set(ids).size).toBe(ids.length);expect(next.program!.wellData.turbulatorDesign!.points.some(x=>x.md===550)).toBe(true);
  expect(r.design).toBeDefined();
  expect(r.program?.buffers[0].additives).toEqual(p.buffers[0].additives);
  expect(r.program?.wellData.turbulatorDesign?.points.length).toBeGreaterThan(1);
  expect(r.evaluation?.feasible).toBe(true);
  expect(r.design?.proof?.removalPct).toBe(86);
  const saved=normalizeWellData(JSON.parse(JSON.stringify({...r.program!.wellData,optimizerCleaning:r.design})));
  expect(saved.optimizerCleaning).toEqual(r.design);
  const missing=input(),unconfirmed=await buildHighQualityScenario(missing,settings,[qualityCentralizerPlan(missing,settings)],(pp,v,cp,full,onPressure)=>evaluateProgram(pp,v,settings,undefined,cp.profile,{preserveSteps:true,fast:!full,onPressure}));
  expect(unconfirmed.design).toBeDefined();expect(unconfirmed.ready).toBe(true);
  expect(unconfirmed.design?.proof).toBeUndefined();expect(unconfirmed.warnings.join(';')).toContain('фактический процент неизвестен');

 },60000);
 it('rejects a short or incomplete actual transit, independently of the planned volume',()=>{
  const p=withProof(input()),t=cleaningTarget(p.wellData);
  const point={time:1,annularReturnRate:20,transportColumns:{pipe:[],annulus:[{fluidId:'buffer:0',fluidType:'buffer',topMD:0,botMD:600,volumeM3:10}]}};
  const r={points:[{...point,time:0},point]} as unknown as PressureProfileResult;
  const audit=auditCleaningTransit(p,t,r,p.wellData.fluidInteractionLab!.removal[0]);
  expect(audit.issues.join(';')).toContain('10 л/с');expect(audit.issues.join(';')).toContain('время');
 });
});
