import type { ProgramInput, OptimizerSettings, OptimizerResult } from './cement-optimizer';
import type { OptimizerHardwareCatalog } from './optimizer-hardware';

export const OPTIMIZER_TIMEOUT_MS=120000;

/** One worker per run; terminating it cancels both candidate search and native confirmation. */
export function runOptimizerInWorker(input:ProgramInput, settings:OptimizerSettings, catalog:OptimizerHardwareCatalog, onProgress:(done:number,total:number)=>void, signal:AbortSignal):Promise<OptimizerResult> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('Подбор отменён','AbortError'));return;}
    const worker=new Worker(new URL('../workers/programOptimizer.worker.ts',import.meta.url),{type:'module'});
    const finish=()=>{clearTimeout(timeout);worker.terminate();signal.removeEventListener('abort',abort);};
    const abort=()=>{finish();reject(new DOMException('Подбор отменён','AbortError'));};
    const timeout=setTimeout(()=>{finish();reject(new Error('Автоподбор остановлен: превышен лимит 2 минуты. Исходные данные сохранены; непроверенные варианты не применялись.'));},OPTIMIZER_TIMEOUT_MS);
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=event=>{
      const message=event.data;
      if(message.type==='progress')onProgress(message.done,message.total);
      else if(message.type==='result'){finish();resolve(message.result);}
      else if(message.type==='error'){finish();reject(new Error(message.message));}
    };
    worker.onmessageerror=()=>{finish();reject(new Error('Не удалось получить результат автоподбора. Исходные данные сохранены.'));};
    worker.onerror=event=>{finish();reject(new Error(event.message||'Не удалось выполнить автоподбор'));};
    try{worker.postMessage({input,settings,catalog});}catch(error){finish();reject(error);}
  });
}
