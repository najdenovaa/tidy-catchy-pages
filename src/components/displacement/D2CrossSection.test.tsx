import {useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,afterEach,vi} from 'vitest';
import D2CrossSection from './D2CrossSection';
import {sectionFixture} from '@/lib/__tests__/fixtures/displacement-section-fixture';
vi.mock('./D2Section3D',()=>({default:({data,view}:any)=><output data-testid="section-scene">{view} | {data.frame} | {data.timeS} | {data.pipeFractions.join(',')}</output>}));
afterEach(cleanup);
function Host(){const[md,setMD]=useState(15),[frame,setFrame]=useState(1),[stale,setStale]=useState(false);return <><button onClick={()=>setFrame(0)}>Начальный кадр</button><button onClick={()=>setStale(true)}>Изменить вход</button><D2CrossSection data={sectionFixture()} md={md} frame={frame} onDepth={setMD} stale={stale}/></>;}
it('shares the actual frame across both section views, rejects invalid depths and blocks stale export',()=>{
 render(<Host/>);expect(screen.getByTestId('section-scene')).toHaveTextContent('3d | 1 | 10');expect(screen.getByText('75.00')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Сверху'}));expect(screen.getByTestId('section-scene')).toHaveTextContent('top | 1 | 10');
 fireEvent.click(screen.getByText('Начальный кадр'));expect(screen.getByTestId('section-scene')).toHaveTextContent('top | 0 | 0 | 1,0');
 fireEvent.click(screen.getByText('Изменить вход'));expect(screen.getByRole('button',{name:'Сечение в XLSX'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Глубина общего сечения MD'),{target:{value:'21'}});expect(screen.getByRole('alert')).toHaveTextContent('вне интервала колонны');expect(screen.queryByTestId('section-scene')).not.toBeInTheDocument();
});
