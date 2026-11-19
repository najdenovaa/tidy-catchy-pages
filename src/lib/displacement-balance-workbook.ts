import * as XLSX from 'xlsx';
import {ANNULAR_BALANCE_NOTE,BALANCE_COLUMNS,annularBalanceRows} from './displacement-balance';
import type {D2Result} from './displacement-2d';
export function addAnnularBalanceSheets(book:XLSX.WorkBook,r:Pick<D2Result,'fluids'|'snapshots'>,frame:number,offsetS=0){
 const b=r.snapshots[frame]?.balance;if(!b)return false;
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([BALANCE_COLUMNS,...annularBalanceRows(b,r.fluids.map(f=>f.name))]),'Баланс затрубья');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Кадр','Время затрубья, с','От начала закачки, с',...BALANCE_COLUMNS],...r.snapshots.flatMap((s,i)=>s.balance?annularBalanceRows(s.balance,r.fluids.map(f=>f.name)).map(row=>[i,s.t,s.t+offsetS,...row]):[])]),'Баланс все кадры');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Метод',ANNULAR_BALANCE_NOTE],['Выбранный кадр',frame],['Ноль времени затрубья, с',offsetS],['Знак численной поправки','Положительное значение добавляет объём жидкости; отрицательное убирает. Невязка до поправок плюс обрезка плюс нормировка равна необъяснённой невязке.']]),'Метод баланса');return true;
}
export function annularBalanceWorkbook(r:Pick<D2Result,'fluids'|'snapshots'>,frame:number,offsetS=0){const book=XLSX.utils.book_new();if(!addAnnularBalanceSheets(book,r,frame,offsetS))throw Error('Баланс старого расчёта отсутствует. Пересчитайте модель.');return book;}
