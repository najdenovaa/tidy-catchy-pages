import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import WellGeometrySummary from './WellGeometrySummary';
import InputSection from './InputSection';
import {getCementingExample} from '@/lib/cementing-example';
afterEach(cleanup);
const source={fileName:'field.las',curve:'CALI',importedAt:'2026-11-12T00:00:00Z',depthUnit:'m',diameterUnit:'mm',nominalDiameterMm:200,intervalStepM:5,maxGapM:2,samples:[{md:0,diameterMm:220},{md:1,diameterMm:null}]};
const well=()=>({...getCementingExample().wellData,wellDepthMD:100,casingDepthMD:100,holeDiameter:200,prevCasingDepth:0,cavernIntervals:[{fromMD:0,toMD:100,coeff:1.21,diameterMm:220}],caliperLog:source});
it('shows preserved source, measured coverage, and coefficient-only legacy projects',()=>{
 const r=render(<WellGeometrySummary wellData={well()}/>);
 expect(screen.getByTestId('well-geometry-summary')).toHaveTextContent('field.las');
 expect(screen.getByTestId('well-geometry-summary')).toHaveTextContent('100.0 м');
 expect(screen.getByText('Скачать исходные отсчёты CSV')).toBeInTheDocument();
 r.rerender(<WellGeometrySummary wellData={{...well(),caliperLog:undefined,cavernIntervals:[{fromMD:0,toMD:100,coeff:1.21}]}}/>);
 expect(screen.getByText(/Повторный импорт LAS/)).toBeInTheDocument();
});
it('an explicit K edit detaches the derived diameter while retaining raw provenance',()=>{
 const ex=getCementingExample(),changed=vi.fn();
 render(<MemoryRouter><InputSection {...ex} wellData={well()} onWellDataChange={changed}
 onDrillingFluidChange={vi.fn()} onBuffersChange={vi.fn()} onSlurriesChange={vi.fn()} onDisplacementFluidsChange={vi.fn()}
 onFractureGradientChange={vi.fn()} onFlushTimeMinChange={vi.fn()} onFlushVolumeM3Change={vi.fn()}/></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:/Данные скважины/}));
 fireEvent.change(screen.getByDisplayValue('1.21'),{target:{value:'1.5'}});
 const w=changed.mock.calls[0][0];expect(w.cavernIntervals[0]).toMatchObject({coeff:1.5});expect(w.cavernIntervals[0].diameterMm).toBeUndefined();
 expect(w.caliperLog.samples).toEqual(source.samples);expect(w.caliperLog.intervalsEdited).toBe(true);
});
