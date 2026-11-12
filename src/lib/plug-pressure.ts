import {advanceAle, type AleState} from './ale-transport';
import type {MovingPlugResult, MovingPlugCase} from './moving-plug';

export interface HydraulicFrame {
  timeSec:number; xM:number; facesM:number[]; pressuresMPa:number[];
  massesKg:number[]; fractions:number[][]; relativeFluxKgS:number[];
  laboratoryVelocityMps:number[]; inletMPa:number; backWallMPa:number;
  aheadWallMPa:number; movingForceMismatchMPa:number|null; maxReynolds:number;
}
export interface PlugHydraulics {
  model:'prescribed-piston-pressure-v1'; status:'complete'|'stopped'; reason:string;
  viscosityMpas:number; cellsPerChamber:number; switchSec:number; frames:HydraulicFrame[];
  initialKg:number[]; injectedKg:number[]; returnedKg:number[]; retainedKg:number[];
  acceptedSteps:number; maxMassResidualKg:number; maxComponentResidualKg:number;
  maxGeometricResidualM3:number; maxReynolds:number;
}
const total=(a:number[])=>a.reduce((s,x)=>s+x,0);
/** Hagen-Poiseuille resistance in MPa/(m³/s), Newtonian fully developed laminar flow. */
export function laminarResistance(lengthM:number,diameterMm:number,viscosityMpas:number){
  if(![lengthM,diameterMm,viscosityMpas].every(Number.isFinite)||lengthM<=0||diameterMm<=0||viscosityMpas<=0)throw new Error('Нужны положительные длина, диаметр и вязкость.');
  const r=128*(viscosityMpas/1000)*lengthM/(Math.PI*(diameterMm/1000)**4)/1e6;
  if(!(r>0&&Number.isFinite(r)))throw new Error('Невыразимое вязкое сопротивление.');
  return r;
}
function linear(lower:number[],diag:number[],upper:number[],rhs:number[]){
  const d=[...diag],b=[...rhs],x=d.map(()=>0);
  for(let i=1;i<d.length;i++){if(!(d[i-1]>0))throw new Error('Вырожденная матрица давления.');const w=lower[i]/d[i-1];d[i]-=w*upper[i-1];b[i]-=w*b[i-1];}
  if(!(d.at(-1)!>0))throw new Error('Вырожденная матрица давления.');
  x[x.length-1]=b.at(-1)!/d.at(-1)!;for(let i=x.length-2;i>=0;i--)x[i]=(b[i]-upper[i]*x[i+1])/d[i];return x;
}
function density(ref:number,k:number,p:number){
  if(!Number.isFinite(p)||p<0||p/k>.1)throw new Error('Пространственная EOS: нужны P ≥ 0 и P/K ≤ 10%.');
  return ref*Math.exp(p/k);
}
export function pistonFaces(p:MovingPlugCase,n:number,x:number){
  return [...Array.from({length:n+1},(_,i)=>x*(i/n)),...Array.from({length:n},(_,i)=>i===n-1?p.totalLengthM:x+(p.totalLengthM-x)*((i+1)/n))];
}
/** Independent cell EOS + continuity + quasi-steady viscous face momentum.
 * Piston trajectory is prescribed; this does NOT solve its force balance.
 */
