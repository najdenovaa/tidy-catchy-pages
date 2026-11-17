import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,afterEach,vi} from 'vitest';
import Displacement2DSection from './Displacement2DSection';
import {getCementingExample} from '@/lib/cementing-example';
import {calculateVolumes} from '@/lib/cementing-calculations';
import {calculateDisplacementSpaces} from '@/lib/displacement-spaces';
vi.mock('./D2Annulus3D',()=>({default:()=>{throw new Error('Disabled annular scene must not mount');}}));
afterEach(cleanup);
it('renders pipe-only output, and requires recalculation when space settings change',()=>{
 const ex=getCementingExample(),p={...ex,volumes:calculateVolumes(ex.wellData,ex.slurries)},settings={fine:false,rotationRpm:0,settleMin:0,pipeEnabled:true,annulusEnabled:false},run=calculateDisplacementSpaces(p,settings),change=vi.fn();
 render(<Displacement2DSection {...p} initialReport={{...run,settings,inputKey:'previous'}} initialSettings={settings} onSettingsChange={change}/>);
 expect(screen.getByRole('region',{name:'Трубное пространство'})).toBeInTheDocument();expect(screen.getByText(/Затрубные концентрации и 3D-поле не представлены/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('checkbox',{name:'Рассчитывать состав в трубе'}));expect(screen.getByRole('alert')).toHaveTextContent('хотя бы одно');expect(screen.getByTestId('d2-run')).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox',{name:'Рассчитывать вытеснение в затрубье'}));expect(screen.getByTestId('d2-run')).toBeEnabled();expect(change).toHaveBeenLastCalledWith({...settings,pipeEnabled:false,annulusEnabled:true});
});
