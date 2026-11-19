import { TURBULATOR_MODEL_NOTE } from './turbulator-flow';
import * as XLSX from 'xlsx';
import {centralizerInventory} from './cementing-equipment';
import {getEffectiveTrajectory,type WellData} from './cementing-calculations';
import type {CentralizationReportData} from './cementing-report-data';
import {buildCentralizerJointSchedule} from './centralizer-layout';
import {calculateCasingRunning,normalizeRunningSettings,type CasingRunningAnalysis} from './casing-running-analysis';
import {interpolateTrajectory} from './centralization-calculations';
import {runningBroomPlot} from './casing-running-plot';
import {normalizeDepthChartSettings,DEPTH_UNITS} from './depth-chart-settings';
import {reportSeriesPlot,hasPlotNumbers,type PlotSeries} from './report-series-plot';
import {REPORT_ITEMS,reportIncludes,type ReportItem,type ReportSelection} from './cementing-report-options';
export type CasingChartScope='centralization'|'running';
export function casingRunningResult(w:WellData,c:CentralizationReportData){if(!c.running)return undefined;return calculateCasingRunning({well:w,intervals:c.intervals,turbPoints:c.turbPoints,...c.running,settings:normalizeRunningSettings(w.runningSettings,c.running.frictionCased,c.running.frictionOpenhole)});}
export function casingDesignCharts(w:WellData,c:CentralizationReportData,scope:CasingChartScope,selection?:ReportSelection,a?:CasingRunningAnalysis){
 const cfg=normalizeDepthChartSettings(c.chartSettings??w.depthChartSettings),unit=DEPTH_UNITS[cfg.depthUnit];
 const depth=(title:string,item:ReportItem,id:string,rows:{md:number;tvd?:number}[],label:string,unitLabel:string,series:PlotSeries[])=>{
  const coordinates=rows.map(p=>({mdM:p.md,tvdM:p.tvd??interpolateTrajectory(getEffectiveTrajectory(w),p.md).tvd}));
  const plot=reportSeriesPlot(title,item,coordinates.map(p=>(cfg.coordinate==='TVD'?p.tvdM:p.mdM)*unit.k),label+' '+cfg.coordinate+', '+unit.label,unitLabel,series,{depth:true,plotId:id,note:'Порядок MD сохранён; одинаковые TVD не объединены. Пустые значения не заменяются нулями.'});
  return {...plot,data:{...plot.data,coordinates}};
 };
 const plots:ReturnType<typeof runningBroomPlot>[]=[];
 if(scope==='centralization'&&c.calculated&&c.results.length){const r=c.results;
  plots.push(depth('Профиль Standoff на опорах и в пролёте','standoff','centralStandoff',r,'Глубина','Standoff, %',[{name:'В пролёте',color:'#dc2626',values:r.map(p=>p.standoff)},{name:'На опоре',color:'#0284c7',values:r.map(p=>100*(1-(p.supportEccentricity??p.eccentricity)))},...(c.targetStandoff===undefined?[]:[{name:'Цель',color:'#64748b',dash:'5 4',reference:true,values:r.map(()=>c.targetStandoff)}])]),depth('Центрирование: боковая нагрузка','loads','centralLoad',r,'Глубина','Нагрузка, кН',[{name:'Боковая нагрузка',color:'#7c3aed',values:r.map(p=>p.lateralLoadKN)}]),depth('Центрирование: прогиб трубы в пролёте','loads','centralSag',r,'Глубина','Прогиб, мм',[{name:'Прогиб трубы (не рессоры)',color:'#d97706',values:r.map(p=>p.spanSagMM)}]));
 }
 if(scope==='running'&&c.running){const s=normalizeRunningSettings(w.runningSettings,c.running.frictionCased,c.running.frictionOpenhole),result=a??casingRunningResult(w,c)!;
  if(result.valid){const r=result.profile;plots.push(runningBroomPlot(result,s,w,cfg),depth('Профиль осевых сил по колонне','forceProfile','runningForce',r,'Глубина сечения','Осевое усилие, кН',[{name:'Спуск',color:'#15803d',values:r.map(p=>p.runInKN)},{name:'Подъём',color:'#dc2626',values:r.map(p=>p.pullOutKN)},{name:'Без трения',color:'#0369a1',values:r.map(p=>p.freeKN)}]),depth('Профиль сопротивлений вдоль колонны','forceProfile','runningDrag',r,'Глубина сечения','Накопленное сопротивление, кН',[{name:'Оснастка',color:'#7c3aed',values:r.map(p=>p.toolDragKN)},{name:'Вязкое',color:'#0284c7',values:r.map(p=>p.viscousDragKN)},{name:'Стенка',color:'#64748b',values:r.map(p=>p.wallDragKN)}]),depth('Момент при спуске: сухое вращение','torque','runningTorque',result.broom,'Глубина башмака','Момент, кН·м',[{name:'Сухое трение при вращении',color:'#7c3aed',values:result.broom.map(p=>p.torqueKNm)}]));}
 }
 return plots.filter(p=>reportIncludes(selection,p.reportItem)&&hasPlotNumbers(p)).map(p=>({...p,sourceKey:JSON.stringify([scope,p.plotId,p.data])}));
}
export function missingCasingChartItems(plots:ReturnType<typeof casingDesignCharts>,scope:CasingChartScope,selection?:ReportSelection){return REPORT_ITEMS[scope].filter(([k])=>(scope==='centralization'?['standoff','loads']:['broom','forceProfile','torque']).includes(k)&&reportIncludes(selection,k)&&!plots.some(p=>p.reportItem===k));}
export function casingChartRows(p:ReturnType<typeof casingDesignCharts>[number]){return [[p.data.xLabel,'MD, м (исходная)','TVD, м (исходная)',...p.data.series.map(s=>s.name+' ['+p.data.leftLabel+']')],...p.data.xValues.map((x,i)=>[x,p.data.coordinates[i].mdM,p.data.coordinates[i].tvdM,...p.data.series.map(s=>s.values[i])])];}
/** Full current rows. No raw passport/note or attached document bodies are exported. */
export function casingDesignWorkbook(w:WellData,c:CentralizationReportData,scope:CasingChartScope,selection?:ReportSelection,a?:CasingRunningAnalysis){
 if(!c.calculated||(scope==='centralization'&&!c.results.length))throw new Error('Сначала выполните актуальный расчёт.');
 if(scope==='running'&&!(a??casingRunningResult(w,c))?.valid)throw new Error('Проверьте исходные данные дохождения.');
 const book=XLSX.utils.book_new(),plots=casingDesignCharts(w,c,scope,selection,a),catalog:(string|number|null)[][]=[['Раздел Word','График','Лист XLSX','Координата','Значения','Строк','Статус']];
 const append=(name:string,rows:unknown[][])=>{if(rows.length>1048576)throw new Error('Превышен предел строк XLSX.');const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=rows[0].map(()=>({wch:28}));XLSX.utils.book_append_sheet(book,sheet,name);};
 plots.forEach((p,i)=>{const name='График '+(i+1);catalog.push([REPORT_ITEMS[scope].find(([k])=>k===p.reportItem)![1],p.title,name,p.data.xLabel,p.data.leftLabel,p.data.xValues.length,p.data.series.some(s=>s.values.some(v=>v!==null))?'Есть ряд':'Нет числовых значений']);append(name,casingChartRows(p));});
 for(const [,title]of missingCasingChartItems(plots,scope,selection))catalog.push([title,'','','','',0,'Нет актуальных числовых данных']);
 if(reportIncludes(selection,'chartData')){append('Карта графиков',catalog);book.SheetNames=['Карта графиков',...book.SheetNames.filter(x=>x!=='Карта графиков')];}
 if(reportIncludes(selection,'inputs')){append('Скважина',[['Параметр','Значение'],['Глубина башмака MD, м',w.casingDepthMD],['Наружный диаметр, мм',w.casingOD],['Стенка, мм',w.casingWall],['Ствол, мм',w.holeDiameter],['Башмак предыдущей колонны MD, м',w.prevCasingDepth],['Проход предыдущей колонны, мм',w.prevCasingID]]);append('Траектория',[['MD, м','TVD, м','Зенит, °','Азимут, °'],...getEffectiveTrajectory(w).map(p=>[p.md,p.tvd,p.zenith,p.azimuth])]);}
 if(reportIncludes(selection,'materials'))append('Оснастка',[['Наименование','Изготовитель','Количество, шт.'],...centralizerInventory(w.casingDepthMD,c.intervals).map(p=>[p.model,p.manufacturer,p.quantity])]);
 if(scope==='centralization'&&reportIncludes(selection,'turbulatorFlow')&&c.turbulatorFlows?.length){
  append('Турбулизаторы',[['MD, м','Жидкость','Q, л/с','Ствол, мм','vz, м/с','vθ, м/с','vθ/vz','Re','L, м MD','Порог достигнут','Δp, МПа','Статус'],...c.turbulatorFlows.map(r=>[r.point.md,c.turbulatorFluid?.name,c.turbulatorRateLps,r.boreMm,r.valid?r.axialMs:null,r.valid?r.tangentialMs:null,r.valid?r.ratio:null,r.valid?r.reynolds:null,r.valid?r.lengthM:null,r.valid?r.reachedThreshold:null,r.valid?r.pressureLossMPa:null,r.issues.join(' ')])]);
  append('Затухание',[['MD установки, м','MD сечения, м','Выше изделия, м','vz, м/с','vθ, м/с','vθ/vz','Фаза, рад'],...c.turbulatorFlows.flatMap(r=>r.samples.map(v=>[r.point.md,v.md,v.distanceM,v.axialMs,v.tangentialMs,v.ratio,v.phase]))]);
  append('Модель закрутки',[['Условие','Значение'],['Метод',TURBULATOR_MODEL_NOTE],['Порог',c.turbulatorDesign?.threshold],['Передача закрутки',c.turbulatorDesign?.turningEfficiency]]);
 }
 if(scope==='centralization'){
  if(reportIncludes(selection,'loads')||reportIncludes(selection,'standoff'))append('Центрирование',[['MD, м','TVD, м','Зенит, °','Standoff в пролёте, %','Standoff опоры, %','Боковая нагрузка, кН','Прогиб трубы, мм','Пролёт, м','Перегрузка опоры','А/Б','MD опоры, м'],...c.results.map(p=>[p.md,p.tvd,p.zenith,p.standoff,100*(1-(p.supportEccentricity??p.eccentricity)),p.lateralLoadKN??null,p.spanSagMM??null,p.supportSpanM??null,p.supportOverloaded===undefined?null:p.supportOverloaded?'Да':'Нет',p.centralizerRole??null,p.centralizerMD??null])]);
  if(reportIncludes(selection,'placement'))append('Установка',[['№ участка','Кровля MD, м','Подошва MD, м','MD изделия, м','А/Б','Наименование','Изготовитель'],...buildCentralizerJointSchedule(w.casingDepthMD,c.intervals).flatMap(row=>row.placements.map(p=>[row.jointNum,row.topMD,row.bottomMD,p.md,p.role,p.spec.passport?.model??p.spec.type,p.spec.passport?.manufacturer??'Не задан']))]);
 }else if(c.running){const result=a??casingRunningResult(w,c)!,s=normalizeRunningSettings(w.runningSettings,c.running.frictionCased,c.running.frictionOpenhole);
  if(reportIncludes(selection,'runningLoads')){append('Веник',[['Башмак MD, м','Спуск, тс','Подъём, тс','Без трения, тс','Спуск μ ниже','Спуск μ выше','Подъём μ ниже','Подъём μ выше','Без оснастки, тс','Момент, кН·м','Число опор'],...result.broom.map(p=>[p.md,p.runIn,p.pullOut,p.free,p.runLow,p.runHigh,p.pullLow,p.pullHigh,p.noTools,p.torqueKNm,p.toolCount])]);append('Профиль усилий',[['Сечение MD, м','Спуск, кН','Подъём, кН','Без трения, кН','Нормальная нагрузка, кН/м','Стенка, кН','Оснастка, кН','Вязкое, кН','Изгиб, МПа','Осевое + изгиб, МПа','Зазор, мм'],...result.profile.map(p=>[p.md,p.runInKN,p.pullOutKN,p.freeKN,p.normalKNPerM,p.wallDragKN,p.toolDragKN,p.viscousDragKN,p.bendingMPa,p.combinedAxialBendingMPa,p.clearanceMM])]);}
  if(reportIncludes(selection,'measurements'))append('Замеры',[['MD, м','Режим','Крюк, тс','В пределах расчётной глубины'],...s.measurements.map(m=>[m.md,m.mode==='runIn'?'Спуск':'Подъём',m.hookTF,m.md<=w.casingDepthMD?'Да':'Нет'])]);
  if(reportIncludes(selection,'inputs'))append('Параметры спуска',[['Параметр','Значение'],['Плотность БР, кг/м³',c.running.mudDensity],['PV, сПз',c.running.pv],['YP, Па',c.running.yp],...Object.entries(s).filter(([,v])=>typeof v!=='object').map(([k,v])=>[k,v]),...result.errors.map(n=>['Ошибка',n]),...result.notes.map(n=>['Допущение',n])]);
 }
 append('Условия',[['Условие','Значение'],['Область',scope==='centralization'?'Только центрирование':'Только дохождение'],['Координаты','Порядок MD сохранён. TVD по действующей траектории; горизонтальные участки не объединяются. Исходные MD/TVD в метрах записаны рядом с отображаемой координатой.'],['Числа','Полные расчётные ряды без округления. Пусто - нет значения; ноль - рассчитанный ноль.'],['Различие глубин','Веник/момент: текущий башмак. Профиль усилий/сопротивлений: сечение полностью спущенной трубы.'],['Механика','Существующая оценочная модель. Штриховые линии - чувствительность к трению, не доверительный интервал.'],['Комплектность','3D, сечения и формы планок остаются отдельными иллюстрациями Word, не притворяются числовыми кривыми. Паспортные документы не вкладываются.'],...c.results.flatMap(p=>p.calculationAssumptions??[]).filter((v,i,a)=>a.indexOf(v)===i).map(n=>['Допущение',n])]);
 return book;
}
