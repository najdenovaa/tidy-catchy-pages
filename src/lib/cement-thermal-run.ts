import type {CementingSnapshot} from './cementing-normalizers';
import type {ThermalResult} from './cement-thermal';
export function runThermal(input:CementingSnapshot):Promise<ThermalResult>{return new Promise((resolve,reject)=>{const worker=new Worker(new URL('../workers/cementThermal.worker.ts',import.meta.url),{type:'module'});worker.onmessage=e=>{worker.terminate();e.data.error?reject(Error(e.data.error)):resolve(e.data.result);};worker.onerror=e=>{worker.terminate();reject(Error(e.message||'Ошибка теплового расчёта'));};worker.postMessage(input);});}
