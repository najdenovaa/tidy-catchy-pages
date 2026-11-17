import {describe,it,expect} from 'vitest';
import {buildPipeTransport,pipePumpedAt,pipeDepthComposition,pipeBalance,pipeShoeStages,displacementTimeline,pipeHistoryPlots} from './displacement-pipe';
import {pipeWorkbook} from './displacement-pipe-workbook';
import * as XLSX from 'xlsx';
const fluids=[{name:'Mud',kind:'mud' as const,density:1100,pv:.02,yp:3},{name:'Cement',kind:'cement' as const,density:1800,pv:.04,yp:5},{name:'Displacement',kind:'other' as const,density:1000,pv:.001,yp:0}];
const pipe=()=>buildPipeTransport(fluids,[{topMD:0,bottomMD:10,startM3:0,endM3:2},{topMD:10,bottomMD:20,startM3:2,endM3:3}], [{fluid:1,volumeM3:4,rateM3s:.1},{fluid:1,volumeM3:0,rateM3s:0,holdS:20},{fluid:2,volumeM3:5,rateM3s:.2}]);
describe('analytical conservative pipe transport',()=>{
 it('keeps the initial mud, variable capacity, exact fronts and holds',()=>{
  const p=pipe();expect(pipePumpedAt(p,50)).toBe(4);expect(pipePumpedAt(p,60)).toBe(4);
  expect(pipeDepthComposition(p,15,0)!.fractions).toEqual([1,0,0]);
  expect(pipeDepthComposition(p,15,25)!.fractions).toEqual([.5,.5,0]);
  expect(pipeDepthComposition(p,10,25)!.cell).toBe(1);
  expect(pipeDepthComposition(p,20,25)!.fractions).toEqual([.5,.5,0]);
  for(const md of [-1,21,NaN])expect(pipeDepthComposition(p,md,10)).toBeNull();
  expect(pipeDepthComposition(p,5,-1)).toBeNull();
 });
 it('independently balances each fluid before arrival, during hold and during overdisplacement',()=>{
  const p=pipe();for(const t of [0,3,25,30,40,50,60,61,75,85,1000]){
   const b=pipeBalance(p,t);expect(b.reduce((s,x)=>s+x.insideM3,0)).toBeCloseTo(3,12);
   expect(b.reduce((s,x)=>s+x.outletM3,0)).toBeCloseTo(pipePumpedAt(p,t),12);
   for(const row of b)expect(Math.abs(row.residualM3)).toBeLessThan(1e-12);
  }
  expect(pipeBalance(p,85).map(x=>x.outletM3)).toEqual([3,4,2]);
 });
 it('preserves the actual driving rate, hold, and displacement fluid at the shoe',()=>{
  const p=pipe(),out=pipeShoeStages(p);expect(out.annulusStartS).toBeCloseTo(30);
  expect(out.stages).toEqual([{fluid:1,volumeM3:1,rateM3s:.1,drivingStageId:undefined},{fluid:1,volumeM3:0,rateM3s:0,holdS:20,drivingStageId:undefined},{fluid:1,volumeM3:3,rateM3s:.2,drivingStageId:undefined},{fluid:2,volumeM3:2,rateM3s:.2,drivingStageId:undefined}]);
  for(let i=1;i<3;i++)expect(out.stages.filter(s=>s.fluid===i).reduce((v,s)=>v+s.volumeM3,0)).toBeCloseTo(pipeBalance(p,85)[i].outletM3,12);
 });
 it('does not invent an arrival before pipe capacity is displaced',()=>{
  const p=buildPipeTransport(fluids,pipe().segments,[{fluid:1,volumeM3:1,rateM3s:.1}]);expect(pipeShoeStages(p).stages).toEqual([]);expect(pipeBalance(p,10)[1].insideM3).toBe(1);
 });
 it('shares exact time arrays and numeric fractions with XLSX, including full pipe-only timeline',()=>{
  const p=pipe(),frames=displacementTimeline(p,null,0,1);expect(frames[0].timeS).toBe(0);expect(frames[frames.length-1].timeS).toBe(145);
  const plot=pipeHistoryPlots(p,['#123456','#654321','#abcdef'],15,frames)[0];expect(plot.data.xValues).toEqual(frames.map(f=>f.timeS/60));
  const wb=pipeWorkbook(p,15,frames,0),rows=XLSX.utils.sheet_to_json(wb.Sheets['Труба - доли'],{header:1}) as number[][];
  expect(rows.slice(1).map(row=>row[4])).toEqual(plot.data.series[1].values);
 });
});
