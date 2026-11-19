import {describe,it,expect} from 'vitest';
import {emptyFluidLab,labFluids,compileMixtures,measuredMixture,normalizeFluidLab,removalIssue,type MixtureTest} from './fluid-interaction-lab';
import {getCementingExample} from './cementing-example';
import {normalizeCementingSnapshot} from './cementing-normalizers';
import {simulateDisplacement2D} from './displacement-2d';
import {buildDisplacementInput} from './displacement-2d-input';
import {calculateVolumes} from './cementing-calculations';
import {requiresDisplacementReport,defaultReportSelection} from './cementing-report-options';
import {labFixture} from './__tests__/fixtures/fluid-lab-fixture';
describe('F11 measured mixtures',()=>{
 it('interpolates only inside measured binary compositions and retains zero yield stress',()=>{
  const {lab,fluids}=labFixture(),data=compileMixtures(lab,fluids);expect(data.issues).toEqual([]);
  expect(measuredMixture(data.points,fluids.map((_,i)=>[i===0?.5:i===1?.5:0]),0)).toEqual({pv:.15,yp:20});expect(measuredMixture(data.points,fluids.map((_,i)=>[i===0?.95:i===1?.05:0]),0)).toBeNull();
  lab.mixtures[0].ypPa=0;expect(compileMixtures(lab,fluids).points[0].yp).toBe(0);
 });
 it('does not invent interpolation across ternary compositions',()=>{
  const points=[{id:'T1',fractions:[.2,.3,.5],pv:.5,yp:30}];expect(measuredMixture(points,[[.2],[.3],[.5]],0)).toEqual({pv:.5,yp:30});expect(measuredMixture(points,[[.3],[.3],[.4]],0)).toBeNull();
 });
 it('invalidates changed material and mismatched conditions without silently relinking',()=>{
  const {ex,lab,fluids}=labFixture();ex.drillingFluid.density+=1;expect(compileMixtures(lab,labFluids(ex)).issues.join(' ')).toContain('Состав');
  lab.mixtures[0].temperatureC=20;expect(compileMixtures(lab,fluids).issues.join(' ')).toContain('T/P');
 });
 it('rejects ambiguous, malformed and adverse protocols',()=>{
  const {lab,fluids}=labFixture();lab.mixtures.push({...lab.mixtures[0],id:'duplicate'});expect(compileMixtures(lab,fluids).issues.join(' ')).toContain('Дублирующий');
  lab.mixtures[0].observation='anomaly';expect(compileMixtures(lab,fluids).issues.join(' ')).toContain('аномалия');
  expect(normalizeFluidLab({mixtures:[{fractions:[{share:'bad'}]}]})!.mixtures[0].fractions[0].share).toBeNull();
 });
 it('persists the protocol through normalized save/reload and actual adapter',()=>{
  const {ex,lab}=labFixture(),s=normalizeCementingSnapshot(ex);expect(s.wellData.fluidInteractionLab).toEqual(lab);
  const volumes=calculateVolumes(s.wellData,s.slurries),built=buildDisplacementInput({...s,volumes});expect(built.input.labMixtures).toHaveLength(2);
  const invalid=structuredClone(s);invalid.wellData.fluidInteractionLab!.mixtures[0].source='';expect(()=>buildDisplacementInput({...invalid,volumes})).toThrow('не применима');
 });
 it('changes actual displacement when enabled, preserves per-fluid accounting and stops using measured laws during final settling',()=>{
  const {lab,fluids}=labFixture(),points=compileMixtures(lab,fluids).points.map(p=>({...p,fractions:p.fractions.slice(0,2)}));
  const input={zTop:0,zBot:25,nZ:20,nTheta:6,geom:()=>({rHole:.108,rCasing:.073,standoff:.4,inclDeg:55}),fluids:[{name:'Mud',kind:'mud' as const,density:1100,pv:.02,yp:2},{name:'Spacer',kind:'spacer' as const,density:1250,pv:.03,yp:4}],stages:[{fluid:1,volumeM3:.4,rateM3s:.002}],maxTimeStepS:.5};
  const baseline=simulateDisplacement2D(input),measured=simulateDisplacement2D({...input,labMixtures:points});expect(measured.mixtureCoverage!.measuredEvaluations).toBeGreaterThan(0);expect(measured.finalFrac).not.toEqual(baseline.finalFrac);
  const balance=measured.snapshots.at(-1)!.balance!;expect(Math.max(...balance.unexplainedM3.map(Math.abs))).toBeLessThan(1e-7);
  const settle=simulateDisplacement2D({...input,labMixtures:points,settleMin:.02});expect(settle.mixtureCoverage!.activeAtFinal).toBe(false);expect(settle.warnings.join(' ')).toContain('выдержке');
 });
 it('requires displacement even when only the new lab or final-placement report item is checked',()=>{
  const none=Object.fromEntries(Object.keys(defaultReportSelection('cementing')).map(k=>[k,false]));expect(requiresDisplacementReport(none)).toBe(false);expect(requiresDisplacementReport({...none,fluidLab:true})).toBe(true);expect(requiresDisplacementReport({...none,displacementPlacement:true})).toBe(true);
 });
});
