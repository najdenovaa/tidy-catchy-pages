import {describe,it,expect,beforeAll} from 'vitest';
import * as XLSX from 'xlsx';
import {normalizeWellData} from '../cementing-normalizers';
import {simulateFoamJob,defaultFoamSettings} from '../foam-cement-engine';
import {foamCharts,foamChartsWorkbook,currentFoamReport,foamInputKey} from '../foam-chart-data';
import {cementingChartsWorkbook,cementingNumericCharts,numericChartRows} from '../cementing-chart-data';
import {compareFoamFact} from '../foam-cement-data';
import {DEFAULT_DEPTH_CHART} from '../depth-chart-settings';
import type {FoamReportBundle} from '../foam-cement-types';
const well=normalizeWellData({casingDepthMD:500,wellDepthMD:500,wellDepthTVD:400,casingOD:168.3,casingWall:8.9,holeDiameter:215.9,cavernCoeff:1,prevCasingDepth:100,prevCasingID:250,ckodDepth:480,bottomTempStatic:50,bottomTempCirc:40,trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:400,tvd:400,zenith:0,azimuth:0},{md:500,tvd:400,zenith:90,azimuth:0}]});
let bundle:FoamReportBundle;
beforeAll(()=>{const input={wellData:well,mudDensity:1.2,settings:{...defaultFoamSettings({wellData:well}),spatialCells:16,timeStepMin:1}};const simulation=simulateFoamJob(input),observations=[{timeMin:0,pumpPressureMPa:0,n2RateStdM3Min:0},{timeMin:simulation.frames.at(-1)!.time,n2RateStdM3Min:0}];bundle={simulation,observations,planFact:compareFoamFact(simulation,observations),frameIndex:1,chartSettings:{...DEFAULT_DEPTH_CHART,coordinate:'TVD',depthUnit:'ft',pressureUnit:'psi',densityUnit:'ppg'}};},45000);
describe('foam chart data contract',()=>{
 it('exports exactly the plotted full series, distinguishes absolute and gauge pressure and preserves fact null/zero',()=>{
  const plots=foamCharts(bundle),before=JSON.stringify(bundle),w=foamChartsWorkbook(bundle),read=XLSX.read(XLSX.write(w,{type:'array',bookType:'xlsx'}),{type:'array'});
  expect(plots).toHaveLength(8);plots.forEach((p,i)=>expect(XLSX.utils.sheet_to_json(read.Sheets['График '+(i+1)],{header:1,defval:null})).toEqual(numericChartRows(p)));
  const pressure=plots.find(p=>p.plotId==='foamDepthPressure')!,cells=bundle.simulation.frames[1].cells.filter(x=>x.leg==='annulus').sort((a,b)=>a.md-b.md);
  expect(pressure.data.leftLabel).toBe('Давление абсолютное, psi');expect(plots[0].data.leftLabel).toContain('избыточное');
  pressure.data.xValues.forEach((x,i)=>expect(x).toBeCloseTo(cells[i].tvd/.3048,9));expect(pressure.data.series[0].values[0]).toBeCloseTo(cells[0].pressureMPaAbs*145.03773773,6);
  const fact=plots.at(-1)!;expect(fact.data.series[0].values).toEqual([0,null]);expect(JSON.stringify(bundle)).toBe(before);
  const state={points:[],envelope:[],stageBoundaries:[],observation:undefined,stopStorage:undefined,foam:bundle},common=cementingChartsWorkbook(state);
  expect(cementingNumericCharts(state)).toEqual(plots);expect(common.SheetNames).toContain('Пена - ячейки');expect(XLSX.utils.sheet_to_json(common.Sheets['График 01'],{header:1,defval:null})).toEqual(numericChartRows(plots[0]));
 });
 it('retains all saved frame/cell rows, standard N2 conditions, diagnostics and both legs without inventing unsaved frames',()=>{
  const w=foamChartsWorkbook(bundle),r=bundle.simulation;
  expect(XLSX.utils.sheet_to_json(w.Sheets['Пена - время'],{header:1}).length).toBe(r.frames.length+1);expect(XLSX.utils.sheet_to_json(w.Sheets['Пена - ячейки'],{header:1}).length).toBe(1+r.frames.reduce((n,f)=>n+f.cells.length,0));
  const cells=XLSX.utils.sheet_to_json(w.Sheets['Пена - ячейки'],{header:1}) as unknown[][];expect(cells.some(x=>x[2]==='Труба')).toBe(true);expect(cells.some(x=>x[2]==='Затрубье')).toBe(true);expect(JSON.stringify(w.Sheets['Пена - условия'])).toContain('0.101325');
  const earlier=foamCharts({...bundle,frameIndex:0});expect(earlier[0].data.series).toEqual(foamCharts(bundle)[0].data.series);expect(earlier.find(x=>x.plotId==='foamDepthPressure')!.data.series).not.toEqual(foamCharts(bundle).find(x=>x.plotId==='foamDepthPressure')!.data.series);
 });
 it('rejects stale physics and mud, permits presentation-only changes, honors selection and absence',()=>{
  expect(currentFoamReport(bundle,well,1200)).toBe(bundle);expect(currentFoamReport(bundle,{...well,holeDiameter:220},1.2)).toBeUndefined();expect(currentFoamReport(bundle,well,1.3)).toBeUndefined();
  expect(currentFoamReport(bundle,{...well,depthChartSettings:DEFAULT_DEPTH_CHART,annularStandoffPct:67},1.2)).toBe(bundle);expect(foamInputKey(bundle.simulation.input)).not.toBe(foamInputKey({...bundle.simulation.input,settings:{...bundle.simulation.input.settings,pumpRateLps:20}}));
  const state={points:[],envelope:[],stageBoundaries:[],observation:undefined,stopStorage:undefined,foam:bundle};expect(cementingNumericCharts(state,undefined,{foam:false})).toEqual([]);expect(cementingChartsWorkbook(state,undefined,{foam:false}).SheetNames.some(x=>x.startsWith('Пена'))).toBe(false);expect(foamCharts(undefined)).toEqual([]);
 });
});
