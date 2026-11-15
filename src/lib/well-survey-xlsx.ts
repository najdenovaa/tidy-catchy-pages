/** Excel is an input adapter only. All units, duplicates, ranges and TVD use buildSurvey.
 * SheetJS parsing options: https://docs.sheetjs.com/docs/api/parse-options/ */
import * as XLSX from 'xlsx';
import {SURVEY_MAX_BYTES,SURVEY_MAX_ROWS,surveyColumns,surveyColumn,surveyNumber,type ImportTable} from './well-survey-import';
const MAX_SOURCE_ROWS=SURVEY_MAX_ROWS+100;
function checkBytes(bytes:ArrayBuffer){
  if(bytes.byteLength>SURVEY_MAX_BYTES)throw new Error('Файл больше 10 МБ. Разделите его на интервалы.');
  const b=new Uint8Array(bytes),zip=b[0]===0x50&&b[1]===0x4b&&b[2]===3&&b[3]===4,ole=b[0]===0xd0&&b[1]===0xcf&&b[2]===0x11&&b[3]===0xe0;
  if(!zip&&!ole)throw new Error('Ожидалась книга XLSX/XLS. Текстовый файл выберите как TXT/CSV.');
}
export function surveyWorkbookSheets(bytes:ArrayBuffer):string[]{
  checkBytes(bytes);
  const w=XLSX.read(new Uint8Array(bytes),{type:'array',bookSheets:true});
  if(!w.SheetNames.length||w.SheetNames.length>50)throw new Error('В книге должно быть от 1 до 50 листов. Выгрузите нужный лист отдельным файлом.');
  return w.SheetNames;
}
export interface SurveySheetOptions {headerRow?:number;firstDataRow?:number;lastDataRow?:number}
export interface SurveySheetTable extends ImportTable {sheetName:string;headerRow:number;firstDataRow:number;lastDataRow:number;totalRows:number}
export function parseSurveyWorksheet(bytes:ArrayBuffer,sheetName:string,options:SurveySheetOptions={}):SurveySheetTable {
  checkBytes(bytes);
  const w=XLSX.read(new Uint8Array(bytes),{type:'array',sheets:sheetName,sheetRows:MAX_SOURCE_ROWS+1,cellDates:true,cellFormula:true,cellHTML:false,cellText:false});
  const sheet=w.Sheets[sheetName];if(!sheet)throw new Error('Выберите существующий лист книги.');
  const ref=sheet['!fullref']??sheet['!ref'];if(!ref)throw new Error('Лист пуст. Выберите лист с инклинометрией.');
  const range=XLSX.utils.decode_range(ref),totalRows=range.e.r+1,width=range.e.c+1;
  if(totalRows>MAX_SOURCE_ROWS||width>128||totalRows*width>2000000)throw new Error('Слишком большой диапазон листа: максимум 100 100 строк, 128 колонок и 2 млн ячеек. Выгрузите нужный диапазон отдельно.');
  const cell=(r:number,c:number)=>sheet[XLSX.utils.encode_cell({r:r-1,c})] as XLSX.CellObject|undefined;
  const names=(r:number)=>Array.from({length:width},(_,c)=>String(cell(r,c)?.v??'').trim());
  let header=options.headerRow;
  if(header===undefined){
    header=0;
    for(let r=range.s.r+1;r<=Math.min(totalRows,range.s.r+20);r++){
      const m=surveyColumns({columns:names(r).map(surveyColumn),rows:[],warnings:[]});
      if(Object.values(m).every(x=>x>=0)&&new Set(Object.values(m)).size===3){header=r;break;}
    }
  }
  if(!Number.isInteger(header)||header<0||header>totalRows)throw new Error('Строка заголовка: 0 (без заголовка) либо номер существующей строки листа.');
  const first=options.firstDataRow??(header?header+1:range.s.r+1),last=options.lastDataRow??totalRows;
  if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last>totalRows||last<first||(header&&first<=header))throw new Error('Проверьте диапазон строк данных: после заголовка, в пределах листа.');
  if(last-first+1>SURVEY_MAX_ROWS)throw new Error('Больше 100 000 точек. Разделите файл.');
  const columns=(header?names(header):Array.from({length:width},(_,i)=>`Колонка ${i+1}`)).map((n,i)=>surveyColumn(n||`Колонка ${i+1}`));
  const rows:ImportTable['rows']=[],sourceRows:number[]=[],cellIssues:NonNullable<ImportTable['cellIssues']>={};
  for(let r=first;r<=last;r++){
    const out:(number|null)[]=[];
    for(let c=0;c<width;c++){
      const v=cell(r,c);let issue='';
      if(v?.f!==undefined||v?.F!==undefined)issue='формула: вставьте проверенное числовое значение';
      else if(v?.t==='d')issue='дата вместо числа';
      else if(v?.t==='b')issue='логическое значение вместо числа';
      else if(v?.t==='e')issue='ошибка Excel';
      if(issue)cellIssues[`${rows.length}:${c}`]=`${sheetName}!${XLSX.utils.encode_cell({r:r-1,c})}: ${issue}.`;
      out.push(issue?null:surveyNumber(v?.v));
    }
    rows.push(out);sourceRows.push(r);
  }
  const warnings=header?[]:['Нет заголовка: назначьте MD, азимут и зенит вручную.'];
  if(first>(header?header+1:range.s.r+1)||last<totalRows)warnings.push(`Применяется только выбранный диапазон строк ${first}-${last}; остальные строки не импортируются.`);
  return {columns,rows,sourceRows,cellIssues,warnings,sheetName,headerRow:header,firstDataRow:first,lastDataRow:last,totalRows};
}
