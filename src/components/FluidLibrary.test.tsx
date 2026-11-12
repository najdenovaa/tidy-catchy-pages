import {useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import FluidLibrary from './FluidLibrary';
import {getCementingExample} from '@/lib/cementing-example';
import {FLUID_LIBRARY_KEY,readFluidLibrary} from '@/lib/fluid-library';
afterEach(cleanup);beforeEach(()=>localStorage.clear());
function Host(){const ex=getCementingExample(),[mud,setMud]=useState(ex.drillingFluid);return <><span data-testid="project-density">{mud.density}</span><FluidLibrary {...ex} drillingFluid={mud} onDrillingFluidChange={setMud} onBuffersChange={vi.fn()} onSlurriesChange={vi.fn()} onDisplacementFluidsChange={vi.fn()}/></>;}
const click=(name:string)=>fireEvent.click(screen.getByRole('button',{name}));
it('edits immutable versions and changes project only on explicit application',()=>{
 render(<Host/>);click('Библиотека жидкостей');click('Сохранить состав из проекта как новую запись');
 fireEvent.change(screen.getByLabelText('Источник свойств'),{target:{value:'Протокол 45'}});click('Сохранить версию в библиотеку');
 expect(readFluidLibrary(localStorage).library.entries).toHaveLength(1);
 click('Редактировать как новую версию');fireEvent.change(screen.getByLabelText('Плотность библиотеки'),{target:{value:'1500'}});click('Сохранить версию в библиотеку');
 expect(screen.getByTestId('project-density').textContent).not.toBe('1500');
 expect(readFluidLibrary(localStorage).library.entries[0].revisions).toHaveLength(2);
 click('Применить выбранную версию к жидкости');expect(screen.getByTestId('project-density')).toHaveTextContent('1500');
 expect(screen.getByText(/снимок выбранной версии/)).toHaveTextContent('версия 2');
 fireEvent.change(screen.getByLabelText('Версия библиотеки'),{target:{value:'1'}});click('Применить выбранную версию к жидкости');
 expect(screen.getByTestId('project-density').textContent).not.toBe('1500');
});
it('does not overwrite a concurrent library edit',()=>{
 render(<Host/>);click('Библиотека жидкостей');click('Сохранить состав из проекта как новую запись');fireEvent.change(screen.getByLabelText('Источник свойств'),{target:{value:'Источник'}});
 const changed=JSON.stringify({schemaVersion:1,entries:[]});localStorage.setItem(FLUID_LIBRARY_KEY,changed);click('Сохранить версию в библиотеку');
 expect(screen.getByRole('alert')).toHaveTextContent('другой вкладке');expect(localStorage.getItem(FLUID_LIBRARY_KEY)).toBe(changed);
});

it('creates a reusable record without requiring a project fluid and validates its source',()=>{
 render(<Host/>);click('Библиотека жидкостей');fireEvent.change(screen.getByLabelText('Тип жидкости в библиотеке'),{target:{value:'slurry'}});click('Создать запись');
 fireEvent.change(screen.getByLabelText('Название записи'),{target:{value:'Состав G лаборатория'}});
 fireEvent.change(screen.getByLabelText('Плотность библиотеки'),{target:{value:'1450.1234'}});
 click('Сохранить версию в библиотеку');expect(screen.getByRole('alert')).toHaveTextContent('источник');
 fireEvent.change(screen.getByLabelText('Источник свойств'),{target:{value:'Технолог, черновая рецептура'}});click('Сохранить версию в библиотеку');
 expect(readFluidLibrary(localStorage).library.entries[0].revisions[0].properties.density).toBe(1450.1234);
});
