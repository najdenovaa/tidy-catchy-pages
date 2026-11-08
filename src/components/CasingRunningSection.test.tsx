import { it,expect,vi,afterEach } from 'vitest';
import { render,screen,fireEvent,cleanup } from '@testing-library/react';
import CasingRunningSection from './CasingRunningSection';
import { getCementingExample } from '@/lib/cementing-example';
import { normalizeRunningSettings } from '@/lib/casing-running-analysis';
afterEach(cleanup);
vi.mock('recharts',()=>({ResponsiveContainer:({children}:any)=><div>{children}</div>,LineChart:()=>null,Line:()=>null,XAxis:()=>null,YAxis:()=>null,Tooltip:()=>null,Legend:()=>null,CartesianGrid:()=>null,ReferenceLine:()=>null}));
it('shows an actual broomstick and permits a saved running force scenario and field measurements',()=>{
  const ex=getCementingExample(),onSettingsChange=vi.fn();
  const w={...ex.wellData,casingDepthMD:100,prevCasingDepth:0,trajectory:[{md:0,tvd:0,zenith:30,azimuth:0},{md:100,tvd:86.6,zenith:30,azimuth:0}],runningSettings:normalizeRunningSettings({})};
  render(<CasingRunningSection wellData={w} mudDensity={1100} intervals={[]} turbPoints={[]} pv={20} yp={5} frictionCased={.25} frictionOpenhole={.35} onSettingsChange={onSettingsChange}/>);
  expect(screen.getByRole('img',{name:/Веник:/})).toBeInTheDocument();
  expect(screen.getByText(/Грузоподъёмность не задана/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Сопротивление центратора без испытания, кН/шт.'),{target:{value:'0.45'}});
  expect(onSettingsChange.mock.calls.at(-1)[0].centralizerRunningKN).toBe(.45);
  fireEvent.change(screen.getByLabelText('Замер нагрузки, тс'),{target:{value:'2'}});
  fireEvent.click(screen.getByText('Добавить замер'));
  expect(onSettingsChange.mock.calls.at(-1)[0].measurements).toEqual([{md:100,mode:'runIn',hookTF:2}]);
});
