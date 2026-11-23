import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import ProgramOptimizerSection from './ProgramOptimizerSection';
import {qualityInput,qualitySettings} from '@/lib/__tests__/fixtures/optimizer-cleaning-fixture';
import {optimizerHardwareCatalog} from '@/lib/optimizer-hardware';
import {runOptimizer,type OptimizerResult} from '@/lib/cement-optimizer';
const mocks=vi.hoisted(()=>({run:vi.fn()}));
vi.mock('@/lib/optimizer-worker-client',()=>({runOptimizerInWorker:mocks.run}));
it('lets the user apply a fully confirmed program while further search is still running',async()=>{
 const input=qualityInput();let stop=false;
 const ready=await runOptimizer(input,{...qualitySettings,minRateLps:30,maxRateLps:30,maxCementRateLps:30},undefined,optimizerHardwareCatalog(),{timeBudgetMs:10000,now:()=>stop?10000:0,onConfirmed:()=>{stop=true;}});
 expect(ready.best.length,ready.blocker).toBeGreaterThan(0);
 let deliver:(r:OptimizerResult)=>void=()=>{},signal:AbortSignal;
 mocks.run.mockImplementation((_i,_s,_c,_p,jobSignal,confirmed)=>new Promise(resolve=>{
  signal=jobSignal;deliver=confirmed;jobSignal.addEventListener('abort',()=>resolve(ready),{once:true});
 }));
 const apply=vi.fn();
 render(<ProgramOptimizerSection input={input} onApply={vi.fn()} onApplyComplete={apply}/>);
 fireEvent.click(screen.getByRole('button',{name:'Подобрать программу'}));
 expect(screen.getByRole('button',{name:'Отменить'})).toBeInTheDocument();
 act(()=>deliver(ready));
 const button=screen.getAllByRole('button',{name:'Применить и остановить'})[0];expect(button).not.toBeDisabled();
 fireEvent.click(button);expect(signal!.aborted).toBe(true);expect(apply).toHaveBeenCalledWith(ready.best[0].complete);
 await waitFor(()=>expect(screen.getByRole('button',{name:'Подобрать программу'})).not.toBeDisabled());
});
