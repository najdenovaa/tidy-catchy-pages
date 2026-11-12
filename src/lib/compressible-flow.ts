import {pipeFrictionMPa,annularFrictionMPa} from './cementing-calculations';
import type {HBParams} from './cement-rheology';
export interface FlowFluid {id:string;name:string;rhoRef:number;bulkMPa:number;pv:number;yp:number;hb?:HBParams}
export interface FlowCell {volumeM3:number;lengthM:number;tvd:number;kind:'pipe'|'annulus';outerMm:number;innerMm:number;md:number;standoffPct?:number}
export interface FlowState {pressures:number[];fractions:number[][];masses:number[]}
export interface FlowStep {state:FlowState;fluxKgS:number[];inletMPa:number;returnedKg:number[];maxComponentResidualKg:number;maxRelativeResidual:number;iterations:number}
export interface FlowSystem {frictionMultiplier?:number;cells:FlowCell[];fluids:FlowFluid[];referenceMPa:number;outletMPa:number;inletTvd:number;outletTvd:number}
const sum=(a:number[])=>a.reduce((n,v)=>n+v,0);
/** Harmonic mass-fraction mixture, additive physical volumes, exponential constant-K EOS. */
export function mixtureDensity(fluids:FlowFluid[],fractions:number[],p:number,pref:number){
 let v=0,beta=0;
 for(let j=0;j<fluids.length;j++){
  const f=fluids[j],x=(p-pref)/f.bulkMPa;
  if(!Number.isFinite(x)||Math.abs(x)>.1)throw new Error('EOS: |P-Pref|/K > 10%.');
  const specific=fractions[j]/(f.rhoRef*Math.exp(x));v+=specific;beta+=specific/f.bulkMPa;
 }
 if(!(v>0))throw new Error('EOS: неположительный удельный объём.');
 return {rho:1/v,derivative:beta/(v*v)};
}
function tridiagonal(lower:number[],diagonal:number[],upper:number[],rhs:number[]){
 const d=[...diagonal],b=[...rhs];
 for(let i=1;i<d.length;i++){if(!(Math.abs(d[i-1])>1e-20))throw new Error('Вырожденная матрица потока.');const w=lower[i]/d[i-1];d[i]-=w*upper[i-1];b[i]-=w*b[i-1];}
 const x=d.map(()=>0);x[x.length-1]=b.at(-1)!/d.at(-1)!;for(let i=x.length-2;i>=0;i--)x[i]=(b[i]-upper[i]*x[i+1])/d[i];return x;
}
/** Face momentum is quasi-steady: pressure + gravity balances viscous/yield/turbulent loss. */
function face(s:FlowSystem,i:number,p:number[],fractions:number[][],zeroFlow=false){
 const n=s.cells.length,left=s.cells[i-1],right=s.cells[i];
 const pl=i===0?p[0]:p[i-1],pr=i===n?s.outletMPa:p[i],pm=(pl+pr)/2;
 const f=i===n?fractions[n-1]:i===0?fractions[0]:s.fluids.map((_,j)=>(fractions[i-1][j]+fractions[i][j])/2);
 const rho=mixtureDensity(s.fluids,f,pm,s.referenceMPa).rho;
 const dz=i===n?s.outletTvd-left.tvd:i===0?right.tvd-s.inletTvd:right.tvd-left.tvd;
 const drive=pl-pr+rho*9.81*dz/1e6;
 const weights=s.fluids.map((v,j)=>f[j]/(v.rhoRef*Math.exp((pm-s.referenceMPa)/v.bulkMPa))*rho);
 const loss=(q:number)=>{
  let value=0;
  for(const c of [left,right])if(c)for(let j=0;j<s.fluids.length;j++)if(weights[j]>1e-10){
   const fluid=s.fluids[j],r=c.kind==='pipe'?pipeFrictionMPa(q*1000,c.lengthM/2,c.innerMm,fluid.pv,fluid.yp,rho,fluid.hb):annularFrictionMPa(q*1000,c.lengthM/2,c.outerMm,c.innerMm,fluid.pv,fluid.yp,rho,c.standoffPct??100,fluid.hb);
   value+=weights[j]*r.pressureMPa;
  }
  return value*(s.frictionMultiplier??1);
 };
 if(zeroFlow)return {flux:0,conductance:0,loss};
 const target=Math.abs(drive),yieldLoss=loss(1e-13);
 if(target<=yieldLoss+1e-14){const slope=(loss(1e-7)-yieldLoss)/1e-7;return {flux:0,conductance:slope>0?rho/(slope+yieldLoss/.002):0,loss};}
 let lo=0,hi=.002;while(loss(hi)<target&&hi<.256)hi*=2;
 if(hi>=.256&&loss(hi)<target)throw new Error('Расход грани превышает область расчёта 256 л/с.');
 for(let k=0;k<40;k++){const mid=(lo+hi)/2;if(loss(mid)<target)lo=mid;else hi=mid;}
 const q=(lo+hi)/2,eps=Math.max(1e-9,q*1e-3),slope=(loss(q+eps)-loss(Math.max(1e-14,q-eps)))/(2*eps);
 if(!(slope>0))throw new Error('Немонотонное сопротивление грани.');
 return {flux:Math.sign(drive)*q*rho,conductance:rho/slope,loss};
}
export function initializeFlow(s:FlowSystem,mudIndex:number):FlowState{
 if(!s.cells.length||!s.fluids.length||!s.fluids[mudIndex]||s.cells.some(c=>!Number.isFinite(c.volumeM3)||c.volumeM3<=0||c.lengthM<=0||c.innerMm<=0)||s.fluids.some(f=>!(f.bulkMPa>0&&f.rhoRef>0)))throw new Error('Некорректная геометрия или свойства потока.');
 const fractions=s.cells.map(()=>s.fluids.map((_,j)=>j===mudIndex?1:0)),pressures=s.cells.map(()=>s.outletMPa);
 // Equilibrium of the same midpoint-gravity discretization used by the flow faces.
 for(let i=s.cells.length-1;i>=0;i--){const next=i===s.cells.length-1?s.outletMPa:pressures[i+1],nextTvd=i===s.cells.length-1?s.outletTvd:s.cells[i+1].tvd,dz=s.cells[i].tvd-nextTvd;let p=next;
  for(let k=0;k<30;k++){const rho=mixtureDensity(s.fluids,fractions[i],(p+next)/2,s.referenceMPa).rho;const value=next+rho*9.81*dz/1e6;if(Math.abs(value-p)<1e-12){p=value;break;}p=value;}pressures[i]=p;
 }
 return {pressures,fractions,masses:s.cells.map((c,i)=>c.volumeM3*mixtureDensity(s.fluids,fractions[i],pressures[i],s.referenceMPa).rho)};
}
/** Implicit finite-volume mass + upwind species; quasi-Newton pressure / Picard composition. */
export function advanceFlow(s:FlowSystem,old:FlowState,dt:number,inletKgS:number,inletFluid:number):FlowStep{
 if(!(dt>0&&Number.isFinite(dt)&&inletKgS>=0&&Number.isFinite(inletKgS))||!s.fluids[inletFluid])throw new Error('Недопустимый шаг или подача.');
 const n=s.cells.length,nf=s.fluids.length;let fractions=old.fractions.map(f=>[...f]),p=[...old.pressures],iterations=0;
 let flux:number[]=[],mass:number[]=[];
 for(let outer=0;outer<16;outer++){
  let converged=false;
  for(let it=0;it<40;it++){
   iterations++;
   const faces=Array.from({length:n},(_,j)=>face(s,j+1,p,fractions));flux=[inletKgS,...faces.map(f=>f.flux)];
   const rho=s.cells.map((_,i)=>mixtureDensity(s.fluids,fractions[i],p[i],s.referenceMPa));mass=s.cells.map((c,i)=>c.volumeM3*rho[i].rho);
   const residual=mass.map((m,i)=>m-old.masses[i]+dt*(flux[i+1]-flux[i]));
   if(Math.max(...residual.map((r,i)=>Math.abs(r)/Math.max(old.masses[i],1)))<1e-9){converged=true;break;}
   const lower=p.map(()=>0),diag=p.map((_,i)=>s.cells[i].volumeM3*rho[i].derivative),upper=p.map(()=>0);
   for(let i=0;i<n;i++){const g=dt*faces[i].conductance;diag[i]+=g;if(i<n-1){upper[i]-=g;lower[i+1]-=g;diag[i+1]+=g;}}
   const delta=tridiagonal(lower,diag,upper,residual.map(r=>-r));const damping=Math.min(1,20/Math.max(20,...delta.map(Math.abs)));
   const norm=Math.max(...residual.map((r,i)=>Math.abs(r)/Math.max(old.masses[i],1)));
   let accepted=false;
   for(let line=0;line<16;line++){
    const scale=damping*2**(-line),trial=p.map((v,i)=>v+delta[i]*scale);
    try{
     const trialFlux=[inletKgS,...Array.from({length:n},(_,j)=>face(s,j+1,trial,fractions).flux)];
     const trialNorm=Math.max(...s.cells.map((c,i)=>Math.abs(c.volumeM3*mixtureDensity(s.fluids,fractions[i],trial[i],s.referenceMPa).rho-old.masses[i]+dt*(trialFlux[i+1]-trialFlux[i]))/Math.max(old.masses[i],1)));
     if(trialNorm<norm*(1-1e-8*scale)||trialNorm<1e-9){p=trial;accepted=true;break;}
    }catch{ /* backtrack from an inadmissible trial, never commit it */ }
   }
   if(!accepted)throw new Error('Демпфирование давления не нашло допустимого шага.');
  }
  if(!converged)throw new Error('Давление не сошлось на шаге.');
  if(flux[n]<-1e-7)throw new Error('Обратный приток через линию возврата не задан.');
  const previous=fractions,next=s.cells.map(()=>s.fluids.map(()=>0));
  const lower=mass.map((_,i)=>i>0?-dt*Math.max(flux[i],0):0),upper=mass.map((_,i)=>i<n-1?dt*Math.min(flux[i+1],0):0),diag=mass.map((m,i)=>m+dt*(Math.max(flux[i+1],0)+Math.max(-flux[i],0)));
  for(let j=0;j<nf;j++){
   const rhs=old.masses.map((m,i)=>m*old.fractions[i][j]+(i===0&&j===inletFluid?dt*inletKgS:0));
   const x=tridiagonal(lower,diag,upper,rhs);for(let i=0;i<n;i++)next[i][j]=x[i];
  }
  if(next.some(f=>f.some(x=>x< -1e-10||!Number.isFinite(x))||Math.abs(sum(f)-1)>1e-6))throw new Error('Некорректные массовые доли.');
  fractions=next.map(f=>{const total=sum(f);return f.map(v=>Math.max(0,v)/total);});
  const change=Math.max(...fractions.flatMap((f,i)=>f.map((v,j)=>Math.abs(v-previous[i][j]))));
  if(change>1e-9)continue;
  const finalMass=s.cells.map((c,i)=>c.volumeM3*mixtureDensity(s.fluids,fractions[i],p[i],s.referenceMPa).rho);
  let maxComponentResidualKg=0,maxRelativeResidual=0;
  for(let i=0;i<n;i++)for(let j=0;j<nf;j++){
   const inward=i===0?inletKgS*(j===inletFluid?1:0):flux[i]*(flux[i]>=0?fractions[i-1][j]:fractions[i][j]);
   const outward=flux[i+1]*(i===n-1?fractions[i][j]:flux[i+1]>=0?fractions[i][j]:fractions[i+1][j]);
   const residual=finalMass[i]*fractions[i][j]-old.masses[i]*old.fractions[i][j]+dt*(outward-inward);
   maxComponentResidualKg=Math.max(maxComponentResidualKg,Math.abs(residual));maxRelativeResidual=Math.max(maxRelativeResidual,Math.abs(residual)/Math.max(old.masses[i],1));
  }
  if(maxRelativeResidual>1e-7)throw new Error('Компонентный баланс шага не сошёлся.');
  const rhoIn=mixtureDensity(s.fluids,fractions[0],p[0],s.referenceMPa).rho;
  const inletLoss=face(s,0,p,fractions,true).loss(inletKgS/rhoIn);
  const inletMPa=p[0]-rhoIn*9.81*(s.cells[0].tvd-s.inletTvd)/1e6+inletLoss;
  if(Math.min(inletMPa,...p)<-1e-5)throw new Error('Разрежение: требуется модель свободной поверхности / U-tube.');
  return {state:{pressures:p,fractions,masses:finalMass},fluxKgS:flux,inletMPa,returnedKg:fractions[n-1].map(v=>v*Math.max(0,flux[n])*dt),maxComponentResidualKg,maxRelativeResidual,iterations};
 }
 throw new Error('Состав и давление совместно не сошлись.');
}
