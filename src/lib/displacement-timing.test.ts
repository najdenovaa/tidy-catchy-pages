import {describe,it,expect} from 'vitest';
import {simulateDisplacement2D,type D2Input} from './displacement-2d';
import {normalizeDisplacementTiming,validateFrameBudget} from './displacement-timing';
import {displacementReportKey} from './cementing-report-data';
import {getCementingExample} from './cementing-example';
import {calculateVolumes} from './cementing-calculations';
import {buildPipeTransport,displacementTimeline} from './displacement-pipe';
const input=():D2Input=>({zTop:0,zBot:30,nZ:20,nTheta:6,geom:()=>({rHole:.108,rCasing:.073,standoff:1,inclDeg:0}),fluids:[{name:'Раствор',kind:'mud',density:1100,pv:.02,yp:2},{name:'Цемент',kind:'cement',density:1100,pv:.02,yp:2}],stages:[{fluid:1,volumeM3:.08,rateM3s:.001},{fluid:1,volumeM3:0,rateM3s:0,holdS:7}],settleMin:.1});
const error=(a:ReturnType<typeof simulateDisplacement2D>,b:ReturnType<typeof simulateDisplacement2D>)=>a.finalFrac[1].reduce((s,v,i)=>s+Math.abs(v-b.finalFrac[1][i]),0)/a.finalFrac[1].length;
describe('independent displacement time controls',()=>{
 it('changes saved frames without changing any final fraction, step count or balance',()=>{
  const a=simulateDisplacement2D({...input(),maxTimeStepS:2,frameIntervalS:7}),b=simulateDisplacement2D({...input(),maxTimeStepS:2,frameIntervalS:15});
  expect(a.finalFrac).toEqual(b.finalFrac);expect(a.summary.steps).toBe(b.summary.steps);expect(a.summary.massBalanceErrPct).toBe(b.summary.massBalanceErrPct);expect(a.snapshots.length).not.toBe(b.snapshots.length);
  for(const r of [a,b]){expect(r.snapshots[r.pumpEndSnap].t).toBeCloseTo(87,8);expect(r.snapshots.at(-1)!.t).toBeCloseTo(93,8);expect(r.summary.timing!.complete).toBe(true);expect(r.summary.timing!.maxStepS).toBeLessThanOrEqual(2+1e-9);expect(r.summary.timing!.actualSettleS).toBeCloseTo(6,8);expect(r.summary.timing!.frames).toBe(r.snapshots.length);}
 });
 it('really refines dt and exhibits convergence on the same transport problem',()=>{
  const a=simulateDisplacement2D({...input(),maxTimeStepS:2}),b=simulateDisplacement2D({...input(),maxTimeStepS:1}),c=simulateDisplacement2D({...input(),maxTimeStepS:.5});
  expect(a.summary.steps).toBeLessThan(b.summary.steps);expect(b.summary.steps).toBeLessThan(c.summary.steps);
  expect(error(b,c)).toBeLessThan(error(a,b));expect(error(b,c)).toBeLessThan(.01);
  for(const r of [a,b,c]){expect(Math.abs(r.summary.massBalanceErrPct)).toBeLessThan(.01);for(const fractions of r.finalFrac)for(const value of fractions){expect(value).toBeGreaterThanOrEqual(0);expect(value).toBeLessThanOrEqual(1);}}
 });
 it('lets the stability criterion reduce a large requested cap',()=>{
  const r=simulateDisplacement2D({...input(),maxTimeStepS:60,stages:[{fluid:1,volumeM3:.5,rateM3s:.01}],settleMin:0});
  expect(r.summary.timing!.maxStepS).toBeGreaterThan(0);expect(r.summary.timing!.maxStepS).toBeLessThan(10);expect(r.summary.timing!.complete).toBe(true);
 });
 it('records only actual step ends when frames are requested more frequently than dt',()=>{
  const r=simulateDisplacement2D({...input(),maxTimeStepS:2,frameIntervalS:.5});
  expect(r.snapshots[1].t).toBe(2);expect(r.snapshots.length).toBeLessThan(100);expect(r.summary.timing!.targetFrameIntervalS).toBe(.5);
  expect(r.snapshots.every((s,i)=>i===0||s.t>r.snapshots[i-1].t)).toBe(true);
 });
 it('rejects invalid controls and excessive storage/work before a long run',()=>{
  for(const v of [-1,.001,Infinity,NaN,61])expect(()=>normalizeDisplacementTiming({maxTimeStepS:v})).toThrow('Максимальный шаг');
  expect(normalizeDisplacementTiming({maxTimeStepS:0,frameIntervalS:0})).toEqual({maxTimeStepS:undefined,frameIntervalS:undefined});
  expect(()=>simulateDisplacement2D({...input(),frameIntervalS:.01})).toThrow('Интервал кадров слишком мал');
  expect(()=>simulateDisplacement2D({...input(),maxTimeStepS:.01,stages:[{fluid:1,volumeM3:3,rateM3s:.001}]})).toThrow('числа шагов');
  expect(()=>validateFrameBudget(100,1,3,10)).toThrow('до 10 кадров');
 });
 it('keeps playback out of cache identity, but invalidates both numerical controls',()=>{
  const ex=getCementingExample(),p={...ex,volumes:calculateVolumes(ex.wellData,ex.slurries)},s={fine:false,rotationRpm:0,settleMin:0};
  expect(displacementReportKey(p,s)).toBe(displacementReportKey(p,{...s,playbackMs:45,maxTimeStepS:0,frameIntervalS:0}));
  expect(displacementReportKey(p,s)).not.toBe(displacementReportKey(p,{...s,maxTimeStepS:1}));expect(displacementReportKey(p,s)).not.toBe(displacementReportKey(p,{...s,frameIntervalS:15}));
 });
 it('uses the frame interval in pipe-only mode, including hold/stage boundaries',()=>{
  const p=buildPipeTransport(input().fluids,[{topMD:0,bottomMD:10,startM3:0,endM3:1}],[{fluid:1,volumeM3:2,rateM3s:.1},{fluid:1,volumeM3:0,rateM3s:0,holdS:7}]),frames=displacementTimeline(p,null,0,0,5);
  expect(frames.map(f=>f.timeS)).toEqual([0,5,10,15,20,25,27]);
 });
});
