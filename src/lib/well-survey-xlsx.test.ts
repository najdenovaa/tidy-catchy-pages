import {describe,it,expect} from 'vitest';
import * as XLSX from 'xlsx';
import {parseSurveyWorksheet,surveyWorkbookSheets} from './well-survey-xlsx';
import {buildSurvey,parseSurveyText,surveyColumns} from './well-survey-import';
import {interpolateTVD} from './cementing-calculations';
import {calculateCentralization} from './centralization-calculations';
import {getCementingExample} from './cementing-example';
import {readFileSync} from 'node:fs';
const grid=[['Azimuth [deg]','MD [ft]','Inclination [rad]','TVD [m]'],[0,0,0,0],[90,100,Math.PI/6,123],[90,200,Math.PI/3,456]];
const file=(rows:unknown[][],type:'xlsx'|'xls'='xlsx',modify?:(s:XLSX.WorkSheet)=>void)=>{
 const w=XLSX.utils.book_new(),s=XLSX.utils.aoa_to_sheet(rows);modify?.(s);XLSX.utils.book_append_sheet(w,s,'Замеры');return XLSX.write(w,{type:'array',bookType:type}) as ArrayBuffer;
};
const run=(bytes:ArrayBuffer)=>{const t=parseSurveyWorksheet(bytes,'Замеры');return buildSurvey(t,surveyColumns(t),'ft','rad','deg');};
describe('F04 unified TXT / Excel import',()=>{
 it.each(['xlsx','xls'] as const)('%s preserves values and source rows; same minimum-curvature MD/TVD as TXT, not the file TVD',type=>{
  const b=file(grid,type),t=parseSurveyWorksheet(b,'Замеры');expect(surveyWorkbookSheets(b)).toEqual(['Замеры']);expect(t.sourceRows).toEqual([2,3,4]);
  const txt=parseSurveyText(grid.map(r=>r.join(';')).join('\n'));
  expect(run(b).points).toEqual(buildSurvey(txt,surveyColumns(txt),'ft','rad','deg').points);expect(run(b).warnings.join()).toContain('TVD из файла');
  expect(run(b).points[1].md).toBe(30.48);expect(run(b).points[1].tvd).not.toBe(123);
 });
 it('chooses a sheet explicitly, finds a header below a title, and respects an explicit row range',()=>{
  const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['Cover']]),'Обложка');
  XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['Инклинометрия'],[],...grid,['Подпись']]),'Замеры');
  const b=XLSX.write(w,{type:'array',bookType:'xlsx'});expect(surveyWorkbookSheets(b)).toEqual(['Обложка','Замеры']);
  const t=parseSurveyWorksheet(b,'Замеры',{lastDataRow:6});expect(t.headerRow).toBe(3);expect(t.sourceRows).toEqual([4,5,6]);expect(t.warnings.join()).toContain('только выбранный диапазон');
  expect(buildSurvey(t,surveyColumns(t),'ft','rad','deg').points).toHaveLength(3);
  expect(()=>run(b)).toThrow(/Строка 7/);expect(()=>parseSurveyWorksheet(b,'Другой')).toThrow(/лист/);
 });
 it('does not drop blank, malformed or formula rows; identifies the actual Excel cell and refuses cached formula results',()=>{
  for(const row of [[90,'',.3,0],[90,'bad',.3,0],[]]){
   const b=file([...grid.slice(0,2),row,...grid.slice(2)]);expect(()=>run(b)).toThrow(/Строка 3/);
  }
  const formula=file(grid,'xlsx',s=>{s.B3={t:'n',v:100,f:'50+50'};});expect(()=>run(formula)).toThrow(/Замеры!B3: формула/);
  const date=file(grid,'xlsx',s=>{s.B3={t:'d',v:new Date('2026-01-01T00:00:00Z')};});expect(()=>run(date)).toThrow(/B3: дата/);
  const error=file(grid,'xlsx',s=>{s.B3={t:'e',v:7};});expect(()=>run(error)).toThrow(/B3: ошибка Excel/);
 });
 it('enforces common duplicate, tie-in, range and column-selection rules',()=>{
  expect(()=>run(file([grid[0],grid[1],grid[1]]))).toThrow(/Повторяются/);
  expect(()=>run(file([grid[0],...grid.slice(2)]))).toThrow(/MD=0/);
  expect(()=>run(file([grid[0],grid[1],[361,100,0,0]]))).toThrow(/360/);
  const t=parseSurveyWorksheet(file(grid),'Замеры');expect(()=>buildSurvey(t,{md:0,azimuth:0,zenith:2},'m','deg')).toThrow(/разные/);
  expect(()=>parseSurveyWorksheet(file(grid),'Замеры',{headerRow:1,firstDataRow:1})).toThrow(/диапазон/);
 });
 it('no header means explicit column mapping, with decimal commas and no forced order',()=>{
  const t=parseSurveyWorksheet(file([['0','0','0'],['90','100,5','30']]),'Замеры',{headerRow:0});expect(surveyColumns(t).md).toBe(-1);
  expect(buildSurvey(t,{azimuth:0,md:1,zenith:2},'m','deg').points[1].md).toBe(100.5);
 });
 it('warns about depth gaps and incomplete coverage; rejects an invalid warning threshold',()=>{
  const t=parseSurveyWorksheet(file(grid),'Замеры');
  const p=buildSurvey(t,surveyColumns(t),'ft','rad','deg',{maxGapM:20,targetDepthMD:100});expect(p.warnings.join()).toContain('разрыв MD');expect(p.warnings.join()).toContain('не покрывает');
  expect(()=>buildSurvey(t,surveyColumns(t),'ft','rad','deg',{maxGapM:0})).toThrow(/Порог/);
 });
 it('refuses oversized ranges, fake Excel and an unknown header row without allocating a full numeric grid',()=>{
  expect(()=>surveyWorkbookSheets(new TextEncoder().encode('MD;AZ;INC').buffer)).toThrow(/Ожидалась книга/);
  const huge=file(grid,'xlsx',s=>{s['!ref']='A1:D100200';});expect(()=>parseSurveyWorksheet(huge,'Замеры')).toThrow(/Слишком большой/);
  expect(()=>parseSurveyWorksheet(file(grid),'Замеры',{headerRow:100})).toThrow(/заголовка/);
 });
 it('reads the shipped template with the same mapping and reproduces downstream hydrostatic depth and centering',()=>{
  const source=readFileSync('public/trajectory_template.xlsx'),b=source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength) as ArrayBuffer;
  const t=parseSurveyWorksheet(b,surveyWorkbookSheets(b)[0]);expect(surveyColumns(t).md).toBeGreaterThanOrEqual(0);
  const x=buildSurvey(t,surveyColumns(t),'m','deg');expect(x.points.length).toBeGreaterThan(1);
  const tx=run(file(grid)).points,txt=buildSurvey(parseSurveyText(grid.map(r=>r.join(';')).join('\n')),surveyColumns(parseSurveyWorksheet(file(grid),'Замеры')),'ft','rad','deg').points;
  const w={...getCementingExample().wellData,casingDepthMD:60,wellDepthMD:60,trajectory:tx};
  expect(interpolateTVD(45,tx)).toBe(interpolateTVD(45,txt));
  expect(calculateCentralization(w,[],1100)).toEqual(calculateCentralization({...w,trajectory:txt},[],1100));
 });
});
