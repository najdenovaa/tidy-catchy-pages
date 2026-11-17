import {useState} from 'react';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,afterEach} from 'vitest';
import {buildPipeTransport} from '@/lib/displacement-pipe';
import D2PipeSection from './D2PipeSection';
afterEach(cleanup);
const pipe=buildPipeTransport([{name:'Раствор',kind:'mud',density:1100,pv:.01,yp:5},{name:'Цемент G',kind:'cement',density:1850,pv:.03,yp:8}],[{topMD:0,bottomMD:100,startM3:0,endM3:1}],[{fluid:1,volumeM3:2,rateM3s:.1}]);
function Host(){const[frame,setFrame]=useState(0),[md,setMD]=useState(50);return <><output data-testid="shared-frame">{frame}</output><D2PipeSection pipe={pipe} colors={['#387d55','#64748b']} frame={frame} timeline={[{timeS:0,annulusFrame:0},{timeS:20,annulusFrame:1}]} md={md} onFrame={setFrame} onDepth={setMD} stale={false}/></>;}
it('uses the common frame and rejects invalid depths instead of displaying fabricated zeroes',()=>{
 render(<Host/>);expect(screen.getByText('100.00')).toBeInTheDocument();fireEvent.change(screen.getByLabelText('Общий кадр вытеснения'),{target:{value:'1'}});expect(screen.getByTestId('shared-frame')).toHaveTextContent('1');expect(screen.getByText('100.00')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Глубина состава в трубе MD'),{target:{value:'101'}});expect(screen.getByRole('alert')).toHaveTextContent('вне трубного пространства');expect(screen.getByRole('button',{name:'Труба и баланс в XLSX'})).toBeDisabled();
});
