import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {useWorkoverDraft} from './use-workover-draft';
vi.mock('sonner',()=>({toast:{error:vi.fn()}}));
let root:Root,host:HTMLDivElement;
let change:ReturnType<typeof useWorkoverDraft<{rateLs:number}>>[1];
function Probe({scope}:{scope:string}){const [value,setValue]=useWorkoverDraft(scope,'rate',{rateLs:8});change=setValue;return <span>{value.rateLs}</span>;}
beforeEach(()=>{(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
it('сохраняет последовательные изменения, восстанавливает после перезапуска и изолирует скважины',()=>{
 act(()=>root.render(<Probe key="a" scope="well:a"/>));
 act(()=>{change(x=>({rateLs:x.rateLs+1}));change(x=>({rateLs:x.rateLs+1}));});
 expect(host.textContent).toBe('10');
 act(()=>root.render(<Probe key="b" scope="well:b"/>));expect(host.textContent).toBe('8');
 act(()=>root.render(<Probe key="a" scope="well:a"/>));expect(host.textContent).toBe('10');
});
it('не перезаписывает сохранённое значение недопустимым вводом',()=>{
 act(()=>root.render(<Probe scope="new"/>));act(()=>change({rateLs:-3}));
 expect(host.textContent).toBe('8');expect(JSON.parse(localStorage.getItem('workover_draft_v2:new:rate')!).rateLs).toBe(8);
});
