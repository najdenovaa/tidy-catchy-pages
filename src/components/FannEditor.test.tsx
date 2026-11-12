import {useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,afterEach,vi} from 'vitest';
import FannEditor from './FannEditor';
import type {Rheology} from '@/lib/cementing-calculations';
afterEach(()=>{cleanup();vi.useRealTimers();});
function Host(){const [r,set]=useState<Rheology>({pv:50,yp:8,fann:{r600:80,r300:50,r200:38,r100:26,r6:9,r3:8}});return <><pre data-testid="rheo">{JSON.stringify(r)}</pre><FannEditor rheology={r} onChange={set}/></>;}
it('does not confuse recommendation with the applied model and exposes residuals',()=>{
 render(<Host/>);expect(screen.getByText(/Применяется:/)).toHaveTextContent('Прежний');fireEvent.change(screen.getByLabelText('Модель для гидравлики'),{target:{value:'bingham'}});expect(screen.getByTestId('rheo')).toHaveTextContent('"model":"bingham"');expect(screen.getByText(/Применяется:/)).toHaveTextContent('Бингам');
 fireEvent.click(screen.getByRole('button',{name:'Остатки аппроксимации'}));expect(screen.getByRole('img')).toHaveAccessibleName('Остатки реологии');
});
it('preserves blanks as missing measurements and warns instead of switching an invalid choice',()=>{
 vi.useFakeTimers();render(<Host/>);fireEvent.change(screen.getByLabelText('Модель для гидравлики'),{target:{value:'hb'}});
 fireEvent.change(screen.getByLabelText('Fann 600'),{target:{value:''}});fireEvent.blur(screen.getByLabelText('Fann 600'));
 for(const rpm of [300,200,100]){fireEvent.change(screen.getByLabelText(`Fann ${rpm}`),{target:{value:''}});fireEvent.blur(screen.getByLabelText(`Fann ${rpm}`));}
 expect(screen.getByRole('alert')).toHaveTextContent('минимум три');
 expect(screen.getByTestId('rheo')).not.toHaveTextContent('"r600"');expect(screen.getByTestId('rheo')).toHaveTextContent('"model":"hb"');
 fireEvent.change(screen.getByLabelText('Модель для гидравлики'),{target:{value:'pvyp'}});expect(screen.getByTestId('rheo')).toHaveTextContent('"pv":50');vi.useRealTimers();
});
