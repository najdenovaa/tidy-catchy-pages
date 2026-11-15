import {useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect} from 'vitest';
import ChartPresentationEditor from './ChartPresentationEditor';
import {reportSeriesPlot,applyPlotPresentation} from '@/lib/report-series-plot';
import type {ChartPresentations,PresentationPlotId} from '@/lib/chart-presentation';
afterEach(cleanup);
function Harness({unit='МПа'}:{unit?:string}){
 const [styles,setStyles]=useState<ChartPresentations>({});
 const plots=(['pressures','rate'] as const).map(id=>applyPlotPresentation(reportSeriesPlot(id==='rate'?'Расход':'Давление',id,[0,1,2],'Время, мин',unit,[{name:'Ряд',color:'#123456',values:[0,5,10]}]),styles[id as PresentationPlotId]));
 return <ChartPresentationEditor plots={plots} presentations={styles} onChange={setStyles}/>;
}
it('applies valid edits only on request, keeps panels independent, resets and rejects wrong-unit windows',()=>{
 const r=render(<Harness/>);fireEvent.click(screen.getByText('Оформление графиков и масштаб'));
 const preview=()=>screen.getByLabelText('Предпросмотр оформленного графика').innerHTML;
 fireEvent.change(screen.getByLabelText('Заголовок графика'),{target:{value:'Мой график'}});
 expect(preview()).not.toContain('Мой график');
 fireEvent.change(screen.getByLabelText('left Min'),{target:{value:'1'}});
 expect(screen.getByRole('button',{name:'Применить оформление'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('left Max'),{target:{value:'9'}});
 fireEvent.click(screen.getByRole('button',{name:'Применить оформление'}));expect(preview()).toContain('Мой график');expect(screen.getByRole('status')).toHaveTextContent('За пределами окна');
 fireEvent.change(screen.getByLabelText('График для оформления'),{target:{value:'rate'}});expect(screen.getByLabelText('Заголовок графика')).toHaveValue('');
 fireEvent.change(screen.getByLabelText('График для оформления'),{target:{value:'pressures'}});expect(screen.getByLabelText('Заголовок графика')).toHaveValue('Мой график');
 r.rerender(<Harness unit="psi"/>);expect(screen.getByLabelText('left Min')).toHaveValue(null);expect(screen.getByRole('status')).toHaveTextContent('Прежние пределы');expect(preview()).toContain('Мой график');
 fireEvent.click(screen.getByRole('button',{name:'Сбросить оформление графика'}));expect(preview()).not.toContain('Мой график');expect(screen.getByLabelText('Заголовок графика')).toHaveValue('');
});
