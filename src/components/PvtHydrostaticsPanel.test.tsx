import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import PvtHydrostaticsPanel from './PvtHydrostaticsPanel';
import {StopStorageControls} from './StopStorageSection';
import {getCementingExample} from '@/lib/cementing-example';
import {evaluatePvtHydrostatics} from '@/lib/pvt-hydrostatics';
import type {StopStorageSettings} from '@/lib/stop-storage';
afterEach(cleanup);
it('enables PVT independently and reuses one shared set of fluid K inputs',()=>{
 const well=getCementingExample().wellData,onChange=vi.fn();render(<StopStorageControls well={well} onChange={onChange}/>);fireEvent.click(screen.getByRole('button',{name:/Сжимаемость жидкостей/}));fireEvent.click(screen.getByRole('checkbox',{name:/Сравнить PVT/}));const enabled=onChange.mock.calls[0][0];expect(enabled.stopStorage.hydrostaticsEnabled).toBe(true);expect(enabled.stopStorage.enabled).toBe(false);cleanup();
 render(<StopStorageControls well={enabled} onChange={onChange}/>);fireEvent.click(screen.getByRole('button',{name:/Сжимаемость жидкостей/}));expect(screen.getAllByLabelText('K продавочной жидкости, МПа')).toHaveLength(1);expect(screen.getByLabelText('Опорное давление плотностей, МПа изб.')).toBeTruthy();expect(screen.queryByLabelText('Модуль Юнга E, МПа')).toBeNull();
});
it('reports unavailable comparison as missing data, not a zero-pressure result',()=>{
 const w=getCementingExample().wellData;w.stopStorage={hydrostaticsEnabled:true,bulkModuliMPa:{}} as StopStorageSettings;const r=evaluatePvtHydrostatics(w,[],[]);render(<PvtHydrostaticsPanel result={r}/>);expect(screen.getByRole('alert').textContent).toContain('Нет кадров');expect(screen.queryByRole('button',{name:'Скачать PVT-сравнение CSV'})).toBeNull();expect(screen.getByText(/не является сохранённым инвентарём/)).toBeTruthy();
});
