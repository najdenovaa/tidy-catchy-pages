import {describe,it,expect} from 'vitest';
import {simulateDisplacement2D,type D2Input} from './displacement-2d';
import {AnnularVolumeLedger} from './displacement-balance';
import {annularBalanceWorkbook} from './displacement-balance-workbook';
import * as XLSX from 'xlsx';
const input=():D2Input=>({zTop:0,zBot:30,nZ:20,nTheta:6,geom:()=>({rHole:.108,rCasing:.073,standoff:.8,inclDeg:0}),fluids:[{name:'Буровой',kind:'mud',density:1100,pv:.02,yp:2},{name:'Буфер',kind:'spacer',density:1200,pv:.025,yp:3},{name:'Цемент G',kind:'cement',density:1850,pv:.04,yp:5}],stages:[{fluid:1,volumeM3:.08,rateM3s:.002},{fluid:1,volumeM3:0,rateM3s:0,holdS:2},{fluid:2,volumeM3:.2,rateM3s:.002}],settleMin:.02});
function check(r:ReturnType<typeof simulateDisplacement2D>){
 const N=r.nZ*r.nTheta;
 for(const snap of r.snapshots){const b=snap.balance!;expect(b).toBeDefined();for(let f=0;f<r.fluids.length;f++){
  const residual=b.initialM3[f]+b.sourceInM3[f]+b.boundaryInM3[f]-b.outletM3[f]-b.insideM3[f];expect(b.residualM3[f]).toBeCloseTo(residual,11);
  expect(b.unexplainedM3[f]).toBeCloseTo(residual+b.clippingM3[f]+b.normalizationM3[f],11);
  expect(Math.abs(b.unexplainedM3[f])).toBeLessThan(1e-7);
  let integral=0;for(let k=0;k<N;k++){let sum=0;for(let j=0;j<r.fluids.length;j++)sum+=snap.frac[j*N+k];integral+=r.cellVolumesM3![k]*snap.frac[f*N+k]/sum;}
  expect(integral).toBeCloseTo(b.insideM3[f]+b.quantizationM3[f],10);
  expect(b.sourceInM3[f]).toBeGreaterThanOrEqual(0);expect(b.boundaryInM3[f]).toBeGreaterThanOrEqual(0);expect(b.outletM3[f]).toBeGreaterThanOrEqual(0);
 }}
}
describe('F05 independent annular component ledger',()=>{
 it('accounts for every source portion and actual inventories, including a hold',()=>{
  const r=simulateDisplacement2D(input());check(r);const b=r.snapshots.at(-1)!.balance!;expect(b.sourceInM3[1]).toBeCloseTo(.08,9);expect(b.sourceInM3[2]).toBeCloseTo(.2,9);expect(b.sourceInM3[0]).toBe(0);expect(b.initialM3[0]).toBeCloseTo(r.cellVolumesM3!.reduce((a,b)=>a+b,0),10);
 });
 it('uses full-circumference units for both half and full meshes',()=>{
  const a=simulateDisplacement2D(input()),b=simulateDisplacement2D({...input(),fullCircle:true});check(b);
  expect(a.snapshots[0].balance!.initialM3[0]).toBeCloseTo(b.snapshots[0].balance!.initialM3[0],8);
  expect(a.snapshots.at(-1)!.balance!.sourceInM3).toEqual(expect.arrayContaining(b.snapshots.at(-1)!.balance!.sourceInM3.map(v=>expect.closeTo(v,8))));
 });
 it('distinguishes reverse boundary inflow from the pump in a tilted rotating well',()=>{
  const r=simulateDisplacement2D({...input(),geom:()=>({rHole:.108,rCasing:.073,standoff:.4,inclDeg:65}),rotationRpm:15,outlets:{top:true,bottom:true},settleMin:.2});check(r);
  const b=r.snapshots.at(-1)!.balance!;expect(b.boundaryInM3[0]).toBeGreaterThan(0);expect(b.boundaryInM3.slice(1)).toEqual([0,0]);expect(b.sourceInM3[0]).toBe(0);
 });
 it('uses actual storage capacities for a custom sheet, and does not change output with frame interval',()=>{
  const base={...input(),customGap:()=>.01,storageGap:()=>.02,arcLength:.4},a=simulateDisplacement2D({...base,frameIntervalS:10}),b=simulateDisplacement2D({...base,frameIntervalS:20});check(a);check(b);
  expect(a.snapshots[0].balance!.initialM3[0]).toBeCloseTo(.02*.4*30,9);expect(a.finalFrac).toEqual(b.finalFrac);expect(a.snapshots.at(-1)!.balance).toEqual(b.snapshots.at(-1)!.balance);
 });
 it('retains per-fluid closure when the maximum integration step is refined',()=>{
  const a=simulateDisplacement2D({...input(),maxTimeStepS:.5}),b=simulateDisplacement2D({...input(),maxTimeStepS:.25});check(a);check(b);
  const ca=a.snapshots.at(-1)!.balance!,cb=b.snapshots.at(-1)!.balance!;
  ca.sourceInM3.forEach((v,i)=>expect(cb.sourceInM3[i]).toBeCloseTo(v,9));
  const err=(x:typeof ca)=>Math.max(...x.residualM3.map(Math.abs));expect(err(cb)).toBeLessThanOrEqual(err(ca)*1.1+1e-5);
 });
 it('exposes clipping/normalization as numerical changes rather than source injection',()=>{
  const ledger=new AnnularVolumeLedger(new Float64Array([2]),[new Float64Array([1]),new Float64Array([0])],1);ledger.clipping[0]=-.2;ledger.normalization[1]=.2;
  const b=ledger.snapshot([new Float64Array([.9]),new Float64Array([.1])],new Uint8Array([230,26]));expect(b.sourceInM3).toEqual([0,0]);expect(b.residualM3[0]).toBeCloseTo(.2);expect(b.unexplainedM3.every(x=>Math.abs(x)<1e-12)).toBe(true);
 });
 it('exports the selected and all recorded ledgers, rejects legacy missing balances',()=>{
  const r=simulateDisplacement2D(input()),book=annularBalanceWorkbook(r,r.snapshots.length-1,120);expect(XLSX.utils.sheet_to_json(book.Sheets['Баланс затрубья'])).toHaveLength(3);expect(XLSX.utils.sheet_to_json(book.Sheets['Баланс все кадры'])).toHaveLength(3*r.snapshots.length);
  expect(()=>annularBalanceWorkbook({...r,snapshots:r.snapshots.map(({balance,...s})=>s)},0)).toThrow('отсутствует');
 });
});
