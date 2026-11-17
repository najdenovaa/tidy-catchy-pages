import {useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,afterEach} from 'vitest';
import D2TimingControls from './D2TimingControls';
import type {DisplacementTimingSettings} from '@/lib/displacement-timing';
afterEach(cleanup);
function Host(){const[s,set]=useState<DisplacementTimingSettings>({maxTimeStepS:0,frameIntervalS:0,playbackMs:90});return <><output data-testid="settings">{JSON.stringify(s)}</output><D2TimingControls settings={s} onChange={set} annulusEnabled/></>;}
it('keeps the physical cap, sampling interval and playback separate, and shows invalid input',()=>{
 render(<Host/>);fireEvent.change(screen.getByLabelText('Максимальный шаг решателя, с'),{target:{value:'2'}});fireEvent.change(screen.getByLabelText('Интервал кадров, с'),{target:{value:'15'}});fireEvent.change(screen.getByLabelText('Скорость просмотра'),{target:{value:'45'}});
 expect(JSON.parse(screen.getByTestId('settings').textContent!)).toEqual({maxTimeStepS:2,frameIntervalS:15,playbackMs:45});
 fireEvent.change(screen.getByLabelText('Максимальный шаг решателя, с'),{target:{value:'.001'}});expect(screen.getByRole('alert')).toHaveTextContent('Максимальный шаг');
});
