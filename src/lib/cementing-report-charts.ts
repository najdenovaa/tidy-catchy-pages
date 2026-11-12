import type { PressurePoint,DepthEnvelopePoint,StageBoundary } from './cementing-calculations';
import type { ReportSelection } from './cementing-report-options';
import { reportIncludes } from './cementing-report-options';
import { reportSeriesPlot,type PlotSeries } from './report-series-plot';
type P=Pick<PressurePoint,'time'|'surfacePressure'|'bottomholePressure'|'fracturePressure'|'pumpRateLps'>&Partial<PressurePoint>;
export function hydraulicReportCharts(points:P[],selection?:ReportSelection,stages:StageBoundary[]=[]) {
 if(!points.length)return[];
 const time=points.map(p=>p.time),series=(name:string,color:string,key:keyof P,axis?:'right'):PlotSeries=>({name,color,values:points.map(p=>typeof p[key]==='number'?p[key] as number:null),axis,curve:points[0]?.transportColumns&&(key==='pumpRateLps'||key==='annularReturnRate')?'stepBefore':undefined});
 const pressure=[series('Устье','#4f46e5','surfacePressure'),series('Забой','#0284c7','bottomholePressure'),series('ГРП','#dc2626','fracturePressure')];
 const list=[
 reportSeriesPlot('Совмещённый график цементирования','combined',time,'Время, мин','Давление, МПа',[...pressure,series('Закачка, правая шкала','#16a34a','pumpRateLps','right'),series('Выход, правая шкала','#d97706','annularReturnRate','right')],{rightUnit:'Расход, л/с',stages}),
 reportSeriesPlot('Плотность закачки: панель совмещённого графика','combined',time,'Время, мин','Плотность, г/см³',[series('Закачиваемая жидкость','#7c3aed','densityGcm3')],{stages}),
 reportSeriesPlot('Давления в ходе цементирования','pressures',time,'Время, мин','Давление, МПа',pressure,{stages}),
 reportSeriesPlot('Расход закачки и выход на устье','rate',time,'Время, мин','Расход, л/с',[series('Закачка','#0284c7','pumpRateLps'),series('Выход на устье','#ea580c','annularReturnRate')],{stages}),
 reportSeriesPlot('ЭЦП во времени: забой и башмак предыдущей колонны','ecdTime',time,'Время, мин','ЭЦП, г/см³',[series('ЭЦП на забое','#1d4ed8','ecdAtBottomGcm3'),series('Статическая ЭЦП на забое','#38bdf8','ecdStaticAtBottomGcm3'),series('ЭЦП на башмаке','#ea580c','ecdAtPrevShoeGcm3'),series('Граница ГРП','#dc2626','fracGradEcdGcm3'),series('Пластовое давление в ед. плотности','#a16207','porePressureEcdGcm3')],{stages}),
 reportSeriesPlot('Объём и давление','volumePressure',points.map(p=>p.cumulativeVolume??NaN),'Накопленный объём, м³','Давление, МПа',pressure),
 reportSeriesPlot('План продавки: давления и безопасный расход','safeRate',time,'Время, мин','Давление, МПа',[...pressure,series('Фактический расход, правая шкала','#7c3aed','pumpRateLps','right'),series('Макс. безопасный расход, правая шкала','#ea580c','maxSafeRateLps','right')],{rightUnit:'Расход, л/с',stages}),
 reportSeriesPlot('Рейнольдс и режим потока в затрубье','flowRegime',time,'Время, мин','Число Рейнольдса',[series('Re в затрубье','#0284c7','reynoldsAnn'),{name:'Граница перехода Re=2100',color:'#d97706',values:time.map(()=>2100),dash:'6 4'}],{stages}),
 reportSeriesPlot('Состав затрубного пространства: высоты жидкостей','annularFill',time,'Время, мин','Высота, м',[series('Буровой раствор','#a16207','annMudHeightM'),series('Буфер','#0284c7','annBufferHeightM'),series('Цемент','#64748b','annCementHeightM'),series('Продавочная жидкость','#16a34a','annDisplHeightM')],{stages}),
 ];
 return list.filter(p=>reportIncludes(selection,p.reportItem));
}
export function depthReportCharts(envelope:DepthEnvelopePoint[],selection?:ReportSelection) {
 if(!envelope.length)return[];
 const ecd=(p:number|null,tvd:number)=>p!==null&&tvd>50?p/(.00981*tvd):null;
 const series=(name:string,color:string,key:'maxPressureMPa'|'minPressureMPa'|'minHydrostaticMPa'|'wocHydrostaticMPa'|'porePressureMPa'|'fracPressureMPa',equiv=false):PlotSeries=>({name,color,values:envelope.map(p=>equiv?ecd(p[key],p.tvd):p[key])});
 const build=(equiv:boolean)=>reportSeriesPlot(equiv?'ЭЦП по глубине: огибающие за всю операцию':'Давление по глубине: огибающие за всю операцию',equiv?'depthEcd':'depthPressure',envelope.map(e=>e.md),'Глубина MD, м',equiv?'ЭЦП, г/см³':'Давление, МПа',[
 series('Максимум за операцию','#dc2626','maxPressureMPa',equiv),series('Минимум при циркуляции','#16a34a','minPressureMPa',equiv),series('Минимальная гидростатика','#0284c7','minHydrostaticMPa',equiv),series('ОЗЦ','#7c3aed','wocHydrostaticMPa',equiv),series('Пластовое: заданное / оценочное','#a16207','porePressureMPa',equiv),series('ГРП / поглощение','#64748b','fracPressureMPa',equiv)],{depth:true});
 return[build(false),build(true)].filter(p=>reportIncludes(selection,p.reportItem));
}

export function stopStorageReportCharts(r:import('./stop-storage').StopStorageResult|undefined){
 if(r?.status!=='ready')return [];
 return [reportSeriesPlot('Дополнительная подача после посадки пробки','stopStorage',r.curve.map(p=>p.injectedReferenceM3*1000),'Дополнительная подача в исходном состоянии, л','Прирост давления ΔP, МПа',[{name:'Замкнутая труба над ЦКОД',color:'#4f46e5',values:r.curve.map(p=>p.pressureRiseMPa)}])];
}
