import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it} from 'vitest';
import Component from './Centralizer3DInspector';
import {pcCentralizers} from '@/lib/pc-centralizers';
const spec=pcCentralizers.find(p=>p.spec.passport?.model==='ПЦ-2-168/222')!.spec;
it('разделяет цель, результат пролёта и опоры; увеличение меняет картинку, но не мм',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<Component spec={spec} result={{md:2500,tvd:2300,zenith:25,eccentricity:.6,supportEccentricity:.1,standoff:40,spanSagMM:13.5,lateralLoadKN:1.4,hasCentralizer:true,hasTurbulizer:false,turbulenceMultiplier:1,intervalId:'1'}} casingOD={168} casingID={152} boreDiameter={222} cased={false} targetStandoff={40}/>));
  expect(host.textContent).toContain('Цель расстановки40%');expect(host.textContent).toContain('Standoff в пролёте40.0%');expect(host.textContent).toContain('Standoff на опоре90.0%');
  expect(host.textContent).toContain('до сжатия');
  const rows=host.querySelector('tbody')!.textContent;
  const points=host.querySelector('polygon')!.getAttribute('points');
  const slider=host.querySelector<HTMLInputElement>('[aria-label="Увеличение деформации"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(slider,'8');slider.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(host.querySelector('tbody')!.textContent).toBe(rows);
  expect(host.querySelector('polygon')!.getAttribute('points')).not.toBe(points);
  const beforeAxial=host.querySelector('polygon')!.getAttribute('points');
  const axial=[...host.querySelectorAll('button')].find(b=>b.textContent==='Вид вдоль оси')!;
  await act(async()=>axial.click());
  expect(host.querySelector('polygon')!.getAttribute('points')).not.toBe(beforeAxial);
  expect(host.querySelector('tbody')!.textContent).toBe(rows);

 }finally{await act(async()=>root.unmount());host.remove();}
},15000);
