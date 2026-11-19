import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import CementMechanicsSection from './CementMechanicsSection';
import {mechanicsFixture} from '@/lib/__tests__/fixtures/mechanics-fixture';
import {calculateMechanics} from '@/lib/cement-mechanics';
import {runMechanics} from '@/lib/cement-mechanics-run';
vi.mock('@/lib/cement-mechanics-run',()=>({runMechanics:vi.fn()}));
it('calculates the saved conditions and keeps new operating-state measurements unknown',async()=>{const input=mechanicsFixture(),apply=vi.fn();vi.mocked(runMechanics).mockImplementation(async s=>calculateMechanics(s));render(<CementMechanicsSection input={input} onApply={apply}/>);fireEvent.click(screen.getByText('Рассчитать механику'));await waitFor(()=>expect(screen.getByText(/Полных осевых кадров/)).toBeTruthy());fireEvent.click(screen.getByText('Добавить сценарий освоения'));fireEvent.click(screen.getByText('Сохранить механические условия'));expect(apply.mock.calls.at(-1)![0].cases.at(-1).pi).toBeNull();expect(apply.mock.calls.at(-1)![0].cases.at(-1).cementC).toBeNull();});
