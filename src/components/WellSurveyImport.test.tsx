import * as XLSX from 'xlsx';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import WellSurveyImport from './WellSurveyImport';
import InputSection from './InputSection';
import {MemoryRouter} from 'react-router-dom';
import {getCementingExample} from '@/lib/cementing-example';
afterEach(cleanup);
const las='~V\nVERS. 2.0 : version\nWRAP. NO : wrap\n~W\nNULL. -999.25 : null\n~C\nDEPT.M : depth\nCALI.MM : diameter\n~A\n0 220\n1 220\n2 220';
function file(text:string,name:string){const f=new File([text],name);Object.defineProperty(f,'arrayBuffer',{value:async()=>new TextEncoder().encode(text).buffer});return f;}
const well=()=>({...getCementingExample().wellData,wellDepthMD:2,casingDepthMD:2,prevCasingDepth:0,holeDiameter:200,wellDepthTVD:1.5});
describe('local survey preview',()=>{
 it('previews the LAS curve and only replaces geometry on Apply',async()=>{
  const onChange=vi.fn();render(<WellSurveyImport kind="caliper" wellData={well()} onChange={onChange}/>);
  screen.getByTestId('import-caliper').setAttribute('open','');
  fireEvent.change(screen.getByLabelText('Импорт кавернометрии LAS 2.0'),{target:{files:[file(las,'well.las')]}});
  await waitFor(()=>expect(screen.getByText(/well.las:/)).toBeInTheDocument());
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Применить кавернометрию'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Применить кавернометрию'}));
  const result=onChange.mock.calls[0][0];
  expect(result.cavernIntervals).toHaveLength(1);expect(result.cavernIntervals[0].coeff).toBeCloseTo(1.21,9);
  expect(result.cavernIntervals[0].diameterMm).toBeCloseTo(220,9);
  expect(result.caliperLog).toMatchObject({fileName:"well.las",curve:"CALI",samples:[{md:0,diameterMm:220},{md:1,diameterMm:220},{md:2,diameterMm:220}]});
  expect(result.cavernIntervals[0].toMD).toBe(2);expect(result.wellDepthMD).toBe(2);
 });
 it('does not assume unknown units or apply a corrupt file',async()=>{
  const onChange=vi.fn();render(<WellSurveyImport kind="caliper" wellData={well()} onChange={onChange}/>);
  screen.getByTestId('import-caliper').setAttribute('open','');
  const input=screen.getByLabelText('Импорт кавернометрии LAS 2.0');
  fireEvent.change(input,{target:{files:[file(las.replace('CALI.MM','CALI.X'),'unknown.las')]}});
  await waitFor(()=>expect(screen.getByText(/unknown.las:/)).toBeInTheDocument());
  expect(screen.getByRole('button',{name:'Применить кавернометрию'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Единицы диаметра'),{target:{value:'mm'}});
  expect(screen.getByRole('button',{name:'Применить кавернометрию'})).toBeEnabled();
  fireEvent.change(input,{target:{files:[file('broken','bad.las')]}});
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('LAS 2.0'));
  expect(onChange).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Применить кавернометрию'})).not.toBeInTheDocument();
 });
 it('maps TXT columns and commits recalculated TVD without changing MD',async()=>{
  const onChange=vi.fn();render(<WellSurveyImport kind="trajectory" wellData={well()} onChange={onChange}/>);
  screen.getByTestId('import-trajectory').setAttribute('open','');
  fireEvent.change(screen.getByLabelText('Импорт инклинометрии TXT / CSV / XLSX'),{target:{files:[file('MD [m];Azimuth;Inclination\n0;0;0\n2;0;0','survey.txt')]}});
  await waitFor(()=>expect(screen.getByText(/survey.txt:/)).toBeInTheDocument());expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Применить инклинометрию'}));
  expect(onChange.mock.calls[0][0]).toMatchObject({wellDepthMD:2,wellDepthTVD:2,trajectory:[{md:0,tvd:0},{md:2,tvd:2}]});
 });
});

it('keeps global row indexes when paging through a long imported survey',()=>{
  const ex=getCementingExample(),onChange=vi.fn();
  const trajectory=Array.from({length:205},(_,i)=>({md:i,tvd:i,azimuth:0,zenith:0}));
  const r=render(<MemoryRouter><InputSection {...ex} wellData={{...well(),trajectory}} onWellDataChange={onChange}
    onDrillingFluidChange={vi.fn()} onBuffersChange={vi.fn()} onSlurriesChange={vi.fn()} onDisplacementFluidsChange={vi.fn()}
    onFractureGradientChange={vi.fn()} onFlushTimeMinChange={vi.fn()} onFlushVolumeM3Change={vi.fn()}/></MemoryRouter>);
  fireEvent.click(screen.getByRole('button',{name:/Профиль скважины/}));
  expect(r.container.querySelector('tbody tr td')?.textContent).toBe('1');
  fireEvent.click(screen.getByText('Следующие точки'));
  const row=r.container.querySelector('tbody tr')!;
  expect(row.querySelector('td')?.textContent).toBe('101');
  fireEvent.click(row.querySelector('button')!);
  const result=onChange.mock.calls[0][0].trajectory;
  expect(result).toHaveLength(204);expect(result[0].md).toBe(0);expect(result[100].md).toBe(101);
});

