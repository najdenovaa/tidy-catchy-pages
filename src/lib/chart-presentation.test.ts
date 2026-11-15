import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {normalizeChartPresentations,resolveChartPresentation,validChartRange} from './chart-presentation';
import {reportSeriesPlot,applyPlotPresentation} from './report-series-plot';
import {normalizeWellData} from './cementing-normalizers';
import {cementingChartsWorkbook,cementingNumericCharts,numericChartRows} from './cementing-chart-data';
import {getCementingExample} from './cementing-example';
import {calculateVolumes,calculatePressureProfile} from './cementing-calculations';
const basis={x:'Время, мин',left:'Давление, МПа',right:'Расход, л/с'};
const base=()=>reportSeriesPlot('Исходный график','combined',[0,1,2,3],basis.x,basis.left,[{name:'Давление',color:'#123456',values:[0,null,8,12]},{name:'Расход',color:'#456789',axis:'right',values:[2,2,2,2],curve:'stepBefore'}],{rightUnit:basis.right});
describe('chart presentation and data integrity',()=>{
 it('normalizes untrusted project preferences and persists only recognized bounded settings',()=>{
  const values=normalizeChartPresentations({combined:{title:'  Заголовок  ',fontFamily:'serif',fontSize:20,basis,x:{min:1,max:2}},rate:{fontFamily:'<script>',fontSize:50,x:{min:0,max:1}},unknown:{title:'Ignored'}});
  expect(values).toEqual({combined:{title:'Заголовок',fontFamily:'serif',fontSize:20,basis,x:{min:1,max:2}}});
  expect(normalizeWellData(JSON.parse(JSON.stringify({chartPresentations:values}))).chartPresentations).toEqual(values);
  expect(normalizeWellData({}).chartPresentations).toBeUndefined();
  for(const range of [{min:NaN,max:2},{min:2,max:1},{min:0,max:1e10},{min:0,max:1e-7}])expect(validChartRange(range)).toBe(false);
  expect(normalizeChartPresentations({rate:{basis:{x:'x',left:'y'},right:{min:0,max:5}}})).toEqual({});
 });
 it('binds each manual window to its coordinate and units; changed scales cannot silently inherit limits',()=>{
  const style={basis,x:{min:0,max:2},left:{min:0,max:10},right:{min:0,max:5},title:'Тест'};
  const actual=resolveChartPresentation(style,{...basis,left:'Давление, psi'});
  expect(actual.ranges).toEqual({x:style.x,right:style.right});expect(actual.ignored).toEqual(['left']);expect(actual.presentation?.title).toBe('Тест');
 });
 it('clips geometry, reports hidden samples, escapes the title and keeps zero, gaps and all original series',()=>{
  const p=base(),before=JSON.stringify(p),styled=applyPlotPresentation(p,{title:'Окно <script> & "давление"',fontFamily:'monospace',fontSize:20,basis,x:{min:1,max:2},left:{min:0,max:10},right:{min:0,max:3}});
  expect(styled.data.outsideCount).toBe(4);expect(styled.svg).toContain('clip-path="url(#plot-combined)"');expect(styled.svg).toContain('DejaVu Sans Mono');expect(styled.svg).toContain('&lt;script&gt; &amp; &quot;давление&quot;');expect(styled.svg).not.toContain('<script>');expect(styled.svg).toContain('Исходный график');
  expect(styled.svg).toContain('За пределами окна: 4');expect(styled.data.xValues).toEqual([0,1,2,3]);expect(styled.data.series).toEqual(p.data.series);expect(JSON.stringify(p)).toBe(before);
  expect(applyPlotPresentation(styled)).toEqual(p);
 });
 it('keeps MD/TVD source coordinates, independent plot panels and complete XLSX rows after zoom',()=>{
  const ex=getCementingExample(),v=calculateVolumes(ex.wellData,ex.slurries),r=calculatePressureProfile(ex.wellData,ex.slurries,ex.buffers,ex.drillingFluid,ex.displacementFluids,ex.fractureGradient,v.displacementVolumeWithCompression);
  const raw=cementingNumericCharts(r),depth=raw.find(p=>p.plotId==='depthPressure')!;
  const styles={combined:{title:'Новый совмещённый'},combinedDensity:{title:'Отдельная плотность'},depthPressure:{title:'Огибающая',fontSize:20,basis:{x:depth.data.xLabel,left:depth.data.leftLabel},x:{min:100,max:200},left:{min:1,max:2}}};
  const plots=cementingNumericCharts(r,undefined,undefined,styles),changed=plots.find(p=>p.plotId==='depthPressure')!;
  expect(changed.data.coordinates).toEqual(depth.data.coordinates);expect(changed.data.outsideCount).toBeGreaterThan(0);
  expect(plots.find(p=>p.plotId==='combined')!.title).toBe('Новый совмещённый');expect(plots.find(p=>p.plotId==='combinedDensity')!.title).toBe('Отдельная плотность');
  const w=cementingChartsWorkbook(r,undefined,undefined,styles),round=XLSX.read(XLSX.write(w,{type:'array',bookType:'xlsx'}),{type:'array'});
  const catalog=XLSX.utils.sheet_to_json(round.Sheets['Карта графиков'],{header:1}) as unknown[][],row=catalog.find(r=>r[1]==='Огибающая')!;
  expect(XLSX.utils.sheet_to_json(round.Sheets[String(row[2])],{header:1,defval:null})).toEqual(numericChartRows(depth));
  const meta=XLSX.utils.sheet_to_json(round.Sheets['Оформление'],{header:1,defval:null}) as unknown[][];
  expect(meta.find(r=>r[0]==='depthPressure')!.slice(2,9)).toEqual(['Огибающая','sans-serif',20,100,200,1,2]);
 });
});
