import { useState } from 'react';
import { afterEach,it,expect,vi } from 'vitest';
import { render,screen,fireEvent,cleanup } from '@testing-library/react';
import LogisticsSection from './LogisticsSection';
import BasketStopCard from './BasketStopCard';
import CementingEquipmentCard from './CementingEquipmentCard';
import { DEFAULT_LOGISTICS,type LogisticsSettings } from '@/lib/cement-logistics';
import { getCementingExample } from '@/lib/cementing-example';
import { evaluateBasketStop } from '@/lib/cement-basket-stop';
import type { PressureProfileResult,MaterialSummary } from '@/lib/cementing-calculations';
vi.mock('@/hooks/use-measured-width',()=>({useMeasuredWidth:()=>[{current:null},800]}));
afterEach(cleanup);
const ex=getCementingExample();
const pressure={points:[{time:1,pumpRateLps:10,surfacePressure:10,stage:'Цемент'}]} as PressureProfileResult;
const materials={cementItems:[{name:'Цемент',amount:40,unit:'т'}],waterTotal:20} as MaterialSummary;
it('switches classic, twin, single and mixer-CA layouts with persisted callbacks',()=>{
 const save=vi.fn();
 function Harness(){const [s,setS]=useState<LogisticsSettings>(DEFAULT_LOGISTICS);return <LogisticsSection pressure={pressure} materials={materials} slurries={ex.slurries} settings={s} onSettingsChange={v=>{save(v);setS(v);}}/>;}
 render(<Harness/>);
 const select=screen.getByLabelText('Схема комплекса');
 for(const scheme of ['twin','single','mixer-ca']) {
  fireEvent.change(select,{target:{value:scheme}});
  expect(screen.getByText(/Производитель \/ семейство/)).toBeInTheDocument();
  expect(screen.getByRole('cell',{name:/Цементовоз ЦТ-25 \(25 м³\)/})).toBeInTheDocument();
  expect(save.mock.calls.at(-1)![0].scheme).toBe(scheme);
 }
 fireEvent.change(select,{target:{value:'classic'}});
 expect(screen.queryByLabelText('Производитель комплекса')).not.toBeInTheDocument();
});
it('edits basket hypotheses and displays a separate Stop comparison',()=>{
 const e={id:'b',kind:'basket' as const,model:'500S',manufacturer:'Аврора',quantity:1,depthMD:1000,basketSupportPct:40,basketBridgeMin:5};
 const well={...ex.wellData,equipment:[e]},write=vi.fn();
 const r=evaluateBasketStop(well,[{top:0,bot:well.casingDepthMD,rho:1.9,fluidType:'cement'}],20);
 render(<><CementingEquipmentCard well={well} onChange={write}/><BasketStopCard result={r} well={well}/></>);
 fireEvent.change(screen.getByLabelText('Доля передачи нагрузки, %'),{target:{value:60}});
 expect(write.mock.calls[0][0].equipment[0].basketSupportPct).toBe(60);
 expect(screen.getByTestId('basket-stop-comparison')).toBeInTheDocument();
 expect(screen.getByRole('img',{name:/Давление без корзины/})).toBeInTheDocument();
});

it('edits actual machines and crew and redraws fleet totals',()=>{
 const save=vi.fn();
 function Harness(){const [s,setS]=useState<LogisticsSettings>({...DEFAULT_LOGISTICS,scheme:'single'});return <LogisticsSection pressure={pressure} materials={materials} slurries={ex.slurries} settings={s} onSettingsChange={v=>{save(v);setS(v);}}/>;}
 render(<Harness/>);
 const main=screen.getByLabelText(/Количество техники: Цементировочный агрегат со встроенным миксером/i);
 fireEvent.change(main,{target:{value:'3'}});
 expect(save.mock.calls.at(-1)![0].equipmentQuantities.main).toBe(3);
 expect(screen.getByRole('img',{name:'Схема расстановки цементировочной техники, вид сверху'})).toHaveTextContent('3 ед.');
 const crew=screen.getAllByLabelText(/^Персонал:/)[0];
 fireEvent.change(crew,{target:{value:'7'}});
 expect(Object.values(save.mock.calls.at(-1)![0].personnelQuantities)).toContain(7);
 expect(screen.getByLabelText('Источник воды')).toHaveValue('rig');
});
