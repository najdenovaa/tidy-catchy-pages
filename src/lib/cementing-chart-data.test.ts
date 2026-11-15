import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {cementingNumericCharts,chartCoverage,cementingChartsWorkbook,numericChartRows} from './cementing-chart-data';
import {hydraulicReportCharts,depthReportCharts} from './cementing-report-charts';
import {reportSeriesPlot} from './report-series-plot';
import {DEFAULT_DEPTH_CHART,normalizeDepthChartSettings,PRESSURE_UNITS,DENSITY_UNITS} from './depth-chart-settings';
import {normalizeWellData} from './cementing-normalizers';
import type {DepthEnvelopePoint,PressurePoint} from './cementing-calculations';
const envelope:DepthEnvelopePoint[]=[0,100,200,300].map((md,i)=>({md,tvd:[0,80,80,60][i],maxPressureMPa:i+2,minPressureMPa:i+1,minHydrostaticMPa:i+.5,wocHydrostaticMPa:i+.4,porePressureMPa:i===2?null:i*.3,fracPressureMPa:i===0?null:i+3,poreFromLayer:false,maxAtStage:'Цемент'}));
const points=[{time:0,surfacePressure:0,bottomholePressure:2,fracturePressure:4,pumpRateLps:3,annularReturnRate:2,cumulativeVolume:0,densityGcm3:1.85,ecdAtBottomGcm3:1.1},{time:1,surfacePressure:2,bottomholePressure:3,fracturePressure:4,pumpRateLps:5,annularReturnRate:null,cumulativeVolume:1,densityGcm3:1.2,ecdAtBottomGcm3:null}] as unknown as PressurePoint[];
const result={points,envelope,stageBoundaries:[],observation:undefined,stopStorage:undefined};
const settings={...DEFAULT_DEPTH_CHART,coordinate:'TVD' as const,depthUnit:'ft' as const,pressureUnit:'psi' as const,densityUnit:'ppg' as const};
describe('F10/F19/F27/F36 numeric graph contract',()=>{
 it('exports the exact plotted rows and right-axis units, preserving zero, missing data and full sample precision',()=>{
  const plots=hydraulicReportCharts(points),combined=plots.find(p=>p.reportItem==='combined')!,rate=plots.find(p=>p.reportItem==='rate')!;
  expect(combined.data.rightLabel).toBe('Расход, л/с');expect(combined.data.series.find(s=>s.name.includes('Выход'))!.values).toEqual([2,null]);
  const w=cementingChartsWorkbook(result),catalog=XLSX.utils.sheet_to_json(w.Sheets['Карта графиков'],{header:1}) as unknown[][];
  for(const p of plots.filter(p=>p.data.series.some(s=>s.values.some(v=>v!==null)))){
   const row=catalog.find(row=>row[1]===p.title)!,sheet=w.Sheets[String(row[2])];expect(sheet).toBeDefined();
   expect(XLSX.utils.sheet_to_json(sheet,{header:1,defval:null})).toEqual(numericChartRows(p));
  }
  const roundTrip=XLSX.read(new Uint8Array(XLSX.write(w,{type:'array',bookType:'xlsx'})),{type:'array'});expect(roundTrip.SheetNames).toEqual(w.SheetNames);expect(XLSX.utils.sheet_to_json(roundTrip.Sheets['График 01'],{header:1,defval:null})).toEqual(numericChartRows(combined));
  expect(rate.data.series[1].values[1]).toBeNull();expect(numericChartRows(rate)[1][1]).toBe(3);
 });
 it('MD/TVD, ft, psi and US ppg change presentation, not physical TVD or result arrays; duplicate/upward TVD stays ordered',()=>{
  const before=JSON.stringify(result),md=depthReportCharts(envelope),tv=depthReportCharts(envelope,undefined,settings);
  tv[0].data.xValues.forEach((v,i)=>expect(v).toBeCloseTo(envelope[i].tvd/.3048,10));expect(tv[0].data.xValues[1]).toBe(tv[0].data.xValues[2]);expect(tv[0].data.xValues[3]).toBeLessThan(tv[0].data.xValues[2]!);
  expect(tv[0].data.series[0].values[1]).toBeCloseTo(3*145.03773773,6);
  expect(tv[1].data.series[0].values[1]).toBeCloseTo(md[1].data.series[0].values[1]!*DENSITY_UNITS.ppg.k,10);expect(tv[1].data.series[0].values[0]).toBeNull();
  expect(numericChartRows(tv[0])[0].slice(0,3)).toEqual(['Глубина TVD, ft','MD, м (исходная)','TVD, м (исходная)']);
  expect(JSON.stringify(result)).toBe(before);expect(tv[0].svg).toContain('Глубина TVD, ft');expect(tv[0].svg).toContain('Давление, psi');
 });
 it('unit conversions use international foot, standard gravity and US gallon; prefs survive project normalization',()=>{
  expect(PRESSURE_UNITS.kgf.k*.0980665).toBeCloseTo(1,12);expect(PRESSURE_UNITS.bar.k).toBe(10);expect(DENSITY_UNITS.ppg.k).toBeCloseTo(8.345404452,8);
  expect(normalizeWellData({depthChartSettings:settings}).depthChartSettings).toEqual(settings);
  expect(normalizeDepthChartSettings({coordinate:'BAD',pressureUnit:'INVALID'})).toEqual(DEFAULT_DEPTH_CHART);
  expect(normalizeWellData({}).depthChartSettings).toBeUndefined();
 });
 it('selection is honored and missing graphs/series are identified rather than filled with zeros',()=>{
  const w=cementingChartsWorkbook(result,settings,{depthEcd:false}),rows=XLSX.utils.sheet_to_json(w.Sheets['Карта графиков'],{header:1}) as unknown[][];
  expect(rows.some(r=>String(r[1]).startsWith('ЭЦП по глубине'))).toBe(false);
  const coverage=chartCoverage(cementingNumericCharts(result));expect(coverage.find(r=>r.key==='selectedDepth')!.ready).toHaveLength(0);expect(coverage.find(r=>r.key==='stopStorage')!.status).toContain('Нет актуального');
  expect(rows.filter(r=>r[0]==='Расход закачки и выход на устье').some(r=>r[7]===1)).toBe(true);
 });
 it('a large full-resolution graph and missing values render without argument-spread overflow or fabricated segments',()=>{
  const p=reportSeriesPlot('Test','pressures',Array.from({length:150000},(_,i)=>i),'Время','МПа',[{name:'P',color:'#123456',values:Array.from({length:150000},(_,i)=>i===4?NaN:i)}]);
  expect(p.data.xValues).toHaveLength(150000);expect(p.data.series[0].values[4]).toBeNull();expect(p.svg).not.toMatch(/NaN|Infinity/);
 });
});
