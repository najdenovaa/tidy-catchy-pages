import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import * as XLSX from 'xlsx';
import CementingChartData from './CementingChartData';
import {getCementingExample} from '@/lib/cementing-example';
vi.mock('xlsx',async importOriginal=>({...await importOriginal<typeof import('xlsx')>(),writeFile:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it('includes the result snapshot rheology in XLSX, exposes missing measurements and keeps unsupported panels out of the style selector',()=>{
 const ex=getCementingExample(),snapshot={...ex,drillingFluid:{...ex.drillingFluid,name:'Расчётный БР',rheology:{pv:30,yp:5,model:'hb' as const,fann:{r600:70,r300:44,r200:33,r100:23,r6:9,r3:8}}}};
 snapshot.buffers[0].rheology={pv:0,yp:0};
 render(<CementingChartData result={{points:[],envelope:[],stageBoundaries:[],observation:undefined,stopStorage:undefined,rheologyInput:snapshot}}/>);
 fireEvent.click(screen.getByText('Реология: наличие замеров по жидкостям'));
 expect(screen.getByText('Расчётный БР')).toBeInTheDocument();expect(screen.getAllByText(/Нет аппроксимации/).length).toBeGreaterThan(0);
 expect(screen.queryByLabelText('График для оформления')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Скачать данные графиков XLSX'}));
 expect(XLSX.writeFile).toHaveBeenCalledOnce();const w=vi.mocked(XLSX.writeFile).mock.calls[0][0];expect(w.SheetNames).toContain('Реология - замеры');
 const rows=XLSX.utils.sheet_to_json(w.Sheets['Реология - жидкости'],{header:1});expect(rows.some(row=>String(row).includes('Расчётный БР'))).toBe(true);
});
