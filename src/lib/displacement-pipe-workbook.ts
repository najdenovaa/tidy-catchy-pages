import {timingRows,type DisplacementTimingSettings,type DisplacementTimingStats} from './displacement-timing';
import * as XLSX from 'xlsx';
import { pipeHistory,pipeBalance,pipeDepthComposition,PIPE_NOTE,type PipeTransport,type DisplacementFrame } from './displacement-pipe';
export function pipeWorkbook(p:PipeTransport,md:number,frames:DisplacementFrame[],frame:number,settings?:DisplacementTimingSettings,stats?:DisplacementTimingStats){
 const cell=pipeDepthComposition(p,md,0);if(!cell)throw new Error('Глубина вне трубы');
 const w=XLSX.utils.book_new(),rows=pipeHistory(p,md,frames);
 for(const[name,values]of [
 ['Труба - доли',[['Кадр','От начала закачки, с','MD центра, м',...p.fluids.map((f,i)=>(i+1)+'. '+f.name+', %')],...rows.map(r=>[r.frame,r.timeS,r.md,...r.fractions.map(x=>x*100)])]],
 ['Баланс трубы',[['Жидкость','Исходно, м³','Вошло, м³','В трубе, м³','Через башмак, м³','Невязка, м³'],...pipeBalance(p,frames[frame].timeS).map(b=>[b.name,b.initialM3,b.injectedM3,b.insideM3,b.outletM3,b.residualM3])]],
 ['Условия',[['Параметр','Значение'],['Запрошенная MD, м',md],['Ячейка сверху, м',cell.topMD],['Ячейка снизу, м',cell.bottomMD],['Кадр',frame],['Время, с',frames[frame].timeS],['Вместимость, м³',p.capacityM3],['Модель',PIPE_NOTE],...timingRows(settings,stats)]]
 ] as [string,unknown[][]][]){const sheet=XLSX.utils.aoa_to_sheet(values);sheet['!cols']=values[0].map(()=>({wch:25}));XLSX.utils.book_append_sheet(w,sheet,name);}
 return w;
}
