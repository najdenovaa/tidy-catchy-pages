import {normalizeHardwareIdentity,type HardwareIdentity} from './optimizer-hardware-identity';
export interface BufferTransitRecord {name:string;fluidId:string;minRateLps:number;maxRateLps:number;minContactMin:number;minRegime:number;maxRegime:number;coveredDepths:number;totalDepths:number}
export interface OptimizerProgramRecord {version:1;variant:string;createdAt:string;cqi:number;minCqi:number;targetFromMD:number;targetToMD:number;bufferBoost:boolean;transit:BufferTransitRecord[];hardware:{identity:HardwareIdentity;quantity:number;kind:'centralizer'|'turbulator'}[];notes:string[]}
export function normalizeOptimizerProgramRecord(v:unknown):OptimizerProgramRecord|undefined{
 if(!v||typeof v!=='object')return;const x=v as OptimizerProgramRecord;
 if(x.version!==1||typeof x.variant!=='string'||x.variant.length>200||!Number.isFinite(Date.parse(x.createdAt))||![x.cqi,x.minCqi,x.targetFromMD,x.targetToMD].every(n=>Number.isFinite(n)&&n>=0)||x.targetToMD<=x.targetFromMD||typeof x.bufferBoost!=='boolean'||!Array.isArray(x.transit)||x.transit.length>100||!Array.isArray(x.hardware)||x.hardware.length>100||!Array.isArray(x.notes)||x.notes.length>200)return;
 const transit=x.transit.map(t=>{if(typeof t.name!=='string'||typeof t.fluidId!=='string'||![t.minRateLps,t.maxRateLps,t.minContactMin,t.minRegime,t.maxRegime,t.coveredDepths,t.totalDepths].every(n=>Number.isFinite(n)&&n>=0)||t.minRateLps>t.maxRateLps||t.coveredDepths>t.totalDepths)return;return {...t,name:t.name.slice(0,2000),fluidId:t.fluidId.slice(0,100)};});
 const hardware=x.hardware.map(h=>{const identity=normalizeHardwareIdentity(h.identity);return identity&&['centralizer','turbulator'].includes(h.kind)&&Number.isInteger(h.quantity)&&h.quantity>=0?{identity,kind:h.kind,quantity:h.quantity}:undefined;});
 if(transit.some(x=>!x)||hardware.some(x=>!x))return;
 return {version:1,variant:x.variant,createdAt:x.createdAt,cqi:x.cqi,minCqi:x.minCqi,targetFromMD:x.targetFromMD,targetToMD:x.targetToMD,bufferBoost:x.bufferBoost,transit,hardware,notes:x.notes.filter(n=>typeof n==='string').map(n=>n.slice(0,4000))};
}
