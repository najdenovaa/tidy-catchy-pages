import type {ChartPresentations,PresentationPlotId} from './chart-presentation';
import {normalizeDepthChartSettings,DEPTH_UNITS,PRESSURE_UNITS,DENSITY_UNITS,type DepthChartSettings} from './depth-chart-settings';
import type {PressureObservation} from './pressure-observation';
import type { PressurePoint,DepthEnvelopePoint,StageBoundary } from './cementing-calculations';
import type { ReportSelection } from './cementing-report-options';
import { reportIncludes } from './cementing-report-options';
import { reportSeriesPlot,applyPlotPresentation,hasPlotNumbers,type PlotSeries } from './report-series-plot';
type P=Pick<PressurePoint,'time'|'surfacePressure'|'bottomholePressure'|'fracturePressure'|'pumpRateLps'>&Partial<PressurePoint>;
export function hydraulicReportCharts(points:P[],selection?:ReportSelection,stages:StageBoundary[]=[],observation?:PressureObservation,presentations?:ChartPresentations) {
 if(!points.length)return[];
 const time=points.map(p=>p.time),series=(name:string,color:string,key:keyof P,axis?:'right'):PlotSeries=>({name,color,reference:['fracGradEcdGcm3','porePressureEcdGcm3','fracturePressure'].includes(String(key)),values:points.map(p=>typeof p[key]==='number'?p[key] as number:null),axis,curve:points[0]?.transportColumns&&(key==='pumpRateLps'||key==='annularReturnRate')?'stepBefore':undefined});
 const pressure=[series('Устье','#4f46e5','surfacePressure'),series('Забой','#0284c7','bottomholePressure'),series('ГРП','#dc2626','fracturePressure')];
 const list=[
 reportSeriesPlot('Совмещённый график цементирования','combined',time,'Время, мин','Давление, МПа',[...pressure,series('Закачка, правая шкала','#16a34a','pumpRateLps','right'),series('Выход, правая шкала','#d97706','annularReturnRate','right')],{rightUnit:'Расход, л/с',stages}),
 reportSeriesPlot('Плотность закачки: панель совмещённого графика','combined',time,'Время, мин','Плотность, г/см³',[series('Закачиваемая жидкость','#7c3aed','densityGcm3')],{stages,plotId:'combinedDensity'}),
 reportSeriesPlot('Давления в ходе цементирования','pressures',time,'Время, мин','Давление, МПа',pressure,{stages}),
 reportSeriesPlot('Расход закачки и выход на устье','rate',time,'Время, мин','Расход, л/с',[series('Закачка','#0284c7','pumpRateLps'),series('Выход на устье','#ea580c','annularReturnRate')],{stages}),
 reportSeriesPlot('ЭЦП во времени: забой и башмак предыдущей колонны','ecdTime',time,'Время, мин','ЭЦП, г/см³',[series('ЭЦП на забое','#1d4ed8','ecdAtBottomGcm3'),series('Статическая ЭЦП на забое','#38bdf8','ecdStaticAtBottomGcm3'),series('ЭЦП на башмаке','#ea580c','ecdAtPrevShoeGcm3'),series('Граница ГРП','#dc2626','fracGradEcdGcm3'),series('Пластовое давление в ед. плотности','#a16207','porePressureEcdGcm3')],{stages}),
 reportSeriesPlot('Объём и давление','volumePressure',points.map(p=>p.cumulativeVolume??NaN),'Накопленный объём, м³','Давление, МПа',pressure),
 reportSeriesPlot('План продавки: давления и безопасный расход','safeRate',time,'Время, мин','Давление, МПа',[...pressure,series('Фактический расход, правая шкала','#7c3aed','pumpRateLps','right'),series('Макс. безопасный расход, правая шкала','#ea580c','maxSafeRateLps','right')],{rightUnit:'Расход, л/с',stages}),
 reportSeriesPlot('Рейнольдс и режим потока в затрубье','flowRegime',time,'Время, мин','Число Рейнольдса',[series('Re в затрубье','#0284c7','reynoldsAnn'),{name:'Граница перехода Re=2100',reference:true,color:'#d97706',values:time.map(()=>2100),dash:'6 4'}],{stages}),
 reportSeriesPlot('Состав затрубного пространства: высоты жидкостей','annularFill',time,'Время, мин','Высота, м',[series('Буровой раствор','#a16207','annMudHeightM'),series('Буфер','#0284c7','annBufferHeightM'),series('Цемент','#64748b','annCementHeightM'),series('Продавочная жидкость','#16a34a','annDisplHeightM')],{stages}),
 ];
 if(observation?.status==='ready'&&observation.rows.length){const r=observation,t=r.rows.map(p=>p.timeMin),at='MD '+r.depthMD!.toFixed(2)+' / TVD '+r.depthTVD!.toFixed(2)+' м';list.push(reportSeriesPlot('Давление на выбранной глубине: '+at,'selectedDepth',t,'Время, мин','Давление в затрубье, МПа',[{name:'Давление',color:'#2563eb',values:r.rows.map(p=>p.pressureMPa)},{name:'Гидростатика',color:'#38bdf8',values:r.rows.map(p=>p.hydrostaticMPa)},{name:'Пластовое: заданное',color:'#a16207',values:t.map(()=>r.poreMPa??null)},{name:'ГРП: заданное',color:'#ef4444',values:t.map(()=>r.fractureMPa??null)},{name:'Поглощение: заданное',color:'#a855f7',values:t.map(()=>r.absorptionMPa??null)},{name:'Предел 95%',color:'#dc2626',values:t.map(()=>r.limitMPa??null),dash:'5 4'}],{stages,plotId:'selectedDepthPressure'}));if(r.depthTVD!>1e-6)list.push(reportSeriesPlot('ЭЦП на выбранной глубине: '+at,'selectedDepth',t,'Время, мин','ЭЦП, г/см³',[{name:'ЭЦП',color:'#2563eb',values:r.rows.map(p=>p.ecdGcm3)},{name:'Статическая ЭЦП',color:'#38bdf8',values:r.rows.map(p=>p.staticEcdGcm3)},{name:'Пластовое в ед. плотности',color:'#a16207',values:t.map(()=>r.poreMPa===undefined?null:r.poreMPa/(.00981*r.depthTVD!))},{name:'Предел 95% в ед. плотности',color:'#dc2626',values:t.map(()=>r.limitMPa===undefined?null:r.limitMPa/(.00981*r.depthTVD!))}],{stages,plotId:'selectedDepthEcd'}));}
 return list.filter(p=>reportIncludes(selection,p.reportItem)&&hasPlotNumbers(p)).map(p=>applyPlotPresentation(p,presentations?.[p.plotId as PresentationPlotId])).map(p=>p.reportItem==='selectedDepth'?{...p,sourceKey:observation?.sourceKey}:p);
}
export function depthReportCharts(envelope:DepthEnvelopePoint[],selection?:ReportSelection,settings?:DepthChartSettings,presentations?:ChartPresentations) {
 if(!envelope.length)return[];
 const config=normalizeDepthChartSettings(settings),depth=DEPTH_UNITS[config.depthUnit],pressure=PRESSURE_UNITS[config.pressureUnit],density=DENSITY_UNITS[config.densityUnit];
 const ecd=(p:number|null,tvd:number)=>p!==null&&tvd>50?p/(.00981*tvd)*density.k:null;
 const series=(name:string,color:string,key:'maxPressureMPa'|'minPressureMPa'|'minHydrostaticMPa'|'wocHydrostaticMPa'|'porePressureMPa'|'fracPressureMPa',equiv=false):PlotSeries=>({name,color,values:envelope.map(p=>equiv?ecd(p[key],p.tvd):p[key]===null?null:p[key]*pressure.k)});
 const build=(equiv:boolean)=>reportSeriesPlot((equiv?'ЭЦП по глубине: огибающие за всю операцию':'Давление по глубине: огибающие за всю операцию')+'; '+config.coordinate+', '+depth.label+'; '+(equiv?density.label:pressure.label),equiv?'depthEcd':'depthPressure',envelope.map(e=>(config.coordinate==='TVD'?e.tvd:e.md)*depth.k),'Глубина '+config.coordinate+', '+depth.label,equiv?'ЭЦП, '+density.label:'Давление, '+pressure.label,[
 series('Максимум за операцию','#dc2626','maxPressureMPa',equiv),series('Минимум при циркуляции','#16a34a','minPressureMPa',equiv),series('Минимальная гидростатика','#0284c7','minHydrostaticMPa',equiv),series('ОЗЦ','#7c3aed','wocHydrostaticMPa',equiv),series('Пластовое: заданное / оценочное','#a16207','porePressureMPa',equiv),series('ГРП / поглощение','#64748b','fracPressureMPa',equiv),{name:'Предел 95% ГРП',color:'#f97316',values:envelope.map(p=>p.fracPressureMPa===null?null:equiv?ecd(p.fracPressureMPa*.95,p.tvd):p.fracPressureMPa*.95*pressure.k),dash:'5 4'}],{depth:true});
 return[build(false),build(true)].filter(p=>reportIncludes(selection,p.reportItem)&&hasPlotNumbers(p)).map(p=>({...p,data:{...p.data,coordinates:envelope.map(e=>({mdM:e.md,tvdM:e.tvd}))}})).map(p=>applyPlotPresentation(p,presentations?.[p.plotId as PresentationPlotId]));
}

export function stopStorageReportCharts(r:import('./stop-storage').StopStorageResult|undefined,presentations?:ChartPresentations){
 if(r?.status!=='ready')return [];
 return [reportSeriesPlot('Дополнительная подача после посадки пробки','stopStorage',r.curve.map(p=>p.injectedReferenceM3*1000),'Дополнительная подача в исходном состоянии, л','Прирост давления ΔP, МПа',[{name:'Замкнутая труба над ЦКОД',color:'#4f46e5',values:r.curve.map(p=>p.pressureRiseMPa)}])].map(p=>applyPlotPresentation(p,presentations?.stopStorage));
}
