import {hbFriction,hbRegimeBounds,type HBParams} from './cement-rheology';

/** Axisymmetric angular-momentum transport, SI units throughout. Not a three-dimensional CFD solution. */
export interface SwirlFluid {density:number;hb:HBParams;}
export interface SwirlSection {innerM:number;outerM:number;}
export interface SwirlState extends SwirlSection {omega:number[];flowAreaScale?:number;}
export interface SwirlBlade {count:number;angleDeg:number;heightM:number;widthM:number;lengthM:number;sleeveM:number;}
export const SWIRL_RESIDUAL=.001;
export interface SwirlStats {meanMs:number;rmsMs:number;moment:number;phaseGradient:number;}
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));

export function swirlStats(s:SwirlState,qM3s:number):SwirlStats {
  const dr=(s.outerM-s.innerM)/s.omega.length,area=(s.outerM*s.outerM-s.innerM*s.innerM)/2;
  let mean=0,energy=0,moment=0,phase=0;
  for(let i=0;i<s.omega.length;i++){
    const r=s.innerM+(i+.5)*dr,w=r*dr,v=s.omega[i]*r;
    mean+=w*v;energy+=w*v*v;moment+=w*r*v;phase+=w*s.omega[i];
  }
  const u=qM3s/(2*Math.PI*area*(s.flowAreaScale??1));
  return {meanMs:mean/area,rmsMs:Math.sqrt(energy/area),moment:qM3s*moment/area,phaseGradient:u>0?phase/area/u:0};
}

/** Remap equal-area stream tubes preserving r*vθ (specific angular momentum) and thus its convected flux. */
export function remapSwirl(s:SwirlState,g:SwirlSection):SwirlState {
  const n=s.omega.length,dr=(g.outerM-g.innerM)/n,oldDr=(s.outerM-s.innerM)/n;
  const omega=Array.from({length:n},(_,i)=>{
    const r=g.innerM+(i+.5)*dr,t=(r*r-g.innerM*g.innerM)/(g.outerM*g.outerM-g.innerM*g.innerM);
    const oldR=Math.sqrt(s.innerM*s.innerM+t*(s.outerM*s.outerM-s.innerM*s.innerM));
    const j=clamp((oldR-s.innerM)/oldDr-.5,0,n-1),a=Math.floor(j),b=Math.min(n-1,a+1);
    return (s.omega[a]+(s.omega[b]-s.omega[a])*(j-a))*oldR*oldR/(r*r);
  });
  const next={...g,omega},old=swirlStats(s,1).moment,current=swirlStats(next,1).moment;
  if(current>0)for(let i=0;i<n;i++)omega[i]*=old/current;
  return next;
}

function diffusivities(s:SwirlState,q:number,f:SwirlFluid) {
  const n=s.omega.length,h=s.outerM-s.innerM,dr=h/n,dh=2*h,u=q/(Math.PI*(s.outerM*s.outerM-s.innerM*s.innerM)*(s.flowAreaScale??1));
  const friction=hbFriction(f.hb,u,dh,1,f.density,'annulus'),bounds=hbRegimeBounds(f.hb);
  const blend=clamp((friction.reynolds-bounds.laminar)/(bounds.turbulent-bounds.laminar),0,1);
  const G=((2*f.hb.n+1)/(3*f.hb.n))*1.5,wallGamma=8*G*u/dh;
  const wallMu=f.hb.tau0/Math.max(wallGamma,1e-9)+f.hb.K*Math.max(wallGamma,1e-9)**(f.hb.n-1);
  const uStar=Math.sqrt(Math.max(0,friction.wallShearPa)/f.density);
  return Array.from({length:n+1},(_,i)=>{
    const r=s.innerM+i*dr,y=Math.min(r-s.innerM,s.outerM-r);
    const shearTheta=i===0?r*s.omega[0]/(dr/2):i===n?r*s.omega[n-1]/(dr/2):r*(s.omega[i]-s.omega[i-1])/dr;
    // Prescribed axial shear distribution, combined invariant for HB apparent viscosity.
    const shearAxial=wallGamma*Math.abs(2*(r-s.innerM)/h-1);
    const gamma=Math.max(1e-5,Math.hypot(shearAxial,shearTheta));
    const molecular=f.hb.tau0/gamma+f.hb.K*gamma**(f.hb.n-1);
    const yPlus=f.density*uStar*y/Math.max(1e-12,wallMu);
    const mixingLength=.41*y*(1-Math.exp(-yPlus/26));
    const eddy=f.density*mixingLength*mixingLength*shearAxial*blend;
    return (molecular+eddy)/f.density;
  });
}

