import {compileMixtures,labFluids,removalIssue,FLUID_LAB_NOTE,type LabFluid,type LabFluidsInput} from './fluid-interaction-lab';
import type {WellData} from './cementing-calculations';
import {getEffectiveTrajectory,interpolateTVD} from './cementing-calculations';
import type {DisplacementReportData} from './cementing-report-data';
import {normalizeDepthChartSettings,DEPTH_UNITS} from './depth-chart-settings';
import {reportSeriesPlot} from './report-series-plot';
export const REMOVAL_NOTE='Требуется измеренное критическое напряжение для данного бурового и промывки, состояния отложений, времени испытания и T/P. Доступное напряжение - давление/гравитационная составляющая щелевой модели: h·|∇p−ρg|/2; прямой вклад вращения не включён. Сопоставление только в чистой промывке на последнем решённом гидравлическом подшаге; время этого поля указано отдельно от кадра состава. Превышение порога не подтверждает время контакта или очистку. Требуемое напряжение не заменяется ДНС бурового.';
export type FluidLabReportInput={wellData:WellData} & (LabFluidsInput|{labRegistry:LabFluid[]});
export function fluidLabReport(input:FluidLabReportInput,d?:DisplacementReportData|null){
 const lab=input.wellData.fluidInteractionLab,fluids='labRegistry'in input?input.labRegistry:labFluids(input),compiled=compileMixtures(lab,fluids),issues=[...compiled.issues];
 const geometry=(w:WellData)=>JSON.stringify([w.casingDepthMD,w.wellDepthMD,w.wellDepthTVD,w.holeDiameter,w.casingOD,w.casingWall,w.prevCasingDepth,w.prevCasingID,w.cavernCoeff,w.cavernIntervals,w.trajectory,w.casingSections,w.standoffProfile,w.annularStandoffPct]);
 const fresh=!!d?.meta.sectionWell&&geometry(d.meta.sectionWell)===geometry(input.wellData)&&JSON.stringify(d.meta.sectionWell.fluidInteractionLab)===JSON.stringify(lab)&&JSON.stringify(d.meta.labFluids?.map(f=>f.key))===JSON.stringify(fluids.map(f=>f.key));
 const r=fresh?d?.result:null,frame=r?.snapshots.length?r.snapshots.length-1:null,snap=frame===null?null:r!.snapshots[frame],w=fresh?d!.meta.sectionWell!:input.wellData,traj=getEffectiveTrajectory(w);
 const settings=normalizeDepthChartSettings(input.wellData.depthChartSettings),k=DEPTH_UNITS[settings.depthUnit].k,axisLabel=settings.coordinate+', '+DEPTH_UNITS[settings.depthUnit].label;
 if(d&&!fresh)issues.push('Протоколы, составы или геометрия изменены после замещения. Профиль сдвига требует пересчёта.');
 if(lab?.removal.length&&!snap?.wallShearPa)issues.push('Нет сохранённого поля напряжения. Пересчитайте замещение.');
 const profiles=(lab?.removal??[]).map(test=>{
  const error=removalIssue(test,lab!,fluids),index=fluids.findIndex(f=>f.id===test.cleanerId),depths=[...new Set([0,w.casingDepthMD,...Array.from(r?.zCenters??[]),test.fromMD,test.toMD].filter((v):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=w.casingDepthMD))].sort((a,b)=>a-b),rows=depths.map(md=>{
   const dz=r&&r.nZ>1?r.zCenters[1]-r.zCenters[0]:0,top=r&&dz?r.zCenters[0]-dz/2:0,bottom=r&&dz?r.zCenters[r.nZ-1]+dz/2:0;
   const cell=r&&dz&&md>=top&&md<=bottom?Math.min(r.nZ-1,Math.floor((md-top)/dz)):null;
   const requiredPa=!error&&md>=test.fromMD!&&md<=test.toMD!?test.criticalPa:null;let min=Infinity,max=-Infinity,total=0,available=0;
   if(requiredPa!==null&&cell!==null&&r&&snap?.wallShearPa&&snap.wallShearFluid)for(let i=0;i<r.nTheta;i++){const n=cell*r.nTheta+i,weight=r.cellVolumesM3?.[n]??r.gap[n];total+=weight;if(snap.wallShearFluid[n]===index+1&&Number.isFinite(snap.wallShearPa[n])){min=Math.min(min,snap.wallShearPa[n]);max=Math.max(max,snap.wallShearPa[n]);available+=weight;}}
   return {md,sourceCell:cell,tvd:interpolateTVD(md,traj),depth:(settings.coordinate==='TVD'?interpolateTVD(md,traj):md)*k,requiredPa,availableMinPa:min===Infinity?null:min,availableMaxPa:max===-Infinity?null:max,pureCoveragePct:total?100*available/total:0};
  });if(error)issues.push(test.id+': '+error);return {test,error,rows};
 });
 const coverage=r?.mixtureCoverage??null;
 const sourceKey=JSON.stringify([lab,fluids.map(f=>f.key),settings,frame,snap?.t,snap?.wallShearTimeS,profiles,coverage]);
 return {lab,fluids,compiled,issues,profiles,coverage,frame,timeS:snap&&d?snap.t+d.meta.annulusStartS:null,shearTimeS:snap?.wallShearTimeS===undefined?null:snap.wallShearTimeS+(d?.meta.annulusStartS??0),fresh,axisLabel,sourceKey};
}
export function fluidLabFigures(input:FluidLabReportInput,d?:DisplacementReportData|null){
 const data=fluidLabReport(input,d),figures=[];
 const groups=new Map<string,typeof data.compiled.points>();for(const p of data.compiled.points){const ids=p.fractions.map((v,i)=>v>0?i:-1).filter(i=>i>=0);if(ids.length!==2)continue;const key=ids.join(',');groups.set(key,[...(groups.get(key)??[]),p]);}
 for(const[key,points]of groups){if(points.length<2)continue;const [a,b]=key.split(',').map(Number),sorted=[...points].sort((p,q)=>p.fractions[b]-q.fractions[b]),x=sorted.map(p=>p.fractions[b]*100);for(const metric of ['pv','yp']as const){const plot=reportSeriesPlot('Смеси: '+data.fluids[a].name+' / '+data.fluids[b].name+' - '+(metric==='pv'?'PV':'ДНС'),'fluidLab',x,'Доля '+data.fluids[b].name+', об.%',metric==='pv'?'PV, сПз':'ДНС, Па',[{name:'Измерения и выбранная линейная интерполяция',color:'#4f46e5',values:sorted.map(p=>p[metric]*(metric==='pv'?1000:1))}],{plotId:'fluid-lab-'+key+'-'+metric,note:FLUID_LAB_NOTE});figures.push({...plot,sourceKey:data.sourceKey});}}
 for(const p of data.profiles){if(p.error||!p.rows.some(r=>r.requiredPa!==null))continue;const plot=reportSeriesPlot('Вымываемость: '+p.test.id,'fluidLab',p.rows.map(r=>r.depth),data.axisLabel,'Напряжение, Па',[{name:'Требуется по протоколу',color:'#dc2626',values:p.rows.map(r=>r.requiredPa)},{name:'Доступно min, чистая промывка',color:'#2563eb',values:p.rows.map(r=>r.availableMinPa)},{name:'Доступно max, чистая промывка',color:'#059669',values:p.rows.map(r=>r.availableMaxPa)}],{plotId:'removal-'+p.test.id,note:REMOVAL_NOTE});figures.push({...plot,sourceKey:data.sourceKey});}
 return figures;
}
