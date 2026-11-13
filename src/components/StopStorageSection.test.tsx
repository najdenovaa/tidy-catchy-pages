import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {StopStorageControls,StopStoragePanel} from './StopStorageSection';
import {getCementingExample} from '@/lib/cementing-example';
import {evaluateStopStorage,type StopStorageSettings} from '@/lib/stop-storage';
afterEach(cleanup);
it('keeps the phase opt-in, retains inputs when disabled and asks for physical moduli',()=>{
 const well=getCementingExample().wellData,onChange=vi.fn();render(<StopStorageControls well={well} onChange={onChange}/>);expect(screen.queryByRole('checkbox')).toBeNull();fireEvent.click(screen.getByRole('button',{name:/Сжимаемость жидкостей/}));expect(screen.queryByLabelText('K продавочной жидкости, МПа')).toBeNull();fireEvent.click(screen.getByRole('checkbox',{name:/Учитывать сжатие/}));const enabled=onChange.mock.calls[0][0];expect(enabled.stopStorage.enabled).toBe(true);expect(enabled.stopStorage.bulkModuliMPa).toEqual({});cleanup();
 render(<StopStorageControls well={{...enabled,stopStorage:{...enabled.stopStorage,bulkModuliMPa:{displacement:2200}}}} onChange={onChange}/>);fireEvent.click(screen.getByRole('button',{name:/Сжимаемость жидкостей/}));expect(screen.getByLabelText('K продавочной жидкости, МПа').getAttribute('value')).toBe('2200');fireEvent.click(screen.getByRole('checkbox',{name:/Учитывать сжатие/}));expect(onChange.mock.calls.at(-1)[0].stopStorage.bulkModuliMPa.displacement).toBe(2200);
});
it('shows missing data explicitly instead of a zero-volume success',()=>{
 const well=getCementingExample().wellData;well.stopStorage={enabled:true,pressureRiseMPa:5,rateLps:.2,youngModulusMPa:200000,poissonRatio:.3,restraint:'fixedLength',bulkModuliMPa:{},source:''} as StopStorageSettings;
 const r=evaluateStopStorage(well,undefined,[],undefined,false);render(<StopStoragePanel result={r}/>);expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);expect(screen.queryByText('Скачать расчёт сжатия CSV')).toBeNull();expect(screen.getByText(/абсолютное давление/)).toBeTruthy();
});
it('keeps production storage controls and removes separate research controls even from legacy saved settings',()=>{const w=getCementingExample().wellData;render(<StopStorageControls well={{...w,stopStorage:{enabled:false,plugBenchEnabled:true,flowEnabled:true,hydrostaticsEnabled:true} as any}} onChange={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:/Сжимаемость жидкостей/}));expect(screen.getAllByRole('checkbox')).toHaveLength(1);expect(screen.getByRole('checkbox',{name:/Учитывать сжатие/})).toBeInTheDocument();expect(screen.queryByText(/стенд|1D-перенос|PVT-гидростатику/)).toBeNull();});