/** Implicit conservative FV step: ρ uz r³ ∂ω/∂z = ∂(r³ μeff ∂ω/∂r)/∂r, stationary no-slip walls. */
export function advanceSwirl(s:SwirlState,dz:number,q:number,f:SwirlFluid,source?:(r:number,v:number,u:number)=>number):SwirlState {
  if(!(q>0&&dz>0))return {...s,omega:s.omega.slice()};
  const n=s.omega.length,dr=(s.outerM-s.innerM)/n,u=q/(Math.PI*(s.outerM*s.outerM-s.innerM*s.innerM)*(s.flowAreaScale??1));
  const old=s.omega,answer={...s,omega:old.slice()};
  // Picard iteration resolves viscosity from the combined axial and tangential shear.
  for(let iteration=0;iteration<4;iteration++){
    const nu=diffusivities(answer,q,f),lower=new Float64Array(n),diag=new Float64Array(n),upper=new Float64Array(n),rhs=new Float64Array(n);
    for(let i=0;i<n;i++){
      const r=s.innerM+(i+.5)*dr,a=s.innerM+i*dr,b=a+dr,volume=(b**4-a**4)/4;
      const left=dz*nu[i]*a**3/(u*volume*(i===0?dr/2:dr)),right=dz*nu[i+1]*b**3/(u*volume*(i===n-1?dr/2:dr));
      lower[i]=-left;upper[i]=-right;diag[i]=1+left+right;
      rhs[i]=old[i]+dz*(source?.(r,answer.omega[i]*r,u)??0)/r;
      if(i){const m=lower[i]/diag[i-1];diag[i]-=m*upper[i-1];rhs[i]-=m*rhs[i-1];}
    }
    for(let i=n-1;i>=0;i--)answer.omega[i]=Math.max(0,(rhs[i]-(i<n-1?upper[i]*answer.omega[i+1]:0))/diag[i]);
  }
  return answer;
}

export function swirlStepSize(s:SwirlState,q:number,f:SwirlFluid):number {
  const nu=diffusivities(s,q,f).sort((a,b)=>a-b),mean=nu[Math.floor(nu.length/2)];
  const h=s.outerM-s.innerM,u=q/(Math.PI*(s.outerM*s.outerM-s.innerM*s.innerM)*(s.flowAreaScale??1));
  return clamp(u*h*h/(Math.PI*Math.PI*Math.max(1e-12,mean))/16,1e-5,2);
}

/** Finite-length guide action: Bernoulli normal pressure on each blade transfers angular momentum.
 * This is an ideal pressure-turning closure, not a fitted passport efficiency. */
export function generateSwirl(section:SwirlSection,blade:SwirlBlade,q:number,f:SwirlFluid,n=20) {
  const innerM=section.innerM+blade.sleeveM,outerM=section.outerM;
  const passage=Math.PI*(outerM*outerM-innerM*innerM),ribArea=blade.count*blade.widthM*Math.max(0,blade.heightM-blade.sleeveM);
  let state:SwirlState={innerM,outerM,omega:Array(n).fill(0),flowAreaScale:clamp(1-ribArea/passage,.05,1)};
  const profiles:{z:number;state:SwirlState}[]=[{z:-blade.lengthM,state}];
  if(!(q>0&&blade.angleDeg>0&&blade.heightM>blade.sleeveM))return {state:remapSwirl(state,section),profiles};
  const angle=blade.angleDeg*Math.PI/180,top=section.innerM+blade.heightM;
  const source=(r:number,v:number,u:number)=>{
    if(r>top)return 0;
    const pitch=Math.max(.0001,2*Math.PI*r/blade.count-blade.widthM);
    const normal=u*Math.sin(angle)-v*Math.cos(angle);
    // Δp_n = ρ un²/2; normal blade area/axial length = 1/cos(angle), which cancels its θ projection.
    return Math.max(0,normal)*Math.max(0,normal)/(2*pitch*u);
  };
  const steps=64;
  for(let i=0;i<steps;i++){
    state=advanceSwirl(state,blade.lengthM/steps,q,f,source);
    if((i+1)%4===0)profiles.push({z:-blade.lengthM+(i+1)*blade.lengthM/steps,state});
  }
  return {state:remapSwirl(state,section),profiles};
}
