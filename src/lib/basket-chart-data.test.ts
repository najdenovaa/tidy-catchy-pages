import {it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {evaluateBasketStop} from './cement-basket-stop';
import {normalizeWellData} from './cementing-normalizers';
import {basketStopCharts} from './basket-chart-data';
import {cementingChartsWorkbook,cementingNumericCharts,numericChartRows} from './cementing-chart-data';
import {DEFAULT_DEPTH_CHART} from './depth-chart-settings';
const well=normalizeWellData({casingDepthMD:1000,wellDepthMD:1000,wellDepthTVD:800,casingOD:168,casingWall:8,holeDiameter:216,cavernCoeff:1,prevCasingDepth:0,trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:700,tvd:700,zenith:90,azimuth:0},{md:1000,tvd:700,zenith:90,azimuth:0}],equipment:[{id:'b',kind:'basket',model:'Корзина',manufacturer:'Изготовитель',sourceUrl:'https://example.org/product',quantity:1,depthMD:700,basketBridgeMin:5,basketSupportPct:50,basketCapacityKN:2,passport:'SECRET-PASSPORT-BODY'}],reservoirLayers:[{name:'Пласт 1',topMD:800,bottomMD:1000,porePressureGrad:17,fracGrad:22,absorbGrad:21}]});
const result=()=>evaluateBasketStop(well,[{top:0,bot:1000,rho:1.9,fluidType:'cement'}],23);
const state=()=>({points:[],envelope:[],stageBoundaries:[],observation:undefined,stopStorage:undefined,basketStop:result()});
it('uses exactly the same full profile in Word figure and XLSX while preserving duplicate TVD and original MD order',()=>{
 const s=state(),before=JSON.stringify(s),settings={...DEFAULT_DEPTH_CHART,coordinate:'TVD' as const,depthUnit:'ft' as const,pressureUnit:'psi' as const},p=basketStopCharts(s.basketStop,settings)[0];
 expect(cementingNumericCharts(s,settings)).toEqual([p]);expect(p.data.xValues).toHaveLength(s.basketStop.rows.length);
 p.data.xValues.forEach((x,i)=>expect(x).toBeCloseTo(s.basketStop.rows[i].tvd/.3048,10));expect(p.data.series[0].values[1]).toBeCloseTo(s.basketStop.rows[1].withoutMPa*145.03773773,6);
 expect(p.data.xValues.filter(x=>x===700/.3048).length).toBeGreaterThan(1);
 const w=cementingChartsWorkbook(s,settings),read=XLSX.read(XLSX.write(w,{type:'array',bookType:'xlsx'}),{type:'array'});
 expect(XLSX.utils.sheet_to_json(read.Sheets['График 01'],{header:1,defval:null})).toEqual(numericChartRows(p));
 const raw=XLSX.utils.sheet_to_json(read.Sheets['Корзины - профиль'],{header:1,defval:null}) as unknown[][];
 expect(raw.slice(1).map(r=>r.slice(0,7))).toEqual(s.basketStop.rows.map(r=>[r.md,r.tvd,r.withoutMPa,r.scenarioMPa,r.reductionMPa,r.poreMPa,r.limitMPa]));expect(raw[1][5]).toBeNull();expect(raw[1][4]).toBe(0);expect(JSON.stringify(s)).toBe(before);
});
it('records entered and effective values separately, retains missing capacity and sources, and exports no passport body',()=>{
 const s=state(),w=cementingChartsWorkbook(s),rows=XLSX.utils.sheet_to_json(w.Sheets['Корзины - исходные'],{header:1,defval:null}) as unknown[][];
 expect(rows[1].slice(6,11)).toEqual([50,5,null,1,2]);expect(s.basketStop.baskets[0].limited).toBe(true);
 expect(s.basketStop.rows.at(-1)!.poreSource).toContain('Пласт 1');expect(s.basketStop.rows.at(-1)!.limitSource).toContain('поглощение');
 expect(JSON.stringify(w)).not.toContain('SECRET-PASSPORT');
 const r=evaluateBasketStop({...well,equipment:well.equipment!.map(b=>({...b,basketCapacityKN:undefined}))},[{top:0,bot:1000,rho:1.9,fluidType:'cement'}],0);expect(r.baskets[0].capacityKN).toBeUndefined();
 expect(r.rows[0].limitMPa).toBeNull();expect(r.rows[0].limitSource).toBe('Не задано');
});
it('honors checkbox and missing result without inventing zero curves or rebuilding old provenance',()=>{
 const s=state();expect(cementingNumericCharts(s,undefined,{basket:false})).toEqual([]);expect(cementingChartsWorkbook(s,undefined,{basket:false}).SheetNames.some(n=>n.startsWith('Корзины'))).toBe(false);expect(basketStopCharts(undefined)).toEqual([]);
 const legacy={...s,basketStop:{...s.basketStop,inputs:undefined}},w=cementingChartsWorkbook(legacy);expect(JSON.stringify(w.Sheets['Корзины - условия'])).toContain('Не сохранён');
 const immediate=evaluateBasketStop({...well,basketEvaluationMin:0},[{top:0,bot:1000,rho:1.9,fluidType:'cement'}],23);expect(immediate.rows.every(r=>r.reductionMPa===0)).toBe(true);
});