export function pressureAleStep(p:MovingPlugCase,n:number,mu:number,old:AleState,oldPressure:number[],faces:number[],dt:number,source:number,injection:number[]){
  const nc=2*n,a=Math.PI*(p.diameterMm/1000)**2/4;
  if(!Number.isInteger(n)||n<1||n>60||oldPressure.length!==nc||old.massKg.length!==nc||old.facesM.length!==nc+1||faces.length!==nc+1||![dt,source,mu].every(Number.isFinite)||dt<=0||source<0||mu<=0)throw new Error('Недопустимые параметры пространственного шага.');
  if(![p.totalLengthM,p.diameterMm,p.rhoBackKgM3,p.rhoAheadKgM3,p.bulkBackMPa,p.bulkAheadMPa].every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(p.outletMPa)||p.outletMPa<0||!Number.isFinite(p.outletResistanceMPaPerM3s)||p.outletResistanceMPaPerM3s<0||faces[0]!==0||old.facesM[0]!==0||faces[nc]!==p.totalLengthM||old.facesM[nc]!==p.totalLengthM)throw new Error('Недопустимая EOS или неподвижные внешние границы стенда.');
  for(let i=0;i<nc;i++){
    const expected=a*(old.facesM[i+1]-old.facesM[i])*density(i<n?p.rhoBackKgM3:p.rhoAheadKgM3,i<n?p.bulkBackMPa:p.bulkAheadMPa,oldPressure[i]);
    if(!(expected>0&&Number.isFinite(expected)&&old.massKg[i]>0&&Number.isFinite(old.massKg[i]))||Math.abs(expected-old.massKg[i])>1e-8*Math.max(1,expected))throw new Error('Исходная масса ячейки не согласована с EOS.');
  }
  if(source*(p.diameterMm/1000)/(a*(mu/1000))>2000)throw new Error('Re > 2000: ламинарное сопротивление стенда неприменимо; нужен другой закон потерь.');
  const volume=faces.slice(1).map((x,i)=>a*(x-faces[i])),center=volume.map((_,i)=>(faces[i]+faces[i+1])/2),w=faces.map((x,i)=>(x-old.facesM[i])/dt),bulk=volume.map((_,i)=>i<n?p.bulkBackMPa:p.bulkAheadMPa),ref=volume.map((_,i)=>i<n?p.rhoBackKgM3:p.rhoAheadKgM3);
  if(volume.some(x=>!Number.isFinite(x)||x<=0)||w.some(x=>!Number.isFinite(x)))throw new Error('Вырожденная движущаяся сетка давления.');
  const resist=faces.map((_,i)=>i===0||i===n?0:laminarResistance(i===nc?faces[nc]-center[nc-1]:center[i]-center[i-1],p.diameterMm,mu)+(i===nc?p.outletResistanceMPaPerM3s:0));
  const evaluate=(pressure:number[])=>{
    const rho=pressure.map((v,i)=>density(ref[i],bulk[i],v)),mass=rho.map((v,i)=>v*volume[i]),flux=Array(nc+1).fill(0),qlab=Array(nc+1).fill(0),dl=Array(nc+1).fill(0),dr=Array(nc+1).fill(0);
    flux[0]=source;qlab[0]=source/rho[0];qlab[n]=a*w[n];
    for(let i=1;i<nc;i++)if(i!==n){
      qlab[i]=(pressure[i-1]-pressure[i])/resist[i];const rel=qlab[i]-a*w[i],up=rel>=0?i-1:i;
      flux[i]=rho[up]*rel;dl[i]=rho[up]/resist[i]+(up===i-1?flux[i]/bulk[up]:0);dr[i]=-rho[up]/resist[i]+(up===i?flux[i]/bulk[up]:0);
    }
    // Explicit ideal non-return outlet; no unspecified external inflow.
    qlab[nc]=Math.max(0,(pressure[nc-1]-p.outletMPa)/resist[nc]);flux[nc]=rho[nc-1]*qlab[nc];
    dl[nc]=pressure[nc-1]>=p.outletMPa?rho[nc-1]/resist[nc]+flux[nc]/bulk[nc-1]:0;
    const residual=mass.map((m,i)=>m-old.massKg[i]+dt*(flux[i+1]-flux[i])),norm=Math.max(...residual.map((v,i)=>Math.abs(v)/Math.max(1,old.massKg[i])));
    return {rho,mass,flux,qlab,dl,dr,residual,norm};
  };
  let pressure=[...oldPressure],e=evaluate(pressure),iterations=0;
  for(;e.norm>1e-10&&iterations<60;iterations++){
    const lo=volume.map((_,i)=>i?-dt*e.dl[i]:0),hi=volume.map((_,i)=>i<nc-1?dt*e.dr[i+1]:0),diag=e.mass.map((m,i)=>m/bulk[i]+dt*(e.dl[i+1]-e.dr[i]));
    const delta=linear(lo,diag,hi,e.residual.map(v=>-v));let accepted=false;
    for(let line=0;line<24;line++)try{
      const scale=2**(-line),candidate=pressure.map((v,i)=>v+scale*delta[i]),trial=evaluate(candidate);
      if(trial.norm<e.norm*(1-1e-7*scale)||trial.norm<=1e-10){pressure=candidate;e=trial;accepted=true;break;}
    }catch{/* reject inadmissible trial without committing state */}
    if(!accepted)throw new Error('Пространственное давление: не найден допустимый шаг Ньютона; уменьшите шаг или проверьте траекторию.');
  }
  if(e.norm>1e-10)throw new Error('Пространственное давление не сошлось.');
  const velocity=e.qlab.map(q=>q/a),re=velocity.map((u,i)=>Math.abs(u)*(p.diameterMm/1000)*(i===0?e.rho[0]:i===nc?e.rho[nc-1]:Math.max(e.rho[i-1],e.rho[i]))/(mu/1000)),maxReynolds=Math.max(...re);
  if(maxReynolds>2000)throw new Error('Re > 2000: ламинарное сопротивление стенда неприменимо; нужен другой закон потерь.');
  const inletMPa=pressure[0]+laminarResistance(center[0],p.diameterMm,mu)*e.qlab[0],backWallMPa=pressure[n-1]-laminarResistance(faces[n]-center[n-1],p.diameterMm,mu)*e.qlab[n],aheadWallMPa=pressure[n]+laminarResistance(center[n]-faces[n],p.diameterMm,mu)*e.qlab[n];
  density(p.rhoBackKgM3,p.bulkBackMPa,inletMPa);density(p.rhoBackKgM3,p.bulkBackMPa,backWallMPa);density(p.rhoAheadKgM3,p.bulkAheadMPa,aheadWallMPa);
  const transport=advanceAle(old,faces,e.mass,e.flux,dt,a,injection,undefined,n);
  return {...transport,pressures:pressure,relativeFluxKgS:e.flux,laboratoryVelocityMps:velocity,inletMPa,backWallMPa,aheadWallMPa,maxReynolds,maxContinuityResidualKg:Math.max(...e.residual.map(Math.abs)),iterations};
}
export function evaluatePlugPressure(base:MovingPlugResult,n:number,mu:number,switchSec:number):PlugHydraulics{
  const p=base.input,r:PlugHydraulics={model:'prescribed-piston-pressure-v1',status:'stopped',reason:'',viscosityMpas:mu,cellsPerChamber:n,switchSec,frames:[],initialKg:[0,0,0],injectedKg:[0,0,0],returnedKg:[0,0,0],retainedKg:[0,0,0],acceptedSteps:0,maxMassResidualKg:0,maxComponentResidualKg:0,maxGeometricResidualM3:0,maxReynolds:0};
  let last:HydraulicFrame|undefined;
  try{
    if(!Number.isInteger(n)||n<1||n>60||!Number.isFinite(mu)||mu<=0||!Number.isFinite(switchSec)||switchSec<0||switchSec>p.durationSec||!base.samples.length)throw new Error('Нужны 1-60 ячеек, положительная вязкость и корректный момент метки.');
    const first=base.samples[0],a=Math.PI*(p.diameterMm/1000)**2/4,faces=pistonFaces(p,n,first.xM);
    let pressure=Array(2*n).fill(p.outletMPa),state:AleState={facesM:faces,massKg:faces.slice(1).map((x,i)=>a*(x-faces[i])*density(i<n?p.rhoBackKgM3:p.rhoAheadKgM3,i<n?p.bulkBackMPa:p.bulkAheadMPa,p.outletMPa)),fractions:Array.from({length:2*n},(_,i)=>i<n?[1,0,0]:[0,0,1])};
    advanceAle(state,faces,state.massKg,Array(2*n+1).fill(0),1,a,[1,0,0],undefined,n);
    r.initialKg=[total(state.massKg.slice(0,n)),0,total(state.massKg.slice(n))];r.retainedKg=[...r.initialKg];
    last={timeSec:0,xM:first.xM,facesM:faces,pressuresMPa:pressure,massesKg:state.massKg,fractions:state.fractions,relativeFluxKgS:Array(2*n+1).fill(0),laboratoryVelocityMps:Array(2*n+1).fill(0),inletMPa:p.outletMPa,backWallMPa:p.outletMPa,aheadWallMPa:p.outletMPa,movingForceMismatchMPa:null,maxReynolds:0};r.frames.push(last);
    const stride=Math.max(1,Math.ceil((base.samples.length-1)/150));
    for(let k=1;k<base.samples.length;k++){
      const prev=base.samples[k-1],next=base.samples[k],dt=next.timeSec-prev.timeSec;
      if(prev.timeSec<switchSec-1e-8&&next.timeSec>switchSec+1e-8)throw new Error('Шаг пересекает смену метки; нужна согласованная временная сетка.');
      const step=pressureAleStep(p,n,mu,state,pressure,pistonFaces(p,n,next.xM),dt,p.rateLps/1000*p.rhoBackKgM3,prev.timeSec>=switchSec-1e-8?[0,1,0]:[1,0,0]);
      const injected=r.injectedKg.map((m,j)=>m+step.injectedKg[j]),returned=r.returnedKg.map((m,j)=>m+step.returnedKg[j]),retained=[0,1,2].map(j=>total(step.state.massKg.map((m,i)=>m*step.state.fractions[i][j]))),residuals=retained.map((m,j)=>Math.abs(r.initialKg[j]+injected[j]-returned[j]-m));
      if(residuals.some((e,j)=>e>1e-7*Math.max(1,r.initialKg[j]+injected[j],returned[j]+retained[j])))throw new Error('Накопленный баланс пространственного давления не сошёлся.');
      state=step.state;pressure=step.pressures;r.injectedKg=injected;r.returnedKg=returned;r.retainedKg=retained;r.acceptedSteps++;
      r.maxMassResidualKg=Math.max(r.maxMassResidualKg,step.maxContinuityResidualKg);r.maxComponentResidualKg=Math.max(r.maxComponentResidualKg,step.maxMassResidualKg,...residuals);r.maxGeometricResidualM3=Math.max(r.maxGeometricResidualM3,step.maxGeometricResidualM3);r.maxReynolds=Math.max(r.maxReynolds,step.maxReynolds);
      last={timeSec:next.timeSec,xM:next.xM,facesM:state.facesM,massesKg:state.massKg,fractions:state.fractions,pressuresMPa:pressure,relativeFluxKgS:step.relativeFluxKgS,laboratoryVelocityMps:step.laboratoryVelocityMps,inletMPa:step.inletMPa,backWallMPa:step.backWallMPa,aheadWallMPa:step.aheadWallMPa,movingForceMismatchMPa:!next.landed&&next.velocityMps>1e-9?step.backWallMPa-step.aheadWallMPa-p.breakawayMPa-p.dragMPaPerMps*next.velocityMps:null,maxReynolds:step.maxReynolds};
      if(k%stride===0||k===base.samples.length-1||next.landed&&!prev.landed||Math.abs(next.timeSec-switchSec)<1e-8)r.frames.push(last);
    }
    r.status=base.status;r.reason=base.status==='complete'?'Пространственные давления рассчитаны на заданной траектории; обратная связь с движением не включена.':'Пространственные давления рассчитаны только на принятой части механического прогона.';
  }catch(e){r.reason=e instanceof Error?e.message:String(e);}
  if(last&&r.frames.at(-1)?.timeSec!==last.timeSec)r.frames.push(last);return r;
}
export function plugPressureCsv(r:PlugHydraulics,f:HydraulicFrame){
  return 'status;time_s;cell;left_m;right_m;p_mpa;mass_kg;back_fraction;marker_fraction;ahead_fraction\n'+f.massesKg.map((m,i)=>[r.status,f.timeSec,i,f.facesM[i],f.facesM[i+1],f.pressuresMPa[i],m,...f.fractions[i]].join(';')).join('\n');
}
export function plugPressureFacesCsv(r:PlugHydraulics,f:HydraulicFrame){return 'status;time_s;face;x_m;relative_mass_flux_kg_s;laboratory_velocity_m_s\n'+f.facesM.map((x,i)=>[r.status,f.timeSec,i,x,f.relativeFluxKgS[i],f.laboratoryVelocityMps[i]].join(';')).join('\n');}
