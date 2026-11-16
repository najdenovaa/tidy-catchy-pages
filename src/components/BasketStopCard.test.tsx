import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import BasketStopCard from './BasketStopCard';
import {getCementingExample} from '@/lib/cementing-example';
import {evaluateBasketStop} from '@/lib/cement-basket-stop';
import {DEFAULT_DEPTH_CHART} from '@/lib/depth-chart-settings';
afterEach(cleanup);
it('switches the actual basket figure to TVD/ft/psi while retaining physical table units and missing-data text',()=>{
 const well=getCementingExample().wellData,result=evaluateBasketStop(well,[{top:0,bot:well.casingDepthMD,rho:1.9,fluidType:'cement'}],23);
 const ui=render(<BasketStopCard result={result} well={well}/>);expect(screen.getByRole('img').textContent).toContain('Глубина MD, м');
 ui.rerender(<BasketStopCard result={result} well={well} settings={{...DEFAULT_DEPTH_CHART,coordinate:'TVD',depthUnit:'ft',pressureUnit:'psi'}}/>);
 expect(screen.getByRole('img').textContent).toContain('Глубина TVD, ft');expect(screen.getByRole('img').textContent).toContain('Давление, psi');expect(screen.getByText('Без разгрузки, МПа')).toBeInTheDocument();
 ui.rerender(<BasketStopCard well={well}/>);expect(screen.queryByRole('img')).not.toBeInTheDocument();expect(screen.getByText(/Без корзины действует полный жидкий столб/)).toBeInTheDocument();
});
