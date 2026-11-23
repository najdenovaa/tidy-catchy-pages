import {afterEach,expect,it,vi} from 'vitest';
import {runOptimizerInWorker} from './optimizer-worker-client';
import {qualityInput,qualitySettings} from './__tests__/fixtures/optimizer-cleaning-fixture';
import {optimizerHardwareCatalog} from './optimizer-hardware';
class FakeWorker {
 static instances:FakeWorker[]=[];
 onmessage:((e:{data:unknown})=>void)|null=null;
 onerror:((e:{message:string})=>void)|null=null;
 postMessage=vi.fn();terminate=vi.fn();
 constructor(){FakeWorker.instances.push(this);}
}
afterEach(()=>{vi.unstubAllGlobals();FakeWorker.instances=[];});
it('runs search off the UI thread, forwards progress and terminates after success',async()=>{
 vi.stubGlobal('Worker',FakeWorker);const progress=vi.fn(),controller=new AbortController();
 const promise=runOptimizerInWorker(qualityInput(),qualitySettings,optimizerHardwareCatalog(),progress,controller.signal);
 const worker=FakeWorker.instances[0];expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({settings:qualitySettings}));
 worker.onmessage!({data:{type:'progress',done:42,total:100}});expect(progress).toHaveBeenCalledWith(42,100);
 worker.onmessage!({data:{type:'result',result:{best:[]}}});expect(await promise).toEqual({best:[]});expect(worker.terminate).toHaveBeenCalledTimes(1);
});
it('cancels native calculation immediately and rejects without displaying a calculation error',async()=>{
 vi.stubGlobal('Worker',FakeWorker);const controller=new AbortController();
 const promise=runOptimizerInWorker(qualityInput(),qualitySettings,optimizerHardwareCatalog(),vi.fn(),controller.signal);
 controller.abort();await expect(promise).rejects.toMatchObject({name:'AbortError'});expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
});
it('reports worker errors and releases the worker',async()=>{
 vi.stubGlobal('Worker',FakeWorker);
 const promise=runOptimizerInWorker(qualityInput(),qualitySettings,optimizerHardwareCatalog(),vi.fn(),new AbortController().signal);
 FakeWorker.instances[0].onmessage!({data:{type:'error',message:'Ошибка геометрии'}});
 await expect(promise).rejects.toThrow('Ошибка геометрии');expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
});
it('stops an unresponsive worker after two minutes without depending on worker progress',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker);
 try{
  const promise=runOptimizerInWorker(qualityInput(),qualitySettings,optimizerHardwareCatalog(),vi.fn(),new AbortController().signal);
  const assertion=expect(promise).rejects.toThrow('превышен лимит 2 минуты');
  await vi.advanceTimersByTimeAsync(120000);await assertion;
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
it('clears the watchdog after a successful response',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker);
 try{
  const promise=runOptimizerInWorker(qualityInput(),qualitySettings,optimizerHardwareCatalog(),vi.fn(),new AbortController().signal);
  FakeWorker.instances[0].onmessage!({data:{type:'result',result:{best:[]}}});await promise;
  await vi.advanceTimersByTimeAsync(120000);expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
it('returns the last fully checked program on timeout rather than discarding it',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker);
 const ready={best:[{ev:{feasible:true},complete:{record:{}}}],planningNotes:[]};
 try{
  const confirmed=vi.fn();const promise=runOptimizerInWorker(qualityInput(),qualitySettings,optimizerHardwareCatalog(),vi.fn(),new AbortController().signal,confirmed);
  FakeWorker.instances[0].onmessage!({data:{type:'confirmed',result:ready}});
  expect(confirmed).toHaveBeenCalledWith(ready);
  await vi.advanceTimersByTimeAsync(120000);const result=await promise;
  expect(result.best).toEqual(ready.best);expect(result.planningNotes.join(' ')).toContain('лимит времени');expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
it('keeps a checked candidate when the user cancels further improvement',async()=>{
 vi.stubGlobal('Worker',FakeWorker);const controller=new AbortController();
 const promise=runOptimizerInWorker(qualityInput(),qualitySettings,optimizerHardwareCatalog(),vi.fn(),controller.signal);
 const ready={best:[{ev:{feasible:true},complete:{record:{}}}]};FakeWorker.instances[0].onmessage!({data:{type:'confirmed',result:ready}});
 controller.abort();const result=await promise;expect(result.best).toEqual(ready.best);expect(result.planningNotes.join(' ')).toContain('остановлен пользователем');
});
it('never treats an unverified preliminary candidate as a checked fallback',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker);
 try{
  const promise=runOptimizerInWorker(qualityInput(),qualitySettings,optimizerHardwareCatalog(),vi.fn(),new AbortController().signal);
  FakeWorker.instances[0].onmessage!({data:{type:'confirmed',result:{best:[{ev:{feasible:true}}]}}});
  const assertion=expect(promise).rejects.toThrow('превышен лимит 2 минуты');await vi.advanceTimersByTimeAsync(120000);await assertion;
 }finally{vi.useRealTimers();}
});
