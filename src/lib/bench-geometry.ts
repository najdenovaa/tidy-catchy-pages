import type {MovingPlugCase} from './moving-plug';
export interface BenchGeometry {survey:{mdM:number;tvdM:number}[];sections:{fromM:number;toM:number;diameterMm:number}[]}
export function defaultBenchGeometry(p:MovingPlugCase):BenchGeometry{return {survey:[{mdM:0,tvdM:0},{mdM:p.totalLengthM,tvdM:0}],sections:[{fromM:0,toM:p.totalLengthM,diameterMm:p.diameterMm}]};}
export function normalizeBenchGeometry(v:unknown):BenchGeometry|undefined{if(v===undefined)return undefined;const x=v&&typeof v==='object'?v as Record<string,unknown>:{},num=(r:unknown,k:string)=>r&&typeof r==='object'&&typeof (r as any)[k]==='number'&&Number.isFinite((r as any)[k])?(r as any)[k]:Number.NaN;return {survey:Array.isArray(x.survey)?x.survey.slice(0,2002).map(r=>({mdM:num(r,'mdM'),tvdM:num(r,'tvdM')})):[],sections:Array.isArray(x.sections)?x.sections.slice(0,52).map(r=>({fromM:num(r,'fromM'),toM:num(r,'toM'),diameterMm:num(r,'diameterMm')})):[]};}
export function benchGeometryKey(g?:BenchGeometry){return normalizeBenchGeometry(g)??null;}
export function compileBenchGeometry(p:MovingPlugCase,raw:BenchGeometry){
 const g=normalizeBenchGeometry(raw)!,length=p.totalLengthM,areaRef=Math.PI*(p.diameterMm/1000)**2/4;
 if(!Number.isFinite(length)||length<=0||!Number.isFinite(areaRef)||areaRef<=0||g.sections.length<1||g.sections.length>50||g.survey.length<2||g.survey.length>2000)throw new Error('Геометрия: нужны 1-50 секций и 2-2000 точек MD/TVD.');
 if(g.sections.some((s,i)=>![s.fromM,s.toM,s.diameterMm].every(Number.isFinite)||s.diameterMm<=0||s.toM<=s.fromM||s.fromM!==(i?g.sections[i-1].toM:0))||g.sections.at(-1)!.toM!==length)throw new Error('Секции должны без разрывов и перекрытий покрывать 0 - длина контура; внутренний диаметр положительный.');
 if(g.survey[0].mdM!==0||g.survey.at(-1)!.mdM!==length||g.survey.some((s,i)=>![s.mdM,s.tvdM].every(Number.isFinite)||i>0&&(s.mdM<=g.survey[i-1].mdM||Math.abs(s.tvdM-g.survey[i-1].tvdM)>s.mdM-g.survey[i-1].mdM+1e-8)))throw new Error('Траектория должна покрывать 0 - длина контура; MD возрастает, |ΔTVD| ≤ ΔMD.');
 const sections=g.sections.map(s=>({...s,areaM2:Math.PI*(s.diameterMm/1000)**2/4})),prefix=[0];for(const s of sections)prefix.push(prefix.at(-1)!+s.areaM2*(s.toM-s.fromM));const capacityM3=prefix.at(-1)!;
 if(!Number.isFinite(capacityM3)||capacityM3<=0||sections.some(s=>!Number.isFinite(s.areaM2)||s.areaM2<=0))throw new Error('Невыразимая вместимость контура.');
 const check=(md:number)=>{if(!Number.isFinite(md)||md<0||md>length)throw new Error('MD вне геометрии контура.');};
 const sectionAt=(md:number)=>{check(md);return sections.find(s=>md<s.toM)??sections.at(-1)!;};
 const volumeAt=(md:number)=>{check(md);if(md===length)return capacityM3;const i=sections.findIndex(s=>md<s.toM);return prefix[i]+sections[i].areaM2*(md-sections[i].fromM);};
 const mdAtVolume=(v:number)=>{if(!Number.isFinite(v)||v<0||v>capacityM3)throw new Error('Объёмная координата вне контура.');if(v===capacityM3)return length;const i=prefix.findIndex((x,j)=>j>0&&v<x)-1;return sections[i].fromM+(v-prefix[i])/sections[i].areaM2;};
 const toLogical=(md:number)=>volumeAt(md)/areaRef,fromLogical=(s:number)=>{const v=s*areaRef;if(!Number.isFinite(v)||v < -1e-12*Math.max(1,capacityM3)||v > capacityM3+1e-12*Math.max(1,capacityM3))throw new Error("Объёмная координата вне контура.");return mdAtVolume(Math.max(0,Math.min(capacityM3,v)));};
 const tvd=(md:number)=>{check(md);if(md===length)return g.survey.at(-1)!.tvdM;let lo=1,hi=g.survey.length-1;while(lo<hi){const m=(lo+hi)>>1;if(g.survey[m].mdM<=md)lo=m+1;else hi=m;}const i=lo,a=g.survey[i-1],b=g.survey[i];return a.tvdM+(b.tvdM-a.tvdM)*(md-a.mdM)/(b.mdM-a.mdM);};
 const parts=(from:number,to:number)=>{check(from);check(to);if(!(to>from))throw new Error('Неположительный отрезок гидравлики.');return sections.filter(s=>s.toM>from&&s.fromM<to).map(s=>({lengthM:Math.min(to,s.toM)-Math.max(from,s.fromM),diameterMm:s.diameterMm}));};
 const cuts=[...new Set(g.sections.slice(1).map(s=>s.fromM))].sort((a,b)=>a-b),region=(md:number)=>cuts.filter(c=>c<=md).length;
 const faces=(x:number,n:number)=>{const b=toLogical(x),end=capacityM3/areaRef;return [...Array.from({length:n+1},(_,i)=>b*(i/n)),...Array.from({length:n},(_,i)=>i===n-1?end:b+(end-b)*((i+1)/n))];};
 return {input:g,length,areaRef,capacityM3,logicalLength:capacityM3/areaRef,sectionAt,volumeAt,mdAtVolume,toLogical,fromLogical,tvd,parts,cuts,region,faces};
}
export type CompiledBenchGeometry=ReturnType<typeof compileBenchGeometry>;
/** Explicitly imports only the requested pipe interval; never extrapolates survey coverage. */
export function benchGeometryFromWell(w:import('./cementing-calculations').WellData,p:MovingPlugCase):BenchGeometry{
 const end=p.totalLengthM,t=w.trajectory;if(!(end>0&&end<=w.casingDepthMD)||!t?.length||t[0].md!==0||t.at(-1)!.md<end||t.some((v,i)=>!Number.isFinite(v.md)||!Number.isFinite(v.tvd)||i>0&&v.md<=t[i-1].md))throw new Error('Для импорта нужны секция внутри глубины колонны и траектория проекта от 0 до конца этого участка.');
 const survey=t.filter(v=>v.md<=end).map(v=>({mdM:v.md,tvdM:v.tvd}));if(survey.at(-1)!.mdM<end){const i=t.findIndex(v=>v.md>end),a=t[i-1],b=t[i];survey.push({mdM:end,tvdM:a.tvd+(b.tvd-a.tvd)*(end-a.md)/(b.md-a.md)});}
 const bounds=[...new Set([0,end,...(w.casingSections??[]).flatMap(s=>[s.fromMD,s.toMD]).filter(x=>x>0&&x<end)])].sort((a,b)=>a-b),sections=bounds.slice(1).map((toM,i)=>{const fromM=bounds[i],wall=w.casingSections?.find(s=>fromM>=s.fromMD&&fromM<s.toMD)?.wallThickness??w.casingWall;return {fromM,toM,diameterMm:w.casingOD-2*wall};});const g={survey,sections};compileBenchGeometry(p,g);return g;
}
