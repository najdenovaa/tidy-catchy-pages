import {useState} from 'react';
import {render,screen,within,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,afterEach} from 'vitest';
import ChemicalWashRecipes from './ChemicalWashRecipes';
import {qualityInput} from '@/lib/__tests__/fixtures/optimizer-cleaning-fixture';
import type {BufferFluid,DrillingFluid} from '@/lib/cementing-calculations';
afterEach(cleanup);
function Harness(){
 const p=qualityInput(),[mud,setMud]=useState<DrillingFluid>(p.drillingFluid),[buffers,setBuffers]=useState<BufferFluid[]>(p.buffers);
 return <><ChemicalWashRecipes mud={mud} buffers={buffers} onMudChange={setMud} onBuffersChange={setBuffers}/><output data-testid="saved">{JSON.stringify({mud,buffers})}</output></>;
}
it('filters the family, creates an unmeasured recipe, recovers invalid doses, and explicitly records actual properties',()=>{
 render(<Harness/>);fireEvent.click(screen.getByText('Химия буфера и стартовые рецептуры'));
 const card=within(screen.getByTestId('chemical-wash-recipes'));
 expect(card.getByRole('button',{name:'Внести химическую рецептуру'})).toBeDisabled();
 fireEvent.change(card.getByLabelText('Основа БР для подбора химии'),{target:{value:'oil'}});
 expect(card.queryByRole('option',{name:'Водный БР · ПАВ + диспергатор'})).toBeNull();
 fireEvent.change(card.getByLabelText('Дозировка wash-dpm'),{target:{value:'99.9'}});
 expect(card.getByRole('button',{name:'Внести химическую рецептуру'})).toBeDisabled();
 fireEvent.change(card.getByLabelText('Дозировка wash-dpm'),{target:{value:'2'}});
 fireEvent.click(card.getByRole('button',{name:'Внести химическую рецептуру'}));
 let saved=JSON.parse(screen.getByTestId('saved').textContent!);
 expect(saved.buffers[0].rheology.pv).toBe(0);expect(saved.buffers[0].additives.map((a:{percentage:number})=>a.percentage)).toEqual([.05,.5,2]);
 for(const [name,value] of [['Измеренная плотность химбуфера, кг/м³','1100'],['Измеренный PV химбуфера, сПз','20'],['Измеренный YP химбуфера, Па','5'],['T замеров химбуфера, °C','40'],['P замеров химбуфера, МПа абс.','5'],['Вода химбуфера и минерализация','Лабораторная вода 0,2 г/л'],['Протокол замеров свойств химбуфера','P-1']])fireEvent.change(card.getByLabelText(name),{target:{value}});
 fireEvent.click(card.getByRole('button',{name:'Подтвердить замеры химбуфера'}));
 saved=JSON.parse(screen.getByTestId('saved').textContent!);
 expect(saved.buffers[0].chemicalRecipe.propertySignature).toBeTruthy();
 expect(card.getByRole('status')).toHaveTextContent('Свойства этого состава подтверждены');
 fireEvent.change(card.getByLabelText('Вода химбуфера и минерализация'),{target:{value:'Другой рассол'}});
 expect(card.getByRole('status')).toHaveTextContent('Подтвердите');
});
