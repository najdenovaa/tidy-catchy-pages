import * as XLSX from 'xlsx';
import {PLACEMENT_NOTE,type DisplacementPlacement} from './displacement-placement';
export function displacementPlacementWorkbook(s:DisplacementPlacement){
 const book=XLSX.utils.book_new(),percent=(xs:(number|null)[])=>xs.map(x=>x===null?null:x*100);
 const sheets:[string,unknown[][]][]=[
 ['Размещение',[['Верх MD, м','Низ MD, м','Центр MD, м','TVD центра, м','Ячейка трубы','Ячейка затрубья','Объём трубы, м³','Объём затрубья, м³',...s.fluids.map((f,i)=>`Труба ${i+1}. ${f.name}, %`),...s.fluids.map((f,i)=>`Затрубье ${i+1}. ${f.name}, %`)],...s.rows.map(r=>[r.topMD,r.bottomMD,r.md,r.tvd,r.pipeCell,r.annulusCell,r.pipeVolumeM3,r.annulusVolumeM3,...percent(r.pipeFractions),...percent(r.annulusFractions)])]],
 ['Траектория',[['MD, м','Восток, м','TVD, м','Север, м'],...s.depths.map((md,i)=>[md,s.positions[i][0],-s.positions[i][1],s.positions[i][2]])]],
 ['Инвентарь',[['Жидкость','В трубе по профилю, м³','В трубе по балансу, м³','Невязка профиля трубы, м³','В затрубном поле, м³'],...s.fluids.map((f,i)=>[f.name,s.pipeInventory?.[i]??null,s.pipeLedger?.[i].insideM3??null,s.pipeInventory&&s.pipeLedger?s.pipeInventory[i]-s.pipeLedger[i].insideM3:null,s.annulusInventory?.[i]??null])]],
 ['Условия',[['Параметр','Значение'],['Время от начала закачки, с',s.timeS],['Общий кадр',s.frame],['Кадр затрубья',s.annulusFrame],['Время затрубного кадра, с',s.annulusTimeS],['Последний сохранённый кадр',s.isLast?'Да':'Нет'],['Расчёт завершён',s.completed?'Да':'Нет'],['Труба',s.pipeEnabled?'Рассчитана':'Отключена'],['Затрубье',s.annulusEnabled?'Рассчитано':'Отключено'],['Примечание',PLACEMENT_NOTE],['Пустые значения','Состав не рассчитан; нулём не заменяется']]],
 ];
 for(const[name,data]of sheets){const sheet=XLSX.utils.aoa_to_sheet(data);sheet['!cols']=data[0].map(()=>({wch:24}));XLSX.utils.book_append_sheet(book,sheet,name);}return book;
}
