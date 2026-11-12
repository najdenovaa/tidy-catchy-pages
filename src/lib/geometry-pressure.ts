import {advanceAle,type AleState} from './ale-transport';
import {resolveBenchLaws,isNewtonian,pipeFlowForPressure,wallStressForRate,hbFlowAtWall,type PipeLaw,type BenchRheologyPair} from './bench-rheology';
import type {CompiledBenchGeometry} from './bench-geometry';
import type {MovingPlugCase} from './moving-plug';
const gravity=9.80665/1e6;
function rho(ref:number,k:number,p:number,trial=false){if(!Number.isFinite(p)||(trial?Math.abs(p/k)>.5:p<0||p/k>.1))throw new Error('Геометрическая EOS: разрежение или выход за P/K ≤ 10%; свободная поверхность не моделируется.');return ref*Math.exp(p/k);}
function linear(l:number[],d:number[],u:number[],b:number[]){d=[...d];b=[...b];for(let i=1;i<d.length;i++){if(!(d[i-1]>0))throw new Error('Вырожденная геометрическая матрица.');const w=l[i]/d[i-1];d[i]-=w*u[i-1];b[i]-=w*b[i-1];}const x=d.map(()=>0);x[x.length-1]=b.at(-1)!/d.at(-1)!;for(let i=x.length-2;i>=0;i--)x[i]=(b[i]-u[i]*x[i+1])/d[i];return x;}
type Part={lengthM:number;diameterMm:number};
function seriesLoss(q:number,parts:Part[],law:PipeLaw,external=0){let value=external*Math.abs(q),derivative=external;for(const c of parts){const tau=wallStressForRate(q,c.diameterMm,law),scale=4*c.lengthM/(c.diameterMm/1000)/1e6;value+=scale*tau;const d=isNewtonian(law)?Math.PI*(c.diameterMm/2000)**3/(4*law.K):hbFlowAtWall(tau,c.diameterMm/2000,law).derivative;derivative+=d>0?scale/d:Infinity;}return {value,derivative};}
export function seriesFlow(dp:number,parts:Part[],law:PipeLaw,external=0){
 if(parts.length===1)return pipeFlowForPressure(dp,parts[0].lengthM,parts[0].diameterMm,law,external);
 if(isNewtonian(law)){const r=external+parts.reduce((s,c)=>s+8*law.K*c.lengthM/(Math.PI*(c.diameterMm/2000)**4)/1e6,0);return {q:dp/r,derivative:1/r,tau:0};}
 const target=Math.abs(dp),yieldDrop=parts.reduce((s,c)=>s+4*c.lengthM*law.tau0/(c.diameterMm/1000)/1e6,0);if(target<=yieldDrop)return {q:0,derivative:0,tau:0};
 let lo=0,hi=Math.min(...parts.map(c=>Math.abs(pipeFlowForPressure(dp,c.lengthM,c.diameterMm,law).q)),external>0?target/external:Infinity),q=hi/2;
 for(let i=0;i<60;i++){const f=seriesLoss(q,parts,law,external),res=f.value-target;if(Math.abs(res)<1e-12*Math.max(1,target))return {q:Math.sign(dp)*q,derivative:1/f.derivative,tau:0};if(res>0)hi=q;else lo=q;const next=q-res/f.derivative;q=next>lo&&next<hi?next:(lo+hi)/2;}
 throw new Error('Расход через секции не сошёлся.');
}
function fromRight(pRight:number,zRight:number,zLeft:number,ref:number,k:number){let p=pRight;for(let i=0;i<80;i++){const next=pRight-(rho(ref,k,p,true)+rho(ref,k,pRight,true))/2*gravity*(zRight-zLeft);if(Math.abs(next-p)<1e-12)return next;p=next;}throw new Error('Гидростатика не сошлась.');}
export function initializeGeometryPressure(p:MovingPlugCase,n:number,g:CompiledBenchGeometry){
 const faces=g.faces(p.initialXM,n),centers=faces.slice(1).map((x,i)=>g.fromLogical((x+faces[i])/2)),pressures=Array(2*n).fill(0);let right=p.outletMPa,z=g.tvd(p.totalLengthM);
 for(let i=2*n-1;i>=n;i--){pressures[i]=fromRight(right,z,g.tvd(centers[i]),p.rhoAheadKgM3,p.bulkAheadMPa);right=pressures[i];z=g.tvd(centers[i]);}
 const wall=fromRight(right,z,g.tvd(p.initialXM),p.rhoAheadKgM3,p.bulkAheadMPa);right=wall;z=g.tvd(p.initialXM);
 for(let i=n-1;i>=0;i--){pressures[i]=fromRight(right,z,g.tvd(centers[i]),p.rhoBackKgM3,p.bulkBackMPa);right=pressures[i];z=g.tvd(centers[i]);}
 const inlet=fromRight(right,z,g.tvd(0),p.rhoBackKgM3,p.bulkBackMPa),mass=pressures.map((v,i)=>g.areaRef*(faces[i+1]-faces[i])*rho(i<n?p.rhoBackKgM3:p.rhoAheadKgM3,i<n?p.bulkBackMPa:p.bulkAheadMPa,v));rho(p.rhoBackKgM3,p.bulkBackMPa,inlet);rho(p.rhoBackKgM3,p.bulkBackMPa,wall);rho(p.rhoAheadKgM3,p.bulkAheadMPa,wall);
 return {state:{facesM:faces,massKg:mass,fractions:pressures.map((_,i)=>i<n?[1,0,0]:[0,0,1])} as AleState,pressures,inletMPa:inlet,wallMPa:wall};
}
export function geometryPressureStep(p:MovingPlugCase,n:number,mu:number,old:AleState,oldPressure:number[],faces:number[],dt:number,source:number,injection:number[],trial:boolean,rheology:BenchRheologyPair|undefined,g:CompiledBenchGeometry){
 const count=2*n,laws=resolveBenchLaws(rheology,mu),a=g.areaRef;
 if(!Number.isInteger(n)||n<1||n>60||faces.length!==count+1||old.facesM.length!==count+1||old.massKg.length!==count||oldPressure.length!==count||!(dt>0&&Number.isFinite(dt)&&source>=0&&Number.isFinite(source))||faces[0]!==0||faces.at(-1)!==g.logicalLength)throw new Error('Недопустимая объёмная сетка геометрического расчёта.');
 const md=faces.map(g.fromLogical),centers=faces.slice(1).map((x,i)=>g.fromLogical((x+faces[i])/2)),z=centers.map(g.tvd),volume=faces.slice(1).map((x,i)=>a*(x-faces[i])),swept=faces.map((x,i)=>a*(x-old.facesM[i])/dt),ref=volume.map((_,i)=>i<n?p.rhoBackKgM3:p.rhoAheadKgM3),bulk=volume.map((_,i)=>i<n?p.bulkBackMPa:p.bulkAheadMPa),segments=Array.from({length:count+1},(_,i)=>i===n?[]:g.parts(i===0?0:centers[i-1],i===count?p.totalLengthM:centers[i]));
 if(volume.some(v=>!Number.isFinite(v)||v<=0)||old.massKg.some((m,i)=>!Number.isFinite(m)||m<=0||Math.abs(m-a*(old.facesM[i+1]-old.facesM[i])*rho(ref[i],bulk[i],oldPressure[i]))>1e-8*Math.max(1,m)))throw new Error('Исходная масса не согласована с геометрической EOS.');
 const evalAt=(pressure:number[])=>{
  const dens=pressure.map((v,i)=>rho(ref[i],bulk[i],v,trial)),mass=dens.map((r,i)=>r*volume[i]),flux=Array(count+1).fill(0),q=Array(count+1).fill(0),dl=Array(count+1).fill(0),dr=Array(count+1).fill(0);flux[0]=source;q[0]=source/dens[0];q[n]=swept[n];
  for(let i=1;i<=count;i++)if(i!==n){const left=i-1,right=i===count?p.outletMPa:pressure[i],rr=i===count?rho(ref[left],bulk[left],right,trial):dens[i],dz=(i===count?g.tvd(p.totalLengthM):z[i])-z[left],head=(dens[left]+rr)/2*gravity*dz,drive=pressure[left]-right+head,dlDrive=1+dens[left]/(2*bulk[left])*gravity*dz,drDrive=-1+rr/(2*bulk[left])*gravity*dz;if(dlDrive<=0||drDrive>=0)throw new Error('Слишком крупный гидростатический интервал.');const f=seriesFlow(i===count?Math.max(0,drive):drive,segments[i],i<n?laws.back:laws.ahead,i===count?p.outletResistanceMPaPerM3s:0);q[i]=f.q;const rel=q[i]-swept[i],up=rel>=0?left:Math.min(i,count-1);flux[i]=dens[up]*rel;dl[i]=dens[up]*f.derivative*dlDrive+(up===left?flux[i]/bulk[up]:0);dr[i]=dens[up]*f.derivative*drDrive+(up===i?flux[i]/bulk[up]:0);if(i===count&&drive<0)dl[i]=0;}
  const residual=mass.map((m,i)=>m-old.massKg[i]+dt*(flux[i+1]-flux[i])),norm=Math.max(...residual.map((v,i)=>Math.abs(v)/Math.max(1,old.massKg[i])));return {dens,mass,flux,q,dl,dr,residual,norm};
 };
 let pressure=[...oldPressure],e=evalAt(pressure),iterations=0;
 for(let it=0;e.norm>1e-12&&it<Math.max(80,2*count);it++){iterations++;const delta=linear(volume.map((_,i)=>i?-dt*e.dl[i]:0),e.mass.map((m,i)=>m/bulk[i]+dt*(e.dl[i+1]-e.dr[i])),volume.map((_,i)=>i<count-1?dt*e.dr[i+1]:0),e.residual.map(v=>-v));let found=false;for(let j=0;j<24;j++)try{const scale=2**(-j),next=pressure.map((v,i)=>v+scale*delta[i]),test=evalAt(next);if(test.norm<e.norm*(1-1e-7*scale)||test.norm<=1e-12){pressure=next;e=test;found=true;break;}}catch{}if(!found)throw new Error('Давление с геометрией не нашло допустимого шага.');}
 if(e.norm>1e-12)throw new Error('Давление с геометрией не сошлось.');
 const backParts=g.parts(centers[n-1],md[n]),frontParts=g.parts(md[n],centers[n]);
 const surface=(pc:number,zc:number,zs:number,ref:number,k:number,loss:number)=>{let wall=pc;for(let j=0;j<80;j++){const next=pc+(rho(ref,k,pc,trial)+rho(ref,k,wall,true))/2*gravity*(zs-zc)+loss;if(Math.abs(next-wall)<1e-12)return next;wall=next;}throw new Error('Поверхностное давление не сошлось.');};
 let backWallMPa=surface(pressure[n-1],z[n-1],g.tvd(md[n]),p.rhoBackKgM3,p.bulkBackMPa,-Math.sign(e.q[n])*seriesLoss(e.q[n],backParts,laws.back).value),aheadWallMPa=surface(pressure[n],z[n],g.tvd(md[n]),p.rhoAheadKgM3,p.bulkAheadMPa,Math.sign(e.q[n])*seriesLoss(e.q[n],frontParts,laws.ahead).value);
 if(e.q[n]===0){const yb=backParts.reduce((s,c)=>s+4*c.lengthM*laws.back.tau0/(c.diameterMm/1000)/1e6,0),yf=frontParts.reduce((s,c)=>s+4*c.lengthM*laws.ahead.tau0/(c.diameterMm/1000)/1e6,0),alpha=yb+yf>0?Math.min(1,Math.max(0,(backWallMPa-aheadWallMPa-p.breakawayMPa)/(yb+yf))):0;backWallMPa-=alpha*yb;aheadWallMPa+=alpha*yf;}
 const inletMPa=surface(pressure[0],z[0],g.tvd(0),p.rhoBackKgM3,p.bulkBackMPa,seriesLoss(e.q[0],segments[0],laws.back).value);
 const velocity=e.q.map((q,i)=>q/g.sectionAt(md[i]).areaM2),metric=(q:number,d:number,r:number,law:PipeLaw)=>{if(q===0)return 0;const u=q/(Math.PI*(d/1000)**2/4),tau=wallStressForRate(q,d,law);return 8*r*u*u/tau;};
 let rb=0,rf=0;for(let i=0;i<=count;i++){if(i<n){const density=Math.max(e.dens[Math.max(0,i-1)],e.dens[Math.min(i,n-1)]);for(const c of segments[i])rb=Math.max(rb,metric(e.q[i],c.diameterMm,density,laws.back));}else if(i>n){const density=Math.max(e.dens[i-1],e.dens[Math.min(i,count-1)]);for(const c of segments[i])rf=Math.max(rf,metric(e.q[i],c.diameterMm,density,laws.ahead));}else{for(const c of backParts)rb=Math.max(rb,metric(e.q[i],c.diameterMm,e.dens[n-1],laws.back));for(const c of frontParts)rf=Math.max(rf,metric(e.q[i],c.diameterMm,e.dens[n],laws.ahead));}}
 if(!trial&&(rb>(isNewtonian(laws.back)?2000:1000)||rf>(isNewtonian(laws.ahead)?2000:1000)))throw new Error('Предел ламинарного режима превышен в секционном контуре.');
 if(!trial){rho(p.rhoBackKgM3,p.bulkBackMPa,inletMPa);rho(p.rhoBackKgM3,p.bulkBackMPa,backWallMPa);rho(p.rhoAheadKgM3,p.bulkAheadMPa,aheadWallMPa);}if(![inletMPa,backWallMPa,aheadWallMPa,rb,rf].every(Number.isFinite))throw new Error('Невыразимое геометрическое состояние.');
 const transport=advanceAle(old,faces,e.mass,e.flux,dt,a,injection,undefined,n);return {...transport,pressures:pressure,relativeFluxKgS:e.flux,laboratoryVelocityMps:velocity,inletMPa,backWallMPa,aheadWallMPa,maxReynolds:Math.max(rb,rf),maxReynoldsBack:rb,maxReynoldsAhead:rf,maxContinuityResidualKg:Math.max(...e.residual.map(Math.abs)),iterations};
}
