import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {rheologyChartData} from './rheology-data';
import {rheologyFigure,rheologyCsv} from './rheology-figure';
import {rheologyReportFigures,rheologyReportFluids} from './rheology-report';
import {rheologyCoverage} from './rheology-workbook';
import {cementingNumericCharts,cementingChartsWorkbook,numericChartRows} from './cementing-chart-data';
import {getCementingExample} from './cementing-example';
import {RPM_TO_SHEAR,DIAL_TO_PA,type RheologyInput} from './cement-rheology';
const fann=Object.fromEntries([600,300,200,100,6,3].map(rpm=>['r'+rpm,(4+.4*(rpm*RPM_TO_SHEAR)**.6)/DIAL_TO_PA]));
const r:RheologyInput={pv:30,yp:5,model:'hb',fann};
function input(){const ex=getCementingExample();return {...ex,drillingFluid:{...ex.drillingFluid,name:'Одинаковое имя',rheology:r,rheologyBottomhole:{...r,model:'pvyp' as const}},buffers:ex.buffers.slice(0,1).map(f=>({...f,name:'Одинаковое имя',rheology:{pv:0,yp:0}})),slurries:ex.slurries.map(f=>({...f,name:'Одинаковое имя',rheology:r}))};}
const empty={points:[],envelope:[],stageBoundaries:[],observation:undefined,stopStorage:undefined};
describe('rheology numeric export from plotted samples',()=>{
 it('all measured markers, model-grid values and signed residuals match their full XLSX sheets and CSV',()=>{
  const p=input(),state={...empty,rheologyInput:p},before=JSON.stringify(p),plots=cementingNumericCharts(state),figures=rheologyReportFigures(p);
  expect(plots.map(p=>({svg:p.svg,data:p.data}))).toEqual(figures.map(p=>({svg:p.svg,data:p.data})));expect(plots.length).toBeGreaterThan(4);
  for(const plot of plots){expect(plot.svg).not.toMatch(/NaN|Infinity/);expect(plot.data.xValues).toEqual([...plot.data.xValues].sort((a,b)=>a!-b!));
   if(plot.plotId.endsWith('-flow')){const s=plot.data.series.find(s=>s.markersOnly)!;expect(s.values.filter(v=>v!==null)).toHaveLength(6);expect(plot.svg.match(/<circle /g)).toHaveLength(6);}
  }
  const w=cementingChartsWorkbook(state),book=XLSX.read(XLSX.write(w,{type:'array',bookType:'xlsx'}),{type:'array'}),catalog=XLSX.utils.sheet_to_json(book.Sheets['Карта графиков'],{header:1}) as unknown[][];
  const names=catalog.filter(row=>String(row[2]).startsWith('График ')).map(row=>row[2]);expect(new Set(names).size).toBe(plots.length);
  let i=0;for(const plot of plots){const sheet='График '+String(++i).padStart(2,'0');expect(XLSX.utils.sheet_to_json(book.Sheets[sheet],{header:1,defval:null})).toEqual(numericChartRows(plot));}
  const flow=rheologyFigure(r)!,residual=rheologyFigure(r,true)!,d=rheologyChartData(r),csv=rheologyCsv(r).split('\n').slice(3).map(row=>row.split(';').map(Number));
  for(const m of d.measurements){const a=flow.data.xValues.indexOf(m.gamma),b=residual.data.xValues.indexOf(m.gamma),line=csv.find(row=>row[0]===m.rpm)!;
   expect(flow.data.series.at(-1)!.values[a]).toBe(m.tau);for(let k=0;k<3;k++){expect(flow.data.series[k].values[a]).toBeCloseTo(line[3+k],12);expect(residual.data.series[k].values[b]).toBeCloseTo(line[6+k],12);}expect(residual.data.series[3].values[b]).toBeCloseTo(line[10],12);
  }
  expect(JSON.stringify(p)).toBe(before);
 });
 it('distinguishes applied legacy-bounded parameters from candidate fits and marks invalid selection without a fake applied curve',()=>{
  const steep={pv:30,yp:5,fann:Object.fromEntries([600,300,200,100,6,3].map(rpm=>['r'+rpm,(rpm*RPM_TO_SHEAR)**1.6/DIAL_TO_PA]))};
  const d=rheologyChartData(steep);expect(d.applied.params!.n).toBe(1.2);expect(d.original.fit!.hb.n).toBeGreaterThan(1.2);
  expect(d.curves.at(-1)!.values).not.toEqual(d.curves[2].values);
  const bad=rheologyFigure({...r,model:'powerLaw',fann:{...fann,r3:-1}})!;
  expect(rheologyChartData({...r,model:'powerLaw',fann:{...fann,r3:-1}}).applied.valid).toBe(false);expect(bad.data.series.some(s=>s.name.startsWith('Выбранная модель'))).toBe(false);expect(bad.svg).toContain('отрицательные');
 });
 it('preserves zero and missing raw readings and identifies the model defaults without fabricating measured curves',()=>{
  const p=input();p.drillingFluid.rheology={...r,model:'pvyp',fann:{...fann,r3:0,r6:undefined}};
  const book=cementingChartsWorkbook({...empty,rheologyInput:p}),raw=XLSX.utils.sheet_to_json(book.Sheets['Реология - замеры'],{header:1,defval:null}) as unknown[][];
  const zero=raw.find(row=>row[0]==='mud'&&row[2]===3)!,missing=raw.find(row=>row[0]==='mud'&&row[2]===6)!;expect(zero[3]).toBe(0);expect(zero[5]).toBe(0);expect(zero[6]).toContain('Исключено');expect(missing[3]).toBeNull();expect(missing[5]).toBeNull();
  const fallback=rheologyCoverage(p).find(f=>f.id==='buffer-1')!;expect(fallback.status).toContain('Нет аппроксимации');expect(fallback.appliedSource).toContain('не измерения');
  const models=XLSX.utils.sheet_to_json(book.Sheets['Реология - модели'],{header:1,defval:null}) as unknown[][];expect(models.find(row=>row[0]==='buffer-1')![8]).toBeNull();
  expect(rheologyReportFigures(p).some(f=>f.plotId.includes('buffer-1'))).toBe(false);
  const fluids=rheologyReportFluids(p);expect(new Set(fluids.map(f=>f.id)).size).toBe(fluids.length);
 });
 it('honors the rheology checkbox and keeps excluded data out of catalog, sheets and figures',()=>{
  const p=input(),state={...empty,rheologyInput:p},selection={rheology:false},w=cementingChartsWorkbook(state,undefined,selection);
  expect(cementingNumericCharts(state,undefined,selection)).toEqual([]);expect(w.SheetNames.some(s=>s.startsWith('Реология'))).toBe(false);expect(w.SheetNames.some(s=>s.startsWith('График '))).toBe(false);
  expect(XLSX.utils.sheet_to_json(w.Sheets['Карта графиков'],{header:1}).some(row=>String(row).includes('Реология'))).toBe(false);
 });
});
