import { it,expect,vi,afterEach } from 'vitest';
import { render,screen,fireEvent,cleanup } from '@testing-library/react';
import MaterialsSection from './MaterialsSection';
import { getCementingExample } from '@/lib/cementing-example';
import { calculateMaterials } from '@/lib/cementing-calculations';
import { centralizerMaterialGeometryKey } from '@/lib/materials-equipment-inventory';
afterEach(cleanup);
it('offers Avrora equipment in Materials even before the main calculation',()=>{
 const w=getCementingExample().wellData,onChange=vi.fn();
 render(<MaterialsSection wellData={w} onWellDataChange={onChange}/>);
 expect(screen.getByTestId('cementing-equipment')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Изделие Аврора'),{target:{value:'avrora-112pb'}});
 expect(onChange.mock.calls[0][0].equipment[0].model).toBe('AVRORA 112ПБ');
});
it('shows calculated center models, manufacturer and quantities in the material inventory',()=>{
 const e=getCementingExample();
 const w={...e.wellData,centralizerMaterials:{geometryKey:centralizerMaterialGeometryKey(e.wellData),items:[{model:'AVRORA 205',manufacturer:'Аврора',quantity:42}]}};
 render(<MaterialsSection materials={calculateMaterials(e.slurries,e.buffers,w)} wellData={w} onWellDataChange={vi.fn()}/>);
 expect(screen.getByText('Центратор / AVRORA 205')).toBeInTheDocument();expect(screen.getByText('42')).toBeInTheDocument();expect(screen.getByText(/По расчёту центрирования/)).toBeInTheDocument();
});
