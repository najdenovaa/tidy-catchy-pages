export interface HardwareIdentity {id:string;model:string;manufacturer:string;source:string;sourceUrl?:string;revision:number;basis:'passport'|'catalog'|'user'}
export function normalizeHardwareIdentity(v:unknown):HardwareIdentity|undefined{
 if(!v||typeof v!=='object')return;const x=v as HardwareIdentity;
 if(!['id','model','manufacturer','source'].every(k=>typeof x[k]==='string'&&x[k].length>0&&x[k].length<=4000)||!Number.isInteger(x.revision)||x.revision<1||!['passport','catalog','user'].includes(x.basis))return;
 return {id:x.id,model:x.model,manufacturer:x.manufacturer,source:x.source,revision:x.revision,basis:x.basis,...(typeof x.sourceUrl==='string'?{sourceUrl:x.sourceUrl}: {})};
}
