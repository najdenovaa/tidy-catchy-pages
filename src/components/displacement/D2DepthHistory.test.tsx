import { useState } from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,afterEach} from 'vitest';
import D2DepthHistory from './D2DepthHistory';
import type {D2Result} from '@/lib/displacement-2d';
afterEach(cleanup);
const r={nZ:2,nTheta:2,zCenters:new Float64Array([105,115]),gap:new Float32Array([3,1,1,1]),fluids:[{name:'Раствор'},{name:'Цемент'}],snapshots:[{t:0,stage:0,frac:new Uint8Array([255,255,255,255,0,0,0,0])},{t:60,stage:1,frac:new Uint8Array([255,0,127,0,0,255,127,255])}]} as D2Result;
function Host(){const[md,setMD]=useState(105),[frame,setFrame]=useState(0);return <><output data-testid="scene-frame">{frame}</output><D2DepthHistory res={r} colors={['#123456','#654321']} md={md} frame={frame} annulusStartS={120} stale={false} onDepth={setMD} onFrame={setFrame}/></>;}
it('selects the same frame for composition and scene, and reports invalid depth explicitly',()=>{
 render(<Host/>);fireEvent.click(screen.getByText('Показать кадр 1'));
 expect(screen.getByTestId('scene-frame')).toHaveTextContent('1');expect(screen.getByText('75.00')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Глубина состава MD'),{target:{value:'115'}});expect(screen.getByText('25.00')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Глубина состава MD'),{target:{value:'1000'}});expect(screen.getByRole('alert')).toHaveTextContent('вне расчётного интервала');expect(screen.getByRole('button',{name:'Все кадры в XLSX'})).toBeDisabled();
});
