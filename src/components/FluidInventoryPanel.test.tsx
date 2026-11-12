import {it,expect} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import FluidInventoryPanel from './FluidInventoryPanel';
import {FluidInventory} from '@/lib/fluid-inventory';
import type {PressureProfileResult} from '@/lib/cementing-calculations';
it('shows calculated returns, the model boundary and residual failures separately',()=>{
 const inventory={...new FluidInventory(10,5,{fluidId:'mud:initial',fluidType:'mud' as const,densityGcm3:1.1}).summary(),maxStepResidualKg:0,maxStepResidualM3:0,limitations:['Физическая сжимаемость пока не решается.']};
 render(<FluidInventoryPanel result={{inventory} as PressureProfileResult}/>);expect(screen.getByText('Исходный буровой раствор')).toBeTruthy();expect(screen.getByText('Расчётный возврат')).toBeTruthy();expect(screen.getByText('Физическая сжимаемость пока не решается.')).toBeTruthy();expect(screen.getByRole('status').textContent).toContain('постоянной плотности');cleanup();
 render(<FluidInventoryPanel result={{inventory:{...inventory,maxStepResidualKg:1}} as PressureProfileResult}/>);expect(screen.getByRole('alert').textContent).toContain('невязка');cleanup();
});
