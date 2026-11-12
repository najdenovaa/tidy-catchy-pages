import {transportRefinementInputs,summarizeTransportRefinement} from './transport-refinement';
import type {CementingSnapshot} from './cementing-normalizers';
import {transportInputKey,type TransportResult} from './compressible-transport';
export function startTransportWorker(input:CementingSnapshot,onProgress?:(fraction:number)=>void){
 const worker=new Worker(new URL('./compressible-transport.worker.ts',import.meta.url),{type:'module'}),key=transportInputKey(input);
 let rejectTask:(e:Error)=>void=()=>{};
 const promise=new Promise<TransportResult>((resolve,reject)=>{
  rejectTask=reject;
  worker.onmessage=event=>{const data=event.data;if(data.type==='progress'){onProgress?.(data.fraction);return;}worker.terminate();if(data.type==='result'&&data.result.inputKey===key)resolve(data.result);else reject(new Error(data.message||'Результат не соответствует снимку входных данных.'));};
  worker.onerror=e=>{worker.terminate();reject(new Error(e.message||'Ошибка рабочего потока.'));};
  worker.postMessage(input);
 });
 return {promise,cancel:()=>{worker.terminate();rejectTask(new Error('Расчёт отменён.'));}};
}

/** Sequential Workers bound memory and allow cancelling between as well as during runs. */
export function startTransportRefinement(input:CementingSnapshot,onProgress?:(fraction:number)=>void){
 const plan=transportRefinementInputs(input);let active:ReturnType<typeof startTransportWorker>|undefined,cancelled=false;
 const promise=(async()=>{const runs:TransportResult[]=[];for(let i=0;i<plan.length;i++){
  if(cancelled)throw new Error('Расчёт отменён.');
  active=startTransportWorker(plan[i].input,f=>onProgress?.((i+f)/plan.length));const result=await active.promise;
  if(cancelled)throw new Error('Расчёт отменён.');runs.push(result);onProgress?.((i+1)/plan.length);
 }return {...runs[0],study:summarizeTransportRefinement(input,runs)};})();
 return {promise,cancel:()=>{cancelled=true;active?.cancel();}};
}
