import {it,expect} from 'vitest';
import {studyFixture,flowFixture} from '@/test/fixtures/compressible-flow';
import {simulateCompressibleTransport} from './compressible-transport';
import {transportRefinementInputs,summarizeTransportRefinement,compositionDistance} from './transport-refinement';

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

it('does not mix internal-boundary runs into the open-contour study',()=>{const p=studyFixture();p.wellData.stopStorage={...p.wellData.stopStorage,flowCheckValve:true};expect(()=>transportRefinementInputs(p)).toThrow('открытого контура');});
