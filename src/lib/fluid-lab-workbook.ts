import * as XLSX from 'xlsx';
import {fluidLabReport,REMOVAL_NOTE,type FluidLabReportInput} from './fluid-lab-report';
import {FLUID_LAB_NOTE} from './fluid-interaction-lab';
import type {DisplacementReportData} from './cementing-report-data';
export function fluidLabWorkbook(input:FluidLabReportInput,d?:DisplacementReportData|null){const data=fluidLabReport(input,d),book=XLSX.utils.book_new();
 const sheets:[string,unknown[][]][]=[
 ['Смеси',[['ID','Протокол','T, °C','P, МПа абс.','Компоненты, об. доли','PV, сПз','ДНС, Па','Наблюдение','Примечание'],...(data.lab?.mixtures??[]).map(t=>[t.id,t.source,t.temperatureC,t.pressureMPaAbs,t.fractions.map(f=>(data.fluids.find(x=>x.id===f.fluidId)?.name??f.fluidId)+': '+f.share).join('; '),t.pvCp,t.ypPa,t.observation,t.notes])]],
 ['Протоколы вымывания',[['ID','Источник','Промывка','Кровля MD, м','Подошва MD, м','Критический сдвиг, Па','Воздействие, с','Смытие в испытании, %','T, °C','P, МПа абс.','Состояние','Примечания'],...data.profiles.map(p=>[p.test.id,p.test.source,p.test.cleanerId,p.test.fromMD,p.test.toMD,p.test.criticalPa,p.test.exposureS,p.test.removalPct??null,p.test.temperatureC,p.test.pressureMPaAbs,p.error??'Привязан к сценарию',p.test.notes])]],
 ['Кривые сдвига',[['Протокол','MD, м','TVD, м',data.axisLabel,'Требуется, Па','Доступно min, Па','Доступно max, Па','Доля чистой промывки в ячейке, %'],...data.profiles.flatMap(p=>p.rows.map(r=>[p.test.id,r.md,r.tvd,r.depth,r.requiredPa,r.availableMinPa,r.availableMaxPa,r.pureCoveragePct]))]],
 ['Условия',[['Параметр','Значение'],['Температура сценария, °C',data.lab?.temperatureC??null],['Давление сценария, МПа абс.',data.lab?.pressureMPaAbs??null],['Измеренные смеси включены',data.lab?.useMixtures?'Да':'Нет'],['Время кадра состава, с',data.timeS],['Время поля сдвига, с',data.shearTimeS],['Метод смесей',FLUID_LAB_NOTE],['Метод вымываемости',REMOVAL_NOTE],...data.issues.map(x=>['Замечание',x])]],
 ];for(const[name,rows]of sheets){const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=rows[0].map(()=>({wch:26}));XLSX.utils.book_append_sheet(book,sheet,name);}return book;}
