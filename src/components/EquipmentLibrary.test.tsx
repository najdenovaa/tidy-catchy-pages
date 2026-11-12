import {useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,beforeEach,afterEach,vi} from 'vitest';
import EquipmentLibrary from './EquipmentLibrary';
import CentralizationSection from './CentralizationSection';
import {passportExamples} from '@/lib/centralizer-passports';
import {getCementingExample} from '@/lib/cementing-example';
import {readEquipmentLibrary,writeEquipmentLibrary,emptyEquipmentLibrary,saveEquipmentRevision,centralizerProperties,applyCentralizerRevision,EQUIPMENT_LIBRARY_KEY} from '@/lib/equipment-library';
import type {EquipmentSelection} from '@/lib/cementing-equipment';
vi.mock('./Centralizer3DInspector',()=>({default:()=>null}));vi.mock('./TriaxialCasingCard',()=>({default:()=>null}));
beforeEach(()=>{localStorage.clear();vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});});afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const click=(name:string)=>fireEvent.click(screen.getByRole('button',{name}));
function Host(){const [items,setItems]=useState<EquipmentSelection[]>([{id:'a',kind:'shoe',model:'Б-168',manufacturer:'Завод',quantity:3,depthMD:2000}]);return <><span data-testid="selection">{items[0].model}|{items[0].quantity}|{items[0].depthMD}</span><EquipmentLibrary items={items} onChange={setItems}/></>;}
it('edits library versions without modifying the project until apply and retains quantity/depth',()=>{
 render(<Host/>);click('Библиотека оснастки');fireEvent.change(screen.getByLabelText('Позиция оснастки проекта'),{target:{value:'a'}});click('Сохранить из проекта как новую запись');
 fireEvent.change(screen.getByLabelText('Источник оснастки'),{target:{value:'Паспорт 056'}});click('Сохранить версию оснастки');click('Редактировать как новую версию');fireEvent.change(screen.getByLabelText('Библиотека: Модель'),{target:{value:'Б-168 усиленный'}});click('Сохранить версию оснастки');
 expect(screen.getByTestId('selection')).toHaveTextContent('Б-168|3|2000');expect(readEquipmentLibrary(localStorage).library.entries[0].revisions).toHaveLength(2);
 click('Применить выбранную версию оснастки');expect(screen.getByTestId('selection')).toHaveTextContent('Б-168 усиленный|3|2000');
 fireEvent.change(screen.getByLabelText('Версия оснастки'),{target:{value:'1'}});click('Применить выбранную версию оснастки');expect(screen.getByTestId('selection')).toHaveTextContent('Б-168|3|2000');
});
it('blocks a stale tab without overwriting another library',()=>{
 render(<Host/>);click('Библиотека оснастки');click('Создать запись');fireEvent.change(screen.getByLabelText('Библиотека: Модель'),{target:{value:'Б-168'}});fireEvent.change(screen.getByLabelText('Библиотека: Производитель'),{target:{value:'Завод'}});fireEvent.change(screen.getByLabelText('Источник оснастки'),{target:{value:'Паспорт'}});
 const token=JSON.stringify(emptyEquipmentLibrary());localStorage.setItem(EQUIPMENT_LIBRARY_KEY,token);click('Сохранить версию оснастки');expect(screen.getByRole('alert')).toHaveTextContent('другой вкладке');expect(localStorage.getItem(EQUIPMENT_LIBRARY_KEY)).toBe(token);
});
it('applies the complete centralizer spec from the same library used by materials',()=>{
 const s=structuredClone(passportExamples[0].spec);s.passport.manufacturer='Завод';const lib=saveEquipmentRevision(emptyEquipmentLibrary(),centralizerProperties(s),{source:'Паспорт 056',basis:'passport',notes:''});writeEquipmentLibrary(localStorage,lib,null);
 const changed=vi.fn();render(<EquipmentLibrary spec={passportExamples[1].spec} onSpecChange={changed}/>);click('Библиотека центраторов');fireEvent.change(screen.getByLabelText('Запись библиотеки оснастки'),{target:{value:lib.entries[0].id}});click('Применить выбранную версию оснастки');
 expect(changed.mock.calls[0][0].passport).toEqual(s.passport);expect(changed.mock.calls[0][0].libraryReference.revision).toBe(1);
});
it('restores saved design and reloads a different project without keeping its old selection',()=>{
 const s=structuredClone(passportExamples[0].spec);s.passport.manufacturer='Завод';const lib=saveEquipmentRevision(emptyEquipmentLibrary(),centralizerProperties(s),{source:'Паспорт 056',basis:'passport',notes:''});const saved=applyCentralizerRevision(lib.entries[0],1);
 const w={...getCementingExample().wellData,centralizerDesign:{mode:'manual' as const,targetStandoff:78,jointLength:10,autoSpec:saved,intervals:[{id:'x',fromMD:0,toMD:100,jointLength:10,centralizersPerJoint:1,spec:saved}]}};
 const report=vi.fn();const r=render(<CentralizationSection wellData={w} mudDensity={1100} onReportChange={report}/>);
 expect(screen.getByDisplayValue(saved.passport.model)).toBeInTheDocument();expect(report.mock.lastCall[0].targetStandoff).toBe(78);expect(report.mock.lastCall[0].intervals[0].spec.libraryReference.revision).toBe(1);
 r.rerender(<CentralizationSection wellData={{...w,centralizerDesign:undefined}} mudDensity={1100} onReportChange={report}/>);
 expect(screen.queryByDisplayValue(saved.passport.model)).not.toBeInTheDocument();expect(report.mock.lastCall[0].intervals[0].spec.libraryReference).toBeUndefined();
});
