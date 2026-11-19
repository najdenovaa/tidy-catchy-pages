import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import FluidInteractionLab from './FluidInteractionLab';
import {labFixture} from '@/lib/__tests__/fixtures/fluid-lab-fixture';
afterEach(cleanup);
it('retains zero measurements and saves explicit observations instead of auto-approving a protocol',()=>{
 const {ex,lab}=labFixture(),save=vi.fn();render(<FluidInteractionLab input={ex} data={lab} onApply={save}/>);
 fireEvent.change(screen.getByLabelText('ДНС смеси 1, Па'),{target:{value:'0'}});fireEvent.change(screen.getByLabelText('Наблюдения смеси 1'),{target:{value:'anomaly'}});
 fireEvent.click(screen.getByText('Сохранить протоколы в расчёт'));const actual=save.mock.calls[0][0];expect(actual.mixtures[0].ypPa).toBe(0);expect(actual.mixtures[0].observation).toBe('anomaly');
 fireEvent.click(screen.getByText('Добавить испытание смеси'));expect(screen.getByLabelText('Наблюдения смеси 3')).toHaveValue('unknown');
 fireEvent.click(screen.getByText('Добавить испытание вымываемости'));expect(screen.getByLabelText('Критический сдвиг, Па 1')).toHaveValue(null);
});
