import {displacementDepthHistory} from './displacement-depth-history';
import {pipeDepthComposition,displacementTimeline,type DisplacementFrame} from './displacement-pipe';
import {getCasingIDAtDepth} from './cementing-calculations';
import {boreDiameterAtDepth} from './well-geometry';
import {mixtureColor} from './displacement-colors';
import type {DisplacementReportData} from './cementing-report-data';
export type SectionSource=Pick<DisplacementReportData,'result'|'pipe'|'meta'> & Partial<Pick<DisplacementReportData,'timeline'|'settings'>>;
export type Point3=[number,number,number];
export interface SectionFace {space:'annulus'|'pipe'|'metal';points:[Point3,Point3,Point3];color:string}
export const SECTION_NOTE='Сечение поперёк оси колонны. Цвет смеси кодирует средние доли, не радиальное расслоение. Секторы сохраняют порядок по окружности и объёмные веса ячеек модели; их угловые границы отображены с сохранением площади. Толщина 3D-фрагмента условная.';
export function observationDepthMD(d:SectionSource,selected?:number){return selected??d.result?.zCenters[Math.floor(d.result.nZ/2)]??d.pipe?.segments[Math.floor(d.pipe.segments.length/2)]?.topMD??0;}
export function sectionTimeline(d:SectionSource):DisplacementFrame[]{return d.timeline??displacementTimeline(d.pipe,d.result,d.meta.annulusStartS,d.settings?.settleMin??0,d.settings?.frameIntervalS);}
const blank=(n:number)=>(Array.from({length:n},()=>null) as (number|null)[]);
const darken=(hex:string,factor:number)=>'#'+[0,1,2].map(k=>Math.round(parseInt(hex.slice(1+k*2,3+k*2),16)*factor).toString(16).padStart(2,'0')).join('');
export function displacementSection(d:SectionSource,md:number,frame:number){
 const w=d.meta.sectionWell,timeline=sectionTimeline(d),point=timeline[frame];
 if(!w)return {error:'Геометрия этого расчёта не сохранена. Пересчитайте вытеснение.'} as const;
 if(!Number.isFinite(md)||md<0||md>w.casingDepthMD)return {error:'Глубина вне интервала колонны. Сечение не определено.'} as const;
 if(!Number.isInteger(frame)||!point)return {error:'Нет выбранного временного кадра.'} as const;
 const r=d.result,fluids=r?.fluids??d.pipe?.fluids??[],colors=d.meta.colors;
 const p=d.pipe?pipeDepthComposition(d.pipe,md,point.timeS):null;
 const hist=r?displacementDepthHistory(r,md):null;
 const snapshot=r?.snapshots[point.annulusFrame],row=hist?.rows[point.annulusFrame];
 const pipeFractions=p?.fractions??blank(fluids.length),annulusFractions=row?.fractions??blank(fluids.length);
 const pipeStatus=d.pipe?(p?'Рассчитано':'Вне трубной сетки'):'Расчёт отключён';
 const annulusStatus=!r?'Расчёт отключён':!hist?'Вне затрубной сетки':!snapshot||annulusFractions.some(x=>x===null)?'Нет полного состава ячейки':point.timeS<d.meta.annulusStartS?'Исходный раствор до выхода первых порций':'Рассчитано';
 const ro=w.casingOD/2,ri=p?Math.sqrt((d.pipe!.segments[p.cell].endM3-d.pipe!.segments[p.cell].startM3)/(p.bottomMD-p.topMD)/Math.PI)*1000:getCasingIDAtDepth(Math.min(md,w.casingDepthMD-1e-7),w.casingOD,w.casingWall,w.casingSections)/2;
 const gap=hist&&r?Array.from({length:r.nTheta},(_,i)=>r.gap[hist.cell*r.nTheta+i]*1000):null;
 if(gap?.some(g=>!Number.isFinite(g)||g<=0))return {error:'Недопустимая геометрия расчётной ячейки.'} as const;
 const rh=gap?ro+gap.reduce((s,v)=>s+v,0)/gap.length:Math.max(ro+3,boreDiameterAtDepth(w,md)/2);
 const profile=(w.standoffProfile??[]).slice().sort((a,b)=>a.md-b.md);
 let so=(w.annularStandoffPct??67)/100;
 if(hist&&r)so=r.rows[hist.cell]?.standoff??so;
 else if(profile.length){so=profile[0].standoffPct/100;for(let i=1;i<profile.length;i++){const a=profile[i-1],b=profile[i];if(md<=b.md){so=(a.standoffPct+(b.standoffPct-a.standoffPct)*Math.max(0,(md-a.md)/Math.max(1e-9,b.md-a.md)))/100;break;}so=b.standoffPct/100;}}
 so=Math.min(1,Math.max(.05,so));const offset=(1-so)*(rh-ro),thickness=rh*.65;
 if(![ro,ri,rh,offset].every(Number.isFinite)||ri<=0||ro<=ri||rh<=ro)return {error:'Недопустимые диаметры сечения.'} as const;
 const n=hist&&r?r.nTheta*(r.full?1:2):32,weights=Array.from({length:n},(_,i)=>gap?gap[r!.full?i:i<r!.nTheta?i:2*r!.nTheta-i-1]:1),sum=weights.reduce((s,x)=>s+x,0);
 // Invert the physical annular-area CDF. The display grid preserves model volume weights
 // while retaining exact eccentric circular boundaries and the wide/narrow ordering.
 const outer=(a:number)=>offset*Math.cos(a)+Math.sqrt(rh*rh-offset*offset*Math.sin(a)**2);
 const areaRate=(a:number)=>(outer(a)**2-ro*ro)/2,steps=4096,da=2*Math.PI/steps,cdf=[0];
 for(let i=1;i<=steps;i++)cdf.push(cdf[i-1]+(areaRate((i-1)*da)+areaRate(i*da))*da/2);
 const totalArea=cdf[steps],angle=(share:number)=>{if(share<=0)return 0;if(share>=1)return 2*Math.PI;const target=totalArea*share;let lo=0,hi=steps;while(hi-lo>1){const mid=(lo+hi)>>1;if(cdf[mid]<target)lo=mid;else hi=mid;}return da*(lo+(target-cdf[lo])/(cdf[hi]-cdf[lo]));};
 const N=r?r.nZ*r.nTheta:0;let cumulative=0;
 const sectors=weights.map((weight,i)=>{
  const sourceCell=hist&&r?(r.full?i:i<r.nTheta?i:2*r.nTheta-i-1):null,a=angle(cumulative/sum);cumulative+=weight;const b=angle(cumulative/sum);
  let fractions:(number|null)[]=blank(fluids.length);
  if(hist&&snapshot&&sourceCell!==null){const k=hist.cell*r!.nTheta+sourceCell,v=fluids.map((_,f)=>snapshot.frac[f*N+k]),s=v.reduce((a,b)=>a+b,0);if(s>0&&v.every(Number.isFinite))fractions=v.map(x=>x/s);}
  return {index:i,sourceCell,startAngle:a,endAngle:b,weight:weight/sum,areaMm2:Math.PI*(rh*rh-ro*ro)*weight/sum,gapMm:gap&&sourceCell!==null?gap[sourceCell]:null,fractions,color:mixtureColor(fractions,colors)};
 });
 const faces:SectionFace[]=[];
 const at=(a:number,radius:number,z:number):Point3=>[radius*Math.sin(a),radius*Math.cos(a)-offset,z];
 const tri=(a:Point3,b:Point3,c:Point3,color:string,space:SectionFace['space']='annulus')=>faces.push({points:[a,b,c],color,space});
 const quad=(a:Point3,b:Point3,c:Point3,e:Point3,color:string,space:SectionFace['space']='annulus')=>{tri(a,b,c,color,space);tri(a,c,e,color,space);};
 const z=thickness/2;
 for(const sector of sectors){const steps=Math.max(1,Math.ceil((sector.endAngle-sector.startAngle)/(Math.PI/180)));
  for(let k=0;k<steps;k++){const a=sector.startAngle+(sector.endAngle-sector.startAngle)*k/steps,b=sector.startAngle+(sector.endAngle-sector.startAngle)*(k+1)/steps,oa=outer(a),ob=outer(b),color=sector.color;
   quad(at(a,ro,z),at(a,oa,z),at(b,ob,z),at(b,ro,z),color);
   quad(at(a,oa,z),at(a,oa,-z),at(b,ob,-z),at(b,ob,z),darken(color,.72));
   quad(at(a,ro,-z),at(b,ro,-z),at(b,ob,-z),at(a,oa,-z),darken(color,.8));
  }
 }
 const pipeColor=mixtureColor(pipeFractions,colors);
 for(let i=0;i<180;i++){const a=i*2*Math.PI/180,b=(i+1)*2*Math.PI/180;
  quad(at(a,ri,z),at(a,ro,z),at(b,ro,z),at(b,ri,z),'#64748b','metal');
  quad(at(a,ri,z),at(b,ri,z),at(b,ri,-z),at(a,ri,-z),'#475569','metal');
  quad(at(a,ri,-z),at(b,ri,-z),at(b,ro,-z),at(a,ro,-z),'#53657c','metal');
  quad(at(a,ro,z),at(a,ro,-z),at(b,ro,-z),at(b,ro,z),'#475569','metal');
  tri([0,-offset,z],at(a,ri,z),at(b,ri,z),pipeColor,'pipe');
  tri([0,-offset,-z],at(b,ri,-z),at(a,ri,-z),darken(pipeColor,.8),'pipe');
 }
 const geometry={ro,ri,rh,offset,thickness,standoff:so,minGapMm:rh-ro-offset,maxGapMm:rh-ro+offset};
 const state={requestedMD:md,frame,timeS:point.timeS,annulusFrame:point.annulusFrame,annulusTimeS:snapshot?.t??null,annulusBounds:hist?[hist.topMD,hist.bottomMD,hist.md]:null,pipeBounds:p?[p.topMD,p.bottomMD,p.md]:null,fluids,colors,pipeFractions,annulusFractions,pipeStatus,annulusStatus,geometry,sectors,faces};
 return {...state,sourceKey:JSON.stringify([md,point,geometry,pipeFractions,annulusFractions,pipeStatus,annulusStatus,sectors.map(s=>[s.sourceCell,s.weight,s.fractions]),colors,fluids.map(f=>f.name)])};
}
export type DisplacementSection=Exclude<ReturnType<typeof displacementSection>,{error:string}>;
export function sectionState(d:SectionSource,selectedMD?:number,selectedFrame?:number){const frames=sectionTimeline(d);return displacementSection(d,observationDepthMD(d,selectedMD),selectedFrame??frames.length-1);}
