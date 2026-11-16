// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {well,data} from './fixtures/casing-chart-fixture';
import * as XLSX from 'xlsx';
import {casingDesignCharts,casingDesignWorkbook,casingChartRows,casingRunningResult} from '../casing-design-chart-data';
import {buildCementingReportSvgs} from '../cementing-report-figures';
import {defaultReportSelection} from '../cementing-report-options';
describe('separate casing numeric chart contract',()=>{
 it('round trips the exact full plotted series, preserves equal TVD and original MD without mutating data',()=>{
  const before=JSON.stringify(data);
  for(const scope of ['centralization','running'] as const){const p=casingDesignCharts(well,data,scope),book=casingDesignWorkbook(well,data,scope),read=XLSX.read(XLSX.write(book,{type:'array',bookType:'xlsx'}),{type:'array'});
   expect(p.length).toBe(scope==='centralization'?3:4);
   p.forEach((plot,i)=>{expect(XLSX.utils.sheet_to_json(read.Sheets['График '+(i+1)],{header:1,defval:null})).toEqual(casingChartRows(plot));expect(plot.svg).not.toMatch(/NaN|Infinity/);expect(plot.data.xLabel).toContain('TVD, ft');expect(buildCementingReportSvgs(well,{centralization:data},scope).some(s=>s.svg===plot.svg)).toBe(true);});
   const plot=p[0],horizontal=plot.data.coordinates.filter(p=>p.mdM>100);expect(horizontal.length).toBeGreaterThan(2);expect(new Set(horizontal.map(p=>p.tvdM)).size).toBe(1);
   expect(JSON.stringify(book.Sheets)).not.toContain('SECRET-PASSPORT');
   if(scope==='centralization'){expect(book.SheetNames).not.toContain('Веник');expect(book.SheetNames).toContain('Установка');}
   else {expect(book.SheetNames).toContain('Веник');expect(book.SheetNames).not.toContain('Центрирование');}
  }
  expect(JSON.stringify(data)).toBe(before);
 });
 it('keeps hook measurements, sensitivity, force profiles and missing values distinct',()=>{
  const a=casingRunningResult(well,data)!,plots=casingDesignCharts(well,data,'running',undefined,a),broom=plots[0];
  expect(broom.data.series[0].values.slice(0,a.broom.length)).toEqual(a.broom.map(p=>p.runIn));expect(broom.data.series.find(s=>s.name==='Спуск: μ ниже')!.values.slice(0,a.broom.length)).toEqual(a.broom.map(p=>p.runLow));
  expect(broom.data.series.find(s=>s.markersOnly)!.values.at(-1)).toBe(0);expect(broom.data.xValues).toHaveLength(a.broom.length+1);
  expect(plots.find(p=>p.plotId==='runningForce')!.data.series[0].values).toEqual(a.profile.map(p=>p.runInKN));expect(plots.find(p=>p.plotId==='runningDrag')!.data.series[0].values).toEqual(a.profile.map(p=>p.toolDragKN));
  const sparse={...data,results:data.results.map(p=>({...p,lateralLoadKN:undefined}))};expect(casingDesignCharts(well,sparse,'centralization').some(p=>p.plotId==='centralLoad')).toBe(false);
  const legacy={...data,results:data.results.map(p=>({...p,lateralLoadKN:undefined,spanSagMM:undefined}))};expect(casingDesignCharts(well,legacy,'centralization')).toHaveLength(1);expect(JSON.stringify(casingDesignWorkbook(well,legacy,'centralization').Sheets['Карта графиков'])).toContain('Нет актуальных числовых данных');
  const book=casingDesignWorkbook(well,data,'running');expect(XLSX.utils.sheet_to_json(book.Sheets['Замеры'],{header:1,defval:null})).toEqual([['MD, м','Режим','Крюк, тс','В пределах расчётной глубины'],[150,'Спуск',0,'Да'],[250,'Подъём',1,'Нет']]);
 });
 it('honors section choices, rejects invalid calculations and refreshes forces when physical inputs change',()=>{
  const selection={...defaultReportSelection('running'),broom:false,forceProfile:false,torque:false,measurements:false,runningLoads:false,inputs:false,materials:false};
  const book=casingDesignWorkbook(well,data,'running',selection);expect(casingDesignCharts(well,data,'running',selection)).toEqual([]);expect(book.SheetNames).toEqual(['Карта графиков','Условия']);expect(casingDesignWorkbook(well,data,'running',{...selection,chartData:false}).SheetNames).toEqual(['Условия']);
  expect(()=>casingDesignWorkbook(well,{...data,calculated:false},'centralization')).toThrow('актуальный');expect(()=>casingDesignWorkbook({...well,casingWall:200},data,'running')).toThrow('исходные');
  const a=casingDesignCharts(well,data,'running'),b=casingDesignCharts(well,{...data,running:{...data.running!,mudDensity:1300}},'running');expect(a[0].sourceKey).not.toBe(b[0].sourceKey);expect(a[0].data.series).not.toEqual(b[0].data.series);
  expect(buildCementingReportSvgs(well,{centralization:data},'cementing').some(p=>p.reportItem==='broom'||p.reportItem==='standoff')).toBe(false);
 });
});
