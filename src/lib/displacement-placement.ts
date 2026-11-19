import {getEffectiveTrajectory,interpolateTVD,getCasingIDAtDepth} from './cementing-calculations';
import {boreDiameterAtDepth} from './well-geometry';
import {pathPoints} from './displacement-geometry';
import {pipeBalance,pipeDepthComposition} from './displacement-pipe';
import {displacementDepthHistory} from './displacement-depth-history';
import {sectionTimeline,type SectionSource} from './displacement-section';
import {mixtureColor} from './displacement-colors';
export const PLACEMENT_NOTE='Общая траектория трубы и затрубья. Цвет каждой осевой ячейки кодирует её средние объёмные доли, как в числовом сечении; он не показывает радиальное расслоение. Диаметры увеличены для наглядности. Угловое распределение смотрите в сечении F08. Пустой состав означает отсутствие расчёта, а не отсутствие жидкости. Объёмы затрубья ниже - инвентарь сохранённого поля, не независимый баланс решателя.';
export function displacementPlacement(d:SectionSource,frame=sectionTimeline(d).length-1){
 const w=d.meta.sectionWell,timeline=sectionTimeline(d),point=timeline[frame];
 if(!w)return {error:'Геометрия этого расчёта не сохранена. Пересчитайте вытеснение.'} as const;
 if(!point||!Number.isInteger(frame))return {error:'Нет выбранного временного кадра.'} as const;
 const r=d.result,p=d.pipe,fluids=r?.fluids??p?.fluids??[],snap=r?.snapshots[point.annulusFrame],dz=r&&r.nZ>1?r.zCenters[1]-r.zCenters[0]:0;
 if(!Number.isFinite(w.casingDepthMD)||w.casingDepthMD<=0)return {error:'Недопустимая глубина колонны.'} as const;
 const trajectory=getEffectiveTrajectory(w),bounds=[0,w.casingDepthMD,...(p?.segments.flatMap(s=>[s.topMD,s.bottomMD])??[]),...trajectory.map(t=>t.md),...(r&&dz>0?Array.from({length:r.nZ+1},(_,j)=>r.zCenters[0]-dz/2+j*dz):[])];
 const depths=[...new Set(bounds.filter(md=>Number.isFinite(md)&&md>=0&&md<=w.casingDepthMD))].sort((a,b)=>a-b);
 const raw=pathPoints(trajectory,depths),positions=raw.map((v,i)=>[v.x,-interpolateTVD(depths[i],trajectory),v.z] as [number,number,number]);
 if(p&&r&&(p.fluids.length!==r.fluids.length||p.fluids.some((f,i)=>f.name!==r.fluids[i].name||f.kind!==r.fluids[i].kind||f.density!==r.fluids[i].density)))return {error:'Составы трубы и затрубья относятся к разным данным. Пересчитайте модель.'} as const;
 const unknown=()=>(fluids.map(()=>null) as (number|null)[]);
 const annCache=new Map<number,ReturnType<typeof displacementDepthHistory>>();
 const rows=depths.slice(0,-1).map((topMD,j)=>{
  const bottomMD=depths[j+1],md=(topMD+bottomMD)/2,pipe=p?pipeDepthComposition(p,md,point.timeS):null;
  let hist:ReturnType<typeof displacementDepthHistory>=null;
  if(r&&snap&&dz>0){const cell=Math.floor((md-(r.zCenters[0]-dz/2))/dz);if(cell>=0&&cell<r.nZ){if(!annCache.has(cell))annCache.set(cell,displacementDepthHistory({...r,snapshots:[snap]},md));hist=annCache.get(cell)!;}}
  const pipeFractions=pipe?.fractions??unknown(),annulusFractions=hist?.rows[0]?.fractions??unknown();
  const ro=w.casingOD/2000,pipeArea=pipe&&p?(p.segments[pipe.cell].endM3-p.segments[pipe.cell].startM3)/(pipe.bottomMD-pipe.topMD):null;
  const ri=pipeArea?Math.sqrt(pipeArea/Math.PI):getCasingIDAtDepth(md,w.casingOD,w.casingWall,w.casingSections)/2000;
  const meanGap=hist&&r?Array.from({length:r.nTheta},(_,i)=>r.gap[hist!.cell*r.nTheta+i]).reduce((a,b)=>a+b,0)/r.nTheta:null;
  const rh=meanGap===null?Math.max(ro+.003,boreDiameterAtDepth(w,md)/2000):ro+meanGap;
  const annArea=hist&&r?.cellVolumesM3 ? Array.from({length:r.nTheta},(_,i)=>r.cellVolumesM3![hist!.cell*r.nTheta+i]).reduce((a,b)=>a+b,0)/dz : meanGap===null?null:Math.PI*(rh*rh-ro*ro);
  return {topMD,bottomMD,md,tvd:interpolateTVD(md,trajectory),pipeCell:pipe?.cell??null,annulusCell:hist?.cell??null,pipeFractions,annulusFractions,pipeColor:mixtureColor(pipeFractions,d.meta.colors),annulusColor:mixtureColor(annulusFractions,d.meta.colors),ro,ri,rh,pipeVolumeM3:pipeArea===null?null:pipeArea*(bottomMD-topMD),annulusVolumeM3:annArea===null?null:annArea*(bottomMD-topMD)};
 });
 const pipeLedger=p?pipeBalance(p,point.timeS):null;
 const inventory=(space:'pipe'|'annulus')=>{
  if(space==='pipe'?!p:!r)return null;
  if(!rows.some(row=>space==='pipe'?row.pipeVolumeM3!==null:row.annulusVolumeM3!==null))return null;
  const out=fluids.map(()=>0);
  for(const row of rows){const v=space==='pipe'?row.pipeVolumeM3:row.annulusVolumeM3,fs=space==='pipe'?row.pipeFractions:row.annulusFractions;if(v===null)continue;if(fs.some(x=>x===null||!Number.isFinite(x)))return null;fs.forEach((f,i)=>out[i]+=v*f!);}
  return out;
 };
 const pipeInventory=inventory('pipe'),annulusInventory=inventory('annulus');
 const completed=r?.summary?.timing?.complete??true;
 const state={frame,timeS:point.timeS,annulusFrame:point.annulusFrame,annulusTimeS:snap?.t??null,isLast:frame===timeline.length-1,completed,depths,positions,rows,fluids,colors:d.meta.colors,pipeLedger,pipeInventory,annulusInventory,pipeEnabled:!!p,annulusEnabled:!!r,trajectory};
 return {...state,sourceKey:JSON.stringify([frame,point,completed,depths,positions,rows,d.meta.colors,fluids.map(f=>f.name),pipeLedger])};
}
export type DisplacementPlacement=Exclude<ReturnType<typeof displacementPlacement>,{error:string}>;
