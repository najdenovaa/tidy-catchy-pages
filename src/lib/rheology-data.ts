import {FANN_RPMS,RHEOLOGY_MODELS,rheologyResolution,rheologyMetrics,type RheologyInput} from './cement-rheology';
export const RHEOLOGY_FIT_MODELS=['bingham','powerLaw','hb'] as const;
/** One dataset for the plotted curves, CSV and workbook. No new fitting method. */
export function rheologyChartData(input:RheologyInput,appliedInput:RheologyInput=input){
 const original=rheologyResolution(input),applied=rheologyResolution(appliedInput),fit=original.fit;
 const models=fit?RHEOLOGY_FIT_MODELS.map((id,i)=>({id,name:RHEOLOGY_MODELS[id],color:['#64748b','#ef7d21','#4338ca'][i],...rheologyMetrics(fit,id)})):[];
 const predictApplied=(g:number)=>{if(!applied.valid)return null;const p=applied.params,n=p?p.tau0+p.K*g**p.n:appliedInput.yp+appliedInput.pv*g/1000;return Number.isFinite(n)?n:null;};
 const measurements=fit?.points.map(p=>({...p,predictions:models.map(m=>m.pred(p.gamma)),applied:predictApplied(p.gamma)}))??[];
 const min=fit?Math.min(...fit.points.map(p=>p.gamma)):null,max=fit?Math.max(...fit.points.map(p=>p.gamma)):null;
 // Include every original measurement in addition to the 81-point model grid.
 const x=min!==null&&max!==null?[...new Set([...Array.from({length:81},(_,i)=>min+(max-min)*i/80),...measurements.map(p=>p.gamma)])].sort((a,b)=>a-b):[];
 const curves=models.map(m=>({name:m.name,color:m.color,values:x.map(m.pred)}));
 if(applied.valid&&fit)curves.push({name:'Выбранная модель: '+applied.label,color:'#0f766e',values:x.map(predictApplied)});
 const raw=FANN_RPMS.map(rpm=>{const value=input.fann?.[`r${rpm}` as keyof NonNullable<RheologyInput['fann']>];return {rpm,value:Number.isFinite(value)?value!:null,status:value===undefined?'Нет замера':!Number.isFinite(value)?'Неконечное значение':value!<=0?'Исключено из подбора: требуется положительное показание':fit?'Использовано в подборе':'Подбор недоступен'};});
 return {original,applied,models,measurements,x,curves,min,max,raw,predictApplied};
}
