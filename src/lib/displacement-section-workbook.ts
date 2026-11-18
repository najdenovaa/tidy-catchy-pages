import * as XLSX from 'xlsx';
import {SECTION_NOTE,type DisplacementSection} from './displacement-section';
export function displacementSectionWorkbook(s:DisplacementSection){
 const w=XLSX.utils.book_new(),g=s.geometry;
 const sheets:[string,unknown[][]][]=[
 ['Состав сечения',[['№','Жидкость','Цвет','Труба, %','Затрубье, %'],...s.fluids.map((f,i)=>[i+1,f.name,s.colors[i],s.pipeFractions[i]===null?null:s.pipeFractions[i]*100,s.annulusFractions[i]===null?null:s.annulusFractions[i]*100])]],
 ['Секторы',[['№ сектора','Исходная угловая ячейка','Начало отображения, град','Конец отображения, град','Объёмный вес, %','Площадь, мм²','Зазор модели, мм',...s.fluids.map((f,i)=>(i+1)+'. '+f.name+', %')],...s.sectors.filter(x=>x.sourceCell!==null).map(x=>[x.index,x.sourceCell,x.startAngle*180/Math.PI,x.endAngle*180/Math.PI,x.weight*100,x.areaMm2,x.gapMm,...x.fractions.map(f=>f===null?null:f*100)])]],
 ['Условия',[['Параметр','Значение'],['Запрошенная MD, м',s.requestedMD],['Общий кадр',s.frame],['От начала закачки, с',s.timeS],['Кадр затрубья',s.annulusFrame],['Время затрубного кадра, с',s.annulusTimeS],['Ячейка трубы, м',s.pipeBounds?.join(' / ')??'Нет'],['Ячейка затрубья, м',s.annulusBounds?.join(' / ')??'Нет'],['Труба',s.pipeStatus],['Затрубье',s.annulusStatus],['ОК OD, мм',2*g.ro],['ОК ID, мм',2*g.ri],['Ствол, мм',2*g.rh],['Смещение осей, мм',g.offset],['Минимальный зазор, мм',g.minGapMm],['Максимальный зазор, мм',g.maxGapMm],['Принятый stand-off, %',g.standoff*100],['Изображение',SECTION_NOTE],['Пустые доли','Нет расчёта/ячейки/полного состава. Не заменяются нулём.']]],
 ];
 for(const[name,rows]of sheets){const sheet=XLSX.utils.aoa_to_sheet(rows);sheet['!cols']=rows[0].map(()=>({wch:28}));XLSX.utils.book_append_sheet(w,sheet,name);}return w;
}
