import {it,expect,vi,afterEach} from 'vitest';
import {startTransportWorker} from './compressible-worker-client';
import {flowFixture} from '@/test/fixtures/compressible-flow';
import {transportInputKey} from './compressible-transport';
class FakeWorker {static last:FakeWorker;onmessage:any;onerror:any;terminate=vi.fn();postMessage=vi.fn();constructor(){FakeWorker.last=this;}}
afterEach(()=>vi.unstubAllGlobals());
it('rejects mismatched source results and terminates the worker',async()=>{vi.stubGlobal('Worker',FakeWorker);const t=startTransportWorker(flowFixture());FakeWorker.last.onmessage({data:{type:'result',result:{inputKey:'stale'}}});await expect(t.promise).rejects.toThrow('снимку');expect(FakeWorker.last.terminate).toHaveBeenCalled();});
it('reports progress and returns only the matching snapshot',async()=>{vi.stubGlobal('Worker',FakeWorker);const p=flowFixture(),progress=vi.fn(),t=startTransportWorker(p,progress);FakeWorker.last.onmessage({data:{type:'progress',fraction:.5}});expect(progress).toHaveBeenCalledWith(.5);const result={inputKey:transportInputKey(p)};FakeWorker.last.onmessage({data:{type:'result',result}});await expect(t.promise).resolves.toBe(result);});
it('allows cancellation without accepting a later result',async()=>{vi.stubGlobal('Worker',FakeWorker);const p=flowFixture(),t=startTransportWorker(p);t.cancel();FakeWorker.last.onmessage({data:{type:'result',result:{inputKey:transportInputKey(p)}}});await expect(t.promise).rejects.toThrow('отменён');expect(FakeWorker.last.terminate).toHaveBeenCalled();});
