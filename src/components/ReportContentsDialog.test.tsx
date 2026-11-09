import {it,expect,vi,afterEach} from 'vitest';
import{render,screen,fireEvent,cleanup}from'@testing-library/react';
import ReportContentsDialog from './ReportContentsDialog';
afterEach(cleanup);
it('lists all cementing graphs and exports only checked contents without mixing casing reports',()=>{
 const confirm=vi.fn();render(<ReportContentsDialog scope="cementing" open onOpenChange={vi.fn()} onConfirm={confirm}/>);
 expect(screen.getByLabelText('Совмещённый график цементирования')).toBeChecked();expect(screen.getByLabelText('ЭЦП во времени: забой и башмак')).toBeChecked();
 expect(screen.queryByText('Веник по глубине башмака')).not.toBeInTheDocument();
 fireEvent.click(screen.getByText('Снять всё'));expect(screen.getByText('Сформировать Word')).toBeDisabled();
 fireEvent.click(screen.getByLabelText('Совмещённый график цементирования'));fireEvent.click(screen.getByText('Сформировать Word'));
 expect(confirm.mock.calls[0][0].combined).toBe(true);expect(confirm.mock.calls[0][0].materials).toBe(false);expect(confirm.mock.calls[0][0].ecdTime).toBe(false);
});
it('offers centralizer-in-bore visualization and excludes cementing pages in the center report',()=>{
 render(<ReportContentsDialog scope="centralization" open onOpenChange={vi.fn()} onConfirm={vi.fn()}/>);
 expect(screen.getByLabelText('3D: центратор в стволе')).toBeChecked();expect(screen.queryByText('Программа закачки')).not.toBeInTheDocument();
});
