import {it,expect,afterEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import RheologyHierarchy from './RheologyHierarchy';
import {getCementingExample} from '@/lib/cementing-example';
afterEach(cleanup);
it('shows shared curves and unknown conditions and refreshes snapshot values without claiming suitability',()=>{
 const ex=getCementingExample(),r={pv:20,yp:8,model:'pvyp' as const},input={drillingFluid:{...ex.drillingFluid,rheology:r},buffers:[{...ex.buffers[0],rheology:{...r,pv:80,yp:2}}],slurries:[],displacementFluids:[]};
 const view=render(<RheologyHierarchy input={input}/>);expect(screen.getAllByRole('img')).toHaveLength(3);expect(screen.getAllByText(/Условия T\/P не подтверждены/).length).toBeGreaterThan(0);expect(screen.getByText('Меняется знак Δτ')).toBeInTheDocument();
 view.rerender(<RheologyHierarchy input={{...input,buffers:[{...input.buffers[0],rheology:{...r,pv:90,yp:20}}]}}/>);expect(screen.queryByText('Меняется знак Δτ')).not.toBeInTheDocument();expect(screen.getByText('Следующая выше на сетке')).toBeInTheDocument();expect(screen.getByText(/не проверка совместимости/)).toBeInTheDocument();
});
