import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getSession:vi.fn().mockResolvedValue({data:{session:null}})}}}));
vi.mock('@/components/SaveToCabinetDialog',()=>({default:()=>null}));
vi.mock('@/components/TermsFooter',()=>({default:()=>null}));
vi.mock('@/components/HelpLink',()=>({default:()=>null}));
vi.mock('@/lib/workover-report',()=>({openWorkoverReport:vi.fn(()=>true)}));
import Workover from './Workover';
import {openWorkoverReport} from '@/lib/workover-report';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal("ResizeObserver",class{observe(){} unobserve(){} disconnect(){}});(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();vi.clearAllMocks();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const mount=()=>act(()=>root.render(<MemoryRouter initialEntries={['/workover']}><Workover/></MemoryRouter>));
it('не экспортирует невыбранные операции и сохраняет выбор в черновик',()=>{
 mount();const report=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Отчёт PDF'))!;
 expect(report.disabled).toBe(true);
 const label=Array.from(host.querySelectorAll('label')).find(l=>l.textContent==='Подъёмник')!;
 act(()=>(label.querySelector('input') as HTMLInputElement).click());expect(report.disabled).toBe(false);
 act(()=>report.click());const sections=vi.mocked(openWorkoverReport).mock.calls[0][1];
 expect(sections.map(s=>s.title)).toEqual(['Скважина и колонна НКТ','Последовательность выбранных операций','Сводка нагрузок']);
 expect(localStorage.getItem('workover_draft_v2:new:selectedOperations')).toBe('["rig"]');
});
it('использует единую геометрию и сохраняет изменение после ввода',()=>{
 mount();const field=Array.from(host.querySelectorAll('label')).find(l=>l.textContent?.startsWith('OD обсадной'))!.parentElement!.querySelector('input')!;
 act(()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(field,'178');field.dispatchEvent(new Event('input',{bubbles:true}));});
 act(()=>field.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));
 expect(host.textContent).toContain('ID по конструкции: 162.0 мм');
});
it('для объёмного метода не показывает график циркуляции',()=>{
 localStorage.setItem('workover_draft_v2:new:kill',JSON.stringify({method:'volumetric'}));
 localStorage.setItem('workover_draft_v2:new:selectedOperations','["kill"]');mount();
 act(()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Открыть')!.click());
 expect(host.textContent).toContain('Объёмный метод: циркуляция не моделируется');
 expect(host.textContent).not.toContain('Расчётный график выбранного метода');
});
it('блокирует отчёт при несовместимой общей конструкции',()=>{
 localStorage.setItem('workover_draft_v2:new:casing',JSON.stringify({casingOD_mm:76,casingWall_mm:8}));
 localStorage.setItem('workover_draft_v2:new:selectedOperations','["cleanout"]');mount();
 const report=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Отчёт PDF'))!;
 expect(report.disabled).toBe(true);expect(host.textContent).toContain('ID колонны > OD НКТ');
 act(()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Открыть')!.click());
 expect(host.textContent).toContain('Расчёт заблокирован');
});
it('TVD пласта вычисляется по текущей траектории, а не сохранённому числу',()=>{
 localStorage.setItem('workover_draft_v2:new:well',JSON.stringify({trajectory:[{md:0,tvd:0,zenith:0,azimuth:0},{md:2500,tvd:2500,zenith:0,azimuth:0}]}));
 localStorage.setItem('workover_draft_v2:new:selectedOperations','["kill"]');mount();
 act(()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Открыть')!.click());
 expect(host.textContent).toContain('TVD пласта по траектории: 2300.0 м');
});
