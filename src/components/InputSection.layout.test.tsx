import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import InputSection from './InputSection';
import {getCementingExample} from '@/lib/cementing-example';
afterEach(cleanup);
it('places compression between displacement and fracture using the same collapsed input header',()=>{
 const noop=vi.fn();render(<MemoryRouter><InputSection {...getCementingExample()} flushTimeMin={0} flushVolumeM3={0} onWellDataChange={noop} onDrillingFluidChange={noop} onBuffersChange={noop} onSlurriesChange={noop} onDisplacementFluidsChange={noop} onFractureGradientChange={noop} onFlushTimeMinChange={noop} onFlushVolumeM3Change={noop}/></MemoryRouter>);
 const displacement=screen.getByRole('button',{name:/🚀 Продавочная жидкость/}),storage=screen.getByRole('button',{name:/🔩 Сжатие и упругость/}),fracture=screen.getByRole('button',{name:/⚙️ Параметры гидроразрыва/}),well=screen.getByRole('button',{name:/📐 Данные скважины/});
 expect(displacement.compareDocumentPosition(storage)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(storage.compareDocumentPosition(fracture)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(storage.className).toBe(well.className);expect(storage.getAttribute('aria-expanded')).toBe('false');expect(screen.queryByText('Расписание и баланс закачки')).toBeNull();expect(screen.queryByRole('checkbox',{name:/Учитывать сжатие/})).toBeNull();
});
