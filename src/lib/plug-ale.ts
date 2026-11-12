import {advanceAle,type AleState} from './ale-transport';
import {simulateMovingPlug,type MovingPlugCase,type MovingPlugResult,type PlugSpatialResult,type PlugSpatialFrame} from './moving-plug';
export function simulatePlugAle(input:MovingPlugCase,cellsPerChamber=8,switchSec=0):MovingPlugResult {
 const valid=Number.isInteger(cellsPerChamber)&&cellsPerChamber>=1&&cellsPerChamber<=60&&Number.isFinite(switchSec)&&switchSec>=0&&switchSec<=input.durationSec;
 const base=simulateMovingPlug(input,valid?[switchSec]:[]),p=base.input,spatial:PlugSpatialResult={status:'stopped',reason:'',cellsPerChamber,switchSec,frames:[],initialKg:[0,0,0],injectedKg:[0,0,0],returnedKg:[0,0,0],retainedKg:[0,0,0],maxComponentResidualKg:0,maxGeometricResidualM3:0,acceptedSteps:0};base.spatial=spatial;let lastAcceptedFrame:PlugSpatialFrame|undefined;
 try{
  if(!valid)throw new Error('Нужны 1-60 ячеек в каждой камере и момент смены метки в пределах прогона.');
  if(!base.samples.length)throw new Error('Нет принятого начального состояния механического стенда.');
  const n=cellsPerChamber,a=Math.PI*(p.diameterMm/1000)**2/4,faces=(x:number)=>[...Array.from({length:n+1},(_,i)=>x*(i/n)),...Array.from({length:n},(_,i)=>i===n-1?p.totalLengthM:x+(p.totalLengthM-x)*((i+1)/n))],masses=(b:number,f:number)=>[...Array(n).fill(b/n),...Array(n).fill(f/n)];
  const first=base.samples[0];let state:AleState={facesM:faces(first.xM),massKg:masses(first.backMassKg,first.aheadMassKg),fractions:Array.from({length:2*n},(_,i)=>i<n?[1,0,0]:[0,0,1])};
  advanceAle(state,state.facesM,state.massKg,Array(2*n+1).fill(0),1,a,[1,0,0],undefined,n); // Validate the initial geometry/state without advancing physical time.
  spatial.initialKg=[first.backMassKg,0,first.aheadMassKg];
  const retain=()=>{spatial.retainedKg=[0,1,2].map(j=>state.massKg.reduce((v,m,i)=>v+m*state.fractions[i][j],0));};
  const capture=(timeSec:number,xM:number):PlugSpatialFrame=>({timeSec,xM,facesM:[...state.facesM],massKg:[...state.massKg],fractions:state.fractions.map(f=>[...f])});retain();lastAcceptedFrame=capture(first.timeSec,first.xM);spatial.frames.push(lastAcceptedFrame);
  const stride=Math.max(1,Math.ceil((base.samples.length-1)/150));
  for(let k=1;k<base.samples.length;k++){
   const prev=base.samples[k-1],next=base.samples[k],dt=next.timeSec-prev.timeSec,newMass=masses(next.backMassKg,next.aheadMassKg),flux=Array(2*n+1).fill(0),source=(next.injectedKg-prev.injectedKg)/dt;
   flux[0]=source;for(let i=0;i<n;i++)flux[i+1]=flux[i]-(newMass[i]-state.massKg[i])/dt;
   if(Math.abs(flux[n])>1e-7*Math.max(1,source))throw new Error('Масса задней камеры не согласована с герметичной границей.');flux[n]=0;
   for(let i=n;i<2*n;i++)flux[i+1]=flux[i]-(newMass[i]-state.massKg[i])/dt;
   if(Math.abs(flux[2*n]-(next.returnedKg-prev.returnedKg)/dt)>1e-7*Math.max(1,source))throw new Error('Отток передней камеры не согласован с механическим стендом.');flux[2*n]=(next.returnedKg-prev.returnedKg)/dt;
   const injection=prev.timeSec>=switchSec-1e-8?[0,1,0]:[1,0,0],step=advanceAle(state,faces(next.xM),newMass,flux,dt,a,injection,undefined,n);
   const injected=spatial.injectedKg.map((m,j)=>m+step.injectedKg[j]),returned=spatial.returnedKg.map((m,j)=>m+step.returnedKg[j]),retained=[0,1,2].map(j=>step.state.massKg.reduce((v,m,i)=>v+m*step.state.fractions[i][j],0)),residuals=retained.map((m,j)=>Math.abs(spatial.initialKg[j]+injected[j]-returned[j]-m));
   if(residuals.some((e,j)=>e>1e-7*Math.max(1,spatial.initialKg[j]+injected[j],returned[j]+retained[j])))throw new Error('Накопленный компонентный ALE-баланс не сошёлся.');
   state=step.state;lastAcceptedFrame=capture(next.timeSec,next.xM);spatial.acceptedSteps++;spatial.injectedKg=injected;spatial.returnedKg=returned;spatial.retainedKg=retained;
   spatial.maxComponentResidualKg=Math.max(spatial.maxComponentResidualKg,step.maxMassResidualKg,...residuals);spatial.maxGeometricResidualM3=Math.max(spatial.maxGeometricResidualM3,step.maxGeometricResidualM3);
   if(k%stride===0||k===base.samples.length-1||next.landed&&!prev.landed||Math.abs(next.timeSec-switchSec)<1e-8)spatial.frames.push(lastAcceptedFrame);
  }
  spatial.status=base.status==='complete'?'complete':'stopped';spatial.reason=base.status==='complete'?'Пространственный перенос метки рассчитан на всех принятых шагах механического стенда.':'Показан перенос только на принятой части остановленного механического прогона.';
 }catch(error){if(lastAcceptedFrame&&spatial.frames.at(-1)?.timeSec!==lastAcceptedFrame.timeSec)spatial.frames.push(lastAcceptedFrame);spatial.reason=error instanceof Error?error.message:String(error);}
 return base;
}
export function plugSpatialCsv(r:PlugSpatialResult){return 'status;last_accepted_time_s;component;initial_kg;injected_kg;returned_kg;retained_kg;residual_kg\n'+r.retainedKg.map((m,j)=>[r.status,r.frames.at(-1)?.timeSec??'',j,r.initialKg[j],r.injectedKg[j],r.returnedKg[j],m,r.initialKg[j]+r.injectedKg[j]-r.returnedKg[j]-m].join(';')).join('\n');}

export function plugSpatialProfileCsv(r:PlugSpatialResult,f:PlugSpatialFrame){return 'status;time_s;cell;left_m;right_m;mass_kg;back_fraction;marker_fraction;ahead_fraction\n'+f.massKg.map((m,i)=>[r.status,f.timeSec,i,f.facesM[i],f.facesM[i+1],m,...f.fractions[i]].join(';')).join('\n');}
