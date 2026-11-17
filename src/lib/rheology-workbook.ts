import {appendHierarchySheets} from './rheology-hierarchy-workbook';
import * as XLSX from 'xlsx';
import {DIAL_TO_PA,RPM_TO_SHEAR} from './cement-rheology';
import {rheologyChartData} from './rheology-data';
import {rheologyReportFluids,type RheologyReportInput} from './rheology-report';
export function rheologyCoverage(input:RheologyReportInput){return rheologyReportFluids(input).map(f=>{const data=rheologyChartData(f.r,f.appliedR);return {...f,data,status:data.original.fit?'Есть кривые и замеры':'Нет аппроксимации: недостаточные либо неизменяющиеся положительные показания Fann'};});}
/** Provenance sheets supplement, never replace, the full plotted numeric sheets. */
export function appendRheologySheets(w:XLSX.WorkBook,input:RheologyReportInput){
 const fluids=rheologyCoverage(input);
 const catalog:(string|number|null)[][]=[['ID жидкости','Жидкость','Состояние графиков','Выбор в исходных данных','Применяемая модель','Допустима для гидравлики','Источник применяемых PV/YP','Мин. скорость сдвига, с⁻¹','Макс. скорость сдвига, с⁻¹','Ошибка выбора']];
 const raw:(string|number|null)[][]=[['ID жидкости','Жидкость','RPM','Шкала Fann, дел.','Скорость сдвига, с⁻¹','Напряжение из показания, Па','Статус показания']];
 const models:(string|number|null)[][]=[['ID жидкости','Жидкость','Роль','Модель','PV, мПа·с','YP / τ₀, Па','K, Па·с^n','n','R²','RMSE, Па','MAE, Па','Макс. ошибка, Па','Условие']];
 for(const f of fluids){const d=f.data,p=d.applied.params;
  catalog.push([f.id,f.name,f.status,d.original.label,d.applied.label,d.applied.valid?'Да':'Нет',f.appliedSource,d.min,d.max,d.applied.error]);
  for(const r of d.raw)raw.push([f.id,f.name,r.rpm,r.value,r.rpm*RPM_TO_SHEAR,r.value===null?null:r.value*DIAL_TO_PA,r.status]);
  for(const m of d.models){const fit=d.original.fit!,b=fit.bingham,pl=fit.powerLaw,hb=fit.hb;models.push([f.id,f.name,'Аппроксимация замеров',m.name,m.id==='bingham'?b.pv:null,m.id==='bingham'?b.ypPa:m.id==='hb'?hb.tau0:0,m.id==='bingham'?b.pv/1000:m.id==='powerLaw'?pl.K:hb.K,m.id==='bingham'?1:m.id==='powerLaw'?pl.n:hb.n,m.r2,m.rmse,m.mae,m.maxError,'Диагностика совпадения; не означает автоматический выбор']);}
  models.push([f.id,f.name,'Применяемая в гидравлике',d.applied.label,d.applied.valid&&!p?f.appliedR.pv:null,d.applied.valid?(p?.tau0??f.appliedR.yp):null,d.applied.valid?(p?.K??f.appliedR.pv/1000):null,d.applied.valid?(p?.n??1):null,null,null,null,null,d.applied.valid?f.appliedSource:d.applied.error]);
 }
 for(const [name,rows] of [['Реология - жидкости',catalog],['Реология - замеры',raw],['Реология - модели',models]] as const){const s=XLSX.utils.aoa_to_sheet(rows);s['!cols']=rows[0].map((_,i)=>({wch:i===1?40:26}));XLSX.utils.book_append_sheet(w,s,name);}
 appendHierarchySheets(w,input);
}
