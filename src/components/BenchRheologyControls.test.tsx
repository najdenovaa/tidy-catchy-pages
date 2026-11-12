import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import BenchRheologyControls from './BenchRheologyControls';
import {defaultBenchRheology} from '@/lib/bench-rheology';
afterEach(cleanup);
it('edits the rear model without overwriting the ahead fluid',()=>{const change=vi.fn(),b=defaultBenchRheology(10),a=defaultBenchRheology(20);render(<BenchRheologyControls enabled back={b} ahead={a} mu={10} onChange={change}/>);fireEvent.change(screen.getByRole('combobox',{name:'Модель жидкости сзади'}),{target:{value:'hb'}});expect(change).toHaveBeenCalledWith(true,{...b,model:'hb'},a);expect(screen.getByLabelText('Впереди: Вязкость, мПа·с')).toHaveValue(20);});
