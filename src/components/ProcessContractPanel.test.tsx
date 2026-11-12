import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import ProcessContractPanel from './ProcessContractPanel';
import {getCementingExample} from '@/lib/cementing-example';
afterEach(cleanup);
it('shows assigned well/service totals and explicit invalid-rate diagnostics',()=>{
 const input={...getCementingExample(),flushTimeMin:2.5,flushVolumeM3:3},r=render(<ProcessContractPanel input={input}/>);fireEvent.click(screen.getByRole('button',{name:/Расписание и баланс/}));
 expect(screen.getByText(/ЛВД отдельно:/)).toHaveTextContent('3.000 м³');expect(screen.getByRole('button',{name:'Скачать расписание CSV'})).toBeInTheDocument();
 r.rerender(<ProcessContractPanel input={{...input,buffers:input.buffers.map(b=>({...b,flowRateSteps:[{rateLps:0,volumeM3:1,volumeMode:'manual'}]}))}}/>);
 expect(screen.getAllByRole('alert').every(x=>x.textContent.includes('положительный расход'))).toBe(true);expect(screen.getByText(/Плановое время:/)).toHaveTextContent('не определено');
});
