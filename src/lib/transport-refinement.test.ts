import {it,expect} from 'vitest';
import {studyFixture,flowFixture} from '@/test/fixtures/compressible-flow';
import {buildProcessContract} from './cementing-process';
import {transportMesh} from './transport-mesh';
import {simulateCompressibleTransport} from './compressible-transport';
import {transportRefinementInputs,summarizeTransportRefinement,compositionDistance,compareTransportPressure} from './transport-refinement';

it('separates actual spatial and temporal refinement and closes every full run',()=>{
 const p=studyFixture(),plan=transportRefinementInputs(p),runs=plan.map(x=>simulateCompressibleTransport(x.input));for(const r of runs)expect(r.status,r.reason).toBe('complete');
 expect(runs.map(r=>r.cellCount)).toEqual([4,8,16,4,4]);expect(runs.map(r=>r.stepSeconds)).toEqual([10,10,10,5,2.5]);
 const s=summarizeTransportRefinement(p,runs);expect(s.rows).toHaveLength(5);expect(s.comparisons).toHaveLength(4);expect(s.rows.every(r=>r.maxMassResidualKg<.001)).toBe(true);expect(s.comparisons.every(r=>Number.isFinite(r.compositionL1)&&r.compositionL1>=0&&r.compositionL1<=2)).toBe(true);
 expect(compositionDistance(runs[0],runs[0])).toBeCloseTo(0,12);
 const stopped=runs.map((r,i)=>i===1?{...r,status:'stopped' as const}:r);expect(summarizeTransportRefinement(p,stopped).comparisons).toHaveLength(2);
 expect(()=>summarizeTransportRefinement(p,[runs[1],...runs.slice(1)])).toThrow('плану');
});
it('rejects an impossible study before launching any work',()=>{expect(()=>transportRefinementInputs(flowFixture())).toThrow('пяти прогонов');const p=studyFixture();p.wellData.stopStorage.flowStepSeconds=.2;expect(()=>transportRefinementInputs(p)).toThrow('пяти прогонов');});
it('integrates composition over physical volume rather than matching cell indexes',()=>{
 const p=studyFixture(),r=simulateCompressibleTransport(p),half=structuredClone(r);
 half.profile=r.profile.flatMap(c=>[{...c,volumeM3:c.volumeM3/2},{...c,volumeM3:c.volumeM3/2}]);expect(compositionDistance(r,half)).toBeCloseTo(0,12);
 half.profile[0].volumeM3*=2;expect(()=>compositionDistance(r,half)).toThrow('вместимости');
});

it('refines every nonuniform boundary interval and compares complete boundary runs',()=>{
 const p=studyFixture();p.wellData.ckodDepth=60;p.wellData.stopStorage={...p.wellData.stopStorage,flowCheckValve:true,flowClosureEnabled:true,flowClosureTimeMin:buildProcessContract(p).totalTimeMin-1/60,flowStepSeconds:1};
 const plan=transportRefinementInputs(p),runs=plan.map(x=>simulateCompressibleTransport(x.input));for(const r of runs)expect(r.status,r.reason).toBe('complete');
 expect(runs.map(r=>r.cellCount)).toEqual([6,12,24,6,6]);const s=summarizeTransportRefinement(p,runs);expect(s.comparisons).toHaveLength(4);expect(s.rows.slice(0,3).map(x=>x.minCellLengthM)).toEqual([20,10,5]);expect(s.rows.every(x=>x.maxMassResidualKg<.001)).toBe(true);
 expect(s.comparisons.every(x=>x.beforeClosureMPa!==undefined&&x.afterClosureMPa!==undefined&&x.barrierTransferredDifferenceKg!==undefined)).toBe(true);
 for(const r of runs){const event=r.boundaryEvents.find(e=>e.kind==='prescribedSeal');expect(event.timeMin).toBeCloseTo(p.wellData.stopStorage.flowClosureTimeMin,9);expect(r.frames.filter(f=>f.sealClosed).every(f=>f.barrierFlowKgS===0)).toBe(true);}
 const bad=runs.map((r,i)=>i===1?{...r,boundaryEvents:[]}:r);expect(()=>summarizeTransportRefinement(p,bad)).toThrow('События');
},20000);
it('keeps boundary cuts nested and checks the true refined count before launching',()=>{const a=transportMesh(80,40,60,1),b=transportMesh(80,40,60,4);expect(a.cuts.every(x=>b.cuts.includes(x))).toBe(true);expect(b.cuts).toHaveLength(13);expect(()=>transportMesh(1500,100,1499,4)).toThrow('120');expect(()=>transportMesh(1e12,10)).toThrow('120');});
it('never bridges the closure jump or invents missing post-event coverage',()=>{const r=simulateCompressibleTransport(studyFixture());const frame=(timeMin:number,inletMPa:number,sealClosed=false)=>({...r.frames[0],timeMin,inletMPa,sealClosed});const a={...r,frames:[frame(0,0),frame(1,0),frame(1.1,100,true),frame(2,100,true)]},b={...r,frames:[frame(0,0),frame(1,0),frame(1.2,100,true),frame(2,100,true)]};const d=compareTransportPressure(a,b,1);expect(d.maxInletDifferenceMPa).toBe(0);expect(d.afterComparisonStartMin).toBe(1.2);const empty=compareTransportPressure(a,{...b,frames:b.frames.slice(0,2)},1);expect(empty.afterClosureMPa).toBeUndefined();});
