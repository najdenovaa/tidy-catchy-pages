import {basketStopCharts,appendBasketSheets} from './basket-chart-data';
import {rheologyReportFigures,type RheologyReportInput} from './rheology-report';
import {appendRheologySheets,rheologyCoverage} from './rheology-workbook';
import type {ChartPresentations} from './chart-presentation';
import {hasPlotNumbers} from './report-series-plot';
import * as XLSX from 'xlsx';
import {hydraulicReportCharts,depthReportCharts,stopStorageReportCharts} from './cementing-report-charts';
import {REPORT_ITEMS,reportIncludes,type ReportSelection} from './cementing-report-options';
import type {PressureProfileResult} from './cementing-calculations';
import {normalizeDepthChartSettings,type DepthChartSettings} from './depth-chart-settings';
export type NumericChart=ReturnType<typeof hydraulicReportCharts>[number];
export const chartHasNumbers=hasPlotNumbers;
export const NUMERIC_CHART_ITEMS=['basket','rheology','combined','pressures','rate','ecdTime','depthPressure','depthEcd','volumePressure','safeRate','flowRegime','annularFill','selectedDepth','stopStorage'] as const;
export function cementingNumericCharts(r:Pick<PressureProfileResult,'points'|'envelope'|'stageBoundaries'|'observation'|'stopStorage'>&{basketStop?:PressureProfileResult['basketStop']}&{rheologyInput?:RheologyReportInput},settings?:DepthChartSettings,selection?:ReportSelection,presentations?:ChartPresentations):NumericChart[]{
 return [...basketStopCharts(r.basketStop,settings),...(r.rheologyInput&&reportIncludes(selection,'rheology')?rheologyReportFigures(r.rheologyInput):[]),...hydraulicReportCharts(r.points,selection,r.stageBoundaries,r.observation,presentations),...depthReportCharts(r.envelope,selection,settings,presentations),...stopStorageReportCharts(r.stopStorage,presentations)].filter(p=>reportIncludes(selection,p.reportItem));
}
export function chartCoverage(plots:NumericChart[],selection?:ReportSelection){
 return NUMERIC_CHART_ITEMS.filter(k=>reportIncludes(selection,k)).map(key=>{
  const charts=plots.filter(p=>p.reportItem===key),ready=charts.filter(chartHasNumbers),label=REPORT_ITEMS.cementing.find(([k])=>k===key)![1];
  return {key,label,charts,ready,rows:ready.reduce((n,p)=>n+p.data.xValues.length,0),status:ready.length?'Есть числовые ряды':'Нет актуального числового ряда'};
 });
}
export function numericChartRows(p:NumericChart){
 const coordinates=p.data.coordinates;
 return [[p.data.xLabel,...(coordinates?['MD, м (исходная)','TVD, м (исходная)']:[]),...p.data.series.map(s=>s.name+' ['+(s.axis==='right'?p.data.rightLabel??'правая шкала':p.data.leftLabel)+']')],...p.data.xValues.map((x,i)=>[x,...(coordinates?[coordinates[i]?.mdM??null,coordinates[i]?.tvdM??null]:[]),...p.data.series.map(s=>s.values[i])])];
}
/** Full-resolution numeric sheets built from exactly the arrays used to draw Word figures. */
export function cementingChartsWorkbook(r:Parameters<typeof cementingNumericCharts>[0],settings?:DepthChartSettings,selection?:ReportSelection,presentations?:ChartPresentations){
 const plots=cementingNumericCharts(r,settings,selection,presentations),coverage=chartCoverage(plots,selection),w=XLSX.utils.book_new();
 const catalog:(string|number|null)[][]=[['Раздел Word','График','Лист XLSX','Координата','Шкала значений','Правая шкала','Строк','Числовых точек ряда','Состояние']];
 let index=1;
 for(const row of coverage){
  if(!row.charts.length)catalog.push([row.label,'','', '', '', '',0,0,row.status]);
  for(const p of row.charts){
   const available=chartHasNumbers(p),name=available?'График '+String(index++).padStart(2,'0'):'';
   for(const s of p.data.series)catalog.push([row.label,p.title,name,p.data.xLabel,p.data.leftLabel,p.data.rightLabel??'',p.data.xValues.length,s.values.filter((v,i)=>v!==null&&p.data.xValues[i]!==null).length,s.name+(available?'':' - нет числовых точек')]);
   if(available){const data=numericChartRows(p);if(data.length>1048576)throw new Error('Слишком много строк для одного листа XLSX.');const sheet=XLSX.utils.aoa_to_sheet(data);sheet['!cols']=data[0].map(()=>({wch:30}));XLSX.utils.book_append_sheet(w,sheet,name);}
  }
 }
 if(r.rheologyInput&&reportIncludes(selection,'rheology')){for(const f of rheologyCoverage(r.rheologyInput).filter(f=>!f.data.original.fit))catalog.push(['Реология: модели, замеры и графики',f.name,'','Скорость сдвига, с⁻¹','Па','',0,0,f.status]);appendRheologySheets(w,r.rheologyInput);}
 if(r.basketStop&&reportIncludes(selection,'basket'))appendBasketSheets(w,r.basketStop);
 const meta=XLSX.utils.aoa_to_sheet(catalog);meta['!cols']=[38,70,16,26,30,25,12,20,50].map(wch=>({wch}));XLSX.utils.book_append_sheet(w,meta,'Карта графиков');w.SheetNames=['Карта графиков',...w.SheetNames.filter(x=>x!=='Карта графиков')];
 XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['Время, мин','Граница этапа'],...(r.stageBoundaries??[]).map(s=>[s.time,s.label])]),'Этапы');
 const styleRows=[['Код графика','Исходный заголовок','Заголовок','Шрифт','Размер, px','Координата: мин','Координата: макс','Значения: мин','Значения: макс','Правая: мин','Правая: макс','Значений за окном','Не применены старые пределы'],...plots.map(p=>[p.plotId,p.data.sourceTitle,p.title,p.data.presentation?.fontFamily??'sans-serif',p.data.presentation?.fontSize??13,p.data.ranges.x.min,p.data.ranges.x.max,p.data.ranges.left.min,p.data.ranges.left.max,p.data.ranges.right?.min??null,p.data.ranges.right?.max??null,p.data.outsideCount,p.data.ignoredRanges.join(', ')])];
 XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(styleRows),'Оформление');
 const c=normalizeDepthChartSettings(settings);
 XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['Условие','Значение'],['Данные','Те же числовые ряды, что используются для гидравлических графиков Word. Все сохранённые кадры, без округления и прореживания.'],['Глубинные графики',`${c.coordinate}; ${c.depthUnit}; ${c.pressureUnit}; ${c.densityUnit}`],['ЭЦП','Делитель всегда физическая TVD в метрах; изменение оси MD/TVD не меняет ЭЦП. При TVD ≤ 50 м глубинная ЭЦП не определяется этим представлением.'],['Окно графика','Пределы отображения и шрифт записаны на листе Оформление. Полные числовые ряды не обрезаны по окну. При смене единиц прежние пределы соответствующей шкалы не применяются.'],['Пустые ячейки','Нет значения: не заменяются нулём и не интерполируются.'],['Координаты TVD','Порядок MD сохранён. Одинаковые TVD на горизонтальном участке не объединяются; восходящие участки не сортируются заново.'],['Рендер','Линия может визуально сглаживаться на экране; XLSX содержит исходные отсчёты.'],['Корзины','Полный профиль, снижение, нагрузки и исходный снимок находятся на отдельных листах Корзины. Сценарий не уменьшает давление основной гидравлики; источник изделия не подтверждает сценарные параметры.'],['Реология','При наличии снимка жидкостей: те же кривые, что на экране и в Word, исходные показания и все модели. Аппроксимации отделены от выбранной модели. Нет измерений - нет выдуманных кривых; модельные PV/YP подписаны. Остаток = модель минус замер.'],['Область','Основная гидравлика, выбранная глубина, сжатие после посадки и реология жидкостей. Не включает остальные лабораторные данные, 3D, центрирование и дохождение.'],['Пластовое давление',r.observation?.poreSource??'См. исходные пласты и подписи огибающих.'],['Ограничения выбранной глубины',r.observation?.note??'Нет рассчитанного ряда.']]),'Условия');
 return w;
}
