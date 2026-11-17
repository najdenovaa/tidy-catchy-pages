import { describe,it,expect } from 'vitest';
import * as XLSX from 'xlsx';
import { displacementDepthHistory,displacementHistoryPlots,type HistoryResult } from './displacement-depth-history';
import { displacementHistoryWorkbook } from './displacement-history-workbook';
import { simulateDisplacement2D } from './displacement-2d';
import { allowedReportFigure } from './cementing-report-options';

export function fixture():HistoryResult{return {
 nZ:2,nTheta:2,zCenters:new Float64Array([105,115]),gap:new Float32Array([3,1,1,1]),
 fluids:[{name:'Раствор',kind:'mud',density:1100,pv:.02,yp:5},{name:'Цемент',kind:'cement',density:1850,pv:.05,yp:8}],
 snapshots:[{t:0,stage:0,frac:new Uint8Array([255,255,255,255,0,0,0,0])},{t:60,stage:1,frac:new Uint8Array([255,0,127,0,0,255,127,255])}]
};}
describe('saved annular concentration history',()=>{
 it('weights by gap and normalizes each quantized cell exactly like the scene',()=>{
  const r=fixture(),h=displacementDepthHistory(r,102)!;
  expect(h.cell).toBe(0);expect(h.topMD).toBe(100);expect(h.bottomMD).toBe(110);
  expect(h.rows.map(x=>x.fractions)).toEqual([[1,0],[.75,.25]]);
  expect(displacementDepthHistory(r,110)!.rows[1].fractions).toEqual([.25,.75]);
 });
 it('never clamps out-of-domain depths or invents missing composition',()=>{
  const r=fixture();for(const md of [99,121,NaN,Infinity])expect(displacementDepthHistory(r,md)).toBeNull();
  expect(displacementDepthHistory(r,120)!.cell).toBe(1);
  r.snapshots[1].frac.fill(0);expect(displacementDepthHistory(r,105)!.rows[1].fractions).toEqual([null,null]);
 });
 it('uses identical full arrays in graph and numeric export, with explicit time origin',()=>{
  const r=fixture(),h=displacementDepthHistory(r,105)!,plot=displacementHistoryPlots(r,['#123456','#654321'],105)[0];
  expect(plot.data.xValues).toEqual(h.rows.map(x=>x.timeS/60));
  expect(plot.data.series[1].values).toEqual([0,25]);
  const w=displacementHistoryWorkbook(r,105,1,120),rows=XLSX.utils.sheet_to_json(w.Sheets['Доли во времени'],{header:1});
  expect(rows[2]).toEqual([1,60,180,105,75,25]);
  expect(allowedReportFigure('cementing',undefined,plot)).toBe(true);
  expect(allowedReportFigure('running',undefined,plot)).toBe(false);
  expect(allowedReportFigure('cementing',{displacementHistory:false},plot)).toBe(false);
 });
 it('agrees with the actual solver end profile within saved-frame quantization precision',()=>{
  const r=simulateDisplacement2D({zTop:0,zBot:100,nZ:12,nTheta:8,maxSnapshots:15,settleMin:0,geom:()=>({rHole:.108,rCasing:.073,standoff:.3,inclDeg:65}),fluids:fixture().fluids,stages:[{fluid:1,volumeM3:1.2,rateM3s:.01}]});
  for(let j=0;j<r.nZ;j++){
    const h=displacementDepthHistory(r,r.zCenters[j])!,last=h.rows.at(-1)!;
    expect(last.timeS).toBe(r.snapshots.at(-1)!.t);
    expect(last.fractions.reduce((s,x)=>s+(x??0),0)).toBeCloseTo(1,12);
    expect(Math.abs(last.fractions[1]!-r.rows[j].cement)).toBeLessThan(.005);
  }
 });
});
