import type {BasketStopResult} from './cement-basket-stop';
import {reportSeriesPlot} from './report-series-plot';
import {normalizeDepthChartSettings,DEPTH_UNITS,PRESSURE_UNITS,type DepthChartSettings} from './depth-chart-settings';
import * as XLSX from 'xlsx';
export function basketStopCharts(result:BasketStopResult|undefined,settings?:DepthChartSettings){
 if(!result?.rows.length)return [];
 const c=normalizeDepthChartSettings(settings),d=DEPTH_UNITS[c.depthUnit],p=PRESSURE_UNITS[c.pressureUnit];
 const plot=reportSeriesPlot('Корзина: полный столб и сценарий через '+result.elapsedMin+' мин после Стоп; '+c.coordinate+', '+d.label,'basket',result.rows.map(r=>(c.coordinate==='TVD'?r.tvd:r.md)*d.k),'Глубина '+c.coordinate+', '+d.label,'Давление, '+p.label,[
  {name:'Полный столб сразу после Стоп',color:'#2563eb',values:result.rows.map(r=>r.withoutMPa*p.k)},
  {name:'Сценарная передача нагрузки',color:'#ea580c',dash:'6 4',values:result.rows.map(r=>r.scenarioMPa*p.k)},
  {name:'Пластовое: заданное',color:'#a16207',reference:true,values:result.rows.map(r=>r.poreMPa===null?null:r.poreMPa*p.k)},
  {name:'ГРП / поглощение: заданный предел',color:'#dc2626',reference:true,dash:'4 4',values:result.rows.map(r=>r.limitMPa===null?null:r.limitMPa*p.k)}],{depth:true,plotId:'basketStop',note:'Сценарий не уменьшает давления в основных проверках ГРП. Корзина не является герметичным пакером.'});
 return [{...plot,data:{...plot.data,coordinates:result.rows.map(r=>({mdM:r.md,tvdM:r.tvd}))}}];
}
export function appendBasketSheets(w:XLSX.WorkBook,r:BasketStopResult){
 const profile=[['MD, м','TVD, м','Полный столб, МПа','Сценарий, МПа','Снижение, МПа','Пластовое, МПа','Предел, МПа','Источники пластового (максимум)','Источники предела (минимум)'],...r.rows.map(p=>[p.md,p.tvd,p.withoutMPa,p.scenarioMPa,p.reductionMPa,p.poreMPa,p.limitMPa,p.poreSource??'Источник не сохранён',p.limitSource??'Источник не сохранён'])];
 const loads=[['ID','Модель','MD, м','Активная заданная доля до ограничения, %','Потенциальное снижение, МПа','Передано, МПа','Реакция, кН','Несущая способность, кН','Ограничена способностью','Примечания'],...r.baskets.map(b=>[b.id,b.model,b.md,b.transferPct,b.potentialMPa,b.transferredMPa,b.reactionKN,b.capacityKN??null,b.limited?'Да':'Нет',b.notes.join('; ')])];
 const inputs=[['ID','Модель','Производитель','Источник изделия (не подтверждение параметров)','MD, м','Количество позиции','Задано: передача, %','Задано: время перемычки, мин','Задано: плотность носителя, г/см³','Применено: плотность носителя, г/см³','Задано: несущая способность, кН'],...(r.inputs??[]).map(b=>[b.id,b.model,b.manufacturer,b.sourceUrl??'',b.md,b.quantity,b.supportPct??null,b.bridgeMin??null,b.carrierDensity??null,b.effectiveCarrierDensity,b.capacityKN??null])];
 for(const [name,rows] of [['Корзины - профиль',profile],['Корзины - нагрузки',loads],['Корзины - исходные',inputs],['Корзины - условия',[['Условие','Значение'],['Момент после Стоп, мин',r.elapsedMin],['Параметры сценария','Заданные пользователем значения; ссылка изготовителя не подтверждает долю, время или способность. Паспортные документы не включены.'],['Снимок исходных данных',r.inputs?'Сохранён при расчёте':'Не сохранён в этом результате; не восстанавливается из текущего ввода.'],...r.notes.map(n=>['Ограничение',n])]]] as const){const s=XLSX.utils.aoa_to_sheet(rows as unknown[][]);s['!cols']=rows[0].map(()=>({wch:30}));XLSX.utils.book_append_sheet(w,s,name);}
}
