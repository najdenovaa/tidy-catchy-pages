import type { ProgramInput, OptimizerSettings, OptimizerResult } from './cement-optimizer';
import type { OptimizerHardwareCatalog } from './optimizer-hardware';

export const OPTIMIZER_TIMEOUT_MS=120000;

/** One worker per run; terminating it cancels both candidate search and native confirmation. */
export function runOptimizerInWorker(input:ProgramInput, settings:OptimizerSettings, catalog:OptimizerHardwareCatalog, onProgress:(done:number,total:number)=>void, signal:AbortSignal,onConfirmed?:(result:OptimizerResult)=>void):Promise<OptimizerResult> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('Подбор отменён','AbortError'));return;}
    let confirmed:OptimizerResult|undefined;
    const stopped=(note:string)=>({...confirmed!,planningNotes:[...(confirmed!.planningNotes??[]).filter(n=>!n.includes('продолжается')),note],blocker:undefined});
    const worker=new Worker(new URL('../workers/programOptimizer.worker.ts',import.meta.url),{type:'module'});
    const finish=()=>{clearTimeout(timeout);worker.terminate();signal.removeEventListener('abort',abort);};
    const abort=()=>{finish();if(confirmed)resolve(stopped('Поиск остановлен пользователем. Сохранены полностью проверенные варианты.'));else reject(new DOMException('Подбор отменён','AbortError'));};
    const timeout=setTimeout(()=>{finish();if(confirmed){resolve(stopped('Достигнут лимит времени. Сохранены полностью проверенные варианты.'));return;}reject(new Error('Автоподбор остановлен: превышен лимит 2 минуты. Исходные данные сохранены; непроверенные варианты не применялись.'));},OPTIMIZER_TIMEOUT_MS);
    signal.addEventListener('abort',abort,{once:true});
    worker.onmessage=event=>{
      const message=event.data;
      if(message.type==='progress')onProgress(message.done,message.total);
      else if(message.type==='confirmed'&&message.result.best?.length&&message.result.best.every((x:OptimizerResult['best'][number])=>x.complete&&x.ev.feasible)){confirmed=message.result;onConfirmed?.(confirmed);}
      else if(message.type==='result'){finish();resolve(message.result);}
      else if(message.type==='error'){finish();reject(new Error(message.message));}
    };
    worker.onmessageerror=()=>{finish();reject(new Error('Не удалось получить результат автоподбора. Исходные данные сохранены.'));};
    worker.onerror=event=>{finish();reject(new Error(event.message||'Не удалось выполнить автоподбор'));};
    try{worker.postMessage({input,settings,catalog});}catch(error){finish();reject(error);}
  });
}
