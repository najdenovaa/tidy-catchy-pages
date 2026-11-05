import type { CentralizerSpec } from './centralization-calculations';
/** Explicit engineering assumptions, never written back into catalogue/passport values. */
export function centralizerCalibration(spec:CentralizerSpec) {
 const p=spec.passport;
 const force=p?.restoringForceKgf ? p.restoringForceKgf*.00980665 : spec.restoringForce>0 ? spec.restoringForce : (p?.estimatedRestoringForceKN ?? 5);
 return {forceKN:force,standoff:p?.restoringStandoff ?? 67,assumedForce:!p?.restoringForceKgf&&!(spec.restoringForce>0),assumedStandoff:!p?.restoringStandoff};
}
/** Linear individual springs, unilateral wall contact. Calibrated by the net radial force of the entire device. */
export function centralizerRadialForce(spec:CentralizerSpec,casingOD:number,bore:number,offsetMM:number) {
 const p=spec.passport,clearance=(bore-casingOD)/2;
 if(!p?.outerDiameter||clearance<=0)return 0;
 const calibration=centralizerCalibration(spec),R=bore/2,free=p.outerDiameter/2;
 const count=Math.max(2,Math.round(spec.bladesCount));
 const sum=(d:number)=>{
  let f=0;
  for(let i=0;i<count;i++){const a=i*Math.PI*2/count,c=Math.cos(a),s=Math.sin(a);const wall=-d*c+Math.sqrt(Math.max(0,R*R-d*d*s*s));f+=Math.max(0,free-wall)*c;}
  return Math.max(0,f);
 };
 const reference=sum(clearance*(1-calibration.standoff/100));
 if(reference<=1e-8)return 0;
 return calibration.forceKN*sum(Math.max(0,Math.min(clearance,offsetMM)))/reference;
}
export function centralizerDeflection(spec:CentralizerSpec,casingOD:number,bore:number,lateralNPerM:number,spanM:number,EI:number) {
 const gap=(bore-casingOD)/2,loadKN=Math.max(0,lateralNPerM*spanM/1000);
 if(gap<=0||spanM<=0||EI<=0)return {supportMM:0,sagMM:0,loadKN,exceeded:false};
 let low=0,high=gap;
 for(let i=0;i<45;i++){const mid=(low+high)/2;if(centralizerRadialForce(spec,casingOD,bore,mid)<loadKN)low=mid;else high=mid;}
 const supportMM=(low+high)/2;
 const sagMM=5*Math.max(0,lateralNPerM)*spanM**4/(384*EI)*1000;
 return {supportMM,sagMM,loadKN,exceeded:centralizerRadialForce(spec,casingOD,bore,gap)<loadKN};
}

export function centralizerModelNotes(spec:CentralizerSpec):string[] {
 if(!spec.passport||spec.type!=='spring')return [];
 const c=centralizerCalibration(spec),notes:string[]=[];
 if(c.assumedStandoff)notes.push('Степень центрирования испытания не указана: для оценочной модели принято 67%.');
 if(c.assumedForce)notes.push(`Усилие не указано: принято модельное ${c.forceKN.toFixed(2)} кН, это допущение программы, не характеристика изделия.`);
 if(spec.passport.forceLimitAmbiguous)notes.push('Предел усилия в источнике неоднозначен; используется табличное значение для оценочного расчёта.');
 return notes;
}
