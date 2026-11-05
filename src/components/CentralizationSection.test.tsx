import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import CentralizationSection from './CentralizationSection';
import type {WellData} from '@/lib/cementing-calculations';
vi.mock('./Centralizer3DInspector',()=>({default:()=>null}));
vi.mock('./TriaxialCasingCard',()=>({default:()=>null}));
it('оставляет кнопки расчёта активными для ПЦ без степени испытания и AVRORA без усилий',async()=>{
 vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 const computed=vi.fn();
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const well:WellData={wellDepthMD:300,wellDepthTVD:200,casingDepthMD:300,casingOD:168,casingWall:8,holeDiameter:222,cavernCoeff:1,prevCasingDepth:0,prevCasingID:0,prevCasingOD:0,ckodDepth:300,cementRiseHeight:0,bottomTempStatic:60,bottomTempCirc:40,pumpZoneTop:0,pumpZoneBottom:0,trajectory:[{md:0,tvd:0,zenith:45,azimuth:0},{md:300,tvd:200,zenith:45,azimuth:0}]};
 const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes(text))!;
 const choose=async(text:string)=>{const select=host.querySelector<HTMLSelectElement>('select[aria-label="Пример паспорта"]')!;const option=Array.from(select.options).find(o=>o.textContent===text)!;await act(async()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));});};
 try{
  await act(async()=>root.render(<CentralizationSection wellData={well} mudDensity={1100} onResultsChange={computed}/>));
  await choose('ПЦ-2-168/222');expect(button('Рассчитать центрирование').disabled).toBe(false);
  expect(host.textContent).toContain('Оценочный расчёт доступен');
  await act(async()=>button('Рассчитать центрирование').click());
  expect(computed.mock.lastCall?.[0]?.length).toBeGreaterThan(0);
  await act(async()=>button('По целевому Standoff').click());
  await choose('ПЦ-2-168/222');expect(button('Рассчитать расстановку').disabled).toBe(false);
  await act(async()=>button('Рассчитать расстановку').click());
  expect(computed.mock.lastCall?.[0]?.length).toBeGreaterThan(0);
  const target=host.querySelector<HTMLInputElement>('#centralizer-target')!;
  const setValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  await act(async()=>{setValue.call(target,'40');target.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,350));});
  expect(host.textContent).toContain('Расстановка центраторов · цель 40%');
  await choose('AVRORA 205 · ОК 168 · OD 254');expect(button('Рассчитать расстановку').disabled).toBe(false);
 }finally{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}
});
