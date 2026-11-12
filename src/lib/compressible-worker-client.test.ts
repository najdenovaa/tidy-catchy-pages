import {transportRefinementInputs} from './transport-refinement';
import {it,expect,vi,afterEach} from 'vitest';
import {startTransportWorker,startTransportRefinement} from './compressible-worker-client';
import {flowFixture,studyFixture} from '@/test/fixtures/compressible-flow';
import {transportInputKey,simulateCompressibleTransport} from './compressible-transport';
class FakeWorker {static last:FakeWorker;onmessage:any;onerror:any;terminate=vi.fn();postMessage=vi.fn();constructor(){FakeWorker.last=this;}}
afterEach(()=>vi.unstubAllGlobals());
it('rejects mismatched source results and terminates the worker',async()=>{vi.stubGlobal('Worker',FakeWorker);const t=startTransportWorker(flowFixture());FakeWorker.last.onmessage({data:{type:'result',result:{inputKey:'stale'}}});await expect(t.promise).rejects.toThrow('снимку');expect(FakeWorker.last.terminate).toHaveBeenCalled();});
it('reports progress and returns only the matching snapshot',async()=>{vi.stubGlobal('Worker',FakeWorker);const p=flowFixture(),progress=vi.fn(),t=startTransportWorker(p,progress);FakeWorker.last.onmessage({data:{type:'progress',fraction:.5}});expect(progress).toHaveBeenCalledWith(.5);const result={inputKey:transportInputKey(p)};FakeWorker.last.onmessage({data:{type:'result',result}});await expect(t.promise).resolves.toBe(result);});
it('allows cancellation without accepting a later result',async()=>{vi.stubGlobal('Worker',FakeWorker);const p=flowFixture(),t=startTransportWorker(p);t.cancel();FakeWorker.last.onmessage({data:{type:'result',result:{inputKey:transportInputKey(p)}}});await expect(t.promise).rejects.toThrow('отменён');expect(FakeWorker.last.terminate).toHaveBeenCalled();});

it('cancels the five-run study before launching a subsequent worker',async()=>{vi.stubGlobal('Worker',FakeWorker);const p=studyFixture(),t=startTransportRefinement(p),worker=FakeWorker.last;t.cancel();await expect(t.promise).rejects.toThrow('отменён');expect(FakeWorker.last).toBe(worker);expect(worker.terminate).toHaveBeenCalled();});

it('executes five workers sequentially and attaches the study to the original snapshot',async()=>{vi.stubGlobal('Worker',FakeWorker);const p=studyFixture(),plan=transportRefinementInputs(p),progress=vi.fn(),t=startTransportRefinement(p,progress);let previous:FakeWorker|undefined;for(const x of plan){const w=FakeWorker.last;expect(w).not.toBe(previous);const result=simulateCompressibleTransport(x.input);w.onmessage({data:{type:'result',result}});await Promise.resolve();await Promise.resolve();previous=w;}const r=await t.promise;expect(r.inputKey).toBe(transportInputKey(p));expect(r.study.rows).toHaveLength(5);expect(progress).toHaveBeenLastCalledWith(1);});
