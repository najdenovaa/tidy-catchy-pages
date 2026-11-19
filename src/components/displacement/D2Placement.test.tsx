import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,afterEach,vi} from 'vitest';
import D2Placement from './D2Placement';
import {sectionFixture} from '@/lib/__tests__/fixtures/displacement-section-fixture';
vi.mock('./D2Placement3D',()=>({default:({data}:any)=><output data-testid="common-scene">{data.frame} | {data.timeS}</output>}));
afterEach(cleanup);
it('shows the common frame, moves to the final frame and blocks stale export',()=>{
 const onFrame=vi.fn(),d=sectionFixture();const host=render(<D2Placement data={d} frame={0} onFrame={onFrame} stale={false}/>);
 expect(screen.getByTestId('common-scene')).toHaveTextContent('0 | 0');fireEvent.click(screen.getByText('К концу расчёта'));expect(onFrame).toHaveBeenCalledWith(1);
 fireEvent.click(screen.getByText('Проекция без WebGL'));expect(screen.getByAltText('Общая скважина: проекция состава трубы и затрубья')).toBeInTheDocument();
 host.rerender(<D2Placement data={d} frame={1} onFrame={onFrame} stale/>);expect(screen.getByText('Размещение в XLSX')).toBeDisabled();expect(screen.getByText(/Последний сохранённый кадр/)).toBeInTheDocument();
});
