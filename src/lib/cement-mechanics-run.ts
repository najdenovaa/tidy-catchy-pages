import type {CementingSnapshot} from './cementing-normalizers';
import type {ThermalResult} from './cement-thermal';
import type {MechanicsResult} from './cement-mechanics';
export function runMechanics(s:CementingSnapshot,thermal?:ThermalResult):Promise<MechanicsResult>{return new Promise((resolve,reject)=>{const w=new Worker(new URL('../workers/cementMechanics.worker.ts',import.meta.url),{type:'module'});w.onmessage=e=>{w.terminate();e.data.error?reject(Error(e.data.error)):resolve(e.data.result);};w.onerror=e=>{w.terminate();reject(Error(e.message));};w.postMessage({input:s,thermal});});}
