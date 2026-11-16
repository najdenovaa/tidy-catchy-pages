import type { CasingRunningAnalysis, CasingRunningSettings } from './casing-running-analysis';
import {getEffectiveTrajectory,type WellData} from './cementing-calculations';
import {interpolateTrajectory} from './centralization-calculations';
import {DEPTH_UNITS,normalizeDepthChartSettings,type DepthChartSettings} from './depth-chart-settings';
import {reportSeriesPlot,type PlotSeries} from './report-series-plot';
/** One numeric contract for screen, Word and workbook. Measurements keep their own rows. */
export function runningBroomPlot(a:CasingRunningAnalysis,s:CasingRunningSettings,w?:WellData,settings?:DepthChartSettings){
 const c=normalizeDepthChartSettings(settings),unit=DEPTH_UNITS[c.depthUnit],measurements=s.measurements.filter(m=>m.md<=(a.final?.md??0));
 const md=[...a.broom.map(p=>p.md),...measurements.map(m=>m.md)],n=a.broom.length;
 const coords=md.map(mdM=>({mdM,tvdM:w?interpolateTrajectory(getEffectiveTrajectory(w),mdM).tvd:mdM}));
 const line=(name:string,color:string,key:keyof CasingRunningAnalysis['broom'][number],dash?:string):PlotSeries=>({name,color,dash,values:[...a.broom.map(p=>p[key]),...measurements.map(()=>null)]});
 const series=[line('Спуск','#15803d','runIn'),line('Подъём','#dc2626','pullOut'),line('Без трения','#0369a1','free'),line('Спуск без оснастки','#64748b','noTools','7 3'),line('Спуск: μ ниже','#15803d','runLow','5 4'),line('Спуск: μ выше','#15803d','runHigh','2 4'),line('Подъём: μ ниже','#dc2626','pullLow','5 4'),line('Подъём: μ выше','#dc2626','pullHigh','2 4')];
 for(const mode of ['runIn','pullOut'] as const)if(measurements.some(m=>m.mode===mode))series.push({name:'Замер MD: '+(mode==='runIn'?'спуск':'подъём'),color:mode==='runIn'?'#15803d':'#dc2626',markersOnly:true,values:md.map((_,i)=>i<n?null:measurements[i-n].mode===mode?measurements[i-n].hookTF:null)});
 if(s.maxHookKN>0)series.push({name:'Предел крюка',color:'#991b1b',reference:true,dash:'9 4',values:md.map(()=>s.maxHookKN/9.80665)} as PlotSeries);
 const plot=reportSeriesPlot('Спуск колонны: веник по глубине башмака','broom',coords.map(p=>(c.coordinate==='TVD'?p.tvdM:p.mdM)*unit.k),'Глубина башмака '+c.coordinate+', '+unit.label,'Нагрузка на крюке, тс',series,{depth:true,plotId:'runningBroom',note:`μ колонна / ствол: ${s.frictionCased.toFixed(2)} / ${s.frictionOpenhole.toFixed(2)}; штриховые ±${s.frictionSpread.toFixed(2)} - сценарии, не доверительный интервал. Скорость ${s.speedMps} м/с; вес блока ${s.blockWeightKN} кН. 1 тс = 9,80665 кН.`});
 return {...plot,data:{...plot.data,coordinates:coords}};
}
export function runningBroomSVG(a:CasingRunningAnalysis,s:CasingRunningSettings){return a.final?runningBroomPlot(a,s).svg:'';}
