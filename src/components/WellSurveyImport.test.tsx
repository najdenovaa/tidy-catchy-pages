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
  fireEvent.change(screen.getByLabelText('Импорт инклинометрии TXT / CSV'),{target:{files:[file('MD [m];Azimuth;Inclination\n0;0;0\n2;0;0','survey.txt')]}});
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
