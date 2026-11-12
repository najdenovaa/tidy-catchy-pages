import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import PumpingSchedule from './PumpingSchedule';
import {getCementingExample} from '@/lib/cementing-example';
import {buildProcessContract} from '@/lib/cementing-process';
afterEach(cleanup);
it('uses the calculated contract once and never invents service operations or volumes',()=>{
 const input={...getCementingExample(),flushTimeMin:2.5,flushVolumeM3:3},contract=buildProcessContract(input);
 render(<PumpingSchedule input={input}/>);expect(screen.getByText(/ЛВД отдельно:/)).toHaveTextContent('3.000 м³');expect(screen.getByRole('button',{name:'Скачать расписание CSV'})).toBeTruthy();
 expect(screen.getAllByRole('table')).toHaveLength(1);expect(screen.getAllByRole('row')).toHaveLength(contract.stages.length+1);
 expect(screen.queryByText('Заполнение ЛВД')).toBeNull();expect(screen.queryByText('Опрессовка ЛВД (25 МПа)')).toBeNull();expect(screen.queryByText('Промывка ЛВД, демонтаж ГЦУ')).toBeNull();
});
it('shows unknown duration when a real positive portion lacks a rate',()=>{
 const input={...getCementingExample(),flushTimeMin:0,flushVolumeM3:0};input.buffers=input.buffers.map(b=>({...b,flowRateSteps:[{rateLps:0,volumeM3:1,volumeMode:'manual'}]}));render(<PumpingSchedule input={input}/>);
 expect(screen.getAllByRole('alert').every(x=>x.textContent.includes('положительный расход'))).toBe(true);expect(screen.getByText(/Плановое время:/)).toHaveTextContent('не определено');
});
