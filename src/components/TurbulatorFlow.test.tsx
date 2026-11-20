import {useCallback,useState} from 'react';
import {it,expect,vi} from 'vitest';
import {render,fireEvent,screen,cleanup} from '@testing-library/react';
import CentralizationSection from './CentralizationSection';
import {getCementingExample} from '@/lib/cementing-example';
import {defaultTurbulatorDesign} from '@/lib/turbulator-flow';
import type {CentralizationReportData} from '@/lib/cementing-report-data';
it('echoes saved points without a render loop, restores another project and removes particles on stop',()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 const e=getCementingExample(),report=vi.fn();
 const base={...e.wellData,annularStandoffPct:100,turbulatorDesign:{...defaultTurbulatorDesign(),points:[{id:'saved',md:1000,bladesCount:6,bladeAngle:55,bladeHeight:15,bladeWidthMm:15}]}};
 function Parent(){const [w,setW]=useState<import("@/lib/cementing-calculations").WellData>(base);const onReport=useCallback((d:CentralizationReportData)=>{report(d);setW(old=>JSON.stringify(old.turbulatorDesign)===JSON.stringify(d.turbulatorDesign)?old:{...old,turbulatorDesign:d.turbulatorDesign!});},[]);return <><button onClick={()=>setW({...base,turbulatorDesign:defaultTurbulatorDesign()})}>Другой проект</button><CentralizationSection wellData={w} mudDensity={e.drillingFluid.density} drillingFluid={e.drillingFluid} onReportChange={onReport}/></>;}
 try{
  const r=render(<Parent/>);
  expect(screen.getByRole('region',{name:'3D турбулизатора и вихревого потока'})).toBeTruthy();
  expect(r.container.querySelectorAll('animateMotion').length).toBeGreaterThan(0);
  const before=r.container.querySelector('[data-flow-metric="Скорость вверх"]')!.textContent;
  const interval=r.container.querySelector('[data-turbulator-interval]')!.textContent;
  const duration=parseFloat(r.container.querySelector('animateMotion')!.getAttribute('dur')!);
  fireEvent.change(screen.getByRole('slider',{name:'Производительность насосов'}),{target:{value:'20'}});
  expect(screen.getByLabelText('Расход турбулизатора',{exact:true})).toHaveValue(20);
  expect(report.mock.lastCall?.[0].turbulatorRateLps).toBe(20);
  expect(r.container.querySelector('[data-flow-metric="Скорость вверх"]')!.textContent).not.toBe(before);
  expect(r.container.querySelector('[data-turbulator-interval]')!.textContent).toBe(interval);
  expect(parseFloat(r.container.querySelector('animateMotion')!.getAttribute('dur')!)).toBeLessThan(duration);
  fireEvent.change(screen.getByRole('slider',{name:'Длина окна наблюдения'}),{target:{value:'2'}});
  expect(r.container.querySelector('[data-turbulator-interval]')!.textContent).not.toBe(interval);
  fireEvent.click(screen.getByRole('button',{name:'Стоп насосов'}));
  expect(r.container.querySelector('[data-flow-regime]')).toHaveTextContent('Насосы остановлены');
  fireEvent.change(screen.getByLabelText('Расход турбулизатора',{exact:true}),{target:{value:'0'}});
  expect(r.container.querySelectorAll('animateMotion')).toHaveLength(0);
  expect(report.mock.lastCall?.[0].turbulatorRateLps).toBe(0);
  expect(report.mock.lastCall?.[0].turbulatorFlows[0].lengthM).toBe(0);
  fireEvent.click(screen.getByText('Другой проект'));
  expect(screen.queryByRole('region',{name:'3D турбулизатора и вихревого потока'})).toBeNull();
  expect(report.mock.calls.length).toBeLessThan(15);
 }finally{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
