import {render,screen,fireEvent,cleanup,act} from '@testing-library/react';
import {it,expect,afterEach,vi} from 'vitest';
import Displacement2DSection from './Displacement2DSection';
import {getCementingExample} from '@/lib/cementing-example';
import {calculateVolumes} from '@/lib/cementing-calculations';
import {displacementReportKey} from '@/lib/cementing-report-data';
import {calculateDisplacementSpaces} from '@/lib/displacement-spaces';
vi.mock('./D2Placement3D',()=>({default:()=>null}));
vi.mock('./D2Section3D',()=>({default:()=>null}));
vi.mock('./D2Annulus3D',()=>({default:()=>{throw new Error('Disabled annular scene must not mount');}}));
afterEach(()=>{cleanup();vi.useRealTimers();});
it('renders pipe-only output, and requires recalculation when space settings change',()=>{
 const ex=getCementingExample(),p={...ex,volumes:calculateVolumes(ex.wellData,ex.slurries)},settings={fine:false,rotationRpm:0,settleMin:0,pipeEnabled:true,annulusEnabled:false},run=calculateDisplacementSpaces(p,settings),change=vi.fn();
 render(<Displacement2DSection {...p} initialReport={{...run,settings,inputKey:'previous'}} initialSettings={settings} onSettingsChange={change}/>);
 expect(screen.getByRole('region',{name:'Трубное пространство'})).toBeInTheDocument();expect(screen.getByText(/Затрубные концентрации и 3D-поле не представлены/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('checkbox',{name:'Рассчитывать состав в трубе'}));expect(screen.getByRole('alert')).toHaveTextContent('хотя бы одно');expect(screen.getByTestId('d2-run')).toBeDisabled();
 fireEvent.click(screen.getByRole('checkbox',{name:'Рассчитывать вытеснение в затрубье'}));expect(screen.getByTestId('d2-run')).toBeEnabled();expect(change).toHaveBeenLastCalledWith(expect.objectContaining({...settings,pipeEnabled:false,annulusEnabled:true}));
});

it('changes playback without marking a fresh result stale, while frame interval requires recalculation',()=>{
 const ex=getCementingExample(),p={...ex,volumes:calculateVolumes(ex.wellData,ex.slurries)},settings={fine:false,rotationRpm:0,settleMin:0,pipeEnabled:true,annulusEnabled:false},run=calculateDisplacementSpaces(p,settings);
 render(<Displacement2DSection {...p} initialReport={{...run,settings,inputKey:displacementReportKey(p,settings)}} initialSettings={settings}/>);
 expect(screen.queryByText(/Исходные данные изменились/)).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Скорость просмотра'),{target:{value:'45'}});expect(screen.queryByText(/Исходные данные изменились/)).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Интервал кадров, с'),{target:{value:'15'}});expect(screen.getByText(/Исходные данные изменились/)).toBeInTheDocument();
});

it('applies playback speed to the common timer even in pipe-only mode',()=>{
 vi.useFakeTimers();const ex=getCementingExample(),p={...ex,volumes:calculateVolumes(ex.wellData,ex.slurries)},settings={fine:false,rotationRpm:0,settleMin:0,pipeEnabled:true,annulusEnabled:false},run=calculateDisplacementSpaces(p,settings);
 render(<Displacement2DSection {...p} initialReport={{...run,settings,inputKey:displacementReportKey(p,settings)}} initialSettings={settings}/>);
 fireEvent.change(screen.getByLabelText('Скорость просмотра'),{target:{value:'45'}});fireEvent.click(screen.getByRole('button',{name:'Воспроизвести'}));
 act(()=>vi.advanceTimersByTime(44));expect(screen.getByLabelText('Время')).toHaveValue('0');act(()=>vi.advanceTimersByTime(1));expect(screen.getByLabelText('Время')).toHaveValue('1');
 expect(screen.queryByText(/Исходные данные изменились/)).not.toBeInTheDocument();
});