const surveyInput='Импорт инклинометрии TXT / CSV / XLSX';
function excelFile(rows:unknown[][],modify?:(s:XLSX.WorkSheet)=>void,cover=false){
 const w=XLSX.utils.book_new(),s=XLSX.utils.aoa_to_sheet(rows);modify?.(s);
 if(cover)XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet([['Обложка']]),'Обложка');
 XLSX.utils.book_append_sheet(w,s,'Замеры');const bytes=XLSX.write(w,{type:'array',bookType:'xlsx'});
 const f=new File([bytes],'survey.xlsx');Object.defineProperty(f,'arrayBuffer',{value:async()=>bytes});return f;
}
const surveyRows=[['MD [m]','AZI [deg]','INC [deg]'],[0,0,0],[1,0,0],[2,0,0]];
describe('F04 shared Excel preview and apply',()=>{
 it('TXT and Excel apply the same entire well snapshot, only after an explicit click',async()=>{
  const snapshots=[];
  for(const f of [file(surveyRows.map(r=>r.join(';')).join('\n'),'survey.txt'),excelFile(surveyRows)]){
   const onChange=vi.fn(),r=render(<WellSurveyImport kind="trajectory" wellData={well()} onChange={onChange}/>);screen.getByTestId('import-trajectory').setAttribute('open','');
   fireEvent.change(screen.getByLabelText(surveyInput),{target:{files:[f]}});
   await waitFor(()=>expect(screen.getByRole('button',{name:'Применить инклинометрию'})).toBeEnabled());expect(onChange).not.toHaveBeenCalled();
   fireEvent.click(screen.getByRole('button',{name:'Применить инклинометрию'}));snapshots.push(onChange.mock.calls[0][0]);r.unmount();
  }
  expect(snapshots[0]).toEqual(snapshots[1]);expect(snapshots[0].wellDepthTVD).toBe(2);
 });
 it('selects another sheet explicitly and invalidates the old preview on a row-range change; incomplete coverage keeps well TVD',async()=>{
  const onChange=vi.fn();render(<WellSurveyImport kind="trajectory" wellData={well()} onChange={onChange}/>);screen.getByTestId('import-trajectory').setAttribute('open','');
  fireEvent.change(screen.getByLabelText(surveyInput),{target:{files:[excelFile(surveyRows,undefined,true)]}});
  await waitFor(()=>expect(screen.getByLabelText('Лист книги')).toBeInTheDocument());expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Лист книги'),{target:{value:'Замеры'}});expect(screen.queryByRole('button',{name:'Применить инклинометрию'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Обновить предпросмотр Excel'}));expect(screen.getByRole('button',{name:'Применить инклинометрию'})).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Последняя строка данных'),{target:{value:'3'}});expect(screen.queryByRole('button',{name:'Применить инклинометрию'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Обновить предпросмотр Excel'}));expect(screen.getByText(/не покрывает всю глубину/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Применить инклинометрию'}));expect(onChange.mock.calls[0][0]).toMatchObject({wellDepthMD:2,wellDepthTVD:1.5});expect(onChange.mock.calls[0][0].trajectory).toHaveLength(2);
 });
 it('blocks formula caches, unknown angle units and a malformed row; a replacement file clears stale errors',async()=>{
  const onChange=vi.fn();render(<WellSurveyImport kind="trajectory" wellData={well()} onChange={onChange}/>);screen.getByTestId('import-trajectory').setAttribute('open','');
  const input=screen.getByLabelText(surveyInput);
  fireEvent.change(input,{target:{files:[excelFile(surveyRows,s=>{s.A3={t:'n',v:1,f:'1'};})]}});
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Замеры!A3: формула'));expect(screen.getByRole('button',{name:'Применить инклинометрию'})).toBeDisabled();
  fireEvent.change(input,{target:{files:[excelFile([['MD [m]','AZI [deg]','INC [gon]'],...surveyRows.slice(1)])]}});
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('единицы зенита'));expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Единицы зенита'),{target:{value:'deg'}});expect(screen.getByRole('button',{name:'Применить инклинометрию'})).toBeEnabled();
  fireEvent.change(input,{target:{files:[excelFile([surveyRows[0],surveyRows[1],[1,'',0]])]}});
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Строка 3: пропуск'));expect(onChange).not.toHaveBeenCalled();
 });
 it('a late earlier file read cannot replace the current preview',async()=>{
  const onChange=vi.fn();render(<WellSurveyImport kind="trajectory" wellData={well()} onChange={onChange}/>);screen.getByTestId('import-trajectory').setAttribute('open','');
  let finish:(x:ArrayBuffer)=>void;const old=new File(['old'],'old.txt');Object.defineProperty(old,'arrayBuffer',{value:()=>new Promise<ArrayBuffer>(r=>{finish=r;})});
  const input=screen.getByLabelText(surveyInput);fireEvent.change(input,{target:{files:[old]}});
  fireEvent.change(input,{target:{files:[excelFile(surveyRows)]}});await waitFor(()=>expect(screen.getByText(/survey.xlsx: 3 отсчётов/)).toBeInTheDocument());
  finish!(new TextEncoder().encode('bad').buffer);await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());expect(screen.getByText(/survey.xlsx: 3 отсчётов/)).toBeInTheDocument();expect(onChange).not.toHaveBeenCalled();
 });
});
