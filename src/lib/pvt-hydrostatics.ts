import {createAnnularGeometry} from './well-geometry';
import {getEffectiveTrajectory,totalPipeVolumeForRange,type WellData,type PressurePoint} from './cementing-calculations';
import type {ProcessFluid} from './cementing-process';
import {normalizeStopStorage} from './stop-storage';
export interface PvtCell {fluidId:string;fluidName:string;topMD:number;bottomMD:number;topPressureMPa:number;bottomPressureMPa:number;topDensityKgM3:number;bottomDensityKgM3:number;volumeM3:number;massKg:number;referenceVolumeM3:number}
export interface PvtFrame {timeMin:number;annularBottomMPa:number;pipeBottomMPa:number;constantAnnularBottomMPa:number;differenceMPa:number;annularMassKg:number;pipeMassKg:number;annularReferenceVolumeM3:number;pipeReferenceVolumeM3:number}
export interface PvtHydrostaticResult {model:'fixed-boundary-pvt-hydrostatics-v1';status:'ready'|'unavailable';issues:string[];properties:{fluidId:string;name:string;densityKgM3:number;bulkModulusMPa:number}[];referencePressureMPa:number;surfaceBackpressureMPa:number;source:string;curve:PvtFrame[];finalPipe:PvtCell[];finalAnnulus:PvtCell[];maxDensityChangePct:number;maxPressureDifferenceMPa:number;limitations:string[]}
/** Exact isothermal constant-K hydrostatics on a segment with linear TVD(MD). */
export function liquidHydrostaticStep(rhoRef:number,kMPa:number,pRef:number,pTop:number,deltaTVD:number,volumeM3:number){
 if(![rhoRef,kMPa,pRef,pTop,deltaTVD,volumeM3].every(Number.isFinite)||rhoRef<=0||kMPa<=0||volumeM3<0)throw new Error('Недопустимые свойства PVT-сегмента.');
 const topDensityKgM3=rhoRef*Math.exp((pTop-pRef)/kMPa),x=topDensityKgM3*9.81*deltaTVD/(1e6*kMPa);
 if(!(x<1))throw new Error('Сингулярность гидростатики: заданный K слишком мал для высоты столба.');
 const rise=-kMPa*Math.log1p(-x),bottomPressureMPa=pTop+rise,bottomDensityKgM3=topDensityKgM3/(1-x);
 if(Math.min(pTop,bottomPressureMPa)<-1e-8)throw new Error('Отрицательное избыточное давление вне принятого диапазона модели.');
 if(Math.max(Math.abs(pTop-pRef),Math.abs(bottomPressureMPa-pRef))/kMPa>.1)throw new Error('Диапазон постоянного K превышен: |P-Pref|/K > 10%.');
 const meanDensity=Math.abs(x)<1e-7?topDensityKgM3*(1+x/2+x*x/3+x*x*x/4):rise*1e6/(9.81*deltaTVD);
 const massKg=meanDensity*volumeM3;
 return {topPressureMPa:pTop,bottomPressureMPa,topDensityKgM3,bottomDensityKgM3,massKg,referenceVolumeM3:massKg/rhoRef};
}
/** Counterfactual hydrostatics at prescribed liquid interfaces; never alters pumping/returns. */
export function evaluatePvtHydrostatics(w:WellData,points:PressurePoint[],fluids:ProcessFluid[]):PvtHydrostaticResult|undefined{
 const s=normalizeStopStorage(w.stopStorage);if(!s?.hydrostaticsEnabled)return undefined;
 const r:PvtHydrostaticResult={model:'fixed-boundary-pvt-hydrostatics-v1',status:'unavailable',issues:[],properties:[],referencePressureMPa:s.referencePressureMPa??0,surfaceBackpressureMPa:s.surfaceBackpressureMPa??0,source:s.source,curve:[],finalPipe:[],finalAnnulus:[],maxDensityChangePct:0,maxPressureDifferenceMPa:0,limitations:[
  'Сравнительная изотермическая гидростатика при фиксированных границах жидкостей из основной модели. K общий для категории, плотности из программы относятся к заданному опорному давлению.',
  'Для каждого кадра заново рассчитывается равновесный столб. Масса, необходимая для его заполнения, не является сохранённым инвентарём закачки. Эквивалентный опорный объём не является дополнительной подачей.',
  'Основные давления с трением, возвраты, положение жидкостей, Стоп и ограничения основной модели не изменяются. Связанный сжимаемый перенос, газ, пена, тепловые эффекты и деформация колонны здесь не решаются.',
  'Давления избыточные относительно атмосферы; опорное давление и поверхностное противодавление задаются в той же шкале. В пустой части трубы принято атмосферное давление над свободной поверхностью. Капиллярные эффекты не учитываются.'
 ]};
 if(r.referencePressureMPa<0||r.surfaceBackpressureMPa<0){r.issues.push('Опорное давление и противодавление должны быть неотрицательными.');return r;}
 if(!points.length){r.issues.push('Нет кадров расчёта.');return r;}
 const lookup=new Map(fluids.map(f=>[f.id,f])),mud=fluids.find(f=>f.kind==='mud');if(mud)lookup.set('mud:initial',mud);
 const trajectory=[...getEffectiveTrajectory(w)].sort((a,b)=>a.md-b.md),geometry=createAnnularGeometry(w,w.casingDepthMD);
 const tvdAt=(md:number)=>{
  if(!trajectory.length)return md;
  if(trajectory.length===1)return trajectory[0].md===0&&trajectory[0].tvd===0?md:trajectory[0].tvd;
  if(md<=trajectory[0].md)return trajectory[0].tvd;if(md>=trajectory.at(-1)!.md)return trajectory.at(-1)!.tvd;
  let lo=0,hi=trajectory.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(trajectory[mid].md<=md)lo=mid;else hi=mid;}
  const a=trajectory[lo],b=trajectory[hi];return a.tvd+(md-a.md)/(b.md-a.md)*(b.tvd-a.tvd);
 };
 const sorted=(a:number[])=>[...new Set(a.filter(x=>x>=0&&x<=w.casingDepthMD))].sort((a,b)=>a-b);
 const pipeCuts=sorted([0,w.casingDepthMD,...trajectory.map(t=>t.md),...(w.casingSections??[]).flatMap(s=>[s.fromMD,s.toMD])]);
 const annCuts=sorted([0,w.casingDepthMD,...trajectory.map(t=>t.md),...geometry.cells.flatMap(c=>[c.topMD,c.bottomMD])]);
 const properties=new Map<string,PvtHydrostaticResult['properties'][number]>();
 let evaluations=0;
 const solve=(batches:NonNullable<PressurePoint['transportColumns']>['pipe'],annular:boolean)=>{
  const cells:PvtCell[]=[],ordered=[...batches].sort((a,b)=>a.topMD-b.topMD),cuts=annular?annCuts:pipeCuts;
  let pressure=r.surfaceBackpressureMPa,constant=pressure,lastBottom=0;
  for(const b of ordered){
   if(!(b.botMD>b.topMD)||b.topMD<lastBottom-1e-5||b.topMD>lastBottom+1e-5)throw new Error('Неполное или перекрывающееся распределение жидкостей.');lastBottom=b.botMD;
   if(b.fluidType==='void'){if(annular||b.topMD>1e-7||r.surfaceBackpressureMPa>0)throw new Error('Заданная пустота несовместима с граничным давлением.');pressure=0;constant=0;continue;}
   const f=lookup.get(b.fluidId),k=s.bulkModuliMPa[b.fluidType];if(!f||!(k>0))throw new Error('Укажите положительный K для '+(f?.name??b.fluidId)+'.');
   properties.set(b.fluidId,{fluidId:b.fluidId,name:f.name,densityKgM3:f.densityKgM3,bulkModulusMPa:k});
   const split=[b.topMD,...cuts.filter(md=>md>b.topMD+1e-8&&md<b.botMD-1e-8),b.botMD];
   for(let i=1;i<split.length;i++){
    if(++evaluations>2000000)throw new Error('Превышен лимит 2 млн PVT-сегментов; уменьшите число кадров или разрешение импортированной геометрии.');
    const topMD=split[i-1],bottomMD=split[i],dh=tvdAt(bottomMD)-tvdAt(topMD);
    const volumeM3=annular?geometry.volume(topMD,bottomMD):totalPipeVolumeForRange(topMD,bottomMD,w.casingOD,w.casingWall,w.casingSections);
    if(!(volumeM3>0))throw new Error('Неположительная вместимость PVT-сегмента.');
    const step=liquidHydrostaticStep(f.densityKgM3,k,r.referencePressureMPa,pressure,dh,volumeM3);
    r.maxDensityChangePct=Math.max(r.maxDensityChangePct,Math.abs(step.topDensityKgM3/f.densityKgM3-1)*100,Math.abs(step.bottomDensityKgM3/f.densityKgM3-1)*100);
    cells.push({fluidId:b.fluidId,fluidName:f.name,topMD,bottomMD,volumeM3,...step});pressure=step.bottomPressureMPa;constant+=f.densityKgM3*9.81*dh/1e6;
   }
  }
  if(Math.abs(lastBottom-w.casingDepthMD)>1e-5)throw new Error('Столб жидкостей не доходит до башмака.');
  return {cells,pressure,constant,mass:cells.reduce((n,c)=>n+c.massKg,0),reference:cells.reduce((n,c)=>n+c.referenceVolumeM3,0)};
 };
 for(const p of points){
  try{
   if(!p.transportColumns)throw new Error('Нет распределения жидкостей. Пересчитайте программу.');
   const ann=solve(p.transportColumns.annulus,true),pipe=solve(p.transportColumns.pipe,false);
   r.curve.push({timeMin:p.time,annularBottomMPa:ann.pressure,pipeBottomMPa:pipe.pressure,constantAnnularBottomMPa:ann.constant,differenceMPa:ann.pressure-ann.constant,annularMassKg:ann.mass,pipeMassKg:pipe.mass,annularReferenceVolumeM3:ann.reference,pipeReferenceVolumeM3:pipe.reference});
   r.maxPressureDifferenceMPa=Math.max(r.maxPressureDifferenceMPa,Math.abs(ann.pressure-ann.constant));r.finalPipe=pipe.cells;r.finalAnnulus=ann.cells;
  }catch(e){r.issues.push('Кадр '+p.time.toFixed(2)+' мин: '+(e instanceof Error?e.message:String(e)));r.curve=[];r.finalPipe=[];r.finalAnnulus=[];return r;}
 }
 r.properties=[...properties.values()];r.status='ready';return r;
}
export function pvtHydrostaticsCsv(r:PvtHydrostaticResult){return 'time_min;ann_pvt_mpa;ann_fixed_mpa;difference_mpa;pipe_pvt_mpa;ann_equilibrium_mass_kg;pipe_equilibrium_mass_kg;ann_reference_m3;pipe_reference_m3\n'+r.curve.map(p=>[p.timeMin,p.annularBottomMPa,p.constantAnnularBottomMPa,p.differenceMPa,p.pipeBottomMPa,p.annularMassKg,p.pipeMassKg,p.annularReferenceVolumeM3,p.pipeReferenceVolumeM3].join(';')).join('\n');}

export function pvtProfileCsv(r:PvtHydrostaticResult){
 const q=(v:unknown)=>'"'+String(v??'').replace(/"/g,'""')+'"',props=new Map(r.properties.map(p=>[p.fluidId,p]));
 return 'leg;fluid;top_md_m;bottom_md_m;top_pressure_mpa;bottom_pressure_mpa;top_density_kg_m3;bottom_density_kg_m3;volume_m3;equilibrium_mass_kg;reference_volume_m3;reference_density_kg_m3;bulk_modulus_mpa;reference_pressure_mpa;source\n'+[...r.finalPipe.map(c=>({...c,leg:'pipe'})),...r.finalAnnulus.map(c=>({...c,leg:'annulus'}))].map(c=>[c.leg,c.fluidName,c.topMD,c.bottomMD,c.topPressureMPa,c.bottomPressureMPa,c.topDensityKgM3,c.bottomDensityKgM3,c.volumeM3,c.massKg,c.referenceVolumeM3,props.get(c.fluidId)?.densityKgM3,props.get(c.fluidId)?.bulkModulusMPa,r.referencePressureMPa,r.source].map(q).join(';')).join('\n');
}
