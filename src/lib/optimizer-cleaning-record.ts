import type {CleaningDesign} from './optimizer-cleaning';
/** Historical design at application; never asserts current field removal after later edits. */
export function normalizeCleaningDesign(v:unknown):CleaningDesign|undefined{
 if(!v||typeof v!=='object')return;
 const x=v as CleaningDesign,t=x.target;
 if(x.version!==1||x.targetRemovalPct!==85||x.chemicalRateLps!==10||!t||!Array.isArray(t.layers)||t.layers.length>200)return;
 const numbers=[t.topMD,t.bottomMD,t.topTVD,t.bottomTVD,t.volumeM3,t.aboveActualM,x.chemicalVolumeM3,x.heavyVolumeM3,x.chemicalContactMin,x.heavyHighContactMin,x.heavyRateLps,x.cementRateLps,x.displacementRateLps,x.switchVolumeM3,x.heavyEndVolumeM3];
 if(numbers.some(n=>!Number.isFinite(n)||n<0)||t.topMD>=t.bottomMD||x.heavyEndVolumeM3<x.switchVolumeM3)return;
 const text=(v:unknown)=>typeof v==='string'?v.slice(0,2000):'';
 const p=x.proof;
 if(p&&(![p.removalPct,p.exposureS,p.criticalPa,p.temperatureC,p.pressureMPaAbs].every(Number.isFinite)||p.removalPct<85||p.removalPct>100||p.exposureS<=0||p.criticalPa<0||p.temperatureC<=-273.15||p.pressureMPaAbs<=0))return;
 return {version:1,target:{topMD:t.topMD,bottomMD:t.bottomMD,topTVD:t.topTVD,bottomTVD:t.bottomTVD,volumeM3:t.volumeM3,aboveActualM:t.aboveActualM,layers:t.layers.map(text)},targetRemovalPct:85,chemicalName:text(x.chemicalName),heavyName:text(x.heavyName),chemicalVolumeM3:x.chemicalVolumeM3,heavyVolumeM3:x.heavyVolumeM3,chemicalContactMin:x.chemicalContactMin,heavyHighContactMin:x.heavyHighContactMin,chemicalRateLps:10,heavyRateLps:x.heavyRateLps,cementRateLps:x.cementRateLps,displacementRateLps:x.displacementRateLps,switchVolumeM3:x.switchVolumeM3,heavyEndVolumeM3:x.heavyEndVolumeM3,...(p?{proof:{id:text(p.id),source:text(p.source),removalPct:p.removalPct,exposureS:p.exposureS,criticalPa:p.criticalPa,temperatureC:p.temperatureC,pressureMPaAbs:p.pressureMPaAbs}}:{})};
}
