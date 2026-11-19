import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import CementThermalSection from './CementThermalSection';
import {thermalFixture} from '@/lib/__tests__/fixtures/thermal-fixture';
import {simulateThermal} from '@/lib/cement-thermal';
import {runThermal} from '@/lib/cement-thermal-run';
vi.mock('@/lib/cement-thermal-run',()=>({runThermal:vi.fn()}));
it('sends explicit thermal settings to the worker and keeps a missing heat capacity unknown',async()=>{
 const input=thermalFixture(),apply=vi.fn();vi.mocked(runThermal).mockImplementation(async s=>simulateThermal(s));render(<CementThermalSection input={input} onApply={apply}/>);
 fireEvent.click(screen.getByText('Рассчитать температуру'));await waitFor(()=>expect(screen.getByText(/Итоговая невязка/)).toBeTruthy());expect(screen.getByText('Первая порция первого цемента')).toBeTruthy();
 const cp=screen.getAllByLabelText(/^Cp /)[0];fireEvent.change(cp,{target:{value:''}});fireEvent.click(screen.getByText('Рассчитать температуру'));await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('теплоёмкость'));expect(Number.isNaN(apply.mock.calls.at(-1)![0].fluids[0].cp)).toBe(true);
});
