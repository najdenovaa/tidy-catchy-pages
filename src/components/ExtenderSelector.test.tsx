import {it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import ExtenderSelector from './ExtenderSelector';
import ReadyCementAlternatives from './ReadyCementAlternatives';
import {MINERAL_EXTENDERS} from '@/lib/cement-mineral-extenders';
afterEach(cleanup);
it('offers all three minerals and exposes the actual material data and editable true density',()=>{
 const change=vi.fn(),{rerender}=render(<ExtenderSelector onChange={change}/>);
 for(const m of MINERAL_EXTENDERS){
  fireEvent.change(screen.getByLabelText('Облегчающая добавка'),{target:{value:m.id}});
  expect(change).toHaveBeenLastCalledWith(m.id,undefined);
  rerender(<ExtenderSelector value={m.id} onChange={change}/>);
  expect(screen.getByText(m.note)).toBeInTheDocument();
  expect(screen.getByRole('link',{name:m.sourceLabel})).toHaveAttribute('href',m.sourceUrl);
  fireEvent.change(screen.getByLabelText('Истинная плотность минерального облегчителя'),{target:{value:2.25}});
  expect(change).toHaveBeenLastCalledWith(m.id,2.25);
 }
});
it('shows the entire Nefteservis catalogue initially even if the current range has matches',()=>{
 render(<ReadyCementAlternatives densityGcm3={1.45} temperatureC={58}/>);
 expect(screen.getByRole('button',{name:/Готовые смеси «Нефтесервис»/})).toHaveAttribute('aria-expanded','true');
 expect(screen.getAllByRole('article')).toHaveLength(6);
 expect(screen.getByText('Арктическая цементная система')).toBeInTheDocument();
});
