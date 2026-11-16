import {type RheologyInput} from './cement-rheology';
import {rheologyChartData} from './rheology-data';
import {reportSeriesPlot,type PlotSeries} from './report-series-plot';
export function rheologyFigure(r:RheologyInput,residual=false,name='',appliedR:RheologyInput=r,plotId?:string){
 const d=rheologyChartData(r,appliedR);if(!d.original.fit)return;
 const title=(residual?'Остатки реологии':'Кривые течения')+(name?': '+name:'');
 const x=residual?d.measurements.map(p=>p.gamma).sort((a,b)=>a-b):d.x;
 const series:PlotSeries[]=residual?d.models.map(m=>({name:m.name,color:m.color,values:x.map(g=>m.pred(g)-d.measurements.find(p=>p.gamma===g)!.tau)})):d.curves;
 if(residual){if(d.applied.valid)series.push({name:'Выбранная модель: '+d.applied.label,color:'#0f766e',values:x.map(g=>{const a=d.predictApplied(g);return a===null?null:a-d.measurements.find(p=>p.gamma===g)!.tau;})});series.push({name:'Ноль отклонения',color:'#94a3b8',reference:true,dash:'4 4',values:x.map(()=>0)});}
 else series.push({name:'Замеры Fann',color:'#111827',markersOnly:true,values:x.map(g=>d.measurements.find(p=>p.gamma===g)?.tau??null)});
 const note='Выбор: '+d.applied.label+(d.applied.valid?'':'; '+d.applied.error)+'; только диапазон замеров, без экстраполяции.';
 return reportSeriesPlot(title,'rheology',x,'Скорость сдвига, с⁻¹',residual?'Модель минус замер, Па':'Напряжение сдвига, Па',series,{plotId:plotId??('rheology-'+(residual?'residual':'flow')),note});
}
export function rheologyCsv(r:RheologyInput){const d=rheologyChartData(r);if(!d.original.fit)return '';return `Модель;${d.applied.label}\nЕдиницы;скорость сдвига с^-1;напряжение Па\nRPM;gamma_s-1;tau_Pa;Bingham_Pa;PowerLaw_Pa;HB_Pa;Bingham_residual_Pa;PowerLaw_residual_Pa;HB_residual_Pa;Applied_Pa;Applied_residual_Pa\n`+d.measurements.map(p=>[p.rpm,p.gamma,p.tau,...p.predictions,...p.predictions.map(v=>v-p.tau),p.applied??'',p.applied===null?'':p.applied-p.tau].join(';')).join('\n');}
